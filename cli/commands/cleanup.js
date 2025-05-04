/**
 * cleanup.js - HuginBot CLI parameter cleanup commands
 * 
 * Manages AWS SSM Parameter Store cleanup
 */
const inquirer = require('inquirer');
const ora = require('ora');
const chalk = require('chalk');
const boxen = require('boxen');
const { 
  getObsoleteParameters, 
  getActiveParameters,
  getAllParameters,
  markParameterObsolete,
  recordCleanup
} = require('../utils/parameter-tracker');
const { getSSMClient } = require('../utils/aws');

// Command group registration
function register(program) {
  const cleanup = program
    .command('cleanup')
    .description('Manage SSM parameter cleanup');
  
  cleanup
    .command('list')
    .description('List parameters')
    .option('-a, --all', 'Show all parameters')
    .option('-o, --obsolete', 'Show only obsolete parameters')
    .action(listParameters);
  
  cleanup
    .command('mark-obsolete')
    .description('Mark parameters as obsolete')
    .action(markObsolete);
  
  cleanup
    .command('perform')
    .description('Perform cleanup of obsolete parameters')
    .option('-f, --force', 'Skip confirmation')
    .action(performCleanup);
  
  cleanup
    .command('scan')
    .description('Scan for parameters that appear to be obsolete')
    .action(scanForObsolete);
  
  // Add auto cleanup commands
  cleanup
    .command('auto-enable')
    .description('Enable automatic cleanup')
    .option('-d, --days <days>', 'Delete after days', '30')
    .action((options) => {
      const { setAutoCleanupSettings } = require('../utils/auto-cleanup');
      setAutoCleanupSettings(true, parseInt(options.days));
      console.log(chalk.green(`Automatic cleanup enabled. Obsolete parameters will be deleted after ${options.days} days.`));
    });
  
  cleanup
    .command('auto-disable')
    .description('Disable automatic cleanup')
    .action(() => {
      const { setAutoCleanupSettings } = require('../utils/auto-cleanup');
      setAutoCleanupSettings(false);
      console.log(chalk.green('Automatic cleanup disabled'));
    });
  
  cleanup
    .command('auto-run')
    .description('Run automatic cleanup now')
    .option('-f, --force', 'Force cleanup without age threshold')
    .action(async (options) => {
      const { runAutoCleanup } = require('../utils/auto-cleanup');
      await runAutoCleanup(!options.force);
    });
  
  return cleanup;
}

/**
 * List parameters with various filters
 */
async function listParameters(options) {
  let parameters;
  
  if (options.obsolete) {
    parameters = getObsoleteParameters();
    console.log(chalk.cyan.bold('\n📋 Obsolete Parameters:'));
  } else if (options.all) {
    parameters = getAllParameters();
    console.log(chalk.cyan.bold('\n📋 All Parameters:'));
  } else {
    parameters = getActiveParameters();
    console.log(chalk.cyan.bold('\n📋 Active Parameters:'));
  }
  
  if (parameters.length === 0) {
    console.log(chalk.yellow('No parameters found'));
    return;
  }
  
  parameters.forEach((param, index) => {
    const status = param.obsolete 
      ? chalk.red('⚠️ OBSOLETE') 
      : chalk.green('✓ ACTIVE');
    
    console.log(`${index + 1}. ${chalk.bold(param.name)} (${status})`);
    console.log(`   Description: ${param.description || 'N/A'}`);
    
    if (param.associatedResource) {
      console.log(`   Associated: ${param.associatedResource}`);
    }
    
    console.log(`   Created: ${new Date(param.createdAt).toLocaleString()}`);
    console.log(`   Updated: ${new Date(param.updatedAt).toLocaleString()}`);
    
    if (param.obsolete) {
      console.log(`   Marked obsolete: ${new Date(param.markedObsoleteAt).toLocaleString()}`);
      console.log(`   Reason: ${param.obsoleteReason}`);
    }
    
    console.log('');
  });
}

/**
 * Mark parameters as obsolete
 */
async function markObsolete() {
  const activeParams = getActiveParameters();
  
  if (activeParams.length === 0) {
    console.log(chalk.yellow('No active parameters found'));
    return;
  }
  
  const { selectedParams } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selectedParams',
      message: 'Select parameters to mark as obsolete:',
      choices: activeParams.map(param => ({
        name: `${param.name} (${param.description || 'No description'})`,
        value: param.name
      }))
    }
  ]);
  
  if (selectedParams.length === 0) {
    console.log(chalk.yellow('No parameters selected'));
    return;
  }
  
  const { reason } = await inquirer.prompt([
    {
      type: 'input',
      name: 'reason',
      message: 'Reason for marking as obsolete:',
      default: 'Manually marked obsolete'
    }
  ]);
  
  const spinner = ora('Marking parameters as obsolete...').start();
  
  try {
    for (const paramName of selectedParams) {
      markParameterObsolete(paramName, reason);
    }
    
    spinner.succeed(`Marked ${selectedParams.length} parameters as obsolete`);
  } catch (error) {
    spinner.fail('Error marking parameters as obsolete');
    console.error(chalk.red('Error:'), error.message);
  }
}

