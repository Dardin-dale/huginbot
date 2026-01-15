#!/bin/bash
set -e

# Log function for consistent output
log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log "Starting backup-and-stop sequence"

# Get AWS region
REGION=$(curl -s --connect-timeout 5 http://169.254.169.254/latest/meta-data/placement/region)
if [ -z "$REGION" ]; then
  log "ERROR: Could not determine AWS region"
  exit 1
fi

# Get instance ID
INSTANCE_ID=$(curl -s --connect-timeout 5 http://169.254.169.254/latest/meta-data/instance-id)
if [ -z "$INSTANCE_ID" ]; then
  log "ERROR: Could not determine instance ID"
  exit 1
fi

# Get guild ID for notifications
GUILD_ID=$(aws ssm get-parameter --name "/huginbot/discord/guild-id" --region $REGION --query "Parameter.Value" --output text 2>/dev/null || echo "unknown")

# Run backup
log "Running backup..."
BACKUP_RESULT=0
BACKUP_ERROR=""

if /usr/local/bin/backup-valheim.sh; then
  log "✅ Backup completed successfully"
  BACKUP_RESULT=1
else
  BACKUP_RESULT=0
  BACKUP_ERROR="Backup script failed"
  log "⚠️ Backup failed, proceeding with shutdown anyway"
fi

# Send EventBridge notification for backup completion
log "Sending backup notification to Discord..."
TIMESTAMP_MS=$(date +%s)000
aws events put-events \
  --entries "[{
    \"Source\": \"valheim.server\",
    \"DetailType\": \"Backup.Complete\",
    \"Detail\": \"{\\\"backupCompleted\\\":${BACKUP_RESULT}, \\\"backupError\\\":\\\"${BACKUP_ERROR}\\\", \\\"timestamp\\\":${TIMESTAMP_MS}, \\\"guildId\\\":\\\"${GUILD_ID}\\\"}\",
    \"EventBusName\": \"default\"
  }]" \
  --region "$REGION" || log "WARNING: Failed to send EventBridge notification"

# Stop the instance
log "Stopping EC2 instance: $INSTANCE_ID"
if aws ec2 stop-instances --instance-ids "$INSTANCE_ID" --region "$REGION"; then
  log "✅ EC2 stop command sent successfully"
  log "Server shutdown complete"
else
  log "❌ Failed to stop instance"

  # Send failure notification
  aws events put-events --entries '[{
    "Source": "valheim.server",
    "DetailType": "Server.StopFailed",
    "Detail": "{\"reason\":\"ec2_stop_failed\", \"timestamp\":'"$(date +%s)000"', \"guildId\":\"'"$GUILD_ID"'\"}",
    "EventBusName": "default"
  }]' --region "$REGION" 2>/dev/null

  exit 1
fi

exit 0
