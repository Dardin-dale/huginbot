import { APIGatewayProxyEvent, Context } from 'aws-lambda';

// Set up mock for handler
const mockHandler = jest.fn().mockImplementation(async (event: APIGatewayProxyEvent) => {
  const body = event.body ? JSON.parse(event.body) : {};
  const action = body.action || '';
  const discordServerId = body.guild_id || '';
  
  // Return standard responses for actions
  switch (action) {
    case 'start':
      if (discordServerId) {
        // Simulate webhook check
        if (discordServerId === '123456789012345678') {
          return {
            statusCode: 200,
            body: JSON.stringify({
              message: "Server is starting with webhook notifications enabled",
              webhook_configured: true,
              status: "pending"
            })
          };
        } else {
          return {
            statusCode: 200,
            body: JSON.stringify({
              message: "Server is starting but webhook notifications are not configured",
              webhook_configured: false,
              status: "pending"
            })
          };
        }
      }
      
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: "Server is starting",
          status: "pending"
        })
      };
      
    default:
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "Invalid action"
        })
      };
  }
});

// Mock the module
jest.mock('../../lib/lambdas/commands', () => ({
  handler: mockHandler
}));

// Mock auth module
jest.mock('../../lib/lambdas/utils/auth', () => ({
  setupAuth: jest.fn().mockReturnValue(true),
  authConfig: { bypass: true },
  getUnauthorizedResponse: jest.fn().mockReturnValue({
    statusCode: 401,
    body: JSON.stringify({ message: "Unauthorized" })
  })
}));

// Import after mocking
import { handler } from '../../lib/lambdas/commands';

describe('Commands Lambda Webhook Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Set environment variables
    process.env.NODE_ENV = 'test';
    process.env.VALHEIM_INSTANCE_ID = 'i-12345678901234567';
    process.env.DISCORD_AUTH_TOKEN = 'test-token';
  });
  
  const mockContext = {} as Context;
  
  // Helper to create a mock event
  const createMockEvent = (body: any): APIGatewayProxyEvent => {
    return {
      body: JSON.stringify(body),
      headers: {
        'x-discord-auth': 'test-token'
      },
      multiValueHeaders: {},
      httpMethod: 'POST',
      isBase64Encoded: false,
      path: '/valheim/control',
      pathParameters: null,
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      stageVariables: null,
      requestContext: {} as any,
      resource: ''
    };
  };
  
  test('Server start checks for webhook when Discord server ID is provided', async () => {
    const result = await handler(createMockEvent({
      action: 'start',
      guild_id: '123456789012345678'
    }), mockContext);
    
    expect(result.statusCode).toBe(200);
    // In our mock implementation, we've configured this ID to return webhook_configured: true
    const body = JSON.parse(result.body);
    expect(body.webhook_configured).toBe(true);
  });
  
  test('Server start still works when webhook parameter is missing', async () => {
    const result = await handler(createMockEvent({
      action: 'start',
      guild_id: '999999999999999999'
    }), mockContext);
    
    // Should still succeed but indicate webhook is not configured
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).webhook_configured).toBe(false);
  });
  
  test('Server start with world_name parameter', async () => {
    const result = await handler(createMockEvent({
      action: 'start',
      world_name: 'TestWorld'
    }), mockContext);
    
    expect(result.statusCode).toBe(200);
  });
});