/**
 * HuginBot CLI - Configuration Management
 * This module handles configuration storage and retrieval
 * Updated to prioritize .env configuration
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const Conf = require('conf');
require('dotenv').config(); // Load environment variables from .env

// Create config directory if it doesn't exist
const configDir = path.join(os.homedir(), '.huginbot');
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

// Parse WORLD_CONFIGURATIONS from .env if available
function parseWorldsFromEnv() {
  const worldConfigs = [];
  
  if (process.env.WORLD_CONFIGURATIONS) {
    // Format is World1,123456789012345678,Midgard,password1;World2,876543210987654321,Asgard,password2
    const worlds = process.env.WORLD_CONFIGURATIONS.split(';');
    
    worlds.forEach(worldString => {
      const [name, discordServerId, worldName, serverPassword] = worldString.split(',');
      if (name && worldName && serverPassword) {
        worldConfigs.push({
          name,
          discordServerId,
          worldName,
          serverPassword,
          adminIds: process.env.VALHEIM_ADMIN_IDS || ''
        });
      }
    });
  }
  
  return worldConfigs;
}

// Initialize Discord config from .env if available
function getDiscordConfigFromEnv() {
  const discordConfig = {
    appId: process.env.DISCORD_APP_ID || '',
    publicKey: process.env.DISCORD_BOT_PUBLIC_KEY || '',
    botToken: process.env.DISCORD_BOT_SECRET_TOKEN || '',
    configured: !!(process.env.DISCORD_APP_ID && process.env.DISCORD_BOT_SECRET_TOKEN),
    deployed: false,
    deployedAt: '',
    commandPrefix: '!',
    useSlashCommands: true
  };
  
  return discordConfig;
}

// Initialize configuration store
const config = new Conf({
  cwd: configDir,
  configName: 'config',
  schema: {
    // AWS Configuration
    awsRegion: {
      type: 'string',
      default: process.env.AWS_REGION || 'us-west-2'
    },
    awsProfile: {
      type: 'string',
      default: process.env.AWS_PROFILE || 'default'
    },
    awsAccountId: {
      type: 'string',
      default: ''
    },
    
    // Server Configuration
    serverName: {
      type: 'string',
      default: process.env.VALHEIM_SERVER_NAME || 'ValheimServer'
    },
    worldName: {
      type: 'string',
      default: process.env.VALHEIM_WORLD_NAME || 'ValheimWorld'
    },
    serverPassword: {
      type: 'string',
      default: process.env.VALHEIM_SERVER_PASSWORD || 'valheim'
    },
    adminIds: {
      type: 'string',
      default: process.env.VALHEIM_ADMIN_IDS || ''
    },
    serverArgs: {
      type: 'string',
      default: process.env.VALHEIM_SERVER_ARGS || '-crossplay'
    },
    bepInExEnabled: {
      type: 'boolean',
      default: process.env.VALHEIM_BEPINEX === 'true' || true
    },
    updateIfIdle: {
      type: 'boolean',
      default: process.env.VALHEIM_UPDATE_IF_IDLE === 'true' || false
    },
    instanceType: {
      type: 'string',
      default: process.env.VALHEIM_INSTANCE_TYPE || 't3.medium'
    },
    instanceId: {
      type: 'string',
      default: ''
    },
    publicIp: {
      type: 'string',
      default: ''
    },
    deployedAt: {
      type: 'string',
      default: ''
    },
    activeWorld: {
      type: 'string',
      default: ''
    },
    
    // Backup Configuration
    backupBucket: {
      type: 'string',
      default: ''
    },
    backupsToKeep: {
      type: 'number',
      default: parseInt(process.env.BACKUPS_TO_KEEP, 10) || 7
    },
    
    // Testing Configuration
    useLocalTesting: {
      type: 'boolean',
      default: false
    },
    localPort: {
      type: 'number',
      default: 3000
    },
    useDockerTesting: {
      type: 'boolean',
      default: false
    },
    worldNameDocker: {
      type: 'string',
      default: 'TestWorld'
    },
    serverPasswordDocker: {
      type: 'string',
      default: 'valheim'
    },
    enableBepInExDocker: {
      type: 'boolean',
      default: true
    },
    
    // Discord Configuration
    discord: {
      type: 'object',
      default: getDiscordConfigFromEnv()
    },
    
    // World Configurations
    worlds: {
      type: 'array',
      default: parseWorldsFromEnv()
    },
    
    // Auto-cleanup Configuration
    autoCleanup: {
      type: 'boolean',
      default: false
    },
    autoCleanupDays: {
      type: 'number',
      default: 30
    }
  }
});

/**
 * Get full configuration, prioritizing .env values when available
 * @returns {Object} The full configuration object
 */
