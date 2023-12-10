const AWS = require('aws-sdk');
const ecs = new AWS.ECS();

exports.handler = async (event) => {
  const worldName = event.worldName; // Passed as a parameter
  // Setup ECS task/service parameters
  const params = {
    // ... ECS task/service configuration ...
    // Use worldName and other configurations
  };

  try {
    const result = await ecs.runTask(params).promise(); // or createService
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify(error) };
  }
};
