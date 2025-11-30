#!/bin/bash

# Backup EFS by running commands on the existing Valheim server
# This server already has EFS mounted and IAM permissions

set -e

AWS_REGION="us-west-2"
BACKUP_BUCKET="huginbot-efs-backup-$(date +%Y%m%d)"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
INSTANCE_ID="i-0db0982ff6b50f70b"  # Your Valheim server

echo "======================================"
echo "EFS Backup via Valheim Server"
echo "======================================"
echo ""

# Create S3 bucket
echo "Step 1: Creating S3 bucket..."
aws s3 mb s3://$BACKUP_BUCKET --region $AWS_REGION 2>/dev/null || echo "Bucket already exists"

# Start the instance if it's stopped
echo "Step 2: Checking instance state..."
INSTANCE_STATE=$(aws ec2 describe-instances --instance-ids $INSTANCE_ID --region $AWS_REGION --query 'Reservations[0].Instances[0].State.Name' --output text)

if [ "$INSTANCE_STATE" = "stopped" ]; then
    echo "Starting Valheim server..."
    aws ec2 start-instances --instance-ids $INSTANCE_ID --region $AWS_REGION
    aws ec2 wait instance-running --instance-ids $INSTANCE_ID --region $AWS_REGION
    echo "Waiting for instance to fully boot..."
    sleep 30
elif [ "$INSTANCE_STATE" = "running" ]; then
    echo "Instance already running"
else
    echo "ERROR: Instance is in state: $INSTANCE_STATE"
    exit 1
fi

# Create backup script
BACKUP_SCRIPT="/tmp/backup-script-$TIMESTAMP.sh"
cat > "$BACKUP_SCRIPT" << 'SCRIPT_EOF'
#!/bin/bash
set -e

# Find where EFS is mounted
EFS_MOUNT=$(df -h | grep '/opt/valheim' | awk '{print $6}')
if [ -z "$EFS_MOUNT" ]; then
    echo "ERROR: EFS not mounted!"
    exit 1
fi

echo "Found EFS mounted at: $EFS_MOUNT"

# Install zip if not present
if ! command -v zip &> /dev/null; then
    sudo yum install -y zip
fi

# Create backup
echo "Creating backup..."
cd "$EFS_MOUNT"
sudo zip -r /tmp/valheim-backup-TIMESTAMP.zip .
sudo chown ec2-user:ec2-user /tmp/valheim-backup-TIMESTAMP.zip

# Upload to S3
echo "Uploading to S3..."
aws s3 cp /tmp/valheim-backup-TIMESTAMP.zip s3://BACKUP_BUCKET/ --region AWS_REGION

# Cleanup
rm -f /tmp/valheim-backup-TIMESTAMP.zip

echo "Backup complete!"
SCRIPT_EOF

# Replace placeholders
sed -i "s/TIMESTAMP/$TIMESTAMP/g" "$BACKUP_SCRIPT"
sed -i "s/BACKUP_BUCKET/$BACKUP_BUCKET/g" "$BACKUP_SCRIPT"
sed -i "s/AWS_REGION/$AWS_REGION/g" "$BACKUP_SCRIPT"

# Copy script to instance and run it
echo "Step 3: Running backup on server..."
INSTANCE_IP=$(aws ec2 describe-instances --instance-ids $INSTANCE_ID --region $AWS_REGION --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)

if [ -z "$INSTANCE_IP" ] || [ "$INSTANCE_IP" = "None" ]; then
    echo "ERROR: Cannot use SSH - instance has no public IP"
    echo ""
    echo "Using SSM instead (requires aws-cli v2 and Session Manager plugin)..."

    # Upload script via SSM
    aws ssm send-command \
        --instance-ids "$INSTANCE_ID" \
        --document-name "AWS-RunShellScript" \
        --parameters "commands=[
            'cd /opt/valheim',
            'sudo yum install -y zip',
            'sudo zip -r /tmp/valheim-backup-$TIMESTAMP.zip .',
            'sudo chown ec2-user:ec2-user /tmp/valheim-backup-$TIMESTAMP.zip',
            'aws s3 cp /tmp/valheim-backup-$TIMESTAMP.zip s3://$BACKUP_BUCKET/ --region $AWS_REGION',
            'rm -f /tmp/valheim-backup-$TIMESTAMP.zip'
        ]" \
        --region $AWS_REGION \
        --output text \
        --query 'Command.CommandId'

    echo "Command sent via SSM. Check status in AWS Systems Manager console."
else
    echo "ERROR: This approach requires SSH access or SSM"
    echo "Your instance IP: $INSTANCE_IP"
    echo ""
    echo "Manual approach:"
    echo "1. SSH to the server: ssh ec2-user@$INSTANCE_IP"
    echo "2. Run these commands:"
    echo "   cd /opt/valheim"
    echo "   sudo zip -r /tmp/backup.zip ."
    echo "   sudo chown ec2-user:ec2-user /tmp/backup.zip"
    echo "   aws s3 cp /tmp/backup.zip s3://$BACKUP_BUCKET/"
fi

rm -f "$BACKUP_SCRIPT"
