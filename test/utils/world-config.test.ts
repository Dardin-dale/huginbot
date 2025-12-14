import { parseWorldConfigsFromEnv, validateWorldConfig, WorldConfig } from '../../lib/lambdas/utils/world-config';

describe('World Config Utilities', () => {
  // Tests for parseWorldConfigsFromEnv function
  describe('parseWorldConfigsFromEnv', () => {
    const originalEnv = process.env;
    
    beforeEach(() => {
      // Reset environment variables before each test
      process.env = { ...originalEnv };
      delete process.env.WORLD_COUNT;
      delete process.env.WORLD_1_NAME;
      delete process.env.WORLD_1_WORLD_NAME;
      delete process.env.WORLD_1_PASSWORD;
      delete process.env.WORLD_1_DISCORD_ID;
      delete process.env.WORLD_2_NAME;
      delete process.env.WORLD_2_WORLD_NAME;
      delete process.env.WORLD_2_PASSWORD;
      delete process.env.WORLD_2_DISCORD_ID;
    });
    
    afterAll(() => {
      // Restore original environment
      process.env = originalEnv;
    });

    test('parses multiple world configs correctly from environment variables', () => {
      process.env.WORLD_COUNT = '2';
      process.env.WORLD_1_NAME = 'World1';
      process.env.WORLD_1_WORLD_NAME = 'ValheimWorld1';
      process.env.WORLD_1_PASSWORD = 'password1';
      process.env.WORLD_1_DISCORD_ID = '123456';
      process.env.WORLD_2_NAME = 'World2';
      process.env.WORLD_2_WORLD_NAME = 'ValheimWorld2';
      process.env.WORLD_2_PASSWORD = 'password2';
      process.env.WORLD_2_DISCORD_ID = '234567';
      
      const configs = parseWorldConfigsFromEnv();
      
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

    test('returns empty array when no WORLD_COUNT is set', () => {
      expect(parseWorldConfigsFromEnv()).toEqual([]);
    });

    test('returns empty array when WORLD_COUNT is 0', () => {
      process.env.WORLD_COUNT = '0';
      expect(parseWorldConfigsFromEnv()).toEqual([]);
    });
    
    test('should filter out incomplete configurations', () => {
      process.env.WORLD_COUNT = '2';
      process.env.WORLD_1_NAME = 'World1';
      process.env.WORLD_1_WORLD_NAME = 'ValidWorld';
      process.env.WORLD_1_PASSWORD = 'password123';
      // Missing WORLD_2_NAME for the second world
      process.env.WORLD_2_WORLD_NAME = 'IncompleteWorld';
      process.env.WORLD_2_PASSWORD = 'password456';
      
      const result = parseWorldConfigsFromEnv();
      
      // Should only have the complete configuration
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('World1');
    });
    
    test('should use default password when not provided', () => {
      process.env.WORLD_COUNT = '1';
      process.env.WORLD_1_NAME = 'TestWorld';
      process.env.WORLD_1_WORLD_NAME = 'TestValheimWorld';
      // No password set
      
      const result = parseWorldConfigsFromEnv();
      
      expect(result).toHaveLength(1);
      expect(result[0].serverPassword).toBe('valheim');
    });
    
    test('should handle missing Discord ID', () => {
      process.env.WORLD_COUNT = '1';
      process.env.WORLD_1_NAME = 'TestWorld';
      process.env.WORLD_1_WORLD_NAME = 'TestValheimWorld';
      process.env.WORLD_1_PASSWORD = 'testpass';
      // No Discord ID set
      
      const result = parseWorldConfigsFromEnv();
      
      expect(result).toHaveLength(1);
      expect(result[0].discordServerId).toBe('');
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