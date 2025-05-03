# HuginBot CLI Enhancement Plan

## Overview

This document outlines specific implementation instructions for improving the HuginBot CLI to provide a more intuitive and user-friendly experience, especially for users who are not familiar with AWS, Discord bot development, or game server hosting.

## Current Architecture

The current architecture uses:
- AWS CDK for infrastructure deployment
- Docker container (lloesche/valheim-server) for server hosting
- Discord webhooks for notifications
- SSM Parameter Store for configuration
- Simple CLI interface with inquirer.js

## Implementation Plan

### 1. CLI Structure Refactoring

#### Directory Structure

```
cli/
├── commands/           # Command modules
│   ├── deploy.js       # Deployment commands
│   ├── server.js       # Server management commands
│   ├── worlds.js       # World management commands
│   ├── backup.js       # Backup management commands
│   ├── discord.js      # Discord integration commands
│   └── testing.js      # Local testing commands
├── ui/                 # UI components
│   ├── spinners.js     # Loading indicators
│   ├── prompts.js      # Common prompt configurations
│   └── styles.js       # Colors and styling
├── utils/              # Utility functions
│   ├── aws.js          # AWS SDK wrappers
│   ├── config.js       # Configuration management
│   └── docker.js       # Docker interactions
├── index.js            # Main entry point
└── wizard.js           # Setup wizard
```

#### Code Implementation

Replace the current monolithic `cli.mjs` with a modular structure using Commander.js:

```javascript
// cli/index.js
const { program } = require('commander');
const chalk = require('chalk');
const figlet = require('figlet');

// Import command modules
const deployCommands = require('./commands/deploy');
const serverCommands = require('./commands/server');
const worldsCommands = require('./commands/worlds');
const backupCommands = require('./commands/backup');
const discordCommands = require('./commands/discord');
const testingCommands = require('./commands/testing');

// Import wizard
const { runSetupWizard } = require('./wizard');

console.log(
  chalk.cyan(
    figlet.textSync('HuginBot', { horizontalLayout: 'full' })
  )
);

program
  .version('1.0.0')
  .description('HuginBot - Valheim Server Manager');

// Add "Get Started" command
program
  .command('setup')
  .description('Start the guided setup process')
  .action(runSetupWizard);

// Register command groups
deployCommands(program);
serverCommands(program);
worldsCommands(program);
backupCommands(program);
discordCommands(program);
testingCommands(program);

// Add interactive mode
program
  .command('interactive', { isDefault: true })
  .description('Start interactive menu')
  .action(() => {
    // This will launch the interactive menu similar to the current CLI
    require('./interactive')();
  });

program.parse(process.argv);
```

### 2. Interactive Menu

The interactive menu should use inquirer.js but with improved organization:

```javascript
// cli/interactive.js
const inquirer = require('inquirer');
const chalk = require('chalk');
const { 
  deployStack, 
  undeployStack 
} = require('./commands/deploy');
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
const { runSetupWizard } = require('./wizard');

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

// Example of a submenu function
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
      await deployStack();
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
      await undeployStack();
      break;
    case 'back':
      return;
  }

  // Return to server menu
  await serverMenu();
}

// Implement other submenu functions (worldsMenu, backupMenu, etc.)

module.exports = mainMenu;
```

### 3. First-Time Setup Wizard

Create a comprehensive setup wizard:

