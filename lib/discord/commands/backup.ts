const { SlashCommandBuilder } = require('@discordjs/builders');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('backup')
        .setDescription('Manage server backups')
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List available backups'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('create')
                .setDescription('Create a new backup')),

    async execute(interaction, lambda) {
        await interaction.deferReply();
        
        const subcommand = interaction.options.getSubcommand();

        try {
            const response = await lambda.invoke({
                FunctionName: process.env.COMMANDS_LAMBDA_NAME,
                Payload: JSON.stringify({
                    body: JSON.stringify({
                        action: 'backup',
                        backup_action: subcommand,
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
            console.error('Error executing backup command:', error);
            await interaction.editReply('Backup operation failed. Please try again later.');
        }
    }
};
