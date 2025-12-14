#!/usr/bin/env node

/**
 * Discord Slash Commands Registration
 * This script registers all HuginBot slash commands with Discord
 */

const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const { 
  DISCORD_COMMANDS, 
  getRegisteredCommands, 
  compareCommands 
} = require('./lib/discord-commands');
require('dotenv').config();

// Use the shared command definitions
const commands = DISCORD_COMMANDS;

async function registerCommands() {
  // Check required environment variables
  const appId = process.env.DISCORD_APP_ID;
  const botToken = process.env.DISCORD_BOT_SECRET_TOKEN;
  
  if (!appId) {
    console.error('❌ DISCORD_APP_ID not found in environment variables');
    console.log('Make sure your .env file contains DISCORD_APP_ID');
    process.exit(1);
  }
  
  if (!botToken) {
    console.error('❌ DISCORD_BOT_SECRET_TOKEN not found in environment variables');
    console.log('Make sure your .env file contains DISCORD_BOT_SECRET_TOKEN');
    process.exit(1);
  }

  // Setup REST API client
  const rest = new REST({ version: '10' }).setToken(botToken);

  try {
    console.log('🔄 Registering slash commands with Discord...');
    console.log(`📋 Registering ${commands.length} commands: ${commands.map(c => `/${c.name}`).join(', ')}`);

    // Register commands globally (takes up to 1 hour to propagate)
    await rest.put(
      Routes.applicationCommands(appId),
      { body: commands }
    );

    console.log('✅ Commands registered successfully!');
    console.log('');
    console.log('📝 Next steps:');
    console.log('1. Commands may take up to 1 hour to appear in Discord');
    console.log('2. Make sure your bot has been added to your Discord server');
    console.log('3. Ensure your Discord endpoint URL is set in Discord Developer Portal');
    console.log('4. Use /setup in a Discord channel to configure notifications');
    console.log('');
    console.log('🔗 Bot invite URL (if needed):');
    console.log(`https://discord.com/api/oauth2/authorize?client_id=${appId}&permissions=536871936&scope=bot%20applications.commands`);
    
  } catch (error) {
    console.error('❌ Failed to register Discord commands:', error);
    
    if (error.status === 401) {
      console.log('Check that your DISCORD_BOT_SECRET_TOKEN is correct');
    } else if (error.status === 400) {
      console.log('Check that your DISCORD_APP_ID is correct');
    }
    
    process.exit(1);
  }
}

async function checkRegisteredCommands() {
  // Check required environment variables
  const appId = process.env.DISCORD_APP_ID;
  const botToken = process.env.DISCORD_BOT_SECRET_TOKEN;
  
  if (!appId || !botToken) {
    console.error('❌ Missing Discord credentials in .env file');
    process.exit(1);
  }

  try {
    console.log('🔍 Checking registered Discord commands...');
    
    const registeredCommands = await getRegisteredCommands(appId, botToken);
    const comparison = compareCommands(DISCORD_COMMANDS, registeredCommands);
    
    console.log('\n📊 Command Status:');
    console.log(`Local commands: ${comparison.local.length}`);
    console.log(`Registered commands: ${comparison.registered.length}`);
    
    if (comparison.inSync) {
      console.log('✅ Commands are in sync!');
    } else {
      console.log('⚠️  Commands are out of sync');
    }
    
    if (comparison.matching.length > 0) {
      console.log(`\n✅ Registered (${comparison.matching.length}):`);
      comparison.matching.forEach(name => console.log(`  /${name}`));
    }
    
    if (comparison.missing.length > 0) {
      console.log(`\n❌ Missing from Discord (${comparison.missing.length}):`);
      comparison.missing.forEach(name => console.log(`  /${name}`));
    }
    
    if (comparison.extra.length > 0) {
      console.log(`\n🔶 Extra in Discord (${comparison.extra.length}):`);
      comparison.extra.forEach(name => console.log(`  /${name}`));
    }
    
    console.log('\n📝 Detailed registered commands:');
    registeredCommands.forEach(cmd => {
      console.log(`  /${cmd.name} - ${cmd.description}`);
    });
    
  } catch (error) {
    console.error('❌ Failed to check registered commands:', error.message);
    process.exit(1);
  }
}

// Handle command line arguments
const args = process.argv.slice(2);
if (args.includes('--check') || args.includes('-c')) {
  checkRegisteredCommands();
} else if (args.includes('--help') || args.includes('-h')) {
  console.log('Discord Commands Management');
  console.log('');
  console.log('Usage:');
  console.log('  npm run register-commands          Register commands with Discord');
  console.log('  npm run register-commands --check  Check what commands are registered');
  console.log('  npm run register-commands --help   Show this help');
} else {
  registerCommands();
}