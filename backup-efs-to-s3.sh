#!/bin/bash

# Backup EFS World Data to S3
# This script backs up your friends' Valheim world data from EFS to S3

set -e

# Cleanup function for temporary resources
cleanup_iam_resources() {
    # Cleanup security group
    if [ "$CLEANUP_SG" = "true" ] && [ -n "$SECURITY_GROUP_ID" ] && [ -n "$EFS_SECURITY_GROUP" ]; then
        echo ""
        echo "Cleaning up temporary security group..."

        # Remove the ingress rule from EFS security group
        aws ec2 revoke-security-group-ingress \
            --group-id $EFS_SECURITY_GROUP \
            --protocol tcp \
            --port 2049 \
            --source-group $SECURITY_GROUP_ID \
            --region $AWS_REGION >/dev/null 2>&1 || true

        # Delete the temporary security group
        aws ec2 delete-security-group \
            --group-id $SECURITY_GROUP_ID \
            --region $AWS_REGION >/dev/null 2>&1 || true

        echo "✅ Cleaned up temporary security group"
    fi

    # Cleanup IAM resources
    if [ "$CLEANUP_IAM" = "true" ] && [ -n "$PROFILE_NAME" ] && [ -n "$ROLE_NAME" ]; then
        echo "Cleaning up temporary IAM resources..."

        # Remove role from instance profile
        aws iam remove-role-from-instance-profile \
            --instance-profile-name $PROFILE_NAME \
            --role-name $ROLE_NAME \
            --region $AWS_REGION >/dev/null 2>&1 || true

        # Delete instance profile
        aws iam delete-instance-profile \
            --instance-profile-name $PROFILE_NAME \
            --region $AWS_REGION >/dev/null 2>&1 || true

        # Detach policy from role
        aws iam detach-role-policy \
            --role-name $ROLE_NAME \
            --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess \
            --region $AWS_REGION >/dev/null 2>&1 || true

        # Delete role
        aws iam delete-role \
            --role-name $ROLE_NAME \
            --region $AWS_REGION >/dev/null 2>&1 || true

        echo "✅ Cleaned up temporary IAM resources"
    fi
}

# Trap to cleanup on exit
trap cleanup_iam_resources EXIT

EFS_ID="fs-03d88f4ec4ca60ffc"
AWS_REGION="us-west-2"
BACKUP_BUCKET="huginbot-efs-backup-$(date +%Y%m%d)"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

echo "======================================"
echo "Valheim EFS Backup to S3"
echo "======================================"
echo ""
echo "EFS ID: $EFS_ID"
echo "Region: $AWS_REGION"
echo "Backup Bucket: $BACKUP_BUCKET"
echo "Timestamp: $TIMESTAMP"
echo ""

# Step 1: Create S3 bucket for backup
echo "Step 1: Creating S3 backup bucket..."
aws s3 mb s3://$BACKUP_BUCKET --region $AWS_REGION 2>/dev/null || echo "Bucket already exists or error occurred"

# Step 2: Enable versioning on backup bucket
echo "Step 2: Enabling versioning on backup bucket..."
aws s3api put-bucket-versioning \
    --bucket $BACKUP_BUCKET \
    --versioning-configuration Status=Enabled \
    --region $AWS_REGION

# Step 3: Get VPC and Subnet info from EFS (no jq needed!)
echo "Step 3: Getting EFS network configuration..."
SUBNET_ID=$(aws efs describe-mount-targets \
    --file-system-id $EFS_ID \
    --region $AWS_REGION \
    --query 'MountTargets[0].SubnetId' \
    --output text)

VPC_ID=$(aws ec2 describe-subnets --subnet-ids $SUBNET_ID --region $AWS_REGION --query 'Subnets[0].VpcId' --output text)

# Get EFS mount target security group (this one already allows NFS traffic!)
EFS_SECURITY_GROUP=$(aws efs describe-mount-targets \
    --file-system-id $EFS_ID \
    --region $AWS_REGION \
    --query 'MountTargets[0].SecurityGroups[0]' \
    --output text)

# Create a temporary security group for our backup instance
TEMP_SG_NAME="EFS-Backup-Temp-SG-$TIMESTAMP"
echo "Creating temporary security group to allow NFS access..."

