/**
 * testing.js - HuginBot CLI testing commands
 * 
 * Provides test utilities and commands
 */
const inquirer = require('inquirer');
const ora = require('ora');
const chalk = require('chalk');
const boxen = require('boxen');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { getConfig, saveConfig } = require('../utils/config');

// Command group registration
function register(program) {
  const testing = program
    .command('test')
    .description('Testing utilities');
  
  testing
    .command('local')
    .description('Run local tests')
    .option('-w, --watch', 'Run tests in watch mode')
    .option('-f, --filter <pattern>', 'Filter tests by name')
    .action(runLocalTests);
  
  testing
    .command('e2e')
    .description('Run end-to-end tests')
    .action(runE2ETests);
  
  testing
    .command('docker')
    .description('Run local Docker instance for testing')
    .action(runDockerInstance);
  
  testing
    .command('env')
    .description('Set up test environment')
    .action(setupTestEnvironment);
  
  testing
    .command('mock')
    .description('Launch mock server for offline testing')
    .option('-p, --port <port>', 'Port to run mock server on', parseInt, 3000)
    .action(runMockServer);
  
  return testing;
}

// Run local unit tests
async function runLocalTests(options) {
  console.log(chalk.cyan.bold('\n📋 Running Local Tests:'));
  
  const spinner = ora('Preparing test environment...').start();
  
  // Build test command
  const args = ['run', 'test'];
  
  if (options.watch) {
    args.push('--', '--watch');
  }
  
  if (options.filter) {
    args.push('--', options.filter);
  }
  
  spinner.succeed('Running tests');
  console.log(chalk.yellow('\n--- Test Output ---\n'));
  
  // Run tests
  await new Promise((resolve) => {
    const test = spawn('npm', args, { 
      stdio: 'inherit' 
    });
    
    test.on('close', (code) => {
      if (code === 0) {
        console.log(chalk.green('\n✅ Tests completed successfully'));
      } else {
        console.log(chalk.red(`\n❌ Tests failed with code ${code}`));
      }
      resolve();
    });
  });
}

// Run end-to-end tests
async function runE2ETests() {
  console.log(chalk.cyan.bold('\n📋 Running End-to-End Tests:'));
  console.log(chalk.yellow('⚠️  This will deploy test resources to AWS that will be automatically cleaned up afterward.'));
  
  const { confirmE2E } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmE2E',
      message: 'Do you want to continue? This may incur AWS charges.',
      default: false
    }
  ]);
  
  if (!confirmE2E) {
    console.log(chalk.yellow('❌ E2E tests cancelled.'));
    return;
  }
  
  const spinner = ora('Setting up E2E test environment...').start();
  
  // Run E2E tests
  try {
    await new Promise((resolve, reject) => {
      const e2e = spawn('npm', ['run', 'test:e2e'], { 
        stdio: ['ignore', 'pipe', 'pipe'] 
      });
      
      let output = '';
      
      e2e.stdout.on('data', (data) => {
        const text = data.toString();
        output += text;
        
        // Only display progress information
        if (text.includes('PASS') || text.includes('FAIL') || text.includes('Test:') || text.includes('Error:')) {
          process.stdout.write(text);
        }
      });
      
      e2e.stderr.on('data', (data) => {
        const text = data.toString();
        output += text;
        process.stderr.write(text);
      });
      
      e2e.on('close', (code) => {
        if (code === 0) {
          spinner.succeed('E2E tests completed successfully');
          console.log(chalk.green('✅ All E2E tests passed'));
          resolve();
        } else {
          spinner.fail('E2E tests failed');
          console.log(chalk.red(`❌ E2E tests failed with code ${code}`));
          console.log('Check the full log output for details');
          reject(new Error(`E2E tests failed with code ${code}`));
        }
      });
    });
  } catch (error) {
    console.error(chalk.red('Error running E2E tests:'), error.message);
  } finally {
    // Clean up test resources
    console.log(chalk.yellow('\nCleaning up test resources...'));
    
    try {
      const cleanup = spawn('npm', ['run', 'test:cleanup'], { 
        stdio: 'inherit' 
      });
      
      await new Promise((resolve) => {
        cleanup.on('close', (code) => {
          if (code === 0) {
            console.log(chalk.green('✅ Test resources cleaned up successfully'));
          } else {
            console.log(chalk.red(`❌ Cleanup failed with code ${code}`));
            console.log(chalk.yellow('You may need to manually clean up test resources'));
          }
          resolve();
        });
      });
    } catch (error) {
      console.error(chalk.red('Error cleaning up test resources:'), error.message);
    }
  }
}

