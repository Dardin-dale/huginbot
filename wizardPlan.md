# HuginBot Setup Wizard Development Plan

## Overview

This document outlines a comprehensive plan to improve the HuginBot CLI's setup wizard, with a focus on ensuring proper configuration handling, environment variable integration, and Discord bot functionality. We'll focus on manual testing approaches rather than automated testing with mocked AWS infrastructure.

## Architecture Clarification

1. **Single EC2 Instance**: The CDK deploys a single EC2 instance that runs the Valheim server
2. **Server Name vs. World Name**: 
   - Server Name: Name displayed in the server browser (global setting for the EC2 instance)
   - World Name: Name of the specific world save file loaded on the server
3. **World Swapping**: The single server can load different worlds, but only one at a time
4. **Configuration Sources**: Moving to a single-source-of-truth approach using primarily .env file

## Current Issues

1. **Environment Variable Integration**: The setup wizard doesn't use existing `.env` values as defaults
2. **Discord Configuration**: The wizard ignores Discord configurations from `.env`
3. **Multiple World Configurations**: Current format is complex and error-prone
4. **Default Values**: Hardcoded defaults instead of reading from the environment
5. **Configuration Flow**: Unclear user flow for updating vs. creating new configurations
6. **Configuration Duplication**: World-specific settings are duplicated between individual variables and WORLD_CONFIGURATIONS

## Configuration Approach Changes

### Revised Indexed World Configuration Format

We'll adopt an indexed variables approach with clear documentation that maintains consistency with Docker container variables:

```
# World 1 - Main Server
WORLD_1_NAME=MainWorld          # Display name for our reference only
WORLD_1_WORLD_NAME=Midgard      # Actual save file name in Valheim (Docker's WORLD_NAME)
WORLD_1_PASSWORD=secretpass     # Server password for players (Docker's SERVER_PASS)
WORLD_1_DISCORD_ID=12345        # ID of the Discord server that can control this world

# World 2 - Alternative Server
WORLD_2_NAME=AltWorld
WORLD_2_WORLD_NAME=Asgard
WORLD_2_PASSWORD=viking123
WORLD_2_DISCORD_ID=67890

# Total number of worlds
WORLD_COUNT=2
```

### Removing Redundant Configuration

1. **Remove World-Specific Settings** from general VALHEIM_* variables:
   - Remove `VALHEIM_WORLD_NAME` (use indexed format instead)
   - Remove `VALHEIM_SERVER_PASSWORD` (use indexed format instead)

2. **Keep Server-Wide Settings** in VALHEIM_* variables:
   - `VALHEIM_SERVER_NAME` (name in server browser)
   - `VALHEIM_SERVER_ARGS` (additional CLI arguments)
   - `VALHEIM_BEPINEX` (mod support toggle)
   - `VALHEIM_ADMIN_IDS` (admin Steam IDs)
   - `VALHEIM_UPDATE_IF_IDLE` (auto-update setting)

### Configuration Storage Split

1. **Use .env for All Static Configuration**:
   - Server parameters (name, args, etc.)
   - AWS settings
   - Discord tokens/IDs
   - World configurations using indexed format
   - Feature flags and general settings

2. **Use ~/.huginbot/ for Runtime Data Only**:
   - Instance IDs (discovered after deployment)
   - Deployment timestamps
   - Last backup information
   - Operation logs
   - Parameter tracking
   - Currently active world

### Configuration Reading Implementation

```javascript
// In config.js
function parseWorldConfigs() {
  const worlds = [];
  const worldCount = parseInt(process.env.WORLD_COUNT || '0', 10);
  
  for (let i = 1; i <= worldCount; i++) {
    if (process.env[`WORLD_${i}_NAME`] && process.env[`WORLD_${i}_WORLD_NAME`]) {
      worlds.push({
        name: process.env[`WORLD_${i}_NAME`],
        discordServerId: process.env[`WORLD_${i}_DISCORD_ID`] || '',
        worldName: process.env[`WORLD_${i}_WORLD_NAME`],
        serverPassword: process.env[`WORLD_${i}_PASSWORD`] || 'valheim'
      });
    }
  }
  
  // Optional fallback to legacy format for backwards compatibility
  if (worlds.length === 0 && process.env.WORLD_CONFIGURATIONS) {
    // Legacy parsing logic (can be removed in future)
  }
  
  return worlds;
}
```

