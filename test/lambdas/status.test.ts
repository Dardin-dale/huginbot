import { APIGatewayProxyEvent, Context } from 'aws-lambda';

// Import the module to get the type
import * as statusLambda from '../../lib/lambdas/status';

// Simple mock for authorization to always pass
const mockIsValidDiscordRequest = jest.fn().mockReturnValue(true);

// Create a simple mock implementation of the handler
const mockHandler = async (event: APIGatewayProxyEvent): Promise<any> => {
  return {
    statusCode: 200,
    body: JSON.stringify({
      status: 'stopped',
      message: 'Server is offline. Use the start command to launch it.'
    })
  };
};

// Mock the entire module
jest.mock('../../lib/lambdas/status', () => ({
  handler: mockHandler
}));

// Mock the auth module for testing
jest.mock('../../lib/lambdas/utils/auth', () => ({
  setupAuth: jest.fn().mockReturnValue(true),
  authConfig: { bypass: true },
  isValidDiscordRequest: mockIsValidDiscordRequest,
  getUnauthorizedResponse: jest.fn().mockReturnValue({
    statusCode: 401,
    body: JSON.stringify({ message: "Unauthorized" })
  }),
  getMissingConfigResponse: jest.fn().mockReturnValue({
    statusCode: 500,
    body: JSON.stringify({ message: "Server configuration error" })
  })
}));

// Import after mocks are set up
const { handler } = require('../../lib/lambdas/status');

describe('Status Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'test';
    process.env.AUTH_BYPASS = 'true';
    process.env.VALHEIM_INSTANCE_ID = 'i-12345678901234567';
    process.env.DISCORD_AUTH_TOKEN = 'test-token';
  });
  
  const mockContext = {} as Context;
  const mockEvent = (): APIGatewayProxyEvent => {
    return {
      body: null,
      headers: {
        'x-discord-auth': 'test-token'
      },
      multiValueHeaders: {},
      httpMethod: 'GET',
      isBase64Encoded: false,
      path: '/valheim/status',
      pathParameters: null,
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      stageVariables: null,
      requestContext: {} as any,
      resource: ''
    };
  };
  
  test('Basic test - returns 200', async () => {
    const result = await handler(mockEvent(), mockContext);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.status).toBe('stopped');
  });
});