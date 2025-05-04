/**
 * worlds.js - HuginBot CLI world management commands
 * 
 * Handles world creation, deletion, and configuration
 */
const inquirer = require('inquirer');
const ora = require('ora');
const chalk = require('chalk');
const boxen = require('boxen');
const { getConfig, saveConfig, getWorldConfig, saveWorldConfig } = require('../utils/config');
const { 
  getInstanceStatus, 
  createBackup, 
  restartServer, 
  updateActiveWorld,
  getServerAddress,
  getActiveWorldFromSSM
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

  worlds
    .command('current')
    .description('Show current active world')
    .action(showCurrentWorld);
  
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
    const activeWorld = await getActiveWorldFromSSM();
    return activeWorld;
  } catch (error) {
    console.log(chalk.yellow('⚠️  Could not retrieve active world: ' + error.message));
    return { name: "Unknown" };
  }
}

// List all available worlds
async function listWorlds() {
  const config = getConfig();
  
  if (!config.worlds || config.worlds.length === 0) {
    console.log(chalk.yellow('No worlds configured'));
    console.log('Add a world with: ' + chalk.cyan('huginbot worlds add'));
    return;
  }
  
  console.log(chalk.cyan.bold('\n📋 Available Worlds:'));
  
  // Get active world to highlight it
  let activeWorld = "Unknown";
  try {
    const currentWorld = await getCurrentWorld();
    activeWorld = currentWorld.name;
  } catch (error) {
    // Ignore error, just don't highlight any world
  }
  
  // Header
  console.log(`${chalk.bold('#')}  ${chalk.bold('Name'.padEnd(20))} ${chalk.bold('Valheim Name'.padEnd(15))} ${chalk.bold('Last Played')}`);
  console.log('-'.repeat(60));
  
  config.worlds.forEach((world, index) => {
    const isActive = world.name === activeWorld;
    const prefix = isActive ? chalk.green('✓ ') : '  ';
    const worldName = isActive ? chalk.green(world.name.padEnd(20)) : world.name.padEnd(20);
    const valheimName = isActive ? chalk.green(world.worldName.padEnd(15)) : world.worldName.padEnd(15);
    const lastPlayed = "Unknown"; // We'll implement this later
    
    console.log(`${prefix}${index + 1}. ${worldName} ${valheimName} ${lastPlayed}`);
  });
  
  console.log('');
}

// Show detailed info about the current world
async function showCurrentWorld() {
  try {
    const currentWorld = await getCurrentWorld();
    
    if (currentWorld.name === "Unknown") {
      console.log(chalk.yellow('⚠️  No active world set or could not retrieve active world.'));
      return;
    }
    
    const status = await getInstanceStatus();
    const address = status === 'running' ? await getServerAddress() : 'Server not running';
    
    console.log(boxen(
      chalk.bold(`🌍 Current Active World: ${chalk.green(currentWorld.name)} 🌍\n\n`) +
      `Valheim World Name: ${chalk.cyan(currentWorld.worldName)}\n` +
      `Server Password: ${chalk.cyan('*'.repeat(currentWorld.serverPassword.length))}\n` +
      `Discord Server: ${chalk.cyan(currentWorld.discordServerId || 'None')}\n` +
      `Last Played: ${chalk.cyan(await getLastPlayedDate(currentWorld.name))}\n` +
      `Server Status: ${status === 'running' ? chalk.green('RUNNING') : chalk.yellow(status.toUpperCase())}\n` +
      `Join Address: ${status === 'running' ? chalk.green(address) : chalk.gray('N/A')}`,
      { padding: 1, margin: 1, borderStyle: 'round', borderColor: 'green' }
    ));
    
    if (status !== 'running') {
      console.log(chalk.yellow('⚠️  Server is not running. Start it with:'));
      console.log(chalk.cyan('  huginbot server start'));
    }
  } catch (error) {
    console.error(chalk.red('Error retrieving current world:'), error.message);
  }
}

