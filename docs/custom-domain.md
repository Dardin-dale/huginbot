# Custom Domain Setup Guide

This guide shows you how to configure a custom domain for your Valheim server, allowing players to connect via `valheim.yourdomain.com:2456` instead of PlayFab join codes.

## Why Use a Custom Domain?

**Benefits:**
- **Easier to remember** - `valheim.gjurdsihop.net:2456` vs `1A2B3C+4D5E6F`
- **Consistent** - Same address every time server starts
- **Professional** - Your own branded server address
- **Reliable** - Direct IP connection, no dependency on PlayFab join codes

**Costs:**
- Domain registration: ~$13/year (varies by TLD)
- Route 53 hosted zone: $0.50/month ($6/year)
- DNS queries: ~$0.001/month (negligible)
- **Total**: **~$19/year** or **~$1.60/month**

## Prerequisites

- A registered domain name (can purchase via Route 53 or transfer from another registrar)
- Domain must be using Route 53 for DNS hosting
- HuginBot already deployed and working

## Quick Start

If you already have a domain in Route 53:

```bash
# 1. Add to .env
CUSTOM_URL=valheim.yourdomain.com

# 2. Redeploy
npm run deploy

# 3. Done! Server will update DNS automatically when it starts
```

## Detailed Setup

### Option 1: Register New Domain in Route 53

**This is the easiest option - everything stays in one place.**

1. **Go to Route 53 Console**
   - https://console.aws.amazon.com/route53/

2. **Register Domain**
   - Click "Registered domains" in left sidebar
   - Click "Register Domain"
   - Search for your desired domain
   - Complete registration (takes 15-60 minutes to process)

3. **Verify Hosted Zone Created**
   - Click "Hosted zones" in left sidebar
   - You should see your new domain listed
   - Note: Route 53 automatically creates a hosted zone for registered domains

4. **Configure HuginBot**
   ```bash
   # In .env file
   CUSTOM_URL=valheim.yourdomain.com
   # Or use subdomain:
   CUSTOM_URL=valheim.mydomain.com
   ```

5. **Deploy**
   ```bash
   npm run deploy
   ```

6. **Test**
   - Start server: `/start` in Discord
   - Wait 5-10 minutes for server to start
   - Discord will show your custom domain
   - Connect via: `valheim.yourdomain.com:2456`

### Option 2: Use Existing Domain from Another Registrar

**If you have a domain at GoDaddy, Namecheap, etc.**

#### A. Transfer Entire Domain to Route 53 (Recommended)

1. **Unlock domain** at current registrar
2. **Get authorization code** from current registrar
3. **Transfer to Route 53**:
   - Route 53 Console → Registered domains → Transfer domain
   - Follow prompts (takes 5-7 days)
4. Follow "Option 1" steps above after transfer completes

#### B. Delegate Subdomain to Route 53 (Keep Current Registrar)

**Best for: Using a subdomain like `valheim.yourdomain.com` while keeping `yourdomain.com` at current registrar**

1. **Create Hosted Zone in Route 53**
   ```bash
   aws route53 create-hosted-zone \
     --name valheim.yourdomain.com \
     --caller-reference "huginbot-$(date +%s)"
   ```

   Or via Route 53 Console:
   - Hosted zones → Create hosted zone
   - Domain name: `valheim.yourdomain.com`
   - Type: Public hosted zone
   - Click "Create hosted zone"

2. **Get Route 53 Name Servers**
   - After creating, you'll see 4 NS (name server) records
   - Example:
     ```
     ns-123.awsdns-12.com
     ns-456.awsdns-34.net
     ns-789.awsdns-56.org
     ns-012.awsdns-78.co.uk
     ```

3. **Add NS Records at Current Registrar**
   - Log into your current domain registrar (GoDaddy, Namecheap, etc.)
   - Find DNS settings for `yourdomain.com`
   - Add NS records for the subdomain:
     ```
     Host: valheim
     Type: NS
     Value: ns-123.awsdns-12.com
     (repeat for all 4 name servers)
     ```

