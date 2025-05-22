# World-Specific Mod Isolation Plan

## Background and Motivation

Currently, HuginBot uses a shared global directory for all Valheim mods, which has several limitations:

1. All worlds must use the same set of mods
2. Changing mods for one world affects all other worlds
3. Different mod configurations cannot coexist
4. Testing new mods risks breaking existing worlds

This plan outlines how to implement world-specific mod isolation, allowing each Valheim world to have its own unique set of mods and configurations.

## Current Implementation Analysis

### Docker Container Usage

The project currently uses the lloesche/valheim-server Docker container with the following mod-related configuration:

- Volume mount for mods: `/mnt/valheim-data/mods:/bepinex/plugins`
- BepInEx control via `BEPINEX` environment variable (default true)
- Server arguments configuration via `SERVER_ARGS` parameter
- No support for world-specific mod isolation

### BepInEx Structure

BepInEx follows a standard structure:
- Main folder: `BepInEx/`
- Plugins directory: `BepInEx/plugins/`
- Configuration files: `BepInEx/config/`

### ValheimPlus Structure

ValheimPlus is a comprehensive mod suite with its own structure:
- Main configuration file: `valheim_plus.cfg` in `BepInEx/config/`
- Additional plugins: `/config/valheimplus/plugins/`
- ValheimPlus config: `/config/valheimplus/config/`

## Enhanced Directory Structure

Based on research into both BepInEx and ValheimPlus, here's the proposed directory structure:

```
/mnt/valheim-data/
├── config/                # Main config (shared across worlds)
├── backups/               # World backups  
├── mods/                  # Global mods (legacy support)
├── worlds-mods/           # World-specific mods
│   ├── world1/
│   │   ├── bepinex/       # BepInEx for world1
│   │   │   ├── plugins/   # BepInEx plugins
│   │   │   └── config/    # BepInEx config files
│   │   └── valheimplus/   # ValheimPlus for world1 (if used)
│   │       ├── plugins/   # Additional plugins
│   │       └── config/    # ValheimPlus config
│   ├── world2/
│   │   ├── bepinex/       # BepInEx for world2
│   │   │   ├── plugins/   # BepInEx plugins
│   │   │   └── config/    # BepInEx config files
│   │   └── valheimplus/   # ValheimPlus for world2 (if used)
│   │       ├── plugins/   # Additional plugins
│   │       └── config/    # ValheimPlus config
│   └── ...
└── shared-mods/          # Optional shared mods across selected worlds
    ├── group1/           # Mod group 1 (e.g., "minimal")
    │   ├── bepinex/      # BepInEx for this group
    │   │   └── plugins/  # Shared plugins
    │   └── valheimplus/  # ValheimPlus for this group
    └── group2/           # Mod group 2 (e.g., "full")
        └── ...
```

**Implementation Reasoning:**
- Separate directories for BepInEx and ValheimPlus to handle their different structures
- Shared-mods directory for mod groups that can be reused across worlds
- Maintaining the global mods directory for backward compatibility
- World-specific organization to prevent mod conflicts

## Implementation Plan

### 1. Script Changes (switch-valheim-world.sh)

