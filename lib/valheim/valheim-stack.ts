import { Annotations, CfnOutput, Duration, Stack, StackProps } from "aws-cdk-lib";
import {
    BlockDeviceVolume,
    EbsDeviceVolumeType,
    Instance,
    InstanceClass,
    InstanceSize,
    InstanceType,
    MachineImage,
    Peer,
    Port,
    SecurityGroup,
    SubnetType,
    UserData,
    Vpc
} from "aws-cdk-lib/aws-ec2";
import {
    Effect,
    ManagedPolicy,
    PolicyStatement,
    Role,
    ServicePrincipal
} from "aws-cdk-lib/aws-iam";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Alarm, ComparisonOperator, Metric, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import * as path from "path";
import { loadScript } from './script-loader';

interface WorldConfig {
    /**
     * Display name of the world
     */
    name: string;

    /**
     * Discord server ID this world belongs to
     */
    discordServerId: string;

    /**
     * World name in Valheim
     */
    worldName: string;

    /**
     * Server password for this world
     */
    serverPassword: string;
    
    /**
     * Discord webhook URL for notifications
     * This can be fetched from SSM parameter store
     */
    discordWebhook?: string;
}

interface ValheimServerAwsCdkStackProps extends StackProps {
    /**
     * Optional parameter if you want to have the server start with an existing world file.
     */
    worldBootstrapLocation?: string;
    /**
     * The S3 bucket the world file exists in.
     * REQUIRED if worldBootstrapLocation is set.
     */
    worldResourcesBucket?: Bucket;
    /**
     * Password for the Valheim server
     * Default: "valheim" (should be changed)
     */
    serverPassword?: string;
    /**
     * Name for the Valheim server
     * Default: "ValheimServer"
     */
    serverName?: string;
    /**
     * Valheim world name
     * Default: "ValheimWorld"
     */
    worldName?: string;
    /**
     * Admin Steam IDs (space separated)
     */
    adminIds?: string;
    /**
     * Instance type to use
     * Default: t3.medium
     */
    instanceType?: InstanceType;
    /**
     * Size of data volume in GB
     * Default: 20
     */
    dataVolumeSize?: number;
    /**
     * How often to run backups (in hours)
     * Default: 24 (once per day)
     */
    backupFrequencyHours?: number;
    /**
     * How many backups to keep
     * Default: 7
     */
    backupsToKeep?: number;
    /**
     * Configuration for multiple worlds
     * Each world gets its own backup folder in S3
     */
    worldConfigurations?: WorldConfig[];
    /**
     * Path to BepInEx mods directory
     * Mods will be copied to the server's BepInEx plugins directory
     * Default: "./mods"
     */
    modsDirectory?: string;
    /**
     * Whether to enable BepInEx for mod support
     * Default: true
     */
    enableBepInEx?: boolean;
}

export class ValheimServerAwsCdkStack extends Stack {
    public readonly ec2Instance: Instance;
    public readonly vpc: Vpc;
    public readonly backupBucket: Bucket;
    public readonly backupSchedule?: string;
    public readonly idleAlarm: Alarm;

    constructor(scope: Construct, id: string, props?: ValheimServerAwsCdkStackProps) {
        super(scope, id, props);

        if (props?.worldBootstrapLocation && !props.worldResourcesBucket) {
            Annotations.of(this).addError("worldResourcesBucket must be set if worldBootstrapLocation is set!");
        }

        // Set defaults
        const serverPassword = props?.serverPassword || "valheim";
        const serverName = props?.serverName || "ValheimServer";
        const worldName = props?.worldName || "ValheimWorld";
        const instanceType = props?.instanceType || InstanceType.of(InstanceClass.T3, InstanceSize.MEDIUM);
        const dataVolumeSize = props?.dataVolumeSize || 20;
        const backupFrequencyHours = props?.backupFrequencyHours || 24;
        const backupsToKeep = props?.backupsToKeep || 7;
        const modsDirectory = props?.modsDirectory || "./mods";
        const enableBepInEx = props?.enableBepInEx !== undefined ? props?.enableBepInEx : true;
        const idleThresholdMinutes = 10; // Server shuts down after 10 minutes of inactivity

        // Create VPC with a single public subnet
        this.vpc = new Vpc(this, "valheimVpc", {
            cidr: "10.0.0.0/24",
            subnetConfiguration: [
                {
                    cidrMask: 24,
                    name: "valheimPublicSubnet",
                    subnetType: SubnetType.PUBLIC,
                },
            ],
            maxAzs: 1,
            enableDnsSupport: true,
            enableDnsHostnames: true,
        });

        // Security group for the EC2 instance
        const securityGroup = new SecurityGroup(this, "valheimSecurityGroup", {
            vpc: this.vpc,
            description: "Security group for Valheim server",
            allowAllOutbound: true,
        });

        // Allow Valheim required ports
        securityGroup.addIngressRule(Peer.anyIpv4(), Port.udpRange(2456, 2458), "Valheim game ports (UDP)");
        securityGroup.addIngressRule(Peer.anyIpv4(), Port.tcpRange(2456, 2458), "Valheim game ports (TCP)");
        securityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(80), "Valheim web admin (optional)");

