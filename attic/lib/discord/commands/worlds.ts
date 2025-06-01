const { SlashCommandBuilder } = require('@discordjs/builders');
const { 
    EmbedBuilder, 
    ActionRowBuilder, 
    StringSelectMenuBuilder, 
    ButtonBuilder, 
    ButtonStyle 
} = require('discord.js');

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
                .setDescription('Switch to a different world'))
        .addBooleanOption(option =>
            option.setName('private')
                .setDescription('Make response visible only to you')
                .setRequired(false)),

    async execute(interaction, lambda) {
        const subcommand = interaction.options.getSubcommand();
        const isEphemeral = interaction.options.getBoolean('private') === true;
        
        if (subcommand === 'list') {
            await listWorlds(interaction, lambda, isEphemeral);
        } else if (subcommand === 'switch') {
            await switchWorld(interaction, lambda, isEphemeral);
        }
    }
};

/**
 * List available worlds for this Discord server
 */
async function listWorlds(interaction, lambda, isEphemeral) {
    await interaction.deferReply({ ephemeral: isEphemeral });

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
            const noWorldsEmbed = new EmbedBuilder()
                .setTitle("🌍 No Worlds Available")
                .setDescription("No worlds are configured for this Discord server.")
                .setColor(0xff0000) // Red
                .addFields({
                    name: "How to Add Worlds",
                    value: "Worlds can be added using the CLI command:\n`npm run cli` → 'Manage Worlds' → 'Add World'"
                })
                .setFooter({ text: 'HuginBot • Worlds' })
                .setTimestamp();
                
            return await interaction.editReply({
                embeds: [noWorldsEmbed]
            });
        }

        // Get active world configuration
        let activeWorld = null;
        try {
            const activeWorldResponse = await lambda.invoke({
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

            const activeWorldResult = JSON.parse(activeWorldResponse.Payload);
            const activeWorldBody = JSON.parse(activeWorldResult.body);
            
            if (activeWorldBody.world) {
                activeWorld = activeWorldBody.world.name;
            }
        } catch (error) {
            console.error('Error getting active world:', error);
            // Continue without active world info
        }

        // Create embed with world list
        const worldFields = body.worlds.map(world => ({
            name: world.name + (activeWorld === world.name ? ' (Active)' : ''),
            value: `World Name: ${world.worldName}`,
            inline: true
        }));

        const worldsEmbed = new EmbedBuilder()
            .setTitle("🌍 Available Worlds")
            .setDescription("The following worlds are available for this server:")
            .setColor(0x00aaff) // Blue
            .addFields(worldFields)
            .setFooter({ text: 'HuginBot • Worlds' })
            .setTimestamp();

        // Add button to switch worlds
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('worlds_switch')
                    .setLabel('Switch World')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('🔄')
            );

        await interaction.editReply({
            embeds: [worldsEmbed],
            components: [row]
        });

        // Set up button collector
        const message = await interaction.fetchReply();
        const collector = message.createMessageComponentCollector({ time: 300000 }); // 5 minutes

        collector.on('collect', async i => {
            if (i.user.id !== interaction.user.id) {
                return i.reply({ 
                    content: "Use `/worlds list` to view the worlds for yourself.", 
                    ephemeral: true 
                });
            }

            if (i.customId === 'worlds_switch') {
                await switchWorld(i, lambda, true);
            }
        });
    } catch (error) {
        console.error('Error listing worlds:', error);
        await interaction.editReply({
            embeds: [{
                title: "❌ Error Listing Worlds",
                description: "Failed to retrieve the list of worlds. Please try again later.",
                color: 0xff0000 // Red
            }]
        });
    }
}

/**
 * Switch to a different world
 */
