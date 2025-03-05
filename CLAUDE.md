# HuginBot Development Guide

## Commands
- Build: `npm run build`
- Watch for changes: `npm run watch`
- Run all tests: `npm run test`
- Run single test: `npx jest path/to/test-file.test.ts`
- CLI: `npm run cli`
- CDK: `npm run cdk`

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