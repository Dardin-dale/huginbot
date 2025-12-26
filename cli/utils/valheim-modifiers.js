/**
 * valheim-modifiers.js - Valheim Server Modifier Configuration
 *
 * Provides friendly interfaces for configuring Valheim's built-in server modifiers.
 * These are native game settings passed via SERVER_ARGS, not BepInEx mods.
 *
 * Reference: https://valheim.fandom.com/wiki/Modifiers
 */

const inquirer = require('inquirer');
const chalk = require('chalk');

/**
 * Individual modifiers available in Valheim
 * Each modifier can be set independently
 */
const MODIFIERS = {
  combat: {
    name: 'Combat Difficulty',
    description: 'Adjusts damage dealt by enemies',
    arg: '-modifier combat',
    options: [
      { value: 'veryeasy', label: 'Very Easy', description: 'Enemies deal 50% damage' },
      { value: 'easy', label: 'Easy', description: 'Enemies deal 75% damage' },
      { value: 'normal', label: 'Normal (Default)', description: 'Standard damage' },
      { value: 'hard', label: 'Hard', description: 'Enemies deal 150% damage' },
      { value: 'veryhard', label: 'Very Hard', description: 'Enemies deal 200% damage' }
    ],
    default: 'normal'
  },
  deathpenalty: {
    name: 'Death Penalty',
    description: 'What happens when you die',
    arg: '-modifier deathpenalty',
    options: [
      { value: 'casual', label: 'Casual', description: 'No skill loss on death' },
      { value: 'veryeasy', label: 'Very Easy', description: 'Lose 5% skills on death' },
      { value: 'easy', label: 'Easy', description: 'Lose 10% skills on death' },
      { value: 'normal', label: 'Normal (Default)', description: 'Lose 25% skills on death' },
      { value: 'hard', label: 'Hard', description: 'Lose 50% skills on death' },
      { value: 'hardcore', label: 'Hardcore', description: 'Character deleted on death' }
    ],
    default: 'normal'
  },
  resources: {
    name: 'Resource Rate',
    description: 'How many resources drop from gathering',
    arg: '-modifier resources',
    options: [
      { value: 'muchless', label: 'Much Less', description: '50% resource drops' },
      { value: 'less', label: 'Less', description: '75% resource drops' },
      { value: 'normal', label: 'Normal (Default)', description: 'Standard drops' },
      { value: 'more', label: 'More', description: '150% resource drops' },
      { value: 'muchmore', label: 'Much More', description: '200% resource drops' },
      { value: 'most', label: 'Most', description: '300% resource drops' }
    ],
    default: 'normal'
  },
  raids: {
    name: 'Raid Frequency',
    description: 'How often base raids occur',
    arg: '-modifier raids',
    options: [
      { value: 'none', label: 'None', description: 'No raids' },
      { value: 'muchless', label: 'Much Less', description: 'Raids very rare' },
      { value: 'less', label: 'Less', description: 'Raids less frequent' },
      { value: 'normal', label: 'Normal (Default)', description: 'Standard raid frequency' },
      { value: 'more', label: 'More', description: 'Raids more frequent' },
      { value: 'muchmore', label: 'Much More', description: 'Raids very frequent' }
    ],
    default: 'normal'
  },
  portals: {
    name: 'Portal Restrictions',
    description: 'What items can be teleported',
    arg: '-modifier portals',
    options: [
      { value: 'casual', label: 'Casual', description: 'All items can be teleported' },
      { value: 'normal', label: 'Normal (Default)', description: 'Metals cannot be teleported' },
      { value: 'hard', label: 'Hard', description: 'Only equipped items teleport' },
      { value: 'veryhard', label: 'Very Hard', description: 'No portals at all' }
    ],
    default: 'normal'
  }
};

/**
 * Preset configurations that combine multiple modifiers
 */
