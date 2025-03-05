import { S3Client, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";

const s3Client = new S3Client();
const BACKUP_BUCKET_NAME = process.env.BACKUP_BUCKET_NAME || '';
const BACKUPS_TO_KEEP = parseInt(process.env.BACKUPS_TO_KEEP || '7', 10);

export async function handler(): Promise<void> {
  if (!BACKUP_BUCKET_NAME) {
    console.error('BACKUP_BUCKET_NAME environment variable is not set');
    return;
  }

  try {
    console.log(`Cleaning up backups. Keeping ${BACKUPS_TO_KEEP} most recent backups per world.`);
    
    // List all objects in the bucket to find world folders
    const listCommand = new ListObjectsV2Command({
      Bucket: BACKUP_BUCKET_NAME,
      Delimiter: '/'
    });
    
    const response = await s3Client.send(listCommand);
    
    // Check for worlds directory
    const worldsPrefix = 'worlds/';
    
    // List objects in worlds directory
    const worldsCommand = new ListObjectsV2Command({
      Bucket: BACKUP_BUCKET_NAME,
      Prefix: worldsPrefix,
      Delimiter: '/'
    });
    
    const worldsResponse = await s3Client.send(worldsCommand);
    
    if (!worldsResponse.CommonPrefixes || worldsResponse.CommonPrefixes.length === 0) {
      // No world folders found, check for backups in the root
      await cleanupBackupsInFolder('');
    } else {
      // Process each world folder
      for (const prefix of worldsResponse.CommonPrefixes) {
        if (prefix.Prefix) {
          console.log(`Processing world folder: ${prefix.Prefix}`);
          await cleanupBackupsInFolder(prefix.Prefix);
        }
      }
    }
    
    console.log('Backup cleanup completed successfully for all worlds');
  } catch (error) {
    console.error('Error cleaning up backups:', error);
    throw error;
  }
}

async function cleanupBackupsInFolder(folderPrefix: string): Promise<void> {
  try {
    // List all backups in the folder
    const command = new ListObjectsV2Command({
      Bucket: BACKUP_BUCKET_NAME,
      Prefix: folderPrefix
    });
    
    const response = await s3Client.send(command);
    
    if (!response.Contents || response.Contents.length === 0) {
      console.log(`No backups found in folder: ${folderPrefix || 'root'}`);
      return;
    }
    
    // Sort backups by last modified date (most recent first)
    const backups = response.Contents
      .filter(item => item.Key && item.Key.endsWith('.tar.gz'))
      .sort((a, b) => {
        const dateA = a.LastModified ? a.LastModified.getTime() : 0;
        const dateB = b.LastModified ? b.LastModified.getTime() : 0;
        return dateB - dateA; // Sort descending
      });
    
    console.log(`Found ${backups.length} backups in folder: ${folderPrefix || 'root'}`);
    
    // Keep the most recent backups and delete the rest
    const backupsToDelete = backups.slice(BACKUPS_TO_KEEP);
    
    if (backupsToDelete.length === 0) {
      console.log(`No backups to delete in folder: ${folderPrefix || 'root'}`);
      return;
    }
    
    console.log(`Deleting ${backupsToDelete.length} old backups from folder: ${folderPrefix || 'root'}`);
    
    // Delete each old backup
    for (const backup of backupsToDelete) {
      if (backup.Key) {
        const deleteCommand = new DeleteObjectCommand({
          Bucket: BACKUP_BUCKET_NAME,
          Key: backup.Key,
        });
        
        await s3Client.send(deleteCommand);
        console.log(`Deleted backup: ${backup.Key}`);
      }
    }
  } catch (error) {
    console.error(`Error cleaning up backups in folder ${folderPrefix}:`, error);
    throw error;
  }
}