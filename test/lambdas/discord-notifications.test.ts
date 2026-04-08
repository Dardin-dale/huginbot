import type { EventBridgeEvent, Context } from 'aws-lambda';

// Mock SSM Client - store the send mock in global
jest.mock('@aws-sdk/client-ssm', () => {
  const mockSend = jest.fn();
  (global as any).__mockSsmSend = mockSend;

  return {
    SSMClient: jest.fn().mockImplementation(() => ({
      send: mockSend,
    })),
    GetParameterCommand: jest.fn().mockImplementation((input: any) => ({
      input,
      constructor: { name: 'GetParameterCommand' },
    })),
  };
});

// Mock global fetch - store in global for test access
const mockFetch = jest.fn();
(global as any).__mockFetch = mockFetch;
global.fetch = mockFetch as any;

// Get references to the actual mocks
const getMockSsmSend = () => (global as any).__mockSsmSend as jest.Mock;
const getMockFetch = () => (global as any).__mockFetch as jest.Mock;

// Import after mocking
import { handler } from '../../lib/lambdas/discord-notifications';

describe('Discord Notifications Lambda', () => {
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

  // Helper to extract the parsed body from a fetch call
  const getFetchBody = (callIndex = 0): any => {
    const call = getMockFetch().mock.calls[callIndex];
    return JSON.parse(call[1].body);
  };

  // Helper to setup SSM mocks with webhook
  const setupWebhookMock = () => {
    getMockSsmSend().mockImplementation((command: any) => {
      const name = command.input?.Name;
      if (name === '/huginbot/active-world') {
        return Promise.resolve({
          Parameter: {
            Value: JSON.stringify({
              name: 'TestWorld',
              discordServerId: 'test-guild-123',
              serverPassword: 'secret123',
            }),
          },
        });
      }
      if (name === '/huginbot/discord-webhook/test-guild-123') {
        return Promise.resolve({
          Parameter: {
            Value: 'https://discord.com/api/webhooks/123/abc',
          },
        });
      }
      const error = new Error('Parameter not found');
      (error as any).name = 'ParameterNotFound';
      return Promise.reject(error);
    });
  };

  beforeEach(() => {
    // Reset mocks between tests
    getMockSsmSend().mockReset();
    getMockFetch().mockReset();
    getMockFetch().mockResolvedValue({ ok: true, status: 204 });

    // Default SSM responses - no webhook configured
    getMockSsmSend().mockRejectedValue({ name: 'ParameterNotFound' });
  });

  const createEvent = <T>(detailType: string, detail: T): EventBridgeEvent<string, T> => ({
    id: 'test-event-id',
    version: '0',
    account: '123456789012',
    time: '2023-01-01T00:00:00Z',
    region: 'us-west-2',
    resources: [],
    source: 'valheim.server',
    'detail-type': detailType,
    detail,
  });

  describe('Webhook URL Resolution', () => {
    test('gets webhook URL from active world guild ID', async () => {
      setupWebhookMock();

      const event = createEvent('PlayFab.JoinCodeDetected', { joinCode: 'ABCD1234' });
      await handler(event, mockContext);

      // Verify axios was called with the webhook URL
      expect(getMockFetch()).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/123/abc',
        expect.any(Object)
      );
    });

    test('skips notification when no webhook is configured', async () => {
      const event = createEvent('PlayFab.JoinCodeDetected', { joinCode: 'ABCD1234' });

      // Should not throw but log error
      await handler(event, mockContext);

      // Webhook URL lookup fails silently (no axios call)
      expect(getMockFetch()).not.toHaveBeenCalled();
    });
  });

  describe('PlayFab.JoinCodeDetected Event', () => {
    test('sends join code notification to Discord', async () => {
      setupWebhookMock();

      const event = createEvent('PlayFab.JoinCodeDetected', { joinCode: 'ABCD1234' });
      await handler(event, mockContext);

      expect(getMockFetch()).toHaveBeenCalled();
      const body = getFetchBody();
      expect(body.username).toBe('HuginBot');
      expect(body.embeds[0].title).toContain('Ready');
      expect(body.embeds[0].fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'World', value: 'TestWorld' }),
          expect.objectContaining({ name: 'Join Code', value: '`ABCD1234`' }),
        ])
      );
    });

    test('skips notification when join code is missing', async () => {
      setupWebhookMock();

      const event = createEvent('PlayFab.JoinCodeDetected', {});
      await handler(event, mockContext);

      // Should not call axios when join code is missing
      expect(getMockFetch()).not.toHaveBeenCalled();
    });
  });

  describe('Backup.Completed Event', () => {
    test('sends backup completed notification', async () => {
      setupWebhookMock();

      const event = createEvent('Backup.Completed', {
        worldName: 'TestWorld',
        size: 10 * 1024 * 1024, // 10 MB
        s3Uri: 's3://bucket/backup.tar.gz',
      });
      await handler(event, mockContext);

      expect(getMockFetch()).toHaveBeenCalled();
      const body = getFetchBody();
      expect(body.embeds[0].title).toContain('Backup');
      expect(body.embeds[0].fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'World', value: 'TestWorld' }),
          expect.objectContaining({ name: 'Size', value: expect.stringContaining('10') }),
        ])
      );
    });
  });

  describe('Backup.Complete (Shutdown Backup) Event', () => {
    test('sends shutdown backup notification when successful', async () => {
      setupWebhookMock();

      const event = createEvent('Backup.Complete', {
        backupCompleted: true,
      });
      await handler(event, mockContext);

      expect(getMockFetch()).toHaveBeenCalled();
      const body = getFetchBody();
      expect(body.embeds[0].title).toContain('Shutdown Backup');
      expect(body.embeds[0].description).toContain('Backup saved');
      expect(body.embeds[0].color).toBe(0x2ecc71);
    });

    test('sends warning notification when backup failed', async () => {
      setupWebhookMock();

      const event = createEvent('Backup.Complete', {
        backupCompleted: false,
        backupError: 'Disk full',
      });
      await handler(event, mockContext);

      expect(getMockFetch()).toHaveBeenCalled();
      const body = getFetchBody();
      expect(body.embeds[0].description).toContain('Disk full');
      expect(body.embeds[0].color).toBe(0xe67e22);
    });
  });

  describe('EC2 Instance State-change Notification Event', () => {
    test('sends server stopped notification when EC2 stops', async () => {
      setupWebhookMock();

      const event = createEvent('EC2 Instance State-change Notification', {
        'instance-id': 'i-1234567890abcdef0',
        state: 'stopped',
      });
      await handler(event, mockContext);

      expect(getMockFetch()).toHaveBeenCalled();
      const body = getFetchBody();
      expect(body.embeds[0].title).toContain('Stopped');
      expect(body.embeds[0].color).toBe(0x95a5a6);
    });

    test('ignores non-stopped EC2 state changes', async () => {
      setupWebhookMock();

      const event = createEvent('EC2 Instance State-change Notification', {
        'instance-id': 'i-1234567890abcdef0',
        state: 'running',
      });
      await handler(event, mockContext);

      // Should not send notification for running state
      expect(getMockFetch()).not.toHaveBeenCalled();
    });
  });

  describe('Unknown Event Types', () => {
    test('ignores unknown event types', async () => {
      const event = createEvent('Unknown.Event', { data: 'test' });
      await handler(event, mockContext);

      // Should not call axios for unknown events
      expect(getMockFetch()).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    test('continues silently when Discord webhook fails', async () => {
      setupWebhookMock();
      getMockFetch().mockRejectedValue(new Error('Discord API Error'));

      const event = createEvent('PlayFab.JoinCodeDetected', { joinCode: 'ABCD1234' });

      // Should not throw
      await expect(handler(event, mockContext)).resolves.not.toThrow();
    });

    test('continues silently when SSM parameter lookup fails', async () => {
      getMockSsmSend().mockRejectedValue(new Error('SSM Error'));

      const event = createEvent('PlayFab.JoinCodeDetected', { joinCode: 'ABCD1234' });

      // Should not throw
      await expect(handler(event, mockContext)).resolves.not.toThrow();
    });
  });
});
