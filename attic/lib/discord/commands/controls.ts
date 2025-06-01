const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('controls')
        .setDescription('Show Valheim server control panel')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild), // Only server admins by default

    async execute(interaction, lambda) {
        await interaction.deferReply();

        try {
            // Check current server status to enable/disable appropriate buttons
            const statusResponse = await lambda.invoke({
                FunctionName: process.env.COMMANDS_LAMBDA_NAME,
                Payload: JSON.stringify({
                    body: JSON.stringify({
                        action: 'status'
                    }),
                    headers: {
                        'x-discord-auth': process.env.DISCORD_AUTH_TOKEN
                    }
                })
            }).promise();

            const statusResult = JSON.parse(statusResponse.Payload);
            const statusBody = JSON.parse(statusResult.body);
            const serverStatus = statusBody.status || 'unknown';

            // Get list of worlds
            const worldsResponse = await lambda.invoke({
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

            const worldsResult = JSON.parse(worldsResponse.Payload);
            const worldsBody = JSON.parse(worldsResult.body);
            const worldsList = worldsBody.worlds || [];

            // Create control panel embed
            const embed = new EmbedBuilder()
                .setTitle("🎮 Valheim Server Controls")
                .setDescription("Use the buttons below to manage your Valheim server.")
                .setColor(0x5865F2) // Discord blurple
                .setThumbnail('https://i.imgur.com/UQYgxBG.png') // Valheim logo
                .addFields(
                    {
                        name: "Current Status",
                        value: formatStatus(serverStatus),
                        inline: true
                    },
                    {
                        name: "Available Worlds",
                        value: worldsList.length > 0 
                            ? worldsList.map(w => `• ${w.name}`).join('\n')
                            : "No worlds configured for this server.",
                        inline: true
                    },
                    {
                        name: "Auto-Shutdown",
                        value: "Server will automatically shut down after 10 minutes of inactivity to save resources.",
                        inline: false
                    }
                )
                .setFooter({ 
                    text: "HuginBot • Control Panel • Updates every 30s",
                    iconURL: "https://i.imgur.com/xASc1QX.png" 
                })
                .setTimestamp();

            // Create server control buttons
            const controlRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('controls_start')
                        .setLabel('Start Server')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('▶️')
                        .setDisabled(serverStatus === 'running' || serverStatus === 'pending'),
                    new ButtonBuilder()
                        .setCustomId('controls_stop')
                        .setLabel('Stop Server')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('⏹️')
                        .setDisabled(serverStatus === 'stopped' || serverStatus === 'stopping'),
                    new ButtonBuilder()
                        .setCustomId('controls_status')
                        .setLabel('Check Status')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('🔄')
                );
            
            // Create additional utility buttons
            const utilityRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('controls_worlds')
                        .setLabel('Select World')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('🌍')
                        .setDisabled(worldsList.length === 0),
                    new ButtonBuilder()
                        .setCustomId('controls_backup')
                        .setLabel('Create Backup')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('💾')
                        .setDisabled(serverStatus !== 'running'),
                    new ButtonBuilder()
                        .setCustomId('controls_help')
                        .setLabel('Help')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('❓')
                );

            // Send control panel
            const message = await interaction.editReply({
                embeds: [embed],
                components: [controlRow, utilityRow]
            });

            // Set up button collector
            const collector = message.createMessageComponentCollector({ time: 1800000 }); // 30 minutes

            collector.on('collect', async i => {
                if (i.user.id !== interaction.user.id) {
                    return i.reply({ 
                        content: "These controls are for the person who created them. Use `/controls` to create your own.", 
                        ephemeral: true 
                    });
                }

                switch (i.customId) {
                    case 'controls_start':
                        await handleStartServer(i, lambda, interaction.guildId);
                        break;
                    case 'controls_stop':
                        await handleStopServer(i, lambda, interaction.guildId);
                        break;
                    case 'controls_status':
                        await handleRefreshStatus(i, lambda, interaction.guildId, worldsList);
                        break;
                    case 'controls_worlds':
                        await handleWorldsSelection(i, lambda, interaction.guildId, worldsList);
                        break;
                    case 'controls_backup':
                        await handleBackup(i, lambda, interaction.guildId);
                        break;
                    case 'controls_help':
                        await handleHelp(i);
                        break;
                }
            });

            collector.on('end', async () => {
                // Disable all buttons when collector expires
                const expiredControlRow = disableAllButtons(controlRow);
                const expiredUtilityRow = disableAllButtons(utilityRow);
                
                await interaction.editReply({
                    content: "This control panel has expired. Use `/controls` to create a new one.",
                    embeds: [embed],
                    components: [expiredControlRow, expiredUtilityRow]
                }).catch(console.error);
            });
        } catch (error) {
            console.error('Error creating control panel:', error);
            await interaction.editReply({
                embeds: [{
                    title: "❌ Error Creating Controls",
                    description: "There was an error creating the control panel. Please try again later.",
                    color: 0xff0000 // Red
                }]
            });
        }
    },

    // Add this method to handle button interactions from other parts of the code
    async handleButton(interaction, buttonId, lambda) {
        // This could be called from the bot.js if needed
        const parts = buttonId.split('_');
        if (parts[0] !== 'controls') return;

        // Forward to the appropriate handler
        switch (parts[1]) {
            case 'start':
                await handleStartServer(interaction, lambda, interaction.guildId);
                break;
            case 'stop':
                await handleStopServer(interaction, lambda, interaction.guildId);
                break;
            // Handle other button types...
        }
    }
};

