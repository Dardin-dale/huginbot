/**
 * HuginBot CLI - Setup Wizard
 * This module implements a step-by-step setup wizard for first-time users
 */

const inquirer = require('inquirer');
const chalk = require('chalk');
const { spawn } = require('child_process');
const { loadESMDependencies } = require('./utils/esm-loader');
const { 
  checkAwsCredentials, 
  setupAwsProfile 
} = require('./utils/aws');
const { saveConfig } = require('./utils/config');
const { deployStack } = require('./commands/deploy');

/**
 * Run the setup wizard
 */
async function runSetupWizard() {
  // Load ESM dependencies
  const { boxen, ora, open } = await loadESMDependencies();
  
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
      
      const { continueWithoutAws } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'continueWithoutAws',
          message: 'Continue with setup anyway?',
          default: true
        }
      ]);
      
      if (!continueWithoutAws) {
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