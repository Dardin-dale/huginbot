/**
 * server.js - HuginBot CLI server commands
 * 
 * Manages Valheim server operations
 */
const inquirer = require('inquirer');
const ora = require('ora');
const chalk = require('chalk');
const boxen = require('boxen');
const { getConfig } = require('../utils/config');
const {
  getInstanceStatus,
  startEC2Instance,
  stopEC2Instance,
  getServerAddress,
  waitForServerReady,
  getAutoShutdownConfig,
  setAutoShutdownConfig
} = require('../utils/aws');

// Command group registration
function register(program) {
  const server = program
    .command('server')
    .description('Manage Valheim server');
  
  server
    .command('start')
    .description('Start the Valheim server')
    .action(startServer);
  
  server
    .command('stop')
    .description('Stop the Valheim server')
    .action(stopServer);
  
  server
    .command('status')
    .description('Check server status')
    .action(getServerStatus);
  
  server
    .command('address')
    .description('Get server address')
    .action(showServerAddress);

  server
    .command('info')
    .description('Show detailed server information')
    .action(showServerInfo);

  server
    .command('auto-shutdown <value>')
    .description('Configure auto-shutdown (minutes or "off")')
    .action(setAutoShutdown);

  server
    .command('get-auto-shutdown')
    .description('Get current auto-shutdown configuration')
    .action(getAutoShutdown);

  return server;
}

// Start the Valheim server
async function startServer() {
  const config = getConfig();
  
  if (!config.instanceId) {
    console.log(chalk.yellow('❌ Server not deployed. Deploy it first with:'));
    console.log(chalk.cyan('  huginbot deploy valheim'));
    return;
  }
  
  const spinner = ora('Checking server status...').start();
  const status = await getInstanceStatus();
  spinner.succeed(`Server status: ${status}`);
  
  if (status === 'running') {
    console.log(chalk.green('✅ Server is already running!'));
    console.log(`   Join address: ${await getServerAddress()}`);
    return;
  }
  
  if (status === 'stopping') {
    console.log(chalk.yellow('⚠️  Server is currently stopping. Please wait a moment and try again.'));
    return;
  }
  
  spinner.text = 'Starting server...';
  spinner.start();
  
  try {
    await startEC2Instance();
    spinner.succeed('Server instance started');
    
    // Wait for server to initialize
    spinner.text = 'Waiting for Valheim server to initialize...';
    spinner.start();
    
    await waitForServerReady();
    
    spinner.succeed('Valheim server is ready!');
    
    const address = await getServerAddress();
    console.log(boxen(
      chalk.bold(`🎮 Server Started! 🎮\n\n`) +
      `Join Address: ${chalk.green(address)}\n` +
      `Active World: ${chalk.green(config.activeWorld || 'Default')}\n\n` +
      `${chalk.yellow('Note: It may take a few minutes for the server to appear in the server list.')}`,
      { padding: 1, margin: 1, borderStyle: 'round', borderColor: 'green' }
    ));
  } catch (error) {
    spinner.fail('Failed to start server');
    console.error(chalk.red('Error:'), error.message);
  }
}

// Stop the Valheim server
async function stopServer() {
  const config = getConfig();
  
  if (!config.instanceId) {
    console.log(chalk.yellow('❌ Server not deployed. Nothing to stop.'));
    return;
  }
  
  const spinner = ora('Checking server status...').start();
  const status = await getInstanceStatus();
  spinner.succeed(`Server status: ${status}`);
  
  if (status === 'stopped') {
    console.log(chalk.green('✅ Server is already stopped!'));
    return;
  }
  
  if (status === 'stopping') {
    console.log(chalk.yellow('⚠️  Server is already in the process of stopping.'));
    return;
  }
  
  if (status === 'pending') {
    console.log(chalk.yellow('⚠️  Server is still starting up. Let it finish before stopping.'));
    return;
  }
  
  // Confirm with user before stopping
  const { confirmStop } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmStop',
      message: 'Are you sure you want to stop the server? All players will be disconnected.',
      default: false
    }
  ]);
  
  if (!confirmStop) {
    console.log(chalk.yellow('❌ Server stop cancelled.'));
    return;
  }
  
  spinner.text = 'Stopping server...';
  spinner.start();
  
  try {
    await stopEC2Instance();
    spinner.succeed('Server stop command sent');
    
    console.log(chalk.yellow('⚠️  The server is shutting down, which may take a few minutes.'));
    console.log(chalk.yellow('   A backup will automatically be created during shutdown.'));
    console.log(chalk.green('✅ You can check the status later with:'));
    console.log(chalk.cyan('   huginbot server status'));
  } catch (error) {
    spinner.fail('Failed to stop server');
    console.error(chalk.red('Error:'), error.message);
  }
}

