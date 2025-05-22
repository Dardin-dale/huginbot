/**
 * HuginBot CLI - Environment File Manager
 * This module handles direct manipulation of the .env file
 */

const fs = require('fs');
const path = require('path');

/**
 * Get the path to the .env file
 * @returns {string} The absolute path to the .env file
 */
function getEnvFilePath() {
  return path.join(process.cwd(), '.env');
}

/**
 * Read the content of the .env file
 * @returns {string} The content of the .env file, or empty string if not exists
 */
function readEnvFile() {
  const envPath = getEnvFilePath();
  return fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
}

/**
 * Update a variable in the .env file
 * @param {string} key The key to update
 * @param {string} value The new value
 * @returns {boolean} True if successful, false if not
 */
function updateEnvVariable(key, value) {
  try {
    const envPath = getEnvFilePath();
    let content = readEnvFile();
    
    // Escape special characters in value if needed
    const escapedValue = value.includes('#') || value.includes(' ') 
      ? `"${value.replace(/"/g, '\\"')}"` 
      : value;
    
    // Check if key exists and update, or add if it doesn't
    const keyRegex = new RegExp(`^${key}=.*`, 'm');
    if (keyRegex.test(content)) {
      content = content.replace(keyRegex, `${key}=${escapedValue}`);
    } else {
      // Add a newline before adding the new key if the file doesn't end with one
      if (content && !content.endsWith('\n')) {
        content += '\n';
      }
      content += `${key}=${escapedValue}\n`;
    }
    
    fs.writeFileSync(envPath, content);
    
    // Also update process.env so changes take effect immediately
    process.env[key] = value;
    
    return true;
  } catch (err) {
    console.error('Error updating .env file:', err);
    return false;
  }
}

/**
 * Remove a variable from the .env file
 * @param {string} key The key to remove
 * @returns {boolean} True if successful, false if not
 */
function removeEnvVariable(key) {
  try {
    const envPath = getEnvFilePath();
    let content = readEnvFile();
    
    // Remove the line with the key
    const keyRegex = new RegExp(`^${key}=.*\n?`, 'm');
    content = content.replace(keyRegex, '');
    
    fs.writeFileSync(envPath, content);
    
    // Also update process.env so changes take effect immediately
    delete process.env[key];
    
    return true;
  } catch (err) {
    console.error('Error removing variable from .env file:', err);
    return false;
  }
}

/**
 * Add a new world to the .env file using indexed format
 * @param {Object} world The world configuration object
 * @returns {number} The index of the newly added world
 */
function addWorldToEnv(world) {
  try {
    // Get current world count
    const worldCount = parseInt(process.env.WORLD_COUNT || '0', 10);
    const newIndex = worldCount + 1;
    
    // Add the new world - basic properties
    updateEnvVariable(`WORLD_${newIndex}_NAME`, world.name);
    updateEnvVariable(`WORLD_${newIndex}_WORLD_NAME`, world.worldName);
    updateEnvVariable(`WORLD_${newIndex}_PASSWORD`, world.serverPassword);
    if (world.discordServerId) {
      updateEnvVariable(`WORLD_${newIndex}_DISCORD_ID`, world.discordServerId);
    }
    
    // Add any overrides if they exist
    if (world.overrides && typeof world.overrides === 'object') {
      Object.entries(world.overrides).forEach(([key, value]) => {
        // Convert all values to strings for the .env file
        const stringValue = typeof value === 'boolean' || typeof value === 'number' 
          ? value.toString() 
          : value;
        
        updateEnvVariable(`WORLD_${newIndex}_${key}`, stringValue);
      });
    }
    
    // For backward compatibility, also handle explicitly named properties
    // These will be deprecated in favor of the overrides object
    const legacyProps = {
      serverArgs: 'SERVER_ARGS',
      bepInEx: 'BEPINEX',
      serverPublic: 'SERVER_PUBLIC',
      updateInterval: 'UPDATE_INTERVAL'
    };
    
    Object.entries(legacyProps).forEach(([propName, envKey]) => {
      if (world[propName] !== null && world[propName] !== undefined && 
          (!world.overrides || !world.overrides[envKey])) {
        const value = typeof world[propName] === 'boolean' || typeof world[propName] === 'number'
          ? world[propName].toString()
          : world[propName];
        
        updateEnvVariable(`WORLD_${newIndex}_${envKey}`, value);
      }
    });
    
    // Update world count
    updateEnvVariable('WORLD_COUNT', newIndex.toString());
    
    return newIndex;
  } catch (err) {
    console.error('Error adding world to .env file:', err);
    return -1;
  }
}