SECURITY_GROUP_ID=$(aws ec2 create-security-group \
    --group-name $TEMP_SG_NAME \
    --description "Temporary SG for EFS backup - auto-cleanup" \
    --vpc-id $VPC_ID \
    --region $AWS_REGION \
    --query 'GroupId' \
    --output text)

# Allow ALL outbound traffic (new security groups have no egress by default!)
aws ec2 authorize-security-group-egress \
    --group-id $SECURITY_GROUP_ID \
    --protocol -1 \
    --cidr 0.0.0.0/0 \
    --region $AWS_REGION >/dev/null 2>&1 || true

# Allow NFS traffic FROM our instance TO the EFS security group
aws ec2 authorize-security-group-ingress \
    --group-id $EFS_SECURITY_GROUP \
    --protocol tcp \
    --port 2049 \
    --source-group $SECURITY_GROUP_ID \
    --region $AWS_REGION 2>&1 | grep -v "already exists" || true

echo "VPC ID: $VPC_ID"
echo "Subnet ID: $SUBNET_ID"
echo "Security Group: $SECURITY_GROUP_ID (temporary, allows NFS)"
echo "EFS Security Group: $EFS_SECURITY_GROUP"
echo ""

CLEANUP_SG=true

# Step 4: Launch temporary EC2 instance
echo "Step 4: Launching temporary t3.micro instance for backup..."
echo "This will cost about $0.01 for the backup operation (instance will auto-terminate)"
echo ""

# Get latest Amazon Linux 2 AMI
AMI_ID=$(aws ec2 describe-images \
    --region $AWS_REGION \
    --owners amazon \
    --filters "Name=name,Values=amzn2-ami-hvm-*-x86_64-gp2" "Name=state,Values=available" \
    --query 'Images | sort_by(@, &CreationDate) | [-1].ImageId' \
    --output text)

echo "Using AMI: $AMI_ID"

# Check for suitable IAM instance profile
echo "Checking for IAM instance profile with S3 permissions..."
INSTANCE_PROFILE=""

# Try common instance profile names
for profile_name in ecsInstanceRole EC2-S3-Access ValheimServerRole; do
    if aws iam get-instance-profile --instance-profile-name $profile_name --region $AWS_REGION >/dev/null 2>&1; then
        INSTANCE_PROFILE=$profile_name
        echo "✅ Found instance profile: $INSTANCE_PROFILE"
        break
    fi
done

if [ -z "$INSTANCE_PROFILE" ]; then
    echo "⚠️  No suitable IAM instance profile found"
    echo "   Will attempt to create a temporary one..."

    # Create a temporary IAM role and instance profile
    ROLE_NAME="EFSBackupTempRole-$TIMESTAMP"
    PROFILE_NAME="EFSBackupTempProfile-$TIMESTAMP"

    # Create the role
    aws iam create-role \
        --role-name $ROLE_NAME \
        --assume-role-policy-document '{
            "Version": "2012-10-17",
            "Statement": [{
                "Effect": "Allow",
                "Principal": {"Service": "ec2.amazonaws.com"},
                "Action": "sts:AssumeRole"
            }]
        }' --region $AWS_REGION >/dev/null 2>&1

    # Attach S3 write policy
    aws iam attach-role-policy \
        --role-name $ROLE_NAME \
        --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess \
        --region $AWS_REGION >/dev/null 2>&1

    # Create instance profile
    aws iam create-instance-profile \
        --instance-profile-name $PROFILE_NAME \
        --region $AWS_REGION >/dev/null 2>&1

    # Add role to instance profile
    aws iam add-role-to-instance-profile \
        --instance-profile-name $PROFILE_NAME \
        --role-name $ROLE_NAME \
        --region $AWS_REGION >/dev/null 2>&1

    # Wait a moment for IAM to propagate
    echo "Waiting for IAM role to propagate..."
    sleep 10

    INSTANCE_PROFILE=$PROFILE_NAME
    CLEANUP_IAM=true
    echo "✅ Created temporary instance profile: $INSTANCE_PROFILE"
fi

