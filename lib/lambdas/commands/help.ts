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

export async function handleHelpCommand(): Promise<APIGatewayProxyResult> {
  return {
    statusCode: 200,
    body: JSON.stringify({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        embeds: [{
          title: '📚 HuginBot Help',
          description: 'HuginBot helps you manage your Valheim server from Discord.',
          color: 0x5865f2,
          fields: [
            {
              name: 'Server Commands',
              value: [
                '`/start [world]` - Start the Valheim server',
                '`/stop` - Stop the Valheim server',
                '`/status` - Check server status',
              ].join('\n'),
            },
            {
              name: 'World & Backup Commands',
              value: [
                '`/worlds list` - List available worlds',
                '`/backup list` - Show recent backups',
                '`/backup create` - Create a new backup',
              ].join('\n'),
            },
            {
              name: 'Setup & Fun',
              value: [
                '`/setup` - Set up server notifications',
                '`/hail` - Get wisdom from Hugin',
                '`/help` - Show this help menu',
              ].join('\n'),
            },
            {
              name: 'Getting Started',
              value: '1. Use `/setup` to configure notifications\n2. Use `/start` to launch the server\n3. Wait for the join code notification',
            },
          ],
          footer: {
            text: 'HuginBot • Valheim Server Manager'
          }
        }],
      },
    }),
  };
}

