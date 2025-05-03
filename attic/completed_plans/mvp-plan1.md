# HuginBot MVP Week 1: Core Functionality Plan

## Overview

This document outlines the key focus areas for Week 1 of the HuginBot MVP development. The goal is to ensure the core functionality is solid and reliable before moving on to CLI improvements and Discord integration.

## Current Status

After analyzing the codebase, we have identified the following core components:

1. **AWS Infrastructure** - EC2-based Valheim server using CDK
2. **Server Management** - Start/stop/status functionality
3. **World Management** - Creation, switching, and configuration of worlds
4. **Backup System** - S3-based backup and restore
5. **Discord Integration** - Webhook-based notifications

## Critical Path for MVP

### 1. Server Deployment & Management

#### Current Implementation
- EC2 instance creation via CDK
- Basic start/stop via Lambda functions
- Status checking via EC2 APIs
- Docker container for Valheim server

#### Necessary Improvements
- [ ] **Error Recovery** - Add retry logic for AWS API calls in Lambda functions
- [ ] **State Consistency** - Ensure server state is always accurately reported
- [ ] **Startup Verification** - Verify server is fully operational after startup
- [ ] **Graceful Shutdown** - Ensure world data is saved before stopping the server

```typescript
// Example improved server status check with retry logic
async function getServerStatus(): Promise<string> {
  const maxRetries = 3;
  let retryCount = 0;
  
  while (retryCount < maxRetries) {
    try {
      const status = await ec2Client.send(new DescribeInstancesCommand({
        InstanceIds: [VALHEIM_INSTANCE_ID]
      }));
      
      // Verify response contains expected data
      if (!status.Reservations || status.Reservations.length === 0) {
        throw new Error('Invalid response structure');
      }
      
      return status.Reservations[0].Instances[0].State.Name;
    } catch (error) {
      retryCount++;
      if (retryCount >= maxRetries) {
        console.error('Failed to get server status after multiple attempts:', error);
        throw error;
      }
      
      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retryCount)));
    }
  }
  
  return 'unknown';
}
```

### 2. World Management

#### Current Implementation
- World configuration in SSM Parameter Store
- Switching via shell script on EC2 instance
- Limited validation of world data

#### Necessary Improvements
- [ ] **Validation** - Add validation for world configurations
- [ ] **Error Handling** - Improve error handling in world switching
- [ ] **Locking** - Prevent concurrent world operations
- [ ] **Status Tracking** - Track world switch status and handle failures

```typescript
// Example validation function for world configurations
function validateWorldConfig(worldConfig: WorldConfig): string[] {
  const errors: string[] = [];
  
  if (!worldConfig.name || worldConfig.name.trim() === '') {
    errors.push('World name cannot be empty');
  }
  
  if (!worldConfig.worldName || worldConfig.worldName.trim() === '') {
    errors.push('Valheim world name cannot be empty');
  }
  
  if (!worldConfig.serverPassword || worldConfig.serverPassword.length < 5) {
    errors.push('Server password must be at least 5 characters');
  }
  
  return errors;
}
```

### 3. Backup and Restore

#### Current Implementation
- S3-based backup storage
- Basic backup creation via shell script
- Manual restoration process

#### Necessary Improvements
- [ ] **Backup Validation** - Verify backup integrity after creation
- [ ] **Automated Restore** - Streamline the restore process
- [ ] **Backup Rotation** - Ensure old backups are properly cleaned up
- [ ] **Error Recovery** - Add retry logic for failed backups
- [ ] **Progress Reporting** - Provide feedback during backup/restore operations

```typescript
// Example backup validation function
async function validateBackup(bucketName: string, backupKey: string): Promise<boolean> {
  try {
    // Check if backup exists
    const headObjectCommand = new HeadObjectCommand({
      Bucket: bucketName,
      Key: backupKey
    });
    
    await s3Client.send(headObjectCommand);
    
    // Check backup size (should be at least 1KB for valid backups)
    const result = await s3Client.send(new GetObjectCommand({
      Bucket: bucketName,
      Key: backupKey
    }));
    
    const size = parseInt(result.ContentLength?.toString() || '0');
    if (size < 1024) {
      console.error(`Backup ${backupKey} is too small (${size} bytes)`);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('Error validating backup:', error);
    return false;
  }
}
```

### 4. Discord Integration

#### Current Implementation
- Webhook-based notifications
- Basic event reporting (server start/stop)
- Player join/leave notifications

