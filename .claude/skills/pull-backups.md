# /pull-backups - Download Valheim World Backups for Safekeeping

Download world backups from the S3 backup bucket to the local machine. By
default this pulls the **latest backup per world** into `./backups/<world>/`.

## Resolve the backup bucket

The bucket name is stored in SSM (and as a CloudFormation stack output):

```bash
BUCKET=$(aws ssm get-parameter --name /huginbot/backup-bucket-name \
  --query 'Parameter.Value' --output text)
# Fallback if the SSM param is missing:
# BUCKET=$(aws cloudformation describe-stacks --stack-name ValheimStack \
#   --query 'Stacks[0].Outputs[?OutputKey==`BackupBucketName`].OutputValue' --output text)
echo "Bucket: $BUCKET"
```

Backups are laid out as `worlds/<WorldName>/valheim_backup_<timestamp>.tar.gz`.

## Pull the latest backup per world (default)

```bash
DEST=./backups
for PREFIX in $(aws s3api list-objects-v2 --bucket "$BUCKET" --prefix worlds/ \
    --delimiter / --query 'CommonPrefixes[].Prefix' --output text); do
  WORLD=$(basename "$PREFIX")
  KEY=$(aws s3api list-objects-v2 --bucket "$BUCKET" --prefix "$PREFIX" \
    --query 'sort_by(Contents,&LastModified)[-1].Key' --output text)
  mkdir -p "$DEST/$WORLD"
  echo "Downloading $KEY -> $DEST/$WORLD/"
  aws s3 cp "s3://$BUCKET/$KEY" "$DEST/$WORLD/$(basename "$KEY")"
done
```

## Other options

- **Inspect what's available first:**
  ```bash
  npm run cli -- backup list
  ```
- **Pull a specific world's latest only:** set `PREFIX=worlds/<WorldName>/` and run
  the single-world body of the loop above.
- **Pull ALL backups (full mirror, idempotent — skips already-synced files):**
  ```bash
  npm run cli -- backup sync --direction pull          # all worlds
  npm run cli -- backup sync --direction pull --world <WorldName>
  ```
- **Interactively pick one backup to download:**
  ```bash
  npm run cli -- backup download
  ```

## Notes

- Latest backups are ~250–290 MB each; downloads take a moment.
- The local `./backups/<world>/` layout matches what `backup sync`/`backup upload`
  expect, so pulled files can be re-uploaded or restored later.
- This is read-only against S3 — it never deletes or overwrites remote backups.
