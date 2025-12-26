# Discord Integration Setup Guide

This guide walks you through setting up Discord integration for HuginBot. You'll need three pieces of information from Discord's Developer Portal: **Application ID**, **Public Key**, and **Bot Token**.

## Prerequisites

- A Discord account
- Administrator permissions on the Discord server where you want to use HuginBot
- 10-15 minutes to complete setup

## Step 1: Create a Discord Application

1. **Open Discord Developer Portal**
   - Go to: https://discord.com/developers/applications
   - Click the "New Application" button (top right)

2. **Name Your Application**
   - Enter a name (e.g., "HuginBot" or "Valheim Server Manager")
   - Accept the Terms of Service
   - Click "Create"

## Step 2: Get Your Application ID and Public Key

You'll now see your application's settings page.

### Application ID
1. Look at the "APPLICATION ID" section near the top of the page
2. Click the "Copy" button to copy your Application ID
3. **Save this value** - you'll need it for your `.env` file as `DISCORD_APP_ID`

**Example:** `1234567890123456789` (18-19 digit number)

### Public Key
1. Scroll down slightly to find "PUBLIC KEY"
2. Click the "Copy" button to copy your Public Key
3. **Save this value** - you'll need it for your `.env` file as `DISCORD_BOT_PUBLIC_KEY`

**Example:** `a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6` (64 character hex string)

## Step 3: Create a Bot User

1. **Navigate to the Bot Section**
   - Click "Bot" in the left sidebar
   - Click "Add Bot"
   - Confirm by clicking "Yes, do it!"

2. **Configure Bot Settings**
   - **Bot Name**: Change if desired (this is what users see)
   - **Bot Icon**: Upload an icon if you want (optional)

3. **Disable Public Bot** (Recommended)
   - Uncheck "Public Bot" to prevent others from adding your bot to their servers

4. **Enable Privileged Gateway Intents** (Not required for basic functionality)
   - You can leave these OFF for now
   - HuginBot doesn't require privileged intents for basic server management

## Step 4: Get Your Bot Token

**⚠️ IMPORTANT: Keep this token SECRET! Never share it or commit it to Git.**

1. **Reset and Copy Token**
   - Under "TOKEN" section, click "Reset Token"
   - Click "Yes, do it!" to confirm
   - Click "Copy" to copy the new token
   - **Save this immediately** - you won't be able to see it again!

2. **Save to .env File**
   - Add this as `DISCORD_BOT_SECRET_TOKEN` in your `.env` file
   - **Example format:** `NzkyNzE1...` (a long string with dots)

**Security Notes:**
- If you lose this token, just reset it and update your `.env` file
- Never commit `.env` to version control
- If the token is leaked, reset it immediately in the Developer Portal

## Step 5: Configure Bot Permissions

1. **Navigate to OAuth2 > URL Generator**
   - Click "OAuth2" in left sidebar
   - Click "URL Generator"

2. **Select Scopes**
   Check these boxes:
   - ✅ `bot` - Allows your bot to join servers
   - ✅ `applications.commands` - Enables slash commands

3. **Select Bot Permissions**
   Scroll down and check these permissions:
   - ✅ `Send Messages` - Required to send server status and notifications
   - ✅ `Manage Webhooks` - Required for the `/setup` command
   - ✅ `Use Slash Commands` - Required for all bot interactions
   - ✅ `Embed Links` - Optional but recommended for rich embeds

4. **Copy the Generated URL**
   - At the bottom, you'll see a "Generated URL"
   - Click "Copy" to copy this URL
   - **Keep this URL** - you'll use it to add the bot to your server

## Step 6: Add Bot to Your Discord Server

1. **Open the Invite URL**
   - Paste the URL you copied into your browser
   - Or use the HuginBot setup wizard which will display this URL

2. **Select Your Server**
   - Choose the Discord server where you want to add the bot
   - Click "Continue"

3. **Authorize Permissions**
   - Review the permissions (should match what you selected)
   - Click "Authorize"
   - Complete any CAPTCHA if prompted

4. **Verify Bot Joined**
   - Check your Discord server's member list
   - You should see your bot (it will appear offline until HuginBot is deployed)

## Step 7: Deploy HuginBot Infrastructure

Before Discord commands will work, you need to deploy HuginBot to AWS:

```bash
# Make sure .env is configured with Discord credentials
source .env

# Deploy to AWS (takes 10-15 minutes)
npm run deploy
```

After deployment completes, you'll see an **API Gateway endpoint URL**. Keep this for the next step!

