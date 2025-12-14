import { 
  EC2Client, 
  DescribeInstancesCommand 
} from "@aws-sdk/client-ec2";
import {
  SSMClient,
  GetParameterCommand,
  GetParametersCommand
} from "@aws-sdk/client-ssm";
import {
  S3Client
} from "@aws-sdk/client-s3";

// AWS client configuration optimized for Discord interactions
// Balanced timeout and retry configuration for reliable responses
const awsClientConfig = {
  requestTimeout: 15000, // 15 second timeout for individual requests
  region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-west-2',
  maxAttempts: 2, // Two attempts to handle transient failures
};

// Create and export AWS clients with timeout configuration
export const ec2Client = new EC2Client(awsClientConfig);
export const ssmClient = new SSMClient(awsClientConfig);
export const s3Client = new S3Client(awsClientConfig);

/**
 * Robust retry wrapper for AWS API calls with exponential backoff
 * @param operation Function to retry
 * @param maxRetries Maximum number of retry attempts (default: 2 for reliability)
 * @param baseDelay Base delay in ms (default: 1000ms)
 * @returns Result of the operation
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 2,
  baseDelay: number = 1000
): Promise<T> {
  let retryCount = 0;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      retryCount++;

      if (retryCount >= maxRetries) {
        console.error(`Failed after ${maxRetries} attempts:`, error);
        throw error;
      }

      // Exponential backoff: 1s, 2s, 4s...
      const delay = baseDelay * Math.pow(2, retryCount - 1);
      console.log(`Retry attempt ${retryCount}/${maxRetries} after ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Common environment variables
export const VALHEIM_INSTANCE_ID = process.env.VALHEIM_INSTANCE_ID || '';
export const BACKUP_BUCKET_NAME = process.env.BACKUP_BUCKET_NAME || '';
export const DISCORD_AUTH_TOKEN = process.env.DISCORD_AUTH_TOKEN || '';

// SSM Parameter paths
export const SSM_PARAMS = {
  PLAYFAB_JOIN_CODE: '/huginbot/playfab-join-code',
  PLAYFAB_JOIN_CODE_TIMESTAMP: '/huginbot/playfab-join-code-timestamp',
  ACTIVE_WORLD: '/huginbot/active-world',
  DISCORD_WEBHOOK: '/huginbot/discord-webhook', // Base path for Discord webhook parameters
  AUTO_SHUTDOWN_MINUTES: '/huginbot/auto-shutdown-minutes',
  // Per-Discord-server default world: /huginbot/discord/<guild-id>/default-world
  GUILD_DEFAULT_WORLD_PREFIX: '/huginbot/discord'
};

/**
 * Get the SSM parameter path for a guild's default world
 */
export function getGuildDefaultWorldParam(guildId: string): string {
  return `${SSM_PARAMS.GUILD_DEFAULT_WORLD_PREFIX}/${guildId}/default-world`;
}

/**
 * Get the current status of the Valheim EC2 instance
 * @returns EC2 instance status (running, stopped, pending, stopping, etc.)
 */
export async function getInstanceStatus(): Promise<string> {
  if (!VALHEIM_INSTANCE_ID) {
    throw new Error("Missing VALHEIM_INSTANCE_ID environment variable");
  }
  
  return withRetry(async () => {
    const command = new DescribeInstancesCommand({
      InstanceIds: [VALHEIM_INSTANCE_ID]
    });
    
    const response = await ec2Client.send(command);
    
    if (!response.Reservations || response.Reservations.length === 0 || 
        !response.Reservations[0].Instances || response.Reservations[0].Instances.length === 0) {
      throw new Error("Instance not found");
    }
    
    return response.Reservations[0].Instances[0].State?.Name || 'unknown';
  });
}

/**
 * Get fast basic server status - just EC2 instance state
 * Optimized for Discord responsiveness with timeout protection
 * @returns Object with basic status info
 */
export async function getFastServerStatus(): Promise<{
  status: string;
  message: string;
  launchTime?: Date;
}> {
  try {
    // Use withRetry which already has proper timeout handling via AWS client config
    const details = await withRetry(() => getInstanceDetails(), 1, 500);
    return {
      status: details.status,
      message: getStatusMessage(details.status),
      launchTime: details.launchTime
    };
  } catch (error) {
    console.error('Fast server status check failed:', error);
    // Return a reasonable default instead of failing completely
    return {
      status: 'unknown',
      message: 'Server status temporarily unavailable',
    };
  }
}

