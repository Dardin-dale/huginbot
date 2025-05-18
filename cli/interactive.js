/**
 * HuginBot CLI - Interactive Menu
 * This module implements the interactive CLI menu interface using inquirer.js
 */

const inquirer = require('inquirer');
const chalk = require('chalk');
const { execSync } = require('child_process');
const { getConfig, saveConfig } = require('./utils/config');
const { 
  startServer, 
  stopServer, 
  getServerStatus 
} = require('./commands/server');
const { 
  listWorlds, 
  addWorld, 
  editWorld, 
  removeWorld, 
  switchWorld 
} = require('./commands/worlds');
const {
  createBackup,
  downloadBackup,
  restoreBackup,
  listBackups: listBackupFiles, // alias to match our usage
  rotateBackups
} = require('./commands/backup');
const {
  configureDiscord,
  testDiscord
} = require('./commands/discord');
const {
  configureLocalTesting,
  startLocalTestServer
} = require('./commands/testing');
const { runSetupWizard } = require('./wizard');

/**
 * Main menu for interactive CLI mode
 */
async function mainMenu() {
  const mainChoices = [
    {
      name: `${chalk.green('📋')} Get Started (New User Guide)`,
      value: 'setup'
    },
    {
      name: `${chalk.blue('🖥️')} Server Management`,
      value: 'server'
    },
    {
      name: `${chalk.yellow('🌍')} World Management`,
      value: 'worlds'
    },
    {
      name: `${chalk.magenta('💾')} Backup Management`,
      value: 'backup'
    },
    {
      name: `${chalk.cyan('🤖')} Discord Integration`,
      value: 'discord'
    },
    {
      name: `${chalk.gray('🧪')} Local Testing`,
      value: 'testing'
    },
    {
      name: `${chalk.red('⚙️')} Advanced Settings`,
      value: 'advanced'
    },
    {
      name: `${chalk.red('❌')} Exit`,
      value: 'exit'
    }
  ];

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      pageSize: 10,
      choices: mainChoices,
    }
  ]);

  switch (action) {
    case 'setup':
      await runSetupWizard();
      break;
    case 'server':
      await serverMenu();
      break;
    case 'worlds':
      await worldsMenu();
      break;
    case 'backup':
      await backupMenu();
      break;
    case 'discord':
      await discordMenu();
      break;
    case 'testing':
      await testingMenu();
      break;
    case 'advanced':
      await advancedMenu();
      break;
    case 'exit':
      console.log(chalk.green('Goodbye!'));
      process.exit(0);
  }

  // Return to main menu
  await mainMenu();
}

/**
 * Server management submenu
 */
/**
 * Deploy infrastructure using CDK
 */
async function deployCdk() {
  console.log(chalk.cyan('Deploying HuginBot infrastructure...'));
  
  // Ask if we should deploy all stacks or just one
  const { deployTarget } = await inquirer.prompt([
    {
      type: 'list',
      name: 'deployTarget',
      message: 'What would you like to deploy?',
      choices: [
        { name: 'All Infrastructure', value: 'all' },
        { name: 'Valheim Server Only', value: 'valheim' },
        { name: 'Discord Bot Only', value: 'discord' }
      ]
    }
  ]);

  const { confirmDeploy } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmDeploy',
      message: `Do you want to deploy ${deployTarget === 'all' ? 'all infrastructure' : deployTarget + ' stack'}?`,
      default: true
    }
  ]);

  if (!confirmDeploy) {
    console.log(chalk.yellow('Deployment cancelled.'));
    return;
  }

  try {
    let command;
    switch (deployTarget) {
      case 'all':
        command = 'npm run deploy:all';
        break;
      case 'valheim':
        command = 'npm run deploy:valheim';
        break;
      case 'discord':
        command = 'npm run deploy:discord';
        break;
    }

    console.log(chalk.cyan(`Running: ${command}`));
    execSync(command, { stdio: 'inherit' });
    console.log(chalk.green('✅ Deployment completed successfully!'));
  } catch (error) {
    console.error(chalk.red('❌ Deployment failed:'), error.message);
  }
}

