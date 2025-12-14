import { 
  getUnauthorizedResponse,
  getMissingConfigResponse 
} from '../../lib/lambdas/utils/auth';

// Create simple test for utility functions only (working around module mocking issues)
describe('Auth Response Utilities', () => {
  describe('getUnauthorizedResponse', () => {
    test('returns 401 response with correct message', () => {
      const response = getUnauthorizedResponse();
      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).message).toBe('Unauthorized');
    });
  });

  describe('getMissingConfigResponse', () => {
    test('returns 500 response with correct message', () => {
      const response = getMissingConfigResponse('instance ID');
      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body).message).toBe('Server configuration error: Missing instance ID');
    });
  });
});