/**
 * Format server status for display
 */
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

/**
 * Handle the start server button
 */
async function handleStartServer(interaction, lambda, guildId) {
    await interaction.deferUpdate();
    
    try {
        // Update the message with a loading state
        const loadingEmbed = new EmbedBuilder()
            .setTitle("🚀 Starting Valheim Server")
            .setDescription("Sending start command to the server...")
            .setColor(0xffaa00) // Orange
            .setFooter({ text: 'HuginBot • Server starting' })
            .setTimestamp();
            
        await interaction.editReply({
            embeds: [loadingEmbed],
            components: [] // Remove buttons while processing
        });

        // Invoke Lambda function
        const response = await lambda.invoke({
            FunctionName: process.env.COMMANDS_LAMBDA_NAME,
            Payload: JSON.stringify({
                body: JSON.stringify({
                    action: 'start',
                    guild_id: guildId
                }),
                headers: {
                    'x-discord-auth': process.env.DISCORD_AUTH_TOKEN
                }
            })
        }).promise();

        const result = JSON.parse(response.Payload);
        const body = JSON.parse(result.body);

        // Create progress bar
        const progressBar = "▓".repeat(5) + "░".repeat(15); // 25% progress
        
        // Create starting embed with progress information
        const startingEmbed = new EmbedBuilder()
            .setTitle("🚀 Server Starting")
            .setDescription(`Progress: ${progressBar} 25%\n${body.message}`)
            .setColor(0xffaa00) // Orange
            .setThumbnail('https://i.imgur.com/UQYgxBG.png')
            .addFields({
                name: "Next Steps",
                value: "The server is starting. A notification will be posted when the server is ready with the join code."
            })
            .setFooter({ text: 'HuginBot • Server starting' })
            .setTimestamp();

        // Re-create buttons with updated states
        const controlRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('controls_start')
                    .setLabel('Start Server')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('▶️')
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId('controls_stop')
                    .setLabel('Stop Server')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('⏹️')
                    .setDisabled(false),
                new ButtonBuilder()
                    .setCustomId('controls_status')
                    .setLabel('Check Status')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🔄')
            );
        
        // Send updated reply
        await interaction.editReply({
            embeds: [startingEmbed],
            components: [controlRow]
        });
    } catch (error) {
        console.error('Error starting server:', error);
        const errorEmbed = new EmbedBuilder()
            .setTitle("❌ Failed to Start Server")
            .setDescription("An error occurred while trying to start the server.")
            .setColor(0xff0000) // Red
            .setFooter({ text: 'HuginBot • Error' })
            .setTimestamp();
            
        await interaction.editReply({
            embeds: [errorEmbed],
            components: []
        });
    }
}

/**
 * Handle the stop server button
 */
