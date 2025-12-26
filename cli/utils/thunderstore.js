/**
 * thunderstore.js - Thunderstore API Client for Valheim Mods
 *
 * Provides integration with the Thunderstore mod repository for:
 * - Searching mods
 * - Fetching mod details
 * - Downloading mod packages
 *
 * Thunderstore API: https://thunderstore.io/api/docs/
 * Valheim community: https://thunderstore.io/c/valheim/
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const chalk = require('chalk');
const { execSync } = require('child_process');

// Thunderstore API base URL - use community-specific endpoint
const THUNDERSTORE_API = 'https://thunderstore.io/c/valheim/api/v1';
const VALHEIM_COMMUNITY = 'valheim';

// Cache for package list (in-memory, cleared on process exit)
let packageCache = null;
let packageCacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Make an HTTPS GET request
 * @param {string} url - URL to fetch
 * @returns {Promise<any>} - Parsed JSON response
 */
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        return resolve(httpsGet(res.headers.location));
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        return;
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Invalid JSON response'));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

/**
 * Download a file to a local path
 * @param {string} url - URL to download
 * @param {string} destPath - Local path to save file
 * @returns {Promise<void>}
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);

    const request = https.get(url, { timeout: 60000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        file.close();
        fs.unlinkSync(destPath);
        return resolve(downloadFile(res.headers.location, destPath));
      }

      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(destPath);
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      res.pipe(file);

      file.on('finish', () => {
        file.close();
        resolve();
      });
    });

    request.on('error', (err) => {
      file.close();
      fs.unlinkSync(destPath);
      reject(err);
    });

    request.on('timeout', () => {
      request.destroy();
      file.close();
      try {
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      } catch (e) { /* ignore cleanup errors */ }
      reject(new Error('Download timeout'));
    });
  });
}

/**
 * Get all packages for Valheim from Thunderstore
 * Uses caching to avoid rate limiting
 * @param {boolean} forceRefresh - Force refresh cache
 * @returns {Promise<Object[]>} - Array of package objects
 */
async function getAllPackages(forceRefresh = false) {
  const now = Date.now();

  if (!forceRefresh && packageCache && (now - packageCacheTime) < CACHE_TTL_MS) {
    return packageCache;
  }

  console.log(chalk.gray('Fetching Valheim packages from Thunderstore...'));

  try {
    // Use the community-specific v1 API endpoint
    const url = `${THUNDERSTORE_API}/package/`;
    const packages = await httpsGet(url);

    // Filter out deprecated packages
    const activePackages = packages.filter(pkg => !pkg.is_deprecated);

    packageCache = activePackages;
    packageCacheTime = now;

    console.log(chalk.gray(`Loaded ${activePackages.length} packages`));
    return activePackages;
  } catch (error) {
    console.error(chalk.red('Failed to fetch packages:'), error.message);
    throw error;
  }
}

/**
 * Get total downloads for a package (sum of all versions)
 * @param {Object} pkg - Package object
 * @returns {number} - Total downloads
 */
function getTotalDownloads(pkg) {
  if (!pkg.versions || pkg.versions.length === 0) return 0;
  return pkg.versions.reduce((sum, v) => sum + (v.downloads || 0), 0);
}

/**
 * Search for mods by name/description
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @param {number} options.limit - Max results (default 20)
 * @param {string} options.sortBy - Sort by: 'downloads', 'updated', 'rating', 'name'
 * @returns {Promise<Object[]>} - Matching packages
 */
async function searchMods(query, options = {}) {
  const { limit = 20, sortBy = 'downloads' } = options;

  const packages = await getAllPackages();
  const queryLower = query.toLowerCase();

  // Filter packages that match the query
  let results = packages.filter(pkg => {
    const name = (pkg.name || '').toLowerCase();
    const fullName = (pkg.full_name || '').toLowerCase();
    const ownerName = (pkg.owner || '').toLowerCase();

    return name.includes(queryLower) ||
           fullName.includes(queryLower) ||
           ownerName.includes(queryLower);
  });

  // Sort results
  switch (sortBy) {
    case 'downloads':
      results.sort((a, b) => getTotalDownloads(b) - getTotalDownloads(a));
      break;
    case 'updated':
      results.sort((a, b) => new Date(b.date_updated || 0) - new Date(a.date_updated || 0));
      break;
    case 'rating':
      results.sort((a, b) => (b.rating_score || 0) - (a.rating_score || 0));
      break;
    case 'name':
      results.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      break;
  }

  return results.slice(0, limit);
}