/**
 * Update an existing world in the .env file
 * @param {number} index The index of the world to update
 * @param {Object} world The updated world configuration
 * @returns {boolean} True if successful, false if not
 */
function updateWorldInEnv(index, world) {
  try {
    // Update basic properties
    updateEnvVariable(`WORLD_${index}_NAME`, world.name);
    updateEnvVariable(`WORLD_${index}_WORLD_NAME`, world.worldName);
    updateEnvVariable(`WORLD_${index}_PASSWORD`, world.serverPassword);
    
    // Update or remove discord ID based on whether it's provided
    if (world.discordServerId) {
      updateEnvVariable(`WORLD_${index}_DISCORD_ID`, world.discordServerId);
    } else {
      removeEnvVariable(`WORLD_${index}_DISCORD_ID`);
    }
    
    // Find existing override keys to handle removal of properties that are no longer present
    const worldPrefix = `WORLD_${index}_`;
    const basicProps = ['NAME', 'WORLD_NAME', 'PASSWORD', 'DISCORD_ID'];
    const existingOverrides = [];
    
    Object.keys(process.env).forEach(key => {
      if (key.startsWith(worldPrefix)) {
        const paramName = key.substring(worldPrefix.length);
        if (!basicProps.includes(paramName)) {
          existingOverrides.push(paramName);
        }
      }
    });
    
    // Remove overrides that aren't in the updated world
    if (world.overrides && typeof world.overrides === 'object') {
      existingOverrides.forEach(key => {
        if (!world.overrides.hasOwnProperty(key)) {
          removeEnvVariable(`WORLD_${index}_${key}`);
        }
      });
      
      // Add or update overrides
      Object.entries(world.overrides).forEach(([key, value]) => {
        // Convert all values to strings for the .env file
        const stringValue = typeof value === 'boolean' || typeof value === 'number' 
          ? value.toString() 
          : value;
        
        updateEnvVariable(`WORLD_${index}_${key}`, stringValue);
      });
    } else {
      // If no overrides object, remove all existing overrides
      existingOverrides.forEach(key => {
        removeEnvVariable(`WORLD_${index}_${key}`);
      });
    }
    
    // For backward compatibility, also handle explicitly named properties
    const legacyProps = {
      serverArgs: 'SERVER_ARGS',
      bepInEx: 'BEPINEX',
      serverPublic: 'SERVER_PUBLIC',
      updateInterval: 'UPDATE_INTERVAL'
    };
    
    Object.entries(legacyProps).forEach(([propName, envKey]) => {
      if (world[propName] !== null && world[propName] !== undefined) {
        const value = typeof world[propName] === 'boolean' || typeof world[propName] === 'number'
          ? world[propName].toString()
          : world[propName];
        
        updateEnvVariable(`WORLD_${index}_${envKey}`, value);
      } else if (!world.overrides || !world.overrides[envKey]) {
        // Remove if not present in world object and not in overrides
        removeEnvVariable(`WORLD_${index}_${envKey}`);
      }
    });
    
    return true;
  } catch (err) {
    console.error('Error updating world in .env file:', err);
    return false;
  }
}

/**
 * Remove a world from the .env file and reindex remaining worlds
 * @param {number} index The index of the world to remove
 * @returns {boolean} True if successful, false if not
 */
