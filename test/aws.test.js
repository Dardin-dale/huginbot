// test-aws.js
const { checkAwsCredentials } = require('./cli/utils/aws');

async function test() {
    console.log('Testing AWS credentials...');
    const result = await checkAwsCredentials();
    console.log('Result:', result);
}

test().catch(console.error);
