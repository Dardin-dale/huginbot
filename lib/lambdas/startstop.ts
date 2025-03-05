import { 
  APIGatewayProxyEvent, 
  APIGatewayProxyResult, 
  Context 
} from "aws-lambda";
import { 
  EC2Client, 
  StartInstancesCommand, 
  StopInstancesCommand, 
  DescribeInstancesCommand 
} from "@aws-sdk/client-ec2";
import { 
  SSMClient, 
  GetParameterCommand, 
  PutParameterCommand 
} from "@aws-sdk/client-ssm";
import { 
  S3Client, 
  CopyObjectCommand 
} from "@aws-sdk/client-s3";

const ec2Client = new EC2Client();
const ssmClient = new SSMClient();
const s3Client = new S3Client();

// This would come from environment variables set by CDK
const VALHEIM_INSTANCE_ID = process.env.VALHEIM_INSTANCE_ID || '';
const BACKUP_BUCKET_NAME = process.env.BACKUP_BUCKET_NAME || '';

// This would be set in your Discord bot's configuration
const DISCORD_AUTH_TOKEN = process.env.DISCORD_AUTH_TOKEN || '';

// SSM Parameter to track the currently active world
const ACTIVE_WORLD_PARAM = '/huginbot/active-world';

// Parse world configurations from environment variable
const WORLD_CONFIGS = process.env.WORLD_CONFIGURATIONS ? 
  parseWorldConfigs(process.env.WORLD_CONFIGURATIONS) : [];

interface WorldConfig {
  name: string;
  discordServerId: string;
  worldName: string;
  serverPassword: string;
}

function parseWorldConfigs(configString: string): WorldConfig[] {
  try {
    return configString.split(';').map(worldString => {
      const [name, discordServerId, worldName, serverPassword] = worldString.split(',');
      return { name, discordServerId, worldName, serverPassword };
    });
  } catch (error) {
    console.error('Error parsing world configurations:', error);
    return [];
  }
}

// Verify the request is from Discord
function isValidDiscordRequest(event: APIGatewayProxyEvent): boolean {
  // In production, you would verify the signature from Discord
  // https://discord.com/developers/docs/interactions/receiving-and-responding#security-and-authorization
  
  const authHeader = event.headers['x-discord-auth'] || '';
  return authHeader === DISCORD_AUTH_TOKEN;
}

export async function handler(
  event: APIGatewayProxyEvent, 
  context: Context
): Promise<APIGatewayProxyResult> {
  console.log("Event:", JSON.stringify(event, null, 2));

  // Verify request is from Discord
  if (!isValidDiscordRequest(event)) {
    return {
      statusCode: 401,
      body: JSON.stringify({ message: "Unauthorized" })
    };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const action = body.action || '';
    const discordServerId = body.guild_id || '';
    const worldName = body.world_name || '';
    
    if (!VALHEIM_INSTANCE_ID) {
      return {
        statusCode: 500,
        body: JSON.stringify({ message: "Server configuration error: Missing instance ID" })
      };
    }
    
    // Handle actions based on Discord server ID or specific world
    switch (action) {
      case 'start':
        if (worldName) {
          return await startServerWithWorld(worldName);
        } else if (discordServerId) {
          return await startServerForDiscord(discordServerId);
        } else {
          return await startServer();
        }
      case 'stop':
        return await stopServer();
      case 'status':
        return await getServerStatus();
      case 'list-worlds':
        return await listWorlds(discordServerId);
      default:
        return {
          statusCode: 400,
          body: JSON.stringify({ 
            message: "Invalid action. Use 'start', 'stop', 'status', or 'list-worlds'",
            available_worlds: WORLD_CONFIGS.map(w => w.name)
          })
        };
    }
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Internal server error" })
    };
  }
}

// List available worlds, optionally filtered by Discord server ID
async function listWorlds(discordServerId?: string): Promise<APIGatewayProxyResult> {
  try {
    const worlds = discordServerId 
      ? WORLD_CONFIGS.filter(w => w.discordServerId === discordServerId)
      : WORLD_CONFIGS;
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Available worlds",
        worlds: worlds.map(w => ({ 
          name: w.name, 
          worldName: w.worldName 
        }))
      })
    };
  } catch (error) {
    console.error("Error listing worlds:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Failed to list worlds" })
    };
  }
}

// Start server with a specific world configuration
async function startServerWithWorld(worldName: string): Promise<APIGatewayProxyResult> {
  try {
    const worldConfig = WORLD_CONFIGS.find(w => 
      w.name.toLowerCase() === worldName.toLowerCase() || 
      w.worldName.toLowerCase() === worldName.toLowerCase()
    );
    
    if (!worldConfig) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          message: `World "${worldName}" not found`,
          available_worlds: WORLD_CONFIGS.map(w => w.name)
        })
      };
    }
    
    // Set active world in SSM Parameter Store
    await ssmClient.send(new PutParameterCommand({
      Name: ACTIVE_WORLD_PARAM,
      Value: JSON.stringify(worldConfig),
      Type: 'String',
      Overwrite: true
    }));
    
    // Start the server as normal
    return await startServer();
  } catch (error) {
    console.error("Error starting server with world:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Failed to start server with specified world" })
    };
  }
}

