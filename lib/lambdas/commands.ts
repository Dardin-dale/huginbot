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
  getGuildDefaultWorldParam,
  getInstanceStatus,
  getStatusMessage,
  getFastServerStatus,
  getDetailedServerStatus
} from "./utils/aws-clients";
import { 
  createSuccessResponse, 
  createBadRequestResponse, 
  createErrorResponse 
} from "./utils/responses";
import { WORLD_CONFIGS, WorldConfig, validateWorldConfig } from "./utils/world-config";

// Discord interaction types
const InteractionType = {
    PING: 1,
    APPLICATION_COMMAND: 2,
    MESSAGE_COMPONENT: 3,
    APPLICATION_COMMAND_AUTOCOMPLETE: 4,
    MODAL_SUBMIT: 5,
};

const InteractionResponseType = {
    PONG: 1,
    CHANNEL_MESSAGE_WITH_SOURCE: 4,
    DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
    DEFERRED_UPDATE_MESSAGE: 6,
    UPDATE_MESSAGE: 7,
};

// Import Discord interactions for signature verification
const { verifyKey } = require('discord-interactions');

// Import fetch for webhook testing (Node 18+ has built-in fetch)
const fetch = globalThis.fetch;

// Error classification helper
function isInfrastructureError(error: any): boolean {
  if (!error) return false;
  const message = error.message || String(error);
  const errorCode = error.code || '';
  
  return message.includes('timeout') || 
         message.includes('fetch failed') || 
         message.includes('SocketError') ||
         message.includes('UND_ERR_SOCKET') ||
         message.includes('network') ||
         message.includes('connection') ||
         message.includes('AbortError') ||
         errorCode === 'UND_ERR_SOCKET' ||
         errorCode === 'ECONNRESET' ||
         errorCode === 'ETIMEDOUT' ||
         errorCode === 'ENOTFOUND';
}

