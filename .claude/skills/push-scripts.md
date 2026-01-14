# /push-scripts - Push Script Updates to Running Server

Push updated scripts to a running Valheim server without redeploying.

## When to Use

Use this after making changes to scripts in `scripts/valheim/` when the server is already running and you don't want to do a full redeploy.

## Steps

1. Upload the changed scripts to S3:
   ```bash
   # Upload all scripts
   aws s3 sync scripts/valheim/ s3://$(aws cloudformation describe-stacks --stack-name ValheimStack --query 'Stacks[0].Outputs[?OutputKey==`BackupBucketName`].OutputValue' --output text)/scripts/valheim/
   ```

2. Trigger the script update on the running server:
   ```bash
   npm run cli -- server update-scripts --restart
   ```

3. Monitor the server to confirm it restarted successfully.

## Alternative: Upload specific script

If you only changed one script:
```bash
aws s3 cp scripts/valheim/switch-valheim-world.sh s3://BUCKET_NAME/scripts/valheim/switch-valheim-world.sh
```

## Notes

- The `--restart` flag restarts the Valheim server to apply the new scripts
- Without `--restart`, scripts are updated but won't take effect until the server restarts
- Players will be disconnected during restart
