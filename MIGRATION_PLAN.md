# HuginBot Migration & Optimization Plan

## Current Situation Analysis

### What We Have
1. **Old Fargate Stack (2023)** - Contains EFS `fs-03d88f4ec4ca60ffc` with ~11GB of save data ⚠️ **KEEP THIS**
2. **Current EC2 Stack (ValheimStack)** - In inconsistent state, Discord bot not working
3. **Orphaned Resources** - 2x 20GB EBS volumes (vol-0a1c74fe8887b1e60, vol-00960163b30564711)

### Issues to Fix
- CloudFormation drift (EC2 instance doesn't exist)
- Discord bot hanging on all commands
- Excessive storage costs

---

## Phase 1: Safe Cleanup (Immediate Savings)

### 1.1 Delete ONLY Orphaned Volumes
```bash
# These are NOT attached to any instance - safe to delete
aws ec2 delete-volume --region us-west-2 --volume-id vol-0a1c74fe8887b1e60
aws ec2 delete-volume --region us-west-2 --volume-id vol-00960163b30564711
```
**Savings:** ~$3.20/month immediately

### 1.2 What NOT to Touch
- ❌ `ValheimServerValheimServerAwsCdkStackDE1BD991` (Fargate stack with EFS)
- ❌ `fs-03d88f4ec4ca60ffc` (EFS with 11GB save data)
- ❌ Old EC2 instances i-02d1b4ce079135f61, i-0d4593de7a101cf3a (might have attached volumes)

---

## Phase 2: Migrate World Data from EFS to S3

### 2.1 Backup EFS Data to S3
You'll need to spin up a temporary EC2 instance to mount the EFS and copy to S3:

```bash
# Option A: Manual (safer for first time)
# 1. Launch small EC2 instance (t3.micro) in same VPC as EFS
# 2. Mount EFS: sudo mount -t nfs4 fs-03d88f4ec4ca60ffc.efs.us-west-2.amazonaws.com:/ /mnt/efs
# 3. Copy to S3: aws s3 sync /mnt/efs s3://your-backup-bucket/efs-migration/
# 4. Terminate temp instance

# Option B: Use AWS DataSync (automated but costs ~$0.02/GB)
```

### 2.2 Organize S3 Backups
```
s3://backup-bucket/
├── efs-migration/           # Full EFS backup (one-time)
├── worlds/
│   ├── world1/
│   │   ├── backup_20250923.tar.gz
│   │   └── backup_20251101.tar.gz
│   └── world2/
│       └── backup_20251101.tar.gz
```

---

## Phase 3: Optimize EC2 Stack Configuration

### 3.1 Volume Sizing
**Current:** 30GB root + 20GB data = 50GB total
**Recommended:** 10GB root + 12GB data = 22GB total (56% reduction!)

Why 12GB data volume?
- Your save data: ~11GB
- Docker images: ~500MB
- BepInEx mods: ~200MB
- Buffer: ~300MB
- Total: ~12GB (safe with headroom)

### 3.2 Cost Optimization Ideas from Spot Server Project

#### Implement Spot Instances (Optional - 70% cost savings)
```typescript
// In valheim-stack.ts
this.ec2Instance = new Instance(this, "valheimInstance", {
  // ... existing config
  instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.MEDIUM),
  spotOptions: {
    requestType: SpotInstanceRequestType.PERSISTENT,
    interruptionBehavior: SpotInstanceInterruption.STOP,
  },
});
```

**Savings:** t3.medium on-demand = $0.0416/hr → spot = ~$0.0125/hr (~70% off)
**Risk:** Instance can be interrupted (rare for t3.medium)

#### Remove Elastic IP (Optional - $3.60/month savings)
Your current setup uses dynamic IP (already optimized!). The join code system handles this.

### 3.3 Fix EC2 Instance Duplication Issue

**Root Cause:** No logical ID = CloudFormation treats as replaceable resource

**Fix in `lib/valheim/valheim-stack.ts:562`:**
```typescript
this.ec2Instance = new Instance(this, "valheimInstance", {
  vpc: this.vpc,
  instanceType: instanceType,
  // ... rest of config
});
```

Change to:
```typescript
// Add CFN override to set logical ID
this.ec2Instance = new Instance(this, "ValheimServerInstance", { // <-- Consistent logical ID
  vpc: this.vpc,
  instanceType: instanceType,
  // ... rest of config
});

// Prevent replacement on minor config changes
const cfnInstance = this.ec2Instance.node.defaultChild as CfnInstance;
cfnInstance.addPropertyDeletionOverride('Tags'); // Example: don't replace for tag changes
```

---

## Phase 4: Fix Discord Bot Issues

### 4.1 Root Cause Analysis

The deferred response code is correct, but follow-up messages are failing. Likely causes:

1. **Lambda timeout before follow-up** - Lambda terminates before sending follow-up
2. **Discord API rate limiting** - Too many retries hitting rate limits
3. **Network issues to Discord** - VPC/security group blocking outbound HTTPS

### 4.2 Debugging Steps

```bash
# Check recent Lambda invocations
aws lambda get-function --function-name ValheimStack-CommandsFunction05D33041-x5a2Y26B5aWA --region us-west-2

# Check if log group exists
aws logs describe-log-groups --region us-west-2 --log-group-name-prefix "/aws/lambda/ValheimStack-Commands"

# If log group exists, tail logs
aws logs tail $(aws logs describe-log-groups --region us-west-2 --log-group-name-prefix "/aws/lambda/ValheimStack-Commands" --query 'logGroups[0].logGroupName' --output text) --region us-west-2 --since 24h
```

### 4.3 Quick Test: Direct API Gateway Call

```bash
# Get API Gateway URL
API_URL=$(aws cloudformation describe-stacks --region us-west-2 --stack-name ValheimStack --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" --output text)

echo "API Gateway URL: $API_URL"

# Test with a simple PING (Discord verification)
# Note: This won't work without proper Discord signature, but will tell us if API Gateway is reachable
curl -X POST "${API_URL}valheim/control" \
  -H "Content-Type: application/json" \
  -d '{"type": 1}' \
  -v
```

### 4.4 Potential Fixes

**Option A: Increase Lambda timeout** (lib/valheim/valheim-stack.ts:663)
```typescript
timeout: Duration.seconds(120), // Current
```
Change to:
```typescript
timeout: Duration.minutes(15), // Max allowed for async operations
```

**Option B: Use SQS for async processing**
1. Discord command → Lambda → immediate deferred response
2. Lambda → SQS message → Worker Lambda
3. Worker Lambda → Follow-up message to Discord

**Option C: Simplify to just deferred + EventBridge**
Remove the immediate follow-up, rely only on EventBridge notifications:
- User runs `/start` → "Server starting, wait for notification"
- EC2 boots → EventBridge → Notification Lambda → "Server ready!"

---

## Phase 5: Deployment Steps

### 5.1 Preparation
```bash
# 1. Backup current configuration
cp .env .env.backup
cp lib/valheim/valheim-stack.ts lib/valheim/valheim-stack.ts.backup

# 2. Clean up orphaned volumes
aws ec2 delete-volume --region us-west-2 --volume-id vol-0a1c74fe8887b1e60
aws ec2 delete-volume --region us-west-2 --volume-id vol-00960163b30564711
```

### 5.2 Update Stack Configuration

**lib/valheim/valheim-stack.ts** changes:
1. Line 572: `30` → `10` (root volume)
2. Line 579: `dataVolumeSize` → `12` (data volume)
3. Line 562: Add logical ID to EC2 instance
4. Line 663: Increase Lambda timeout to 15 minutes

### 5.3 Destroy and Rebuild
```bash
# Destroy inconsistent stack
npx cdk destroy ValheimStack --region us-west-2

# If that fails (it probably will):
aws cloudformation delete-stack --region us-west-2 --stack-name ValheimStack

# Wait for deletion
aws cloudformation wait stack-delete-complete --region us-west-2 --stack-name ValheimStack

# Deploy fresh
source .env
npm run build
npm run deploy

# Register Discord commands
npm run register-commands
```

### 5.4 Restore World Data
```bash
# Get new instance ID
NEW_INSTANCE_ID=$(aws cloudformation describe-stack-resources --region us-west-2 --stack-name ValheimStack --query "StackResources[?ResourceType=='AWS::EC2::Instance'].PhysicalResourceId" --output text)

# Get backup bucket
BACKUP_BUCKET=$(aws cloudformation describe-stacks --region us-west-2 --stack-name ValheimStack --query "Stacks[0].Outputs[?OutputKey=='BackupBucketName'].OutputValue" --output text)

# Copy from S3 to new instance (via SSM)
aws ssm send-command \
  --region us-west-2 \
  --instance-ids "$NEW_INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["aws s3 sync s3://'$BACKUP_BUCKET'/efs-migration/ /mnt/valheim-data/config/"]'
```

---

## Expected Cost Savings

| Item | Before | After | Savings |
|------|--------|-------|---------|
| Orphaned volumes | $3.20/mo | $0 | $3.20/mo |
| Root volume | $2.40/mo | $0.80/mo | $1.60/mo |
| Data volume | $1.60/mo | $0.96/mo | $0.64/mo |
| **Total** | | | **$5.44/mo (50% reduction)** |

**Optional spot instance:** Additional ~$15/mo savings on compute

---

## Testing Checklist

After deployment:
- [ ] EC2 instance starts successfully
- [ ] Discord `/status` returns (not hangs)
- [ ] Discord `/start` works and sends follow-up
- [ ] EventBridge notifications arrive
- [ ] Join code appears in Discord
- [ ] Server is joinable with code
- [ ] World data loaded correctly

---

## Rollback Plan

If something breaks:
1. Stop new EC2 instance
2. Fargate stack still has original data on EFS
3. Can spin up old Fargate service to recover
4. Or restore from S3 backup to new EC2

**The EFS is your safety net - don't touch it until fully migrated!**
