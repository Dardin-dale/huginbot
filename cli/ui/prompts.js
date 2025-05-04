/**
 * prompts.js - HuginBot CLI prompt components
 * 
 * Handles user input and interactive prompts
 */
const inquirer = require('inquirer');
const chalk = require('chalk');

/**
 * Common validation functions for prompts
 */
const validation = {
  // Validate required fields
  required: (name) => (input) => 
    input.trim() !== '' ? true : `${name} is required`,
  
  // Validate minimum length
  minLength: (name, min) => (input) => 
    input.trim().length >= min ? true : `${name} must be at least ${min} characters`,
  
  // Validate numeric values
  numeric: (name) => (input) => 
    /^\d+$/.test(input.trim()) ? true : `${name} must be a number`,
  
  // Validate AWS region format
  awsRegion: (input) => 
    /^[a-z]{2}-[a-z]+-\d+$/.test(input.trim()) ? true : 'Must be a valid AWS region (e.g., us-west-2)',
  
  // Validate port number
  port: (input) => {
    const port = parseInt(input.trim(), 10);
    return (!isNaN(port) && port >= 1 && port <= 65535) ? 
      true : 'Port must be a number between 1 and 65535';
  },
  
  // Validate Discord ID (snowflake) format
  discordId: (input) => 
    input.trim() === '' || /^\d{17,19}$/.test(input.trim()) ? true : 'Discord ID must be a 17-19 digit number',
  
  // Validate file path
  filePath: (input) => 
    /^[\/\\]?([a-zA-Z0-9-_\.]+[\/\\])*([a-zA-Z0-9-_\.]+)?$/.test(input.trim()) ? 
      true : 'Invalid file path format'
};

/**
 * Predefined prompt configurations to maintain consistency
 */
const defaultPrompts = {
  // Confirmation prompt with custom message
  confirm: (message, defaultValue = false) => ({
    type: 'confirm',
    message,
    default: defaultValue
  }),
  
  // Text input with validation
  input: (message, defaultValue = '', validator = null) => ({
    type: 'input',
    message,
    default: defaultValue,
    validate: validator
  }),
  
  // Password input with validation
  password: (message, defaultValue = '', validator = null) => ({
    type: 'password',
    message,
    default: defaultValue,
    validate: validator,
    mask: '*'
  }),
  
  // Selection list
  list: (message, choices, defaultValue = null) => ({
    type: 'list',
    message,
    choices,
    default: defaultValue,
    pageSize: 10
  }),
  
  // Checkbox (multiple selection)
  checkbox: (message, choices, defaultValue = []) => ({
    type: 'checkbox',
    message,
    choices,
    default: defaultValue,
    pageSize: 10
  })
};

/**
 * Ask for AWS configuration
 * @returns {Promise<Object>} AWS configuration
 */
async function promptAwsConfig() {
  return inquirer.prompt([
    {
      ...defaultPrompts.input('AWS Region:', 'us-west-2', validation.awsRegion),
      name: 'region'
    },
    {
      ...defaultPrompts.input('AWS Profile (leave empty for default):', ''),
      name: 'profile'
    }
  ]);
}

/**
 * Ask for server configuration
 * @param {Object} defaults - Default values
 * @returns {Promise<Object>} Server configuration
 */
async function promptServerConfig(defaults = {}) {
  return inquirer.prompt([
    {
      ...defaultPrompts.input(
        'Server Name:', 
        defaults.serverName || 'ValheimServer', 
        validation.required('Server name')
      ),
      name: 'serverName'
    },
    {
      ...defaultPrompts.password(
        'Server Password:', 
        defaults.serverPassword || 'valheim', 
        validation.minLength('Password', 5)
      ),
      name: 'serverPassword'
    },
    {
      ...defaultPrompts.list(
        'Instance Type:', 
        [
          { name: 't3.micro - 2 vCPU, 1 GB RAM (not recommended)', value: 't3.micro' },
          { name: 't3.small - 2 vCPU, 2 GB RAM (minimal, 1-2 players)', value: 't3.small' },
          { name: 't3.medium - 2 vCPU, 4 GB RAM (recommended, 2-5 players)', value: 't3.medium' },
          { name: 't3.large - 2 vCPU, 8 GB RAM (optimal, 5-10 players)', value: 't3.large' }
        ],
        defaults.instanceType || 't3.medium'
      ),
      name: 'instanceType'
    }
  ]);
}

/**
 * Ask for Discord configuration
 * @param {Object} defaults - Default values
 * @returns {Promise<Object>} Discord configuration
 */
async function promptDiscordConfig(defaults = {}) {
  return inquirer.prompt([
    {
      ...defaultPrompts.input(
        'Discord Application ID:', 
        defaults.appId || '', 
        validation.required('Application ID')
      ),
      name: 'appId'
    },
    {
      ...defaultPrompts.input(
        'Discord Public Key:', 
        defaults.publicKey || '', 
        validation.required('Public key')
      ),
      name: 'publicKey'
    },
    {
      ...defaultPrompts.password(
        'Discord Bot Token:', 
        defaults.botToken || '', 
        validation.required('Bot token')
      ),
      name: 'botToken'
    }
  ]);
}

