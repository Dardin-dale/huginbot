import { 
  APIGatewayProxyEvent, 
  APIGatewayProxyResult, 
  Context 
} from "aws-lambda";
import { 
  StartInstancesCommand, 
  StopInstancesCommand 
} from "@aws-sdk/client-ec2";
import { 
  GetParameterCommand, 
  PutParameterCommand,
  DeleteParameterCommand,
  SendCommandCommand
} from "@aws-sdk/client-ssm";
import { 
  ListObjectsV2Command
} from "@aws-sdk/client-s3";

// Import shared utilities
import { 
  ec2Client, 
  ssmClient, 
  s3Client,
  withRetry,
  VALHEIM_INSTANCE_ID, 
  BACKUP_BUCKET_NAME,
  SSM_PARAMS,
  getInstanceStatus,
  getStatusMessage,
  getDetailedServerStatus
} from "./utils/aws-clients";
import { 
  setupAuth,
  getUnauthorizedResponse,
  getMissingConfigResponse
} from "./utils/auth";
import { 
  createSuccessResponse, 
  createBadRequestResponse, 
  createErrorResponse 
} from "./utils/responses";
import { WORLD_CONFIGS, WorldConfig, validateWorldConfig } from "./utils/world-config";

export async function handler(
  event: APIGatewayProxyEvent, 
  context: Context
): Promise<APIGatewayProxyResult> {
  console.log("Event:", JSON.stringify(event, null, 2));
  
  // Handle authentication
  if (!setupAuth(event)) {
    return getUnauthorizedResponse();
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const action = body.action || '';
    const discordServerId = body.guild_id || '';
    const worldName = body.world_name || '';
    
    // Check for required configuration
    if (!VALHEIM_INSTANCE_ID) {
      return getMissingConfigResponse("instance ID");
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
      case 'backup':
        const backupAction = body.backup_action || 'list';
        return await handleBackup(backupAction);
      case 'hail':
        return await hailHugin();
      case 'help':
        return await showHelp();
      default:
        return createBadRequestResponse(
          "Invalid action. Use 'help' to see all available commands.", 
          { available_worlds: WORLD_CONFIGS.map(w => w.name) }
        );
    }
  } catch (error) {
    console.error("Error:", error);
    return createErrorResponse();
  }
}

// List available worlds, optionally filtered by Discord server ID
async function listWorlds(discordServerId?: string): Promise<APIGatewayProxyResult> {
  try {
    const worlds = discordServerId 
      ? WORLD_CONFIGS.filter(w => w.discordServerId === discordServerId)
      : WORLD_CONFIGS;
    
    return createSuccessResponse({
      message: "Available worlds",
      worlds: worlds.map(w => ({ 
        name: w.name, 
        worldName: w.worldName 
      }))
    });
  } catch (error) {
    console.error("Error listing worlds:", error);
    return createErrorResponse("Failed to list worlds");
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
      return createBadRequestResponse(
        `World "${worldName}" not found`,
        { available_worlds: WORLD_CONFIGS.map(w => w.name) }
      );
    }
    
    // Validate the world configuration
    const validationErrors = validateWorldConfig(worldConfig);
    if (validationErrors.length > 0) {
      return createBadRequestResponse(
        `Invalid world configuration: ${validationErrors.join(', ')}`,
        { available_worlds: WORLD_CONFIGS.map(w => w.name) }
      );
    }
    
    // Set active world in SSM Parameter Store with retry
    await withRetry(() => 
      ssmClient.send(new PutParameterCommand({
        Name: SSM_PARAMS.ACTIVE_WORLD,
        Value: JSON.stringify(worldConfig),
        Type: 'String',
        Overwrite: true
      }))
    );
    
    // Ensure we have a Discord webhook parameter that the Docker container can use
    if (worldConfig.discordServerId) {
      try {
        // Check if webhook already exists in SSM
        const webhookParamName = `${SSM_PARAMS.DISCORD_WEBHOOK}/${worldConfig.discordServerId}`;
        await withRetry(() => 
          ssmClient.send(new GetParameterCommand({
            Name: webhookParamName,
            WithDecryption: true
          }))
        );
        
        // Parameter exists, no further action needed
        console.log(`Discord webhook parameter ${webhookParamName} exists`);
      } catch (err) {
        console.log(`Discord webhook parameter not found for server ${worldConfig.discordServerId}. Notifications will not be sent.`);
        // We don't need to fail here, the server will still start but notifications won't be sent
      }
    }
    
    // Start the server as normal
    return await startServer();
  } catch (error) {
    console.error("Error starting server with world:", error);
    return createErrorResponse("Failed to start server with specified world");
  }
}

