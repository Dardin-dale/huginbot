/*
 * HuginBot CLI - AWS Utilities
 * This module provides utility functions for interacting with AWS services
 */

const { SSM, ListParametersCommand } = require('@aws-sdk/client-ssm');
const { STSClient, GetCallerIdentityCommand } = require('@aws-sdk/client-sts');
const { fromIni, defaultProvider } = require('@aws-sdk/credential-provider-node');
const { EC2 } = require('@aws-sdk/client-ec2');
const { CloudFormation } = require('@aws-sdk/client-cloudformation');
const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const { spawn } = require('child_process');
const ora = require('ora');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
require('dotenv').config(); // Load .env file variables
const { getConfig, saveConfig } = require('./config');

/**
 * Get standard AWS configuration including region and credentials
 * @returns {Object} AWS configuration object
 */
function getAwsConfig() {
    const config = getConfig();
    const awsConfig = {
        region: process.env.AWS_REGION || config.awsRegion || 'us-west-2',
        // Use defaultProvider which will check environment variables, 
        // shared ini files, EC2/ECS credentials, and process.env
        credentials: defaultProvider()
    };

    return awsConfig;
}

// Initialize AWS clients with consistent configuration
const getSSMClient = () => new SSM(getAwsConfig());
const getEC2Client = () => new EC2(getAwsConfig());
const getCloudFormationClient = () => new CloudFormation(getAwsConfig());
const getS3Client = () => new S3Client(getAwsConfig());
const getSTSClient = () => new STSClient(getAwsConfig());

/**
 * Check if AWS credentials are configured
 * @returns {Promise<boolean>} True if credentials are valid, false otherwise
 */
