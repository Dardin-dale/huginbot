/**
 * HuginBot CLI - Deployment Commands
 * This module handles commands for deploying and undeploying infrastructure
 */

const inquirer = require('inquirer');
const { execSync } = require('child_process');
const ora = require('ora');
const chalk = require('chalk');
const boxen = require('boxen');
const { 
  getConfig, 
  saveConfig 
} = require('../utils/config');
const { 
  isStackDeployed,
  getStackOutputs,
  getInstanceDetails
} = require('../utils/aws');

/**
 * Register deployment commands
 * @param {Object} program - Commander program object
 */
function register(program) {
  const deploy = program
    .command('deploy')
    .description('Deploy HuginBot infrastructure');
  
  deploy
    .command('all')
    .description('Deploy all infrastructure stacks')
    .action(deployStack);
  
  deploy
    .command('valheim')
    .description('Deploy only Valheim server stack')
    .action(() => deployValheimStack());
  
  deploy
    .command('discord')
    .description('Deploy only Discord integration stack')
    .action(() => deployDiscordStack());
  
  const undeploy = program
    .command('undeploy')
    .description('Undeploy HuginBot infrastructure')
    .action(undeployStack);
  
  return deploy;
}

/**
 * Deploy both Valheim and Discord stacks
 */
async function deployStack() {
  try {
    // First deploy Valheim stack
    const instanceId = await deployValheimStack();
    
    if (!instanceId) {
      return;
    }
    
    // Then deploy Discord stack
    await deployDiscordStack(instanceId);
    
  } catch (error) {
    console.error(chalk.red('Error deploying stacks:'), error);
  }
}

/**
 * Deploy the Valheim server stack
 * @returns {Promise<string|null>} The instance ID if successful, null otherwise
 */
async function deployValheimStack() {
  try {
    const config = getConfig();
    const valheimStackName = 'ValheimStack';
    
    // Check if stack already exists
    const spinner = ora('Checking if Valheim stack is already deployed...').start();
    const isDeployed = await isStackDeployed(valheimStackName);
    
    if (isDeployed) {
      spinner.succeed(`Stack ${valheimStackName} is already deployed.`);
      
      try {
        // Get instance ID from stack outputs
        const outputs = await getStackOutputs(valheimStackName);
        const instanceId = outputs.InstanceId;
        
        if (instanceId) {
          // Save instance ID to config
          saveConfig({ instanceId });
          return instanceId;
        }
      } catch (err) {
        // If we can't get the instance ID, continue without it
        console.warn(chalk.yellow('Could not retrieve instance ID from existing stack.'));
      }
      
      return null;
    }
    
    spinner.text = `Deploying ${valheimStackName}...`;
    
    // Confirm before proceeding
    spinner.stop();
    console.log(chalk.yellow(`\nAbout to deploy Valheim server with these settings:`));
    console.log(boxen(
      `Server Name: ${chalk.green(config.serverName)}\n` +
      `World Name: ${chalk.green(config.worldName)}\n` +
      `Server Password: ${chalk.green('********')}\n` +
      `Admin IDs: ${chalk.green(config.adminIds || 'None')}\n` +
      `Instance Type: ${chalk.green(config.instanceType)}`,
      { padding: 1, borderColor: 'yellow' }
    ));
    
    const { confirmDeploy } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmDeploy',
        message: 'Do you want to proceed with deployment?',
        default: true
      }
    ]);
    
    if (!confirmDeploy) {
      console.log(chalk.yellow('Deployment cancelled.'));
      return null;
    }
    
    // Start deployment spinner again
    spinner.start(`Deploying ${valheimStackName}...`);
    
    try {
      // Deploy the Valheim stack with parameters
      const command = `npx cdk deploy ${valheimStackName} ` +
        `--parameters serverName=${config.serverName} ` +
        `--parameters worldName=${config.worldName} ` +
        `--parameters serverPassword=${config.serverPassword} ` +
        `--parameters adminIds="${config.adminIds}" ` +
        `--parameters instanceType=${config.instanceType}`;
      
      execSync(command, { stdio: 'inherit' });
      spinner.succeed(`${valheimStackName} deployed successfully.`);
      
      // Get the instance ID for the Huginbot stack
      spinner.text = 'Getting instance details...';
      spinner.start();
      
      try {
        // Get instance ID from stack outputs
        const outputs = await getStackOutputs(valheimStackName);
        const instanceId = outputs.InstanceId;
        
        if (instanceId) {
          // Save instance ID and deployment timestamp to config
          const deployedAt = new Date().toISOString();
          saveConfig({ instanceId, deployedAt });
          
          // Also get the public IP address
          try {
            const instanceDetails = await getInstanceDetails(instanceId);
            if (instanceDetails.publicIp) {
              saveConfig({ publicIp: instanceDetails.publicIp });
              spinner.succeed(`Server deployed with IP: ${instanceDetails.publicIp}`);
              
              console.log(chalk.green(`\n✅ Valheim server deployed successfully!`));
              console.log(`Connect to your server at: ${chalk.cyan(`${instanceDetails.publicIp}:2456`)}`);
              console.log(`Server is currently starting up and may take a few minutes to be available.`);
              
              return instanceId;
            }
          } catch (err) {
            // If we can't get the instance details, continue with just the ID
            spinner.succeed(`Server deployed with ID: ${instanceId}`);
          }
          
          return instanceId;
        } else {
          spinner.warn('Could not find instance ID in stack outputs.');
          return null;
        }
      } catch (err) {
        spinner.fail('Error getting instance details.');
        console.error(chalk.red('Error:'), err.message);
        return null;
      }
    } catch (err) {
      spinner.fail(`Error deploying ${valheimStackName}.`);
      console.error(chalk.red('Error:'), err.message);
      return null;
    }
  } catch (error) {
    console.error(chalk.red('Error deploying Valheim stack:'), error.message);
    return null;
  }
}