---

### Phase 2: Improve Server Configuration (Priority: High)

#### Tasks:
- [ ] Update server configuration prompts to use all relevant environment variables
- [ ] Add support for server arguments configuration
- [ ] Enhance BepInEx configuration options
- [ ] Add display of current server settings

#### Implementation Notes:
```javascript
// Server configuration with environment defaults
const serverConfig = await inquirer.prompt([
  {
    type: 'input',
    name: 'serverName',
    message: 'Enter server name:',
    default: config.serverName || 'ValheimServer',
    validate: (input) => input.trim() !== '' ? true : 'Server name cannot be empty'
  },
  // Additional prompts with environment defaults
]);
```

#### Manual Testing:
1. Test with various server configurations in `.env`
2. Verify correct handling of server arguments
3. Test BepInEx enable/disable functionality
4. Confirm proper validation of server parameters

---

### Phase 3: Improve World Management UI (Priority: High)

#### Tasks:
- [ ] Update world management commands to use indexed format
- [ ] Create UI for adding/editing/removing worlds in indexed format
- [ ] Implement direct .env file updates for world changes
- [ ] Add validation for world configuration fields
- [ ] Improve world listing with current status indicators

#### Implementation Notes:
```javascript
// World management with indexed variables
async function addWorld() {
  const config = getConfig();
  
  // Get current world count
  const worldCount = parseInt(process.env.WORLD_COUNT || '0', 10);
  const newIndex = worldCount + 1;
  
  // Prompt for new world details
  const newWorld = await inquirer.prompt([
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
    {
      type: 'input',
      name: 'discordServerId',
      message: 'Discord server ID (optional):',
    }
  ]);
  
  // Update .env file with new world
  updateEnvFile(`WORLD_${newIndex}_NAME`, newWorld.name);
  updateEnvFile(`WORLD_${newIndex}_WORLD_NAME`, newWorld.worldName); // Changed to WORLD_NAME
  updateEnvFile(`WORLD_${newIndex}_PASSWORD`, newWorld.serverPassword);
  updateEnvFile(`WORLD_${newIndex}_DISCORD_ID`, newWorld.discordServerId);
  updateEnvFile('WORLD_COUNT', newIndex.toString());
  
  console.log(chalk.green(`✅ World "${newWorld.name}" added as World #${newIndex}`));
}
```

#### Manual Testing:
1. Test adding a new world with the wizard
2. Test editing existing worlds
3. Test removing worlds (should reindex remaining worlds)
4. Verify .env file is properly updated
5. Test with various validation scenarios (missing fields, etc.)

---

### Phase 4: Enhance Discord Integration (Priority: High)

#### Tasks:
- [ ] Show existing Discord configuration values as defaults
- [ ] Add Discord webhook validation
- [ ] Implement Discord integration testing option
- [ ] Link Discord webhooks with world configurations using indexed format
- [ ] Add option to skip Discord configuration if already set

#### Implementation Notes:
```javascript
// Discord configuration section
if (config.discord && config.discord.configured) {
  console.log(chalk.green('✓ Discord integration already configured'));
  console.log(`Application ID: ${config.discord.appId}`);
  console.log(`Public Key: ${config.discord.publicKey.substring(0, 10)}...`);
  
  const { updateDiscord } = await inquirer.prompt([{
    type: 'confirm',
    name: 'updateDiscord',
    message: 'Would you like to update Discord integration?',
    default: false
  }]);
  
  if (!updateDiscord) {
    // Skip Discord configuration
    discordConfig = config.discord;
  } else {
    // Show existing values as defaults
    // ...
  }
}