const PRESETS = {
  casual: {
    name: 'Casual',
    description: 'Relaxed gameplay, reduced penalties',
    arg: '-preset casual',
    settings: 'Combat: Easy, Death: Casual, Resources: More, Portals: Casual'
  },
  easy: {
    name: 'Easy',
    description: 'Slightly easier gameplay',
    arg: '-preset easy',
    settings: 'Combat: Easy, Death: Easy, Resources: More'
  },
  normal: {
    name: 'Normal (Default)',
    description: 'Standard Valheim experience',
    arg: '',
    settings: 'All modifiers at default values'
  },
  hard: {
    name: 'Hard',
    description: 'Challenging gameplay',
    arg: '-preset hard',
    settings: 'Combat: Hard, Death: Hard, Resources: Less'
  },
  hardcore: {
    name: 'Hardcore',
    description: 'Permadeath and brutal difficulty',
    arg: '-preset hardcore',
    settings: 'Combat: Very Hard, Death: Hardcore, No map sharing'
  },
  immersive: {
    name: 'Immersive',
    description: 'Slower, more atmospheric gameplay',
    arg: '-preset immersive',
    settings: 'No map markers, stamina drains faster'
  },
  hammer: {
    name: 'Hammer Mode',
    description: 'Creative/building focused',
    arg: '-preset hammer',
    settings: 'Infinite resources, no enemies, free building'
  }
};

/**
 * Build SERVER_ARGS string from modifier configuration
 * @param {Object} config - Modifier configuration object
 * @param {boolean} includeBase - Include base args like -crossplay
 * @returns {string} SERVER_ARGS string
 */
function buildServerArgs(config, includeBase = true) {
  const args = [];

  if (includeBase) {
    args.push('-crossplay');
  }

  // If a preset is selected, use it
  if (config.preset && config.preset !== 'normal' && PRESETS[config.preset]) {
    const presetArg = PRESETS[config.preset].arg;
    if (presetArg) {
      args.push(presetArg);
    }
    return args.join(' ');
  }

  // Otherwise, build from individual modifiers
  for (const [key, value] of Object.entries(config)) {
    if (key === 'preset') continue;

    const modifier = MODIFIERS[key];
    if (modifier && value && value !== 'normal' && value !== modifier.default) {
      args.push(`${modifier.arg} ${value}`);
    }
  }

  return args.join(' ');
}

/**
 * Parse SERVER_ARGS string into modifier configuration
 * @param {string} serverArgs - SERVER_ARGS string
 * @returns {Object} Modifier configuration object
 */
function parseServerArgs(serverArgs) {
  const config = {};

  if (!serverArgs) {
    return config;
  }

  // Check for presets first
  for (const [presetKey, preset] of Object.entries(PRESETS)) {
    if (preset.arg && serverArgs.includes(preset.arg)) {
      config.preset = presetKey;
      return config;
    }
  }

  // Parse individual modifiers
  for (const [modKey, modifier] of Object.entries(MODIFIERS)) {
    const regex = new RegExp(`${modifier.arg}\\s+(\\w+)`, 'i');
    const match = serverArgs.match(regex);
    if (match) {
      config[modKey] = match[1].toLowerCase();
    }
  }

  return config;
}

/**
 * Interactive prompt for selecting a preset
 * @returns {Promise<Object>} Selected preset configuration
 */
async function promptForPreset() {
  const choices = Object.entries(PRESETS).map(([key, preset]) => ({
    name: `${preset.name}${key === 'normal' ? '' : ` - ${preset.description}`}`,
    value: key
  }));

  choices.push({ name: chalk.cyan('Custom (configure individual modifiers)'), value: 'custom' });

  const { preset } = await inquirer.prompt([
    {
      type: 'list',
      name: 'preset',
      message: 'Select a gameplay preset:',
      choices,
      default: 'normal'
    }
  ]);

  if (preset === 'custom') {
    return await promptForModifiers();
  }

  return { preset };
}

/**
 * Interactive prompt for individual modifiers
 * @param {Object} currentConfig - Current modifier configuration
 * @returns {Promise<Object>} Updated modifier configuration
 */
async function promptForModifiers(currentConfig = {}) {
  console.log(chalk.cyan('\nConfigure individual game modifiers:'));
  console.log(chalk.gray('These are Valheim\'s built-in server settings.\n'));

  const config = { ...currentConfig };

  for (const [modKey, modifier] of Object.entries(MODIFIERS)) {
    const currentValue = currentConfig[modKey] || modifier.default;

    const choices = modifier.options.map(opt => ({
      name: `${opt.label}${opt.description ? ` - ${opt.description}` : ''}`,
      value: opt.value
    }));

    const { value } = await inquirer.prompt([
      {
        type: 'list',
        name: 'value',
        message: `${modifier.name}:`,
        choices,
        default: currentValue
      }
    ]);

    if (value !== modifier.default) {
      config[modKey] = value;
    } else {
      delete config[modKey];
    }
  }

  return config;
}

