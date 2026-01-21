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
const { loadESMDependencies } = require('../utils/esm-loader');
const { getConfig, getConfigWithStackOutputs, saveConfig } = require('../utils/config');
const {
  getInstanceStatus,
  createBackup,
  listBackups,
  downloadBackup,
  uploadBackup,
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

  backup
    .command('upload')
    .description('Upload a local world backup to S3')
    .option('-w, --world <worldName>', 'World name for the backup')
    .option('-f, --file <filePath>', 'Path to the backup file (.tar.gz or .zip)')
    .action(uploadBackupFile);

  backup
    .command('sync')
    .description('Sync backups between local directory and S3 (organized by world)')
    .option('-d, --direction <direction>', 'Sync direction: pull (S3→local), push (local→S3), or both', 'pull')
    .option('-w, --world <worldName>', 'Only sync backups for specific world')
    .option('--local-dir <path>', 'Local backups directory', './backups')
    .action(syncBackups);

  return backup;
}

// List available backups
async function listBackupFiles(options) {
  const config = await getConfigWithStackOutputs();

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
  const config = await getConfigWithStackOutputs();

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
    
    // Determine download location - default to ./backups/<WorldName>/
    let downloadLocation = options.path;
    const defaultBackupDir = path.join('./backups', selectedBackup.worldName);

    if (!downloadLocation) {
      const { location } = await inquirer.prompt([
        {
          type: 'input',
          name: 'location',
          message: 'Enter download location (directory):',
          default: defaultBackupDir,
          validate: (input) => {
            // Allow creating new directories
            if (!fs.existsSync(input)) {
              return true; // Will be created
            }
            try {
              const stats = fs.statSync(input);
              return stats.isDirectory() ? true : 'Not a directory';
            } catch (error) {
              return true; // Will be created
            }
          }
        }
      ]);
      
      downloadLocation = location;
    }
    
    // Use original S3 filename
    const filename = path.basename(selectedBackup.key);
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
  const config = await getConfigWithStackOutputs();

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
  const { boxen } = await loadESMDependencies();
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

// Upload a local backup to S3
async function uploadBackupFile(options) {
  const config = await getConfigWithStackOutputs();

  if (!config.backupBucket) {
    console.log(chalk.yellow('⚠️  Backup bucket not configured.'));
    console.log('Run setup wizard to configure: ' + chalk.cyan('huginbot setup'));
    return;
  }

  let filePath = options.file;
  let worldName = options.world;

  // If no file specified, prompt for it
  if (!filePath) {
    const { inputPath } = await inquirer.prompt([
      {
        type: 'input',
        name: 'inputPath',
        message: 'Enter path to backup file (.tar.gz or .zip):',
        validate: (input) => {
          if (!input) return 'File path is required';
          if (!fs.existsSync(input)) return 'File does not exist';
          if (!input.endsWith('.tar.gz') && !input.endsWith('.zip')) {
            return 'File must be a .tar.gz or .zip archive';
          }
          return true;
        }
      }
    ]);
    filePath = inputPath;
  }

  // Validate file exists
  if (!fs.existsSync(filePath)) {
    console.log(chalk.red(`❌ File not found: ${filePath}`));
    return;
  }

  // Validate file type
  const isZip = filePath.endsWith('.zip');
  const isTarGz = filePath.endsWith('.tar.gz');
  if (!isZip && !isTarGz) {
    console.log(chalk.red(`❌ File must be a .tar.gz or .zip archive`));
    return;
  }

  // If no world name specified, prompt for it
  if (!worldName) {
    // Try to extract world name from filename
    let defaultWorld = path.basename(filePath);
    defaultWorld = defaultWorld.replace(/\.tar\.gz$/, '').replace(/\.zip$/, '');
    defaultWorld = defaultWorld.replace(/_backup.*/, '').replace(/^\d{4}-\d{2}-\d{2}_/, '');

    const { inputWorld } = await inquirer.prompt([
      {
        type: 'input',
        name: 'inputWorld',
        message: 'Enter world name for this backup:',
        default: defaultWorld,
        validate: (input) => input ? true : 'World name is required'
      }
    ]);
    worldName = inputWorld;
  }

  // Get file stats
  const stats = fs.statSync(filePath);
  const sizeStr = formatSize(stats.size);

  console.log(chalk.cyan(`\n📦 Backup Upload Summary:`));
  console.log(`   File: ${filePath}`);
  console.log(`   Size: ${sizeStr}`);
  console.log(`   World: ${worldName}`);
  if (isZip) {
    console.log(`   ${chalk.yellow('Note: ZIP file will be converted to tar.gz for upload')}`);
  }
  console.log(`   Destination: s3://${config.backupBucket}/worlds/${worldName}/\n`);

  const { confirmUpload } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmUpload',
      message: 'Proceed with upload?',
      default: true
    }
  ]);

  if (!confirmUpload) {
    console.log(chalk.yellow('❌ Upload cancelled.'));
    return;
  }

  let uploadPath = filePath;
  let tempFile = null;

  try {
    // Convert ZIP to tar.gz if needed
    if (isZip) {
      const spinner = ora('Converting ZIP to tar.gz...').start();
      tempFile = await convertZipToTarGz(filePath, worldName);
      uploadPath = tempFile;
      spinner.succeed('ZIP converted to tar.gz');
    }

    const spinner = ora('Uploading backup...').start();
    const s3Uri = await uploadBackup(config.backupBucket, worldName, uploadPath);
    spinner.succeed('Upload complete');
    console.log(chalk.green(`\n✅ Backup uploaded successfully!`));
    console.log(`   Location: ${s3Uri}`);
    console.log(chalk.cyan(`\nTo use this world, run: huginbot worlds select`));
  } catch (error) {
    console.error(chalk.red('Error:'), error.message);
  } finally {
    // Clean up temp file
    if (tempFile && fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }
}

