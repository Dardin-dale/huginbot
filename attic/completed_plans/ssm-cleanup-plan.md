# HuginBot SSM Parameter Cleanup Implementation Plan

## Overview

This document outlines the implementation plan for an AWS SSM Parameter Store cleanup mechanism in the HuginBot application. As the number of worlds, Discord integrations, and configurations increases, orphaned or outdated parameters can accumulate in the Parameter Store, potentially leading to confusion and approaching service quotas.

## Current Parameter Usage

HuginBot currently stores the following data in SSM Parameter Store:

1. `/huginbot/active-world` - Currently active world configuration
2. `/huginbot/discord-webhook/{discordServerId}` - Discord webhook URLs for notifications
3. `/huginbot/playfab-join-code` - Current server join code
4. `/huginbot/playfab-join-code-timestamp` - Timestamp of when join code was detected
5. `/huginbot/player-count` - Current player count

## Cleanup Requirements

The parameter cleanup mechanism should:

1. Identify and remove obsolete parameters
2. Ensure no active configurations are deleted
3. Provide backup options before deletion
4. Integrate with the existing CLI
5. Support both automatic and manual cleanup
6. Log all cleanup activities

## Implementation Steps

### 1. Parameter Tracking System

Add a tracking system to record all parameters created by HuginBot:

```javascript
// cli/utils/parameter-tracker.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getConfig } = require('./config');

// Parameter tracking file location
const trackingDir = path.join(os.homedir(), '.huginbot');
const trackingFile = path.join(trackingDir, 'parameters.json');

// Ensure tracking directory exists
if (!fs.existsSync(trackingDir)) {
  fs.mkdirSync(trackingDir, { recursive: true });
}

// Initialize tracking file if it doesn't exist
if (!fs.existsSync(trackingFile)) {
  fs.writeFileSync(trackingFile, JSON.stringify({
    parameters: [],
    lastCleanup: null
  }));
}

// Read tracking file
function getTracking() {
  try {
    const data = fs.readFileSync(trackingFile, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading parameter tracking file:', error);
    return { parameters: [], lastCleanup: null };
  }
}

// Save tracking file
function saveTracking(tracking) {
  try {
    fs.writeFileSync(trackingFile, JSON.stringify(tracking, null, 2));
  } catch (error) {
    console.error('Error saving parameter tracking file:', error);
  }
}

// Track a parameter
function trackParameter(name, description, associatedResource = null) {
  const tracking = getTracking();
  
  // Check if parameter already exists in tracking
  const existingIndex = tracking.parameters.findIndex(p => p.name === name);
  
  const parameterInfo = {
    name,
    description,
    associatedResource,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  if (existingIndex >= 0) {
    // Update existing parameter
    tracking.parameters[existingIndex] = {
      ...tracking.parameters[existingIndex],
      ...parameterInfo,
      createdAt: tracking.parameters[existingIndex].createdAt
    };
  } else {
    // Add new parameter
    tracking.parameters.push(parameterInfo);
  }
  
  saveTracking(tracking);
}

// Mark a parameter as obsolete
function markParameterObsolete(name, reason = 'Marked manually') {
  const tracking = getTracking();
  const param = tracking.parameters.find(p => p.name === name);
  
  if (param) {
    param.obsolete = true;
    param.obsoleteReason = reason;
    param.markedObsoleteAt = new Date().toISOString();
    saveTracking(tracking);
    return true;
  }
  
  return false;
}

// Get all tracked parameters
function getAllParameters() {
  return getTracking().parameters;
}

// Get obsolete parameters
function getObsoleteParameters() {
  return getTracking().parameters.filter(p => p.obsolete);
}

// Get active parameters
function getActiveParameters() {
  return getTracking().parameters.filter(p => !p.obsolete);
}

// Record cleanup event
function recordCleanup(deletedParameters) {
  const tracking = getTracking();
  
  tracking.lastCleanup = {
    timestamp: new Date().toISOString(),
    deletedCount: deletedParameters.length,
    parameters: deletedParameters
  };
  
  // Remove deleted parameters from tracking
  tracking.parameters = tracking.parameters.filter(
    p => !deletedParameters.some(dp => dp.name === p.name)
  );
  
  saveTracking(tracking);
}

module.exports = {
  trackParameter,
  markParameterObsolete,
  getAllParameters,
  getObsoleteParameters,
  getActiveParameters,
  recordCleanup
};
```

