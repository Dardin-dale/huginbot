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
    try {
      const paramResult = await ssmClient.send(new GetParameterCommand({
        Name: ACTIVE_WORLD_PARAM
      }));
      
      if (paramResult.Parameter?.Value) {
        const worldConfig = JSON.parse(paramResult.Parameter.Value);
        worldInfo = `${worldConfig.name} (${worldConfig.worldName})`;
      }
    } catch (err) {
      console.log('No active world parameter found, using default');
    }
    
    // Construct the message
    const message = {
      content: null,
      embeds: [
        {
          title: "Valheim Server Ready!",
          description: `The server is now online and ready to play with world: ${worldInfo}`,
          color: 0x33cc33, // Green color
          fields: [
            {
              name: "Join Code",
              value: `\`${joinCode}\``,
              inline: true
            },
            {
              name: "How to Join",
              value: "Open Valheim and select 'Start Game' → 'Join Game' → 'Join by code'",
              inline: false
            }
          ],
          footer: {
            text: "HuginBot • Server will auto-shutdown after inactivity"
          },
          timestamp: new Date().toISOString()
        }
      ]
    };


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
    if (DISCORD_WEBHOOK_URL) {
      await axios.post(DISCORD_WEBHOOK_URL, message);
      console.log('Discord notification sent successfully');
    } else {
      console.error('No Discord webhook URL provided');
    }
  } catch (error) {
    console.error('Error in notify-join-code handler:', error);
  }
}
