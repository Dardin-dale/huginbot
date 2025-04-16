#!/bin/bash
# This script switches the active Valheim world based on SSM Parameter Store value

# Check if the server is running
if docker ps | grep -q valheim-server; then
  echo "Stopping Valheim server..."
  docker stop valheim-server
  docker rm valheim-server
fi

# Get active world from SSM Parameter Store
if ! aws ssm get-parameter --name "/huginbot/active-world" --region $(curl -s http://169.254.169.254/latest/meta-data/placement/region) 2>/dev/null; then
  echo "No active world parameter found, using default configuration"
  exit 0
fi

PARAM_VALUE=$(aws ssm get-parameter --name "/huginbot/active-world" --region $(curl -s http://169.254.169.254/latest/meta-data/placement/region) --query "Parameter.Value" --output text)
WORLD_NAME=$(echo $PARAM_VALUE | jq -r '.worldName')
SERVER_NAME=$(echo $PARAM_VALUE | jq -r '.name')
SERVER_PASSWORD=$(echo $PARAM_VALUE | jq -r '.serverPassword')

echo "Switching to world: $SERVER_NAME ($WORLD_NAME)"

# Back up the current world
/usr/local/bin/backup-valheim.sh

# Start the server with the new configuration
docker run -d --name valheim-server \
  -p 2456-2458:2456-2458/udp \
  -p 2456-2458:2456-2458/tcp \
  -p 80:80 \
  -v /mnt/valheim-data/config:/config \
  -v /mnt/valheim-data/backups:/config/backups \
  -v /mnt/valheim-data/mods:/bepinex/plugins \
  -e SERVER_NAME="$SERVER_NAME" \
  -e WORLD_NAME="$WORLD_NAME" \
  -e SERVER_PASS="$SERVER_PASSWORD" \
  -e TZ="America/Los_Angeles" \
  -e BACKUPS_DIRECTORY="/config/backups" \
  -e BACKUPS_INTERVAL="3600" \
  -e BACKUPS_MAX_AGE="3" \
  -e BACKUPS_DIRECTORY_PERMISSIONS="755" \
  -e BACKUPS_FILE_PERMISSIONS="644" \
  -e CONFIG_DIRECTORY_PERMISSIONS="755" \
  -e WORLDS_DIRECTORY_PERMISSIONS="755" \
  -e WORLDS_FILE_PERMISSIONS="644" \
  -e SERVER_PUBLIC="true" \
  -e UPDATE_INTERVAL="900" \
  -e STEAMCMD_ARGS="validate" \
  -e BEPINEX="true" \
  -e SERVER_ARGS="-crossplay -bepinex" \
  --restart unless-stopped \
  lloesche/valheim-server

echo "World switched successfully"