```bash
# Add new logic to determine which mod source to use
if [ "$MOD_ISOLATION" = "true" ]; then
  # Check if world-specific mods directory exists
  if [ -d "/mnt/valheim-data/worlds-mods/${WORLD_NAME}" ]; then
    echo "Using world-specific mods for ${WORLD_NAME}"
    
    # Check if using BepInEx or ValheimPlus
    if [ "$VALHEIM_PLUS" = "true" ]; then
      MOD_SOURCE="/mnt/valheim-data/worlds-mods/${WORLD_NAME}/valheimplus"
      MOD_TYPE="valheimplus"
    else
      MOD_SOURCE="/mnt/valheim-data/worlds-mods/${WORLD_NAME}/bepinex"
      MOD_TYPE="bepinex"
    fi
  else
    echo "World-specific mods directory not found, creating..."
    mkdir -p "/mnt/valheim-data/worlds-mods/${WORLD_NAME}/bepinex/plugins"
    mkdir -p "/mnt/valheim-data/worlds-mods/${WORLD_NAME}/bepinex/config"
    
    # Initialize with global mods if available
    if [ -d "/mnt/valheim-data/mods" ]; then
      echo "Initializing with global mods..."
      cp -r /mnt/valheim-data/mods/* "/mnt/valheim-data/worlds-mods/${WORLD_NAME}/bepinex/plugins/"
    fi
    
    MOD_SOURCE="/mnt/valheim-data/worlds-mods/${WORLD_NAME}/bepinex"
    MOD_TYPE="bepinex"
  fi
else
  # Use global mods directory (backward compatibility)
  echo "Using global mods directory"
  MOD_SOURCE="/mnt/valheim-data/mods"
  MOD_TYPE="bepinex"
fi

# Then update the Docker run command to use the appropriate paths
if [ "$MOD_TYPE" = "valheimplus" ]; then
  VALHEIM_PLUS_MOUNTS="-v ${MOD_SOURCE}/plugins:/config/valheimplus/plugins \
                        -v ${MOD_SOURCE}/config:/config/valheimplus/config"
  MOD_MOUNTS="${VALHEIM_PLUS_MOUNTS}"
  # Set env vars for ValheimPlus
  MOD_ENV="-e VALHEIM_PLUS=true"
else
  BEPINEX_MOUNTS="-v ${MOD_SOURCE}/plugins:/config/bepinex/plugins \
                   -v ${MOD_SOURCE}/config:/config/bepinex/config"
  MOD_MOUNTS="${BEPINEX_MOUNTS}"
  # Set env vars for BepInEx
  MOD_ENV="-e BEPINEX=${BEPINEX}"
fi

# Update the Docker run command to include the new mounts
SERVER_CMD="docker run -d --name valheim-server \
  -p 2456-2458:2456-2458/udp \
  -p 2456-2458:2456-2458/tcp \
  -p 80:80 \
  --cap-add=sys_nice \
  -v /mnt/valheim-data/config:/config \
  -v /mnt/valheim-data/backups:/config/backups \
  -v /mnt/valheim-data/opt-valheim:/opt/valheim \
  ${MOD_MOUNTS} \
  -e SERVER_NAME=\"$SERVER_NAME\" \
  -e WORLD_NAME=\"$WORLD_NAME\" \
  -e SERVER_PASS=\"$SERVER_PASSWORD\" \
  ${MOD_ENV} \
  [other environment variables...] \
  $WEBHOOK_ENV \
  $OVERRIDE_ENV \
  --restart unless-stopped \
  lloesche/valheim-server"
```

**Implementation Notes:**
- The script checks for MOD_ISOLATION flag to determine whether to use world-specific mods
- If the world-specific directory doesn't exist, it creates it and optionally initializes from global mods
- It dynamically determines whether to use BepInEx or ValheimPlus based on configuration
- The Docker command is updated to mount the appropriate directories

### 2. Configuration Updates (config.js)

```javascript
// Add new configuration options for mod isolation
function parseWorldsFromEnv() {
  const worldConfigs = [];
  const worldCount = parseInt(process.env.WORLD_COUNT || '0', 10);
  
  for (let i = 1; i <= worldCount; i++) {
    if (process.env[`WORLD_${i}_NAME`] && process.env[`WORLD_${i}_WORLD_NAME`]) {
      // Create the base world config
      const worldConfig = {
        // Basic properties (required)
        name: process.env[`WORLD_${i}_NAME`],
        worldName: process.env[`WORLD_${i}_WORLD_NAME`],
        serverPassword: process.env[`WORLD_${i}_PASSWORD`] || 'valheim',
        discordServerId: process.env[`WORLD_${i}_DISCORD_ID`] || '',
        adminIds: process.env.VALHEIM_ADMIN_IDS || '',
        
        // Container overrides object to store all custom parameters
        overrides: {},
        
        // Mod configuration
        modIsolation: process.env[`WORLD_${i}_MOD_ISOLATION`] === 'true',
        valheimPlus: process.env[`WORLD_${i}_VALHEIM_PLUS`] === 'true',
        modGroup: process.env[`WORLD_${i}_MOD_GROUP`] || '',
      };
      
      // Find all environment variables that match WORLD_<i>_* pattern
      // and aren't one of the basic properties
      const worldPrefix = `WORLD_${i}_`;
      const basicProps = ['NAME', 'WORLD_NAME', 'PASSWORD', 'DISCORD_ID', 'MOD_ISOLATION', 'VALHEIM_PLUS', 'MOD_GROUP'];
      
      Object.keys(process.env).forEach(key => {
        if (key.startsWith(worldPrefix)) {
          // Extract the parameter name (everything after WORLD_<i>_)
          const paramName = key.substring(worldPrefix.length);
          
          // Skip basic properties, we've already handled those
          if (!basicProps.includes(paramName)) {
            let value = process.env[key];
            
            // Parse booleans and numbers
            if (value.toLowerCase() === 'true') {
              value = true;
            } else if (value.toLowerCase() === 'false') {
              value = false;
            } else if (!isNaN(value) && !isNaN(parseFloat(value))) {
              value = parseFloat(value);
            }
            
            // Store in overrides object using original parameter name
            worldConfig.overrides[paramName] = value;
          }
        }
      });
      
      worldConfigs.push(worldConfig);
    }
  }
  
  return worldConfigs;
}
```

