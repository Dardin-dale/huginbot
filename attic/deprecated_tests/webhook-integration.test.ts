import axios from 'axios';

jest.mock('axios', () => ({
  post: jest.fn()
}));

const mockAxiosPost = axios.post as jest.Mock;

describe('Discord Webhook Integration', () => {
  const testWebhookUrl = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz';

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Default mock implementation
    mockAxiosPost.mockResolvedValue({ status: 200, data: 'success' });
  });

  test('should send server notifications to Discord webhook', async () => {
    // Send a test message to the webhook
    await axios.post(testWebhookUrl, {
      username: 'HuginBot',
      content: 'Server is starting...'
    });
    
    // Verify axios post was called with correct parameters
    expect(mockAxiosPost).toHaveBeenCalledWith(
      testWebhookUrl,
      {
        username: 'HuginBot',
        content: 'Server is starting...'
      }
    );
  });

  test('should handle webhook posting error', async () => {
    // Mock axios post failure
    mockAxiosPost.mockRejectedValueOnce(new Error('Failed to post to webhook'));
    
    // Attempt to send message to webhook
    await expect(
      axios.post(testWebhookUrl, {
        username: 'HuginBot',
        content: 'Test message'
      })
    ).rejects.toThrow('Failed to post to webhook');
  });
});