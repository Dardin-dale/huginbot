/**
 * ESM-only dependencies loader utility
 * 
 * Dynamically imports ESM-only dependencies into CommonJS modules
 * Handles the following ESM-only packages:
 * - boxen (v7.1.1)
 * - open (v8.4.2)
 * - ora (v5.4.1)
 * - terminal-link (v3.0.0)
 */

// Cache for imported modules
let boxen, open, ora, terminalLink;

/**
 * Load ESM-only dependencies 
 * @returns {Promise<Object>} Object containing imported modules
 */
async function loadESMDependencies() {
  if (!boxen) {
    boxen = (await import('boxen')).default;
    open = (await import('open')).default;
    ora = (await import('ora')).default;
    terminalLink = (await import('terminal-link')).default;
  }
  return { boxen, open, ora, terminalLink };
}

module.exports = { loadESMDependencies };