// Start server for a specific Discord server
async function startServerForDiscord(discordServerId: string): Promise<APIGatewayProxyResult> {
  try {
    // Find worlds for this Discord server
    const discordWorlds = WORLD_CONFIGS.filter(w => w.discordServerId === discordServerId);
    
    if (discordWorlds.length === 0) {
      return createBadRequestResponse(
        "No worlds configured for this Discord server",
        { available_worlds: WORLD_CONFIGS.map(w => w.name) }
      );
    }
    
    // If multiple worlds, use the first one (can be enhanced with selection UI)
    const worldConfig = discordWorlds[0];
    
    // Validate the world configuration
    const validationErrors = validateWorldConfig(worldConfig);
    if (validationErrors.length > 0) {
      return createBadRequestResponse(
        `Invalid world configuration: ${validationErrors.join(', ')}`,
        { available_worlds: WORLD_CONFIGS.map(w => w.name) }
      );
    }
    
    // Set active world in SSM Parameter Store with retry
    await withRetry(() => 
      ssmClient.send(new PutParameterCommand({
        Name: SSM_PARAMS.ACTIVE_WORLD,
        Value: JSON.stringify(worldConfig),
        Type: 'String',
        Overwrite: true
      }))
    );
    
    // Ensure we have a Discord webhook parameter that the Docker container can use
    try {
      // Check if webhook already exists in SSM
      const webhookParamName = `${SSM_PARAMS.DISCORD_WEBHOOK}/${discordServerId}`;
      await withRetry(() => 
        ssmClient.send(new GetParameterCommand({
          Name: webhookParamName,
          WithDecryption: true
        }))
      );
      
      // Parameter exists, no further action needed
      console.log(`Discord webhook parameter ${webhookParamName} exists`);
    } catch (err) {
      console.log(`Discord webhook parameter not found for server ${discordServerId}. Notifications will not be sent.`);
      // We don't need to fail here, the server will still start but notifications won't be sent
    }
    
    // Start the server as normal
    return await startServer();
  } catch (error) {
    console.error("Error starting server for Discord:", error);
    return createErrorResponse("Failed to start server for this Discord server");
  }
}

