import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { HuginbotStack } from '../lib/huginbot/huginbot-stack';
import { Vpc } from 'aws-cdk-lib/aws-ec2';

describe('HuginbotStack', () => {
  const app = new App({
    context: {
      testing: true
    }
  });
  
  // Create a stack for the VPC
  const vpcStack = new Stack(app, 'TestVpcStack', {
    env: { 
      account: '123456789012', 
      region: 'us-east-1' 
    }
  });
  
  // Create a mock VPC in the test stack
  const vpc = new Vpc(vpcStack, 'TestVpc', {
    maxAzs: 2,
    natGateways: 0
  });
  
  const stack = new HuginbotStack(app, 'TestHuginbotStack', {
    valheimInstanceId: 'i-12345678',
    discordAuthToken: 'test-token',
    valheimVpc: vpc,
    env: { 
      account: '123456789012', 
      region: 'us-east-1' 
    }
  });
  const template = Template.fromStack(stack);

  test('Creates API Gateway', () => {
    template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
  });

  test('Creates Lambda Functions', () => {
    // After refactor, we only have the base commands Lambda, not the notification Lambdas
    template.resourceCountIs('AWS::Lambda::Function', 1);
  });

  test('Creates SSM Parameter', () => {
    template.resourceCountIs('AWS::SSM::Parameter', 1);
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Type: 'String',
      Value: 'test-token'
    });
  });

  test('Lambda has correct environment variables', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: {
          VALHEIM_INSTANCE_ID: 'i-12345678',
          DISCORD_AUTH_TOKEN: 'test-token'
        }
      }
    });
  });

  test('Creates API Gateway methods', () => {
    // There should be at least 1 method (POST on /valheim/control)
    template.resourceCountIs('AWS::ApiGateway::Method', 1);
  });
});