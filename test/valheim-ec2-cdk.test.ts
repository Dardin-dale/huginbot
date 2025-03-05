import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { ValheimServerAwsCdkStack } from '../lib/valheim/valheim-stack';
import { HuginbotStack } from '../lib/huginbot/huginbot-stack';

describe('ValheimServerAwsCdkStack', () => {
  let app: cdk.App;
  let stack: ValheimServerAwsCdkStack;
  let template: Template;

  beforeAll(() => {
    app = new cdk.App();
    stack = new ValheimServerAwsCdkStack(app, 'TestValheimStack', {
      serverName: 'TestServer',
      worldName: 'TestWorld',
      serverPassword: 'testpassword',
      adminIds: '76561198073817655'
    });
    template = Template.fromStack(stack);
  });

  test('EC2 Instance Created', () => {
    template.hasResourceProperties('AWS::EC2::Instance', {
      InstanceType: 't3.medium'
    });
  });

  test('Security Group Created With Correct Ports', () => {
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      SecurityGroupIngress: [
        {
          CidrIp: '0.0.0.0/0',
          FromPort: 2456,
          ToPort: 2458,
          IpProtocol: 'udp',
          Description: 'Valheim game ports (UDP)'
        },
        {
          CidrIp: '0.0.0.0/0',
          FromPort: 2456,
          ToPort: 2458,
          IpProtocol: 'tcp',
          Description: 'Valheim game ports (TCP)'
        },
        {
          CidrIp: '0.0.0.0/0',
          FromPort: 80,
          ToPort: 80,
          IpProtocol: 'tcp',
          Description: 'Valheim web admin (optional)'
        }
      ]
    });
  });

  test('EBS Volumes Created', () => {
    template.hasResourceProperties('AWS::EC2::Instance', {
      BlockDeviceMappings: [
        {
          DeviceName: '/dev/xvda',
          Ebs: {
            VolumeType: 'gp3',
            Encrypted: true,
            VolumeSize: 30
          }
        },
        {
          DeviceName: '/dev/xvdf',
          Ebs: {
            VolumeType: 'gp3',
            Encrypted: true,
            DeleteOnTermination: false
          }
        }
      ]
    });
  });

  test('S3 Backup Bucket Created', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      VersioningConfiguration: {
        Status: 'Enabled'
      }
    });
  });

  test('IAM Role Created With Correct Permissions', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      ManagedPolicyArns: [
        {
          'Fn::Join': [
            '',
            [
              'arn:',
              { Ref: 'AWS::Partition' },
              ':iam::aws:policy/AmazonSSMManagedInstanceCore'
            ]
          ]
        }
      ]
    });

    // Check if any policy has S3 permissions
    const s3ActionsFound = template.findResources('AWS::IAM::Policy', {
      Properties: {
        PolicyDocument: {
          Statement: [
            {
              Action: expect.arrayContaining([
                's3:PutObject',
              ]),
              Effect: 'Allow'
            }
          ]
        }
      }
    });
    
    expect(Object.keys(s3ActionsFound).length).toBeGreaterThan(0);
  });
  
  test('Backup Cleanup Lambda Created', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'index.handler',
      Runtime: 'nodejs18.x',
      Environment: {
        Variables: {
          BACKUP_BUCKET_NAME: expect.anything(),
          BACKUPS_TO_KEEP: expect.anything()
        }
      },
      Timeout: 300
    });
  });
  
  test('CloudWatch Event Rule Created For Backup Cleanup', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: expect.stringMatching(/rate\(\d+ hours\)/),
      Targets: expect.arrayContaining([
        expect.objectContaining({
          Arn: expect.anything(),
          Id: expect.anything()
        })
      ])
    });
  });
});

describe('HuginbotStack', () => {
  let app: cdk.App;
  let stack: HuginbotStack;
  let template: Template;

  beforeEach(() => {
    // Create a new app for each test to avoid construct name conflicts
    app = new cdk.App({ context: { testing: true } });
    
    // Generate a unique ID for each test
    const uniqueId = `TestHuginbotStack-${Math.random().toString(36).substring(2, 7)}`;
    
    // Use a unique ID for the test stack to avoid naming conflicts
    stack = new HuginbotStack(app, uniqueId, {
      valheimInstanceId: 'i-1234567890abcdef0',
      discordAuthToken: 'test-token'
    });
    template = Template.fromStack(stack);
  });

  test('API Gateway Created', () => {
    template.hasResourceProperties('AWS::ApiGateway::RestApi', {
      Name: 'HuginBot Discord API'
    });
  });

  test('Lambda Functions Created', () => {
    template.resourceCountIs('AWS::Lambda::Function', 2);
  });

  test('SSM Parameter Created For Discord Auth Token', () => {
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: expect.stringMatching(/^\/huginbot\/discord-auth-token/),
      Type: 'String',
      Value: 'test-token'
    });
  });

  test('Lambda Functions Have Correct Environment Variables', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: expect.objectContaining({
          VALHEIM_INSTANCE_ID: 'i-1234567890abcdef0',
          DISCORD_AUTH_TOKEN: 'test-token'
        })
      }
    });
  });

  test('Lambda Functions Have Correct EC2 Permissions', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: [
          {
            Action: [
              'ec2:DescribeInstances',
              'ec2:StartInstances',
              'ec2:StopInstances'
            ],
            Effect: 'Allow',
            Resource: '*'
          }
        ]
      }
    });
  });
});