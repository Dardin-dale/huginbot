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

export async function handleStartCommand(worldName?: string, guildId?: string): Promise<APIGatewayProxyResult> {
  try {
    console.log(`Starting server command - worldName: ${worldName}, guildId: ${guildId}`);

    // Check current status
    const { status } = await getFastServerStatus();
    console.log(`Current instance status: ${status}`);

    if (status === 'running') {
      return {
        statusCode: 200,
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            embeds: [{
              title: '✅ Server Already Running',
              description: 'The Valheim server is already online!',
              color: 0x00ff00,
              footer: { text: 'HuginBot • Use /status to see server details' }
            }]
          }
        })
      };
    }

    if (status === 'pending') {
      return {
        statusCode: 200,
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            embeds: [{
              title: '🚀 Server Already Starting',
              description: 'The server is currently booting up. Please wait a moment.',
              color: 0xffaa00,
              footer: { text: 'HuginBot • You\'ll be notified when the join code is ready' }
            }]
          }
        })
      };
    }

    if (status === 'stopping') {
      return {
        statusCode: 200,
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            embeds: [{
              title: '⏸️ Server is Shutting Down',
              description: 'The server is currently stopping. Please wait a moment for it to fully stop before starting again.',
              color: 0xffaa00,
              footer: { text: 'HuginBot • Try again in a moment' }
            }]
          }
        })
      };
    }

    // Handle world configuration
    let selectedWorldConfig: WorldConfig | undefined;

    if (worldName) {
      selectedWorldConfig = WORLD_CONFIGS.find(w =>
        w.name.toLowerCase() === worldName.toLowerCase() ||
        w.worldName.toLowerCase() === worldName.toLowerCase()
      );

      if (!selectedWorldConfig) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `❌ World "${worldName}" not found. Use /worlds list to see available worlds.`
            }
          })
        };
      }
    } else if (guildId) {
      // Check for guild-specific default world in SSM first
      try {
        const guildDefaultParam = getGuildDefaultWorldParam(guildId);
        const guildDefaultResult = await ssmClient.send(new GetParameterCommand({
          Name: guildDefaultParam
        }));
        if (guildDefaultResult.Parameter?.Value) {
          const defaultWorldName = guildDefaultResult.Parameter.Value;
          console.log(`Found guild default world: ${defaultWorldName}`);
          selectedWorldConfig = WORLD_CONFIGS.find(w =>
            w.name.toLowerCase() === defaultWorldName.toLowerCase() ||
            w.worldName.toLowerCase() === defaultWorldName.toLowerCase()
          );
        }
      } catch (err) {
        // No guild default set, fall through to WORLD_CONFIGS filter
        console.log('No guild-specific default world set');
      }

      // Fall back to WORLD_CONFIGS filter if no SSM default
      if (!selectedWorldConfig) {
        const discordWorlds = WORLD_CONFIGS.filter(w => w.discordServerId === guildId);
        if (discordWorlds.length > 0) {
          selectedWorldConfig = discordWorlds[0];
        }
      }
    }

    if (selectedWorldConfig) {
      console.log(`Selected world: ${selectedWorldConfig.name} (${selectedWorldConfig.worldName})`);

      const validationErrors = validateWorldConfig(selectedWorldConfig);
      if (validationErrors.length > 0) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `❌ Invalid world configuration: ${validationErrors.join(', ')}`
            }
          })
        };
      }

      // Store active world configuration
      await withRetry(() =>
        ssmClient.send(new PutParameterCommand({
          Name: SSM_PARAMS.ACTIVE_WORLD,
          Value: JSON.stringify(selectedWorldConfig),
          Type: 'String',
          Overwrite: true
        }))
      );
      console.log(`Active world configuration saved`);
    }

    // Clear any existing join code
    try {
      await withRetry(() =>
        ssmClient.send(new DeleteParameterCommand({ Name: SSM_PARAMS.PLAYFAB_JOIN_CODE }))
      );
      console.log(`Cleared existing PlayFab join code`);
    } catch (err) {
      console.log('No existing PlayFab parameters found to delete');
    }

    // Start the instance
    console.log(`Starting EC2 instance: ${VALHEIM_INSTANCE_ID}`);
    await withRetry(() => ec2Client.send(new StartInstancesCommand({
      InstanceIds: [VALHEIM_INSTANCE_ID]
    })));
    console.log(`EC2 instance start command sent successfully`);

    const displayWorldName = selectedWorldConfig ? selectedWorldConfig.name : undefined;

    return {
      statusCode: 200,
      body: JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          embeds: [{
            title: '🚀 Server Starting',
            description: 'The server is booting up. This usually takes **3-5 minutes**.\n\n' +
                        'You\'ll get a notification with the join code when it\'s ready!',
            color: 0x00ff00,
            fields: displayWorldName ? [{
              name: '🌍 World',
              value: displayWorldName,
              inline: true,
            }] : [],
            footer: {
              text: 'HuginBot'
            },
            timestamp: new Date().toISOString(),
          }]
        }
      })
    };

  } catch (error) {
    console.error('Error in handleStartCommand:', error);
    return {
      statusCode: 200,
      body: JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          embeds: [{
            title: '❌ Server Start Failed',
            description: 'Unable to start the server right now. Please try again in a moment.',
            color: 0xff0000,
            footer: { text: 'HuginBot • Contact admin if this persists' }
          }]
        }
      })
    };
  }
}