```javascript
// cli/wizard.js
const inquirer = require('inquirer');
const chalk = require('chalk');
const ora = require('ora');
const boxen = require('boxen');
const open = require('open');
const { 
  checkAwsCredentials, 
  setupAwsProfile 
} = require('./utils/aws');
const { saveConfig } = require('./utils/config');
const { deployStack } = require('./commands/deploy');

async function runSetupWizard() {
  console.log(boxen(chalk.bold('Welcome to HuginBot Setup Wizard'), { 
    padding: 1, 
    margin: 1, 
    borderStyle: 'round', 
    borderColor: 'cyan'
  }));

  // Step 1: AWS Configuration
  console.log(chalk.cyan.bold('\n📋 Step 1: AWS Configuration'));
  
  // Check if AWS CLI is installed
  const spinner = ora('Checking AWS credentials...').start();
  const hasCredentials = await checkAwsCredentials();
  
  if (hasCredentials) {
    spinner.succeed('AWS credentials found');
  } else {
    spinner.fail('No valid AWS credentials found');
    
    const { setupAws } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'setupAws',
        message: 'Would you like to set up AWS credentials now?',
        default: true
      }
    ]);
    
    if (setupAws) {
      await setupAwsProfile();
    } else {
      console.log(chalk.yellow('⚠️  You will need valid AWS credentials to deploy HuginBot'));
      console.log('You can set them up later with: aws configure');
      
      const { continuWithoutAws } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'continuWithoutAws',
          message: 'Continue with setup anyway?',
          default: true
        }
      ]);
      
      if (!continuWithoutAws) {
        console.log('Setup cancelled. Exiting...');
        return;
      }
    }
  }
  
  // Step 2: Basic Server Configuration
  console.log(chalk.cyan.bold('\n📋 Step 2: Basic Server Configuration'));
  
  const serverConfig = await inquirer.prompt([
    {
      type: 'input',
      name: 'serverName',
      message: 'Enter server name:',
      default: 'ValheimServer',
      validate: (input) => input.trim() !== '' ? true : 'Server name cannot be empty'
    },
    {
      type: 'input',
      name: 'worldName',
      message: 'Enter world name:',
      default: 'ValheimWorld',
      validate: (input) => input.trim() !== '' ? true : 'World name cannot be empty'
    },
    {
      type: 'password',
      name: 'serverPassword',
      message: 'Enter server password (min 5 characters):',
      default: 'valheim',
      validate: (input) => input.trim().length >= 5 ? true : 'Password must be at least 5 characters'
    },
    {
      type: 'input',
      name: 'adminIds',
      message: 'Enter admin Steam IDs (space separated):',
      default: '',
      validate: (input) => {
        if (input.trim() === '') return true;
        const ids = input.split(' ');
        const validIds = ids.every(id => /^\d+$/.test(id.trim()));
        return validIds ? true : 'Steam IDs should be numeric values';
      }
    }
  ]);
  
  // Step 3: Instance Type Selection
  console.log(chalk.cyan.bold('\n📋 Step 3: Server Hardware Configuration'));
  
  const instanceInfo = [
    { type: 't3.micro', cpu: '2 vCPU', memory: '1 GB', cost: '$0.01/hour', recommended: 'Not recommended for gameplay' },
    { type: 't3.small', cpu: '2 vCPU', memory: '2 GB', cost: '$0.02/hour', recommended: 'Minimal (1-2 players)' },
    { type: 't3.medium', cpu: '2 vCPU', memory: '4 GB', cost: '$0.04/hour', recommended: 'Recommended (2-5 players)' },
    { type: 't3.large', cpu: '2 vCPU', memory: '8 GB', cost: '$0.08/hour', recommended: 'Optimal (5-10 players)' }
  ];
  
  console.log(chalk.yellow('Available instance types:'));
  instanceInfo.forEach(instance => {
    console.log(`${chalk.green(instance.type)} - ${instance.cpu}, ${instance.memory}, ${instance.cost} - ${instance.recommended}`);
  });
  
  const { instanceType } = await inquirer.prompt([
    {
      type: 'list',
      name: 'instanceType',
      message: 'Select instance type:',
      choices: instanceInfo.map(i => ({ name: `${i.type} (${i.recommended})`, value: i.type })),
      default: 't3.medium'
    }
  ]);
  
  // Step 4: Discord Configuration
  console.log(chalk.cyan.bold('\n📋 Step 4: Discord Integration'));
  
  console.log(chalk.yellow('To set up Discord integration, you need to:'));
  console.log('1. Create a Discord application at https://discord.com/developers/applications');
  console.log('2. Create a bot for your application');
  console.log('3. Get the application ID, public key, and bot token');
  
  const { setupDiscord } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'setupDiscord',
      message: 'Would you like to set up Discord integration now?',
      default: true
    }
  ]);
  
  let discordConfig = {
    appId: '',
    publicKey: '',
    botToken: ''
  };
  
  if (setupDiscord) {
    console.log(chalk.green('Opening Discord Developer Portal...'));
    await open('https://discord.com/developers/applications');
    
    discordConfig = await inquirer.prompt([
      {
        type: 'input',
        name: 'appId',
        message: 'Enter Discord Application ID:',
        validate: (input) => /^\d+$/.test(input.trim()) ? true : 'Application ID should be numeric'
      },
      {
        type: 'input',
        name: 'publicKey',
        message: 'Enter Discord Public Key:',
        validate: (input) => input.trim() !== '' ? true : 'Public key cannot be empty'
      },
      {
        type: 'password',
        name: 'botToken',
        message: 'Enter Discord Bot Token:',
        validate: (input) => input.trim() !== '' ? true : 'Bot token cannot be empty'
      }
    ]);
  } else {
    console.log(chalk.yellow('⚠️  Discord integration can be set up later'));
  }
  
  // Step 5: Review and Save Configuration
  console.log(chalk.cyan.bold('\n📋 Step 5: Review Configuration'));
  
  console.log(boxen(
    `Server Name: ${chalk.green(serverConfig.serverName)}\n` +
    `World Name: ${chalk.green(serverConfig.worldName)}\n` +
    `Server Password: ${chalk.green('********')}\n` +
    `Admin IDs: ${chalk.green(serverConfig.adminIds || 'None')}\n` +
    `Instance Type: ${chalk.green(instanceType)}\n` +
    `Discord Integration: ${chalk.green(setupDiscord ? 'Configured' : 'Not configured')}`,
    { padding: 1, borderColor: 'green' }
  ));
  
  const { confirmConfig } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmConfig',
      message: 'Does this configuration look correct?',
      default: true
    }
  ]);
  
  if (!confirmConfig) {
    console.log(chalk.yellow('Configuration not saved. Please run the setup wizard again.'));
    return;
  }
  
  // Save configuration
  const config = {
    ...serverConfig,
    instanceType,
    discord: discordConfig,
    worlds: [
      {
        name: serverConfig.worldName,
        discordServerId: '',
        worldName: serverConfig.worldName,
        serverPassword: serverConfig.serverPassword
      }
    ]
  };
  
  saveConfig(config);
  
  console.log(chalk.green('✅ Configuration saved successfully!'));
  
  // Step 6: Optional Deployment
  const { deployNow } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'deployNow',
      message: 'Would you like to deploy your Valheim server now?',
      default: true
    }
  ]);
  
  if (deployNow) {
    console.log(chalk.cyan.bold('\n📋 Deploying Valheim Server...'));
    await deployStack();
  } else {
    console.log(chalk.yellow('Deployment skipped. You can deploy later with:'));
    console.log(chalk.cyan('huginbot deploy'));
  }
  
  // Final instructions
  console.log(boxen(
    chalk.bold('🎮 HuginBot Setup Complete! 🎮\n\n') +
    'To manage your server, use the following commands:\n\n' +
    `${chalk.cyan('huginbot interactive')} - Start interactive menu\n` +
    `${chalk.cyan('huginbot server start')} - Start the server\n` +
    `${chalk.cyan('huginbot server stop')} - Stop the server\n` +
    `${chalk.cyan('huginbot server status')} - Check server status\n\n` +
    'For more help, visit: https://github.com/yourusername/huginbot',
    { padding: 1, margin: 1, borderStyle: 'round', borderColor: 'green' }
  ));
}

module.exports = { runSetupWizard };
```

