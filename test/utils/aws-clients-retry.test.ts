import { withRetry } from '../../lib/lambdas/utils/aws-clients';

describe('AWS Client Retry Logic Tests', () => {
  // Save and restore console.log/error
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  
  beforeEach(() => {
    console.log = jest.fn();
    console.error = jest.fn();
  });
  
  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  it('should execute the operation successfully on first try', async () => {
    const mockOperation = jest.fn().mockResolvedValue('success');
    
    const result = await withRetry(mockOperation);
    
    expect(result).toBe('success');
    expect(mockOperation).toHaveBeenCalledTimes(1);
  });

  it('should retry the operation when it fails and succeed eventually', async () => {
    // Fail twice, succeed on third try
    const mockOperation = jest.fn()
      .mockRejectedValueOnce(new Error('Failure 1'))
      .mockRejectedValueOnce(new Error('Failure 2'))
      .mockResolvedValueOnce('success');
    
    // Mock setTimeout to execute immediately for faster tests
    jest.useFakeTimers();
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = jest.fn((callback) => {
      callback();
      return {} as any;
    });
    
    const result = await withRetry(mockOperation);
    
    expect(result).toBe('success');
    expect(mockOperation).toHaveBeenCalledTimes(3);
    
    // Restore setTimeout
    global.setTimeout = originalSetTimeout;
    jest.useRealTimers();
  });

  it('should throw an error after max retries', async () => {
    // Always fail
    const mockError = new Error('Persistent failure');
    const mockOperation = jest.fn().mockRejectedValue(mockError);
    
    // Mock setTimeout to execute immediately
    jest.useFakeTimers();
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = jest.fn((callback) => {
      callback();
      return {} as any;
    });
    
    await expect(withRetry(mockOperation, 3)).rejects.toThrow(mockError);
    expect(mockOperation).toHaveBeenCalledTimes(3);
    
    // Restore setTimeout
    global.setTimeout = originalSetTimeout;
    jest.useRealTimers();
  });

  it('should respect custom maxRetries parameter', async () => {
    // Always fail
    const mockOperation = jest.fn().mockRejectedValue(new Error('Failure'));
    
    // Mock setTimeout to execute immediately
    jest.useFakeTimers();
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = jest.fn((callback) => {
      callback();
      return {} as any;
    });
    
    try {
      await withRetry(mockOperation, 5);
    } catch (error) {
      // Expected to fail
    }
    
    expect(mockOperation).toHaveBeenCalledTimes(5);
    
    // Restore setTimeout
    global.setTimeout = originalSetTimeout;
    jest.useRealTimers();
  });

  it('should use exponential backoff for delays between retries', async () => {
    const mockOperation = jest.fn()
      .mockRejectedValueOnce(new Error('Failure 1'))
      .mockRejectedValueOnce(new Error('Failure 2'))
      .mockResolvedValueOnce('success');
    
    const delays: number[] = [];
    const mockSetTimeout = jest.fn((callback, delay) => {
      delays.push(delay as number);
      callback();
      return {} as any;
    });
    
    // Mock setTimeout to capture delay values
    jest.useFakeTimers();
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = mockSetTimeout;
    
    await withRetry(mockOperation, 3, 100);
    
    expect(delays.length).toBe(2); // Two retries
    expect(delays[0]).toBe(100);   // First retry: baseDelay * 2^0
    expect(delays[1]).toBe(200);   // Second retry: baseDelay * 2^1
    
    // Restore setTimeout
    global.setTimeout = originalSetTimeout;
    jest.useRealTimers();
  });
});