/**
 * Perform cleanup of obsolete parameters
 */
async function performCleanup(options) {
  const obsoleteParams = getObsoleteParameters();
  
  if (obsoleteParams.length === 0) {
    console.log(chalk.yellow('No obsolete parameters found'));
    return;
  }
  
  console.log(chalk.cyan.bold('\n📋 Parameters to be Deleted:'));
  obsoleteParams.forEach((param, index) => {
    console.log(`${index + 1}. ${chalk.bold(param.name)}`);
    console.log(`   Description: ${param.description || 'N/A'}`);
    console.log(`   Marked obsolete: ${new Date(param.markedObsoleteAt).toLocaleString()}`);
    console.log(`   Reason: ${param.obsoleteReason}`);
    console.log('');
  });
  
  if (!options.force) {
    const { confirmDelete } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmDelete',
        message: `Are you sure you want to delete ${obsoleteParams.length} parameters?`,
        default: false
      }
    ]);
    
    if (!confirmDelete) {
      console.log(chalk.yellow('Cleanup cancelled'));
      return;
    }
  }
  
  const spinner = ora('Deleting parameters...').start();
  
  try {
    const ssm = getSSMClient();
    const deletedParams = [];
    
    for (const param of obsoleteParams) {
      try {
        await ssm.deleteParameter({
          Name: param.name
        });
        
        deletedParams.push(param);
      } catch (error) {
        console.error(`Error deleting parameter ${param.name}:`, error.message);
      }
    }
    
    // Record cleanup
    recordCleanup(deletedParams);
    
    spinner.succeed(`Deleted ${deletedParams.length} parameters`);
  } catch (error) {
    spinner.fail('Error performing cleanup');
    console.error(chalk.red('Error:'), error.message);
  }
}

/**
 * Scan for parameters that appear to be obsolete
 */
async function scanForObsolete() {
  const spinner = ora('Scanning for potentially obsolete parameters...').start();
  
  try {
    const ssm = getSSMClient();
    const trackingParams = getAllParameters().map(p => p.name);
    
    // Get all parameters with the /huginbot/ prefix
    let nextToken;
    let allSsmParams = [];
    
    do {
      const response = await ssm.describeParameters({
        ParameterFilters: [
          {
            Key: 'Name',
            Option: 'BeginsWith',
            Values: ['/huginbot/']
          }
        ],
        NextToken: nextToken
      });
      
      allSsmParams = [...allSsmParams, ...(response.Parameters || [])];
      nextToken = response.NextToken;
    } while (nextToken);
    
    // Find parameters that exist in SSM but not in our tracking
    const untracked = allSsmParams.filter(p => 
      !trackingParams.includes(p.Name)
    );
    
    spinner.succeed(`Found ${untracked.length} potentially obsolete parameters`);
    
    if (untracked.length === 0) {
      console.log(chalk.green('All parameters are being tracked. No cleanup needed.'));
      return;
    }
    
    console.log(chalk.cyan.bold('\n📋 Untracked Parameters:'));
    untracked.forEach((param, index) => {
      console.log(`${index + 1}. ${chalk.bold(param.Name)}`);
      console.log(`   Last Modified: ${param.LastModifiedDate.toLocaleString()}`);
      console.log(`   Type: ${param.Type}`);
      console.log('');
    });
    
    const { addToTracking } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'addToTracking',
        message: 'Would you like to add these parameters to tracking as obsolete?',
        default: true
      }
    ]);
    
    if (addToTracking) {
      for (const param of untracked) {
        // Add to tracking
        const { trackParameter } = require('../utils/parameter-tracker');
        trackParameter(
          param.Name,
          `Auto-discovered parameter`,
          null
        );
        
        // Mark as obsolete
        markParameterObsolete(
          param.Name,
          'Discovered during scan and not associated with any known resource'
        );
      }
      
      console.log(chalk.green(`Added ${untracked.length} parameters to tracking as obsolete`));
      console.log('You can now use the cleanup command to delete them.');
    }
  } catch (error) {
    spinner.fail('Error scanning for obsolete parameters');
    console.error(chalk.red('Error:'), error.message);
  }
}

module.exports = {
  register,
  listParameters,
  markObsolete,
  performCleanup,
  scanForObsolete
};