/**
 * Get the detailed server status including operational readiness
 * This goes beyond EC2 status and checks if the Valheim server itself is ready
 * @returns Object with status, message, and readiness
 */
export async function getDetailedServerStatus(): Promise<{
  status: string;
  message: string;
  isReady: boolean;
  isServerRunning: boolean;
  joinCode?: string;
  launchTime?: Date;
}> {
  // Get the basic EC2 instance status
  const instanceStatus = await getInstanceStatus();
  const details = await getInstanceDetails();
  
  // Default response
  let result = {
    status: instanceStatus,
    message: getStatusMessage(instanceStatus),
    isReady: false,
    isServerRunning: false,
    launchTime: details.launchTime,
    joinCode: undefined as string | undefined
  };
  
  // If instance isn't running, return early
  if (instanceStatus !== 'running') {
    return result;
  }
  
  // Instance is running, but need to check if the Valheim server is actually ready
  try {
    // Get both join code and timestamp in a single batch call
    const parametersCommand = new GetParametersCommand({
      Names: [
        SSM_PARAMS.PLAYFAB_JOIN_CODE,
        SSM_PARAMS.PLAYFAB_JOIN_CODE_TIMESTAMP
      ],
      WithDecryption: true
    });
    
    const parametersResponse = await withRetry(() => ssmClient.send(parametersCommand));
    
    const joinCodeParam = parametersResponse.Parameters?.find(p => p.Name === SSM_PARAMS.PLAYFAB_JOIN_CODE);
    const timestampParam = parametersResponse.Parameters?.find(p => p.Name === SSM_PARAMS.PLAYFAB_JOIN_CODE_TIMESTAMP);
    
    if (joinCodeParam?.Value) {
      const joinCode = joinCodeParam.Value;
      
      if (timestampParam?.Value) {
        const timestamp = new Date(timestampParam.Value);
        const now = new Date();
        
        // If join code is less than 30 minutes old, server is probably operational
        const ageInMinutes = (now.getTime() - timestamp.getTime()) / (1000 * 60);
        
        if (ageInMinutes < 30) {
          result.isReady = true;
          result.isServerRunning = true;
          result.joinCode = joinCode;
          result.message = "Server is online and ready to play! Use the join code to connect.";
        } else {
          // Join code exists but is old - server might be stuck or has issues
          result.isServerRunning = true;
          result.message = "Server is running but the join code is stale. The server might be having issues.";
        }
      } else {
        // Join code exists but no timestamp - assume it's valid
        result.isReady = true;
        result.isServerRunning = true;
        result.joinCode = joinCode;
        result.message = "Server appears to be running and ready to play!";
      }
    } else {
      // No join code found, but EC2 is running
      result.message = "Server is starting up, but not yet ready to accept connections.";
    }
  } catch (err) {
    // Parameters not found - server is probably still starting
    result.message = "Server is running but not yet ready. Please wait for the join code notification.";
  }
  
  return result;
}

/**
 * Get a human-readable message for a server status
 */
export function getStatusMessage(status: string): string {
  switch (status) {
    case 'running':
      return "Server is online and ready to play!";
    case 'pending':
      return "Server is starting up. Please wait a few minutes.";
    case 'stopping':
      return "Server is shutting down.";
    case 'stopped':
      return "Server is offline. Use the start command to launch it.";
    default:
      return `Server status: ${status}`;
  }
}

/**
 * Get instance details including public IP
 */
export async function getInstanceDetails() {
  if (!VALHEIM_INSTANCE_ID) {
    throw new Error("Missing VALHEIM_INSTANCE_ID environment variable");
  }
  
  return withRetry(async () => {
    const command = new DescribeInstancesCommand({
      InstanceIds: [VALHEIM_INSTANCE_ID]
    });
    
    const response = await ec2Client.send(command);
    
    if (!response.Reservations || response.Reservations.length === 0 || 
        !response.Reservations[0].Instances || response.Reservations[0].Instances.length === 0) {
      throw new Error("Instance not found");
    }
    
    const instance = response.Reservations[0].Instances[0];
    return {
      status: instance.State?.Name || 'unknown',
      publicIp: instance.PublicIpAddress,
      instanceId: instance.InstanceId,
      launchTime: instance.LaunchTime
    };
  });
}