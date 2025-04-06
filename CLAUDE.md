# HuginBot Development Guide

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

## Code Style
- Use TypeScript with strict typing
- Follow AWS CDK patterns for infrastructure code
- Use camelCase for variables and functions
- Use PascalCase for classes and interfaces
- Include return types for all functions
- Prefer async/await over direct Promise handling
- Use descriptive variable names
- Avoid any type when possible
- Handle errors with try/catch blocks
- Export interfaces for public APIs
- Keep lambdas focused on single responsibility

## Testing Guidelines
- Always run tests before committing changes: `npm run test`
- Make sure Discord authentication tests pass: `npm run test -- test/lambdas/status.test.ts test/lambdas/startstop.test.ts`
- Use mock implementations for AWS services (never call real AWS services in tests)
- Make sure all test cases are covered, especially authentication edge cases
- Test environment variables should be set in the test setup
- Tests should be isolated and not depend on each other

## Discord Integration
- All Discord API requests need authentication using the `DISCORD_AUTH_TOKEN`
- Lambda functions use `authConfig.bypass` for testing
- Authentication can be enabled/disabled during tests
- The authentication token should be kept secure and never committed to the repository
- API Gateway endpoints should be secured with proper authentication