"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const auth_1 = require("../../lib/lambdas/utils/auth");
// Create simple test for utility functions only (working around module mocking issues)
describe('Auth Response Utilities', () => {
    describe('getUnauthorizedResponse', () => {
        test('returns 401 response with correct message', () => {
            const response = (0, auth_1.getUnauthorizedResponse)();
            expect(response.statusCode).toBe(401);
            expect(JSON.parse(response.body).message).toBe('Unauthorized');
        });
    });
    describe('getMissingConfigResponse', () => {
        test('returns 500 response with correct message', () => {
            const response = (0, auth_1.getMissingConfigResponse)('instance ID');
            expect(response.statusCode).toBe(500);
            expect(JSON.parse(response.body).message).toBe('Server configuration error: Missing instance ID');
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXV0aC50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYXV0aC50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsdURBR3NDO0FBRXRDLHVGQUF1RjtBQUN2RixRQUFRLENBQUMseUJBQXlCLEVBQUUsR0FBRyxFQUFFO0lBQ3ZDLFFBQVEsQ0FBQyx5QkFBeUIsRUFBRSxHQUFHLEVBQUU7UUFDdkMsSUFBSSxDQUFDLDJDQUEyQyxFQUFFLEdBQUcsRUFBRTtZQUNyRCxNQUFNLFFBQVEsR0FBRyxJQUFBLDhCQUF1QixHQUFFLENBQUM7WUFDM0MsTUFBTSxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDdEMsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsQ0FBQztRQUNqRSxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0lBRUgsUUFBUSxDQUFDLDBCQUEwQixFQUFFLEdBQUcsRUFBRTtRQUN4QyxJQUFJLENBQUMsMkNBQTJDLEVBQUUsR0FBRyxFQUFFO1lBQ3JELE1BQU0sUUFBUSxHQUFHLElBQUEsK0JBQXdCLEVBQUMsYUFBYSxDQUFDLENBQUM7WUFDekQsTUFBTSxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDdEMsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLElBQUksQ0FBQyxpREFBaUQsQ0FBQyxDQUFDO1FBQ3BHLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFxuICBnZXRVbmF1dGhvcml6ZWRSZXNwb25zZSxcbiAgZ2V0TWlzc2luZ0NvbmZpZ1Jlc3BvbnNlIFxufSBmcm9tICcuLi8uLi9saWIvbGFtYmRhcy91dGlscy9hdXRoJztcblxuLy8gQ3JlYXRlIHNpbXBsZSB0ZXN0IGZvciB1dGlsaXR5IGZ1bmN0aW9ucyBvbmx5ICh3b3JraW5nIGFyb3VuZCBtb2R1bGUgbW9ja2luZyBpc3N1ZXMpXG5kZXNjcmliZSgnQXV0aCBSZXNwb25zZSBVdGlsaXRpZXMnLCAoKSA9PiB7XG4gIGRlc2NyaWJlKCdnZXRVbmF1dGhvcml6ZWRSZXNwb25zZScsICgpID0+IHtcbiAgICB0ZXN0KCdyZXR1cm5zIDQwMSByZXNwb25zZSB3aXRoIGNvcnJlY3QgbWVzc2FnZScsICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gZ2V0VW5hdXRob3JpemVkUmVzcG9uc2UoKTtcbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDQwMSk7XG4gICAgICBleHBlY3QoSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KS5tZXNzYWdlKS50b0JlKCdVbmF1dGhvcml6ZWQnKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ2dldE1pc3NpbmdDb25maWdSZXNwb25zZScsICgpID0+IHtcbiAgICB0ZXN0KCdyZXR1cm5zIDUwMCByZXNwb25zZSB3aXRoIGNvcnJlY3QgbWVzc2FnZScsICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gZ2V0TWlzc2luZ0NvbmZpZ1Jlc3BvbnNlKCdpbnN0YW5jZSBJRCcpO1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoNTAwKTtcbiAgICAgIGV4cGVjdChKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpLm1lc3NhZ2UpLnRvQmUoJ1NlcnZlciBjb25maWd1cmF0aW9uIGVycm9yOiBNaXNzaW5nIGluc3RhbmNlIElEJyk7XG4gICAgfSk7XG4gIH0pO1xufSk7Il19