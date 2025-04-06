import { APIGatewayProxyEvent, Context } from 'aws-lambda';

// Declare globals for test
declare global {
  var mockInstanceState: string;
  var lastPutParameterValue: string;
  var mockGetParameterValue: string;
}

// Initialize global states
global.mockInstanceState = 'stopped';
global.lastPutParameterValue = '';
global.mockGetParameterValue = '';

// Create a mock implementation for EC2
const mockEC2Send = jest.fn().mockImplementation((command) => {
  if (command.constructor.name === 'DescribeInstancesCommand') {
    return Promise.resolve({
      Reservations: [{
        Instances: [{
          State: { Name: global.mockInstanceState || 'stopped' }
        }]
      }]
    });
  }
  if (command.constructor.name === 'StartInstancesCommand' || 
      command.constructor.name === 'StopInstancesCommand') {
    return Promise.resolve({});
  }
  return Promise.reject(new Error('Command not mocked'));
});

// Create a mock implementation for SSM
const mockSSMSend = jest.fn().mockImplementation((command) => {
  if (command.constructor.name === 'PutParameterCommand') {
    global.lastPutParameterValue = command.input.Value;
    return Promise.resolve({});
  }
  if (command.constructor.name === 'GetParameterCommand') {
    if (global.mockGetParameterValue) {
      return Promise.resolve({
        Parameter: {
          Value: global.mockGetParameterValue
        }
      });
    }
    return Promise.reject({ name: 'ParameterNotFound' });
  }
  return Promise.reject(new Error('Command not mocked'));
});

// Mock AWS clients first
jest.mock('@aws-sdk/client-ec2', () => {
  const originalModule = jest.requireActual('@aws-sdk/client-ec2');
  
  return {
    ...originalModule,
    EC2Client: jest.fn().mockImplementation(() => ({
      send: mockEC2Send
    })),
    DescribeInstancesCommand: originalModule.DescribeInstancesCommand,
    StartInstancesCommand: originalModule.StartInstancesCommand,
    StopInstancesCommand: originalModule.StopInstancesCommand
  };
});

jest.mock('@aws-sdk/client-ssm', () => {
  const originalModule = jest.requireActual('@aws-sdk/client-ssm');
  
  return {
    ...originalModule,
    SSMClient: jest.fn().mockImplementation(() => ({
      send: mockSSMSend
    })),
    PutParameterCommand: originalModule.PutParameterCommand,
    GetParameterCommand: originalModule.GetParameterCommand
  };
});

// Mock S3 client as well to avoid errors
jest.mock('@aws-sdk/client-s3', () => {
  const originalModule = jest.requireActual('@aws-sdk/client-s3');
  
  return {
    ...originalModule,
    S3Client: jest.fn().mockImplementation(() => ({
      send: jest.fn().mockResolvedValue({})
    }))
  };
});

// Mock the authentication function in the module
jest.mock('../../lib/lambdas/startstop', () => {
  const originalModule = jest.requireActual('../../lib/lambdas/startstop');
  
  return {
    ...originalModule,
    isValidDiscordRequest: jest.fn().mockImplementation((event) => {
      const authHeader = event.headers['x-discord-auth'] || '';
      return authHeader === 'test-token';
    })
  };
});

// Import after all mocks
import { handler } from '../../lib/lambdas/startstop';

describe('StartStop Lambda', () => {
  const originalEnv = process.env;
  
  beforeEach(() => {
    jest.resetModules();
    
    // Setup test environment
    process.env = { ...originalEnv };
    process.env.VALHEIM_INSTANCE_ID = 'i-12345678901234567';
    process.env.DISCORD_AUTH_TOKEN = 'test-token';
    process.env.WORLD_CONFIGURATIONS = 'TestWorld,123456789012345678,ValheimTest,testpassword;AnotherWorld,876543210987654321,ValheimOther,otherpassword';
    
    // Reset global state
    global.mockInstanceState = 'stopped';
    global.lastPutParameterValue = '';
    global.mockGetParameterValue = '';
    
    // Reset mocks
    mockEC2Send.mockClear();
    mockSSMSend.mockClear();
  });
  
  afterEach(() => {
    process.env = originalEnv;
  });
  
  const mockContext = {} as Context;
  const mockEvent = (body: any, auth: string = 'test-token'): APIGatewayProxyEvent => {
    return {
      body: JSON.stringify(body),
      headers: {
        'x-discord-auth': auth
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
  
  test('List worlds returns available worlds', async () => {
    const result = await handler(mockEvent({ action: 'list-worlds' }), mockContext);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.worlds).toHaveLength(2);
    expect(body.worlds[0].name).toBe('TestWorld');
    expect(body.worlds[1].name).toBe('AnotherWorld');
  });
  
  test('Start server with specific world name', async () => {
    const result = await handler(mockEvent({
      action: 'start',
      world_name: 'TestWorld'
    }), mockContext);
    
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).status).toBe('pending');
    
    // Verify SSM parameter was set with correct world config
    const paramValue = JSON.parse(global.lastPutParameterValue);
    expect(paramValue.name).toBe('TestWorld');
    expect(paramValue.worldName).toBe('ValheimTest');
  });
  
  test('Start server for Discord server ID', async () => {
    const result = await handler(mockEvent({
      action: 'start',
      guild_id: '123456789012345678'
    }), mockContext);
    
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).status).toBe('pending');
    
    // Verify SSM parameter was set with correct Discord world config
    const paramValue = JSON.parse(global.lastPutParameterValue);
    expect(paramValue.name).toBe('TestWorld'); // Should be TestWorld as it matches the Discord server ID
    expect(paramValue.discordServerId).toBe('123456789012345678');
  });
  
  test('Stop server', async () => {
    global.mockInstanceState = 'running';
    
    const result = await handler(mockEvent({
      action: 'stop'
    }), mockContext);
    
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).status).toBe('stopping');
  });
  
  test('Get server status', async () => {
    global.mockInstanceState = 'running';
    
    const result = await handler(mockEvent({
      action: 'status'
    }), mockContext);
    
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).status).toBe('running');
  });
  
  test('Start server with existing world configuration', async () => {
    global.mockGetParameterValue = JSON.stringify({
      name: 'ExistingWorld',
      worldName: 'ExistingValheim',
      serverPassword: 'existingpass'
    });
    
    const result = await handler(mockEvent({
      action: 'start'
    }), mockContext);
    
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.status).toBe('pending');
    expect(body.message).toContain('ExistingWorld');
    expect(body.world).toEqual({
      name: 'ExistingWorld',
      worldName: 'ExistingValheim'
    });
  });
  
  test('Invalid action returns 400', async () => {
    const result = await handler(mockEvent({
      action: 'invalid-action'
    }), mockContext);
    
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).available_worlds).toBeDefined();
  });
  
  test('Unauthorized request returns 401', async () => {
    const result = await handler(mockEvent({ action: 'status' }, 'wrong-token'), mockContext);
    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body).message).toBe('Unauthorized');
  });
});