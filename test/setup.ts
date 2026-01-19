/**
 * Global Jest test setup
 * This file is loaded after the test framework is installed but before tests run.
 */

// Increase default timeout for async operations
jest.setTimeout(30000);

// Global beforeAll hook
beforeAll(() => {
  // Suppress console output during tests unless DEBUG is set
  if (!process.env.DEBUG) {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
    // Keep error and warn for debugging
  }
});

// Global afterAll hook
afterAll(() => {
  jest.restoreAllMocks();
});

// Export empty object to make this a module
export {};