        // Create S3 bucket for backups
        this.backupBucket = new Bucket(this, "valheimBackupBucket", {
            versioned: true,
            removalPolicy: this.removalPolicy,
        });

        // Create IAM role for EC2 instance
        const instanceRole = new Role(this, "valheimInstanceRole", {
            assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
            managedPolicies: [
                ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"), // For SSM access
            ],
        });

        // Add policy for S3 access (for backups)
        instanceRole.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ["s3:PutObject", "s3:GetObject", "s3:ListBucket"],
                resources: [
                    this.backupBucket.bucketArn,
                    `${this.backupBucket.bucketArn}/*`,
                ],
            })
        );

        // Add policy for EventBridge events
        instanceRole.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ["events:PutEvents"],
                resources: [
                    `arn:aws:events:${this.region}:${this.account}:event-bus/default`
                ],
            })
        );
        
        // Add policy for SSM Parameter Store access (for Discord webhooks)
        instanceRole.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ["ssm:GetParameter", "ssm:GetParameters"],
                resources: [
                    `arn:aws:ssm:${this.region}:${this.account}:parameter/huginbot/discord-webhook/*`
                ],
            })
        );

        // CloudWatch metrics don't support resource-level permissions for PutMetricData
        instanceRole.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ["cloudwatch:PutMetricData"],
                resources: ["*"],
                conditions: {
                    "StringEquals": {
                        "cloudwatch:namespace": "ValheimServer"
                    }
                }
            })
        );

        // Scope EC2 actions to this specific instance
        instanceRole.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: [
                    "ec2:StopInstances",
                    "ec2:DescribeInstances"
                ],
                resources: [
                    // This will be replaced with the actual instance ARN once created
                    `arn:aws:ec2:${this.region}:${this.account}:instance/*`
                ],
                conditions: {
                    // Add condition to restrict actions to only this instance using tags
                    "StringEquals": {
                        "ec2:ResourceTag/Name": "valheimInstance"
                    }
                }
            })
        );

        // If provided, add policy to read from world bootstrap bucket
        if (props?.worldResourcesBucket) {
            instanceRole.addToPolicy(
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ["s3:GetObject", "s3:ListBucket"],
                    resources: [
                        props.worldResourcesBucket.bucketArn,
                        `${props.worldResourcesBucket.bucketArn}/*`,
                    ],
                })
            );
        }

        // Create user data script for EC2 instance
        const userData = UserData.forLinux();

        // Install essential packages
        userData.addCommands(
            "yum update -y",
            "yum install -y docker git amazon-cloudwatch-agent jq",
            "systemctl enable docker",
            "systemctl start docker"
        );

        // Configure CloudWatch agent for logs - create a simplified config
        userData.addCommands(
            'echo \'{"agent":{"metrics_collection_interval":60,"run_as_user":"root"},"logs":{"logs_collected":{"files":{"collect_list":[{"file_path":"/var/lib/docker/containers/*/*.log","log_group_name":"/valheim/docker/containers","log_stream_name":"{instance_id}/{filename}","timezone":"UTC"}]}}},"metrics":{"metrics_collected":{"mem":{"measurement":["mem_used_percent"]},"disk":{"measurement":["disk_used_percent"],"resources":["/"]}},"append_dimensions":{"InstanceId":"${!aws:InstanceId}"}}}' + "'" + ' > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json',
            "amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json"
        );

        // Format and mount the data volume
        userData.addCommands(
            // Wait for the device to be available
            "echo 'Waiting for data volume to be available...'",
            "while [ ! -e /dev/nvme1n1 ]; do sleep 1; done",

            // Check if the volume is already formatted
            "if ! blkid /dev/nvme1n1; then",
            "  echo 'Formatting data volume...'",
            "  mkfs -t ext4 /dev/nvme1n1",
            "fi",

            // Create mount point and add to fstab
            "mkdir -p /mnt/valheim-data",
            "echo '/dev/nvme1n1 /mnt/valheim-data ext4 defaults 0 2' >> /etc/fstab",
            "mount -a",

            // Create directories
            "mkdir -p /mnt/valheim-data/config",
            "mkdir -p /mnt/valheim-data/backups",
            "mkdir -p /mnt/valheim-data/mods",
            "chmod -R 755 /mnt/valheim-data"
        );

        // Copy bootstrap world data if provided
        if (props?.worldResourcesBucket && props.worldBootstrapLocation) {
            userData.addCommands(
                `aws s3 cp --recursive s3://${props.worldResourcesBucket.bucketName}/${props.worldBootstrapLocation} /mnt/valheim-data/config/`
            );
        }

        // Setup mods directory - this will copy local mods to the EC2 instance
        userData.addCommands(
            // Create directory for local mod files
            `cat > /usr/local/bin/setup-valheim-mods.sh << 'EOF'
#!/bin/bash
# This script copies mod files from the S3 bucket to the local mods directory

# Create BepInEx plugins directory structure
mkdir -p /mnt/valheim-data/config/plugins
mkdir -p /mnt/valheim-data/config/patchers

# Check if there are mods in S3
if aws s3 ls s3://${this.backupBucket.bucketName}/mods/ 2>/dev/null; then
  echo "Copying mods from S3 bucket..."
  aws s3 cp --recursive s3://${this.backupBucket.bucketName}/mods/ /mnt/valheim-data/mods/
  cp -r /mnt/valheim-data/mods/* /mnt/valheim-data/config/plugins/
  echo "Mods installed successfully"
else
  echo "No mods found in S3 bucket"
fi
EOF`,
            "chmod +x /usr/local/bin/setup-valheim-mods.sh",
            "/usr/local/bin/setup-valheim-mods.sh"
        );

        // Create backup script with Discord webhook notification
        userData.addCommands(
            `cat > /usr/local/bin/backup-valheim.sh << 'EOF'
#!/bin/bash
# Get active world from SSM Parameter Store if it exists
ACTIVE_WORLD=""
WORLD_NAME=""
if aws ssm get-parameter --name "/huginbot/active-world" --region $(curl -s http://169.254.169.254/latest/meta-data/placement/region) 2>/dev/null; then
  PARAM_VALUE=$(aws ssm get-parameter --name "/huginbot/active-world" --region $(curl -s http://169.254.169.254/latest/meta-data/placement/region) --query "Parameter.Value" --output text)
  ACTIVE_WORLD=$(echo $PARAM_VALUE | jq -r '.name')
  WORLD_NAME=$(echo $PARAM_VALUE | jq -r '.worldName')
fi

# Create the backup folder path
BACKUP_PATH=""
if [ -n "$ACTIVE_WORLD" ]; then
  BACKUP_PATH="worlds/$ACTIVE_WORLD"
  echo "Backing up world: $ACTIVE_WORLD ($WORLD_NAME)"
else
  BACKUP_PATH="worlds/default"
  echo "Backing up default world"
fi

# Get the Discord webhook URL from environment variable
DISCORD_WEBHOOK=$(env | grep DISCORD_WEBHOOK | cut -d= -f2- | tr -d '"')

# Send backup started notification if webhook exists
if [ -n "$DISCORD_WEBHOOK" ]; then
  curl -sfSL -X POST -H "Content-Type: application/json" -d "{\"username\":\"HuginBot\",\"content\":\"Starting backup of world: $WORLD_NAME\"}" "$DISCORD_WEBHOOK"
fi

# Create the backup
timestamp=$(date +%Y%m%d_%H%M%S)
tar -czf /tmp/valheim_backup_$timestamp.tar.gz -C /mnt/valheim-data .
aws s3 cp /tmp/valheim_backup_$timestamp.tar.gz s3://${this.backupBucket.bucketName}/$BACKUP_PATH/valheim_backup_$timestamp.tar.gz
backup_status=$?

# Send backup completion notification
if [ -n "$DISCORD_WEBHOOK" ]; then
  if [ $backup_status -eq 0 ]; then
    curl -sfSL -X POST -H "Content-Type: application/json" -d "{\"username\":\"HuginBot\",\"content\":\"✅ Backup completed successfully for world: $WORLD_NAME\"}" "$DISCORD_WEBHOOK"
  else
    curl -sfSL -X POST -H "Content-Type: application/json" -d "{\"username\":\"HuginBot\",\"content\":\"❌ Backup failed for world: $WORLD_NAME\"}" "$DISCORD_WEBHOOK"
  fi
fi

rm /tmp/valheim_backup_$timestamp.tar.gz
EOF`,
            "chmod +x /usr/local/bin/backup-valheim.sh",

            // Create world switching script
            `cat > /usr/local/bin/switch-valheim-world.sh << 'EOF'
${loadScript('valheim/switch-valheim-world.sh')}
EOF`,
            "chmod +x /usr/local/bin/switch-valheim-world.sh",

            // Install jq for JSON parsing
            "yum install -y jq",

            // Set up cron jobs for backups and world checking
            `(crontab -l 2>/dev/null; echo "0 */${backupFrequencyHours} * * * /usr/local/bin/backup-valheim.sh") | crontab -`,
            `(crontab -l 2>/dev/null; echo "*/5 * * * * /usr/local/bin/switch-valheim-world.sh") | crontab -`
        );

        // Create environment variables for the Valheim docker container
        const dockerEnvVars = [
            `SERVER_NAME="${serverName}"`,
            `WORLD_NAME="${worldName}"`,
            `SERVER_PASS="${serverPassword}"`,
            `TZ="America/Los_Angeles"`,
            `BACKUPS_DIRECTORY="/config/backups"`,
            `BACKUPS_INTERVAL="3600"`,
            `BACKUPS_MAX_AGE="3"`,
            `BACKUPS_DIRECTORY_PERMISSIONS="755"`,
            `BACKUPS_FILE_PERMISSIONS="644"`,
            `CONFIG_DIRECTORY_PERMISSIONS="755"`,
            `WORLDS_DIRECTORY_PERMISSIONS="755"`,
            `WORLDS_FILE_PERMISSIONS="644"`,
            `SERVER_PUBLIC="true"`,
            `UPDATE_INTERVAL="900"`,
            `STEAMCMD_ARGS="validate"`,
            `BEPINEX="${enableBepInEx ? "true" : "false"}"`,
        ];
        
        // Add Discord webhook and lifecycle hooks
        if (props?.worldConfigurations) {
            // Use the first world config's Discord server ID for getting the webhook
            const discordServerId = props.worldConfigurations[0].discordServerId;
            
            // Add webhook environment variables with error handling
            dockerEnvVars.push('DISCORD_WEBHOOK="$(aws ssm get-parameter --name /huginbot/discord-webhook/' + discordServerId + ' --with-decryption --query Parameter.Value --output text 2>/dev/null || echo "")"');
            
            // Add error detection for missing webhook
            dockerEnvVars.push('[ -z "$DISCORD_WEBHOOK" ] && echo "WARNING: Discord webhook URL not found for server ' + discordServerId + '. Notifications will not be sent." || echo "Discord webhook configured successfully for ' + discordServerId + '"');
            
            // Add server lifecycle hooks
            dockerEnvVars.push('PRE_BOOTSTRAP_HOOK="curl -sfSL -X POST -H \\"Content-Type: application/json\\" -d \'{\\"username\\":\\"HuginBot\\",\\"content\\":\\"Server is starting...\\"}\' \\"$DISCORD_WEBHOOK\\""');
            dockerEnvVars.push('POST_SERVER_LISTENING_HOOK="curl -sfSL -X POST -H \\"Content-Type: application/json\\" -d \'{\\"username\\":\\"HuginBot\\",\\"content\\":\\"Server is online and ready to play!\\"}\' \\"$DISCORD_WEBHOOK\\""');
            dockerEnvVars.push('PRE_SERVER_SHUTDOWN_HOOK="curl -sfSL -X POST -H \\"Content-Type: application/json\\" -d \'{\\"username\\":\\"HuginBot\\",\\"content\\":\\"Server is shutting down. Save your game!\\"}\' \\"$DISCORD_WEBHOOK\\""');
            
            // Add log filtering for join code only - we don't need to notify for player joins/leaves
            dockerEnvVars.push('VALHEIM_LOG_FILTER_CONTAINS_JoinCode="Session .* with join code [0-9]+ and IP"');
            dockerEnvVars.push('ON_VALHEIM_LOG_FILTER_CONTAINS_JoinCode="{ read l; server_name=\\$(echo \\"$l\\" | grep -o \\"Session \\\\\\"\\".*\\\\\\"\\" | cut -d\\\\\\"\\" -f2); join_code=\\$(echo \\"$l\\" | grep -o \\"join code [0-9]*\\" | cut -d\\\" \\\" -f3); msg=\\"🎮 Server \\\\\\"$server_name\\\\\\" is ready! Join code: $join_code\\"; curl -sfSL -X POST -H \\"Content-Type: application/json\\" -d \\"{\\\\\\"username\\\\\\":\\\\\\"HuginBot\\\\\\",\\\\\\"content\\\\\\":\\\\\\"$msg\\\\\\"}\\" \\"$DISCORD_WEBHOOK\\"; }"');
        }

        // Add admin IDs if provided
        if (props?.adminIds) {
            dockerEnvVars.push(`ADMINLIST_IDS="${props.adminIds}"`);
        }

        // Create server specific arguments
        const serverArgs = ["-crossplay"];

        // If BepInEx is enabled, we need to mount the mods directory
        if (enableBepInEx) {
            serverArgs.push("-bepinex");
        }

        dockerEnvVars.push(`SERVER_ARGS="${serverArgs.join(' ')}"`);

        // Create PlayFab join code monitoring script
        userData.addCommands(
            `cat > /usr/local/bin/monitor-playfab.sh << 'EOF'
${loadScript('valheim/monitor-playfab.sh')}
EOF`,
            "chmod +x /usr/local/bin/monitor-playfab.sh",

            // Setup a systemd service for the monitoring script
            `cat > /etc/systemd/system/playfab-monitor.service << 'EOF'
[Unit]
Description=PlayFab Join Code Monitor
After=docker.service

[Service]
Type=simple
ExecStart=/usr/local/bin/monitor-playfab.sh
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF`,

            // Create player count monitoring script
            `cat > /usr/local/bin/monitor-players.sh << 'EOF'
${loadScript('valheim/monitor-players.sh')}
EOF`,
            "chmod +x /usr/local/bin/monitor-players.sh",

            // Setup systemd service for the player monitoring
            `cat > /etc/systemd/system/player-monitor.service << 'EOF'
[Unit]
Description=Valheim Player Count Monitor
After=docker.service

[Service]
Type=simple
ExecStart=/usr/local/bin/monitor-players.sh
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF`,

            "systemctl daemon-reload",
            "systemctl enable playfab-monitor.service",
            "systemctl enable player-monitor.service"
        );

        // Start Valheim server using Docker
        userData.addCommands(
            `docker run -d --name valheim-server \\
        -p 2456-2458:2456-2458/udp \\
        -p 2456-2458:2456-2458/tcp \\
        -p 80:80 \\
        -v /mnt/valheim-data/config:/config \\
        -v /mnt/valheim-data/backups:/config/backups \\
        -v /mnt/valheim-data/mods:/bepinex/plugins \\
        ${dockerEnvVars.map(env => `-e ${env}`).join(" \\\n        ")} \\
        --restart unless-stopped \\
        lloesche/valheim-server`,

            // Start the PlayFab monitoring service
            "systemctl start playfab-monitor.service"
        );

        // Create EC2 instance with two volumes:
        // 1. Root volume for OS (30GB)
        // 2. Additional volume for game data
        this.ec2Instance = new Instance(this, "valheimInstance", {
            vpc: this.vpc,
            instanceType: instanceType,
            machineImage: MachineImage.latestAmazonLinux2(),
            securityGroup: securityGroup,
            userData: userData,
            role: instanceRole,
            blockDevices: [
                {
                    deviceName: "/dev/xvda",
                    volume: BlockDeviceVolume.ebs(30, {
                        volumeType: EbsDeviceVolumeType.GP3,
                        encrypted: true,
                    }),
                },
                {
                    deviceName: "/dev/xvdf",
                    volume: BlockDeviceVolume.ebs(dataVolumeSize, {
                        volumeType: EbsDeviceVolumeType.GP3,
                        encrypted: true,
                        deleteOnTermination: false, // Preserve game data if instance is terminated
                    }),
                },
            ],
        });

        // Create Lambda for automated backup cleanup
        const backupCleanupFunction = new NodejsFunction(this, 'BackupCleanupFunction', {
            runtime: Runtime.NODEJS_18_X,
            handler: 'handler',
            entry: path.join(__dirname, '../../lib/lambdas/cleanup-backups.ts'),
            environment: {
                BACKUP_BUCKET_NAME: this.backupBucket.bucketName,
                BACKUPS_TO_KEEP: backupsToKeep.toString(),
            },
            timeout: Duration.minutes(5),
        });

        // Grant the Lambda permission to access the S3 bucket
        this.backupBucket.grantReadWrite(backupCleanupFunction);

        // Create CloudWatch Event Rule to trigger the backup cleanup Lambda
        const rule = new Rule(this, 'BackupCleanupRule', {
            schedule: Schedule.rate(Duration.hours(backupFrequencyHours)),
        });

        // Add the Lambda as a target for the CloudWatch Event
        rule.addTarget(new LambdaFunction(backupCleanupFunction));

        // Create CloudWatch Alarm for player inactivity
        const playerCountMetric = new Metric({
            namespace: 'ValheimServer',
            metricName: 'PlayerCount',
            statistic: 'Maximum',
            period: Duration.minutes(5),
            dimensionsMap: {
                InstanceId: this.ec2Instance.instanceId,
            },
        });

        // Create an alarm that will trigger if player count is 0 for the specified duration
        this.idleAlarm = new Alarm(this, 'PlayerInactivityAlarm', {
            metric: playerCountMetric,
            threshold: 0,
            comparisonOperator: ComparisonOperator.LESS_THAN_OR_EQUAL_TO_THRESHOLD,
            evaluationPeriods: Math.ceil(idleThresholdMinutes / 5), // Convert minutes to 5-minute periods
            datapointsToAlarm: Math.ceil(idleThresholdMinutes / 5), // Require all datapoints to be below threshold
            treatMissingData: TreatMissingData.BREACHING, // Treat missing data as if no players are online
            alarmDescription: `Auto-shutdown Valheim server after ${idleThresholdMinutes} minutes of inactivity`,
        });

        // Outputs
        new CfnOutput(this, "InstanceId", {
            value: this.ec2Instance.instanceId,
            description: "ID of the Valheim server EC2 instance",
            exportName: "ValheimServerInstanceId",
        });

        new CfnOutput(this, "InstancePublicIP", {
            value: this.ec2Instance.instancePublicIp,
            description: "Public IP of the Valheim server",
            exportName: "ValheimServerPublicIP",
        });

        new CfnOutput(this, "ValheimConnectAddress", {
            value: `${this.ec2Instance.instancePublicIp}:2456`,
            description: "Address to connect to the Valheim server",
            exportName: "ValheimConnectAddress",
        });

        new CfnOutput(this, "BackupBucketName", {
            value: this.backupBucket.bucketName,
            description: "S3 bucket for Valheim server backups",
            exportName: "ValheimBackupBucket",
        });
    }

    private get removalPolicy() {
        return this.node.tryGetContext("production") === true
            ? undefined // Retain in production
            : this.node.tryGetContext("keep_resources") === true
                ? undefined // Retain if explicitly requested
                : undefined; // Default behavior (DESTROY would be safer for testing)
    }
    
    /**
     * Create an SSM Parameter for storing Discord webhook URL
     * This parameter can be referenced by both the EC2 instance and Lambda functions
     * 
     * @param discordServerId The Discord server/guild ID associated with this webhook
     * @param webhookUrl The Discord webhook URL
     * @returns The created SSM Parameter
     */
    private createDiscordWebhookParameter(discordServerId: string, webhookUrl: string): StringParameter {
        return new StringParameter(this, `DiscordWebhookParam-${discordServerId}`, {
            parameterName: `/huginbot/discord-webhook/${discordServerId}`,
            stringValue: webhookUrl,
            description: "Discord webhook URL for HuginBot notifications",
            type: StringParameter.Type.SECURE_STRING // Store as a secure string since it contains sensitive URL
        });
    }
}
