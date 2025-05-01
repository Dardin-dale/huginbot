const { SlashCommandBuilder } = require('@discordjs/builders');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('start')
        .setDescription('Start the Valheim server')
        .addStringOption(option =>
            option.setName('world')
                .setDescription('World to load')
                .setRequired(false)),

    async execute(interaction, lambda) {
        await interaction.deferReply();

        try {
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
                return await interaction.editReply({
                    content: `${body.message}\n\nTo configure this server, use the following command:\n\`npm run cli\` → "Manage Worlds" → "Add World" and set the Discord Server ID to \`${interaction.guildId}\``,
                    ephemeral: true  // Only visible to the command user
                });
            }

            await interaction.editReply(body.message);
        } catch (error) {
            console.error('Error starting server:', error);
            await interaction.editReply('Failed to start the server. Please try again later.');
        }
    }
};
