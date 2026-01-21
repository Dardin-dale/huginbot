# HuginBot CLI Reference

The HuginBot CLI provides an interactive interface for server administration.

## Quick Start

```bash
npm run cli          # Launch interactive menu
```

## Interactive Menu Options

| Option | Description |
|--------|-------------|
| Get Started | First-time setup wizard - AWS, Discord, and initial world config |
| Server Management | Deploy, start, stop, status, undeploy |
| World Management | Add, edit, switch, remove worlds |
| Mod Management | Add, import, sync, browse Thunderstore mods |
| Backup Management | Create, list, download, configure retention |
| Advanced Settings | Parameter cleanup, AWS region config |

## Direct Commands

Skip the interactive menu with direct commands:

```bash
# Server
npm run cli -- server start
npm run cli -- server stop
npm run cli -- server status

# Worlds
npm run cli -- worlds list
npm run cli -- worlds add
npm run cli -- worlds switch

# Mods
npm run cli -- mods list
npm run cli -- mods search <query>
npm run cli -- mods import <mod-name>
npm run cli -- mods browse

# Backups
npm run cli -- backup list
npm run cli -- backup create
```

## World Configuration

Worlds are stored in `.env` using indexed format:

```bash
WORLD_COUNT=2

WORLD_1_NAME=MyWorld
WORLD_1_WORLD_NAME=Midgard
WORLD_1_PASSWORD=secret123
WORLD_1_DISCORD_ID=123456789

WORLD_2_NAME=TestWorld
WORLD_2_WORLD_NAME=TestRealm
WORLD_2_PASSWORD=test456
WORLD_2_DISCORD_ID=987654321
```

### World-Specific Overrides

Each world can have custom settings:

```bash
WORLD_1_BEPINEX=true
WORLD_1_MODS=["ValheimPlus","EpicLoot"]
WORLD_1_SERVER_ARGS=-crossplay -modifier combat hard
WORLD_1_SERVER_PUBLIC=false
```

## Mod Management

### Adding Mods from Thunderstore

```bash
npm run cli -- mods search "epic loot"    # Search
npm run cli -- mods import EpicLoot       # Import with dependencies
npm run cli -- mods browse                 # Browse popular mods
```

### Local Mod Sync

Place mods in `./mods/<ModName>/` directory:

```
mods/
├── MyMod/
│   ├── MyMod.dll
│   └── metadata.json  (optional)
```

Then sync:
```bash
npm run cli -- mods sync
```

## Valheim Game Modifiers

Native Valheim settings (no mods required):

| Modifier | Values |
|----------|--------|
| combat | veryeasy, easy, hard, veryhard |
| deathpenalty | casual, veryeasy, easy, hard, hardcore |
| resources | muchless, less, more, muchmore |
| raids | none, muchless, less, more, muchmore |
| portals | casual, hard, veryhard |

Presets: `-preset casual`, `-preset hard`, `-preset hardcore`, `-preset immersive`

Configure via `WORLD_X_SERVER_ARGS`:
```bash
WORLD_1_SERVER_ARGS=-crossplay -modifier combat hard -modifier raids none
```

## Backup Configuration

```bash
# Global settings
DOCKER_BACKUP_CRON="0 */2 * * *"     # Every 2 hours
DOCKER_BACKUP_MAX_COUNT=12            # Keep 12 backups
BACKUPS_TO_KEEP=7                     # S3 retention (days)

# Per-world overrides
WORLD_1_BACKUP_CRON="0 */1 * * *"    # Hourly for important world
```
