# HuginBot CLI

A powerful command-line interface for managing Valheim servers with HuginBot.

## Features

- Deploy and manage AWS infrastructure for Valheim servers
- Control server start/stop operations and monitor status
- Manage multiple Valheim worlds easily
- Create and restore backups of your worlds
- Configure Discord bot integration
- Local testing utilities with Docker support

## Installation

The CLI is included with HuginBot. After cloning the repository:

```bash
# Install dependencies
npm install

# Link the CLI globally (optional)
npm link

# Make the CLI executable
chmod +x cli/index.js
```

## Usage

### Interactive Mode

The easiest way to use the CLI is in interactive mode:

```bash
huginbot
# or
npm run cli
```

This launches a menu-driven interface where you can select options with arrow keys.

### Direct Commands

You can also use direct commands for specific operations:

```bash
# Get general help
huginbot --help

# First-time setup
huginbot setup

# Deploy infrastructure 
huginbot deploy valheim
huginbot deploy discord
huginbot deploy all

# Server management
huginbot server start
huginbot server stop
huginbot server status

# World management
huginbot worlds list
huginbot worlds add
huginbot worlds switch

# Backup management
huginbot backup list
huginbot backup create
huginbot backup download

# Testing utilities
huginbot test local
huginbot test docker
huginbot test mock
```

## Available Commands

### Global Commands

- `huginbot setup` - Run the first-time setup wizard
- `huginbot interactive` - Launch interactive menu mode

### Deployment

- `huginbot deploy valheim` - Deploy Valheim server infrastructure
- `huginbot deploy discord` - Deploy Discord bot infrastructure
- `huginbot deploy all` - Deploy all infrastructure
- `huginbot deploy undeploy` - Undeploy all infrastructure

### Server Management

- `huginbot server start` - Start the Valheim server
- `huginbot server stop` - Stop the Valheim server
- `huginbot server status` - Check server status
- `huginbot server address` - Get server connection address
- `huginbot server info` - Show detailed server information

### World Management

- `huginbot worlds list` - List available worlds
- `huginbot worlds add` - Add a new world
- `huginbot worlds edit` - Edit an existing world
- `huginbot worlds remove` - Remove a world
- `huginbot worlds switch` - Switch active world
- `huginbot worlds current` - Show current active world

### Backup Management

- `huginbot backup list` - List available backups
- `huginbot backup create` - Create a new backup
- `huginbot backup download` - Download a backup
- `huginbot backup restore` - Restore a backup (advanced)

### Discord Integration

- `huginbot discord setup` - Configure Discord bot settings
- `huginbot discord deploy` - Deploy Discord bot to AWS
- `huginbot discord status` - Check Discord bot status
- `huginbot discord update` - Update Discord bot commands
- `huginbot discord logs` - View Discord bot logs

### Testing Utilities

- `huginbot test local` - Run local tests
- `huginbot test e2e` - Run end-to-end tests
- `huginbot test docker` - Run local Docker instance for testing
- `huginbot test env` - Set up test environment
- `huginbot test mock` - Launch mock server for offline testing

## Configuration

The CLI uses the Conf package to store configuration in `~/.huginbot/config.json`. You can edit this file directly, but it's recommended to use the CLI commands to modify configuration.

Key configuration items:
- AWS region and credentials
- Server parameters (name, password, instance type)
- World configurations
- Discord bot settings

## Local Development

For local development without AWS:

1. Enable local testing mode:
   ```bash
   huginbot test env
   ```

2. Start the mock server:
   ```bash
   huginbot test mock
   ```

3. For testing with a real Valheim server locally:
   ```bash
   huginbot test docker
   ```

## Advanced Usage

### NPM Scripts

You can use npm scripts for common operations:

```bash
# Interactive CLI
npm run cli

# Development mode with auto-restart
npm run cli:dev

# First-time setup
npm run cli:setup

# Server management
npm run server:start
npm run server:stop
npm run server:status

# And more in package.json
```

### Environment Variables

You can set these environment variables to modify CLI behavior:

- `AWS_PROFILE` - AWS profile to use
- `AWS_REGION` - AWS region to deploy to
- `DISCORD_TOKEN` - Discord bot token
- `HUGINBOT_CONFIG_DIR` - Custom configuration directory

## Transition from Legacy CLI

This CLI replaces the older `cli.mjs` script. If you need to use the legacy CLI:

```bash
npm run cli:legacy
```

## Support

If you encounter issues or have questions:
- Submit an issue on GitHub
- Use the `huginbot --help` command for detailed command help