**Implementation Notes:**
- Added new properties to the world configuration object: modIsolation, valheimPlus, and modGroup
- These properties determine how mods are handled for each world
- Maintained compatibility with existing configuration approach

### 3. Environment Manager Updates (env-manager.js)

```javascript
function addWorldToEnv(world) {
  try {
    // Get current world count
    const worldCount = parseInt(process.env.WORLD_COUNT || '0', 10);
    const newIndex = worldCount + 1;
    
    // Add the new world - basic properties
    updateEnvVariable(`WORLD_${newIndex}_NAME`, world.name);
    updateEnvVariable(`WORLD_${newIndex}_WORLD_NAME`, world.worldName);
    updateEnvVariable(`WORLD_${newIndex}_PASSWORD`, world.serverPassword);
    if (world.discordServerId) {
      updateEnvVariable(`WORLD_${newIndex}_DISCORD_ID`, world.discordServerId);
    }
    
    // Add mod isolation settings
    if (world.modIsolation) {
      updateEnvVariable(`WORLD_${newIndex}_MOD_ISOLATION`, 'true');
    }
    if (world.valheimPlus) {
      updateEnvVariable(`WORLD_${newIndex}_VALHEIM_PLUS`, 'true');
    }
    if (world.modGroup) {
      updateEnvVariable(`WORLD_${newIndex}_MOD_GROUP`, world.modGroup);
    }
    
    // Add any overrides if they exist
    if (world.overrides && typeof world.overrides === 'object') {
      Object.entries(world.overrides).forEach(([key, value]) => {
        // Convert all values to strings for the .env file
        const stringValue = typeof value === 'boolean' || typeof value === 'number' 
          ? value.toString() 
          : value;
        
        updateEnvVariable(`WORLD_${newIndex}_${key}`, stringValue);
      });
    }
    
    // Update world count
    updateEnvVariable('WORLD_COUNT', newIndex.toString());
    
    return newIndex;
  } catch (err) {
    console.error('Error adding world to .env file:', err);
    return -1;
  }
}
```

**Implementation Notes:**
- Updated to handle the new mod isolation properties
- Ensures these properties are saved to the .env file
- Maintains the existing override pattern for maximum flexibility

### 4. CLI UI Updates (worlds.js)

