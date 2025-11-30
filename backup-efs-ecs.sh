#!/bin/bash

# Automated EFS Backup using ECS Fargate
# This automates the manual process you've been using

set -e

EFS_ID="fs-03d88f4ec4ca60ffc"
AWS_REGION="us-west-2"
BACKUP_BUCKET="huginbot-efs-backup-20251129"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

echo "======================================"
echo "EFS Backup via ECS Fargate"
echo "======================================"
echo ""

# Use existing Valheim ECS cluster
CLUSTER="ValheimServerValheimServerAwsCdkStackDE1BD991-fargateCluster7F3D820B-qDmXunFBIEfo"
echo "Using cluster: $CLUSTER"

# Get VPC and subnet from EFS
echo "Getting network configuration from EFS..."
SUBNET_ID=$(aws efs describe-mount-targets \
    --file-system-id $EFS_ID \
    --region $AWS_REGION \
    --query 'MountTargets[0].SubnetId' \
    --output text)

# Use the EFS security group from your Valheim infrastructure
SECURITY_GROUP="sg-06e42e3fbcf9f81cd"

echo "Subnet: $SUBNET_ID"
echo "Security Group: $SECURITY_GROUP (valheimServerStorage/EfsSecurityGroup)"
echo ""

# Create task definition
echo "Creating ECS task definition..."

TASK_DEF=$(cat <<EOF
{
  "family": "efs-backup-task",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):role/ValheimECSTaskRole",
  "containerDefinitions": [
    {
      "name": "backup-container",
      "image": "amazon/aws-cli:latest",
      "essential": true,
      "command": [
        "sh", "-c",
        "yum install -y zip && cd /mnt/efs && zip -r /tmp/backup-$TIMESTAMP.zip . && aws s3 cp /tmp/backup-$TIMESTAMP.zip s3://$BACKUP_BUCKET/valheim-efs-backup-$TIMESTAMP.zip --region $AWS_REGION"
      ],
      "mountPoints": [
        {
          "sourceVolume": "efs-volume",
          "containerPath": "/mnt/efs",
          "readOnly": true
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/efs-backup",
          "awslogs-region": "$AWS_REGION",
          "awslogs-stream-prefix": "backup",
          "awslogs-create-group": "true"
        }
      }
    }
  ],
  "volumes": [
    {
      "name": "efs-volume",
      "efsVolumeConfiguration": {
        "fileSystemId": "$EFS_ID",
        "transitEncryption": "ENABLED"
      }
    }
  ]
}
EOF
)

echo "$TASK_DEF" > /tmp/task-def-$TIMESTAMP.json

aws ecs register-task-definition \
    --cli-input-json file:///tmp/task-def-$TIMESTAMP.json \
    --region $AWS_REGION > /dev/null

rm /tmp/task-def-$TIMESTAMP.json

echo "✅ Task definition registered"
echo ""

# Run the task
echo "Launching ECS task..."
TASK_ARN=$(aws ecs run-task \
    --cluster $CLUSTER \
    --task-definition efs-backup-task \
    --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[$SUBNET_ID],securityGroups=[$SECURITY_GROUP],assignPublicIp=ENABLED}" \
    --region $AWS_REGION \
    --query 'tasks[0].taskArn' \
    --output text)

if [ -z "$TASK_ARN" ]; then
    echo "ERROR: Failed to launch task"
    exit 1
fi

echo "✅ Task launched: $TASK_ARN"
echo ""

# Wait for task to complete
echo "Waiting for backup to complete..."
echo "(This may take 5-10 minutes for 11GB)"
echo ""

aws ecs wait tasks-stopped \
    --cluster $CLUSTER \
    --tasks $TASK_ARN \
    --region $AWS_REGION

# Check if backup succeeded
echo "Checking if backup was uploaded..."
if aws s3 ls s3://$BACKUP_BUCKET/valheim-efs-backup-$TIMESTAMP.zip --region $AWS_REGION >/dev/null 2>&1; then
    echo "✅ Backup successful!"
    echo ""
    echo "Backup location: s3://$BACKUP_BUCKET/valheim-efs-backup-$TIMESTAMP.zip"

    # Download locally
    echo ""
    echo "Downloading backup locally..."
    mkdir -p ./backups
    aws s3 cp s3://$BACKUP_BUCKET/valheim-efs-backup-$TIMESTAMP.zip ./backups/ --region $AWS_REGION

    BACKUP_SIZE=$(du -h ./backups/valheim-efs-backup-$TIMESTAMP.zip | cut -f1)
    echo "✅ Downloaded: $BACKUP_SIZE"
    echo ""
    echo "To extract: unzip ./backups/valheim-efs-backup-$TIMESTAMP.zip -d ./worlds"
else
    echo "❌ Backup failed - file not found in S3"
    echo ""
    echo "Check task logs:"
    echo "aws logs tail /ecs/efs-backup --follow --region $AWS_REGION"
    exit 1
fi

echo ""
echo "======================================"
echo "Backup Complete!"
echo "======================================"
