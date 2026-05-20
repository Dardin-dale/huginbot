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

export async function handleBackupCommand(data: any, guildId: string): Promise<APIGatewayProxyResult> {
  const subcommand = data.options?.[0]?.name || 'list';

  try {
    if (subcommand === 'create') {
      const status = await getInstanceStatus();
      
      if (status !== 'running') {
        return {
          statusCode: 200,
          body: JSON.stringify({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: '❌ Cannot create backup: Server is not running.',
            },
          }),
        };
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      
      await withRetry(() => ssmClient.send(new SendCommandCommand({
        DocumentName: 'AWS-RunShellScript',
        InstanceIds: [VALHEIM_INSTANCE_ID],
        Parameters: {
          'commands': ['/usr/local/bin/backup-valheim.sh']
        },
        Comment: `Manual backup triggered via Discord at ${timestamp}`
      })));

      return {
        statusCode: 200,
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: '💾 Backup initiated! This may take a few minutes to complete.',
            embeds: [{
              title: 'Backup Started',
              description: 'Creating a backup of the current world state.',
              color: 0x00aaff,
              footer: {
                text: 'HuginBot • Backup will appear in S3 bucket'
              },
              timestamp: new Date().toISOString(),
            }],
          },
        }),
      };
    } else {
      // List recent backups
      const listResponse = await withRetry(() => s3Client.send(new ListObjectsV2Command({
        Bucket: BACKUP_BUCKET_NAME,
        Prefix: 'worlds/',
        MaxKeys: 5
      })));

      const backups = listResponse.Contents ?
        listResponse.Contents
          .sort((a, b) => (b.LastModified?.getTime() || 0) - (a.LastModified?.getTime() || 0))
          .slice(0, 5)
          .map(item => {
            // Extract world name from S3 key: worlds/<WorldName>/valheim_backup_timestamp.tar.gz
            const keyParts = (item.Key || '').split('/');
            const worldName = keyParts.length >= 2 ? keyParts[1] : 'Unknown';

            const size = Math.round((item.Size || 0) / (1024 * 1024) * 10) / 10;
            const date = item.LastModified?.toISOString().replace('T', ' ').substring(0, 19) || 'Unknown';

            return {
              name: worldName,
              value: `${size} MB • ${date}`,
              inline: false
            };
          }) : [];

      return {
        statusCode: 200,
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            embeds: [{
              title: '💾 Recent Backups',
              description: backups.length > 0 ? 'Your most recent world backups:' : 'No backups found.',
              color: 0x00aaff,
              fields: backups,
              footer: {
                text: 'HuginBot • Use /backup create to make a new backup'
              }
            }],
          },
        }),
      };
    }
  } catch (error) {
    console.error('Error handling backup command:', error);
    return {
      statusCode: 200,
      body: JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '❌ Failed to handle backup request.',
        },
      }),
    };
  }
}