/**
 * Destroy infrastructure using CDK
 */
async function undeployCdk() {
  console.log(chalk.red.bold('⚠️  WARNING: Undeploying Infrastructure'));
  console.log(chalk.yellow('This will permanently delete all resources, including:'));
  console.log('- EC2 instances running your Valheim server');
  console.log('- S3 buckets containing your world backups');
  console.log('- API Gateway endpoints for Discord integration');
  console.log('- Lambda functions and other AWS resources\n');

  const { confirmUndeploy } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmUndeploy',
      message: 'Are you SURE you want to destroy all infrastructure?',
      default: false
    }
  ]);

  if (!confirmUndeploy) {
    console.log(chalk.green('Undeploy cancelled.'));
    return;
  }

  // Extra confirmation
  const { finalConfirmation } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'finalConfirmation',
      message: chalk.red.bold('THIS IS YOUR FINAL WARNING: All data will be lost. Continue?'),
      default: false
    }
  ]);

  if (!finalConfirmation) {
    console.log(chalk.green('Undeploy cancelled.'));
    return;
  }

  try {
    console.log(chalk.cyan('Running: npm run destroy:all'));
    execSync('npm run destroy:all', { stdio: 'inherit' });
    console.log(chalk.green('✅ Undeployment completed successfully!'));
  } catch (error) {
    console.error(chalk.red('❌ Undeployment failed:'), error.message);
  }
}

async function serverMenu() {
  const { serverAction } = await inquirer.prompt([
    {
      type: 'list',
      name: 'serverAction',
      message: 'Server Management:',
      choices: [
        { name: 'Deploy Server', value: 'deploy' },
        { name: 'Start Server', value: 'start' },
        { name: 'Stop Server', value: 'stop' },
        { name: 'Server Status', value: 'status' },
        { name: 'Undeploy Server', value: 'undeploy' },
        { name: 'Back to Main Menu', value: 'back' }
      ]
    }
  ]);

  switch (serverAction) {
    case 'deploy':
      await deployCdk();
      break;
    case 'start':
      await startServer();
      break;
    case 'stop':
      await stopServer();
      break;
    case 'status':
      await getServerStatus();
      break;
    case 'undeploy':
      await undeployCdk();
      break;
    case 'back':
      return;
  }

  // Return to server menu
  await serverMenu();
}

/**
 * World management submenu
 */
async function worldsMenu() {
  const { worldsAction } = await inquirer.prompt([
    {
      type: 'list',
      name: 'worldsAction',
      message: 'World Management:',
      choices: [
        { name: 'List Worlds', value: 'list' },
        { name: 'Add World', value: 'add' },
        { name: 'Edit World', value: 'edit' },
        { name: 'Switch Active World', value: 'switch' },
        { name: 'Remove World', value: 'remove' },
        { name: 'Back to Main Menu', value: 'back' }
      ]
    }
  ]);

  switch (worldsAction) {
    case 'list':
      await listWorlds();
      break;
    case 'add':
      await addWorld();
      break;
    case 'edit':
      await editWorld();
      break;
    case 'switch':
      await switchWorld();
      break;
    case 'remove':
      await removeWorld();
      break;
    case 'back':
      return;
  }

  // Return to worlds menu
  await worldsMenu();
}

/**
 * Backup management submenu
 */
