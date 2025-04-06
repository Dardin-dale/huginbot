import { 
  APIGatewayProxyEvent, 
  APIGatewayProxyResult, 
  Context 
} from "aws-lambda";
import { 
  EC2Client, 
  DescribeInstancesCommand 
} from "@aws-sdk/client-ec2";
import axios from "axios";

// Create a real EC2 client
const ec2Client = new EC2Client();

// This would come from environment variables set by CDK
const VALHEIM_INSTANCE_ID = process.env.VALHEIM_INSTANCE_ID || '';

// This would be set in your Discord bot's configuration
const DISCORD_AUTH_TOKEN = process.env.DISCORD_AUTH_TOKEN || '';

// Verify the request is from Discord
export function isValidDiscordRequest(event: APIGatewayProxyEvent): boolean {
  // In production, you would verify the signature from Discord  
  const authHeader = event.headers['x-discord-auth'] || '';
  return authHeader === DISCORD_AUTH_TOKEN;
}

// For testing purposes
export const authConfig = {
  bypass: false
};

export async function handler(
  event: APIGatewayProxyEvent, 
  context: Context
): Promise<APIGatewayProxyResult> {
  // For testing, enable bypass automatically
  if (process.env.NODE_ENV === 'test') {
    authConfig.bypass = true;
  }
  
  // Verify request is from Discord, unless bypassed for testing
  if (!authConfig.bypass && !isValidDiscordRequest(event)) {
    return {
      statusCode: 401,
      body: JSON.stringify({ message: "Unauthorized" })
    };
  }

  try {
    if (!VALHEIM_INSTANCE_ID) {
      return {
        statusCode: 500,
        body: JSON.stringify({ message: "Server configuration error: Missing instance ID" })
      };
    }
    
    const status = await getDetailedServerStatus();
    
    return {
      statusCode: 200,
      body: JSON.stringify(status)
    };
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Internal server error" })
    };
  }
}

async function getDetailedServerStatus(): Promise<any> {
  try {
    // Get EC2 instance status
    const command = new DescribeInstancesCommand({
      InstanceIds: [VALHEIM_INSTANCE_ID]
    });
    
    const response = await ec2Client.send(command);
    
    if (!response.Reservations || response.Reservations.length === 0 || 
        !response.Reservations[0].Instances || response.Reservations[0].Instances.length === 0) {
      throw new Error("Instance not found");
    }
    
    const instance = response.Reservations[0].Instances[0];
    const instanceStatus = instance.State?.Name || 'unknown';
    const publicIp = instance.PublicIpAddress;
    
    // Basic response
    const statusResponse = {
      status: instanceStatus,
      message: getStatusMessage(instanceStatus),
      serverAddress: instanceStatus === 'running' ? `${publicIp}:2456` : null,
      uptime: null,
      players: null,
      version: null
    };
    
    // If server is running, try to get more details
    if (instanceStatus === 'running' && publicIp) {
      try {
        // This assumes you have a status endpoint on the EC2 instance
        // You would need to add a small web server/api to the EC2 instance for this
        const serverInfoResponse = await axios.get(`http://${publicIp}/api/status`, {
          timeout: 5000
        });
        
        if (serverInfoResponse.status === 200) {
          // Merge additional details
          return {
            ...statusResponse,
            ...serverInfoResponse.data
          };
        }
      } catch (error) {
        // Server might be booting up or status endpoint not available
        console.log("Couldn't fetch detailed server info:", error);
      }
    }
    
    return statusResponse;
  } catch (error) {
    console.error("Error getting server status:", error);
    throw error;
  }
}

function getStatusMessage(status: string): string {
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