// Enhanced sendFollowUpMessage with retry mechanism and better error handling
async function sendFollowUpMessage(applicationId: string, token: string, content: any, retries: number = 2): Promise<void> {
  const followUpUrl = `https://discord.com/api/v10/webhooks/${applicationId}/${token}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      console.log(`📤 Sending follow-up message to Discord webhook (attempt ${attempt + 1}/${retries + 1})`);
      console.log(`Webhook URL: ${followUpUrl.substring(0, 60)}...`); // Log partial URL (don't expose token)

      // Add timeout to prevent hanging connections
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      const response = await fetch(followUpUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'HuginBot/1.0',
        },
        body: JSON.stringify(content),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorData = await response.text();
        console.error(`❌ Discord API error: ${response.status} ${response.statusText}`);
        console.error(`Error response: ${errorData}`);
        
        // Don't retry on client errors (4xx) - these won't succeed
        if (response.status >= 400 && response.status < 500) {
          throw new Error(`Discord API client error ${response.status}: ${errorData}`);
        }
        
        // Retry on server errors (5xx) if we have attempts left
        if (attempt < retries) {
          console.log(`Server error ${response.status}, retrying in ${(attempt + 1) * 1000}ms`);
          await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1000));
          continue;
        }
        
        throw new Error(`Discord API returned ${response.status}: ${errorData}`);
      }
      
      console.log(`✅ Follow-up message sent successfully`);
      return; // Success, exit retry loop
      
    } catch (error: any) {
      console.error(`❌ Error sending follow-up message (attempt ${attempt + 1}):`, error.message || error);
      console.error(`Error name: ${error.name}, Error code: ${error.code}, Error stack: ${error.stack}`);
      
      // Check if it's a network/socket error that might be retryable
      const isRetryableError = error.name === 'AbortError' || 
                              error.name === 'TypeError' ||
                              error.code === 'UND_ERR_SOCKET' ||
                              error.code === 'ECONNRESET' ||
                              error.code === 'ETIMEDOUT';
      
      if (isRetryableError && attempt < retries) {
        console.log(`Network error, retrying in ${(attempt + 1) * 1000}ms`);
        await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1000));
        continue;
      }
      
      // Log details for debugging on final failure
      if (attempt === retries) {
        console.error('Follow-up URL:', followUpUrl);
        console.error('Content:', JSON.stringify(content, null, 2));
      }
      
      throw error; // Re-throw on final attempt
    }
  }
}

// Fallback message for infrastructure errors with more retries
async function sendSimpleFallbackMessage(applicationId: string, token: string, command: string): Promise<void> {
  const simpleMessage = {
    content: `⚠️ ${command} command temporarily unavailable due to network issues. Please try again in a few minutes.`
  };
  
  try {
    // Use more retries for fallback message since it's our last hope
    await sendFollowUpMessage(applicationId, token, simpleMessage, 4);
  } catch (fallbackError) {
    console.error('❌ Even simple fallback message failed after retries:', fallbackError);
    
    // Last resort: try an even simpler message with minimal content
    try {
      await sendFollowUpMessage(applicationId, token, {
        content: `❌ ${command} failed. Please try again later.`
      }, 2);
    } catch (finalError) {
      console.error('❌ Final fallback message also failed:', finalError);
      // Nothing more we can do - Discord will show "thinking..." indefinitely
    }
  }
}

export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  // Keep Lambda alive to complete async operations (this is the default, but being explicit)
  // This is critical for deferred Discord responses to work properly
  context.callbackWaitsForEmptyEventLoop = true;

  console.log("Event:", JSON.stringify(event, null, 2));

  try {
    // Handle Discord signature verification
    const signature = event.headers['x-signature-ed25519'] || event.headers['X-Signature-Ed25519'];
    const timestamp = event.headers['x-signature-timestamp'] || event.headers['X-Signature-Timestamp'];
    const publicKey = process.env.DISCORD_BOT_PUBLIC_KEY;

    if (!signature || !timestamp || !publicKey) {
      console.error('Missing required headers for Discord verification');
      console.error('Signature:', signature ? 'present' : 'missing');
      console.error('Timestamp:', timestamp ? 'present' : 'missing');
      console.error('Public Key:', publicKey ? 'present' : 'missing');
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ error: 'Unauthorized' }),
      };
    }

    // Verify the request is from Discord using the official discord-interactions package
    try {
      const isValidRequest = await verifyKey(
        event.body || '',
        signature,
        timestamp,
        publicKey
      );
      
      if (!isValidRequest) {
        console.error('Invalid request signature');
        return {
          statusCode: 401,
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ error: 'Invalid request signature' }),
        };
      }
    } catch (error) {
      console.error('Error during signature verification:', error);
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ error: 'Signature verification failed' }),
      };
    }

    const body = JSON.parse(event.body || '{}');

    // Handle Discord PING (verification)
    if (body.type === InteractionType.PING) {
      console.log('Received PING, responding with PONG');
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: InteractionResponseType.PONG }),
      };
    }

    // Check for required configuration
    if (!VALHEIM_INSTANCE_ID) {
      return {
        statusCode: 500,
        body: JSON.stringify({ 
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: '❌ Server configuration error: Missing instance ID' }
        })
      };
    }
    
    // Handle slash commands
    if (body.type === InteractionType.APPLICATION_COMMAND) {
      const { data, guild_id } = body;
      const command = data.name;

      console.log(`Processing command: ${command}`);

      switch (command) {
        case 'start':
          const worldName = data.options?.find((opt: any) => opt.name === 'world')?.value;
          if (worldName) {
            return await handleStartCommand(worldName, guild_id);
          } else {
            return await handleStartCommand(undefined, guild_id);
          }
        case 'stop':
          const forceStop = data.options?.find((opt: any) => opt.name === 'force')?.value || false;
          return await handleStopCommand(guild_id, forceStop);
        case 'status':
          return await handleStatusCommand();
        case 'worlds':
          return await handleWorldsCommand(data, guild_id);
        case 'backup':
          return await handleBackupCommand(data, guild_id);
        case 'hail':
          return await handleHailCommand();
        case 'help':
          return await handleHelpCommand();
        case 'setup':
          return await handleSetupCommand(body);
        default:
          return {
            statusCode: 200,
            body: JSON.stringify({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                content: 'Unknown command. Use /help to see available commands.',
              },
            }),
          };
      }
    }

    // Handle button/select menu interactions
    if (body.type === InteractionType.MESSAGE_COMPONENT) {
      return await handleComponentInteraction(body);
    }

    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ error: 'Unhandled interaction type' }),
    };

  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}

// Discord-compatible command handlers
async function handleStartCommand(worldName?: string, guildId?: string): Promise<APIGatewayProxyResult> {
  try {
    console.log(`🚀 Starting server command - worldName: ${worldName}, guildId: ${guildId}`);

    // Check current status
    const { status } = await getFastServerStatus();
    console.log(`📊 Current instance status: ${status}`);

    if (status === 'running') {
      return {
        statusCode: 200,
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            embeds: [{
              title: '✅ Server Already Running',
              description: 'The Valheim server is already online!',
              color: 0x00ff00,
              footer: { text: 'HuginBot • Use /status to see server details' }
            }]
          }
        })
      };
    }

    if (status === 'pending') {
      return {
        statusCode: 200,
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            embeds: [{
              title: '🚀 Server Already Starting',
              description: 'The server is currently booting up. Please wait a moment.',
              color: 0xffaa00,
              footer: { text: 'HuginBot • You\'ll be notified when the join code is ready' }
            }]
          }
        })
      };
    }

    // Handle world configuration
    let selectedWorldConfig: WorldConfig | undefined;

    if (worldName) {
      selectedWorldConfig = WORLD_CONFIGS.find(w =>
        w.name.toLowerCase() === worldName.toLowerCase() ||
        w.worldName.toLowerCase() === worldName.toLowerCase()
      );

      if (!selectedWorldConfig) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `❌ World "${worldName}" not found. Use /worlds list to see available worlds.`
            }
          })
        };
      }
    } else if (guildId) {
      // Check for guild-specific default world in SSM first
      try {
        const guildDefaultParam = getGuildDefaultWorldParam(guildId);
        const guildDefaultResult = await ssmClient.send(new GetParameterCommand({
          Name: guildDefaultParam
        }));
        if (guildDefaultResult.Parameter?.Value) {
          const defaultWorldName = guildDefaultResult.Parameter.Value;
          console.log(`📍 Found guild default world: ${defaultWorldName}`);
          selectedWorldConfig = WORLD_CONFIGS.find(w =>
            w.name.toLowerCase() === defaultWorldName.toLowerCase() ||
            w.worldName.toLowerCase() === defaultWorldName.toLowerCase()
          );
        }
      } catch (err) {
        // No guild default set, fall through to WORLD_CONFIGS filter
        console.log('ℹ️ No guild-specific default world set');
      }

      // Fall back to WORLD_CONFIGS filter if no SSM default
      if (!selectedWorldConfig) {
        const discordWorlds = WORLD_CONFIGS.filter(w => w.discordServerId === guildId);
        if (discordWorlds.length > 0) {
          selectedWorldConfig = discordWorlds[0];
        }
      }
    }

    if (selectedWorldConfig) {
      console.log(`🌍 Selected world: ${selectedWorldConfig.name} (${selectedWorldConfig.worldName})`);

      const validationErrors = validateWorldConfig(selectedWorldConfig);
      if (validationErrors.length > 0) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `❌ Invalid world configuration: ${validationErrors.join(', ')}`
            }
          })
        };
      }

      // Store active world configuration
      await withRetry(() =>
        ssmClient.send(new PutParameterCommand({
          Name: SSM_PARAMS.ACTIVE_WORLD,
          Value: JSON.stringify(selectedWorldConfig),
          Type: 'String',
          Overwrite: true
        }))
      );
      console.log(`✅ Active world configuration saved`);
    }

    // Clear any existing join code
    try {
      await withRetry(() =>
        ssmClient.send(new DeleteParameterCommand({ Name: SSM_PARAMS.PLAYFAB_JOIN_CODE }))
      );
      console.log(`🧹 Cleared existing PlayFab join code`);
    } catch (err) {
      console.log('ℹ️ No existing PlayFab parameters found to delete');
    }

    // Start the instance
    console.log(`🔄 Starting EC2 instance: ${VALHEIM_INSTANCE_ID}`);
    await withRetry(() => ec2Client.send(new StartInstancesCommand({
      InstanceIds: [VALHEIM_INSTANCE_ID]
    })));
    console.log(`✅ EC2 instance start command sent successfully`);

    const displayWorldName = selectedWorldConfig ? selectedWorldConfig.name : undefined;

    return {
      statusCode: 200,
      body: JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          embeds: [{
            title: '🚀 Valheim Server Starting',
            description: 'Server startup initiated successfully!\n\n' +
                        '**Timeline:**\n' +
                        '🔄 EC2 instance boots (30-60 seconds)\n' +
                        '📦 Docker container starts (1-2 minutes)\n' +
                        '🎮 Valheim server loads (2-3 minutes)\n\n' +
                        '**You\'ll get a notification here with the join code when the server is ready!**\n\n' +
                        '💡 Sit back and relax - everything is automatic from here.',
            color: 0x00ff00,
            fields: displayWorldName ? [{
              name: '🌍 World',
              value: displayWorldName,
              inline: true,
            }] : [],
            footer: {
              text: 'HuginBot • Auto-notifications enabled'
            },
            timestamp: new Date().toISOString(),
          }]
        }
      })
    };

  } catch (error) {
    console.error('❌ Error in handleStartCommand:', error);
    return {
      statusCode: 200,
      body: JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          embeds: [{
            title: '❌ Server Start Failed',
            description: 'Unable to start the server right now. Please try again in a moment.',
            color: 0xff0000,
            footer: { text: 'HuginBot • Contact admin if this persists' }
          }]
        }
      })
    };
  }
}


async function handleStopCommand(guildId?: string, force: boolean = false): Promise<APIGatewayProxyResult> {
  try {
    console.log(`🛑 Stopping server command initiated (force: ${force})`);

    // Check current status
    const { status } = await getFastServerStatus();
    console.log(`📊 Current instance status: ${status}`);

    if (status === 'stopped') {
      return {
        statusCode: 200,
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            embeds: [{
              title: '❌ Server Already Stopped',
              description: 'The server is not currently running.',
              color: 0xff6600,
              footer: { text: 'HuginBot • Use /start to launch the server' }
            }]
          }
        })
      };
    }

    if (status === 'stopping') {
      return {
        statusCode: 200,
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            embeds: [{
              title: '🛑 Server Already Stopping',
              description: 'The server is currently shutting down. Please wait.',
              color: 0xffaa00,
              footer: { text: 'HuginBot' }
            }]
          }
        })
      };
    }

    if (force) {
      // Force stop: skip backup, stop immediately
      console.log(`⚡ Force stop initiated - skipping backup`);

      await withRetry(() => ec2Client.send(new StopInstancesCommand({
        InstanceIds: [VALHEIM_INSTANCE_ID]
      })));
      console.log(`✅ EC2 instance force stopped successfully`);

      // Send EventBridge notification
      try {
        const { EventBridgeClient, PutEventsCommand } = await import('@aws-sdk/client-eventbridge');
        const eventBridgeClient = new EventBridgeClient({ region: process.env.AWS_REGION });

        await eventBridgeClient.send(new PutEventsCommand({
          Entries: [{
            Source: 'valheim.server',
            DetailType: 'Server.Stopped',
            Detail: JSON.stringify({
              reason: 'discord_force_stop',
              backupCompleted: false,
              backupError: 'Skipped (force stop)',
              timestamp: Date.now(),
              guildId: guildId || 'unknown'
            }),
            EventBusName: 'default'
          }]
        }));
      } catch (eventError) {
        console.error('⚠️ Failed to send EventBridge notification:', eventError);
      }

      return {
        statusCode: 200,
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            embeds: [{
              title: '⚡ Server Force Stopped',
              description: '**Emergency shutdown:**\n' +
                          '⚠️ Backup was skipped\n' +
                          '🛑 Server stopped immediately\n\n' +
                          '💡 World progress may be lost since last backup',
              color: 0xff0000,
              footer: { text: 'HuginBot • Use /stop without force for safe shutdown' }
            }]
          }
        })
      };
    }

    // Normal stop: trigger backup-and-stop script (fire and forget)
    console.log(`💾 Triggering backup-and-stop script`);

    await withRetry(() => ssmClient.send(new SendCommandCommand({
      DocumentName: 'AWS-RunShellScript',
      InstanceIds: [VALHEIM_INSTANCE_ID],
      Parameters: {
        'commands': ['/usr/local/bin/backup-and-stop.sh']
      },
      Comment: 'Backup and stop triggered via Discord stop command'
    })));

    console.log(`✅ Backup-and-stop script triggered (running in background)`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          embeds: [{
            title: '🛑 Valheim Server Stopping',
            description: '**Shutdown sequence initiated:**\n' +
                        '💾 Creating backup...\n' +
                        '🔄 Server will stop after backup completes\n\n' +
                        '💡 You\'ll receive notifications as the shutdown progresses',
            color: 0xff6600,
            footer: { text: 'HuginBot • Use "/stop force" to skip backup' }
          }]
        }
      })
    };

  } catch (error) {
    console.error('❌ Error in handleStopCommand:', error);
    return {
      statusCode: 200,
      body: JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          embeds: [{
            title: '❌ Server Stop Failed',
            description: 'Unable to stop the server right now. Please try again in a moment.',
            color: 0xff0000,
            footer: { text: 'HuginBot • Contact admin if this persists' }
          }]
        }
      })
    };
  }
}


async function handleStatusCommand(): Promise<APIGatewayProxyResult> {
  try {
    console.log(`📊 Getting server status details`);

    const { status, message: fastMessage, launchTime } = await getFastServerStatus();
    console.log(`📊 Server status retrieved: ${status}`);

    // Try to get active world and join code from SSM
    let activeWorld: string | undefined;
    let joinCode: string | undefined;

    if (status === 'running') {
      try {
        const worldResult = await ssmClient.send(new GetParameterCommand({
          Name: SSM_PARAMS.ACTIVE_WORLD
        }));
        if (worldResult.Parameter?.Value) {
          const worldConfig = JSON.parse(worldResult.Parameter.Value);
          activeWorld = worldConfig.name || worldConfig.worldName;
        }
      } catch (err) {
        console.log('No active world found in SSM');
      }

      try {
        const joinCodeResult = await ssmClient.send(new GetParameterCommand({
          Name: SSM_PARAMS.PLAYFAB_JOIN_CODE
        }));
        joinCode = joinCodeResult.Parameter?.Value;
      } catch (err) {
        console.log('No join code found yet - server may still be loading');
      }
    }

    // Determine server state
    let statusEmoji: string;
    let statusText: string;
    let description: string;
    let embedColor: number;

    if (status === 'stopped') {
      statusEmoji = '❌';
      statusText = 'Stopped';
      description = 'The server is currently offline.';
      embedColor = 0xff0000;
    } else if (status === 'stopping' || status === 'shutting-down') {
      statusEmoji = '🛑';
      statusText = 'Stopping';
      description = 'Server is shutting down...';
      embedColor = 0xff6600;
    } else if (status === 'running' && joinCode) {
      statusEmoji = '✅';
      statusText = 'Ready to Play!';
      description = 'The Valheim server is online and ready for adventure!';
      embedColor = 0x00ff00;
    } else if (status === 'running') {
      statusEmoji = '🔄';
      statusText = 'Booting';
      description = 'EC2 instance is running, Valheim server is loading...\n_This usually takes 2-4 minutes after EC2 starts._';
      embedColor = 0xffaa00;
    } else if (status === 'pending') {
      statusEmoji = '⏳';
      statusText = 'Starting';
      description = 'EC2 instance is booting up...';
      embedColor = 0xffaa00;
    } else {
      statusEmoji = '⚠️';
      statusText = 'Unknown';
      description = fastMessage;
      embedColor = 0xff6600;
    }

    let fields: Array<{name: string, value: string, inline: boolean}> = [
      {
        name: 'Status',
        value: `${statusEmoji} ${statusText}`,
        inline: true,
      }
    ];

    // Add world info if available
    if (activeWorld) {
      fields.push({
        name: 'World',
        value: `🌍 ${activeWorld}`,
        inline: true,
      });
    }

    // Add uptime if running
    if (status === 'running' && launchTime) {
      const uptimeMs = Date.now() - launchTime.getTime();
      const uptimeMinutes = Math.floor(uptimeMs / (1000 * 60));
      const uptimeHours = Math.floor(uptimeMinutes / 60);
      const remainingMinutes = uptimeMinutes % 60;

      fields.push({
        name: 'Uptime',
        value: uptimeHours > 0 ? `${uptimeHours}h ${remainingMinutes}m` : `${uptimeMinutes}m`,
        inline: true,
      });
    }

    // Add join code if available
    if (joinCode) {
      fields.push({
        name: 'Join Code',
        value: `\`${joinCode}\``,
        inline: false,
      });
      fields.push({
        name: 'How to Join',
        value: '1. Start game\n2. Join game\n3. Add Server\n4. Enter join code above',
        inline: false,
      });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          embeds: [{
            title: 'Valheim Server Status',
            description: description,
            color: embedColor,
            fields: fields,
            footer: {
              text: joinCode ? 'HuginBot • Use /stop when done playing' : 'HuginBot • Use /start to launch the server'
            },
            timestamp: new Date().toISOString(),
          }],
        },
      }),
    };
  } catch (error) {
    console.error('❌ Error in handleStatusCommand:', error);
    return {
      statusCode: 200,
      body: JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '❌ Failed to get server status. Please try again.',
        },
      }),
    };
  }
}

