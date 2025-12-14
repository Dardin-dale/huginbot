import { APIGatewayProxyResult } from "aws-lambda";

/**
 * Create a standardized API response
 */
export function createApiResponse(
  statusCode: number, 
  body: Record<string, any>
): APIGatewayProxyResult {
  return {
    statusCode,
    body: JSON.stringify(body)
  };
}

/**
 * Create a successful response (200 OK)
 */
export function createSuccessResponse(body: Record<string, any>): APIGatewayProxyResult {
  return createApiResponse(200, body);
}

/**
 * Create a bad request response (400)
 */
export function createBadRequestResponse(message: string, additionalData?: Record<string, any>): APIGatewayProxyResult {
  return createApiResponse(400, { message, ...additionalData });
}

/**
 * Create an error response (500)
 */
export function createErrorResponse(message: string = "Internal server error"): APIGatewayProxyResult {
  return createApiResponse(500, { message });
}