// Add a new world
async function addWorld() {
  const config = getConfig();
  
  console.log(chalk.cyan.bold('\n📋 Add New World:'));
  console.log('This will create a new world configuration. The world will not be active until you switch to it.');
  
  const newWorld = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Display name for the world:',
      validate: (input) => {
        if (input.trim() === '') return 'Name cannot be empty';
        
        // Check for duplicate names
        if (config.worlds && config.worlds.some(w => w.name === input)) {
          return 'A world with this name already exists';
        }
        
        return true;
      }
    },
    {
      type: 'input',
      name: 'worldName',
      message: 'Valheim world name (used in-game):',
      validate: (input) => {
        if (input.trim() === '') return 'World name cannot be empty';
        
        // Check for duplicate Valheim world names
        if (config.worlds && config.worlds.some(w => w.worldName === input)) {
          return 'A world with this Valheim name already exists';
        }
        
        return true;
      }
    },
    {
      type: 'password',
      name: 'serverPassword',
      message: 'Server password (min 5 characters):',
      validate: (input) => input.trim().length >= 5 ? true : 'Password must be at least 5 characters'
    },
    {
      type: 'input',
      name: 'discordServerId',
      message: 'Discord Server ID (optional):',
    },
    {
      type: 'input',
      name: 'adminIds',
      message: 'Admin Steam IDs (space separated, optional):',
      validate: (input) => {
        if (input.trim() === '') return true;
        const ids = input.split(' ');
        const validIds = ids.every(id => /^\d+$/.test(id.trim()));
        return validIds ? true : 'Steam IDs should be numeric values';
      }
    }
  ]);
  
  config.worlds = config.worlds || [];
  config.worlds.push(newWorld);
  saveConfig(config);
  
  console.log(chalk.green(`✅ World "${newWorld.name}" added successfully`));
  
  // Ask if the user wants to switch to this world
  const { switchToNew } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'switchToNew',
      message: 'Do you want to switch to this world now?',
      default: true
    }
  ]);
  
  if (switchToNew) {
    await switchWorld(newWorld.name);
  } else {
    console.log(chalk.yellow(`World "${newWorld.name}" is available but not active.`));
    console.log(`Switch to it later with: ${chalk.cyan('huginbot worlds switch')}`);
  }
}

// Edit a world
async function editWorld(worldName) {
  const config = getConfig();
  
  if (!config.worlds || config.worlds.length === 0) {
    console.log(chalk.yellow('No worlds configured'));
    console.log('Add a world with: ' + chalk.cyan('huginbot worlds add'));
    return;
  }
  
  let worldToEditIndex;
  
  // If a specific world name was provided as an argument
  if (worldName && typeof worldName === 'string') {
    worldToEditIndex = config.worlds.findIndex(w => w.name === worldName);
    if (worldToEditIndex === -1) {
      console.log(chalk.red(`World "${worldName}" not found`));
      return;
    }
  } else {
    // Otherwise, prompt the user to select a world
    const { selectedWorld } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedWorld',
        message: 'Select world to edit:',
        choices: config.worlds.map((world, index) => ({
          name: `${world.name} (${world.worldName})`,
          value: index
        }))
      }
    ]);
    
    worldToEditIndex = selectedWorld;
  }
  
  const world = config.worlds[worldToEditIndex];
  
  console.log(chalk.cyan.bold(`\n📋 Editing World: ${world.name}`));
  
  const editedWorld = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Display name for the world:',
      default: world.name,
      validate: (input) => {
        if (input.trim() === '') return 'Name cannot be empty';
        
        // Check for duplicate names, but allow keeping the same name
        if (input !== world.name && config.worlds.some(w => w.name === input)) {
          return 'A world with this name already exists';
        }
        
        return true;
      }
    },
    {
      type: 'input',
      name: 'worldName',
      message: 'Valheim world name (used in-game):',
      default: world.worldName,
      validate: (input) => {
        if (input.trim() === '') return 'World name cannot be empty';
        
        // Check for duplicate Valheim world names, but allow keeping the same name
        if (input !== world.worldName && config.worlds.some(w => w.worldName === input)) {
          return 'A world with this Valheim name already exists';
        }
        
        return true;
      }
    },
    {
      type: 'password',
      name: 'serverPassword',
      message: 'Server password (min 5 characters):',
      default: world.serverPassword,
      validate: (input) => input.trim().length >= 5 ? true : 'Password must be at least 5 characters'
    },
    {
      type: 'input',
      name: 'discordServerId',
      message: 'Discord Server ID (optional):',
      default: world.discordServerId
    },
    {
      type: 'input',
      name: 'adminIds',
      message: 'Admin Steam IDs (space separated, optional):',
      default: world.adminIds,
      validate: (input) => {
        if (input.trim() === '') return true;
        const ids = input.split(' ');
        const validIds = ids.every(id => /^\d+$/.test(id.trim()));
        return validIds ? true : 'Steam IDs should be numeric values';
      }
    }
  ]);
  
  config.worlds[worldToEditIndex] = editedWorld;
  saveConfig(config);
  
  console.log(chalk.green(`✅ World "${editedWorld.name}" updated successfully`));
  
  // Check if this is the active world and ask if the user wants to update it
  try {
    const currentWorld = await getCurrentWorld();
    if (currentWorld.name === world.name) {
      console.log(chalk.yellow('⚠️  This is the currently active world.'));
      
      const { updateActive } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'updateActive',
          message: 'Update the active world configuration with these changes?',
          default: true
        }
      ]);
      
      if (updateActive) {
        const spinner = ora('Updating active world configuration...').start();
        try {
          await updateActiveWorld(editedWorld);
          spinner.succeed('Active world configuration updated');
          
          const { restartNow } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'restartNow',
              message: 'Restart the server to apply changes now?',
              default: false
            }
          ]);
          
          if (restartNow) {
            // Restart the server
            spinner.text = 'Restarting the server...';
            spinner.start();
            try {
              await restartServer();
              spinner.succeed('Server restarted successfully');
            } catch (error) {
              spinner.fail('Failed to restart server');
              console.error(chalk.red('Error:'), error.message);
            }
          } else {
            console.log(chalk.yellow('Changes will apply next time the server is started.'));
          }
        } catch (error) {
          spinner.fail('Failed to update active world configuration');
          console.error(chalk.red('Error:'), error.message);
        }
      }
    }
  } catch (error) {
    // Ignore errors when checking active world
  }
}