### 4. Enhanced World Management

Improve the world switching functionality:

```javascript
// cli/commands/worlds.js
const inquirer = require('inquirer');
const ora = require('ora');
const chalk = require('chalk');
const { getConfig, saveConfig } = require('../utils/config');
const { 
  getInstanceStatus, 
  createBackup, 
  restartServer, 
  updateActiveWorld,
  getServerAddress
} = require('../utils/aws');

// Command group registration
function register(program) {
  const worlds = program
    .command('worlds')
    .description('Manage Valheim worlds');
  
  worlds
    .command('list')
    .description('List available worlds')
    .action(listWorlds);
  
  worlds
    .command('add')
    .description('Add a new world')
    .action(addWorld);
  
  worlds
    .command('edit')
    .description('Edit a world')
    .action(editWorld);
  
  worlds
    .command('remove')
    .description('Remove a world')
    .action(removeWorld);
  
  worlds
    .command('switch')
    .description('Switch active world')
    .action(switchWorld);
  
  return worlds;
}

// Returns formatted "last played" date for a world
async function getLastPlayedDate(worldName) {
  // This would need to be implemented to fetch the last played date from S3 metadata or similar
  // For now, return "Unknown"
  return "Unknown";
}

// Get the currently active world
async function getCurrentWorld() {
  try {
    // Get active world from SSM Parameter Store
    // Implementation depends on your AWS utils
    const activeWorld = await getActiveWorldFromSSM();
    return activeWorld.name;
  } catch (error) {
    return "Unknown";
  }
}

// List all available worlds
async function listWorlds() {
  const config = getConfig();
  
  if (!config.worlds || config.worlds.length === 0) {
    console.log(chalk.yellow('No worlds configured'));
    return;
  }
  
  console.log(chalk.cyan.bold('\n📋 Available Worlds:'));
  
  // Get active world to highlight it
  let activeWorld = "Unknown";
  try {
    activeWorld = await getCurrentWorld();
  } catch (error) {
    // Ignore error, just don't highlight any world
  }
  
  config.worlds.forEach((world, index) => {
    const isActive = world.name === activeWorld;
    const prefix = isActive ? chalk.green('✓ ') : '  ';
    console.log(`${prefix}${index + 1}. ${chalk.bold(world.name)} (${world.worldName})`);
    console.log(`   Discord Server: ${world.discordServerId || 'None'}`);
    console.log(`   Password: ${'*'.repeat(world.serverPassword.length)}`);
    console.log(`   Last Played: ${getLastPlayedDate(world.name)}`);
    console.log('');
  });
}

// Add a new world
async function addWorld() {
  const config = getConfig();
  
  const newWorld = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Display name for the world:',
      validate: (input) => input.trim() !== '' ? true : 'Name cannot be empty'
    },
    {
      type: 'input',
      name: 'discordServerId',
      message: 'Discord Server ID (optional):',
    },
    {
      type: 'input',
      name: 'worldName',
      message: 'Valheim world name:',
      validate: (input) => input.trim() !== '' ? true : 'World name cannot be empty'
    },
    {
      type: 'password',
      name: 'serverPassword',
      message: 'Server password:',
      validate: (input) => input.trim().length >= 5 ? true : 'Password must be at least 5 characters'
    }
  ]);
  
  config.worlds = config.worlds || [];
  config.worlds.push(newWorld);
  saveConfig(config);
  
  console.log(chalk.green(`✅ World "${newWorld.name}" added successfully`));
}

// Edit a world
async function editWorld() {
  const config = getConfig();
  
  if (!config.worlds || config.worlds.length === 0) {
    console.log(chalk.yellow('No worlds configured'));
    return;
  }
  
  const { worldToEdit } = await inquirer.prompt([
    {
      type: 'list',
      name: 'worldToEdit',
      message: 'Select world to edit:',
      choices: config.worlds.map((world, index) => ({
        name: `${world.name} (${world.worldName})`,
        value: index
      }))
    }
  ]);
  
  const world = config.worlds[worldToEdit];
  const editedWorld = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Display name for the world:',
      default: world.name,
      validate: (input) => input.trim() !== '' ? true : 'Name cannot be empty'
    },
    {
      type: 'input',
      name: 'discordServerId',
      message: 'Discord Server ID (optional):',
      default: world.discordServerId
    },
    {
      type: 'input',
      name: 'worldName',
      message: 'Valheim world name:',
      default: world.worldName,
      validate: (input) => input.trim() !== '' ? true : 'World name cannot be empty'
    },
    {
      type: 'password',
      name: 'serverPassword',
      message: 'Server password:',
      default: world.serverPassword,
      validate: (input) => input.trim().length >= 5 ? true : 'Password must be at least 5 characters'
    }
  ]);
  
  config.worlds[worldToEdit] = editedWorld;
  saveConfig(config);
  
  console.log(chalk.green(`✅ World "${editedWorld.name}" updated successfully`));
}

// Remove a world
async function removeWorld() {
  const config = getConfig();
  
  if (!config.worlds || config.worlds.length === 0) {
    console.log(chalk.yellow('No worlds configured'));
    return;
  }
  
  const { worldToRemove } = await inquirer.prompt([
    {
      type: 'list',
      name: 'worldToRemove',
      message: 'Select world to remove:',
      choices: config.worlds.map((world, index) => ({
        name: `${world.name} (${world.worldName})`,
        value: index
      }))
    }
  ]);
  
  const { confirmRemove } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmRemove',
      message: `Are you sure you want to remove "${config.worlds[worldToRemove].name}"?`,
      default: false
    }
  ]);
  
  if (confirmRemove) {
    const removedWorld = config.worlds.splice(worldToRemove, 1)[0];
    saveConfig(config);
    console.log(chalk.green(`✅ World "${removedWorld.name}" removed successfully`));
  }
}

// Switch active world
async function switchWorld() {
  const config = getConfig();
  
  if (!config.worlds || config.worlds.length === 0) {
    console.log(chalk.yellow('No worlds configured'));
    return;
  }
  
  // Get last played dates to display in the selection list
  const worldChoices = await Promise.all(config.worlds.map(async (world, index) => {
    const lastPlayed = await getLastPlayedDate(world.name);
    return {
      name: `${world.name} (${world.worldName}) - Last played: ${lastPlayed}`,
      value: world
    };
  }));
  
  const { selectedWorld } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selectedWorld',
      message: 'Select world to activate:',
      choices: worldChoices
    }
  ]);
  
  // Confirm if server is running
  const spinner = ora('Checking server status...').start();
  const status = await getInstanceStatus();
  spinner.succeed(`Server status: ${status}`);
  
  if (status === 'running') {
    console.log(chalk.yellow(`⚠️  Server is currently running with world: ${await getCurrentWorld()}`));
    const { confirmRestart } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmRestart',
        message: 'Switching worlds requires a server restart. Players will be disconnected. Continue?',
        default: false
      }
    ]);
    
    if (!confirmRestart) {
      console.log(chalk.yellow('❌ World switch cancelled.'));
      return;
    }
  }
  
  // Create backup of current world if server is running
  if (status === 'running') {
    spinner.text = 'Backing up current world...';
    spinner.start();
    
    try {
      await createBackup();
      spinner.succeed('Current world backed up successfully');
    } catch (error) {
      spinner.fail('Failed to create backup');
      console.error(chalk.red('Error:'), error.message);
      
      const { continueWithoutBackup } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'continueWithoutBackup',
          message: 'Continue without backup?',
          default: false
        }
      ]);
      
      if (!continueWithoutBackup) {
        console.log(chalk.yellow('❌ World switch cancelled.'));
        return;
      }
    }
  }
  
  // Update active world in SSM Parameter Store
  spinner.text = 'Updating world configuration...';
  spinner.start();
  
  try {
    await updateActiveWorld(selectedWorld);
    spinner.succeed('World configuration updated');
  } catch (error) {
    spinner.fail('Failed to update world configuration');
    console.error(chalk.red('Error:'), error.message);
    return;
  }
  
  // Restart server if it was running
  if (status === 'running') {
    spinner.text = 'Restarting server with new world...';
    spinner.start();
    
    try {
      await restartServer();
      spinner.succeed('Server restarted successfully');
      
      console.log(chalk.green(`\n✅ Server is now running with world: ${selectedWorld.name}`));
      console.log(`   Join address: ${await getServerAddress()}`);
    } catch (error) {
      spinner.fail('Failed to restart server');
      console.error(chalk.red('Error:'), error.message);
      
      console.log(chalk.yellow('\n⚠️  World configuration was updated but server restart failed.'));
      console.log('   You can start the server manually with:');
      console.log(chalk.cyan('   huginbot server start'));
    }
  } else {
    console.log(chalk.green(`\n✅ World switched to: ${selectedWorld.name}`));
    console.log('   Server is currently stopped. Start it when ready with:');
    console.log(chalk.cyan('   huginbot server start'));
  }
}

module.exports = {
  register,
  listWorlds,
  addWorld,
  editWorld,
  removeWorld,
  switchWorld
};
```

