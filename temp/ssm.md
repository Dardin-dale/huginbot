# Lambda Refactor Plan - SSM-Based Discord Integration

## Overview
Refactor all Lambda functions to use SSM Parameter Store consistently for cost optimization while fixing the Discord webhook integration.

## Phase 1: Update Commands Lambda ✏️

### 1.1 Fix `/setup` Command
**File**: `lib/lambdas/commands.ts`

- **Add webhook URL parameter to slash command**
- **Remove SSM metadata storage** (not needed)
- **Store webhook directly in SSM**
- **Test webhook before storing**
- **Return clear success/failure messages**

```typescript
// Key changes:
- Add webhook_url option to command data
- Validate Discord webhook URL format
- Test webhook with actual POST request
- Store at /huginbot/discord-webhook/{guild-id}
- Remove ephemeral flag for success messages
```

### 1.2 Update Other Commands
- **`/start`**: Check for webhook existence, warn if not configured
- **`/stop`**: Add notification attempt with graceful failure
- **`/status`**: Show webhook configuration status

## Phase 2: Fix Notification Lambdas 📢

### 2.1 Update `notify-join-code.ts`
- **Remove Secrets Manager imports**
- **Add SSM-based webhook retrieval**
- **Add fallback logic for webhook discovery**
- **Improve error handling**

```typescript
// Key changes:
- Remove SecretsManagerClient
- Use SSM GetParameter for webhook URL
- Try guild-specific webhook first
- Add graceful failure if no webhook
```

### 2.2 Update `notify-shutdown.ts`
- **Same changes as notify-join-code.ts**
- **Add shutdown reason to notification**
- **Include uptime statistics**

## Phase 3: Update CDK Stack 🏗️

### 3.1 Remove Secrets Manager
**File**: `lib/valheim/valheim-stack.ts`

- **Remove Secret import**
- **Remove webhook secret creation**
- **Update Lambda environment variables**

### 3.2 Update IAM Permissions
- **Add SSM PutParameter for commands Lambda**
- **Keep SSM GetParameter for notification Lambdas**
- **Remove Secrets Manager permissions**

```typescript
// SSM permissions needed:
- commands Lambda: Get, Put, Delete, AddTags
- notification Lambdas: Get only
- EC2 instance: Get only
```

## Phase 4: Add New Features 🚀

### 4.1 Multi-Server Support
- Store webhooks per Discord server
- Allow different worlds per server
- Path structure: `/huginbot/discord-webhook/{guild-id}`

### 4.2 Webhook Management Commands
- `/setup remove` - Remove webhook configuration
- `/setup test` - Test current webhook
- `/setup info` - Show current configuration

## Phase 5: Testing & Validation ✅

### 5.1 Test Scenarios
1. **Fresh setup**: No existing webhook
2. **Update webhook**: Replace existing
3. **Invalid webhook**: Bad URL format
4. **Deleted webhook**: Discord-side deletion
5. **Multi-world**: Different Discord servers

### 5.2 Error Handling
- Graceful failures for missing webhooks
- Clear error messages for users
- Logging for debugging

## Implementation Order

1. **Start with Commands Lambda** - Fix setup command first
2. **Update Stack IAM** - Ensure permissions are correct
3. **Update Notification Lambdas** - Switch to SSM
4. **Remove Secrets Manager** - Clean up unused resources
5. **Test end-to-end** - Verify all workflows

## SSM Parameter Structure

```
/huginbot/
├── discord-auth-token                    # Bot authentication
├── active-world                          # Current world config
├── playfab-join-code                     # Temporary join code
├── playfab-join-code-timestamp           # Code timestamp
└── discord-webhook/
    ├── {guild-id-1}                      # Webhook URL for guild 1
    ├── {guild-id-2}                      # Webhook URL for guild 2
    └── {guild-id-n}                      # Webhook URL for guild n
```

## Cost Impact
- **Before**: $0.40/month per Secrets Manager secret
- **After**: $0 (using free tier SSM parameters)
- **Limit**: 10,000 free parameters (plenty of room)

## Migration Notes
- No data migration needed (fresh webhook setup required)
- Users must run `/setup` command after deployment
- Old webhook secret can be deleted manually

## Code Snippets to Add

### Webhook Validation Function
```typescript
async function validateWebhookUrl(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes('discord.com') || 
           parsed.hostname.includes('discordapp.com');
  } catch {
    return false;
  }
}
```

### Webhook Retrieval Function
```typescript
async function getWebhookForGuild(guildId: string): Promise<string | null> {
  try {
    const result = await ssmClient.send(new GetParameterCommand({
      Name: `/huginbot/discord-webhook/${guildId}`
    }));
    return result.Parameter?.Value || null;
  } catch {
    return null;
  }
}
```

## Success Criteria
- [ ] `/setup webhook_url:xxx` stores webhook in SSM
- [ ] Server start notifications work
- [ ] Join code notifications work  
- [ ] Shutdown notifications work
- [ ] No Secrets Manager usage
- [ ] Clear error messages for missing webhooks
- [ ] Multi-Discord server support
