# HuginBot Development Guide

## Architecture Overview
HuginBot is a Valheim server management system that leverages AWS CDK for infrastructure deployment and Discord bot integration for user interactions.

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
- Deploy all: `npm run deploy:all`
- Deploy Valheim stack: `npm run deploy:valheim`
- Deploy Discord bot stack: `npm run deploy:discord`
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
- Make sure Discord authentication tests pass: `npm run test -- test/lambdas/status.test.ts test/lambdas/startstop.test.ts`
- Use mock implementations for AWS services (never call real AWS services in tests)
- Make sure all test cases are covered, especially authentication edge cases
- Test environment variables should be set in the test setup
- Tests should be isolated and not depend on each other
- Test error handling paths with specific error types

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
1. Run tests: `npm run test`
2. Build project: `npm run build`
3. Deploy infrastructure: `npm run deploy:all`
4. Configure Discord webhooks: `/setup` command in Discord
5. Test server operations

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