### 2. Parameter Creation Modifications

Update all parameter creation functions to track created parameters:

```javascript
// cli/utils/aws.js - Modified updateActiveWorld function
async function updateActiveWorld(worldConfig) {
  try {
    const ssm = getSSMClient();
    const paramName = '/huginbot/active-world';
    
    await ssm.putParameter({
      Name: paramName,
      Value: JSON.stringify(worldConfig),
      Type: 'String',
      Overwrite: true
    });
    
    // Track the parameter
    const { trackParameter } = require('./parameter-tracker');
    trackParameter(
      paramName,
      `Active world configuration for ${worldConfig.name}`,
      `world:${worldConfig.name}`
    );
    
    return true;
  } catch (error) {
    console.error('Error updating active world:', error);
    throw error;
  }
}

// Similar modifications needed for all parameter creation functions
```

### 3. Cleanup Command Implementation

Create a new command module for parameter cleanup:

```javascript
// cli/commands/cleanup.js
const inquirer = require('inquirer');
const ora = require('ora');
const chalk = require('chalk');
const { 
  getObsoleteParameters, 
  getActiveParameters,
  getAllParameters,
  markParameterObsolete,
  recordCleanup
} = require('../utils/parameter-tracker');
const { getSSMClient } = require('../utils/aws');

// Register cleanup command
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
  
  return cleanup;
}

// List parameters
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

// Mark parameters as obsolete
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

// Perform cleanup of obsolete parameters
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

// Scan for parameters that appear to be obsolete
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
        const { trackParameter, markParameterObsolete } = require('../utils/parameter-tracker');
        
        // Add to tracking
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
```

### 4. Automatic Cleanup Integration

Add an automatic cleanup mechanism that runs periodically:

```javascript
// cli/utils/auto-cleanup.js
const { 
  getObsoleteParameters, 
  recordCleanup 
} = require('./parameter-tracker');
const { getSSMClient } = require('./aws');
const { getConfig } = require('./config');
const chalk = require('chalk');

// Check if automatic cleanup is enabled
function isAutoCleanupEnabled() {
  const config = getConfig();
  return config.autoCleanup === true;
}

// Set auto cleanup settings
function setAutoCleanupSettings(enabled, olderThanDays = 30) {
  const config = getConfig();
  config.autoCleanup = enabled;
  config.autoCleanupDays = olderThanDays;
  require('./config').saveConfig(config);
}

// Run automatic cleanup
async function runAutoCleanup(silent = false) {
  if (!isAutoCleanupEnabled()) {
    if (!silent) {
      console.log(chalk.yellow('Automatic cleanup is disabled'));
    }
    return;
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
    return;
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
    recordCleanup(deletedParams);
    
    if (!silent) {
      console.log(chalk.green(`Automatically deleted ${deletedParams.length} obsolete parameters`));
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
```

### 5. Add Cleanup to Interactive Menu

Add cleanup options to the CLI's interactive menu:

```javascript
// cli/interactive.js - Add to the main menu
const mainChoices = [
  // ... existing choices
  {
    name: `${chalk.magenta('🧹')} Parameter Cleanup`,
    value: 'cleanup'
  },
  // ... other choices
];

// Add cleanupMenu function
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
        { name: 'Back to Main Menu', value: 'back' }
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

// Update the mainMenu's switch statement
switch (action) {
  // ... existing cases
  case 'cleanup':
    await cleanupMenu();
    break;
  // ... other cases
}
```

### 6. Automated Cleanup on Start

Add cleanup check on CLI startup:

```javascript
// cli/index.js - Add to the beginning after imports
// Check for obsolete parameters and run auto-cleanup if enabled
const { runAutoCleanup } = require('./utils/auto-cleanup');
runAutoCleanup(true); // silent mode
```

### 7. Command Line Arguments for Cleanup

Add direct command line arguments:

```javascript
// cli/commands/cleanup.js - Update register function
function register(program) {
  const cleanup = program
    .command('cleanup')
    .description('Manage SSM parameter cleanup');
  
  // ... existing commands
  
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
      if (options.force) {
        // Override days threshold to 0 for this run
        const origSettings = require('../utils/config').getConfig();
        const origDays = origSettings.autoCleanupDays;
        
        require('../utils/config').saveConfig({
          ...origSettings,
          autoCleanupDays: 0
        });
        
        await runAutoCleanup(false);
        
        // Restore original settings
        require('../utils/config').saveConfig({
          ...require('../utils/config').getConfig(),
          autoCleanupDays: origDays
        });
      } else {
        await runAutoCleanup(false);
      }
    });
  
  return cleanup;
}
```

