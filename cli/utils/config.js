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

// Parse world configurations from .env using indexed format
function parseWorldsFromEnv() {
  const worldConfigs = [];
  const worldCount = parseInt(process.env.WORLD_COUNT || '0', 10);
  
  for (let i = 1; i <= worldCount; i++) {
    if (process.env[`WORLD_${i}_NAME`] && process.env[`WORLD_${i}_WORLD_NAME`]) {
      // Create the base world config
      const worldConfig = {
        // Basic properties (required)
        name: process.env[`WORLD_${i}_NAME`],
        worldName: process.env[`WORLD_${i}_WORLD_NAME`],
        serverPassword: process.env[`WORLD_${i}_PASSWORD`] || 'valheim',
        discordServerId: process.env[`WORLD_${i}_DISCORD_ID`] || '',
        // Per-world admin IDs take precedence over global admin IDs
        adminIds: process.env[`WORLD_${i}_ADMIN_IDS`] || process.env.VALHEIM_ADMIN_IDS || '',

        // Container overrides object to store all custom parameters
        overrides: {}
      };
      
      // Find all environment variables that match WORLD_<i>_* pattern
      // and aren't one of the basic properties
      const worldPrefix = `WORLD_${i}_`;
      const basicProps = ['NAME', 'WORLD_NAME', 'PASSWORD', 'DISCORD_ID', 'ADMIN_IDS'];
      
      Object.keys(process.env).forEach(key => {
        if (key.startsWith(worldPrefix)) {
          // Extract the parameter name (everything after WORLD_<i>_)
          const paramName = key.substring(worldPrefix.length);
          
          // Skip basic properties, we've already handled those
          if (!basicProps.includes(paramName)) {
            let value = process.env[key];
            
            // Parse booleans (true/false strings)
            if (value.toLowerCase() === 'true') {
              value = true;
            } else if (value.toLowerCase() === 'false') {
              value = false;
            }
            // Parse numbers
            else if (!isNaN(value) && !isNaN(parseFloat(value))) {
              value = parseFloat(value);
            }
            
            // Store in overrides object using original parameter name
            worldConfig.overrides[paramName] = value;
          }
        }
      });
      
      worldConfigs.push(worldConfig);
    }
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
  // Check for either indexed format or legacy format
  const newWorlds = parseWorldsFromEnv();
  if (newWorlds.length > 0) {
    configData.worlds = [...newWorlds];
  }

  return configData;
}

/**
 * Get configuration with stack outputs (async version)
 * Fetches backupBucket and instanceId from CloudFormation if not cached
 * @returns {Promise<Object>} The full configuration with stack outputs
 */
async function getConfigWithStackOutputs() {
  const configData = getConfig();

  // If we already have both values cached, return immediately
  if (configData.backupBucket && configData.instanceId) {
    return configData;
  }

  // Try to fetch from CloudFormation stack outputs
  try {
    const { getStackOutputs } = require('./aws');
    const outputs = await getStackOutputs('ValheimStack');

    if (outputs.BackupBucketName && !configData.backupBucket) {
      configData.backupBucket = outputs.BackupBucketName;
      // Cache for future use
      saveConfig({ backupBucket: outputs.BackupBucketName });
    }

    if (outputs.InstanceId && !configData.instanceId) {
      configData.instanceId = outputs.InstanceId;
      // Cache for future use
      saveConfig({ instanceId: outputs.InstanceId });
    }
  } catch (error) {
    // Stack might not be deployed yet, that's ok
    console.log('Note: Could not fetch stack outputs. Deploy the stack first with: npm run deploy');
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
  getConfigWithStackOutputs,
  saveConfig,
  getWorldConfig,
  saveWorldConfig,
  getActiveWorld,
  setActiveWorld,
  backupConfig,
  restoreConfig,
  listConfigBackups
};