async function backupMenu() {
  // Get configuration to display current backup retention setting
  const config = getConfig();
  const backupsToKeep = config.backupsToKeep || 7;
  
  const { backupAction } = await inquirer.prompt([
    {
      type: 'list',
      name: 'backupAction',
      message: 'Backup Management:',
      choices: [
        { name: 'Create Backup', value: 'create' },
        { name: 'Download Backup', value: 'download' },
        { name: 'List Backups', value: 'list' },
        { name: 'Rotate Backups (Clean Up Old)', value: 'rotate' },
        { name: `Configure Backup Retention (Current: ${backupsToKeep})`, value: 'retention' },
        { name: 'Restore Backup', value: 'restore' },
        { name: 'Back to Main Menu', value: 'back' }
      ]
    }
  ]);

  switch (backupAction) {
    case 'create':
      await createBackup();
      break;
    case 'download':
      await downloadBackup();
      break;
    case 'list':
      await listBackupFiles();
      break;
    case 'rotate':
      await rotateBackups();
      break;
    case 'retention':
      await configureBackupRetention();
      break;
    case 'restore':
      await restoreBackup();
      break;
    case 'back':
      return;
  }

  // Return to backup menu
  await backupMenu();
}

/**
 * Configure backup retention settings
 */
async function configureBackupRetention() {
  const config = getConfig();
  const currentRetention = config.backupsToKeep || 7;
  
  console.log(chalk.cyan.bold('\n⚙️ Backup Retention Configuration'));
  console.log('This setting controls how many backups are kept per world when rotation runs.');
  console.log('Older backups will be automatically deleted, keeping only the most recent ones.');
  console.log(chalk.yellow(`Current setting: ${currentRetention} backups per world`));
  
  const { backupsToKeep } = await inquirer.prompt([
    {
      type: 'number',
      name: 'backupsToKeep',
      message: 'How many backups should be kept per world?',
      default: currentRetention,
      validate: (input) => {
        if (isNaN(input) || input < 1) {
          return 'Please enter a number greater than or equal to 1';
        }
        return true;
      }
    }
  ]);
  
  // Save to config
  config.backupsToKeep = backupsToKeep;
  saveConfig(config);
  
  console.log(chalk.green(`✅ Backup retention updated to ${backupsToKeep} backups per world`));
  
  // Ask if they want to update the CDK environment variable
  const { updateEnv } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'updateEnv',
      message: 'Would you like to update the AWS Lambda environment variable to match?',
      default: true
    }
  ]);
  
  if (updateEnv) {
    console.log(chalk.yellow('To update the Lambda environment variable, you need to redeploy:'));
    console.log(chalk.cyan('  export BACKUPS_TO_KEEP=' + backupsToKeep));
    console.log(chalk.cyan('  npm run deploy:all'));
    console.log('This will ensure the automatic cleanup uses the same retention setting.');
  }
}

/**
 * Discord integration submenu
 */
async function discordMenu() {
  const { discordAction } = await inquirer.prompt([
    {
      type: 'list',
      name: 'discordAction',
      message: 'Discord Integration:',
      choices: [
        { name: 'Configure Discord Bot', value: 'configure' },
        { name: 'Test Discord Connection', value: 'test' },
        { name: 'Back to Main Menu', value: 'back' }
      ]
    }
  ]);

  switch (discordAction) {
    case 'configure':
      await configureDiscord();
      break;
    case 'test':
      await testDiscord();
      break;
    case 'back':
      return;
  }

  // Return to discord menu
  await discordMenu();
}

/**
 * Testing tools submenu
 */
async function testingMenu() {
  const { testingAction } = await inquirer.prompt([
    {
      type: 'list',
      name: 'testingAction',
      message: 'Local Testing:',
      choices: [
        { name: 'Configure Local Testing', value: 'configure' },
        { name: 'Start Local Test Server', value: 'start' },
        { name: 'Back to Main Menu', value: 'back' }
      ]
    }
  ]);

  switch (testingAction) {
    case 'configure':
      await configureLocalTesting();
      break;
    case 'start':
      await startLocalTestServer();
      break;
    case 'back':
      return;
  }

  // Return to testing menu
  await testingMenu();
}

/**
 * Advanced settings submenu
 */
