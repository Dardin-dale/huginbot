#!/bin/bash
set -e

# Get EC2 instance ID from CloudFormation stack
EC2_INSTANCE_ID=$(aws cloudformation describe-stacks --stack-name HuginbotStack --query "Stacks[0].Outputs[?OutputKey=='DiscordBotInstanceId'].OutputValue" --output text)

if [ -z "$EC2_INSTANCE_ID" ]; then
  echo "Error: Could not retrieve EC2 instance ID. Make sure the HuginbotStack has been deployed."
  exit 1
fi

echo "Found EC2 instance: $EC2_INSTANCE_ID"

# Check if instance is running
echo "Checking instance status..."
INSTANCE_STATE=$(aws ec2 describe-instances --instance-ids $EC2_INSTANCE_ID --query "Reservations[0].Instances[0].State.Name" --output text)

if [ "$INSTANCE_STATE" != "running" ]; then
  echo "Instance is not running (current state: $INSTANCE_STATE)."
  echo "Starting EC2 instance..."
  aws ec2 start-instances --instance-ids $EC2_INSTANCE_ID
  
  echo "Waiting for instance to be ready..."
  aws ec2 wait instance-running --instance-ids $EC2_INSTANCE_ID
  
  # Additional wait for services to start
  echo "Waiting for SSH to be available..."
  sleep 30
fi

echo "=== Building TypeScript components ==="
npm run build

echo "=== Deploying Discord bot to EC2 instance $EC2_INSTANCE_ID ==="

# Use SSM to upload the compiled files
echo "Copying bot.js..."
aws ssm send-command \
  --instance-ids $EC2_INSTANCE_ID \
  --document-name "AWS-RunShellScript" \
  --parameters "commands=[
    'mkdir -p /opt/huginbot/dist/lib/discord',
    'cat > /opt/huginbot/dist/lib/discord/bot.js << \"EOF\"
$(cat dist/lib/discord/bot.js)
EOF',
    'chown ec2-user:ec2-user /opt/huginbot/dist/lib/discord/bot.js'
  ]"

# Copy register-commands.js
echo "Copying register-commands.js..."
aws ssm send-command \
  --instance-ids $EC2_INSTANCE_ID \
  --document-name "AWS-RunShellScript" \
  --parameters "commands=[
    'cat > /opt/huginbot/dist/lib/discord/register-commands.js << \"EOF\"
$(cat dist/lib/discord/register-commands.js)
EOF',
    'chown ec2-user:ec2-user /opt/huginbot/dist/lib/discord/register-commands.js'
  ]"

# Copy command files
for cmd in start stop status; do
  echo "Copying $cmd.js..."
  aws ssm send-command \
    --instance-ids $EC2_INSTANCE_ID \
    --document-name "AWS-RunShellScript" \
    --parameters "commands=[
      'mkdir -p /opt/huginbot/dist/lib/discord/commands',
      'cat > /opt/huginbot/dist/lib/discord/commands/$cmd.js << \"EOF\"
$(cat dist/lib/discord/commands/$cmd.js)
EOF',
      'chown ec2-user:ec2-user /opt/huginbot/dist/lib/discord/commands/$cmd.js'
    ]"
done

# Register commands and restart the service
echo "Registering commands and restarting service..."
aws ssm send-command \
  --instance-ids $EC2_INSTANCE_ID \
  --document-name "AWS-RunShellScript" \
  --parameters "commands=[
    'cd /opt/huginbot',
    'node dist/lib/discord/register-commands.js',
    'systemctl restart discord-bot',
    'systemctl status discord-bot'
  ]"

echo "=== Deployment completed ==="
