# HuginBot Project Context & Critical Information

## ⚠️ DO NOT DELETE THESE RESOURCES

### Fargate Stack (2023 - Original Server)
- **Stack Name:** `ValheimServerValheimServerAwsCdkStackDE1BD991`
- **Created:** April 4, 2023
- **Contains:** EFS with friend's save data

### EFS Filesystem (CRITICAL - Contains World Data)
- **ID:** `fs-03d88f4ec4ca60ffc`
- **Size:** ~11GB of save data
- **Mount Target:** `fsmt-0219ba9585db33cfe`
- **Location:** ValheimServer/ValheimServerAwsCdkStack/valheimServerStorage
- **Status:** Contains all friend's world progress - DO NOT DELETE

## Project History

1. **Original Fork:** https://github.com/rileydakota/valheim-ecs-fargate-cdk
   - Used ECS Fargate with EFS for world persistence
   - Save data lives on EFS `fs-03d88f4ec4ca60ffc`

2. **Current Project:** Expanded scope significantly
   - Migrated to EC2-based deployment
   - Added Discord bot integration
   - Multi-world support
   - Automated backups to S3

3. **Reference Project:** https://github.com/samchungy/valheim-aws-spot-server
   - Good ideas for cost optimization
   - Spot instances (~70% cost savings)
   - No Elastic IP when stopped

## Current Architecture

### What Works
- ✅ EC2 instance with Docker (lloesche/valheim-server)
- ✅ S3 backups
- ✅ EventBridge notifications for join codes
- ✅ Discord slash commands registered
- ✅ SSM parameter store for configuration

### What's Broken
- ❌ Discord bot hangs indefinitely (follow-up messages fail)
- ❌ CloudFormation drift (EC2 instance doesn't match stack)
- ❌ Deployments create duplicate instances
- ❌ Orphaned EBS volumes accumulating

## Cost Analysis

### Current Monthly Costs
- EC2 t3.medium (stopped): $0
- EBS volumes (50GB per deployment): ~$4.00
- Orphaned volumes (40GB): ~$3.20
- EFS (11GB): ~$3.30
- Lambda/API Gateway: ~$0.50
- **Total: ~$11/month** (with broken resources)

### Target Monthly Costs (After Optimization)
- EC2 t3.medium (stopped): $0
- EBS volumes (22GB): ~$1.76
- EFS (can delete after migration): $0
- Lambda/API Gateway: ~$0.50
- **Total: ~$2.30/month** (80% reduction!)

### With Spot Instances (Optional)
- Running 50 hrs/month: ~$0.60 compute + $2.30 storage = **~$3/month**

## Migration Goal

Safely move world data from:
- **Source:** EFS `fs-03d88f4ec4ca60ffc` (Fargate stack)
- **Destination:** S3 backup bucket → New EC2 instance EBS volume

Keep EFS intact until migration verified successful.

## Known Issues & Solutions

### Issue 1: Discord Bot Hangs
**Symptom:** All commands show "thinking..." forever
**Likely Cause:** Follow-up messages failing to send
**Solutions:**
1. Increase Lambda timeout to 15 minutes
2. Check Lambda logs for errors
3. Test API Gateway endpoint directly
4. Consider SQS-based async processing

### Issue 2: Duplicate EC2 Instances
**Symptom:** Each `cdk deploy` creates new instance
**Cause:** No logical ID + CloudFormation drift
**Solution:** Add consistent logical ID to EC2 resource

### Issue 3: High Storage Costs
**Symptom:** $7+ monthly for storage
**Cause:** Oversized volumes (50GB) + orphaned volumes
**Solution:** Reduce to 22GB total, clean up orphans

## Next Steps (Priority Order)

1. **Clean up orphaned volumes** (immediate $3.20/month savings)
2. **Test Discord bot** (diagnose why follow-up fails)
3. **Fix stack configuration** (prevent future duplication)
4. **Destroy/rebuild stack** (fresh start with fixed config)
5. **Migrate EFS data** (move worlds to S3/new instance)
6. **Test thoroughly** (ensure friends can access worlds)
7. **Delete EFS** (final $3.30/month savings)

## Critical Commands

```bash
# View EFS (DO NOT DELETE)
aws efs describe-file-systems --region us-west-2 --file-system-id fs-03d88f4ec4ca60ffc

# View orphaned volumes (SAFE TO DELETE)
aws ec2 describe-volumes --region us-west-2 --filters "Name=status,Values=available"

# Check current stack status
aws cloudformation describe-stacks --region us-west-2 --stack-name ValheimStack

# View Discord Lambda logs
aws logs tail /aws/lambda/ValheimStack-CommandsFunction* --region us-west-2 --since 1h
```
