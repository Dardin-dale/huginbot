import inquirer from 'inquirer';
import { CloudFormation } from '@aws-sdk/client-cloudformation';
import { execSync } from 'child_process';
import { EC2 } from '@aws-sdk/client-ec2';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';
import os from 'os';

const cloudformation = new CloudFormation();
const ec2 = new EC2();

// Configuration defaults
const CONFIG_FILE = path.join(process.cwd(), 'huginbot-config.json');
let config = {
  serverName: 'ValheimServer',
  worldName: 'ValheimWorld',
  serverPassword: 'valheim',
  adminIds: '',
  instanceType: 't3.medium',
  useLocalTesting: true,
  localPort: 3000,
  worlds: [
    {
      name: 'Default',
      discordServerId: '',
      worldName: 'ValheimWorld',
      serverPassword: 'valheim'
    }
  ]
};

// Load config if exists
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      config = { ...config, ...JSON.parse(data) };
      console.log('Configuration loaded');
    }
  } catch (err) {
    console.error('Error loading config:', err.message);
  }
}

// Save config
function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log('Configuration saved');
  } catch (err) {
    console.error('Error saving config:', err.message);
  }
}

function displayIntro() {
  const asciiArt = `
                 **#%                       
               #@@@*%@@%                    
            -@@@@@@@@@@@##%%              %%
                 #@@@@%*@*%%#%###%##% %#    
                 +*%%@*@%###@%%%#%###*#+    
                  #*@%%@@@@@@@%@@@@@%%%%    
                   %@%%@@%@@@@@@%%%      %% 
                     =%@@@@@@@@             
                        @@ @@@              
                        %@ @@@              
                       #@  %@               
                       +   +                
                   *#%+@#@#%%               
                   @# % @ % #               
                      @   @ %                                              
                                                                         
   ▄█    █▄    ███    █▄     ▄██████▄   ▄█  ███▄▄▄▄   ▀█████████▄   ▄██████▄      ███     
  ███    ███   ███    ███   ███    ███ ███  ███▀▀▀██▄   ███    ███ ███    ███ ▀█████████▄ 
  ███    ███   ███    ███   ███    █▀  ███▌ ███   ███   ███    ███ ███    ███    ▀███▀▀██ 
 ▄███▄▄▄▄███▄▄ ███    ███  ▄███        ███▌ ███   ███  ▄███▄▄▄██▀  ███    ███     ███   ▀ 
▀▀███▀▀▀▀███▀  ███    ███ ▀▀███ ████▄  ███▌ ███   ███ ▀▀███▀▀▀██▄  ███    ███     ███     
  ███    ███   ███    ███   ███    ███ ███  ███   ███   ███    ██▄ ███    ███     ███     
  ███    ███   ███    ███   ███    ███ ███  ███   ███   ███    ███ ███    ███     ███     
  ███    █▀    ████████▀    ████████▀  █▀    ▀█   █▀  ▄█████████▀   ▀██████▀     ▄████▀                                                                            
  `;
                                                                         
  console.log(asciiArt);
}

function isStackDeployed(stackName) {
  try {
    return new Promise((resolve) => {
      cloudformation.describeStacks({ StackName: stackName }, (err) => {
        if (err) resolve(false);
        else resolve(true);
      });
    });
  } catch (error) {
    return Promise.resolve(false);
  }
}

