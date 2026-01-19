/**
 * Tests for parameter-tracker.js utility
 */

// Type definition for the parameter-tracker module
interface ParameterTrackerModule {
  trackParameter: (name: string, description: string, associatedResource?: string | null) => any;
  markParameterObsolete: (name: string, reason?: string) => boolean;
  getAllParameters: () => any[];
  getObsoleteParameters: () => any[];
  getActiveParameters: () => any[];
  recordCleanup: (deletedParameters: any[]) => any;
}

// Store the mock data that fs.readFileSync should return
let mockFileData = JSON.stringify({ parameters: [], lastCleanup: null });

// Mock fs module before importing anything
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn().mockImplementation(() => mockFileData)
}));

// Mock the config module to prevent file reads
jest.mock('../../cli/utils/config', () => ({
  getConfig: jest.fn().mockReturnValue({})
}));

describe('Parameter Tracker', () => {
  let fs: jest.Mocked<typeof import('fs')>;
  let parameterTracker: ParameterTrackerModule;

  beforeEach(() => {
    // Reset module registry to get fresh import
    jest.resetModules();

    // Get fresh fs mock reference
    fs = require('fs');

    // Reset all mocks
    jest.clearAllMocks();

    // Set default mock file data
    mockFileData = JSON.stringify({ parameters: [], lastCleanup: null });

    // Re-require the module under test
    parameterTracker = require('../../cli/utils/parameter-tracker');
  });

  test('should track a new parameter', () => {
    parameterTracker.trackParameter('/test/param', 'Test parameter', 'test:resource');

    expect(fs.writeFileSync).toHaveBeenCalled();

    // Get the JSON that was written
    const calls = fs.writeFileSync.mock.calls;
    const writtenData = JSON.parse(calls[0][1] as string);

    expect(writtenData.parameters).toHaveLength(1);
    expect(writtenData.parameters[0].name).toBe('/test/param');
    expect(writtenData.parameters[0].description).toBe('Test parameter');
    expect(writtenData.parameters[0].associatedResource).toBe('test:resource');
  });

  test('should mark a parameter as obsolete', () => {
    // Setup: existing parameter in the mock file data
    mockFileData = JSON.stringify({
      parameters: [
        {
          name: '/test/param',
          description: 'Test parameter',
          associatedResource: 'test:resource',
          createdAt: '2023-01-01T00:00:00.000Z',
          updatedAt: '2023-01-01T00:00:00.000Z'
        }
      ],
      lastCleanup: null
    });

    // Re-require to get fresh module with new mock data
    jest.resetModules();
    fs = require('fs');
    parameterTracker = require('../../cli/utils/parameter-tracker');

    // Mark as obsolete
    const result = parameterTracker.markParameterObsolete('/test/param', 'Test reason');

    expect(result).toBe(true);
    expect(fs.writeFileSync).toHaveBeenCalled();

    // Get the JSON that was written
    const calls = fs.writeFileSync.mock.calls;
    const writtenData = JSON.parse(calls[0][1] as string);

    expect(writtenData.parameters[0].obsolete).toBe(true);
    expect(writtenData.parameters[0].obsoleteReason).toBe('Test reason');
    expect(writtenData.parameters[0].markedObsoleteAt).toBeDefined();
  });

  test('should return false when marking a non-existent parameter as obsolete', () => {
    const result = parameterTracker.markParameterObsolete('/non-existent');
    expect(result).toBe(false);
  });

  test('should get all parameters', () => {
    // Setup: test data in mock file
    mockFileData = JSON.stringify({
      parameters: [
        {
          name: '/test/param1',
          description: 'Test parameter 1',
          createdAt: '2023-01-01T00:00:00.000Z',
          updatedAt: '2023-01-01T00:00:00.000Z'
        },
        {
          name: '/test/param2',
          description: 'Test parameter 2',
          createdAt: '2023-01-01T00:00:00.000Z',
          updatedAt: '2023-01-01T00:00:00.000Z',
          obsolete: true,
          obsoleteReason: 'Test reason',
          markedObsoleteAt: '2023-01-02T00:00:00.000Z'
        }
      ],
      lastCleanup: null
    });

    // Re-require to get fresh module with new mock data
    jest.resetModules();
    parameterTracker = require('../../cli/utils/parameter-tracker');

    const result = parameterTracker.getAllParameters();
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('/test/param1');
    expect(result[1].name).toBe('/test/param2');
  });

  test('should get only obsolete parameters', () => {
    // Setup: test data in mock file
    mockFileData = JSON.stringify({
      parameters: [
        {
          name: '/test/param1',
          description: 'Test parameter 1',
          createdAt: '2023-01-01T00:00:00.000Z',
          updatedAt: '2023-01-01T00:00:00.000Z'
        },
        {
          name: '/test/param2',
          description: 'Test parameter 2',
          createdAt: '2023-01-01T00:00:00.000Z',
          updatedAt: '2023-01-01T00:00:00.000Z',
          obsolete: true,
          obsoleteReason: 'Test reason',
          markedObsoleteAt: '2023-01-02T00:00:00.000Z'
        }
      ],
      lastCleanup: null
    });

    // Re-require to get fresh module with new mock data
    jest.resetModules();
    parameterTracker = require('../../cli/utils/parameter-tracker');

    const result = parameterTracker.getObsoleteParameters();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('/test/param2');
    expect(result[0].obsolete).toBe(true);
  });

  test('should get only active parameters', () => {
    // Setup: test data in mock file
    mockFileData = JSON.stringify({
      parameters: [
        {
          name: '/test/param1',
          description: 'Test parameter 1',
          createdAt: '2023-01-01T00:00:00.000Z',
          updatedAt: '2023-01-01T00:00:00.000Z'
        },
        {
          name: '/test/param2',
          description: 'Test parameter 2',
          createdAt: '2023-01-01T00:00:00.000Z',
          updatedAt: '2023-01-01T00:00:00.000Z',
          obsolete: true,
          obsoleteReason: 'Test reason',
          markedObsoleteAt: '2023-01-02T00:00:00.000Z'
        }
      ],
      lastCleanup: null
    });

    // Re-require to get fresh module with new mock data
    jest.resetModules();
    parameterTracker = require('../../cli/utils/parameter-tracker');

    const result = parameterTracker.getActiveParameters();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('/test/param1');
    expect(result[0].obsolete).toBeUndefined();
  });

  test('should record cleanup', () => {
    mockFileData = JSON.stringify({
      parameters: [
        {
          name: '/test/param1',
          description: 'Test parameter 1',
          createdAt: '2023-01-01T00:00:00.000Z',
          updatedAt: '2023-01-01T00:00:00.000Z'
        },
        {
          name: '/test/param2',
          description: 'Test parameter 2',
          createdAt: '2023-01-01T00:00:00.000Z',
          updatedAt: '2023-01-01T00:00:00.000Z',
          obsolete: true,
          obsoleteReason: 'Test reason',
          markedObsoleteAt: '2023-01-02T00:00:00.000Z'
        }
      ],
      lastCleanup: null
    });

    // Re-require to get fresh module with new mock data
    jest.resetModules();
    fs = require('fs');
    parameterTracker = require('../../cli/utils/parameter-tracker');

    const deletedParams = [
      {
        name: '/test/param2',
        description: 'Test parameter 2',
        createdAt: '2023-01-01T00:00:00.000Z',
        updatedAt: '2023-01-01T00:00:00.000Z',
        obsolete: true,
        obsoleteReason: 'Test reason',
        markedObsoleteAt: '2023-01-02T00:00:00.000Z'
      }
    ];

    parameterTracker.recordCleanup(deletedParams);

    expect(fs.writeFileSync).toHaveBeenCalled();

    // Get the JSON that was written
    const calls = fs.writeFileSync.mock.calls;
    const writtenData = JSON.parse(calls[0][1] as string);

    // Check that the parameter was removed
    expect(writtenData.parameters).toHaveLength(1);
    expect(writtenData.parameters[0].name).toBe('/test/param1');

    // Check that cleanup was recorded
    expect(writtenData.lastCleanup).toBeDefined();
    expect(writtenData.lastCleanup.deletedCount).toBe(1);
    expect(writtenData.lastCleanup.parameters).toHaveLength(1);
    expect(writtenData.lastCleanup.parameters[0].name).toBe('/test/param2');
  });
});
