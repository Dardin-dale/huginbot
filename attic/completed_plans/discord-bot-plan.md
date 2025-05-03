# HuginBot Discord Bot Enhancement Plan

## Overview

This document outlines the implementation plan for enhancing the Discord bot integration in HuginBot. The primary goal is to improve user experience and provide intuitive server management for players without requiring technical knowledge of AWS or game server administration.

## Current Discord Integration

HuginBot currently uses:
- Discord webhooks for server notifications
- Basic slash commands for server control (/start, /stop, /status)
- Simple text-based responses
- Limited error handling and user feedback

## Implementation Plan

### 1. Enhanced Visual Presentation

#### Rich Embeds for Notifications and Responses

Replace the current plain text messages with rich embeds that include colors, fields, and formatting:

```javascript
// lib/lambdas/notify-join-code.ts - Modified notification with rich embed
async function handler() {
  // ...existing code...

  // Construct the message with rich embed
  const message = {
    username: "HuginBot",
    avatar_url: "https://i.imgur.com/XYZ123.png", // Add a custom avatar
    embeds: [
      {
        title: "🎮 Valheim Server Ready!",
        description: `The server is now online and ready to play with world: ${worldInfo}`,
        color: 0x33cc33, // Green color
        fields: [
          {
            name: "Join Code",
            value: `\`${joinCode}\``,
            inline: true
          },
          {
            name: "Server Address",
            value: `${serverAddress}`,
            inline: true
          },
          {
            name: "How to Join",
            value: "Open Valheim and select 'Start Game' → 'Join Game' → 'Join by code'",
            inline: false
          }
        ],
        thumbnail: {
          url: "https://i.imgur.com/valheim-icon.png" // Valheim icon
        },
        footer: {
          text: "HuginBot • Server will auto-shutdown after inactivity"
        },
        timestamp: new Date().toISOString()
      }
    ]
  };

  // Send notification to Discord via webhook
  if (DISCORD_WEBHOOK_URL) {
    await axios.post(DISCORD_WEBHOOK_URL, message);
    console.log('Discord notification sent successfully');
  } else {
    console.error('No Discord webhook URL provided');
  }
}
```

#### Status Dashboard Message

Create a persistent, auto-updating status message that shows current server state:

```javascript
// lib/discord/commands/status.ts - Enhanced status command
module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Check the Valheim server status')
    .addSubcommand(subcommand =>
      subcommand
        .setName('check')
        .setDescription('Check current server status'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('dashboard')
        .setDescription('Create a live-updating status dashboard')),

  async execute(interaction, lambda) {
    if (interaction.options.getSubcommand() === 'dashboard') {
      await createStatusDashboard(interaction, lambda);
    } else {
      await checkStatus(interaction, lambda);
    }
  }
};

async function checkStatus(interaction, lambda) {
  // Existing status check implementation
  // ...
}

async function createStatusDashboard(interaction, lambda) {
  await interaction.deferReply();

  try {
    // Create initial status message
    const statusEmbed = await buildStatusEmbed(lambda);
    
    const message = await interaction.editReply({
      content: null,
      embeds: [statusEmbed],
      components: [
        new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('refresh_status')
              .setLabel('Refresh')
              .setStyle(ButtonStyle.Secondary)
              .setEmoji('🔄'),
            new ButtonBuilder()
              .setCustomId('start_server')
              .setLabel('Start Server')
              .setStyle(ButtonStyle.Success)
              .setEmoji('▶️'),
            new ButtonBuilder()
              .setCustomId('stop_server')
              .setLabel('Stop Server')
              .setStyle(ButtonStyle.Danger)
              .setEmoji('⏹️')
          )
      ]
    });

    // Store the message ID in the database/cache for auto-updates
    await storeStatusMessage(interaction.channelId, message.id);

    // Create button interaction collector
    const collector = message.createMessageComponentCollector({ time: 3600000 }); // 1 hour

    collector.on('collect', async i => {
      if (i.customId === 'refresh_status') {
        await i.deferUpdate();
        const updatedEmbed = await buildStatusEmbed(lambda);
        await i.editReply({
          embeds: [updatedEmbed],
          components: message.components
        });
      } else if (i.customId === 'start_server') {
        await i.deferUpdate();
        // Call start server function
        // ...
      } else if (i.customId === 'stop_server') {
        await i.deferUpdate();
        // Call stop server function
        // ...
      }
    });

  } catch (error) {
    console.error('Error creating status dashboard:', error);
    await interaction.editReply('Failed to create status dashboard. Please try again later.');
  }
}