async function deployInfrastructure() {
  const questions = [
    {
      type: 'input',
      name: 'serverName',
      message: 'Enter server name:',
      default: config.serverName
    },
    {
      type: 'input',
      name: 'worldName',
      message: 'Enter world name:',
      default: config.worldName
    },
    {
      type: 'password',
      name: 'serverPassword',
      message: 'Enter server password:',
      default: config.serverPassword
    },
    {
      type: 'input',
      name: 'adminIds',
      message: 'Enter admin Steam IDs (space separated):',
      default: config.adminIds
    },
    {
      type: 'list',
      name: 'instanceType',
      message: 'Select instance type:',
      choices: ['t3.micro', 't3.small', 't3.medium', 't3.large'],
      default: config.instanceType
    }
  ];

  const answers = await inquirer.prompt(questions);
  
  // Save the config
  config = { ...config, ...answers };
  saveConfig();
  
  // Check if stacks are deployed
  const valheimStackName = 'ValheimStack';
  const huginbotStackName = 'HuginbotStack';
  
  const valheimDeployed = await isStackDeployed(valheimStackName);
  const huginbotDeployed = await isStackDeployed(huginbotStackName);
  
  if (valheimDeployed) {
    console.log(`Stack ${valheimStackName} is already deployed.`);
  } else {
    console.log(`Deploying ${valheimStackName}...`);
    try {
      // Deploy the Valheim stack with parameters
      const command = `npx cdk deploy ${valheimStackName} --parameters serverName=${config.serverName} --parameters worldName=${config.worldName} --parameters serverPassword=${config.serverPassword} --parameters adminIds="${config.adminIds}" --parameters instanceType=${config.instanceType}`;
      execSync(command, { stdio: 'inherit' });
    } catch (error) {
      console.error('Error deploying Valheim stack:', error);
      return;
    }
  }
  
  // Get the instance ID for the Huginbot stack
  let instanceId = '';
  try {
    const result = await cloudformation.describeStacks({ StackName: valheimStackName });
    const outputs = result.Stacks[0].Outputs;
    
    for (const output of outputs) {
      if (output.OutputKey === 'InstanceId') {
        instanceId = output.OutputValue;
        break;
      }
    }
    
    if (!instanceId) {
      console.error('Could not find instance ID in Valheim stack outputs');
      return;
    }
  } catch (error) {
    console.error('Error getting Valheim instance ID:', error);
    return;
  }
  
  if (huginbotDeployed) {
    console.log(`Stack ${huginbotStackName} is already deployed.`);
  } else {
    console.log(`Deploying ${huginbotStackName}...`);
    try {
      // Deploy the Huginbot stack with the instance ID
      const command = `npx cdk deploy ${huginbotStackName} --parameters valheimInstanceId=${instanceId}`;
      execSync(command, { stdio: 'inherit' });
    } catch (error) {
      console.error('Error deploying Huginbot stack:', error);
    }
  }
}

async function undeployInfrastructure() {
  // Check if stacks are deployed
  const valheimStackName = 'ValheimStack';
  const huginbotStackName = 'HuginbotStack';
  
  const valheimDeployed = await isStackDeployed(valheimStackName);
  const huginbotDeployed = await isStackDeployed(huginbotStackName);
  
  if (!valheimDeployed && !huginbotDeployed) {
    console.log('No HuginBot stacks are currently deployed.');
    return;
  }
  
  // Show warning
  console.log('\n\n');
  console.log('⚠️  WARNING: UNDEPLOYING INFRASTRUCTURE ⚠️');
  console.log('=====================================');
  console.log('This will PERMANENTLY DELETE all deployed resources, including:');
  console.log('- EC2 instances running your Valheim server');
  console.log('- S3 buckets containing your world backups');
  console.log('- API Gateway endpoints for Discord integration');
  console.log('- Lambda functions and other AWS resources');
  console.log('\nWorld backups will be PERMANENTLY LOST unless you download them first!');
  console.log('\n');
  
  // First confirmation
  const { confirmUndeploy } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmUndeploy',
      message: 'Are you sure you want to undeploy all HuginBot infrastructure?',
      default: false
    }
  ]);
  
  if (!confirmUndeploy) {
    console.log('Undeploy cancelled.');
    return;
  }
  
  // Get the name of the world to type for confirmation
  let worldName = config.worldName || 'ValheimWorld';
  
  // Second confirmation - type the world name
  const { worldNameConfirmation } = await inquirer.prompt([
    {
      type: 'input',
      name: 'worldNameConfirmation',
      message: `To confirm, please type the name of your primary world (${worldName}):`,
      validate: (input) => {
        if (input === worldName) {
          return true;
        }
        return 'The world name does not match. Please try again or press Ctrl+C to cancel.';
      }
    }
  ]);
  
  // Final confirmation
  const { finalConfirmation } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'finalConfirmation',
      message: 'THIS IS YOUR FINAL WARNING: Proceed with undeploying all resources?',
      default: false
    }
  ]);
  
  if (!finalConfirmation) {
    console.log('Undeploy cancelled.');
    return;
  }
  
  // Ask if they want to back up their worlds first
  const { backupFirst } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'backupFirst',
      message: 'Would you like to download backups of your worlds before undeploying?',
      default: true
    }
  ]);
  
  if (backupFirst) {
    console.log('Launching backup tool...');
    await downloadBackups();
    
    // After backup, confirm again
    const { proceedAfterBackup } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'proceedAfterBackup',
        message: 'Proceed with undeploying after backup?',
        default: true
      }
    ]);
    
    if (!proceedAfterBackup) {
      console.log('Undeploy cancelled.');
      return;
    }
  }
  
  console.log('Beginning undeploy process...');
  
  // Undeploy in reverse order of deployment
  if (huginbotDeployed) {
    console.log(`Undeploying ${huginbotStackName}...`);
    try {
      const command = `npx cdk destroy ${huginbotStackName} --force`;
      execSync(command, { stdio: 'inherit' });
      console.log(`${huginbotStackName} successfully undeployed.`);
    } catch (error) {
      console.error(`Error undeploying ${huginbotStackName}:`, error);
      console.log('Continuing with remaining undeployment...');
    }
  }
  
  if (valheimDeployed) {
    console.log(`Undeploying ${valheimStackName}...`);
    try {
      const command = `npx cdk destroy ${valheimStackName} --force`;
      execSync(command, { stdio: 'inherit' });
      console.log(`${valheimStackName} successfully undeployed.`);
    } catch (error) {
      console.error(`Error undeploying ${valheimStackName}:`, error);
      console.log('Undeployment process completed with errors.');
      return;
    }
  }
  
  console.log('All HuginBot infrastructure has been successfully undeployed.');
}