4. **Wait for DNS Propagation**
   - Changes take 5-60 minutes to propagate
   - Test with: `dig valheim.yourdomain.com NS`

5. **Configure HuginBot**
   ```bash
   # In .env
   CUSTOM_URL=valheim.yourdomain.com
   ```

6. **Deploy**
   ```bash
   npm run deploy
   ```

### Option 3: Use Root Domain

**Use the root domain itself (e.g., `gjurdsihop.net` instead of `valheim.gjurdsihop.net`)**

1. Make sure domain is in Route 53 (Option 1 or 2A above)

2. **Configure HuginBot**
   ```bash
   # In .env
   CUSTOM_URL=yourdomain.com
   ```

3. **Deploy**
   ```bash
   npm run deploy
   ```

**Note:** This creates an A record for the root domain. If you have a website at `yourdomain.com`, this will override it. Use a subdomain instead.

## How It Works

### Automatic DNS Updates

When you configure `CUSTOM_URL`:

1. **Lambda Function** is created to update Route 53
2. **EventBridge Rule** triggers Lambda when EC2 instance starts
3. **Lambda Updates DNS**:
   - Gets EC2 instance public IP
   - Finds Route 53 hosted zone for your domain
   - Creates/updates A record pointing to the IP
   - Uses TTL of 60 seconds for fast updates

4. **Discord Notification** shows custom domain instead of join code

### What Happens When Server Stops/Starts

**When server stops:**
- DNS record is left in place (points to stopped instance IP)
- Players can't connect (expected - server is off)
- No DNS changes needed

**When server starts:**
- New IP address is assigned (usually different)
- EventBridge detects "running" state
- Lambda updates DNS to new IP within ~30 seconds
- DNS propagates within 1-2 minutes
- Players can connect via custom domain

## Verifying It's Working

### 1. Check DNS Record

```bash
# Should return your EC2 instance's current IP
dig +short valheim.yourdomain.com

# Or use:
nslookup valheim.yourdomain.com
```

### 2. Check Lambda Logs

```bash
# View Route53 update Lambda logs
aws logs tail /aws/lambda/ValheimStack-Route53UpdateFunction --follow
```

### 3. Test Connection

```bash
# Ping your domain (should respond with EC2 IP)
ping valheim.yourdomain.com

# Check Valheim port is open
nc -zv valheim.yourdomain.com 2456
```

## Troubleshooting

### DNS Not Updating

**Symptoms:** Old IP address or no A record

**Solutions:**

1. **Check Lambda execution**
   ```bash
   aws logs filter-log-events \
     --log-group-name /aws/lambda/ValheimStack-Route53UpdateFunction \
     --start-time $(date -u -d '10 minutes ago' +%s)000
   ```

2. **Check EventBridge rule**
   ```bash
   aws events list-rules --name-prefix "ValheimStack-Route53"
   ```

3. **Manually trigger update**
   - Stop and start server
   - Lambda should execute within 30 seconds

4. **Verify hosted zone exists**
   ```bash
   aws route53 list-hosted-zones
   ```

### "Could not find hosted zone" Error

**Cause:** Lambda can't find Route 53 hosted zone for your domain

**Solutions:**

1. **Check hosted zone exists**
   ```bash
   aws route53 list-hosted-zones-by-name --dns-name yourdomain.com
   ```

2. **Verify domain spelling** in `.env` matches hosted zone exactly

3. **For subdomains**: Make sure hosted zone exists for the subdomain
   - Example: `CUSTOM_URL=valheim.mydomain.com` needs a hosted zone for `mydomain.com`

### Players Can't Connect

**Symptoms:** DNS resolves but connection fails

**Debug steps:**

1. **Verify server is running**
   ```
   /status check
   ```

2. **Check correct port**
   - Must connect to: `domain:2456`
   - NOT just `domain`

3. **Test direct IP connection**
   - Get IP from `/status check`
   - Try connecting with IP directly
   - If IP works but domain doesn't, DNS issue

