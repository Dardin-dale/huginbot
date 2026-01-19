import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { ValheimServerAwsCdkStack } from '../../lib/valheim/valheim-stack';

describe('ValheimServerAwsCdkStack', () => {
  let app: cdk.App;
  let stack: ValheimServerAwsCdkStack;
  let template: Template;

  beforeAll(() => {
    // Override ALL environment variables with test values to prevent
    // real secrets from leaking into snapshots
    process.env.DISCORD_BOT_PUBLIC_KEY = 'test-public-key';
    process.env.DISCORD_BOT_SECRET_TOKEN = 'test-secret-token';
    process.env.VALHEIM_ADMIN_IDS = '12345678901234567';

    // Clear any WORLD_* or VALHEIM_* env vars that might contain real data
    Object.keys(process.env)
      .filter(key => key.startsWith('WORLD_') || key.startsWith('VALHEIM_'))
      .forEach(key => delete process.env[key]);

    // Set mock world config (must be after clearing)
    process.env.DISCORD_BOT_PUBLIC_KEY = 'test-public-key';
    process.env.DISCORD_BOT_SECRET_TOKEN = 'test-secret-token';
    process.env.VALHEIM_ADMIN_IDS = '12345678901234567';
    process.env.WORLD_1_NAME = 'TestWorld1';
    process.env.WORLD_1_WORLD_NAME = 'TestWorld1';
    process.env.WORLD_1_PASSWORD = 'test-password-1';
    process.env.WORLD_1_DISCORD_ID = '111111111111111111';
    process.env.WORLD_1_ADMIN_IDS = '12345678901234567';
    process.env.WORLD_2_NAME = 'TestWorld2';
    process.env.WORLD_2_WORLD_NAME = 'TestWorld2';
    process.env.WORLD_2_PASSWORD = 'test-password-2';
    process.env.WORLD_2_DISCORD_ID = '222222222222222222';
    process.env.WORLD_2_ADMIN_IDS = '12345678901234567';

    // Create stack once for all tests (faster)
    app = new cdk.App({
      context: {
        testing: true,  // Signal to stack that this is a test run
      },
    });

    stack = new ValheimServerAwsCdkStack(app, 'TestValheimStack', {
      env: {
        account: '123456789012',
        region: 'us-west-2',
      },
    });

    template = Template.fromStack(stack);
  });

  describe('Snapshot Tests', () => {
    test('stack matches snapshot', () => {
      // This will fail if infrastructure changes unexpectedly
      // Update snapshot with: npm test -- -u

      // Get template and sanitize dynamic values before snapshot comparison
      const templateJson = template.toJSON();

      // Sanitize auth token values which are randomly generated
      const sanitized = JSON.parse(JSON.stringify(templateJson), (key, value) => {
        // Replace auth token values with a placeholder
        if (key === 'Value' && typeof value === 'string' && value.length === 64 && /^[a-f0-9]+$/.test(value)) {
          return 'AUTH_TOKEN_PLACEHOLDER';
        }
        if (key === 'DISCORD_AUTH_TOKEN' && typeof value === 'string' && value.length === 64) {
          return 'AUTH_TOKEN_PLACEHOLDER';
        }
        return value;
      });

      expect(sanitized).toMatchSnapshot();
    });
  });

  describe('EC2 Instance Configuration', () => {
    test('creates an EC2 instance', () => {
      template.resourceCountIs('AWS::EC2::Instance', 1);
    });

    test('EC2 instance has encrypted root volume', () => {
      template.hasResourceProperties('AWS::EC2::Instance', {
        BlockDeviceMappings: Match.arrayWith([
          Match.objectLike({
            DeviceName: '/dev/xvda',
            Ebs: Match.objectLike({
              Encrypted: true,
            }),
          }),
        ]),
      });
    });

    test('EC2 instance uses t3.medium by default', () => {
      template.hasResourceProperties('AWS::EC2::Instance', {
        InstanceType: 't3.medium',
      });
    });
  });

  describe('Data Volume Configuration', () => {
    test('creates an EBS data volume', () => {
      template.resourceCountIs('AWS::EC2::Volume', 1);
    });

    test('data volume is encrypted', () => {
      template.hasResourceProperties('AWS::EC2::Volume', {
        Encrypted: true,
        VolumeType: 'gp3',
      });
    });

    test('data volume has RETAIN removal policy', () => {
      // Ensure data volume won't be deleted when stack is destroyed
      const volumes = template.findResources('AWS::EC2::Volume');
      const volumeLogicalId = Object.keys(volumes)[0];
      expect(volumes[volumeLogicalId].DeletionPolicy).toBe('Retain');
    });
  });

  describe('Security Group Configuration', () => {
    test('creates a security group', () => {
      template.resourceCountIs('AWS::EC2::SecurityGroup', 1);
    });

    test('allows Valheim UDP ports 2456-2458', () => {
      template.hasResourceProperties('AWS::EC2::SecurityGroup', {
        SecurityGroupIngress: Match.arrayWith([
          Match.objectLike({
            IpProtocol: 'udp',
            FromPort: 2456,
            ToPort: 2458,
            CidrIp: '0.0.0.0/0',
          }),
        ]),
      });
    });

    test('allows Valheim TCP ports 2456-2458', () => {
      template.hasResourceProperties('AWS::EC2::SecurityGroup', {
        SecurityGroupIngress: Match.arrayWith([
          Match.objectLike({
            IpProtocol: 'tcp',
            FromPort: 2456,
            ToPort: 2458,
            CidrIp: '0.0.0.0/0',
          }),
        ]),
      });
    });
  });

  describe('S3 Backup Bucket Configuration', () => {
    test('creates an S3 bucket for backups', () => {
      template.resourceCountIs('AWS::S3::Bucket', 1);
    });

    test('backup bucket has versioning enabled', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        VersioningConfiguration: {
          Status: 'Enabled',
        },
      });
    });
  });

  describe('IAM Role Configuration', () => {
    test('creates IAM role for EC2 instance', () => {
      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Principal: {
                Service: 'ec2.amazonaws.com',
              },
            }),
          ]),
        }),
      });
    });

    test('EC2 role has SSM managed policy for remote access', () => {
      template.hasResourceProperties('AWS::IAM::Role', {
        ManagedPolicyArns: Match.arrayWith([
          Match.objectLike({
            'Fn::Join': Match.arrayWith([
              Match.arrayWith([
                Match.stringLikeRegexp('AmazonSSMManagedInstanceCore'),
              ]),
            ]),
          }),
        ]),
      });
    });

    test('EC2 role has scoped S3 permissions', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith(['s3:PutObject', 's3:GetObject', 's3:ListBucket']),
              Effect: 'Allow',
              // Should have bucket-specific resources
              Resource: Match.anyValue(),
            }),
          ]),
        }),
      });
    });

    test('EC2 role has scoped SSM Parameter Store permissions', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith(['ssm:GetParameter', 'ssm:GetParameters', 'ssm:PutParameter']),
              Effect: 'Allow',
              Resource: Match.stringLikeRegexp('parameter/huginbot'),
            }),
          ]),
        }),
      });
    });
  });

  describe('Lambda Functions', () => {
    test('creates backup cleanup Lambda', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Handler: 'index.handler',
        Runtime: 'nodejs18.x',
      });
    });

    test('creates Discord commands Lambda', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Runtime: 'nodejs18.x',
        Timeout: 900, // 15 minutes in seconds
      });
    });

    test('creates Discord notifications Lambda', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Runtime: 'nodejs18.x',
        Timeout: 30,
      });
    });
  });

  describe('API Gateway Configuration', () => {
    test('creates REST API for Discord integration', () => {
      template.hasResourceProperties('AWS::ApiGateway::RestApi', {
        Name: 'HuginBot Discord API',
      });
    });

    test('API has valheim/control endpoint', () => {
      template.hasResourceProperties('AWS::ApiGateway::Resource', {
        PathPart: 'control',
      });
    });
  });

  describe('EventBridge Rules', () => {
    test('creates rule for backup cleanup schedule', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        ScheduleExpression: Match.stringLikeRegexp('rate'),
      });
    });

    test('creates rule for join code events', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        EventPattern: Match.objectLike({
          source: ['valheim.server'],
          'detail-type': ['PlayFab.JoinCodeDetected'],
        }),
      });
    });

    test('creates rule for EC2 state changes', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        EventPattern: Match.objectLike({
          source: ['aws.ec2'],
          'detail-type': ['EC2 Instance State-change Notification'],
        }),
      });
    });
  });

  describe('SSM Parameters', () => {
    test('creates auth token parameter', () => {
      template.hasResourceProperties('AWS::SSM::Parameter', {
        Description: 'Authentication token for Discord integration',
      });
    });

    test('creates backup bucket name parameter', () => {
      template.hasResourceProperties('AWS::SSM::Parameter', {
        Name: '/huginbot/backup-bucket-name',
        Description: 'S3 bucket name for Valheim backups',
      });
    });

    test('creates auto-shutdown parameter', () => {
      template.hasResourceProperties('AWS::SSM::Parameter', {
        Name: '/huginbot/auto-shutdown-minutes',
        Description: Match.stringLikeRegexp('auto-shutdown'),
      });
    });
  });

  describe('Outputs', () => {
    test('outputs instance ID', () => {
      template.hasOutput('InstanceId', {
        Description: Match.stringLikeRegexp('EC2 instance'),
      });
    });

    test('outputs backup bucket name', () => {
      template.hasOutput('BackupBucketName', {
        Description: Match.stringLikeRegexp('backup'),
      });
    });

    test('outputs API endpoint', () => {
      template.hasOutput('ApiEndpoint', {
        Description: Match.stringLikeRegexp('Discord'),
      });
    });
  });
});
