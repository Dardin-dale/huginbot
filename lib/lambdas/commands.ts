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
        body: JSON.stringify({ error: 'Unauthorized' }),
      };
    }

    // Verify the request is from Discord using the official discord-interactions package
    const isValidRequest = verifyKey(
      event.body || '',
      signature,
      timestamp,
      publicKey
    );

    if (!isValidRequest) {
      console.error('Invalid request signature');
      console.error('Body length:', (event.body || '').length);
      console.error('Signature length:', signature.length);
      console.error('Timestamp:', timestamp);
      console.error('Public key length:', publicKey.length);
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Invalid request signature' }),
      };
    }

    const body = JSON.parse(event.body || '{}');

    // Handle Discord PING (verification)
    if (body.type === InteractionType.PING) {
      console.log('Received PING, responding with PONG');
      return {
        statusCode: 200,
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
          return await handleStopCommand();
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
      body: JSON.stringify({ error: 'Unhandled interaction type' }),
    };

  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}

// Discord-compatible command handlers
async function handleStartCommand(worldName?: string, guildId?: string): Promise<APIGatewayProxyResult> {
  try {
    // Check instance status
    const status = await getInstanceStatus();
    
    if (status === 'running') {
      return {
        statusCode: 200,
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: '✅ Server is already running!',
          },
        }),
      };
    }

    if (status === 'pending') {
      return {
        statusCode: 200,
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: '🚀 Server is already starting!',
          },
        }),
      };
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
        return {
          statusCode: 200,
          body: JSON.stringify({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `❌ World "${worldName}" not found. Use /worlds list to see available worlds.`,
            },
          }),
        };
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
      // Validate and set active world
      const validationErrors = validateWorldConfig(selectedWorldConfig);
      if (validationErrors.length > 0) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `❌ Invalid world configuration: ${validationErrors.join(', ')}`,
            },
          }),
        };
      }
      
      await withRetry(() => 
        ssmClient.send(new PutParameterCommand({
          Name: SSM_PARAMS.ACTIVE_WORLD,
          Value: JSON.stringify(selectedWorldConfig),
          Type: 'String',
          Overwrite: true
        }))
      );
    }

    // Clear any existing PlayFab join codes
    try {
      await withRetry(() =>
        ssmClient.send(new DeleteParameterCommand({
          Name: SSM_PARAMS.PLAYFAB_JOIN_CODE
        }))
      );
    } catch (err) {
      console.log('No PlayFab parameters found to delete');
    }

    // Start the instance
    await withRetry(() => ec2Client.send(new StartInstancesCommand({
      InstanceIds: [VALHEIM_INSTANCE_ID]
    })));

    const displayWorldName = selectedWorldConfig ? selectedWorldConfig.name : undefined;

    return {
      statusCode: 200,
      body: JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
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
        },
      }),
    };
  } catch (error) {
    console.error('Error starting server:', error);
    return {
      statusCode: 200,
      body: JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '❌ Failed to start server. Please try again later.',
        },
      }),
    };
  }
}

async function handleStopCommand(): Promise<APIGatewayProxyResult> {
  try {
    const status = await getInstanceStatus();
    
    if (status === 'stopped') {
      return {
        statusCode: 200,
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: '❌ Server is already stopped.',
          },
        }),
      };
    }

    if (status === 'stopping') {
      return {
        statusCode: 200,
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: '🛑 Server is already stopping.',
          },
        }),
      };
    }

    await withRetry(() => ec2Client.send(new StopInstancesCommand({
      InstanceIds: [VALHEIM_INSTANCE_ID]
    })));

    return {
      statusCode: 200,
      body: JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
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
        },
      }),
    };
  } catch (error) {
    console.error('Error stopping server:', error);
    return {
      statusCode: 200,
      body: JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '❌ Failed to stop server. Please try again later.',
        },
      }),
    };
  }
}

async function handleStatusCommand(): Promise<APIGatewayProxyResult> {
  try {
    const { 
      status, 
      message, 
      isReady, 
      isServerRunning, 
      joinCode, 
      launchTime 
    } = await getDetailedServerStatus();

    const statusEmoji = status === 'running' ? '✅' : status === 'stopped' ? '❌' : '⏳';
    
    const fields = [
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
      
      fields.push({
        name: 'Uptime',
        value: uptimeHours > 0 ? `${uptimeHours}h ${remainingMinutes}m` : `${uptimeMinutes}m`,
        inline: true,
      });
    }

    if (isReady && joinCode) {
      fields.push({
        name: 'PlayFab Join Code',
        value: `\`${joinCode}\``,
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
            description: message,
            color: status === 'running' ? 0x00ff00 : status === 'stopped' ? 0xff0000 : 0xffaa00,
            fields: fields,
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
        },
      }),
    };
  } catch (error) {
    console.error('Error checking status:', error);
    return {
      statusCode: 200,
      body: JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '❌ Failed to check server status.',
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
  const { guild_id, channel_id, member } = interaction;

  // Check if user has permissions (manage webhooks)
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

  try {
    await withRetry(() => ssmClient.send(new PutParameterCommand({
      Name: `/huginbot/discord-webhook-setup/${guild_id}`,
      Value: JSON.stringify({
        channelId: channel_id,
        requestedBy: member.user.id,
        requestedAt: new Date().toISOString(),
      }),
      Type: 'String',
      Overwrite: true,
    })));

    return {
      statusCode: 200,
      body: JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '✅ Webhook setup initiated! The bot will create a webhook in this channel.',
          embeds: [{
            title: 'Setup Instructions',
            description: 'A webhook has been created for server notifications in this channel.',
            color: 0x00ff00,
            fields: [
              {
                name: 'What happens next?',
                value: 'You will receive server start/stop notifications in this channel.',
              },
            ],
            footer: {
              text: 'HuginBot • Setup Complete'
            }
          }],
          flags: 64, // Ephemeral
        },
      }),
    };
  } catch (error) {
    console.error('Error setting up webhook:', error);
    return {
      statusCode: 200,
      body: JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '❌ Failed to set up webhook. Please try again later.',
          flags: 64, // Ephemeral
        },
      }),
    };
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
