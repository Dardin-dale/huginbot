#!/bin/bash
set -e

# This script restores a world from S3 backup if the world files don't exist locally
# Usage: restore-world.sh <world-name> [--force]
#   world-name: The name of the world to restore (e.g., GjurdsIHOP)
#   --force: Force restore even if world files exist

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') - $1"
}

WORLD_NAME="${1:-}"
FORCE_RESTORE="${2:-}"

if [ -z "$WORLD_NAME" ]; then
  log "ERROR: World name is required"
  echo "Usage: restore-world.sh <world-name> [--force]"
  exit 1
fi

log "Checking world: $WORLD_NAME"

# Get AWS region from instance metadata
REGION=$(curl -s --connect-timeout 5 http://169.254.169.254/latest/meta-data/placement/region)
if [ -z "$REGION" ]; then
  log "ERROR: Could not determine AWS region from instance metadata"
  exit 1
fi

# Get backup bucket name from SSM
BACKUP_BUCKET_NAME=$(aws ssm get-parameter --name "/huginbot/backup-bucket-name" --region $REGION --query "Parameter.Value" --output text 2>/dev/null || echo "")
if [ -z "$BACKUP_BUCKET_NAME" ]; then
  log "ERROR: Could not get backup bucket name from SSM"
  exit 1
fi
log "Using backup bucket: $BACKUP_BUCKET_NAME"

# Define world file paths
WORLD_DIR="/mnt/valheim-data/config/worlds_local"
WORLD_DB="$WORLD_DIR/${WORLD_NAME}.db"
WORLD_FWL="$WORLD_DIR/${WORLD_NAME}.fwl"

# Check if world files already exist
if [ -f "$WORLD_DB" ] && [ -f "$WORLD_FWL" ] && [ "$FORCE_RESTORE" != "--force" ]; then
  DB_SIZE=$(stat -c%s "$WORLD_DB")
  FWL_SIZE=$(stat -c%s "$WORLD_FWL")
  log "World files already exist:"
  log "  - $WORLD_DB ($DB_SIZE bytes)"
  log "  - $WORLD_FWL ($FWL_SIZE bytes)"
  log "Skipping restore. Use --force to override."
  exit 0
fi

# List backups for this world in S3
log "Looking for backups in s3://$BACKUP_BUCKET_NAME/worlds/$WORLD_NAME/"
LATEST_BACKUP=$(aws s3 ls "s3://$BACKUP_BUCKET_NAME/worlds/$WORLD_NAME/" --region $REGION 2>/dev/null | sort | tail -1 | awk '{print $4}')

if [ -z "$LATEST_BACKUP" ]; then
  log "WARNING: No backups found for world $WORLD_NAME"
  log "The server will create a new world with this name"
  exit 0
fi

log "Found latest backup: $LATEST_BACKUP"

# Create temp directory for download
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

# Download the backup
S3_PATH="s3://$BACKUP_BUCKET_NAME/worlds/$WORLD_NAME/$LATEST_BACKUP"
LOCAL_BACKUP="$TEMP_DIR/$LATEST_BACKUP"

log "Downloading backup from $S3_PATH"
if ! aws s3 cp "$S3_PATH" "$LOCAL_BACKUP" --region $REGION; then
  log "ERROR: Failed to download backup"
  exit 1
fi

# Verify backup integrity
log "Verifying backup integrity..."
if ! tar -tzf "$LOCAL_BACKUP" > /dev/null 2>&1; then
  log "ERROR: Backup archive is corrupted"
  exit 1
fi

# Check if backup contains the world files
if ! tar -tzf "$LOCAL_BACKUP" | grep -q "worlds_local/${WORLD_NAME}.db"; then
  log "WARNING: Backup does not contain ${WORLD_NAME}.db"
  log "Backup contents:"
  tar -tzf "$LOCAL_BACKUP"
  exit 1
fi

# Create world directory if it doesn't exist
mkdir -p "$WORLD_DIR"

# Extract the backup
log "Extracting backup to /mnt/valheim-data/"
if ! tar -xzf "$LOCAL_BACKUP" -C /mnt/valheim-data/; then
  log "ERROR: Failed to extract backup"
  exit 1
fi

# Verify extraction
if [ -f "$WORLD_DB" ] && [ -f "$WORLD_FWL" ]; then
  DB_SIZE=$(stat -c%s "$WORLD_DB")
  FWL_SIZE=$(stat -c%s "$WORLD_FWL")
  log "World restored successfully:"
  log "  - $WORLD_DB ($DB_SIZE bytes)"
  log "  - $WORLD_FWL ($FWL_SIZE bytes)"
else
  log "ERROR: World files not found after extraction"
  ls -la "$WORLD_DIR/" || true
  exit 1
fi

log "Restore completed successfully"
exit 0
