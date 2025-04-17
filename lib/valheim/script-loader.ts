import * as fs from 'fs';
import * as path from 'path';

/**
 * Load a script file from the scripts directory
 * 
 * @param scriptPath Path to the script file relative to the scripts directory
 * @param variables Optional variables to replace in the script (key-value pairs)
 * @returns The script content with variables replaced
 */
export function loadScript(scriptPath: string, variables: Record<string, string> = {}): string {
    // Use __dirname to get the current directory, then navigate to the scripts directory
    const scriptsDir = path.resolve(__dirname, '../../scripts');
    const fullPath = path.join(scriptsDir, scriptPath);
    
    // Read the script file
    let scriptContent = fs.readFileSync(fullPath, 'utf8');
    
    // Replace variables in the script
    Object.entries(variables).forEach(([key, value]) => {
        scriptContent = scriptContent.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value);
    });
    
    return scriptContent;
}
