#!/bin/bash
# Monitor player count and auto-shutdown server if inactive for too long
REGION=$(curl -s http://169.254.169.254/latest/meta-data/placement/region)
INSTANCE_ID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id)
PARAM_NAME="/huginbot/player-count"
INACTIVE_THRESHOLD=600  # 10 minutes in seconds
ACTIVITY_FILE="/tmp/valheim_last_activity"
NAMESPACE="ValheimServer"
# Initialize last activity timestamp if not exists
if [ ! -f "$ACTIVITY_FILE" ]; then
  date +%s > "$ACTIVITY_FILE"
fi
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
    
    # Check if we should shut down
    if [ "$INACTIVE_TIME" -gt "$INACTIVE_THRESHOLD" ]; then
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
