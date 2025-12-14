import { EventBridgeEvent, Context } from 'aws-lambda';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import axios from 'axios';

// Create AWS clients
const ssmClient = new SSMClient();

// SSM Parameter names
const PLAYFAB_JOIN_CODE_PARAM = '/huginbot/playfab-join-code';
const ACTIVE_WORLD_PARAM = '/huginbot/active-world';
const DISCORD_WEBHOOK_BASE = '/huginbot/discord-webhook';

// Track last detailed server stop notification to avoid duplicates from EC2 fallback
let lastDetailedStopNotification = 0;

/**
 * Get Discord webhook URL from SSM Parameter Store
 * Cost-optimized: Uses free SSM parameters instead of Secrets Manager
 */
async function getWebhookUrl(): Promise<string> {
  // First, try to get the guild ID from active world
  let guildId: string | undefined;
  
  try {
    const activeWorldResult = await ssmClient.send(new GetParameterCommand({
      Name: ACTIVE_WORLD_PARAM
    }));
    
    if (activeWorldResult.Parameter?.Value) {
      const worldConfig = JSON.parse(activeWorldResult.Parameter.Value);
      guildId = worldConfig.discordServerId;
    }
  } catch (err) {
    console.log('No active world found, will try to find any configured webhook');
  }
  
  // If we have a guild ID, try to get its webhook
  if (guildId) {
    try {
      const webhookResult = await ssmClient.send(new GetParameterCommand({
        Name: `${DISCORD_WEBHOOK_BASE}/${guildId}`
      }));
      
      if (webhookResult.Parameter?.Value) {
        return webhookResult.Parameter.Value;
      }
    } catch (err) {
      console.log(`No webhook found for guild ${guildId}`);
    }
  }
  
  // If no guild-specific webhook found, log warning and continue silently
  console.warn('No webhook found for active world, notifications will not be sent');
  throw new Error('No Discord webhook configured - use /setup command in Discord');
}

export async function handler(
  event: EventBridgeEvent<string, any>,
  context: Context
): Promise<void> {
  console.log('Event received:', JSON.stringify(event, null, 2));

  try {
    const eventType = event['detail-type'];
    console.log(`Processing event type: ${eventType}`);

    let message: any;

    switch (eventType) {
      case 'PlayFab.JoinCodeDetected':
        message = await handleJoinCodeEvent(event.detail);
        break;
      case 'Backup.Completed':
        message = await handleBackupCompletedEvent(event.detail);
        break;
      case 'Server.Stopped':
        message = await handleServerStoppedEvent(event.detail);
        break;
      case 'EC2 Instance State-change Notification':
        // EC2 instance stopped - fallback notification
        if (event.detail.state === 'stopped') {
          message = await handleEC2StoppedEvent(event.detail);
        }
        break;
      default:
        console.log(`Unknown event type: ${eventType}`);
        return;
    }

    if (!message) {
      console.log('No message to send');
      return;
    }

    // Get webhook URL from SSM and send notification
    try {
      const webhookUrl = await getWebhookUrl();
      await axios.post(webhookUrl, message);
      console.log(`Discord notification sent successfully for ${eventType}`);
    } catch (error) {
      console.error('Failed to send Discord notification:', error);
      // Don't throw - we don't want to fail the whole Lambda just because Discord notification failed
    }
  } catch (error) {
    console.error('Error in notification handler:', error);
  }
}

async function handleJoinCodeEvent(detail: any): Promise<any> {
  const joinCode = detail.joinCode;

  if (!joinCode) {
    console.error('No join code provided in event');
    return null;
  }

  // Get the active world configuration
  let worldName = 'Default';
  let serverPassword = '*****';
  try {
    const paramResult = await ssmClient.send(new GetParameterCommand({
      Name: ACTIVE_WORLD_PARAM
    }));

    if (paramResult.Parameter?.Value) {
      const worldConfig = JSON.parse(paramResult.Parameter.Value);
      worldName = worldConfig.name;
      serverPassword = worldConfig.serverPassword || '*****';
    }
  } catch (err) {
    console.log('No active world parameter found, using default');
  }

  return {
    username: "HuginBot",
    avatar_url: "https://cdn.discordapp.com/attachments/1085270430593589338/1446033918343254016/Valheim-Listen-to-Hugin-Raven.jpg",
    embeds: [
      {
        title: "🎮 Valheim Server Ready!",
        description: `Your Valheim journey awaits! The server is now online and ready for adventure.`,
        color: 0x33cc33, // Green color
        fields: [
          {
            name: "World",
            value: worldName,
            inline: true
          },
          {
            name: "Join Code",
            value: `\`${joinCode}\``,
            inline: true
          },
          {
            name: "Server Password",
            value: `||${serverPassword}||`, // Spoiler tag to hide password
            inline: true
          },
          {
            name: "How to Join",
            value: "1. Start game\n2. Join game\n3. Add Server\n4. Enter join code above",
            inline: false
          }
        ],
        footer: {
          text: "HuginBot • Server will auto-shutdown after inactivity • Type /help for commands",
          icon_url: "https://static.wikia.nocookie.net/valheim/images/7/7d/Hugin.png"
        },
        timestamp: new Date().toISOString()
      }
    ]
  };
}