/**
 * Get popular/top mods
 * @param {Object} options - Options
 * @param {number} options.limit - Max results (default 20)
 * @param {string} options.category - Filter by category (optional)
 * @returns {Promise<Object[]>} - Top packages
 */
async function getPopularMods(options = {}) {
  const { limit = 20, category = null } = options;

  let packages = await getAllPackages();

  // Filter by category if specified
  if (category) {
    const categoryLower = category.toLowerCase();
    packages = packages.filter(pkg =>
      pkg.categories?.some(cat => cat.toLowerCase().includes(categoryLower))
    );
  }

  // Sort by downloads (sum of all version downloads)
  packages.sort((a, b) => getTotalDownloads(b) - getTotalDownloads(a));

  return packages.slice(0, limit);
}

/**
 * Get package details by full name (author-name)
 * @param {string} fullName - Package full name (e.g., "denikson-BepInExPack_Valheim")
 * @returns {Promise<Object|null>} - Package details or null if not found
 */
async function getPackageDetails(fullName) {
  const packages = await getAllPackages();

  return packages.find(pkg =>
    pkg.full_name?.toLowerCase() === fullName.toLowerCase() ||
    pkg.name?.toLowerCase() === fullName.toLowerCase()
  ) || null;
}

/**
 * Get latest version info for a package
 * @param {Object} pkg - Package object from API
 * @returns {Object|null} - Latest version info
 */
function getLatestVersion(pkg) {
  if (!pkg.versions || pkg.versions.length === 0) {
    return null;
  }

  // Versions are usually sorted newest first
  return pkg.versions[0];
}

/**
 * Download and extract a mod package
 * @param {Object} pkg - Package object
 * @param {string} version - Version to download (or 'latest')
 * @returns {Promise<Object>} - Extracted mod info { tempDir, files, manifest }
 */