async function handleWorldsCommand(data: any, guildId: string): Promise<APIGatewayProxyResult> {
  const subcommand = data.options?.[0]?.name;

  if (subcommand === 'list') {
    const relevantWorlds = guildId
      ? WORLD_CONFIGS.filter(w => !w.discordServerId || w.discordServerId === guildId)
      : WORLD_CONFIGS;

    // Get current default for this guild
    let currentDefault: string | null = null;
    if (guildId) {
      try {
        const guildDefaultParam = getGuildDefaultWorldParam(guildId);
        const result = await ssmClient.send(new GetParameterCommand({ Name: guildDefaultParam }));
        currentDefault = result.Parameter?.Value || null;
      } catch (err) {
        // No default set
      }
    }

    if (relevantWorlds.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: '📋 No worlds configured for this server.',
          },
        }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          embeds: [{
            title: '🌍 Available Worlds',
            description: currentDefault
              ? `Default world: **${currentDefault}**\n\nThe following worlds are available:`
              : 'The following worlds are available:',
            color: 0x00aaff,
            fields: relevantWorlds.map(w => ({
              name: currentDefault && (w.name === currentDefault || w.worldName === currentDefault)
                ? `⭐ ${w.name}`
                : w.name,
              value: `Valheim world: ${w.worldName}`,
              inline: true,
            })),
            footer: {
              text: 'HuginBot • Use /worlds set-default <world> to change the default'
            }
          }],
        },
      }),
    };
  }

  if (subcommand === 'set-default') {
    const worldOption = data.options?.[0]?.options?.[0]?.value;

    if (!worldOption) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: '❌ Please specify a world name. Use `/worlds list` to see available worlds.',
          },
        }),
      };
    }

    // Find the world in WORLD_CONFIGS
    const worldConfig = WORLD_CONFIGS.find(w =>
      w.name.toLowerCase() === worldOption.toLowerCase() ||
      w.worldName.toLowerCase() === worldOption.toLowerCase()
    );

    if (!worldConfig) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `❌ World "${worldOption}" not found. Use \`/worlds list\` to see available worlds.`,
          },
        }),
      };
    }

    // Check if world is allowed for this guild
    if (worldConfig.discordServerId && worldConfig.discordServerId !== guildId) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `❌ World "${worldConfig.name}" is not available for this Discord server.`,
          },
        }),
      };
    }

    // Save the default world for this guild
    try {
      const guildDefaultParam = getGuildDefaultWorldParam(guildId);
      await ssmClient.send(new PutParameterCommand({
        Name: guildDefaultParam,
        Value: worldConfig.name,
        Type: 'String',
        Overwrite: true,
        Description: `Default world for Discord guild ${guildId}`
      }));

      return {
        statusCode: 200,
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            embeds: [{
              title: '⭐ Default World Set',
              description: `**${worldConfig.name}** is now the default world for this server.\n\nWhen you use \`/start\` without specifying a world, this world will be used.`,
              color: 0x00ff00,
              footer: {
                text: 'HuginBot • Use /start to launch the server'
              }
            }],
          },
        }),
      };
    } catch (error) {
      console.error('Failed to set default world:', error);
      return {
        statusCode: 200,
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: '❌ Failed to set default world. Please try again.',
          },
        }),
      };
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: 'Use `/worlds list` to see available worlds or `/worlds set-default <world>` to set a default.',
      },
    }),
  };
}

