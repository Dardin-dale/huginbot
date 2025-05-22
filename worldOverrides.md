# World-Specific Server Overrides

## Overview

This document outlines the plan for implementing world-specific server configuration overrides in HuginBot. This feature will allow each world to have its own unique Docker container configuration beyond the basic world name and password.

## Current Implementation

The switch-valheim-world.sh script currently:

1. Gets the active world from SSM Parameter Store
2. Extracts basic world properties (worldName, name, serverPassword)
3. Stops any running Valheim container
4. Starts a new container with these world properties
5. Uses hardcoded values for other Docker parameters

Key line in the script that sets server arguments:
```bash
-e SERVER_ARGS=\"-crossplay -bepinex\" \
```

## Proposed Changes

### 1. Extended World Configuration

Allow additional parameters per world in our indexed format:

```
# Basic world config
WORLD_1_NAME=MainWorld                 # Display name for our reference only
WORLD_1_WORLD_NAME=Midgard             # Actual save file name (Docker's WORLD_NAME)
WORLD_1_PASSWORD=valheim               # Server password (Docker's SERVER_PASS)
WORLD_1_DISCORD_ID=12345               # Discord server ID that can control this world

# World-specific overrides
WORLD_1_SERVER_ARGS="-crossplay -public 1"  # Override default server arguments
WORLD_1_BEPINEX=true                   # Override BepInEx setting
WORLD_1_SERVER_PUBLIC=true             # Override server visibility
WORLD_1_UPDATE_INTERVAL=3600           # Override update check interval (seconds)
```

### 2. Configuration Loading

Update config.js to load these additional parameters:

```javascript
function parseWorldConfigs() {
  const worlds = [];
  const worldCount = parseInt(process.env.WORLD_COUNT || '0', 10);
  
  for (let i = 1; i <= worldCount; i++) {
    if (process.env[`WORLD_${i}_NAME`] && process.env[`WORLD_${i}_WORLD_NAME`]) {
      worlds.push({
        // Basic properties
        name: process.env[`WORLD_${i}_NAME`],
        discordServerId: process.env[`WORLD_${i}_DISCORD_ID`] || '',
        worldName: process.env[`WORLD_${i}_WORLD_NAME`],
        serverPassword: process.env[`WORLD_${i}_PASSWORD`] || 'valheim',
        
        // Extended properties (overrides)
        serverArgs: process.env[`WORLD_${i}_SERVER_ARGS`] || null,
        bepInEx: process.env[`WORLD_${i}_BEPINEX`] !== undefined ? 
          (process.env[`WORLD_${i}_BEPINEX`].toLowerCase() === 'true') : null,
        serverPublic: process.env[`WORLD_${i}_SERVER_PUBLIC`] !== undefined ?
          (process.env[`WORLD_${i}_SERVER_PUBLIC`].toLowerCase() === 'true') : null,
        updateInterval: process.env[`WORLD_${i}_UPDATE_INTERVAL`] || null
      });
    }
  }
  
  return worlds;
}
```

### 3. Modify switch-valheim-world.sh Script

Update the script to handle these additional parameters:

```bash
# Extract additional override values with defaults
SERVER_ARGS=$(echo "$PARAM_VALUE" | jq -r '.serverArgs // "-crossplay -bepinex"')
BEPINEX=$(echo "$PARAM_VALUE" | jq -r '.bepInEx // true')
SERVER_PUBLIC=$(echo "$PARAM_VALUE" | jq -r '.serverPublic // true')
UPDATE_INTERVAL=$(echo "$PARAM_VALUE" | jq -r '.updateInterval // 900')

# Use these values when constructing the Docker run command
docker run -d --name valheim-server \
  # ... other parameters ...
  -e SERVER_ARGS=\"$SERVER_ARGS\" \
  -e BEPINEX=\"$BEPINEX\" \
  -e SERVER_PUBLIC=\"$SERVER_PUBLIC\" \
  -e UPDATE_INTERVAL=\"$UPDATE_INTERVAL\" \
  # ... continue with other parameters ...
```

### 4. World Management UI Updates

Extend the world management UI to configure these additional parameters:

