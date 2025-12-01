#!/bin/bash
# Monitor player count and auto-shutdown server if inactive for too long
REGION=$(curl -s http://169.254.169.254/latest/meta-data/placement/region)
INSTANCE_ID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id)
PARAM_NAME="/huginbot/player-count"
AUTO_SHUTDOWN_PARAM="/huginbot/auto-shutdown-minutes"
ACTIVITY_FILE="/tmp/valheim_last_activity"
NAMESPACE="ValheimServer"

# Read auto-shutdown configuration from SSM (default: 30 minutes)
AUTO_SHUTDOWN_CONFIG=$(aws ssm get-parameter --name "$AUTO_SHUTDOWN_PARAM" --region "$REGION" --query 'Parameter.Value' --output text 2>/dev/null || echo "30")

# Check if auto-shutdown is disabled
if [ "$AUTO_SHUTDOWN_CONFIG" = "off" ] || [ "$AUTO_SHUTDOWN_CONFIG" = "disabled" ]; then
  echo "Auto-shutdown is disabled"
  AUTO_SHUTDOWN_ENABLED=false
  INACTIVE_THRESHOLD=0
else
  echo "Auto-shutdown enabled: ${AUTO_SHUTDOWN_CONFIG} minutes"
  AUTO_SHUTDOWN_ENABLED=true
  INACTIVE_THRESHOLD=$((AUTO_SHUTDOWN_CONFIG * 60))  # Convert minutes to seconds
fi
# Always reset activity timestamp on script start (new server session)
# This prevents immediate shutdown from stale activity data from previous runs
echo "Resetting activity timestamp for new server session"
date +%s > "$ACTIVITY_FILE"
while true; do
  # Look for connected players in logs
  CURRENT_TIME=$(date +%s)
  
  # Check for recent player activity in logs (last 5 minutes)
  RECENT_PLAYERS=$(docker logs --since 5m valheim-server 2>&1 | grep -i "Player joined server" | wc -l)
  RECENT_DISCONNECTS=$(docker logs --since 5m valheim-server 2>&1 | grep -i "Player connection lost server" | wc -l)
  # Extract the most recent player count directly from logs
  LATEST_PLAYER_COUNT=$(docker logs --tail 100 valheim-server 2>&1 | grep -E "now [0-9]+ player\(s\)" | tail -1 | grep -oE "now ([0-9]+)" | grep -oE "[0-9]+")
  # If no player count found in logs, fall back to manual counting
  if [ -z "$LATEST_PLAYER_COUNT" ]; then
    # Count all connections and disconnections in log history
    CONNECTIONS=$(docker logs --tail 500 valheim-server 2>&1 | grep -i "Player joined server" | wc -l)
    DISCONNECTIONS=$(docker logs --tail 500 valheim-server 2>&1 | grep -i "Player connection lost server" | wc -l)
    CURRENT_PLAYERS=$((CONNECTIONS - DISCONNECTIONS))
  
    # Ensure we don't have negative players (could happen if we missed some log entries)
    if [ "$CURRENT_PLAYERS" -lt 0 ]; then
      CURRENT_PLAYERS=0
    fi
  else
    # Use the player count directly from logs
    CURRENT_PLAYERS=$LATEST_PLAYER_COUNT
  fi
  
  echo "Current player count: $CURRENT_PLAYERS"
  
  # Store player count in Parameter Store
  aws ssm put-parameter --name "$PARAM_NAME" --type "String" --value "$CURRENT_PLAYERS" --overwrite --region "$REGION"
  
  # Send metric to CloudWatch
  aws cloudwatch put-metric-data \
    --namespace "$NAMESPACE" \
    --metric-name "PlayerCount" \
    --value "$CURRENT_PLAYERS" \
    --unit "Count" \
    --region "$REGION"
  
  # Check if there's player activity
  if [ "$CURRENT_PLAYERS" -gt 0 ] || [ "$RECENT_PLAYERS" -gt 0 ]; then
    echo "Active players detected, updating last activity timestamp"
    echo "$CURRENT_TIME" > "$ACTIVITY_FILE"
  else
    # Calculate time since last activity
    LAST_ACTIVITY=$(cat "$ACTIVITY_FILE")
    INACTIVE_TIME=$((CURRENT_TIME - LAST_ACTIVITY))
    echo "No active players. Server idle for $INACTIVE_TIME seconds"
    
    # Send idle time metric to CloudWatch
    aws cloudwatch put-metric-data \
      --namespace "$NAMESPACE" \
      --metric-name "IdleTimeSeconds" \
      --value "$INACTIVE_TIME" \
      --unit "Seconds" \
      --region "$REGION"
    
    # Check if we should shut down (only if auto-shutdown is enabled)
    if [ "$AUTO_SHUTDOWN_ENABLED" = true ] && [ "$INACTIVE_TIME" -gt "$INACTIVE_THRESHOLD" ]; then
      echo "Server has been inactive for more than $INACTIVE_THRESHOLD seconds. Shutting down..."

      # Take a backup before shutting down
      /usr/local/bin/backup-valheim.sh

      # Send notification to EventBridge
      aws events put-events --entries '[{
        "Source": "valheim.server",
        "DetailType": "Server.AutoShutdown",
        "Detail": "{\"reason\":\"inactivity\", \"idleTime\":'"$INACTIVE_TIME"', \"timestamp\":'"$CURRENT_TIME"', \"guildId\":\"'"$GUILD_ID"'\"}",
        "EventBusName": "default"
      }]' --region "$REGION"

      # Stop the instance
      aws ec2 stop-instances --instance-ids "$INSTANCE_ID" --region "$REGION"
      break
    fi
  fi
  
  # Check every 2 minutes
  sleep 120
done
