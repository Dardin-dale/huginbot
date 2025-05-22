# HuginBot Simplified MVP Plan

## Current Status
- ✅ Backup system implemented (key differentiator vs Fargate setup)
- ✅ Legacy CLI removed (cli.mjs deleted)
- ❌ AWS authentication failing
- ❌ CLI not using .env configuration
- ✅ Package.json cleaned up

## Core Issues to Fix

### 1. AWS Authentication (BLOCKING)
**Problem**: CLI can't authenticate with AWS despite valid credentials
**Solution**: Fix credential loading in `cli/utils/aws.js`

### 2. Configuration System (HIGH)
**Problem**: CLI not using .env file, has its own config system
**Solution**: Integrate .env into CLI configuration

### 3. Unnecessary Code (MEDIUM)
**Problem**: `cli/commands/deploy.js` duplicates CDK functionality, `discord-setup.sh` likely redundant after re-facoring lib/
**Solution**: Remove deploy.js and discord-setup.sh, use CDK directly

## Simplified MVP Scope

### Must-Have Features
1. **AWS Authentication** - CLI works with existing AWS setup
2. **Server Management** - Start/stop via CLI and Discord
3. **World Switching** - Change worlds via CLI
4. **Backup Management** - List/create/download backups (already implemented)

### Won't-Have Features (for now)
- Parameter cleanup (can be manual)
- Local testing utilities (too complex, test against real AWS)
- Advanced backup rotation
- Setup wizard (just use .env)

## Implementation Plan

### Phase 1: Fix Authentication (URGENT)
```bash
# Add missing dependencies
npm install dotenv @aws-sdk/credential-provider-node @aws-sdk/client-sts

# Files to update:
# - cli/utils/aws.js (fix credential loading)
# - cli/utils/config.js (read from .env)
```

**Changes**:
1. Update `cli/utils/config.js` to load from `.env` 
2. Fix `cli/utils/aws.js` to use `defaultProvider()`
3. Test authentication with existing AWS setup

### Phase 2: Remove Redundant Code (HIGH)
```bash
# Files to remove:
# - cli/commands/deploy.js
# - discord-setup.sh (likely redundant)
# - cli/wizard.js (optional, can keep for future)

# Files to update:
# - cli/index.js (remove deploy command registration)
# - cli/interactive.js (update to use CDK scripts)
```

**Changes**:
1. Remove deployment commands from CLI
2. Remove Discord setup script (use manual setup instead)
3. Update interactive menu to point to CDK commands
4. Simplify CLI to core operations only

### Phase 3: Manual Testing & Validation (MEDIUM)
```bash
# Manual test workflow against real AWS:
# 1. cdk deploy --all
# 2. huginbot server start
# 3. huginbot backup create
# 4. huginbot server stop
# 5. Test Discord integration manually
# 6. cdk destroy --all (cleanup)
```

**Manual Validation**:
1. Server deploys successfully to real AWS
2. CLI can control real EC2 instance
3. Backups work with real S3
4. Discord bot responds to commands
5. All functionality works end-to-end

## Files That Need Changes

### High Priority
```
cli/utils/config.js     # Load from .env instead of Conf
cli/utils/aws.js        # Fix credential provider
cli/index.js           # Remove deploy command
```

### Medium Priority
```
cli/interactive.js     # Update deployment options
cli/commands/deploy.js # DELETE THIS FILE
cli/commands/server.js # Test with new config
discord-setup.sh       # DELETE THIS FILE (use manual setup)
```

### Low Priority
```
cli/commands/worlds.js # Update for .env config
cli/commands/backup.js # Verify still works
```

## Package.json Updates Needed

### Add Dependencies
```json
"dotenv": "^16.0.0",
"@aws-sdk/credential-provider-node": "^3.470.0",
"@aws-sdk/client-sts": "^3.470.0"
```

### Remove Scripts (after deploy.js removal)
```json
// Remove these:
"cli:setup": "node cli/index.js setup",
"start:local": "node cli/index.js --local",
"test:local": "node cli/index.js test local", 
"test:docker": "node cli/index.js test docker"
```

### Keep Essential Scripts
```json
"deploy:valheim": "cdk deploy ValheimStack",
"deploy:discord": "cdk deploy HuginBotStack", 
"deploy:all": "cdk deploy --all",
"server:start": "node cli/index.js server start",
"server:stop": "node cli/index.js server stop",
"backup:create": "node cli/index.js backup create",
"backup:list": "node cli/index.js backup list"
```

## Success Criteria

### MVP Complete When:
- [x] `cp .env.template .env` and fill in values
- [ ] `npm run deploy:all` works
- [ ] `npm run server:start` works  
- [ ] `npm run backup:create` works
- [ ] Discord `/start` and `/stop` commands work
- [ ] Can switch worlds via CLI

### Quality Gates:
- No AWS authentication errors
- All CLI commands work with .env configuration  
- Backup system fully functional
- Clean codebase (no deploy.js, no legacy code)

## Implementation Order

### Week 1: Core Fixes
1. **Day 1-2**: Fix AWS authentication
   - Update config.js to use .env
   - Fix aws.js credential loading
   - Test basic connection

2. **Day 3-4**: Remove deploy.js  
   - Delete cli/commands/deploy.js
   - Update CLI index and interactive
   - Test CDK deployment workflow

3. **Day 5**: Integration testing
   - Full workflow test
   - Discord integration test
   - Backup functionality test

### Week 2: Polish & Documentation
1. Update README with simplified workflow
2. Test with fresh .env setup  
3. Document any edge cases
4. Prepare for production use

## Immediate Next Steps

1. **Install missing deps**:
   ```bash
   npm install dotenv @aws-sdk/credential-provider-node @aws-sdk/client-sts
   ```

2. **Test current auth issue**:
   ```bash
   node debug-aws.js  # from our previous session
   ```

3. **Fix config.js** to load from .env first
4. **Fix aws.js** to use proper credential loading  
5. **Test**: `huginbot server status`

This focused approach gets you to a working MVP quickly while keeping the backup system as your key differentiator.
