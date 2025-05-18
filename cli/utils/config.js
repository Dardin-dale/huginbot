/**
 * HuginBot CLI - Configuration Management
 * This module handles configuration storage and retrieval
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const Conf = require('conf');

// Create config directory if it doesn't exist
const configDir = path.join(os.homedir(), '.huginbot');
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
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
      default: 'ValheimServer'
    },
    worldName: {
      type: 'string',
      default: 'ValheimWorld'
    },
    serverPassword: {
      type: 'string',
      default: 'valheim'
    },
    adminIds: {
      type: 'string',
      default: ''
    },
    instanceType: {
      type: 'string',
      default: 't3.medium'
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
      default: 7
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
      default: {
        appId: '',
        publicKey: '',
        botToken: '',
        configured: false,
        deployed: false,
        deployedAt: '',
        commandPrefix: '!',
        useSlashCommands: true
      }
    },
    
    // World Configurations
    worlds: {
      type: 'array',
      default: []
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
 * Get full configuration
 * @returns {Object} The full configuration object
 */
function getConfig() {
  return config.store;
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
