import * as cdk from "aws-cdk-lib";
import { Annotations, CfnOutput, Duration, Stack, StackProps, Tags } from "aws-cdk-lib";
import {
    BlockDeviceVolume,
    CfnVolume,
    CfnVolumeAttachment,
    EbsDeviceVolumeType,
    Instance,
    InstanceClass,
    InstanceSize,
    InstanceType,
    IpAddresses,
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
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import * as path from "path";
import { loadScript } from './script-loader';
import * as dotenv from 'dotenv';
import {
    RestApi,
    LambdaIntegration,
    EndpointType
} from "aws-cdk-lib/aws-apigateway";
import {
    RetentionDays,
    LogGroup
} from "aws-cdk-lib/aws-logs";

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
     * Default: 12
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
    public readonly apiUrl: string;

    constructor(scope: Construct, id: string, props?: ValheimServerAwsCdkStackProps) {
        super(scope, id, props);
        
        // Load environment variables from .env file
        dotenv.config();

        if (props?.worldBootstrapLocation && !props.worldResourcesBucket) {
            Annotations.of(this).addError("worldResourcesBucket must be set if worldBootstrapLocation is set!");
        }

        // Set defaults
        const serverPassword = props?.serverPassword || "valheim";
        const serverName = props?.serverName || "ValheimServer";
        const worldName = props?.worldName || "ValheimWorld";
        const instanceType = props?.instanceType || InstanceType.of(InstanceClass.T3, InstanceSize.MEDIUM);
        const dataVolumeSize = props?.dataVolumeSize || 12;
        const backupFrequencyHours = props?.backupFrequencyHours || 24;
        const backupsToKeep = props?.backupsToKeep || 7;
        const modsDirectory = props?.modsDirectory || "./mods";
        const enableBepInEx = props?.enableBepInEx !== undefined ? props?.enableBepInEx : true;
        // Note: Auto-shutdown is controlled by SSM parameter /huginbot/auto-shutdown-minutes (default: 20 minutes)

        // Create VPC with a single public subnet
        this.vpc = new Vpc(this, "valheimVpc", {
            ipAddresses: IpAddresses.cidr("10.0.0.0/24"),
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

        // Deploy scripts to S3 bucket for EC2 instance to download
        new BucketDeployment(this, "ScriptDeployment", {
            sources: [Source.asset("./scripts")],
            destinationBucket: this.backupBucket,
            destinationKeyPrefix: "scripts/",
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
        
        // Add policy for SSM Parameter Store access (for Discord webhooks and monitoring)
        instanceRole.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: [
                    "ssm:GetParameter", 
                    "ssm:GetParameters",
                    "ssm:PutParameter"  // For monitoring scripts to store join codes
                ],
                resources: [
                    `arn:aws:ssm:${this.region}:${this.account}:parameter/huginbot/*`
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
        // Note: The instance ID will be injected after creation
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
                        "ec2:ResourceTag/Name": "ValheimStack/ValheimServerInstanceV2"
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

        // Setup mods directory - BepInEx plugins go in /config/bepinex/plugins/
        // The container copies them to /opt/valheim/bepinex/BepInEx/plugins/ on install/update
        userData.addCommands(
            // Create directory for mod staging and BepInEx plugins
            `cat > /usr/local/bin/setup-valheim-mods.sh << 'EOF'
#!/bin/bash
# This script sets up the BepInEx plugins directory structure
# Note: BepInEx creates /config/bepinex/ on first container start
# We pre-create the plugins directory so mods can be placed there

# Create BepInEx directory structure (container will use this)
mkdir -p /mnt/valheim-data/config/bepinex/plugins
mkdir -p /mnt/valheim-data/config/bepinex/patchers

# Mods staging directory (for S3 downloads before copying to bepinex)
mkdir -p /mnt/valheim-data/mods

echo "BepInEx plugins directory structure created"
echo "Mods will be downloaded per-world by switch-valheim-world.sh"
EOF`,
            "chmod +x /usr/local/bin/setup-valheim-mods.sh",
            "/usr/local/bin/setup-valheim-mods.sh"
        );

        // Install jq for JSON parsing (required by scripts)
        userData.addCommands(
            "yum install -y jq"
        );

        // Create environment variables for the Valheim docker container
        const dockerEnvVars = [
            `SERVER_NAME="${serverName}"`,
            `WORLD_NAME="${worldName}"`,
            `SERVER_PASS="${serverPassword}"`,
            `TZ="America/Los_Angeles"`,
            // Disable Docker container's built-in backups - we use our own S3 backup system
            `BACKUPS="false"`,
            `CONFIG_DIRECTORY_PERMISSIONS="755"`,
            `WORLDS_DIRECTORY_PERMISSIONS="755"`,
            `WORLDS_FILE_PERMISSIONS="644"`,
            `SERVER_PUBLIC="true"`,
            `UPDATE_INTERVAL="900"`,
            `STEAMCMD_ARGS="validate"`,
            `BEPINEX="${enableBepInEx ? "true" : "false"}"`,
        ];

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

        // Create a service that updates scripts from S3 on every boot
        userData.addCommands(
            `cat > /etc/systemd/system/update-valheim-scripts.service << 'EOF'
[Unit]
Description=Update Valheim monitoring scripts from S3
After=network-online.target
Wants=network-online.target
Before=playfab-monitor.service player-monitor.service

[Service]
Type=oneshot
# Wait for IAM credentials to be available from instance metadata service
ExecStartPre=/bin/bash -c 'echo "Waiting for IAM credentials..."; until curl -sf --connect-timeout 2 http://169.254.169.254/latest/meta-data/iam/security-credentials/ > /dev/null 2>&1; do echo "IAM credentials not ready, retrying..."; sleep 2; done; echo "IAM credentials available"'
ExecStart=/bin/bash -c 'aws s3 cp s3://${this.backupBucket.bucketName}/scripts/valheim/monitor-playfab.sh /usr/local/bin/monitor-playfab.sh && chmod +x /usr/local/bin/monitor-playfab.sh && aws s3 cp s3://${this.backupBucket.bucketName}/scripts/valheim/monitor-players.sh /usr/local/bin/monitor-players.sh && chmod +x /usr/local/bin/monitor-players.sh && aws s3 cp s3://${this.backupBucket.bucketName}/scripts/valheim/restore-world.sh /usr/local/bin/restore-world.sh && chmod +x /usr/local/bin/restore-world.sh && aws s3 cp s3://${this.backupBucket.bucketName}/scripts/valheim/backup-valheim.sh /usr/local/bin/backup-valheim.sh && chmod +x /usr/local/bin/backup-valheim.sh && aws s3 cp s3://${this.backupBucket.bucketName}/scripts/valheim/backup-and-stop.sh /usr/local/bin/backup-and-stop.sh && chmod +x /usr/local/bin/backup-and-stop.sh && aws s3 cp s3://${this.backupBucket.bucketName}/scripts/valheim/switch-valheim-world.sh /usr/local/bin/switch-valheim-world.sh && chmod +x /usr/local/bin/switch-valheim-world.sh'
RemainAfterExit=yes
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
EOF`,
            "systemctl enable update-valheim-scripts.service"
        );

        // Note: Scripts are downloaded by update-valheim-scripts.service on every boot
        // Setup systemd services for monitoring scripts
        userData.addCommands(
            `cat > /etc/systemd/system/playfab-monitor.service << 'EOF'
[Unit]
Description=PlayFab Join Code Monitor
After=docker.service update-valheim-scripts.service
Requires=update-valheim-scripts.service

[Service]
Type=simple
ExecStart=/usr/local/bin/monitor-playfab.sh
Restart=always
RestartSec=10
Environment=GUILD_ID=${props?.worldConfigurations?.[0]?.discordServerId || 'unknown'}

[Install]
WantedBy=multi-user.target
EOF`,

            `cat > /etc/systemd/system/player-monitor.service << 'EOF'
[Unit]
Description=Valheim Player Monitor
After=docker.service update-valheim-scripts.service
Requires=update-valheim-scripts.service

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

        // Create Valheim server startup script that reads config from SSM
        userData.addCommands(
            `cat > /usr/local/bin/start-valheim-server.sh << 'EOF'
#!/bin/bash
# Start Valheim server Docker container with configuration from SSM

REGION=$(curl -s http://169.254.169.254/latest/meta-data/placement/region)

# Get active world configuration from SSM
ACTIVE_WORLD_JSON=$(aws ssm get-parameter --name "/huginbot/active-world" --region "$REGION" --query 'Parameter.Value' --output text 2>/dev/null)

if [ -z "$ACTIVE_WORLD_JSON" ]; then
  echo "No active world configuration found, using defaults"
  WORLD_NAME="${worldName}"
  SERVER_NAME="${serverName}"
  SERVER_PASS="${serverPassword}"
else
  echo "Loading active world configuration from SSM"
  WORLD_NAME=$(echo "$ACTIVE_WORLD_JSON" | python3 -c "import sys, json; print(json.load(sys.stdin)['worldName'])")
  SERVER_NAME=$(echo "$ACTIVE_WORLD_JSON" | python3 -c "import sys, json; print(json.load(sys.stdin).get('serverName', 'Valheim Server'))")
  SERVER_PASS=$(echo "$ACTIVE_WORLD_JSON" | python3 -c "import sys, json; print(json.load(sys.stdin)['serverPassword'])")
fi

echo "Starting Valheim server with world: $WORLD_NAME"

# Stop and remove existing container if it exists
docker stop valheim-server 2>/dev/null || true
docker rm valheim-server 2>/dev/null || true

# Start new container
docker run -d --name valheim-server \\
  -p 2456-2458:2456-2458/udp \\
  -p 2456-2458:2456-2458/tcp \\
  -p 80:80 \\
  -v /mnt/valheim-data/config:/config \\
  -v /mnt/valheim-data/backups:/config/backups \\
  -v /mnt/valheim-data/server:/opt/valheim \\
  -e SERVER_NAME="$SERVER_NAME" \\
  -e WORLD_NAME="$WORLD_NAME" \\
  -e SERVER_PASS="$SERVER_PASS" \\
  -e TZ="America/Los_Angeles" \\
  -e BACKUPS="false" \\
  -e SERVER_PUBLIC="true" \\
  -e UPDATE_INTERVAL="900" \\
  -e STEAMCMD_ARGS="validate" \\
  -e SERVER_ARGS="-crossplay" \\
  --restart unless-stopped \\
  --stop-timeout 120 \\
  lloesche/valheim-server

echo "Valheim server container started successfully"
EOF`,
            "chmod +x /usr/local/bin/start-valheim-server.sh",

            // Create systemd service for Valheim server
            // Note: Type=oneshot cannot have Restart= - Docker's --restart handles container restarts
            `cat > /etc/systemd/system/valheim-server.service << 'EOF'
[Unit]
Description=Valheim Server Docker Container
After=docker.service update-valheim-scripts.service
Requires=docker.service
Before=playfab-monitor.service player-monitor.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/bin/start-valheim-server.sh
ExecStop=/usr/bin/docker stop valheim-server
ExecStopPost=/usr/bin/docker rm valheim-server

[Install]
WantedBy=multi-user.target
EOF`,
            "systemctl daemon-reload",
            "systemctl enable valheim-server.service",
            "systemctl start valheim-server.service",

            // Start/restart the monitoring services to ensure latest scripts are loaded
            "systemctl restart playfab-monitor.service",
            "systemctl restart player-monitor.service"
        );

        // Create standalone EBS volume for game data
        // This volume survives EC2 instance replacements during CDK deploys
        // RemovalPolicy.RETAIN ensures the volume isn't deleted even if stack is destroyed
        const dataVolume = new CfnVolume(this, "ValheimDataVolume", {
            availabilityZone: this.vpc.availabilityZones[0],
            size: dataVolumeSize,
            volumeType: "gp3",
            encrypted: true,
            tags: [
                { key: "Name", value: "ValheimGameData" },
                { key: "Purpose", value: "Valheim world data and backups" },
            ],
        });
        dataVolume.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

        // Create EC2 instance with only root volume
        // Data volume is attached separately to survive instance replacements
        this.ec2Instance = new Instance(this, "ValheimServerInstanceV2", {
            vpc: this.vpc,
            instanceType: instanceType,
            machineImage: MachineImage.latestAmazonLinux2(),
            securityGroup: securityGroup,
            userData: userData,
            role: instanceRole,
            blockDevices: [
                {
                    deviceName: "/dev/xvda",
                    volume: BlockDeviceVolume.ebs(10, {
                        volumeType: EbsDeviceVolumeType.GP3,
                        encrypted: true,
                    }),
                },
            ],
        });

        // Add deployment version tag to force replacement when needed
        Tags.of(this.ec2Instance).add('DeploymentVersion', '2025-12-13-v2');

        // Attach the data volume to the instance
        // This attachment is recreated when instance is replaced, but volume persists
        const volumeAttachment = new CfnVolumeAttachment(this, "ValheimDataVolumeAttachment", {
            device: "/dev/xvdf",
            instanceId: this.ec2Instance.instanceId,
            volumeId: dataVolume.ref,
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

        // ====== DISCORD INTEGRATION ======
        
        // Generate auth token for Discord integration
        const discordAuthToken = this.generateRandomToken();
        
        // Use a unique parameter name based on stack ID to avoid conflicts in tests
        const parameterSuffix = this.node.tryGetContext('testing') ? `-${this.node.id}` : '';

        const authTokenParam = new StringParameter(this, "DiscordAuthToken", {
            parameterName: `/huginbot/discord-auth-token${parameterSuffix}`,
            stringValue: discordAuthToken,
            description: "Authentication token for Discord integration",
        });

        // Store backup bucket name in SSM for EC2 scripts to access
        new StringParameter(this, "BackupBucketParam", {
            parameterName: "/huginbot/backup-bucket-name",
            stringValue: this.backupBucket.bucketName,
            description: "S3 bucket name for Valheim backups",
        });

        // Auto-shutdown configuration (minutes of idle time before server stops)
        // Set to "off" or "disabled" to disable auto-shutdown
        const autoShutdownMinutes = process.env.AUTO_SHUTDOWN_MINUTES || '20';
        new StringParameter(this, "AutoShutdownParam", {
            parameterName: "/huginbot/auto-shutdown-minutes",
            stringValue: autoShutdownMinutes,
            description: "Minutes of idle time before auto-shutdown (or 'off' to disable)",
        });

        // Note: Discord webhooks are now stored in SSM Parameter Store
        // Use /setup command in Discord to configure webhooks per guild

        // Create Lambda common environment variables
        const lambdaEnv: { [key: string]: string } = {
            VALHEIM_INSTANCE_ID: this.ec2Instance.instanceId,
            DISCORD_AUTH_TOKEN: discordAuthToken,
            BACKUP_BUCKET_NAME: this.backupBucket.bucketName,
            DISCORD_BOT_PUBLIC_KEY: process.env.DISCORD_BOT_PUBLIC_KEY || '',
            DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_SECRET_TOKEN || '',
        };

        // Add world configuration environment variables
        // Pass WORLD_COUNT and all WORLD_X_ variables to Lambda
        if (process.env.WORLD_COUNT) {
            lambdaEnv.WORLD_COUNT = process.env.WORLD_COUNT;
            
            const worldCount = parseInt(process.env.WORLD_COUNT, 10);
            for (let i = 1; i <= worldCount; i++) {
                // Pass all WORLD_X_ environment variables to Lambda
                Object.keys(process.env).forEach(key => {
                    if (key.startsWith(`WORLD_${i}_`) && process.env[key]) {
                        lambdaEnv[key] = process.env[key]!; // Non-null assertion since we checked above
                    }
                });
            }
        }

        // Remove empty values to avoid test issues
        Object.keys(lambdaEnv).forEach(key => {
            if (!lambdaEnv[key]) {
                delete lambdaEnv[key];
            }
        });

        // Common Lambda properties
        const lambdaDefaultProps = {
            runtime: Runtime.NODEJS_18_X,
            timeout: Duration.minutes(15), // Maximum timeout for async Discord operations
            memorySize: 512, // Increased memory for better performance
            environment: lambdaEnv,
        };

        // Create Discord Commands Lambda function
        const commandsFunction = new NodejsFunction(this, "CommandsFunction", {
            ...lambdaDefaultProps,
            entry: "lib/lambdas/commands.ts",
            handler: "handler",
        });
        
        // Add CloudWatch log retention
        new LogGroup(this, 'CommandsFunctionLogGroup', {
            logGroupName: `/aws/lambda/${commandsFunction.functionName}`,
            retention: RetentionDays.ONE_DAY
        });

        // Grant EC2 permissions to the Commands Lambda function
        // DescribeInstances is a list operation and doesn't support resource-level permissions
        const ec2DescribePolicy = new PolicyStatement({
            actions: [
                "ec2:DescribeInstances",
            ],
            resources: ["*"],
        });

        // Start/Stop operations can be scoped to specific instance
        const ec2ControlPolicy = new PolicyStatement({
            actions: [
                "ec2:StartInstances",
                "ec2:StopInstances",
            ],
            resources: [
                `arn:aws:ec2:${this.region}:${this.account}:instance/${this.ec2Instance.instanceId}`
            ],
        });

        // Add permission for SSM document - scoped to specific document and instance
        // Note: AWS-RunShellScript is an AWS-owned document, so ARN has no account ID
        const ssmDocumentPolicy = new PolicyStatement({
            actions: [
                "ssm:SendCommand",
            ],
            resources: [
                `arn:aws:ssm:${this.region}::document/AWS-RunShellScript`,
                `arn:aws:ec2:${this.region}:${this.account}:instance/${this.ec2Instance.instanceId}`
            ]
        });

        // Add permission for SSM command invocation
        const ssmCommandPolicy = new PolicyStatement({
            actions: [
                "ssm:GetCommandInvocation"
            ],
            resources: [
                `arn:aws:ssm:${this.region}:${this.account}:*`
            ]
        });

        // Add S3 backup policy for commands function
        const s3BackupPolicy = new PolicyStatement({
            actions: [
                "s3:ListBucket",
                "s3:GetObject"
            ],
            resources: [
                this.backupBucket.bucketArn,
                `${this.backupBucket.bucketArn}/worlds/*`
            ]
        });

        // Add EventBridge policy for commands function (for force stop notifications)
        const eventBridgePolicy = new PolicyStatement({
            actions: [
                "events:PutEvents"
            ],
            resources: [
                `arn:aws:events:${this.region}:${this.account}:event-bus/default`
            ]
        });

        commandsFunction.addToRolePolicy(ec2DescribePolicy);
        commandsFunction.addToRolePolicy(ec2ControlPolicy);
        commandsFunction.addToRolePolicy(ssmDocumentPolicy);
        commandsFunction.addToRolePolicy(ssmCommandPolicy);
        commandsFunction.addToRolePolicy(s3BackupPolicy);
        commandsFunction.addToRolePolicy(eventBridgePolicy);

        // Grant SSM Parameter Store access to commands Lambda (full permissions)
        const ssmCommandsPolicy = new PolicyStatement({
            actions: [
                "ssm:GetParameter",
                "ssm:GetParameters",
                "ssm:PutParameter",  // For setup command
                "ssm:DeleteParameter",  // For cleanup
                "ssm:AddTagsToResource",  // For tagging parameters
            ],
            resources: [
                `arn:aws:ssm:${this.region}:${this.account}:parameter/huginbot/*`
            ],
        });
        
        commandsFunction.addToRolePolicy(ssmCommandsPolicy);

        // Grant limited SSM access to backup cleanup function (read-only)
        const ssmBackupPolicy = new PolicyStatement({
            actions: [
                "ssm:GetParameter",
                "ssm:GetParameters",
            ],
            resources: [
                `arn:aws:ssm:${this.region}:${this.account}:parameter/huginbot/*`
            ],
        });
        
        backupCleanupFunction.addToRolePolicy(ssmBackupPolicy);

        // Create API Gateway
        const api = new RestApi(this, "HuginbotApi", {
            restApiName: "HuginBot Discord API",
            description: "API for Discord bot to control Valheim server",
            endpointTypes: [EndpointType.REGIONAL],
        });

        // Create API routes
        const valheimResource = api.root.addResource("valheim");
        const commandsResource = valheimResource.addResource("control");
        commandsResource.addMethod("POST", new LambdaIntegration(commandsFunction, {
            proxy: true,
        }));
        
        // Add CORS support for Discord
        commandsResource.addCorsPreflight({
            allowOrigins: ['https://discord.com'],
            allowMethods: ['POST', 'OPTIONS'],
            allowHeaders: ['Content-Type', 'X-Signature-Ed25519', 'X-Signature-Timestamp'],
        });

        this.apiUrl = api.url;

        // Create Discord notifications Lambda function (handles all EventBridge notifications)
        const discordNotificationsFunction = new NodejsFunction(this, 'DiscordNotificationsFunction', {
            ...lambdaDefaultProps,
            entry: path.join(__dirname, '../lambdas/discord-notifications.ts'),
            handler: 'handler',
            timeout: Duration.seconds(30),
        });

        // Grant SSM permissions for webhook and world config access
        discordNotificationsFunction.addToRolePolicy(new PolicyStatement({
            actions: [
                "ssm:GetParameter",
                "ssm:GetParameters",
            ],
            resources: [
                `arn:aws:ssm:${this.region}:${this.account}:parameter/huginbot/*`
            ],
        }));

        // Create EventBridge rule for join code events
        const joinCodeEventRule = new Rule(this, 'JoinCodeEventRule', {
            eventPattern: {
                source: ['valheim.server'],
                detailType: ['PlayFab.JoinCodeDetected']
            },
            description: 'Trigger Discord notification when join code is detected'
        });

        // Connect EventBridge rules to Discord notifications Lambda
        joinCodeEventRule.addTarget(new LambdaFunction(discordNotificationsFunction));

        // Create EventBridge rule for backup completion events
        const backupCompletedRule = new Rule(this, 'BackupCompletedEventRule', {
            eventPattern: {
                source: ['valheim.server'],
                detailType: ['Backup.Completed']
            },
            description: 'Trigger Discord notification when backup completes'
        });
        backupCompletedRule.addTarget(new LambdaFunction(discordNotificationsFunction));

        // Create EventBridge rule for server stop events (from scripts)
        const serverStoppedRule = new Rule(this, 'ServerStoppedEventRule', {
            eventPattern: {
                source: ['valheim.server'],
                detailType: ['Server.Stopped']
            },
            description: 'Trigger Discord notification when server stops'
        });
        serverStoppedRule.addTarget(new LambdaFunction(discordNotificationsFunction));

        // Create EventBridge rule for EC2 instance state changes (external observer)
        const ec2StateChangeRule = new Rule(this, 'EC2StateChangeRule', {
            eventPattern: {
                source: ['aws.ec2'],
                detailType: ['EC2 Instance State-change Notification'],
                detail: {
                    'instance-id': [this.ec2Instance.instanceId],
                    'state': ['stopped']
                }
            },
            description: 'Trigger notification when EC2 instance stops (fallback)'
        });
        ec2StateChangeRule.addTarget(new LambdaFunction(discordNotificationsFunction));

        // === ROUTE 53 CUSTOM DOMAIN (OPTIONAL) ===
        // If CUSTOM_URL is set, create Lambda to update Route53 when EC2 IP changes
        const customUrl = process.env.CUSTOM_URL;
        if (customUrl) {
            console.log(`Custom domain configured: ${customUrl}`);

            // Create Lambda function to update Route53
            const route53UpdateFunction = new NodejsFunction(this, 'Route53UpdateFunction', {
                ...lambdaDefaultProps,
                entry: path.join(__dirname, '../lambdas/update-route53.ts'),
                handler: 'handler',
                timeout: Duration.seconds(30),
                environment: {
                    ...lambdaDefaultProps.environment,
                    CUSTOM_DOMAIN: customUrl,
                },
            });

            // Grant permissions to read EC2 instance info
            route53UpdateFunction.addToRolePolicy(new PolicyStatement({
                effect: Effect.ALLOW,
                actions: [
                    'ec2:DescribeInstances',
                ],
                resources: ['*'], // DescribeInstances doesn't support resource-level permissions
            }));

            // Grant permissions to update Route53 records
            route53UpdateFunction.addToRolePolicy(new PolicyStatement({
                effect: Effect.ALLOW,
                actions: [
                    'route53:ListHostedZonesByName',
                    'route53:ChangeResourceRecordSets',
                    'route53:GetChange', // Optional: check status of DNS changes
                ],
                resources: ['*'], // Route53 requires wildcard for ListHostedZonesByName
            }));

            // Create EventBridge rule for EC2 state changes (running state)
            const route53UpdateRule = new Rule(this, 'Route53UpdateRule', {
                eventPattern: {
                    source: ['aws.ec2'],
                    detailType: ['EC2 Instance State-change Notification'],
                    detail: {
                        'instance-id': [this.ec2Instance.instanceId],
                        'state': ['running']
                    }
                },
                description: 'Update Route53 DNS when Valheim server starts'
            });

            route53UpdateRule.addTarget(new LambdaFunction(route53UpdateFunction));

            // Also pass custom domain to discord notifications lambda
            discordNotificationsFunction.addEnvironment('CUSTOM_DOMAIN', customUrl);

            // Output the custom domain
            new CfnOutput(this, "CustomDomain", {
                value: `${customUrl}:2456`,
                description: "Custom domain for connecting to Valheim server",
                exportName: "ValheimServerCustomDomain",
            });
        }

        // Outputs
        new CfnOutput(this, "InstanceId", {
            value: this.ec2Instance.instanceId,
            description: "ID of the Valheim server EC2 instance",
            exportName: "ValheimServerInstanceId",
        });

        new CfnOutput(this, "InstancePublicIP", {
            value: "Get public IP with: aws ec2 describe-instances --instance-ids " + this.ec2Instance.instanceId + " --query 'Reservations[0].Instances[0].PublicIpAddress'",
            description: "Command to get the Valheim server public IP",
            exportName: "ValheimServerPublicIP",
        });

        new CfnOutput(this, "ValheimConnectAddress", {
            value: "Use the public IP from above command with port 2456",
            description: "Address format to connect to the Valheim server",
            exportName: "ValheimConnectAddress",
        });

        new CfnOutput(this, "BackupBucketName", {
            value: this.backupBucket.bucketName,
            description: "S3 bucket for Valheim server backups",
            exportName: "ValheimBackupBucket",
        });

        // Discord integration outputs
        new CfnOutput(this, "ApiEndpoint", {
            value: api.url,
            description: "API Endpoint for Discord bot integration",
            exportName: `HuginbotApiEndpoint${parameterSuffix}`,
        });

        new CfnOutput(this, "AuthTokenOutput", {
            value: discordAuthToken,
            description: "Auth token for Discord integration",
            exportName: `HuginbotDiscordAuthToken${parameterSuffix}`,
        });
    }

    private get removalPolicy() {
        return this.node.tryGetContext("production") === true
            ? undefined // Retain in production
            : this.node.tryGetContext("keep_resources") === true
                ? undefined // Retain if explicitly requested
                : undefined; // Default behavior (DESTROY would be safer for testing)
    }

    private generateRandomToken(): string {
        // Use Node.js crypto module for cryptographically secure random token
        const crypto = require('crypto');
        // Generate 32 bytes (256 bits) of secure random data and convert to hex
        return crypto.randomBytes(32).toString('hex');
    }
    
}
