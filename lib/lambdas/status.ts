import { 
  APIGatewayProxyEvent, 
  APIGatewayProxyResult, 
  Context 
} from "aws-lambda";
import { GetParameterCommand } from "@aws-sdk/client-ssm";
import axios from "axios";

// Import shared utilities
import { 
  ec2Client, 
  ssmClient, 
  VALHEIM_INSTANCE_ID, 
  SSM_PARAMS, 
  getInstanceDetails,
  getStatusMessage
} from "./utils/aws-clients";
import { 
  setupAuth, 
  getUnauthorizedResponse, 
  getMissingConfigResponse 
} from "./utils/auth";
import { createSuccessResponse, createErrorResponse } from "./utils/responses";

export async function handler(
  event: APIGatewayProxyEvent, 
  context: Context
): Promise<APIGatewayProxyResult> {
  // Handle authentication
  if (!setupAuth(event)) {
    return getUnauthorizedResponse();
  }

  try {
    // Check for required configuration
    if (!VALHEIM_INSTANCE_ID) {
      return getMissingConfigResponse("instance ID");
    }
    
    const status = await getDetailedServerStatus();
    return createSuccessResponse(status);
  } catch (error) {
    console.error("Error:", error);
    return createErrorResponse();
  }
}

async function getDetailedServerStatus(): Promise<any> {
  try {
    // Get EC2 instance details
    const instanceDetails = await getInstanceDetails();
    const instanceStatus = instanceDetails.status;
    const publicIp = instanceDetails.publicIp;
    
    // Basic response
    const statusResponse: any = {
      status: instanceStatus,
      message: getStatusMessage(instanceStatus),
      serverAddress: instanceStatus === 'running' ? `${publicIp}:2456` : null,
      uptime: null,
      players: null,
      version: null
    };
    
    // If server is running, try to get the PlayFab join code from SSM
    if (instanceStatus === 'running') {
      try {
        // Get PlayFab join code from SSM Parameter Store
        const joinCodeParam = await ssmClient.send(new GetParameterCommand({
          Name: SSM_PARAMS.PLAYFAB_JOIN_CODE,
          WithDecryption: true
        }));
        
        const joinCodeTimestampParam = await ssmClient.send(new GetParameterCommand({
          Name: SSM_PARAMS.PLAYFAB_JOIN_CODE_TIMESTAMP
        }));
        
        if (joinCodeParam.Parameter?.Value) {
          const joinCode = joinCodeParam.Parameter.Value;
          statusResponse.joinCode = joinCode;
          
          // Add timestamp info if available
          if (joinCodeTimestampParam.Parameter?.Value) {
            const timestamp = parseInt(joinCodeTimestampParam.Parameter.Value, 10);
            const now = Math.floor(Date.now() / 1000);
            const ageSeconds = now - timestamp;
            
            // Only use join code if it's less than 1 hour old (3600 seconds)
            if (ageSeconds <= 3600) {
              statusResponse.joinCodeAge = ageSeconds;
            } else {
              // Join code is too old, mark as expired
              statusResponse.joinCode = "EXPIRED";
              statusResponse.joinCodeAge = ageSeconds;
            }
          }
        }
      } catch (error) {
        // Parameter might not exist yet
        console.log("Couldn't fetch PlayFab join code:", error);
      }
      
      // Try to get more details from the server API if available
      if (publicIp) {
        try {
          // This assumes you have a status endpoint on the EC2 instance
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
    }
    
    return statusResponse;
  } catch (error) {
    console.error("Error getting server status:", error);
    throw error;
  }
}