// Sync backups between local directory and S3
async function syncBackups(options) {
  const config = await getConfigWithStackOutputs();

  if (!config.backupBucket) {
    console.log(chalk.yellow('⚠️  Backup bucket not configured.'));
    console.log('Run setup wizard to configure: ' + chalk.cyan('huginbot setup'));
    return;
  }

  const localDir = path.resolve(options.localDir);
  const direction = options.direction.toLowerCase();
  const worldFilter = options.world;

  // Validate direction
  if (!['pull', 'push', 'both'].includes(direction)) {
    console.log(chalk.red(`❌ Invalid direction: ${direction}. Use 'pull', 'push', or 'both'.`));
    return;
  }

  // Create local backups directory if it doesn't exist
  if (!fs.existsSync(localDir)) {
    fs.mkdirSync(localDir, { recursive: true });
    console.log(chalk.green(`✓ Created local backups directory: ${localDir}`));
  }

  console.log(chalk.cyan(`\n📦 Backup Sync`));
  console.log(`   Local directory: ${localDir}`);
  console.log(`   S3 bucket: s3://${config.backupBucket}/worlds/`);
  console.log(`   Direction: ${direction}`);
  if (worldFilter) {
    console.log(`   World filter: ${worldFilter}`);
  }
  console.log('');

  try {
    // Get list of S3 backups
    const spinner = ora('Fetching S3 backup list...').start();
    const s3Backups = await listBackups(config.backupBucket, worldFilter);
    spinner.succeed(`Found ${s3Backups.length} backups in S3`);

    // Get list of local backups
    const localBackups = getLocalBackups(localDir, worldFilter);
    console.log(chalk.gray(`Found ${localBackups.length} local backups`));

    // Build maps for comparison - key by world/filename
    const s3BackupMap = new Map(
      s3Backups.map(b => [`${b.worldName}/${path.basename(b.key)}`, b])
    );
    const localBackupMap = new Map(
      localBackups.map(b => [`${b.worldName}/${b.filename}`, b])
    );

    let pullCount = 0;
    let pushCount = 0;
    let skipCount = 0;

    // Pull: Download S3 backups that don't exist locally (organized by world)
    if (direction === 'pull' || direction === 'both') {
      console.log(chalk.cyan('\n📥 Pulling from S3...'));

      for (const s3Backup of s3BackupMap.values()) {
        const worldName = s3Backup.worldName;
        const filename = path.basename(s3Backup.key);
        const worldDir = path.join(localDir, worldName);
        const localPath = path.join(worldDir, filename);

        if (fs.existsSync(localPath)) {
          // Check if sizes match
          const localStats = fs.statSync(localPath);
          if (localStats.size === s3Backup.size) {
            skipCount++;
            continue;
          }
        }

        // Create world directory if needed
        fs.mkdirSync(worldDir, { recursive: true });

        // Download the backup to world subdirectory
        const dlSpinner = ora(`Downloading ${worldName}/${filename}...`).start();
        try {
          await downloadBackup(config.backupBucket, s3Backup.key, localPath);
          dlSpinner.succeed(`Downloaded ${worldName}/${filename}`);
          pullCount++;
        } catch (error) {
          dlSpinner.fail(`Failed to download ${worldName}/${filename}: ${error.message}`);
        }
      }
    }

    // Push: Upload local backups that don't exist in S3
    if (direction === 'push' || direction === 'both') {
      console.log(chalk.cyan('\n📤 Pushing to S3...'));

      for (const [mapKey, localBackup] of localBackupMap) {
        if (s3BackupMap.has(mapKey)) {
          // Already exists in S3
          const s3Backup = s3BackupMap.get(mapKey);
          if (s3Backup.size === localBackup.size) {
            skipCount++;
            continue;
          }
        }

        // Upload the backup
        const ulSpinner = ora(`Uploading ${localBackup.worldName}/${localBackup.filename}...`).start();
        try {
          await uploadBackup(config.backupBucket, localBackup.worldName, localBackup.path);
          ulSpinner.succeed(`Uploaded ${localBackup.worldName}/${localBackup.filename}`);
          pushCount++;
        } catch (error) {
          ulSpinner.fail(`Failed to upload ${localBackup.worldName}/${localBackup.filename}: ${error.message}`);
        }
      }
    }

    // Summary
    console.log(chalk.green(`\n✅ Sync complete!`));
    if (pullCount > 0) console.log(`   Downloaded: ${pullCount} backups`);
    if (pushCount > 0) console.log(`   Uploaded: ${pushCount} backups`);
    if (skipCount > 0) console.log(`   Skipped (already synced): ${skipCount} backups`);
    if (pullCount === 0 && pushCount === 0) {
      console.log(`   Everything is already in sync!`);
    }

  } catch (error) {
    console.error(chalk.red('Sync failed:'), error.message);
  }
}

