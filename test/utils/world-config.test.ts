import { parseWorldConfigs } from '../../lib/lambdas/utils/world-config';

describe('World Config Utilities', () => {
  describe('parseWorldConfigs', () => {
    test('parses multiple world configs correctly', () => {
      const configString = 'World1,123456,ValheimWorld1,password1;World2,234567,ValheimWorld2,password2';
      const configs = parseWorldConfigs(configString);
      
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
      expect(parseWorldConfigs('')).toEqual([]);
    });

    test('returns empty array for undefined input', () => {
      // @ts-ignore - testing undefined input
      expect(parseWorldConfigs(undefined)).toEqual([]);
    });
    
    test('handles malformed input gracefully', () => {
      // Missing parts
      const configString = 'World1,123456';
      const configs = parseWorldConfigs(configString);
      
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