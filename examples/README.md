# HuginBot Configuration Examples

This directory contains example configuration files to help you get started with HuginBot.

## Available Examples

### `.env.minimal`
**Use this if:** You want the quickest setup with minimal configuration

**Features:**
- Single world configuration
- Default backup settings
- Standard instance type (t3.medium)
- Basic Discord integration

**Setup time:** ~15 minutes

**Steps:**
1. Copy to project root: `cp examples/.env.minimal .env`
2. Fill in Discord credentials (see [Discord Setup Guide](../docs/discord-setup.md))
3. Update `WORLD_1_DISCORD_ID` with your Discord server ID
4. Change `WORLD_1_PASSWORD` to something secure
5. Deploy: `npm run deploy`

---

### `.env.full-featured`
**Use this if:** You want to see all available features and options

**Features:**
- Multiple worlds (3 worlds configured)
- Custom domain setup (Route 53)
- Larger instance type for better performance
- Aggressive backup strategy
- Per-world backup overrides
- Additional Docker container features (auto-updates, scheduled restarts)

**Setup time:** ~30-45 minutes (includes Route 53 setup)

**Steps:**
1. Copy to project root: `cp examples/.env.full-featured .env`
2. Fill in Discord credentials
3. Configure custom domain (or comment out `CUSTOM_URL`)
4. Update world configurations as needed
5. Adjust instance type based on budget
6. Deploy: `npm run deploy`

---

## Quick Comparison

| Feature | Minimal | Full-Featured |
|---------|---------|---------------|
| **Worlds** | 1 | 3 |
| **Instance** | t3.medium | t3.large |
| **Cost/month** | ~$5-15 | ~$15-30 |
| **Backup freq** | 2 hours | 30-60 min |
| **S3 retention** | 7 days | 14 days |
| **Custom domain** | ❌ | ✅ |
| **Auto-updates** | ❌ | ✅ |
| **Daily restart** | ❌ | ✅ |
| **Setup time** | 15 min | 30-45 min |

## Customizing Your Configuration

You don't have to use these exactly as-is! Mix and match features:

### Common Customizations

**Add custom domain to minimal config:**
```bash
# In your .env
CUSTOM_URL=valheim.yourdomain.com
```

**Reduce costs in full-featured:**
```bash
# Use smaller instance
VALHEIM_INSTANCE_TYPE=t3.medium

# Reduce backup retention
BACKUPS_TO_KEEP=7
DOCKER_BACKUP_MAX_COUNT=12
```

**Add more worlds:**
```bash
# Copy the WORLD_2_* pattern
WORLD_4_NAME=NewWorld
WORLD_4_WORLD_NAME=Helheim
WORLD_4_PASSWORD=password123
WORLD_4_DISCORD_ID=your_discord_id

# Update count
WORLD_COUNT=4
```

## Environment Variable Documentation

For detailed explanation of each variable, see:
- [.env.example](../.env.example) - Full configuration with comments
- [AWS Setup Guide](../docs/aws-setup.md) - AWS-specific settings
- [Discord Setup Guide](../docs/discord-setup.md) - Discord configuration
- [lloesche/valheim-server-docker](https://github.com/lloesche/valheim-server-docker#environment-variables) - Docker container variables

## Getting Help

- **Troubleshooting:** See [docs/troubleshooting.md](../docs/troubleshooting.md)
- **README:** See [README.md](../README.md)
- **GitHub Issues:** Create an issue for bugs or questions