// Mock EC2 instance for local testing
let mockEc2State = 'stopped';

// Function to download backups from S3
async function downloadBackups() {
  try {
    // Get the bucket name from CloudFormation outputs
    const result = await cloudformation.describeStacks({ StackName: 'ValheimStack' });
    const outputs = result.Stacks[0].Outputs;
    
    let bucketName = '';
    for (const output of outputs) {
      if (output.OutputKey === 'BackupBucketName') {
        bucketName = output.OutputValue;
        break;
      }
    }
    
    if (!bucketName) {
      console.error('Could not find backup bucket name in CloudFormation outputs');
      return;
    }
    
    // Create S3 client
    const s3 = new S3Client();
    
    // List available backup folders (worlds)
    const listFoldersCommand = new ListObjectsV2Command({
      Bucket: bucketName,
      Delimiter: '/'
    });
    
    const foldersResponse = await s3.send(listFoldersCommand);
    
    // Get the common prefixes which represent folders
    const worldFolders = foldersResponse.CommonPrefixes || [];
    
    if (worldFolders.length === 0) {
      console.log('No world backups found in bucket');
      return;
    }
    
    // Ask which world backup to browse
    const worldChoices = worldFolders
      .map(prefix => ({
        name: prefix.Prefix.replace('worlds/', '').replace('/', ''),
        value: prefix.Prefix
      }))
      .filter(world => world.name); // Filter out empty names
    
    if (worldChoices.length === 0) {
      console.log('No world backups found in bucket');
      return;
    }
    
    worldChoices.push({ name: 'Cancel', value: null });
    
    const { worldToRestore } = await inquirer.prompt([
      {
        type: 'list',
        name: 'worldToRestore',
        message: 'Select a world to restore backups from:',
        choices: worldChoices
      }
    ]);
    
    if (!worldToRestore) {
      console.log('Restore cancelled');
      return;
    }
    
    // Get backups for the selected world
    const listBackupsCommand = new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: worldToRestore
    });
    
    const backupsResponse = await s3.send(listBackupsCommand);
    
    if (!backupsResponse.Contents || backupsResponse.Contents.length === 0) {
      console.log(`No backups found for ${worldToRestore}`);
      return;
    }
    
    // Sort backups by last modified date (most recent first)
    const backups = backupsResponse.Contents
      .filter(item => item.Key && item.Key.endsWith('.tar.gz'))
      .sort((a, b) => {
        const dateA = a.LastModified ? a.LastModified.getTime() : 0;
        const dateB = b.LastModified ? b.LastModified.getTime() : 0;
        return dateB - dateA; // Sort descending
      })
      .map(item => ({
        name: item.Key,
        date: item.LastModified ? new Date(item.LastModified).toLocaleString() : 'Unknown',
        size: formatSize(item.Size || 0)
      }));
    
    console.log(`Found ${backups.length} backups for ${worldToRestore}`);
    
    // Ask which backup to download
    const backupChoices = backups.map((backup, index) => ({
      name: `${path.basename(backup.name)} (${backup.date}, ${backup.size})`,
      value: backup.name
    }));
    
    backupChoices.push({ name: 'Cancel', value: null });
    
    const { backupToDownload } = await inquirer.prompt([
      {
        type: 'list',
        name: 'backupToDownload',
        message: 'Select a backup to download:',
        choices: backupChoices
      }
    ]);
    
    if (!backupToDownload) {
      console.log('Download cancelled');
      return;
    }
    
    // Extract world name from folder path
    const worldName = worldToRestore.replace('worlds/', '').replace('/', '');
    
    // Offer options for what to do with the backup
    const { backupAction } = await inquirer.prompt([
      {
        type: 'list',
        name: 'backupAction',
        message: 'What would you like to do with this backup?',
        choices: [
          { 
            name: `Restore to local worlds folder (./worlds/${worldName})`, 
            value: 'restore_local_world' 
          },
          { 
            name: 'Download to custom location', 
            value: 'download_custom' 
          },
          { 
            name: 'Cancel', 
            value: 'cancel' 
          }
        ]
      }
    ]);
    
    if (backupAction === 'cancel') {
      console.log('Operation cancelled');
      return;
    }
    
    let downloadPath;
    let extractDir;
    
    if (backupAction === 'download_custom') {
      // Ask for download location
      const { downloadDir } = await inquirer.prompt([
        {
          type: 'input',
          name: 'downloadDir',
          message: 'Enter download directory:',
          default: process.cwd()
        }
      ]);
      
      // Create download directory if it doesn't exist
      fs.mkdirSync(downloadDir, { recursive: true });
      
      // Set the download path
      downloadPath = path.join(downloadDir, path.basename(backupToDownload));
      
      // Ask for extraction directory
      const { shouldExtract } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'shouldExtract',
          message: 'Do you want to extract the backup after downloading?',
          default: true
        }
      ]);
      
      if (shouldExtract) {
        const { extractionDir } = await inquirer.prompt([
          {
            type: 'input',
            name: 'extractionDir',
            message: 'Enter extraction directory:',
            default: path.join(downloadDir, 'valheim-backup')
          }
        ]);
        
        extractDir = extractionDir;
      }
    } else if (backupAction === 'restore_local_world') {
      // Create world directory in the worlds folder
      const worldsDir = path.join(process.cwd(), 'worlds');
      const specificWorldDir = path.join(worldsDir, worldName);
      
      fs.mkdirSync(specificWorldDir, { recursive: true });
      
      // Set paths for download and extraction
      downloadPath = path.join(os.tmpdir(), path.basename(backupToDownload));
      extractDir = path.join(os.tmpdir(), 'valheim-extract-temp');
      
      // Clean up extraction directory if it exists
      if (fs.existsSync(extractDir)) {
        fs.rmSync(extractDir, { recursive: true, force: true });
      }
      
      fs.mkdirSync(extractDir, { recursive: true });
    }
    
    console.log(`Downloading ${path.basename(backupToDownload)}...`);
    
    // Download file
    const fileStream = fs.createWriteStream(downloadPath);
    
    const getObjectCommand = new GetObjectCommand({
      Bucket: bucketName,
      Key: backupToDownload
    });
    
    const { Body } = await s3.send(getObjectCommand);
    
    await new Promise((resolve, reject) => {
      Body.pipe(fileStream);
      Body.on('error', reject);
      fileStream.on('finish', resolve);
    });
    
    console.log(`Backup downloaded successfully`);
    
    // Extract if needed
    if (extractDir) {
      console.log(`Extracting backup...`);
      
      try {
        execSync(`tar -xzf "${downloadPath}" -C "${extractDir}"`, { stdio: 'inherit' });
        console.log('Backup extracted successfully');
        
        // If restoring to worlds folder, copy only world files to the world directory
        if (backupAction === 'restore_local_world') {
          const worldsDir = path.join(process.cwd(), 'worlds');
          const specificWorldDir = path.join(worldsDir, worldName);
          
          console.log(`Finding world files for ${worldName}...`);
          
          // Look for world files in extracted backup
          // Check in common locations where world files might be stored
          const searchPaths = [
            path.join(extractDir, 'config', 'worlds'),
            path.join(extractDir, 'mnt', 'valheim-data', 'config', 'worlds'),
            path.join(extractDir, 'worlds')
          ];
          
          let foundFiles = false;
          
          for (const searchPath of searchPaths) {
            if (fs.existsSync(searchPath)) {
              const files = fs.readdirSync(searchPath);
              const worldFiles = files.filter(file => {
                const filename = path.basename(file, path.extname(file));
                return (
                  (file.endsWith('.db') || file.endsWith('.fwl')) && 
                  filename.toLowerCase() === worldName.toLowerCase()
                );
              });
              
              if (worldFiles.length > 0) {
                console.log(`Found ${worldFiles.length} world files in ${searchPath}`);
                foundFiles = true;
                
                // Copy world files to the world directory
                worldFiles.forEach(file => {
                  const sourcePath = path.join(searchPath, file);
                  const destPath = path.join(specificWorldDir, file);
                  
                  fs.copyFileSync(sourcePath, destPath);
                  console.log(`Copied ${file} to ${specificWorldDir}`);
                });
                
                break;
              }
            }
          }
          
          if (!foundFiles) {
            console.log(`No world files found for ${worldName} in the backup.`);
            console.log(`You may need to extract the backup manually and look for the world files.`);
          } else {
            console.log(`Successfully restored world files for ${worldName} to ${specificWorldDir}`);
          }
          
          // Clean up temporary files
          if (fs.existsSync(downloadPath)) {
            fs.unlinkSync(downloadPath);
          }
          
          if (fs.existsSync(extractDir)) {
            fs.rmSync(extractDir, { recursive: true, force: true });
          }
        }
      } catch (error) {
        console.error('Error extracting backup:', error.message);
      }
    }
  } catch (error) {
    console.error('Error downloading backup:', error);
  }
}

function formatSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Function to manage world configurations
async function manageWorlds() {
  while (true) {
    const worldsAction = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'Manage Worlds:',
        choices: [
          'List Worlds',
          'Add World',
          'Edit World',
          'Remove World',
          'Back to Main Menu'
        ]
      }
    ]);
    
    switch (worldsAction.action) {
      case 'List Worlds':
        console.log('\nConfigured Worlds:');
        config.worlds.forEach((world, index) => {
          console.log(`${index + 1}. ${world.name} (${world.worldName})`);
          console.log(`   Discord Server: ${world.discordServerId || 'None'}`);
          console.log(`   Password: ${world.serverPassword}`);
          console.log('');
        });
        break;
        
      case 'Add World':
        const newWorld = await inquirer.prompt([
          {
            type: 'input',
            name: 'name',
            message: 'Display name for the world:',
            validate: (input) => input.trim() !== '' ? true : 'Name cannot be empty'
          },
          {
            type: 'input',
            name: 'discordServerId',
            message: 'Discord Server ID (optional):',
          },
          {
            type: 'input',
            name: 'worldName',
            message: 'Valheim world name:',
            validate: (input) => input.trim() !== '' ? true : 'World name cannot be empty'
          },
          {
            type: 'password',
            name: 'serverPassword',
            message: 'Server password:',
            validate: (input) => input.trim().length >= 5 ? true : 'Password must be at least 5 characters'
          }
        ]);
        
        config.worlds.push(newWorld);
        saveConfig();
        console.log(`World "${newWorld.name}" added successfully`);
        break;
        
      case 'Edit World':
        if (config.worlds.length === 0) {
          console.log('No worlds configured');
          break;
        }
        
        const { worldToEdit } = await inquirer.prompt([
          {
            type: 'list',
            name: 'worldToEdit',
            message: 'Select world to edit:',
            choices: config.worlds.map((world, index) => ({
              name: `${world.name} (${world.worldName})`,
              value: index
            }))
          }
        ]);
        
        const world = config.worlds[worldToEdit];
        const editedWorld = await inquirer.prompt([
          {
            type: 'input',
            name: 'name',
            message: 'Display name for the world:',
            default: world.name,
            validate: (input) => input.trim() !== '' ? true : 'Name cannot be empty'
          },
          {
            type: 'input',
            name: 'discordServerId',
            message: 'Discord Server ID (optional):',
            default: world.discordServerId
          },
          {
            type: 'input',
            name: 'worldName',
            message: 'Valheim world name:',
            default: world.worldName,
            validate: (input) => input.trim() !== '' ? true : 'World name cannot be empty'
          },
          {
            type: 'password',
            name: 'serverPassword',
            message: 'Server password:',
            default: world.serverPassword,
            validate: (input) => input.trim().length >= 5 ? true : 'Password must be at least 5 characters'
          }
        ]);
        
        config.worlds[worldToEdit] = editedWorld;
        saveConfig();
        console.log(`World "${editedWorld.name}" updated successfully`);
        break;
        
      case 'Remove World':
        if (config.worlds.length === 0) {
          console.log('No worlds configured');
          break;
        }
        
        const { worldToRemove } = await inquirer.prompt([
          {
            type: 'list',
            name: 'worldToRemove',
            message: 'Select world to remove:',
            choices: config.worlds.map((world, index) => ({
              name: `${world.name} (${world.worldName})`,
              value: index
            }))
          }
        ]);
        
        const { confirmRemove } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirmRemove',
            message: `Are you sure you want to remove "${config.worlds[worldToRemove].name}"?`,
            default: false
          }
        ]);
        
        if (confirmRemove) {
          const removedWorld = config.worlds.splice(worldToRemove, 1)[0];
          saveConfig();
          console.log(`World "${removedWorld.name}" removed successfully`);
        }
        break;
        
      case 'Back to Main Menu':
        return;
    }
  }
}