// Now link Discord webhooks with worlds
for (let i = 1; i <= worldCount; i++) {
  const worldName = process.env[`WORLD_${i}_NAME`];
  const discordId = process.env[`WORLD_${i}_DISCORD_ID`];
  
  if (worldName && discordId) {
    console.log(`Setting up webhook for world "${worldName}" (Discord server: ${discordId})`);
    // Set up webhook for this world
  }
}
```

#### Manual Testing:
1. Test with existing Discord configuration in `.env`
2. Test with various Discord webhook URLs
3. Verify webhook validation works correctly
4. Test integration with Discord notification system
5. Verify per-world webhook configuration using indexed format

---

### Phase 5: Env File Management (Priority: Medium)

#### Tasks:
- [ ] Create utilities for direct .env file management
- [ ] Add functions to update, delete, and add variables to .env
- [ ] Implement automatic reindexing for world configurations
- [ ] Create command to export current configuration as .env
- [ ] Add validation of .env file format

#### Implementation Notes:
```javascript
// .env file manipulation utilities
function updateEnvFile(key, value) {
  const envPath = path.join(process.cwd(), '.env');
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  
  // Check if key exists and update, or add if it doesn't
  const keyRegex = new RegExp(`^${key}=.*`, 'm');
  if (keyRegex.test(content)) {
    content = content.replace(keyRegex, `${key}=${value}`);
  } else {
    content += `\n${key}=${value}`;
  }
  
  fs.writeFileSync(envPath, content);
}

// Reindex worlds after deletion
function reindexWorlds() {
  const envPath = path.join(process.cwd(), '.env');
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  
  // Find all world-related variables
  const worldVars = {};
  const regex = /^WORLD_(\d+)_([A-Z_]+)=(.*)/gm;
  let match;
  
  while ((match = regex.exec(content)) !== null) {
    const index = parseInt(match[1], 10);
    const field = match[2];
    const value = match[3];
    
    if (!worldVars[index]) worldVars[index] = {};
    worldVars[index][field] = value;
  }
  
  // Sort indices
  const indices = Object.keys(worldVars).map(i => parseInt(i, 10)).sort((a, b) => a - b);
  
  // Reindex worlds
  let newContent = content;
  indices.forEach((oldIndex, newIdx) => {
    const newIndex = newIdx + 1;
    if (oldIndex !== newIndex) {
      // Update all variables for this world
      Object.keys(worldVars[oldIndex]).forEach(field => {
        const oldKey = `WORLD_${oldIndex}_${field}`;
        const newKey = `WORLD_${newIndex}_${field}`;
        const value = worldVars[oldIndex][field];
        
        // Replace in content
        const keyRegex = new RegExp(`^${oldKey}=.*`, 'm');
        newContent = newContent.replace(keyRegex, `${newKey}=${value}`);
      });
    }
  });
  
  // Update world count
  const countRegex = /^WORLD_COUNT=.*/m;
  if (countRegex.test(newContent)) {
    newContent = newContent.replace(countRegex, `WORLD_COUNT=${indices.length}`);
  } else {
    newContent += `\nWORLD_COUNT=${indices.length}`;
  }
  
  fs.writeFileSync(envPath, newContent);
}
```

#### Manual Testing:
1. Test updating variables in existing .env file
2. Test adding new variables to .env file
3. Test reindexing after removing a world
4. Verify .env remains valid after multiple operations
5. Test with various edge cases (empty file, missing variables, etc.)

---

### Phase 6: AWS Infrastructure Management (Priority: Medium)

#### Tasks:
- [ ] Add detection of existing AWS infrastructure
- [ ] Create options for updating vs. creating new resources
- [ ] Improve handling of AWS credentials and region selection
- [ ] Add deployment status visualization
- [ ] Update deployment to use environment variables from .env

#### Implementation Notes:
```javascript
// Check for existing infrastructure
const spinner = ora('Checking for existing infrastructure...').start();
try {
  const hasExistingInfrastructure = await isStackDeployed('ValheimStack');
  spinner.succeed(`Infrastructure check complete`);
  
  if (hasExistingInfrastructure) {
    console.log(chalk.green('✓ HuginBot infrastructure is already deployed'));
    // Offer update options
  } else {
    console.log(chalk.yellow('No existing HuginBot infrastructure found'));
    // Offer creation options
  }
} catch (error) {
  spinner.fail('Failed to check infrastructure');
  // Handle error
}

