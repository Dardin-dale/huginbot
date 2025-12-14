#!/bin/bash
set -e # Exit immediately if a command exits with a non-zero status

# Log function for consistent output
log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log "Starting backup operation"

# Get AWS region
REGION=$(curl -s --connect-timeout 5 http://169.254.169.254/latest/meta-data/placement/region)
if [ -z "$REGION" ]; then
  log "ERROR: Could not determine AWS region from instance metadata"
  exit 1
fi
log "Using AWS region: $REGION"

# Verify BACKUP_BUCKET_NAME environment variable is set
if [ -z "$BACKUP_BUCKET_NAME" ]; then
  log "ERROR: BACKUP_BUCKET_NAME environment variable is not set"
  # Check if it's available in the instance's environment
  if [ -f /etc/environment ]; then
    source /etc/environment
  fi
  # If still not available, try to get it from AWS Parameter Store
  if [ -z "$BACKUP_BUCKET_NAME" ]; then
    log "Attempting to retrieve backup bucket name from SSM Parameter Store"
    BACKUP_BUCKET_NAME=$(aws ssm get-parameter --name "/huginbot/backup-bucket-name" --region $REGION --query "Parameter.Value" --output text 2>/dev/null || echo "")
    if [ -z "$BACKUP_BUCKET_NAME" ]; then
      log "ERROR: Could not determine backup bucket name"
      exit 1
    fi
  fi
fi
log "Using backup bucket: $BACKUP_BUCKET_NAME"

# Get active world from SSM Parameter Store if it exists
ACTIVE_WORLD=""
WORLD_NAME=""
if aws ssm get-parameter --name "/huginbot/active-world" --region $REGION 2>/dev/null; then
  PARAM_VALUE=$(aws ssm get-parameter --name "/huginbot/active-world" --region $REGION --query "Parameter.Value" --output text)
  
  # Validate JSON format
  if ! echo "$PARAM_VALUE" | jq . > /dev/null 2>&1; then
    log "ERROR: Parameter value is not valid JSON: $PARAM_VALUE"
    ACTIVE_WORLD="default-fallback"
  else
    ACTIVE_WORLD=$(echo "$PARAM_VALUE" | jq -r '.name')
    WORLD_NAME=$(echo "$PARAM_VALUE" | jq -r '.worldName')
    
    # Check for null values
    if [ "$ACTIVE_WORLD" = "null" ]; then
      ACTIVE_WORLD="default-fallback"
    fi
    if [ "$WORLD_NAME" = "null" ]; then
      WORLD_NAME="DefaultWorld"
    fi
  fi
fi

# Create the backup folder path
BACKUP_PATH=""
if [ -n "$ACTIVE_WORLD" ]; then
  BACKUP_PATH="worlds/$ACTIVE_WORLD"
  log "Backing up world: $ACTIVE_WORLD ($WORLD_NAME)"
else
  BACKUP_PATH="worlds/default"
  log "Backing up default world"
fi

# Verify backup directory exists in S3
log "Checking if backup path exists in S3: $BACKUP_PATH"
if ! aws s3 ls "s3://${BACKUP_BUCKET_NAME}/$BACKUP_PATH/" > /dev/null 2>&1; then
  log "Creating backup path in S3 bucket"
  if ! aws s3api put-object --bucket "$BACKUP_BUCKET_NAME" --key "$BACKUP_PATH/" > /dev/null 2>&1; then
    log "WARNING: Failed to create backup path in S3, but will attempt backup anyway"
  fi
fi

# Create temporary directory for validation
TEMP_DIR=$(mktemp -d)
log "Created temporary directory for validation: $TEMP_DIR"
trap 'rm -rf "$TEMP_DIR"' EXIT

# Create the backup
timestamp=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="/tmp/valheim_backup_$timestamp.tar.gz"
S3_KEY="$BACKUP_PATH/valheim_backup_$timestamp.tar.gz"
S3_URI="s3://${BACKUP_BUCKET_NAME}/$S3_KEY"

# Only backup world files (config/worlds_local/) - NOT the entire game directory
# World files: .db (world data ~80MB) and .fwl (metadata ~5KB)
WORLD_DIR="/mnt/valheim-data/config/worlds_local"

if [ ! -d "$WORLD_DIR" ]; then
  log "ERROR: World directory does not exist: $WORLD_DIR"
  exit 1
fi

# Check if there are any world files
if ! ls "$WORLD_DIR"/*.db 1> /dev/null 2>&1; then
  log "WARNING: No world files (.db) found in $WORLD_DIR"
  log "Available files:"
  ls -la "$WORLD_DIR" || echo "Directory is empty"
  exit 1
fi

log "Creating backup archive at $BACKUP_FILE"
log "Backing up world files from: $WORLD_DIR"

# Create backup with proper directory structure for restore
if ! tar -czf "$BACKUP_FILE" -C /mnt/valheim-data config/worlds_local; then
  log "ERROR: Failed to create backup archive"
  exit 1
fi

# Check backup size
BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
BACKUP_BYTES=$(stat -c%s "$BACKUP_FILE")
log "Backup archive created successfully: $BACKUP_SIZE ($BACKUP_BYTES bytes)"

# World files should be at least a few KB (fwl ~5KB, db can be 1MB+)
if [ "$BACKUP_BYTES" -lt 5000 ]; then
  log "ERROR: Backup file is too small (${BACKUP_BYTES} bytes), world data may be missing"
  exit 1
fi

# Test backup integrity
log "Validating backup integrity..."
if ! tar -tzf "$BACKUP_FILE" > /dev/null 2>&1; then
  log "ERROR: Backup integrity check failed, archive may be corrupted"
  exit 1
fi

# Upload to S3
log "Uploading backup to S3: $S3_URI"
if ! aws s3 cp "$BACKUP_FILE" "$S3_URI"; then
  log "ERROR: Failed to upload backup to S3"
  exit 1
fi

# Verify upload was successful by checking object exists and size matches
log "Verifying backup was uploaded correctly"
S3_OBJECT_INFO=$(aws s3api head-object --bucket "$BACKUP_BUCKET_NAME" --key "$S3_KEY" 2>/dev/null)
if [ $? -ne 0 ]; then
  log "ERROR: Failed to verify backup in S3"
  exit 1
fi

S3_OBJECT_SIZE=$(echo "$S3_OBJECT_INFO" | jq -r '.ContentLength')
if [ "$S3_OBJECT_SIZE" != "$BACKUP_BYTES" ]; then
  log "ERROR: Size mismatch between local backup ($BACKUP_BYTES bytes) and S3 ($S3_OBJECT_SIZE bytes)"
  exit 1
fi

# Optional: Validate backup contents by extracting a small test file
log "Performing additional validation by testing extraction"
TEST_FILE=$(tar -tzf "$BACKUP_FILE" | grep -E "\.(fwl|db|fch)$" | head -1)
if [ -n "$TEST_FILE" ]; then
  log "Testing extraction of a sample file: $TEST_FILE"
  if ! tar -xzf "$BACKUP_FILE" -C "$TEMP_DIR" "$TEST_FILE" 2>/dev/null; then
    log "WARNING: Sample extraction test failed, backup may be incomplete"
  else
    log "Sample extraction test succeeded"
  fi
fi

# Clean up
log "Removing temporary backup file"
rm "$BACKUP_FILE"

log "Backup operation completed successfully"

# Send EventBridge notification for backup completion
log "Sending EventBridge notification"
GUILD_ID=$(aws ssm get-parameter --name "/huginbot/discord/guild-id" --region $REGION --query "Parameter.Value" --output text 2>/dev/null || echo "unknown")
aws events put-events --entries '[{
  "Source": "valheim.server",
  "DetailType": "Backup.Completed",
  "Detail": "{\"worldName\":\"'"$ACTIVE_WORLD"'\", \"size\":'"$BACKUP_BYTES"', \"s3Uri\":\"'"$S3_URI"'\", \"timestamp\":'"$(date +%s)000"', \"guildId\":\"'"$GUILD_ID"'\"}",
  "EventBusName": "default"
}]' --region "$REGION" 2>/dev/null || log "WARNING: Failed to send EventBridge notification"

echo "Backup saved to $S3_URI (Size: $BACKUP_SIZE)"
exit 0