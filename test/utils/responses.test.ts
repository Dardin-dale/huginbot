import { 
  createApiResponse, 
  createSuccessResponse, 
  createBadRequestResponse, 
  createErrorResponse 
} from '../../lib/lambdas/utils/responses';

describe('Response Utilities', () => {
  describe('createApiResponse', () => {
    test('creates response with correct status code and body', () => {
      const response = createApiResponse(201, { message: 'Created' });
      expect(response.statusCode).toBe(201);
      expect(JSON.parse(response.body)).toEqual({ message: 'Created' });
    });
  });

  describe('createSuccessResponse', () => {
    test('creates 200 response with correct body', () => {
      const response = createSuccessResponse({ message: 'Success', data: [1, 2, 3] });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ message: 'Success', data: [1, 2, 3] });
    });
  });

  describe('createBadRequestResponse', () => {
    test('creates 400 response with correct message', () => {
      const response = createBadRequestResponse('Bad request');
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({ message: 'Bad request' });
    });

    test('includes additional data when provided', () => {
      const response = createBadRequestResponse('Bad request', { details: 'Missing field' });
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({ 
        message: 'Bad request', 
        details: 'Missing field' 
      });
    });
  });

  describe('createErrorResponse', () => {
    test('creates 500 response with default message when none provided', () => {
      const response = createErrorResponse();
      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body)).toEqual({ message: 'Internal server error' });
    });

    test('creates 500 response with custom message when provided', () => {
      const response = createErrorResponse('Database connection failed');
      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body)).toEqual({ message: 'Database connection failed' });
    });
  });
});