async function handleBackupCompletedEvent(detail: any): Promise<any> {
  const { worldName, size, s3Uri } = detail;
  const sizeMB = Math.round(size / (1024 * 1024) * 10) / 10;

  return {
    username: "HuginBot",
    avatar_url: "https://media.discordapp.net/attachments/1085270430593589338/1446033918343254016/Valheim-Listen-to-Hugin-Raven.jpg",
    embeds: [
      {
        title: "💾 Backup Completed",
        description: `World backup has been saved successfully.`,
        color: 0x3498db, // Blue color
        fields: [
          {
            name: "World",
            value: worldName || 'Unknown',
            inline: true
          },
          {
            name: "Size",
            value: `${sizeMB} MB`,
            inline: true
          }
        ],
        footer: {
          text: "HuginBot • Use /backup list to see all backups"
        },
        timestamp: new Date().toISOString()
      }
    ]
  };
}

async function handleServerStoppedEvent(detail: any): Promise<any> {
  const { backupCompleted, backupError, reason, playerCount, idleTimeMinutes } = detail;

  // Record that we sent a detailed notification
  lastDetailedStopNotification = Date.now();

  let description = '**Shutdown complete**';
  const color = backupCompleted ? 0x2ecc71 : 0xe67e22; // Green if backup ok, orange if not

  const fields: any[] = [];

  if (backupCompleted) {
    fields.push({
      name: "💾 Backup",
      value: "✅ Completed successfully",
      inline: true
    });
  } else if (backupError) {
    fields.push({
      name: "💾 Backup",
      value: `⚠️ ${backupError}`,
      inline: true
    });
  }

  if (reason === 'discord_force_stop') {
    description = '**Emergency shutdown complete**\n⚠️ Backup was skipped';
  } else if (reason === 'auto_shutdown') {
    description = `**Auto-shutdown: Server idle**\n🕒 No players for ${idleTimeMinutes || 'several'} minutes`;
    fields.push({
      name: "👥 Final Player Count",
      value: `${playerCount ?? 0}`,
      inline: true
    });
  }

  return {
    username: "HuginBot",
    avatar_url: "https://media.discordapp.net/attachments/1085270430593589338/1446033918343254016/Valheim-Listen-to-Hugin-Raven.jpg",
    embeds: [
      {
        title: "🛑 Server Stopped",
        description: description,
        color: color,
        fields: fields,
        footer: {
          text: "HuginBot • Use /start when you want to play again"
        },
        timestamp: new Date().toISOString()
      }
    ]
  };
}

async function handleEC2StoppedEvent(detail: any): Promise<any> {
  // This is a fallback notification when EC2 stops but we didn't get a script event
  // This happens during auto-shutdown when the instance stops before the event is sent

  // Skip if we sent a detailed notification recently (within 2 minutes)
  const timeSinceLastDetailed = Date.now() - lastDetailedStopNotification;
  if (timeSinceLastDetailed < 120000) {
    console.log(`Skipping EC2 fallback - detailed notification sent ${timeSinceLastDetailed}ms ago`);
    return null;
  }

  const time = detail.time ? new Date(detail.time) : new Date();

  return {
    username: "HuginBot",
    avatar_url: "https://media.discordapp.net/attachments/1085270430593589338/1446033918343254016/Valheim-Listen-to-Hugin-Raven.jpg",
    embeds: [
      {
        title: "🛑 Server Stopped",
        description: "**Server has shut down**",
        color: 0x95a5a6, // Gray color for unknown status
        fields: [
          {
            name: "ℹ️ Status",
            value: "Instance stopped (auto-shutdown or manual stop)",
            inline: false
          }
        ],
        footer: {
          text: "HuginBot • Use /start when you want to play again"
        },
        timestamp: time.toISOString()
      }
    ]
  };
}