// Deploy using variables from .env
async function deployInfrastructure() {
  // Load all environment variables
  require('dotenv').config();
  
  // Use them during deployment
  try {
    console.log(chalk.cyan('Deploying HuginBot infrastructure using current .env configuration'));
    execSync('npm run deploy:all', { 
      stdio: 'inherit',
      env: process.env // Pass through all environment variables
    });
    console.log(chalk.green('✅ Deployment completed successfully!'));
  } catch (error) {
    console.error(chalk.red('❌ Deployment failed:'), error.message);
  }
}
```

#### Manual Testing:
1. Test with existing AWS infrastructure
2. Test with no existing infrastructure
3. Verify proper handling of AWS credentials
4. Test deployment using environment variables
5. Confirm all configuration is properly applied


---

### Phase 7: Backup and Maintenance (Priority: Lower)

#### Tasks:
- [ ] Update backup configuration to use .env variables
- [ ] Implement backup rotation policy options
- [ ] Create backup testing functionality
- [ ] Add backup restoration options
- [ ] Integrate with indexed world format

#### Implementation Notes:
```javascript
// Backup configuration
updateEnvFile('BACKUPS_TO_KEEP', backupConfig.backupsToKeep.toString());
updateEnvFile('BACKUP_FREQUENCY_HOURS', backupConfig.backupFrequencyHours.toString());

// World-specific backup locations based on indexed format
async function backupWorld(worldIndex) {
  const worldName = process.env[`WORLD_${worldIndex}_NAME`];
  const worldValheimName = process.env[`WORLD_${worldIndex}_VALHEIM_NAME`];
  
  if (!worldName || !worldValheimName) {
    console.log(chalk.red(`World #${worldIndex} not found in configuration`));
    return false;
  }
  
  console.log(chalk.cyan(`Creating backup for world: ${worldName} (${worldValheimName})`));
  // Execute backup with world-specific path
}
```

#### Manual Testing:
1. Test with various backup configurations in .env
2. Verify backup rotation policy works correctly
3. Test backup creation and restoration
4. Confirm proper backup scheduling
5. Test backups with the indexed world format

### Phase 8: Testing and Documentation (Ongoing)

#### Tasks:
- [ ] Create comprehensive manual test cases
- [ ] Document common failure scenarios and solutions
- [ ] Create user-focused documentation for the new approach
- [ ] Add inline help and examples
- [ ] Create detailed .env.example file with thorough documentation

#### Documentation Focus:
- Setup process step-by-step
- New indexed world configuration format
- Environment variable reference
- Troubleshooting common issues
- Discord integration guide
- World management guide

#### Example .env.example File:
```
# === SERVER-WIDE SETTINGS ===
VALHEIM_SERVER_NAME="My Valheim Server"  # Name displayed in server list
VALHEIM_SERVER_ARGS="-crossplay"         # Additional server arguments
VALHEIM_BEPINEX=true                     # Enable BepInEx mod support
VALHEIM_ADMIN_IDS="76561198xxx 7656119yyy"  # Steam IDs for admins
VALHEIM_UPDATE_IF_IDLE=true              # Update server when idle

# === WORLD CONFIGURATIONS ===
# Each world is configured with a set of indexed variables.
# Replace 1 with the index of each world (starting from 1).

WORLD_1_NAME=MainWorld           # Display name for our reference only
WORLD_1_WORLD_NAME=Midgard       # Actual save file name in Valheim (Docker's WORLD_NAME)
WORLD_1_PASSWORD=valheim         # Server password for players (Docker's SERVER_PASS)
WORLD_1_DISCORD_ID=123456789012345678    # ID of the Discord server that can control this world