// Remove a world
async function removeWorld(worldName) {
  const config = getConfig();
  
  if (!config.worlds || config.worlds.length === 0) {
    console.log(chalk.yellow('No worlds configured'));
    return;
  }
  
  let worldToRemoveIndex;
  
  // If a specific world name was provided as an argument
  if (worldName && typeof worldName === 'string') {
    worldToRemoveIndex = config.worlds.findIndex(w => w.name === worldName);
    if (worldToRemoveIndex === -1) {
      console.log(chalk.red(`World "${worldName}" not found`));
      return;
    }
  } else {
    // Otherwise, prompt the user to select a world
    const { selectedWorld } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedWorld',
        message: 'Select world to remove:',
        choices: config.worlds.map((world, index) => ({
          name: `${world.name} (${world.worldName})`,
          value: index
        }))
      }
    ]);
    
    worldToRemoveIndex = selectedWorld;
  }
  
  const worldToRemove = config.worlds[worldToRemoveIndex];
  
  // Check if this is the active world
  try {
    const currentWorld = await getCurrentWorld();
    if (currentWorld.name === worldToRemove.name) {
      console.log(chalk.red('⚠️  This is the currently active world!'));
      console.log(chalk.red('    You must switch to another world before removing this one.'));
      
      if (config.worlds.length > 1) {
        console.log(chalk.yellow('Switch to another world first with:'));
        console.log(chalk.cyan('  huginbot worlds switch'));
      } else {
        console.log(chalk.yellow('Add another world first with:'));
        console.log(chalk.cyan('  huginbot worlds add'));
      }
      
      return;
    }
  } catch (error) {
    // Continue even if we can't check the active world
  }
  
  // Confirm with user before removing
  const { confirmRemove } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmRemove',
      message: chalk.red(`Are you sure you want to remove "${worldToRemove.name}"?`),
      default: false
    }
  ]);
  
  if (!confirmRemove) {
    console.log(chalk.yellow('❌ World removal cancelled.'));
    return;
  }
  
  // Double-confirm for safety
  const { confirmAgain } = await inquirer.prompt([
    {
      type: 'input',
      name: 'confirmAgain',
      message: chalk.red(`Type the world name "${worldToRemove.name}" to confirm deletion:`),
      validate: (input) => input === worldToRemove.name ? true : 'World name does not match'
    }
  ]);
  
  const removedWorld = config.worlds.splice(worldToRemoveIndex, 1)[0];
  saveConfig(config);
  
  // Mark associated parameters as obsolete
  const { markParameterObsolete } = require('../utils/parameter-tracker');
  
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

// Switch active world
async function switchWorld(worldName) {
  const config = getConfig();
  
  if (!config.worlds || config.worlds.length === 0) {
    console.log(chalk.yellow('No worlds configured'));
    console.log('Add a world with: ' + chalk.cyan('huginbot worlds add'));
    return;
  }
  
  let selectedWorld;
  
  // If a world name was provided as an argument
  if (worldName && typeof worldName === 'string') {
    selectedWorld = config.worlds.find(w => w.name === worldName);
    if (!selectedWorld) {
      console.log(chalk.red(`World "${worldName}" not found`));
      return;
    }
  } else {
    // Get last played dates to display in the selection list
    const worldChoices = await Promise.all(config.worlds.map(async (world, index) => {
      const lastPlayed = await getLastPlayedDate(world.name);
      return {
        name: `${world.name} (${world.worldName}) - Last played: ${lastPlayed}`,
        value: world
      };
    }));
    
    const result = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedWorld',
        message: 'Select world to activate:',
        choices: worldChoices
      }
    ]);
    
    selectedWorld = result.selectedWorld;
  }
  
  // Check if we're already on this world
  try {
    const currentWorld = await getCurrentWorld();
    if (currentWorld.name === selectedWorld.name) {
      console.log(chalk.green(`✅ World "${selectedWorld.name}" is already active!`));
      return;
    }
  } catch (error) {
    // Continue even if we can't check the active world
  }
  
  // Confirm if server is running
  const spinner = ora('Checking server status...').start();
  const status = await getInstanceStatus();
  spinner.succeed(`Server status: ${status}`);
  
  if (status === 'running') {
    console.log(chalk.yellow(`⚠️  Server is currently running with world: ${(await getCurrentWorld()).name}`));
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
    
    // Update local config
    config.activeWorld = selectedWorld.name;
    saveConfig(config);
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
  switchWorld,
  showCurrentWorld,
  getCurrentWorld,
  getLastPlayedDate
};