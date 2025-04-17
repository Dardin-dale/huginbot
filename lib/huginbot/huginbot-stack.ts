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
    Rule,
    EventPattern
} from "aws-cdk-lib/aws-events";
import {
    LambdaFunction
} from "aws-cdk-lib/aws-events-targets";
import {
    StringParameter
} from "aws-cdk-lib/aws-ssm";
import * as path from "path";
import { Construct } from "constructs";
import * as fs from 'fs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';

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

    /**
     * Discord webhook URL for sending server notifications.
     * This is used to send messages directly to a channel.
     */
    discordWebhookUrl?: string;
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
            DISCORD_WEBHOOK_URL: props.discordWebhookUrl || '',
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

        // Grant EC2 permissions to the Lambda functions - scoped to specific instance
        const ec2Policy = new PolicyStatement({
            actions: [
                "ec2:DescribeInstances",
                "ec2:StartInstances",
                "ec2:StopInstances",
            ],
            resources: [
                `arn:aws:ec2:${this.region}:${this.account}:instance/${props.valheimInstanceId}`
            ],
        });

        // Add permission for SSM document - scoped to specific document and instance
        const ssmDocumentPolicy = new PolicyStatement({
            actions: [
                "ssm:SendCommand",
            ],
            resources: [
                `arn:aws:ssm:${this.region}:${this.account}:document/AWS-RunShellScript`,
                `arn:aws:ec2:${this.region}:${this.account}:instance/${props.valheimInstanceId}`
            ]
        });

        // Add permission for SSM command invocation
        const ssmCommandPolicy = new PolicyStatement({
            actions: [
                "ssm:GetCommandInvocation"
            ],
            resources: [
                `arn:aws:ssm:${this.region}:${this.account}:*`
            ]
        });

        // Add S3 backup policy with explicit bucket name
        const backupBucketName = process.env.BACKUP_BUCKET_NAME;
        let s3BackupPolicy: PolicyStatement;

        if (backupBucketName) {
            s3BackupPolicy = new PolicyStatement({
                actions: [
                    "s3:ListBucket",
                    "s3:GetObject"
                ],
                resources: [
                    `arn:aws:s3:::${backupBucketName}`,
                    `arn:aws:s3:::${backupBucketName}/worlds/*`
                ]
            });
        } else {
            // During development/testing only, when bucket name is not known
            // This should never be deployed to production
            s3BackupPolicy = new PolicyStatement({
                actions: [
                    "s3:ListBucket",
                    "s3:GetObject"
                ],
                resources: [
                    `arn:aws:s3:::*`,
                ],
                conditions: {
                    "StringLike": {
                        "s3:prefix": ["worlds/*"]
                    }
                }
            });
        }

        startStopFunction.addToRolePolicy(ec2Policy);
        startStopFunction.addToRolePolicy(ssmDocumentPolicy);
        startStopFunction.addToRolePolicy(ssmCommandPolicy);
        startStopFunction.addToRolePolicy(s3BackupPolicy);

        statusFunction.addToRolePolicy(ec2Policy);

        // Create the join code notification Lambda
        const notifyJoinCodeFunction = new NodejsFunction(this, "NotifyJoinCodeFunction", {
            ...lambdaDefaultProps,
            entry: "lib/lambdas/notify-join-code.ts",
            handler: "handler",
            timeout: Duration.seconds(30), // Give more time for Discord API
        });

        // Create the auto-shutdown notification Lambda
        const notifyShutdownFunction = new NodejsFunction(this, "NotifyShutdownFunction", {
            ...lambdaDefaultProps,
            entry: "lib/lambdas/notify-shutdown.ts",
            handler: "handler",
            timeout: Duration.seconds(30), // Give more time for Discord API
        });

        // Grant SSM Parameter Store access to the notification Lambdas - scoped to specific parameters
        const ssmParameterPolicy = new PolicyStatement({
            actions: [
                "ssm:GetParameter",
            ],
            resources: [
                `arn:aws:ssm:${this.region}:${this.account}:parameter/huginbot/*`
            ],
        });

        notifyJoinCodeFunction.addToRolePolicy(ssmParameterPolicy);
        notifyShutdownFunction.addToRolePolicy(ssmParameterPolicy);

        // Create EventBridge rule to trigger the notification Lambda when join code is detected
        const joinCodeEventRule = new Rule(this, "JoinCodeEventRule", {
            eventPattern: {
                source: ["valheim.server"],
                detailType: ["PlayFab.JoinCodeDetected"],
            },
        });

        joinCodeEventRule.addTarget(new LambdaFunction(notifyJoinCodeFunction));

        // Create EventBridge rule for auto-shutdown notifications
        const shutdownEventRule = new Rule(this, "ShutdownEventRule", {
            eventPattern: {
                source: ["valheim.server"],
                detailType: ["Server.AutoShutdown"],
            },
        });

        shutdownEventRule.addTarget(new LambdaFunction(notifyShutdownFunction));

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
        const botInstance = new ec2.Instance(this, 'DiscordBotInstance', {
            instanceType: ec2.InstanceType.of(
                ec2.InstanceClass.T4G,
                ec2.InstanceSize.NANO
            ),
            machineImage: ec2.MachineImage.latestAmazonLinux2023ARM(),
            vpc: vpc, // Use existing VPC
            userData: ec2.UserData.custom(fs.readFileSync('scripts/discord-setup.sh', 'utf8')),
            role: discordBotRole,
        });

        // Create IAM role for Discord bot
        const discordBotRole = new iam.Role(this, 'DiscordBotRole', {
            assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
            ],
        });

        // Add Lambda invocation permissions
        discordBotRole.addToPolicy(
            new iam.PolicyStatement({
                actions: ['lambda:InvokeFunction'],
                resources: [
                    startStopFunction.functionArn,
                    statusFunction.functionArn,
                ],
            })
        );

        // Export the instance ID
        new cdk.CfnOutput(this, 'DiscordBotInstanceId', {
            value: botInstance.instanceId,
            description: 'ID of the Discord bot EC2 instance',
        });

    }

    private generateRandomToken(): string {
        // Use Node.js crypto module for cryptographically secure random token
        const crypto = require('crypto');
        // Generate 32 bytes (256 bits) of secure random data and convert to hex
        return crypto.randomBytes(32).toString('hex');
    }
}
