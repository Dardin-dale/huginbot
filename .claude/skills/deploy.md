# /deploy - Deploy HuginBot to AWS

Deploy the HuginBot infrastructure to AWS. This runs the full deployment workflow.

## Steps

1. First, run the tests to make sure nothing is broken:
   ```bash
   npm run test
   ```

2. If tests pass, build the project:
   ```bash
   npm run build
   ```

3. If build succeeds, deploy to AWS:
   ```bash
   source .env && npm run cdk -- deploy ValheimStack --require-approval never
   ```

4. Report the deployment results including:
   - Instance ID
   - API endpoint
   - Any errors encountered

## Notes

- Always run tests before deploying
- The `.env` file must be sourced for deployment to work
- If deployment fails due to volume attachment, the VolumeManagerFunction should handle it automatically
- After deployment, scripts are automatically uploaded to S3
