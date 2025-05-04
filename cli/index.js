#!/usr/bin/env node

/**
 * HuginBot CLI - Main Entry Point
 * This is the main CLI entry point that uses Commander.js to handle
 * command line arguments and dispatch to the appropriate modules.
 */

// Check for obsolete parameters and run auto-cleanup if enabled
try {
  const { runAutoCleanup } = require('./utils/auto-cleanup');
  runAutoCleanup(true); // silent mode
} catch (error) {
  // Ignore errors during auto-cleanup
}

const { program } = require('commander');
const chalk = require('chalk');
const figlet = require('figlet');
const { loadESMDependencies } = require('./utils/esm-loader');

// Import command modules
const deployCommands = require('./commands/deploy');
const serverCommands = require('./commands/server');
const worldsCommands = require('./commands/worlds');
const backupCommands = require('./commands/backup');
const discordCommands = require('./commands/discord');
const testingCommands = require('./commands/testing');
const cleanupCommands = require('./commands/cleanup');

// Import wizard
const { runSetupWizard } = require('./wizard');

// Import interactive mode
const interactive = require('./interactive');

/**
 * Initialize CLI with ESM dependencies preloaded
 */
async function initializeCLI() {
  try {
    // Preload ESM dependencies for better performance
    await loadESMDependencies();
    
    // Display ASCII art header
    // Raven artwork (from JPEG converted to ASCII)
    console.log(chalk.blue(`
                 **#%                       
               #@@@*%@@%                    
            -@@@@@@@@@@@##%%              %%
                 #@@@@%*@*%%#%###%##% %#    
                 +*%%@*@%###@%%%#%###*#+    
                  #*@%%@@@@@@@%@@@@@%%%%    
                   %@%%@@%@@@@@@%%%      %% 
                     =%@@@@@@@@             
                        @@ @@@              
                        %@ @@@              
                       #@  %@               
                       +   +                
                   *#%+@#@#%%               
                   @# % @ % #               
                      @   @ %                                             
    `));

    console.log(chalk.cyan(`
   ▄█    █▄    ███    █▄     ▄██████▄   ▄█  ███▄▄▄▄   ▀█████████▄   ▄██████▄      ███     
  ███    ███   ███    ███   ███    ███ ███  ███▀▀▀██▄   ███    ███ ███    ███ ▀█████████▄ 
  ███    ███   ███    ███   ███    █▀  ███▌ ███   ███   ███    ███ ███    ███    ▀███▀▀██ 
 ▄███▄▄▄▄███▄▄ ███    ███  ▄███        ███▌ ███   ███  ▄███▄▄▄██▀  ███    ███     ███   ▀ 
▀▀███▀▀▀▀███▀  ███    ███ ▀▀███ ████▄  ███▌ ███   ███ ▀▀███▀▀▀██▄  ███    ███     ███     
  ███    ███   ███    ███   ███    ███ ███  ███   ███   ███    ██▄ ███    ███     ███     
  ███    ███   ███    ███   ███    ███ ███  ███   ███   ███    ███ ███    ███     ███     
  ███    █▀    ████████▀    ████████▀  █▀    ▀█   █▀  ▄█████████▀   ▀██████▀     ▄████▀
    `));

    program
      .version('1.0.0')
      .description('HuginBot - Valheim Server Manager');

    // Add "Get Started" command
    program
      .command('setup')
      .description('Start the guided setup process')
      .action(runSetupWizard);

    // Register command groups
    deployCommands.register(program);
    serverCommands.register(program);
    worldsCommands.register(program);
    backupCommands.register(program);
    discordCommands.register(program);
    testingCommands.register(program);
    cleanupCommands.register(program);

    // Add interactive mode
    program
      .command('interactive', { isDefault: true })
      .description('Start interactive menu')
      .action(() => {
        interactive();
      });

    // Parse arguments
    program.parse(process.argv);
  } catch (error) {
    console.error('Failed to initialize CLI:', error);
    process.exit(1);
  }
}

// Start the CLI
initializeCLI().catch(console.error);