function removeWorldFromEnv(index) {
  try {
    const worldCount = parseInt(process.env.WORLD_COUNT || '0', 10);
    
    if (index < 1 || index > worldCount) {
      return false;
    }
    
    // Read current worlds with all overrides
    const worlds = [];
    for (let i = 1; i <= worldCount; i++) {
      if (i !== index && process.env[`WORLD_${i}_NAME`]) {
        // Create the base world config
        const world = {
          name: process.env[`WORLD_${i}_NAME`],
          worldName: process.env[`WORLD_${i}_WORLD_NAME`] || '',
          serverPassword: process.env[`WORLD_${i}_PASSWORD`] || '',
          discordServerId: process.env[`WORLD_${i}_DISCORD_ID`] || '',
          overrides: {}
        };
        
        // Collect all overrides for this world
        const worldPrefix = `WORLD_${i}_`;
        const basicProps = ['NAME', 'WORLD_NAME', 'PASSWORD', 'DISCORD_ID'];
        
        Object.keys(process.env).forEach(key => {
          if (key.startsWith(worldPrefix)) {
            const paramName = key.substring(worldPrefix.length);
            if (!basicProps.includes(paramName)) {
              let value = process.env[key];
              
              // Parse values correctly
              if (value.toLowerCase() === 'true') {
                value = true;
              } else if (value.toLowerCase() === 'false') {
                value = false;
              } else if (!isNaN(value) && !isNaN(parseFloat(value))) {
                value = parseFloat(value);
              }
              
              world.overrides[paramName] = value;
            }
          }
        });
        
        worlds.push(world);
      }
    }
    
    // Remove all world variables - including all possible overrides
    // by checking for any env var with WORLD_<number>_ prefix
    Object.keys(process.env).forEach(key => {
      const worldRegex = /^WORLD_\d+_/;
      if (worldRegex.test(key)) {
        removeEnvVariable(key);
      }
    });
    
    // Add worlds back with new indices
    worlds.forEach((world, idx) => {
      const newIndex = idx + 1;
      
      // Add basic properties
      updateEnvVariable(`WORLD_${newIndex}_NAME`, world.name);
      updateEnvVariable(`WORLD_${newIndex}_WORLD_NAME`, world.worldName);
      updateEnvVariable(`WORLD_${newIndex}_PASSWORD`, world.serverPassword);
      if (world.discordServerId) {
        updateEnvVariable(`WORLD_${newIndex}_DISCORD_ID`, world.discordServerId);
      }
      
      // Add all overrides
      if (world.overrides && typeof world.overrides === 'object') {
        Object.entries(world.overrides).forEach(([key, value]) => {
          const stringValue = typeof value === 'boolean' || typeof value === 'number'
            ? value.toString()
            : value;
            
          updateEnvVariable(`WORLD_${newIndex}_${key}`, stringValue);
        });
      }
    });
    
    // Update world count
    updateEnvVariable('WORLD_COUNT', worlds.length.toString());
    
    return true;
  } catch (err) {
    console.error('Error removing world from .env file:', err);
    return false;
  }
}

/**
 * Create a backup of the .env file
 * @returns {string} Path to the backup file, or empty string if failed
 */
function backupEnvFile() {
  try {
    const envPath = getEnvFilePath();
    if (!fs.existsSync(envPath)) {
      return '';
    }
    
    const backupDir = path.join(process.cwd(), '.env-backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `.env.${timestamp}`);
    
    fs.copyFileSync(envPath, backupPath);
    return backupPath;
  } catch (err) {
    console.error('Error creating .env backup:', err);
    return '';
  }
}

/**
 * Migrate from legacy WORLD_CONFIGURATIONS format to indexed format
 * @returns {boolean} True if successful, false if not
 */
function migrateToIndexedFormat() {
  try {
    // Check if we need to migrate
    if (!process.env.WORLD_CONFIGURATIONS) {
      return false;
    }
    
    // Parse legacy format
    const worlds = [];
    const worldStrings = process.env.WORLD_CONFIGURATIONS.split(';');
    
    worldStrings.forEach(worldString => {
      const [name, discordServerId, worldName, serverPassword] = worldString.split(',');
      if (name && worldName && serverPassword) {
        worlds.push({
          name,
          discordServerId,
          worldName,
          serverPassword
        });
      }
    });
    
    if (worlds.length === 0) {
      return false;
    }
    
    // Create backup before migrating
    backupEnvFile();
    
    // Add worlds in indexed format
    worlds.forEach((world, idx) => {
      const index = idx + 1;
      updateEnvVariable(`WORLD_${index}_NAME`, world.name);
      updateEnvVariable(`WORLD_${index}_WORLD_NAME`, world.worldName);
      updateEnvVariable(`WORLD_${index}_PASSWORD`, world.serverPassword);
      if (world.discordServerId) {
        updateEnvVariable(`WORLD_${index}_DISCORD_ID`, world.discordServerId);
      }
    });
    
    // Update world count
    updateEnvVariable('WORLD_COUNT', worlds.length.toString());
    
    // Remove legacy format
    removeEnvVariable('WORLD_CONFIGURATIONS');
    
    return true;
  } catch (err) {
    console.error('Error migrating to indexed format:', err);
    return false;
  }
}

module.exports = {
  getEnvFilePath,
  readEnvFile,
  updateEnvVariable,
  removeEnvVariable,
  addWorldToEnv,
  updateWorldInEnv,
  removeWorldFromEnv,
  backupEnvFile,
  migrateToIndexedFormat
};