async function handleStopServer(interaction, lambda, guildId) {
    await interaction.deferUpdate();
    
    try {
        // Create confirmation embed
        const confirmEmbed = new EmbedBuilder()
            .setTitle("⚠️ Stop Valheim Server?")
            .setDescription("Are you sure you want to stop the server? This will disconnect all players and may cause unsaved progress to be lost.")
            .setColor(0xff9900) // Warning orange
            .addFields({ 
                name: "Important", 
                value: "Make sure all players have saved their game before stopping the server!" 
            })
            .setFooter({ text: 'HuginBot • Confirmation required' })
            .setTimestamp();

        // Create confirmation buttons
        const confirmRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('controls_confirm_stop')
                    .setLabel('Stop Server')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('⏹️'),
                new ButtonBuilder()
                    .setCustomId('controls_cancel_stop')
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('❌')
            );

        // Send confirmation
        await interaction.editReply({
            embeds: [confirmEmbed],
            components: [confirmRow]
        });

        // Set up button collector for confirmation
        const message = await interaction.fetchReply();
        const collector = message.createMessageComponentCollector({ time: 60000 }); // 1 minute

        collector.on('collect', async i => {
            if (i.user.id !== interaction.user.id) {
                return i.reply({ 
                    content: "This confirmation is for the person who initiated the command.", 
                    ephemeral: true 
                });
            }

            if (i.customId === 'controls_confirm_stop') {
                // User confirmed the stop action
                await i.deferUpdate();
                
                // Update with a stopping message
                const stoppingEmbed = new EmbedBuilder()
                    .setTitle("⏳ Stopping Server")
                    .setDescription("Sending shutdown command to the server...")
                    .setColor(0xff5500) // Orange-red
                    .setFooter({ text: 'HuginBot • Server stopping' })
                    .setTimestamp();
                    
                await interaction.editReply({
                    embeds: [stoppingEmbed],
                    components: []
                });

                // Invoke Lambda function
                const response = await lambda.invoke({
                    FunctionName: process.env.COMMANDS_LAMBDA_NAME,
                    Payload: JSON.stringify({
                        body: JSON.stringify({
                            action: 'stop',
                            guild_id: guildId
                        }),
                        headers: {
                            'x-discord-auth': process.env.DISCORD_AUTH_TOKEN
                        }
                    })
                }).promise();

                const result = JSON.parse(response.Payload);
                const body = JSON.parse(result.body);

                // Final success message
                const successEmbed = new EmbedBuilder()
                    .setTitle("🛑 Server Shutting Down")
                    .setDescription(body.message)
                    .setColor(0xff0000) // Red
                    .addFields({
                        name: "Important",
                        value: "Players should save their game immediately before they are disconnected!"
                    })
                    .setFooter({ text: 'HuginBot • Server stopping' })
                    .setTimestamp();
                
                // Re-create buttons with updated states
                const controlRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('controls_start')
                            .setLabel('Start Server')
                            .setStyle(ButtonStyle.Success)
                            .setEmoji('▶️')
                            .setDisabled(false),
                        new ButtonBuilder()
                            .setCustomId('controls_stop')
                            .setLabel('Stop Server')
                            .setStyle(ButtonStyle.Danger)
                            .setEmoji('⏹️')
                            .setDisabled(true),
                        new ButtonBuilder()
                            .setCustomId('controls_status')
                            .setLabel('Check Status')
                            .setStyle(ButtonStyle.Secondary)
                            .setEmoji('🔄')
                    );
                    
                await interaction.editReply({
                    embeds: [successEmbed],
                    components: [controlRow]
                });
            } else if (i.customId === 'controls_cancel_stop') {
                // User cancelled the stop operation
                await i.deferUpdate();
                
                // Get current status to rebuild control panel
                await handleRefreshStatus(interaction, lambda, guildId);
            }
        });

        collector.on('end', async (collected, reason) => {
            if (reason === 'time' && collected.size === 0) {
                // Timeout - no button was clicked
                // Get current status to rebuild control panel
                await handleRefreshStatus(interaction, lambda, guildId);
            }
        });
    } catch (error) {
        console.error('Error handling stop server:', error);
        const errorEmbed = new EmbedBuilder()
            .setTitle("❌ Error")
            .setDescription("An error occurred while trying to stop the server.")
            .setColor(0xff0000) // Red
            .setFooter({ text: 'HuginBot • Error' })
            .setTimestamp();
            
        await interaction.editReply({
            embeds: [errorEmbed],
            components: []
        });
    }
}

