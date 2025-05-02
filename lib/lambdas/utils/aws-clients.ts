import { 
  EC2Client, 
  DescribeInstancesCommand 
} from "@aws-sdk/client-ec2";
import {
  SSMClient
} from "@aws-sdk/client-ssm";
import {
  S3Client
} from "@aws-sdk/client-s3";

// Create and export AWS clients
export const ec2Client = new EC2Client();
export const ssmClient = new SSMClient();
export const s3Client = new S3Client();

// Common environment variables
export const VALHEIM_INSTANCE_ID = process.env.VALHEIM_INSTANCE_ID || '';
export const BACKUP_BUCKET_NAME = process.env.BACKUP_BUCKET_NAME || '';
export const DISCORD_AUTH_TOKEN = process.env.DISCORD_AUTH_TOKEN || '';

// SSM Parameter paths
export const SSM_PARAMS = {
  PLAYFAB_JOIN_CODE: '/huginbot/playfab-join-code',
  PLAYFAB_JOIN_CODE_TIMESTAMP: '/huginbot/playfab-join-code-timestamp',
  ACTIVE_WORLD: '/huginbot/active-world',
  DISCORD_WEBHOOK: '/huginbot/discord-webhook' // Base path for Discord webhook parameters
};

/**
 * Get the current status of the Valheim EC2 instance
 */
export async function getInstanceStatus(): Promise<string> {
  try {
    if (!VALHEIM_INSTANCE_ID) {
      throw new Error("Missing VALHEIM_INSTANCE_ID environment variable");
    }
    
    const command = new DescribeInstancesCommand({
      InstanceIds: [VALHEIM_INSTANCE_ID]
    });
    
    const response = await ec2Client.send(command);
    
    if (!response.Reservations || response.Reservations.length === 0 || 
        !response.Reservations[0].Instances || response.Reservations[0].Instances.length === 0) {
      throw new Error("Instance not found");
    }
    
    return response.Reservations[0].Instances[0].State?.Name || 'unknown';
  } catch (error) {
    console.error("Error getting instance status:", error);
    throw error;
  }
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
  try {
    if (!VALHEIM_INSTANCE_ID) {
      throw new Error("Missing VALHEIM_INSTANCE_ID environment variable");
    }
    
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
  } catch (error) {
    console.error("Error getting instance details:", error);
    throw error;
  }
}