// Local Discord bot testing server
function startLocalTestServer() {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });
  
  app.use(express.json());
  
  // API endpoints that mimic the Lambda functions
  app.post('/valheim/control', (req, res) => {
    const { action } = req.body;
    
    let message = '';
    let status = mockEc2State;
    
    if (action === 'start' && mockEc2State === 'stopped') {
      mockEc2State = 'pending';
      setTimeout(() => {
        mockEc2State = 'running';
        broadcastStatus();
      }, 5000);
      message = 'Server is starting. It may take several minutes before it\'s ready.';
      status = 'pending';
    } else if (action === 'start' && mockEc2State === 'running') {
      message = 'Server is already running';
    } else if (action === 'stop' && mockEc2State === 'running') {
      mockEc2State = 'stopping';
      setTimeout(() => {
        mockEc2State = 'stopped';
        broadcastStatus();
      }, 5000);
      message = 'Server is shutting down. Save your game before disconnecting!';
      status = 'stopping';
    } else if (action === 'stop' && mockEc2State === 'stopped') {
      message = 'Server is already stopped';
    } else {
      message = `Invalid action or state: ${action} (current state: ${mockEc2State})`;
    }
    
    res.json({ message, status });
    broadcastStatus();
  });
  
  app.get('/valheim/status', (req, res) => {
    const statusResponse = {
      status: mockEc2State,
      message: getStatusMessage(mockEc2State),
      serverAddress: mockEc2State === 'running' ? '127.0.0.1:2456' : null,
      uptime: mockEc2State === 'running' ? '1h 23m' : null,
      players: mockEc2State === 'running' ? ['Player1', 'Player2'] : null,
      version: mockEc2State === 'running' ? '0.217.14' : null
    };
    
    res.json(statusResponse);
  });
  
  // WebSocket for real-time updates
  wss.on('connection', (ws) => {
    console.log('Discord bot connected to WebSocket');
    
    ws.on('message', (message) => {
      console.log(`Received: ${message}`);
    });
    
    ws.send(JSON.stringify({ status: mockEc2State, message: getStatusMessage(mockEc2State) }));
  });
  
  function broadcastStatus() {
    wss.clients.forEach((client) => {
      client.send(JSON.stringify({ 
        status: mockEc2State, 
        message: getStatusMessage(mockEc2State) 
      }));
    });
  }
  
  server.listen(config.localPort, () => {
    console.log(`Local test server running at http://localhost:${config.localPort}`);
    console.log(`WebSocket available at ws://localhost:${config.localPort}`);
    console.log(`Current server status: ${mockEc2State}`);
    console.log('Use endpoints:');
    console.log(` - POST /valheim/control with {"action": "start"} or {"action": "stop"}`);
    console.log(` - GET /valheim/status`);
  });
}

