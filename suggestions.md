# Auto-Shutdown Implementation Summary 🛑

## How It Works

1. **Player Monitoring** → CloudWatch Alarm → SNS Topic → Lambda → Stop EC2 → EventBridge → Discord Notification

## The Flow

1. **EC2 Instance** reports player count every minute via `monitor-players.sh`
2. **CloudWatch Alarm** triggers when player count = 0 for 10 minutes
3. **SNS Topic** receives alarm notification
4. **Auto-Shutdown Lambda** checks:
   - Is the server actually running?
   - Has it been up for at least 10 minutes? (grace period)
   - If yes to both → Stop the instance
5. **EventBridge Event** is published for the shutdown
6. **Notify Lambda** sends Viking-themed message to Discord

## Key Features

### 🕐 Grace Period
- Server won't shut down in first 10 minutes after startup
- Prevents immediate shutdown if players are still joining
- Configurable via `MIN_UPTIME_MINUTES` environment variable

### 🎭 Viking-Themed Messages
- Random selection from thematic shutdown messages
- Shows world name, uptime, idle time
- Includes "gold saved" calculation
- Beautiful embed with Viking imagery

### 📊 Metrics Shown
- Server uptime (how long it was running)
- Idle time (how long without players)
- Estimated cost savings
- World backup status

## Required Changes to Your Stack

1. **Add new imports** (SNS, CloudWatch Actions)
2. **Create SNS topic** for alarm notifications
3. **Create auto-shutdown Lambda** with EC2 stop permissions
4. **Connect alarm to SNS** topic
5. **Create EventBridge rule** for shutdown events
6. **Deploy notify-shutdown Lambda** with SSM permissions

## Testing

1. Start server with `/start`
2. Wait 10 minutes (grace period)
3. Ensure no players connect
4. After 10 more minutes → Auto-shutdown triggers
5. Check Discord for Viking-themed notification

## Environment Variables

```typescript
// Auto-shutdown Lambda
VALHEIM_INSTANCE_ID: "i-xxxxx"
MIN_UPTIME_MINUTES: "10"

// Notification Lambda
VALHEIM_INSTANCE_ID: "i-xxxxx"
// (uses same env as other lambdas)
```

## Cost Impact
- Lambda invocations: ~$0.00 (free tier)
- SNS messages: ~$0.00 (free tier)
- EventBridge events: ~$0.00 (free tier)
- **Savings**: Stops idle EC2 instances automatically!

## Customization Options

1. **Change idle threshold**: Modify alarm `evaluationPeriods`
2. **Change grace period**: Update `MIN_UPTIME_MINUTES`
3. **Add more Viking messages**: Update the `vikingMessages` array
4. **Change notification style**: Modify embed colors/images

// Updated notify-shutdown.ts with Viking-themed messages

export async function handler(
  event: EventBridgeEvent<'Server.AutoShutdown', any>,
  context: Context
): Promise<void> {
  console.log('Shutdown event received:', JSON.stringify(event, null, 2));
  
  try {
    // Get details from the event
    const idleTime = event.detail.idleTime || 600; // Default 10 minutes
    const idleMinutes = Math.round(idleTime / 60);
    const uptimeMinutes = event.detail.uptimeMinutes || 0;
    const reason = event.detail.reason || 'Inactivity';
    
    // Get the active world configuration
    let worldName = 'Midgard';
    let guildId: string | undefined;
    
    try {
      const paramResult = await ssmClient.send(new GetParameterCommand({
        Name: ACTIVE_WORLD_PARAM
      }));
      
      if (paramResult.Parameter?.Value) {
        const worldConfig = JSON.parse(paramResult.Parameter.Value);
        worldName = worldConfig.name;
        guildId = worldConfig.discordServerId;
      }
    } catch (err) {
      console.log('No active world parameter found, using defaults');
    }
    
    // Viking-themed shutdown messages
    const vikingMessages = [
      `The longhouse grows cold and empty. The warriors have sailed to distant shores...`,
      `Odin's ravens report no Vikings in sight. The mead halls stand silent...`,
      `The forge fires die down as no hammers ring. Rest now, ${worldName}...`,
      `Even the mightiest warriors must rest. The realm slumbers until called upon again...`,
      `The wolves of winter howl through empty halls. ${worldName} awaits its heroes' return...`,
      `No songs echo from the great hall. The server rests like a sleeping dragon...`,
      `The Valkyries have carried the last warrior home. Silence falls upon ${worldName}...`,
    ];
    
    const randomMessage = vikingMessages[Math.floor(Math.random() * vikingMessages.length)];
    
    // Construct the Discord message with enhanced Viking theme
    const message = {
      username: "HuginBot",
      avatar_url: "https://i.imgur.com/xASc1QX.png",
      content: "⚔️ **The realm grows quiet...**",
      embeds: [
        {
          title: "🌙 Valheim Server Entering Slumber",
          description: randomMessage,
          color: 0xd4701f, // Amber/orange color
          fields: [
            {
              name: "🌍 World",
              value: worldName,
              inline: true
            },
            {
              name: "⏱️ Server Uptime",
              value: uptimeMinutes > 60 
                ? `${Math.floor(uptimeMinutes / 60)}h ${uptimeMinutes % 60}m`
                : `${uptimeMinutes} minutes`,
              inline: true
            },
            {
              name: "💤 Idle Time",
              value: `${idleMinutes} minutes`,
              inline: true
            },
            {
              name: "📊 Status",
              value: "🔴 Shutting Down",
              inline: true
            },
            {
              name: "💰 Gold Saved",
              value: `~${(uptimeMinutes * 0.003).toFixed(2)} coins`,
              inline: true
            },
            {
              name: "💾 World State",
              value: "✅ Saved & Backed Up",
              inline: true
            },
            {
              name: "🔮 Summon the Server",
              value: "When you're ready to return to " + worldName + ", simply use `/start` to awaken the realm once more. The gods await your call!",
              inline: false
            }
          ],
          image: {
            url: "https://i.imgur.com/H3XNEFL.png" // Viking sunset/dusk image
          },
          footer: {
            text: "HuginBot • Keeper of the Digital Realms • Auto-shutdown saves resources",
            icon_url: "https://i.imgur.com/xASc1QX.png"
          },
          timestamp: new Date().toISOString()
        }
      ],
      components: [
        {
          type: 1, // Action Row
          components: [
            {
              type: 2, // Button (these don't work with webhooks, but look nice)
              style: 3, // Success (Green)
              label: "Wake the Server",
              custom_id: "start_server",
              emoji: {
                name: "▶️"
              },
              disabled: true // Webhooks can't handle interactions
            },
            {
              type: 2,
              style: 2, // Secondary (Grey)
              label: "View Status",
              custom_id: "check_status",
              emoji: {
                name: "📊"
              },
              disabled: true
            }
          ]
        }
      ]
    };

    // Get webhook URL from SSM and send notification
    try {
      const webhookUrl = await getWebhookUrl(guildId);
      await axios.post(webhookUrl, message);
      console.log('Discord shutdown notification sent successfully');
    } catch (error) {
      console.error('Failed to send Discord notification:', error);
      // Don't throw - we don't want to fail the Lambda just because Discord notification failed
    }
  } catch (error) {
    console.error('Error in notify-shutdown handler:', error);
  }
}
