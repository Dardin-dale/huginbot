# AWS Setup Guide for HuginBot

This guide walks you through setting up AWS credentials and configuring your AWS environment for HuginBot deployment.

## Prerequisites

- An AWS account ([Create one here](https://aws.amazon.com/))
- Credit card for AWS billing (you'll use mostly free tier resources)
- Basic familiarity with command line

## Estimated Costs

HuginBot is designed to be cost-effective:

| Resource | Cost | Notes |
|----------|------|-------|
| **EC2 Instance** | ~$0.04-0.08/hour | Only when server is running |
| **S3 Storage** | ~$0.02/GB/month | For world backups |
| **Lambda** | Free* | Usually within free tier limits |
| **API Gateway** | Free* | Usually within free tier limits |
| **Secrets Manager** | $0.40/month | Per webhook secret |
| **CloudWatch Logs** | Free* | First 5GB/month free |
| **Data Transfer** | Free* | Mostly within free tier |

**Typical monthly cost:** $5-20 depending on play time (auto-shutdown keeps costs low!)

*Free tier available - see [AWS Free Tier](https://aws.amazon.com/free/)

**💡 Cost Calculator:** [AWS Pricing Calculator](https://calculator.aws.amazon.com/)

## Step 1: Install AWS CLI

The AWS Command Line Interface is required for HuginBot deployment.

### macOS
```bash
brew install awscli
```

### Linux
```bash
# Download installer
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

# Verify installation
aws --version
```

### Windows
Download and run the installer:
https://awscli.amazonaws.com/AWSCLIV2.msi

**Verify Installation:**
```bash
aws --version
# Should output: aws-cli/2.x.x ...
```

## Step 2: Create an IAM User for HuginBot

**⚠️ Important:** Don't use your root AWS account credentials! Create a dedicated IAM user.

### 2.1 Sign in to AWS Console

1. Go to: https://console.aws.amazon.com/
2. Sign in with your AWS account

### 2.2 Navigate to IAM

1. In the AWS Console search bar, type "IAM"
2. Click on "IAM" (Identity and Access Management)

### 2.3 Create New User

1. Click "Users" in the left sidebar
2. Click "Add users" (top right)
3. **User name:** Enter `huginbot-deployer` (or your preferred name)
4. Click "Next"

### 2.4 Set Permissions

You have two options:

#### Option A: Administrator Access (Easier, Less Secure)

**Best for:** Personal use, testing, quick setup

1. Click "Attach policies directly"
2. Search for and select: `AdministratorAccess`
3. Click "Next"
4. Click "Create user"

**⚠️ Warning:** This gives full AWS access. Only use for personal/testing environments.

#### Option B: Minimal Permissions (Recommended, More Secure)

**Best for:** Production use, team environments, security-conscious setups

1. Click "Attach policies directly"
2. Click "Create policy" (opens new tab)
3. Click the "JSON" tab
4. Paste this minimal permissions policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "HuginBotCDKDeploy",
      "Effect": "Allow",
      "Action": [
        "cloudformation:*",
        "s3:*",
        "iam:*",
        "ec2:*",
        "lambda:*",
        "apigateway:*",
        "logs:*",
        "events:*",
        "secretsmanager:*",
        "ssm:*",
        "sts:GetCallerIdentity",
        "ecr:*"
      ],
      "Resource": "*"
    },
    {
      "Sid": "HuginBotCDKBootstrap",
      "Effect": "Allow",
      "Action": [
        "sts:AssumeRole"
      ],
      "Resource": "arn:aws:iam::*:role/cdk-*"
    }
  ]
}
```

5. Click "Next"
6. **Policy name:** `HuginBotDeployPolicy`
7. Click "Create policy"
8. Go back to the user creation tab
9. Click the refresh button
10. Search for and select: `HuginBotDeployPolicy`
11. Click "Next"
12. Click "Create user"

**🔒 Security Note:** This follows the principle of least privilege while still allowing CDK deployments.

## Step 3: Create Access Keys

Now create programmatic access credentials:

1. **Click on the user** you just created (`huginbot-deployer`)
2. Click the **"Security credentials"** tab
3. Scroll down to **"Access keys"**
4. Click **"Create access key"**
5. Select **"Command Line Interface (CLI)"**
6. Check the confirmation box at the bottom
7. Click **"Next"**
8. (Optional) Add a description tag: "HuginBot CLI deployment"
9. Click **"Create access key"**

### 3.1 Save Your Credentials

**⚠️ CRITICAL: This is your only chance to see the Secret Access Key!**

You'll see two values:
- **Access key ID:** `AKIAIOSFODNN7EXAMPLE` (20 characters)
- **Secret access key:** `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` (40 characters)

**Save both values immediately!**

Options:
- Click "Download .csv file" (stores both values)
- Copy to a secure password manager
- Write them down temporarily (delete after configuration)

**Security Best Practices:**
- Never commit these to Git
- Don't share them via email/chat
- Store in password manager
- Rotate regularly (every 90 days)

## Step 4: Configure AWS CLI

Configure the AWS CLI with your new credentials:

```bash
aws configure
```

You'll be prompted for:

```
AWS Access Key ID [None]: <paste your Access key ID>
AWS Secret Access Key [None]: <paste your Secret access key>
Default region name [None]: us-west-2
Default output format [None]: json
```

### Choosing Your Region

**Popular regions:**
- `us-east-1` - US East (N. Virginia) - Usually cheapest, most services
- `us-west-2` - US West (Oregon) - Good for west coast
- `eu-west-1` - Europe (Ireland) - Good for Europe
- `ap-southeast-1` - Asia Pacific (Singapore) - Good for Asia

**Considerations:**
- Choose a region close to where players are located (lower latency)
- Some regions are slightly cheaper than others
- Not all instance types available in all regions

**Check EC2 pricing:** https://aws.amazon.com/ec2/pricing/on-demand/

### Verify Configuration

```bash
# Test AWS credentials
aws sts get-caller-identity

# Should output something like:
# {
#     "UserId": "AIDAI...",
#     "Account": "123456789012",
#     "Arn": "arn:aws:iam::123456789012:user/huginbot-deployer"
# }
```

If you see your account info, you're all set!

## Step 5: Bootstrap AWS CDK (First Time Only)

HuginBot uses AWS CDK for infrastructure deployment. Bootstrap your AWS account:

```bash
# This creates necessary CDK resources in your AWS account
npx cdk bootstrap aws://ACCOUNT-ID/REGION

# Or let CDK detect automatically:
npx cdk bootstrap
```

**Example:**
```bash
npx cdk bootstrap aws://123456789012/us-west-2
```

**What this does:**
- Creates an S3 bucket for CDK assets
- Creates IAM roles for CDK deployments
- Sets up CloudFormation stack for CDK toolkit

**You only need to do this once per AWS account/region combination.**

## Step 6: Update HuginBot .env File

Add your AWS configuration to `.env`:

```bash
# AWS Configuration
AWS_REGION=us-west-2        # Your chosen region
AWS_PROFILE=default         # Usually "default"
```

**Note:** The access keys are stored in `~/.aws/credentials` by `aws configure`, so you don't need to add them to `.env`.

## Multiple AWS Profiles (Optional)

If you use multiple AWS accounts, you can create named profiles:

```bash
# Configure a named profile
aws configure --profile huginbot

# Update .env to use this profile
AWS_PROFILE=huginbot
```

Then all AWS commands will use the `huginbot` profile.

## Step 7: Set EC2 Instance Type

Choose your instance type based on expected player count:

```bash
# In .env file
VALHEIM_INSTANCE_TYPE=t3.medium
```

**Instance type recommendations:**

| Instance Type | vCPU | RAM | Cost/hour | Players | Recommended |
|---------------|------|-----|-----------|---------|-------------|
| `t3.micro` | 2 | 1 GB | $0.01 | N/A | ❌ Too small |
| `t3.small` | 2 | 2 GB | $0.02 | 1-2 | ⚠️ Minimal |
| `t3.medium` | 2 | 4 GB | $0.04 | 2-5 | ✅ Recommended |
| `t3.large` | 2 | 8 GB | $0.08 | 5-10 | ✅ Optimal |
| `t3.xlarge` | 4 | 16 GB | $0.17 | 10+ | 🎮 Large groups |

**Cost example:** Running a `t3.medium` for 100 hours/month = $4/month

## Regional Considerations

### Latency

Your Valheim server's region affects player latency:

| Players Located | Recommended Region | Latency |
|-----------------|-------------------|---------|
| US West Coast | `us-west-2` | ~20-40ms |
| US East Coast | `us-east-1` | ~20-40ms |
| Europe | `eu-west-1` | ~10-30ms |
| Asia/Pacific | `ap-southeast-1` | ~20-50ms |

**Pro tip:** Use https://www.cloudping.info/ to test latency from your location to different AWS regions.

### Pricing Differences

Some regions cost more than others. For example:
- `us-east-1` (N. Virginia) - Usually cheapest
- `ap-northeast-1` (Tokyo) - ~10% more expensive
- `eu-north-1` (Stockholm) - ~5% cheaper than other EU regions

**Check pricing:** https://aws.amazon.com/ec2/pricing/on-demand/

## Service Quotas and Limits

AWS accounts have default service quotas. For HuginBot you might need:

### Check EC2 Quotas

```bash
aws service-quotas get-service-quota \
  --service-code ec2 \
  --quota-code L-1216C47A
```

**Default limits (new accounts):**
- EC2 instances: Usually 5-20 on-demand instances
- Elastic IPs: 5 per region
- EBS volumes: 300 GB total

**If you hit limits:**
1. Go to AWS Service Quotas console
2. Request a quota increase
3. Usually approved within 24 hours

## Troubleshooting

### "Unable to locate credentials"

**Solution:**
```bash
# Re-run AWS configure
aws configure

# Verify credentials file exists
cat ~/.aws/credentials
```

### "Access Denied" errors during deployment

**Possible causes:**
1. IAM user doesn't have sufficient permissions
2. CDK not bootstrapped
3. Wrong AWS region

**Solutions:**
1. Verify IAM policies are attached
2. Run `npx cdk bootstrap`
3. Check `AWS_REGION` in `.env` matches `aws configure` region

### "Region not supported"

Some older/specialized regions may not support all AWS services.

**Solution:** Use a major region like `us-west-2` or `us-east-1`

### CDK Bootstrap Fails

**Error:** "Stack was already deployed"

**Solution:** This is fine! It means CDK is already bootstrapped. Proceed with deployment.

## Security Best Practices

- ✅ Use IAM user (never root account) for deployments
- ✅ Enable MFA (Multi-Factor Authentication) on your AWS account
- ✅ Rotate access keys every 90 days
- ✅ Use minimal IAM permissions (Option B above)
- ✅ Monitor AWS Cost Explorer weekly
- ✅ Set up billing alarms (get notified if costs exceed expected)
- ✅ Review CloudTrail logs periodically
- ✅ Delete unused resources to avoid charges

## Setting Up Billing Alerts

Protect yourself from unexpected AWS charges:

1. Go to: https://console.aws.amazon.com/billing/
2. Click "Billing preferences" in left sidebar
3. Enable "Receive Billing Alerts"
4. Go to CloudWatch console
5. Create alarm: Alert when charges exceed $10 (or your threshold)

## Next Steps

Now that AWS is configured:

1. ✅ Complete Discord setup (see [Discord Setup Guide](./discord-setup.md))
2. ✅ Configure your first world in `.env`
3. ✅ Run `npm run deploy` to deploy infrastructure
4. ✅ Test your server with `/start` in Discord

## Additional Resources

- [AWS Free Tier Details](https://aws.amazon.com/free/)
- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [AWS CLI User Guide](https://docs.aws.amazon.com/cli/latest/userguide/)
- [EC2 Pricing Calculator](https://calculator.aws.amazon.com/)
- [AWS Support](https://console.aws.amazon.com/support/)

## Need Help?

- Check the [HuginBot README](../README.md)
- Review [Troubleshooting Guide](./troubleshooting.md)
- Check AWS service health: https://status.aws.amazon.com/
- Create an issue on GitHub
