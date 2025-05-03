# HuginBot Discord Bot Test Plan

This test plan outlines the manual testing steps to verify the functionality of the enhanced Discord bot integration. These tests should be performed in a development environment before deploying to production.

## Prerequisites

1. AWS resources are properly deployed:
   - EC2 instance for Valheim server is configured
   - Lambda functions are deployed
   - S3 bucket for backups is created
   - SSM parameters are set up

2. Discord bot is set up:
   - Bot token is configured
   - Bot is added to a test server
   - Bot has appropriate permissions
   - Slash commands are registered

## Test Cases

### 1. Status Command

#### Test 1.1: Basic Status Check
- **Command**: `/status check`
- **Expected Result**: Rich embed showing current server status (online/offline)
- **Pass Criteria**: 
  - Embed shows correct status with appropriate color coding
  - Status information is accurately displayed

#### Test 1.2: Status Dashboard
- **Command**: `/status dashboard`
- **Expected Result**: Interactive dashboard with refresh, start, and stop buttons
- **Pass Criteria**:
  - Dashboard displays with all buttons
  - Buttons are enabled/disabled based on current server state
  - Refresh button updates the status display
  - Dashboard expires after 1 hour

### 2. Start Command

#### Test 2.1: Starting Server
- **Command**: `/start`
- **Expected Result**: Progress bar updates showing server startup progress
- **Pass Criteria**:
  - Initial 0% progress display appears
  - Progress updates to 25%, 50%, 75%, and 100%
  - Final success message contains accurate world information
  - Server actually starts (verify via EC2 console)

#### Test 2.2: Starting Server with Specific World
- **Command**: `/start world:MyWorld`
- **Expected Result**: Server starts with specified world
- **Pass Criteria**:
  - Progress indicators show
  - Final success message shows correct world name
  - Server loads with correct world configuration

#### Test 2.3: Ephemeral Response
- **Command**: `/start private:true`
- **Expected Result**: Start progress is only visible to command user
- **Pass Criteria**:
  - Response is marked as "Only you can see this"
  - Other users cannot see the command response

### 3. Stop Command

#### Test 3.1: Stopping Server
- **Command**: `/stop`
- **Expected Result**: Confirmation dialog with "Stop Server" and "Cancel" buttons
- **Pass Criteria**:
  - Confirmation dialog appears
  - Clicking "Cancel" aborts the operation
  - Clicking "Stop Server" initiates shutdown
  - Shutdown progress is displayed
  - Server actually stops (verify via EC2 console)

#### Test 3.2: Ephemeral Response
- **Command**: `/stop private:true`
- **Expected Result**: Stop confirmation is only visible to command user
- **Pass Criteria**:
  - Response is marked as "Only you can see this"
  - Other users cannot see the command response

### 4. Error Handling

#### Test 4.1: Configuration Error
- **Command**: `/start` (with no world configured)
- **Expected Result**: Rich error embed with configuration instructions
- **Pass Criteria**:
  - Error embed shows with red color
  - Error message explains the issue
  - Instructions for fixing the issue are provided

#### Test 4.2: Invalid Command
- **Action**: Try to use a button after its collector has expired
- **Expected Result**: Graceful error message
- **Pass Criteria**:
  - Error message is displayed
  - Bot continues functioning normally

### 5. Webhooks

#### Test 5.1: Join Code Notification
- **Action**: Start server and wait for join code
- **Expected Result**: Rich embed notification with join code
- **Pass Criteria**:
  - Embed contains server world information
  - Join code is prominently displayed
  - Visual elements like thumbnails and images load properly

#### Test 5.2: Shutdown Notification
- **Action**: Wait for server to auto-shutdown (or manually trigger)
- **Expected Result**: Rich embed notification for shutdown
- **Pass Criteria**:
  - Embed shows shutdown reason
  - Embed contains buttons for restarting
  - Visuals load properly

## Test Execution

| Test ID | Test Date | Tester | Result | Notes |
|---------|-----------|--------|--------|-------|
| 1.1     |           |        |        |       |
| 1.2     |           |        |        |       |
| 2.1     |           |        |        |       |
| 2.2     |           |        |        |       |
| 2.3     |           |        |        |       |
| 3.1     |           |        |        |       |
| 3.2     |           |        |        |       |
| 4.1     |           |        |        |       |
| 4.2     |           |        |        |       |
| 5.1     |           |        |        |       |
| 5.2     |           |        |        |       |

## Issues Found

| Issue ID | Test Reference | Description | Severity | Status |
|----------|---------------|-------------|----------|--------|
|          |               |             |          |        |

## Notes for Future Enhancements

- Add tests for worlds command with select menus
- Add tests for controls command with interactive buttons
- Add tests for help command pagination
- Add tests for permission restrictions