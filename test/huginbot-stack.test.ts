import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { HuginbotStack } from '../lib/huginbot/huginbot-stack';

describe('HuginbotStack', () => {
  const app = new App({
    context: {
      testing: true
    }
  });
  const stack = new HuginbotStack(app, 'TestHuginbotStack', {
    valheimInstanceId: 'i-12345678',
    discordAuthToken: 'test-token',
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
    template.resourceCountIs('AWS::Lambda::Function', 2);
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
    template.resourceCountIs('AWS::ApiGateway::Method', 2);
  });
});