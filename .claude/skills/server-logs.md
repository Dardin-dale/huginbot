# /server-logs - Check Server Logs and Status

Check the Valheim server logs and status on the running EC2 instance.

## Steps

1. First, get the instance ID:
   ```bash
   INSTANCE_ID=$(aws cloudformation describe-stacks --stack-name ValheimStack --query 'Stacks[0].Outputs[?OutputKey==`InstanceId`].OutputValue' --output text)
   echo "Instance ID: $INSTANCE_ID"
   ```

2. Check instance status:
   ```bash
   aws ec2 describe-instances --instance-ids $INSTANCE_ID --query 'Reservations[0].Instances[0].[State.Name,PublicIpAddress]' --output text
   ```

3. If running, check Docker container logs via SSM:
   ```bash
   aws ssm send-command --instance-ids "$INSTANCE_ID" --document-name "AWS-RunShellScript" --parameters 'commands=["docker logs valheim-server --tail 50"]' --query 'Command.CommandId' --output text
   ```

4. Get the command output (replace COMMAND_ID):
   ```bash
   sleep 5 && aws ssm get-command-invocation --command-id "COMMAND_ID" --instance-id "$INSTANCE_ID" --query 'StandardOutputContent' --output text
   ```

## Quick Status Check

For a quick status check:
```bash
npm run cli -- server status
```

## Common Log Checks

- **Server config**: `cat /mnt/valheim-data/config/server_config.txt`
- **Systemd service**: `journalctl -u valheim-server.service -n 50`
- **Docker inspect**: `docker inspect valheim-server --format="{{range .Config.Env}}{{println .}}{{end}}"`