# World 2 - Alternative world
WORLD_2_NAME=AltWorld            # Display name for our reference only
WORLD_2_WORLD_NAME=Asgard        # Actual save file name in Valheim (Docker's WORLD_NAME)
WORLD_2_PASSWORD=viking123       # Server password for players (Docker's SERVER_PASS)
WORLD_2_DISCORD_ID=876543210987654321    # ID of the Discord server that can control this world

# Total number of worlds
WORLD_COUNT=2

# === AWS SETTINGS ===
AWS_REGION=us-west-2
AWS_PROFILE=default

# === DISCORD SETTINGS ===
DISCORD_APP_ID=123456789012345678
DISCORD_BOT_PUBLIC_KEY=abcdef123456
DISCORD_BOT_SECRET_TOKEN=your-secret-token

# === BACKUP SETTINGS ===
BACKUPS_TO_KEEP=7                        # Number of backups to keep per world
BACKUP_FREQUENCY_HOURS=24                # How often to run scheduled backups
```

---

## Implementation Plan

### Week 1: Configuration Format Refactoring
- Implement indexed world format in config.js
- Remove redundant configuration
- Create migration utilities
- Update .env.example with documentation
- Create basic test cases for the new format

### Week 2: Setup Wizard & World Management
- Update setup wizard to use indexed format
- Implement .env file management utilities
- Create world management UI for indexed format
- Extend test cases for world management

### Week 3: Discord Integration & Env Management
- Update Discord configuration to work with indexed worlds
- Add webhook validation and testing
- Implement direct .env file manipulation functions
- Create test cases for Discord integration

### Week 4: AWS Integration & Documentation
- Update AWS deployment to use environment variables
- Implement backup functionality for indexed worlds
- Create comprehensive documentation
- Execute full test suite
- Final review and adjustments

## Appendix: Key Files to Modify

1. `cli/utils/config.js` - Update configuration parsing for indexed world format
2. `cli/wizard.js` - Modify setup wizard to use and update .env file directly
3. `cli/commands/worlds.js` - Update to manage indexed world format
4. `cli/commands/discord.js` - Update Discord integration
5. `cli/ui/prompts.js` - Update prompts for world configuration
6. `.env.example` - Create detailed example file
7. `lib/lambdas/notify-join-code.ts` - Update to work with indexed world format
8. `lib/lambdas/utils/world-config.ts` - Update parsing logic

## Manual Testing Approach

Since AWS infrastructure mocking is challenging, we'll focus on manual testing strategies:

### Test Environment Setup
1. Create a dedicated test AWS account
2. Use minimal infrastructure for testing (smallest instance types)
3. Create test Discord server for integration testing

### Test Matrices

#### Configuration Test Matrix
| Configuration Option | Test Values |
|---------------------|-------------|
| Server Name | Empty, Default, Custom |
| World Format | Legacy Format, Indexed Format, Mixed |
| World Count | 0, 1, Multiple |
| Instance Type | t3.micro, t3.small, t3.medium |
| BepInEx | Enabled, Disabled |
| Admin IDs | Empty, Single, Multiple |

#### Discord Test Matrix
| Discord Config | Test Values |
|----------------|-------------|
| App ID | Empty, Invalid, Valid |
| Public Key | Empty, Invalid, Valid |
| Bot Token | Empty, Invalid, Valid |
| Webhook URL | Empty, Invalid, Valid |
| World Discord IDs | Missing, Invalid, Valid |

### Specific Test Cases

1. **Configuration Format Migration**
   - Test migrating from old format to indexed format
   - Test handling missing world count
   - Test partial configurations

2. **World Management**
   - Add/edit/remove worlds and verify .env updates
   - Test reindexing after world removal
   - Test world switching with indexed format

3. **Discord Integration**
   - Test webhook creation per world
   - Test notification system with indexed format
   - Verify configuration validation

4. **Deployment Testing**
   - Verify deployment uses environment variables
   - Test runtime modifications
   - Test backup and restore with indexed format
