import { EventBridgeEvent, Context } from 'aws-lambda';
import {
  Route53Client,
  ChangeResourceRecordSetsCommand,
  ListHostedZonesByNameCommand,
  ChangeAction,
  RRType
} from '@aws-sdk/client-route-53';
import { EC2Client, DescribeInstancesCommand } from '@aws-sdk/client-ec2';

const route53Client = new Route53Client();
const ec2Client = new EC2Client();

/**
 * Lambda function to update Route 53 A record when EC2 instance state changes
 *
 * Triggered by EventBridge on EC2 state changes:
 * - When instance goes to 'running' → Update A record with public IP
 * - When instance goes to 'stopped' → Keep A record (harmless to point to stopped instance)
 *
 * Environment Variables:
 * - CUSTOM_DOMAIN: The domain name to update (e.g., valheim.gjurdsihop.net)
 */
export async function handler(
  event: EventBridgeEvent<'EC2 Instance State-change Notification', any>,
  _context: Context
): Promise<void> {
  console.log('Route53 update event received:', JSON.stringify(event, null, 2));

  const customDomain = process.env.CUSTOM_DOMAIN;
  if (!customDomain) {
    console.log('No CUSTOM_DOMAIN configured, skipping Route53 update');
    return;
  }

  const instanceId = event.detail['instance-id'];
  const state = event.detail.state;

  console.log(`Instance ${instanceId} is now ${state}`);

  // Only update DNS when instance is running
  if (state !== 'running') {
    console.log(`Instance state is ${state}, not updating Route53`);
    return;
  }

  try {
    // Get the public IP of the instance
    const publicIp = await getInstancePublicIp(instanceId);
    if (!publicIp) {
      console.error('Could not get public IP for instance');
      return;
    }

    console.log(`Instance public IP: ${publicIp}`);

    // Update Route53 A record
    await updateRoute53Record(customDomain, publicIp);

    console.log(`Successfully updated ${customDomain} to point to ${publicIp}`);
  } catch (error) {
    console.error('Error updating Route53:', error);
    throw error;
  }
}

/**
 * Get the public IP address of an EC2 instance
 */
async function getInstancePublicIp(instanceId: string): Promise<string | null> {
  try {
    const response = await ec2Client.send(new DescribeInstancesCommand({
      InstanceIds: [instanceId]
    }));

    const instance = response.Reservations?.[0]?.Instances?.[0];
    return instance?.PublicIpAddress || null;
  } catch (error) {
    console.error('Error getting instance public IP:', error);
    return null;
  }
}

/**
 * Update Route53 A record to point to the given IP address
 */
async function updateRoute53Record(domain: string, ipAddress: string): Promise<void> {
  try {
    // Get the hosted zone ID for the domain
    const hostedZoneId = await getHostedZoneId(domain);
    if (!hostedZoneId) {
      throw new Error(`Could not find hosted zone for domain: ${domain}`);
    }

    console.log(`Updating hosted zone ${hostedZoneId}`);

    // Update the A record
    const changeParams = {
      HostedZoneId: hostedZoneId,
      ChangeBatch: {
        Comment: `Updated by HuginBot - ${new Date().toISOString()}`,
        Changes: [
          {
            Action: ChangeAction.UPSERT,
            ResourceRecordSet: {
              Name: domain,
              Type: RRType.A,
              TTL: 60, // Short TTL so changes propagate quickly
              ResourceRecords: [
                {
                  Value: ipAddress
                }
              ]
            }
          }
        ]
      }
    };

    await route53Client.send(new ChangeResourceRecordSetsCommand(changeParams));
    console.log(`Route53 A record updated successfully for ${domain}`);
  } catch (error) {
    console.error('Error updating Route53 record:', error);
    throw error;
  }
}

/**
 * Get the hosted zone ID for a domain
 * Handles both root domains and subdomains
 */
async function getHostedZoneId(domain: string): Promise<string | null> {
  try {
    // Extract the root domain (e.g., gjurdsihop.net from valheim.gjurdsihop.net)
    const parts = domain.split('.');
    const rootDomain = parts.slice(-2).join('.'); // Get last two parts (domain.tld)

    console.log(`Looking for hosted zone for root domain: ${rootDomain}`);

    // List hosted zones by name (more efficient than listing all)
    const response = await route53Client.send(new ListHostedZonesByNameCommand({
      DNSName: rootDomain,
      MaxItems: 1
    }));

    // Find matching hosted zone
    const hostedZone = response.HostedZones?.find((zone: any) => {
      const zoneName = zone.Name?.replace(/\.$/, ''); // Remove trailing dot
      return zoneName === rootDomain;
    });

    if (!hostedZone?.Id) {
      console.error(`No hosted zone found for ${rootDomain}`);
      return null;
    }

    // Route53 returns IDs like "/hostedzone/Z1234567890ABC", we just need the ID
    const zoneId = hostedZone.Id.split('/').pop() || null;
    console.log(`Found hosted zone ID: ${zoneId} for ${rootDomain}`);

    return zoneId;
  } catch (error) {
    console.error('Error getting hosted zone ID:', error);
    return null;
  }
}
