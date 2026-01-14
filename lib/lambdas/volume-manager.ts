/**
 * Volume Manager Lambda
 *
 * Custom Resource handler that ensures an EBS volume is detached from any
 * existing instances before a new instance is created. This allows for
 * graceful EC2 instance replacement without volume attachment conflicts.
 */

import { EC2Client, DescribeVolumesCommand, DetachVolumeCommand, DescribeInstancesCommand, StopInstancesCommand, waitUntilVolumeAvailable, waitUntilInstanceStopped } from '@aws-sdk/client-ec2';

const ec2 = new EC2Client({});

interface CloudFormationEvent {
    RequestType: 'Create' | 'Update' | 'Delete';
    ResponseURL: string;
    StackId: string;
    RequestId: string;
    ResourceType: string;
    LogicalResourceId: string;
    PhysicalResourceId?: string;
    ResourceProperties: {
        VolumeId: string;
        CurrentInstanceId?: string;
    };
}

interface CloudFormationResponse {
    Status: 'SUCCESS' | 'FAILED';
    Reason?: string;
    PhysicalResourceId: string;
    StackId: string;
    RequestId: string;
    LogicalResourceId: string;
    Data?: Record<string, string>;
}

async function sendResponse(event: CloudFormationEvent, response: CloudFormationResponse): Promise<void> {
    const responseBody = JSON.stringify(response);
    console.log('Response:', responseBody);

    const https = await import('https');
    const url = new URL(event.ResponseURL);

    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: url.hostname,
            port: 443,
            path: url.pathname + url.search,
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': responseBody.length,
            },
        }, (res) => {
            console.log('CloudFormation response status:', res.statusCode);
            resolve();
        });

        req.on('error', (err) => {
            console.error('Error sending response:', err);
            reject(err);
        });

        req.write(responseBody);
        req.end();
    });
}

async function getVolumeAttachment(volumeId: string): Promise<{ instanceId: string; state: string } | null> {
    try {
        const result = await ec2.send(new DescribeVolumesCommand({
            VolumeIds: [volumeId],
        }));

        const volume = result.Volumes?.[0];
        if (volume?.Attachments && volume.Attachments.length > 0) {
            const attachment = volume.Attachments[0];
            return {
                instanceId: attachment.InstanceId || '',
                state: attachment.State || '',
            };
        }
        return null;
    } catch (error) {
        console.error('Error describing volume:', error);
        return null;
    }
}

async function getInstanceState(instanceId: string): Promise<string> {
    try {
        const result = await ec2.send(new DescribeInstancesCommand({
            InstanceIds: [instanceId],
        }));

        const instance = result.Reservations?.[0]?.Instances?.[0];
        return instance?.State?.Name || 'unknown';
    } catch (error) {
        console.error('Error describing instance:', error);
        return 'unknown';
    }
}

async function stopInstance(instanceId: string): Promise<void> {
    console.log(`Stopping instance ${instanceId}...`);

    await ec2.send(new StopInstancesCommand({
        InstanceIds: [instanceId],
    }));

    // Wait for instance to stop (max 5 minutes)
    await waitUntilInstanceStopped(
        { client: ec2, maxWaitTime: 300 },
        { InstanceIds: [instanceId] }
    );

    console.log(`Instance ${instanceId} stopped`);
}

async function detachVolume(volumeId: string, instanceId: string): Promise<void> {
    console.log(`Detaching volume ${volumeId} from instance ${instanceId}...`);

    await ec2.send(new DetachVolumeCommand({
        VolumeId: volumeId,
        InstanceId: instanceId,
        Force: false,
    }));

    // Wait for volume to become available (max 5 minutes)
    await waitUntilVolumeAvailable(
        { client: ec2, maxWaitTime: 300 },
        { VolumeIds: [volumeId] }
    );

    console.log(`Volume ${volumeId} detached and available`);
}

export async function handler(event: CloudFormationEvent): Promise<void> {
    console.log('Event:', JSON.stringify(event, null, 2));

    const volumeId = event.ResourceProperties.VolumeId;
    const currentInstanceId = event.ResourceProperties.CurrentInstanceId;
    const physicalResourceId = event.PhysicalResourceId || `volume-manager-${volumeId}`;

    try {
        if (event.RequestType === 'Delete') {
            // Nothing to do on delete - the volume persists
            await sendResponse(event, {
                Status: 'SUCCESS',
                PhysicalResourceId: physicalResourceId,
                StackId: event.StackId,
                RequestId: event.RequestId,
                LogicalResourceId: event.LogicalResourceId,
            });
            return;
        }

        // For Create/Update, check if volume is attached to a different instance
        const attachment = await getVolumeAttachment(volumeId);

        if (attachment && attachment.instanceId && attachment.instanceId !== currentInstanceId) {
            console.log(`Volume ${volumeId} is attached to ${attachment.instanceId} (state: ${attachment.state})`);

            // Check if the attached instance is running
            const instanceState = await getInstanceState(attachment.instanceId);
            console.log(`Instance ${attachment.instanceId} state: ${instanceState}`);

            if (instanceState === 'running') {
                // Stop the instance first for safe detachment
                await stopInstance(attachment.instanceId);
            }

            // Detach the volume if it's in 'attached' state
            if (attachment.state === 'attached') {
                await detachVolume(volumeId, attachment.instanceId);
            }
        } else if (attachment) {
            console.log(`Volume ${volumeId} is already attached to current instance or in state: ${attachment.state}`);
        } else {
            console.log(`Volume ${volumeId} is not attached to any instance`);
        }

        await sendResponse(event, {
            Status: 'SUCCESS',
            PhysicalResourceId: physicalResourceId,
            StackId: event.StackId,
            RequestId: event.RequestId,
            LogicalResourceId: event.LogicalResourceId,
            Data: {
                VolumeId: volumeId,
                PreviousInstanceId: attachment?.instanceId || 'none',
            },
        });
    } catch (error) {
        console.error('Error:', error);
        await sendResponse(event, {
            Status: 'FAILED',
            Reason: error instanceof Error ? error.message : 'Unknown error',
            PhysicalResourceId: physicalResourceId,
            StackId: event.StackId,
            RequestId: event.RequestId,
            LogicalResourceId: event.LogicalResourceId,
        });
    }
}