async function handleBackupCommand(data: any, guildId: string): Promise<APIGatewayProxyResult> {
  const subcommand = data.options?.[0]?.name || 'list';

  try {
    if (subcommand === 'create') {
      const status = await getInstanceStatus();
      
      if (status !== 'running') {
        return {
          statusCode: 200,
          body: JSON.stringify({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: '❌ Cannot create backup: Server is not running.',
            },
          }),
        };
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      
      await withRetry(() => ssmClient.send(new SendCommandCommand({
        DocumentName: 'AWS-RunShellScript',
        InstanceIds: [VALHEIM_INSTANCE_ID],
        Parameters: {
          'commands': ['/usr/local/bin/backup-valheim.sh']
        },
        Comment: `Manual backup triggered via Discord at ${timestamp}`
      })));

      return {
        statusCode: 200,
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: '💾 Backup initiated! This may take a few minutes to complete.',
            embeds: [{
              title: 'Backup Started',
              description: 'Creating a backup of the current world state.',
              color: 0x00aaff,
              footer: {
                text: 'HuginBot • Backup will appear in S3 bucket'
              },
              timestamp: new Date().toISOString(),
            }],
          },
        }),
      };
    } else {
      // List recent backups
      const listResponse = await withRetry(() => s3Client.send(new ListObjectsV2Command({
        Bucket: BACKUP_BUCKET_NAME,
        Prefix: 'worlds/',
        MaxKeys: 5
      })));

      const backups = listResponse.Contents ?
        listResponse.Contents
          .sort((a, b) => (b.LastModified?.getTime() || 0) - (a.LastModified?.getTime() || 0))
          .slice(0, 5)
          .map(item => {
            // Extract world name from S3 key: worlds/<WorldName>/valheim_backup_timestamp.tar.gz
            const keyParts = (item.Key || '').split('/');
            const worldName = keyParts.length >= 2 ? keyParts[1] : 'Unknown';

            const size = Math.round((item.Size || 0) / (1024 * 1024) * 10) / 10;
            const date = item.LastModified?.toISOString().replace('T', ' ').substring(0, 19) || 'Unknown';

            return {
              name: worldName,
              value: `${size} MB • ${date}`,
              inline: false
            };
          }) : [];

      return {
        statusCode: 200,
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            embeds: [{
              title: '💾 Recent Backups',
              description: backups.length > 0 ? 'Your most recent world backups:' : 'No backups found.',
              color: 0x00aaff,
              fields: backups,
              footer: {
                text: 'HuginBot • Use /backup create to make a new backup'
              }
            }],
          },
        }),
      };
    }
  } catch (error) {
    console.error('Error handling backup command:', error);
    return {
      statusCode: 200,
      body: JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '❌ Failed to handle backup request.',
        },
      }),
    };
  }
}

