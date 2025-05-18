#!/bin/bash

# Install Node.js
curl -sL https://rpm.nodesource.com/setup_16.x | bash -
yum install -y nodejs git

# Create directory for bot
mkdir -p /opt/huginbot

# Create necessary subdirectories
mkdir -p /opt/huginbot/dist/lib/discord/commands

# Set up environment file
cat > /opt/huginbot/.env << EOL
DISCORD_APP_ID=${DISCORD_APP_ID}
DISCORD_BOT_PUBLIC_KEY=${DISCORD_BOT_PUBLIC_KEY}
DISCORD_BOT_SECRET_TOKEN=${DISCORD_BOT_SECRET_TOKEN}
DISCORD_AUTH_TOKEN=${DISCORD_AUTH_TOKEN}
COMMANDS_LAMBDA_NAME=${COMMANDS_LAMBDA_NAME}
AWS_REGION=$(curl -s http://169.254.169.254/latest/meta-data/placement/region)
EOL

# Create package.json
cat > /opt/huginbot/package.json << EOL
{
  "name": "huginbot-discord",
  "version": "1.0.0",
  "description": "Discord bot for Valheim server",
  "main": "dist/lib/discord/bot.js",
  "scripts": {
    "start": "node dist/lib/discord/bot.js",
    "register": "node dist/lib/discord/register-commands.js"
  },
  "dependencies": {
    "@discordjs/builders": "^1.6.3",
    "@discordjs/rest": "^1.7.1",
    "aws-sdk": "^2.1415.0",
    "discord-api-types": "^0.37.47",
    "discord.js": "^14.11.0",
    "dotenv": "^16.3.1"
  }
}
EOL

# Install dependencies
cd /opt/huginbot
npm install

# Create systemd service file
cat > /etc/systemd/system/discord-bot.service << EOL
[Unit]
Description=HuginBot Discord Service
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/huginbot/dist/lib/discord/bot.js
Restart=always
User=ec2-user
Environment=NODE_ENV=production
EnvironmentFile=/opt/huginbot/.env
WorkingDirectory=/opt/huginbot

[Install]
WantedBy=multi-user.target
EOL

# Set correct permissions
chown -R ec2-user:ec2-user /opt/huginbot

# Enable service
systemctl daemon-reload
systemctl enable discord-bot

echo "Environment setup complete. Deploy bot code separately using SSM."