**Example output:**
```
Outputs:
ValheimStack.ApiEndpoint = https://abc123xyz.execute-api.us-west-2.amazonaws.com/prod
```

## Step 8: Set Interactions Endpoint URL

This is the crucial step that connects Discord to your deployed Lambda functions.

1. **Go Back to Discord Developer Portal**
   - Navigate to your application: https://discord.com/developers/applications
   - Select your HuginBot application

2. **Navigate to General Information**
   - Click "General Information" in the left sidebar
   - Scroll down to "INTERACTIONS ENDPOINT URL"

3. **Enter Your Endpoint URL**
   - Take your API Gateway URL from deployment
   - Add `/valheim/control` to the end
   - **Example:** `https://abc123xyz.execute-api.us-west-2.amazonaws.com/prod/valheim/control`
   - Paste this into the "INTERACTIONS ENDPOINT URL" field
   - Click "Save Changes"

4. **Discord Verification**
   - Discord will automatically send a test request to verify the endpoint
   - If valid, you'll see a green checkmark
   - If it fails, double-check:
     - URL is exactly correct (no trailing slash, includes `/valheim/control`)
     - Your deployment succeeded
     - Your Lambda function is running
     - Your `DISCORD_BOT_PUBLIC_KEY` in `.env` matches the one in Developer Portal

## Step 9: Initialize in Discord Server

Almost done! Now set up notifications in your Discord channel:

1. **Go to Your Discord Server**
   - Open the channel where you want server notifications

2. **Run the Setup Command**
   ```
   /setup
   ```
   - This creates a webhook for server notifications
   - The webhook URL is automatically encrypted and stored in AWS Secrets Manager

3. **Verify Setup**
   - You should see a success message
   - The bot will use this channel for server status updates

## Step 10: Test Your Bot

Try these commands to verify everything works:

```
/help              # Shows available commands
/status check      # Checks server status
/worlds list       # Lists configured worlds
```

If you see responses, congratulations! Your Discord integration is working!

## Common Issues and Solutions

### "Application did not respond" Error

**Cause:** Discord can't reach your Interactions Endpoint URL

**Solutions:**
1. Verify the endpoint URL is correct in Developer Portal
2. Check that your Lambda function deployed successfully
3. Verify `DISCORD_BOT_PUBLIC_KEY` matches in both `.env` and Developer Portal
4. Check CloudWatch Logs for your Lambda function for errors

### Bot Appears Offline

**This is normal!** Discord bots using slash commands don't need to maintain a gateway connection, so they appear offline. The bot will still respond to slash commands.

### Commands Don't Appear

**Cause:** Slash commands weren't registered

**Solution:**
```bash
npm run register-commands
```

Or run the setup wizard again and choose to register commands.

### Webhook Not Working

**Cause:** The `/setup` command may not have completed successfully

**Solutions:**
1. Run `/setup` again in your desired channel
2. Check CloudWatch Logs for webhook creation errors
3. Verify the bot has "Manage Webhooks" permission in that channel

## Getting Your Discord Server ID

Some HuginBot features require your Discord Server ID (for world configuration):

1. **Enable Developer Mode in Discord**
   - User Settings → Advanced → Enable "Developer Mode"

2. **Copy Server ID**
   - Right-click your server icon in the left sidebar
   - Click "Copy Server ID"
   - Paste this into your `.env` as `WORLD_1_DISCORD_ID` (for your first world)

## Security Best Practices

- ✅ Never share your Bot Token with anyone
- ✅ Keep your `.env` file out of version control (add to `.gitignore`)
- ✅ If you suspect your token was compromised, reset it immediately in Developer Portal
- ✅ Disable "Public Bot" to prevent unauthorized installations
- ✅ Only grant the minimum required permissions
- ✅ Use Discord's audit log to monitor bot actions

## Next Steps

Now that Discord is set up:

1. Configure your first world in `.env`
2. Use `/start` to launch your Valheim server
3. Invite friends and share the join code (posted in Discord)
4. Use `/stop` when done playing to save on AWS costs

## Additional Resources

- [Discord Developer Documentation](https://discord.com/developers/docs)
- [Discord.js Guide](https://discordjs.guide/)
- [HuginBot Troubleshooting Guide](./troubleshooting.md)

## Need Help?

- Check the [HuginBot README](../README.md)
- Review [CloudWatch Logs](https://console.aws.amazon.com/cloudwatch/home#logs:) for errors
- Create an issue on GitHub