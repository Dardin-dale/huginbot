#!/bin/bash

# Simple EFS to S3 Backup using AWS DataSync
# This uses AWS's built-in service instead of custom EC2 instances

set -e

EFS_ID="fs-03d88f4ec4ca60ffc"
AWS_REGION="us-west-2"
BACKUP_BUCKET="huginbot-efs-backup-$(date +%Y%m%d)"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

echo "======================================"
echo "EFS to S3 Backup (AWS DataSync)"
echo "======================================"

# Create S3 bucket
echo "Creating S3 bucket..."
aws s3 mb s3://$BACKUP_BUCKET --region $AWS_REGION 2>/dev/null || echo "Bucket exists"

# Get EFS details
SUBNET_ID=$(aws efs describe-mount-targets \
    --file-system-id $EFS_ID \
    --region $AWS_REGION \
    --query 'MountTargets[0].SubnetId' \
    --output text)

SECURITY_GROUP=$(aws efs describe-mount-targets \
    --file-system-id $EFS_ID \
    --region $AWS_REGION \
    --query 'MountTargets[0].SecurityGroups[0]' \
    --output text)

echo "EFS: $EFS_ID"
echo "Subnet: $SUBNET_ID"
echo "Security Group: $SECURITY_GROUP"
echo ""
echo "Next steps:"
echo "1. Go to AWS DataSync console: https://console.aws.amazon.com/datasync/"
echo "2. Create a new task:"
echo "   - Source: EFS location ($EFS_ID)"
echo "   - Destination: S3 bucket (s3://$BACKUP_BUCKET)"
echo "   - Use subnet: $SUBNET_ID"
echo "   - Use security group: $SECURITY_GROUP"
echo "3. Run the task"
echo ""
echo "This is the AWS-recommended way to backup EFS to S3."
echo "It's managed, reliable, and handles large files efficiently."
