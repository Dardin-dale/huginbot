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

// Enhanced sendFollowUpMessage with better error handling
async function sendFollowUpMessage(applicationId: string, token: string, content: any): Promise<void> {
  const followUpUrl = `https://discord.com/api/v10/webhooks/${applicationId}/${token}`;
  
  try {
    console.log(`📤 Sending follow-up message to Discord webhook`);
    
    const response = await fetch(followUpUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(content),
    });
    
    if (!response.ok) {
      const errorData = await response.text();
      console.error(`❌ Discord API error: ${response.status} ${response.statusText}`);
      console.error(`Error response: ${errorData}`);
      throw new Error(`Discord API returned ${response.status}: ${errorData}`);
    }
    
    console.log(`✅ Follow-up message sent successfully`);
    
  } catch (error) {
    console.error('❌ Error sending follow-up message:', error);
    console.error('Follow-up URL:', followUpUrl);
    console.error('Content:', JSON.stringify(content, null, 2));
    throw error; // Re-throw so calling function can handle it
  }
}

export async function handler(
  event: APIGatewayProxyEvent, 
  context: Context
): Promise<APIGatewayProxyResult> {
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
      const { data, guild_id, application_id, token } = body;
      const command = data.name;

      console.log(`Processing command: ${command}`);

      switch (command) {
        case 'start':
          const worldName = data.options?.find((opt: any) => opt.name === 'world')?.value;
          if (worldName) {
            return await handleStartCommand(worldName, guild_id, application_id, token);
          } else {
            return await handleStartCommand(undefined, guild_id, application_id, token);
          }
        case 'stop':
          return await handleStopCommand(application_id, token);
        case 'status':
          return await handleStatusCommand(application_id, token);
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
async function handleStartCommand(worldName?: string, guildId?: string, applicationId?: string, token?: string): Promise<APIGatewayProxyResult> {
  // Send deferred response immediately
  const deferredResponse = {
    statusCode: 200,
    body: JSON.stringify({
      type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    }),
  };

  // Perform the actual work asynchronously
  if (applicationId && token) {
    handleStartCommandAsync(worldName, guildId, applicationId, token).catch(error => {
      console.error('Error in handleStartCommandAsync:', error);
    });
  }

  return deferredResponse;
}

async function handleStartCommandAsync(worldName?: string, guildId?: string, applicationId?: string, token?: string): Promise<void> {
  if (!applicationId || !token) {
    console.error('Missing applicationId or token for follow-up message');
    return;
  }

  try {
    console.log(`🚀 Starting server command - worldName: ${worldName}, guildId: ${guildId}`);
    
    // Check instance status with timeout - use fast check for start command
    const status = await Promise.race([
      getInstanceStatus(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('getInstanceStatus timeout')), 10000)
      )
    ]) as string;
    
    console.log(`📊 Current instance status: ${status}`);
    
    if (status === 'running') {
      await sendFollowUpMessage(applicationId, token, {
        content: '✅ Server is already running!',
      });
      return;
    }

    if (status === 'pending') {
      await sendFollowUpMessage(applicationId, token, {
        content: '🚀 Server is already starting!',
      });
      return;
    }

    // Handle world configuration 
    let selectedWorldConfig: WorldConfig | undefined;
    
    if (worldName) {
      // Find specific world by name
      selectedWorldConfig = WORLD_CONFIGS.find(w => 
        w.name.toLowerCase() === worldName.toLowerCase() || 
        w.worldName.toLowerCase() === worldName.toLowerCase()
      );
      
      if (!selectedWorldConfig) {
        await sendFollowUpMessage(applicationId, token, {
          content: `❌ World "${worldName}" not found. Use /worlds list to see available worlds.`,
        });
        return;
      }
    } else if (guildId) {
      // Find worlds for this Discord server
      const discordWorlds = WORLD_CONFIGS.filter(w => w.discordServerId === guildId);
      
      if (discordWorlds.length > 0) {
        // Use the first world for this Discord server
        selectedWorldConfig = discordWorlds[0];
      }
    }
    
    if (selectedWorldConfig) {
      console.log(`🌍 Selected world: ${selectedWorldConfig.name} (${selectedWorldConfig.worldName})`);
      
      const validationErrors = validateWorldConfig(selectedWorldConfig);
      if (validationErrors.length > 0) {
        await sendFollowUpMessage(applicationId, token, {
          content: `❌ Invalid world configuration: ${validationErrors.join(', ')}`,
        });
        return;
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

    // Clear any existing PlayFab join codes
    try {
      await withRetry(() =>
        ssmClient.send(new DeleteParameterCommand({
          Name: SSM_PARAMS.PLAYFAB_JOIN_CODE
        }))
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

    await sendFollowUpMessage(applicationId, token, {
      content: '🚀 Starting Valheim server... This may take 5-10 minutes.',
      embeds: [{
        title: 'Server Starting',
        description: 'The server is being started. You\'ll receive a notification when it\'s ready.',
        color: 0xffaa00,
        fields: displayWorldName ? [{
          name: 'World',
          value: displayWorldName,
          inline: true,
        }] : [],
        footer: {
          text: 'HuginBot • Valheim Server Manager'
        },
        timestamp: new Date().toISOString(),
      }],
    });
    
    console.log(`✅ Start command completed successfully`);
    
  } catch (error) {
    console.error('❌ Error in handleStartCommandAsync:', error);
    console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace');
    
    if (applicationId && token) {
      try {
        await sendFollowUpMessage(applicationId, token, {
          content: `❌ Failed to start server: ${error instanceof Error ? error.message : 'Unknown error'}`,
          embeds: [{
            title: 'Start Command Failed',
            description: 'There was an error starting the server. Please check the logs or try again.',
            color: 0xff0000,
            fields: [{
              name: 'Error Details',
              value: error instanceof Error ? error.message : String(error),
              inline: false
            }],
            footer: {
              text: 'HuginBot • Contact administrator if this persists'
            }
          }]
        });
      } catch (followUpError) {
        console.error('❌ Failed to send error follow-up message:', followUpError);
      }
    }
  }
}

async function handleStopCommand(applicationId?: string, token?: string): Promise<APIGatewayProxyResult> {
  // Send deferred response immediately
  const deferredResponse = {
    statusCode: 200,
    body: JSON.stringify({
      type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    }),
  };

  // Perform the actual work asynchronously
  if (applicationId && token) {
    handleStopCommandAsync(applicationId, token).catch(error => {
      console.error('Error in handleStopCommandAsync:', error);
      sendFollowUpMessage(applicationId, token, {
        content: '❌ An unexpected error occurred while stopping the server. Please try again.',
      }).catch(followUpError => {
        console.error('Failed to send error follow-up message:', followUpError);
      });
    });
  }

  return deferredResponse;
}

async function handleStopCommandAsync(applicationId: string, token: string): Promise<void> {
  console.log('handleStopCommandAsync called with applicationId:', applicationId, 'token length:', token?.length);
  try {
    console.log(`🛑 Stopping server command initiated`);
    
    // Check instance status with timeout - use fast check for stop command
    const status = await Promise.race([
      getInstanceStatus(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('getInstanceStatus timeout')), 10000)
      )
    ]) as string;
    
    console.log(`📊 Current instance status: ${status}`);
    
    if (status === 'stopped') {
      await sendFollowUpMessage(applicationId, token, {
        content: '❌ Server is already stopped.',
      });
      return;
    }

    if (status === 'stopping') {
      await sendFollowUpMessage(applicationId, token, {
        content: '🛑 Server is already stopping.',
      });
      return;
    }

    // Trigger backup before shutdown using container's built-in backup system
    console.log(`💾 Triggering pre-shutdown backup`);
    try {
      await withRetry(() => ssmClient.send(new SendCommandCommand({
        DocumentName: 'AWS-RunShellScript',
        InstanceIds: [VALHEIM_INSTANCE_ID],
        Parameters: {
          'commands': [
            '# Trigger container backup using SIGHUP signal',
            'docker exec valheim-server pkill -HUP valheim-backup || true',
            '# Wait a moment for backup to start',
            'sleep 5',
            '# Check if backup is running (optional verification)',
            'docker exec valheim-server pgrep -f valheim-backup && echo "Backup triggered successfully" || echo "Backup may have completed or failed"'
          ]
        },
        Comment: 'Pre-shutdown backup triggered via Discord stop command'
      })));
      console.log(`✅ Pre-shutdown backup command sent`);
    } catch (backupError) {
      console.error('⚠️ Pre-shutdown backup failed, proceeding with shutdown:', backupError);
      // Don't block shutdown if backup fails
    }

    console.log(`🔄 Stopping EC2 instance: ${VALHEIM_INSTANCE_ID}`);
    await withRetry(() => ec2Client.send(new StopInstancesCommand({
      InstanceIds: [VALHEIM_INSTANCE_ID]
    })));
    console.log(`✅ EC2 instance stop command sent successfully`);

    await sendFollowUpMessage(applicationId, token, {
      content: '🛑 Stopping Valheim server...',
      embeds: [{
        title: 'Server Stopping',
        description: 'The server is being shut down. Make sure to save your progress!',
        color: 0xff0000,
        footer: {
          text: 'HuginBot • Valheim Server Manager'
        },
        timestamp: new Date().toISOString(),
      }],
    });
    
    console.log(`✅ Stop command completed successfully`);
    
  } catch (error) {
    console.error('❌ Error in handleStopCommandAsync:', error);
    console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace');
    
    try {
      await sendFollowUpMessage(applicationId, token, {
        content: `❌ Failed to stop server: ${error instanceof Error ? error.message : 'Unknown error'}`,
        embeds: [{
          title: 'Stop Command Failed',
          description: 'There was an error stopping the server. Please check the logs or try again.',
          color: 0xff0000,
          fields: [{
            name: 'Error Details',
            value: error instanceof Error ? error.message : String(error),
            inline: false
          }],
          footer: {
            text: 'HuginBot • Contact administrator if this persists'
          }
        }]
      });
    } catch (followUpError) {
      console.error('❌ Failed to send error follow-up message:', followUpError);
    }
  }
}

async function handleStatusCommand(applicationId?: string, token?: string): Promise<APIGatewayProxyResult> {
  // Send deferred response immediately
  const deferredResponse = {
    statusCode: 200,
    body: JSON.stringify({
      type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    }),
  };

  // Perform the actual work asynchronously
  if (applicationId && token) {
    handleStatusCommandAsync(applicationId, token).catch(error => {
      console.error('Error in handleStatusCommandAsync:', error);
      sendFollowUpMessage(applicationId, token, {
        content: '❌ An unexpected error occurred while checking server status. Please try again.',
      }).catch(followUpError => {
        console.error('Failed to send error follow-up message:', followUpError);
      });
    });
  }

  return deferredResponse;
}

async function handleStatusCommandAsync(applicationId: string, token: string): Promise<void> {
  console.log('handleStatusCommandAsync called with applicationId:', applicationId, 'token length:', token?.length);
  try {
    console.log(`📊 Status check command initiated with progressive loading`);
    
    // Step 1: Get fast status and send initial response
    const { status, message: fastMessage, launchTime } = await Promise.race([
      getFastServerStatus(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('getFastServerStatus timeout')), 10000)
      )
    ]) as any;
    
    console.log(`📊 Fast server status retrieved: ${status}`);
    
    const statusEmoji = status === 'running' ? '✅' : status === 'stopped' ? '❌' : '⏳';
    
    let initialFields = [
      {
        name: 'Status',
        value: `${statusEmoji} ${status}`,
        inline: true,
      }
    ];

    if (status === 'running' && launchTime) {
      const uptimeMs = Date.now() - launchTime.getTime();
      const uptimeMinutes = Math.floor(uptimeMs / (1000 * 60));
      const uptimeHours = Math.floor(uptimeMinutes / 60);
      const remainingMinutes = uptimeMinutes % 60;
      
      initialFields.push({
        name: 'Uptime',
        value: uptimeHours > 0 ? `${uptimeHours}h ${remainingMinutes}m` : `${uptimeMinutes}m`,
        inline: true,
      });
    }

    // Add a loading indicator if server is running
    if (status === 'running') {
      initialFields.push({
        name: 'Server Details',
        value: '🔄 Checking server readiness...',
        inline: false,
      });
    }

    // Send initial fast response
    await sendFollowUpMessage(applicationId, token, {
      embeds: [{
        title: 'Valheim Server Status',
        description: fastMessage,
        color: status === 'running' ? 0x00ff00 : status === 'stopped' ? 0xff0000 : 0xffaa00,
        fields: initialFields,
        footer: {
          text: 'HuginBot • Use /start to launch the server'
        },
        timestamp: new Date().toISOString(),
      }]
    });

    // Step 2: If server is running, get detailed status and update
    if (status === 'running') {
      try {
        console.log(`📊 Getting detailed status for running server`);
        
        const detailedStatus = await Promise.race([
          getDetailedServerStatus(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('getDetailedServerStatus timeout')), 20000)
          )
        ]) as any;
        
        const { message: detailedMessage, isReady, joinCode } = detailedStatus;
        console.log(`📊 Detailed server status retrieved: ready: ${isReady}, hasJoinCode: ${!!joinCode}`);
        
        // Update the fields with detailed information
        let updatedFields = [
          {
            name: 'Status',
            value: `${statusEmoji} ${status}`,
            inline: true,
          }
        ];

        if (launchTime) {
          const uptimeMs = Date.now() - launchTime.getTime();
          const uptimeMinutes = Math.floor(uptimeMs / (1000 * 60));
          const uptimeHours = Math.floor(uptimeMinutes / 60);
          const remainingMinutes = uptimeMinutes % 60;
          
          updatedFields.push({
            name: 'Uptime',
            value: uptimeHours > 0 ? `${uptimeHours}h ${remainingMinutes}m` : `${uptimeMinutes}m`,
            inline: true,
          });
        }

        if (isReady && joinCode) {
          updatedFields.push({
            name: 'PlayFab Join Code',
            value: `\`${joinCode}\``,
            inline: false,
          });
        } else if (status === 'running') {
          updatedFields.push({
            name: 'Server Details',
            value: '⏳ Server is starting up, join code not yet available',
            inline: false,
          });
        }

        // Send updated response with detailed information
        await sendFollowUpMessage(applicationId, token, {
          embeds: [{
            title: 'Valheim Server Status',
            description: detailedMessage,
            color: isReady ? 0x00ff00 : 0xffaa00,
            fields: updatedFields,
            footer: {
              text: 'HuginBot • Use /start to launch the server'
            },
            timestamp: new Date().toISOString(),
          }],
          components: [{
            type: 1,
            components: [{
              type: 2,
              style: 2,
              label: "Refresh Status",
              custom_id: "status_refresh",
              emoji: { name: "🔄" }
            }]
          }]
        });
        
      } catch (detailError) {
        console.error('Failed to get detailed status, keeping fast response:', detailError);
        // Don't send another message if detailed status fails - the fast response is sufficient
      }
    } else {
      // For non-running servers, add the refresh button to the initial response
      await sendFollowUpMessage(applicationId, token, {
        embeds: [{
          title: 'Valheim Server Status',
          description: fastMessage,
          color: status === 'running' ? 0x00ff00 : status === 'stopped' ? 0xff0000 : 0xffaa00,
          fields: initialFields,
          footer: {
            text: 'HuginBot • Use /start to launch the server'
          },
          timestamp: new Date().toISOString(),
        }],
        components: [{
          type: 1,
          components: [{
            type: 2,
            style: 2,
            label: "Refresh Status",
            custom_id: "status_refresh",
            emoji: { name: "🔄" }
          }]
        }]
      });
    }
    
    console.log(`✅ Status command completed successfully`);
    
  } catch (error) {
    console.error('❌ Error in handleStatusCommandAsync:', error);
    console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace');
    
    try {
      await sendFollowUpMessage(applicationId, token, {
        content: `❌ Failed to check server status: ${error instanceof Error ? error.message : 'Unknown error'}`,
        embeds: [{
          title: 'Status Check Failed',
          description: 'There was an error checking the server status. Please try again.',
          color: 0xff0000,
          fields: [{
            name: 'Error Details',
            value: error instanceof Error ? error.message : String(error),
            inline: false
          }],
          footer: {
            text: 'HuginBot • Contact administrator if this persists'
          }
        }]
      });
    } catch (followUpError) {
      console.error('❌ Failed to send error follow-up message:', followUpError);
    }
  }
}