// Get list of local backup files (organized by world subdirectories)
function getLocalBackups(localDir, worldFilter = null) {
  const backups = [];

  if (!fs.existsSync(localDir)) {
    return backups;
  }

  // Scan for world subdirectories
  const items = fs.readdirSync(localDir, { withFileTypes: true });

  for (const item of items) {
    if (item.isDirectory()) {
      const worldName = item.name;

      // Apply world filter if specified
      if (worldFilter && worldName.toLowerCase() !== worldFilter.toLowerCase()) {
        continue;
      }

      const worldDir = path.join(localDir, worldName);
      const worldFiles = fs.readdirSync(worldDir);

      for (const file of worldFiles) {
        if (file.endsWith('.tar.gz')) {
          const filePath = path.join(worldDir, file);
          const stats = fs.statSync(filePath);
          backups.push({
            filename: file,
            path: filePath,
            worldName: worldName,
            size: stats.size,
            lastModified: stats.mtime
          });
        }
      }
    }
  }

  return backups;
}

// Convert a ZIP file to tar.gz format with proper Valheim backup structure
async function convertZipToTarGz(zipPath, worldName) {
  const { execSync } = require('child_process');
  const os = require('os');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huginbot-'));
  const extractDir = path.join(tempDir, 'extract');
  const outputDir = path.join(tempDir, 'output');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
  const tarGzPath = path.join(tempDir, `${worldName}_backup_${timestamp}.tar.gz`);

  try {
    // Create directories
    fs.mkdirSync(extractDir, { recursive: true });
    fs.mkdirSync(path.join(outputDir, 'config', 'worlds_local'), { recursive: true });

    // Extract ZIP
    execSync(`unzip -q "${zipPath}" -d "${extractDir}"`, { stdio: 'pipe' });

    // Find world files (.db and .fwl) - they might be in subdirectories
    const findWorldFiles = (dir) => {
      const files = [];
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          files.push(...findWorldFiles(fullPath));
        } else if (item.name.endsWith('.db') || item.name.endsWith('.fwl')) {
          files.push(fullPath);
        }
      }
      return files;
    };

    const worldFiles = findWorldFiles(extractDir);

    if (worldFiles.length === 0) {
      throw new Error('No Valheim world files (.db or .fwl) found in ZIP');
    }

    // Copy world files to proper structure
    for (const file of worldFiles) {
      const destPath = path.join(outputDir, 'config', 'worlds_local', path.basename(file));
      fs.copyFileSync(file, destPath);
      console.log(chalk.gray(`   Found: ${path.basename(file)}`));
    }

    // Create tar.gz
    execSync(`tar -czf "${tarGzPath}" -C "${outputDir}" .`, { stdio: 'pipe' });

    // Clean up extraction directory (but keep tar.gz)
    fs.rmSync(extractDir, { recursive: true });
    fs.rmSync(outputDir, { recursive: true });

    return tarGzPath;
  } catch (error) {
    // Clean up on error
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
    throw error;
  }
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
  rotateBackups,
  uploadBackupFile,
  syncBackups
};