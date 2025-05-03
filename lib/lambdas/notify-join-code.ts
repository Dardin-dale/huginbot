import { EventBridgeEvent, Context } from 'aws-lambda';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import axios from 'axios';

// Create AWS clients
const ssmClient = new SSMClient();

// SSM Parameter names
const PLAYFAB_JOIN_CODE_PARAM = '/huginbot/playfab-join-code';
const ACTIVE_WORLD_PARAM = '/huginbot/active-world';

// Discord webhook URL (set via environment variable by CDK)
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';

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
      avatar_url: "https://i.imgur.com/xASc1QX.png", // Viking raven icon
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
              value: "1. Open Valheim\n2. Select 'Start Game' → 'Join Game'\n3. Choose 'Join by code'\n4. Enter the code above\n5. When prompted for password, enter the server password",
              inline: false
            },
            {
              name: "Server Features",
              value: "✅ Automatic backups\n✅ Discord integration\n✅ Low-latency hosting",
              inline: false
            }
          ],
          thumbnail: {
            url: "https://i.imgur.com/UQYgxBG.png" // Valheim logo
          },
          image: {
            url: "https://i.imgur.com/yGrVDso.png" // Valheim banner image
          },
          footer: {
            text: "HuginBot • Server will auto-shutdown after inactivity • Type /help for commands",
            icon_url: "https://i.imgur.com/xASc1QX.png" // Small HuginBot icon
          },
          timestamp: new Date().toISOString()
        }
      ]
    };

    // Get guild-specific webhook URL if available
    let webhookUrl = DISCORD_WEBHOOK_URL;
    if (event.detail.guildId) {
      try {
        const paramResult = await ssmClient.send(new GetParameterCommand({
          Name: `/huginbot/discord-webhook/${event.detail.guildId}`,
          WithDecryption: true
        }));
        
        if (paramResult.Parameter?.Value) {
          webhookUrl = paramResult.Parameter.Value;
        }
      } catch (err) {
        console.log('No guild-specific webhook found, using default');
      }
    }
    
    // Send notification to Discord via webhook
    if (webhookUrl) {
      await axios.post(webhookUrl, message);
      console.log('Discord notification sent successfully');
    } else {
      console.error('No Discord webhook URL provided');
    }
  } catch (error) {
    console.error('Error in notify-join-code handler:', error);
  }
}