function getStatusMessage(status) {
  switch (status) {
    case 'running':
      return "Server is online and ready to play!";
    case 'pending':
      return "Server is starting up. Please wait a few minutes.";
    case 'stopping':
      return "Server is shutting down.";
    case 'stopped':
      return "Server is offline. Use the start command to launch it.";
    default:
      return `Server status: ${status}`;
  }
}

async function showInstanceStatus() {
  if (config.useLocalTesting) {
    console.log(`Mock server status: ${mockEc2State}`);
    console.log(`Status message: ${getStatusMessage(mockEc2State)}`);
    return;
  }
  
  // Get the instance ID from the Valheim stack
  try {
    const result = await cloudformation.describeStacks({ StackName: 'ValheimStack' });
    const outputs = result.Stacks[0].Outputs;
    
    let instanceId = '';
    let publicIp = '';
    
    for (const output of outputs) {
      if (output.OutputKey === 'InstanceId') {
        instanceId = output.OutputValue;
      }
      if (output.OutputKey === 'InstancePublicIP') {
        publicIp = output.OutputValue;
      }
    }
    
    if (!instanceId) {
      console.error('Could not find instance ID in stack outputs');
      return;
    }
    
    // Get the instance status
    const response = await ec2.describeInstances({ InstanceIds: [instanceId] });
    
    if (!response.Reservations || response.Reservations.length === 0 || 
        !response.Reservations[0].Instances || response.Reservations[0].Instances.length === 0) {
      console.error('Instance not found');
      return;
    }
    
    const instance = response.Reservations[0].Instances[0];
    const state = instance.State.Name;
    
    console.log(`Instance status: ${state}`);
    console.log(`Public IP: ${publicIp || 'Not available'}`);
    console.log(`Connection address: ${publicIp ? `${publicIp}:2456` : 'Not available'}`);
  } catch (error) {
    if (error.name === 'ValidationError') {
      console.log('Valheim stack is not deployed yet');
    } else {
      console.error('Error getting instance status:', error);
    }
  }
}

