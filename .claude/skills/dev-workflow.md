# /dev-workflow - HuginBot Development Workflow

Complete development workflow for making changes to HuginBot.

## Standard Workflow

### 1. Make Code Changes

Edit the relevant files. Key directories:
- `lib/valheim/` - CDK stack and infrastructure
- `lib/lambdas/` - Lambda function code
- `scripts/valheim/` - Bash scripts that run on EC2
- `cli/` - CLI commands and utilities

### 2. Run Tests

```bash
npm run test
```

### 3. Build

```bash
npm run build
```

### 4. Deploy Changes

**For infrastructure/Lambda changes:**
```bash
source .env && npm run cdk -- deploy ValheimStack --require-approval never
```

**For script-only changes (faster):**
```bash
# Upload scripts to S3
aws s3 sync scripts/valheim/ s3://$(aws cloudformation describe-stacks --stack-name ValheimStack --query 'Stacks[0].Outputs[?OutputKey==`BackupBucketName`].OutputValue' --output text)/scripts/valheim/

# Push to running server
npm run cli -- server update-scripts --restart
```

### 5. Verify Changes

```bash
npm run cli -- server status
```

## Quick Reference

| Change Type | Deploy Method |
|-------------|---------------|
| Lambda code | Full deploy |
| CDK stack | Full deploy |
| EC2 scripts | Push scripts |
| CLI code | No deploy needed |

## Environment Setup

Before deploying, ensure `.env` is configured:
```bash
source .env
```

Required variables: `AWS_REGION`, `DISCORD_*`, `VALHEIM_*`, `WORLD_*`
