#!/bin/bash

# HuginBot AWS Resource Cleanup Script
# This script helps you identify and clean up duplicate EC2 instances and orphaned EBS volumes

set -e

echo "=========================================="
echo "HuginBot AWS Resource Audit"
echo "=========================================="
echo ""

# Load environment variables safely
if [ -f .env ]; then
    set -a
    source <(cat .env | grep -v '^#' | grep -v '=' | grep -E '^[A-Z_]+=')
    set +a
fi

AWS_REGION=${AWS_REGION:-us-west-2}

echo "Using AWS Region: $AWS_REGION"
echo ""

# List all EC2 instances related to Valheim
echo "--- EC2 INSTANCES ---"
aws ec2 describe-instances \
    --region "$AWS_REGION" \
    --filters "Name=tag:Name,Values=*valheim*" \
    --query 'Reservations[*].Instances[*].[InstanceId,State.Name,LaunchTime,Tags[?Key==`Name`].Value|[0]]' \
    --output table

echo ""
echo "--- ALL VALHEIM-RELATED EC2 INSTANCES (including stopped) ---"
aws ec2 describe-instances \
    --region "$AWS_REGION" \
    --filters "Name=tag:Name,Values=*valheim*" \
    --query 'Reservations[*].Instances[*].[InstanceId,State.Name,InstanceType,PublicIpAddress,PrivateIpAddress,LaunchTime]' \
    --output table

echo ""

# List all EBS volumes
echo "--- ALL EBS VOLUMES ---"
aws ec2 describe-volumes \
    --region "$AWS_REGION" \
    --query 'Volumes[*].[VolumeId,State,Size,VolumeType,Attachments[0].InstanceId,CreateTime,Tags[?Key==`Name`].Value|[0]]' \
    --output table

echo ""

# List unattached volumes (orphaned)
echo "--- ORPHANED EBS VOLUMES (not attached to any instance) ---"
aws ec2 describe-volumes \
    --region "$AWS_REGION" \
    --filters "Name=status,Values=available" \
    --query 'Volumes[*].[VolumeId,Size,VolumeType,CreateTime,Tags[?Key==`Name`].Value|[0]]' \
    --output table

echo ""

# Calculate costs
echo "--- ESTIMATED MONTHLY COSTS ---"
VOLUME_COUNT=$(aws ec2 describe-volumes --region "$AWS_REGION" --filters "Name=status,Values=available" --query 'length(Volumes)' --output text)
TOTAL_GB=$(aws ec2 describe-volumes --region "$AWS_REGION" --filters "Name=status,Values=available" --query 'sum(Volumes[*].Size)' --output text)

if [ -n "$TOTAL_GB" ] && [ "$TOTAL_GB" != "null" ] && [ "$TOTAL_GB" -gt 0 ]; then
    MONTHLY_COST=$(echo "scale=2; $TOTAL_GB * 0.08" | bc)
    echo "Orphaned Volumes: $VOLUME_COUNT"
    echo "Total Storage: ${TOTAL_GB}GB"
    echo "Estimated Monthly Cost: \$$MONTHLY_COST USD"
else
    echo "No orphaned volumes found!"
fi

echo ""
echo "=========================================="
echo "To delete resources, run:"
echo "=========================================="
echo ""
echo "# Delete a specific EC2 instance:"
echo "aws ec2 terminate-instances --region $AWS_REGION --instance-ids i-xxxxx"
echo ""
echo "# Delete a specific EBS volume:"
echo "aws ec2 delete-volume --region $AWS_REGION --volume-id vol-xxxxx"
echo ""
echo "# Or use the interactive cleanup script:"
echo "./cleanup-aws-resources-interactive.sh"
echo ""
