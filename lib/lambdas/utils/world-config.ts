// Define the world configuration interface
export interface WorldConfig {
  name: string;
  discordServerId: string;
  worldName: string;
  serverPassword: string;
}

// Parse world configurations from environment variable
export function parseWorldConfigs(configString: string): WorldConfig[] {
  try {
    if (!configString) {
      return [];
    }
    
    return configString.split(';').map(worldString => {
      const [name, discordServerId, worldName, serverPassword] = worldString.split(',');
      return { name, discordServerId, worldName, serverPassword };
    });
  } catch (error) {
    console.error('Error parsing world configurations:', error);
    return [];
  }
}

// Get world configurations from environment
export const WORLD_CONFIGS = process.env.WORLD_CONFIGURATIONS ? 
  parseWorldConfigs(process.env.WORLD_CONFIGURATIONS) : [];