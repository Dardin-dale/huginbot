import { APIGatewayProxyResult } from "aws-lambda";
import {
  StartInstancesCommand,
  StopInstancesCommand,
} from "@aws-sdk/client-ec2";
import {
  GetParameterCommand,
  PutParameterCommand,
  DeleteParameterCommand,
  SendCommandCommand,
} from "@aws-sdk/client-ssm";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import {
  ec2Client,
  ssmClient,
  s3Client,
  withRetry,
  VALHEIM_INSTANCE_ID,
  BACKUP_BUCKET_NAME,
  SSM_PARAMS,
  getGuildDefaultWorldParam,
  getInstanceStatus,
  getStatusMessage,
  getFastServerStatus,
} from "../utils/aws-clients";
import {
  createSuccessResponse,
  createBadRequestResponse,
  createErrorResponse,
} from "../utils/responses";
import {
  WORLD_CONFIGS,
  WorldConfig,
  validateWorldConfig,
} from "../utils/world-config";
import { sendFollowUpMessage } from "../utils/discord-followup";
import { InteractionResponseType } from "./types";

export async function handleWorldsCommand(data: any, guildId: string): Promise<APIGatewayProxyResult> {
  const subcommand = data.options?.[0]?.name;

  if (subcommand === 'list') {
    const relevantWorlds = guildId
      ? WORLD_CONFIGS.filter(w => !w.discordServerId || w.discordServerId === guildId)
      : WORLD_CONFIGS;

    // Get current default for this guild
    let currentDefault: string | null = null;
    if (guildId) {
      try {
        const guildDefaultParam = getGuildDefaultWorldParam(guildId);
        const result = await ssmClient.send(new GetParameterCommand({ Name: guildDefaultParam }));
        currentDefault = result.Parameter?.Value || null;
      } catch (err) {
        // No default set
      }
    }

    if (relevantWorlds.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: '📋 No worlds configured for this server.',
          },
        }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          embeds: [{
            title: '🌍 Available Worlds',
            description: currentDefault
              ? `Default world: **${currentDefault}**\n\nThe following worlds are available:`
              : 'The following worlds are available:',
            color: 0x00aaff,
            fields: relevantWorlds.map(w => ({
              name: currentDefault && (w.name === currentDefault || w.worldName === currentDefault)
                ? `⭐ ${w.name}`
                : w.name,
              value: `Valheim world: ${w.worldName}`,
              inline: true,
            })),
            footer: {
              text: 'HuginBot • Use /worlds set-default <world> to change the default'
            }
          }],
        },
      }),
    };
  }

  if (subcommand === 'set-default') {
    const worldOption = data.options?.[0]?.options?.[0]?.value;

    if (!worldOption) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: '❌ Please specify a world name. Use `/worlds list` to see available worlds.',
          },
        }),
      };
    }

    // Find the world in WORLD_CONFIGS
    const worldConfig = WORLD_CONFIGS.find(w =>
      w.name.toLowerCase() === worldOption.toLowerCase() ||
      w.worldName.toLowerCase() === worldOption.toLowerCase()
    );

    if (!worldConfig) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `❌ World "${worldOption}" not found. Use \`/worlds list\` to see available worlds.`,
          },
        }),
      };
    }

    // Check if world is allowed for this guild
    if (worldConfig.discordServerId && worldConfig.discordServerId !== guildId) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `❌ World "${worldConfig.name}" is not available for this Discord server.`,
          },
        }),
      };
    }

    // Save the default world for this guild
    try {
      const guildDefaultParam = getGuildDefaultWorldParam(guildId);
      await ssmClient.send(new PutParameterCommand({
        Name: guildDefaultParam,
        Value: worldConfig.name,
        Type: 'String',
        Overwrite: true,
        Description: `Default world for Discord guild ${guildId}`
      }));

      return {
        statusCode: 200,
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            embeds: [{
              title: '⭐ Default World Set',
              description: `**${worldConfig.name}** is now the default world for this server.\n\nWhen you use \`/start\` without specifying a world, this world will be used.`,
              color: 0x00ff00,
              footer: {
                text: 'HuginBot • Use /start to launch the server'
              }
            }],
          },
        }),
      };
    } catch (error) {
      console.error('Failed to set default world:', error);
      return {
        statusCode: 200,
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: '❌ Failed to set default world. Please try again.',
          },
        }),
      };
    }
  }

  if (subcommand === 'info') {
    const worldOption = data.options?.[0]?.options?.[0]?.value;
    let worldConfig;

    if (worldOption) {
      // Find specific world
      worldConfig = WORLD_CONFIGS.find(w =>
        w.name.toLowerCase() === worldOption.toLowerCase() ||
        w.worldName.toLowerCase() === worldOption.toLowerCase()
      );

      if (!worldConfig) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `❌ World "${worldOption}" not found. Use \`/worlds list\` to see available worlds.`,
            },
          }),
        };
      }
    } else {
      // Get active world
      try {
        const result = await ssmClient.send(new GetParameterCommand({ Name: '/huginbot/active-world' }));
        const activeWorld = JSON.parse(result.Parameter?.Value || '{}');
        worldConfig = WORLD_CONFIGS.find(w => w.name === activeWorld.name);

        if (!worldConfig) {
          return {
            statusCode: 200,
            body: JSON.stringify({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                content: '❌ No active world found. Start a server or specify a world name.',
              },
            }),
          };
        }
      } catch (err) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: '❌ Could not determine active world. Please specify a world name.',
            },
          }),
        };
      }
    }

    // Get world overrides from environment (parse from WORLD_X_ vars)
    let mods: string[] = [];
    let modifiers: Record<string, string> = {};
    let serverArgs = '-crossplay';
    let bepInEx = 'true';

    // Find the world index and get overrides
    const worldCount = parseInt(process.env.WORLD_COUNT || '0', 10);
    for (let i = 1; i <= worldCount; i++) {
      if (process.env[`WORLD_${i}_NAME`] === worldConfig.name) {
        // Check for MODS override
        const modsEnv = process.env[`WORLD_${i}_MODS`];
        if (modsEnv) {
          try {
            mods = JSON.parse(modsEnv);
          } catch (e) { /* ignore */ }
        }
        // Check for MODIFIERS override
        const modifiersEnv = process.env[`WORLD_${i}_MODIFIERS`];
        if (modifiersEnv) {
          try {
            modifiers = JSON.parse(modifiersEnv);
          } catch (e) { /* ignore */ }
        }
        // Get SERVER_ARGS
        serverArgs = process.env[`WORLD_${i}_SERVER_ARGS`] || '-crossplay';
        bepInEx = process.env[`WORLD_${i}_BEPINEX`] || 'true';
        break;
      }
    }

    const fields = [
      { name: 'Valheim World', value: worldConfig.worldName, inline: true },
      { name: 'BepInEx', value: bepInEx === 'true' ? 'Enabled' : 'Disabled', inline: true },
    ];

    if (mods.length > 0) {
      fields.push({ name: 'Mods', value: mods.join(', '), inline: false });
    } else {
      fields.push({ name: 'Mods', value: 'None configured', inline: false });
    }

    // Add modifiers if any - display in a user-friendly way
    const modifierKeys = Object.keys(modifiers);
    if (modifierKeys.length > 0) {
      // Check if using a preset
      if (modifiers.preset && modifiers.preset !== 'normal') {
        const presetNames: Record<string, string> = {
          casual: 'Casual - Relaxed gameplay',
          easy: 'Easy - Slightly easier',
          hard: 'Hard - Challenging',
          hardcore: 'Hardcore - Permadeath',
          immersive: 'Immersive - Slower, atmospheric',
          hammer: 'Hammer Mode - Creative/building'
        };
        fields.push({
          name: 'Game Modifiers',
          value: presetNames[modifiers.preset] || `Preset: ${modifiers.preset}`,
          inline: false
        });
      } else {
        // Individual modifiers - show friendly names
        const modifierNames: Record<string, string> = {
          combat: 'Combat Difficulty',
          deathpenalty: 'Death Penalty',
          resources: 'Resource Rate',
          raids: 'Raid Frequency',
          portals: 'Portal Rules'
        };
        const modifierDisplay = modifierKeys
          .filter(k => k !== 'preset')
          .map(k => `${modifierNames[k] || k}: ${modifiers[k]}`)
          .join('\n');
        if (modifierDisplay) {
          fields.push({ name: 'Game Modifiers', value: modifierDisplay, inline: false });
        }
      }
    } else {
      fields.push({ name: 'Game Modifiers', value: 'Default settings', inline: false });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          embeds: [{
            title: `🌍 World Info: ${worldConfig.name}`,
            color: 0x00aaff,
            fields,
            footer: {
              text: 'HuginBot • Use /mods list to see all available mods'
            }
          }],
        },
      }),
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: 'Use `/worlds list` to see available worlds or `/worlds set-default <world>` to set a default.',
      },
    }),
  };
}
