#!/bin/bash
# Apply UserData fixes to running instance without replacement
# This script manually applies the configuration that would normally come from UserData

set -e

echo "=== Applying UserData Fixes to Running Instance ==="
echo ""

# Get S3 bucket name from CloudFormation
BUCKET_NAME=$(aws cloudformation describe-stacks \
  --stack-name ValheimStack \
  --query 'Stacks[0].Outputs[?OutputKey==`BackupBucketName`].OutputValue' \
  --output text)

echo "Using S3 bucket: $BUCKET_NAME"
echo ""

# 1. Create the Valheim server startup script
echo "[1/6] Creating /usr/local/bin/start-valheim-server.sh..."
cat > /tmp/start-valheim-server.sh << 'EOF'
#!/bin/bash
# Start Valheim server Docker container with configuration from SSM

REGION=$(curl -s http://169.254.169.254/latest/meta-data/placement/region)

# Get active world configuration from SSM
ACTIVE_WORLD_JSON=$(aws ssm get-parameter --name "/huginbot/active-world" --region "$REGION" --query 'Parameter.Value' --output text 2>/dev/null)

if [ -z "$ACTIVE_WORLD_JSON" ]; then
  echo "No active world configuration found, using defaults"
  WORLD_NAME="GjurdTest"
  SERVER_NAME="Valheim Server"
  SERVER_PASS="changeme"
else
  echo "Loading active world configuration from SSM"
  WORLD_NAME=$(echo "$ACTIVE_WORLD_JSON" | python3 -c "import sys, json; print(json.load(sys.stdin)['worldName'])")
  SERVER_NAME=$(echo "$ACTIVE_WORLD_JSON" | python3 -c "import sys, json; print(json.load(sys.stdin).get('serverName', 'Valheim Server'))")
  SERVER_PASS=$(echo "$ACTIVE_WORLD_JSON" | python3 -c "import sys, json; print(json.load(sys.stdin)['serverPassword'])")
fi

echo "Starting Valheim server with world: $WORLD_NAME"

# Stop and remove existing container if it exists
docker stop valheim-server 2>/dev/null || true
docker rm valheim-server 2>/dev/null || true

# Start new container
docker run -d --name valheim-server \
  -p 2456-2458:2456-2458/udp \
  -p 2456-2458:2456-2458/tcp \
  -p 80:80 \
  -v /mnt/valheim-data/config:/config \
  -v /mnt/valheim-data/backups:/config/backups \
  -v /mnt/valheim-data/mods:/bepinex/plugins \
  -v /mnt/valheim-data/server:/opt/valheim \
  -e SERVER_NAME="$SERVER_NAME" \
  -e WORLD_NAME="$WORLD_NAME" \
  -e SERVER_PASS="$SERVER_PASS" \
  -e TZ="America/Los_Angeles" \
  -e BACKUPS="true" \
  -e BACKUPS_DIRECTORY="/config/backups" \
  -e BACKUPS_CRON="0 */6 * * *" \
  -e BACKUPS_IF_IDLE="true" \
  -e BACKUPS_IDLE_GRACE_PERIOD="3600" \
  -e BACKUPS_MAX_COUNT="10" \
  -e BACKUPS_MAX_AGE="7" \
  -e BACKUPS_ZIP="true" \
  -e SERVER_PUBLIC="true" \
  -e UPDATE_INTERVAL="900" \
  -e STEAMCMD_ARGS="validate" \
  -e SERVER_ARGS="-crossplay" \
  --restart unless-stopped \
  --stop-timeout 120 \
  ghcr.io/community-valheim-tools/valheim-server

echo "Valheim server container started successfully"
EOF

sudo mv /tmp/start-valheim-server.sh /usr/local/bin/start-valheim-server.sh
sudo chmod +x /usr/local/bin/start-valheim-server.sh
echo "✓ Created start-valheim-server.sh"
echo ""

# 2. Create the systemd service
echo "[2/6] Creating /etc/systemd/system/valheim-server.service..."
cat > /tmp/valheim-server.service << 'EOF'
[Unit]
Description=Valheim Server Docker Container
After=docker.service update-valheim-scripts.service
Requires=docker.service
Before=playfab-monitor.service player-monitor.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/bin/start-valheim-server.sh
ExecStop=/usr/bin/docker stop valheim-server
ExecStopPost=/usr/bin/docker rm valheim-server
Restart=on-failure
RestartSec=10s

[Install]
WantedBy=multi-user.target
EOF

sudo mv /tmp/valheim-server.service /etc/systemd/system/valheim-server.service
echo "✓ Created valheim-server.service"
echo ""

# 3. Reload systemd and enable service (but don't start yet - container is already running)
echo "[3/6] Enabling valheim-server.service..."
sudo systemctl daemon-reload
sudo systemctl enable valheim-server.service
echo "✓ Service enabled (will auto-start on boot)"
echo ""

# 4. Update monitoring scripts from S3
echo "[4/6] Updating monitoring scripts from S3..."
aws s3 cp s3://$BUCKET_NAME/scripts/valheim/monitor-playfab.sh /tmp/monitor-playfab.sh
aws s3 cp s3://$BUCKET_NAME/scripts/valheim/monitor-players.sh /tmp/monitor-players.sh

sudo mv /tmp/monitor-playfab.sh /usr/local/bin/monitor-playfab.sh
sudo mv /tmp/monitor-players.sh /usr/local/bin/monitor-players.sh
sudo chmod +x /usr/local/bin/monitor-playfab.sh
sudo chmod +x /usr/local/bin/monitor-players.sh
echo "✓ Updated monitoring scripts"
echo ""

# 5. Remove problematic cron jobs (if they exist)
echo "[5/6] Removing problematic cron jobs..."
crontab -l > /tmp/current_cron 2>/dev/null || echo "" > /tmp/current_cron
if grep -q "switch-valheim-world" /tmp/current_cron; then
  grep -v "switch-valheim-world" /tmp/current_cron | crontab -
  echo "✓ Removed switch-valheim-world cron job"
else
  echo "✓ No problematic cron jobs found"
fi
echo ""

# 6. Restart monitoring services to pick up new scripts
echo "[6/6] Restarting monitoring services..."
sudo systemctl restart playfab-monitor.service
sudo systemctl restart player-monitor.service
echo "✓ Monitoring services restarted"
echo ""

echo "=== All Fixes Applied Successfully! ==="
echo ""
echo "Summary:"
echo "  ✓ Created start-valheim-server.sh"
echo "  ✓ Created valheim-server.service (auto-starts on boot)"
echo "  ✓ Updated monitoring scripts from S3"
echo "  ✓ Removed problematic cron jobs"
echo "  ✓ Restarted monitoring services"
echo ""
echo "Your instance is now fully configured!"
echo "Docker container will auto-start on next boot."
echo ""
echo "Verification:"
echo "  sudo systemctl status valheim-server.service"
echo "  sudo systemctl status playfab-monitor.service"
echo "  docker ps"
