#!/bin/bash
set -e # Exit immediately if a command exits with a non-zero status

# This script starts the Valheim server based on SSM Parameter Store configuration
# Used for normal server starts - does NOT create backups (use switch-valheim-world.sh for world switches)

echo "$(date '+%Y-%m-%d %H:%M:%S') - Starting Valheim server"

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

# Check if the server is already running
if docker ps | grep -q valheim-server; then
  echo "Valheim server is already running"
  docker ps | grep valheim-server
  exit 0
fi

# Clean up any stopped containers
if docker ps -a | grep -q valheim-server; then
  echo "Removing stopped valheim-server container..."
  docker rm valheim-server || true
fi

# Get active world from SSM Parameter Store with error handling
echo "Retrieving world configuration from SSM Parameter Store..."
SSM_CMD="aws ssm get-parameter --name /huginbot/active-world --region $REGION"

if ! PARAM_RESULT=$($SSM_CMD 2>&1); then
  if [[ "$PARAM_RESULT" == *"ParameterNotFound"* ]]; then
    echo "NOTICE: No active world parameter found, using default configuration"
    # Set default values
    WORLD_NAME="HuginDefault"
    SERVER_NAME="HuginBot Default World"
    SERVER_PASSWORD="huginbot"
    OVERRIDES_JSON="{}"
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
  ADMIN_IDS=$(echo "$PARAM_VALUE" | jq -r '.adminIds // empty')

  # Extract overrides if present
  if echo "$PARAM_VALUE" | jq -e '.overrides' > /dev/null 2>&1; then
    echo "World-specific overrides found, will apply custom settings"
    OVERRIDES_JSON=$(echo "$PARAM_VALUE" | jq -c '.overrides')
  else
    echo "No world-specific overrides found, using default settings"
    OVERRIDES_JSON="{}"
  fi

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

echo "Starting world: $SERVER_NAME ($WORLD_NAME)"

# Extract override values with defaults
SERVER_ARGS=$(echo "$OVERRIDES_JSON" | jq -r '.SERVER_ARGS // "-crossplay"')
BEPINEX=$(echo "$OVERRIDES_JSON" | jq -r '.BEPINEX // "true"')
SERVER_PUBLIC=$(echo "$OVERRIDES_JSON" | jq -r '.SERVER_PUBLIC // "true"')
UPDATE_INTERVAL=$(echo "$OVERRIDES_JSON" | jq -r '.UPDATE_INTERVAL // "900"')

# Handle null values from jq
[ "$SERVER_ARGS" = "null" ] && SERVER_ARGS="-crossplay"
[ "$BEPINEX" = "null" ] && BEPINEX="true"
[ "$SERVER_PUBLIC" = "null" ] && SERVER_PUBLIC="true"
[ "$UPDATE_INTERVAL" = "null" ] && UPDATE_INTERVAL="900"

# Verify data directories exist
for dir in "/mnt/valheim-data/config" "/mnt/valheim-data/backups" "/mnt/valheim-data/mods" "/mnt/valheim-data/opt-valheim" "/mnt/valheim-data/config/worlds_local"; do
  if [ ! -d "$dir" ]; then
    echo "Creating required directory: $dir"
    mkdir -p "$dir"
    chmod 755 "$dir"
  fi
done

# Restore world from S3 backup if needed (only if world files don't exist)
echo "Checking if world needs to be restored from backup..."
if [ -x /usr/local/bin/restore-world.sh ]; then
  if ! /usr/local/bin/restore-world.sh "$WORLD_NAME"; then
    echo "WARNING: World restore failed, server will create new world if files don't exist"
  fi
else
  echo "Restore script not found, skipping world restore"
fi

# ============================================
# Per-World Mod Management
# ============================================
BEPINEX_PLUGINS_DIR="/mnt/valheim-data/config/bepinex/plugins"

# Ensure BepInEx directory structure exists
mkdir -p "$BEPINEX_PLUGINS_DIR"
mkdir -p /mnt/valheim-data/config/bepinex/patchers

