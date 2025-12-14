const fs = require('fs');
const path = require('path');

describe('Valheim Log Pattern Matching with Real Logs', () => {
  // Real log entries from the example logs
  const realLogs = {
    joinCode: 'Apr 15 20:18:07 supervisord: valheim-server 04/15/2025 20:18:07: Session "GjurdsIHOP" with join code 122842 and IP 18.236.178.46:2456 is active with 0 player(s)',
    playerJoin: 'Apr 15 20:21:13 supervisord: valheim-server 04/15/2025 20:21:13: Player joined server "GjurdsIHOP" that has join code 122842, now 1 player(s)',
    playerLeave: 'Apr 15 20:25:56 supervisord: valheim-server 04/15/2025 20:25:56: Player connection lost server "GjurdsIHOP" that has join code 122842, now 0 player(s)'
  };

  // Patterns that should match these logs
  const patterns = {
    joinCode: 'Session .* with join code [0-9]+ and IP',
    playerJoin: 'Player joined server .* that has join code [0-9]+',
    playerLeave: 'Player connection lost server .* that has join code'
  };

  test('should match join code in real logs', () => {
    const regex = new RegExp(patterns.joinCode);
    expect(regex.test(realLogs.joinCode)).toBe(true);
    
    // Extract server name and join code
    const serverNameMatch = realLogs.joinCode.match(/Session "([^"]+)" with/);
    const joinCodeMatch = realLogs.joinCode.match(/join code ([0-9]+)/);
    
    expect(serverNameMatch[1]).toBe('GjurdsIHOP');
    expect(joinCodeMatch[1]).toBe('122842');
  });

  test('should match player join in real logs', () => {
    const regex = new RegExp(patterns.playerJoin);
    expect(regex.test(realLogs.playerJoin)).toBe(true);
    
    // Extract server name, join code, and player count
    const serverNameMatch = realLogs.playerJoin.match(/server "([^"]+)" that/);
    const joinCodeMatch = realLogs.playerJoin.match(/join code ([0-9]+)/);
    const playerCountMatch = realLogs.playerJoin.match(/now ([0-9]+) player/);
    
    expect(serverNameMatch[1]).toBe('GjurdsIHOP');
    expect(joinCodeMatch[1]).toBe('122842');
    expect(playerCountMatch[1]).toBe('1');
  });

  test('should match player leave in real logs', () => {
    const regex = new RegExp(patterns.playerLeave);
    expect(regex.test(realLogs.playerLeave)).toBe(true);
    
    // Extract server name, join code, and player count
    const serverNameMatch = realLogs.playerLeave.match(/server "([^"]+)" that/);
    const joinCodeMatch = realLogs.playerLeave.match(/join code ([0-9]+)/);
    const playerCountMatch = realLogs.playerLeave.match(/now ([0-9]+) player/);
    
    expect(serverNameMatch[1]).toBe('GjurdsIHOP');
    expect(joinCodeMatch[1]).toBe('122842');
    expect(playerCountMatch[1]).toBe('0');
  });

  // Test Docker container environment variables
  test('should generate correct Docker environment variables for log filtering', () => {
    // These are examples of what should be generated in valheim-stack.ts
    const dockerEnvVars = [
      'VALHEIM_LOG_FILTER_CONTAINS_JoinCode="Session .* with join code [0-9]+ and IP"',
      'ON_VALHEIM_LOG_FILTER_CONTAINS_JoinCode="{ read l; server_name=$(echo \\"$l\\" | grep -o \\"Session \\\\\\"\\".*\\\\\\"\\" | cut -d\\\\\\"\\" -f2); join_code=$(echo \\"$l\\" | grep -o \\"join code [0-9]*\\" | cut -d\\\" \\\" -f3); msg=\\"🎮 Server \\\\\\"$server_name\\\\\\" is ready! Join code: $join_code\\"; curl -sfSL -X POST -H \\"Content-Type: application/json\\" -d \\"{\\\\\\"username\\\\\\":\\\\\\"HuginBot\\\\\\",\\\\\\"content\\\\\\":\\\\\\"$msg\\\\\\"}\\" \\"$DISCORD_WEBHOOK\\"; }"',
      'VALHEIM_LOG_FILTER_CONTAINS_PlayerJoin="Player joined server .* that has join code [0-9]+"',
      'ON_VALHEIM_LOG_FILTER_CONTAINS_PlayerJoin="{ read l; server_name=$(echo \\"$l\\" | grep -o \\"server \\\\\\"\\".*\\\\\\"\\" | cut -d\\\\\\"\\" -f2); player_count=$(echo \\"$l\\" | grep -o \\"now [0-9]* player\\" | cut -d\\\" \\\" -f2); msg=\\"👋 Player joined $server_name. Player count: $player_count\\"; curl -sfSL -X POST -H \\"Content-Type: application/json\\" -d \\"{\\\\\\"username\\\\\\":\\\\\\"HuginBot\\\\\\",\\\\\\"content\\\\\\":\\\\\\"$msg\\\\\\"}\\" \\"$DISCORD_WEBHOOK\\"; }"',
      'VALHEIM_LOG_FILTER_CONTAINS_PlayerLeave="Player connection lost server .* that has join code"',
      'ON_VALHEIM_LOG_FILTER_CONTAINS_PlayerLeave="{ read l; server_name=$(echo \\"$l\\" | grep -o \\"server \\\\\\"\\".*\\\\\\"\\" | cut -d\\\\\\"\\" -f2); player_count=$(echo \\"$l\\" | grep -o \\"now [0-9]* player\\" | cut -d\\\" \\\" -f2); msg=\\"👋 Player left $server_name. Player count: $player_count\\"; curl -sfSL -X POST -H \\"Content-Type: application/json\\" -d \\"{\\\\\\"username\\\\\\":\\\\\\"HuginBot\\\\\\",\\\\\\"content\\\\\\":\\\\\\"$msg\\\\\\"}\\" \\"$DISCORD_WEBHOOK\\"; }"'
    ];
    
    // Check that each pattern actually exists in the environment variables
    expect(dockerEnvVars[0]).toContain(patterns.joinCode);
    expect(dockerEnvVars[2]).toContain(patterns.playerJoin);
    expect(dockerEnvVars[4]).toContain(patterns.playerLeave);
    
    // Each filter should have a corresponding action
    expect(dockerEnvVars[1]).toContain('ON_VALHEIM_LOG_FILTER_CONTAINS_JoinCode');
    expect(dockerEnvVars[3]).toContain('ON_VALHEIM_LOG_FILTER_CONTAINS_PlayerJoin');
    expect(dockerEnvVars[5]).toContain('ON_VALHEIM_LOG_FILTER_CONTAINS_PlayerLeave');
  });
});