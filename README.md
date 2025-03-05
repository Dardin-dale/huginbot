# HuginBot

This is an AWS CDK project to host the llosche docker container for Valheim.

The goal of the project is to get an easy CLI interface to spin up worlds and a host of handy accompanying lambda functions and finally HuginBot, a helpful Discord companion to let your players start/stop the game server whenever they want!

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `npm run cli`     run the local CLI interface
* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template

## Current Progress

- [x] Basic CDK structure for Valheim server
- [x] CLI interface skeleton
- [x] Implement EC2-based deployment (cheaper than Fargate)
- [x] Complete lambda functions for server management
- [x] Add Discord bot integration
- [x] Implement S3 backup for game files
- [x] Add backup management and download capabilities
- [x] Local testing framework to save AWS costs
- [x] Add multiple world support with Discord-specific worlds
- [ ] Add mod installation interface

## Development

To test locally without incurring AWS costs, we're focusing on developing and testing the infrastructure and CLI locally first. The Discord bot will be developed with a local testing harness.

## Cost-Effective Architecture

The project now uses:
- EC2 instances instead of Fargate (3-5x cheaper)
- EBS volumes for persistent storage instead of EFS (cheaper and simpler)
- Automatic S3 backups with configurable retention
- Lambda functions for backup cleanup
- CLI tools to download and restore backups

## Backup & Restore

The server automatically backs up to S3 on a schedule (default: daily). You can:
1. Use the CLI to download any backup (`npm run cli` → "Download Backup")
2. Extract the backup locally
3. Browse and modify game files
4. Upload modified files back to the server

## Resources

- EC2 Instance: Runs the Valheim server with Docker
- EBS Volumes:
  - Root volume (30GB): Operating system
  - Data volume (20GB): Game files, worlds, and mods
- S3 Bucket: Stores backups of game data

## Multiple Worlds Support

HuginBot now supports multiple Valheim worlds:

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

## Configuration

The project now uses two configuration methods:

1. **.env file**: For sensitive information like API keys and passwords:
   - Copy `.env.template` to `.env` and fill in your values
   - Never commit the `.env` file to version control

2. **CLI Config**: For world configurations and server settings:
   - Use `npm run cli` and select "Manage Worlds" 
   - Add Discord server IDs to link worlds to specific Discord servers
