#!/bin/bash
# Monitor Docker logs for PlayFab join code and store in SSM Parameter Store

REGION=$(curl -s http://169.254.169.254/latest/meta-data/placement/region)
PARAM_NAME="/huginbot/playfab-join-code"
LAST_JOIN_CODE=""
LOG_PREFIX="[PlayFab Monitor]"

echo "$LOG_PREFIX Starting PlayFab join code monitor"
echo "$LOG_PREFIX Region: $REGION"

# Get guild ID from active world instead of relying on environment variable
ACTIVE_WORLD_JSON=$(aws ssm get-parameter --name "/huginbot/active-world" --region "$REGION" --query 'Parameter.Value' --output text 2>/dev/null)
if [ -n "$ACTIVE_WORLD_JSON" ]; then
  GUILD_ID=$(echo "$ACTIVE_WORLD_JSON" | python3 -c "import sys, json; print(json.load(sys.stdin).get('discordServerId', 'unknown'))" 2>/dev/null || echo "unknown")
  echo "$LOG_PREFIX Guild ID from active world: $GUILD_ID"
else
  GUILD_ID="${GUILD_ID:-unknown}"
  echo "$LOG_PREFIX Using fallback guild ID: $GUILD_ID"
fi

while true; do
  # Look for join code in logs from server session or player joined messages
  # Try multiple patterns to catch different log formats

  # Debug: Check if Docker container is running
  if ! docker ps | grep -q valheim-server; then
    echo "$LOG_PREFIX WARNING: valheim-server container not found or not running"
    sleep 60
    continue
  fi

  # Get recent logs
  RECENT_LOGS=$(docker logs --tail 500 valheim-server 2>&1)

  # Try to find join code with multiple patterns
  # Pattern 1: "with join code XXXXXX"
  # Pattern 2: "that has join code XXXXXX"
  # Pattern 3: "join code XXXXXX" (more lenient)
  JOIN_CODE=$(echo "$RECENT_LOGS" | grep -iE "(with|has|that has) join code" | tail -1 | grep -oE 'join code [0-9]{6}' | grep -oE '[0-9]{6}')

  # Debug logging (only on first run or every 10 minutes)
  if [ -z "$LAST_CHECK" ] || [ $(($(date +%s) - LAST_CHECK)) -gt 600 ]; then
    echo "$LOG_PREFIX Checking for join code..."
    MATCHING_LINES=$(echo "$RECENT_LOGS" | grep -iE "join code" | wc -l)
    echo "$LOG_PREFIX Found $MATCHING_LINES lines containing 'join code' in last 500 log lines"
    if [ "$MATCHING_LINES" -gt 0 ]; then
      echo "$LOG_PREFIX Sample join code line:"
      echo "$RECENT_LOGS" | grep -iE "join code" | tail -1
    fi
    LAST_CHECK=$(date +%s)
  fi

  if [ -n "$JOIN_CODE" ]; then
    # Only process if this is a new join code or first detection
    if [ "$JOIN_CODE" != "$LAST_JOIN_CODE" ]; then
      echo "$LOG_PREFIX ✅ Found new PlayFab join code: $JOIN_CODE"
      
      # Store in SSM Parameter Store
      aws ssm put-parameter --name "$PARAM_NAME" --type "String" --value "$JOIN_CODE" --overwrite --region "$REGION"
      
      # Also store timestamp of when we found it
      TIMESTAMP=$(date +%s)
      aws ssm put-parameter --name "$PARAM_NAME-timestamp" --type "String" --value "$TIMESTAMP" --overwrite --region "$REGION"
      
      # Send event to EventBridge
      aws events put-events --entries '[{
        "Source": "valheim.server",
        "DetailType": "PlayFab.JoinCodeDetected",
        "Detail": "{\"joinCode\":\"'"$JOIN_CODE"'\", \"timestamp\":'"$TIMESTAMP"', \"guildId\":\"'"$GUILD_ID"'\"}",
        "EventBusName": "default"
      }]' --region "$REGION"

      echo "$LOG_PREFIX Sent EventBridge notification for join code"
      
      # Update last seen code
      LAST_JOIN_CODE="$JOIN_CODE"
    else
      echo "$LOG_PREFIX Join code unchanged: $JOIN_CODE"
    fi
  else
    # Only log "no join code" on first run or every 10 minutes to reduce noise
    if [ -z "$LAST_NO_CODE_LOG" ] || [ $(($(date +%s) - LAST_NO_CODE_LOG)) -gt 600 ]; then
      echo "$LOG_PREFIX No join code found yet (still waiting for server to fully start)"
      LAST_NO_CODE_LOG=$(date +%s)
    fi
  fi
  
  # Check every 60 seconds
  sleep 60
done