// Check server status
async function getServerStatus() {
  const config = getConfig();
  
  if (!config.instanceId) {
    console.log(chalk.yellow('❌ Server not deployed. Deploy it first with:'));
    console.log(chalk.cyan('  huginbot deploy valheim'));
    return;
  }
  
  const spinner = ora('Checking server status...').start();
  
  try {
    const status = await getInstanceStatus();
    let statusText;
    let statusColor;
    
    switch (status) {
      case 'running':
        statusText = 'RUNNING';
        statusColor = 'green';
        break;
      case 'stopped':
        statusText = 'STOPPED';
        statusColor = 'red';
        break;
      case 'pending':
        statusText = 'STARTING';
        statusColor = 'yellow';
        break;
      case 'stopping':
        statusText = 'STOPPING';
        statusColor = 'yellow';
        break;
      case 'shutting-down':
        statusText = 'SHUTTING DOWN';
        statusColor = 'yellow';
        break;
      case 'terminated':
        statusText = 'TERMINATED';
        statusColor = 'red';
        break;
      default:
        statusText = status.toUpperCase();
        statusColor = 'gray';
    }
    
    spinner.succeed(`Server status: ${chalk[statusColor](statusText)}`);
    
    if (status === 'running') {
      const address = await getServerAddress();
      console.log(`Join Address: ${chalk.green(address)}`);
      console.log(`Active World: ${chalk.green(config.activeWorld || 'Default')}`);
    }
  } catch (error) {
    spinner.fail('Failed to get server status');
    console.error(chalk.red('Error:'), error.message);
  }
}

// Get server address
async function showServerAddress() {
  const config = getConfig();
  
  if (!config.instanceId) {
    console.log(chalk.yellow('❌ Server not deployed. Deploy it first with:'));
    console.log(chalk.cyan('  huginbot deploy valheim'));
    return;
  }
  
  const spinner = ora('Getting server address...').start();
  
  try {
    const status = await getInstanceStatus();
    
    if (status !== 'running') {
      spinner.fail(`Server is not running (status: ${status})`);
      console.log(chalk.yellow('⚠️  Start the server first with:'));
      console.log(chalk.cyan('  huginbot server start'));
      return;
    }
    
    const address = await getServerAddress();
    spinner.succeed('Server is running');
    
    console.log(boxen(
      chalk.bold(`🎮 Server Connection Info 🎮\n\n`) +
      `Join Address: ${chalk.green(address)}\n` +
      `Active World: ${chalk.green(config.activeWorld || 'Default')}`,
      { padding: 1, margin: 1, borderStyle: 'round', borderColor: 'green' }
    ));
  } catch (error) {
    spinner.fail('Failed to get server address');
    console.error(chalk.red('Error:'), error.message);
  }
}

