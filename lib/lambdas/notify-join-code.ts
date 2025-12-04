import { EventBridgeEvent, Context } from 'aws-lambda';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import axios from 'axios';

// Create AWS clients
const ssmClient = new SSMClient();

// SSM Parameter names
const PLAYFAB_JOIN_CODE_PARAM = '/huginbot/playfab-join-code';
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
  event: EventBridgeEvent<'PlayFab.JoinCodeDetected', any>,
  context: Context
): Promise<void> {
  console.log('Event received:', JSON.stringify(event, null, 2));
  
  try {
    // Get the join code from the event detail
    const joinCode = event.detail.joinCode;
    
    if (!joinCode) {
      console.error('No join code provided in event');
      return;
    }
    
    // Get the active world configuration
    let worldInfo = 'default world';
    let worldName = 'Default';
    let serverPassword = '*****';
    try {
      const paramResult = await ssmClient.send(new GetParameterCommand({
        Name: ACTIVE_WORLD_PARAM
      }));
      
      if (paramResult.Parameter?.Value) {
        const worldConfig = JSON.parse(paramResult.Parameter.Value);
        worldInfo = `${worldConfig.name} (${worldConfig.worldName})`;
        worldName = worldConfig.name;
        serverPassword = worldConfig.serverPassword || '*****';
      }
    } catch (err) {
      console.log('No active world parameter found, using default');
    }

    // Get server address if available
    let serverAddress = process.env.SERVER_ADDRESS || 'Auto-assigned';
    
    // Construct the message with rich embed
    const message = {
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

    // Get webhook URL from SSM and send notification
    try {
      const webhookUrl = await getWebhookUrl();
      await axios.post(webhookUrl, message);
      console.log('Discord notification sent successfully');
    } catch (error) {
      console.error('Failed to send Discord notification:', error);
      // Don't throw - we don't want to fail the whole Lambda just because Discord notification failed
    }
  } catch (error) {
    console.error('Error in notify-join-code handler:', error);
  }
}
