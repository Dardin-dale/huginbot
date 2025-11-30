# EFS World Data Backup Guide

## Quick Summary
Your friend's Valheim world data is safely stored on EFS `fs-03d88f4ec4ca60ffc` (~11GB).
This guide shows how to backup to S3 and download locally.

---

## Option 1: Automated Backup (Recommended)

```bash
chmod +x backup-efs-to-s3.sh
./backup-efs-to-s3.sh
```

This script will:
1. Create S3 bucket for backup
2. Launch temporary t3.micro instance
3. Mount EFS and create tarball
4. Upload to S3
5. Auto-terminate instance

**Cost:** ~$0.01 for 5 minutes of t3.micro runtime

---

## Option 2: Manual Backup (If automated fails)

### Step 1: Use AWS DataSync (Easiest, No EC2 needed)

```bash
# Create S3 bucket
aws s3 mb s3://valheim-efs-backup-$(date +%Y%m%d) --region us-west-2

# Create DataSync locations and task via console:
# 1. Go to AWS DataSync console
# 2. Create EFS location: fs-03d88f4ec4ca60ffc
# 3. Create S3 location: s3://valheim-efs-backup-YYYYMMDD
# 4. Create task and run it
```

**Cost:** ~$0.20 for 11GB transfer ($0.0125/GB after first free GB)

### Step 2: Launch EC2 and Manual Copy

```bash
# 1. Launch t3.micro in same VPC as EFS
aws ec2 run-instances \
  --image-id ami-0c55b159cbfafe1f0 \
  --instance-type t3.micro \
  --subnet-id subnet-XXXXX \
  --security-group-ids sg-XXXXX \
  --key-name YOUR-KEY \
  --region us-west-2

# 2. SSH into instance
ssh -i your-key.pem ec2-user@INSTANCE-IP

# 3. Mount EFS
sudo yum install -y nfs-utils amazon-efs-utils
sudo mkdir -p /mnt/efs
sudo mount -t efs fs-03d88f4ec4ca60ffc:/ /mnt/efs

# 4. Create backup
cd /mnt/efs
sudo tar -czf /tmp/valheim-backup-$(date +%Y%m%d).tar.gz .

# 5. Upload to S3
aws s3 cp /tmp/valheim-backup-*.tar.gz s3://valheim-efs-backup/

# 6. Terminate instance
```

---

## Option 3: Download Directly to Local (Fastest for small files)

```bash
# 1. Create backup on EC2 (as above)

# 2. Download to local via SCP
scp -i your-key.pem ec2-user@INSTANCE-IP:/tmp/valheim-backup-*.tar.gz ./
```

---

## After Backup: Download Locally from S3

```bash
# List backups
aws s3 ls s3://huginbot-efs-backup-YYYYMMDD/ --region us-west-2

# Download specific backup
aws s3 cp s3://huginbot-efs-backup-YYYYMMDD/valheim-efs-backup-TIMESTAMP.tar.gz ./

# Verify contents
tar -tzf valheim-efs-backup-TIMESTAMP.tar.gz | head -20
```

---

## Restore from Backup (Future Use)

### To New EC2 Instance:
```bash
# 1. SSH to Valheim EC2 instance
ssh ec2-user@INSTANCE-IP

# 2. Download backup
aws s3 cp s3://BUCKET/backup.tar.gz /tmp/

# 3. Extract to data volume
sudo tar -xzf /tmp/backup.tar.gz -C /mnt/valheim-data/config/
```

### To EFS (if needed):
```bash
# Mount EFS
sudo mount -t efs fs-XXXXX:/ /mnt/efs

# Extract
sudo tar -xzf backup.tar.gz -C /mnt/efs/
```

---

## Current EFS Details

| Property | Value |
|----------|-------|
| **EFS ID** | `fs-03d88f4ec4ca60ffc` |
| **Size** | ~11GB |
| **Mount Target** | `fsmt-0219ba9585db33cfe` |
| **VPC** | `vpc-0090fd839034f024f` (Fargate stack) |
| **Subnet** | Check with: `aws efs describe-mount-targets --file-system-id fs-03d88f4ec4ca60ffc` |
| **Monthly Cost** | ~$3.30 ($0.30/GB) |

---

## After Migration is Complete

Once you've:
1. ✅ Backed up EFS to S3
2. ✅ Downloaded local copy
3. ✅ Tested restore to new EC2 instance
4. ✅ Verified friends can join with restored world

You can safely delete the old EFS:
```bash
# Delete mount target first
aws efs delete-mount-target --mount-target-id fsmt-0219ba9585db33cfe --region us-west-2

# Wait 2-3 minutes, then delete EFS
aws efs delete-file-system --file-system-id fs-03d88f4ec4ca60ffc --region us-west-2
```

**Savings:** $3.30/month

---

## Backup Best Practices

1. **Multiple Locations:** Keep backups in S3 + local + maybe another cloud
2. **Versioning:** Enable S3 versioning on backup bucket
3. **Test Restores:** Periodically verify backups can be restored
4. **Retention:** Keep at least 3 recent backups before deleting old ones
5. **Documentation:** Note which backup corresponds to which game session

---

## Cost Summary

| Method | Cost | Time | Complexity |
|--------|------|------|------------|
| Automated Script | ~$0.01 | 5 min | Low |
| DataSync | ~$0.20 | 10 min | Low |
| Manual EC2 | ~$0.01 | 15 min | Medium |
| S3 Storage | ~$0.25/mo | - | - |
| Local Storage | Free | Depends on internet | Medium |

**Recommended:** Run automated script, then download to local for double backup.
