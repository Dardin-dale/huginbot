# HuginBot TODO List

This file tracks features that are planned but not yet implemented.

## 🎯 High Priority

### CLI Commands
- [ ] **Discord Log Viewing** - `npm run cli -- discord logs`
  - View Discord Lambda function logs from CloudWatch
  - Filter by severity level
  - Real-time log streaming

- [ ] **Advanced Server Settings** - Advanced configuration menu
  - Custom server arguments
  - Mod management interface
  - Performance tuning options

### Discord Integration
- [ ] **Slash Command Updates** - Dynamic command registration
  - Update commands without redeployment
  - Command permission management
  - Custom command responses

### Backup Management
- [ ] **Backup Restoration** - `npm run cli -- backup restore`
  - Select and restore from S3 backups
  - Validation before restore
  - Progress tracking

- [ ] **Backup Downloads** - `npm run cli -- backup download`
  - Download backups to local machine
  - Progress indicators
  - Integrity checking

## 🔧 Medium Priority

### World Management
- [ ] **World Templates** - Pre-configured world setups
  - Vanilla worlds
  - Modded world configurations
  - Custom world seeds

### Monitoring & Analytics
- [ ] **Player Statistics** - Track gameplay metrics
  - Play time tracking
  - Player activity patterns
  - Performance metrics

- [ ] **Server Health Monitoring** - Real-time server monitoring
  - Resource usage tracking
  - Performance alerts
  - Automated scaling recommendations

### User Interface
- [ ] **Web Dashboard** - Browser-based management interface
  - Server status overview
  - World management
  - Player statistics

## 🚀 Future Enhancements

### Multi-Server Support
- [ ] **Multiple Server Instances** - Manage multiple Valheim servers
  - Per-server world configurations
  - Load balancing
  - Cross-server player management

### Integration & API
- [ ] **REST API** - Public API for third-party integrations
  - Server management endpoints
  - Webhook notifications
  - Authentication system

### Advanced Features
- [ ] **Mod Management** - Automated mod installation and updates
  - BepInEx plugin management
  - Mod compatibility checking
  - Version control

- [ ] **Custom Events** - Discord events and notifications
  - Player join/leave events
  - Boss defeat notifications
  - Custom trigger events

## ⚠️ Known Issues

### CLI Issues
- [ ] Some CLI commands show errors instead of "coming soon" messages
- [ ] Old Discord stack references need updating
- [ ] Missing graceful error handling for unimplemented features

### Documentation
- [ ] Add command examples to help text
- [ ] Create troubleshooting guides
- [ ] Add configuration examples

---

## 🤝 Contributing

When implementing features from this TODO list:

1. Move the item from TODO to DONE
2. Update the CLI help text
3. Add tests for new functionality
4. Update documentation in README.md and CLAUDE.md
5. Test with the Discord integration

## ✅ Recently Completed

- [x] **Stack Consolidation** - Merged HuginbotStack into ValheimStack
- [x] **Discord Ed25519 Authentication** - Proper Discord signature verification
- [x] **Setup Wizard Improvements** - Show API Gateway URL and open Discord portal
- [x] **TypeScript Build Fixes** - Resolved Jest mock type issues