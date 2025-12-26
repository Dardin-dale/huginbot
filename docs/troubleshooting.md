# HuginBot Troubleshooting Guide

This guide helps you diagnose and fix common issues with HuginBot.

## Table of Contents

- [Setup Issues](#setup-issues)
- [Deployment Issues](#deployment-issues)
- [Discord Issues](#discord-issues)
- [Server Issues](#server-issues)
- [Backup Issues](#backup-issues)
- [Performance Issues](#performance-issues)
- [Cost Issues](#cost-issues)

---

## Setup Issues

### AWS CLI Not Found

**Error:**
```
bash: aws: command not found
```

**Solution:**
1. Install AWS CLI following [AWS Setup Guide](./aws-setup.md)
2. Verify installation: `aws --version`
3. Restart your terminal after installation

### Unable to Locate AWS Credentials

**Error:**
```
Unable to locate credentials. You can configure credentials by running "aws configure"
```

**Solution:**
```bash
# Configure AWS credentials
aws configure

# Enter when prompted:
AWS Access Key ID: <your access key>
AWS Secret Access Key: <your secret key>
Default region name: us-west-2  # or your preferred region
Default output format: json
```

**Verify credentials work:**
```bash
aws sts get-caller-identity
```

### CDK Bootstrap Fails

**Error:**
```
This stack uses assets, so the toolkit stack must be deployed to the environment
```

**Solution:**
```bash
# Bootstrap CDK (one-time setup per region)
npx cdk bootstrap

# If that fails, try explicitly specifying account/region:
npx cdk bootstrap aws://ACCOUNT-ID/REGION
```

**Find your account ID:**
```bash
aws sts get-caller-identity --query Account --output text
```

---

## Deployment Issues

### Stack Already Exists Error

**Error:**
```
Stack [ValheimStack] already exists
```

**This is actually OK!** It means you're updating an existing deployment.

**Solution:**
```bash
# CDK will update the existing stack
npm run deploy
```

To completely remove and redeploy:
```bash
npm run destroy:all
npm run deploy
```

### Access Denied During Deployment

**Error:**
```
User: arn:aws:iam::123456789012:user/huginbot is not authorized to perform: XXX
```

**Cause:** IAM user doesn't have required permissions

**Solution:**
1. Go to AWS IAM Console
2. Find your user (`huginbot-deployer` or similar)
3. Verify policies are attached (see [AWS Setup Guide](./aws-setup.md))
4. If using minimal permissions, you may need to add specific permissions
5. Alternatively, attach `AdministratorAccess` (less secure but easier)

### CDK Deploy Hangs or Times Out

**Symptoms:**
- Deployment seems stuck
- No progress for 10+ minutes
- Eventually times out

**Solution:**
1. Check AWS CloudFormation Console for actual status
2. Look for resources in "CREATE_IN_PROGRESS" state
3. Common causes:
   - VPC creation can take 5-10 minutes (normal)
   - NAT Gateway creation takes time (if used)
   - First Lambda deployment takes longer
4. If truly stuck, check CloudFormation events for errors

### "No Default VPC" Error

**Error:**
```
Cannot find default VPC
```

**Solution:**

Either:
A. Create a default VPC:
```bash
aws ec2 create-default-vpc
```

B. Or specify VPC in your CDK stack (requires code changes)

### Deployment Succeeds But No Outputs

**Issue:** Deployment completes but doesn't show API Gateway URL

**Solution:**
```bash
# Get stack outputs manually
aws cloudformation describe-stacks \
  --stack-name ValheimStack \
  --query "Stacks[0].Outputs" \
  --output table
```

---

## Discord Issues

### "Application Did Not Respond"

**Symptoms:** Discord slash commands show this error message

**Causes:**

1. **Interactions Endpoint URL not set correctly**
   - Go to Discord Developer Portal
   - General Information → Interactions Endpoint URL
   - Should be: `https://YOUR-API-GATEWAY-URL/prod/valheim/control`
   - Must include `/valheim/control` path

2. **Lambda function not deployed**
   ```bash
   # Redeploy
   npm run deploy
   ```

3. **Public key mismatch**
   - Verify `DISCORD_BOT_PUBLIC_KEY` in `.env` matches Developer Portal
   - Redeploy after fixing

4. **Lambda function crashed**
   - Check CloudWatch Logs:
     - Go to: https://console.aws.amazon.com/cloudwatch/home#logs:
     - Find: `/aws/lambda/ValheimDiscordBot-ApiLambda`
     - Look for errors in recent logs

**Quick Test:**
```bash
# Test the endpoint manually
curl -X POST https://YOUR-API-GATEWAY-URL/prod/valheim/control \
  -H "Content-Type: application/json" \
  -d '{"type":1}'

# Should return: {"type":1}
```

### Slash Commands Don't Appear

**Solution:**
```bash
# Register slash commands
npm run register-commands

# Or run setup wizard
npm run cli
# Select: Get Started → Update Discord Configuration
```

**Discord takes 1-5 minutes to propagate commands globally.**

### Bot Shows as Offline

**This is normal!** Bots using slash commands don't need a gateway connection, so they appear offline. Commands still work.

### Webhook Notifications Not Working

**Issue:** Server doesn't post status updates to Discord

**Solutions:**

1. **Run /setup in Discord**
   ```
   /setup
   ```
   - This creates the webhook
   - Run in the channel where you want notifications

2. **Check webhook exists in Secrets Manager**
   ```bash
   aws secretsmanager list-secrets --query "SecretList[?contains(Name, 'webhook')]"
   ```

3. **Verify channel permissions**
   - Bot needs "Manage Webhooks" permission
   - Check Discord server settings → Roles

4. **Check CloudWatch logs for webhook errors**
   - Look for "webhook" in Lambda logs
   - Common error: 404 (webhook deleted) - just run `/setup` again

### Wrong Discord Server Gets Notifications

**Cause:** World is configured for different Discord server

**Solution:**
```bash
# Check world configuration
cat .env | grep DISCORD_ID

# Update for your server:
WORLD_1_DISCORD_ID=YOUR_SERVER_ID  # Right-click server icon → Copy Server ID
```

Then redeploy:
```bash
npm run deploy
```

---

## Server Issues

### Server Won't Start

**Symptoms:** `/start` command succeeds but server never becomes ready

**Diagnostic Steps:**

1. **Check EC2 instance status**
   ```bash
   aws ec2 describe-instances \
     --filters "Name=tag:Name,Values=ValheimServer" \
     --query "Reservations[0].Instances[0].State.Name"
   ```

2. **Check CloudWatch Logs**
   - Log Group: `/valheim/server-logs`
   - Look for errors in startup logs

3. **Check server status in Discord**
   ```
   /status check
   ```

4. **SSH to instance** (if desperate)
   ```bash
   # Get instance ID
   INSTANCE_ID=$(aws ec2 describe-instances \
     --filters "Name=tag:Name,Values=ValheimServer" \
     --query "Reservations[0].Instances[0].InstanceId" \
     --output text)

   # Connect via Session Manager (no SSH key needed)
   aws ssm start-session --target $INSTANCE_ID

   # Check Docker logs
   sudo docker logs valheim-server
   ```

**Common Causes:**

- **World file corruption** - Try switching to a new world temporarily
- **Insufficient memory** - Upgrade instance type in `.env`
- **Docker container failed** - Check Docker logs (see SSH method above)
- **Network issues** - Security group misconfigured (rare, CDK should handle this)

### Server Starts But No Join Code

**Issue:** Server shows as running but no join code posted to Discord

**Causes:**

1. **Webhook not configured** - Run `/setup` in Discord

2. **Server still initializing** - Wait 5-10 minutes, Valheim takes time to start

3. **PlayFab not initialized** - Check server logs:
   ```bash
   aws logs tail /valheim/server-logs --follow
   ```
   Look for "Session 'YOUR_WORLD_NAME' registered"

4. **Check instance is actually running**
   ```
   /status check
   ```

### Server Stops Immediately After Starting

**Cause:** Auto-shutdown triggered because server thinks it's idle

**Solution:**
1. Check player activity monitoring is working
2. Temporarily disable auto-shutdown in stack code (for testing)
3. Check CloudWatch Logs for shutdown triggers

### Can't Connect to Server (Join Code Doesn't Work)

**Diagnostic:**

1. **Verify server is running**
   ```
   /status check
   ```

2. **Check firewall/ports**
   - Valheim uses ports 2456-2458 UDP
   - CDK should configure security group automatically
   - Verify in EC2 Console → Security Groups

3. **Crossplay issues**
   - Make sure `-crossplay` is in `VALHEIM_SERVER_ARGS`
   - Redeploy if you just added it

4. **Try direct IP**
   - Get public IP: `/status check`
   - Connect directly: `SERVER_IP:2456`

### Server Performance is Poor

See [Performance Issues](#performance-issues) below.

---

## Backup Issues

### Manual Backup Fails

**Error:** `/backup create` fails

**Requirements:**
- Server must be RUNNING to create backups
- Can't backup a stopped server

**Solution:**
```bash
# Start server first
/start

# Wait for server to be fully running
/status check

# Then create backup
/backup create
```

### Container Backups Not Working

**Check Docker backup logs:**
```bash
# SSH to instance (see Server Issues section)
sudo docker logs valheim-server | grep -i backup
```

**Common Issues:**

1. **Backup disabled** - Check `.env`:
   ```bash
   DOCKER_BACKUP_CRON="0 */2 * * *"  # Should have a schedule
   ```

2. **Not backing up when idle**
   ```bash
   DOCKER_BACKUP_IF_IDLE=false  # If true, only backs up with players
   ```

3. **Permissions issue** - Rare, but check Docker volume permissions

### Can't Find Backups

**List S3 backups:**
```bash
aws s3 ls s3://huginbot-ACCOUNT-ID-REGION-backups/worlds/ --recursive
```

**Or use Discord:**
```
/backup list
```

### Restore Backup Fails

**Backup restoration is CLI-only** (by design, to prevent accidents)

**Process:**
1. Stop server: `/stop`
2. Use CLI to restore:
   ```bash
   npm run cli
   # Backup Management → Restore Backup
   ```
3. Start server: `/start`

---

## Performance Issues

### High Latency / Lag

**Solutions:**

1. **Choose region closer to players**
   - Check current region: `echo $AWS_REGION`
   - Redeploy in different region if needed
   - Test latency: https://www.cloudping.info/

2. **Upgrade instance type**
   ```bash
   # In .env
   VALHEIM_INSTANCE_TYPE=t3.large  # Instead of t3.medium
   ```
   Then redeploy

3. **Check server load**
   - SSH to instance
   - Run `htop` or `top`
   - Look for CPU/memory usage

4. **Check network issues**
   - Not all ISPs route well to AWS
   - Try different AWS region

### Frequent Disconnects

**Causes:**

1. **Auto-shutdown** - Server thinks it's idle
   - Check shutdown logs in CloudWatch

2. **Memory issues** - Server running out of RAM
   - Upgrade instance type

3. **Network instability**
   - Check if specific players have issues
   - May be ISP-related, not server

### Long Startup Time

**Normal startup:** 5-10 minutes

**Causes of slow startup:**

1. **Large world file** - Older worlds take longer to load
2. **Instance type too small** - t3.small is slow
3. **First start after deploy** - Docker image download

**Solutions:**
- Upgrade instance type
- Pre-warm server before play session
- Consider world reset if very old/corrupt

---

## Cost Issues

### Unexpected AWS Charges

**Common causes:**

1. **Server left running** - Auto-shutdown may have failed

   **Check:**
   ```bash
   aws ec2 describe-instances \
     --filters "Name=tag:Name,Values=ValheimServer" \
     --query "Reservations[0].Instances[0].State.Name"
   ```

   **Stop manually if needed:**
   ```
   /stop
   ```

2. **Multiple instances running** - Deployment issue

   **Check:**
   ```bash
   aws ec2 describe-instances \
     --filters "Name=instance-state-name,Values=running" \
     --query "Reservations[*].Instances[*].[InstanceId,Tags[?Key=='Name'].Value|[0]]" \
     --output table
   ```

   Terminate duplicates via EC2 Console

3. **Large S3 storage** - Old backups not cleaned up

   **Check S3 usage:**
   ```bash
   aws s3 ls s3://huginbot-ACCOUNT-ID-REGION-backups/ --recursive --summarize --human-readable
   ```

   **Run backup rotation:**
   ```
   npm run cli
   # Backup Management → Rotate Backups
   ```

4. **NAT Gateway** (if using private subnets)
   - $0.045/hour = $32/month
   - Check if you really need private subnets

5. **Data transfer** - Usually minimal for Valheim
   - Check AWS Cost Explorer for breakdown

**Set up billing alerts:**
1. AWS Console → Billing → Billing Preferences
2. Enable "Receive Billing Alerts"
3. CloudWatch → Create Alarm → Billing → Total Estimated Charge
4. Set threshold (e.g., $10)

### How to Minimize Costs

1. **Use auto-shutdown** (enabled by default)
   - Server stops after 10 min of inactivity

2. **Choose right instance type**
   - Don't over-provision
   - t3.medium is usually enough

3. **Reduce backup retention**
   ```bash
   # In .env
   BACKUPS_TO_KEEP=3  # Instead of 7
   ```

4. **Stop server when not playing**
   ```
   /stop
   ```

5. **Delete old worlds**
   ```bash
   npm run cli
   # World Management → Remove World
   ```

6. **Monitor costs weekly**
   - AWS Cost Explorer: https://console.aws.amazon.com/cost-management/

---

## Advanced Debugging

### Enable Detailed Logging

**Lambda Functions:**
1. Go to Lambda Console
2. Select function (e.g., `ValheimDiscordBot-CommandsLambda`)
3. Configuration → Environment Variables
4. Add: `LOG_LEVEL=DEBUG`

**Server Logs:**
```bash
# Follow live logs
aws logs tail /valheim/server-logs --follow

# Search logs
aws logs tail /valheim/server-logs --filter-pattern "ERROR"
```

### Check All Resources

**CloudFormation Stack:**
```bash
aws cloudformation describe-stack-resources \
  --stack-name ValheimStack \
  --output table
```

**EC2 Instances:**
```bash
aws ec2 describe-instances \
  --filters "Name=tag:Project,Values=Valheim" \
  --output table
```

**Lambda Functions:**
```bash
aws lambda list-functions \
  --query "Functions[?contains(FunctionName, 'Valheim')].[FunctionName,Runtime,LastModified]" \
  --output table
```

### Common CloudWatch Log Groups

- `/aws/lambda/ValheimDiscordBot-ApiLambda` - Discord API requests
- `/aws/lambda/ValheimDiscordBot-CommandsLambda` - Discord command execution
- `/valheim/server-logs` - Valheim server output

### Export Logs for Support

```bash
# Export recent logs
aws logs filter-log-events \
  --log-group-name /aws/lambda/ValheimDiscordBot-CommandsLambda \
  --start-time $(date -u -d '1 hour ago' +%s)000 \
  --output json > debug-logs.json
```

---

## Getting Help

If you're still stuck:

1. **Check GitHub Issues**: Existing solutions may be documented
2. **Review AWS CloudWatch Logs**: Most errors show up here
3. **Check AWS Service Health**: https://status.aws.amazon.com/
4. **Discord Community**: (if available)
5. **Create GitHub Issue**: Include:
   - Error messages
   - Relevant logs
   - Configuration (redact secrets!)
   - Steps to reproduce

## Related Documentation

- [AWS Setup Guide](./aws-setup.md)
- [Discord Setup Guide](./discord-setup.md)
- [HuginBot README](../README.md)