/**
 * Handle the refresh status button
 */
async function handleRefreshStatus(interaction, lambda, guildId, worldsList = []) {
    await interaction.deferUpdate();
    
    try {
        // Get updated status
        const statusResponse = await lambda.invoke({
            FunctionName: process.env.COMMANDS_LAMBDA_NAME,
            Payload: JSON.stringify({
                body: JSON.stringify({
                    action: 'status'
                }),
                headers: {
                    'x-discord-auth': process.env.DISCORD_AUTH_TOKEN
                }
            })
        }).promise();

        const statusResult = JSON.parse(statusResponse.Payload);
        const statusBody = JSON.parse(statusResult.body);
        const serverStatus = statusBody.status || 'unknown';

        // If we don't have the worlds list, fetch it
        if (!worldsList || worldsList.length === 0) {
            const worldsResponse = await lambda.invoke({
                FunctionName: process.env.COMMANDS_LAMBDA_NAME,
                Payload: JSON.stringify({
                    body: JSON.stringify({
                        action: 'list-worlds',
                        guild_id: guildId
                    }),
                    headers: {
                        'x-discord-auth': process.env.DISCORD_AUTH_TOKEN
                    }
                })
            }).promise();

            const worldsResult = JSON.parse(worldsResponse.Payload);
            const worldsBody = JSON.parse(worldsResult.body);
            worldsList = worldsBody.worlds || [];
        }

        // Create updated embed
        const updatedEmbed = new EmbedBuilder()
            .setTitle("🎮 Valheim Server Controls")
            .setDescription("Use the buttons below to manage your Valheim server.")
            .setColor(0x5865F2) // Discord blurple
            .setThumbnail('https://i.imgur.com/UQYgxBG.png') // Valheim logo
            .addFields(
                {
                    name: "Current Status",
                    value: formatStatus(serverStatus),
                    inline: true
                },
                {
                    name: "Available Worlds",
                    value: worldsList.length > 0 
                        ? worldsList.map(w => `• ${w.name}`).join('\n')
                        : "No worlds configured for this server.",
                    inline: true
                }
            )
            .setFooter({ 
                text: `HuginBot • Control Panel • Updated ${new Date().toLocaleTimeString()}`,
                iconURL: "https://i.imgur.com/xASc1QX.png" 
            })
            .setTimestamp();

        // Add uptime and join code info if server is running
        if (serverStatus === 'running') {
            if (statusBody.uptime) {
                updatedEmbed.addFields({
                    name: "Uptime",
                    value: statusBody.uptime,
                    inline: true
                });
            }
            
            if (statusBody.isReady && statusBody.joinCode) {
                updatedEmbed.addFields({
                    name: "Join Code",
                    value: `\`${statusBody.joinCode}\``,
                    inline: true
                });
            }
        }

        updatedEmbed.addFields({
            name: "Auto-Shutdown",
            value: "Server will automatically shut down after 10 minutes of inactivity to save resources.",
            inline: false
        });

        // Create updated buttons based on server status
        const controlRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('controls_start')
                    .setLabel('Start Server')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('▶️')
                    .setDisabled(serverStatus === 'running' || serverStatus === 'pending'),
                new ButtonBuilder()
                    .setCustomId('controls_stop')
                    .setLabel('Stop Server')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('⏹️')
                    .setDisabled(serverStatus === 'stopped' || serverStatus === 'stopping'),
                new ButtonBuilder()
                    .setCustomId('controls_status')
                    .setLabel('Check Status')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🔄')
            );
        
        // Create additional utility buttons
        const utilityRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('controls_worlds')
                    .setLabel('Select World')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('🌍')
                    .setDisabled(worldsList.length === 0),
                new ButtonBuilder()
                    .setCustomId('controls_backup')
                    .setLabel('Create Backup')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('💾')
                    .setDisabled(serverStatus !== 'running'),
                new ButtonBuilder()
                    .setCustomId('controls_help')
                    .setLabel('Help')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('❓')
            );

        // Update the message
        await interaction.editReply({
            embeds: [updatedEmbed],
            components: [controlRow, utilityRow]
        });
    } catch (error) {
        console.error('Error refreshing status:', error);
        const errorEmbed = new EmbedBuilder()
            .setTitle("❌ Error Refreshing Status")
            .setDescription("An error occurred while trying to refresh the server status.")
            .setColor(0xff0000) // Red
            .setFooter({ text: 'HuginBot • Error' })
            .setTimestamp();
            
        await interaction.editReply({
            embeds: [errorEmbed],
            components: []
        });
    }
}