async function checkAwsCredentials() {
    try {
        const sts = getSTSClient();
        const command = new GetCallerIdentityCommand({});

        try {
            const response = await sts.send(command);
            console.log(chalk.green(`✓ AWS credentials valid (Account: ${response.Account})`));

            // Save the account ID to config for reference
            const config = getConfig();
            if (!config.awsAccountId || config.awsAccountId !== response.Account) {
                saveConfig({ awsAccountId: response.Account });
            }

            return true;
        } catch (credError) {
            // Check if we have environment variable credentials
            if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
                console.log(chalk.yellow('AWS credentials found in environment variables but may be invalid'));
                return false;
            }
            throw credError;
        }
    } catch (error) {
        // Provide specific error messages
        if (error.name === 'CredentialsProviderError') {
            console.log(chalk.red('AWS credentials not found'));
            console.log(chalk.yellow('Try running: aws configure'));
        } else if (error.name === 'InvalidUserID.NotFound' || error.name === 'InvalidClientTokenId') {
            console.log(chalk.red('AWS credentials are invalid'));
            console.log(chalk.yellow('Your access key or secret key may be incorrect'));
        } else if (error.message.includes('Could not load credentials')) {
            console.log(chalk.red('No AWS credentials found in any standard location'));
            console.log(chalk.yellow('Configure with: aws configure'));
        } else if (error.message.includes('ExpiredToken')) {
            console.log(chalk.red('AWS credentials have expired'));
            console.log(chalk.yellow('If using temporary credentials, please refresh them'));
        } else {
            console.log(chalk.red(`AWS authentication error: ${error.message}`));
        }

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

    // Check if AWS CLI is installed
    try {
        await new Promise((resolve, reject) => {
            const aws = spawn('aws', ['--version'], { stdio: 'pipe' });
            aws.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error('AWS CLI not found'));
            });
        });
    } catch (error) {
        console.log(chalk.red('AWS CLI is not installed.'));
        console.log('Please install it from: https://aws.amazon.com/cli/');
        return false;
    }

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
        const result = await cloudformation.describeStacks({ StackName: stackName });

        // Check if stack is in a valid state (not in DELETE_COMPLETE)
        if (result.Stacks && result.Stacks.length > 0) {
            const stack = result.Stacks[0];
            return stack.StackStatus !== 'DELETE_COMPLETE';
        }

        return false;
    } catch (error) {
        if (error.name === 'ValidationError' && error.message.includes('does not exist')) {
            return false;
        }
        // Re-throw other errors
        throw error;
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
        if (error.name === 'InvalidInstanceID.NotFound') {
            return detailed ? { state: 'not_found' } : 'not_found';
        }
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
        const result = await ec2.startInstances({ InstanceIds: [instanceId] });

        if (result.StartingInstances && result.StartingInstances.length > 0) {
            const instance = result.StartingInstances[0];
            console.log(chalk.green(`Instance ${instanceId} is starting (previous state: ${instance.PreviousState.Name})`));
        }

        return result;
    } catch (error) {
        if (error.name === 'InvalidInstanceID.NotFound') {
            throw new Error(`Instance ${config.instanceId} not found in AWS`);
        }
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
        const result = await ec2.stopInstances({ InstanceIds: [instanceId] });

        if (result.StoppingInstances && result.StoppingInstances.length > 0) {
            const instance = result.StoppingInstances[0];
            console.log(chalk.green(`Instance ${instanceId} is stopping (previous state: ${instance.PreviousState.Name})`));
        }

        return result;
    } catch (error) {
        if (error.name === 'InvalidInstanceID.NotFound') {
            throw new Error(`Instance ${config.instanceId} not found in AWS`);
        }
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
                console.warn('Still waiting for server to initialize...');
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
        const result = await ssm.sendCommand({
            DocumentName: 'AWS-RunShellScript',
            InstanceIds: [instanceId],
            Parameters: {
                commands: ['/usr/local/bin/backup-valheim.sh']
            }
        });

        console.log(chalk.green(`Backup command sent (Command ID: ${result.Command.CommandId})`));

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
        const result = await ssm.sendCommand({
            DocumentName: 'AWS-RunShellScript',
            InstanceIds: [instanceId],
            Parameters: {
                commands: ['/usr/local/bin/switch-valheim-world.sh']
            }
        });

        console.log(chalk.green(`Restart command sent (Command ID: ${result.Command.CommandId})`));

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

        // Clone the world config to avoid modifying the original
        const worldConfigToStore = JSON.parse(JSON.stringify(worldConfig));

        // Make sure overrides exist in the config
        if (!worldConfigToStore.overrides) {
            worldConfigToStore.overrides = {};
        }

        // Log the overrides for debugging
        if (Object.keys(worldConfigToStore.overrides).length > 0) {
            console.log(chalk.cyan('World overrides will be applied:'));
            Object.entries(worldConfigToStore.overrides).forEach(([key, value]) => {
                console.log(`  ${key}: ${value}`);
            });
        }

        await ssm.putParameter({
            Name: paramName,
            Value: JSON.stringify(worldConfigToStore),
            Type: 'String',
            Overwrite: true
        });

        // Update local config as well
        const config = getConfig();
        config.activeWorld = worldConfigToStore.name;
        saveConfig(config);

        // Track the parameter
        const { trackParameter } = require('./parameter-tracker');
        trackParameter(
            paramName,
            `Active world configuration for ${worldConfigToStore.name}`,
            `world:${worldConfigToStore.name}`
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
        if (error.name === 'ParameterNotFound') {
            throw new Error('Active world parameter not found in SSM');
        }
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
        if (error.name === 'NoSuchBucket') {
            throw new Error(`Bucket ${bucketName} not found`);
        }
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

        console.log(chalk.green(`Downloaded backup to: ${downloadPath}`));

        return downloadPath;
    } catch (error) {
        if (error.name === 'NoSuchKey') {
            throw new Error(`Backup ${key} not found in bucket ${bucketName}`);
        }
        console.error('Error downloading backup:', error);
        throw error;
    }
}

/**
 * Upload a backup to S3
 * @param {string} bucketName - The S3 bucket name
 * @param {string} worldName - The world name for the backup
 * @param {string} localPath - The local path to the backup file
 * @returns {Promise<string>} The S3 URI of the uploaded file
 */
