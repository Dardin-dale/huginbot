# /switch-world - Switch Active Valheim World

Switch the active Valheim world on the server.

## Using CLI (Interactive)

```bash
npm run cli
# Select "World Management" -> "Switch World"
```

## Using CLI (Direct)

```bash
npm run cli -- worlds switch
```

## Manual World Switch

If you need to manually update the world config:

1. Update the SSM parameter with the world config:
   ```javascript
   // The world config should include:
   {
     "name": "WorldName",
     "worldName": "WorldName",
     "serverPassword": "password",
     "discordServerId": "123456789",
     "adminIds": "steam_id_1 steam_id_2",
     "overrides": {
       "BEPINEX": true,
       "SERVER_ARGS": "-crossplay"
     }
   }
   ```

2. Trigger the world switch on the server:
   ```bash
   npm run cli -- server update-scripts --restart
   ```

## World Configuration

Worlds are configured in `.env`:
```
WORLD_1_NAME=MyWorld
WORLD_1_WORLD_NAME=MyWorld
WORLD_1_PASSWORD=password
WORLD_1_DISCORD_ID=123456789
WORLD_1_ADMIN_IDS="steam_id1 steam_id2"
WORLD_COUNT=1
```
