# HuginBot

HuginBot is an AWS CDK project that provisions and manages a Valheim game server using the llosche Docker container. It features a CLI interface for world management and a Discord bot that enables players to start/stop the server and manage their worlds directly from Discord.

## Features

- **EC2-based Valheim Server**: Cost-effective hosting with on-demand scaling
- **Discord Integration**: Control your server directly from Discord
- **Multiple World Support**: Run different worlds for different Discord servers
- **Automated Backups**: Scheduled backups to S3 with configurable retention
- **World Management**: Easy CLI for adding/editing worlds and configurations
- **Secure Authentication**: Discord verification for server control
- **BepInEx Mod Support**: Load custom mods for your Valheim worlds

## Setup Requirements

1. AWS Account with appropriate permissions:
   - Administrative access for initial setup
   - IAM permissions for creating roles and policies
   - EC2, S3, Lambda, API Gateway, CloudWatch, SSM, and EventBridge permissions
   - AWS CLI installed and configured with valid credentials

2. Node.js 16+ and npm installed
   - TypeScript knowledge for customization
   - AWS CDK familiarity recommended

3. Discord bot application configured with:
   - Bot token
   - Application ID
   - Public key
   - A Discord server where you have admin permissions

4. Network requirements:
   - AWS security groups are automatically configured by the stack
   - No special network configuration needed on your local computer
   - For local testing only: UDP/TCP ports 2456-2458 if testing with Docker