/**
 * Ask for world configuration
 * @param {Object} defaults - Default values
 * @returns {Promise<Object>} World configuration
 */
async function promptWorldConfig(defaults = {}) {
  return inquirer.prompt([
    {
      ...defaultPrompts.input(
        'World Name:', 
        defaults.worldName || 'ValheimWorld', 
        validation.required('World name')
      ),
      name: 'worldName'
    },
    {
      ...defaultPrompts.input(
        'Display Name:', 
        defaults.name || '', 
        validation.required('Display name')
      ),
      name: 'name'
    },
    {
      ...defaultPrompts.password(
        'Server Password:', 
        defaults.serverPassword || 'valheim', 
        validation.minLength('Password', 5)
      ),
      name: 'serverPassword'
    },
    {
      ...defaultPrompts.input(
        'Discord Server ID (optional):', 
        defaults.discordServerId || '', 
        validation.discordId
      ),
      name: 'discordServerId'
    }
  ]);
}

/**
 * Ask for confirmation with customizable yes/no responses
 * @param {string} message - Confirmation prompt message
 * @param {Object} options - Customization options
 * @returns {Promise<boolean>} User confirmation
 */
async function confirm(message, options = {}) {
  const defaultOptions = {
    default: false,
    yes: 'Yes',
    no: 'No',
    color: 'yellow'
  };
  
  const opts = { ...defaultOptions, ...options };
  
  const colorFn = chalk[opts.color] || chalk.yellow;
  const formattedMessage = colorFn(message);
  
  const { confirmed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message: formattedMessage,
      default: opts.default
    }
  ]);
  
  return confirmed;
}

/**
 * Prompt for a selection from a list with enhanced display
 * @param {string} message - Prompt message
 * @param {Array} items - Selection items
 * @param {Object} options - Customization options
 * @returns {Promise<any>} Selected item
 */
async function select(message, items, options = {}) {
  const defaultOptions = {
    pageSize: 10,
    default: null,
    nameField: 'name',
    valueField: 'value',
    color: 'cyan'
  };
  
  const opts = { ...defaultOptions, ...options };
  const colorFn = chalk[opts.color] || chalk.cyan;
  
  // Transform items if they're not already in the right format
  const choices = items.map(item => {
    if (typeof item === 'object' && item !== null) {
      return {
        name: item[opts.nameField] || String(item),
        value: item[opts.valueField] || item
      };
    }
    return {
      name: String(item),
      value: item
    };
  });
  
  const { selected } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selected',
      message: colorFn(message),
      choices,
      pageSize: opts.pageSize,
      default: opts.default
    }
  ]);
  
  return selected;
}

/**
 * Prompt for text input with validation and customization
 * @param {string} message - Prompt message
 * @param {Object} options - Customization options
 * @returns {Promise<string>} User input
 */
async function input(message, options = {}) {
  const defaultOptions = {
    default: '',
    validate: null,
    color: 'cyan',
    required: false,
    secret: false
  };
  
  const opts = { ...defaultOptions, ...options };
  const colorFn = chalk[opts.color] || chalk.cyan;
  
  // Build validator
  let validator = opts.validate;
  if (opts.required && !validator) {
    validator = input => input.trim() !== '' ? true : 'This field is required';
  }
  
  const { value } = await inquirer.prompt([
    {
      type: opts.secret ? 'password' : 'input',
      name: 'value',
      message: colorFn(message),
      default: opts.default,
      validate: validator,
      mask: opts.secret ? '*' : undefined
    }
  ]);
  
  return value;
}

/**
 * Present a menu of actions and execute the selected one
 * @param {string} title - Menu title
 * @param {Array} actions - Available actions
 * @param {Object} options - Customization options
 * @returns {Promise<any>} Result of the executed action
 */
async function menu(title, actions, options = {}) {
  const defaultOptions = {
    pageSize: 10,
    color: 'cyan',
    exitOption: true,
    exitText: 'Back'
  };
  
  const opts = { ...defaultOptions, ...options };
  const colorFn = chalk[opts.color] || chalk.cyan;
  
  // Add exit option if requested
  const choices = [...actions];
  if (opts.exitOption) {
    choices.push({
      name: chalk.gray(opts.exitText),
      value: null
    });
  }
  
  const { selected } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selected',
      message: colorFn(title),
      choices: choices.map(action => ({
        name: action.name,
        value: action.value || action
      })),
      pageSize: opts.pageSize
    }
  ]);
  
  // Exit if null is selected
  if (selected === null) {
    return null;
  }
  
  // Find the selected action
  const selectedAction = actions.find(action => 
    (action.value && action.value === selected) || action === selected
  );
  
  // Execute the action handler if it exists
  if (selectedAction && selectedAction.handler) {
    return await selectedAction.handler();
  }
  
  return selected;
}

module.exports = {
  validation,
  defaultPrompts,
  promptAwsConfig,
  promptServerConfig,
  promptDiscordConfig,
  promptWorldConfig,
  confirm,
  select,
  input,
  menu
};