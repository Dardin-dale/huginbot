import { parseWorldConfigs, validateWorldConfig, WorldConfig } from '../../lib/lambdas/utils/world-config';

describe('World Config Utilities', () => {
  // Original parseWorldConfigs tests
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
    
    test('should filter out invalid configurations', () => {
      // Two valid configs and one invalid (using new validation)
      const configString = 'World1,123456,ValidWorld,password123;InvalidWorld,654321,Invalid-World,pass;World3,789012,AnotherValid,password789';
      const result = parseWorldConfigs(configString);
      
      // Should only have the valid configurations
      expect(result.length).toBeLessThan(3);
    });
    
    test('should trim whitespace from values', () => {
      const configString = ' World1 , 123456 , ValidWorld , password123 ';
      const result = parseWorldConfigs(configString);
      
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].name).toBe('World1');
      expect(result[0].worldName).toBe('ValidWorld');
    });
  });
  
  // New tests for validateWorldConfig function
  describe('validateWorldConfig', () => {
    test('should return no errors for valid config', () => {
      const validConfig: WorldConfig = {
        name: 'Test World',
        discordServerId: '12345678901234567',
        worldName: 'TestWorld',
        serverPassword: 'password123'
      };
      
      const errors = validateWorldConfig(validConfig);
      expect(errors).toHaveLength(0);
    });
    
    test('should validate name field', () => {
      // Empty name
      let config: WorldConfig = {
        name: '',
        discordServerId: '123456789',
        worldName: 'TestWorld',
        serverPassword: 'password123'
      };
      
      let errors = validateWorldConfig(config);
      expect(errors.some(e => e.includes('name'))).toBeTruthy();
      
      // Too short
      config.name = 'AB';
      errors = validateWorldConfig(config);
      expect(errors.some(e => e.includes('name'))).toBeTruthy();
    });
    
    test('should validate worldName field', () => {
      // Empty world name
      let config: WorldConfig = {
        name: 'Valid Name',
        discordServerId: '123456789',
        worldName: '',
        serverPassword: 'password123'
      };
      
      let errors = validateWorldConfig(config);
      expect(errors.some(e => e.includes('world name'))).toBeTruthy();
      
      // Invalid characters
      config.worldName = 'Invalid-Characters!';
      errors = validateWorldConfig(config);
      expect(errors.some(e => e.includes('letters, numbers, and underscores'))).toBeTruthy();
    });
    
    test('should validate serverPassword field', () => {
      // Empty password
      let config: WorldConfig = {
        name: 'Valid Name',
        discordServerId: '123456789',
        worldName: 'ValidWorld',
        serverPassword: ''
      };
      
      let errors = validateWorldConfig(config);
      expect(errors.some(e => e.includes('password'))).toBeTruthy();
      
      // Too short
      config.serverPassword = 'pass';
      errors = validateWorldConfig(config);
      expect(errors.some(e => e.includes('password'))).toBeTruthy();
    });
    
    test('should validate discordServerId field', () => {
      // Invalid Discord ID (non-numeric)
      let config: WorldConfig = {
        name: 'Valid Name',
        discordServerId: 'not-a-number',
        worldName: 'ValidWorld',
        serverPassword: 'password123'
      };
      
      let errors = validateWorldConfig(config);
      expect(errors.some(e => e.includes('Discord'))).toBeTruthy();
    });
  });
});