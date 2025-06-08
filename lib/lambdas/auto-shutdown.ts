import { SNSEvent, Context } from 'aws-lambda';
import { EC2Client, StopInstancesCommand, DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const ec2Client = new EC2Client();
const eventBridgeClient = new EventBridgeClient();

const VALHEIM_INSTANCE_ID = process.env.VALHEIM_INSTANCE_ID!;
const MIN_UPTIME_MINUTES = parseInt(process.env.MIN_UPTIME_MINUTES || '10');

export async function handler(event: SNSEvent, context: Context): Promise<void> {
  console.log('Auto-shutdown triggered:', JSON.stringify(event, null, 2));
  
  try {
    if (!VALHEIM_INSTANCE_ID) {
      console.error('VALHEIM_INSTANCE_ID environment variable not set');
      return;
    }

    // Get instance details
    const describeResult = await ec2Client.send(new DescribeInstancesCommand({
      InstanceIds: [VALHEIM_INSTANCE_ID]
    }));

    const instance = describeResult.Reservations?.[0]?.Instances?.[0];
    if (!instance) {
      console.error('Instance not found:', VALHEIM_INSTANCE_ID);
      return;
    }

    // Check if instance is actually running
    if (instance.State?.Name !== 'running') {
      console.log(`Instance is not running (state: ${instance.State?.Name}), skipping shutdown`);
      return;
    }

    // Check grace period - make sure server has been up for minimum time
    const launchTime = instance.LaunchTime;
    if (launchTime) {
      const uptimeMs = Date.now() - launchTime.getTime();
      const uptimeMinutes = uptimeMs / (1000 * 60);
      
      if (uptimeMinutes < MIN_UPTIME_MINUTES) {
        console.log(`Server has only been up for ${Math.round(uptimeMinutes)} minutes (minimum: ${MIN_UPTIME_MINUTES}), skipping shutdown`);
        return;
      }
      
      console.log(`Server uptime: ${Math.round(uptimeMinutes)} minutes, proceeding with shutdown`);
    }

    // Parse the SNS message to get alarm details
    const snsMessage = JSON.parse(event.Records[0].Sns.Message);
    const alarmName = snsMessage.AlarmName;
    const trigger = snsMessage.Trigger;
    
    console.log(`Alarm ${alarmName} triggered, stopping instance ${VALHEIM_INSTANCE_ID}`);

    // Stop the instance
    await ec2Client.send(new StopInstancesCommand({
      InstanceIds: [VALHEIM_INSTANCE_ID]
    }));

    // Calculate metrics for the shutdown event
    const uptimeMs = launchTime ? Date.now() - launchTime.getTime() : 0;
    const uptimeMinutes = Math.round(uptimeMs / (1000 * 60));
    const idleTime = 600; // 10 minutes (based on alarm configuration)

    // Publish EventBridge event for Discord notification
    await eventBridgeClient.send(new PutEventsCommand({
      Entries: [{
        Source: 'huginbot.autoshutdown',
        DetailType: 'Server.AutoShutdown',
        Detail: JSON.stringify({
          instanceId: VALHEIM_INSTANCE_ID,
          reason: 'Player inactivity detected',
          alarmName: alarmName,
          uptimeMinutes: uptimeMinutes,
          idleTime: idleTime,
          timestamp: new Date().toISOString()
        })
      }]
    }));

    console.log(`Instance ${VALHEIM_INSTANCE_ID} shutdown initiated successfully`);
    
  } catch (error) {
    console.error('Error in auto-shutdown handler:', error);
    throw error; // Re-throw to trigger SNS retry if needed
  }
}