/**
 * discord.js - HuginBot CLI Discord integration commands
 * 
 * Manages Discord bot and webhook configurations
 */
const inquirer = require('inquirer');
const ora = require('ora');
const chalk = require('chalk');
const boxen = require('boxen');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const open = require('open');
const { getConfig, saveConfig } = require('../utils/config');
const { isStackDeployed } = require('../utils/aws');

// Command group registration
function register(program) {
  const discord = program
    .command('discord')
    .description('Manage Discord bot integration');
  
  discord
    .command('setup')
    .description('Configure Discord bot settings')
    .action(setupDiscord);
  
  discord
    .command('deploy')
    .description('Deploy Discord bot to AWS')
    .action(deployDiscordBot);
  
  discord
    .command('status')
    .description('Check Discord bot status')
    .action(checkDiscordStatus);
  
  discord
    .command('update')
    .description('Update Discord bot commands')
    .action(updateDiscordCommands);
  
  discord
    .command('logs')
    .description('View Discord bot logs')
    .option('-l, --limit <number>', 'Number of log entries to show', parseInt, 10)
    .action(viewDiscordLogs);
  
  return discord;
}

// Setup Discord configuration
async function setupDiscord() {
  const config = getConfig();
  
  console.log(chalk.cyan.bold('\n📋 Discord Bot Configuration:'));
  console.log(chalk.yellow(
    'To set up Discord integration, you need to create a Discord application with bot permissions.\n' +
    'This will guide you through the process of configuring your Discord bot for HuginBot.'
  ));
  
  // Check for existing configuration
  const hasExistingConfig = config.discord && 
    config.discord.appId && 
    config.discord.publicKey && 
    config.discord.botToken;
  
  if (hasExistingConfig) {
    console.log(chalk.green('\nExisting Discord configuration found:'));
    console.log(`Application ID: ${config.discord.appId}`);
    console.log(`Public Key: ${config.discord.publicKey.substring(0, 10)}...`);
    console.log(`Bot Token: ${config.discord.botToken.substring(0, 5)}...`);
    
    const { updateConfig } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'updateConfig',
        message: 'Do you want to update this configuration?',
        default: false
      }
    ]);
    
    if (!updateConfig) {
      console.log(chalk.green('✅ Using existing Discord configuration'));
      return;
    }
  }
  
  // Option to open Discord Developer Portal
  const { openPortal } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'openPortal',
      message: 'Open Discord Developer Portal in your browser?',
      default: true
    }
  ]);
  
  if (openPortal) {
    console.log(chalk.cyan('Opening Discord Developer Portal...'));
    await open('https://discord.com/developers/applications');
  }
  
  console.log(chalk.yellow('\nFollow these steps in the Discord Developer Portal:'));
  console.log('1. Click "New Application" and give it a name (e.g. "HuginBot")');
  console.log('2. Go to the "Bot" section and click "Add Bot"');
  console.log('3. Under the bot\'s username, click "Reset Token" and copy the new token');
  console.log('4. Make sure "MESSAGE CONTENT INTENT" is enabled under "Privileged Gateway Intents"');
  console.log('5. Return to the "General Information" section to copy the Application ID and Public Key');
  
  // Prompt for Discord application details
  const discordConfig = await inquirer.prompt([
    {
      type: 'input',
      name: 'appId',
      message: 'Enter Discord Application ID:',
      default: config.discord?.appId || '',
      validate: (input) => /^\d+$/.test(input.trim()) ? true : 'Application ID should be a numeric value'
    },
    {
      type: 'input',
      name: 'publicKey',
      message: 'Enter Discord Public Key:',
      default: config.discord?.publicKey || '',
      validate: (input) => input.trim() !== '' ? true : 'Public key cannot be empty'
    },
    {
      type: 'password',
      name: 'botToken',
      message: 'Enter Discord Bot Token:',
      default: config.discord?.botToken || '',
      validate: (input) => input.trim() !== '' ? true : 'Bot token cannot be empty'
    }
  ]);
  
  // Prompt for additional bot configuration
  const botConfig = await inquirer.prompt([
    {
      type: 'input',
      name: 'commandPrefix',
      message: 'Command prefix for text commands (optional):',
      default: config.discord?.commandPrefix || '!',
    },
    {
      type: 'confirm',
      name: 'useSlashCommands',
      message: 'Use slash commands?',
      default: true
    }
  ]);
  
  // Save configuration
  const updatedConfig = {
    ...config,
    discord: {
      ...discordConfig,
      ...botConfig,
      configured: true,
      configuredAt: new Date().toISOString()
    }
  };
  
  saveConfig(updatedConfig);
  
  console.log(chalk.green('\n✅ Discord configuration saved successfully!'));
  
  // Offer to deploy
  const { deployNow } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'deployNow',
      message: 'Would you like to deploy the Discord bot now?',
      default: true
    }
  ]);
  
  if (deployNow) {
    await deployDiscordBot();
  } else {
    console.log(chalk.yellow('\nYou can deploy the Discord bot later with:'));
    console.log(chalk.cyan('huginbot discord deploy'));
  }
}

