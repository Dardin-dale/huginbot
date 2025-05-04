/**
 * backup.js - HuginBot CLI backup commands
 * 
 * Manages backup and restore operations
 */
const inquirer = require('inquirer');
const ora = require('ora');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs');
const boxen = require('boxen');
const { getConfig, saveConfig } = require('../utils/config');
const { 
  getInstanceStatus, 
  createBackup, 
  listBackups, 
  downloadBackup, 
  getActiveWorldFromSSM
} = require('../utils/aws');

// Command group registration
function register(program) {
  const backup = program
    .command('backup')
    .description('Manage Valheim world backups');
  
  backup
    .command('list')
    .description('List available backups')
    .option('-w, --world <worldName>', 'Filter backups by world name')
    .option('-n, --limit <number>', 'Limit the number of backups to show', parseInt)
    .action(listBackupFiles);
  
  backup
    .command('create')
    .description('Create a new backup of the current world')
    .action(createBackupFile);
  
  backup
    .command('download')
    .description('Download a backup')
    .option('-p, --path <path>', 'Download location')
    .action(downloadBackupFile);
  
  backup
    .command('restore')
    .description('Restore a backup (server must be stopped)')
    .action(restoreBackup);
    
  backup
    .command('rotate')
    .description('Clean up old backups')
    .option('-k, --keep <number>', 'Number of backups to keep per world', parseInt, 7)
    .option('-f, --force', 'Skip confirmation prompt', false)
    .option('-w, --world <worldName>', 'Only rotate backups for specific world')
    .action(rotateBackups);
  
  return backup;
}

// List available backups
async function listBackupFiles(options) {
  const config = getConfig();
  
  if (!config.backupBucket) {
    console.log(chalk.yellow('⚠️  Backup bucket not configured.'));
    console.log('Run setup wizard to configure: ' + chalk.cyan('huginbot setup'));
    return;
  }
  
  const spinner = ora('Fetching backups...').start();
  
  try {
    const backups = await listBackups(config.backupBucket, options.world);
    spinner.succeed('Retrieved backup list');
    
    if (backups.length === 0) {
      console.log(chalk.yellow('No backups found'));
      if (options.world) {
        console.log(`No backups found for world "${options.world}"`);
      } else {
        console.log('No backups found for any world');
      }
      return;
    }
    
    // Limit number of backups to display if requested
    const limitedBackups = options.limit && options.limit > 0 
      ? backups.slice(0, options.limit) 
      : backups;
    
    console.log(chalk.cyan.bold(`\n📋 Available Backups${options.world ? ` for world ${options.world}` : ''}:`));
    console.log(`${chalk.bold('#')}  ${chalk.bold('World'.padEnd(20))} ${chalk.bold('Date'.padEnd(20))} ${chalk.bold('Size')}`);
    console.log('-'.repeat(60));
    
    limitedBackups.forEach((backup, index) => {
      const dateStr = backup.lastModified ? 
        backup.lastModified.toLocaleString() : 
        'Unknown';
      
      const sizeStr = formatSize(backup.size);
      
      console.log(`${(index + 1).toString().padEnd(3)} ${backup.worldName.padEnd(20)} ${dateStr.padEnd(20)} ${sizeStr}`);
    });
    
    if (options.limit && backups.length > options.limit) {
      console.log(chalk.yellow(`\nShowing ${options.limit} of ${backups.length} backups. Use --limit to show more.`));
    }
    
    console.log('');
  } catch (error) {
    spinner.fail('Failed to retrieve backups');
    console.error(chalk.red('Error:'), error.message);
  }
}

// Create a backup of the current world
async function createBackupFile() {
  const config = getConfig();
  
  if (!config.instanceId) {
    console.log(chalk.yellow('❌ Server not deployed. Deploy it first with:'));
    console.log(chalk.cyan('  huginbot deploy valheim'));
    return;
  }
  
  const spinner = ora('Checking server status...').start();
  const status = await getInstanceStatus();
  
  if (status !== 'running') {
    spinner.fail(`Unable to create backup - server is not running (status: ${status})`);
    console.log(chalk.yellow('⚠️  The server must be running to create a backup.'));
    console.log('Start it with: ' + chalk.cyan('huginbot server start'));
    return;
  }
  
  // Get the active world name
  try {
    const activeWorld = await getActiveWorldFromSSM();
    spinner.succeed(`Creating backup of world: ${activeWorld.name}`);
    
    console.log(chalk.yellow('⚠️  Creating a backup while players are connected is safe but may cause brief lag.'));
    
    const { confirmCreate } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmCreate',
        message: 'Create backup now?',
        default: true
      }
    ]);
    
    if (!confirmCreate) {
      console.log(chalk.yellow('❌ Backup creation cancelled.'));
      return;
    }
    
    spinner.text = 'Creating backup...';
    spinner.start();
    
    await createBackup();
    
    spinner.succeed('Backup created successfully');
    console.log(chalk.green(`✅ Created backup of world "${activeWorld.name}"`));
    console.log(`View backups with: ${chalk.cyan('huginbot backup list')}`);
  } catch (error) {
    spinner.fail('Failed to create backup');
    console.error(chalk.red('Error:'), error.message);
  }
}