async function buildStatusEmbed(lambda) {
  // Call Lambda to get status
  const response = await lambda.invoke({
    FunctionName: process.env.STATUS_LAMBDA_NAME,
    Payload: JSON.stringify({
      headers: {
        'x-discord-auth': process.env.DISCORD_AUTH_TOKEN
      }
    })
  }).promise();

  const result = JSON.parse(response.Payload);
  const body = JSON.parse(result.body);
  const status = body.status || 'unknown';

  // Build status embed
  const embed = {
    title: "Valheim Server Status",
    description: getStatusDescription(status),
    color: getStatusColor(status),
    fields: [
      {
        name: "Status",
        value: formatStatus(status),
        inline: true
      }
    ],
    footer: {
      text: `Last updated: ${new Date().toLocaleString()}`
    }
  };

  // Add additional fields based on status
  if (status === 'running') {
    embed.fields.push(
      {
        name: "Address",
        value: body.serverAddress || 'Unknown',
        inline: true
      },
      {
        name: "Uptime",
        value: body.uptime || 'Unknown',
        inline: true
      }
    );

    // Add player list if available
    if (body.players && body.players.length > 0) {
      embed.fields.push({
        name: "Online Players",
        value: body.players.join(', '),
        inline: false
      });
    } else {
      embed.fields.push({
        name: "Online Players",
        value: "No players online",
        inline: false
      });
    }
  }

  return embed;
}

function getStatusColor(status) {
  switch (status) {
    case 'running':
      return 0x00ff00; // Green
    case 'pending':
      return 0xffaa00; // Orange
    case 'stopping':
      return 0xff5500; // Orange-red
    case 'stopped':
      return 0xff0000; // Red
    default:
      return 0x999999; // Gray
  }
}

function getStatusDescription(status) {
  switch (status) {
    case 'running':
      return "🟢 The server is **ONLINE** and ready to play!";
    case 'pending':
      return "🟠 The server is **STARTING UP**. Please wait a few minutes.";
    case 'stopping':
      return "🟠 The server is **SHUTTING DOWN**. Save your game!";
    case 'stopped':
      return "🔴 The server is **OFFLINE**. Use the start command to launch it.";
    default:
      return "⚪ Server status is **UNKNOWN**. Try refreshing.";
  }
}

function formatStatus(status) {
  switch (status) {
    case 'running':
      return "✅ Online";
    case 'pending':
      return "⏳ Starting";
    case 'stopping':
      return "⏳ Stopping";
    case 'stopped':
      return "❌ Offline";
    default:
      return "❓ Unknown";
  }
}

// Function to store message IDs for auto-updates
async function storeStatusMessage(channelId, messageId) {
  // This would store in a database or file
  // For MVP, could use an SSM parameter
  // ...
}
```

#### Progress Indicators for Long Operations

Add progress indicators for long-running operations like server start:

```javascript
// lib/discord/commands/start.ts - With progress updates
module.exports = {
  // ...existing code...

  async execute(interaction, lambda) {
    await interaction.deferReply();

    try {
      // Initial response with progress bar
      const progressBar = createProgressBar(0);
      await interaction.editReply({
        embeds: [{
          title: "Starting Valheim Server",
          description: `Progress: ${progressBar} 0%\nInitiating server startup...`,
          color: 0xffaa00 // Orange
        }]
      });

      // Invoke Lambda function
      const response = await lambda.invoke({
        FunctionName: process.env.START_STOP_LAMBDA_NAME,
        Payload: JSON.stringify({
          body: JSON.stringify({
            action: 'start',
            world_name: interaction.options.getString('world'),
            guild_id: interaction.guildId
          }),
          headers: {
            'x-discord-auth': process.env.DISCORD_AUTH_TOKEN
          }
        })
      }).promise();

      const result = JSON.parse(response.Payload);
      const body = JSON.parse(result.body);

      // Update with 25% progress
      setTimeout(async () => {
        const progressBar = createProgressBar(25);
        await interaction.editReply({
          embeds: [{
            title: "Starting Valheim Server",
            description: `Progress: ${progressBar} 25%\nServer instance is starting...`,
            color: 0xffaa00
          }]
        });
      }, 5000);

      // Update with 50% progress
      setTimeout(async () => {
        const progressBar = createProgressBar(50);
        await interaction.editReply({
          embeds: [{
            title: "Starting Valheim Server",
            description: `Progress: ${progressBar} 50%\nValheim container is initializing...`,
            color: 0xffaa00
          }]
        });
      }, 15000);

      // Update with 75% progress
      setTimeout(async () => {
        const progressBar = createProgressBar(75);
        await interaction.editReply({
          embeds: [{
            title: "Starting Valheim Server",
            description: `Progress: ${progressBar} 75%\nWorld is loading...`,
            color: 0xffaa00
          }]
        });
      }, 30000);

      // Final success update
      setTimeout(async () => {
        const progressBar = createProgressBar(100);
        await interaction.editReply({
          embeds: [{
            title: "✅ Valheim Server Started",
            description: `Progress: ${progressBar} 100%\n${body.message}`,
            color: 0x00ff00, // Green
            fields: [
              {
                name: "Status",
                value: "Online",
                inline: true
              },
              {
                name: "World",
                value: interaction.options.getString('world') || "Default",
                inline: true
              }
            ],
            footer: {
              text: "It may take a few more minutes before the join code is available."
            }
          }]
        });
      }, 45000);

    } catch (error) {
      console.error('Error starting server:', error);
      await interaction.editReply({
        embeds: [{
          title: "❌ Failed to Start Server",
          description: "An error occurred while trying to start the server. Please try again later.",
          color: 0xff0000 // Red
        }]
      });
    }
  }
};