async function handleHailCommand(): Promise<APIGatewayProxyResult> {
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
  
  const randomIndex = Math.floor(Math.random() * responses.length);
  
  return {
    statusCode: 200,
    body: JSON.stringify({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        embeds: [{
          title: '🐦‍⬛ Hugin Speaks',
          description: responses[randomIndex],
          color: 0x2c2f33,
          thumbnail: {
            url: 'https://static.wikia.nocookie.net/valheim/images/7/7d/Hugin.png'
          },
          footer: {
            text: 'HuginBot • Wisdom of the All-Father'
          }
        }],
      },
    }),
  };
}

async function handleHelpCommand(): Promise<APIGatewayProxyResult> {
  return {
    statusCode: 200,
    body: JSON.stringify({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        embeds: [{
          title: '📚 HuginBot Help',
          description: 'HuginBot helps you manage your Valheim server from Discord.',
          color: 0x5865f2,
          fields: [
            {
              name: 'Server Commands',
              value: [
                '`/start [world]` - Start the Valheim server',
                '`/stop` - Stop the Valheim server',
                '`/status` - Check server status',
              ].join('\n'),
            },
            {
              name: 'World & Backup Commands',
              value: [
                '`/worlds list` - List available worlds',
                '`/backup list` - Show recent backups',
                '`/backup create` - Create a new backup',
              ].join('\n'),
            },
            {
              name: 'Setup & Fun',
              value: [
                '`/setup` - Set up server notifications',
                '`/hail` - Get wisdom from Hugin',
                '`/help` - Show this help menu',
              ].join('\n'),
            },
            {
              name: 'Getting Started',
              value: '1. Use `/setup` to configure notifications\n2. Use `/start` to launch the server\n3. Wait for the join code notification',
            },
          ],
          footer: {
            text: 'HuginBot • Valheim Server Manager'
          }
        }],
      },
    }),
  };
}