async function configureLocalTesting() {
  const answers = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'useLocalTesting',
      message: 'Enable local testing mode?',
      default: config.useLocalTesting
    },
    {
      type: 'input',
      name: 'localPort',
      message: 'Local test server port:',
      default: config.localPort,
      when: (answers) => answers.useLocalTesting
    },
    {
      type: 'confirm',
      name: 'useDockerTesting',
      message: 'Enable local Docker-based Valheim server for testing?',
      default: config.useDockerTesting || false,
      when: (answers) => answers.useLocalTesting
    },
    {
      type: 'input',
      name: 'worldNameDocker',
      message: 'World name for Docker testing:',
      default: config.worldNameDocker || 'TestWorld',
      when: (answers) => answers.useLocalTesting && answers.useDockerTesting
    },
    {
      type: 'password',
      name: 'serverPasswordDocker',
      message: 'Server password for Docker testing:',
      default: config.serverPasswordDocker || 'valheim',
      when: (answers) => answers.useLocalTesting && answers.useDockerTesting
    },
    {
      type: 'confirm',
      name: 'enableBepInExDocker',
      message: 'Enable BepInEx for Docker testing?',
      default: config.enableBepInExDocker !== undefined ? config.enableBepInExDocker : true,
      when: (answers) => answers.useLocalTesting && answers.useDockerTesting
    }
  ]);
  
  config = { ...config, ...answers };
  saveConfig();
  
  console.log('Local testing configuration updated');
  
  if (answers.useLocalTesting) {
    const startNow = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'start',
        message: 'Start local test server now?',
        default: true
      }
    ]);
    
    if (startNow.start) {
      if (config.useDockerTesting) {
        await startLocalDockerServer();
      }
      startLocalTestServer();
    }
  }
}

async function startLocalDockerServer() {
  console.log('Starting local Docker-based Valheim server...');
  
  try {
    // Check if Docker is installed
    execSync('docker --version', { stdio: 'ignore' });
  } catch (error) {
    console.error('Docker is not installed or not in your PATH. Please install Docker to use this feature.');
    return;
  }
  
  try {
    // Check if valheim-server container is already running
    const output = execSync('docker ps -q -f name=valheim-server').toString().trim();
    if (output) {
      console.log('Valheim server container is already running');
      const restart = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'restartContainer',
          message: 'Restart the container?',
          default: false
        }
      ]);
      
      if (restart.restartContainer) {
        console.log('Stopping existing container...');
        execSync('docker stop valheim-server', { stdio: 'inherit' });
        execSync('docker rm valheim-server', { stdio: 'inherit' });
      } else {
        return;
      }
    }
    
    // Create needed directories if they don't exist
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    const configDir = path.join(homeDir, '.huginbot', 'valheim', 'config');
    const backupsDir = path.join(homeDir, '.huginbot', 'valheim', 'backups');
    const modsDir = path.join(homeDir, '.huginbot', 'valheim', 'mods');
    
    console.log('Creating required directories...');
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(backupsDir, { recursive: true });
    fs.mkdirSync(modsDir, { recursive: true });
    
    // Check for world files in ./worlds directory
    const worldName = config.worldNameDocker || 'TestWorld';
    const worldDir = path.join(process.cwd(), 'worlds', worldName);
    
    if (fs.existsSync(worldDir)) {
      console.log(`Found world directory for ${worldName}, copying files...`);
      
      // Get world files (.db and .fwl files)
      const worldFiles = fs.readdirSync(worldDir)
        .filter(file => file.endsWith('.db') || file.endsWith('.fwl'));
        
      if (worldFiles.length > 0) {
        // Create worlds directory in config
        const configWorldsDir = path.join(configDir, 'worlds');
        fs.mkdirSync(configWorldsDir, { recursive: true });
        
        // Copy world files
        worldFiles.forEach(file => {
          fs.copyFileSync(
            path.join(worldDir, file),
            path.join(configWorldsDir, file)
          );
          console.log(`Copied ${file} to local testing environment`);
        });
      }
    }
    
    // Check for mods in ./mods directory
    const projectModsDir = path.join(process.cwd(), 'mods');
    if (fs.existsSync(projectModsDir)) {
      const mods = fs.readdirSync(projectModsDir);
      if (mods.length > 0) {
        console.log('Found mods, copying to local testing environment...');
        
        // Copy all mods
        mods.forEach(mod => {
          const modSource = path.join(projectModsDir, mod);
          const modDest = path.join(modsDir, mod);
          
          if (fs.statSync(modSource).isDirectory()) {
            // Copy directory recursively
            fs.mkdirSync(modDest, { recursive: true });
            fs.cpSync(modSource, modDest, { recursive: true });
          } else {
            // Copy file
            fs.copyFileSync(modSource, modDest);
          }
          console.log(`Copied mod ${mod} to local testing environment`);
        });
      }
    }
    
    // Build the Docker run command
    const serverArgs = ['-crossplay'];
    if (config.enableBepInExDocker) {
      serverArgs.push('-bepinex');
    }
    
    const dockerCommand = `docker run -d --name valheim-server \\
      -p 2456-2458:2456-2458/udp \\
      -p 2456-2458:2456-2458/tcp \\
      -p 8080:80 \\
      -v "${configDir}:/config" \\
      -v "${backupsDir}:/config/backups" \\
      -v "${modsDir}:/bepinex/plugins" \\
      -e SERVER_NAME="Local Test Server" \\
      -e WORLD_NAME="${config.worldNameDocker || 'TestWorld'}" \\
      -e SERVER_PASS="${config.serverPasswordDocker || 'valheim'}" \\
      -e TZ="America/Los_Angeles" \\
      -e BACKUPS_DIRECTORY="/config/backups" \\
      -e BACKUPS_INTERVAL="3600" \\
      -e BACKUPS_MAX_AGE="3" \\
      -e BACKUPS_DIRECTORY_PERMISSIONS="755" \\
      -e BACKUPS_FILE_PERMISSIONS="644" \\
      -e CONFIG_DIRECTORY_PERMISSIONS="755" \\
      -e WORLDS_DIRECTORY_PERMISSIONS="755" \\
      -e WORLDS_FILE_PERMISSIONS="644" \\
      -e SERVER_PUBLIC="false" \\
      -e UPDATE_INTERVAL="900" \\
      -e STEAMCMD_ARGS="validate" \\
      -e BEPINEX="${config.enableBepInExDocker ? 'true' : 'false'}" \\
      -e SERVER_ARGS="${serverArgs.join(' ')}" \\
      --restart unless-stopped \\
      lloesche/valheim-server`;
    
    console.log('Starting Valheim server container...');
    execSync(dockerCommand, { stdio: 'inherit' });
    
    console.log(`
Local Valheim server started successfully!
- Connect to game at: 127.0.0.1:2456
- Server name: Local Test Server
- World name: ${config.worldNameDocker || 'TestWorld'}
- Password: ${config.serverPasswordDocker || 'valheim'}
- Admin panel at: http://localhost:8080
`);
    
    // Update the mock state
    mockEc2State = 'running';
    
  } catch (error) {
    console.error('Error starting Docker container:', error.message);
  }
}

