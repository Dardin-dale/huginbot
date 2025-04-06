# HuginBot

HuginBot is an AWS CDK project that provisions and manages a Valheim game server using the llosche Docker container. It features a CLI interface for world management and a Discord bot that enables players to start/stop the server and manage their worlds directly from Discord.

## Features

- **EC2-based Valheim Server**: Cost-effective hosting with on-demand scaling
- **Discord Integration**: Control your server directly from Discord
- **Multiple World Support**: Run different worlds for different Discord servers
- **Automated Backups**: Scheduled backups to S3 with configurable retention
- **World Management**: Easy CLI for adding/editing worlds and configurations
- **Secure Authentication**: Discord verification for server control

## Setup Requirements

1. AWS Account with appropriate permissions
2. Node.js 16+ and npm installed
3. Discord bot application configured with:
   - Bot token
   - Application ID
   - Public key

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
   Edit `.env` with your AWS and Discord configuration.

4. Build the project:
   ```
   npm run build
   ```

## Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application or use an existing one
3. Under "Bot" section, create a bot and copy the token
4. Add the following to your `.env` file:
   ```
   DISCORD_APP_ID=your_discord_client_id_here
   DISCORD_BOT_PUBLIC_KEY=your_discord_bot_public_key_here
   DISCORD_BOT_SECRET_TOKEN=your_discord_bot_token_here
   DISCORD_AUTH_TOKEN=your_custom_auth_token_here
   ```

5. Add the bot to your Discord server with the following permissions:
   - Send Messages
   - Read Message History
   - Use Slash Commands

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

## Usage

### CLI Commands

* `npm run build`   - Compile TypeScript to JavaScript
* `npm run watch`   - Watch for changes and compile
* `npm run test`    - Run Jest unit tests
* `npm run cli`     - Launch the CLI interface
* `npm run cdk`     - Run CDK commands

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

## Backup System

The server automatically backs up to S3 on a schedule (default: daily). You can:

1. Use the CLI to download any backup (`npm run cli` → "Download Backup")
2. Extract the backup locally
3. Browse and modify game files
4. Upload modified files back to the server

Backup retention is configurable through the `BACKUPS_TO_KEEP` environment variable.

## Multiple Worlds Support

HuginBot supports multiple Valheim worlds:

1. **Discord Server Integration**:
   - Each Discord server can have its own world
   - Players can only control their own server's world
   - Prevents accidental overwriting of other servers' progress

2. **World Management**:
   - Use CLI to add, edit, and remove world configurations
   - Configure different passwords for each world
   - Automatic world switching when starting the server

3. **World-Specific Backups**:
   - Backups are organized by world name in S3
   - Each world maintains its own backup history
   - Automatic cleanup maintains the specified number of backups per world

## Development and Testing

To test locally without incurring AWS costs:

1. Set up a local environment:
   ```
   npm run start:local
   ```

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
| `VALHEIM_SERVER_NAME` | Server name in game browser | `MyValheimServer` |
| `VALHEIM_WORLD_NAME` | Default world name | `Midgard` |
| `VALHEIM_SERVER_PASSWORD` | Server password | `secretpassword` |
| `VALHEIM_ADMIN_IDS` | Steam IDs for admins | `76561198012345678` |
| `DISCORD_*` | Discord integration vars | See Discord Setup |
| `WORLD_CONFIGURATIONS` | Multi-world configs | See .env.template |
| `BACKUP_FREQUENCY_HOURS` | Hours between backups | `24` |
| `BACKUPS_TO_KEEP` | Number of backups to keep | `7` |

## Future Enhancements

- [ ] Add mod installation interface
- [ ] Implement server monitoring and alerts
- [ ] Add player statistics and tracking
- [ ] Enhance Discord bot with more commands and features
- [ ] Implement automatic server scaling based on player count

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.