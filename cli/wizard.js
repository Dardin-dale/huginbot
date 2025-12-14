/**
 * HuginBot CLI - Setup Wizard
 * This module implements a step-by-step setup wizard for first-time users
 * Updated to use environment variables and indexed world format
 */

const inquirer = require('inquirer');
const chalk = require('chalk');
const { spawn, execSync } = require('child_process');
const { loadESMDependencies } = require('./utils/esm-loader');
const { 
  checkAwsCredentials, 
  setupAwsProfile 
} = require('./utils/aws');
const { getConfig, saveConfig } = require('./utils/config');
const { 
  updateEnvVariable, 
  addWorldToEnv, 
  migrateToIndexedFormat 
} = require('./utils/env-manager');

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
  
  // Get current config to use as defaults
  const config = getConfig();
  
  const serverConfig = await inquirer.prompt([
    {
      type: 'input',
      name: 'serverName',
      message: 'Enter server name (displayed in server browser):',
      default: process.env.VALHEIM_SERVER_NAME || config.serverName || 'ValheimServer',
      validate: (input) => input.trim() !== '' ? true : 'Server name cannot be empty'
    },
    {
      type: 'input',
      name: 'serverArgs',
      message: 'Enter server arguments (e.g. -crossplay):',
      default: process.env.VALHEIM_SERVER_ARGS || config.serverArgs || '-crossplay'
    },
    {
      type: 'confirm',
      name: 'bepInExEnabled',
      message: 'Enable BepInEx mod support?',
      default: process.env.VALHEIM_BEPINEX === 'true' || config.bepInExEnabled || true
    },
    {
      type: 'confirm',
      name: 'updateIfIdle',
      message: 'Update server when idle?',
      default: process.env.VALHEIM_UPDATE_IF_IDLE === 'true' || config.updateIfIdle || false
    },
    {
      type: 'input',
      name: 'adminIds',
      message: 'Enter admin Steam IDs (space separated):',
      default: process.env.VALHEIM_ADMIN_IDS || config.adminIds || '',
      validate: (input) => {
        if (input.trim() === '') return true;
        const ids = input.split(' ');
        const validIds = ids.every(id => /^\d+$/.test(id.trim()));
        return validIds ? true : 'Steam IDs should be numeric values';
      }
    }
  ]);
  
  // Step 3: World Configuration
  console.log(chalk.cyan.bold('\n📋 Step 3: World Configuration'));
  
  const worlds = config.worlds || [];
  
  // Check if there are existing worlds in the config
  if (worlds.length > 0) {
    console.log(chalk.green(`Found ${worlds.length} existing world configurations:`));
    worlds.forEach((world, index) => {
      console.log(`${index + 1}. ${chalk.cyan(world.name)} (${world.worldName})`);
    });
    
    const { configureNewWorld } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'configureNewWorld',
        message: 'Would you like to configure a new world?',
        default: false
      }
    ]);
    
    if (!configureNewWorld) {
      console.log(chalk.yellow('Skipping new world configuration.'));
    } else {
      await configureWorld();
    }
  } else {
    console.log(chalk.yellow('No existing world configurations found.'));
    console.log('Let\'s set up your first world:');
    await configureWorld();
  }
  
  // Function to configure a new world
  async function configureWorld() {
    const worldConfig = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Enter display name for the world:',
        default: 'MainWorld',
        validate: (input) => input.trim() !== '' ? true : 'World name cannot be empty'
      },
      {
        type: 'input',
        name: 'worldName',
        message: 'Enter world save name (used in-game):',
        default: 'Midgard',
        validate: (input) => input.trim() !== '' ? true : 'World save name cannot be empty'
      },
      {
        type: 'password',
        name: 'serverPassword',
        message: 'Enter server password for this world (min 5 characters):',
        default: 'valheim',
        validate: (input) => input.trim().length >= 5 ? true : 'Password must be at least 5 characters'
      },
      {
        type: 'input',
        name: 'discordServerId',
        message: 'Enter Discord server ID for this world (optional):',
        default: ''
      }
    ]);
    
    // Add the world to the env file
    const newIndex = addWorldToEnv(worldConfig);
    console.log(chalk.green(`✅ World "${worldConfig.name}" added as World #${newIndex}`));
    
    // Set as active world
    updateEnvVariable('VALHEIM_WORLD_NAME', worldConfig.worldName);
    updateEnvVariable('VALHEIM_SERVER_PASSWORD', worldConfig.serverPassword);
    
    return worldConfig;
  }
  
  // Step 4: Instance Type Selection
  console.log(chalk.cyan.bold('\n📋 Step 4: Server Hardware Configuration'));
  
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
      default: process.env.VALHEIM_INSTANCE_TYPE || config.instanceType || 't3.medium'
    }
  ]);
  
  // Step 5: Discord Configuration
  console.log(chalk.cyan.bold('\n📋 Step 5: Discord Integration'));
  
  // Check if Discord is already configured
  const hasDiscordConfig = config.discord && config.discord.configured;
  let discordConfig = {
    appId: '',
    publicKey: '',
    botToken: ''
  };
  
  if (hasDiscordConfig || process.env.DISCORD_APP_ID) {
    console.log(chalk.green('✓ Discord integration already configured'));
    
    // Show existing values if available
    if (process.env.DISCORD_APP_ID) {
      console.log(`Application ID: ${process.env.DISCORD_APP_ID}`);
    } else if (config.discord && config.discord.appId) {
      console.log(`Application ID: ${config.discord.appId}`);
    }
    
    if (process.env.DISCORD_BOT_PUBLIC_KEY) {
      const publicKey = process.env.DISCORD_BOT_PUBLIC_KEY;
      console.log(`Public Key: ${publicKey.substring(0, 5)}...${publicKey.substring(publicKey.length - 5)}`);
    } else if (config.discord && config.discord.publicKey) {
      const publicKey = config.discord.publicKey;
      console.log(`Public Key: ${publicKey.substring(0, 5)}...${publicKey.substring(publicKey.length - 5)}`);
    }
    
    if (process.env.DISCORD_BOT_SECRET_TOKEN || (config.discord && config.discord.botToken)) {
      console.log(`Bot Token: ${'*'.repeat(10)}`);
    }
    
    const { updateDiscord } = await inquirer.prompt([{
      type: 'confirm',
      name: 'updateDiscord',
      message: 'Would you like to update Discord integration?',
      default: false
    }]);
    
    if (!updateDiscord) {
      // Use existing values
      discordConfig = {
        appId: process.env.DISCORD_APP_ID || (config.discord && config.discord.appId) || '',
        publicKey: process.env.DISCORD_BOT_PUBLIC_KEY || (config.discord && config.discord.publicKey) || '',
        botToken: process.env.DISCORD_BOT_SECRET_TOKEN || (config.discord && config.discord.botToken) || ''
      };
      
      // Ask if they want to register commands even if not updating config
      const { registerCommands } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'registerCommands',
          message: 'Would you like to register/update Discord slash commands?',
          default: true
        }
      ]);
      
      if (registerCommands && discordConfig.appId && discordConfig.botToken) {
        await registerDiscordCommands(discordConfig);
      } else if (registerCommands) {
        console.log(chalk.yellow('⚠️  Discord configuration is incomplete. Please update Discord settings first.'));
      }
    } else {
      // Proceed with Discord setup
      await setupDiscordConfig();
    }
  } else {
    console.log(chalk.yellow('To set up Discord integration, you need to:'));
    console.log('1. Create a Discord application at https://discord.com/developers/applications');
    console.log('2. Create a bot for your application');
    console.log('3. Get the application ID, public key, and bot secret token');
    
    const { setupDiscord } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'setupDiscord',
        message: 'Would you like to set up Discord integration now?',
        default: true
      }
    ]);
    
    if (setupDiscord) {
      await setupDiscordConfig();
    } else {
      console.log(chalk.yellow('⚠️  Discord integration can be set up later'));
    }
  }
  
  // Function to set up Discord configuration
  async function setupDiscordConfig() {
    console.log(chalk.green('Opening Discord Developer Portal...'));
    await open('https://discord.com/developers/applications');
    
    discordConfig = await inquirer.prompt([
      {
        type: 'input',
        name: 'appId',
        message: 'Enter Discord Application ID:',
        default: process.env.DISCORD_APP_ID || (config.discord && config.discord.appId) || '',
        validate: (input) => /^\d+$/.test(input.trim()) ? true : 'Application ID should be numeric'
      },
      {
        type: 'input',
        name: 'publicKey',
        message: 'Enter Discord Public Key (for request verification):',
        default: process.env.DISCORD_BOT_PUBLIC_KEY || (config.discord && config.discord.publicKey) || '',
        validate: (input) => input.trim() !== '' ? true : 'Public key cannot be empty'
      },
      {
        type: 'password',
        name: 'botToken',
        message: 'Enter Discord Bot Secret Token:',
        default: process.env.DISCORD_BOT_SECRET_TOKEN || (config.discord && config.discord.botToken) || '',
        validate: (input) => input.trim() !== '' ? true : 'Bot secret token cannot be empty'
      }
    ]);
    
    // Update the environment variables
    updateEnvVariable('DISCORD_APP_ID', discordConfig.appId);
    updateEnvVariable('DISCORD_BOT_PUBLIC_KEY', discordConfig.publicKey);
    updateEnvVariable('DISCORD_BOT_SECRET_TOKEN', discordConfig.botToken);
    
    console.log(chalk.green('✅ Discord configuration saved to .env file'));
    
    // Register slash commands with Discord
    const { registerCommands } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'registerCommands',
        message: 'Would you like to register slash commands with Discord now?',
        default: true
      }
    ]);
    
    if (registerCommands) {
      await registerDiscordCommands(discordConfig);
    } else {
      console.log(chalk.yellow('⚠️  Slash commands can be registered later by running the setup wizard again'));
    }
  }
  
  // Function to register Discord slash commands
  async function registerDiscordCommands(config) {
    try {
      console.log(chalk.cyan('Registering Discord slash commands...'));
      const spinner = ora('Registering commands with Discord API...').start();
      
      // Import Discord REST API
      const { REST } = require('@discordjs/rest');
      const { Routes } = require('discord-api-types/v10');
      const { DISCORD_COMMANDS } = require('../lib/discord-commands');
      
      // Use the shared command definitions
      const commands = DISCORD_COMMANDS;
      
      // Setup REST API client
      const rest = new REST({ version: '10' }).setToken(config.botToken);
      
      // Register commands globally
      await rest.put(
        Routes.applicationCommands(config.appId),
        { body: commands }
      );
      
      spinner.succeed('Slash commands registered successfully!');
      console.log(chalk.green(`✅ Registered ${commands.length} slash commands with Discord`));
      
      // Show next steps
      console.log(boxen(
        chalk.bold('🎯 Discord Integration Setup Complete!\n\n') +
        'Your slash commands are now registered with Discord.\n\n' +
        chalk.cyan('Next steps:\n') +
        '1. Deploy your infrastructure: npm run deploy\n' +
        '2. In Discord, type "/" to see your new commands\n' +
        '3. Use /setup in a Discord channel to configure notifications\n' +
        '4. Use /start to launch your Valheim server\n\n' +
        chalk.yellow('⚠️  Important: Make sure to set your Interactions Endpoint URL\n') +
        'in the Discord Developer Portal to your API Gateway endpoint\n' +
        'after deployment.',
        { padding: 1, margin: 1, borderStyle: 'round', borderColor: 'green' }
      ));
      
    } catch (error) {
      console.error(chalk.red('❌ Failed to register Discord commands:'), error.message);
      console.log(chalk.yellow('You can try again later with: npm run register-commands'));
    }
  }
  
  // Step 6: Review and Save Configuration
  console.log(chalk.cyan.bold('\n📋 Step 6: Review Configuration'));
  
  const worldsDisplay = worlds.length > 0 
    ? worlds.map((w, i) => `  ${i + 1}. ${w.name} (${w.worldName})`).join('\n')
    : '  None configured';
  
  console.log(boxen(
    `Server Name: ${chalk.green(serverConfig.serverName)}\n` +
    `Admin IDs: ${chalk.green(serverConfig.adminIds || 'None')}\n` +
    `BepInEx Enabled: ${chalk.green(serverConfig.bepInExEnabled ? 'Yes' : 'No')}\n` +
    `Server Arguments: ${chalk.green(serverConfig.serverArgs || 'None')}\n` +
    `Instance Type: ${chalk.green(instanceType)}\n` +
    `Discord Integration: ${chalk.green(discordConfig.appId ? 'Configured' : 'Not configured')}\n` +
    `Worlds:\n${chalk.cyan(worldsDisplay)}`,
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
  
  // Save to environment variables
  updateEnvVariable('VALHEIM_SERVER_NAME', serverConfig.serverName);
  updateEnvVariable('VALHEIM_SERVER_ARGS', serverConfig.serverArgs);
  updateEnvVariable('VALHEIM_BEPINEX', serverConfig.bepInExEnabled.toString());
  updateEnvVariable('VALHEIM_UPDATE_IF_IDLE', serverConfig.updateIfIdle.toString());
  updateEnvVariable('VALHEIM_ADMIN_IDS', serverConfig.adminIds);
  updateEnvVariable('VALHEIM_INSTANCE_TYPE', instanceType);
  
  // Also save to config file for backwards compatibility
  const configToSave = {
    ...serverConfig,
    instanceType,
    discord: {
      ...discordConfig,
      configured: !!discordConfig.appId
    }
  };
  
  saveConfig(configToSave);
  
  console.log(chalk.green('✅ Configuration saved successfully to .env and config!'));
  
  // Step 6: Optional Deployment
  const { deployNow } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'deployNow',
      message: 'Would you like to deploy your Valheim server now?',
      default: true
    }
  ]);
  
  let apiGatewayUrl = null;
  
  if (deployNow) {
    console.log(chalk.cyan.bold('\n📋 Deploying Valheim Server...'));
    console.log(chalk.yellow('This will take about 10-15 minutes. Showing deployment progress:\n'));
    
    try {
      console.log(chalk.cyan('Running: npm run deploy\n'));
      
      // Show deployment output in real-time
      const deployOutput = execSync('npm run deploy', { stdio: 'inherit', encoding: 'utf8' });
      
      console.log(chalk.green('\n✅ Deployment completed successfully!'));
      
      // Get the API Gateway URL directly from AWS
      try {
        console.log(chalk.cyan('Getting Discord endpoint URL from AWS...'));
        const awsOutput = execSync('aws cloudformation describe-stacks --stack-name ValheimStack --query "Stacks[0].Outputs[?OutputKey==\'ApiEndpoint\'].OutputValue" --output text', { encoding: 'utf8' });
        apiGatewayUrl = awsOutput.trim();
        
        if (apiGatewayUrl && apiGatewayUrl !== 'None') {
          // Remove trailing slash if present
          if (apiGatewayUrl.endsWith('/')) {
            apiGatewayUrl = apiGatewayUrl.slice(0, -1);
          }
          
          const discordEndpoint = `${apiGatewayUrl}/valheim/control`;
          
          console.log(boxen(
            chalk.bold.green('🚀 Deployment Successful!\n\n') +
            chalk.cyan('📡 Discord Integration Endpoint:\n') +
            chalk.white.bgBlue.bold(` ${discordEndpoint} `) + '\n\n' +
            chalk.yellow('⚠️  Type this URL exactly as shown (or select with mouse and copy)'),
            { padding: 1, margin: 1, borderStyle: 'round', borderColor: 'green' }
          ));
        }
      } catch (outputError) {
        console.log(chalk.yellow('⚠️  Could not get API Gateway URL. Make sure AWS CLI is configured.'));
        console.log(chalk.cyan('You can manually get it with:'));
        console.log(chalk.white('aws cloudformation describe-stacks --stack-name ValheimStack --query "Stacks[0].Outputs[?OutputKey==\'ApiEndpoint\'].OutputValue" --output text'));
        console.log(chalk.cyan('Then append "/valheim/control" to that URL.'));
      }
      
    } catch (error) {
      console.error(chalk.red('❌ Deployment failed:'));
      console.error(error.message);
      console.log(chalk.yellow('\nTroubleshooting tips:'));
      console.log('• Check your AWS credentials: aws sts get-caller-identity');
      console.log('• Verify your AWS region is set correctly');
      console.log('• Check CloudFormation console for detailed error messages');
    }
  } else {
    console.log(chalk.yellow('Deployment skipped. You can deploy later with:'));
    console.log(chalk.cyan('npm run deploy'));
  }
  
  // Step 7: Optional Migration from Legacy Format
  if (process.env.WORLD_CONFIGURATIONS) {
    console.log(chalk.cyan.bold('\n📋 Legacy Format Migration'));
    console.log(chalk.yellow('Legacy world configuration format detected (WORLD_CONFIGURATIONS)'));
    
    const { migrateFormat } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'migrateFormat',
        message: 'Would you like to migrate to the new indexed format?',
        default: true
      }
    ]);
    
    if (migrateFormat) {
      console.log(chalk.cyan('Migrating to indexed world format...'));
      const migrationResult = migrateToIndexedFormat();
      
      if (migrationResult) {
        console.log(chalk.green('✅ Successfully migrated to indexed format!'));
        console.log(chalk.yellow('Note: A backup of your original .env file has been created.'));
      } else {
        console.log(chalk.red('❌ Migration failed. Please check your configuration.'));
      }
    } else {
      console.log(chalk.yellow('Keeping legacy format. You can migrate later if needed.'));
    }
  }
  
  // Discord Developer Portal setup if Discord is configured
  if (discordConfig.appId && apiGatewayUrl) {
    console.log(chalk.cyan.bold('\n🎯 Discord Developer Portal Setup'));
    
    const discordPortalUrl = `https://discord.com/developers/applications/${discordConfig.appId}/information`;
    const interactionsEndpoint = `${apiGatewayUrl}/valheim/control`;
    
    console.log(boxen(
      chalk.bold('📋 Discord Setup Instructions:\n\n') +
      chalk.cyan('1. Copy this Interactions Endpoint URL:\n') +
      chalk.white.bgBlue.bold(` ${interactionsEndpoint} `) + '\n\n' +
      chalk.cyan('2. Open Discord Developer Portal (will open automatically)\n') +
      chalk.cyan('3. Navigate to "General Information"\n') +
      chalk.cyan('4. Scroll down to "Interactions Endpoint URL"\n') +
      chalk.cyan('5. Type or paste the URL above and save\n\n') +
      chalk.yellow('⚠️  This endpoint URL is REQUIRED for Discord slash commands to work!\n') +
      chalk.yellow('Without it, Discord commands will return "Application did not respond"'),
      { padding: 1, margin: 1, borderStyle: 'round', borderColor: 'blue' }
    ));
    
    // Display the URL clearly
    console.log(chalk.white(interactionsEndpoint));
    
    const { openPortal } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'openPortal',
        message: 'Ready to open Discord Developer Portal?',
        default: true
      }
    ]);
    
    if (openPortal) {
      try {
        await open(discordPortalUrl);
        console.log(chalk.green('✅ Discord Developer Portal opened!'));
        console.log(chalk.cyan('Remember to paste the Interactions Endpoint URL shown above.'));
      } catch (error) {
        console.log(chalk.yellow('⚠️  Could not open browser automatically.'));
        console.log(chalk.cyan(`Please manually visit: ${discordPortalUrl}`));
      }
    } else {
      console.log(chalk.cyan(`Portal URL: ${discordPortalUrl}`));
    }
  }
  
  // Final instructions
  console.log(boxen(
    chalk.bold('🎮 HuginBot Setup Complete! 🎮\n\n') +
    'To manage your server, use the following commands:\n\n' +
    `${chalk.cyan('npm run cli')} - Start CLI with commands\n` +
    `${chalk.cyan('npm run cli -- server start')} - Start the server\n` +
    `${chalk.cyan('npm run cli -- server stop')} - Stop the server\n` +
    `${chalk.cyan('npm run cli -- server status')} - Check server status\n` +
    `${chalk.cyan('npm run cli -- worlds')} - Manage worlds\n` +
    `${chalk.cyan('npm run deploy')} - Deploy infrastructure\n\n` +
    (discordConfig.appId && !apiGatewayUrl ? 
      chalk.bold('🔗 Discord Integration Next Steps:\n') +
      '1. Deploy infrastructure: npm run deploy\n' +
      '2. Run setup wizard again to get your Discord endpoint URL\n' +
      '3. Set "Interactions Endpoint URL" in Discord Developer Portal\n' +
      '4. Use /setup in Discord to configure webhooks\n\n'
      : apiGatewayUrl && discordConfig.appId ?
      chalk.bold('🎮 Discord Integration Ready!\n') +
      `• Endpoint URL: ${apiGatewayUrl}/valheim/control\n` +
      '• Set this as "Interactions Endpoint URL" in Discord Developer Portal\n' +
      '• Use /setup in Discord to configure webhooks\n' +
      '• Use /start to launch your server from Discord\n\n'
      : '') +
    'Your configuration is stored in .env with runtime data in ~/.huginbot',
    { padding: 1, margin: 1, borderStyle: 'round', borderColor: 'green' }
  ));
}

module.exports = { runSetupWizard };