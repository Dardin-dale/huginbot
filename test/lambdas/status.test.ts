import { APIGatewayProxyEvent, Context } from 'aws-lambda';

// Declare globals for test
declare global {
  var mockInstanceState: string;
  var mockPublicIpAddress: string | undefined;
}

// Create EC2 mock implementation first
const mockEC2Send = jest.fn().mockImplementation((command) => {
  if (command.constructor.name === 'DescribeInstancesCommand') {
    return Promise.resolve({
      Reservations: [{
        Instances: [{
          State: { Name: global.mockInstanceState || 'stopped' },
          PublicIpAddress: global.mockPublicIpAddress
        }]
      }]
    });
  }
  return Promise.reject(new Error('Command not mocked'));
});

// Mock AWS clients before importing the module
jest.mock('@aws-sdk/client-ec2', () => {
  const originalModule = jest.requireActual('@aws-sdk/client-ec2');
  
  return {
    ...originalModule,
    EC2Client: jest.fn().mockImplementation(() => ({
      send: mockEC2Send
    })),
    DescribeInstancesCommand: originalModule.DescribeInstancesCommand
  };
});

// Mock axios for the detailed status fetch
jest.mock('axios', () => ({
  get: jest.fn().mockImplementation((url, options) => {
    if (url.includes('/api/status')) {
      return Promise.resolve({
        status: 200,
        data: {
          uptime: '2h 15m',
          players: ['Player1', 'Player2'],
          version: '0.217.14'
        }
      });
    }
    return Promise.reject(new Error('URL not mocked'));
  })
}));

// Mock isValidDiscordRequest BEFORE importing any modules
const mockIsValidDiscordRequest = jest.fn().mockImplementation((event) => {
  const authHeader = event.headers['x-discord-auth'] || '';
  return authHeader === 'test-token';
});

// We need to mock the status module
jest.mock('../../lib/lambdas/status', () => {
  const original = jest.requireActual('../../lib/lambdas/status');
  
  return {
    ...original,
    isValidDiscordRequest: mockIsValidDiscordRequest
  };
});

// Import after all mocking is done
import { handler } from '../../lib/lambdas/status';

describe('Status Lambda', () => {
  const OLD_ENV = process.env;
  
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    process.env.VALHEIM_INSTANCE_ID = 'i-12345678901234567';
    process.env.DISCORD_AUTH_TOKEN = 'test-token';
    
    // Reset global mock state
    global.mockInstanceState = 'stopped';
    global.mockPublicIpAddress = undefined;
    
    // Reset mocks
    mockEC2Send.mockClear();
    mockIsValidDiscordRequest.mockClear();
  });
  
  afterEach(() => {
    process.env = OLD_ENV;
    jest.resetAllMocks();
  });
  
  const mockContext = {} as Context;
  const mockEvent = (auth: string = 'test-token'): APIGatewayProxyEvent => {
    return {
      body: null,
      headers: {
        'x-discord-auth': auth
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
  
  test('Unauthorized request returns 401', async () => {
    // Make sure this test's request is considered unauthorized
    mockIsValidDiscordRequest.mockReturnValueOnce(false);
    
    const result = await handler(mockEvent('wrong-token'), mockContext);
    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body).message).toBe('Unauthorized');
  });

  test('Missing instance ID returns 500', async () => {
    process.env.VALHEIM_INSTANCE_ID = '';
    const result = await handler(mockEvent(), mockContext);
    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body).message).toContain('Missing instance ID');
  });

  test('Stopped server returns correct status', async () => {
    global.mockInstanceState = 'stopped';
    
    const result = await handler(mockEvent(), mockContext);
    
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.status).toBe('stopped');
    expect(body.message).toBe('Server is offline. Use the start command to launch it.');
    expect(body.serverAddress).toBeNull();
  });

  test('Running server returns basic status when API unreachable', async () => {
    global.mockInstanceState = 'running';
    global.mockPublicIpAddress = '192.168.1.1';
    
    // Mock axios to reject the request
    jest.spyOn(require('axios'), 'get').mockRejectedValueOnce(new Error('Connection error'));
    
    const result = await handler(mockEvent(), mockContext);
    
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.status).toBe('running');
    expect(body.message).toBe('Server is online and ready to play!');
    expect(body.serverAddress).toBe('192.168.1.1:2456');
    expect(body.uptime).toBeNull(); // No detailed info
    expect(body.players).toBeNull(); // No detailed info
  });

  test('Running server returns detailed status when API available', async () => {
    global.mockInstanceState = 'running';
    global.mockPublicIpAddress = '192.168.1.1';
    
    const result = await handler(mockEvent(), mockContext);
    
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.status).toBe('running');
    expect(body.message).toBe('Server is online and ready to play!');
    expect(body.serverAddress).toBe('192.168.1.1:2456');
    expect(body.uptime).toBe('2h 15m');
    expect(body.players).toEqual(['Player1', 'Player2']);
    expect(body.version).toBe('0.217.14');
  });

  test('Pending server returns correct status', async () => {
    global.mockInstanceState = 'pending';
    
    const result = await handler(mockEvent(), mockContext);
    
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.status).toBe('pending');
    expect(body.message).toBe('Server is starting up. Please wait a few minutes.');
  });

  test('Server error returns 500', async () => {
    // Force the EC2Client mock to reject once
    mockEC2Send.mockRejectedValueOnce(new Error('AWS API Error'));
    
    const result = await handler(mockEvent(), mockContext);
    
    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body).message).toBe('Internal server error');
  });
});