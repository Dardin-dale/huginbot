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
    const idleTime = event.detail.idleTime || 600; // Default 10 minutes
    const idleMinutes = Math.round(idleTime / 60);
    const uptimeMinutes = event.detail.uptimeMinutes || 0;
    const reason = event.detail.reason || 'Inactivity';
    
    // Get the active world configuration
    let worldName = 'Midgard';
    let guildId: string | undefined;
    
    try {
      const paramResult = await ssmClient.send(new GetParameterCommand({
        Name: ACTIVE_WORLD_PARAM
      }));
      
      if (paramResult.Parameter?.Value) {
        const worldConfig = JSON.parse(paramResult.Parameter.Value);
        worldName = worldConfig.name;
        guildId = worldConfig.discordServerId;
      }
    } catch (err) {
      console.log('No active world parameter found, using defaults');
    }
    
    // Viking-themed shutdown messages
    const vikingMessages = [
      `The longhouse grows cold and empty. The warriors have sailed to distant shores...`,
      `Odin's ravens report no Vikings in sight. The mead halls stand silent...`,
      `The forge fires die down as no hammers ring. Rest now, ${worldName}...`,
      `Even the mightiest warriors must rest. The realm slumbers until called upon again...`,
      `The wolves of winter howl through empty halls. ${worldName} awaits its heroes' return...`,
      `No songs echo from the great hall. The server rests like a sleeping dragon...`,
      `The Valkyries have carried the last warrior home. Silence falls upon ${worldName}...`,
    ];
    
    const randomMessage = vikingMessages[Math.floor(Math.random() * vikingMessages.length)];
    
    // Construct the Discord message with enhanced Viking theme
    const message = {
      username: "HuginBot",
      avatar_url: "https://i.imgur.com/xASc1QX.png",
      content: "⚔️ **The realm grows quiet...**",
      embeds: [
        {
          title: "🌙 Valheim Server Entering Slumber",
          description: randomMessage,
          color: 0xd4701f, // Amber/orange color
          fields: [
            {
              name: "🌍 World",
              value: worldName,
              inline: true
            },
            {
              name: "⏱️ Server Uptime",
              value: uptimeMinutes > 60 
                ? `${Math.floor(uptimeMinutes / 60)}h ${uptimeMinutes % 60}m`
                : `${uptimeMinutes} minutes`,
              inline: true
            },
            {
              name: "💤 Idle Time",
              value: `${idleMinutes} minutes`,
              inline: true
            },
            {
              name: "📊 Status",
              value: "🔴 Shutting Down",
              inline: true
            },
            {
              name: "💰 Gold Saved",
              value: `~${(uptimeMinutes * 0.003).toFixed(2)} coins`,
              inline: true
            },
            {
              name: "💾 World State",
              value: "✅ Saved & Backed Up",
              inline: true
            },
            {
              name: "🔮 Summon the Server",
              value: "When you're ready to return to " + worldName + ", simply use `/start` to awaken the realm once more. The gods await your call!",
              inline: false
            }
          ],
          image: {
            url: "https://i.imgur.com/H3XNEFL.png" // Viking sunset/dusk image
          },
          footer: {
            text: "HuginBot • Keeper of the Digital Realms • Auto-shutdown saves resources",
            icon_url: "https://i.imgur.com/xASc1QX.png"
          },
          timestamp: new Date().toISOString()
        }
      ],
      components: [
        {
          type: 1, // Action Row
          components: [
            {
              type: 2, // Button (these don't work with webhooks, but look nice)
              style: 3, // Success (Green)
              label: "Wake the Server",
              custom_id: "start_server",
              emoji: {
                name: "▶️"
              },
              disabled: true // Webhooks can't handle interactions
            },
            {
              type: 2,
              style: 2, // Secondary (Grey)
              label: "View Status",
              custom_id: "check_status",
              emoji: {
                name: "📊"
              },
              disabled: true
            }
          ]
        }
      ]
    };

    // Get webhook URL from SSM and send notification
    try {
      const webhookUrl = await getWebhookUrl();
      await axios.post(webhookUrl, message);
      console.log('Discord shutdown notification sent successfully');
    } catch (error) {
      console.error('Failed to send Discord notification:', error);
      // Don't throw - we don't want to fail the Lambda just because Discord notification failed
    }
  } catch (error) {
    console.error('Error in notify-shutdown handler:', error);
  }
}