function createProgressBar(percent) {
  const completed = Math.round(percent / 5);
  const remaining = 20 - completed;
  return "▓".repeat(completed) + "░".repeat(remaining);
}
```

### 2. Modern Discord Interactions

#### Buttons for Common Actions

Replace text commands with clickable buttons:

```javascript
// lib/discord/commands/controls.ts - New command for server controls
const { SlashCommandBuilder } = require('@discordjs/builders');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('controls')
    .setDescription('Show Valheim server control panel'),

  async execute(interaction, lambda) {
    await interaction.deferReply();

    try {
      // Check current server status to enable/disable appropriate buttons
      const statusResponse = await lambda.invoke({
        FunctionName: process.env.STATUS_LAMBDA_NAME,
        Payload: JSON.stringify({
          headers: {
            'x-discord-auth': process.env.DISCORD_AUTH_TOKEN
          }
        })
      }).promise();

      const statusResult = JSON.parse(statusResponse.Payload);
      const statusBody = JSON.parse(statusResult.body);
      const serverStatus = statusBody.status || 'unknown';

      // Create control panel embed
      const embed = {
        title: "🎮 Valheim Server Controls",
        description: "Use the buttons below to manage your Valheim server.",
        color: 0x5865F2, // Discord blurple
        fields: [
          {
            name: "Current Status",
            value: formatStatus(serverStatus),
            inline: true
          }
        ],
        footer: {
          text: "Server will automatically shut down after 10 minutes of inactivity"
        }
      };

      // Create buttons with appropriate disabled states
      const startButton = new ButtonBuilder()
        .setCustomId('start_server')
        .setLabel('Start Server')
        .setStyle(ButtonStyle.Success)
        .setEmoji('▶️')
        .setDisabled(serverStatus === 'running' || serverStatus === 'pending');

      const stopButton = new ButtonBuilder()
        .setCustomId('stop_server')
        .setLabel('Stop Server')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('⏹️')
        .setDisabled(serverStatus === 'stopped' || serverStatus === 'stopping');

      const statusButton = new ButtonBuilder()
        .setCustomId('check_status')
        .setLabel('Check Status')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🔄');

      const worldsButton = new ButtonBuilder()
        .setCustomId('select_world')
        .setLabel('Select World')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🌍');

      // Create action row with buttons
      const row = new ActionRowBuilder()
        .addComponents(startButton, stopButton, statusButton, worldsButton);

      // Send control panel
      await interaction.editReply({
        embeds: [embed],
        components: [row]
      });

      // Set up button collector
      const message = await interaction.fetchReply();
      const collector = message.createMessageComponentCollector({ time: 3600000 }); // 1 hour

      collector.on('collect', async i => {
        if (i.user.id !== interaction.user.id) {
          return i.reply({ content: "These controls are for the person who created them. Use `/controls` to create your own.", ephemeral: true });
        }

        switch (i.customId) {
          case 'start_server':
            await handleStartServer(i, lambda);
            break;
          case 'stop_server':
            await handleStopServer(i, lambda);
            break;
          case 'check_status':
            await handleCheckStatus(i, lambda);
            break;
          case 'select_world':
            await handleSelectWorld(i, lambda);
            break;
        }
      });

    } catch (error) {
      console.error('Error creating control panel:', error);
      await interaction.editReply('Failed to create control panel. Please try again later.');
    }
  }
};

async function handleStartServer(interaction, lambda) {
  await interaction.deferUpdate();
  // Call start server Lambda
  // ...
}

async function handleStopServer(interaction, lambda) {
  await interaction.deferUpdate();
  // Call stop server Lambda
  // ...
}

async function handleCheckStatus(interaction, lambda) {
  await interaction.deferUpdate();
  // Call status Lambda
  // ...
}

async function handleSelectWorld(interaction, lambda) {
  // Defer reply with ephemeral message
  await interaction.deferReply({ ephemeral: true });
  
  try {
    // Get list of worlds from Lambda
    const response = await lambda.invoke({
      FunctionName: process.env.COMMANDS_LAMBDA_NAME,
      Payload: JSON.stringify({
        body: JSON.stringify({
          action: 'list-worlds',
          guild_id: interaction.guildId
        }),
        headers: {
          'x-discord-auth': process.env.DISCORD_AUTH_TOKEN
        }
      })
    }).promise();

    const result = JSON.parse(response.Payload);
    const body = JSON.parse(result.body);

    if (!body.worlds || body.worlds.length === 0) {
      return interaction.editReply('No worlds configured for this server. Use the CLI to add worlds.');
    }

    // Create select menu for worlds
    const worldOptions = body.worlds.map(world => ({
      label: world.name,
      description: `Valheim world: ${world.worldName}`,
      value: world.name
    }));

    const row = new ActionRowBuilder()
      .addComponents(
        new SelectMenuBuilder()
          .setCustomId('world_select')
          .setPlaceholder('Select a world')
          .addOptions(worldOptions)
      );

    await interaction.editReply({
      content: 'Select a world to switch to:',
      components: [row]
    });

    // Handle selection
    const message = await interaction.fetchReply();
    const collector = message.createMessageComponentCollector({ time: 60000 }); // 1 minute

    collector.on('collect', async i => {
      const selectedWorld = i.values[0];
      await i.update({ content: `Switching to world: ${selectedWorld}...`, components: [] });

      // Call Lambda to switch world
      const switchResponse = await lambda.invoke({
        FunctionName: process.env.COMMANDS_LAMBDA_NAME,
        Payload: JSON.stringify({
          body: JSON.stringify({
            action: 'switch-world',
            world_name: selectedWorld,
            guild_id: interaction.guildId
          }),
          headers: {
            'x-discord-auth': process.env.DISCORD_AUTH_TOKEN
          }
        })
      }).promise();

      const switchResult = JSON.parse(switchResponse.Payload);
      const switchBody = JSON.parse(switchResult.body);

      await i.editReply(`${switchBody.message}`);
    });

  } catch (error) {
    console.error('Error handling world selection:', error);
    await interaction.editReply('Failed to load worlds. Please try again later.');
  }
}

