import { APIGatewayProxyResult } from "aws-lambda";
import {
  StartInstancesCommand,
  StopInstancesCommand,
} from "@aws-sdk/client-ec2";
import {
  GetParameterCommand,
  PutParameterCommand,
  DeleteParameterCommand,
  SendCommandCommand,
} from "@aws-sdk/client-ssm";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import {
  ec2Client,
  ssmClient,
  s3Client,
  withRetry,
  VALHEIM_INSTANCE_ID,
  BACKUP_BUCKET_NAME,
  SSM_PARAMS,
  getGuildDefaultWorldParam,
  getInstanceStatus,
  getStatusMessage,
  getFastServerStatus,
} from "../utils/aws-clients";
import {
  createSuccessResponse,
  createBadRequestResponse,
  createErrorResponse,
} from "../utils/responses";
import {
  WORLD_CONFIGS,
  WorldConfig,
  validateWorldConfig,
} from "../utils/world-config";
import { sendFollowUpMessage } from "../utils/discord-followup";
import { InteractionResponseType } from "./types";

export async function handleSetupCommand(interaction: any): Promise<APIGatewayProxyResult> {
  const { guild_id, channel_id, member, application_id, token } = interaction;

  // Check if user has permissions (manage webhooks) - do this immediately
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

  // Send deferred response immediately after permission check
  const deferredResponse = {
    statusCode: 200,
    body: JSON.stringify({
      type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    }),
  };

  // Perform the actual work asynchronously
  handleSetupCommandAsync(guild_id, channel_id, application_id, token).catch(error => {
    console.error('Error in handleSetupCommandAsync:', error);
  });

  return deferredResponse;
}
export async function handleSetupCommandAsync(guild_id: string, channel_id: string, application_id: string, token: string): Promise<void> {

  try {
    // Check if a webhook already exists for this guild
    const existingWebhookParam = `/huginbot/discord-webhook/${guild_id}`;
    let existingWebhook = null;
    
    try {
      const result = await withRetry(() => ssmClient.send(new GetParameterCommand({
        Name: existingWebhookParam,
        WithDecryption: true
      })));
      existingWebhook = result.Parameter?.Value;
    } catch (err) {
      // No existing webhook, which is fine
      console.log('No existing webhook found for guild:', guild_id);
    }

    if (existingWebhook) {
      // Test if the existing webhook still works
      try {
        const testResponse = await fetch(existingWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: '✅ Webhook is already configured and working!',
            username: 'HuginBot'
          }),
        });

        if (testResponse.ok) {
          await sendFollowUpMessage(application_id, token, {
            content: '✅ This server already has notifications configured!',
            embeds: [{
              title: '📢 Notifications Active',
              description: 'HuginBot is already set up to send notifications to this channel.',
              color: 0x00ff00,
              fields: [{
                name: 'Need to change channels?',
                value: 'Delete the webhook in this channel\'s settings and run `/setup` in the new channel.',
                inline: false
              }],
              footer: {
                text: 'HuginBot • Ready for Adventure'
              }
            }],
          });
          return;
        }
      } catch (err) {
        console.log('Existing webhook is no longer valid, creating new one');
      }
    }

    // Create a new webhook using Discord's API
    const webhookName = 'HuginBot Notifications';
    const createWebhookUrl = `https://discord.com/api/v10/channels/${channel_id}/webhooks`;

    console.log('Creating webhook for channel:', channel_id);

    // Make the API call to create a webhook
    const botToken = process.env.DISCORD_BOT_TOKEN;
    
    if (!botToken) {
      console.error('DISCORD_BOT_TOKEN not configured');
      await sendFollowUpMessage(application_id, token, {
        content: '❌ Bot configuration error: Missing bot token. Please contact the administrator.',
        flags: 64,
      });
      return;
    }

    const createResponse = await fetch(createWebhookUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: webhookName,
        avatar: null, // You can add a base64 encoded image here if you want
      }),
    });

    if (!createResponse.ok) {
      const errorData = await createResponse.json();
      console.error('Failed to create webhook:', errorData);
      
      // Check if it's a permissions issue
      if (createResponse.status === 403) {
        await sendFollowUpMessage(application_id, token, {
          content: '❌ I don\'t have permission to create webhooks in this channel. Please ensure I have the "Manage Webhooks" permission.',
          flags: 64,
        });
        return;
      }
      
      throw new Error(`Failed to create webhook: ${errorData.message || 'Unknown error'}`);
    }

    const webhookData = await createResponse.json();
    const webhookUrl = `https://discord.com/api/webhooks/${webhookData.id}/${webhookData.token}`;

    console.log('Webhook created successfully:', webhookData.id);

    // Store the webhook URL in SSM
    await withRetry(() => ssmClient.send(new PutParameterCommand({
      Name: existingWebhookParam,
      Value: webhookUrl,
      Type: 'String',
      Overwrite: true,
      Description: `Discord webhook for guild ${guild_id} in channel ${channel_id}`,
    })));

    // Send a test message through the webhook
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'HuginBot',
        embeds: [{
          title: '🎉 Webhook Created Successfully!',
          description: 'I\'ll send server notifications to this channel.',
          color: 0x00ff00,
          fields: [
            {
              name: '📬 Notifications You\'ll Receive',
              value: '• Server startup announcements\n• PlayFab join codes\n• Server shutdown notices\n• Backup status updates',
              inline: false
            },
            {
              name: '🛠️ Next Steps',
              value: 'Use `/start` to launch the server and you\'ll see notifications here!',
              inline: false
            }
          ],
          footer: {
            text: 'HuginBot • Watching Over Your Realm',
            icon_url: 'https://static.wikia.nocookie.net/valheim/images/7/7d/Hugin.png'
          },
          timestamp: new Date().toISOString()
        }]
      }),
    });

    await sendFollowUpMessage(application_id, token, {
      content: '✅ Setup complete! Check the message above.',
      embeds: [{
        title: '✨ Notifications Configured',
        description: 'HuginBot will now send server updates to this channel.',
        color: 0x00ff00,
        footer: {
          text: 'HuginBot • Ready for Adventure'
        }
      }],
    });

  } catch (error) {
    console.error('Error in setup command:', error);
    await sendFollowUpMessage(application_id, token, {
      content: '❌ Failed to set up notifications. Please try again or create a webhook manually.',
      embeds: [{
        title: '⚠️ Setup Failed',
        description: `Error: ${error instanceof Error ? error.message : String(error)}`,
        color: 0xff0000,
        fields: [{
          name: 'Manual Setup',
          value: '1. Go to Channel Settings → Integrations → Webhooks\n2. Create a new webhook\n3. Contact your administrator to configure it',
          inline: false
        }],
        footer: {
          text: 'HuginBot • Contact Support if Issue Persists'
        }
      }],
      flags: 64, // Ephemeral for error messages
    });
  }
}

