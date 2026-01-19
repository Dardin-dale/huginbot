# HuginBot Development Guide

## Architecture Overview
HuginBot is a Valheim server management system that leverages AWS CDK for infrastructure deployment and Discord bot integration for user interactions.
The project is an aws harness for the https://github.com/lloesche/valheim-server-docker docker container.

### Key Components:
- **EC2-based Valheim server** using Docker container (lloesche/valheim-server)
- **Lambda functions** for server control and state management
- **S3 storage** for world backups
- **SSM Parameter Store** for configuration management
- **Discord integration** via webhooks and bot commands
- **CLI interface** for administration and deployment

## Commands
- Build: `npm run build`
- Watch for changes: `npm run watch`
- Run all tests: `npm run test`
- Run specific tests: `npm run test -- test/lambdas/status.test.ts`
- Run specific tests with watch: `npm run test -- test/lambdas/status.test.ts --watch`
- CLI: `npm run cli`
- CDK: `npm run cdk`
- Deploy: `npm run deploy`
- Deploy all: `npm run deploy:all` (same as deploy)
- Clean up SSM parameters: `npm run cleanup`

## Environment Setup
1. Copy `.env.template` to `.env` and configure:
   - AWS credentials and region
   - Discord application settings (ID, public key, bot token)
   - Initial Valheim server configuration
   - World configurations

2. Required Discord bot permissions:
   - Send Messages
   - Manage Webhooks
   - Use Slash Commands

## Code Style
- Use TypeScript with strict typing
- Follow AWS CDK patterns for infrastructure code
- Use camelCase for variables and functions
- Use PascalCase for classes and interfaces
- Include return types for all functions
- Prefer async/await over direct Promise handling
- Use descriptive variable names
- Avoid `any` type when possible
- Handle errors with try/catch blocks and appropriate error types
- Export interfaces for public APIs
- Keep lambdas focused on single responsibility
- Use rich embeds for Discord messages

## Testing Guidelines
- Always run tests before committing changes: `npm run test`
- Run tests with coverage: `npm run test -- --coverage`
- Key test files:
  - `test/lambdas/commands.test.ts` - Discord command handlers and auth
  - `test/lambdas/discord-notifications.test.ts` - EventBridge notification handlers
  - `test/lambdas/cleanup-backups.test.ts` - S3 backup cleanup logic
  - `test/cdk/valheim-stack.test.ts` - CDK infrastructure with snapshot tests
- Use mock implementations for AWS services (never call real AWS services in tests)
- AWS SDK mocking pattern - store mock in global for test access:
  ```typescript
  jest.mock('module', () => {
    const mockFn = jest.fn();
    (global as any).__mockFn = mockFn;
    return { client: { send: mockFn } };
  });
  const getMock = () => (global as any).__mockFn as jest.Mock;
  ```
- For ES module default exports (like axios), use `__esModule: true`
- Tests should be isolated and not depend on each other
- Test error handling paths with specific error types
- CDK tests use snapshot testing - update snapshots with `npm test -- -u` when infrastructure changes intentionally

## Security Best Practices
- Follow the principle of least privilege for all IAM roles and policies
- Avoid using wildcards (`*`) in IAM policy resources
- Scope all IAM permissions to specific resources when possible
- Use IAM policy conditions to further restrict permissions
- Generate secure auth tokens using cryptographically secure methods
- Store sensitive values in AWS Secrets Manager or SSM SecureString parameters
- Implement proper API Gateway authorization for all endpoints
- Validate and sanitize all user inputs before using in AWS API calls
- Enable AWS CloudTrail for auditing and monitoring resource access
- Restrict network access to the minimum required ports and IP ranges
- Regularly audit and rotate credentials
- Use encrypted EBS volumes for all EC2 instances
- Apply security patches regularly

## Discord Integration
- All Discord API requests need authentication using the `DISCORD_AUTH_TOKEN`
- Lambda functions use `authConfig.bypass` for testing
- Authentication can be enabled/disabled during tests
- The authentication token should be kept secure and never committed to the repository
- API Gateway endpoints should be secured with proper authentication
- Use rich embeds for better message formatting
- Implement ephemeral messages for private responses
- Leverage Discord components (buttons, select menus) for interactive features
- Follow Discord rate limits and API best practices
- Discord bot is deployed as part of the ValheimStack (consolidated with server infrastructure)
- The Docker container's built-in webhook functionality is used for notifications
- Slash commands are registered using the `npm run register-commands` script

## World Management
- World creation/deletion is CLI-only (admin function)
- World selection is available via Discord bot
- Each world maintains separate configuration in SSM
- Backups are organized per world in S3
- World switching requires server restart

## SSM Parameter Management
- Use standardized parameter paths: `/huginbot/<category>/<item>`
- Track parameter lifecycle with parameter-tracker module
- Mark obsolete parameters for cleanup
- Implement automatic cleanup for old parameters
- Categories: core, world, discord, backup

## Error Handling
- Use typed error objects with ErrorType enum
- Provide user-friendly error messages in Discord
- Include resolution steps when possible
- Log detailed errors for debugging
- Format errors differently for CLI vs Discord interface

## Docker Container Integration
- Leverage built-in webhook functionality
- Use container log filtering for event detection
- Configure server lifecycle hooks properly
- Handle join code detection automatically

## Backup and Restore
- Automatic backups on server start/stop
- S3 organization: `worlds/<world-name>/<timestamp>.tar.gz`
- Implement backup validation
- Provide backup rotation based on configuration
- CLI-only backup restoration to prevent accidents

## Deployment Workflow
1. Source environment variables: `source .env` or `. .env`
2. Run tests: `npm run test`
3. Build project: `npm run build`
4. Deploy infrastructure: `npm run deploy`
5. Configure Discord webhooks: `/setup` command in Discord
6. Test server operations

**IMPORTANT**: Always source the `.env` file before deployment to ensure environment variables are available during CDK deployment.

## MVP Development Focus
- Core server reliability (start/stop/status)
- CLI usability for administrators
- Discord bot simplicity for players
- Clear error messaging
- Robust backup system
- World management separation (CLI for admin, Discord for selection)

## Future Considerations (Huginbot-Pro)
- Multi-tenant architecture design
- Per-user EC2 isolation
- Billing and metering integration
- Enhanced security boundaries
- Account management systems
- The fargate and EFS valheim comes from my groups active game server, Do not delete!