function formatStatus(status) {
  switch (status) {
    case 'running':
      return "✅ Online";
    case 'pending':
      return "⏳ Starting";
    case 'stopping':
      return "⏳ Stopping";
    case 'stopped':
      return "❌ Offline";
    default:
      return "❓ Unknown";
  }
}
```

#### Select Menus for World Selection

Create dropdown menus for selecting worlds:

```javascript
// lib/discord/commands/worlds.ts - Enhanced with select menu
module.exports = {
  data: new SlashCommandBuilder()
    .setName('worlds')
    .setDescription('Manage Valheim worlds')
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('List available worlds'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('switch')
        .setDescription('Switch to a different world')),

  async execute(interaction, lambda) {
    const subcommand = interaction.options.getSubcommand();
    
    if (subcommand === 'list') {
      await listWorlds(interaction, lambda);
    } else if (subcommand === 'switch') {
      await switchWorld(interaction, lambda);
    }
  }
};

async function listWorlds(interaction, lambda) {
  await interaction.deferReply();

  try {
    // Get worlds from Lambda
    const response = await lambda.invoke({
      FunctionName: process.env.COMMANDS_LAMBDA_NAME,
      Payload: JSON.stringify({
        body: JSON.stringify({
          action: 'list-worlds',
          guild_id: interaction.guildId
        }),
        headers: {
          'x-discord-auth': process.env.DISCORD_AUTH_TOKEN
        }
      })
    }).promise();

    const result = JSON.parse(response.Payload);
    const body = JSON.parse(result.body);

    if (!body.worlds || body.worlds.length === 0) {
      return interaction.editReply({
        embeds: [{
          title: "No Worlds Available",
          description: "No worlds are configured for this Discord server.",
          color: 0xff0000 // Red
        }]
      });
    }

    // Create embed with world list
    const worldFields = body.worlds.map(world => ({
      name: world.name,
      value: `World Name: ${world.worldName}`,
      inline: true
    }));

    await interaction.editReply({
      embeds: [{
        title: "🌍 Available Worlds",
        description: "The following worlds are available for this server:",
        color: 0x00aaff, // Blue
        fields: worldFields
      }]
    });

  } catch (error) {
    console.error('Error listing worlds:', error);
    await interaction.editReply('Failed to list worlds. Please try again later.');
  }
}