// Deploy Discord bot
async function deployDiscordBot() {
  const config = getConfig();
  
  // Verify Discord configuration exists
  if (!config.discord || !config.discord.botToken) {
    console.log(chalk.red('❌ Discord bot not configured'));
    console.log('Run setup first: ' + chalk.cyan('huginbot discord setup'));
    return;
  }
  
  console.log(chalk.cyan.bold('\n📋 Deploying Discord Bot:'));
  
  // Check if Valheim stack is deployed
  const spinner = ora('Checking Valheim infrastructure...').start();
  const valheimDeployed = await isStackDeployed('ValheimStack');
  
  if (!valheimDeployed) {
    spinner.fail('Valheim infrastructure not deployed');
    console.log(chalk.red('❌ You must deploy the Valheim server first:'));
    console.log(chalk.cyan('huginbot deploy valheim'));
    return;
  }
  
  spinner.succeed('Valheim infrastructure is deployed');
  
  // Confirm deployment
  const { confirmDeploy } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmDeploy',
      message: 'Deploy Discord bot to AWS?',
      default: true
    }
  ]);
  
  if (!confirmDeploy) {
    console.log(chalk.yellow('❌ Deployment cancelled.'));
    return;
  }
  
  // Set environment variables for deployment
  const env = {
    ...process.env,
    DISCORD_APP_ID: config.discord.appId,
    DISCORD_PUBLIC_KEY: config.discord.publicKey,
    DISCORD_BOT_TOKEN: config.discord.botToken
  };
  
  spinner.text = 'Deploying Discord bot...';
  spinner.start();
  
  // Execute deployment script
  try {
    await new Promise((resolve, reject) => {
      const deploy = spawn('npm', ['run', 'deploy:discord'], { 
        env,
        stdio: ['ignore', 'pipe', 'pipe'] 
      });
      
      let output = '';
      
      deploy.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      deploy.stderr.on('data', (data) => {
        output += data.toString();
      });
      
      deploy.on('close', (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(`Deployment failed with code ${code}:\n${output}`));
        }
      });
    });
    
    spinner.succeed('Discord bot deployed successfully');
    
    // Update deployment status in config
    config.discord.deployed = true;
    config.discord.deployedAt = new Date().toISOString();
    saveConfig(config);
    
    console.log(chalk.green('\n✅ Discord bot has been deployed to AWS!'));
    console.log('Next steps:');
    console.log('1. ' + chalk.cyan('Add the bot to your Discord server using the OAuth2 URL'));
    console.log('2. ' + chalk.cyan('Run the "/setup" command in your Discord server'));
    
    // Generate and display bot invite URL
    const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${config.discord.appId}&permissions=277025393664&scope=bot%20applications.commands`;
    
    console.log(boxen(
      chalk.bold('🤖 Discord Bot Invite URL 🤖\n\n') +
      `${inviteUrl}\n\n` +
      'Required permissions:\n' +
      '- Send Messages\n' +
      '- Manage Webhooks\n' +
      '- Use Slash Commands',
      { padding: 1, margin: 1, borderStyle: 'round', borderColor: 'green' }
    ));
    
    // Offer to open the invite URL
    const { openInvite } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'openInvite',
        message: 'Open bot invite URL in your browser?',
        default: true
      }
    ]);
    
    if (openInvite) {
      await open(inviteUrl);
    }
  } catch (error) {
    spinner.fail('Deployment failed');
    console.error(chalk.red('Error:'), error.message);
  }
}

// Check Discord bot status
async function checkDiscordStatus() {
  const config = getConfig();
  
  // Verify Discord configuration exists
  if (!config.discord || !config.discord.botToken) {
    console.log(chalk.red('❌ Discord bot not configured'));
    console.log('Run setup first: ' + chalk.cyan('huginbot discord setup'));
    return;
  }
  
  const spinner = ora('Checking Discord bot status...').start();
  
  // Check if Discord stack is deployed
  try {
    const discordDeployed = await isStackDeployed('DiscordBotStack');
    
    if (!discordDeployed) {
      spinner.fail('Discord bot not deployed');
      console.log(chalk.red('❌ You need to deploy the Discord bot first:'));
      console.log(chalk.cyan('huginbot discord deploy'));
      return;
    }
    
    // TODO: Implement more detailed status checking with AWS Lambda logs
    // This would require additional AWS SDK calls to check Lambda health
    spinner.succeed('Discord bot infrastructure is deployed');
    
    console.log(boxen(
      chalk.bold('🤖 Discord Bot Status 🤖\n\n') +
      `Application ID: ${config.discord.appId}\n` +
      `Configured: ${config.discord.configured ? chalk.green('Yes') : chalk.red('No')}\n` +
      `Deployed: ${config.discord.deployed ? chalk.green('Yes') : chalk.red('No')}\n` +
      `Deployed At: ${config.discord.deployedAt || 'Unknown'}\n` +
      `Slash Commands: ${config.discord.useSlashCommands ? chalk.green('Enabled') : chalk.yellow('Disabled')}\n` +
      `Command Prefix: ${config.discord.commandPrefix || '!'}`,
      { padding: 1, margin: 1, borderStyle: 'round', borderColor: 'blue' }
    ));
    
    console.log('For more detailed status, check the bot logs:');
    console.log(chalk.cyan('huginbot discord logs'));
  } catch (error) {
    spinner.fail('Failed to check status');
    console.error(chalk.red('Error:'), error.message);
  }
}

// Update Discord bot commands
async function updateDiscordCommands() {
  const config = getConfig();
  
  // Verify Discord configuration exists
  if (!config.discord || !config.discord.botToken) {
    console.log(chalk.red('❌ Discord bot not configured'));
    console.log('Run setup first: ' + chalk.cyan('huginbot discord setup'));
    return;
  }
  
  // Verify Discord bot is deployed
  if (!config.discord.deployed) {
    console.log(chalk.red('❌ Discord bot not deployed'));
    console.log('Deploy it first: ' + chalk.cyan('huginbot discord deploy'));
    return;
  }
  
  console.log(chalk.cyan.bold('\n📋 Updating Discord Bot Commands:'));
  
  // Confirm update
  const { confirmUpdate } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmUpdate',
      message: 'Update Discord bot commands? This will register slash commands with Discord.',
      default: true
    }
  ]);
  
  if (!confirmUpdate) {
    console.log(chalk.yellow('❌ Update cancelled.'));
    return;
  }
  
  const spinner = ora('Updating Discord commands...').start();
  
  // Set environment variables for deployment
  const env = {
    ...process.env,
    DISCORD_APP_ID: config.discord.appId,
    DISCORD_PUBLIC_KEY: config.discord.publicKey,
    DISCORD_BOT_TOKEN: config.discord.botToken
  };
  
  // Execute command registration script
  try {
    await new Promise((resolve, reject) => {
      const registerPath = path.join(__dirname, '..', '..', 'scripts', 'discord', 'register-commands.sh');
      
      // Check if the script exists
      if (!fs.existsSync(registerPath)) {
        reject(new Error(`Command registration script not found at ${registerPath}`));
        return;
      }
      
      const register = spawn(registerPath, [], { 
        env,
        stdio: ['ignore', 'pipe', 'pipe'] 
      });
      
      let output = '';
      
      register.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      register.stderr.on('data', (data) => {
        output += data.toString();
      });
      
      register.on('close', (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(`Command registration failed with code ${code}:\n${output}`));
        }
      });
    });
    
    spinner.succeed('Discord commands updated successfully');
    
    console.log(chalk.green('\n✅ Discord bot commands have been registered!'));
    console.log('The following commands are now available:');
    console.log('- /help - Show help information');
    console.log('- /setup - Set up webhooks in the current channel');
    console.log('- /start - Start the Valheim server');
    console.log('- /stop - Stop the Valheim server');
    console.log('- /status - Check server status');
    console.log('- /worlds - List and select available worlds');
    console.log('- /backup - Create and manage backups');
  } catch (error) {
    spinner.fail('Command update failed');
    console.error(chalk.red('Error:'), error.message);
  }
}

// View Discord bot logs
async function viewDiscordLogs(options) {
  const config = getConfig();
  
  // Verify Discord configuration exists
  if (!config.discord || !config.discord.botToken) {
    console.log(chalk.red('❌ Discord bot not configured'));
    console.log('Run setup first: ' + chalk.cyan('huginbot discord setup'));
    return;
  }
  
  // Verify Discord bot is deployed
  if (!config.discord.deployed) {
    console.log(chalk.red('❌ Discord bot not deployed'));
    console.log('Deploy it first: ' + chalk.cyan('huginbot discord deploy'));
    return;
  }
  
  const spinner = ora('Fetching Discord bot logs...').start();
  
  // Set the limit for log entries
  const limit = options.limit || 10;
  
  // Fetch logs using AWS CLI
  try {
    // Construct AWS CLI command
    const command = `aws logs get-log-events --log-group-name /aws/lambda/DiscordBot --limit ${limit} --start-from-head false`;
    
    await new Promise((resolve, reject) => {
      const logs = spawn('bash', ['-c', command], { 
        stdio: ['ignore', 'pipe', 'pipe'] 
      });
      
      let output = '';
      
      logs.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      logs.stderr.on('data', (data) => {
        output += data.toString();
      });
      
      logs.on('close', (code) => {
        if (code === 0) {
          spinner.succeed('Retrieved Discord bot logs');
          
          // Parse and display logs
          try {
            const logData = JSON.parse(output);
            
            if (!logData.events || logData.events.length === 0) {
              console.log(chalk.yellow('No log entries found'));
              return;
            }
            
            console.log(chalk.cyan.bold('\n📋 Discord Bot Logs:'));
            console.log(chalk.gray('Showing most recent logs first\n'));
            
            logData.events.reverse().forEach(event => {
              const timestamp = new Date(event.timestamp).toLocaleString();
              const message = event.message.trim();
              
              if (message.includes('ERROR') || message.includes('Error:')) {
                console.log(chalk.red(`[${timestamp}] ${message}`));
              } else if (message.includes('WARN') || message.includes('Warning:')) {
                console.log(chalk.yellow(`[${timestamp}] ${message}`));
              } else {
                console.log(`[${timestamp}] ${message}`);
              }
            });
            
            resolve();
          } catch (error) {
            console.log(chalk.yellow('No log entries found or unable to parse logs'));
            console.log('Raw output:', output);
            resolve();
          }
        } else {
          reject(new Error(`Failed to retrieve logs with code ${code}:\n${output}`));
        }
      });
    });
  } catch (error) {
    spinner.fail('Failed to retrieve logs');
    console.error(chalk.red('Error:'), error.message);
    
    console.log(chalk.yellow('\nTry viewing logs directly in the AWS Console:'));
    console.log('1. Go to CloudWatch Logs in the AWS Console');
    console.log('2. Look for the log group: /aws/lambda/DiscordBot');
  }
}

module.exports = {
  register,
  setupDiscord,
  deployDiscordBot,
  checkDiscordStatus,
  updateDiscordCommands,
  viewDiscordLogs
};