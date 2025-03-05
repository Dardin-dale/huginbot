import { 
  CfnOutput, 
  Duration, 
  Stack, 
  StackProps 
} from "aws-cdk-lib";
import { 
  RestApi, 
  LambdaIntegration, 
  EndpointType 
} from "aws-cdk-lib/aws-apigateway";
import { 
  Runtime 
} from "aws-cdk-lib/aws-lambda";
import { 
  NodejsFunction 
} from "aws-cdk-lib/aws-lambda-nodejs";
import { 
  PolicyStatement 
} from "aws-cdk-lib/aws-iam";
import { 
  StringParameter 
} from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

interface HuginbotStackProps extends StackProps {
  /**
   * The ID of the EC2 instance running the Valheim server.
   * This will be passed to the Lambda functions.
   */
  valheimInstanceId: string;
  
  /**
   * Discord authentication token for verifying requests.
   * This is NOT the Discord bot token, but a simple shared secret.
   */
  discordAuthToken?: string;
}

export class HuginbotStack extends Stack {
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: HuginbotStackProps) {
    super(scope, id, props);

    // Store Discord auth token in SSM Parameter Store if provided
    let discordAuthToken = props.discordAuthToken;
    if (!discordAuthToken) {
      // Generate a random token if not provided
      discordAuthToken = this.generateRandomToken();
    }
    
    // Use a unique parameter name based on stack ID to avoid conflicts in tests
    const parameterSuffix = this.node.tryGetContext('testing') ? `-${this.node.id}` : '';
    
    const authTokenParam = new StringParameter(this, "DiscordAuthToken", {
      parameterName: `/huginbot/discord-auth-token${parameterSuffix}`,
      stringValue: discordAuthToken,
      description: "Authentication token for Discord integration",
    });

    // Create Lambda common environment variables
    const lambdaEnv: { [key: string]: string } = {
      VALHEIM_INSTANCE_ID: props.valheimInstanceId,
      DISCORD_AUTH_TOKEN: discordAuthToken,
      BACKUP_BUCKET_NAME: process.env.BACKUP_BUCKET_NAME || '',
      WORLD_CONFIGURATIONS: process.env.WORLD_CONFIGURATIONS || '',
    };
    
    // Remove empty values to avoid test issues
    Object.keys(lambdaEnv).forEach(key => {
      if (!lambdaEnv[key]) {
        delete lambdaEnv[key];
      }
    });

    // Common Lambda properties
    const lambdaDefaultProps = {
      runtime: Runtime.NODEJS_18_X,
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: lambdaEnv,
    };

    // Create Lambda functions
    const startStopFunction = new NodejsFunction(this, "StartStopFunction", {
      ...lambdaDefaultProps,
      entry: "lib/lambdas/startstop.ts",
      handler: "handler",
    });

    const statusFunction = new NodejsFunction(this, "StatusFunction", {
      ...lambdaDefaultProps,
      entry: "lib/lambdas/status.ts",
      handler: "handler",
    });

    // Grant EC2 permissions to the Lambda functions
    const ec2Policy = new PolicyStatement({
      actions: [
        "ec2:DescribeInstances",
        "ec2:StartInstances",
        "ec2:StopInstances",
      ],
      resources: ["*"], // You should scope this down to the specific instance ARN in production
    });

    startStopFunction.addToRolePolicy(ec2Policy);
    statusFunction.addToRolePolicy(ec2Policy);

    // Create API Gateway
    const api = new RestApi(this, "HuginbotApi", {
      restApiName: "HuginBot Discord API",
      description: "API for Discord bot to control Valheim server",
      endpointTypes: [EndpointType.REGIONAL],
    });

    // Create API routes
    const valheimResource = api.root.addResource("valheim");
    
    const startStopResource = valheimResource.addResource("control");
    startStopResource.addMethod("POST", new LambdaIntegration(startStopFunction));
    
    const statusResource = valheimResource.addResource("status");
    statusResource.addMethod("GET", new LambdaIntegration(statusFunction));

    // Store API URL
    this.apiUrl = api.url;

    // Outputs
    new CfnOutput(this, "ApiEndpoint", {
      value: api.url,
      description: "API Endpoint for Discord bot integration",
      exportName: `HuginbotApiEndpoint${parameterSuffix}`,
    });

    new CfnOutput(this, "AuthTokenOutput", {
      value: discordAuthToken,
      description: "Auth token for Discord integration",
      exportName: `HuginbotDiscordAuthToken${parameterSuffix}`,
    });
  }

  private generateRandomToken(): string {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
  }
}