async function switchWorld(interaction, lambda) {
  await interaction.deferReply();

  try {
    // Get worlds from Lambda
    const response = await lambda.invoke({
      FunctionName: process.env.COMMANDS_LAMBDA_NAME,
      Payload: JSON.stringify({
        body: JSON.stringify({
          action: 'list-worlds',
          guild_id: interaction.guildId
        }),
        headers: {
          'x-discord-auth': process.env.DISCORD_AUTH_TOKEN
        }
      })
    }).promise();

    const result = JSON.parse(response.Payload);
    const body = JSON.parse(result.body);

    if (!body.worlds || body.worlds.length === 0) {
      return interaction.editReply({
        embeds: [{
          title: "No Worlds Available",
          description: "No worlds are configured for this Discord server.",
          color: 0xff0000 // Red
        }]
      });
    }

    // Create select menu for worlds
    const worldOptions = body.worlds.map(world => ({
      label: world.name,
      description: `Valheim world: ${world.worldName}`,
      value: world.name
    }));

    const row = new ActionRowBuilder()
      .addComponents(
        new SelectMenuBuilder()
          .setCustomId('world_select')
          .setPlaceholder('Select a world')
          .addOptions(worldOptions)
      );

    await interaction.editReply({
      embeds: [{
        title: "🌍 Select World",
        description: "Choose a world to activate:",
        color: 0x00aaff // Blue
      }],
      components: [row]
    });

    // Handle selection
    const message = await interaction.fetchReply();
    const collector = message.createMessageComponentCollector({ time: 60000 }); // 1 minute

    collector.on('collect', async i => {
      const selectedWorld = i.values[0];
      
      // Update message with loading state
      await i.update({
        embeds: [{
          title: "🔄 Switching World",
          description: `Switching to world: ${selectedWorld}...`,
          color: 0xffaa00 // Orange
        }],
        components: []
      });

      // Call Lambda to switch world
      const switchResponse = await lambda.invoke({
        FunctionName: process.env.COMMANDS_LAMBDA_NAME,
        Payload: JSON.stringify({
          body: JSON.stringify({
            action: 'switch-world',
            world_name: selectedWorld,
            guild_id: interaction.guildId
          }),
          headers: {
            'x-discord-auth': process.env.DISCORD_AUTH_TOKEN
          }
        })
      }).promise();

      const switchResult = JSON.parse(switchResponse.Payload);
      const switchBody = JSON.parse(switchResult.body);

      // Update with result
      await interaction.editReply({
        embeds: [{
          title: "✅ World Switched",
          description: switchBody.message,
          color: 0x00ff00, // Green
          fields: [
            {
              name: "Active World",
              value: selectedWorld,
              inline: true
            }
          ]
        }],
        components: []
      });
    });

  } catch (error) {
    console.error('Error handling world selection:', error);
    await interaction.editReply('Failed to load worlds. Please try again later.');
  }
}
```

#### Modals for Configuration

Use modals for complex inputs:

```javascript
// lib/discord/commands/configure.ts - New command for configuration
module.exports = {
  data: new SlashCommandBuilder()
    .setName('configure')
    .setDescription('Configure server settings')
    .addSubcommand(subcommand =>
      subcommand
        .setName('world')
        .setDescription('Create a new world')),

  async execute(interaction, lambda) {
    if (interaction.options.getSubcommand() === 'world') {
      // Show modal for world creation
      const modal = new ModalBuilder()
        .setCustomId('create_world_modal')
        .setTitle('Create New World');
      
      // Add input components
      const nameInput = new TextInputBuilder()
        .setCustomId('world_name')
        .setLabel('World Name (Display Name)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('MyWorld')
        .setRequired(true);
      
      const valheimNameInput = new TextInputBuilder()
        .setCustomId('valheim_world_name')
        .setLabel('Valheim World Name (Save File Name)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('ValheimWorld')
        .setRequired(true);
      
      const passwordInput = new TextInputBuilder()
        .setCustomId('server_password')
        .setLabel('Server Password (Min 5 characters)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('password')
        .setMinLength(5)
        .setRequired(true);
      
      // Create action rows for each input
      const nameRow = new ActionRowBuilder().addComponents(nameInput);
      const valheimNameRow = new ActionRowBuilder().addComponents(valheimNameInput);
      const passwordRow = new ActionRowBuilder().addComponents(passwordInput);
      
      // Add rows to modal
      modal.addComponents(nameRow, valheimNameRow, passwordRow);
      
      // Show the modal
      await interaction.showModal(modal);
      
      // Wait for modal submission
      const filter = i => i.customId === 'create_world_modal';
      
      try {
        const submission = await interaction.awaitModalSubmit({ filter, time: 60000 });
        
        // Get values from submission
        const worldName = submission.fields.getTextInputValue('world_name');
        const valheimWorldName = submission.fields.getTextInputValue('valheim_world_name');
        const serverPassword = submission.fields.getTextInputValue('server_password');
        
        // Acknowledge the submission
        await submission.deferReply({ ephemeral: true });
        
        // Call Lambda to create the world
        const response = await lambda.invoke({
          FunctionName: process.env.COMMANDS_LAMBDA_NAME,
          Payload: JSON.stringify({
            body: JSON.stringify({
              action: 'create-world',
              guild_id: interaction.guildId,
              world_config: {
                name: worldName,
                worldName: valheimWorldName,
                serverPassword: serverPassword,
                discordServerId: interaction.guildId
              }
            }),
            headers: {
              'x-discord-auth': process.env.DISCORD_AUTH_TOKEN
            }
          })
        }).promise();
        
        const result = JSON.parse(response.Payload);
        const body = JSON.parse(result.body);
        
        // Respond to the user
        await submission.editReply({
          embeds: [{
            title: "✅ World Created",
            description: `Successfully created world "${worldName}"`,
            color: 0x00ff00, // Green
            fields: [
              {
                name: "World Name",
                value: worldName,
                inline: true
              },
              {
                name: "Valheim World",
                value: valheimWorldName,
                inline: true
              },
              {
                name: "Password",
                value: `||${serverPassword}||`,
                inline: true
              }
            ]
          }]
        });
      } catch (error) {
        if (error.code === 'InteractionCollectorError') {
          console.log('Modal timed out');
        } else {
          console.error('Error processing modal submission:', error);
        }
      }
    }
  }
};
```

### 3. Improved Error Handling

#### User-Friendly Error Messages

Create more descriptive and actionable error messages:

```javascript
// lib/lambdas/utils/discord-errors.ts - New error formatting module
export enum ErrorType {
  AWS_API_ERROR = 'aws_api_error',
  PERMISSION_ERROR = 'permission_error',
  CONFIGURATION_ERROR = 'configuration_error',
  WORLD_NOT_FOUND = 'world_not_found',
  SERVER_BUSY = 'server_busy',
  GENERAL_ERROR = 'general_error'
}

export interface ErrorDetails {
  type: ErrorType;
  message: string;
  resolution?: string;
  context?: Record<string, any>;
}

export function formatErrorEmbed(error: ErrorDetails) {
  // Base embed
  const embed: any = {
    title: getErrorTitle(error.type),
    description: error.message,
    color: 0xff0000, // Red
    fields: []
  };
  
  // Add resolution steps if provided
  if (error.resolution) {
    embed.fields.push({
      name: "What You Can Do",
      value: error.resolution
    });
  }
  
  // Add context-specific fields based on error type
  switch (error.type) {
    case ErrorType.AWS_API_ERROR:
      embed.fields.push({
        name: "Technical Details",
        value: `Service: ${error.context?.service || 'Unknown'}\nOperation: ${error.context?.operation || 'Unknown'}`
      });
      break;
      
    case ErrorType.CONFIGURATION_ERROR:
      embed.fields.push({
        name: "Configuration Issue",
        value: `Check the configuration for: ${error.context?.configItem || 'Unknown'}`
      });
      break;
      
    case ErrorType.WORLD_NOT_FOUND:
      if (error.context?.availableWorlds) {
        embed.fields.push({
          name: "Available Worlds",
          value: error.context.availableWorlds.join(', ') || 'None'
        });
      }
      break;
  }
  
  return embed;
}

function getErrorTitle(type: ErrorType): string {
  switch (type) {
    case ErrorType.AWS_API_ERROR:
      return "⚠️ AWS Service Error";
    case ErrorType.PERMISSION_ERROR:
      return "🔒 Permission Denied";
    case ErrorType.CONFIGURATION_ERROR:
      return "⚙️ Configuration Error";
    case ErrorType.WORLD_NOT_FOUND:
      return "🌍 World Not Found";
    case ErrorType.SERVER_BUSY:
      return "⏳ Server Busy";
    case ErrorType.GENERAL_ERROR:
      return "❌ Operation Failed";
    default:
      return "❌ Error";
  }
}
```

#### Integration with Lambda Functions

Update Lambda functions to use the new error formatting:

```javascript
// lib/lambdas/commands.ts - Modified to use error formatting
import { ErrorType, formatErrorEmbed } from './utils/discord-errors';

export async function handler(
  event: APIGatewayProxyEvent, 
  context: Context
): Promise<APIGatewayProxyResult> {
  // Existing code...
  
  try {
    // Existing code...
    
    // Modified error handling for world selection
    switch (action) {
      case 'start':
        if (worldName) {
          const worldConfig = WORLD_CONFIGS.find(w => 
            w.name.toLowerCase() === worldName.toLowerCase() || 
            w.worldName.toLowerCase() === worldName.toLowerCase()
          );
          
          if (!worldConfig) {
            // Use new error formatting
            return createBadRequestResponse(
              "World not found",
              { 
                error: formatErrorEmbed({
                  type: ErrorType.WORLD_NOT_FOUND,
                  message: `World "${worldName}" not found`,
                  resolution: "Try using the `/worlds list` command to see available worlds",
                  context: {
                    availableWorlds: WORLD_CONFIGS.map(w => w.name)
                  }
                })
              }
            );
          }
          
          // Continue with existing code...
        }
        
        // Existing code...
        
    } catch (error) {
      // Improved error handling
      console.error("Error:", error);
      
      // Format error based on type
      let errorDetails: ErrorDetails;
      
      if (error.name === 'ValidationError') {
        errorDetails = {
          type: ErrorType.CONFIGURATION_ERROR,
          message: error.message,
          resolution: "Check your configuration and try again"
        };
      } else if (error.name === 'EC2ServiceException') {
        errorDetails = {
          type: ErrorType.AWS_API_ERROR,
          message: "AWS EC2 service error occurred",
          resolution: "Wait a few minutes and try again",
          context: {
            service: 'EC2',
            operation: error.operation
          }
        };
      } else {
        errorDetails = {
          type: ErrorType.GENERAL_ERROR,
          message: "An unexpected error occurred",
          resolution: "Try again later or contact the server administrator"
        };
      }
      
      return createErrorResponse(
        "Operation failed",
        { error: formatErrorEmbed(errorDetails) }
      );
    }
  }
}
```

#### Discord-side Error Handling

Improve command error handling on the Discord side:

```javascript
// lib/discord/bot.js - Enhanced error handling
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction, lambda);
  } catch (error) {
    console.error(error);
    
    // Check if the interaction was already replied to
    if (interaction.replied || interaction.deferred) {
      // Create error embed
      const errorEmbed = {
        title: "❌ Command Error",
        description: "There was an error executing this command!",
        color: 0xff0000, // Red
        fields: [
          {
            name: "Error Details",
            value: error.message || "Unknown error"
          },
          {
            name: "What to Do",
            value: "Try the command again later. If the problem persists, contact the server administrator."
          }
        ]
      };
      
      await interaction.editReply({ embeds: [errorEmbed], components: [] });
    } else {
      // Initial reply with error
      await interaction.reply({
        embeds: [{
          title: "❌ Command Error",
          description: "There was an error executing this command!",
          color: 0xff0000, // Red
        }],
        ephemeral: true
      });
    }
  }
});
```

### 4. Ephemeral Messages

Update commands to use ephemeral messages for non-public responses:

```javascript
// lib/discord/commands/start.ts - With ephemeral response
module.exports = {
  data: new SlashCommandBuilder()
    .setName('start')
    .setDescription('Start the Valheim server')
    .addStringOption(option =>
      option.setName('world')
        .setDescription('World to load')
        .setRequired(false)),

  async execute(interaction, lambda) {
    // Make response ephemeral (only visible to command user)
    await interaction.deferReply({ ephemeral: true });

    // Rest of the command implementation...
  }
};
```

### 5. Auto-Updates for Status Messages

Implement a system to update status messages periodically:

```javascript
// lib/discord/status-updater.js - New module for status updates
const { Client } = require('discord.js');
const AWS = require('aws-sdk');

