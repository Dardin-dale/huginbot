# Quick Lambda Refactor Steps 🚀

## Step 1: Fix Commands Lambda `/setup`
**File**: `lib/lambdas/commands.ts`

```typescript
// Add to slash command definition (in Discord):
options: [{
  name: 'webhook_url',
  type: 3, // STRING
  description: 'Discord webhook URL',
  required: false
}]

// Update handleSetupCommand to:
1. Check if webhook_url provided
2. If not, show instructions
3. If yes, validate and test webhook
4. Store in SSM: /huginbot/discord-webhook/{guild_id}
5. Return success message (not ephemeral)
```

## Step 2: Fix Notification Lambdas
**Files**: `notify-join-code.ts`, `notify-shutdown.ts`

```typescript
// Replace getWebhookUrl() function:
async function getWebhookUrl(): Promise<string> {
  // Get guild ID from active world
  const activeWorld = await ssmClient.send(new GetParameterCommand({
    Name: '/huginbot/active-world'
  }));
  
  const worldConfig = JSON.parse(activeWorld.Parameter?.Value || '{}');
  const guildId = worldConfig.discordServerId;
  
  // Get webhook for this guild
  const webhook = await ssmClient.send(new GetParameterCommand({
    Name: `/huginbot/discord-webhook/${guildId}`
  }));
  
  return webhook.Parameter?.Value || throw new Error('No webhook');
}
```

## Step 3: Update CDK Stack
**File**: `lib/valheim/valheim-stack.ts`

```typescript
// Remove:
- import { Secret } from "aws-cdk-lib/aws-secretsmanager"
- webhook secret creation
- DISCORD_WEBHOOK_SECRET_NAME from env

// Update Lambda SSM permissions:
commandsFunction.addToRolePolicy(new PolicyStatement({
  actions: ["ssm:PutParameter", "ssm:GetParameter"],
  resources: [`arn:aws:ssm:${region}:${account}:parameter/huginbot/*`]
}));
```

## Step 4: Deploy & Test

1. Deploy the stack
2. Run `/setup` to see instructions
3. Create webhook in Discord channel settings
4. Run `/setup webhook_url:https://discord.com/api/webhooks/...`
5. Start server and verify notifications work

## That's it! 🎉

The key insight is that webhook URLs aren't secrets - they're just configuration. SSM Parameter Store is perfect for this and costs $0.
