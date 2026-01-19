import { withRetry } from '../../lib/lambdas/utils/aws-clients';

describe('AWS Client Retry Logic Tests', () => {
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
    const mockOperation = jest.fn()
      .mockRejectedValueOnce(new Error('Failure 1'))
      .mockRejectedValueOnce(new Error('Failure 2'))
      .mockResolvedValueOnce('success');

    // Use minimal delay for testing
    const result = await withRetry(mockOperation, 3, 1);

    expect(result).toBe('success');
    expect(mockOperation).toHaveBeenCalledTimes(3);
  });

  it('should throw an error after max retries', async () => {
    const mockError = new Error('Persistent failure');
    const mockOperation = jest.fn().mockRejectedValue(mockError);

    // Use minimal delay for testing
    await expect(withRetry(mockOperation, 3, 1)).rejects.toThrow('Persistent failure');
    expect(mockOperation).toHaveBeenCalledTimes(3);
  });

  it('should respect custom maxRetries parameter', async () => {
    const mockOperation = jest.fn().mockRejectedValue(new Error('Failure'));

    // Use minimal delay for testing
    try {
      await withRetry(mockOperation, 5, 1);
    } catch (error) {
      // Expected to fail
    }

    expect(mockOperation).toHaveBeenCalledTimes(5);
  });

  it('should use exponential backoff for delays between retries', async () => {
    const mockOperation = jest.fn()
      .mockRejectedValueOnce(new Error('Failure 1'))
      .mockRejectedValueOnce(new Error('Failure 2'))
      .mockResolvedValueOnce('success');

    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

    // Use 10ms base delay to make test fast but still measurable
    await withRetry(mockOperation, 3, 10);

    // Extract delay values from setTimeout calls (filter out any internal delays)
    const delays = setTimeoutSpy.mock.calls
      .filter(call => typeof call[1] === 'number' && call[1] >= 10)
      .map(call => call[1]);

    expect(delays.length).toBe(2); // Two retries
    expect(delays[0]).toBe(10);    // First retry: baseDelay * 2^0
    expect(delays[1]).toBe(20);    // Second retry: baseDelay * 2^1

    setTimeoutSpy.mockRestore();
  });
});