// Configuration
const UPDATE_INTERVAL = 60000; // 1 minute
const STATUS_MESSAGE_PARAM = '/huginbot/status-messages';

// Initialize AWS clients
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

/**
 * Initialize the status updater
 * @param {Client} client Discord.js client
 */
async function initStatusUpdater(client) {
  console.log('Initializing status updater');
  
  // Start update interval
  setInterval(() => updateAllStatusMessages(client), UPDATE_INTERVAL);
}

/**
 * Update all registered status messages
 * @param {Client} client Discord.js client
 */
async function updateAllStatusMessages(client) {
  try {
    // Get status message IDs from SSM Parameter Store
    const params = {
      Name: STATUS_MESSAGE_PARAM,
      WithDecryption: true
    };
    
    const response = await ssm.getParameter(params).promise();
    
    if (!response.Parameter || !response.Parameter.Value) {
      return;
    }
    
    const statusMessages = JSON.parse(response.Parameter.Value);
    
    // Update each status message
    for (const [channelId, messageId] of Object.entries(statusMessages)) {
      try {
        const channel = await client.channels.fetch(channelId);
        
        if (!channel) {
          console.log(`Channel ${channelId} not found`);
          continue;
        }
        
        const message = await channel.messages.fetch(messageId);
        
        if (!message) {
          console.log(`Message ${messageId} not found in channel ${channelId}`);
          continue;
        }
        
        // Get current server status
        const statusResponse = await lambda.invoke({
          FunctionName: process.env.STATUS_LAMBDA_NAME,
          Payload: JSON.stringify({
            headers: {
              'x-discord-auth': process.env.DISCORD_AUTH_TOKEN
            }
          })
        }).promise();
        
        const statusResult = JSON.parse(statusResponse.Payload);
        const statusBody = JSON.parse(statusResult.body);
        
        // Build updated embed
        const updatedEmbed = buildStatusEmbed(statusBody);
        
        // Update message
        await message.edit({
          embeds: [updatedEmbed],
          components: message.components
        });
        
        console.log(`Updated status message ${messageId} in channel ${channelId}`);
      } catch (error) {
        console.error(`Error updating status message in channel ${channelId}:`, error);
      }
    }
  } catch (error) {
    console.error('Error updating status messages:', error);
  }
}

