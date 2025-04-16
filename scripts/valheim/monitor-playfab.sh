#!/bin/bash
# Monitor Docker logs for PlayFab join code and store in SSM Parameter Store

REGION=$(curl -s http://169.254.169.254/latest/meta-data/placement/region)
PARAM_NAME="/huginbot/playfab-join-code"
LAST_JOIN_CODE=""

while true; do
  # Look for join code in logs from server session or player joined messages
  JOIN_CODE=$(docker logs --tail 300 valheim-server 2>&1 | grep -E "with join code|has join code" | tail -1 | grep -oE 'join code [0-9]{6}' | grep -oE '[0-9]{6}')
  
  if [ -n "$JOIN_CODE" ]; then
    # Only process if this is a new join code or first detection
    if [ "$JOIN_CODE" != "$LAST_JOIN_CODE" ]; then
      echo "Found new PlayFab join code: $JOIN_CODE"
      
      # Store in SSM Parameter Store
      aws ssm put-parameter --name "$PARAM_NAME" --type "String" --value "$JOIN_CODE" --overwrite --region "$REGION"
      
      # Also store timestamp of when we found it
      TIMESTAMP=$(date +%s)
      aws ssm put-parameter --name "$PARAM_NAME-timestamp" --type "String" --value "$TIMESTAMP" --overwrite --region "$REGION"
      
      # Send event to EventBridge
      aws events put-events --entries '[{
        "Source": "valheim.server",
        "DetailType": "PlayFab.JoinCodeDetected",
        "Detail": "{\"joinCode\":\"'"$JOIN_CODE"'\", \"timestamp\":'"$TIMESTAMP"'}",
        "EventBusName": "default"
      }]' --region "$REGION"
      
      echo "Sent event notification for join code"
      
      # Update last seen code
      LAST_JOIN_CODE="$JOIN_CODE"
    else
      echo "PlayFab join code unchanged: $JOIN_CODE"
    fi
  else
    echo "No PlayFab join code found"
  fi
  
  # Check every 60 seconds
  sleep 60
done