async function handleWorldsCommand(data: any, guildId: string): Promise<APIGatewayProxyResult> {
  const subcommand = data.options?.[0]?.name;

  if (subcommand === 'list') {
    const relevantWorlds = guildId
      ? WORLD_CONFIGS.filter(w => !w.discordServerId || w.discordServerId === guildId)
      : WORLD_CONFIGS;

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
            description: 'The following worlds are available:',
            color: 0x00aaff,
            fields: relevantWorlds.map(w => ({
              name: w.name,
              value: `Valheim world: ${w.worldName}`,
              inline: true,
            })),
            footer: {
              text: 'HuginBot • Use /start <world> to launch a specific world'
            }
          }],
        },
      }),
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: 'Use `/worlds list` to see available worlds.',
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
            const filename = item.Key?.split('/').pop() || '';
            const size = Math.round((item.Size || 0) / (1024 * 1024) * 10) / 10;
            const date = item.LastModified?.toISOString().replace('T', ' ').substring(0, 19) || 'Unknown';
            
            return {
              name: filename,
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
  const { application_id, token } = body;
  
  if (customId === 'status_refresh') {
    return await handleStatusCommand(application_id, token);
  }
  
  return {
    statusCode: 200,
    body: JSON.stringify({
      type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE,
    }),
  };
}
