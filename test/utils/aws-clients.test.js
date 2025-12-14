"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const aws_clients_1 = require("../../lib/lambdas/utils/aws-clients");
describe('AWS Clients Utilities', () => {
    describe('getStatusMessage', () => {
        test('returns correct message for running status', () => {
            expect((0, aws_clients_1.getStatusMessage)('running')).toBe('Server is online and ready to play!');
        });
        test('returns correct message for pending status', () => {
            expect((0, aws_clients_1.getStatusMessage)('pending')).toBe('Server is starting up. Please wait a few minutes.');
        });
        test('returns correct message for stopping status', () => {
            expect((0, aws_clients_1.getStatusMessage)('stopping')).toBe('Server is shutting down.');
        });
        test('returns correct message for stopped status', () => {
            expect((0, aws_clients_1.getStatusMessage)('stopped')).toBe('Server is offline. Use the start command to launch it.');
        });
        test('returns generic message for unknown status', () => {
            expect((0, aws_clients_1.getStatusMessage)('unknown')).toBe('Server status: unknown');
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXdzLWNsaWVudHMudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImF3cy1jbGllbnRzLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSxxRUFBdUU7QUFFdkUsUUFBUSxDQUFDLHVCQUF1QixFQUFFLEdBQUcsRUFBRTtJQUNyQyxRQUFRLENBQUMsa0JBQWtCLEVBQUUsR0FBRyxFQUFFO1FBQ2hDLElBQUksQ0FBQyw0Q0FBNEMsRUFBRSxHQUFHLEVBQUU7WUFDdEQsTUFBTSxDQUFDLElBQUEsOEJBQWdCLEVBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMscUNBQXFDLENBQUMsQ0FBQztRQUNsRixDQUFDLENBQUMsQ0FBQztRQUVILElBQUksQ0FBQyw0Q0FBNEMsRUFBRSxHQUFHLEVBQUU7WUFDdEQsTUFBTSxDQUFDLElBQUEsOEJBQWdCLEVBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsbURBQW1ELENBQUMsQ0FBQztRQUNoRyxDQUFDLENBQUMsQ0FBQztRQUVILElBQUksQ0FBQyw2Q0FBNkMsRUFBRSxHQUFHLEVBQUU7WUFDdkQsTUFBTSxDQUFDLElBQUEsOEJBQWdCLEVBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsMEJBQTBCLENBQUMsQ0FBQztRQUN4RSxDQUFDLENBQUMsQ0FBQztRQUVILElBQUksQ0FBQyw0Q0FBNEMsRUFBRSxHQUFHLEVBQUU7WUFDdEQsTUFBTSxDQUFDLElBQUEsOEJBQWdCLEVBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsd0RBQXdELENBQUMsQ0FBQztRQUNyRyxDQUFDLENBQUMsQ0FBQztRQUVILElBQUksQ0FBQyw0Q0FBNEMsRUFBRSxHQUFHLEVBQUU7WUFDdEQsTUFBTSxDQUFDLElBQUEsOEJBQWdCLEVBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsd0JBQXdCLENBQUMsQ0FBQztRQUNyRSxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBnZXRTdGF0dXNNZXNzYWdlIH0gZnJvbSAnLi4vLi4vbGliL2xhbWJkYXMvdXRpbHMvYXdzLWNsaWVudHMnO1xuXG5kZXNjcmliZSgnQVdTIENsaWVudHMgVXRpbGl0aWVzJywgKCkgPT4ge1xuICBkZXNjcmliZSgnZ2V0U3RhdHVzTWVzc2FnZScsICgpID0+IHtcbiAgICB0ZXN0KCdyZXR1cm5zIGNvcnJlY3QgbWVzc2FnZSBmb3IgcnVubmluZyBzdGF0dXMnLCAoKSA9PiB7XG4gICAgICBleHBlY3QoZ2V0U3RhdHVzTWVzc2FnZSgncnVubmluZycpKS50b0JlKCdTZXJ2ZXIgaXMgb25saW5lIGFuZCByZWFkeSB0byBwbGF5IScpO1xuICAgIH0pO1xuXG4gICAgdGVzdCgncmV0dXJucyBjb3JyZWN0IG1lc3NhZ2UgZm9yIHBlbmRpbmcgc3RhdHVzJywgKCkgPT4ge1xuICAgICAgZXhwZWN0KGdldFN0YXR1c01lc3NhZ2UoJ3BlbmRpbmcnKSkudG9CZSgnU2VydmVyIGlzIHN0YXJ0aW5nIHVwLiBQbGVhc2Ugd2FpdCBhIGZldyBtaW51dGVzLicpO1xuICAgIH0pO1xuXG4gICAgdGVzdCgncmV0dXJucyBjb3JyZWN0IG1lc3NhZ2UgZm9yIHN0b3BwaW5nIHN0YXR1cycsICgpID0+IHtcbiAgICAgIGV4cGVjdChnZXRTdGF0dXNNZXNzYWdlKCdzdG9wcGluZycpKS50b0JlKCdTZXJ2ZXIgaXMgc2h1dHRpbmcgZG93bi4nKTtcbiAgICB9KTtcblxuICAgIHRlc3QoJ3JldHVybnMgY29ycmVjdCBtZXNzYWdlIGZvciBzdG9wcGVkIHN0YXR1cycsICgpID0+IHtcbiAgICAgIGV4cGVjdChnZXRTdGF0dXNNZXNzYWdlKCdzdG9wcGVkJykpLnRvQmUoJ1NlcnZlciBpcyBvZmZsaW5lLiBVc2UgdGhlIHN0YXJ0IGNvbW1hbmQgdG8gbGF1bmNoIGl0LicpO1xuICAgIH0pO1xuXG4gICAgdGVzdCgncmV0dXJucyBnZW5lcmljIG1lc3NhZ2UgZm9yIHVua25vd24gc3RhdHVzJywgKCkgPT4ge1xuICAgICAgZXhwZWN0KGdldFN0YXR1c01lc3NhZ2UoJ3Vua25vd24nKSkudG9CZSgnU2VydmVyIHN0YXR1czogdW5rbm93bicpO1xuICAgIH0pO1xuICB9KTtcbn0pOyJdfQ==