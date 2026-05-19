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
  getDetailedServerStatus,
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

export async function handleModsCommand(data: any, guildId: string): Promise<APIGatewayProxyResult> {
  const subcommand = data.options?.[0]?.name;

  if (subcommand === 'list') {
    const worldOption = data.options?.[0]?.options?.[0]?.value;
    let worldConfig;
    let worldName: string;

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
      worldName = worldConfig.name;
    } else {
      // Get active world
      try {
        const result = await ssmClient.send(new GetParameterCommand({ Name: '/huginbot/active-world' }));
        const activeWorld = JSON.parse(result.Parameter?.Value || '{}');
        worldName = activeWorld.name || 'Unknown';
        worldConfig = WORLD_CONFIGS.find(w => w.name === activeWorld.name);
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

    // Get mods for this world
    let mods: string[] = [];
    const worldCount = parseInt(process.env.WORLD_COUNT || '0', 10);
    for (let i = 1; i <= worldCount; i++) {
      if (process.env[`WORLD_${i}_NAME`] === worldName) {
        const modsEnv = process.env[`WORLD_${i}_MODS`];
        if (modsEnv) {
          try {
            mods = JSON.parse(modsEnv);
          } catch (e) { /* ignore */ }
        }
        break;
      }
    }

    if (mods.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            embeds: [{
              title: `📦 Mods for ${worldName}`,
              description: 'No mods are configured for this world.',
              color: 0xffaa00,
              footer: {
                text: 'HuginBot • Mods are managed via CLI'
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
          embeds: [{
            title: `📦 Mods for ${worldName}`,
            description: `${mods.length} mod(s) enabled:`,
            color: 0x00ff00,
            fields: mods.map(mod => ({
              name: mod,
              value: 'Enabled',
              inline: true
            })),
            footer: {
              text: 'HuginBot • Use /worlds info for more details'
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
        content: 'Use `/mods list [world]` to see mods for a world.',
      },
    }),
  };
}

