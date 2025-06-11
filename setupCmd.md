You're absolutely right! The current setup is unnecessarily complicated. Since your bot has "Manage Webhooks" permission, it should just create the webhook automatically. Let me create an improved version that:

Accepts just /setup without parameters
Creates a webhook in the current channel automatically
Stores it for notifications

async function handleSetupCommand(interaction: any): Promise<APIGatewayProxyResult> {
  const { guild_id, channel_id, member, application_id, token } = interaction;

  // Check if user has permissions (manage webhooks)
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

  try {
    // First, defer the response since this might take a moment
    // (Discord requires a response within 3 seconds)
    
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
          return {
            statusCode: 200,
            body: JSON.stringify({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
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
              },
            }),
          };
        }
      } catch (err) {
        console.log('Existing webhook is no longer valid, creating new one');
      }
    }

    // Create a new webhook using Discord's API
    // We need to use the interaction token to make API calls
    const webhookName = 'HuginBot Notifications';
    const createWebhookUrl = `https://discord.com/api/v10/channels/${channel_id}/webhooks`;

    console.log('Creating webhook for channel:', channel_id);

    // Make the API call to create a webhook
    // Note: We need to use the bot token for this, not the interaction token
    const botToken = process.env.DISCORD_BOT_TOKEN;
    
    if (!botToken) {
      console.error('DISCORD_BOT_TOKEN not configured');
      return {
        statusCode: 200,
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: '❌ Bot configuration error: Missing bot token. Please contact the administrator.',
            flags: 64,
          },
        }),
      };
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
        return {
          statusCode: 200,
          body: JSON.stringify({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: '❌ I don\'t have permission to create webhooks in this channel. Please ensure I have the "Manage Webhooks" permission.',
              flags: 64,
            },
          }),
        };
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

    return {
      statusCode: 200,
      body: JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '✅ Setup complete! Check the message above.',
          embeds: [{
            title: '✨ Notifications Configured',
            description: 'HuginBot will now send server updates to this channel.',
            color: 0x00ff00,
            footer: {
              text: 'HuginBot • Ready for Adventure'
            }
          }],
        },
      }),
    };

  } catch (error) {
    console.error('Error in setup command:', error);
    return {
      statusCode: 200,
      body: JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '❌ Failed to set up notifications. Please try again or create a webhook manually.',
          embeds: [{
            title: '⚠️ Setup Failed',
            description: `Error: ${error.message}`,
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
        },
      }),
    };
  }
}

// Update the slash command registration to remove the webhook_url parameter
const setupCommand = {
  name: 'setup',
  description: 'Set up server notifications in this channel',
  // No options needed anymore!
};

You're absolutely right! The bot should just create the webhook automatically. However, there's one important thing to note: the bot needs its bot token (not just the interaction token) to create webhooks via the Discord API.
Here's what needs to be added to your CDK stack to make this work:

Users just run /setup - no parameters needed
The bot automatically:

Creates a webhook in the current channel
Tests it with a welcome message
Stores it for future notifications


If a webhook already exists, it tests it and confirms it's working

The command will now work like this:

User: /setup
Bot: Creates webhook and sends test message "✅ Setup complete!"

Benefits:

Much simpler user experience
No manual webhook creation needed
Automatically uses the channel where the command is run
Tests the webhook immediately
Handles existing webhooks gracefully

You'll need to:

Add DISCORD_BOT_TOKEN to your environment variables
Redeploy the Lambda function with the updated code
Make sure your bot has the "Manage Webhooks" permission in the Discord server

This is much more user-friendly than asking users to manually create and paste webhook URLs!

// Update in your CDK stack's Lambda environment variables:
const lambdaEnv: { [key: string]: string } = {
    VALHEIM_INSTANCE_ID: this.ec2Instance.instanceId,
    DISCORD_AUTH_TOKEN: discordAuthToken,
    BACKUP_BUCKET_NAME: this.backupBucket.bucketName,
    WORLD_CONFIGURATIONS: process.env.WORLD_CONFIGURATIONS || '',
    DISCORD_BOT_PUBLIC_KEY: process.env.DISCORD_BOT_PUBLIC_KEY || '',
    // Change this line to use the correct env var name:
    DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_SECRET_TOKEN || '',  // <-- Updated!
};

// Then in the handleSetupCommand function, it will use process.env.DISCORD_BOT_TOKEN
// which now correctly maps to your DISCORD_BOT_SECRET_TOKEN from .env
