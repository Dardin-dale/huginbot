const { SlashCommandBuilder } = require('@discordjs/builders');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const statusUpdater = require('../status-updater');

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

/**
 * Check the current status of the server
 */
async function checkStatus(interaction, lambda) {
    await interaction.deferReply();

    try {
        // Invoke Lambda function
        const response = await lambda.invoke({
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

        const result = JSON.parse(response.Payload);
        const body = JSON.parse(result.body);

        // Create a rich embed for the response
        const statusEmbed = await buildStatusEmbed(body);
        
        await interaction.editReply({ embeds: [statusEmbed] });
    } catch (error) {
        console.error('Error checking server status:', error);
        await interaction.editReply({
            embeds: [{
                title: "❌ Error Checking Status",
                description: "There was an error checking the server status. Please try again later.",
                color: 0xff0000, // Red
                footer: {
                    text: "HuginBot • Error"
                },
                timestamp: new Date().toISOString()
            }]
        });
    }
}

/**
 * Create a live status dashboard with buttons
 */
async function createStatusDashboard(interaction, lambda) {
    await interaction.deferReply();

    try {
        // Invoke Lambda function to get initial status
        const response = await lambda.invoke({
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

        const result = JSON.parse(response.Payload);
        const body = JSON.parse(result.body);

        // Create status embed
        const statusEmbed = await buildStatusEmbed(body);
        
        // Create buttons for the dashboard
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('refresh_status')
                    .setLabel('Refresh Status')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🔄'),
                new ButtonBuilder()
                    .setCustomId('start_server')
                    .setLabel('Start Server')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('▶️')
                    .setDisabled(body.status === 'running' || body.status === 'pending'),
                new ButtonBuilder()
                    .setCustomId('stop_server')
                    .setLabel('Stop Server')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('⏹️')
                    .setDisabled(body.status === 'stopped' || body.status === 'stopping')
            );
        
        // Send the dashboard
        const message = await interaction.editReply({
            embeds: [statusEmbed],
            components: [row]
        });

        // Create collector for button interactions
        const collector = message.createMessageComponentCollector({ time: 3600000 }); // 1 hour

        collector.on('collect', async i => {
            if (i.user.id !== interaction.user.id) {
                return i.reply({ 
                    content: "This control panel is for the person who created it. Use `/status dashboard` to create your own.",
                    ephemeral: true 
                });
            }

            switch (i.customId) {
                case 'refresh_status':
                    await handleRefreshStatus(i, lambda);
                    break;
                case 'start_server':
                    await handleStartServer(i, lambda);
                    break;
                case 'stop_server':
                    await handleStopServer(i, lambda);
                    break;
            }
        });

        collector.on('end', async () => {
            // Disable buttons when collector expires
            const disabledRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('refresh_status')
                        .setLabel('Refresh Status')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('🔄')
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId('start_server')
                        .setLabel('Start Server')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('▶️')
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId('stop_server')
                        .setLabel('Stop Server')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('⏹️')
                        .setDisabled(true)
                );
            
            await message.edit({
                content: "This control panel has expired. Use `/status dashboard` to create a new one.",
                components: [disabledRow]
            });
        });

        // Register this status message for auto-updates
        try {
            await statusUpdater.registerStatusMessage(interaction.channelId, message.id);
            console.log(`Registered status message ${message.id} in channel ${interaction.channelId} for auto-updates`);
        } catch (error) {
            console.error('Failed to register status message for auto-updates:', error);
        }
    } catch (error) {
        console.error('Error creating status dashboard:', error);
        await interaction.editReply({
            embeds: [{
                title: "❌ Error Creating Dashboard",
                description: "There was an error creating the status dashboard. Please try again later.",
                color: 0xff0000, // Red
                footer: {
                    text: "HuginBot • Error"
                },
                timestamp: new Date().toISOString()
            }]
        });
    }
}

/**
 * Handle refresh status button click
 */
async function handleRefreshStatus(interaction, lambda) {
    await interaction.deferUpdate();
    
    try {
        // Get current status
        const response = await lambda.invoke({
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

        const result = JSON.parse(response.Payload);
        const body = JSON.parse(result.body);

        // Update status embed
        const updatedEmbed = await buildStatusEmbed(body);
        
        // Update button states
        const updatedRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('refresh_status')
                    .setLabel('Refresh Status')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🔄'),
                new ButtonBuilder()
                    .setCustomId('start_server')
                    .setLabel('Start Server')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('▶️')
                    .setDisabled(body.status === 'running' || body.status === 'pending'),
                new ButtonBuilder()
                    .setCustomId('stop_server')
                    .setLabel('Stop Server')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('⏹️')
                    .setDisabled(body.status === 'stopped' || body.status === 'stopping')
            );

        await interaction.editReply({
            embeds: [updatedEmbed],
            components: [updatedRow]
        });
    } catch (error) {
        console.error('Error refreshing status:', error);
        await interaction.editReply({
            content: "Failed to refresh server status. Please try again.",
            components: interaction.message.components
        });
    }
}

/**
 * Handle start server button click
 */
async function handleStartServer(interaction, lambda) {
    await interaction.deferUpdate();
    
    try {
        // Call start server Lambda
        const response = await lambda.invoke({
            FunctionName: process.env.COMMANDS_LAMBDA_NAME,
            Payload: JSON.stringify({
                body: JSON.stringify({
                    action: 'start',
                    guild_id: interaction.guildId
                }),
                headers: {
                    'x-discord-auth': process.env.DISCORD_AUTH_TOKEN
                }
            })
        }).promise();

        const result = JSON.parse(response.Payload);
        const body = JSON.parse(result.body);

        // Create starting embed
        const startingEmbed = new EmbedBuilder()
            .setTitle('🚀 Server Starting')
            .setDescription(body.message)
            .setColor(0xffaa00) // Orange
            .addFields(
                { name: 'Status', value: 'Starting up...', inline: true }
            )
            .setFooter({ text: 'HuginBot • Server starting' })
            .setTimestamp();

        // Update buttons
        const updatedRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('refresh_status')
                    .setLabel('Refresh Status')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🔄'),
                new ButtonBuilder()
                    .setCustomId('start_server')
                    .setLabel('Start Server')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('▶️')
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId('stop_server')
                    .setLabel('Stop Server')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('⏹️')
                    .setDisabled(false)
            );

        await interaction.editReply({
            embeds: [startingEmbed],
            components: [updatedRow]
        });
    } catch (error) {
        console.error('Error starting server:', error);
        await interaction.editReply({
            content: "Failed to start server. Please try again.",
            components: interaction.message.components
        });
    }
}

/**
 * Handle stop server button click
 */
async function handleStopServer(interaction, lambda) {
    await interaction.deferUpdate();
    
    try {
        // Call stop server Lambda
        const response = await lambda.invoke({
            FunctionName: process.env.COMMANDS_LAMBDA_NAME,
            Payload: JSON.stringify({
                body: JSON.stringify({
                    action: 'stop'
                }),
                headers: {
                    'x-discord-auth': process.env.DISCORD_AUTH_TOKEN
                }
            })
        }).promise();

        const result = JSON.parse(response.Payload);
        const body = JSON.parse(result.body);

        // Create stopping embed
        const stoppingEmbed = new EmbedBuilder()
            .setTitle('⏳ Server Shutting Down')
            .setDescription(body.message)
            .setColor(0xff5500) // Orange-red
            .addFields(
                { name: 'Status', value: 'Shutting down...', inline: true },
                { name: 'Important', value: 'Save your game before disconnecting!', inline: false }
            )
            .setFooter({ text: 'HuginBot • Server stopping' })
            .setTimestamp();

        // Update buttons
        const updatedRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('refresh_status')
                    .setLabel('Refresh Status')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🔄'),
                new ButtonBuilder()
                    .setCustomId('start_server')
                    .setLabel('Start Server')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('▶️')
                    .setDisabled(false),
                new ButtonBuilder()
                    .setCustomId('stop_server')
                    .setLabel('Stop Server')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('⏹️')
                    .setDisabled(true)
            );

        await interaction.editReply({
            embeds: [stoppingEmbed],
            components: [updatedRow]
        });
    } catch (error) {
        console.error('Error stopping server:', error);
        await interaction.editReply({
            content: "Failed to stop server. Please try again.",
            components: interaction.message.components
        });
    }
}

/**
 * Build the status embed based on server state
 */
async function buildStatusEmbed(status) {
    // Use the shared status color function from status-updater
    const color = statusUpdater.getStatusColor(status.status);

    // Create base embed
    const embed = new EmbedBuilder()
        .setTitle('Valheim Server Status')
        .setDescription(statusUpdater.getStatusDescription(status.status))
        .setColor(color)
        .setThumbnail('https://i.imgur.com/UQYgxBG.png') // Valheim logo
        .setFooter({ 
            text: 'HuginBot • Last updated',
            iconURL: 'https://i.imgur.com/xASc1QX.png'
        })
        .setTimestamp();

    // Add fields based on status
    embed.addFields({
        name: 'Status',
        value: statusUpdater.formatStatus(status.status),
        inline: true
    });

    // Add world info if available
    try {
        const worldResponse = await lambda.invoke({
            FunctionName: process.env.COMMANDS_LAMBDA_NAME,
            Payload: JSON.stringify({
                body: JSON.stringify({
                    action: 'list-worlds'
                }),
                headers: {
                    'x-discord-auth': process.env.DISCORD_AUTH_TOKEN
                }
            })
        }).promise();

        const worldResult = JSON.parse(worldResponse.Payload);
        const worldBody = JSON.parse(worldResult.body);

        if (worldBody.worlds && worldBody.worlds.length > 0) {
            embed.addFields({
                name: 'Active World',
                value: worldBody.worlds[0].name || 'Unknown',
                inline: true
            });
        }
    } catch (error) {
        console.error('Error getting world info:', error);
    }

    // Add uptime if server is running
    if (status.status === 'running' && status.uptime) {
        embed.addFields({
            name: 'Uptime',
            value: status.uptime,
            inline: true
        });
    }

    // Add join code if server is ready
    if (status.isReady && status.joinCode) {
        embed.addFields({
            name: 'Join Code',
            value: `\`${status.joinCode}\``,
            inline: true
        });
    }

    // Add action hints based on status
    let actionHint = '';
    switch(status.status) {
        case 'running':
            actionHint = 'The server is online and ready for players! Join using the code above.';
            break;
        case 'stopped':
            actionHint = 'Use the Start Server button or `/start` command to launch the server.';
            break;
        case 'pending':
            actionHint = 'The server is starting up. This may take 5-10 minutes.';
            break;
        case 'stopping':
            actionHint = 'The server is shutting down. Please save your game!';
            break;
        default:
            actionHint = 'Use the Refresh button to check for status updates.';
    }

    embed.addFields({
        name: 'What to do',
        value: actionHint,
        inline: false
    });

    return embed;
}

// Status formatting functions are now in the status-updater module
