import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { ValheimServerAwsCdkStack } from '../lib/valheim/valheim-stack';

describe('ValheimServerAwsCdkStack', () => {
  const app = new App();
  const stack = new ValheimServerAwsCdkStack(app, 'TestValheimStack', {
    serverName: 'TestValheimServer',
    worldName: 'TestValheimWorld',
    serverPassword: 'testpassword',
    env: { 
      account: '123456789012', 
      region: 'us-east-1' 
    }
  });
  const template = Template.fromStack(stack);

  test('Creates VPC', () => {
    template.resourceCountIs('AWS::EC2::VPC', 1);
  });

  test('Creates EC2 instance', () => {
    template.resourceCountIs('AWS::EC2::Instance', 1);
  });

  test('Creates S3 bucket for backups', () => {
    template.resourceCountIs('AWS::S3::Bucket', 1);
  });

  test('Creates security group', () => {
    template.resourceCountIs('AWS::EC2::SecurityGroup', 1);
  });

  test('Creates IAM roles for EC2 and Lambda', () => {
    template.resourceCountIs('AWS::IAM::Role', 2);
  });

  test('Security group has the correct ingress rules', () => {
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      SecurityGroupIngress: [
        {
          CidrIp: '0.0.0.0/0',
          FromPort: 2456,
          ToPort: 2458,
          IpProtocol: 'udp'
        },
        {
          CidrIp: '0.0.0.0/0',
          FromPort: 2456,
          ToPort: 2458,
          IpProtocol: 'tcp'
        },
        {
          CidrIp: '0.0.0.0/0',
          FromPort: 80,
          ToPort: 80,
          IpProtocol: 'tcp'
        }
      ]
    });
  });

  test('Creates Lambda function for backup cleanup', () => {
    template.resourceCountIs('AWS::Lambda::Function', 1);
  });

  test('Creates CloudWatch event rule', () => {
    template.resourceCountIs('AWS::Events::Rule', 1);
  });
  
  test('EC2 Role has SSM Parameter Store access', () => {
    // Instead of checking the nested PolicyDocument directly, check if the policy exists first
    // and then verify individual statements have the required actions
    template.resourceCountIs('AWS::IAM::Policy', 2);
    
    // Find policy statements with SSM actions
    const policies = template.findResources('AWS::IAM::Policy');
    
    // Check that at least one policy has SSM permissions
    const hasSSMPermissions = Object.values(policies).some(policy => {
      const statements = policy.Properties.PolicyDocument.Statement;
      return statements.some((statement: any) => {
        const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
        return actions.some((action: string) => action.includes("ssm:GetParameter"));
      });
    });
    
    expect(hasSSMPermissions).toBe(true);
  });
});

// Test with world configurations including Discord server ID
describe('ValheimServerAwsCdkStack with Discord Integration', () => {
  const app = new App();
  
  const stack = new ValheimServerAwsCdkStack(app, 'TestValheimStackWithDiscord', {
    serverName: 'TestValheimServer',
    worldName: 'TestValheimWorld',
    serverPassword: 'testpassword',
    env: { 
      account: '123456789012', 
      region: 'us-east-1' 
    },
    worldConfigurations: [
      {
        name: 'TestWorld',
        worldName: 'TestValheim',
        serverPassword: 'testpassword',
        discordServerId: '123456789012345678'
      }
    ]
  });
  const template = Template.fromStack(stack);
  
  test('Discord server ID enables webhook functionality', () => {
    // Check that IAM permissions for SSM include webhook access
    template.resourceCountIs('AWS::IAM::Policy', 2);
    
    // Find policy statements with webhook access
    const policies = template.findResources('AWS::IAM::Policy');
    
    // Check that at least one policy has webhook access permissions
    const hasWebhookPermissions = Object.values(policies).some(policy => {
      const statements = policy.Properties.PolicyDocument.Statement;
      return statements.some((statement: any) => {
        const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
        const resources = Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource];
        
        return actions.some((action: string) => action.includes("ssm:GetParameter")) &&
               resources.some((resource: any) => 
                 typeof resource === 'string' && 
                 resource.includes("parameter/huginbot/discord-webhook")
               );
      });
    });
    
    expect(hasWebhookPermissions).toBe(true);
  });
});