// Run local Docker instance for testing
async function runDockerInstance() {
  console.log(chalk.cyan.bold('\n📋 Running Local Docker Instance:'));
  
  // Check if Docker is installed
  const spinner = ora('Checking Docker installation...').start();
  
  try {
    await new Promise((resolve, reject) => {
      const docker = spawn('docker', ['--version'], { 
        stdio: ['ignore', 'pipe', 'pipe'] 
      });
      
      let output = '';
      
      docker.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      docker.stderr.on('data', (data) => {
        output += data.toString();
      });
      
      docker.on('close', (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error('Docker not found'));
        }
      });
    });
    
    spinner.succeed('Docker is installed');
  } catch (error) {
    spinner.fail('Docker not installed');
    console.log(chalk.red('❌ Docker is required to run local testing instances.'));
    console.log('Please install Docker from: https://docs.docker.com/get-docker/');
    return;
  }
  
  // Check if the Valheim Docker image is available
  spinner.text = 'Checking for Valheim server image...';
  spinner.start();
  
  const imageName = 'lloesche/valheim-server';
  let imageExists = false;
  
  try {
    await new Promise((resolve, reject) => {
      const dockerImage = spawn('docker', ['image', 'ls', imageName], { 
        stdio: ['ignore', 'pipe', 'pipe'] 
      });
      
      let output = '';
      
      dockerImage.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      dockerImage.on('close', (code) => {
        if (code === 0 && output.includes(imageName)) {
          imageExists = true;
        }
        resolve();
      });
    });
    
    if (!imageExists) {
      spinner.text = 'Pulling Valheim server Docker image...';
      
      await new Promise((resolve, reject) => {
        const dockerPull = spawn('docker', ['pull', imageName], { 
          stdio: ['ignore', 'pipe', 'pipe'] 
        });
        
        let output = '';
        
        dockerPull.stdout.on('data', (data) => {
          output += data.toString();
          
          if (output.includes('Pulling') || output.includes('Downloading') || output.includes('Extracting')) {
            spinner.text = `Pulling Valheim server Docker image: ${output.trim().split('\n').pop()}`;
          }
        });
        
        dockerPull.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Failed to pull Docker image: ${output}`));
          }
        });
      });
    }
    
    spinner.succeed('Valheim server image ready');
  } catch (error) {
    spinner.fail('Failed to prepare Valheim server image');
    console.error(chalk.red('Error:'), error.message);
    return;
  }
  
  // Ask for test world configuration
  console.log(chalk.cyan('\nConfigure test world:'));
  
  const worldConfig = await inquirer.prompt([
    {
      type: 'input',
      name: 'worldName',
      message: 'World name:',
      default: 'TestWorld',
      validate: (input) => input.trim() !== '' ? true : 'World name cannot be empty'
    },
    {
      type: 'password',
      name: 'password',
      message: 'Server password (min 5 characters):',
      default: 'valheim',
      validate: (input) => input.trim().length >= 5 ? true : 'Password must be at least 5 characters'
    },
    {
      type: 'input',
      name: 'port',
      message: 'Server port:',
      default: '2456',
      validate: (input) => /^\d+$/.test(input) ? true : 'Port must be a number'
    }
  ]);
  
  // Create Docker run command
  const dockerCmd = [
    'run',
    '--name=valheim-test-server',
    '--rm',
    '-d',
    '-p', `${worldConfig.port}:2456/udp`,
    '-p', `${parseInt(worldConfig.port) + 1}:2457/udp`,
    '-e', `SERVER_NAME="HuginBot Test Server"`,
    '-e', `WORLD_NAME="${worldConfig.worldName}"`,
    '-e', `SERVER_PASS="${worldConfig.password}"`,
    '-e', 'SERVER_PUBLIC=false',
    '-v', `valheim-test-data:/opt/valheim`,
    imageName
  ];
  
  // Start Docker container
  spinner.text = 'Starting Valheim test server...';
  spinner.start();
  
  try {
    await new Promise((resolve, reject) => {
      const dockerRun = spawn('docker', dockerCmd, { 
        stdio: ['ignore', 'pipe', 'pipe'] 
      });
      
      let output = '';
      let containerId = '';
      
      dockerRun.stdout.on('data', (data) => {
        output += data.toString();
        containerId = output.trim();
      });
      
      dockerRun.stderr.on('data', (data) => {
        output += data.toString();
      });
      
      dockerRun.on('close', (code) => {
        if (code === 0 && containerId) {
          resolve(containerId);
        } else {
          reject(new Error(`Failed to start Docker container: ${output}`));
        }
      });
    });
    
    spinner.succeed('Test server started');
    
    console.log(boxen(
      chalk.bold('🎮 Test Server Info 🎮\n\n') +
      `Server Name: HuginBot Test Server\n` +
      `World: ${worldConfig.worldName}\n` +
      `Password: ${worldConfig.password}\n` +
      `Port: ${worldConfig.port}\n` +
      `Status: ${chalk.green('RUNNING')}\n\n` +
      `Connect using IP: 127.0.0.1:${worldConfig.port}\n\n` +
      chalk.yellow('Note: The server will be stopped when you press Ctrl+C.'),
      { padding: 1, margin: 1, borderStyle: 'round', borderColor: 'green' }
    ));
    
    // Wait for user to press Ctrl+C
    console.log(chalk.yellow('Press Ctrl+C to stop the server and return to the CLI'));
    
    // Keep process running until user press Ctrl+C
    await new Promise((resolve) => {
      process.on('SIGINT', () => {
        resolve();
      });
    });
    
    // Cleanup when user presses Ctrl+C
    spinner.text = 'Stopping test server...';
    spinner.start();
    
    await new Promise((resolve, reject) => {
      const dockerStop = spawn('docker', ['stop', 'valheim-test-server'], { 
        stdio: ['ignore', 'pipe', 'pipe'] 
      });
      
      dockerStop.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('Failed to stop Docker container'));
        }
      });
    });
    
    spinner.succeed('Test server stopped');
  } catch (error) {
    spinner.fail('Failed to run test server');
    console.error(chalk.red('Error:'), error.message);
    
    // Attempt to clean up in case of error
    try {
      await new Promise((resolve) => {
        const dockerStop = spawn('docker', ['stop', 'valheim-test-server'], { 
          stdio: ['ignore', 'pipe', 'pipe'] 
        });
        
        dockerStop.on('close', () => {
          resolve();
        });
      });
    } catch (cleanupError) {
      // Ignore cleanup errors
    }
  }
}

// Set up test environment
async function setupTestEnvironment() {
  console.log(chalk.cyan.bold('\n📋 Setting Up Test Environment:'));
  
  const spinner = ora('Checking prerequisites...').start();
  
  // Check for required tools
  try {
    await Promise.all([
      checkCommand('npm', ['--version']),
      checkCommand('node', ['--version']),
      checkCommand('aws', ['--version']),
      checkCommand('docker', ['--version'])
    ]);
    
    spinner.succeed('All prerequisites are installed');
  } catch (error) {
    spinner.fail(`Missing prerequisite: ${error.message}`);
    console.log(chalk.red(`❌ Please install the missing requirement: ${error.message}`));
    return;
  }
  
  // Ask about environment configuration
  spinner.succeed('Ready to set up test environment');
  
  const config = getConfig();
  
  // Create .env.test file
  const { setupEnvFile } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'setupEnvFile',
      message: 'Create .env.test file for testing?',
      default: true
    }
  ]);
  
  if (setupEnvFile) {
    spinner.text = 'Creating .env.test file...';
    spinner.start();
    
    const envContent = `# HuginBot test environment
NODE_ENV=test
AWS_REGION=${config.region || 'us-west-2'}
DISCORD_AUTH_BYPASS=true
USE_MOCK_AWS=true
TEST_VALHEIM_IMAGE=lloesche/valheim-server
TEST_WORLD_NAME=TestWorld
TEST_SERVER_PASSWORD=valheim
`;
    
    const envPath = path.join(process.cwd(), '.env.test');
    
    try {
      fs.writeFileSync(envPath, envContent);
      spinner.succeed('.env.test file created');
    } catch (error) {
      spinner.fail('Failed to create .env.test file');
      console.error(chalk.red('Error:'), error.message);
    }
  }
  
  // Install test dependencies
  const { installDeps } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'installDeps',
      message: 'Install test dependencies?',
      default: true
    }
  ]);
  
  if (installDeps) {
    spinner.text = 'Installing test dependencies...';
    spinner.start();
    
    try {
      await new Promise((resolve, reject) => {
        const install = spawn('npm', ['install', '--save-dev', 'jest', 'jest-mock-extended', 'supertest', 'aws-sdk-mock'], { 
          stdio: ['ignore', 'pipe', 'pipe'] 
        });
        
        let output = '';
        
        install.stdout.on('data', (data) => {
          output += data.toString();
        });
        
        install.stderr.on('data', (data) => {
          output += data.toString();
        });
        
        install.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Installation failed with code ${code}:\n${output}`));
          }
        });
      });
      
      spinner.succeed('Test dependencies installed');
    } catch (error) {
      spinner.fail('Failed to install test dependencies');
      console.error(chalk.red('Error:'), error.message);
    }
  }
  
  // Set up test scripts in package.json
  const { updatePackageJson } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'updatePackageJson',
      message: 'Update package.json with test scripts?',
      default: true
    }
  ]);
  
  if (updatePackageJson) {
    spinner.text = 'Updating package.json...';
    spinner.start();
    
    try {
      const packageJsonPath = path.join(process.cwd(), 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      
      // Add or update test scripts
      packageJson.scripts = packageJson.scripts || {};
      packageJson.scripts['test'] = packageJson.scripts['test'] || 'jest';
      packageJson.scripts['test:watch'] = 'jest --watch';
      packageJson.scripts['test:e2e'] = 'NODE_ENV=test jest --config jest.e2e.config.js';
      packageJson.scripts['test:coverage'] = 'jest --coverage';
      packageJson.scripts['test:cleanup'] = 'node scripts/cleanup-test-resources.js';
      
      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
      spinner.succeed('package.json updated with test scripts');
    } catch (error) {
      spinner.fail('Failed to update package.json');
      console.error(chalk.red('Error:'), error.message);
    }
  }
  
  console.log(chalk.green('\n✅ Test environment setup complete!'));
  console.log('You can now run tests with: ' + chalk.cyan('npm test'));
  console.log('Or use the CLI test commands: ' + chalk.cyan('huginbot test local'));
}