async function uploadBackup(bucketName, worldName, localPath) {
    const { Upload } = require('@aws-sdk/lib-storage');

    try {
        const s3 = getS3Client();

        // Validate file exists
        if (!fs.existsSync(localPath)) {
            throw new Error(`File not found: ${localPath}`);
        }

        const filename = path.basename(localPath);
        const s3Key = `worlds/${worldName}/${filename}`;

        const fileStream = fs.createReadStream(localPath);
        const fileStats = fs.statSync(localPath);

        console.log(chalk.cyan(`Uploading ${filename} (${formatBytes(fileStats.size)}) to s3://${bucketName}/${s3Key}...`));

        const upload = new Upload({
            client: s3,
            params: {
                Bucket: bucketName,
                Key: s3Key,
                Body: fileStream,
            },
        });

        // Track progress
        upload.on('httpUploadProgress', (progress) => {
            if (progress.loaded && progress.total) {
                const percent = Math.round((progress.loaded / progress.total) * 100);
                process.stdout.write(`\r  Progress: ${percent}% (${formatBytes(progress.loaded)} / ${formatBytes(progress.total)})`);
            }
        });

        await upload.done();
        console.log(''); // New line after progress

        const s3Uri = `s3://${bucketName}/${s3Key}`;
        console.log(chalk.green(`✓ Uploaded to: ${s3Uri}`));

        return s3Uri;
    } catch (error) {
        console.error('Error uploading backup:', error);
        throw error;
    }
}

/**
 * Helper function to format bytes
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
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
        if (error.name === 'ValidationError' && error.message.includes('does not exist')) {
            throw new Error(`Stack ${stackName} does not exist`);
        }
        console.error(`Error getting outputs for stack ${stackName}:`, error);
        throw error;
    }
}

/**
 * Get auto-shutdown configuration from SSM
 * @returns {Promise<string>} Auto-shutdown setting (minutes or "off")
 */
async function getAutoShutdownConfig() {
    try {
        const ssm = getSSMClient();
        const result = await ssm.getParameter({
            Name: '/huginbot/auto-shutdown-minutes'
        });

        if (result.Parameter?.Value) {
            return result.Parameter.Value;
        }

        return '30'; // Default to 30 minutes if not found
    } catch (error) {
        if (error.name === 'ParameterNotFound') {
            return '30'; // Default to 30 minutes if parameter doesn't exist
        }
        console.error('Error getting auto-shutdown config:', error);
        throw error;
    }
}

/**
 * Set auto-shutdown configuration in SSM
 * @param {string} value - Auto-shutdown setting (minutes or "off"/"disabled")
 * @returns {Promise<void>}
 */
async function setAutoShutdownConfig(value) {
    try {
        const ssm = getSSMClient();

        // Validate the value
        if (value !== 'off' && value !== 'disabled' && (isNaN(parseInt(value)) || parseInt(value) < 0)) {
            throw new Error('Auto-shutdown value must be a positive number (minutes) or "off"/"disabled"');
        }

        await ssm.putParameter({
            Name: '/huginbot/auto-shutdown-minutes',
            Value: value,
            Type: 'String',
            Description: 'Auto-shutdown timeout in minutes (or "off" to disable)',
            Overwrite: true
        });

        console.log(chalk.green(`✓ Auto-shutdown set to: ${value}`));
    } catch (error) {
        console.error('Error setting auto-shutdown config:', error);
        throw error;
    }
}

// ============================================
// Mod Library S3 Operations
// ============================================

/**
 * Get the mod manifest from S3
 * @param {string} bucketName - The S3 bucket name
 * @returns {Promise<Object>} The mod manifest object
 */
async function getModManifest(bucketName) {
    try {
        const s3 = getS3Client();
        const command = new GetObjectCommand({
            Bucket: bucketName,
            Key: 'mods/manifest.json'
        });

        const response = await s3.send(command);
        const bodyString = await response.Body.transformToString();
        return JSON.parse(bodyString);
    } catch (error) {
        if (error.name === 'NoSuchKey') {
            // Return empty manifest if none exists
            return {
                version: '1.0',
                mods: {},
                lastUpdated: new Date().toISOString()
            };
        }
        throw error;
    }
}