/**
 * Register a status message for auto-updates
 * @param {string} channelId The channel ID
 * @param {string} messageId The message ID
 */
async function registerStatusMessage(channelId, messageId) {
  try {
    // Get existing status messages
    let statusMessages = {};
    
    try {
      const params = {
        Name: STATUS_MESSAGE_PARAM,
        WithDecryption: true
      };
      
      const response = await ssm.getParameter(params).promise();
      
      if (response.Parameter && response.Parameter.Value) {
        statusMessages = JSON.parse(response.Parameter.Value);
      }
    } catch (error) {
      // Parameter might not exist yet, which is fine
    }
    
    // Add/update the status message
    statusMessages[channelId] = messageId;
    
    // Save to SSM Parameter Store
    await ssm.putParameter({
      Name: STATUS_MESSAGE_PARAM,
      Value: JSON.stringify(statusMessages),
      Type: 'String',
      Overwrite: true
    }).promise();
    
    console.log(`Registered status message ${messageId} in channel ${channelId}`);
    return true;
  } catch (error) {
    console.error('Error registering status message:', error);
    return false;
  }
}

/**
 * Build status embed from server status
 * @param {object} status Server status object
 * @returns {object} Discord embed object
 */
function buildStatusEmbed(status) {
  // Build status embed (same as in status.ts)
  // ...
}

