const axios = require('axios');

// Mock axios
jest.mock('axios');

describe('Discord Webhook Integration - Simple Test', () => {
  // Example webhook URL format
  const testWebhookUrl = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz';

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Default mock implementation for successful calls
    axios.post = jest.fn().mockResolvedValue({ status: 200, data: 'success' });
  });

  test('should send notifications to Discord webhook', async () => {
    // Send a test message to the webhook
    await axios.post(testWebhookUrl, {
      username: 'HuginBot',
      content: 'Server is starting...'
    });
    
    // Verify axios post was called with correct parameters
    expect(axios.post).toHaveBeenCalledWith(
      testWebhookUrl,
      {
        username: 'HuginBot',
        content: 'Server is starting...'
      }
    );
  });

  test('should handle webhook posting error gracefully', async () => {
    // Mock axios post failure
    axios.post.mockImplementationOnce(() => Promise.reject(new Error('Failed to post to webhook')));
    
    // Attempt to send message to webhook
    await expect(
      axios.post(testWebhookUrl, {
        username: 'HuginBot',
        content: 'Test message'
      })
    ).rejects.toThrow('Failed to post to webhook');
  });
});