function getConfig() {
  // Create a copy of the store configuration
  const configData = { ...config.store };
  
  // Override with .env values if they exist
  if (process.env.AWS_REGION) configData.awsRegion = process.env.AWS_REGION;
  if (process.env.AWS_PROFILE) configData.awsProfile = process.env.AWS_PROFILE;
  
  // Dynamically process all VALHEIM_* environment variables
  Object.keys(process.env).forEach(key => {
    if (key.startsWith('VALHEIM_')) {
      // Convert to camelCase for storing in config
      // Example: VALHEIM_SERVER_NAME -> serverName
      const configKey = key.replace('VALHEIM_', '')
        .toLowerCase()
        .replace(/_([a-z])/g, (match, letter) => letter.toUpperCase());
      
      // Handle boolean values
      if (process.env[key] === 'true' || process.env[key] === 'false') {
        configData[configKey] = process.env[key] === 'true';
      } else {
        configData[configKey] = process.env[key];
      }
    }
  });
  
  // Handle backup configuration
  if (process.env.BACKUPS_TO_KEEP) {
    configData.backupsToKeep = parseInt(process.env.BACKUPS_TO_KEEP, 10);
  }
  
  // Override Discord configuration
  if (process.env.DISCORD_APP_ID || process.env.DISCORD_BOT_PUBLIC_KEY || process.env.DISCORD_BOT_SECRET_TOKEN) {
    configData.discord = configData.discord || {};
    if (process.env.DISCORD_APP_ID) configData.discord.appId = process.env.DISCORD_APP_ID;
    if (process.env.DISCORD_BOT_PUBLIC_KEY) configData.discord.publicKey = process.env.DISCORD_BOT_PUBLIC_KEY;
    if (process.env.DISCORD_BOT_SECRET_TOKEN) configData.discord.botToken = process.env.DISCORD_BOT_SECRET_TOKEN;
    if (process.env.DISCORD_APP_ID && process.env.DISCORD_BOT_SECRET_TOKEN) configData.discord.configured = true;
  }
  
  // Parse and override worlds configuration if present in .env
  if (process.env.WORLD_CONFIGURATIONS) {
    const newWorlds = parseWorldsFromEnv();
    if (newWorlds.length > 0) {
      configData.worlds = [...newWorlds];
    }
  }
  
  return configData;
}

/**
 * Save configuration
 * @param {Object} newConfig The new configuration to merge with existing
 */
function saveConfig(newConfig) {
  Object.assign(config.store, newConfig);
}

/**
 * Get world-specific configuration
 * @param {string} worldName The name of the world to get config for
 * @returns {Object|null} The world configuration or null if not found
 */
function getWorldConfig(worldName) {
  const worlds = config.get('worlds') || [];
  return worlds.find(w => w.name === worldName || w.worldName === worldName) || null;
}

/**
 * Save world-specific configuration
 * @param {string} worldName The name of the world to save config for
 * @param {Object} worldConfig The world configuration to save
 * @returns {boolean} True if successful, false if not
 */
function saveWorldConfig(worldName, worldConfig) {
  const worlds = config.get('worlds') || [];
  const index = worlds.findIndex(w => w.name === worldName || w.worldName === worldName);
  
  if (index >= 0) {
    worlds[index] = worldConfig;
  } else {
    worlds.push(worldConfig);
  }
  
  config.set('worlds', worlds);
  return true;
}

/**
 * Get active world from configuration
 * @returns {Object|null} The active world configuration or null if none set
 */
function getActiveWorld() {
  const activeWorldName = config.get('activeWorld');
  if (!activeWorldName) return null;
  
  return getWorldConfig(activeWorldName);
}

/**
 * Set active world in configuration
 * @param {string} worldName The name of the world to set as active
 * @returns {boolean} True if successful, false if world not found
 */
function setActiveWorld(worldName) {
  const world = getWorldConfig(worldName);
  if (!world) return false;
  
  config.set('activeWorld', worldName);
  return true;
}

/**
 * Create a backup of the configuration
 * @returns {string} Path to the backup file
 */
function backupConfig() {
  const backupDir = path.join(configDir, 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `config-${timestamp}.json`);
  
  fs.writeFileSync(backupFile, JSON.stringify(config.store, null, 2));
  return backupFile;
}

/**
 * Restore configuration from backup
 * @param {string} backupFile Path to the backup file
 * @returns {boolean} True if successful, false if not
 */
function restoreConfig(backupFile) {
  try {
    if (!fs.existsSync(backupFile)) {
      return false;
    }
    
    const data = fs.readFileSync(backupFile, 'utf8');
    const restoredConfig = JSON.parse(data);
    
    // Create a backup before restoring
    backupConfig();
    
    // Restore configuration
    config.store = restoredConfig;
    return true;
  } catch (err) {
    console.error('Error restoring config:', err);
    return false;
  }
}

/**
 * Get a list of available configuration backups
 * @returns {Array} Array of backup filenames
 */
function listConfigBackups() {
  const backupDir = path.join(configDir, 'backups');
  if (!fs.existsSync(backupDir)) {
    return [];
  }
  
  return fs.readdirSync(backupDir)
    .filter(file => file.startsWith('config-') && file.endsWith('.json'))
    .sort()
    .reverse();
}

module.exports = {
  getConfig,
  saveConfig,
  getWorldConfig,
  saveWorldConfig,
  getActiveWorld,
  setActiveWorld,
  backupConfig,
  restoreConfig,
  listConfigBackups
};