## Testing Plan

1. **Unit Tests** for parameter tracker functionality:

```javascript
// test/utils/parameter-tracker.test.js
const {
  trackParameter,
  markParameterObsolete,
  getAllParameters,
  getObsoleteParameters,
  getActiveParameters,
  recordCleanup
} = require('../../cli/utils/parameter-tracker');

// Mock fs module to avoid file system operations
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn().mockReturnValue(JSON.stringify({
    parameters: [],
    lastCleanup: null
  }))
}));

describe('Parameter Tracker', () => {
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Provide fresh mock data
    const fs = require('fs');
    fs.readFileSync.mockReturnValue(JSON.stringify({
      parameters: [],
      lastCleanup: null
    }));
  });
  
  test('should track a new parameter', () => {
    const fs = require('fs');
    trackParameter('/test/param', 'Test parameter', 'test:resource');
    
    expect(fs.writeFileSync).toHaveBeenCalled();
    
    // Get the JSON that was written
    const calls = fs.writeFileSync.mock.calls;
    const writtenData = JSON.parse(calls[0][1]);
    
    expect(writtenData.parameters).toHaveLength(1);
    expect(writtenData.parameters[0].name).toBe('/test/param');
    expect(writtenData.parameters[0].description).toBe('Test parameter');
    expect(writtenData.parameters[0].associatedResource).toBe('test:resource');
  });
  
  test('should mark a parameter as obsolete', () => {
    // Setup existing parameter
    const fs = require('fs');
    fs.readFileSync.mockReturnValue(JSON.stringify({
      parameters: [
        {
          name: '/test/param',
          description: 'Test parameter',
          associatedResource: 'test:resource',
          createdAt: '2023-01-01T00:00:00.000Z',
          updatedAt: '2023-01-01T00:00:00.000Z'
        }
      ],
      lastCleanup: null
    }));
    
    // Mark as obsolete
    const result = markParameterObsolete('/test/param', 'Test reason');
    
    expect(result).toBe(true);
    expect(fs.writeFileSync).toHaveBeenCalled();
    
    // Get the JSON that was written
    const calls = fs.writeFileSync.mock.calls;
    const writtenData = JSON.parse(calls[0][1]);
    
    expect(writtenData.parameters[0].obsolete).toBe(true);
    expect(writtenData.parameters[0].obsoleteReason).toBe('Test reason');
    expect(writtenData.parameters[0].markedObsoleteAt).toBeDefined();
  });
  
  // Add more tests for other functions
});
```

2. **Integration Tests** for AWS SSM interactions:

```javascript
// test/commands/cleanup.test.js
const { 
  scanForObsolete, 
  performCleanup 
} = require('../../cli/commands/cleanup');

// Mock AWS SSM client
jest.mock('../../cli/utils/aws', () => ({
  getSSMClient: jest.fn().mockReturnValue({
    describeParameters: jest.fn().mockResolvedValue({
      Parameters: [
        {
          Name: '/huginbot/test/param1',
          Type: 'String',
          LastModifiedDate: new Date()
        },
        {
          Name: '/huginbot/test/param2',
          Type: 'SecureString',
          LastModifiedDate: new Date()
        }
      ]
    }),
    deleteParameter: jest.fn().mockResolvedValue({})
  })
}));

// Mock parameter tracker
jest.mock('../../cli/utils/parameter-tracker', () => ({
  getAllParameters: jest.fn().mockReturnValue([
    { name: '/huginbot/tracked/param', description: 'Tracked parameter' }
  ]),
  getObsoleteParameters: jest.fn().mockReturnValue([
    { 
      name: '/huginbot/obsolete/param', 
      description: 'Obsolete parameter',
      markedObsoleteAt: new Date().toISOString(),
      obsoleteReason: 'Test reason'
    }
  ]),
  recordCleanup: jest.fn()
}));

describe('Cleanup Commands', () => {
  test('scanForObsolete should find untracked parameters', async () => {
    // Implement test
  });
  
  test('performCleanup should delete obsolete parameters', async () => {
    // Implement test
  });
});
```