async function mainMenu() {
  // Load configuration
  loadConfig();
  
  displayIntro();
  
  while (true) {
    const choices = [
      'Deploy Infrastructure', 
      'Configure Local Testing',
      'Start Local Test Server',
      'Show Server Status',
      'Start Mock Server',
      'Stop Mock Server',
      'Download Backup',
      'Manage Worlds',
      'Undeploy All Infrastructure',
    ];
    
    // Add Docker options if Docker testing is enabled
    if (config.useDockerTesting) {
      choices.splice(3, 0, 'Start Local Docker Valheim Server', 'Stop Local Docker Valheim Server');
    }
    
    choices.push('Exit');
    
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What do you want to do?',
        choices: choices,
      }
    ]);
    
    switch (answers.action) {
      case 'Deploy Infrastructure':
        await deployInfrastructure();
        break;
      case 'Configure Local Testing':
        await configureLocalTesting();
        break;
      case 'Start Local Test Server':
        startLocalTestServer();
        return; // Exit the menu loop since the server will be running
      case 'Start Local Docker Valheim Server':
        await startLocalDockerServer();
        break;
      case 'Stop Local Docker Valheim Server':
        try {
          console.log('Stopping Docker Valheim server...');
          execSync('docker stop valheim-server', { stdio: 'inherit' });
          execSync('docker rm valheim-server', { stdio: 'inherit' });
          console.log('Docker Valheim server stopped successfully.');
          mockEc2State = 'stopped';
        } catch (error) {
          console.error('Error stopping Docker container:', error.message);
        }
        break;
      case 'Show Server Status':
        await showInstanceStatus();
        break;
      case 'Start Mock Server':
        if (mockEc2State === 'stopped') {
          mockEc2State = 'pending';
          console.log('Mock server starting...');
          setTimeout(() => {
            mockEc2State = 'running';
            console.log('Mock server is now running');
          }, 2000);
        } else {
          console.log(`Mock server is already ${mockEc2State}`);
        }
        break;
      case 'Stop Mock Server':
        if (mockEc2State === 'running') {
          mockEc2State = 'stopping';
          console.log('Mock server stopping...');
          setTimeout(() => {
            mockEc2State = 'stopped';
            console.log('Mock server is now stopped');
          }, 2000);
        } else {
          console.log(`Mock server is already ${mockEc2State}`);
        }
        break;
      case 'Download Backup':
        await downloadBackups();
        break;
      case 'Manage Worlds':
        await manageWorlds();
        break;
      case 'Undeploy All Infrastructure':
        await undeployInfrastructure();
        break;
      case 'Exit':
        process.exit();
    }
  }
}

mainMenu();