/**
 * Error handling utilities for Discord bot interactions
 */

export enum ErrorType {
  AWS_API_ERROR = 'aws_api_error',
  PERMISSION_ERROR = 'permission_error',
  CONFIGURATION_ERROR = 'configuration_error',
  WORLD_NOT_FOUND = 'world_not_found',
  SERVER_BUSY = 'server_busy',
  GENERAL_ERROR = 'general_error'
}

export interface ErrorDetails {
  type: ErrorType;
  message: string;
  resolution?: string;
  context?: Record<string, any>;
}

/**
 * Format an error into a Discord embed object
 * @param error The error details
 * @returns A Discord embed object
 */
export function formatErrorEmbed(error: ErrorDetails) {
  // Base embed
  const embed: any = {
    title: getErrorTitle(error.type),
    description: error.message,
    color: 0xff0000, // Red
    fields: []
  };
  
  // Add resolution steps if provided
  if (error.resolution) {
    embed.fields.push({
      name: "What You Can Do",
      value: error.resolution
    });
  }
  
  // Add context-specific fields based on error type
  switch (error.type) {
    case ErrorType.AWS_API_ERROR:
      embed.fields.push({
        name: "Technical Details",
        value: `Service: ${error.context?.service || 'Unknown'}\nOperation: ${error.context?.operation || 'Unknown'}`
      });
      break;
      
    case ErrorType.CONFIGURATION_ERROR:
      embed.fields.push({
        name: "Configuration Issue",
        value: `Check the configuration for: ${error.context?.configItem || 'Unknown'}`
      });
      break;
      
    case ErrorType.WORLD_NOT_FOUND:
      if (error.context?.availableWorlds) {
        embed.fields.push({
          name: "Available Worlds",
          value: error.context.availableWorlds.join(', ') || 'None'
        });
      }
      break;
  }
  
  // Add footer with timestamp
  embed.footer = {
    text: "HuginBot Error"
  };
  embed.timestamp = new Date().toISOString();
  
  return embed;
}

/**
 * Get a user-friendly title for an error type
 * @param type The error type
 * @returns A formatted title string
 */
function getErrorTitle(type: ErrorType): string {
  switch (type) {
    case ErrorType.AWS_API_ERROR:
      return "⚠️ AWS Service Error";
    case ErrorType.PERMISSION_ERROR:
      return "🔒 Permission Denied";
    case ErrorType.CONFIGURATION_ERROR:
      return "⚙️ Configuration Error";
    case ErrorType.WORLD_NOT_FOUND:
      return "🌍 World Not Found";
    case ErrorType.SERVER_BUSY:
      return "⏳ Server Busy";
    case ErrorType.GENERAL_ERROR:
      return "❌ Operation Failed";
    default:
      return "❌ Error";
  }
}

/**
 * Create an error details object for AWS API errors
 * @param message The error message
 * @param service The AWS service name
 * @param operation The operation that failed
 * @returns An ErrorDetails object
 */
export function createAwsApiError(message: string, service: string, operation: string): ErrorDetails {
  return {
    type: ErrorType.AWS_API_ERROR,
    message: message,
    resolution: "Please try again later or contact the server administrator.",
    context: {
      service,
      operation
    }
  };
}

/**
 * Create an error details object for world not found errors
 * @param worldName The world name that was not found
 * @param availableWorlds List of available world names
 * @returns An ErrorDetails object
 */
export function createWorldNotFoundError(worldName: string, availableWorlds: string[]): ErrorDetails {
  return {
    type: ErrorType.WORLD_NOT_FOUND,
    message: `World "${worldName}" not found.`,
    resolution: "Try using the `/worlds list` command to see available worlds.",
    context: {
      worldName,
      availableWorlds
    }
  };
}

/**
 * Create an error details object for permission errors
 * @param message The error message
 * @returns An ErrorDetails object
 */
export function createPermissionError(message: string): ErrorDetails {
  return {
    type: ErrorType.PERMISSION_ERROR,
    message: message,
    resolution: "Contact your server administrator for access."
  };
}

/**
 * Create an error details object for configuration errors
 * @param message The error message
 * @param configItem The configuration item that has an issue
 * @returns An ErrorDetails object
 */
export function createConfigurationError(message: string, configItem: string): ErrorDetails {
  return {
    type: ErrorType.CONFIGURATION_ERROR,
    message: message,
    resolution: "Check your server configuration and try again.",
    context: {
      configItem
    }
  };
}

/**
 * Create an error details object for server busy errors
 * @param message The error message
 * @returns An ErrorDetails object
 */
export function createServerBusyError(message: string): ErrorDetails {
  return {
    type: ErrorType.SERVER_BUSY,
    message: message,
    resolution: "Wait for the current operation to complete and try again."
  };
}

/**
 * Create an error details object for general errors
 * @param message The error message
 * @param resolution Optional resolution steps
 * @returns An ErrorDetails object
 */
export function createGeneralError(message: string, resolution?: string): ErrorDetails {
  return {
    type: ErrorType.GENERAL_ERROR,
    message: message,
    resolution: resolution || "Try again later or contact the server administrator."
  };
}