### 5. Utility Functions

Create utility modules for AWS interactions:

```javascript
// cli/utils/aws.js
const { SSM } = require('@aws-sdk/client-ssm');
const { EC2 } = require('@aws-sdk/client-ec2');
const { spawn } = require('child_process');
const ora = require('ora');
const chalk = require('chalk');

// Initialize AWS clients
const getSSMClient = () => new SSM();
const getEC2Client = () => new EC2();

// Check if AWS credentials are configured
async function checkAwsCredentials() {
  try {
    const ssm = getSSMClient();
    await ssm.listParameters({ MaxResults: 1 });
    return true;
  } catch (error) {
    return false;
  }
}

// Guide user through AWS profile setup
async function setupAwsProfile() {
  console.log(chalk.cyan('Setting up AWS profile...'));
  console.log('You will need your AWS Access Key ID and Secret Access Key.');
  console.log('These can be obtained from the AWS Management Console under IAM.');
  
  // Launch aws configure command
  return new Promise((resolve, reject) => {
    const aws = spawn('aws', ['configure'], { stdio: 'inherit' });
    
    aws.on('close', (code) => {
      if (code === 0) {
        console.log(chalk.green('AWS credentials configured successfully'));
        resolve(true);
      } else {
        console.error(chalk.red('Failed to configure AWS credentials'));
        resolve(false);
      }
    });
  });
}

// Get EC2 instance status
async function getInstanceStatus() {
  try {
    const config = require('./config').getConfig();
    const instanceId = config.instanceId;
    
    if (!instanceId) {
      return 'not_deployed';
    }
    
    const ec2 = getEC2Client();
    const result = await ec2.describeInstanceStatus({
      InstanceIds: [instanceId],
      IncludeAllInstances: true
    });
    
    if (result.InstanceStatuses.length === 0) {
      return 'unknown';
    }
    
    return result.InstanceStatuses[0].InstanceState.Name;
  } catch (error) {
    console.error('Error getting instance status:', error);
    return 'error';
  }
}

// Create a backup of the current world
async function createBackup() {
  try {
    const config = require('./config').getConfig();
    const instanceId = config.instanceId;
    
    if (!instanceId) {
      throw new Error('Instance ID not found in configuration');
    }
    
    // Execute backup script on the EC2 instance using SSM
    const ssm = getSSMClient();
    await ssm.sendCommand({
      DocumentName: 'AWS-RunShellScript',
      InstanceIds: [instanceId],
      Parameters: {
        commands: ['/usr/local/bin/backup-valheim.sh']
      }
    });
    
    return true;
  } catch (error) {
    console.error('Error creating backup:', error);
    throw error;
  }
}

// Restart the server with the new world
async function restartServer() {
  try {
    const config = require('./config').getConfig();
    const instanceId = config.instanceId;
    
    if (!instanceId) {
      throw new Error('Instance ID not found in configuration');
    }
    
    // Execute the world switching script on the EC2 instance
    const ssm = getSSMClient();
    await ssm.sendCommand({
      DocumentName: 'AWS-RunShellScript',
      InstanceIds: [instanceId],
      Parameters: {
        commands: ['/usr/local/bin/switch-valheim-world.sh']
      }
    });
    
    return true;
  } catch (error) {
    console.error('Error restarting server:', error);
    throw error;
  }
}

// Update the active world in SSM Parameter Store
async function updateActiveWorld(worldConfig) {
  try {
    const ssm = getSSMClient();
    
    await ssm.putParameter({
      Name: '/huginbot/active-world',
      Value: JSON.stringify(worldConfig),
      Type: 'String',
      Overwrite: true
    });
    
    return true;
  } catch (error) {
    console.error('Error updating active world:', error);
    throw error;
  }
}

// Get active world from SSM Parameter Store
async function getActiveWorldFromSSM() {
  try {
    const ssm = getSSMClient();
    
    const result = await ssm.getParameter({
      Name: '/huginbot/active-world'
    });
    
    if (result.Parameter?.Value) {
      return JSON.parse(result.Parameter.Value);
    }
    
    throw new Error('Active world parameter not found');
  } catch (error) {
    console.error('Error getting active world:', error);
    throw error;
  }
}

// Get server address
async function getServerAddress() {
  try {
    const config = require('./config').getConfig();
    const instanceId = config.instanceId;
    
    if (!instanceId) {
      throw new Error('Instance ID not found in configuration');
    }
    
    const ec2 = getEC2Client();
    const result = await ec2.describeInstances({
      InstanceIds: [instanceId]
    });
    
    if (result.Reservations.length === 0 || 
        result.Reservations[0].Instances.length === 0) {
      throw new Error('Instance not found');
    }
    
    const publicIp = result.Reservations[0].Instances[0].PublicIpAddress;
    
    if (!publicIp) {
      throw new Error('Instance does not have a public IP address');
    }
    
    return `${publicIp}:2456`;
  } catch (error) {
    console.error('Error getting server address:', error);
    throw error;
  }
}

module.exports = {
  checkAwsCredentials,
  setupAwsProfile,
  getInstanceStatus,
  createBackup,
  restartServer,
  updateActiveWorld,
  getActiveWorldFromSSM,
  getServerAddress
};
```

