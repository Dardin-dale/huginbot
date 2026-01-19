import type { APIGatewayProxyEvent, Context } from 'aws-lambda';

// Mock discord-interactions module - store reference in global
jest.mock('discord-interactions', () => {
  const mockVerifyKey = jest.fn();
  (global as any).__mockVerifyKey = mockVerifyKey;
  return { verifyKey: mockVerifyKey };
});

// Mock global fetch for follow-up messages
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock the aws-clients module - store references in global
jest.mock('../../lib/lambdas/utils/aws-clients', () => {
  const mockEc2Send = jest.fn();
  const mockSsmSend = jest.fn();
  const mockS3Send = jest.fn();
  const mockGetFastServerStatus = jest.fn();
  const mockGetStatusMessage = jest.fn((status: string) => {
    switch (status) {
      case 'running': return 'Server is online and ready to play!';
      case 'stopped': return 'Server is offline. Use the start command to launch it.';
      case 'pending': return 'Server is starting up.';
      default: return `Server status: ${status}`;
    }
  });

  (global as any).__mockEc2Send = mockEc2Send;
  (global as any).__mockSsmSend = mockSsmSend;
  (global as any).__mockS3Send = mockS3Send;
  (global as any).__mockGetFastServerStatus = mockGetFastServerStatus;
  (global as any).__mockGetStatusMessage = mockGetStatusMessage;

  return {
    ec2Client: { send: mockEc2Send },
    ssmClient: { send: mockSsmSend },
    s3Client: { send: mockS3Send },
    VALHEIM_INSTANCE_ID: 'i-1234567890abcdef0',
    BACKUP_BUCKET_NAME: 'test-backup-bucket',
    DISCORD_AUTH_TOKEN: 'test-auth-token',
    SSM_PARAMS: {
      PLAYFAB_JOIN_CODE: '/huginbot/playfab-join-code',
      PLAYFAB_JOIN_CODE_TIMESTAMP: '/huginbot/playfab-join-code-timestamp',
      ACTIVE_WORLD: '/huginbot/active-world',
      DISCORD_WEBHOOK: '/huginbot/discord-webhook',
      AUTO_SHUTDOWN_MINUTES: '/huginbot/auto-shutdown-minutes',
      GUILD_DEFAULT_WORLD_PREFIX: '/huginbot/discord',
    },
    withRetry: async <T>(operation: () => Promise<T>) => operation(),
    getInstanceStatus: jest.fn(),
    getInstanceDetails: jest.fn(),
    getFastServerStatus: mockGetFastServerStatus,
    getDetailedServerStatus: jest.fn(),
    getStatusMessage: mockGetStatusMessage,
  };
});

// Get references to the actual mocks after modules are loaded
const getMockVerifyKey = () => (global as any).__mockVerifyKey as jest.Mock;
const getMockGetFastServerStatus = () => (global as any).__mockGetFastServerStatus as jest.Mock;
const getMockSsmSend = () => (global as any).__mockSsmSend as jest.Mock;

// Import after mocking
import { handler } from '../../lib/lambdas/commands';

describe('Commands Lambda', () => {
  const originalEnv = process.env;

  const mockContext = {
    callbackWaitsForEmptyEventLoop: true,
    functionName: 'test',
    functionVersion: '1',
    invokedFunctionArn: 'arn:aws:lambda:us-west-2:123456789012:function:test',
    memoryLimitInMB: '128',
    awsRequestId: 'test-request-id',
    logGroupName: '/aws/lambda/test',
    logStreamName: 'test-stream',
    getRemainingTimeInMillis: () => 30000,
    done: jest.fn(),
    fail: jest.fn(),
    succeed: jest.fn(),
  } as Context;

  beforeEach(() => {
    // Reset all mocks
    getMockVerifyKey().mockReset();
    getMockGetFastServerStatus().mockReset();
    getMockSsmSend().mockReset();
    mockFetch.mockReset();

    // Setup test environment
    process.env = { ...originalEnv };
    process.env.VALHEIM_INSTANCE_ID = 'i-1234567890abcdef0';
    process.env.BACKUP_BUCKET_NAME = 'test-backup-bucket';
    process.env.DISCORD_BOT_PUBLIC_KEY = 'test-public-key';
    process.env.DISCORD_BOT_TOKEN = 'test-bot-token';
    process.env.AWS_REGION = 'us-west-2';

    // Default: signature verification passes
    getMockVerifyKey().mockResolvedValue(true);

    // Default SSM behavior
    getMockSsmSend().mockRejectedValue({ name: 'ParameterNotFound' });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const createDiscordEvent = (body: any, headers: Record<string, string> = {}): APIGatewayProxyEvent => ({
    body: JSON.stringify(body),
    headers: {
      'x-signature-ed25519': 'test-signature',
      'x-signature-timestamp': 'test-timestamp',
      ...headers,
    },
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: '/valheim/control',
    pathParameters: null,
    queryStringParameters: null,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as any,
    resource: '',
  });

  describe('Signature Verification', () => {
    test('returns 401 when signature header is missing', async () => {
      const event = createDiscordEvent({ type: 1 }, {
        'x-signature-ed25519': '',
      });

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body).error).toBe('Unauthorized');
    });

    test('returns 401 when timestamp header is missing', async () => {
      const event = createDiscordEvent({ type: 1 }, {
        'x-signature-timestamp': '',
      });

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(401);
    });

    test('returns 401 when signature verification fails', async () => {
      getMockVerifyKey().mockResolvedValue(false);

      const event = createDiscordEvent({ type: 1 });
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body).error).toBe('Invalid request signature');
    });
  });

  describe('PING Handler', () => {
    test('responds with PONG to Discord PING', async () => {
      const event = createDiscordEvent({ type: 1 });
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({ type: 1 });
    });
  });

  describe('/status Command', () => {
    test('returns 200 for status command when server is running', async () => {
      getMockGetFastServerStatus().mockResolvedValue({
        status: 'running',
        message: 'Server is online and ready to play!',
        launchTime: new Date(),
      });
      getMockSsmSend().mockResolvedValue({ Parameters: [] });

      const event = createDiscordEvent({
        type: 2,
        data: { name: 'status' },
      });

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.type).toBe(4); // CHANNEL_MESSAGE_WITH_SOURCE
      expect(body.data.embeds).toBeDefined();
    });

    test('returns 200 for status command when server is stopped', async () => {
      getMockGetFastServerStatus().mockResolvedValue({
        status: 'stopped',
        message: 'Server is offline. Use the start command to launch it.',
      });

      const event = createDiscordEvent({
        type: 2,
        data: { name: 'status' },
      });

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.data.embeds[0].description).toContain('offline');
    });
  });

  describe('/help Command', () => {
    test('returns help information', async () => {
      const event = createDiscordEvent({
        type: 2,
        data: { name: 'help' },
      });

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.data.embeds[0].title).toContain('Help');
      expect(body.data.embeds[0].fields.length).toBeGreaterThan(0);
    });
  });

  describe('/hail Command', () => {
    test('returns a random Hugin response', async () => {
      const event = createDiscordEvent({
        type: 2,
        data: { name: 'hail' },
      });

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.data.embeds[0].title).toContain('Hugin');
    });
  });

  describe('Unknown Commands', () => {
    test('returns unknown command message for invalid commands', async () => {
      const event = createDiscordEvent({
        type: 2,
        data: { name: 'invalid-command' },
      });

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.data.content).toContain('Unknown command');
    });
  });
});