async function switchWorld(interaction, lambda, isEphemeral) {
    await interaction.deferReply({ ephemeral: isEphemeral });

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
                    title: "🌍 No Worlds Available",
                    description: "No worlds are configured for this Discord server.",
                    color: 0xff0000, // Red
                    fields: [
                        {
                            name: "How to Add Worlds",
                            value: "Worlds can be added using the CLI command:\n`npm run cli` → 'Manage Worlds' → 'Add World'"
                        }
                    ],
                    footer: {
                        text: "HuginBot • Worlds"
                    },
                    timestamp: new Date().toISOString()
                }]
            });
        }

        // Check server status - should only switch worlds when server is stopped
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

        if (statusBody.status === 'running' || statusBody.status === 'pending') {
            return interaction.editReply({
                embeds: [{
                    title: "⚠️ Server is Running",
                    description: "The server must be stopped before switching worlds.",
                    color: 0xff9900, // Warning orange
                    fields: [
                        {
                            name: "How to Stop",
                            value: "Use the `/stop` command to stop the server, then try switching worlds again."
                        }
                    ],
                    footer: {
                        text: "HuginBot • Worlds"
                    },
                    timestamp: new Date().toISOString()
                }]
            });
        }

        // Get active world to pre-select in dropdown
        let activeWorld = null;
        if (statusBody.world) {
            activeWorld = statusBody.world.name;
        }

        // Create select menu for worlds
        const worldOptions = body.worlds.map(world => ({
            label: world.name,
            description: `Valheim world: ${world.worldName}`,
            value: world.name,
            default: world.name === activeWorld
        }));

        const row = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('world_select')
                    .setPlaceholder('Select a world')
                    .addOptions(worldOptions)
            );

        const selectEmbed = new EmbedBuilder()
            .setTitle("🌍 Select World")
            .setDescription("Choose a world to activate:")
            .setColor(0x00aaff) // Blue
            .addFields({
                name: "Current World",
                value: activeWorld || "No world is currently active"
            })
            .setFooter({ text: 'HuginBot • World Selection' })
            .setTimestamp();

        await interaction.editReply({
            embeds: [selectEmbed],
            components: [row]
        });

        // Handle selection
        const message = await interaction.fetchReply();
        const collector = message.createMessageComponentCollector({ time: 60000 }); // 1 minute

        collector.on('collect', async i => {
            if (i.user.id !== interaction.user.id) {
                return i.reply({ 
                    content: "Use `/worlds switch` to select a world for yourself.", 
                    ephemeral: true 
                });
            }

            const selectedWorld = i.values[0];
            
            // Update message with loading state
            await i.update({
                embeds: [{
                    title: "🔄 Switching World",
                    description: `Switching to world: ${selectedWorld}...`,
                    color: 0xffaa00, // Orange
                    footer: {
                        text: "HuginBot • Switching World"
                    },
                    timestamp: new Date().toISOString()
                }],
                components: []
            });

            try {
                // Call Lambda to switch world
                const switchResponse = await lambda.invoke({
                    FunctionName: process.env.COMMANDS_LAMBDA_NAME,
                    Payload: JSON.stringify({
                        body: JSON.stringify({
                            action: 'start',
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

                // Handle success or error
                if (switchBody.statusCode && switchBody.statusCode !== 200) {
                    // Error occurred
                    const errorEmbed = new EmbedBuilder()
                        .setTitle("❌ World Switch Failed")
                        .setDescription(switchBody.message || "Failed to switch world.")
                        .setColor(0xff0000) // Red
                        .setFooter({ text: 'HuginBot • Error' })
                        .setTimestamp();
                        
                    await interaction.editReply({
                        embeds: [errorEmbed],
                        components: []
                    });
                } else {
                    // Success
                    const successEmbed = new EmbedBuilder()
                        .setTitle("✅ World Switched")
                        .setDescription(`Active world has been set to **${selectedWorld}**. The server will use this world the next time it starts.`)
                        .setColor(0x00cc00) // Green
                        .addFields({
                            name: "Start Server",
                            value: "Use the `/start` command to start the server with this world."
                        })
                        .setFooter({ text: 'HuginBot • World Switched' })
                        .setTimestamp();
                        
                    await interaction.editReply({
                        embeds: [successEmbed],
                        components: []
                    });
                }
            } catch (error) {
                console.error('Error switching world:', error);
                const errorEmbed = new EmbedBuilder()
                    .setTitle("❌ Error")
                    .setDescription("An error occurred while trying to switch worlds.")
                    .setColor(0xff0000) // Red
                    .setFooter({ text: 'HuginBot • Error' })
                    .setTimestamp();
                    
                await interaction.editReply({
                    embeds: [errorEmbed],
                    components: []
                });
            }
        });

        collector.on('end', async (collected, reason) => {
            if (reason === 'time' && collected.size === 0) {
                // Timeout - no selection was made
                const timeoutEmbed = new EmbedBuilder()
                    .setTitle("⏱️ Selection Timed Out")
                    .setDescription("No world was selected. The active world remains unchanged.")
                    .setColor(0x888888) // Gray
                    .setFooter({ text: 'HuginBot • Timed Out' })
                    .setTimestamp();
                    
                await interaction.editReply({
                    embeds: [timeoutEmbed],
                    components: []
                });
            }
        });
    } catch (error) {
        console.error('Error handling world selection:', error);
        await interaction.editReply({
            embeds: [{
                title: "❌ Error",
                description: "Failed to load worlds. Please try again later.",
                color: 0xff0000, // Red
                footer: {
                    text: "HuginBot • Error"
                },
                timestamp: new Date().toISOString()
            }]
        });
    }
}