/**
 * Interactive prompt for modifier configuration (full workflow)
 * @param {Object} currentConfig - Current modifier configuration
 * @returns {Promise<{config: Object, serverArgs: string}>} Configuration and SERVER_ARGS
 */
async function promptForModifierConfig(currentConfig = {}) {
  console.log(chalk.cyan.bold('\nValheim Game Modifiers'));
  console.log(chalk.gray('Configure built-in Valheim server settings.\n'));

  // Show current configuration if any
  const currentKeys = Object.keys(currentConfig).filter(k => currentConfig[k] && currentConfig[k] !== 'normal');
  if (currentKeys.length > 0) {
    console.log(chalk.yellow('Current configuration:'));
    for (const key of currentKeys) {
      const modifier = MODIFIERS[key];
      if (modifier) {
        const option = modifier.options.find(o => o.value === currentConfig[key]);
        console.log(`  ${modifier.name}: ${option?.label || currentConfig[key]}`);
      } else if (key === 'preset') {
        const preset = PRESETS[currentConfig[key]];
        console.log(`  Preset: ${preset?.name || currentConfig[key]}`);
      }
    }
    console.log('');
  }

  const { configType } = await inquirer.prompt([
    {
      type: 'list',
      name: 'configType',
      message: 'How would you like to configure modifiers?',
      choices: [
        { name: 'Use a preset (quick setup)', value: 'preset' },
        { name: 'Configure individual modifiers', value: 'individual' },
        { name: 'Keep defaults (no modifiers)', value: 'default' }
      ]
    }
  ]);

  let config = {};

  if (configType === 'preset') {
    config = await promptForPreset();
  } else if (configType === 'individual') {
    config = await promptForModifiers(currentConfig);
  }
  // 'default' leaves config empty

  const serverArgs = buildServerArgs(config);

  return { config, serverArgs };
}

/**
 * Format modifier configuration for display
 * @param {Object} config - Modifier configuration
 * @returns {string} Formatted display string
 */
function formatModifierConfig(config) {
  if (!config || Object.keys(config).length === 0) {
    return 'Default settings';
  }

  if (config.preset && config.preset !== 'normal') {
    const preset = PRESETS[config.preset];
    if (preset) {
      return `Preset: ${preset.name}\n${preset.settings}`;
    }
  }

  const parts = [];
  for (const [key, value] of Object.entries(config)) {
    if (key === 'preset') continue;
    const modifier = MODIFIERS[key];
    if (modifier && value !== modifier.default) {
      const option = modifier.options.find(o => o.value === value);
      parts.push(`${modifier.name}: ${option?.label || value}`);
    }
  }

  return parts.length > 0 ? parts.join('\n') : 'Default settings';
}

/**
 * Get a summary of modifier configuration for Discord embeds
 * @param {Object} config - Modifier configuration
 * @returns {string} Short summary string
 */
function getModifierSummary(config) {
  if (!config || Object.keys(config).length === 0) {
    return 'Default';
  }

  if (config.preset && config.preset !== 'normal') {
    const preset = PRESETS[config.preset];
    return preset ? `${preset.name} Preset` : config.preset;
  }

  const parts = [];
  for (const [key, value] of Object.entries(config)) {
    if (key === 'preset') continue;
    const modifier = MODIFIERS[key];
    if (modifier && value !== modifier.default) {
      const option = modifier.options.find(o => o.value === value);
      const shortName = modifier.name.split(' ')[0];
      parts.push(`${shortName}: ${option?.label || value}`);
    }
  }

  return parts.length > 0 ? parts.join(', ') : 'Default';
}

module.exports = {
  MODIFIERS,
  PRESETS,
  buildServerArgs,
  parseServerArgs,
  promptForPreset,
  promptForModifiers,
  promptForModifierConfig,
  formatModifierConfig,
  getModifierSummary
};
