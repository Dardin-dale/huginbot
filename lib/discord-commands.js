/**
 * Discord slash-command schema for HuginBot.
 *
 * Consumed by `register-commands.js` to register/diff slash commands with
 * Discord at setup time. The runtime Lambda doesn't use this — it dispatches
 * by command name string in `lib/lambdas/commands.ts`.
 */

// Discord application command option types
// https://discord.com/developers/docs/interactions/application-commands#application-command-object-application-command-option-type
const STRING = 3;
const BOOLEAN = 5;
const SUB_COMMAND = 1;

const DISCORD_COMMANDS = [
  {
    name: 'start',
    description: 'Start the Valheim server',
    options: [
      {
        type: STRING,
        name: 'world',
        description: "World to load (defaults to this server's configured default)",
        required: false,
      },
    ],
  },
  {
    name: 'stop',
    description: 'Stop the Valheim server (backs up first)',
    options: [
      {
        type: BOOLEAN,
        name: 'force',
        description: 'Skip backup and stop immediately',
        required: false,
      },
    ],
  },
  {
    name: 'status',
    description: 'Check the Valheim server status',
  },
  {
    name: 'worlds',
    description: 'Manage Valheim worlds',
    options: [
      {
        type: SUB_COMMAND,
        name: 'list',
        description: 'List available worlds for this server',
      },
      {
        type: SUB_COMMAND,
        name: 'set-default',
        description: 'Set the default world for this Discord server',
        options: [
          {
            type: STRING,
            name: 'world',
            description: 'World name',
            required: true,
          },
        ],
      },
      {
        type: SUB_COMMAND,
        name: 'info',
        description: 'Show details about a world',
        options: [
          {
            type: STRING,
            name: 'world',
            description: 'World name (defaults to active world)',
            required: false,
          },
        ],
      },
    ],
  },
  {
    name: 'backup',
    description: 'Manage server backups',
    options: [
      {
        type: SUB_COMMAND,
        name: 'list',
        description: 'List recent backups',
      },
      {
        type: SUB_COMMAND,
        name: 'create',
        description: 'Create a new backup of the active world',
      },
    ],
  },
  {
    name: 'mods',
    description: 'View configured mods for a world',
    options: [
      {
        type: SUB_COMMAND,
        name: 'list',
        description: 'List mods configured for a world',
        options: [
          {
            type: STRING,
            name: 'world',
            description: 'World name (defaults to active world)',
            required: false,
          },
        ],
      },
    ],
  },
  {
    name: 'setup',
    description: 'Configure Discord notifications for this server',
  },
  {
    name: 'hail',
    description: 'Get wisdom from Hugin',
  },
  {
    name: 'help',
    description: 'Show HuginBot help',
  },
];

async function getRegisteredCommands(appId, botToken) {
  const url = `https://discord.com/api/v10/applications/${appId}/commands`;
  const response = await fetch(url, {
    headers: { Authorization: `Bot ${botToken}` },
  });
  if (!response.ok) {
    throw new Error(`Discord API ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

function compareCommands(local, registered) {
  const localNames = local.map((c) => c.name);
  const registeredNames = registered.map((c) => c.name);
  const matching = localNames.filter((n) => registeredNames.includes(n));
  const missing = localNames.filter((n) => !registeredNames.includes(n));
  const extra = registeredNames.filter((n) => !localNames.includes(n));
  return {
    local,
    registered,
    matching,
    missing,
    extra,
    inSync: missing.length === 0 && extra.length === 0,
  };
}

module.exports = { DISCORD_COMMANDS, getRegisteredCommands, compareCommands };