async function handleSetupCommand(interaction: any): Promise<APIGatewayProxyResult> {
  const { guild_id, channel_id, member, application_id, token } = interaction;

  // Check if user has permissions (manage webhooks) - do this immediately
  const permissions = BigInt(member.permissions);
  const MANAGE_WEBHOOKS = BigInt(1 << 29);
  
  if (!(permissions & MANAGE_WEBHOOKS)) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '❌ You need "Manage Webhooks" permission to use this command.',
          flags: 64, // Ephemeral
        },
      }),
    };
  }

  // Send deferred response immediately after permission check
  const deferredResponse = {
    statusCode: 200,
    body: JSON.stringify({
      type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    }),
  };

  // Perform the actual work asynchronously
  handleSetupCommandAsync(guild_id, channel_id, application_id, token).catch(error => {
    console.error('Error in handleSetupCommandAsync:', error);
  });

  return deferredResponse;
}

async function handleSetupCommandAsync(guild_id: string, channel_id: string, application_id: string, token: string): Promise<void> {

  try {
    // Check if a webhook already exists for this guild
    const existingWebhookParam = `/huginbot/discord-webhook/${guild_id}`;
    let existingWebhook = null;
    
    try {
      const result = await withRetry(() => ssmClient.send(new GetParameterCommand({
        Name: existingWebhookParam,
        WithDecryption: true
      })));
      existingWebhook = result.Parameter?.Value;
    } catch (err) {
      // No existing webhook, which is fine
      console.log('No existing webhook found for guild:', guild_id);
    }

    if (existingWebhook) {
      // Test if the existing webhook still works
      try {
        const testResponse = await fetch(existingWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: '✅ Webhook is already configured and working!',
            username: 'HuginBot'
          }),
        });

        if (testResponse.ok) {
          await sendFollowUpMessage(application_id, token, {
            content: '✅ This server already has notifications configured!',
            embeds: [{
              title: '📢 Notifications Active',
              description: 'HuginBot is already set up to send notifications to this channel.',
              color: 0x00ff00,
              fields: [{
                name: 'Need to change channels?',
                value: 'Delete the webhook in this channel\'s settings and run `/setup` in the new channel.',
                inline: false
              }],
              footer: {
                text: 'HuginBot • Ready for Adventure'
              }
            }],
          });
          return;
        }
      } catch (err) {
        console.log('Existing webhook is no longer valid, creating new one');
      }
    }

    // Create a new webhook using Discord's API
    const webhookName = 'HuginBot Notifications';
    const createWebhookUrl = `https://discord.com/api/v10/channels/${channel_id}/webhooks`;

    console.log('Creating webhook for channel:', channel_id);

    // Make the API call to create a webhook
    const botToken = process.env.DISCORD_BOT_TOKEN;
    
    if (!botToken) {
      console.error('DISCORD_BOT_TOKEN not configured');
      await sendFollowUpMessage(application_id, token, {
        content: '❌ Bot configuration error: Missing bot token. Please contact the administrator.',
        flags: 64,
      });
      return;
    }

    const createResponse = await fetch(createWebhookUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: webhookName,
        avatar: null, // You can add a base64 encoded image here if you want
      }),
    });

    if (!createResponse.ok) {
      const errorData = await createResponse.json();
      console.error('Failed to create webhook:', errorData);
      
      // Check if it's a permissions issue
      if (createResponse.status === 403) {
        await sendFollowUpMessage(application_id, token, {
          content: '❌ I don\'t have permission to create webhooks in this channel. Please ensure I have the "Manage Webhooks" permission.',
          flags: 64,
        });
        return;
      }
      
      throw new Error(`Failed to create webhook: ${errorData.message || 'Unknown error'}`);
    }

    const webhookData = await createResponse.json();
    const webhookUrl = `https://discord.com/api/webhooks/${webhookData.id}/${webhookData.token}`;

    console.log('Webhook created successfully:', webhookData.id);

    // Store the webhook URL in SSM
    await withRetry(() => ssmClient.send(new PutParameterCommand({
      Name: existingWebhookParam,
      Value: webhookUrl,
      Type: 'String',
      Overwrite: true,
      Description: `Discord webhook for guild ${guild_id} in channel ${channel_id}`,
    })));

    // Send a test message through the webhook
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'HuginBot',
        embeds: [{
          title: '🎉 Webhook Created Successfully!',
          description: 'I\'ll send server notifications to this channel.',
          color: 0x00ff00,
          fields: [
            {
              name: '📬 Notifications You\'ll Receive',
              value: '• Server startup announcements\n• PlayFab join codes\n• Server shutdown notices\n• Backup status updates',
              inline: false
            },
            {
              name: '🛠️ Next Steps',
              value: 'Use `/start` to launch the server and you\'ll see notifications here!',
              inline: false
            }
          ],
          footer: {
            text: 'HuginBot • Watching Over Your Realm',
            icon_url: 'https://static.wikia.nocookie.net/valheim/images/7/7d/Hugin.png'
          },
          timestamp: new Date().toISOString()
        }]
      }),
    });

    await sendFollowUpMessage(application_id, token, {
      content: '✅ Setup complete! Check the message above.',
      embeds: [{
        title: '✨ Notifications Configured',
        description: 'HuginBot will now send server updates to this channel.',
        color: 0x00ff00,
        footer: {
          text: 'HuginBot • Ready for Adventure'
        }
      }],
    });

  } catch (error) {
    console.error('Error in setup command:', error);
    await sendFollowUpMessage(application_id, token, {
      content: '❌ Failed to set up notifications. Please try again or create a webhook manually.',
      embeds: [{
        title: '⚠️ Setup Failed',
        description: `Error: ${error instanceof Error ? error.message : String(error)}`,
        color: 0xff0000,
        fields: [{
          name: 'Manual Setup',
          value: '1. Go to Channel Settings → Integrations → Webhooks\n2. Create a new webhook\n3. Contact your administrator to configure it',
          inline: false
        }],
        footer: {
          text: 'HuginBot • Contact Support if Issue Persists'
        }
      }],
      flags: 64, // Ephemeral for error messages
    });
  }
}

async function handleComponentInteraction(body: any): Promise<APIGatewayProxyResult> {
  const customId = body.data.custom_id;

  if (customId === 'status_refresh') {
    return await handleStatusCommand();
  }
  
  return {
    statusCode: 200,
    body: JSON.stringify({
      type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE,
    }),
  };
}