// Show detailed server info
async function showServerInfo() {
  const config = getConfig();
  
  if (!config.instanceId) {
    console.log(chalk.yellow('❌ Server not deployed. Deploy it first with:'));
    console.log(chalk.cyan('  huginbot deploy valheim'));
    return;
  }
  
  const spinner = ora('Gathering server information...').start();
  
  try {
    const status = await getInstanceStatus(true); // Get detailed status
    spinner.succeed('Retrieved server information');
    
    // Format the status data into a nice display
    let displayInfo = [
      `${chalk.cyan('Instance ID:')} ${config.instanceId}`,
      `${chalk.cyan('Instance Type:')} ${config.instanceType}`,
      `${chalk.cyan('Status:')} ${getStatusColor(status.state)}`,
      `${chalk.cyan('Region:')} ${config.region || 'us-west-2'}`,
      `${chalk.cyan('Deployed At:')} ${config.deployedAt || 'Unknown'}`
    ];
    
    if (status.state === 'running') {
      const address = await getServerAddress();
      displayInfo.push(`${chalk.cyan('Public Address:')} ${address}`);
      displayInfo.push(`${chalk.cyan('Active World:')} ${config.activeWorld || 'Default'}`);
      displayInfo.push(`${chalk.cyan('Server Name:')} ${config.serverName || 'Valheim Server'}`);
      
      // Try to get player count if available
      if (status.playerCount !== undefined) {
        displayInfo.push(`${chalk.cyan('Online Players:')} ${status.playerCount}`);
      }
    }
    
    console.log(boxen(
      chalk.bold(`🖥️  Server Information 🖥️\n\n`) +
      displayInfo.join('\n'),
      { padding: 1, margin: 1, borderStyle: 'round', borderColor: 'blue' }
    ));
    
    if (status.state === 'stopped') {
      console.log(chalk.yellow('⚠️  Server is currently stopped.'));
      console.log(chalk.yellow('   Start it with:'));
      console.log(chalk.cyan('   huginbot server start'));
    }
  } catch (error) {
    spinner.fail('Failed to get server information');
    console.error(chalk.red('Error:'), error.message);
  }
}

// Helper function to colorize status
function getStatusColor(status) {
  switch (status) {
    case 'running':
      return chalk.green('RUNNING');
    case 'stopped':
      return chalk.red('STOPPED');
    case 'pending':
      return chalk.yellow('STARTING');
    case 'stopping':
      return chalk.yellow('STOPPING');
    case 'shutting-down':
      return chalk.yellow('SHUTTING DOWN');
    case 'terminated':
      return chalk.red('TERMINATED');
    default:
      return chalk.gray(status.toUpperCase());
  }
}

// Get current auto-shutdown configuration
async function getAutoShutdown() {
  const spinner = ora('Getting auto-shutdown configuration...').start();

  try {
    const config = await getAutoShutdownConfig();
    spinner.succeed('Retrieved auto-shutdown configuration');

    console.log(chalk.bold('\n🔧 Auto-Shutdown Configuration'));
    console.log(chalk.gray('═══════════════════════════════\n'));

    if (config === 'off' || config === 'disabled') {
      console.log(`${chalk.cyan('Status:')} ${chalk.red('DISABLED')}`);
      console.log(`\n${chalk.yellow('⚠  The server will NOT automatically shut down when idle.')}`);
    } else {
      console.log(`${chalk.cyan('Status:')} ${chalk.green('ENABLED')}`);
      console.log(`${chalk.cyan('Timeout:')} ${chalk.green(config + ' minutes')}`);
      console.log(`\n${chalk.yellow('⏲  The server will shut down after ' + config + ' minutes of inactivity.')}`);
    }
    console.log('');
  } catch (error) {
    spinner.fail('Failed to get auto-shutdown configuration');
    console.error(chalk.red('Error:'), error.message);
  }
}

// Set auto-shutdown configuration
async function setAutoShutdown(value) {
  const spinner = ora('Setting auto-shutdown configuration...').start();

  try {
    await setAutoShutdownConfig(value);
    spinner.succeed('Auto-shutdown configuration updated');

    console.log(chalk.bold('\n✅ Auto-Shutdown Updated!'));
    console.log(chalk.gray('═══════════════════════════\n'));

    if (value === 'off' || value === 'disabled') {
      console.log(chalk.bold.red('Status: DISABLED'));
      console.log(`\n${chalk.yellow('⚠  The server will no longer automatically shut down when idle.')}`);
      console.log(chalk.yellow('⚠  Make sure to manually stop the server to avoid unnecessary AWS charges.'));
    } else {
      console.log(chalk.bold.green('Status: ENABLED'));
      console.log(`${chalk.cyan('Timeout:')} ${chalk.green(value + ' minutes')}`);
      console.log(`\n${chalk.yellow('⏲  The server will now shut down after ' + value + ' minutes of inactivity.')}`);
    }

    console.log(chalk.cyan('\n💡 Note: This change will take effect the next time the server starts.\n'));
  } catch (error) {
    spinner.fail('Failed to set auto-shutdown configuration');
    console.error(chalk.red('Error:'), error.message);
  }
}

module.exports = {
  register,
  startServer,
  stopServer,
  getServerStatus,
  showServerAddress,
  showServerInfo,
  getAutoShutdown,
  setAutoShutdown
};