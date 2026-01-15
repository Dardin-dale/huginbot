#!/bin/bash
# Apply UserData fixes to running instance - simplified version
set -e

echo "=== Applying UserData Fixes ==="

# 1. Create startup script
cat > /usr/local/bin/start-valheim-server.sh << 'EOFSCRIPT'
#!/bin/bash
REGION=$(curl -s http://169.254.169.254/latest/meta-data/placement/region)
ACTIVE_WORLD_JSON=$(aws ssm get-parameter --name "/huginbot/active-world" --region "$REGION" --query 'Parameter.Value' --output text 2>/dev/null)
if [ -z "$ACTIVE_WORLD_JSON" ]; then
  WORLD_NAME="GjurdTest"
  SERVER_NAME="Valheim Server"
  SERVER_PASS="changeme"
else
  WORLD_NAME=$(echo "$ACTIVE_WORLD_JSON" | python3 -c "import sys, json; print(json.load(sys.stdin)['worldName'])")
  SERVER_NAME=$(echo "$ACTIVE_WORLD_JSON" | python3 -c "import sys, json; print(json.load(sys.stdin).get('serverName', 'Valheim Server'))")
  SERVER_PASS=$(echo "$ACTIVE_WORLD_JSON" | python3 -c "import sys, json; print(json.load(sys.stdin)['serverPassword'])")
fi
# Restore world from S3 if needed
if [ -x /usr/local/bin/restore-world.sh ]; then
  /usr/local/bin/restore-world.sh "$WORLD_NAME" || echo "World restore skipped or failed"
fi
docker stop valheim-server 2>/dev/null || true
docker rm valheim-server 2>/dev/null || true
docker run -d --name valheim-server \
  -p 2456-2458:2456-2458/udp -p 2456-2458:2456-2458/tcp -p 80:80 \
  -v /mnt/valheim-data/config:/config -v /mnt/valheim-data/backups:/config/backups \
  -v /mnt/valheim-data/mods:/bepinex/plugins \
  -v /mnt/valheim-data/server:/opt/valheim \
  -e SERVER_NAME="$SERVER_NAME" -e WORLD_NAME="$WORLD_NAME" -e SERVER_PASS="$SERVER_PASS" \
  -e TZ="America/Los_Angeles" -e BACKUPS="true" -e SERVER_PUBLIC="true" -e SERVER_ARGS="-crossplay" \
  --restart unless-stopped ghcr.io/community-valheim-tools/valheim-server
EOFSCRIPT

chmod +x /usr/local/bin/start-valheim-server.sh
echo "✓ Created start-valheim-server.sh"

# 2. Create systemd service
# Note: Type=oneshot cannot have Restart= - Docker's --restart handles container restarts
cat > /etc/systemd/system/valheim-server.service << 'EOFSERVICE'
[Unit]
Description=Valheim Server Docker Container
After=docker.service
Requires=docker.service
Before=playfab-monitor.service player-monitor.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/bin/start-valheim-server.sh
ExecStop=/usr/bin/docker stop valheim-server
ExecStopPost=/usr/bin/docker rm valheim-server

[Install]
WantedBy=multi-user.target
EOFSERVICE

systemctl daemon-reload
systemctl enable valheim-server.service
echo "✓ Created and enabled valheim-server.service"

# 3. Verify
echo ""
echo "=== Verification ==="
systemctl status valheim-server.service --no-pager || true
echo ""
echo "✓ All fixes applied successfully!"
echo "Docker container will auto-start on next boot"
