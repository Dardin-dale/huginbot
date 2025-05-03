const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Stop the Valheim server')
        .addBooleanOption(option =>
            option.setName('private')
                .setDescription('Make response visible only to you')
                .setRequired(false)),

    async execute(interaction, lambda) {
        // Determine if this should be an ephemeral message
        const isEphemeral = interaction.options.getBoolean('private') === true;
        await interaction.deferReply({ ephemeral: isEphemeral });

        try {
            // Create confirmation embed with buttons
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
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('confirm_stop')
                        .setLabel('Stop Server')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('⏹️'),
                    new ButtonBuilder()
                        .setCustomId('cancel_stop')
                        .setLabel('Cancel')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('❌')
                );

            // Send confirmation message
            const message = await interaction.editReply({
                embeds: [confirmEmbed],
                components: [row]
            });

            // Create collector for button interactions
            const collector = message.createMessageComponentCollector({ time: 60000 }); // 1 minute

            collector.on('collect', async i => {
                if (i.user.id !== interaction.user.id) {
                    return i.reply({ 
                        content: "This confirmation is for the person who initiated the command. Use `/stop` to create your own.",
                        ephemeral: true 
                    });
                }

                // Handle button clicks
                if (i.customId === 'confirm_stop') {
                    await handleStopServer(i, lambda, interaction.guildId);
                } else if (i.customId === 'cancel_stop') {
                    // Cancel the stop operation
                    const cancelEmbed = new EmbedBuilder()
                        .setTitle("✅ Operation Cancelled")
                        .setDescription("Server shutdown has been cancelled. The server will remain online.")
                        .setColor(0x00aa00) // Green
                        .setFooter({ text: 'HuginBot • Operation cancelled' })
                        .setTimestamp();
                        
                    await i.update({
                        embeds: [cancelEmbed],
                        components: []
                    });
                }
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time' && collected.size === 0) {
                    // Timeout - no button was clicked
                    const timeoutEmbed = new EmbedBuilder()
                        .setTitle("⏱️ Confirmation Timed Out")
                        .setDescription("The server shutdown request has expired. The server will remain online.")
                        .setColor(0x888888) // Gray
                        .setFooter({ text: 'HuginBot • Request expired' })
                        .setTimestamp();
                        
                    await interaction.editReply({
                        embeds: [timeoutEmbed],
                        components: []
                    });
                }
            });
        } catch (error) {
            console.error('Error preparing stop confirmation:', error);
            const errorEmbed = new EmbedBuilder()
                .setTitle("❌ Error")
                .setDescription("An error occurred while preparing the stop confirmation.")
                .setColor(0xff0000) // Red
                .setFooter({ text: 'HuginBot • Error' })
                .setTimestamp();
                
            await interaction.editReply({
                embeds: [errorEmbed],
                components: []
            });
        }
    }
};

/**
 * Handle the server stop operation after confirmation
 */
async function handleStopServer(interaction, lambda, guildId) {
    await interaction.deferUpdate();
    
    try {
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
            
        await interaction.editReply({
            embeds: [successEmbed],
            components: []
        });
    } catch (error) {
        console.error('Error stopping server:', error);
        const errorEmbed = new EmbedBuilder()
            .setTitle("❌ Failed to Stop Server")
            .setDescription("An error occurred while trying to stop the server.")
            .setColor(0xff0000) // Red
            .addFields({
                name: "What to do",
                value: "Please try again later or contact the server administrator."
            })
            .setFooter({ text: 'HuginBot • Error' })
            .setTimestamp();
            
        await interaction.editReply({
            embeds: [errorEmbed],
            components: []
        });
    }
}
