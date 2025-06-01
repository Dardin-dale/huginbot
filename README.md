# HuginBot

A cost-effective AWS-based Valheim server manager with Discord integration. Start, stop, and manage your Valheim server directly from Discord while only paying for the time you play.

## 🎮 Key Features

- **Discord Bot Integration** - Control your server with slash commands
- **Auto-Shutdown** - Server stops after 10 minutes of inactivity to save costs
- **Multiple Worlds** - Run different worlds for different Discord servers
- **Automated Backups** - Scheduled backups to S3 with configurable retention
- **Interactive CLI** - Easy setup wizard and management interface
- **Secure Webhook Storage** - Discord webhooks encrypted in AWS Secrets Manager
- **Cost-Effective** - Pay only when playing (~$0.05/hour for t3.medium)

## 🚀 Quick Start

### Prerequisites

- AWS Account with administrative access
- Node.js 16+ and npm
- Discord server where you have admin permissions
- Basic familiarity with command line

### 1. Clone and Install

```bash
git clone https://github.com/yourusername/huginbot.git
cd huginbot
npm install
```

### 2. Run Setup Wizard

```bash
npm run cli
```

Select **"📋 Get Started (New User Guide)"** and follow the interactive wizard. It will help you:
- Configure AWS credentials
- Set up your Valheim server
- Create your first world
- Configure Discord integration

### 3. Deploy to AWS

```bash
npm run deploy:all
```

This will create all necessary AWS resources (takes ~10-15 minutes).

### 4. Complete Discord Setup