### 6. Configuration Management

Create a config module to handle configuration:

```javascript
// cli/utils/config.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const Conf = require('conf');

// Create config directory if it doesn't exist
const configDir = path.join(os.homedir(), '.huginbot');
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

// Initialize configuration store
const config = new Conf({
  cwd: configDir,
  configName: 'config',
  schema: {
    serverName: {
      type: 'string',
      default: 'ValheimServer'
    },
    worldName: {
      type: 'string',
      default: 'ValheimWorld'
    },
    serverPassword: {
      type: 'string',
      default: 'valheim'
    },
    adminIds: {
      type: 'string',
      default: ''
    },
    instanceType: {
      type: 'string',
      default: 't3.medium'
    },
    instanceId: {
      type: 'string',
      default: ''
    },
    deployedAt: {
      type: 'string',
      default: ''
    },
    discord: {
      type: 'object',
      default: {
        appId: '',
        publicKey: '',
        botToken: ''
      }
    },
    worlds: {
      type: 'array',
      default: []
    }
  }
});

// Get configuration
function getConfig() {
  return config.store;
}

// Save configuration
function saveConfig(newConfig) {
  Object.assign(config.store, newConfig);
}

// Get world-specific configuration
function getWorldConfig(worldName) {
  const worlds = config.get('worlds') || [];
  return worlds.find(w => w.name === worldName || w.worldName === worldName);
}

// Save world-specific configuration
function saveWorldConfig(worldName, worldConfig) {
  const worlds = config.get('worlds') || [];
  const index = worlds.findIndex(w => w.name === worldName || w.worldName === worldName);
  
  if (index >= 0) {
    worlds[index] = worldConfig;
  } else {
    worlds.push(worldConfig);
  }
  
  config.set('worlds', worlds);
}

module.exports = {
  getConfig,
  saveConfig,
  getWorldConfig,
  saveWorldConfig
};
```

