import axios from 'axios';
import { PutParameterCommand } from '@aws-sdk/client-ssm';
import { ssmClient, SSM_PARAMS, withRetry } from './aws-clients';

/**
 * Discord webhook validation result interface
 */
export interface WebhookValidationResult {
  isValid: boolean;
  message: string;
  statusCode?: number;
}

/**
 * Validate a Discord webhook URL
 * @param webhookUrl The Discord webhook URL to validate
 * @returns WebhookValidationResult with validation status
 */
export async function validateWebhook(webhookUrl: string): Promise<WebhookValidationResult> {
  try {
    if (!webhookUrl || webhookUrl.trim() === '') {
      return {
        isValid: false,
        message: 'Webhook URL cannot be empty'
      };
    }
    
    // Basic URL validation
    try {
      const url = new URL(webhookUrl);
      if (!url.host.includes('discord.com') && !url.host.includes('discordapp.com')) {
        return {
          isValid: false,
          message: 'Invalid Discord webhook URL format. Must be a discord.com or discordapp.com URL'
        };
      }
      
      if (!url.pathname.includes('/api/webhooks/')) {
        return {
          isValid: false,
          message: 'Invalid Discord webhook URL path. Must contain "/api/webhooks/"'
        };
      }
    } catch (error) {
      return {
        isValid: false,
        message: 'Invalid URL format'
      };
    }
    
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
        statusCode: 204,
        message: 'Webhook is valid and working'
      };
    } else {
      return {
        isValid: false,
        statusCode: response.status,
        message: `Unexpected status code: ${response.status}`
      };
    }
  } catch (error) {
    console.error('Webhook validation error:', error);
    
    // Check for axios error with response
    if (error && typeof error === 'object' && 'response' in error) {
      const status = (error as any).response?.status;
      let message = `Webhook validation failed with status ${status}`;
      
      // Add more specific messages for common error codes
      if (status === 404) {
        message = 'Webhook not found. The webhook may have been deleted in Discord.';
      } else if (status === 401 || status === 403) {
        message = 'Unauthorized access to webhook. The webhook token may be invalid.';
      } else if (status >= 500) {
        message = 'Discord server error. Please try again later.';
      }
      
      return {
        isValid: false,
        statusCode: status,
        message: message
      };
    }
    
    // Network or other error
    return {
      isValid: false,
      message: (error as any)?.message || 'Unknown error validating webhook'
    };
  }
}

/**
 * Store a webhook URL in SSM Parameter Store
 * @param discordServerId The Discord server ID
 * @param webhookUrl The Discord webhook URL
 * @returns True if successful, false otherwise
 */
export async function storeWebhook(discordServerId: string, webhookUrl: string): Promise<boolean> {
  try {
    // Validate before storing
    const validationResult = await validateWebhook(webhookUrl);
    if (!validationResult.isValid) {
      console.error(`Cannot store invalid webhook: ${validationResult.message}`);
      return false;
    }
    
    // Store in SSM Parameter Store
    const paramName = `${SSM_PARAMS.DISCORD_WEBHOOK}/${discordServerId}`;
    await withRetry(() => 
      ssmClient.send(new PutParameterCommand({
        Name: paramName,
        Value: webhookUrl,
        Type: 'SecureString',
        Overwrite: true
      }))
    );
    
    console.log(`Webhook for Discord server ${discordServerId} stored successfully`);
    return true;
  } catch (error) {
    console.error(`Error storing webhook for Discord server ${discordServerId}:`, error);
    return false;
  }
}

/**
 * Send a message to a Discord webhook
 * @param webhookUrl The Discord webhook URL
 * @param message The message to send
 * @param username Optional username override
 * @returns True if successful, false otherwise
 */
export async function sendWebhookMessage(
  webhookUrl: string, 
  message: string | object,
  username: string = 'HuginBot'
): Promise<boolean> {
  try {
    // Format the message payload
    const payload: any = {
      username: username,
      avatar_url: 'https://static.wikia.nocookie.net/valheim/images/7/7d/Hugin.png'
    };
    
    // Handle string or object messages
    if (typeof message === 'string') {
      payload.content = message;
    } else {
      // If it's an embed object, we need to wrap it
      if (message.hasOwnProperty('title') || message.hasOwnProperty('description')) {
        payload.embeds = [message];
      } else {
        Object.assign(payload, message);
      }
    }
    
    // Send the message
    const response = await axios.post(webhookUrl, payload);
    
    // Discord returns 204 No Content for successful webhook calls
    return response.status === 204;
  } catch (error) {
    console.error('Error sending webhook message:', error);
    return false;
  }
}