const { SlashCommandBuilder, PermissionFlagsBits } = require('@discordjs/builders');
const { WebhookClient } = require('discord.js');
const AWS = require('aws-sdk');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Set up HuginBot webhooks in this channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.MANAGE_WEBHOOKS),

    async execute(interaction, lambda) {
        await interaction.deferReply({ ephemeral: true });
        
        try {
            // Create webhook in the current channel
            const webhook = await interaction.channel.createWebhook({
                name: 'HuginBot Notifications',
            });
            
            console.log(`Created webhook: ${webhook.url}`);
            
            // Store the webhook URL in AWS SSM Parameter Store
            const ssm = new AWS.SSM();
            await ssm.putParameter({
                Name: `/huginbot/discord-webhook/${interaction.guildId}`,
                Value: webhook.url,
                Type: 'SecureString',
                Overwrite: true
            }).promise();
            
            await interaction.editReply({ 
                content: 'HuginBot notifications have been set up in this channel! You will receive server start/stop notifications here.',
                ephemeral: true 
            });
        } catch (error) {
            console.error('Error setting up webhook:', error);
            await interaction.editReply({ 
                content: 'Failed to set up webhook. Please make sure I have the "Manage Webhooks" permission.',
                ephemeral: true 
            });
        }
    }
};
