/**
 * Tests for parameter-tracker.js utility
 */
const {
  trackParameter,
  markParameterObsolete,
  getAllParameters,
  getObsoleteParameters,
  getActiveParameters,
  recordCleanup
} = require('../../cli/utils/parameter-tracker');

// Mock fs module to avoid file system operations
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn().mockReturnValue(JSON.stringify({
    parameters: [],
    lastCleanup: null
  }))
}));

describe('Parameter Tracker', () => {
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Provide fresh mock data
    const fs = require('fs');
    fs.readFileSync.mockReturnValue(JSON.stringify({
      parameters: [],
      lastCleanup: null
    }));
  });
  
  test('should track a new parameter', () => {
    const fs = require('fs');
    trackParameter('/test/param', 'Test parameter', 'test:resource');
    
    expect(fs.writeFileSync).toHaveBeenCalled();
    
    // Get the JSON that was written
    const calls = fs.writeFileSync.mock.calls;
    const writtenData = JSON.parse(calls[0][1]);
    
    expect(writtenData.parameters).toHaveLength(1);
    expect(writtenData.parameters[0].name).toBe('/test/param');
    expect(writtenData.parameters[0].description).toBe('Test parameter');
    expect(writtenData.parameters[0].associatedResource).toBe('test:resource');
  });
  
  test('should mark a parameter as obsolete', () => {
    // Setup existing parameter
    const fs = require('fs');
    fs.readFileSync.mockReturnValue(JSON.stringify({
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
    }));
    
    // Mark as obsolete
    const result = markParameterObsolete('/test/param', 'Test reason');
    
    expect(result).toBe(true);
    expect(fs.writeFileSync).toHaveBeenCalled();
    
    // Get the JSON that was written
    const calls = fs.writeFileSync.mock.calls;
    const writtenData = JSON.parse(calls[0][1]);
    
    expect(writtenData.parameters[0].obsolete).toBe(true);
    expect(writtenData.parameters[0].obsoleteReason).toBe('Test reason');
    expect(writtenData.parameters[0].markedObsoleteAt).toBeDefined();
  });
  
  test('should return false when marking a non-existent parameter as obsolete', () => {
    const result = markParameterObsolete('/non-existent');
    expect(result).toBe(false);
  });
  
  test('should get all parameters', () => {
    // Setup test data
    const fs = require('fs');
    const testParams = [
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
    ];
    
    fs.readFileSync.mockReturnValue(JSON.stringify({
      parameters: testParams,
      lastCleanup: null
    }));
    
    const result = getAllParameters();
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('/test/param1');
    expect(result[1].name).toBe('/test/param2');
  });
  
  test('should get only obsolete parameters', () => {
    // Setup test data
    const fs = require('fs');
    const testParams = [
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
    ];
    
    fs.readFileSync.mockReturnValue(JSON.stringify({
      parameters: testParams,
      lastCleanup: null
    }));
    
    const result = getObsoleteParameters();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('/test/param2');
    expect(result[0].obsolete).toBe(true);
  });
  
  test('should get only active parameters', () => {
    // Setup test data
    const fs = require('fs');
    const testParams = [
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
    ];
    
    fs.readFileSync.mockReturnValue(JSON.stringify({
      parameters: testParams,
      lastCleanup: null
    }));
    
    const result = getActiveParameters();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('/test/param1');
    expect(result[0].obsolete).toBeUndefined();
  });
  
  test('should record cleanup', () => {
    const fs = require('fs');
    fs.readFileSync.mockReturnValue(JSON.stringify({
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
    }));
    
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
    
    recordCleanup(deletedParams);
    
    expect(fs.writeFileSync).toHaveBeenCalled();
    
    // Get the JSON that was written
    const calls = fs.writeFileSync.mock.calls;
    const writtenData = JSON.parse(calls[0][1]);
    
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