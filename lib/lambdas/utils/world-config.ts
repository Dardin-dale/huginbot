// Define the world configuration interface
export interface WorldConfig {
  name: string;                // Friendly name for the world
  discordServerId: string;     // Discord server ID associated with this world
  worldName: string;           // Actual Valheim world name
  serverPassword: string;      // Server password
}

/**
 * Validate a world configuration object
 * @param worldConfig World configuration to validate
 * @returns Array of validation error messages (empty if valid)
 */
export function validateWorldConfig(worldConfig: WorldConfig): string[] {
  const errors: string[] = [];
  
  // Name validation
  if (!worldConfig.name || worldConfig.name.trim() === '') {
    errors.push('World name cannot be empty');
  } else if (worldConfig.name.length < 3) {
    errors.push('World name must be at least 3 characters');
  } else if (worldConfig.name.length > 50) {
    errors.push('World name cannot exceed 50 characters');
  }
  
  // World name validation
  if (!worldConfig.worldName || worldConfig.worldName.trim() === '') {
    errors.push('Valheim world name cannot be empty');
  } else if (worldConfig.worldName.length < 3) {
    errors.push('Valheim world name must be at least 3 characters');
  } else if (worldConfig.worldName.length > 20) {
    errors.push('Valheim world name cannot exceed 20 characters');
  } else if (!/^[a-zA-Z0-9_]+$/.test(worldConfig.worldName)) {
    errors.push('Valheim world name can only contain letters, numbers, and underscores');
  }
  
  // Server password validation
  if (!worldConfig.serverPassword || worldConfig.serverPassword.trim() === '') {
    errors.push('Server password cannot be empty');
  } else if (worldConfig.serverPassword.length < 5) {
    errors.push('Server password must be at least 5 characters');
  } else if (worldConfig.serverPassword.length > 16) {
    errors.push('Server password cannot exceed 16 characters');
  }
  
  // Discord server ID validation (optional)
  if (worldConfig.discordServerId && !/^\d+$/.test(worldConfig.discordServerId)) {
    errors.push('Discord server ID must be a numeric value');
  }
  
  return errors;
}

/**
 * Parse world configurations from environment variable
 * @param configString Semicolon-separated list of world configurations
 * @returns Array of valid world configurations
 */
export function parseWorldConfigs(configString: string): WorldConfig[] {
  try {
    if (!configString) {
      return [];
    }
    
    const parsedConfigs: WorldConfig[] = [];
    const configStrings = configString.split(';');
    
    for (let i = 0; i < configStrings.length; i++) {
      const worldString = configStrings[i].trim();
      if (!worldString) continue;
      
      const [name, discordServerId, worldName, serverPassword] = worldString.split(',').map(s => s.trim());
      const worldConfig = { name, discordServerId, worldName, serverPassword };
      
      // Validate the world configuration
      const validationErrors = validateWorldConfig(worldConfig);
      
      if (validationErrors.length > 0) {
        console.error(`Invalid world configuration at index ${i}:`, validationErrors);
        console.error(`Skipping invalid world: ${worldString}`);
      } else {
        parsedConfigs.push(worldConfig);
      }
    }
    
    return parsedConfigs;
  } catch (error) {
    console.error('Error parsing world configurations:', error);
    return [];
  }
}

// Get world configurations from environment
export const WORLD_CONFIGS = process.env.WORLD_CONFIGURATIONS ? 
  parseWorldConfigs(process.env.WORLD_CONFIGURATIONS) : [];