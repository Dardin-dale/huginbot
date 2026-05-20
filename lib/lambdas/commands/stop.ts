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

export async function handleStopCommand(guildId?: string, force: boolean = false): Promise<APIGatewayProxyResult> {
  try {
    console.log(`Stopping server command initiated (force: ${force})`);

    // Check current status
    const { status } = await getFastServerStatus();
    console.log(`Current instance status: ${status}`);

    if (status === 'stopped') {
      return {
        statusCode: 200,
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            embeds: [{
              title: '❌ Server Already Stopped',
              description: 'The server is not currently running.',
              color: 0xff6600,
              footer: { text: 'HuginBot • Use /start to launch the server' }
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
              title: '🛑 Server Already Stopping',
              description: 'The server is currently shutting down. Please wait.',
              color: 0xffaa00,
              footer: { text: 'HuginBot' }
            }]
          }
        })
      };
    }

    if (force) {
      // Force stop: skip backup, stop immediately
      console.log(`Force stop initiated - skipping backup`);

      await withRetry(() => ec2Client.send(new StopInstancesCommand({
        InstanceIds: [VALHEIM_INSTANCE_ID]
      })));
      console.log(`EC2 instance force stopped successfully`);

      // Send EventBridge notification
      try {
        const { EventBridgeClient, PutEventsCommand } = await import('@aws-sdk/client-eventbridge');
        const eventBridgeClient = new EventBridgeClient({ region: process.env.AWS_REGION });

        await eventBridgeClient.send(new PutEventsCommand({
          Entries: [{
            Source: 'valheim.server',
            DetailType: 'Server.Stopped',
            Detail: JSON.stringify({
              reason: 'discord_force_stop',
              backupCompleted: false,
              backupError: 'Skipped (force stop)',
              timestamp: Date.now(),
              guildId: guildId || 'unknown'
            }),
            EventBusName: 'default'
          }]
        }));
      } catch (eventError) {
        console.error('Failed to send EventBridge notification:', eventError);
      }

      return {
        statusCode: 200,
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            embeds: [{
              title: '⚡ Server Force Stopped',
              description: '**Emergency shutdown:**\n' +
                          '⚠️ Backup was skipped\n' +
                          '🛑 Server stopped immediately\n\n' +
                          '💡 World progress may be lost since last backup',
              color: 0xff0000,
              footer: { text: 'HuginBot • Use /stop without force for safe shutdown' }
            }]
          }
        })
      };
    }

    // Normal stop: trigger backup-and-stop script (fire and forget)
    console.log(`Triggering backup-and-stop script`);

    await withRetry(() => ssmClient.send(new SendCommandCommand({
      DocumentName: 'AWS-RunShellScript',
      InstanceIds: [VALHEIM_INSTANCE_ID],
      Parameters: {
        'commands': ['/usr/local/bin/backup-and-stop.sh']
      },
      Comment: 'Backup and stop triggered via Discord stop command'
    })));

    console.log(`Backup-and-stop script triggered (running in background)`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          embeds: [{
            title: '🛑 Valheim Server Stopping',
            description: '**Shutdown sequence initiated:**\n' +
                        '💾 Creating backup...\n' +
                        '🔄 Server will stop after backup completes\n\n' +
                        '💡 You\'ll receive notifications as the shutdown progresses',
            color: 0xff6600,
            footer: { text: 'HuginBot • Use "/stop force" to skip backup' }
          }]
        }
      })
    };

  } catch (error) {
    console.error('Error in handleStopCommand:', error);
    return {
      statusCode: 200,
      body: JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          embeds: [{
            title: '❌ Server Stop Failed',
            description: 'Unable to stop the server right now. Please try again in a moment.',
            color: 0xff0000,
            footer: { text: 'HuginBot • Contact admin if this persists' }
          }]
        }
      })
    };
  }
}