/**
 * Update the mod manifest in S3
 * @param {string} bucketName - The S3 bucket name
 * @param {Object} manifest - The manifest object to save
 * @returns {Promise<void>}
 */
async function updateModManifest(bucketName, manifest) {
    const s3 = getS3Client();

    // Update timestamp
    manifest.lastUpdated = new Date().toISOString();

    const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: 'mods/manifest.json',
        Body: JSON.stringify(manifest, null, 2),
        ContentType: 'application/json'
    });

    await s3.send(command);
}

/**
 * List mods in the S3 library
 * @param {string} bucketName - The S3 bucket name
 * @returns {Promise<Array>} Array of mod metadata objects
 */
async function listModsInLibrary(bucketName) {
    try {
        const manifest = await getModManifest(bucketName);
        return Object.values(manifest.mods);
    } catch (error) {
        console.error('Error listing mods:', error);
        throw error;
    }
}

/**
 * Get metadata for a specific mod
 * @param {string} bucketName - The S3 bucket name
 * @param {string} modName - The mod name
 * @returns {Promise<Object|null>} Mod metadata or null if not found
 */
async function getModMetadata(bucketName, modName) {
    try {
        const manifest = await getModManifest(bucketName);
        return manifest.mods[modName] || null;
    } catch (error) {
        console.error('Error getting mod metadata:', error);
        throw error;
    }
}

/**
 * Upload a mod to the S3 library
 * @param {string} bucketName - The S3 bucket name
 * @param {string} modName - The mod name
 * @param {Object} metadata - The mod metadata
 * @param {Array<{localPath: string, filename: string}>} files - Files to upload
 * @returns {Promise<void>}
 */
async function uploadModToLibrary(bucketName, modName, metadata, files) {
    const s3 = getS3Client();

    try {
        // Upload each file using PutObjectCommand (works for files under 5GB)
        for (const file of files) {
            const fileContent = fs.readFileSync(file.localPath);
            const filename = file.filename || path.basename(file.localPath);
            const s3Key = `mods/${modName}/plugins/${filename}`;

            console.log(chalk.gray(`  Uploading ${filename}...`));

            const uploadCommand = new PutObjectCommand({
                Bucket: bucketName,
                Key: s3Key,
                Body: fileContent
            });

            await s3.send(uploadCommand);
        }

        // Upload metadata
        const metadataCommand = new PutObjectCommand({
            Bucket: bucketName,
            Key: `mods/${modName}/metadata.json`,
            Body: JSON.stringify(metadata, null, 2),
            ContentType: 'application/json'
        });

        await s3.send(metadataCommand);

        // Update manifest
        const manifest = await getModManifest(bucketName);
        manifest.mods[modName] = metadata;
        await updateModManifest(bucketName, manifest);

    } catch (error) {
        console.error('Error uploading mod:', error);
        throw error;
    }
}

/**
 * Delete a mod from the S3 library
 * @param {string} bucketName - The S3 bucket name
 * @param {string} modName - The mod name to delete
 * @returns {Promise<void>}
 */
async function deleteModFromLibrary(bucketName, modName) {
    const s3 = getS3Client();

    try {
        // List all objects in the mod folder
        const listCommand = new ListObjectsV2Command({
            Bucket: bucketName,
            Prefix: `mods/${modName}/`
        });

        const listResponse = await s3.send(listCommand);

        if (listResponse.Contents && listResponse.Contents.length > 0) {
            // Delete all objects
            const deleteCommand = new DeleteObjectsCommand({
                Bucket: bucketName,
                Delete: {
                    Objects: listResponse.Contents.map(obj => ({ Key: obj.Key }))
                }
            });

            await s3.send(deleteCommand);
        }

        // Update manifest
        const manifest = await getModManifest(bucketName);
        delete manifest.mods[modName];
        await updateModManifest(bucketName, manifest);

    } catch (error) {
        console.error('Error deleting mod:', error);
        throw error;
    }
}