5. Valheim details:
   - Steam IDs for admin configuration (find yours at [SteamID Finder](https://steamidfinder.com/))
   - Basic understanding of Valheim gameplay

## Installation

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/huginbot.git
   cd huginbot
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Configure environment variables:
   ```
   cp .env.template .env
   ```
   Edit `.env` with your AWS and Discord configuration. The template includes:
   ```
   # AWS Configuration
   AWS_REGION=us-west-2
   AWS_PROFILE=default
   
   # Valheim Server Configuration
   VALHEIM_WORLD_NAME=YourWorldName
   VALHEIM_SERVER_PASSWORD=your_secure_password
   VALHEIM_ADMIN_IDS=76561198012345678 76561198023456789
   
   # Discord Integration
   DISCORD_APP_ID=your_discord_client_id_here
   DISCORD_BOT_PUBLIC_KEY=your_discord_bot_public_key_here
   DISCORD_BOT_SECRET_TOKEN=your_discord_bot_token_here
   DISCORD_AUTH_TOKEN=your_custom_auth_token_here
   
   # Multi-world Configuration (JSON format)
   WORLD_CONFIGURATIONS=[{"name":"World1","discordServerId":"123456789012345678","worldName":"World1Save","serverPassword":"password1"},{"name":"World2","discordServerId":"234567890123456789","worldName":"World2Save","serverPassword":"password2"}]
   
   # Backup Configuration
   BACKUP_FREQUENCY_HOURS=24
   BACKUPS_TO_KEEP=7
   ```

4. Build the project:
   ```
   npm run build
   ```

## Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application or use an existing one
3. Under "Bot" section, create a bot and copy the token
4. Copy your Application ID from the "General Information" tab
5. Copy your Public Key from the "General Information" tab
6. Create a custom authentication token for your bot (can be any secure random string)
7. Add the following to your `.env` file:
   ```
   DISCORD_APP_ID=your_discord_client_id_here
   DISCORD_BOT_PUBLIC_KEY=your_discord_bot_public_key_here
   DISCORD_BOT_SECRET_TOKEN=your_discord_bot_token_here
   DISCORD_AUTH_TOKEN=your_custom_auth_token_here
   ```

8. Add the bot to your Discord server with the following permissions:
   - Send Messages
   - Read Message History
   - Use Slash Commands

9. After deploying your stack with `npm run deploy:all`, you'll receive the API Gateway endpoint in the terminal output. Copy this URL.

10. Go back to the Discord Developer Portal and navigate to your application:
    - Go to "Interactions Endpoint URL" and paste your API Gateway URL followed by `/valheim/control`
    - Example: `https://abcdefghij.execute-api.us-west-2.amazonaws.com/prod/valheim/control`
    - Click "Save Changes" - Discord will validate your endpoint
    
11. Register slash commands for your bot:
    - Go to the "Bot" section in the Discord Developer Portal
    - Enable "Message Content Intent" if it's not already enabled
    - Save changes
    - Use a tool like [Discord Slash Commands Deployer](https://discord.com/developers/docs/interactions/application-commands) to register your commands or create a simple script
    - Basic commands to register: `/valheim start`, `/valheim stop`, `/valheim status`, `/valheim worlds`

## Deployment

1. Deploy the CDK stacks:
   ```
   npm run cdk deploy --all
   ```
   Or deploy individual stacks:
   ```
   npm run deploy:valheim    # Deploy just the Valheim server stack
   npm run deploy:discord    # Deploy just the Discord integration stack
   ```

2. The deployment will output API Gateway endpoints that you need to configure in your Discord application settings.

3. To undeploy all resources when finished:
   ```
   npm run cli
   ```
   Then select "Undeploy All Infrastructure" and follow the confirmation prompts.
   
   > ⚠️ **Warning**: Undeploying will permanently delete all AWS resources including EC2 instances and S3 buckets with your world backups. Make sure to download your backups first!

## Usage

### CLI Commands

* `npm run build`   - Compile TypeScript to JavaScript
* `npm run watch`   - Watch for changes and compile
* `npm run test`    - Run Jest unit tests
* `npm run cli`     - Launch the CLI interface
* `npm run cdk`     - Run CDK commands

### Local Testing

To test a Valheim server locally:

1. Launch the CLI:
   ```
   npm run cli
   ```

2. Select "Configure Local Testing" and follow the prompts
3. Select "Start Local Test Server" to run a mock server
4. Launch Valheim and connect to `127.0.0.1:2456`

The local test server simulates the AWS deployment and allows you to test server controls and Discord integration without deploying to AWS.

### Managing Worlds

1. Launch the CLI:
   ```
   npm run cli
   ```

2. Select "Manage Worlds" to:
   - Add new worlds
   - Configure Discord server associations
   - Edit world settings
   - Remove worlds

### Custom Worlds and Pre-existing Saves

You can set up custom worlds with pre-existing save data:

1. Place your world files in the `worlds/WORLD_NAME/` directory:
   ```
   worlds/MyWorld/
   ├── MyWorld.db
   ├── MyWorld.fwl
   └── ... (other world files)
   ```

2. During deployment, these files will be used to bootstrap your Valheim server

HuginBot will automatically recognize worlds in the `worlds/` directory and make them available for selection.

### Installing Mods

HuginBot supports BepInEx mods through the llosche Docker container:

1. Place your mod files in the `mods/` directory:
   ```
   mods/
   ├── SomeValheimMod.dll
   ├── AnotherMod/
   │   ├── AnotherMod.dll
   │   └── assets/
   └── ... (other mod files)
   ```

2. During deployment, these mods will be installed in the BepInEx plugins directory

The server automatically enables BepInEx for all installed mods.

### Discord Commands

Players can use the following commands in Discord:

- `/valheim start [world_name]` - Start the server with optional world name
- `/valheim stop` - Stop the server
- `/valheim status` - Check server status
- `/valheim worlds` - List available worlds

## Architecture

HuginBot uses a serverless architecture with:

- **CloudFormation/CDK**: Infrastructure as code
- **API Gateway**: HTTP endpoints for Discord interactions
- **Lambda Functions**: Server control and processing
- **EC2**: Game server hosting (more cost-effective than Fargate)
- **S3**: World backups and storage
- **SSM Parameter Store**: Configuration storage
- **CloudWatch**: Monitoring and logs
- **EventBridge**: Event-driven communication between components

### Cost Estimation

The project is designed to be cost-effective:

- **EC2 Instance**: Only runs when players are active (~$0.05-0.10/hour for t3.medium when running)
- **Serverless Components**: Minimal costs since they only run on-demand
  - Lambda: Free tier covers most usage
  - API Gateway: ~$1/month for typical usage
  - S3 Storage: ~$0.023 per GB/month for backups
  - CloudWatch: Basic monitoring included
- **Total Monthly Cost**: Around $5-20/month depending on usage

The EC2 instance automatically shuts down after 10 minutes of inactivity to minimize costs.

## Backup System

The server automatically backs up to S3 on a schedule (default: daily). You can:

1. View and manage backups using the CLI (`npm run cli` → "Download Backup"):
   - Select a world to browse its backups 
   - Choose a specific backup to download
   - Restore world files directly to your `worlds/` directory
   - Download full backups for manual inspection

2. Restore worlds from backups:
   - Restore directly to your local `worlds/` folder
   - Launch a test server with the restored world
   - Deploy the restored world to AWS

Backup retention is configurable through the `BACKUPS_TO_KEEP` environment variable.

## Multiple Worlds Support

HuginBot simplifies managing multiple Valheim worlds:

1. **Simplified Configuration**:
   - Each world has a world_name that determines both the server name and world save name
   - No need to manage separate server_name and world_name parameters

2. **Discord Server Integration**:
   - Each Discord server can be linked to a specific world
   - Players can only control their own server's world
   - Prevents accidental overwriting of other servers' progress

3. **World-Specific Backups**:
   - Backups are organized by world name in S3
   - Each world maintains its own backup history
   - Automatic cleanup maintains the specified number of backups per world

## Development and Testing

To test locally without incurring AWS costs:

1. Set up a local environment:
   ```
   npm run cli
   ```
   Then choose "Configure Local Testing" followed by "Start Local Test Server"

2. Run tests:
   ```
   npm run test
   ```

3. Run specific tests:
   ```
   npx jest path/to/test-file.test.ts
   ```

## Configuration Reference

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `AWS_REGION` | AWS region to deploy to | `us-west-2` |
| `AWS_PROFILE` | AWS CLI profile to use | `default` |
| `CUSTOM_URL` | Custom domain (optional) | `myvalheim.example.com` |
| `VALHEIM_WORLD_NAME` | World name (used for both server and world) | `Midgard` |
| `VALHEIM_SERVER_PASSWORD` | Server password | `secretpassword` |
| `VALHEIM_ADMIN_IDS` | Steam IDs for admins | `76561198012345678` |
| `DISCORD_*` | Discord integration vars | See Discord Setup |
| `WORLD_CONFIGURATIONS` | Multi-world configs | See .env.template |
| `BACKUP_FREQUENCY_HOURS` | Hours between backups | `24` |
| `BACKUPS_TO_KEEP` | Number of backups to keep | `7` |

## Future Enhancements

- [x] Add mod installation interface
- [ ] Implement server monitoring and alerts
- [ ] Add player statistics and tracking
- [ ] Enhance Discord bot with more commands and features
- [x] Implement automatic server scaling based on player count

## Troubleshooting

### Common Issues

1. **Discord Slash Commands Not Working**
   - Verify your API Gateway endpoint is correctly configured in Discord Developer Portal
   - Check CloudWatch Logs for Lambda function errors
   - Ensure the bot has appropriate permissions in your Discord server

2. **Server Won't Start**
   - Check EC2 instance limits in your AWS account
   - Verify IAM permissions for Lambda to start EC2 instances
   - Check CloudWatch Logs for error messages

3. **World Files Not Found**
   - Ensure world files are correctly placed in the `worlds/` directory
   - Verify file naming follows the pattern `WorldName.db` and `WorldName.fwl`
   - Check S3 bucket permissions

4. **Auto-Shutdown Too Quick**
   - The server auto-shuts down after 10 minutes of inactivity by default
   - Modify the `idleThresholdMinutes` value in `valheim-stack.ts` to adjust this

5. **Discord Authentication Failures**
   - Ensure your `DISCORD_AUTH_TOKEN` matches between your .env and what's deployed
   - Check CloudWatch Logs for authentication errors

### Getting Help

If you encounter issues not covered here:
- Check CloudWatch Logs for detailed error messages
- Look at the EC2 instance's system logs for Valheim server errors
- File an issue on the GitHub repository with details about your problem

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
