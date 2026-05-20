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

export async function handleStatusCommand(): Promise<APIGatewayProxyResult> {
  try {
    console.log(`Getting server status details`);

    const { status, message: fastMessage, launchTime } = await getFastServerStatus();
    console.log(`Server status retrieved: ${status}`);

    // Try to get active world, join code, and player count from SSM
    let activeWorld: string | undefined;
    let joinCode: string | undefined;
    let playerCount: number | undefined;

    if (status === 'running') {
      try {
        const worldResult = await ssmClient.send(new GetParameterCommand({
          Name: SSM_PARAMS.ACTIVE_WORLD
        }));
        if (worldResult.Parameter?.Value) {
          const worldConfig = JSON.parse(worldResult.Parameter.Value);
          activeWorld = worldConfig.name || worldConfig.worldName;
        }
      } catch (err) {
        console.log('No active world found in SSM');
      }

      try {
        const joinCodeResult = await ssmClient.send(new GetParameterCommand({
          Name: SSM_PARAMS.PLAYFAB_JOIN_CODE
        }));
        joinCode = joinCodeResult.Parameter?.Value;
      } catch (err) {
        console.log('No join code found yet - server may still be loading');
      }

      try {
        const playerCountResult = await ssmClient.send(new GetParameterCommand({
          Name: '/huginbot/player-count'
        }));
        if (playerCountResult.Parameter?.Value) {
          playerCount = parseInt(playerCountResult.Parameter.Value, 10);
        }
      } catch (err) {
        console.log('No player count found in SSM');
      }
    }

    // Get auto-shutdown setting
    let autoShutdownMinutes: string | undefined;
    try {
      const shutdownResult = await ssmClient.send(new GetParameterCommand({
        Name: '/huginbot/auto-shutdown-minutes'
      }));
      autoShutdownMinutes = shutdownResult.Parameter?.Value;
    } catch (err) {
      console.log('Auto-shutdown parameter not found, using default');
      autoShutdownMinutes = '20';
    }

    // Determine server state
    let statusEmoji: string;
    let statusText: string;
    let description: string;
    let embedColor: number;

    if (status === 'stopped') {
      statusEmoji = '❌';
      statusText = 'Stopped';
      description = 'The server is currently offline.';
      embedColor = 0xff0000;
    } else if (status === 'stopping' || status === 'shutting-down') {
      statusEmoji = '🛑';
      statusText = 'Stopping';
      description = 'Server is shutting down...';
      embedColor = 0xff6600;
    } else if (status === 'running' && joinCode) {
      statusEmoji = '✅';
      statusText = 'Ready to Play!';
      description = 'The Valheim server is online and ready for adventure!';
      embedColor = 0x00ff00;
    } else if (status === 'running') {
      statusEmoji = '🔄';
      statusText = 'Booting';
      description = 'Server is loading... You\'ll get a notification when it\'s ready.';
      embedColor = 0xffaa00;
    } else if (status === 'pending') {
      statusEmoji = '⏳';
      statusText = 'Starting';
      description = 'Server is starting up...';
      embedColor = 0xffaa00;
    } else {
      statusEmoji = '⚠️';
      statusText = 'Unknown';
      description = fastMessage;
      embedColor = 0xff6600;
    }

    let fields: Array<{name: string, value: string, inline: boolean}> = [
      {
        name: 'Status',
        value: `${statusEmoji} ${statusText}`,
        inline: true,
      }
    ];

    // Add world info if available
    if (activeWorld) {
      fields.push({
        name: 'World',
        value: `🌍 ${activeWorld}`,
        inline: true,
      });
    }

    // Add player count if available (only when server is ready)
    if (joinCode && playerCount !== undefined) {
      fields.push({
        name: 'Players',
        value: `👥 ${playerCount}`,
        inline: true,
      });
    }

    // Add uptime if running
    if (status === 'running' && launchTime) {
      const uptimeMs = Date.now() - launchTime.getTime();
      const uptimeMinutes = Math.floor(uptimeMs / (1000 * 60));
      const uptimeHours = Math.floor(uptimeMinutes / 60);
      const remainingMinutes = uptimeMinutes % 60;

      fields.push({
        name: 'Uptime',
        value: uptimeHours > 0 ? `${uptimeHours}h ${remainingMinutes}m` : `${uptimeMinutes}m`,
        inline: true,
      });
    }

    // Add auto-shutdown info
    if (autoShutdownMinutes) {
      const shutdownText = autoShutdownMinutes === 'off' || autoShutdownMinutes === 'disabled'
        ? '⏸️ Disabled'
        : `⏱️ ${autoShutdownMinutes}m idle`;
      fields.push({
        name: 'Auto-Shutdown',
        value: shutdownText,
        inline: true,
      });
    }

    // Add join code if available
    if (joinCode) {
      fields.push({
        name: 'Join Code',
        value: `\`${joinCode}\``,
        inline: false,
      });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          embeds: [{
            title: 'Valheim Server Status',
            description: description,
            color: embedColor,
            fields: fields,
            footer: {
              text: joinCode ? 'HuginBot • Use /stop when done playing' : 'HuginBot • Use /start to launch the server'
            },
            timestamp: new Date().toISOString(),
          }],
        },
      }),
    };
  } catch (error) {
    console.error('Error in handleStatusCommand:', error);
    return {
      statusCode: 200,
      body: JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '❌ Failed to get server status. Please try again.',
        },
      }),
    };
  }
}