```javascript
// Extended world management prompt
const worldConfig = await inquirer.prompt([
  // Basic parameters (existing)
  {
    type: 'input',
    name: 'name',
    message: 'Display name for the world:',
    validate: (input) => input.trim() !== '' ? true : 'Name cannot be empty'
  },
  {
    type: 'input',
    name: 'worldName',
    message: 'World save name (used in-game):',
    validate: (input) => input.trim() !== '' ? true : 'World name cannot be empty'
  },
  {
    type: 'password',
    name: 'serverPassword',
    message: 'Server password (min 5 characters):',
    validate: (input) => input.trim().length >= 5 ? true : 'Password must be at least 5 characters'
  },
  
  // Advanced parameters (new)
  {
    type: 'expand',
    name: 'configureAdvanced',
    message: 'Configure advanced settings?',
    choices: [
      { key: 'y', name: 'Yes', value: true },
      { key: 'n', name: 'No (use defaults)', value: false }
    ],
    default: 1
  },
  // Only show these if configureAdvanced is true
  {
    type: 'input',
    name: 'serverArgs',
    message: 'Server arguments:',
    default: '-crossplay',
    when: (answers) => answers.configureAdvanced
  },
  {
    type: 'confirm',
    name: 'bepInEx',
    message: 'Enable BepInEx (mod support):',
    default: true,
    when: (answers) => answers.configureAdvanced
  },
  {
    type: 'confirm',
    name: 'serverPublic',
    message: 'Make server public:',
    default: true,
    when: (answers) => answers.configureAdvanced
  },
  {
    type: 'input',
    name: 'updateInterval',
    message: 'Update check interval (seconds):',
    default: '900',
    validate: (input) => /^\d+$/.test(input) ? true : 'Must be a number',
    when: (answers) => answers.configureAdvanced
  }
]);

// Store basic config
updateEnvFile(`WORLD_${index}_NAME`, worldConfig.name);
updateEnvFile(`WORLD_${index}_WORLD_NAME`, worldConfig.worldName);
updateEnvFile(`WORLD_${index}_PASSWORD`, worldConfig.serverPassword);

// Store advanced config if provided
if (worldConfig.configureAdvanced) {
  if (worldConfig.serverArgs) updateEnvFile(`WORLD_${index}_SERVER_ARGS`, worldConfig.serverArgs);
  updateEnvFile(`WORLD_${index}_BEPINEX`, worldConfig.bepInEx.toString());
  updateEnvFile(`WORLD_${index}_SERVER_PUBLIC`, worldConfig.serverPublic.toString());
  if (worldConfig.updateInterval) updateEnvFile(`WORLD_${index}_UPDATE_INTERVAL`, worldConfig.updateInterval);
}
```

## Implementation Plan

### Phase 1: Core Implementation
1. Update config.js to parse additional world-specific parameters
2. Update the active world format in SSM Parameter Store
3. Modify switch-valheim-world.sh to handle these additional parameters
4. Test with basic overrides

### Phase 2: CLI Updates
1. Update the world management UI to add advanced configuration options
2. Implement save/load for these additional parameters
3. Update validation for these parameters
4. Add documentation for the new options

### Phase 3: Testing and Integration
1. Test with various configuration combinations
2. Verify backward compatibility with existing worlds
3. Update documentation
4. Test integration with other HuginBot features

## Supported Parameters

Initial set of world-specific parameters to support:

| Parameter | Docker Variable | Default | Description |
|-----------|----------------|---------|-------------|
| SERVER_ARGS | SERVER_ARGS | "-crossplay -bepinex" | Command-line arguments for the server |
| BEPINEX | BEPINEX | true | Enable/disable BepInEx mod support |
| SERVER_PUBLIC | SERVER_PUBLIC | true | Make server visible in community list |
| UPDATE_INTERVAL | UPDATE_INTERVAL | 900 | Server update check interval in seconds |

Additional parameters can be added in future phases.

## Considerations

1. **Backward Compatibility**: Ensure existing worlds continue to work without modification
2. **Default Values**: Provide sensible defaults for all parameters
3. **Validation**: Implement validation for each parameter
4. **Error Handling**: Add error handling for invalid configurations
5. **Documentation**: Update documentation to explain these new options
6. **UI/UX**: Make advanced options accessible but not overwhelming

## Testing Approach

1. Test basic world switching with no overrides
2. Test each override parameter individually
3. Test combinations of override parameters
4. Test with invalid parameter values
5. Test backward compatibility with existing configurations
