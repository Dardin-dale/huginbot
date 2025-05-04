/**
 * Auto-Cleanup for HuginBot AWS SSM Parameters
 * 
 * This module implements automatic cleanup of SSM parameters
 * that have been marked as obsolete
 */

const { 
  getObsoleteParameters, 
  recordCleanup 
} = require('./parameter-tracker');
const { getSSMClient } = require('./aws');
const { getConfig, saveConfig } = require('./config');
const chalk = require('chalk');

/**
 * Check if automatic cleanup is enabled
 * @returns {boolean} True if enabled
 */
function isAutoCleanupEnabled() {
  const config = getConfig();
  return config.autoCleanup === true;
}

/**
 * Set auto cleanup settings
 * @param {boolean} enabled Whether auto cleanup is enabled
 * @param {number} olderThanDays Days threshold for cleanup (default: 30)
 */
function setAutoCleanupSettings(enabled, olderThanDays = 30) {
  const config = getConfig();
  config.autoCleanup = enabled;
  config.autoCleanupDays = olderThanDays;
  saveConfig(config);
  return { enabled, olderThanDays };
}

/**
 * Run automatic cleanup of obsolete parameters
 * @param {boolean} silent Whether to suppress log output
 * @returns {Promise<Array>} Deleted parameters
 */
async function runAutoCleanup(silent = false) {
  if (!isAutoCleanupEnabled()) {
    if (!silent) {
      console.log(chalk.yellow('Automatic cleanup is disabled'));
    }
    return [];
  }
  
  const config = getConfig();
  const olderThanDays = config.autoCleanupDays || 30;
  
  // Get parameters marked obsolete more than X days ago
  const obsoleteParams = getObsoleteParameters().filter(param => {
    if (!param.markedObsoleteAt) return false;
    
    const markedDate = new Date(param.markedObsoleteAt);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
    
    return markedDate < cutoffDate;
  });
  
  if (obsoleteParams.length === 0) {
    if (!silent) {
      console.log(chalk.green('No obsolete parameters to clean up'));
    }
    return [];
  }
  
  if (!silent) {
    console.log(chalk.cyan(`Found ${obsoleteParams.length} parameters marked obsolete more than ${olderThanDays} days ago`));
  }
  
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
        if (!silent) {
          console.error(`Error deleting parameter ${param.name}:`, error.message);
        }
      }
    }
    
    // Record cleanup
    if (deletedParams.length > 0) {
      recordCleanup(deletedParams);
      
      if (!silent) {
        console.log(chalk.green(`Automatically deleted ${deletedParams.length} obsolete parameters`));
      }
    }
    
    return deletedParams;
  } catch (error) {
    if (!silent) {
      console.error(chalk.red('Error performing automatic cleanup:'), error.message);
    }
    return [];
  }
}

module.exports = {
  isAutoCleanupEnabled,
  setAutoCleanupSettings,
  runAutoCleanup
};