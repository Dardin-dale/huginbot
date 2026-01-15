// Define the world configuration interface
export interface WorldConfig {
  name: string;                // Friendly name for the world
  discordServerId: string;     // Discord server ID associated with this world
  worldName: string;           // Actual Valheim world name
  serverPassword: string;      // Server password
  adminIds?: string;           // Steam IDs for server admins (space-separated)
  overrides?: Record<string, unknown>;  // Container overrides (BEPINEX, SERVER_ARGS, etc.)
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
 * Parse a string value into appropriate type (boolean, number, or string)
 */
function parseValue(value: string): unknown {
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;
  // Parse numbers (but keep strings with leading zeros as strings)
  if (!isNaN(Number(value)) && !isNaN(parseFloat(value)) && !/^0\d/.test(value)) {
    return parseFloat(value);
  }
  return value;
}

/**
 * Collect global VALHEIM_* variables as default overrides.
 * These apply to all worlds unless overridden by WORLD_X_* variables.
 */
function getGlobalOverrides(): Record<string, unknown> {
  const globalOverrides: Record<string, unknown> = {};
  // Basic VALHEIM_ props handled separately (not as overrides)
  const basicValheimProps = ['VALHEIM_SERVER_NAME', 'VALHEIM_WORLD_NAME', 'VALHEIM_SERVER_PASSWORD', 'VALHEIM_ADMIN_IDS'];

  Object.keys(process.env).forEach(key => {
    if (key.startsWith('VALHEIM_') && !basicValheimProps.includes(key)) {
      // Convert VALHEIM_BEPINEX -> BEPINEX
      const paramName = key.substring('VALHEIM_'.length);
      const value = process.env[key];
      if (value !== undefined) {
        globalOverrides[paramName] = parseValue(value);
      }
    }
  });

  return globalOverrides;
}

/**
 * Parse world configurations from WORLD_X_ environment variables.
 *
 * Override precedence:
 * 1. WORLD_X_* variables (highest priority, per-world)
 * 2. VALHEIM_* variables (global defaults for all worlds)
 * 3. Container defaults (lowest priority)
 *
 * @returns Array of valid world configurations
 */
export function parseWorldConfigsFromEnv(): WorldConfig[] {
  try {
    const parsedConfigs: WorldConfig[] = [];
    const worldCount = parseInt(process.env.WORLD_COUNT || '0', 10);

    console.log(`Found WORLD_COUNT: ${worldCount}`);

    // Get global VALHEIM_* overrides (apply to all worlds)
    const globalOverrides = getGlobalOverrides();
    if (Object.keys(globalOverrides).length > 0) {
      console.log(`Global overrides from VALHEIM_*: ${JSON.stringify(globalOverrides)}`);
    }

    // Basic properties that are handled separately (not as overrides)
    const basicProps = ['NAME', 'WORLD_NAME', 'PASSWORD', 'DISCORD_ID', 'ADMIN_IDS'];

    for (let i = 1; i <= worldCount; i++) {
      const name = process.env[`WORLD_${i}_NAME`];
      const worldName = process.env[`WORLD_${i}_WORLD_NAME`];
      const serverPassword = process.env[`WORLD_${i}_PASSWORD`] || 'valheim';
      const discordServerId = process.env[`WORLD_${i}_DISCORD_ID`] || '';
      // Per-world admin IDs take precedence over global admin IDs
      const adminIds = process.env[`WORLD_${i}_ADMIN_IDS`] || process.env.VALHEIM_ADMIN_IDS || '';

      // Only create world config if name and worldName are present
      if (name && worldName) {
        // Start with global overrides, then apply world-specific overrides
        const overrides: Record<string, unknown> = { ...globalOverrides };
        const worldPrefix = `WORLD_${i}_`;

        // Collect world-specific overrides (these override globals)
        Object.keys(process.env).forEach(key => {
          if (key.startsWith(worldPrefix)) {
            const paramName = key.substring(worldPrefix.length);

            // Skip basic properties
            if (!basicProps.includes(paramName)) {
              const value = process.env[key];
              if (value !== undefined) {
                overrides[paramName] = parseValue(value);
              }
            }
          }
        });

        const worldConfig: WorldConfig = {
          name,
          discordServerId,
          worldName,
          serverPassword,
          adminIds: adminIds || undefined,
          overrides: Object.keys(overrides).length > 0 ? overrides : undefined
        };

        console.log(`Found world ${i}: ${name} (${worldName}) for Discord server: ${discordServerId}`);
        if (adminIds) {
          console.log(`  Admin IDs: ${adminIds}`);
        }
        if (Object.keys(overrides).length > 0) {
          console.log(`  Overrides: ${JSON.stringify(overrides)}`);
        }

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