## Technology Stack

To implement these improvements, we'll need to update the package.json dependencies:

```json
{
  "dependencies": {
    "@aws-sdk/client-cloudformation": "^3.x",
    "@aws-sdk/client-ec2": "^3.x",
    "@aws-sdk/client-s3": "^3.x",
    "@aws-sdk/client-ssm": "^3.x",
    "axios": "^1.x",
    "boxen": "^7.x",
    "chalk": "^4.x",
    "commander": "^11.x",
    "conf": "^10.x",
    "figlet": "^1.x",
    "inquirer": "^9.x",
    "open": "^9.x",
    "ora": "^6.x",
    "terminal-link": "^3.x"
  }
}
```

## Installation Instructions

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Link the CLI globally:
   ```bash
   npm link
   ```
4. Run the setup wizard:
   ```bash
   huginbot setup
   ```

## Testing Plan

1. Unit tests for utility functions:
   ```bash
   npm test utils
   ```
2. Integration tests for AWS interactions:
   ```bash
   npm test aws
   ```
3. Manual testing of the CLI interface:
   ```bash
   npm run cli:dev
   ```

## Future Enhancements

- Web dashboard for server management
- Discord bot commands for world switching
- Player statistics and activity monitoring
- Mod management interface
- Server performance monitoring
- Auto-scaling based on player count

By implementing these changes, the HuginBot CLI will provide a much more user-friendly experience, especially for users who are not familiar with AWS or game server hosting.