# HuginBot Refactor: Findings and Implementation Plan

## Summary of Findings

After analyzing the `lloesche/valheim-server-docker` container, we've discovered it provides numerous built-in features that can significantly simplify our HuginBot implementation:

1. **Built-in Discord Webhook Support**: The container can directly send notifications to Discord without requiring a separate bot instance.

2. **Extensive Event Hooks System**: The container provides hooks for virtually every server lifecycle event (startup, shutdown, backup, etc.) where we can execute custom commands.

3. **Advanced Log Filtering**: The container's log filtering system can detect specific events (player joins, world saves, etc.) and trigger actions.

4. **Automatic Server Management**: The container already handles updates, backups, and server monitoring.

5. **Custom Game Settings**: Server settings and gameplay modifiers can be easily configured through environment variables.

## Refactor TODO List

### 1. Architecture Simplification

- [ ] **Remove Discord Bot EC2 Instance**: Replace with container's built-in webhook functionality
- [ ] **Simplify Lambda Functions**: Reduce to only what can't be handled by container hooks
- [ ] **Update Architecture Diagram**: Reflect the new streamlined design
- [ ] **Review Resource Allocation**: Adjust EC2 instance size based on simplified requirements

### 2. CDK Stack Modifications

- [ ] **Update `valheim-stack.ts`**:
  ```typescript
  // Add environment variables for Discord webhooks
  userData.addEnvironment('DISCORD_WEBHOOK', '${ssm:/huginbot/discord-webhook/${discordServerId}}');
  
  // Add environment variables for server lifecycle hooks
  userData.addEnvironment('POST_SERVER_LISTENING_HOOK', 
    'curl -sfSL -X POST -H "Content-Type: application/json" -d \'{"username":"HuginBot","content":"Server is online and ready!"}\' "$DISCORD_WEBHOOK"');
  
  // Add log filters for player activity
  userData.addEnvironment('VALHEIM_LOG_FILTER_CONTAINS_PlayerJoin', 'Got character ZDOID from');
  userData.addEnvironment('ON_VALHEIM_LOG_FILTER_CONTAINS_PlayerJoin', 
    '{ read l; player=${l:46}; player=${player// :*/}; msg="Player $player has connected"; ' +
    'curl -sfSL -X POST -H "Content-Type: application/json" ' +
    '-d "{\\\"username\\\":\\\"HuginBot\\\",\\\"content\\\":\\\"$msg\\\"}" "$DISCORD_WEBHOOK"; }');
  ```

- [ ] **Create SSM Parameter Store Structure**:
  ```typescript
  // For storing Discord webhook URLs by guild ID
  new StringParameter(this, "DiscordWebhookParam", {
    parameterName: `/huginbot/discord-webhook/${discordServerId}`,
    stringValue: webhook.url,
    description: "Discord webhook URL for notifications",
  });
  ```

- [ ] **Remove Unnecessary Lambda Functions**:
  - Keep only those needed for Discord command handling
  - Remove redundant notification functions

### 3. Discord Bot Simplification

- [ ] **Retain Essential Commands**:
  - `/start` - Start the server
  - `/stop` - Stop the server
  - `/status` - Check server status
  - `/setup` - Configure webhooks (new command)

- [ ] **Implement Webhook Setup Command**:
  ```typescript
  // In lib/discord/commands/setup.ts
  module.exports = {
    data: new SlashCommandBuilder()
      .setName('setup')
      .setDescription('Set up HuginBot webhooks in this channel')
      .setDefaultMemberPermissions(PermissionFlagsBits.MANAGE_WEBHOOKS),

    async execute(interaction, lambda) {
      await interaction.deferReply({ ephemeral: true });
      
      try {
        // Create webhook in the current channel
        const webhook = await interaction.channel.createWebhook({
          name: 'HuginBot Notifications',
        });
        
        // Store the webhook URL in SSM Parameter Store
        const ssm = new AWS.SSM();
        await ssm.putParameter({
          Name: `/huginbot/discord-webhook/${interaction.guildId}`,
          Value: webhook.url,
          Type: 'SecureString',
          Overwrite: true
        }).promise();
        
        await interaction.editReply({ 
          content: 'HuginBot notifications have been set up in this channel!',
          ephemeral: true 
        });
      } catch (error) {
        console.error('Error setting up webhook:', error);
        await interaction.editReply({ 
          content: 'Failed to set up webhook. Please make sure I have the "Manage Webhooks" permission.',
          ephemeral: true 
        });
      }
    }
  };
  ```

