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
    
    // List available backups
    const listCommand = new ListObjectsV2Command({
      Bucket: bucketName,
    });
    
    const response = await s3.send(listCommand);
    
    if (!response.Contents || response.Contents.length === 0) {
      console.log('No backups found in bucket');
      return;
    }
    
    // Sort backups by last modified date (most recent first)
    const backups = response.Contents
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
    
    console.log(`Found ${backups.length} backups in bucket ${bucketName}`);
    
    // Ask which backup to download
    const backupChoices = backups.map((backup, index) => ({
      name: `${backup.name} (${backup.date}, ${backup.size})`,
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
    
    // Ask for download location
    const { downloadDir } = await inquirer.prompt([
      {
        type: 'input',
        name: 'downloadDir',
        message: 'Enter download directory:',
        default: process.cwd()
      }
    ]);
    
    console.log(`Downloading ${backupToDownload} to ${downloadDir}...`);
    
    // Create download directory if it doesn't exist
    fs.mkdirSync(downloadDir, { recursive: true });
    
    // Download file
    const downloadPath = path.join(downloadDir, backupToDownload);
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
    
    console.log(`Backup downloaded successfully to ${downloadPath}`);
    
    // Ask if user wants to extract the backup
    const { extractBackup } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'extractBackup',
        message: 'Do you want to extract the backup?',
        default: true
      }
    ]);
    
    if (extractBackup) {
      // Ask for extraction directory
      const { extractDir } = await inquirer.prompt([
        {
          type: 'input',
          name: 'extractDir',
          message: 'Enter extraction directory:',
          default: path.join(downloadDir, 'valheim-backup')
        }
      ]);
      
      // Create extraction directory if it doesn't exist
      fs.mkdirSync(extractDir, { recursive: true });
      
      // Extract using tar
      console.log(`Extracting backup to ${extractDir}...`);
      
      try {
        execSync(`tar -xzf "${downloadPath}" -C "${extractDir}"`, { stdio: 'inherit' });
        console.log('Backup extracted successfully');
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
      startLocalTestServer();
    }
  }
}

async function mainMenu() {
  // Load configuration
  loadConfig();
  
  displayIntro();
  
  while (true) {
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What do you want to do?',
        choices: [
          'Deploy Infrastructure', 
          'Configure Local Testing',
          'Start Local Test Server',
          'Show Server Status',
          'Start Mock Server',
          'Stop Mock Server',
          'Download Backup',
          'Manage Worlds',
          'Exit'
        ],
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
      case 'Exit':
        process.exit();
    }
  }
}

mainMenu();