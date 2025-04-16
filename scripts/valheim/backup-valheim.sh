#!/bin/bash
# Get active world from SSM Parameter Store if it exists
ACTIVE_WORLD=""
WORLD_NAME=""
if aws ssm get-parameter --name "/huginbot/active-world" --region $(curl -s http://169.254.169.254/latest/meta-data/placement/region) 2>/dev/null; then
  PARAM_VALUE=$(aws ssm get-parameter --name "/huginbot/active-world" --region $(curl -s http://169.254.169.254/latest/meta-data/placement/region) --query "Parameter.Value" --output text)
  ACTIVE_WORLD=$(echo $PARAM_VALUE | jq -r '.name')
  WORLD_NAME=$(echo $PARAM_VALUE | jq -r '.worldName')
fi

# Create the backup folder path
BACKUP_PATH=""
if [ -n "$ACTIVE_WORLD" ]; then
  BACKUP_PATH="worlds/$ACTIVE_WORLD"
  echo "Backing up world: $ACTIVE_WORLD ($WORLD_NAME)"
else
  BACKUP_PATH="worlds/default"
  echo "Backing up default world"
fi

# Create the backup
timestamp=$(date +%Y%m%d_%H%M%S)
tar -czf /tmp/valheim_backup_$timestamp.tar.gz -C /mnt/valheim-data .
aws s3 cp /tmp/valheim_backup_$timestamp.tar.gz s3://${BACKUP_BUCKET_NAME}/$BACKUP_PATH/valheim_backup_$timestamp.tar.gz
rm /tmp/valheim_backup_$timestamp.tar.gz