// Download a backup to local machine
async function downloadBackupFile(options) {
  const config = getConfig();
  
  if (!config.backupBucket) {
    console.log(chalk.yellow('⚠️  Backup bucket not configured.'));
    console.log('Run setup wizard to configure: ' + chalk.cyan('huginbot setup'));
    return;
  }
  
  const spinner = ora('Fetching available backups...').start();
  
  try {
    const backups = await listBackups(config.backupBucket);
    spinner.succeed('Retrieved backup list');
    
    if (backups.length === 0) {
      console.log(chalk.yellow('No backups found'));
      return;
    }
    
    // Create choices for the user to select from
    const choices = backups.slice(0, 20).map((backup, index) => {
      const dateStr = backup.lastModified ? 
        backup.lastModified.toLocaleString() : 
        'Unknown';
      
      return {
        name: `${backup.worldName} (${dateStr}) - ${formatSize(backup.size)}`,
        value: backup
      };
    });
    
    const { selectedBackup } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedBackup',
        message: 'Select backup to download:',
        choices,
        pageSize: 10
      }
    ]);
    
    // Determine download location
    let downloadLocation = options.path;
    
    if (!downloadLocation) {
      const { location } = await inquirer.prompt([
        {
          type: 'input',
          name: 'location',
          message: 'Enter download location (directory):',
          default: '.',
          validate: (input) => {
            try {
              const stats = fs.statSync(input);
              return stats.isDirectory() ? true : 'Not a directory';
            } catch (error) {
              return 'Directory does not exist';
            }
          }
        }
      ]);
      
      downloadLocation = location;
    }
    
    // Generate filename based on backup details
    const backupDate = selectedBackup.lastModified ? 
      selectedBackup.lastModified.toISOString().replace(/[:.]/g, '-').split('T')[0] : 
      'unknown-date';
    
    const filename = `${selectedBackup.worldName}-${backupDate}.tar.gz`;
    const fullPath = path.join(downloadLocation, filename);
    
    // Confirm download
    console.log(chalk.cyan(`Downloading backup to: ${fullPath}`));
    
    const { confirmDownload } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmDownload',
        message: 'Proceed with download?',
        default: true
      }
    ]);
    
    if (!confirmDownload) {
      console.log(chalk.yellow('❌ Download cancelled.'));
      return;
    }
    
    spinner.text = 'Downloading backup...';
    spinner.start();
    
    await downloadBackup(config.backupBucket, selectedBackup.key, fullPath);
    
    spinner.succeed('Backup downloaded successfully');
    console.log(chalk.green(`✅ Downloaded backup to: ${fullPath}`));
  } catch (error) {
    spinner.fail('Failed to download backup');
    console.error(chalk.red('Error:'), error.message);
  }
}