# Create user data script for the instance
USER_DATA=$(cat <<'EOF'
#!/bin/bash

# Ensure instance always terminates, even on failure
trap 'echo "Script failed! Terminating instance in 60 seconds..."; sleep 60; shutdown -h now' ERR

set -e

# Install NFS client and zip (Amazon Linux comes with unzip but not zip!)
yum install -y nfs-utils amazon-efs-utils zip

# Create mount point
mkdir -p /mnt/efs

# Mount EFS
mount -t nfs4 -o nfsvers=4.1,rsize=1048576,wsize=1048576,hard,timeo=600,retrans=2,noresvport EFS_ID.efs.AWS_REGION.amazonaws.com:/ /mnt/efs

# Create zip file (better for Windows users!)
cd /mnt/efs
zip -r /tmp/valheim-efs-backup-TIMESTAMP.zip .

# Upload to S3
aws s3 cp /tmp/valheim-efs-backup-TIMESTAMP.zip s3://BACKUP_BUCKET/valheim-efs-backup-TIMESTAMP.zip --region AWS_REGION

# List contents for verification
echo "Backup contents:" > /tmp/backup-manifest.txt
unzip -l /tmp/valheim-efs-backup-TIMESTAMP.zip >> /tmp/backup-manifest.txt
aws s3 cp /tmp/backup-manifest.txt s3://BACKUP_BUCKET/backup-manifest-TIMESTAMP.txt --region AWS_REGION

# Shutdown (instance will terminate due to instance-initiated-shutdown-behavior)
echo "Backup complete! Instance will terminate in 60 seconds..."
sleep 60
shutdown -h now
EOF
)

# Replace placeholders
USER_DATA=$(echo "$USER_DATA" | sed "s/EFS_ID/$EFS_ID/g" | sed "s/AWS_REGION/$AWS_REGION/g" | sed "s/TIMESTAMP/$TIMESTAMP/g" | sed "s/BACKUP_BUCKET/$BACKUP_BUCKET/g")

# Write user data to temp file (AWS CLI handles encoding automatically from file)
USER_DATA_FILE="/tmp/efs-backup-userdata-$TIMESTAMP.sh"
echo "$USER_DATA" > "$USER_DATA_FILE"

echo ""
echo "Launching instance with backup script..."

# Launch instance
INSTANCE_ID=$(aws ec2 run-instances \
    --image-id $AMI_ID \
    --instance-type t3.micro \
    --subnet-id $SUBNET_ID \
    --security-group-ids $SECURITY_GROUP_ID \
    --iam-instance-profile Name=$INSTANCE_PROFILE \
    --user-data "file://$USER_DATA_FILE" \
    --instance-initiated-shutdown-behavior terminate \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=EFS-Backup-Temp-$TIMESTAMP}]" \
    --region $AWS_REGION \
    --query 'Instances[0].InstanceId' \
    --output text) 2>&1

# Clean up temp file
rm -f "$USER_DATA_FILE"

if [ $? -ne 0 ]; then
    echo "ERROR: Failed to launch instance."
    echo "Error details: $INSTANCE_ID"
    echo ""
    echo "This could be due to:"
    echo "1. Insufficient IAM permissions to create IAM roles/profiles"
    echo "2. VPC/subnet configuration issues"
    echo "3. Security group restrictions"
    echo ""
    echo "=== MANUAL BACKUP APPROACH ===="
    echo ""
    echo "1. Launch a t3.micro instance in VPC $VPC_ID with an IAM role that has S3 write access"
    echo "2. SSH into the instance"
    echo "3. Run these commands:"
    echo ""
    echo "   # Install tools (sudo needed for yum)"
    echo "   sudo yum install -y nfs-utils amazon-efs-utils zip"
    echo ""
    echo "   # Mount EFS (sudo needed for mount)"
    echo "   sudo mkdir -p /mnt/efs"
    echo "   sudo mount -t efs $EFS_ID:/ /mnt/efs"
    echo ""
    echo "   # Create backup (no sudo needed - AWS credentials work as ec2-user)"
    echo "   cd /mnt/efs"
    echo "   sudo zip -r /tmp/valheim-backup.zip ."
    echo "   sudo chown ec2-user:ec2-user /tmp/valheim-backup.zip"
    echo "   aws s3 cp /tmp/valheim-backup.zip s3://$BACKUP_BUCKET/"
    echo ""
    exit 1
fi

echo "✅ Instance launched: $INSTANCE_ID"
echo ""
echo "Monitoring backup progress..."
echo "(This will take 2-5 minutes depending on world size ~11GB)"
echo ""

# Wait for instance to start
aws ec2 wait instance-running --instance-ids $INSTANCE_ID --region $AWS_REGION
echo "✅ Instance is running, backup in progress..."