- [ ] **Remove Unused Command Handlers**:
  - Review all command handlers in `lib/discord/commands/`
  - Keep only those needed for essential functionality

### 4. Server Management Features

- [ ] **Update Docker Container Configuration**:
  ```yaml
  # Example docker-compose configuration
  services:
    valheim:
      image: lloesche/valheim-server
      cap_add:
        - sys_nice
      volumes:
        - ./config:/config
        - ./data:/opt/valheim
      ports:
        - "2456-2458:2456-2458/udp"
      environment:
        SERVER_NAME: "${SERVER_NAME}"
        WORLD_NAME: "${WORLD_NAME}"
        SERVER_PASS: "${SERVER_PASSWORD}"
        SERVER_PUBLIC: "true"
        DISCORD_WEBHOOK: "${DISCORD_WEBHOOK}"
        PRE_BOOTSTRAP_HOOK: "curl -sfSL -X POST -H \"Content-Type: application/json\" -d '{\"username\":\"HuginBot\",\"content\":\"Server is starting...\"}' \"$DISCORD_WEBHOOK\""
        POST_SERVER_LISTENING_HOOK: "curl -sfSL -X POST -H \"Content-Type: application/json\" -d '{\"username\":\"HuginBot\",\"content\":\"Server is online and ready to play!\"}' \"$DISCORD_WEBHOOK\""
        PRE_SERVER_SHUTDOWN_HOOK: "curl -sfSL -X POST -H \"Content-Type: application/json\" -d '{\"username\":\"HuginBot\",\"content\":\"Server is shutting down. Save your game!\"}' \"$DISCORD_WEBHOOK\""
        # Add other environment variables as needed
  ```

- [ ] **Create Lambda Function for SSM Parameter Retrieval**:
  ```typescript
  // Function to retrieve webhook URL from SSM based on Discord guild ID
  async function getWebhookUrl(guildId: string): Promise<string> {
    try {
      const response = await ssmClient.send(new GetParameterCommand({
        Name: `/huginbot/discord-webhook/${guildId}`,
        WithDecryption: true
      }));
      
      return response.Parameter?.Value || '';
    } catch (error) {
      console.error('Error retrieving webhook URL:', error);
      return '';
    }
  }
  ```

- [ ] **Update Server Start/Stop Functions**:
  - Modify to use SSM to set necessary parameters
  - Use EC2 instance user data to configure hooks

### 5. Testing and Verification

- [ ] **Create Test Script for Container Hooks**:
  ```bash
  #!/bin/bash
  # Test script for Discord webhook notifications
  
  echo "Testing Discord webhook..."
  curl -sfSL -X POST \
    -H "Content-Type: application/json" \
    -d '{"username":"HuginBot Test","content":"This is a test notification"}' \
    "$DISCORD_WEBHOOK"
    
  echo "Done."
  ```

- [ ] **Test Log Filtering and Hooks**:
  - Create test scenarios for player join/leave
  - Test backup notifications
  - Test server start/stop notifications

- [ ] **Verify Multi-World Support**:
  - Test webhook isolation between Discord servers
  - Verify SSM parameter structure works with multiple worlds

### 6. Documentation

- [ ] **Update README**:
  - Document the simplified architecture
  - Add installation instructions for the new approach
  - Document Discord bot setup and webhook configuration

- [ ] **Create User Guide**:
  - Step-by-step guide for server administrators
  - Guide for Discord server moderators

## Implementation Suggestions

1. **Start with a Proof of Concept**:
   - Create a simple test environment with the Docker container
   - Configure basic webhooks and verify they work as expected

2. **Implement in Phases**:
   - Phase 1: Basic container with webhook support
   - Phase 2: Discord bot with setup command
   - Phase 3: Full integration with SSM parameters
   - Phase 4: Final testing and documentation

3. **Use Environment Variable Substitution Carefully**:
   - Docker-compose and CDK handle environment variables differently
   - Escape special characters in webhook URLs
   - Test variable substitution in both environments

4. **Keep Security in Mind**:
   - Store webhook URLs in SSM Parameter Store as SecureString
   - Use IAM roles with least privilege
   - Ensure Discord webhook URLs are not exposed in logs

This refactor will significantly reduce the complexity of our architecture while maintaining all the necessary functionality, resulting in a more reliable and maintainable system.
