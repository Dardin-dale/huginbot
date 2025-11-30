# HuginBot Deployment Checklist

## ✅ Completed Tasks

### 1. Cleanup (Immediate Savings: $3.20/month)
- ✅ Deleted orphaned volume: `vol-0a1c74fe8887b1e60` (20GB)
- ✅ Deleted orphaned volume: `vol-00960163b30564711` (20GB)

### 2. Code Optimizations (Future Savings: ~$2.50/month)
- ✅ Reduced root volume: 30GB → 10GB (66% reduction)
- ✅ Reduced data volume: 20GB → 12GB (40% reduction)
- ✅ Fixed EC2 logical ID: `valheimInstance` → `ValheimServerInstance` (prevents duplication)
- ✅ Updated IAM tag condition to match new logical ID
- ✅ Increased Lambda timeout: 120s → 15 minutes (fixes Discord hang issue)
- ✅ Build verified: All changes compile successfully

**Total Storage per Deployment:** 50GB → 22GB (56% reduction)

---

## 📋 Next Steps: Deploy Fresh Stack

### Prerequisites
1. Make sure `.env` file is properly configured
2. Verify AWS credentials are active
3. Backup any important configuration

### Step 1: Destroy Broken Stack
```bash
# Try graceful destroy first
npx cdk destroy ValheimStack --region us-west-2

# If that fails (it might because EC2 instance doesn't exist):
aws cloudformation delete-stack --region us-west-2 --stack-name ValheimStack

# Wait for deletion to complete (5-10 minutes)
aws cloudformation wait stack-delete-complete --region us-west-2 --stack-name ValheimStack

# Verify it's gone
aws cloudformation describe-stacks --region us-west-2 --stack-name ValheimStack
# Should return: "Stack with id ValheimStack does not exist"
```

### Step 2: Deploy Fresh Stack
```bash
# Load environment variables
source .env

# Build (already done, but just in case)
npm run build

# Deploy with CDK
npm run deploy

# This will take 10-15 minutes and will:
# - Create new VPC
# - Create new EC2 instance (with correct logical ID)
# - Create smaller EBS volumes (10GB + 12GB = 22GB)
# - Create Lambda functions (with 15-minute timeout)
# - Create API Gateway
# - Set up EventBridge rules
```

### Step 3: Register Discord Commands
```bash
# After deployment completes, register commands
npm run register-commands
```

### Step 4: Configure Discord Bot
1. Get API Gateway endpoint from deployment output
2. Go to Discord Developer Portal
3. Update "Interactions Endpoint URL" with: `https://your-api-gateway-url/valheim/control`
4. Save changes

### Step 5: Test Discord Bot
In your Discord server, try:
```
/status   # Should return within a few seconds (not hang)
/start    # Should show "Starting..." then update with join code after 3-5 min
/help     # Should show command list immediately
```

---

## 🔍 Troubleshooting

### If Destroy Fails
```bash
# Manual cleanup if CloudFormation gets stuck
# 1. Check for stuck resources
aws cloudformation describe-stack-resources --region us-west-2 --stack-name ValheimStack

# 2. Force delete (last resort)
aws cloudformation delete-stack --region us-west-2 --stack-name ValheimStack --role-arn <your-cf-role-arn>
```

### If Discord Bot Still Hangs
```bash
# Check Lambda logs
LAMBDA_NAME=$(aws lambda list-functions --region us-west-2 --query 'Functions[?contains(FunctionName, `CommandsFunction`)].FunctionName' --output text)

# Tail logs
aws logs tail "/aws/lambda/$LAMBDA_NAME" --region us-west-2 --follow
```

### If Instance Can't Find Volumes
The instance will auto-format new volumes on first boot. Check UserData logs:
```bash
# Get instance ID
INSTANCE_ID=$(aws cloudformation describe-stack-resources --region us-west-2 --stack-name ValheimStack --query "StackResources[?ResourceType=='AWS::EC2::Instance'].PhysicalResourceId" --output text)

# Check system logs
aws ec2 get-console-output --region us-west-2 --instance-id $INSTANCE_ID
```

---

## 💰 Cost Savings Summary

| Item | Before | After | Monthly Savings |
|------|--------|-------|-----------------|
| Orphaned Volumes | $3.20 | $0 | $3.20 |
| Root Volume (per deployment) | $2.40 | $0.80 | $1.60 |
| Data Volume (per deployment) | $1.60 | $0.96 | $0.64 |
| **Immediate Savings** | | | **$3.20/mo** |
| **Ongoing Savings** | | | **$2.24/mo** |
| **Total Savings** | | | **$5.44/mo (48%)** |

*Additional potential savings:*
- Migrate from EFS (after world data migrated): +$3.30/mo
- Use Spot Instances: +~$15/mo (if running often)
- **Potential Total: ~$24/mo → ~$6/mo (75% reduction)**

---

## ⚠️ Important Reminders

### DO NOT DELETE
- ❌ `ValheimServerValheimServerAwsCdkStackDE1BD991` (Fargate stack)
- ❌ `fs-03d88f4ec4ca60ffc` (EFS with ~11GB of friend's save data)
- ❌ Old EC2 instances `i-02d1b4ce079135f61`, `i-0d4593de7a101cf3a` (stopped but may have data)

### Safe to Delete (After Migration)
- Old Fargate stack (once worlds migrated and tested)
- Old EFS (once backup confirmed in S3)

---

## 📊 Expected Results

After successful deployment:
1. **EC2 Instance:** Fresh instance with 22GB total storage
2. **Discord Bot:** Commands respond within 3 seconds (no more infinite "thinking")
3. **Follow-up Messages:** Arrive within 15 minutes (Lambda has time to complete)
4. **Costs:** Reduced by ~48% immediately, potentially 75% long-term
5. **Idempotency:** Running `cdk deploy` again will UPDATE the instance, not create a new one

---

## 🎯 Success Criteria

- [ ] Old stack deleted successfully
- [ ] New stack deploys without errors
- [ ] EC2 instance starts and Docker container runs
- [ ] Discord `/status` returns immediately (not hangs)
- [ ] Discord `/start` sends deferred response, then follow-up with join code
- [ ] EventBridge notifications arrive (join code posted automatically)
- [ ] Server is joinable with the provided join code
- [ ] No orphaned volumes after deployment
- [ ] Costs reduced on next AWS bill

---

## 📝 Post-Deployment Tasks

1. **Monitor first 24 hours:**
   - Check CloudWatch logs for errors
   - Test all Discord commands
   - Verify auto-shutdown works after idle period

2. **Plan EFS migration:**
   - Backup EFS data to S3
   - Test restore to new EC2 instance
   - Verify friends' worlds load correctly
   - Only then delete old Fargate/EFS resources

3. **Consider spot instances:**
   - Research spot instance interruption frequency for t3.medium
   - Test spot instance configuration in dev environment
   - Evaluate cost savings vs. reliability trade-off