/**
 * Download mod files from S3 library
 * @param {string} bucketName - The S3 bucket name
 * @param {string} modName - The mod name
 * @param {string} downloadDir - Local directory to download to
 * @returns {Promise<string[]>} Array of downloaded file paths
 */
async function downloadModFiles(bucketName, modName, downloadDir) {
    const s3 = getS3Client();
    const downloadedFiles = [];

    try {
        // List files in mod's plugins folder
        const listCommand = new ListObjectsV2Command({
            Bucket: bucketName,
            Prefix: `mods/${modName}/plugins/`
        });

        const listResponse = await s3.send(listCommand);

        if (!listResponse.Contents || listResponse.Contents.length === 0) {
            throw new Error(`No files found for mod: ${modName}`);
        }

        // Create download directory if needed
        if (!fs.existsSync(downloadDir)) {
            fs.mkdirSync(downloadDir, { recursive: true });
        }

        // Download each file
        for (const obj of listResponse.Contents) {
            const filename = path.basename(obj.Key);
            if (!filename) continue; // Skip folder entries

            const localPath = path.join(downloadDir, filename);

            const getCommand = new GetObjectCommand({
                Bucket: bucketName,
                Key: obj.Key
            });

            const response = await s3.send(getCommand);
            const fileStream = fs.createWriteStream(localPath);

            await new Promise((resolve, reject) => {
                response.Body.pipe(fileStream);
                response.Body.on('error', reject);
                fileStream.on('finish', resolve);
            });

            downloadedFiles.push(localPath);
        }

        return downloadedFiles;
    } catch (error) {
        console.error('Error downloading mod files:', error);
        throw error;
    }
}

/**
 * Update scripts on a running EC2 instance from S3
 * @param {boolean} restartServer - Whether to restart the Valheim server after updating scripts
 * @returns {Promise<Object>} Result with command ID and status
 */
async function updateScripts(options = {}) {
    const { restartServer = false, includeServices = false } = options;

    try {
        const config = getConfig();
        const instanceId = config.instanceId;

        if (!instanceId) {
            throw new Error('No instance ID found in configuration');
        }

        // Check if instance is running
        const status = await getInstanceStatus();
        if (status !== 'running') {
            throw new Error(`Server is not running (status: ${status}). Start it first.`);
        }

        const ssm = getSSMClient();

        // Build command list - uses the update-valheim-scripts.service which does S3 sync
        const commands = [
            'echo "Updating scripts and services from S3..."',
            'systemctl restart update-valheim-scripts.service',
            'echo "Update completed successfully"'
        ];

        // If services were updated, reload systemd
        if (includeServices) {
            commands.push(
                'echo "Reloading systemd..."',
                'systemctl daemon-reload',
                'echo "Systemd reloaded"'
            );
        }

        if (restartServer) {
            commands.push(
                'echo "Restarting Valheim server..."',
                'systemctl restart valheim-server.service',
                'echo "Server restart initiated"'
            );
        }

        const result = await ssm.sendCommand({
            DocumentName: 'AWS-RunShellScript',
            InstanceIds: [instanceId],
            Parameters: {
                commands: commands
            },
            TimeoutSeconds: 300
        });

        return {
            commandId: result.Command.CommandId,
            instanceId: instanceId,
            restartServer: restartServer,
            includeServices: includeServices
        };
    } catch (error) {
        console.error('Error updating scripts:', error);
        throw error;
    }
}

module.exports = {
    getSSMClient,
    getEC2Client,
    getCloudFormationClient,
    getS3Client,
    getSTSClient,
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
    uploadBackup,
    getStackOutputs,
    getAutoShutdownConfig,
    setAutoShutdownConfig,
    // Mod library operations
    getModManifest,
    updateModManifest,
    listModsInLibrary,
    getModMetadata,
    uploadModToLibrary,
    deleteModFromLibrary,
    downloadModFiles,
    updateScripts
};
