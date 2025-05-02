"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const world_config_1 = require("../../lib/lambdas/utils/world-config");
describe('World Config Utilities', () => {
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
        test('handles malformed input gracefully', () => {
            // Missing parts
            const configString = 'World1,123456';
            const configs = (0, world_config_1.parseWorldConfigs)(configString);
            expect(configs).toHaveLength(1);
            expect(configs[0]).toEqual({
                name: 'World1',
                discordServerId: '123456',
                worldName: undefined,
                serverPassword: undefined
            });
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid29ybGQtY29uZmlnLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJ3b3JsZC1jb25maWcudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLHVFQUF5RTtBQUV6RSxRQUFRLENBQUMsd0JBQXdCLEVBQUUsR0FBRyxFQUFFO0lBQ3RDLFFBQVEsQ0FBQyxtQkFBbUIsRUFBRSxHQUFHLEVBQUU7UUFDakMsSUFBSSxDQUFDLHlDQUF5QyxFQUFFLEdBQUcsRUFBRTtZQUNuRCxNQUFNLFlBQVksR0FBRyw2RUFBNkUsQ0FBQztZQUNuRyxNQUFNLE9BQU8sR0FBRyxJQUFBLGdDQUFpQixFQUFDLFlBQVksQ0FBQyxDQUFDO1lBRWhELE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDaEMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQztnQkFDekIsSUFBSSxFQUFFLFFBQVE7Z0JBQ2QsZUFBZSxFQUFFLFFBQVE7Z0JBQ3pCLFNBQVMsRUFBRSxlQUFlO2dCQUMxQixjQUFjLEVBQUUsV0FBVzthQUM1QixDQUFDLENBQUM7WUFDSCxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDO2dCQUN6QixJQUFJLEVBQUUsUUFBUTtnQkFDZCxlQUFlLEVBQUUsUUFBUTtnQkFDekIsU0FBUyxFQUFFLGVBQWU7Z0JBQzFCLGNBQWMsRUFBRSxXQUFXO2FBQzVCLENBQUMsQ0FBQztRQUNMLENBQUMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxDQUFDLHNDQUFzQyxFQUFFLEdBQUcsRUFBRTtZQUNoRCxNQUFNLENBQUMsSUFBQSxnQ0FBaUIsRUFBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsQ0FBQztRQUM1QyxDQUFDLENBQUMsQ0FBQztRQUVILElBQUksQ0FBQyx5Q0FBeUMsRUFBRSxHQUFHLEVBQUU7WUFDbkQsdUNBQXVDO1lBQ3ZDLE1BQU0sQ0FBQyxJQUFBLGdDQUFpQixFQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxDQUFDO1FBQ25ELENBQUMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxDQUFDLG9DQUFvQyxFQUFFLEdBQUcsRUFBRTtZQUM5QyxnQkFBZ0I7WUFDaEIsTUFBTSxZQUFZLEdBQUcsZUFBZSxDQUFDO1lBQ3JDLE1BQU0sT0FBTyxHQUFHLElBQUEsZ0NBQWlCLEVBQUMsWUFBWSxDQUFDLENBQUM7WUFFaEQsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUNoQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDO2dCQUN6QixJQUFJLEVBQUUsUUFBUTtnQkFDZCxlQUFlLEVBQUUsUUFBUTtnQkFDekIsU0FBUyxFQUFFLFNBQVM7Z0JBQ3BCLGNBQWMsRUFBRSxTQUFTO2FBQzFCLENBQUMsQ0FBQztRQUNMLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IHBhcnNlV29ybGRDb25maWdzIH0gZnJvbSAnLi4vLi4vbGliL2xhbWJkYXMvdXRpbHMvd29ybGQtY29uZmlnJztcblxuZGVzY3JpYmUoJ1dvcmxkIENvbmZpZyBVdGlsaXRpZXMnLCAoKSA9PiB7XG4gIGRlc2NyaWJlKCdwYXJzZVdvcmxkQ29uZmlncycsICgpID0+IHtcbiAgICB0ZXN0KCdwYXJzZXMgbXVsdGlwbGUgd29ybGQgY29uZmlncyBjb3JyZWN0bHknLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWdTdHJpbmcgPSAnV29ybGQxLDEyMzQ1NixWYWxoZWltV29ybGQxLHBhc3N3b3JkMTtXb3JsZDIsMjM0NTY3LFZhbGhlaW1Xb3JsZDIscGFzc3dvcmQyJztcbiAgICAgIGNvbnN0IGNvbmZpZ3MgPSBwYXJzZVdvcmxkQ29uZmlncyhjb25maWdTdHJpbmcpO1xuICAgICAgXG4gICAgICBleHBlY3QoY29uZmlncykudG9IYXZlTGVuZ3RoKDIpO1xuICAgICAgZXhwZWN0KGNvbmZpZ3NbMF0pLnRvRXF1YWwoe1xuICAgICAgICBuYW1lOiAnV29ybGQxJyxcbiAgICAgICAgZGlzY29yZFNlcnZlcklkOiAnMTIzNDU2JyxcbiAgICAgICAgd29ybGROYW1lOiAnVmFsaGVpbVdvcmxkMScsXG4gICAgICAgIHNlcnZlclBhc3N3b3JkOiAncGFzc3dvcmQxJ1xuICAgICAgfSk7XG4gICAgICBleHBlY3QoY29uZmlnc1sxXSkudG9FcXVhbCh7XG4gICAgICAgIG5hbWU6ICdXb3JsZDInLFxuICAgICAgICBkaXNjb3JkU2VydmVySWQ6ICcyMzQ1NjcnLFxuICAgICAgICB3b3JsZE5hbWU6ICdWYWxoZWltV29ybGQyJyxcbiAgICAgICAgc2VydmVyUGFzc3dvcmQ6ICdwYXNzd29yZDInXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIHRlc3QoJ3JldHVybnMgZW1wdHkgYXJyYXkgZm9yIGVtcHR5IHN0cmluZycsICgpID0+IHtcbiAgICAgIGV4cGVjdChwYXJzZVdvcmxkQ29uZmlncygnJykpLnRvRXF1YWwoW10pO1xuICAgIH0pO1xuXG4gICAgdGVzdCgncmV0dXJucyBlbXB0eSBhcnJheSBmb3IgdW5kZWZpbmVkIGlucHV0JywgKCkgPT4ge1xuICAgICAgLy8gQHRzLWlnbm9yZSAtIHRlc3RpbmcgdW5kZWZpbmVkIGlucHV0XG4gICAgICBleHBlY3QocGFyc2VXb3JsZENvbmZpZ3ModW5kZWZpbmVkKSkudG9FcXVhbChbXSk7XG4gICAgfSk7XG4gICAgXG4gICAgdGVzdCgnaGFuZGxlcyBtYWxmb3JtZWQgaW5wdXQgZ3JhY2VmdWxseScsICgpID0+IHtcbiAgICAgIC8vIE1pc3NpbmcgcGFydHNcbiAgICAgIGNvbnN0IGNvbmZpZ1N0cmluZyA9ICdXb3JsZDEsMTIzNDU2JztcbiAgICAgIGNvbnN0IGNvbmZpZ3MgPSBwYXJzZVdvcmxkQ29uZmlncyhjb25maWdTdHJpbmcpO1xuICAgICAgXG4gICAgICBleHBlY3QoY29uZmlncykudG9IYXZlTGVuZ3RoKDEpO1xuICAgICAgZXhwZWN0KGNvbmZpZ3NbMF0pLnRvRXF1YWwoe1xuICAgICAgICBuYW1lOiAnV29ybGQxJyxcbiAgICAgICAgZGlzY29yZFNlcnZlcklkOiAnMTIzNDU2JyxcbiAgICAgICAgd29ybGROYW1lOiB1bmRlZmluZWQsXG4gICAgICAgIHNlcnZlclBhc3N3b3JkOiB1bmRlZmluZWRcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcbn0pOyJdfQ==