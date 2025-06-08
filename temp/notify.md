// Updated notify-join-code.ts to use SSM instead of Secrets Manager
import { EventBridgeEvent, Context } from 'aws-lambda';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import axios from 'axios';

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
  
  // Fallback: try to find any configured webhook (for single-server setups)
  // This is a bit hacky but works for simple deployments
  console.warn('No webhook found for active world, notifications will not be sent');
  throw new Error('No Discord webhook configured - use /setup command in Discord');
}

export async function handler(
  event: EventBridgeEvent<'PlayFab.JoinCodeDetected', any>,
  context: Context
): Promise<void> {
  console.log('Event received:', JSON.stringify(event, null, 2));
  
  try {
    const joinCode = event.detail.joinCode;
    
    if (!joinCode) {
      console.error('No join code provided in event');
      return;
    }
    
    // Get world information
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

    // Construct the Discord message
    const message = {
      username: "HuginBot",
      avatar_url: "https://i.imgur.com/xASc1QX.png",
      embeds: [
        {
          title: "🎮 Valheim Server Ready!",
          description: `Your Valheim journey awaits! The server is now online and ready for adventure.`,
          color: 0x33cc33,
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
              value: `||${serverPassword}||`,
              inline: true
            },
            {
              name: "How to Join",
              value: "1. Open Valheim\n2. Select 'Start Game' → 'Join Game'\n3. Choose 'Join by code'\n4. Enter the code above\n5. When prompted for password, enter the server password",
              inline: false
            }
          ],
          footer: {
            text: "HuginBot • Server will auto-shutdown after inactivity • Type /help for commands",
            icon_url: "https://i.imgur.com/xASc1QX.png"
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
