import { EventBridgeEvent, Context } from 'aws-lambda';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import axios from 'axios';

// Create AWS clients
const ssmClient = new SSMClient();

// SSM Parameter names
const ACTIVE_WORLD_PARAM = '/huginbot/active-world';

// Discord webhook URL (set via environment variable by CDK)
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';

export async function handler(
  event: EventBridgeEvent<'Server.AutoShutdown', any>,
  context: Context
): Promise<void> {
  console.log('Shutdown event received:', JSON.stringify(event, null, 2));
  
  try {
    // Get details from the event
    const idleTime = event.detail.idleTime || 0;
    const idleMinutes = Math.round(idleTime / 60);
    
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
          title: "Valheim Server Auto-Shutdown",
          description: `The server has been automatically shut down due to inactivity`,
          color: 0xffcc00, // Amber/Yellow color
          fields: [
            {
              name: "World",
              value: worldInfo,
              inline: true
            },
            {
              name: "Idle Time",
              value: `${idleMinutes} minutes with no players`,
              inline: true
            },
            {
              name: "How to Restart",
              value: "Use the `/valheim start` command to start the server again when needed",
              inline: false
            }
          ],
          footer: {
            text: "HuginBot • Auto-shutdown to save resources"
          },
          timestamp: new Date().toISOString()
        }
      ]
    };
    
    // Send notification to Discord via webhook
    if (DISCORD_WEBHOOK_URL) {
      await axios.post(DISCORD_WEBHOOK_URL, message);
      console.log('Shutdown notification sent to Discord');
    } else {
      console.error('No Discord webhook URL provided');
    }
  } catch (error) {
    console.error('Error in notify-shutdown handler:', error);
  }
}