/**
 * Deploy the Discord integration stack
 * @param {string} instanceId - The EC2 instance ID for the Valheim server
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
async function deployDiscordStack(instanceId = null) {
  try {
    const config = getConfig();
    const huginbotStackName = 'HuginbotStack';
    
    // Check if stack already exists
    const spinner = ora('Checking if Discord stack is already deployed...').start();
    const isDeployed = await isStackDeployed(huginbotStackName);
    
    if (isDeployed) {
      spinner.succeed(`Stack ${huginbotStackName} is already deployed.`);
      return true;
    }
    
    // Validate Discord configuration
    if (!config.discord || !config.discord.appId || !config.discord.botToken) {
      spinner.fail('Discord configuration is missing.');
      console.log(chalk.yellow('You need to configure Discord integration first.'));
      
      const { configureNow } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'configureNow',
          message: 'Do you want to configure Discord now?',
          default: true
        }
      ]);
      
      if (configureNow) {
        // This should call the discord configuration function
        // For now, we'll just prompt for the required fields
        const discordConfig = await inquirer.prompt([
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
        
        saveConfig({ discord: discordConfig });
      } else {
        console.log(chalk.yellow('Discord stack deployment cancelled.'));
        return false;
      }
    }
    
    // Get instance ID from config if not provided
    if (!instanceId) {
      instanceId = config.instanceId;
      
      if (!instanceId) {
        spinner.fail('Instance ID not found.');
        console.log(chalk.yellow('You need to deploy the Valheim stack first.'));
        return false;
      }
    }
    
    spinner.text = `Deploying ${huginbotStackName}...`;
    
    try {
      // Deploy the Huginbot stack with the instance ID
      const command = `npx cdk deploy ${huginbotStackName} --parameters valheimInstanceId=${instanceId}`;
      execSync(command, { stdio: 'inherit' });
      
      spinner.succeed(`${huginbotStackName} deployed successfully.`);
      console.log(chalk.green('\n✅ Discord integration deployed!'));
      console.log('To complete setup, run: npm run register-commands');
      
      // Ask if they want to register commands now
      const { registerNow } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'registerNow',
          message: 'Do you want to register Discord commands now?',
          default: true
        }
      ]);
      
      if (registerNow) {
        try {
          console.log(chalk.cyan('Registering Discord commands...'));
          execSync('npm run register-commands', { stdio: 'inherit' });
          console.log(chalk.green('✅ Discord commands registered successfully!'));
        } catch (err) {
          console.error(chalk.red('Error registering Discord commands:'), err.message);
        }
      }
      
      return true;
    } catch (err) {
      spinner.fail(`Error deploying ${huginbotStackName}.`);
      console.error(chalk.red('Error:'), err.message);
      return false;
    }
  } catch (error) {
    console.error(chalk.red('Error deploying Discord stack:'), error.message);
    return false;
  }
}

/**
 * Undeploy all infrastructure stacks
 */