async function startServer(): Promise<APIGatewayProxyResult> {
  try {
    // Check if the server is already running
    const status = await getInstanceStatus();
    
    if (status === 'running') {
      return createSuccessResponse({
        message: "Server is already running",
        status: status
      });
    }
    
    if (status === 'pending') {
      return createSuccessResponse({
        message: "Server is already starting",
        status: status
      });
    }
    
    // Reset any existing PlayFab join codes
    try {
      await withRetry(() =>
        ssmClient.send(new DeleteParameterCommand({
          Name: SSM_PARAMS.PLAYFAB_JOIN_CODE
        }))
      );
      
      await withRetry(() =>
        ssmClient.send(new DeleteParameterCommand({
          Name: SSM_PARAMS.PLAYFAB_JOIN_CODE_TIMESTAMP
        }))
      );
    } catch (err) {
      // Parameters might not exist yet, which is fine
      console.log('No PlayFab parameters found to delete');
    }
    
    // Get the active world configuration
    let worldConfig;
    try {
      const paramResult = await withRetry(() =>
        ssmClient.send(new GetParameterCommand({
          Name: SSM_PARAMS.ACTIVE_WORLD
        }))
      );
      
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
    
    await withRetry(() => ec2Client.send(command));
    
    const worldInfo = worldConfig 
      ? `World: ${worldConfig.name} (${worldConfig.worldName})`
      : 'Using default world configuration';
    
    return createSuccessResponse({
      message: `Server is starting with ${worldInfo}. It may take 5-10 minutes to fully boot. You'll receive a notification with the join code as soon as the server is ready.`,
      status: 'pending',
      world: worldConfig ? {
        name: worldConfig.name,
        worldName: worldConfig.worldName
      } : null
    });
  } catch (error) {
    console.error("Error starting server:", error);
    return createErrorResponse("Failed to start server");
  }
}

async function stopServer(): Promise<APIGatewayProxyResult> {
  try {
    // Check if the server is already stopped
    const status = await getInstanceStatus();
    
    if (status === 'stopped') {
      return createSuccessResponse({
        message: "Server is already stopped",
        status: status
      });
    }
    
    if (status === 'stopping') {
      return createSuccessResponse({
        message: "Server is already stopping",
        status: status
      });
    }
    
    // Stop the instance
    const command = new StopInstancesCommand({
      InstanceIds: [VALHEIM_INSTANCE_ID]
    });
    
    await withRetry(() => ec2Client.send(command));
    
    return createSuccessResponse({
      message: "Server is shutting down. Save your game before disconnecting!",
      status: 'stopping'
    });
  } catch (error) {
    console.error("Error stopping server:", error);
    return createErrorResponse("Failed to stop server");
  }
}

async function getServerStatus(): Promise<APIGatewayProxyResult> {
  try {
    // Use the enhanced detailed status function instead of basic status
    const { 
      status, 
      message, 
      isReady, 
      isServerRunning, 
      joinCode, 
      launchTime 
    } = await getDetailedServerStatus();
    
    // Build a more informative response
    const response: any = {
      message: message,
      status: status,
      isReady: isReady,
      isServerRunning: isServerRunning
    };
    
    // Include optional fields if available
    if (launchTime) {
      response.launchTime = launchTime.toISOString();
      
      // Calculate uptime if server is running
      if (status === 'running') {
        const uptimeMs = Date.now() - launchTime.getTime();
        const uptimeMinutes = Math.floor(uptimeMs / (1000 * 60));
        const uptimeHours = Math.floor(uptimeMinutes / 60);
        const remainingMinutes = uptimeMinutes % 60;
        
        response.uptime = uptimeHours > 0 
          ? `${uptimeHours}h ${remainingMinutes}m`
          : `${uptimeMinutes}m`;
      }
    }
    
    // Include join code if available and the server is ready
    if (isReady && joinCode) {
      response.joinCode = joinCode;
    }
    
    return createSuccessResponse(response);
  } catch (error) {
    console.error("Error getting server status:", error);
    return createErrorResponse("Failed to get server status");
  }
}

/**
 * Handle backup actions (create, list)
 */
async function handleBackup(action: string): Promise<APIGatewayProxyResult> {
  try {
    // Get instance status first - need running server for backups
    const status = await getInstanceStatus();
    
    switch(action) {
      case 'create':
        // Server must be running to create a backup
        if (status !== 'running') {
          return createBadRequestResponse(
            "Cannot create backup: Server is not running",
            { status }
          );
        }
        
        // Use SSM Run Command to trigger the backup script on the EC2 instance
        // This approach ensures we get a consistent backup while the server is running
        try {
          // Get the active world configuration
          let worldInfo = 'default world';
          try {
            const paramResult = await withRetry(() =>
              ssmClient.send(new GetParameterCommand({
                Name: SSM_PARAMS.ACTIVE_WORLD
              }))
            );
            
            if (paramResult.Parameter?.Value) {
              const worldConfig = JSON.parse(paramResult.Parameter.Value);
              worldInfo = `${worldConfig.name} (${worldConfig.worldName})`;
            }
          } catch (err) {
            console.log('No active world parameter found, using default');
          }
          
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          
          // Execute the backup script on the EC2 instance using SSM Run Command
          const command = new SendCommandCommand({
            DocumentName: 'AWS-RunShellScript',
            InstanceIds: [VALHEIM_INSTANCE_ID],
            Parameters: {
              'commands': ['/usr/local/bin/backup-valheim.sh']
            },
            Comment: `Manual backup triggered via Discord at ${timestamp}`
          });
          
          await withRetry(() => ssmClient.send(command));
          
          return createSuccessResponse({
            message: `Backup initiated for ${worldInfo}. This may take a few minutes to complete.`,
            status: "pending",
            timestamp: timestamp
          });
        } catch (error) {
          console.error("Error creating backup:", error);
          return createErrorResponse("Failed to create backup");
        }
        
      case 'list':
      default:
        try {
          // Get active world to determine where backups would be
          let backupPath = 'worlds/default';
          let worldName = 'default';
          try {
            const paramResult = await withRetry(() =>
              ssmClient.send(new GetParameterCommand({
                Name: SSM_PARAMS.ACTIVE_WORLD
              }))
            );
            
            if (paramResult.Parameter?.Value) {
              const worldConfig = JSON.parse(paramResult.Parameter.Value);
              worldName = worldConfig.name;
              backupPath = `worlds/${worldName}`;
            }
          } catch (err) {
            console.log('No active world parameter found, using default path');
          }
          
          // List recent backups from S3
          const command = new ListObjectsV2Command({
            Bucket: BACKUP_BUCKET_NAME,
            Prefix: backupPath + '/',
            MaxKeys: 5  // Limit to the 5 most recent backups
          });
          
          const response = await withRetry(() => s3Client.send(command));
          
          // Format the backup information
          const backups = response.Contents ? 
            response.Contents
              .sort((a, b) => (b.LastModified?.getTime() || 0) - (a.LastModified?.getTime() || 0))
              .map(item => {
                // Extract the timestamp from the filename
                const filename = item.Key?.split('/').pop() || '';
                const size = Math.round((item.Size || 0) / (1024 * 1024) * 10) / 10; // Convert to MB with 1 decimal
                const date = item.LastModified ? 
                  item.LastModified.toISOString().replace('T', ' ').substring(0, 19) : 'Unknown';
                
                return {
                  filename,
                  size: `${size} MB`,
                  date,
                  key: item.Key
                };
              }) : [];
          
          return createSuccessResponse({
            message: "Recent backups are created automatically when the server starts and stops. Manual backups can be created with the 'backup create' command.",
            backups_location: backupPath,
            world_name: worldName,
            server_status: status,
            recent_backups: backups,
            total_backups: response.KeyCount || 0
          });
        } catch (error) {
          console.error("Error listing backups:", error);
          return createErrorResponse("Failed to list backups");
        }
    }
  } catch (error) {
    console.error("Error handling backup action:", error);
    return createErrorResponse("Failed to handle backup request");
  }
}

/**
 * Random Hugin (raven) responses in true Valheim style
 */
async function hailHugin(): Promise<APIGatewayProxyResult> {
  const responses = [
    "Hrafn! The All-Father sent me to guide you.",
    "Skål! Your halls await worthy warriors!",
    "The server stands ready, will you answer the call?",
    "The ravens watch over your world. Odin is pleased.",
    "Hail, warrior! The bifrost stands ready for your journey.",
    "I have sailed the server seas. Many treasures await.",
    "The mead halls echo with tales of your adventures.",
    "Beware the plains, little viking!",
    "The world tree Yggdrasil connects all servers in its branches.",
    "The Valkyries await those who would challenge the plains...",
    "Hugin remembers all backups in Odin's wisdom.",
    "The serpent stirs in deep waters, vikings.",
    "Your longboat is anchored in the digital harbor.",
    "The wolves howl at the moon, waiting for players to return.",
    "The trolls sleep fitfully in their caves. Will you wake them?",
    "I spy with my raven eye, players venturing forth!"
  ];
  
  // Select a random response
  const randomIndex = Math.floor(Math.random() * responses.length);
  
  return createSuccessResponse({
    message: responses[randomIndex],
    image: "https://static.wikia.nocookie.net/valheim/images/7/7d/Hugin.png"
  });
}

/**
 * Show help for all available commands
 */
async function showHelp(): Promise<APIGatewayProxyResult> {
  const commands = [
    {
      name: "start",
      description: "Start the Valheim server",
      usage: "/valheim start [world_name]",
      examples: [
        "/valheim start",
        "/valheim start MyWorld"
      ]
    },
    {
      name: "stop",
      description: "Stop the Valheim server",
      usage: "/valheim stop",
      examples: [
        "/valheim stop"
      ]
    },
    {
      name: "status",
      description: "Check the status of the server",
      usage: "/valheim status",
      examples: [
        "/valheim status"
      ]
    },
    {
      name: "list-worlds",
      description: "List available worlds for this Discord server",
      usage: "/valheim list-worlds",
      examples: [
        "/valheim list-worlds"
      ]
    },
    {
      name: "backup",
      description: "Manage server backups",
      usage: "/valheim backup [create|list]",
      examples: [
        "/valheim backup list",
        "/valheim backup create"
      ]
    },
    {
      name: "hail",
      description: "Greet Hugin for Valheim wisdom",
      usage: "/valheim hail",
      examples: [
        "/valheim hail"
      ]
    },
    {
      name: "help",
      description: "Show this help message",
      usage: "/valheim help",
      examples: [
        "/valheim help"
      ]
    }
  ];
  
  // Get the active world configuration
  let worldInfo = "";
  try {
    const paramResult = await withRetry(() =>
      ssmClient.send(new GetParameterCommand({
        Name: SSM_PARAMS.ACTIVE_WORLD
      }))
    );
    
    if (paramResult.Parameter?.Value) {
      const worldConfig = JSON.parse(paramResult.Parameter.Value);
      worldInfo = `\n\nCurrent active world: ${worldConfig.name} (${worldConfig.worldName})`;
    }
  } catch (err) {
    // No active world parameter found
  }
  
  return createSuccessResponse({
    message: "HuginBot - Valheim Server Manager",
    description: `Available commands for controlling your Valheim server:${worldInfo}`,
    commands: commands
  });
}
