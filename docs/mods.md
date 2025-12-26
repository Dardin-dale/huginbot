# HuginBot Mod Management

This guide covers managing Valheim mods for your HuginBot server, including the mod library, per-world mod configuration, and Thunderstore integration.

## Overview

HuginBot uses a centralized mod library stored in S3. Mods are:
1. Added to the library (via CLI)
2. Assigned to specific worlds
3. Downloaded to the server when a world starts
4. Automatically cleared and reloaded on world switch

This architecture allows different worlds to run different mod configurations.

## Prerequisites

- BepInEx must be enabled for the world (`WORLD_X_BEPINEX=true`)
- Stack deployed with `npm run deploy`
- CLI access for mod management

## CLI Commands

### View Mods in Library

```bash
npm run cli -- mods list
```

Shows all mods in your S3 library with name, version, source, and file count.

### Add a Mod Manually

```bash
npm run cli -- mods add
```

Interactive prompts for:
- Path to mod file (`.dll`) or directory
- Mod name
- Version
- Description (optional)
- Source URL (optional)
- Dependencies (optional)

You can also use options:
```bash
npm run cli -- mods add -p ./MyMod.dll -n MyMod -v 1.0.0
```

### Remove a Mod

```bash
npm run cli -- mods remove
# or
npm run cli -- mods remove -n MyMod
```

### View Mod Details

```bash
npm run cli -- mods info MyMod
```

### Sync Local Mods Folder

If you have a local `./mods/` folder with mod directories:

```bash
npm run cli -- mods sync
npm run cli -- mods sync --force  # Overwrite existing
```

**Expected folder structure:**
```
mods/
├── MyMod/
│   ├── MyMod.dll
│   └── metadata.json  (optional)
├── AnotherMod/
│   └── AnotherMod.dll
```

**Optional metadata.json format:**
```json
{
  "name": "MyMod",
  "version": "1.2.3",
  "description": "My custom mod",
  "dependencies": ["OtherMod"]
}
```

## Thunderstore Integration

### Search for Mods

```bash
npm run cli -- mods search "networking"
npm run cli -- mods search "valheim plus" --limit 10
```

### Browse Popular Mods

```bash
npm run cli -- mods browse
npm run cli -- mods browse --limit 30
```

### Import from Thunderstore

```bash
npm run cli -- mods import BetterNetworking_Valheim
npm run cli -- mods import CW_Jesse-BetterNetworking_Valheim  # Full name
npm run cli -- mods import SomeMod --no-deps  # Skip dependencies
```

The import process:
1. Downloads the mod from Thunderstore
2. Extracts plugin files (`.dll`)
3. Uploads to your S3 library
4. Optionally imports dependencies

## Assigning Mods to Worlds

### Via Environment Variables

In your `.env` file:

```bash
WORLD_1_NAME=MyWorld
WORLD_1_BEPINEX=true
WORLD_1_MODS=["BetterNetworking_Valheim", "ValheimPlus"]
```

### Via CLI World Edit

```bash
npm run cli -- worlds edit
```

Select "Edit mod selection" to interactively assign mods.

## Game Modifiers (Built-in Valheim Settings)

Valheim has built-in game modifiers that don't require mods. Configure via:

### Environment Variables

```bash
WORLD_1_SERVER_ARGS="-crossplay -modifier resources more -modifier raids none"
WORLD_1_MODIFIERS={"resources":"more","raids":"none"}
```

### Available Modifiers

| Modifier | Values | Description |
|----------|--------|-------------|
| `combat` | veryeasy, easy, hard, veryhard | Combat difficulty |
| `deathpenalty` | casual, veryeasy, easy, hard, hardcore | What you lose on death |
| `resources` | muchless, less, more, muchmore | Resource drop rates |
| `raids` | none, muchless, less, more, muchmore | Enemy raid frequency |
| `portals` | casual, hard, veryhard | Portal restrictions |

### Presets

Use `-preset <name>` instead of individual modifiers:

| Preset | Description |
|--------|-------------|
| `casual` | Relaxed gameplay, minimal death penalty |
| `easy` | Slightly easier than default |
| `hard` | More challenging |
| `hardcore` | Permadeath enabled |
| `immersive` | Slower, atmospheric gameplay |
| `hammer` | Creative/building focus |

Example:
```bash
WORLD_1_SERVER_ARGS="-crossplay -preset casual"
```

## Discord Commands

### View Mods for a World

```
/mods list [world]
```

Shows mods enabled for the specified world (or active world).

### View World Info (includes mods)

```
/worlds info [world]
```

Displays world details including mods, modifiers, and BepInEx status.

## How Mods Are Loaded

When a world starts (via `/start` or world switch), the following happens:

1. **BepInEx plugins directory cleared**: `/config/bepinex/plugins/` is emptied
2. **Check BepInEx setting**: If `BEPINEX=false` for this world, no mods are loaded
3. **Mods downloaded**: World-specific mods downloaded from S3 to `/config/bepinex/plugins/`
4. **Container starts**: BepInEx copies plugins to `/opt/valheim/bepinex/BepInEx/plugins/` on startup
5. **Valheim loads**: BepInEx injects mods into the game

This ensures:
- Each world gets exactly the mods configured for it
- Switching to a world with `BEPINEX=false` clears all mods
- No leftover mods from previous worlds

## S3 Storage Structure

```
s3://your-backup-bucket/
├── mods/
│   ├── manifest.json           # Library index
│   ├── BetterNetworking_Valheim/
│   │   ├── metadata.json       # Mod info
│   │   └── plugins/
│   │       └── BetterNetworking.dll
│   └── AnotherMod/
│       ├── metadata.json
│       └── plugins/
│           └── AnotherMod.dll
└── worlds/
    └── ... (backups)
```

## Troubleshooting

### Mod not loading

1. Check BepInEx is enabled: `WORLD_X_BEPINEX=true`
2. Verify mod is in library: `npm run cli -- mods list`
3. Check mod is assigned to world: `npm run cli -- worlds list`
4. Check server logs for BepInEx loading messages

### Thunderstore import fails

1. Verify internet connectivity
2. Check the mod name is correct (use `mods search` first)
3. Try with `--no-deps` if a dependency is causing issues

### Mods from previous world still loaded

Mods are cleared on world start, not shutdown. The BepInEx plugins directory is cleared every time a world starts. If you switched worlds but mods persist:
1. Verify the world switch completed successfully (check `/status`)
2. Ensure the switch script ran: `switch-valheim-world.sh` clears `/config/bepinex/plugins/`
3. Stop and restart the server if needed

### BepInEx not loading mods

1. Verify `BEPINEX=true` for the world
2. Check mods are in the correct location: `/config/bepinex/plugins/`
3. Check container logs: `docker logs valheim-server`
4. Look for BepInEx initialization messages in the logs

### Sync not finding mods

Ensure folder structure is correct:
```
mods/
└── ModName/        <- Directory name
    └── ModName.dll <- DLL file inside
```

Not:
```
mods/
└── ModName.dll     <- Wrong! Needs to be in subdirectory
```

## Best Practices

1. **Test mods locally first** before adding to production
2. **Keep mod count reasonable** - more mods = longer load times
3. **Document dependencies** when adding mods manually
4. **Use Thunderstore import** when possible for automatic metadata
5. **Back up before major mod changes** with `/backup create`
