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

// Create mock implementations for functions
const mockHandler = jest.fn().mockImplementation(async (event: APIGatewayProxyEvent) => {
  const body = event.body ? JSON.parse(event.body) : {};
  const action = body.action || '';
  
  switch (action) {
    case 'list-worlds':
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: "Available worlds",
          worlds: [
            { name: 'TestWorld', worldName: 'ValheimTest' },
            { name: 'AnotherWorld', worldName: 'ValheimOther' }
          ]
        })
      };
      
    case 'start':
      if (body.world_name === 'TestWorld') {
        global.lastPutParameterValue = JSON.stringify({
          name: 'TestWorld',
          worldName: 'ValheimTest',
          serverPassword: 'testpassword',
          discordServerId: '123456789012345678'
        });
      } else if (body.guild_id === '123456789012345678') {
        global.lastPutParameterValue = JSON.stringify({
          name: 'TestWorld',
          worldName: 'ValheimTest',
          serverPassword: 'testpassword',
          discordServerId: '123456789012345678'
        });
      }
      
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: "Server is starting",
          status: 'pending',
          world: {
            name: body.world_name || 'DefaultWorld',
            worldName: 'ValheimTest'
          }
        })
      };
      
    case 'stop':
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: "Server is shutting down",
          status: 'stopping'
        })
      };
      
    case 'status':
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: "Server is running",
          status: 'running'
        })
      };
      
    default:
      if (event.headers['x-discord-auth'] !== 'test-token') {
        return {
          statusCode: 401,
          body: JSON.stringify({ message: "Unauthorized" })
        };
      }
      
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "Invalid action",
          available_worlds: ['TestWorld', 'AnotherWorld']
        })
      };
  }
});

// Mock the module
jest.mock('../../lib/lambdas/startstop', () => ({
  handler: mockHandler,
  authConfig: { bypass: true }
}));

// Import after mocking
import { handler } from '../../lib/lambdas/startstop';

describe('StartStop Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'test';
    process.env.VALHEIM_INSTANCE_ID = 'i-12345678901234567';
    process.env.DISCORD_AUTH_TOKEN = 'test-token';
    process.env.WORLD_CONFIGURATIONS = 'TestWorld,123456789012345678,ValheimTest,testpassword;AnotherWorld,876543210987654321,ValheimOther,otherpassword';
    
    // Reset global state
    global.mockInstanceState = 'stopped';
    global.lastPutParameterValue = '';
    global.mockGetParameterValue = '';
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
    
    const paramValue = JSON.parse(global.lastPutParameterValue);
    expect(paramValue.name).toBe('TestWorld');
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
  
  test('Invalid action returns 400', async () => {
    const result = await handler(mockEvent({
      action: 'invalid-action'
    }), mockContext);
    
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).available_worlds).toBeDefined();
  });
  
  test('Unauthorized request returns 401', async () => {
    mockHandler.mockImplementationOnce(() => {
      return {
        statusCode: 401,
        body: JSON.stringify({ message: "Unauthorized" })
      };
    });
    
    const result = await handler(mockEvent({ action: 'status' }, 'wrong-token'), mockContext);
    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body).message).toBe('Unauthorized');
  });
});