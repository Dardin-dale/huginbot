const { SlashCommandBuilder } = require('@discordjs/builders');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show Valheim server commands help'),

    async execute(interaction, lambda) {
        await interaction.deferReply();

        try {
            // Invoke Lambda function
            const response = await lambda.invoke({
                FunctionName: process.env.COMMANDS_LAMBDA_NAME,
                Payload: JSON.stringify({
                    body: JSON.stringify({
                        action: 'help',
                        guild_id: interaction.guildId
                    }),
                    headers: {
                        'x-discord-auth': process.env.DISCORD_AUTH_TOKEN
                    }
                })
            }).promise();

            const result = JSON.parse(response.Payload);
            const body = JSON.parse(result.body);

            await interaction.editReply(body.message);
        } catch (error) {
            console.error('Error getting help:', error);
            await interaction.editReply('Failed to retrieve command help. Please try again later.');
        }
    }
};
