const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('start')
        .setDescription('Start the Valheim server')
        .addStringOption(option =>
            option.setName('world')
                .setDescription('World to load')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('private')
                .setDescription('Make response visible only to you')
                .setRequired(false)),

    async execute(interaction, lambda) {
        // Determine if this should be an ephemeral message
        const isEphemeral = interaction.options.getBoolean('private') === true;
        await interaction.deferReply({ ephemeral: isEphemeral });

        try {
            // Initial response with progress bar
            const progressBar = createProgressBar(0);
            const initialEmbed = new EmbedBuilder()
                .setTitle("🚀 Starting Valheim Server")
                .setDescription(`Progress: ${progressBar} 0%\nInitiating server startup...`)
                .setColor(0xffaa00) // Orange
                .setThumbnail('https://i.imgur.com/UQYgxBG.png') // Valheim logo
                .setFooter({ text: 'HuginBot • Server starting' })
                .setTimestamp();
            
            await interaction.editReply({ embeds: [initialEmbed] });

            // Invoke Lambda function
            const response = await lambda.invoke({
                FunctionName: process.env.COMMANDS_LAMBDA_NAME,
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

            // Check if response indicates a configuration issue
            if (body.statusCode === 400 && body.message.includes("No worlds configured")) {
                const errorEmbed = new EmbedBuilder()
                    .setTitle("⚠️ Configuration Error")
                    .setDescription(`${body.message}`)
                    .setColor(0xff0000) // Red
                    .addFields({
                        name: "How to Configure",
                        value: `To configure this server, use the following command:\n\`npm run cli\` → "Manage Worlds" → "Add World" and set the Discord Server ID to \`${interaction.guildId}\``
                    })
                    .setFooter({ text: 'HuginBot • Configuration required' })
                    .setTimestamp();
                    
                return await interaction.editReply({ embeds: [errorEmbed] });
            }

            // Update with 25% progress
            setTimeout(async () => {
                const progressBar25 = createProgressBar(25);
                const updatedEmbed25 = new EmbedBuilder()
                    .setTitle("🚀 Starting Valheim Server")
                    .setDescription(`Progress: ${progressBar25} 25%\nServer instance is starting...`)
                    .setColor(0xffaa00) // Orange
                    .setThumbnail('https://i.imgur.com/UQYgxBG.png')
                    .addFields({
                        name: "Status",
                        value: "EC2 instance has been started"
                    })
                    .setFooter({ text: 'HuginBot • Server starting' })
                    .setTimestamp();
                    
                await interaction.editReply({ embeds: [updatedEmbed25] });
            }, 5000);

            // Update with 50% progress
            setTimeout(async () => {
                const progressBar50 = createProgressBar(50);
                const updatedEmbed50 = new EmbedBuilder()
                    .setTitle("🚀 Starting Valheim Server")
                    .setDescription(`Progress: ${progressBar50} 50%\nValheim container is initializing...`)
                    .setColor(0xffaa00) // Orange
                    .setThumbnail('https://i.imgur.com/UQYgxBG.png')
                    .addFields({
                        name: "Status",
                        value: "Docker container is starting"
                    })
                    .setFooter({ text: 'HuginBot • Server starting' })
                    .setTimestamp();
                    
                await interaction.editReply({ embeds: [updatedEmbed50] });
            }, 15000);

            // Update with 75% progress
            setTimeout(async () => {
                const progressBar75 = createProgressBar(75);
                const updatedEmbed75 = new EmbedBuilder()
                    .setTitle("🚀 Starting Valheim Server")
                    .setDescription(`Progress: ${progressBar75} 75%\nWorld is loading...`)
                    .setColor(0xffaa00) // Orange
                    .setThumbnail('https://i.imgur.com/UQYgxBG.png')
                    .addFields({
                        name: "Status",
                        value: "Valheim server is starting up"
                    })
                    .setFooter({ text: 'HuginBot • Server starting' })
                    .setTimestamp();
                    
                await interaction.editReply({ embeds: [updatedEmbed75] });
            }, 30000);

            // Final success update
            setTimeout(async () => {
                const progressBar100 = createProgressBar(100);
                const worldInfo = body.world ? `${body.world.name}` : 'Default';
                
                const finalEmbed = new EmbedBuilder()
                    .setTitle("✅ Valheim Server Started")
                    .setDescription(`Progress: ${progressBar100} 100%\n${body.message}`)
                    .setColor(0x00ff00) // Green
                    .setThumbnail('https://i.imgur.com/UQYgxBG.png')
                    .addFields(
                        { name: "Status", value: "Instance online", inline: true },
                        { name: "World", value: worldInfo, inline: true },
                        { name: "Next Steps", value: "A notification with the join code will be posted in the channel once the server is fully ready (usually 5-10 minutes)." }
                    )
                    .setFooter({ text: 'HuginBot • Server started' })
                    .setTimestamp();
                
                await interaction.editReply({ embeds: [finalEmbed] });
            }, 45000);

        } catch (error) {
            console.error('Error starting server:', error);
            const errorEmbed = new EmbedBuilder()
                .setTitle("❌ Failed to Start Server")
                .setDescription("An error occurred while trying to start the server.")
                .setColor(0xff0000) // Red
                .addFields({
                    name: "What to do",
                    value: "Please try again later or contact the server administrator."
                })
                .setFooter({ text: 'HuginBot • Error' })
                .setTimestamp();
                
            await interaction.editReply({ embeds: [errorEmbed] });
        }
    }
};

/**
 * Create a progress bar visualization
 * @param {number} percent Progress percentage (0-100)
 * @returns {string} Text progress bar
 */
function createProgressBar(percent) {
    const completed = Math.round(percent / 5);
    const remaining = 20 - completed;
    return "█".repeat(completed) + "░".repeat(remaining);
}
