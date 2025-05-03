#!/bin/bash
set -e # Exit immediately if a command exits with a non-zero status

# This script switches the active Valheim world based on SSM Parameter Store value

# Log start of script execution
echo "$(date '+%Y-%m-%d %H:%M:%S') - Starting world switch operation"

# Get AWS region from instance metadata
REGION=$(curl -s --connect-timeout 5 http://169.254.169.254/latest/meta-data/placement/region)
if [ -z "$REGION" ]; then
  echo "ERROR: Could not determine AWS region from instance metadata"
  exit 1
fi
echo "Using AWS region: $REGION"

# Check if docker is running
if ! docker info > /dev/null 2>&1; then
  echo "ERROR: Docker service is not running or not accessible"
  exit 1
fi

# Check if the server is running
if docker ps | grep -q valheim-server; then
  echo "Stopping Valheim server..."
  # Stop container with 30s timeout
  if ! docker stop --time=30 valheim-server; then
    echo "WARNING: Docker container did not stop gracefully, forcing stop"
    docker kill valheim-server || true
  fi
  
  # Remove container, but don't fail if it's already gone
  docker rm valheim-server || true
  
  echo "Server container stopped and removed"
else
  echo "No running Valheim server found, proceeding with clean start"
fi

# Get active world from SSM Parameter Store with error handling
echo "Retrieving world configuration from SSM Parameter Store..."
SSM_CMD="aws ssm get-parameter --name \"/huginbot/active-world\" --region $REGION"

if ! PARAM_RESULT=$($SSM_CMD 2>&1); then
  if [[ "$PARAM_RESULT" == *"ParameterNotFound"* ]]; then
    echo "NOTICE: No active world parameter found, using default configuration"
    # Set default values
    WORLD_NAME="HuginDefault"
    SERVER_NAME="HuginBot Default World"
    SERVER_PASSWORD="huginbot"
  else
    echo "ERROR: Failed to get parameter from SSM: $PARAM_RESULT"
    exit 1
  fi
else
  # Parse the parameter value with error handling
  PARAM_VALUE=$(aws ssm get-parameter --name "/huginbot/active-world" --region "$REGION" --query "Parameter.Value" --output text)
  
  # Validate JSON format
  if ! echo "$PARAM_VALUE" | jq . > /dev/null 2>&1; then
    echo "ERROR: Parameter value is not valid JSON: $PARAM_VALUE"
    exit 1
  fi
  
  # Extract values with validation
  WORLD_NAME=$(echo "$PARAM_VALUE" | jq -r '.worldName')
  SERVER_NAME=$(echo "$PARAM_VALUE" | jq -r '.name')
  SERVER_PASSWORD=$(echo "$PARAM_VALUE" | jq -r '.serverPassword')
  
  # Check if any required values are missing or null
  if [ "$WORLD_NAME" = "null" ] || [ -z "$WORLD_NAME" ]; then
    echo "ERROR: World name is missing or null in the configuration"
    exit 1
  fi
  
  if [ "$SERVER_NAME" = "null" ] || [ -z "$SERVER_NAME" ]; then
    echo "ERROR: Server name is missing or null in the configuration"
    exit 1
  fi
  
  if [ "$SERVER_PASSWORD" = "null" ] || [ -z "$SERVER_PASSWORD" ]; then
    echo "ERROR: Server password is missing or null in the configuration"
    exit 1
  fi
fi

echo "Switching to world: $SERVER_NAME ($WORLD_NAME)"

# Back up the current world
echo "Creating backup of current world data..."
if ! /usr/local/bin/backup-valheim.sh; then
  echo "WARNING: Backup operation failed, but continuing with world switch"
fi

# Verify data directories exist
for dir in "/mnt/valheim-data/config" "/mnt/valheim-data/backups" "/mnt/valheim-data/mods"; do
  if [ ! -d "$dir" ]; then
    echo "Creating required directory: $dir"
    mkdir -p "$dir"
    chmod 755 "$dir"
  fi
done

# Get webhook URL for notifications (if available)
DISCORD_SERVER_ID=$(echo "$PARAM_VALUE" | jq -r '.discordServerId' 2>/dev/null || echo "")
WEBHOOK_PARAM_NAME="/huginbot/discord-webhook/$DISCORD_SERVER_ID"

if [ -n "$DISCORD_SERVER_ID" ]; then
  echo "Checking for Discord webhook for server ID: $DISCORD_SERVER_ID"
  if WEBHOOK_URL=$(aws ssm get-parameter --name "$WEBHOOK_PARAM_NAME" --with-decryption --region "$REGION" --query "Parameter.Value" --output text 2>/dev/null); then
    echo "Discord webhook found, will configure server with notifications"
    WEBHOOK_ENV="-e DISCORD_WEBHOOK=\"$WEBHOOK_URL\""
  else
    echo "No Discord webhook found, server will run without notifications"
    WEBHOOK_ENV=""
  fi
else
  echo "No Discord server ID associated with this world, skipping webhook config"
  WEBHOOK_ENV=""
fi

# Write server settings to file for debugging and record-keeping
echo "Creating server config record..."
cat > "/mnt/valheim-data/config/server_config.txt" << EOF
# Valheim Server Configuration - $(date)
SERVER_NAME: $SERVER_NAME
WORLD_NAME: $WORLD_NAME
DISCORD_SERVER_ID: $DISCORD_SERVER_ID
WEBHOOK_CONFIGURED: $([ -n "$WEBHOOK_ENV" ] && echo "Yes" || echo "No")
EOF

echo "Starting Valheim server with world: $WORLD_NAME"
# Start the server with the new configuration
# Note: We use eval for the webhook env variable to properly handle quotes
SERVER_CMD="docker run -d --name valheim-server \
  -p 2456-2458:2456-2458/udp \
  -p 2456-2458:2456-2458/tcp \
  -p 80:80 \
  -v /mnt/valheim-data/config:/config \
  -v /mnt/valheim-data/backups:/config/backups \
  -v /mnt/valheim-data/mods:/bepinex/plugins \
  -e SERVER_NAME=\"$SERVER_NAME\" \
  -e WORLD_NAME=\"$WORLD_NAME\" \
  -e SERVER_PASS=\"$SERVER_PASSWORD\" \
  -e TZ=\"America/Los_Angeles\" \
  -e BACKUPS_DIRECTORY=\"/config/backups\" \
  -e BACKUPS_INTERVAL=\"3600\" \
  -e BACKUPS_MAX_AGE=\"3\" \
  -e BACKUPS_DIRECTORY_PERMISSIONS=\"755\" \
  -e BACKUPS_FILE_PERMISSIONS=\"644\" \
  -e CONFIG_DIRECTORY_PERMISSIONS=\"755\" \
  -e WORLDS_DIRECTORY_PERMISSIONS=\"755\" \
  -e WORLDS_FILE_PERMISSIONS=\"644\" \
  -e SERVER_PUBLIC=\"true\" \
  -e UPDATE_INTERVAL=\"900\" \
  -e STEAMCMD_ARGS=\"validate\" \
  -e BEPINEX=\"true\" \
  -e SERVER_ARGS=\"-crossplay -bepinex\" \
  $WEBHOOK_ENV \
  --restart unless-stopped \
  lloesche/valheim-server"

# Run the command and capture the container ID
if ! CONTAINER_ID=$(eval $SERVER_CMD); then
  echo "ERROR: Failed to start Valheim server container"
  exit 1
fi

echo "Container started successfully with ID: $CONTAINER_ID"

# Wait and verify the container is still running after 5 seconds
echo "Verifying container is running..."
sleep 5

if docker ps | grep -q "$CONTAINER_ID"; then
  echo "Container verification successful"
else
  echo "ERROR: Container failed to start or exited immediately. Checking logs:"
  docker logs "$CONTAINER_ID" || echo "Could not retrieve container logs"
  exit 1
fi

# Record operation success and end time
echo "$(date '+%Y-%m-%d %H:%M:%S') - World switched successfully to $WORLD_NAME"
exit 0