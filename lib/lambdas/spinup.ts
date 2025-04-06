import * as AWS from 'aws-sdk';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { RunTaskRequest } from 'aws-sdk/clients/ecs';

const ecs = new AWS.ECS();

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    // Extract worldName from request body
    const body = event.body ? JSON.parse(event.body) : {};
    const worldName = body.worldName || '';
    
    if (!worldName) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "World name is required" })
      };
    }
    
    // Setup ECS task/service parameters
    const params: RunTaskRequest = {
      taskDefinition: `valheim-${worldName}`,
      cluster: 'valheim',
      count: 1,
      launchType: 'FARGATE', // or EC2 depending on your setup
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: ['subnet-123456'], // Replace with actual subnet IDs
          securityGroups: ['sg-123456'], // Replace with actual security group IDs
          assignPublicIp: 'ENABLED'
        }
      }
    };

    const result = await ecs.runTask(params).promise();
    return { 
      statusCode: 200, 
      body: JSON.stringify({ 
        message: `Successfully started ${worldName} server`,
        taskArns: result.tasks?.map(task => task.taskArn) || []
      }) 
    };
  } catch (error) {
    console.error('Error spinning up server:', error);
    return { 
      statusCode: 500, 
      body: JSON.stringify({ 
        error: "Failed to start server",
        details: error instanceof Error ? error.message : String(error)
      }) 
    };
  }
}