async function undeployStack() {
  try {
    const valheimStackName = 'ValheimStack';
    const huginbotStackName = 'HuginbotStack';
    
    // Check if stacks are deployed
    const valheimDeployed = await isStackDeployed(valheimStackName);
    const huginbotDeployed = await isStackDeployed(huginbotStackName);
    
    if (!valheimDeployed && !huginbotDeployed) {
      console.log(chalk.yellow('No HuginBot stacks are currently deployed.'));
      return;
    }
    
    // Show warning
    console.log('\n');
    console.log(boxen(
      chalk.red.bold('⚠️  WARNING: UNDEPLOYING INFRASTRUCTURE ⚠️') + '\n\n' +
      'This will PERMANENTLY DELETE all deployed resources, including:\n' +
      '- EC2 instances running your Valheim server\n' +
      '- S3 buckets containing your world backups\n' +
      '- API Gateway endpoints for Discord integration\n' +
      '- Lambda functions and other AWS resources\n\n' +
      chalk.yellow.bold('World backups will be PERMANENTLY LOST unless you download them first!'),
      { padding: 1, margin: 1, borderStyle: 'double', borderColor: 'red' }
    ));
    
    // First confirmation
    const { confirmUndeploy } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmUndeploy',
        message: 'Are you sure you want to undeploy all HuginBot infrastructure?',
        default: false
      }
    ]);
    
    if (!confirmUndeploy) {
      console.log(chalk.green('Undeploy cancelled.'));
      return;
    }
    
    // Get the name of the world to type for confirmation
    const config = getConfig();
    const worldName = config.worldName || 'ValheimWorld';
    
    // Second confirmation - type the world name
    const { worldNameConfirmation } = await inquirer.prompt([
      {
        type: 'input',
        name: 'worldNameConfirmation',
        message: `To confirm, please type the name of your primary world (${worldName}):`,
        validate: (input) => {
          if (input === worldName) {
            return true;
          }
          return 'The world name does not match. Please try again or press Ctrl+C to cancel.';
        }
      }
    ]);
    
    // Final confirmation
    const { finalConfirmation } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'finalConfirmation',
        message: 'THIS IS YOUR FINAL WARNING: Proceed with undeploying all resources?',
        default: false
      }
    ]);
    
    if (!finalConfirmation) {
      console.log(chalk.green('Undeploy cancelled.'));
      return;
    }
    
    // Ask if they want to back up their worlds first
    const { backupFirst } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'backupFirst',
        message: 'Would you like to download backups of your worlds before undeploying?',
        default: true
      }
    ]);
    
    if (backupFirst) {
      console.log(chalk.cyan('Launching backup tool...'));
      
      // Ideally call the backup download function here
      console.log(chalk.yellow('Backup functionality will be implemented soon.'));
      
      // After backup, confirm again
      const { proceedAfterBackup } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'proceedAfterBackup',
          message: 'Proceed with undeploying after backup?',
          default: true
        }
      ]);
      
      if (!proceedAfterBackup) {
        console.log(chalk.green('Undeploy cancelled.'));
        return;
      }
    }
    
    const spinner = ora('Beginning undeploy process...').start();
    
    // Undeploy in reverse order of deployment
    if (huginbotDeployed) {
      spinner.text = `Undeploying ${huginbotStackName}...`;
      try {
        const command = `npx cdk destroy ${huginbotStackName} --force`;
        execSync(command, { stdio: 'inherit' });
        spinner.succeed(`${huginbotStackName} successfully undeployed.`);
      } catch (error) {
        spinner.fail(`Error undeploying ${huginbotStackName}:`);
        console.error(chalk.red('Error:'), error.message);
        console.log(chalk.yellow('Continuing with remaining undeployment...'));
      }
    }
    
    if (valheimDeployed) {
      spinner.text = `Undeploying ${valheimStackName}...`;
      spinner.start();
      try {
        const command = `npx cdk destroy ${valheimStackName} --force`;
        execSync(command, { stdio: 'inherit' });
        spinner.succeed(`${valheimStackName} successfully undeployed.`);
      } catch (error) {
        spinner.fail(`Error undeploying ${valheimStackName}:`);
        console.error(chalk.red('Error:'), error.message);
        console.log(chalk.yellow('Undeployment process completed with errors.'));
        return;
      }
    }
    
    // Clear instance ID and other deployment-specific config
    saveConfig({
      instanceId: '',
      publicIp: '',
      deployedAt: ''
    });
    
    console.log(chalk.green('All HuginBot infrastructure has been successfully undeployed.'));
  } catch (error) {
    console.error(chalk.red('Error undeploying stacks:'), error.message);
  }
}

module.exports = {
  register,
  deployStack,
  deployValheimStack,
  deployDiscordStack,
  undeployStack
};