module.exports = {
  initStatusUpdater,
  registerStatusMessage
};
```

### 6. Permission Management

Add permissions to slash commands:

```javascript
// lib/discord/commands/controls.ts - With permissions
module.exports = {
  data: new SlashCommandBuilder()
    .setName('controls')
    .setDescription('Show Valheim server control panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild), // Only server admins

  // Rest of the command implementation...
};
```

### 7. Help and Documentation

Create a help command with interactive tutorial:

```javascript
// lib/discord/commands/help.ts - Enhanced help command
module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show Valheim server commands help'),

  async execute(interaction, lambda) {
    // Create help pages
    const pages = [
      {
        title: "📚 HuginBot Help - Overview",
        description: "HuginBot helps you manage your Valheim server directly from Discord. Here are the available commands:",
        fields: [
          {
            name: "/start",
            value: "Start the Valheim server",
            inline: true
          },
          {
            name: "/stop",
            value: "Stop the Valheim server",
            inline: true
          },
          {
            name: "/status",
            value: "Check server status",
            inline: true
          },
          {
            name: "/worlds",
            value: "Manage Valheim worlds",
            inline: true
          },
          {
            name: "/controls",
            value: "Show control panel",
            inline: true
          },
          {
            name: "/help",
            value: "Show this help menu",
            inline: true
          }
        ],
        color: 0x5865F2 // Discord blurple
      },
      {
        title: "🎮 Server Management",
        description: "Learn how to start, stop, and check the status of your Valheim server.",
        fields: [
          {
            name: "Starting the Server",
            value: "Use `/start [world]` to start the server. If no world is specified, the default world will be used."
          },
          {
            name: "Stopping the Server",
            value: "Use `/stop` to stop the server. Make sure all players save their game before stopping!"
          },
          {
            name: "Checking Status",
            value: "Use `/status` to check if the server is running, or `/status dashboard` to create a live status panel."
          }
        ],
        color: 0x00ff00 // Green
      },
      {
        title: "🌍 World Management",
        description: "Manage different worlds for your Valheim server.",
        fields: [
          {
            name: "Listing Worlds",
            value: "Use `/worlds list` to see all available worlds for this Discord server."
          },
          {
            name: "Switching Worlds",
            value: "Use `/worlds switch` to switch to a different world. Note that this requires a server restart."
          },
          {
            name: "Creating Worlds",
            value: "New worlds can be added using the CLI or the `/configure world` command."
          }
        ],
        color: 0x00aaff // Blue
      },
      {
        title: "⚙️ Server Configuration",
        description: "Advanced server configuration options.",
        fields: [
          {
            name: "Control Panel",
            value: "Use `/controls` to create an interactive control panel for your server."
          },
          {
            name: "World Configuration",
            value: "Use `/configure world` to create a new world configuration."
          },
          {
            name: "Auto-Shutdown",
            value: "The server will automatically shut down after 10 minutes of inactivity to save resources."
          }
        ],
        color: 0xaa00ff // Purple
      }
    ];

    // Create pagination buttons
    let currentPage = 0;
    
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('prev_page')
          .setLabel('Previous')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('⬅️')
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId('next_page')
          .setLabel('Next')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('➡️')
          .setDisabled(false)
      );
    
    // Send initial help message
    await interaction.reply({
      embeds: [pages[currentPage]],
      components: [row]
    });
    
    // Create button collector
    const message = await interaction.fetchReply();
    const collector = message.createMessageComponentCollector({ time: 300000 }); // 5 minutes
    
    collector.on('collect', async i => {
      if (i.user.id !== interaction.user.id) {
        return i.reply({ content: "These controls are for the person who created them. Use `/help` to create your own.", ephemeral: true });
      }
      
      if (i.customId === 'prev_page') {
        currentPage--;
      } else if (i.customId === 'next_page') {
        currentPage++;
      }
      
      // Update buttons based on current page
      const updatedRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('prev_page')
            .setLabel('Previous')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('⬅️')
            .setDisabled(currentPage === 0),
          new ButtonBuilder()
            .setCustomId('next_page')
            .setLabel('Next')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('➡️')
            .setDisabled(currentPage === pages.length - 1)
        );
      
      // Update message
      await i.update({
        embeds: [pages[currentPage]],
        components: [updatedRow]
      });
    });
    
    collector.on('end', async () => {
      // Disable buttons when collector expires
      const disabledRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('prev_page')
            .setLabel('Previous')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('⬅️')
            .setDisabled(true),
          new ButtonBuilder()
            .setCustomId('next_page')
            .setLabel('Next')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('➡️')
            .setDisabled(true)
        );
      
      await message.edit({ components: [disabledRow] });
    });
  }
};
```

## Implementation Priority

### 1. Essential Improvements (Days 1-2)
- Rich embeds for notifications
- Basic button controls
- Ephemeral message support
- Error handling improvements

### 2. Enhanced Interactions (Days 3-4)
- Status dashboard with auto-updates
- World selection with select menus
- Progress indicators for long operations

### 3. Advanced Features (Days 5+)
- Help command with pagination
- Config modal for world creation
- Permission management

## Technical Requirements

Update package.json dependencies to support new Discord features:

```json
{
  "dependencies": {
    "discord.js": "^14.7.1",
    "@discordjs/rest": "^1.5.0",
    "@discordjs/builders": "^1.4.0",
    "axios": "^1.2.2"
  }
}
```

## Testing Plan

1. **Unit Tests**:
   - Test rich embed generation
   - Validate error formatting
   - Test button interaction handlers

2. **Integration Tests**:
   - Create a test Discord server
   - Register test commands
   - Verify interactions work as expected

3. **User Experience Testing**:
   - Have friends test the commands
   - Gather feedback on usability
   - Identify any confusing aspects

## Conclusion

These enhancements will significantly improve the Discord bot experience for your friends, making it more intuitive, visually appealing, and user-friendly. The implementation prioritizes essential improvements first, with more advanced features coming later.

By focusing on enhanced visual presentation, modern Discord interactions, and better error handling, the bot will provide a much better experience for your friends who will be using it to manage the Valheim server.