# Wait for backup to complete (instance will terminate itself)
echo "Waiting for backup to complete (instance will auto-terminate)..."
aws ec2 wait instance-terminated --instance-ids $INSTANCE_ID --region $AWS_REGION || true

echo ""
echo "Verifying backup was uploaded to S3..."

# Check if the backup file exists in S3
if aws s3 ls s3://$BACKUP_BUCKET/valheim-efs-backup-$TIMESTAMP.zip --region $AWS_REGION >/dev/null 2>&1; then
    echo "✅ S3 Backup complete!"
    echo ""
    echo "Backup location: s3://$BACKUP_BUCKET/valheim-efs-backup-$TIMESTAMP.zip"
    echo "Manifest: s3://$BACKUP_BUCKET/backup-manifest-$TIMESTAMP.txt"
    echo ""
else
    echo "❌ ERROR: Backup file not found in S3!"
    echo ""
    echo "The instance terminated but the backup was not uploaded."
    echo "Checking instance console output for errors..."
    echo ""

    # Get console output for debugging
    CONSOLE_OUTPUT=$(aws ec2 get-console-output --instance-id $INSTANCE_ID --region $AWS_REGION --query 'Output' --output text 2>&1 || echo "Console output not available")

    # Look for errors in the output
    echo "$CONSOLE_OUTPUT" | tail -50 | grep -i -A5 -B5 "error\|failed\|timeout" || echo "No obvious errors in console output"

    echo ""
    echo "Full console output has been captured. Common issues:"
    echo "1. NFS mount timeout (security group not configured correctly)"
    echo "2. IAM permissions insufficient for S3 upload"
    echo "3. EFS not accessible from the instance"
    echo ""
    exit 1
fi

# Step 6: Download to local for CLI bootstrap
LOCAL_WORLDS_DIR="./worlds"
LOCAL_BACKUP_DIR="./backups"

echo "Step 6: Downloading to local directories..."
mkdir -p "$LOCAL_WORLDS_DIR"
mkdir -p "$LOCAL_BACKUP_DIR"

# Download the zip file
echo "Downloading backup zip file..."
aws s3 cp s3://$BACKUP_BUCKET/valheim-efs-backup-$TIMESTAMP.zip $LOCAL_BACKUP_DIR/ --region $AWS_REGION

BACKUP_SIZE=$(du -h "$LOCAL_BACKUP_DIR/valheim-efs-backup-$TIMESTAMP.zip" | cut -f1)
echo "✅ Downloaded: $BACKUP_SIZE"

# Extract to worlds directory
echo "Extracting to $LOCAL_WORLDS_DIR..."
cd "$LOCAL_BACKUP_DIR"
unzip -q "valheim-efs-backup-$TIMESTAMP.zip" -d "$LOCAL_WORLDS_DIR"
cd - > /dev/null

echo "✅ Extracted to local worlds directory"
echo ""

# Show what we got
echo "Local backup contents:"
ls -lh "$LOCAL_WORLDS_DIR" | head -20
echo ""

echo "======================================"
echo "Backup Complete!"
echo "======================================"
echo ""
echo "📦 S3 Backup:"
echo "  Location: s3://$BACKUP_BUCKET/valheim-efs-backup-$TIMESTAMP.zip"
echo "  Size: $(aws s3 ls s3://$BACKUP_BUCKET/valheim-efs-backup-$TIMESTAMP.zip --region $AWS_REGION --human-readable | awk '{print $3" "$4}')"
echo ""
echo "💾 Local Backup:"
echo "  Zip file: $LOCAL_BACKUP_DIR/valheim-efs-backup-$TIMESTAMP.zip"
echo "  Extracted: $LOCAL_WORLDS_DIR"
echo "  Size: $BACKUP_SIZE"
echo ""
echo "✅ Your world data is now safe in 2 locations!"
echo ""
echo "📤 Share with friends:"
echo "  They can download the .zip file from S3 and extract it on Windows/Mac/Linux!"
echo "  aws s3 cp s3://$BACKUP_BUCKET/valheim-efs-backup-$TIMESTAMP.zip ."
echo ""
echo "To use for deployment, update .env:"
echo "  WORLD_BOOTSTRAP_LOCATION=./worlds/YourWorldName"
echo ""
echo "======================================"
