#!/bin/bash

# HuginBot Interactive AWS Resource Cleanup
# Safely delete duplicate EC2 instances and orphaned EBS volumes

set -e

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

AWS_REGION=${AWS_REGION:-us-west-2}

echo "=========================================="
echo "HuginBot Interactive Resource Cleanup"
echo "=========================================="
echo ""
echo "⚠️  WARNING: This will DELETE resources!"
echo "Make sure you know which resources to keep."
echo ""

# Get current stack instance ID if it exists
STACK_INSTANCE_ID=""
if aws cloudformation describe-stacks --region "$AWS_REGION" --stack-name ValheimStack &>/dev/null; then
    STACK_INSTANCE_ID=$(aws cloudformation describe-stack-resources \
        --region "$AWS_REGION" \
        --stack-name ValheimStack \
        --query "StackResources[?ResourceType=='AWS::EC2::Instance'].PhysicalResourceId" \
        --output text)

    if [ -n "$STACK_INSTANCE_ID" ]; then
        echo "✅ Current ValheimStack EC2 Instance: $STACK_INSTANCE_ID"
        echo "   (This instance will be PROTECTED from deletion)"
        echo ""
    fi
fi

# Clean up orphaned EBS volumes
echo "--- Cleaning Up Orphaned EBS Volumes ---"
ORPHANED_VOLUMES=$(aws ec2 describe-volumes \
    --region "$AWS_REGION" \
    --filters "Name=status,Values=available" \
    --query 'Volumes[*].VolumeId' \
    --output text)

if [ -z "$ORPHANED_VOLUMES" ] || [ "$ORPHANED_VOLUMES" == "None" ]; then
    echo "✅ No orphaned volumes found!"
else
    echo "Found orphaned volumes:"
    aws ec2 describe-volumes \
        --region "$AWS_REGION" \
        --filters "Name=status,Values=available" \
        --query 'Volumes[*].[VolumeId,Size,CreateTime]' \
        --output table

    echo ""
    read -p "Delete ALL orphaned volumes? (yes/no): " confirm

    if [ "$confirm" == "yes" ]; then
        for volume_id in $ORPHANED_VOLUMES; do
            echo "Deleting volume: $volume_id"
            aws ec2 delete-volume --region "$AWS_REGION" --volume-id "$volume_id"
            echo "✅ Deleted: $volume_id"
        done
    else
        echo "Skipping volume deletion."
    fi
fi

echo ""

# Clean up duplicate EC2 instances
echo "--- Cleaning Up Duplicate EC2 Instances ---"
ALL_VALHEIM_INSTANCES=$(aws ec2 describe-instances \
    --region "$AWS_REGION" \
    --filters "Name=tag:Name,Values=*valheim*" "Name=instance-state-name,Values=running,stopped,stopping" \
    --query 'Reservations[*].Instances[*].InstanceId' \
    --output text)

if [ -z "$ALL_VALHEIM_INSTANCES" ]; then
    echo "✅ No Valheim instances found."
else
    echo "Found Valheim instances:"
    aws ec2 describe-instances \
        --region "$AWS_REGION" \
        --filters "Name=tag:Name,Values=*valheim*" \
        --query 'Reservations[*].Instances[*].[InstanceId,State.Name,LaunchTime]' \
        --output table

    echo ""

    for instance_id in $ALL_VALHEIM_INSTANCES; do
        # Skip the current stack instance
        if [ "$instance_id" == "$STACK_INSTANCE_ID" ]; then
            echo "⚠️  Skipping $instance_id (current stack instance)"
            continue
        fi

        echo ""
        read -p "Terminate instance $instance_id? (yes/no): " confirm

        if [ "$confirm" == "yes" ]; then
            echo "Terminating instance: $instance_id"
            aws ec2 terminate-instances --region "$AWS_REGION" --instance-ids "$instance_id"
            echo "✅ Terminated: $instance_id"
        else
            echo "Skipping $instance_id"
        fi
    done
fi

echo ""
echo "=========================================="
echo "Cleanup Complete!"
echo "=========================================="
echo ""
echo "Run ./cleanup-aws-resources.sh to verify."
