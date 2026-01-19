// Create a mock module that stores the send function in global for test access
jest.mock('../../lib/lambdas/utils/aws-clients', () => {
  const actualMockSend = jest.fn();
  (global as any).__mockS3Send = actualMockSend;

  return {
    s3Client: { send: actualMockSend },
    BACKUP_BUCKET_NAME: 'test-backup-bucket',
    ec2Client: {},
    ssmClient: {},
    VALHEIM_INSTANCE_ID: 'test-instance',
    withRetry: async <T>(operation: () => Promise<T>) => operation(),
  };
});

// Get reference to the actual mock
const getMockSend = () => (global as any).__mockS3Send as jest.Mock;

// Import after mocking
import { handler } from '../../lib/lambdas/cleanup-backups';

describe('Cleanup Backups Lambda', () => {
  beforeEach(() => {
    // Reset the mock between tests
    getMockSend().mockReset();
  });

  test('No backups found logs message', async () => {
    // Handler makes 3 list calls for root-level: root, worlds/, then cleanupBackupsInFolder('')
    getMockSend().mockResolvedValue({ CommonPrefixes: [], Contents: [] });

    await handler();

    // Should have made list calls but no delete calls
    expect(getMockSend()).toHaveBeenCalled();
    // All calls should be list commands (no delete)
    const calls = getMockSend().mock.calls;
    expect(calls.every((call: any) =>
      call[0].constructor.name === 'ListObjectsV2Command'
    )).toBe(true);
  });

  test('Fewer than BACKUPS_TO_KEEP backups are all kept', async () => {
    let callCount = 0;
    getMockSend().mockImplementation(() => {
      callCount++;
      // First two calls return empty (root level check and worlds/ check)
      if (callCount <= 2) {
        return Promise.resolve({ CommonPrefixes: [], Contents: [] });
      }
      // Third call: cleanupBackupsInFolder('') - return few backups
      return Promise.resolve({
        CommonPrefixes: [],
        Contents: [
          { Key: 'backup1.tar.gz', LastModified: new Date('2023-01-01') },
          { Key: 'backup2.tar.gz', LastModified: new Date('2023-01-02') }
        ]
      });
    });

    await handler();

    // Should have made list calls but no delete calls
    expect(getMockSend()).toHaveBeenCalled();
    const deleteCommands = getMockSend().mock.calls.filter((call: any) =>
      call[0].constructor.name === 'DeleteObjectCommand'
    );
    expect(deleteCommands).toHaveLength(0);
  });

  test('More than BACKUPS_TO_KEEP backups deletes oldest ones', async () => {
    let callCount = 0;
    getMockSend().mockImplementation((command: any) => {
      callCount++;
      // Delete responses
      if (command.constructor.name === 'DeleteObjectCommand') {
        return Promise.resolve({});
      }
      // First two calls return empty (root level check and worlds/ check)
      if (callCount <= 2) {
        return Promise.resolve({ CommonPrefixes: [], Contents: [] });
      }
      // Third call: cleanupBackupsInFolder('') - return many backups (>7)
      return Promise.resolve({
        CommonPrefixes: [],
        Contents: [
          { Key: 'backup1.tar.gz', LastModified: new Date('2023-01-01') },
          { Key: 'backup2.tar.gz', LastModified: new Date('2023-01-02') },
          { Key: 'backup3.tar.gz', LastModified: new Date('2023-01-03') },
          { Key: 'backup4.tar.gz', LastModified: new Date('2023-01-04') },
          { Key: 'backup5.tar.gz', LastModified: new Date('2023-01-05') },
          { Key: 'backup6.tar.gz', LastModified: new Date('2023-01-06') },
          { Key: 'backup7.tar.gz', LastModified: new Date('2023-01-07') },
          { Key: 'backup8.tar.gz', LastModified: new Date('2023-01-08') },
          { Key: 'backup9.tar.gz', LastModified: new Date('2023-01-09') },
        ]
      });
    });

    await handler();

    // Should delete 2 oldest backups (keeping 7 most recent - default is 7)
    const deleteCommands = getMockSend().mock.calls.filter((call: any) =>
      call[0].constructor.name === 'DeleteObjectCommand'
    );
    expect(deleteCommands.length).toBeGreaterThan(0);

    // Verify the oldest backups were deleted
    const deletedKeys = deleteCommands.map((call: any) => call[0].input.Key);
    expect(deletedKeys).toContain('backup1.tar.gz');
    expect(deletedKeys).toContain('backup2.tar.gz');
  });

  test('Non-backup files are ignored', async () => {
    let callCount = 0;
    getMockSend().mockImplementation((command: any) => {
      callCount++;
      // Delete responses
      if (command.constructor.name === 'DeleteObjectCommand') {
        return Promise.resolve({});
      }
      // First two calls return empty (root level check and worlds/ check)
      if (callCount <= 2) {
        return Promise.resolve({ CommonPrefixes: [], Contents: [] });
      }
      // Third call: cleanupBackupsInFolder('') - return mix of files
      return Promise.resolve({
        CommonPrefixes: [],
        Contents: [
          { Key: 'backup1.tar.gz', LastModified: new Date('2023-01-01') },
          { Key: 'backup2.tar.gz', LastModified: new Date('2023-01-02') },
          { Key: 'backup3.tar.gz', LastModified: new Date('2023-01-03') },
          { Key: 'backup4.tar.gz', LastModified: new Date('2023-01-04') },
          { Key: 'backup5.tar.gz', LastModified: new Date('2023-01-05') },
          { Key: 'backup6.tar.gz', LastModified: new Date('2023-01-06') },
          { Key: 'backup7.tar.gz', LastModified: new Date('2023-01-07') },
          { Key: 'backup8.tar.gz', LastModified: new Date('2023-01-08') },
          { Key: 'readme.txt', LastModified: new Date('2023-01-09') },
          { Key: 'config.json', LastModified: new Date('2023-01-10') }
        ]
      });
    });

    await handler();

    // Should only delete old backups (8 .tar.gz files, keep 7, delete 1)
    const deleteCommands = getMockSend().mock.calls.filter((call: any) =>
      call[0].constructor.name === 'DeleteObjectCommand'
    );
    expect(deleteCommands.length).toBeGreaterThanOrEqual(1);

    // Verify non-backup files were not deleted
    const deletedKeys = deleteCommands.map((call: any) => call[0].input.Key);
    expect(deletedKeys).not.toContain('readme.txt');
    expect(deletedKeys).not.toContain('config.json');
  });

  test('Multiple world folders are processed separately', async () => {
    let callCount = 0;

    getMockSend().mockImplementation((command: any) => {
      callCount++;
      const input = command.input;

      // Delete responses
      if (command.constructor.name === 'DeleteObjectCommand') {
        return Promise.resolve({});
      }

      // First call: check root level
      if (callCount === 1) {
        return Promise.resolve({ CommonPrefixes: [] });
      }

      // Second call: check worlds/ prefix - return world folders
      if (callCount === 2 && input.Prefix === 'worlds/') {
        return Promise.resolve({
          CommonPrefixes: [
            { Prefix: 'worlds/world1/' },
            { Prefix: 'worlds/world2/' }
          ]
        });
      }

      // World1 folder - 9 backups (delete 2)
      if (input.Prefix === 'worlds/world1/') {
        return Promise.resolve({
          Contents: [
            { Key: 'worlds/world1/backup1.tar.gz', LastModified: new Date('2023-01-01') },
            { Key: 'worlds/world1/backup2.tar.gz', LastModified: new Date('2023-01-02') },
            { Key: 'worlds/world1/backup3.tar.gz', LastModified: new Date('2023-01-03') },
            { Key: 'worlds/world1/backup4.tar.gz', LastModified: new Date('2023-01-04') },
            { Key: 'worlds/world1/backup5.tar.gz', LastModified: new Date('2023-01-05') },
            { Key: 'worlds/world1/backup6.tar.gz', LastModified: new Date('2023-01-06') },
            { Key: 'worlds/world1/backup7.tar.gz', LastModified: new Date('2023-01-07') },
            { Key: 'worlds/world1/backup8.tar.gz', LastModified: new Date('2023-01-08') },
            { Key: 'worlds/world1/backup9.tar.gz', LastModified: new Date('2023-01-09') }
          ]
        });
      }

      // World2 folder - only 2 backups (keep all)
      if (input.Prefix === 'worlds/world2/') {
        return Promise.resolve({
          Contents: [
            { Key: 'worlds/world2/backup1.tar.gz', LastModified: new Date('2023-01-01') },
            { Key: 'worlds/world2/backup2.tar.gz', LastModified: new Date('2023-01-02') }
          ]
        });
      }

      return Promise.resolve({ CommonPrefixes: [], Contents: [] });
    });

    await handler();

    // world1 should have backups deleted (9 backups, keep 7, delete 2)
    // world2 should have 0 backups deleted (only 2)
    const deleteCommands = getMockSend().mock.calls.filter((call: any) =>
      call[0].constructor.name === 'DeleteObjectCommand'
    );
    expect(deleteCommands.length).toBeGreaterThan(0);

    // Verify the right backups were deleted (from world1, not world2)
    const deletedKeys = deleteCommands.map((call: any) => call[0].input.Key);
    expect(deletedKeys.some((key: string) => key.includes('world1'))).toBe(true);
    expect(deletedKeys).not.toContain('worlds/world2/backup1.tar.gz');
    expect(deletedKeys).not.toContain('worlds/world2/backup2.tar.gz');
  });

  test('Error handling when S3 operations fail', async () => {
    // Setup: S3 throws an error
    getMockSend().mockRejectedValue(new Error('S3 API Error'));

    await expect(handler()).rejects.toThrow('S3 API Error');
  });
});
