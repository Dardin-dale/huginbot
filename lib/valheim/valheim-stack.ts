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
import { Construct } from "constructs";
import * as path from "path";

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
}

export class ValheimServerAwsCdkStack extends Stack {
  public readonly ec2Instance: Instance;
  public readonly vpc: Vpc;
  public readonly backupBucket: Bucket;
  public readonly backupSchedule?: string;

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
      "yum install -y docker git amazon-cloudwatch-agent",
      "systemctl enable docker",
      "systemctl start docker"
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
      "chmod -R 755 /mnt/valheim-data"
    );

    // Copy bootstrap data if provided
    if (props?.worldResourcesBucket && props.worldBootstrapLocation) {
      userData.addCommands(
        `aws s3 cp --recursive s3://${props.worldResourcesBucket.bucketName}/${props.worldBootstrapLocation} /mnt/valheim-data/config/`
      );
    }

    // Create backup script
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

# Create the backup
timestamp=$(date +%Y%m%d_%H%M%S)
tar -czf /tmp/valheim_backup_$timestamp.tar.gz -C /mnt/valheim-data .
aws s3 cp /tmp/valheim_backup_$timestamp.tar.gz s3://${this.backupBucket.bucketName}/$BACKUP_PATH/valheim_backup_$timestamp.tar.gz
rm /tmp/valheim_backup_$timestamp.tar.gz
EOF`,
      "chmod +x /usr/local/bin/backup-valheim.sh",
      
      // Create world switching script
      `cat > /usr/local/bin/switch-valheim-world.sh << 'EOF'
#!/bin/bash
# This script switches the active Valheim world based on SSM Parameter Store value

# Check if the server is running
if docker ps | grep -q valheim-server; then
  echo "Stopping Valheim server..."
  docker stop valheim-server
  docker rm valheim-server
fi

# Get active world from SSM Parameter Store
if ! aws ssm get-parameter --name "/huginbot/active-world" --region $(curl -s http://169.254.169.254/latest/meta-data/placement/region) 2>/dev/null; then
  echo "No active world parameter found, using default configuration"
  exit 0
fi

PARAM_VALUE=$(aws ssm get-parameter --name "/huginbot/active-world" --region $(curl -s http://169.254.169.254/latest/meta-data/placement/region) --query "Parameter.Value" --output text)
WORLD_NAME=$(echo $PARAM_VALUE | jq -r '.worldName')
SERVER_NAME=$(echo $PARAM_VALUE | jq -r '.name')
SERVER_PASSWORD=$(echo $PARAM_VALUE | jq -r '.serverPassword')

echo "Switching to world: $SERVER_NAME ($WORLD_NAME)"

# Back up the current world
/usr/local/bin/backup-valheim.sh

# Start the server with the new configuration
docker run -d --name valheim-server \\
  -p 2456-2458:2456-2458/udp \\
  -p 2456-2458:2456-2458/tcp \\
  -p 80:80 \\
  -v /mnt/valheim-data/config:/config \\
  -v /mnt/valheim-data/backups:/config/backups \\
  -e SERVER_NAME="$SERVER_NAME" \\
  -e WORLD_NAME="$WORLD_NAME" \\
  -e SERVER_PASS="$SERVER_PASSWORD" \\
  -e TZ="America/Los_Angeles" \\
  -e BACKUPS_DIRECTORY="/config/backups" \\
  -e BACKUPS_INTERVAL="3600" \\
  -e BACKUPS_MAX_AGE="3" \\
  -e BACKUPS_DIRECTORY_PERMISSIONS="755" \\
  -e BACKUPS_FILE_PERMISSIONS="644" \\
  -e CONFIG_DIRECTORY_PERMISSIONS="755" \\
  -e WORLDS_DIRECTORY_PERMISSIONS="755" \\
  -e WORLDS_FILE_PERMISSIONS="644" \\
  -e SERVER_PUBLIC="true" \\
  -e UPDATE_INTERVAL="900" \\
  -e STEAMCMD_ARGS="validate" \\
  -e BEPINEX="true" \\
  -e SERVER_ARGS="-crossplay" \\
  --restart unless-stopped \\
  lloesche/valheim-server

echo "World switched successfully"
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
      `BEPINEX="true"`,
    ];

    // Add admin IDs if provided
    if (props?.adminIds) {
      dockerEnvVars.push(`ADMINLIST_IDS="${props.adminIds}"`);
    }

    // Create server specific arguments
    dockerEnvVars.push(`SERVER_ARGS="-crossplay"`);

    // Start Valheim server using Docker
    userData.addCommands(
      `docker run -d --name valheim-server \\
        -p 2456-2458:2456-2458/udp \\
        -p 2456-2458:2456-2458/tcp \\
        -p 80:80 \\
        -v /mnt/valheim-data/config:/config \\
        -v /mnt/valheim-data/backups:/config/backups \\
        ${dockerEnvVars.map(env => `-e ${env}`).join(" \\\n        ")} \\
        --restart unless-stopped \\
        lloesche/valheim-server`
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
}