#### Necessary Improvements
- [ ] **Webhook Validation** - Verify webhook URLs are valid before storing
- [ ] **Error Handling** - Improve error handling for webhook failures
- [ ] **Rate Limiting** - Ensure Discord rate limits are respected
- [ ] **Message Formatting** - Enhance message formatting for better readability
- [ ] **Command Response Time** - Ensure commands respond quickly even if operations take time

```typescript
// Example webhook validation function
async function validateWebhook(webhookUrl: string): Promise<boolean> {
  try {
    // Send a test message to the webhook
    const response = await axios.post(webhookUrl, {
      content: 'Webhook test',
      username: 'HuginBot',
      // Set a flag to identify this as a test
      embeds: [{
        title: 'Webhook Test',
        description: 'This is a test message to verify the webhook configuration',
        footer: {
          text: 'HuginBot Webhook Test'
        }
      }]
    });
    
    return response.status === 204; // Discord returns 204 No Content for successful webhook calls
  } catch (error) {
    console.error('Webhook validation failed:', error);
    return false;
  }
}
```

## Technical Debt to Address

1. **Error Handling Consistency**
   - Many functions have inconsistent error handling
   - Some errors are logged but not propagated
   - Some errors are swallowed completely

2. **Resource Cleanup**
   - EC2 termination protection needs to be reviewed
   - S3 bucket lifecycle configurations need to be verified
   - Lambda function timeouts should be optimized

3. **Security Improvements**
   - IAM permissions should be reviewed for least privilege
   - Secrets management could be improved
   - Network security for the EC2 instance should be tightened

## Testing Plan

### Manual Testing Scenarios

1. **Server Deployment**
   - Deploy server from clean state
   - Verify all resources are created correctly
   - Check server is accessible

2. **Server Operations**
   - Start server from stopped state
   - Check server reaches running state
   - Stop server and verify it stops cleanly
   - Verify server data is preserved

3. **World Management**
   - Create a new world
   - Switch to the new world
   - Verify game uses the correct world
   - Delete world and verify it's removed

4. **Backup and Restore**
   - Create manual backup
   - Verify backup is created in S3
   - Restore from backup
   - Verify world data is intact

5. **Error Scenarios**
   - Attempt to start already running server
   - Try to stop already stopped server
   - Switch to non-existent world
   - Restore from invalid backup

### Automated Testing Improvements

1. **Component Tests**
   - Create tests for individual Lambda functions
   - Mock AWS services using aws-sdk-mock
   - Test error handling and recovery

2. **Integration Tests**
   - Set up a test environment
   - Use real AWS resources with unique naming
   - Test end-to-end workflows with real AWS services

```typescript
// Example component test for server status
test('getServerStatus handles EC2 API failure', async () => {
  // Mock EC2 client to simulate failure
  const mockSend = jest.fn().mockRejectedValueOnce(new Error('API failure'));
  
  // Temporarily replace the client's send method
  const originalSend = ec2Client.send;
  ec2Client.send = mockSend;
  
  try {
    // Function should throw after retrying
    await expect(getServerStatus()).rejects.toThrow('API failure');
    
    // Should have been called maxRetries times
    expect(mockSend).toHaveBeenCalledTimes(3);
  } finally {
    // Restore original method
    ec2Client.send = originalSend;
  }
});
```

## Implementation Priority

1. **Critical Functionality**
   - Error handling in server operations
   - Backup validation and recovery
   - World switching reliability

2. **User Experience**
   - Improved status reporting
   - Better error messages
   - Progress indicators for long operations

3. **Maintenance**
   - Logging improvements
   - Resource cleanup
   - Security enhancements

## Timeline

### Day 1-2: Reliability Improvements
- Implement retry logic in AWS API calls
- Add validation for world configurations
- Improve error handling in critical paths

### Day 3-4: Backup System Enhancements
- Add backup validation
- Implement improved restore functionality
- Add backup rotation and cleanup

### Day 5: Testing and Fixes
- Create and run manual test scenarios
- Identify and fix any issues found
- Document known limitations

## Conclusion

Week 1 focuses on strengthening the core functionality of HuginBot to ensure it provides a reliable foundation for the MVP. By addressing these critical areas, we'll have a solid base to build upon in the following weeks when we improve the CLI experience and enhance the Discord integration.

The primary goal is stability and reliability rather than new features, ensuring that the basic server management, world handling, and backup capabilities work correctly in all scenarios.