// Run mock server for offline testing
async function runMockServer(options) {
  console.log(chalk.cyan.bold('\n📋 Running Mock Server:'));
  
  const port = options.port || 3000;
  
  // Check if mock server module exists
  const mockServerPath = path.join(process.cwd(), 'scripts', 'test', 'mock-server.js');
  
  if (!fs.existsSync(mockServerPath)) {
    console.log(chalk.yellow('⚠️  Mock server script not found at:'));
    console.log(mockServerPath);
    
    const { createMockServer } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'createMockServer',
        message: 'Create a basic mock server script?',
        default: true
      }
    ]);
    
    if (createMockServer) {
      const spinner = ora('Creating mock server script...').start();
      
      try {
        // Create directory if it doesn't exist
        const dirPath = path.join(process.cwd(), 'scripts', 'test');
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
        }
        
        const mockServerCode = `/**
 * HuginBot Mock Server for Testing
 * 
 * This server mocks AWS services for offline development and testing.
 */
const express = require('express');
const bodyParser = require('body-parser');

const app = express();
const port = process.env.PORT || ${port};

// Parse JSON bodies
app.use(bodyParser.json());

// Store mocked data
const mockData = {
  instances: {},
  stacks: {},
  parameters: {},
  logs: [],
  backups: []
};

// EC2 Instance endpoints
app.get('/ec2/instances', (req, res) => {
  res.json({ instances: Object.values(mockData.instances) });
});

app.get('/ec2/instances/:instanceId', (req, res) => {
  const instance = mockData.instances[req.params.instanceId];
  if (instance) {
    res.json({ instance });
  } else {
    res.status(404).json({ error: 'Instance not found' });
  }
});

app.post('/ec2/instances/:instanceId/start', (req, res) => {
  const instanceId = req.params.instanceId;
  if (mockData.instances[instanceId]) {
    mockData.instances[instanceId].state = 'running';
    res.json({ success: true, instance: mockData.instances[instanceId] });
  } else {
    res.status(404).json({ error: 'Instance not found' });
  }
});

app.post('/ec2/instances/:instanceId/stop', (req, res) => {
  const instanceId = req.params.instanceId;
  if (mockData.instances[instanceId]) {
    mockData.instances[instanceId].state = 'stopped';
    res.json({ success: true, instance: mockData.instances[instanceId] });
  } else {
    res.status(404).json({ error: 'Instance not found' });
  }
});

// CloudFormation stack endpoints
app.get('/cloudformation/stacks', (req, res) => {
  res.json({ stacks: Object.values(mockData.stacks) });
});

app.get('/cloudformation/stacks/:stackName', (req, res) => {
  const stack = mockData.stacks[req.params.stackName];
  if (stack) {
    res.json({ stack });
  } else {
    res.status(404).json({ error: 'Stack not found' });
  }
});

// SSM Parameter endpoints
app.get('/ssm/parameters', (req, res) => {
  res.json({ parameters: Object.values(mockData.parameters) });
});

app.get('/ssm/parameters/:name', (req, res) => {
  const param = mockData.parameters[req.params.name];
  if (param) {
    res.json({ parameter: param });
  } else {
    res.status(404).json({ error: 'Parameter not found' });
  }
});

app.put('/ssm/parameters/:name', (req, res) => {
  const name = req.params.name;
  const { value, type } = req.body;
  
  mockData.parameters[name] = { name, value, type };
  res.json({ success: true, parameter: mockData.parameters[name] });
});

// Default mock data initialization
function initMockData() {
  // Mock EC2 instance
  mockData.instances['i-0123456789abcdef0'] = {
    instanceId: 'i-0123456789abcdef0',
    state: 'stopped',
    instanceType: 't3.medium',
    publicIp: '54.123.45.67',
    launchTime: new Date().toISOString()
  };
  
  // Mock CloudFormation stacks
  mockData.stacks['ValheimStack'] = {
    stackName: 'ValheimStack',
    stackStatus: 'CREATE_COMPLETE',
    creationTime: new Date().toISOString(),
    outputs: [
      { OutputKey: 'InstanceId', OutputValue: 'i-0123456789abcdef0' },
      { OutputKey: 'BucketName', OutputValue: 'huginbot-valheim-backups' }
    ]
  };
  
  // Mock SSM parameters
  mockData.parameters['/huginbot/active-world'] = {
    name: '/huginbot/active-world',
    value: JSON.stringify({
      name: 'Default',
      worldName: 'ValheimWorld',
      serverPassword: 'valheim',
      discordServerId: ''
    }),
    type: 'String'
  };
}

// Initialize mock data
initMockData();

// Start server
app.listen(port, () => {
  console.log(\`HuginBot Mock Server running on port \${port}\`);
  console.log(\`Mock EC2 instance ID: i-0123456789abcdef0 (status: \${mockData.instances['i-0123456789abcdef0'].state})\`);
  console.log('Use this server for local development and testing without AWS');
});

// Export for testing
module.exports = app;
`;
        
        fs.writeFileSync(mockServerPath, mockServerCode);
        
        // Add express and body-parser dependencies
        await new Promise((resolve, reject) => {
          const install = spawn('npm', ['install', '--save-dev', 'express', 'body-parser'], { 
            stdio: ['ignore', 'pipe', 'pipe'] 
          });
          
          install.on('close', (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error('Failed to install mock server dependencies'));
            }
          });
        });
        
        spinner.succeed('Mock server script created');
      } catch (error) {
        spinner.fail('Failed to create mock server script');
        console.error(chalk.red('Error:'), error.message);
        return;
      }
    } else {
      console.log(chalk.yellow('❌ Mock server setup cancelled.'));
      return;
    }
  }
  
  const spinner = ora('Starting mock server...').start();
  
  // Start the mock server
  try {
    // Check if express is installed
    try {
      require.resolve('express');
      require.resolve('body-parser');
    } catch (error) {
      spinner.text = 'Installing required dependencies...';
      
      await new Promise((resolve, reject) => {
        const install = spawn('npm', ['install', '--save-dev', 'express', 'body-parser'], { 
          stdio: ['ignore', 'pipe', 'pipe'] 
        });
        
        install.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error('Failed to install mock server dependencies'));
          }
        });
      });
    }
    
    // Start the mock server process
    spinner.text = 'Starting mock server...';
    spinner.start();
    
    const mockServer = spawn('node', [mockServerPath], { 
      env: { ...process.env, PORT: port.toString() },
      stdio: ['ignore', 'pipe', 'pipe'] 
    });
    
    // Display initial output
    let serverStarted = false;
    
    mockServer.stdout.on('data', (data) => {
      const output = data.toString();
      
      if (output.includes('running on port')) {
        serverStarted = true;
        spinner.succeed(`Mock server running on port ${port}`);
        console.log(output.trim());
      } else if (serverStarted) {
        console.log(output.trim());
      }
    });
    
    mockServer.stderr.on('data', (data) => {
      console.error(chalk.red(data.toString().trim()));
    });
    
    // Wait for server to start
    await new Promise((resolve) => {
      setTimeout(() => {
        if (!serverStarted) {
          spinner.succeed(`Mock server started on port ${port}`);
        }
        resolve();
      }, 2000);
    });
    
    console.log(boxen(
      chalk.bold('🧪 Mock AWS Server 🧪\n\n') +
      `Server URL: ${chalk.green(`http://localhost:${port}`)}\n` +
      `Status: ${chalk.green('RUNNING')}\n\n` +
      `Use with AWS_ENDPOINT=http://localhost:${port}\n` +
      `For testing without actual AWS access\n\n` +
      chalk.yellow('Press Ctrl+C to stop the server'),
      { padding: 1, margin: 1, borderStyle: 'round', borderColor: 'cyan' }
    ));
    
    // Wait for user to press Ctrl+C
    await new Promise((resolve) => {
      process.on('SIGINT', () => {
        mockServer.kill();
        console.log(chalk.green('\n✅ Mock server stopped'));
        resolve();
      });
    });
  } catch (error) {
    spinner.fail('Failed to start mock server');
    console.error(chalk.red('Error:'), error.message);
  }
}

// Helper function to check if a command is available
async function checkCommand(command, args) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { 
      stdio: ['ignore', 'pipe', 'pipe'] 
    });
    
    process.on('close', (code) => {
      if (code === 0) {
        resolve(true);
      } else {
        reject(new Error(command));
      }
    });
    
    process.on('error', () => {
      reject(new Error(command));
    });
  });
}

module.exports = {
  register,
  runLocalTests,
  runE2ETests,
  runDockerInstance,
  setupTestEnvironment,
  runMockServer
};