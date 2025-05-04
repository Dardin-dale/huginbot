/**
 * HuginBot CLI - AWS Utilities
 * This module provides utility functions for interacting with AWS services
 */

const { SSM } = require('@aws-sdk/client-ssm');
const { EC2 } = require('@aws-sdk/client-ec2');
const { CloudFormation } = require('@aws-sdk/client-cloudformation');
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { spawn } = require('child_process');
const ora = require('ora');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const { getConfig } = require('./config');

// Initialize AWS clients
const getSSMClient = () => new SSM();
const getEC2Client = () => new EC2();
const getCloudFormationClient = () => new CloudFormation();
const getS3Client = () => new S3Client();

/**
 * Check if AWS credentials are configured
 * @returns {Promise<boolean>} True if credentials are valid, false otherwise
 */
async function checkAwsCredentials() {
  try {
    const ssm = getSSMClient();
    await ssm.listParameters({ MaxResults: 1 });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Guide user through AWS profile setup
 * @returns {Promise<boolean>} True if setup was successful, false otherwise
 */
async function setupAwsProfile() {
  console.log(chalk.cyan('Setting up AWS profile...'));
  console.log('You will need your AWS Access Key ID and Secret Access Key.');
  console.log('These can be obtained from the AWS Management Console under IAM.');
  
  // Launch aws configure command
  return new Promise((resolve, reject) => {
    const aws = spawn('aws', ['configure'], { stdio: 'inherit' });
    
    aws.on('close', (code) => {
      if (code === 0) {
        console.log(chalk.green('AWS credentials configured successfully'));
        resolve(true);
      } else {
        console.error(chalk.red('Failed to configure AWS credentials'));
        resolve(false);
      }
    });
  });
}

/**
 * Check if a CloudFormation stack exists
 * @param {string} stackName - The name of the stack to check
 * @returns {Promise<boolean>} True if the stack exists, false otherwise
 */
async function isStackDeployed(stackName) {
  try {
    const cloudformation = getCloudFormationClient();
    await cloudformation.describeStacks({ StackName: stackName });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Get EC2 instance status
 * @param {boolean} detailed - Whether to return detailed instance information
 * @returns {Promise<string|object>} Instance state or detailed status object
 */
async function getInstanceStatus(detailed = false) {
  try {
    const config = getConfig();
    const instanceId = config.instanceId;
    
    if (!instanceId) {
      return detailed ? { state: 'not_deployed' } : 'not_deployed';
    }
    
    if (detailed) {
      return await getInstanceDetails(instanceId);
    }
    
    const ec2 = getEC2Client();
    const result = await ec2.describeInstanceStatus({
      InstanceIds: [instanceId],
      IncludeAllInstances: true
    });
    
    if (result.InstanceStatuses.length === 0) {
      return 'unknown';
    }
    
    return result.InstanceStatuses[0].InstanceState.Name;
  } catch (error) {
    console.error('Error getting instance status:', error);
    return detailed ? { state: 'error', error: error.message } : 'error';
  }
}

/**
 * Get instance details including public IP
 * @param {string} instanceId - The instance ID to check
 * @returns {Promise<Object>} Object containing instance details
 */
async function getInstanceDetails(instanceId) {
  try {
    if (!instanceId) {
      throw new Error('Instance ID not provided');
    }
    
    const ec2 = getEC2Client();
    const result = await ec2.describeInstances({
      InstanceIds: [instanceId]
    });
    
    if (!result.Reservations || result.Reservations.length === 0 || 
        !result.Reservations[0].Instances || result.Reservations[0].Instances.length === 0) {
      throw new Error('Instance not found');
    }
    
    const instance = result.Reservations[0].Instances[0];
    
    return {
      state: instance.State.Name,
      publicIp: instance.PublicIpAddress || null,
      privateIp: instance.PrivateIpAddress || null,
      instanceType: instance.InstanceType,
      launchTime: instance.LaunchTime,
      tags: instance.Tags || []
    };
  } catch (error) {
    console.error('Error getting instance details:', error);
    throw error;
  }
}

/**
 * Start the EC2 instance for the Valheim server
 * @returns {Promise<Object>} Result of the start operation
 */
async function startEC2Instance() {
  try {
    const config = getConfig();
    const instanceId = config.instanceId;
    
    if (!instanceId) {
      throw new Error('No instance ID found in configuration');
    }
    
    const ec2 = getEC2Client();
    return await ec2.startInstances({ InstanceIds: [instanceId] });
  } catch (error) {
    console.error('Error starting instance:', error);
    throw error;
  }
}

/**
 * Stop the EC2 instance for the Valheim server
 * @returns {Promise<Object>} Result of the stop operation
 */
async function stopEC2Instance() {
  try {
    const config = getConfig();
    const instanceId = config.instanceId;
    
    if (!instanceId) {
      throw new Error('No instance ID found in configuration');
    }
    
    const ec2 = getEC2Client();
    return await ec2.stopInstances({ InstanceIds: [instanceId] });
  } catch (error) {
    console.error('Error stopping instance:', error);
    throw error;
  }
}

/**
 * Get the server's public address
 * @returns {Promise<string>} The server connection address
 */
async function getServerAddress() {
  try {
    const config = getConfig();
    const instanceId = config.instanceId;
    
    if (!instanceId) {
      throw new Error('No instance ID found in configuration');
    }
    
    const ec2 = getEC2Client();
    const result = await ec2.describeInstances({
      InstanceIds: [instanceId]
    });
    
    if (!result.Reservations || result.Reservations.length === 0 || 
        !result.Reservations[0].Instances || result.Reservations[0].Instances.length === 0) {
      throw new Error('Instance not found');
    }
    
    const publicIp = result.Reservations[0].Instances[0].PublicIpAddress;
    
    if (!publicIp) {
      throw new Error('Instance does not have a public IP address');
    }
    
    return `${publicIp}:2456`;
  } catch (error) {
    console.error('Error getting server address:', error);
    throw error;
  }
}

/**
 * Wait for the Valheim server to be ready
 * @param {number} timeout - Timeout in milliseconds (default: 5 minutes)
 * @returns {Promise<boolean>} True if the server is ready
 */
async function waitForServerReady(timeout = 300000) {
  try {
    const config = getConfig();
    const instanceId = config.instanceId;
    
    if (!instanceId) {
      throw new Error('No instance ID found in configuration');
    }
    
    // Wait for instance to be in running state
    let status = await getInstanceStatus();
    let startTime = Date.now();
    
    while (status !== 'running') {
      if (Date.now() - startTime > timeout) {
        throw new Error('Timeout waiting for instance to start');
      }
      
      // Wait 5 seconds before checking again
      await new Promise(resolve => setTimeout(resolve, 5000));
      status = await getInstanceStatus();
    }
    
    // Now wait for Valheim server to be running
    const ssm = getSSMClient();
    startTime = Date.now();
    let serverReady = false;
    
    while (!serverReady) {
      if (Date.now() - startTime > timeout) {
        throw new Error('Timeout waiting for Valheim server to initialize');
      }
      
      try {
        // Check if the server is running by checking Docker container status
        const result = await ssm.sendCommand({
          DocumentName: 'AWS-RunShellScript',
          InstanceIds: [instanceId],
          Parameters: {
            commands: ['docker ps --format "{{.Names}} {{.Status}}" | grep -i valheim']
          }
        });
        
        // Wait a bit for the command to complete
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Get the command result
        const commandId = result.Command.CommandId;
        const output = await ssm.getCommandInvocation({
          CommandId: commandId,
          InstanceId: instanceId
        });
        
        if (output.Status === 'Success' && 
            output.StandardOutputContent && 
            output.StandardOutputContent.includes('Up')) {
          serverReady = true;
        }
      } catch (error) {
        // Continue waiting, as this might fail during initialization
      }
      
      if (!serverReady) {
        // Wait 10 seconds before checking again
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }
    
    return true;
  } catch (error) {
    console.error('Error waiting for server to be ready:', error);
    throw error;
  }
}

/**
 * Create a backup of the current world
 * @returns {Promise<boolean>} True if backup was successful
 */
async function createBackup() {
  try {
    const config = getConfig();
    const instanceId = config.instanceId;
    
    if (!instanceId) {
      throw new Error('No instance ID found in configuration');
    }
    
    // Execute backup script on the EC2 instance using SSM
    const ssm = getSSMClient();
    await ssm.sendCommand({
      DocumentName: 'AWS-RunShellScript',
      InstanceIds: [instanceId],
      Parameters: {
        commands: ['/usr/local/bin/backup-valheim.sh']
      }
    });
    
    return true;
  } catch (error) {
    console.error('Error creating backup:', error);
    throw error;
  }
}

/**
 * Restart the server with the new world
 * @returns {Promise<boolean>} True if restart was successful
 */
async function restartServer() {
  try {
    const config = getConfig();
    const instanceId = config.instanceId;
    
    if (!instanceId) {
      throw new Error('No instance ID found in configuration');
    }
    
    // Execute the world switching script on the EC2 instance
    const ssm = getSSMClient();
    await ssm.sendCommand({
      DocumentName: 'AWS-RunShellScript',
      InstanceIds: [instanceId],
      Parameters: {
        commands: ['/usr/local/bin/switch-valheim-world.sh']
      }
    });
    
    return true;
  } catch (error) {
    console.error('Error restarting server:', error);
    throw error;
  }
}

/**
 * Update the active world in SSM Parameter Store
 * @param {Object} worldConfig - The world configuration to set as active
 * @returns {Promise<boolean>} True if update was successful
 */
async function updateActiveWorld(worldConfig) {
  try {
    const ssm = getSSMClient();
    const paramName = '/huginbot/active-world';
    
    await ssm.putParameter({
      Name: paramName,
      Value: JSON.stringify(worldConfig),
      Type: 'String',
      Overwrite: true
    });
    
    // Update local config as well
    const config = getConfig();
    config.activeWorld = worldConfig.name;
    
    // Track the parameter
    const { trackParameter } = require('./parameter-tracker');
    trackParameter(
      paramName,
      `Active world configuration for ${worldConfig.name}`,
      `world:${worldConfig.name}`
    );
    
    return true;
  } catch (error) {
    console.error('Error updating active world:', error);
    throw error;
  }
}

/**
 * Get the active world from SSM Parameter Store
 * @returns {Promise<Object>} The active world configuration
 */
async function getActiveWorldFromSSM() {
  try {
    const ssm = getSSMClient();
    
    const result = await ssm.getParameter({
      Name: '/huginbot/active-world'
    });
    
    if (result.Parameter?.Value) {
      return JSON.parse(result.Parameter.Value);
    }
    
    throw new Error('Active world parameter not found');
  } catch (error) {
    console.error('Error getting active world:', error);
    throw error;
  }
}

/**
 * List available backups in S3
 * @param {string} bucketName - The S3 bucket name
 * @param {string} worldName - (Optional) The world name to filter by
 * @returns {Promise<Array>} Array of backup objects
 */
async function listBackups(bucketName, worldName = null) {
  try {
    const s3 = getS3Client();
    
    // If worldName is provided, list only backups for that world
    const prefix = worldName ? `worlds/${worldName}/` : 'worlds/';
    
    const listCommand = new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: prefix
    });
    
    const response = await s3.send(listCommand);
    
    if (!response.Contents) {
      return [];
    }
    
    // Filter for .tar.gz files and sort by last modified date (newest first)
    return response.Contents
      .filter(item => item.Key && item.Key.endsWith('.tar.gz'))
      .sort((a, b) => {
        const dateA = a.LastModified ? a.LastModified.getTime() : 0;
        const dateB = b.LastModified ? b.LastModified.getTime() : 0;
        return dateB - dateA; // Sort descending
      })
      .map(item => ({
        key: item.Key,
        size: item.Size,
        lastModified: item.LastModified,
        worldName: item.Key.split('/')[1] // Extract world name from path
      }));
  } catch (error) {
    console.error('Error listing backups:', error);
    throw error;
  }
}

/**
 * Download a backup from S3
 * @param {string} bucketName - The S3 bucket name
 * @param {string} key - The S3 object key
 * @param {string} downloadPath - The local path to save the file
 * @returns {Promise<string>} The path to the downloaded file
 */
async function downloadBackup(bucketName, key, downloadPath) {
  try {
    const s3 = getS3Client();
    
    // Create directory if it doesn't exist
    const dir = path.dirname(downloadPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Download file
    const getCommand = new GetObjectCommand({
      Bucket: bucketName,
      Key: key
    });
    
    const { Body } = await s3.send(getCommand);
    const fileStream = fs.createWriteStream(downloadPath);
    
    await new Promise((resolve, reject) => {
      Body.pipe(fileStream);
      Body.on('error', reject);
      fileStream.on('finish', resolve);
    });
    
    return downloadPath;
  } catch (error) {
    console.error('Error downloading backup:', error);
    throw error;
  }
}

/**
 * Get CloudFormation stack outputs
 * @param {string} stackName - The stack name
 * @returns {Promise<Object>} Dictionary of stack outputs
 */
async function getStackOutputs(stackName) {
  try {
    const cloudformation = getCloudFormationClient();
    const result = await cloudformation.describeStacks({ StackName: stackName });
    
    if (!result.Stacks || result.Stacks.length === 0) {
      throw new Error(`Stack ${stackName} not found`);
    }
    
    const outputs = {};
    
    if (result.Stacks[0].Outputs) {
      result.Stacks[0].Outputs.forEach(output => {
        outputs[output.OutputKey] = output.OutputValue;
      });
    }
    
    return outputs;
  } catch (error) {
    console.error(`Error getting outputs for stack ${stackName}:`, error);
    throw error;
  }
}

module.exports = {
  checkAwsCredentials,
  setupAwsProfile,
  isStackDeployed,
  getInstanceStatus,
  getInstanceDetails,
  startEC2Instance,
  stopEC2Instance,
  getServerAddress,
  waitForServerReady,
  createBackup,
  restartServer,
  updateActiveWorld,
  getActiveWorldFromSSM,
  listBackups,
  downloadBackup,
  getStackOutputs
};