async function downloadMod(pkg, version = 'latest') {
  let versionInfo;

  if (version === 'latest') {
    versionInfo = getLatestVersion(pkg);
  } else {
    versionInfo = pkg.versions?.find(v => v.version_number === version);
  }

  if (!versionInfo) {
    throw new Error(`Version ${version} not found for ${pkg.name}`);
  }

  const downloadUrl = versionInfo.download_url;
  if (!downloadUrl) {
    throw new Error(`No download URL for ${pkg.name} v${versionInfo.version_number}`);
  }

  // Create temp directory
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thunderstore-'));
  const zipPath = path.join(tempDir, 'mod.zip');
  const extractDir = path.join(tempDir, 'extracted');

  try {
    // Download the zip file
    console.log(chalk.gray(`Downloading ${pkg.name} v${versionInfo.version_number}...`));
    await downloadFile(downloadUrl, zipPath);

    // Extract the zip using native unzip command
    console.log(chalk.gray('Extracting...'));
    fs.mkdirSync(extractDir, { recursive: true });
    execSync(`unzip -q "${zipPath}" -d "${extractDir}"`, { stdio: 'pipe' });

    // Read manifest if present
    let manifest = null;
    const manifestPath = path.join(extractDir, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    }

    // Find plugin files (DLLs and config files)
    const files = [];
    const pluginsDir = path.join(extractDir, 'plugins');

    // Helper to recursively find files
    const findFilesRecursive = (dir, baseDir = dir) => {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      const results = [];
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          results.push(...findFilesRecursive(fullPath, baseDir));
        } else if (item.name.endsWith('.dll') || item.name.endsWith('.cfg')) {
          results.push({
            name: item.name,
            path: fullPath,
            relativePath: path.relative(baseDir, fullPath)
          });
        }
      }
      return results;
    };

    if (fs.existsSync(pluginsDir)) {
      // Standard structure: plugins/ folder
      files.push(...findFilesRecursive(pluginsDir));
    } else {
      // Alternative: DLLs in root
      const rootFiles = fs.readdirSync(extractDir, { withFileTypes: true });
      for (const item of rootFiles) {
        const fullPath = path.join(extractDir, item.name);
        if (item.isFile() && (item.name.endsWith('.dll') || item.name.endsWith('.cfg'))) {
          files.push({
            name: item.name,
            path: fullPath,
            relativePath: item.name
          });
        }
      }
    }

    return {
      tempDir,
      extractDir,
      files,
      manifest,
      version: versionInfo.version_number,
      dependencies: versionInfo.dependencies || []
    };
  } catch (error) {
    // Cleanup on error
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Parse Thunderstore dependency string
 * @param {string} depString - Dependency string (e.g., "denikson-BepInExPack_Valheim-5.4.2105")
 * @returns {Object} - { author, name, version }
 */
function parseDependency(depString) {
  const parts = depString.split('-');
  if (parts.length >= 3) {
    return {
      author: parts[0],
      name: parts.slice(1, -1).join('-'),
      version: parts[parts.length - 1],
      fullName: `${parts[0]}-${parts.slice(1, -1).join('-')}`
    };
  }
  return { author: '', name: depString, version: '', fullName: depString };
}

/**
 * Get dependencies for a package (recursively resolved)
 * @param {Object} pkg - Package object
 * @param {Set} seen - Already seen packages (to avoid cycles)
 * @returns {Promise<Object[]>} - Array of dependency packages
 */
async function getDependencies(pkg, seen = new Set()) {
  const latestVersion = getLatestVersion(pkg);
  if (!latestVersion) return [];

  const deps = [];
  const depStrings = latestVersion.dependencies || [];

  for (const depString of depStrings) {
    const { fullName } = parseDependency(depString);

    // Skip if already processed
    if (seen.has(fullName)) continue;
    seen.add(fullName);

    // Skip BepInExPack (usually pre-installed)
    if (fullName.toLowerCase().includes('bepinexpack')) continue;

    const depPkg = await getPackageDetails(fullName);
    if (depPkg) {
      deps.push(depPkg);

      // Recursively get dependencies
      const subDeps = await getDependencies(depPkg, seen);
      deps.push(...subDeps);
    }
  }

  return deps;
}

/**
 * Clean up a temp directory
 * @param {string} tempDir - Directory to clean up
 */
function cleanupTempDir(tempDir) {
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Format package for display
 * @param {Object} pkg - Package object
 * @returns {string} - Formatted string
 */
function formatPackage(pkg) {
  const latest = getLatestVersion(pkg);
  const version = latest?.version_number || 'unknown';
  const downloads = getTotalDownloads(pkg).toLocaleString();

  return `${pkg.name} (v${version}) - ${downloads} downloads`;
}

/**
 * Format package details for display
 * @param {Object} pkg - Package object
 * @returns {string} - Multi-line formatted string
 */
function formatPackageDetails(pkg) {
  const latest = getLatestVersion(pkg);
  const lines = [
    chalk.bold(pkg.name),
    chalk.gray(`by ${pkg.owner}`),
    '',
    pkg.description || 'No description',
    '',
    `Version: ${latest?.version_number || 'unknown'}`,
    `Downloads: ${getTotalDownloads(pkg).toLocaleString()}`,
    `Rating: ${pkg.rating_score || 0}`,
    `Updated: ${pkg.date_updated ? new Date(pkg.date_updated).toLocaleDateString() : 'unknown'}`,
  ];

  if (latest?.dependencies?.length > 0) {
    const deps = latest.dependencies
      .filter(d => !d.toLowerCase().includes('bepinexpack'))
      .map(d => parseDependency(d).name);

    if (deps.length > 0) {
      lines.push(`Dependencies: ${deps.join(', ')}`);
    }
  }

  lines.push('');
  lines.push(chalk.cyan(`URL: https://thunderstore.io/c/valheim/p/${pkg.owner}/${pkg.name}/`));

  return lines.join('\n');
}

module.exports = {
  searchMods,
  getPopularMods,
  getPackageDetails,
  getLatestVersion,
  getTotalDownloads,
  downloadMod,
  getDependencies,
  parseDependency,
  cleanupTempDir,
  formatPackage,
  formatPackageDetails,
  getAllPackages
};