## Integration with HuginBot Workflows

### 1. Add Parameter Creation Tracking

Update all functions that create SSM parameters to use the tracking system:

1. World creation and switching
2. Discord webhook registration
3. Server status updates

### 2. Add Regular Cleanup to Server Lifecycle

Schedule cleanup to run during server maintenance operations:

```javascript
// cli/commands/server.js - Add to startServer function
const { runAutoCleanup } = require('../utils/auto-cleanup');

async function startServer() {
  // Run auto cleanup before starting the server
  await runAutoCleanup(true); // silent mode
  
  // Existing server start code
  // ...
}
```

### 3. Parameter Cleanup During World Deletion

When a world is deleted, mark its parameters as obsolete:

```javascript
// cli/commands/worlds.js - Update removeWorld function
async function removeWorld() {
  // Existing code to get world and confirm deletion
  // ...
  
  if (confirmRemove) {
    const removedWorld = config.worlds.splice(worldToRemove, 1)[0];
    saveConfig(config);
    
    // Mark associated parameters as obsolete
    const { markParameterObsolete } = require('../utils/parameter-tracker');
    
    // Mark active world parameter if it matches the removed world
    try {
      const activeWorld = await getActiveWorldFromSSM();
      if (activeWorld.name === removedWorld.name) {
        markParameterObsolete(
          '/huginbot/active-world',
          `World ${removedWorld.name} was removed`
        );
      }
    } catch (error) {
      // Ignore error - active world parameter might not exist
    }
    
    // Mark Discord webhook parameter if there is one
    if (removedWorld.discordServerId) {
      markParameterObsolete(
        `/huginbot/discord-webhook/${removedWorld.discordServerId}`,
        `World ${removedWorld.name} with Discord server ${removedWorld.discordServerId} was removed`
      );
    }
    
    console.log(chalk.green(`✅ World "${removedWorld.name}" removed successfully`));
    console.log(chalk.yellow('Associated parameters have been marked as obsolete'));
    console.log('They will be cleaned up automatically or you can run a manual cleanup');
  }
}
```

## Deployment Guide

### 1. Install Required Package Dependencies

Add to package.json:

```json
{
  "dependencies": {
    // ... existing dependencies
    "conf": "^10.x"
  }
}
```

### 2. Create Development Scripts

Add scripts to package.json:

```json
{
  "scripts": {
    // ... existing scripts
    "cleanup": "node cli/index.js cleanup",
    "cleanup:scan": "node cli/index.js cleanup scan",
    "cleanup:auto": "node cli/index.js cleanup auto-run"
  }
}
```

### 3. Update Documentation

Update the README.md file to include information about parameter cleanup:

```markdown
## Parameter Management

HuginBot includes tools to help manage AWS SSM Parameters used by the application:

### Manual Parameter Cleanup

Use the following commands to manage parameters:

```bash
# List parameters
huginbot cleanup list

# Scan for obsolete parameters
huginbot cleanup scan

# Mark parameters as obsolete
huginbot cleanup mark-obsolete

# Clean up obsolete parameters
huginbot cleanup perform
```

### Automatic Parameter Cleanup

HuginBot can automatically clean up obsolete parameters:

```bash
# Enable automatic cleanup (parameters are deleted 30 days after being marked obsolete)
huginbot cleanup auto-enable

# Change the days threshold
huginbot cleanup auto-enable --days 7

# Disable automatic cleanup
huginbot cleanup auto-disable

# Run automatic cleanup manually
huginbot cleanup auto-run
```

Parameters are marked obsolete when:
- A world is deleted
- A Discord server is unlinked
- Manually marked using the CLI
```

## Conclusion

This implementation plan provides a comprehensive approach to managing SSM parameters in the HuginBot application. By tracking parameter creation, marking obsolete parameters, and providing both automatic and manual cleanup mechanisms, the application can ensure that SSM parameters are well-managed and do not accumulate over time.

The plan includes:
1. A tracking system to record all parameters
2. Functions to mark parameters as obsolete
3. Commands to scan for and clean up parameters
4. Automatic cleanup of parameters after a configurable time period
5. Integration with existing HuginBot workflows
6. Testing and deployment instructions

This approach ensures that the application remains well-organized and doesn't hit SSM Parameter Store limits, while providing full visibility and control over the parameter lifecycle.