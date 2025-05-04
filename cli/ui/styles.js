/**
 * styles.js - HuginBot CLI styling utilities
 * 
 * Provides styling for CLI output
 */
const chalk = require('chalk');
const boxen = require('boxen');
const figlet = require('figlet');

/**
 * Style constants for consistent CLI appearance
 */
const styles = {
  // Color schemes
  colors: {
    primary: 'cyan',
    secondary: 'yellow',
    success: 'green',
    warning: 'yellow',
    error: 'red',
    info: 'blue',
    muted: 'gray',
    highlight: 'magenta'
  },
  
  // Emoji icons for different categories
  icons: {
    server: '🖥️',
    world: '🌍',
    backup: '💾',
    discord: '🤖',
    config: '⚙️',
    deploy: '🚀',
    error: '❌',
    warning: '⚠️',
    success: '✅',
    info: 'ℹ️',
    help: '❓',
    list: '📋'
  },
  
  // Box styles for different types of displays
  boxes: {
    error: {
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: 'red',
      backgroundColor: '#400000'
    },
    success: {
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: 'green',
      backgroundColor: '#004000'
    },
    info: {
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: 'blue',
      backgroundColor: '#000040'
    },
    warning: {
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: 'yellow',
      backgroundColor: '#404000'
    },
    plain: {
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: 'white'
    }
  }
};

/**
 * Generate a stylized header with ASCII art
 * @param {string} text - Header text
 * @param {Object} options - Customization options
 * @returns {string} Stylized header
 */
function header(text, options = {}) {
  const defaultOptions = {
    color: styles.colors.primary,
    font: 'Standard',
    horizontalLayout: 'full'
  };
  
  const opts = { ...defaultOptions, ...options };
  
  try {
    return chalk[opts.color](
      figlet.textSync(text, {
        font: opts.font,
        horizontalLayout: opts.horizontalLayout
      })
    );
  } catch (error) {
    // Fallback if figlet fails
    return chalk[opts.color].bold('=== ' + text + ' ===');
  }
}

/**
 * Create a boxed message
 * @param {string} text - Message content
 * @param {string} type - Box type: 'error', 'success', 'info', 'warning', or 'plain'
 * @returns {string} Boxed message
 */
function box(text, type = 'plain') {
  if (!styles.boxes[type]) {
    type = 'plain';
  }
  
  return boxen(text, styles.boxes[type]);
}

/**
 * Format a title with an icon
 * @param {string} text - Title text
 * @param {string} icon - Icon key from styles.icons
 * @param {string} color - Color from styles.colors
 * @returns {string} Formatted title
 */
function title(text, icon = 'info', color = 'primary') {
  const emoji = styles.icons[icon] || '';
  const chalkColor = styles.colors[color] || styles.colors.primary;
  
  return `${emoji} ${chalk[chalkColor].bold(text)}`;
}

/**
 * Create a list item with optional icon and color
 * @param {string} text - Item text
 * @param {string} icon - Optional icon
 * @param {string} color - Optional color
 * @returns {string} Formatted list item
 */
function listItem(text, icon = '', color = 'primary') {
  const emoji = icon ? (styles.icons[icon] || icon) : '';
  const chalkColor = styles.colors[color] || styles.colors.primary;
  const prefix = emoji ? `${emoji} ` : '  ';
  
  return `${prefix}${chalk[chalkColor](text)}`;
}

/**
 * Create a status message
 * @param {string} type - Status type: 'success', 'error', 'warning', or 'info'
 * @param {string} message - Status message
 * @returns {string} Formatted status message
 */
function status(type, message) {
  if (!styles.colors[type]) {
    type = 'info';
  }
  
  const icon = styles.icons[type] || '';
  
  return `${icon} ${chalk[styles.colors[type]](message)}`;
}

/**
 * Format a command example
 * @param {string} command - Command text
 * @param {string} description - Optional description
 * @returns {string} Formatted command example
 */
function command(command, description = '') {
  const formattedCommand = chalk.cyan(`$ ${command}`);
  
  if (description) {
    return `${formattedCommand}\n  ${chalk.gray(description)}`;
  }
  
  return formattedCommand;
}

/**
 * Format a key-value pair for display
 * @param {string} key - Key name
 * @param {string} value - Value
 * @param {string} keyColor - Color for key
 * @param {string} valueColor - Color for value
 * @returns {string} Formatted key-value pair
 */
function keyValue(key, value, keyColor = 'primary', valueColor = 'secondary') {
  const formattedKey = chalk[styles.colors[keyColor] || styles.colors.primary](`${key}:`);
  const formattedValue = chalk[styles.colors[valueColor] || styles.colors.secondary](value);
  
  return `${formattedKey} ${formattedValue}`;
}

/**
 * Create a section separator
 * @param {string} title - Optional section title
 * @param {string} color - Color for separator
 * @returns {string} Formatted separator
 */
function separator(title = '', color = 'muted') {
  const chalkColor = styles.colors[color] || styles.colors.muted;
  const line = '───────────────────────────────────────────────────';
  
  if (title) {
    return chalk[chalkColor](`─── ${title} ${line.substring(title.length + 5)}`);
  }
  
  return chalk[chalkColor](line);
}

/**
 * Format a link
 * @param {string} text - Link text
 * @param {string} url - URL
 * @returns {string} Formatted link
 */
function link(text, url) {
  return `${text}: ${chalk.blue.underline(url)}`;
}

/**
 * Format a table row
 * @param {Array} cells - Cell values
 * @param {Array} widths - Column widths
 * @param {Array} colors - Column colors
 * @returns {string} Formatted table row
 */
function tableRow(cells, widths, colors = []) {
  return cells.map((cell, i) => {
    const color = colors[i] ? styles.colors[colors[i]] || 'white' : 'white';
    const width = widths[i] || 20;
    const text = String(cell || '').padEnd(width).substring(0, width);
    return chalk[color](text);
  }).join(' ');
}

/**
 * Format a help section with command and description
 * @param {string} command - Command syntax
 * @param {string} description - Command description
 * @returns {string} Formatted help section
 */
function helpItem(command, description) {
  return `${chalk.cyan(command.padEnd(30))} ${description}`;
}

/**
 * Format error messages
 * @param {string} message - Error message
 * @param {Error} error - Optional Error object
 * @returns {string} Formatted error message
 */
function error(message, error = null) {
  let output = `${styles.icons.error} ${chalk.red(message)}`;
  
  if (error && error.message) {
    output += `\n${chalk.red.dim(error.message)}`;
  }
  
  return output;
}

module.exports = {
  styles,
  header,
  box,
  title,
  listItem,
  status,
  command,
  keyValue,
  separator,
  link,
  tableRow,
  helpItem,
  error
};