async function advancedMenu() {
  const { advancedAction } = await inquirer.prompt([
    {
      type: 'list',
      name: 'advancedAction',
      message: 'Advanced Settings:',
      choices: [
        { name: 'Parameter Cleanup', value: 'cleanup' },
        { name: 'AWS Region Configuration', value: 'aws' },
        { name: 'Back to Main Menu', value: 'back' }
      ]
    }
  ]);

  if (advancedAction === 'back') {
    return;
  }
  
  if (advancedAction === 'cleanup') {
    await cleanupMenu();
    return;
  }

  // Handle other advanced actions here
  console.log(chalk.yellow('This feature is not yet implemented.'));

  // Return to advanced menu
  await advancedMenu();
}

/**
 * Parameter cleanup submenu
 */
async function cleanupMenu() {
  const { 
    isAutoCleanupEnabled, 
    setAutoCleanupSettings 
  } = require('./utils/auto-cleanup');
  
  const { cleanupAction } = await inquirer.prompt([
    {
      type: 'list',
      name: 'cleanupAction',
      message: 'Parameter Cleanup Management:',
      choices: [
        { name: 'List Parameters', value: 'list' },
        { name: 'Scan for Obsolete Parameters', value: 'scan' },
        { name: 'Mark Parameters as Obsolete', value: 'mark' },
        { name: 'Perform Cleanup', value: 'cleanup' },
        { name: `Auto-Cleanup Settings (${isAutoCleanupEnabled() ? 'Enabled' : 'Disabled'})`, value: 'auto' },
        { name: 'Back to Advanced Menu', value: 'back' }
      ]
    }
  ]);
  
  const cleanupCommands = require('./commands/cleanup');
  
  switch (cleanupAction) {
    case 'list':
      const { listOption } = await inquirer.prompt([
        {
          type: 'list',
          name: 'listOption',
          message: 'Which parameters would you like to list?',
          choices: [
            { name: 'Active Parameters', value: 'active' },
            { name: 'Obsolete Parameters', value: 'obsolete' },
            { name: 'All Parameters', value: 'all' }
          ]
        }
      ]);
      
      await cleanupCommands.listParameters({
        all: listOption === 'all',
        obsolete: listOption === 'obsolete'
      });
      break;
      
    case 'scan':
      await cleanupCommands.scanForObsolete();
      break;
      
    case 'mark':
      await cleanupCommands.markObsolete();
      break;
      
    case 'cleanup':
      await cleanupCommands.performCleanup({ force: false });
      break;
      
    case 'auto':
      const currentStatus = isAutoCleanupEnabled();
      const config = require('./utils/config').getConfig();
      const currentDays = config.autoCleanupDays || 30;
      
      const { autoSettings } = await inquirer.prompt([
        {
          type: 'list',
          name: 'autoSettings',
          message: 'Auto-Cleanup Settings:',
          choices: [
            { 
              name: currentStatus ? 'Disable Auto-Cleanup' : 'Enable Auto-Cleanup', 
              value: !currentStatus 
            },
            { 
              name: `Change Days Threshold (Current: ${currentDays} days)`, 
              value: 'days' 
            },
            { name: 'Back', value: 'back' }
          ]
        }
      ]);
      
      if (autoSettings === 'back') {
        break;
      } else if (autoSettings === 'days') {
        const { days } = await inquirer.prompt([
          {
            type: 'number',
            name: 'days',
            message: 'Delete obsolete parameters after how many days?',
            default: currentDays,
            validate: (value) => value > 0 ? true : 'Days must be greater than 0'
          }
        ]);
        
        setAutoCleanupSettings(currentStatus, days);
        console.log(chalk.green(`Auto-cleanup threshold set to ${days} days`));
      } else {
        setAutoCleanupSettings(autoSettings);
        console.log(chalk.green(`Auto-cleanup ${autoSettings ? 'enabled' : 'disabled'}`));
      }
      break;
      
    case 'back':
      return;
  }
  
  // Return to cleanup menu
  await cleanupMenu();
}

module.exports = mainMenu;