/**
 * Handle worlds selection button
 */
async function handleWorldsSelection(interaction, lambda, guildId, worldsList) {
    // This will be implemented in the worlds.ts command
    await interaction.reply({
        content: "World selection will be implemented in the future update. Please use the `/worlds` command for now.",
        ephemeral: true
    });
}

/**
 * Handle backup button
 */
async function handleBackup(interaction, lambda, guildId) {
    await interaction.deferUpdate();
    
    try {
        // Show backup in progress message
        const loadingEmbed = new EmbedBuilder()
            .setTitle("💾 Creating Backup")
            .setDescription("Initiating backup process for the Valheim server...")
            .setColor(0x00aaff) // Blue
            .setFooter({ text: 'HuginBot • Backup in progress' })
            .setTimestamp();
            
        await interaction.editReply({
            embeds: [loadingEmbed],
            components: []
        });

        // Invoke Lambda function
        const response = await lambda.invoke({
            FunctionName: process.env.COMMANDS_LAMBDA_NAME,
            Payload: JSON.stringify({
                body: JSON.stringify({
                    action: 'backup',
                    backup_action: 'create',
                    guild_id: guildId
                }),
                headers: {
                    'x-discord-auth': process.env.DISCORD_AUTH_TOKEN
                }
            })
        }).promise();

        const result = JSON.parse(response.Payload);
        const body = JSON.parse(result.body);

        // Create success embed
        const successEmbed = new EmbedBuilder()
            .setTitle("✅ Backup Initiated")
            .setDescription(body.message)
            .setColor(0x00cc00) // Green
            .addFields({
                name: "Notes",
                value: "Backups are stored securely in AWS S3 and can be restored if needed."
            })
            .setFooter({ text: 'HuginBot • Backup' })
            .setTimestamp();
            
        await interaction.editReply({
            embeds: [successEmbed],
            components: []
        });

        // After a few seconds, refresh the control panel
        setTimeout(async () => {
            await handleRefreshStatus(interaction, lambda, guildId);
        }, 5000);
    } catch (error) {
        console.error('Error creating backup:', error);
        const errorEmbed = new EmbedBuilder()
            .setTitle("❌ Backup Failed")
            .setDescription("An error occurred while trying to create a backup.")
            .setColor(0xff0000) // Red
            .setFooter({ text: 'HuginBot • Error' })
            .setTimestamp();
            
        await interaction.editReply({
            embeds: [errorEmbed],
            components: []
        });
    }
}

/**
 * Handle help button
 */
async function handleHelp(interaction) {
    // Send an ephemeral help message
    await interaction.reply({
        embeds: [{
            title: "📖 HuginBot Help",
            description: "HuginBot helps you manage your Valheim server right from Discord.",
            color: 0x5865F2, // Discord blue
            fields: [
                {
                    name: "Control Panel Buttons",
                    value: "• **Start Server** - Starts the Valheim server\n• **Stop Server** - Stops the server (after confirmation)\n• **Check Status** - Refreshes the control panel\n• **Select World** - Choose which world to play\n• **Create Backup** - Manually create a world backup\n• **Help** - Shows this help message"
                },
                {
                    name: "Slash Commands",
                    value: "• `/start` - Start the server\n• `/stop` - Stop the server\n• `/status` - Check server status\n• `/controls` - Opens this control panel\n• `/worlds` - Manage Valheim worlds"
                },
                {
                    name: "Notes",
                    value: "• The server will automatically shut down after 10 minutes of inactivity\n• World saves are backed up automatically on server start/stop\n• Control panels expire after 30 minutes"
                }
            ],
            footer: {
                text: "HuginBot • Help"
            },
            timestamp: new Date()
        }],
        ephemeral: true
    });
}

/**
 * Disable all buttons in an action row
 */
function disableAllButtons(row) {
    const newRow = ActionRowBuilder.from(row);
    for (const component of newRow.components) {
        component.setDisabled(true);
    }
    return newRow;
}