**If you configured Discord during the setup wizard:**
1. After deployment completes, note the API Gateway URL from the output
2. Go to [Discord Developer Portal](https://discord.com/developers/applications) 
3. Select your application → "General Information" → "Interactions Endpoint URL"
4. Paste your API Gateway URL and save

**If you skipped Discord setup:**
1. Run the setup wizard again: `npm run cli` → "Get Started"
2. Choose to update Discord configuration
3. Follow the prompts to register slash commands

### 5. Add Bot to Your Server

The setup wizard provides a direct OAuth2 URL, or manually:
1. In Discord Developer Portal, go to OAuth2 → URL Generator
2. Select scopes: `bot` and `applications.commands`
3. Select permissions: `Send Messages`, `Use Slash Commands`, `Manage Webhooks`
4. Use the generated URL to add the bot to your server

### 6. Initialize in Discord

In your Discord server:
```
/setup
```

This creates a webhook for server notifications in the current channel. The webhook URL is automatically encrypted and stored in AWS Secrets Manager.

## 📝 Configuration

### Environment Variables

Your `.env` file will be created by the setup wizard. Here's what it contains:

```bash
# AWS Configuration
AWS_REGION=us-west-2
AWS_PROFILE=default

# Discord Bot Configuration
DISCORD_APP_ID=your_app_id
DISCORD_BOT_PUBLIC_KEY=your_public_key
DISCORD_BOT_SECRET_TOKEN=your_bot_token

# World Configuration (managed by CLI)
WORLD_COUNT=1
WORLD_1_NAME=MainWorld
WORLD_1_WORLD_NAME=Midgard
WORLD_1_PASSWORD=your_password
WORLD_1_DISCORD_ID=your_discord_server_id

# Server Configuration
VALHEIM_SERVER_NAME=My Valheim Server
VALHEIM_ADMIN_IDS=steam_id_1 steam_id_2
VALHEIM_INSTANCE_TYPE=t3.medium
BACKUPS_TO_KEEP=7
```

### Adding More Worlds

Use the CLI to add worlds:

```bash
npm run cli
```

Select **"🌍 World Management"** → **"Add World"**

Each world can be linked to a different Discord server.

## 🤖 Discord Commands

| Command | Description |
|---------|-------------|
| `/setup` | Initialize HuginBot in current channel |
| `/start [world]` | Start server with optional world |
| `/stop` | Stop the server |
| `/status check` | Check server status |
| `/status dashboard` | Create live status panel |
| `/controls` | Show interactive control panel |
| `/worlds list` | List available worlds |
| `/worlds switch` | Switch to different world |
| `/backup list` | Show recent backups |
| `/backup create` | Create manual backup |
| `/help` | Show command help |

## 🖥️ CLI Management

Launch the interactive CLI:

```bash
npm run cli
```

### Main Menu Options

- **📋 Get Started** - First-time setup wizard
- **🖥️ Server Management** - Start/stop server, check status
- **🌍 World Management** - Add, edit, switch worlds
- **💾 Backup Management** - View, download, restore backups
- **🤖 Discord Integration** - Configure Discord settings
- **🧪 Local Testing** - Test server locally
- **⚙️ Advanced Settings** - AWS configuration, cleanup tools

## 💰 Cost Breakdown

- **EC2 Instance**: ~$0.05/hour when running (t3.medium)
- **Lambda/API Gateway**: Usually free tier
- **S3 Storage**: ~$0.02/GB/month for backups
- **AWS Secrets Manager**: ~$0.40/month per Discord webhook
- **Total**: ~$5-20/month depending on play time

The auto-shutdown feature ensures you only pay while playing!

## 🔧 Troubleshooting

### Discord Commands Not Working

1. Verify the API Gateway URL is correctly set in Discord Developer Portal
2. Check CloudWatch Logs: `ValheimDiscordBot-ApiLambda`
3. Ensure bot has proper permissions in your Discord server

### Server Won't Start

1. Check your AWS service limits
2. Verify world is configured for your Discord server:
   ```bash
   npm run cli → "World Management" → "List Worlds"
   ```
3. Check CloudWatch Logs: `ValheimDiscordBot-CommandsLambda`

### No Join Code in Discord

- The server takes 5-10 minutes to fully start
- Check if PlayFab is properly initialized
- Ensure Discord webhook is set up with `/setup`

### World Not Found

Each Discord server needs a world configured:
```bash
npm run cli → "World Management" → "Add World"
```
Enter your Discord server ID when prompted.

### Discord Notifications Not Working

1. Run `/setup` again in your Discord channel
2. Check AWS Secrets Manager for webhook secret
3. Verify the channel allows webhook posts
4. Check CloudWatch Logs for webhook errors

## 🏗️ Architecture

```
Discord → API Gateway → Lambda → EC2/Docker
                      ↓
                    Secrets Manager (Webhooks)
                    SSM Parameters (Config)
                      ↓
                    S3 Backups
```

- **EC2**: Runs Valheim in Docker container
- **Lambda**: Handles Discord commands and server control
- **S3**: Stores world backups
- **SSM**: Stores configuration and state
- **Secrets Manager**: Securely stores Discord webhook URLs
- **CloudWatch**: Monitors player activity for auto-shutdown

### Security Features

- Discord webhook URLs are encrypted at rest in AWS Secrets Manager
- Discord requests verified using official Ed25519 signature verification
- Automatic rotation support for webhook URLs
- No manual secret creation required - fully automated
- Webhook URLs can be updated anytime via `/setup` command

## 🛠️ Development

### Build and Test

```bash
npm run build          # Compile TypeScript
npm run test           # Run tests
npm run watch          # Watch mode
```

### Local Testing

```bash
npm run cli → "Local Testing" → "Start Local Test Server"
```

### Deployment Commands

```bash
npm run deploy:all     # Deploy everything
npm run deploy:valheim # Deploy server stack only
npm run deploy:discord # Deploy Discord stack only
npm run destroy:all    # Remove all resources
```

## 📋 Roadmap

- [x] Basic server management
- [x] Discord integration
- [x] Multi-world support
- [x] Automated backups
- [x] Interactive CLI
- [x] Secure webhook storage
- [ ] World-specific configurations
- [ ] Mod management interface
- [ ] Player statistics tracking
- [ ] Web dashboard

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT License - see LICENSE file for details

---

**Need help?** Check the [CloudWatch Logs](https://console.aws.amazon.com/cloudwatch/home#logs:) or create an issue on GitHub.