```javascript
// Mod Management section in addWorld function
if (basicConfig.configureAdvanced) {
  console.log(chalk.cyan.bold('\n⚙️ Mod Management:'));
  
  // Mod management prompts
  const modPrompts = [
    {
      type: 'confirm',
      name: 'modIsolation',
      message: 'Enable world-specific mod isolation?',
      default: false
    },
    {
      type: 'list',
      name: 'modType',
      message: 'Select mod framework:',
      choices: [
        { name: 'BepInEx (standard mod framework)', value: 'bepinex' },
        { name: 'ValheimPlus (overhaul mod suite)', value: 'valheimplus' }
      ],
      default: 0,
      when: (answers) => answers.modIsolation
    },
    {
      type: 'list',
      name: 'modSource',
      message: 'Initialize mods from:',
      choices: [
        { name: 'Empty (start fresh)', value: 'empty' },
        { name: 'Global mods (copy from shared)', value: 'global' },
        { name: 'Another world (copy from existing world)', value: 'world' },
        { name: 'Mod group (use a predefined group)', value: 'group' }
      ],
      default: 0,
      when: (answers) => answers.modIsolation
    },
    // Additional prompts based on modSource selection...
  ];
  
  const modConfig = await inquirer.prompt(modPrompts);
  
  // Update world config with mod settings
  newWorld.modIsolation = modConfig.modIsolation;
  newWorld.valheimPlus = modConfig.modType === 'valheimplus';
  
  if (modConfig.modSource === 'group' && modConfig.modGroup) {
    newWorld.modGroup = modConfig.modGroup;
  }
  
  // Add environment variables to overrides
  newWorld.overrides.MOD_ISOLATION = modConfig.modIsolation.toString();
  if (newWorld.valheimPlus) {
    newWorld.overrides.VALHEIM_PLUS = 'true';
    newWorld.overrides.BEPINEX = 'false';
  } else {
    newWorld.overrides.BEPINEX = 'true';
    newWorld.overrides.VALHEIM_PLUS = 'false';
  }
  
  // Set up the directory structure if mod isolation is enabled
  if (modConfig.modIsolation) {
    // Directory creation and initialization logic
    // Varies based on selected initialization source
  }
}
```

**Implementation Notes:**
- Added new UI section for mod management
- Provides options for enabling/disabling mod isolation
- Allows selection of mod framework (BepInEx or ValheimPlus)
- Supports different initialization sources (empty, global mods, another world, mod group)
- Creates the necessary directory structure

### 5. Migration Script (migrateWorldMods)

```javascript
async function migrateWorldMods() {
  const config = getConfig();
  
  console.log(chalk.cyan.bold('\n📋 Migrating World Mods:'));
  console.log('This will create world-specific mod directories for existing worlds.');
  
  // Get list of worlds to migrate
  const worldsToMigrate = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'worlds',
      message: 'Select worlds to migrate:',
      choices: config.worlds.map(world => ({
        name: world.name,
        value: world.name,
        checked: false
      }))
    },
    {
      type: 'confirm',
      name: 'useGlobalMods',
      message: 'Initialize with global mods?',
      default: true
    }
  ]);
  
  // Process each selected world
  for (const worldName of worldsToMigrate.worlds) {
    // Create mod directories
    // Copy global mods if requested
    // Update world configuration
  }
}
```

**Implementation Notes:**
- Provides a way to convert existing worlds to use mod isolation
- Interactive UI for selecting worlds to migrate
- Option to initialize with existing global mods
- Updates world configuration to use mod isolation

## User Documentation

See the attached User Documentation section for details on how to use the world-specific mod isolation feature.

## Testing Plan

See the attached Testing Plan section for a comprehensive testing strategy covering:
1. Basic functionality tests
2. Framework-specific tests
3. Mod management tests
4. Edge cases and error handling

## Implementation Timeline

1. **Core Infrastructure** (1-2 days)
   - Directory structure implementation
   - Script modifications
   - Configuration system updates

2. **UI Enhancements** (1 day)
   - Mod management interface
   - Command-line tools
   - Status display

3. **Migration Tools** (1 day)
   - World conversion utility
   - Backward compatibility handling
   - Error recovery mechanisms

4. **Documentation & Testing** (1-2 days)
   - User documentation
   - Test execution
   - Bug fixing

## Additional Considerations

### Performance Impact
- Minimal performance impact expected
- Potentially faster server startup as only relevant mods are loaded
- Slightly increased disk space usage due to mod duplication

### Backward Compatibility
- Existing worlds will continue to work with global mods
- Migration to world-specific mods is optional
- Configuration system preserves existing properties

### Future Enhancements
- Mod version tracking
- UI for direct mod installation
- Automatic mod updates
- Conflict detection between mods
- Shared profiles for common mod configurations

## Conclusion

The World-Specific Mod Isolation feature provides significant benefits for HuginBot users by allowing each Valheim world to have its own unique set of mods and configurations. This enhances flexibility, improves stability, and creates a better user experience while maintaining backward compatibility.

Implementation follows a phased approach, starting with core infrastructure changes and progressing through UI enhancements, migration tools, and comprehensive testing. The feature is designed to be intuitive for users while providing the technical foundation for future enhancements to mod management capabilities.