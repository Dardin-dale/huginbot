# /test - Run Tests

Run the HuginBot test suite.

## Run All Tests

```bash
npm run test
```

## Run Specific Test File

```bash
npm run test -- test/lambdas/status.test.ts
```

## Run Tests in Watch Mode

```bash
npm run test -- test/lambdas/status.test.ts --watch
```

## Important Test Files

- `test/lambdas/status.test.ts` - Discord status command tests
- `test/lambdas/startstop.test.ts` - Server start/stop command tests

## Notes

- Always run tests before committing changes
- Discord authentication tests are particularly important
- Tests use mock implementations for AWS services
- If tests fail, fix them before deploying