4. **Check security group**
   ```bash
   # Ports 2456-2458 should be open
   aws ec2 describe-security-groups \
     --filters "Name=group-name,Values=*Valheim*"
   ```

### DNS Propagation Taking Too Long

**Normal:** 1-5 minutes for changes to propagate

**If longer:**

1. **Check TTL** (should be 60 seconds)
   ```bash
   dig valheim.yourdomain.com | grep TTL
   ```

2. **Flush local DNS cache**
   - macOS: `sudo dscacheutil -flushcache`
   - Windows: `ipconfig /flushdns`
   - Linux: `sudo systemd-resolve --flush-caches`

3. **Try different DNS server**
   ```bash
   # Use Google DNS directly
   dig @8.8.8.8 valheim.yourdomain.com
   ```

### Permission Errors in Lambda

**Error:** `AccessDenied` for Route53 operations

**Solution:**

Verify IAM permissions:
```bash
# Check Lambda role
aws lambda get-function --function-name ValheimStack-Route53UpdateFunction \
  --query 'Configuration.Role'

# Verify permissions are attached
aws iam list-attached-role-policies --role-name <role-name-from-above>
```

Lambda needs these permissions:
- `route53:ListHostedZonesByName`
- `route53:ChangeResourceRecordSets`
- `ec2:DescribeInstances`

## Cost Breakdown

| Item | Cost | Notes |
|------|------|-------|
| Domain registration | $13/year | Varies by TLD (.com, .net, etc.) |
| Route 53 hosted zone | $0.50/month | $6/year per hosted zone |
| DNS queries | $0.40 per million | ~$0.001/month for Valheim |
| Lambda executions | Free | Within free tier (1M/month) |
| **Total** | **~$19/year** | **~$1.60/month** |

**Comparison to Elastic IP:**
- Elastic IP: $3.60/month when stopped ($43/year)
- Custom Domain: $1.60/month ($19/year)
- **Savings: $24/year with custom domain!**

## Advanced Configuration

### Multiple Subdomains

Run multiple Valheim servers on different subdomains:

```bash
# Server 1
CUSTOM_URL=survival.mydomain.com

# Server 2 (different stack)
CUSTOM_URL=creative.mydomain.com
```

Each needs its own hosted zone or subdomain A record.

### Using Terraform/Other IaC

If you manage DNS outside CDK:

1. Disable HuginBot's Route53 integration (comment out `CUSTOM_URL`)
2. Create A record manually or via your IaC tool
3. Point it to instance public IP
4. Update manually after each server restart

Not recommended - automation is better!

### Custom TTL

Default TTL is 60 seconds for fast updates. To change:

Edit [lib/lambdas/update-route53.ts](../lib/lambdas/update-route53.ts):
```typescript
TTL: 300, // 5 minutes instead of 60 seconds
```

**Trade-off:** Longer TTL = slower updates when IP changes

## Security Considerations

- ✅ DNS records are public (this is normal and expected)
- ✅ Server password still required to connect
- ✅ No additional security risks vs join codes
- ✅ Lambda uses least-privilege IAM permissions
- ⚠️ Anyone can see your server IP via DNS lookup (same as join codes)

## Disabling Custom Domain

To go back to join codes:

1. **Remove from .env**
   ```bash
   # Comment out or delete
   # CUSTOM_URL=valheim.yourdomain.com
   ```

2. **Redeploy**
   ```bash
   npm run deploy
   ```

3. **Optional: Clean up Route53**
   - Delete A record for subdomain (if you want)
   - Keep hosted zone if you might use it again

## Related Documentation

- [AWS Setup Guide](./aws-setup.md)
- [Troubleshooting Guide](./troubleshooting.md)
- [Route 53 Pricing](https://aws.amazon.com/route53/pricing/)
- [Route 53 Documentation](https://docs.aws.amazon.com/route53/)

## Need Help?

- Check [Troubleshooting Guide](./troubleshooting.md)
- Review Lambda logs: `/aws/lambda/ValheimStack-Route53UpdateFunction`
- Create an issue on GitHub
