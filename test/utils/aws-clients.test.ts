import { getStatusMessage } from '../../lib/lambdas/utils/aws-clients';

describe('AWS Clients Utilities', () => {
  describe('getStatusMessage', () => {
    test('returns correct message for running status', () => {
      expect(getStatusMessage('running')).toBe('Server is online and ready to play!');
    });

    test('returns correct message for pending status', () => {
      expect(getStatusMessage('pending')).toBe('Server is starting up. Please wait a few minutes.');
    });

    test('returns correct message for stopping status', () => {
      expect(getStatusMessage('stopping')).toBe('Server is shutting down.');
    });

    test('returns correct message for stopped status', () => {
      expect(getStatusMessage('stopped')).toBe('Server is offline. Use the start command to launch it.');
    });

    test('returns generic message for unknown status', () => {
      expect(getStatusMessage('unknown')).toBe('Server status: unknown');
    });
  });
});