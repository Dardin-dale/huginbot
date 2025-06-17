// Enhanced error handling for commands.ts

async function handleStartCommandAsync(worldName?: string, guildId?: string, applicationId?: string, token?: string): Promise<void> {
  if (!applicationId || !token) {
    console.error('Missing applicationId or token for follow-up message');
    return;
  }

  try {
    console.log(`🚀 Starting server command - worldName: ${worldName}, guildId: ${guildId}`);
    
    // Check instance status with timeout
    const status = await Promise.race([
      getInstanceStatus(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('getInstanceStatus timeout')), 30000)
      )
    ]) as string;
    
    console.log(`📊 Current instance status: ${status}`);
    
    if (status === 'running') {
      await sendFollowUpMessage(applicationId, token, {
        content: '✅ Server is already running!',
      });
      return;
    }

    if (status === 'pending') {
      await sendFollowUpMessage(applicationId, token, {
        content: '🚀 Server is already starting!',
      });
      return;
    }

    // Handle world configuration 
    let selectedWorldConfig: WorldConfig | undefined;
    
    if (worldName) {
      selectedWorldConfig = WORLD_CONFIGS.find(w => 
        w.name.toLowerCase() === worldName.toLowerCase() || 
        w.worldName.toLowerCase() === worldName.toLowerCase()
      );
      
      if (!selectedWorldConfig) {
        await sendFollowUpMessage(applicationId, token, {
          content: `❌ World "${worldName}" not found. Use /worlds list to see available worlds.`,
        });
        return;
      }
    } else if (guildId) {
      const discordWorlds = WORLD_CONFIGS.filter(w => w.discordServerId === guildId);
      if (discordWorlds.length > 0) {
        selectedWorldConfig = discordWorlds[0];
      }
    }
    
    if (selectedWorldConfig) {
      console.log(`🌍 Selected world: ${selectedWorldConfig.name} (${selectedWorldConfig.worldName})`);
      
      const validationErrors = validateWorldConfig(selectedWorldConfig);
      if (validationErrors.length > 0) {
        await sendFollowUpMessage(applicationId, token, {
          content: `❌ Invalid world configuration: ${validationErrors.join(', ')}`,
        });
        return;
      }
      
      // Store active world configuration
      await withRetry(() => 
        ssmClient.send(new PutParameterCommand({
          Name: SSM_PARAMS.ACTIVE_WORLD,
          Value: JSON.stringify(selectedWorldConfig),
          Type: 'String',
          Overwrite: true
        }))
      );
      console.log(`✅ Active world configuration saved`);
    }

    // Clear any existing PlayFab join codes
    try {
      await withRetry(() =>
        ssmClient.send(new DeleteParameterCommand({
          Name: SSM_PARAMS.PLAYFAB_JOIN_CODE
        }))
      );
      console.log(`🧹 Cleared existing PlayFab join code`);
    } catch (err) {
      console.log('ℹ️ No existing PlayFab parameters found to delete');
    }

    // Start the instance
    console.log(`🔄 Starting EC2 instance: ${VALHEIM_INSTANCE_ID}`);
    await withRetry(() => ec2Client.send(new StartInstancesCommand({
      InstanceIds: [VALHEIM_INSTANCE_ID]
    })));
    console.log(`✅ EC2 instance start command sent successfully`);

    const displayWorldName = selectedWorldConfig ? selectedWorldConfig.name : undefined;

    await sendFollowUpMessage(applicationId, token, {
      content: '🚀 Starting Valheim server... This may take 5-10 minutes.',
      embeds: [{
        title: 'Server Starting',
        description: 'The server is being started. You\'ll receive a notification when it\'s ready.',
        color: 0xffaa00,
        fields: displayWorldName ? [{
          name: 'World',
          value: displayWorldName,
          inline: true,
        }] : [],
        footer: {
          text: 'HuginBot • Valheim Server Manager'
        },
        timestamp: new Date().toISOString(),
      }],
    });
    
    console.log(`✅ Start command completed successfully`);
    
  } catch (error) {
    console.error('❌ Error in handleStartCommandAsync:', error);
    console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace');
    
    if (applicationId && token) {
      try {
        await sendFollowUpMessage(applicationId, token, {
          content: `❌ Failed to start server: ${error instanceof Error ? error.message : 'Unknown error'}`,
          embeds: [{
            title: 'Start Command Failed',
            description: 'There was an error starting the server. Please check the logs or try again.',
            color: 0xff0000,
            fields: [{
              name: 'Error Details',
              value: error instanceof Error ? error.message : String(error),
              inline: false
            }],
            footer: {
              text: 'HuginBot • Contact administrator if this persists'
            }
          }]
        });
      } catch (followUpError) {
        console.error('❌ Failed to send error follow-up message:', followUpError);
      }
    }
  }
}

// Enhanced sendFollowUpMessage with better error handling
async function sendFollowUpMessage(applicationId: string, token: string, content: any): Promise<void> {
  const followUpUrl = `https://discord.com/api/v10/webhooks/${applicationId}/${token}`;
  
  try {
    console.log(`📤 Sending follow-up message to Discord webhook`);
    
    const response = await fetch(followUpUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(content),
    });
    
    if (!response.ok) {
      const errorData = await response.text();
      console.error(`❌ Discord API error: ${response.status} ${response.statusText}`);
      console.error(`Error response: ${errorData}`);
      throw new Error(`Discord API returned ${response.status}: ${errorData}`);
    }
    
    console.log(`✅ Follow-up message sent successfully`);
    
  } catch (error) {
    console.error('❌ Error sending follow-up message:', error);
    console.error('Follow-up URL:', followUpUrl);
    console.error('Content:', JSON.stringify(content, null, 2));
    throw error; // Re-throw so calling function can handle it
  }
}
