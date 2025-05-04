/**
 * spinners.js - HuginBot CLI spinner components
 * 
 * Provides loading spinners and progress indicators
 */
const ora = require('ora');
const chalk = require('chalk');

/**
 * Predefined spinner styles for different operations
 */
const spinnerStyles = {
  // Deployment operations
  deploy: {
    color: 'cyan',
    text: 'Deploying...',
    successText: 'Deployment successful',
    failText: 'Deployment failed'
  },
  
  // Server operations
  server: {
    color: 'blue',
    text: 'Processing server operation...',
    successText: 'Server operation completed',
    failText: 'Server operation failed'
  },
  
  // Backup operations
  backup: {
    color: 'magenta',
    text: 'Processing backup...',
    successText: 'Backup operation completed',
    failText: 'Backup operation failed'
  },
  
  // Loading operations
  load: {
    color: 'yellow',
    text: 'Loading...',
    successText: 'Loading completed',
    failText: 'Loading failed'
  },
  
  // AWS operations
  aws: {
    color: 'cyan',
    text: 'Connecting to AWS...',
    successText: 'AWS operation completed',
    failText: 'AWS operation failed'
  },
  
  // Default spinner
  default: {
    color: 'cyan',
    text: 'Processing...',
    successText: 'Operation completed',
    failText: 'Operation failed'
  }
};

/**
 * Create a spinner with predefined style
 * @param {string} type - Spinner type (deploy, server, backup, load, aws, default)
 * @param {string} customText - Custom text to override default
 * @returns {Object} Ora spinner instance
 */
function createSpinner(type = 'default', customText = null) {
  const style = spinnerStyles[type] || spinnerStyles.default;
  const text = customText || style.text;
  
  return ora({
    text,
    color: style.color,
    spinner: 'dots'
  });
}

/**
 * Create a spinner for a specific operation
 * @param {string} operation - Operation name
 * @param {Object} options - Spinner options
 * @returns {Object} Ora spinner instance with additional methods
 */
function spinner(operation, options = {}) {
  const defaultOptions = {
    type: 'default',
    startText: null,
    successText: null,
    failText: null,
    color: null,
    autoStart: false
  };
  
  const opts = { ...defaultOptions, ...options };
  const style = spinnerStyles[opts.type] || spinnerStyles.default;
  
  // Build spinner text
  const startText = opts.startText || `${operation}...`;
  const successText = opts.successText || `${operation} completed successfully`;
  const failText = opts.failText || `${operation} failed`;
  
  // Create spinner
  const spin = ora({
    text: startText,
    color: opts.color || style.color,
    spinner: 'dots'
  });
  
  // Wrap standard methods to include custom text
  const originalSucceed = spin.succeed.bind(spin);
  const originalFail = spin.fail.bind(spin);
  
  // Override succeed method
  spin.succeed = (text = successText) => {
    return originalSucceed(text);
  };
  
  // Override fail method
  spin.fail = (text = failText) => {
    return originalFail(text);
  };
  
  // Add method to update with percentage
  spin.progress = (percent, additionalText = '') => {
    const progress = Math.floor(percent);
    const progressBar = createProgressBar(progress);
    const text = `${startText} ${progressBar} ${progress}%${additionalText ? ' ' + additionalText : ''}`;
    spin.text = text;
    return spin;
  };
  
  // Auto-start if requested
  if (opts.autoStart) {
    spin.start();
  }
  
  return spin;
}

/**
 * Create a simple progress bar string
 * @param {number} percent - Progress percentage (0-100)
 * @param {number} width - Width of the progress bar in characters
 * @returns {string} ASCII progress bar
 */
function createProgressBar(percent, width = 20) {
  const completed = Math.floor(percent * width / 100);
  const remaining = width - completed;
  
  return `[${chalk.green('='.repeat(completed))}${'-'.repeat(remaining)}]`;
}

/**
 * Run a function with a spinner showing progress
 * @param {Function} fn - Async function to run
 * @param {Object} options - Spinner options
 * @returns {Promise<any>} Result of the function
 */
async function withSpinner(fn, options = {}) {
  const defaultOptions = {
    operation: 'Operation',
    type: 'default',
    startText: null,
    successText: null, 
    failText: null
  };
  
  const opts = { ...defaultOptions, ...options };
  const spin = spinner(opts.operation, {
    ...opts,
    autoStart: true
  });
  
  try {
    const result = await fn(spin);
    spin.succeed();
    return result;
  } catch (error) {
    spin.fail(`${opts.operation} failed: ${error.message}`);
    throw error;
  }
}

/**
 * Create a multi-step spinner that tracks progress through multiple operations
 * @param {Array} steps - Array of step descriptions
 * @param {Object} options - Spinner options
 * @returns {Object} Multi-step spinner object
 */
function multiStep(steps, options = {}) {
  const defaultOptions = {
    type: 'default',
    color: null,
    autoStart: false
  };
  
  const opts = { ...defaultOptions, ...options };
  const style = spinnerStyles[opts.type] || spinnerStyles.default;
  
  // Initialize state
  const state = {
    steps,
    totalSteps: steps.length,
    currentStep: 0,
    startTime: null,
    spinner: null
  };
  
  // Create the spinner
  state.spinner = ora({
    text: getStepText(0),
    color: opts.color || style.color,
    spinner: 'dots'
  });
  
  // Helper to get step text
  function getStepText(index) {
    return `[${index + 1}/${state.totalSteps}] ${steps[index]}`;
  }
  
  // Create control methods
  const controls = {
    // Start the spinner
    start() {
      state.startTime = Date.now();
      state.spinner.start(getStepText(0));
      return this;
    },
    
    // Move to the next step
    next(customText = null) {
      state.currentStep++;
      
      if (state.currentStep >= state.totalSteps) {
        this.complete();
        return this;
      }
      
      const text = customText || getStepText(state.currentStep);
      state.spinner.text = text;
      return this;
    },
    
    // Update current step text
    update(text) {
      state.spinner.text = `[${state.currentStep + 1}/${state.totalSteps}] ${text}`;
      return this;
    },
    
    // Complete all steps
    complete(customText = null) {
      const duration = ((Date.now() - state.startTime) / 1000).toFixed(1);
      const text = customText || `All ${state.totalSteps} steps completed in ${duration}s`;
      state.spinner.succeed(text);
      return this;
    },
    
    // Fail the process
    fail(customText = null) {
      const text = customText || `Failed at step ${state.currentStep + 1}: ${steps[state.currentStep]}`;
      state.spinner.fail(text);
      return this;
    }
  };
  
  // Auto-start if requested
  if (opts.autoStart) {
    controls.start();
  }
  
  return controls;
}

module.exports = {
  spinnerStyles,
  createSpinner,
  spinner,
  withSpinner,
  multiStep
};