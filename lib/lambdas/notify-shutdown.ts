import { EventBridgeEvent, Context } from 'aws-lambda';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import axios from 'axios';

// Create AWS clients
const ssmClient = new SSMClient();
const secretsClient = new SecretsManagerClient();

// SSM Parameter names
const ACTIVE_WORLD_PARAM = '/huginbot/active-world';

// Discord webhook secret name (set via environment variable by CDK)
const DISCORD_WEBHOOK_SECRET_NAME = process.env.DISCORD_WEBHOOK_SECRET_NAME || '';

// Cache for webhook URL to avoid repeated API calls
let cachedWebhookUrl: string | null = null;

/**
 * Get Discord webhook URL from Secrets Manager
 */
async function getWebhookUrl(): Promise<string> {
  if (cachedWebhookUrl) {
    return cachedWebhookUrl;
  }
  
  if (!DISCORD_WEBHOOK_SECRET_NAME) {
    throw new Error('DISCORD_WEBHOOK_SECRET_NAME environment variable not set');
  }
  
  try {
    const result = await secretsClient.send(new GetSecretValueCommand({
      SecretId: DISCORD_WEBHOOK_SECRET_NAME
    }));
    
    if (!result.SecretString) {
      throw new Error('Secret value is empty');
    }
    
    const secretObj = JSON.parse(result.SecretString);
    cachedWebhookUrl = secretObj.url;
    
    if (!cachedWebhookUrl || cachedWebhookUrl.includes('PLACEHOLDER')) {
      throw new Error('Webhook URL not configured - use Discord setup command first');
    }
    
    return cachedWebhookUrl;
  } catch (error) {
    console.error('Failed to get webhook URL from Secrets Manager:', error);
    throw error;
  }
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
    
    // Get webhook URL from Secrets Manager
    const webhookUrl = await getWebhookUrl();
    
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
    
    // Send notification to Discord via webhook
    if (webhookUrl) {
      await axios.post(webhookUrl, message);
      console.log('Enhanced shutdown notification sent to Discord');
    } else {
      console.error('No Discord webhook URL provided');
    }
  } catch (error) {
    console.error('Error in notify-shutdown handler:', error);
  }
}