const { SlashCommandBuilder, PermissionFlagsBits } = require('@discordjs/builders');
const { WebhookClient, EmbedBuilder } = require('discord.js');
const AWS = require('aws-sdk');
const axios = require('axios');

/**
 * Validate a Discord webhook URL by sending a test message
 * @param {string} webhookUrl The Discord webhook URL to validate
 * @returns {Promise<{isValid: boolean, message: string}>} Validation result
 */
async function validateWebhook(webhookUrl) {
    try {
        // Send a test message to the webhook
        const response = await axios.post(webhookUrl, {
            content: 'This is a test message from HuginBot to verify the webhook configuration.',
            username: 'HuginBot',
            avatar_url: 'https://static.wikia.nocookie.net/valheim/images/7/7d/Hugin.png',
            embeds: [{
                title: 'Webhook Configuration Test',
                description: 'If you see this message, the webhook is configured correctly. ' +
                    'You will receive server notifications at this channel.',
                color: 0x3498db, // Blue color
                footer: {
                    text: 'HuginBot Webhook Validation'
                },
                timestamp: new Date().toISOString()
            }]
        });
        
        // Discord returns 204 No Content for successful webhook calls
        if (response.status === 204) {
            return {
                isValid: true,
                message: 'Webhook is valid and working'
            };
        } else {
            return {
                isValid: false,
                message: `Unexpected status code: ${response.status}`
            };
        }
    } catch (error) {
        console.error('Webhook validation error:', error);
        
        // Check for axios error with response
        if (error.response) {
            const status = error.response.status;
            let message = `Webhook validation failed with status ${status}`;
            
            if (status === 404) {
                message = 'Webhook not found. The webhook may have been deleted in Discord.';
            } else if (status === 401 || status === 403) {
                message = 'Unauthorized access to webhook. The webhook token may be invalid.';
            } else if (status >= 500) {
                message = 'Discord server error. Please try again later.';
            }
            
            return {
                isValid: false,
                message: message
            };
        }
        
        // Network or other error
        return {
            isValid: false,
            message: error.message || 'Unknown error validating webhook'
        };
    }
}

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
                avatar: 'https://static.wikia.nocookie.net/valheim/images/7/7d/Hugin.png',
                reason: `Requested by ${interaction.user.tag} for HuginBot notifications`
            });
            
            console.log(`Created webhook: ${webhook.url}`);
            
            // Validate the webhook by sending a test message
            const validationResult = await validateWebhook(webhook.url);
            if (!validationResult.isValid) {
                console.error(`Webhook validation failed: ${validationResult.message}`);
                await webhook.delete('Validation failed');
                
                await interaction.editReply({ 
                    content: `Failed to set up webhook: ${validationResult.message}`,
                    ephemeral: true 
                });
                return;
            }
            
            // Store the webhook URL in AWS SSM Parameter Store
            const ssm = new AWS.SSM();
            await ssm.putParameter({
                Name: `/huginbot/discord-webhook/${interaction.guildId}`,
                Value: webhook.url,
                Type: 'SecureString',
                Overwrite: true
            }).promise();
            
            // Create an embedded response
            const embed = new EmbedBuilder()
                .setColor(0x57F287) // Discord green
                .setTitle('HuginBot Setup Successful')
                .setDescription('Notifications have been set up in this channel!')
                .addFields(
                    { name: 'Channel', value: `<#${interaction.channelId}>`, inline: true },
                    { name: 'Server ID', value: interaction.guildId, inline: true },
                    { name: 'Setup By', value: `<@${interaction.user.id}>`, inline: true }
                )
                .setFooter({ text: 'You will receive server start/stop notifications here' })
                .setTimestamp();
                
            await interaction.editReply({ 
                content: 'Setup completed successfully!',
                embeds: [embed],
                ephemeral: true 
            });
            
            // Also send a confirmation message to the channel
            const publicEmbed = new EmbedBuilder()
                .setColor(0x3498DB) // Blue color
                .setTitle('HuginBot Notifications Configured')
                .setDescription('This channel will now receive Valheim server notifications.')
                .addFields(
                    { name: 'Available Commands', value: 'Use </help:1234> to see all available commands' },
                    { name: 'Test Notification', value: 'A test message has been sent to verify the webhook is working.' }
                )
                .setFooter({ text: 'HuginBot - The Valheim Server Manager' });
                
            await interaction.channel.send({ embeds: [publicEmbed] });
        } catch (error) {
            console.error('Error setting up webhook:', error);
            await interaction.editReply({ 
                content: 'Failed to set up webhook. Please make sure I have the "Manage Webhooks" permission and try again.',
                ephemeral: true 
            });
        }
    }
};
