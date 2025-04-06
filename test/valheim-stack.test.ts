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
});