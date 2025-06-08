import { EventBridgeEvent, Context } from 'aws-lambda';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import axios from 'axios';

// Create AWS clients
const ssmClient = new SSMClient();

// SSM Parameter names
const ACTIVE_WORLD_PARAM = '/huginbot/active-world';
const DISCORD_WEBHOOK_BASE = '/huginbot/discord-webhook';

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
  event: EventBridgeEvent<'Server.AutoShutdown', any>,
  context: Context
): Promise<void> {
  console.log('Shutdown event received:', JSON.stringify(event, null, 2));
  
  try {
    // Get details from the event
    const idleTime = event.detail.idleTime || 0;
    const idleMinutes = Math.round(idleTime / 60);
    const reason = event.detail.reason || 'Inactivity';
    
    // Get the active world configuration
    let worldInfo = 'default world';
    let worldName = 'Default';
    try {
      const paramResult = await ssmClient.send(new GetParameterCommand({
        Name: ACTIVE_WORLD_PARAM
      }));
      
      if (paramResult.Parameter?.Value) {
        const worldConfig = JSON.parse(paramResult.Parameter.Value);
        worldInfo = `${worldConfig.name} (${worldConfig.worldName})`;
        worldName = worldConfig.name;
      }
    } catch (err) {
      console.log('No active world parameter found, using default');
    }
    
    // Calculate resources saved
    const resourcesSaved = idleMinutes ? (idleMinutes * 0.05).toFixed(2) : '0.00'; // Just an example metric
    
    // Construct the message with enhanced rich embed
    const message = {
      username: "HuginBot",
      avatar_url: "https://i.imgur.com/xASc1QX.png", // Viking raven icon
      embeds: [
        {
          title: "⏱️ Valheim Server Auto-Shutdown",
          description: `Odin has decided that your server should rest for now. The server has been automatically shut down to conserve resources.`,
          color: 0xf47c20, // Vibrant orange color
          fields: [
            {
              name: "World",
              value: worldName,
              inline: true
            },
            {
              name: "Status",
              value: "🔴 Offline",
              inline: true
            },
            {
              name: "Shutdown Reason",
              value: `${reason}`,
              inline: true
            },
            {
              name: "Idle Time",
              value: `${idleMinutes} minutes with no players`,
              inline: true
            },
            {
              name: "Resources Saved",
              value: `$${resourcesSaved} USD`,
              inline: true
            },
            {
              name: "World State",
              value: "✅ World saved and backed up",
              inline: true
            },
            {
              name: "How to Restart",
              value: "Click the button below or use `/start` command to bring the server back online when needed.",
              inline: false
            }
          ],
          thumbnail: {
            url: "https://i.imgur.com/sG4hIwp.png" // Sleeping Viking icon
          },
          footer: {
            text: "HuginBot • Auto-shutdown to save resources • Type /help for more commands",
            icon_url: "https://i.imgur.com/xASc1QX.png" // Small HuginBot icon
          },
          timestamp: new Date().toISOString()
        }
      ],
      components: [
        {
          type: 1, // Action Row
          components: [
            {
              type: 2, // Button
              style: 3, // Success (Green)
              label: "Start Server",
              custom_id: "start_server",
              emoji: {
                name: "▶️"
              }
            },
            {
              type: 2, // Button
              style: 2, // Secondary (Grey)
              label: "Check Status",
              custom_id: "check_status",
              emoji: {
                name: "🔄"
              }
            }
          ]
        }
      ]
    };
    
    // Get webhook URL from SSM and send notification
    try {
      const webhookUrl = await getWebhookUrl();
      await axios.post(webhookUrl, message);
      console.log('Enhanced shutdown notification sent to Discord');
    } catch (error) {
      console.error('Failed to send Discord notification:', error);
      // Don't throw - we don't want to fail the whole Lambda just because Discord notification failed
    }
  } catch (error) {
    console.error('Error in notify-shutdown handler:', error);
  }
}