// Start server for a specific Discord server
async function startServerForDiscord(discordServerId: string): Promise<APIGatewayProxyResult> {
  try {
    // Find worlds for this Discord server
    const discordWorlds = WORLD_CONFIGS.filter(w => w.discordServerId === discordServerId);
    
    if (discordWorlds.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          message: "No worlds configured for this Discord server",
          available_worlds: WORLD_CONFIGS.map(w => w.name)
        })
      };
    }
    
    // If multiple worlds, use the first one (can be enhanced with selection UI)
    const worldConfig = discordWorlds[0];
    
    // Set active world in SSM Parameter Store
    await ssmClient.send(new PutParameterCommand({
      Name: ACTIVE_WORLD_PARAM,
      Value: JSON.stringify(worldConfig),
      Type: 'String',
      Overwrite: true
    }));
    
    // Start the server as normal
    return await startServer();
  } catch (error) {
    console.error("Error starting server for Discord:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Failed to start server for this Discord server" })
    };
  }
}

async function startServer(): Promise<APIGatewayProxyResult> {
  try {
    // Check if the server is already running
    const status = await getInstanceStatus();
    
    if (status === 'running') {
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          message: "Server is already running",
          status: status
        })
      };
    }
    
    if (status === 'pending') {
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          message: "Server is already starting",
          status: status
        })
      };
    }
    
    // Get the active world configuration
    let worldConfig;
    try {
      const paramResult = await ssmClient.send(new GetParameterCommand({
        Name: ACTIVE_WORLD_PARAM
      }));
      
      if (paramResult.Parameter?.Value) {
        worldConfig = JSON.parse(paramResult.Parameter.Value);
      }
    } catch (err) {
      // Parameter might not exist yet, which is fine
      console.log('No active world parameter found, using default');
    }
    
    // Start the instance
    const command = new StartInstancesCommand({
      InstanceIds: [VALHEIM_INSTANCE_ID]
    });
    
    await ec2Client.send(command);
    
    const worldInfo = worldConfig 
      ? `World: ${worldConfig.name} (${worldConfig.worldName})`
      : 'Using default world configuration';
    
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        message: `Server is starting with ${worldInfo}. It may take several minutes before it's ready.`,
        status: 'pending',
        world: worldConfig ? {
          name: worldConfig.name,
          worldName: worldConfig.worldName
        } : null
      })
    };
  } catch (error) {
    console.error("Error starting server:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Failed to start server" })
    };
  }
}

async function stopServer(): Promise<APIGatewayProxyResult> {
  try {
    // Check if the server is already stopped
    const status = await getInstanceStatus();
    
    if (status === 'stopped') {
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          message: "Server is already stopped",
          status: status
        })
      };
    }
    
    if (status === 'stopping') {
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          message: "Server is already stopping",
          status: status
        })
      };
    }
    
    // Stop the instance
    const command = new StopInstancesCommand({
      InstanceIds: [VALHEIM_INSTANCE_ID]
    });
    
    await ec2Client.send(command);
    
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        message: "Server is shutting down. Save your game before disconnecting!",
        status: 'stopping'
      })
    };
  } catch (error) {
    console.error("Error stopping server:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Failed to stop server" })
    };
  }
}

async function getServerStatus(): Promise<APIGatewayProxyResult> {
  try {
    const status = await getInstanceStatus();
    let message = "";
    
    switch (status) {
      case 'running':
        message = "Server is online and ready to play!";
        break;
      case 'pending':
        message = "Server is starting up. Please wait a few minutes.";
        break;
      case 'stopping':
        message = "Server is shutting down.";
        break;
      case 'stopped':
        message = "Server is offline. Use the start command to launch it.";
        break;
      default:
        message = `Server status: ${status}`;
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        message: message,
        status: status
      })
    };
  } catch (error) {
    console.error("Error getting server status:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Failed to get server status" })
    };
  }
}

async function getInstanceStatus(): Promise<string> {
  try {
    const command = new DescribeInstancesCommand({
      InstanceIds: [VALHEIM_INSTANCE_ID]
    });
    
    const response = await ec2Client.send(command);
    
    if (!response.Reservations || response.Reservations.length === 0 || 
        !response.Reservations[0].Instances || response.Reservations[0].Instances.length === 0) {
      throw new Error("Instance not found");
    }
    
    return response.Reservations[0].Instances[0].State?.Name || 'unknown';
  } catch (error) {
    console.error("Error getting instance status:", error);
    throw error;
  }
}