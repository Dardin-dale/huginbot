const fs = require('fs');
const path = require('path');

describe('Valheim Log Pattern Matching', () => {
  // Sample log entries that we want to match
  const sampleLogs = {
    joinCode: '11:22:33: Session "My Server Name" with join code 123456 and IP address 123.45.67.89',
    playerJoin: '11:22:33: Got character ZDOID from Testy McTestface : 0:1',
    playerLeave: '11:22:33: Closing socket: Testy McTestface',
    serverStarting: '11:22:33: DungeonDB Start',
    serverRunning: '11:22:33: Game server connected'
  };

  // Patterns we use for log filtering in Docker environment variables
  const patterns = {
    joinCode: 'Session .* with join code [0-9]+ and IP',
    playerJoin: 'Got character ZDOID from .+ : [0-9]+:[0-9]+',
    playerLeave: 'Closing socket: .+'
  };

  test('should match join code pattern correctly', () => {
    const regex = new RegExp(patterns.joinCode);
    expect(regex.test(sampleLogs.joinCode)).toBe(true);
    
    // It should also be able to extract the server name and join code
    const serverNameMatch = sampleLogs.joinCode.match(/Session "(.+)" with/);
    const joinCodeMatch = sampleLogs.joinCode.match(/join code ([0-9]+)/);
    
    expect(serverNameMatch[1]).toBe('My Server Name');
    expect(joinCodeMatch[1]).toBe('123456');
  });

  test('should match player join pattern correctly', () => {
    const regex = new RegExp(patterns.playerJoin);
    expect(regex.test(sampleLogs.playerJoin)).toBe(true);
    
    // It should also be able to extract the player name
    const playerNameMatch = sampleLogs.playerJoin.match(/from (.+?) :/);
    expect(playerNameMatch[1]).toBe('Testy McTestface');
  });

  test('should match player leave pattern correctly', () => {
    const regex = new RegExp(patterns.playerLeave);
    expect(regex.test(sampleLogs.playerLeave)).toBe(true);
    
    // It should also be able to extract the player name
    const playerNameMatch = sampleLogs.playerLeave.match(/socket: (.+)/);
    expect(playerNameMatch[1]).toBe('Testy McTestface');
  });

  test('should not match non-relevant log patterns', () => {
    const joinCodeRegex = new RegExp(patterns.joinCode);
    const playerJoinRegex = new RegExp(patterns.playerJoin);
    const playerLeaveRegex = new RegExp(patterns.playerLeave);
    
    // These log lines should not match any of our target patterns
    expect(joinCodeRegex.test(sampleLogs.serverStarting)).toBe(false);
    expect(joinCodeRegex.test(sampleLogs.serverRunning)).toBe(false);
    
    expect(playerJoinRegex.test(sampleLogs.serverStarting)).toBe(false);
    expect(playerJoinRegex.test(sampleLogs.serverRunning)).toBe(false);
    
    expect(playerLeaveRegex.test(sampleLogs.serverStarting)).toBe(false);
    expect(playerLeaveRegex.test(sampleLogs.serverRunning)).toBe(false);
  });
});