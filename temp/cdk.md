// Updates to valheim-stack.ts to remove Secrets Manager and use only SSM

// Remove these imports:
// import { Secret } from "aws-cdk-lib/aws-secretsmanager";

// Remove the webhook secret creation:
// const webhookSecret = new Secret(this, "DiscordWebhookSecret", {...});

// Update Lambda environment variables (remove DISCORD_WEBHOOK_SECRET_NAME)
const lambdaEnv: { [key: string]: string } = {
  VALHEIM_INSTANCE_ID: this.ec2Instance.instanceId,
  DISCORD_AUTH_TOKEN: discordAuthToken,
  BACKUP_BUCKET_NAME: this.backupBucket.bucketName,
  WORLD_CONFIGURATIONS: process.env.WORLD_CONFIGURATIONS || '',
  DISCORD_BOT_PUBLIC_KEY: process.env.DISCORD_BOT_PUBLIC_KEY || '',
};

// Update IAM permissions for Lambda functions
// Replace the Secrets Manager policy with expanded SSM permissions
const ssmParameterPolicy = new PolicyStatement({
  actions: [
    "ssm:GetParameter",
    "ssm:GetParameters",
    "ssm:PutParameter",  // For setup command
    "ssm:DeleteParameter",  // For cleanup
    "ssm:AddTagsToResource",  // For tagging parameters
  ],
  resources: [
    `arn:aws:ssm:${this.region}:${this.account}:parameter/huginbot/*`
  ],
});

// Remove this policy completely:
// const secretsManagerPolicy = new PolicyStatement({...});

// Add SSM permissions to all Lambda functions
commandsFunction.addToRolePolicy(ssmParameterPolicy);
backupCleanupFunction.addToRolePolicy(ssmParameterPolicy);

// For notification lambdas (if created separately)
// notifyJoinCodeFunction.addToRolePolicy(ssmParameterPolicy);
// notifyShutdownFunction.addToRolePolicy(ssmParameterPolicy);

// Update EC2 instance IAM permissions to allow webhook parameter access
instanceRole.addToPolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["ssm:GetParameter", "ssm:GetParameters"],
    resources: [
      `arn:aws:ssm:${this.region}:${this.account}:parameter/huginbot/discord-webhook/*`,
      `arn:aws:ssm:${this.region}:${this.account}:parameter/huginbot/active-world`
    ],
  })
);

// If you're tracking costs, you can add a CloudWatch metric for parameter usage
const parameterCountMetric = new Metric({
  namespace: 'HuginBot',
  metricName: 'SSMParameterCount',
  statistic: 'Maximum',
  period: Duration.days(1),
});

// Output for monitoring SSM usage (optional)
new CfnOutput(this, "SSMParameterPrefix", {
  value: "/huginbot/",
  description: "SSM Parameter Store prefix for all HuginBot parameters",
  exportName: "HuginBotSSMPrefix",
});
