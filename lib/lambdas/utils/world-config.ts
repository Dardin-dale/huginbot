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
 * Parse world configurations from WORLD_X_ environment variables
 * Reads from WORLD_COUNT and WORLD_1_NAME, WORLD_1_WORLD_NAME, etc.
 * @returns Array of valid world configurations
 */
export function parseWorldConfigsFromEnv(): WorldConfig[] {
  try {
    const parsedConfigs: WorldConfig[] = [];
    const worldCount = parseInt(process.env.WORLD_COUNT || '0', 10);
    
    console.log(`Found WORLD_COUNT: ${worldCount}`);
    
    for (let i = 1; i <= worldCount; i++) {
      const name = process.env[`WORLD_${i}_NAME`];
      const worldName = process.env[`WORLD_${i}_WORLD_NAME`];
      const serverPassword = process.env[`WORLD_${i}_PASSWORD`] || 'valheim';
      const discordServerId = process.env[`WORLD_${i}_DISCORD_ID`] || '';
      
      // Only create world config if name and worldName are present
      if (name && worldName) {
        const worldConfig: WorldConfig = {
          name,
          discordServerId,
          worldName,
          serverPassword
        };
        
        console.log(`Found world ${i}: ${name} (${worldName}) for Discord server: ${discordServerId}`);
        
        // Validate the world configuration
        const validationErrors = validateWorldConfig(worldConfig);
        
        if (validationErrors.length > 0) {
          console.error(`Invalid world configuration for WORLD_${i}:`, validationErrors);
          console.error(`Skipping invalid world: ${name}`);
        } else {
          parsedConfigs.push(worldConfig);
        }
      } else {
        console.log(`Skipping WORLD_${i}: missing name or worldName (name: ${name}, worldName: ${worldName})`);
      }
    }
    
    console.log(`Parsed ${parsedConfigs.length} valid world configurations`);
    return parsedConfigs;
  } catch (error) {
    console.error('Error parsing world configurations from environment:', error);
    return [];
  }
}

// Get world configurations from WORLD_X_ environment variables
export const WORLD_CONFIGS = parseWorldConfigsFromEnv();