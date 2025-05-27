"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const world_config_1 = require("../../lib/lambdas/utils/world-config");
describe('World Config Utilities', () => {
    // Original parseWorldConfigs tests
    describe('parseWorldConfigs', () => {
        test('parses multiple world configs correctly', () => {
            const configString = 'World1,123456,ValheimWorld1,password1;World2,234567,ValheimWorld2,password2';
            const configs = (0, world_config_1.parseWorldConfigs)(configString);
            expect(configs).toHaveLength(2);
            expect(configs[0]).toEqual({
                name: 'World1',
                discordServerId: '123456',
                worldName: 'ValheimWorld1',
                serverPassword: 'password1'
            });
            expect(configs[1]).toEqual({
                name: 'World2',
                discordServerId: '234567',
                worldName: 'ValheimWorld2',
                serverPassword: 'password2'
            });
        });
        test('returns empty array for empty string', () => {
            expect((0, world_config_1.parseWorldConfigs)('')).toEqual([]);
        });
        test('returns empty array for undefined input', () => {
            // @ts-ignore - testing undefined input
            expect((0, world_config_1.parseWorldConfigs)(undefined)).toEqual([]);
        });
        test('should filter out invalid configurations', () => {
            // Two valid configs and one invalid (using new validation)
            const configString = 'World1,123456,ValidWorld,password123;InvalidWorld,654321,Invalid-World,pass;World3,789012,AnotherValid,password789';
            const result = (0, world_config_1.parseWorldConfigs)(configString);
            // Should only have the valid configurations
            expect(result.length).toBeLessThan(3);
        });
        test('should trim whitespace from values', () => {
            const configString = ' World1 , 123456 , ValidWorld , password123 ';
            const result = (0, world_config_1.parseWorldConfigs)(configString);
            expect(result.length).toBeGreaterThan(0);
            expect(result[0].name).toBe('World1');
            expect(result[0].worldName).toBe('ValidWorld');
        });
    });
    // New tests for validateWorldConfig function
    describe('validateWorldConfig', () => {
        test('should return no errors for valid config', () => {
            const validConfig = {
                name: 'Test World',
                discordServerId: '12345678901234567',
                worldName: 'TestWorld',
                serverPassword: 'password123'
            };
            const errors = (0, world_config_1.validateWorldConfig)(validConfig);
            expect(errors).toHaveLength(0);
        });
        test('should validate name field', () => {
            // Empty name
            let config = {
                name: '',
                discordServerId: '123456789',
                worldName: 'TestWorld',
                serverPassword: 'password123'
            };
            let errors = (0, world_config_1.validateWorldConfig)(config);
            expect(errors.some(e => e.includes('name'))).toBeTruthy();
            // Too short
            config.name = 'AB';
            errors = (0, world_config_1.validateWorldConfig)(config);
            expect(errors.some(e => e.includes('name'))).toBeTruthy();
        });
        test('should validate worldName field', () => {
            // Empty world name
            let config = {
                name: 'Valid Name',
                discordServerId: '123456789',
                worldName: '',
                serverPassword: 'password123'
            };
            let errors = (0, world_config_1.validateWorldConfig)(config);
            expect(errors.some(e => e.includes('world name'))).toBeTruthy();
            // Invalid characters
            config.worldName = 'Invalid-Characters!';
            errors = (0, world_config_1.validateWorldConfig)(config);
            expect(errors.some(e => e.includes('letters, numbers, and underscores'))).toBeTruthy();
        });
        test('should validate serverPassword field', () => {
            // Empty password
            let config = {
                name: 'Valid Name',
                discordServerId: '123456789',
                worldName: 'ValidWorld',
                serverPassword: ''
            };
            let errors = (0, world_config_1.validateWorldConfig)(config);
            expect(errors.some(e => e.includes('password'))).toBeTruthy();
            // Too short
            config.serverPassword = 'pass';
            errors = (0, world_config_1.validateWorldConfig)(config);
            expect(errors.some(e => e.includes('password'))).toBeTruthy();
        });
        test('should validate discordServerId field', () => {
            // Invalid Discord ID (non-numeric)
            let config = {
                name: 'Valid Name',
                discordServerId: 'not-a-number',
                worldName: 'ValidWorld',
                serverPassword: 'password123'
            };
            let errors = (0, world_config_1.validateWorldConfig)(config);
            expect(errors.some(e => e.includes('Discord'))).toBeTruthy();
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid29ybGQtY29uZmlnLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJ3b3JsZC1jb25maWcudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLHVFQUEyRztBQUUzRyxRQUFRLENBQUMsd0JBQXdCLEVBQUUsR0FBRyxFQUFFO0lBQ3RDLG1DQUFtQztJQUNuQyxRQUFRLENBQUMsbUJBQW1CLEVBQUUsR0FBRyxFQUFFO1FBQ2pDLElBQUksQ0FBQyx5Q0FBeUMsRUFBRSxHQUFHLEVBQUU7WUFDbkQsTUFBTSxZQUFZLEdBQUcsNkVBQTZFLENBQUM7WUFDbkcsTUFBTSxPQUFPLEdBQUcsSUFBQSxnQ0FBaUIsRUFBQyxZQUFZLENBQUMsQ0FBQztZQUVoRCxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ2hDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUM7Z0JBQ3pCLElBQUksRUFBRSxRQUFRO2dCQUNkLGVBQWUsRUFBRSxRQUFRO2dCQUN6QixTQUFTLEVBQUUsZUFBZTtnQkFDMUIsY0FBYyxFQUFFLFdBQVc7YUFDNUIsQ0FBQyxDQUFDO1lBQ0gsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQztnQkFDekIsSUFBSSxFQUFFLFFBQVE7Z0JBQ2QsZUFBZSxFQUFFLFFBQVE7Z0JBQ3pCLFNBQVMsRUFBRSxlQUFlO2dCQUMxQixjQUFjLEVBQUUsV0FBVzthQUM1QixDQUFDLENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztRQUVILElBQUksQ0FBQyxzQ0FBc0MsRUFBRSxHQUFHLEVBQUU7WUFDaEQsTUFBTSxDQUFDLElBQUEsZ0NBQWlCLEVBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUM7UUFDNUMsQ0FBQyxDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMseUNBQXlDLEVBQUUsR0FBRyxFQUFFO1lBQ25ELHVDQUF1QztZQUN2QyxNQUFNLENBQUMsSUFBQSxnQ0FBaUIsRUFBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsQ0FBQztRQUNuRCxDQUFDLENBQUMsQ0FBQztRQUVILElBQUksQ0FBQywwQ0FBMEMsRUFBRSxHQUFHLEVBQUU7WUFDcEQsMkRBQTJEO1lBQzNELE1BQU0sWUFBWSxHQUFHLG9IQUFvSCxDQUFDO1lBQzFJLE1BQU0sTUFBTSxHQUFHLElBQUEsZ0NBQWlCLEVBQUMsWUFBWSxDQUFDLENBQUM7WUFFL0MsNENBQTRDO1lBQzVDLE1BQU0sQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ3hDLENBQUMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxDQUFDLG9DQUFvQyxFQUFFLEdBQUcsRUFBRTtZQUM5QyxNQUFNLFlBQVksR0FBRyw4Q0FBOEMsQ0FBQztZQUNwRSxNQUFNLE1BQU0sR0FBRyxJQUFBLGdDQUFpQixFQUFDLFlBQVksQ0FBQyxDQUFDO1lBRS9DLE1BQU0sQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsZUFBZSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ3pDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1lBQ3RDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDO1FBQ2pELENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCw2Q0FBNkM7SUFDN0MsUUFBUSxDQUFDLHFCQUFxQixFQUFFLEdBQUcsRUFBRTtRQUNuQyxJQUFJLENBQUMsMENBQTBDLEVBQUUsR0FBRyxFQUFFO1lBQ3BELE1BQU0sV0FBVyxHQUFnQjtnQkFDL0IsSUFBSSxFQUFFLFlBQVk7Z0JBQ2xCLGVBQWUsRUFBRSxtQkFBbUI7Z0JBQ3BDLFNBQVMsRUFBRSxXQUFXO2dCQUN0QixjQUFjLEVBQUUsYUFBYTthQUM5QixDQUFDO1lBRUYsTUFBTSxNQUFNLEdBQUcsSUFBQSxrQ0FBbUIsRUFBQyxXQUFXLENBQUMsQ0FBQztZQUNoRCxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ2pDLENBQUMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxDQUFDLDRCQUE0QixFQUFFLEdBQUcsRUFBRTtZQUN0QyxhQUFhO1lBQ2IsSUFBSSxNQUFNLEdBQWdCO2dCQUN4QixJQUFJLEVBQUUsRUFBRTtnQkFDUixlQUFlLEVBQUUsV0FBVztnQkFDNUIsU0FBUyxFQUFFLFdBQVc7Z0JBQ3RCLGNBQWMsRUFBRSxhQUFhO2FBQzlCLENBQUM7WUFFRixJQUFJLE1BQU0sR0FBRyxJQUFBLGtDQUFtQixFQUFDLE1BQU0sQ0FBQyxDQUFDO1lBQ3pDLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsVUFBVSxFQUFFLENBQUM7WUFFMUQsWUFBWTtZQUNaLE1BQU0sQ0FBQyxJQUFJLEdBQUcsSUFBSSxDQUFDO1lBQ25CLE1BQU0sR0FBRyxJQUFBLGtDQUFtQixFQUFDLE1BQU0sQ0FBQyxDQUFDO1lBQ3JDLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsVUFBVSxFQUFFLENBQUM7UUFDNUQsQ0FBQyxDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMsaUNBQWlDLEVBQUUsR0FBRyxFQUFFO1lBQzNDLG1CQUFtQjtZQUNuQixJQUFJLE1BQU0sR0FBZ0I7Z0JBQ3hCLElBQUksRUFBRSxZQUFZO2dCQUNsQixlQUFlLEVBQUUsV0FBVztnQkFDNUIsU0FBUyxFQUFFLEVBQUU7Z0JBQ2IsY0FBYyxFQUFFLGFBQWE7YUFDOUIsQ0FBQztZQUVGLElBQUksTUFBTSxHQUFHLElBQUEsa0NBQW1CLEVBQUMsTUFBTSxDQUFDLENBQUM7WUFDekMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUVoRSxxQkFBcUI7WUFDckIsTUFBTSxDQUFDLFNBQVMsR0FBRyxxQkFBcUIsQ0FBQztZQUN6QyxNQUFNLEdBQUcsSUFBQSxrQ0FBbUIsRUFBQyxNQUFNLENBQUMsQ0FBQztZQUNyQyxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsbUNBQW1DLENBQUMsQ0FBQyxDQUFDLENBQUMsVUFBVSxFQUFFLENBQUM7UUFDekYsQ0FBQyxDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMsc0NBQXNDLEVBQUUsR0FBRyxFQUFFO1lBQ2hELGlCQUFpQjtZQUNqQixJQUFJLE1BQU0sR0FBZ0I7Z0JBQ3hCLElBQUksRUFBRSxZQUFZO2dCQUNsQixlQUFlLEVBQUUsV0FBVztnQkFDNUIsU0FBUyxFQUFFLFlBQVk7Z0JBQ3ZCLGNBQWMsRUFBRSxFQUFFO2FBQ25CLENBQUM7WUFFRixJQUFJLE1BQU0sR0FBRyxJQUFBLGtDQUFtQixFQUFDLE1BQU0sQ0FBQyxDQUFDO1lBQ3pDLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsVUFBVSxFQUFFLENBQUM7WUFFOUQsWUFBWTtZQUNaLE1BQU0sQ0FBQyxjQUFjLEdBQUcsTUFBTSxDQUFDO1lBQy9CLE1BQU0sR0FBRyxJQUFBLGtDQUFtQixFQUFDLE1BQU0sQ0FBQyxDQUFDO1lBQ3JDLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsVUFBVSxFQUFFLENBQUM7UUFDaEUsQ0FBQyxDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMsdUNBQXVDLEVBQUUsR0FBRyxFQUFFO1lBQ2pELG1DQUFtQztZQUNuQyxJQUFJLE1BQU0sR0FBZ0I7Z0JBQ3hCLElBQUksRUFBRSxZQUFZO2dCQUNsQixlQUFlLEVBQUUsY0FBYztnQkFDL0IsU0FBUyxFQUFFLFlBQVk7Z0JBQ3ZCLGNBQWMsRUFBRSxhQUFhO2FBQzlCLENBQUM7WUFFRixJQUFJLE1BQU0sR0FBRyxJQUFBLGtDQUFtQixFQUFDLE1BQU0sQ0FBQyxDQUFDO1lBQ3pDLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsVUFBVSxFQUFFLENBQUM7UUFDL0QsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgcGFyc2VXb3JsZENvbmZpZ3MsIHZhbGlkYXRlV29ybGRDb25maWcsIFdvcmxkQ29uZmlnIH0gZnJvbSAnLi4vLi4vbGliL2xhbWJkYXMvdXRpbHMvd29ybGQtY29uZmlnJztcblxuZGVzY3JpYmUoJ1dvcmxkIENvbmZpZyBVdGlsaXRpZXMnLCAoKSA9PiB7XG4gIC8vIE9yaWdpbmFsIHBhcnNlV29ybGRDb25maWdzIHRlc3RzXG4gIGRlc2NyaWJlKCdwYXJzZVdvcmxkQ29uZmlncycsICgpID0+IHtcbiAgICB0ZXN0KCdwYXJzZXMgbXVsdGlwbGUgd29ybGQgY29uZmlncyBjb3JyZWN0bHknLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWdTdHJpbmcgPSAnV29ybGQxLDEyMzQ1NixWYWxoZWltV29ybGQxLHBhc3N3b3JkMTtXb3JsZDIsMjM0NTY3LFZhbGhlaW1Xb3JsZDIscGFzc3dvcmQyJztcbiAgICAgIGNvbnN0IGNvbmZpZ3MgPSBwYXJzZVdvcmxkQ29uZmlncyhjb25maWdTdHJpbmcpO1xuICAgICAgXG4gICAgICBleHBlY3QoY29uZmlncykudG9IYXZlTGVuZ3RoKDIpO1xuICAgICAgZXhwZWN0KGNvbmZpZ3NbMF0pLnRvRXF1YWwoe1xuICAgICAgICBuYW1lOiAnV29ybGQxJyxcbiAgICAgICAgZGlzY29yZFNlcnZlcklkOiAnMTIzNDU2JyxcbiAgICAgICAgd29ybGROYW1lOiAnVmFsaGVpbVdvcmxkMScsXG4gICAgICAgIHNlcnZlclBhc3N3b3JkOiAncGFzc3dvcmQxJ1xuICAgICAgfSk7XG4gICAgICBleHBlY3QoY29uZmlnc1sxXSkudG9FcXVhbCh7XG4gICAgICAgIG5hbWU6ICdXb3JsZDInLFxuICAgICAgICBkaXNjb3JkU2VydmVySWQ6ICcyMzQ1NjcnLFxuICAgICAgICB3b3JsZE5hbWU6ICdWYWxoZWltV29ybGQyJyxcbiAgICAgICAgc2VydmVyUGFzc3dvcmQ6ICdwYXNzd29yZDInXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIHRlc3QoJ3JldHVybnMgZW1wdHkgYXJyYXkgZm9yIGVtcHR5IHN0cmluZycsICgpID0+IHtcbiAgICAgIGV4cGVjdChwYXJzZVdvcmxkQ29uZmlncygnJykpLnRvRXF1YWwoW10pO1xuICAgIH0pO1xuXG4gICAgdGVzdCgncmV0dXJucyBlbXB0eSBhcnJheSBmb3IgdW5kZWZpbmVkIGlucHV0JywgKCkgPT4ge1xuICAgICAgLy8gQHRzLWlnbm9yZSAtIHRlc3RpbmcgdW5kZWZpbmVkIGlucHV0XG4gICAgICBleHBlY3QocGFyc2VXb3JsZENvbmZpZ3ModW5kZWZpbmVkKSkudG9FcXVhbChbXSk7XG4gICAgfSk7XG4gICAgXG4gICAgdGVzdCgnc2hvdWxkIGZpbHRlciBvdXQgaW52YWxpZCBjb25maWd1cmF0aW9ucycsICgpID0+IHtcbiAgICAgIC8vIFR3byB2YWxpZCBjb25maWdzIGFuZCBvbmUgaW52YWxpZCAodXNpbmcgbmV3IHZhbGlkYXRpb24pXG4gICAgICBjb25zdCBjb25maWdTdHJpbmcgPSAnV29ybGQxLDEyMzQ1NixWYWxpZFdvcmxkLHBhc3N3b3JkMTIzO0ludmFsaWRXb3JsZCw2NTQzMjEsSW52YWxpZC1Xb3JsZCxwYXNzO1dvcmxkMyw3ODkwMTIsQW5vdGhlclZhbGlkLHBhc3N3b3JkNzg5JztcbiAgICAgIGNvbnN0IHJlc3VsdCA9IHBhcnNlV29ybGRDb25maWdzKGNvbmZpZ1N0cmluZyk7XG4gICAgICBcbiAgICAgIC8vIFNob3VsZCBvbmx5IGhhdmUgdGhlIHZhbGlkIGNvbmZpZ3VyYXRpb25zXG4gICAgICBleHBlY3QocmVzdWx0Lmxlbmd0aCkudG9CZUxlc3NUaGFuKDMpO1xuICAgIH0pO1xuICAgIFxuICAgIHRlc3QoJ3Nob3VsZCB0cmltIHdoaXRlc3BhY2UgZnJvbSB2YWx1ZXMnLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWdTdHJpbmcgPSAnIFdvcmxkMSAsIDEyMzQ1NiAsIFZhbGlkV29ybGQgLCBwYXNzd29yZDEyMyAnO1xuICAgICAgY29uc3QgcmVzdWx0ID0gcGFyc2VXb3JsZENvbmZpZ3MoY29uZmlnU3RyaW5nKTtcbiAgICAgIFxuICAgICAgZXhwZWN0KHJlc3VsdC5sZW5ndGgpLnRvQmVHcmVhdGVyVGhhbigwKTtcbiAgICAgIGV4cGVjdChyZXN1bHRbMF0ubmFtZSkudG9CZSgnV29ybGQxJyk7XG4gICAgICBleHBlY3QocmVzdWx0WzBdLndvcmxkTmFtZSkudG9CZSgnVmFsaWRXb3JsZCcpO1xuICAgIH0pO1xuICB9KTtcbiAgXG4gIC8vIE5ldyB0ZXN0cyBmb3IgdmFsaWRhdGVXb3JsZENvbmZpZyBmdW5jdGlvblxuICBkZXNjcmliZSgndmFsaWRhdGVXb3JsZENvbmZpZycsICgpID0+IHtcbiAgICB0ZXN0KCdzaG91bGQgcmV0dXJuIG5vIGVycm9ycyBmb3IgdmFsaWQgY29uZmlnJywgKCkgPT4ge1xuICAgICAgY29uc3QgdmFsaWRDb25maWc6IFdvcmxkQ29uZmlnID0ge1xuICAgICAgICBuYW1lOiAnVGVzdCBXb3JsZCcsXG4gICAgICAgIGRpc2NvcmRTZXJ2ZXJJZDogJzEyMzQ1Njc4OTAxMjM0NTY3JyxcbiAgICAgICAgd29ybGROYW1lOiAnVGVzdFdvcmxkJyxcbiAgICAgICAgc2VydmVyUGFzc3dvcmQ6ICdwYXNzd29yZDEyMydcbiAgICAgIH07XG4gICAgICBcbiAgICAgIGNvbnN0IGVycm9ycyA9IHZhbGlkYXRlV29ybGRDb25maWcodmFsaWRDb25maWcpO1xuICAgICAgZXhwZWN0KGVycm9ycykudG9IYXZlTGVuZ3RoKDApO1xuICAgIH0pO1xuICAgIFxuICAgIHRlc3QoJ3Nob3VsZCB2YWxpZGF0ZSBuYW1lIGZpZWxkJywgKCkgPT4ge1xuICAgICAgLy8gRW1wdHkgbmFtZVxuICAgICAgbGV0IGNvbmZpZzogV29ybGRDb25maWcgPSB7XG4gICAgICAgIG5hbWU6ICcnLFxuICAgICAgICBkaXNjb3JkU2VydmVySWQ6ICcxMjM0NTY3ODknLFxuICAgICAgICB3b3JsZE5hbWU6ICdUZXN0V29ybGQnLFxuICAgICAgICBzZXJ2ZXJQYXNzd29yZDogJ3Bhc3N3b3JkMTIzJ1xuICAgICAgfTtcbiAgICAgIFxuICAgICAgbGV0IGVycm9ycyA9IHZhbGlkYXRlV29ybGRDb25maWcoY29uZmlnKTtcbiAgICAgIGV4cGVjdChlcnJvcnMuc29tZShlID0+IGUuaW5jbHVkZXMoJ25hbWUnKSkpLnRvQmVUcnV0aHkoKTtcbiAgICAgIFxuICAgICAgLy8gVG9vIHNob3J0XG4gICAgICBjb25maWcubmFtZSA9ICdBQic7XG4gICAgICBlcnJvcnMgPSB2YWxpZGF0ZVdvcmxkQ29uZmlnKGNvbmZpZyk7XG4gICAgICBleHBlY3QoZXJyb3JzLnNvbWUoZSA9PiBlLmluY2x1ZGVzKCduYW1lJykpKS50b0JlVHJ1dGh5KCk7XG4gICAgfSk7XG4gICAgXG4gICAgdGVzdCgnc2hvdWxkIHZhbGlkYXRlIHdvcmxkTmFtZSBmaWVsZCcsICgpID0+IHtcbiAgICAgIC8vIEVtcHR5IHdvcmxkIG5hbWVcbiAgICAgIGxldCBjb25maWc6IFdvcmxkQ29uZmlnID0ge1xuICAgICAgICBuYW1lOiAnVmFsaWQgTmFtZScsXG4gICAgICAgIGRpc2NvcmRTZXJ2ZXJJZDogJzEyMzQ1Njc4OScsXG4gICAgICAgIHdvcmxkTmFtZTogJycsXG4gICAgICAgIHNlcnZlclBhc3N3b3JkOiAncGFzc3dvcmQxMjMnXG4gICAgICB9O1xuICAgICAgXG4gICAgICBsZXQgZXJyb3JzID0gdmFsaWRhdGVXb3JsZENvbmZpZyhjb25maWcpO1xuICAgICAgZXhwZWN0KGVycm9ycy5zb21lKGUgPT4gZS5pbmNsdWRlcygnd29ybGQgbmFtZScpKSkudG9CZVRydXRoeSgpO1xuICAgICAgXG4gICAgICAvLyBJbnZhbGlkIGNoYXJhY3RlcnNcbiAgICAgIGNvbmZpZy53b3JsZE5hbWUgPSAnSW52YWxpZC1DaGFyYWN0ZXJzISc7XG4gICAgICBlcnJvcnMgPSB2YWxpZGF0ZVdvcmxkQ29uZmlnKGNvbmZpZyk7XG4gICAgICBleHBlY3QoZXJyb3JzLnNvbWUoZSA9PiBlLmluY2x1ZGVzKCdsZXR0ZXJzLCBudW1iZXJzLCBhbmQgdW5kZXJzY29yZXMnKSkpLnRvQmVUcnV0aHkoKTtcbiAgICB9KTtcbiAgICBcbiAgICB0ZXN0KCdzaG91bGQgdmFsaWRhdGUgc2VydmVyUGFzc3dvcmQgZmllbGQnLCAoKSA9PiB7XG4gICAgICAvLyBFbXB0eSBwYXNzd29yZFxuICAgICAgbGV0IGNvbmZpZzogV29ybGRDb25maWcgPSB7XG4gICAgICAgIG5hbWU6ICdWYWxpZCBOYW1lJyxcbiAgICAgICAgZGlzY29yZFNlcnZlcklkOiAnMTIzNDU2Nzg5JyxcbiAgICAgICAgd29ybGROYW1lOiAnVmFsaWRXb3JsZCcsXG4gICAgICAgIHNlcnZlclBhc3N3b3JkOiAnJ1xuICAgICAgfTtcbiAgICAgIFxuICAgICAgbGV0IGVycm9ycyA9IHZhbGlkYXRlV29ybGRDb25maWcoY29uZmlnKTtcbiAgICAgIGV4cGVjdChlcnJvcnMuc29tZShlID0+IGUuaW5jbHVkZXMoJ3Bhc3N3b3JkJykpKS50b0JlVHJ1dGh5KCk7XG4gICAgICBcbiAgICAgIC8vIFRvbyBzaG9ydFxuICAgICAgY29uZmlnLnNlcnZlclBhc3N3b3JkID0gJ3Bhc3MnO1xuICAgICAgZXJyb3JzID0gdmFsaWRhdGVXb3JsZENvbmZpZyhjb25maWcpO1xuICAgICAgZXhwZWN0KGVycm9ycy5zb21lKGUgPT4gZS5pbmNsdWRlcygncGFzc3dvcmQnKSkpLnRvQmVUcnV0aHkoKTtcbiAgICB9KTtcbiAgICBcbiAgICB0ZXN0KCdzaG91bGQgdmFsaWRhdGUgZGlzY29yZFNlcnZlcklkIGZpZWxkJywgKCkgPT4ge1xuICAgICAgLy8gSW52YWxpZCBEaXNjb3JkIElEIChub24tbnVtZXJpYylcbiAgICAgIGxldCBjb25maWc6IFdvcmxkQ29uZmlnID0ge1xuICAgICAgICBuYW1lOiAnVmFsaWQgTmFtZScsXG4gICAgICAgIGRpc2NvcmRTZXJ2ZXJJZDogJ25vdC1hLW51bWJlcicsXG4gICAgICAgIHdvcmxkTmFtZTogJ1ZhbGlkV29ybGQnLFxuICAgICAgICBzZXJ2ZXJQYXNzd29yZDogJ3Bhc3N3b3JkMTIzJ1xuICAgICAgfTtcbiAgICAgIFxuICAgICAgbGV0IGVycm9ycyA9IHZhbGlkYXRlV29ybGRDb25maWcoY29uZmlnKTtcbiAgICAgIGV4cGVjdChlcnJvcnMuc29tZShlID0+IGUuaW5jbHVkZXMoJ0Rpc2NvcmQnKSkpLnRvQmVUcnV0aHkoKTtcbiAgICB9KTtcbiAgfSk7XG59KTsiXX0=