// Clean up old backups (rotate)
async function rotateBackups(options) {
  const config = getConfig();
  
  if (!config.backupBucket) {
    console.log(chalk.yellow('⚠️  Backup bucket not configured.'));
    console.log('Run setup wizard to configure: ' + chalk.cyan('huginbot setup'));
    return;
  }
  
  // Validate keep count
  const keepCount = options.keep;
  if (isNaN(keepCount) || keepCount < 1) {
    console.log(chalk.red('❌ Invalid number of backups to keep. Must be at least 1.'));
    return;
  }
  
  const spinner = ora('Fetching backups...').start();
  
  try {
    // First list all backups, filtered by world if specified
    const backups = await listBackups(config.backupBucket, options.world);
    spinner.succeed('Retrieved backup list');
    
    if (backups.length === 0) {
      console.log(chalk.yellow('No backups found to rotate'));
      return;
    }
    
    // Group backups by world
    const backupsByWorld = backups.reduce((groups, backup) => {
      const world = backup.worldName;
      if (!groups[world]) {
        groups[world] = [];
      }
      groups[world].push(backup);
      return groups;
    }, {});
    
    // For each world, determine which backups to delete (keep most recent N)
    let totalToDelete = 0;
    const backupsToDelete = [];
    
    for (const world in backupsByWorld) {
      // Sort by date (most recent first)
      const worldBackups = backupsByWorld[world].sort((a, b) => {
        const dateA = a.lastModified ? a.lastModified.getTime() : 0;
        const dateB = b.lastModified ? b.lastModified.getTime() : 0;
        return dateB - dateA;
      });
      
      // Keep most recent 'keepCount' backups
      const toDelete = worldBackups.slice(keepCount);
      totalToDelete += toDelete.length;
      backupsToDelete.push(...toDelete);
    }
    
    if (totalToDelete === 0) {
      console.log(chalk.green('✅ No backups need to be deleted. All worlds have fewer than the maximum allowed backups.'));
      return;
    }
    
    // Format and display backups that will be deleted
    console.log(chalk.cyan.bold(`\n📋 Backups to Delete (keeping ${keepCount} most recent per world):`));
    console.log(`${chalk.bold('#')}  ${chalk.bold('World'.padEnd(20))} ${chalk.bold('Date'.padEnd(20))} ${chalk.bold('Size')}`);
    console.log('-'.repeat(60));
    
    backupsToDelete.forEach((backup, index) => {
      const dateStr = backup.lastModified ? 
        backup.lastModified.toLocaleString() : 
        'Unknown';
      
      const sizeStr = formatSize(backup.size);
      
      console.log(`${(index + 1).toString().padEnd(3)} ${backup.worldName.padEnd(20)} ${dateStr.padEnd(20)} ${sizeStr}`);
    });
    
    // Confirm deletion unless --force is specified
    if (!options.force) {
      const { confirmDelete } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmDelete',
          message: `Are you sure you want to delete ${totalToDelete} backups?`,
          default: false
        }
      ]);
      
      if (!confirmDelete) {
        console.log(chalk.yellow('❌ Backup rotation cancelled.'));
        return;
      }
    }
    
    // Delete backups
    spinner.text = 'Deleting old backups...';
    spinner.start();
    
    // Implement the delete functionality (needs AWS S3 delete operation)
    // This is just a stub - you need to implement actual S3 deletion here
    console.log(chalk.red('This is a preview - actual deletion functionality is not yet implemented.'));
    console.log(chalk.yellow('This feature is handled by the cleanup-backups Lambda function in AWS.'));
    
    spinner.succeed(`Preview: Would delete ${totalToDelete} backups`);
    
  } catch (error) {
    spinner.fail('Failed to rotate backups');
    console.error(chalk.red('Error:'), error.message);
  }
}

// Restore a backup
async function restoreBackup() {
  console.log(chalk.yellow('⚠️  Restoring backups is an advanced operation and requires manual steps.'));
  console.log(chalk.yellow('⚠️  The server must be stopped before restoring a backup.'));
  
  const config = getConfig();
  
  if (!config.instanceId) {
    console.log(chalk.red('❌ Server not deployed. Deploy it first with:'));
    console.log(chalk.cyan('  huginbot deploy valheim'));
    return;
  }
  
  const spinner = ora('Checking server status...').start();
  const status = await getInstanceStatus();
  
  if (status === 'running') {
    spinner.fail('Server is currently running');
    console.log(chalk.red('❌ The server must be stopped before restoring a backup.'));
    console.log('Stop it with: ' + chalk.cyan('huginbot server stop'));
    return;
  }
  
  spinner.succeed('Server is stopped, continuing with restore');
  
  // Display restore instructions
  console.log(boxen(
    chalk.bold('🔄 Backup Restore Procedure 🔄\n\n') +
    '1. Download the desired backup:\n' +
    '   ' + chalk.cyan('huginbot backup download\n\n') +
    '2. Upload the backup to the server manually using SSH:\n' +
    '   ' + chalk.cyan('scp backup-file.tar.gz ec2-user@your-server:/tmp/\n\n') +
    '3. Connect to the server via SSH:\n' +
    '   ' + chalk.cyan('ssh ec2-user@your-server\n\n') +
    '4. Extract the backup to the appropriate location:\n' +
    '   ' + chalk.cyan('sudo tar -xzf /tmp/backup-file.tar.gz -C /opt/valheim/server/data\n\n') +
    '5. Update permissions:\n' +
    '   ' + chalk.cyan('sudo chown -R 1000:1000 /opt/valheim/server/data\n\n') +
    '6. Start the server using HuginBot:\n' +
    '   ' + chalk.cyan('huginbot server start'),
    { padding: 1, margin: 1, borderStyle: 'round', borderColor: 'yellow' }
  ));
  
  console.log(chalk.red('\n⚠️  WARNING: Restoring a backup will overwrite the current world data!'));
  console.log(chalk.red('⚠️  Make sure to download the current world first if needed.'));
}

// Helper function to format file size
function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

module.exports = {
  register,
  listBackupFiles,
  createBackupFile,
  downloadBackupFile,
  restoreBackup,
  rotateBackups
};