# Clear existing plugins for fresh world-specific mods
echo "Clearing BepInEx plugins directory..."
rm -rf "$BEPINEX_PLUGINS_DIR"/*

# If BepInEx is disabled, we're done with mods section
if [ "$BEPINEX" != "true" ]; then
  echo "BepInEx disabled for this world, plugins directory cleared"
else
  # Get backup bucket name from SSM for mod downloads
  BACKUP_BUCKET_PARAM="/huginbot/backup-bucket-name"
  if BACKUP_BUCKET=$(aws ssm get-parameter --name "$BACKUP_BUCKET_PARAM" --region "$REGION" --query "Parameter.Value" --output text 2>/dev/null); then
    echo "Backup bucket: $BACKUP_BUCKET"

    # Extract MODS from overrides
    MODS_JSON=$(echo "$OVERRIDES_JSON" | jq -r '.MODS // "[]"')
    echo "World mods configuration: $MODS_JSON"

    # Download per-world mods if configured
    if [ "$MODS_JSON" != "[]" ] && [ "$MODS_JSON" != "null" ] && [ -n "$MODS_JSON" ]; then
      echo "Downloading per-world mods to BepInEx plugins directory..."

      # Parse mod names from JSON array and download each
      MOD_COUNT=0
      for MOD_NAME in $(echo "$MODS_JSON" | jq -r '.[]'); do
        echo "  Downloading mod: $MOD_NAME"

        # Download all plugin files for this mod from S3 directly to BepInEx plugins
        if aws s3 cp "s3://${BACKUP_BUCKET}/mods/${MOD_NAME}/plugins/" "$BEPINEX_PLUGINS_DIR/" --recursive 2>/dev/null; then
          echo "    Downloaded: $MOD_NAME"
          MOD_COUNT=$((MOD_COUNT + 1))
        else
          echo "    WARNING: Mod $MOD_NAME not found in library"
        fi
      done

      echo "Downloaded $MOD_COUNT mod(s) for this world"
    else
      echo "No per-world mods configured for this world"
    fi
  else
    echo "WARNING: Could not get backup bucket name, skipping mod configuration"
  fi
fi

# Set correct permissions on BepInEx directory
chmod -R 755 /mnt/valheim-data/config/bepinex/
chown -R 1000:1000 /mnt/valheim-data/config/bepinex/ 2>/dev/null || true

# Get webhook URL for notifications (if available)
DISCORD_SERVER_ID=$(echo "$PARAM_VALUE" | jq -r '.discordServerId' 2>/dev/null || echo "")
WEBHOOK_PARAM_NAME="/huginbot/discord-webhook/$DISCORD_SERVER_ID"

if [ -n "$DISCORD_SERVER_ID" ] && [ "$DISCORD_SERVER_ID" != "null" ]; then
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
ADMIN_IDS: $ADMIN_IDS
DISCORD_SERVER_ID: $DISCORD_SERVER_ID
WEBHOOK_CONFIGURED: $([ -n "$WEBHOOK_ENV" ] && echo "Yes" || echo "No")

# Server Overrides
SERVER_ARGS: $SERVER_ARGS
BEPINEX: $BEPINEX
SERVER_PUBLIC: $SERVER_PUBLIC
UPDATE_INTERVAL: $UPDATE_INTERVAL
EOF

# Add additional overrides to the config file if they exist
if [ "$OVERRIDES_JSON" != "{}" ]; then
  echo -e "\n# Additional Overrides" >> "/mnt/valheim-data/config/server_config.txt"
  OVERRIDE_KEYS=$(echo "$OVERRIDES_JSON" | jq -r 'keys[]')

  for KEY in $OVERRIDE_KEYS; do
    if [[ "$KEY" != "SERVER_ARGS" && "$KEY" != "BEPINEX" && "$KEY" != "SERVER_PUBLIC" && "$KEY" != "UPDATE_INTERVAL" && "$KEY" != "MODS" && "$KEY" != "MODIFIERS" ]]; then
      VALUE=$(echo "$OVERRIDES_JSON" | jq -r ".[\"$KEY\"]")
      echo "$KEY: $VALUE" >> "/mnt/valheim-data/config/server_config.txt"
    fi
  done
fi

echo "Starting Valheim server with world: $WORLD_NAME"
echo "Using server arguments: $SERVER_ARGS"
echo "BepInEx enabled: $BEPINEX"
echo "Server public: $SERVER_PUBLIC"
echo "Update interval: $UPDATE_INTERVAL"
echo "Admin IDs: ${ADMIN_IDS:-None configured}"

# Build environment variable for admin IDs if configured
ADMIN_ENV=""
if [ -n "$ADMIN_IDS" ] && [ "$ADMIN_IDS" != "null" ]; then
  echo "Configuring admin list with IDs: $ADMIN_IDS"
  ADMIN_ENV="-e ADMINLIST_IDS=\"$ADMIN_IDS\""
fi

# Build environment variables for all overrides from the JSON
OVERRIDE_ENV=""
if [ "$OVERRIDES_JSON" != "{}" ]; then
  echo "Applying world-specific overrides:"
  # Extract all keys from the overrides JSON
  OVERRIDE_KEYS=$(echo "$OVERRIDES_JSON" | jq -r 'keys[]')

  # Process each override key
  for KEY in $OVERRIDE_KEYS; do
    # Skip the ones we've already handled
    if [[ "$KEY" != "SERVER_ARGS" && "$KEY" != "BEPINEX" && "$KEY" != "SERVER_PUBLIC" && "$KEY" != "UPDATE_INTERVAL" && "$KEY" != "MODS" && "$KEY" != "MODIFIERS" ]]; then
      VALUE=$(echo "$OVERRIDES_JSON" | jq -r ".[\"$KEY\"]")
      echo "  - Setting $KEY=$VALUE"
      OVERRIDE_ENV="$OVERRIDE_ENV -e $KEY=\"$VALUE\" "
    fi
  done
fi

# Start the server with the configuration
SERVER_CMD="docker run -d --name valheim-server \
  -p 2456-2458:2456-2458/udp \
  -p 2456-2458:2456-2458/tcp \
  -p 80:80 \
  --cap-add=sys_nice \
  -v /mnt/valheim-data/config:/config \
  -v /mnt/valheim-data/backups:/config/backups \
  -v /mnt/valheim-data/opt-valheim:/opt/valheim \
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
  -e SERVER_PUBLIC=\"$SERVER_PUBLIC\" \
  -e UPDATE_INTERVAL=\"$UPDATE_INTERVAL\" \
  -e STEAMCMD_ARGS=\"validate\" \
  -e BEPINEX=\"$BEPINEX\" \
  -e SERVER_ARGS=\"$SERVER_ARGS\" \
  $WEBHOOK_ENV \
  $ADMIN_ENV \
  $OVERRIDE_ENV \
  --restart unless-stopped \
  ghcr.io/community-valheim-tools/valheim-server"

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
echo "$(date '+%Y-%m-%d %H:%M:%S') - Valheim server started successfully with world: $WORLD_NAME"
exit 0
