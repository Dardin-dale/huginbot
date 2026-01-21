/**
 * mods.js - HuginBot CLI mod library management commands
 *
 * Manages the central mod library in S3 for per-world mod support
 */
const inquirer = require('inquirer');
const ora = require('ora');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs');
const { loadESMDependencies } = require('../utils/esm-loader');
const { getConfig, getConfigWithStackOutputs, saveConfig } = require('../utils/config');
const {
  listModsInLibrary,
  getModMetadata,
  uploadModToLibrary,
  deleteModFromLibrary,
  getModManifest
} = require('../utils/aws');
const {
  searchMods: thunderstoreSearch,
  getPopularMods,
  getPackageDetails,
  downloadMod,
  getDependencies,
  cleanupTempDir,
  formatPackage,
  formatPackageDetails,
  getLatestVersion,
  getTotalDownloads
} = require('../utils/thunderstore');

// Command group registration
function register(program) {
  const mods = program
    .command('mods')
    .description('Manage Valheim mod library');

  mods
    .command('list')
    .description('List mods in the library')
    .action(listMods);

  mods
    .command('add')
    .description('Add a mod to the library')
    .option('-p, --path <path>', 'Path to mod file or directory')
    .option('-n, --name <name>', 'Mod name')
    .option('-v, --version <version>', 'Mod version')
    .action(addMod);

  mods
    .command('remove')
    .description('Remove a mod from the library')
    .option('-n, --name <name>', 'Mod name to remove')
    .action(removeMod);

  mods
    .command('info')
    .description('Show detailed information about a mod')
    .argument('[modName]', 'Mod name')
    .action(modInfo);

  mods
    .command('search')
    .description('Search for mods on Thunderstore')
    .argument('<query>', 'Search query')
    .option('-l, --limit <limit>', 'Max results', '15')
    .action(searchThunderstore);

  mods
    .command('browse')
    .description('Browse popular mods on Thunderstore')
    .option('-l, --limit <limit>', 'Max results', '20')
    .action(browseThunderstore);

  mods
    .command('import')
    .description('Import a mod from Thunderstore to library')
    .argument('[modName]', 'Mod name or full name (author-name)')
    .option('--no-deps', 'Skip importing dependencies')
    .action(importFromThunderstore);

  mods
    .command('sync')
    .description('Sync mods from local ./mods/ folder to library')
    .option('-f, --force', 'Overwrite existing mods in library')
    .action(syncLocalMods);

  return mods;
}

// List mods in the library
async function listMods() {
  const config = await getConfigWithStackOutputs();

  if (!config.backupBucket) {
    console.log(chalk.yellow('Backup bucket not configured.'));
    console.log('Deploy the stack first: ' + chalk.cyan('npm run deploy'));
    return;
  }

  const spinner = ora('Fetching mod library...').start();

  try {
    const mods = await listModsInLibrary(config.backupBucket);
    spinner.succeed('Retrieved mod library');

    if (mods.length === 0) {
      console.log(chalk.yellow('\nNo mods in library'));
      console.log('Add a mod with: ' + chalk.cyan('huginbot mods add'));
      return;
    }

    console.log(chalk.cyan.bold('\nMod Library:'));
    console.log(`${chalk.bold('#'.padEnd(4))}${chalk.bold('Name'.padEnd(25))}${chalk.bold('Version'.padEnd(12))}${chalk.bold('Source'.padEnd(15))}${chalk.bold('Files')}`);
    console.log('-'.repeat(70));

    mods.forEach((mod, index) => {
      const filesCount = mod.files ? mod.files.length : 0;
      console.log(
        `${(index + 1).toString().padEnd(4)}` +
        `${mod.name.padEnd(25)}` +
        `${(mod.version || 'unknown').padEnd(12)}` +
        `${(mod.source || 'manual').padEnd(15)}` +
        `${filesCount} file${filesCount !== 1 ? 's' : ''}`
      );
    });

    console.log(chalk.gray(`\nTotal: ${mods.length} mod${mods.length !== 1 ? 's' : ''}`));
    console.log(chalk.gray(`View details: huginbot mods info <name>`));

  } catch (error) {
    spinner.fail('Failed to retrieve mod library');
    console.error(chalk.red('Error:'), error.message);
  }
}

// Add a mod to the library
async function addMod(options) {
  const config = await getConfigWithStackOutputs();

  if (!config.backupBucket) {
    console.log(chalk.yellow('Backup bucket not configured.'));
    console.log('Deploy the stack first: ' + chalk.cyan('npm run deploy'));
    return;
  }

  console.log(chalk.cyan.bold('\nAdd Mod to Library'));
  console.log(chalk.gray('Upload a mod to the central library for use with any world.\n'));

  let modPath = options.path;
  let modName = options.name;
  let modVersion = options.version;

  // Prompt for path if not provided
  if (!modPath) {
    const { inputPath } = await inquirer.prompt([
      {
        type: 'input',
        name: 'inputPath',
        message: 'Path to mod file or directory:',
        validate: (input) => {
          if (!input) return 'Path is required';
          if (!fs.existsSync(input)) return 'Path does not exist';
          return true;
        }
      }
    ]);
    modPath = inputPath;
  }

  // Validate path
  if (!fs.existsSync(modPath)) {
    console.log(chalk.red(`Path not found: ${modPath}`));
    return;
  }

  // Collect files to upload
  const files = [];
  const stats = fs.statSync(modPath);

  if (stats.isDirectory()) {
    // Find all .dll files in directory
    const dirFiles = fs.readdirSync(modPath);
    for (const file of dirFiles) {
      if (file.endsWith('.dll')) {
        files.push({
          localPath: path.join(modPath, file),
          filename: file
        });
      }
    }

    if (files.length === 0) {
      console.log(chalk.red('No .dll files found in directory'));
      return;
    }

    console.log(chalk.gray(`Found ${files.length} plugin file(s):`));
    files.forEach(f => console.log(chalk.gray(`  - ${f.filename}`)));
  } else if (modPath.endsWith('.dll')) {
    files.push({
      localPath: modPath,
      filename: path.basename(modPath)
    });
  } else if (modPath.endsWith('.zip')) {
    // Handle ZIP extraction
    console.log(chalk.yellow('ZIP files will be extracted. Looking for .dll files...'));
    const extractedFiles = await extractModFromZip(modPath);
    if (extractedFiles.length === 0) {
      console.log(chalk.red('No .dll files found in ZIP'));
      return;
    }
    files.push(...extractedFiles);
  } else {
    console.log(chalk.red('Unsupported file type. Please provide a .dll file, directory, or .zip archive.'));
    return;
  }

  // Try to infer mod name from filename
  const defaultName = modName || files[0].filename.replace('.dll', '');

  // Prompt for remaining details
  const prompts = [];

  if (!modName) {
    prompts.push({
      type: 'input',
      name: 'name',
      message: 'Mod name:',
      default: defaultName,
      validate: (input) => {
        if (!input || input.trim() === '') return 'Mod name is required';
        if (!/^[a-zA-Z0-9_-]+$/.test(input)) {
          return 'Mod name can only contain letters, numbers, underscores, and hyphens';
        }
        return true;
      }
    });
  }

  if (!modVersion) {
    prompts.push({
      type: 'input',
      name: 'version',
      message: 'Mod version:',
      default: '1.0.0',
      validate: (input) => input ? true : 'Version is required'
    });
  }

  prompts.push({
    type: 'input',
    name: 'description',
    message: 'Description (optional):',
    default: ''
  });

  prompts.push({
    type: 'input',
    name: 'sourceUrl',
    message: 'Source URL (optional, for reference):',
    default: ''
  });

  prompts.push({
    type: 'input',
    name: 'dependencies',
    message: 'Dependencies (comma-separated mod names, optional):',
    default: ''
  });

  const answers = await inquirer.prompt(prompts);

  modName = modName || answers.name;
  modVersion = modVersion || answers.version;

  // Check if mod already exists
  const existingMod = await getModMetadata(config.backupBucket, modName);
  if (existingMod) {
    const { confirmOverwrite } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmOverwrite',
        message: chalk.yellow(`Mod "${modName}" already exists (v${existingMod.version}). Overwrite?`),
        default: false
      }
    ]);

    if (!confirmOverwrite) {
      console.log(chalk.yellow('Upload cancelled.'));
      return;
    }
  }

  // Build metadata
  const metadata = {
    name: modName,
    version: modVersion,
    source: 'manual',
    description: answers.description || undefined,
    files: files.map(f => f.filename),
    dependencies: answers.dependencies ?
      answers.dependencies.split(',').map(d => d.trim()).filter(d => d) :
      undefined,
    sourceUrl: answers.sourceUrl || undefined,
    uploadedAt: new Date().toISOString()
  };

  // Confirm upload
  console.log(chalk.cyan('\nMod Summary:'));
  console.log(`  Name: ${modName}`);
  console.log(`  Version: ${modVersion}`);
  console.log(`  Files: ${files.map(f => f.filename).join(', ')}`);
  if (metadata.dependencies) {
    console.log(`  Dependencies: ${metadata.dependencies.join(', ')}`);
  }

  const { confirmUpload } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmUpload',
      message: 'Upload mod to library?',
      default: true
    }
  ]);

  if (!confirmUpload) {
    console.log(chalk.yellow('Upload cancelled.'));
    return;
  }

  const spinner = ora('Uploading mod...').start();

  try {
    await uploadModToLibrary(config.backupBucket, modName, metadata, files);
    spinner.succeed(`Mod "${modName}" added to library`);

    console.log(chalk.green(`\nMod "${modName}" is now available for world assignment.`));
    console.log(`Assign to worlds with: ${chalk.cyan('huginbot worlds edit')}`);

  } catch (error) {
    spinner.fail('Failed to upload mod');
    console.error(chalk.red('Error:'), error.message);
  }
}

// Remove a mod from the library
async function removeMod(options) {
  const config = await getConfigWithStackOutputs();

  if (!config.backupBucket) {
    console.log(chalk.yellow('Backup bucket not configured.'));
    return;
  }

  let modName = options.name;

  // If no name provided, prompt with list of available mods
  if (!modName) {
    const mods = await listModsInLibrary(config.backupBucket);

    if (mods.length === 0) {
      console.log(chalk.yellow('No mods in library to remove.'));
      return;
    }

    const { selectedMod } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedMod',
        message: 'Select mod to remove:',
        choices: mods.map(mod => ({
          name: `${mod.name} (v${mod.version})`,
          value: mod.name
        }))
      }
    ]);

    modName = selectedMod;
  }

  // Verify mod exists
  const mod = await getModMetadata(config.backupBucket, modName);
  if (!mod) {
    console.log(chalk.red(`Mod "${modName}" not found in library.`));
    return;
  }

  // Show mod details and confirm
  console.log(chalk.cyan('\nMod to remove:'));
  console.log(`  Name: ${mod.name}`);
  console.log(`  Version: ${mod.version}`);
  console.log(`  Files: ${mod.files ? mod.files.join(', ') : 'none'}`);

  const { confirmDelete } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmDelete',
      message: chalk.red(`Are you sure you want to remove "${modName}" from the library?`),
      default: false
    }
  ]);

  if (!confirmDelete) {
    console.log(chalk.yellow('Removal cancelled.'));
    return;
  }

  const spinner = ora('Removing mod...').start();

  try {
    await deleteModFromLibrary(config.backupBucket, modName);
    spinner.succeed(`Mod "${modName}" removed from library`);

    console.log(chalk.yellow('\nNote: Worlds using this mod will fail to load it on next start.'));
    console.log('Update affected worlds with: ' + chalk.cyan('huginbot worlds edit'));

  } catch (error) {
    spinner.fail('Failed to remove mod');
    console.error(chalk.red('Error:'), error.message);
  }
}

// Show detailed mod information
async function modInfo(modName) {
  const config = await getConfigWithStackOutputs();

  if (!config.backupBucket) {
    console.log(chalk.yellow('Backup bucket not configured.'));
    return;
  }

  // If no name provided, prompt with list
  if (!modName) {
    const mods = await listModsInLibrary(config.backupBucket);

    if (mods.length === 0) {
      console.log(chalk.yellow('No mods in library.'));
      return;
    }

    const { selectedMod } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedMod',
        message: 'Select mod to view:',
        choices: mods.map(mod => ({
          name: `${mod.name} (v${mod.version})`,
          value: mod.name
        }))
      }
    ]);

    modName = selectedMod;
  }

  const spinner = ora('Fetching mod details...').start();

  try {
    const mod = await getModMetadata(config.backupBucket, modName);
    spinner.stop();

    if (!mod) {
      console.log(chalk.red(`Mod "${modName}" not found in library.`));
      return;
    }

    // Display mod details
    const { boxen } = await loadESMDependencies();
    const infoBox = boxen(
      chalk.bold.cyan(`${mod.name}\n`) +
      chalk.gray(`Version: ${mod.version}\n`) +
      chalk.gray(`Source: ${mod.source}\n`) +
      (mod.description ? `\n${mod.description}\n` : '') +
      chalk.gray(`\nFiles:\n`) +
      (mod.files ? mod.files.map(f => chalk.gray(`  - ${f}`)).join('\n') : chalk.gray('  (none)')) +
      (mod.dependencies && mod.dependencies.length > 0 ?
        chalk.gray(`\n\nDependencies:\n`) + mod.dependencies.map(d => chalk.yellow(`  - ${d}`)).join('\n') :
        '') +
      (mod.sourceUrl ? chalk.gray(`\n\nSource URL: ${mod.sourceUrl}`) : '') +
      chalk.gray(`\n\nAdded: ${new Date(mod.uploadedAt).toLocaleString()}`),
      {
        padding: 1,
        margin: 1,
        borderStyle: 'round',
        borderColor: 'cyan'
      }
    );

    console.log(infoBox);

  } catch (error) {
    spinner.fail('Failed to fetch mod details');
    console.error(chalk.red('Error:'), error.message);
  }
}

// Helper: Extract .dll files from a ZIP
async function extractModFromZip(zipPath) {
  const { execSync } = require('child_process');
  const os = require('os');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huginbot-mod-'));
  const files = [];

  try {
    // Extract ZIP
    execSync(`unzip -q "${zipPath}" -d "${tempDir}"`, { stdio: 'pipe' });

    // Find all .dll files recursively
    const findDlls = (dir) => {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          findDlls(fullPath);
        } else if (item.name.endsWith('.dll')) {
          files.push({
            localPath: fullPath,
            filename: item.name
          });
        }
      }
    };

    findDlls(tempDir);

    if (files.length > 0) {
      console.log(chalk.gray(`Found ${files.length} plugin file(s) in ZIP:`));
      files.forEach(f => console.log(chalk.gray(`  - ${f.filename}`)));
    }

    return files;

  } catch (error) {
    // Clean up on error
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
    throw error;
  }
}

// Search mods on Thunderstore
async function searchThunderstore(query, options) {
  const limit = parseInt(options.limit) || 15;

  console.log(chalk.cyan.bold(`\nSearching Thunderstore for "${query}"...`));

  const spinner = ora('Searching...').start();

  try {
    const results = await thunderstoreSearch(query, { limit, sortBy: 'downloads' });
    spinner.succeed(`Found ${results.length} result(s)`);

    if (results.length === 0) {
      console.log(chalk.yellow('\nNo mods found matching your search.'));
      console.log('Try: ' + chalk.cyan('huginbot mods browse') + ' to see popular mods');
      return;
    }

    console.log(chalk.cyan.bold('\nSearch Results:'));
    console.log(`${chalk.bold('#'.padEnd(4))}${chalk.bold('Name'.padEnd(30))}${chalk.bold('Version'.padEnd(12))}${chalk.bold('Downloads')}`);
    console.log('-'.repeat(65));

    results.forEach((pkg, index) => {
      const latest = getLatestVersion(pkg);
      const version = latest?.version_number || 'unknown';
      const downloads = getTotalDownloads(pkg).toLocaleString();

      console.log(
        `${(index + 1).toString().padEnd(4)}` +
        `${(pkg.name || '').slice(0, 28).padEnd(30)}` +
        `${version.padEnd(12)}` +
        `${downloads}`
      );
    });

    console.log(chalk.gray(`\nImport a mod: huginbot mods import <name>`));
    console.log(chalk.gray(`View details on Thunderstore: https://thunderstore.io/c/valheim/`));

    // Offer to import
    const { importMod } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'importMod',
        message: 'Would you like to import a mod from these results?',
        default: false
      }
    ]);

    if (importMod) {
      const { selectedMod } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedMod',
          message: 'Select mod to import:',
          choices: results.map((pkg, index) => ({
            name: `${pkg.name} (v${getLatestVersion(pkg)?.version_number || 'unknown'})`,
            value: pkg
          })),
          pageSize: 15
        }
      ]);

      await importFromThunderstore(selectedMod.full_name || selectedMod.name, { deps: true });
    }

  } catch (error) {
    spinner.fail('Search failed');
    console.error(chalk.red('Error:'), error.message);
  }
}

// Browse popular mods on Thunderstore
async function browseThunderstore(options) {
  const limit = parseInt(options.limit) || 20;

  console.log(chalk.cyan.bold('\nBrowsing Popular Valheim Mods on Thunderstore...'));

  const spinner = ora('Fetching popular mods...').start();

  try {
    const results = await getPopularMods({ limit });
    spinner.succeed(`Retrieved top ${results.length} mods`);

    console.log(chalk.cyan.bold('\nPopular Mods:'));
    console.log(`${chalk.bold('#'.padEnd(4))}${chalk.bold('Name'.padEnd(30))}${chalk.bold('Author'.padEnd(20))}${chalk.bold('Downloads')}`);
    console.log('-'.repeat(75));

    results.forEach((pkg, index) => {
      const downloads = getTotalDownloads(pkg).toLocaleString();

      console.log(
        `${(index + 1).toString().padEnd(4)}` +
        `${(pkg.name || '').slice(0, 28).padEnd(30)}` +
        `${(pkg.owner || '').slice(0, 18).padEnd(20)}` +
        `${downloads}`
      );
    });

    console.log(chalk.gray(`\nSearch for specific mods: huginbot mods search <query>`));
    console.log(chalk.gray(`Import a mod: huginbot mods import <name>`));

    // Offer to import
    const { importMod } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'importMod',
        message: 'Would you like to import a mod?',
        default: false
      }
    ]);

    if (importMod) {
      const { selectedMod } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedMod',
          message: 'Select mod to import:',
          choices: results.map((pkg) => ({
            name: `${pkg.name} by ${pkg.owner} (${getTotalDownloads(pkg).toLocaleString()} downloads)`,
            value: pkg
          })),
          pageSize: 15
        }
      ]);

      await importFromThunderstore(selectedMod.full_name || selectedMod.name, { deps: true });
    }

  } catch (error) {
    spinner.fail('Failed to browse mods');
    console.error(chalk.red('Error:'), error.message);
  }
}

// Import a mod from Thunderstore to the library
async function importFromThunderstore(modName, options = {}) {
  const config = await getConfigWithStackOutputs();

  if (!config.backupBucket) {
    console.log(chalk.yellow('Backup bucket not configured.'));
    console.log('Deploy the stack first: ' + chalk.cyan('npm run deploy'));
    return;
  }

  // If no mod name provided, prompt for search
  if (!modName) {
    const { searchQuery } = await inquirer.prompt([
      {
        type: 'input',
        name: 'searchQuery',
        message: 'Search for a mod on Thunderstore:',
        validate: input => input.trim() ? true : 'Please enter a search query'
      }
    ]);

    console.log('');
    const spinner = ora('Searching...').start();
    const results = await thunderstoreSearch(searchQuery, { limit: 10 });
    spinner.stop();

    if (results.length === 0) {
      console.log(chalk.yellow('No mods found. Try a different search term.'));
      return;
    }

    const { selectedMod } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedMod',
        message: 'Select mod to import:',
        choices: results.map(pkg => ({
          name: `${pkg.name} (v${getLatestVersion(pkg)?.version_number || 'unknown'}) - ${getTotalDownloads(pkg).toLocaleString()} downloads`,
          value: pkg
        })),
        pageSize: 10
      }
    ]);

    modName = selectedMod.full_name || selectedMod.name;
  }

  console.log(chalk.cyan.bold(`\nImporting: ${modName}`));

  const spinner = ora('Fetching mod details...').start();

  try {
    // Get package details
    const pkg = await getPackageDetails(modName);

    if (!pkg) {
      spinner.fail(`Mod "${modName}" not found on Thunderstore`);
      console.log(chalk.yellow('Try searching: ') + chalk.cyan(`huginbot mods search ${modName}`));
      return;
    }

    spinner.succeed(`Found: ${pkg.name} by ${pkg.owner}`);

    // Show package details
    console.log(chalk.gray(`\n${pkg.description || 'No description'}`));
    const latest = getLatestVersion(pkg);
    console.log(chalk.gray(`Version: ${latest?.version_number || 'unknown'}`));
    console.log(chalk.gray(`Downloads: ${getTotalDownloads(pkg).toLocaleString()}`));

    // Check for dependencies
    const deps = options.deps !== false ? await getDependencies(pkg) : [];

    if (deps.length > 0) {
      console.log(chalk.yellow(`\nDependencies: ${deps.map(d => d.name).join(', ')}`));
    }

    // Check if already in library
    const existingMod = await getModMetadata(config.backupBucket, pkg.name);
    if (existingMod) {
      console.log(chalk.yellow(`\nMod "${pkg.name}" already exists in library (v${existingMod.version})`));
      const { confirmOverwrite } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmOverwrite',
          message: 'Overwrite with new version?',
          default: false
        }
      ]);

      if (!confirmOverwrite) {
        console.log(chalk.yellow('Import cancelled.'));
        return;
      }
    }

    // Confirm import
    const { confirmImport } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmImport',
        message: `Import ${pkg.name}${deps.length > 0 ? ` and ${deps.length} dependencies` : ''}?`,
        default: true
      }
    ]);

    if (!confirmImport) {
      console.log(chalk.yellow('Import cancelled.'));
      return;
    }

    // Download and import the main mod
    spinner.start(`Downloading ${pkg.name}...`);

    const downloadResult = await downloadMod(pkg);

    try {
      // Prepare files for upload
      const filesToUpload = downloadResult.files.map(f => ({
        localPath: f.path,
        filename: f.name
      }));

      if (filesToUpload.length === 0) {
        spinner.fail('No plugin files found in mod package');
        cleanupTempDir(downloadResult.tempDir);
        return;
      }

      spinner.text = `Uploading ${pkg.name} to library...`;

      // Build metadata
      const metadata = {
        name: pkg.name,
        version: downloadResult.version,
        source: 'thunderstore',
        description: pkg.description,
        files: filesToUpload.map(f => f.filename),
        dependencies: deps.map(d => d.name),
        sourceUrl: `https://thunderstore.io/c/valheim/p/${pkg.owner}/${pkg.name}/`,
        uploadedAt: new Date().toISOString()
      };

      await uploadModToLibrary(config.backupBucket, pkg.name, metadata, filesToUpload);
      spinner.succeed(`Imported ${pkg.name} v${downloadResult.version}`);

      // Clean up temp files
      cleanupTempDir(downloadResult.tempDir);

      // Import dependencies
      if (deps.length > 0 && options.deps !== false) {
        console.log(chalk.cyan('\nImporting dependencies...'));

        for (const dep of deps) {
          const depSpinner = ora(`Importing ${dep.name}...`).start();

          try {
            // Check if already exists
            const existingDep = await getModMetadata(config.backupBucket, dep.name);
            if (existingDep) {
              depSpinner.info(`${dep.name} already in library`);
              continue;
            }

            const depDownload = await downloadMod(dep);

            const depFiles = depDownload.files.map(f => ({
              localPath: f.path,
              filename: f.name
            }));

            if (depFiles.length === 0) {
              depSpinner.warn(`${dep.name}: No plugin files found, skipping`);
              cleanupTempDir(depDownload.tempDir);
              continue;
            }

            const depMeta = {
              name: dep.name,
              version: depDownload.version,
              source: 'thunderstore',
              description: dep.description,
              files: depFiles.map(f => f.filename),
              sourceUrl: `https://thunderstore.io/c/valheim/p/${dep.owner}/${dep.name}/`,
              uploadedAt: new Date().toISOString()
            };

            await uploadModToLibrary(config.backupBucket, dep.name, depMeta, depFiles);
            depSpinner.succeed(`Imported ${dep.name} v${depDownload.version}`);

            cleanupTempDir(depDownload.tempDir);

          } catch (depError) {
            depSpinner.fail(`Failed to import ${dep.name}: ${depError.message}`);
          }
        }
      }

      console.log(chalk.green(`\nSuccessfully imported ${pkg.name} to library!`));
      console.log(`Assign to worlds with: ${chalk.cyan('huginbot worlds edit')}`);

    } catch (uploadError) {
      cleanupTempDir(downloadResult.tempDir);
      throw uploadError;
    }

  } catch (error) {
    spinner.fail('Import failed');
    console.error(chalk.red('Error:'), error.message);
  }
}

// Sync mods from local ./mods/ folder to S3 library
async function syncLocalMods(options = {}) {
  const config = await getConfigWithStackOutputs();

  if (!config.backupBucket) {
    console.log(chalk.yellow('Backup bucket not configured.'));
    console.log('Deploy the stack first: ' + chalk.cyan('npm run deploy'));
    return;
  }

  const modsDir = path.join(process.cwd(), 'mods');

  if (!fs.existsSync(modsDir)) {
    console.log(chalk.yellow('No ./mods/ folder found.'));
    console.log('Create it and add mod folders:');
    console.log(chalk.cyan('  mkdir -p mods/MyMod'));
    console.log(chalk.cyan('  cp MyMod.dll mods/MyMod/'));
    return;
  }

  console.log(chalk.cyan.bold('\nSyncing Local Mods to Library'));
  console.log(chalk.gray(`Scanning ${modsDir}...\n`));

  // Find all mod folders (directories containing .dll files)
  const entries = fs.readdirSync(modsDir, { withFileTypes: true });
  const modFolders = entries.filter(e => e.isDirectory() && e.name !== '.git');

  if (modFolders.length === 0) {
    console.log(chalk.yellow('No mod folders found in ./mods/'));
    console.log(chalk.gray('Expected structure:'));
    console.log(chalk.gray('  mods/'));
    console.log(chalk.gray('  ├── MyMod/'));
    console.log(chalk.gray('  │   ├── MyMod.dll'));
    console.log(chalk.gray('  │   └── metadata.json  (optional)'));
    return;
  }

  // Get existing mods in library
  const existingMods = await listModsInLibrary(config.backupBucket);
  const existingNames = new Set(existingMods.map(m => m.name));

  const modsToSync = [];

  for (const folder of modFolders) {
    const modPath = path.join(modsDir, folder.name);
    const metadataPath = path.join(modPath, 'metadata.json');

    // Find .dll files
    const files = fs.readdirSync(modPath).filter(f => f.endsWith('.dll'));

    if (files.length === 0) {
      console.log(chalk.gray(`  Skipping ${folder.name}/ - no .dll files`));
      continue;
    }

    // Load or create metadata
    let metadata;
    if (fs.existsSync(metadataPath)) {
      try {
        metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        metadata.name = metadata.name || folder.name;
      } catch (e) {
        console.log(chalk.yellow(`  Warning: Invalid metadata.json in ${folder.name}/`));
        metadata = { name: folder.name };
      }
    } else {
      metadata = { name: folder.name };
    }

    // Fill in defaults
    metadata.version = metadata.version || '1.0.0';
    metadata.source = 'local';
    metadata.files = files;
    metadata.uploadedAt = new Date().toISOString();

    const exists = existingNames.has(metadata.name);

    modsToSync.push({
      folder: folder.name,
      path: modPath,
      metadata,
      files: files.map(f => ({
        localPath: path.join(modPath, f),
        filename: f
      })),
      exists
    });
  }

  if (modsToSync.length === 0) {
    console.log(chalk.yellow('No valid mods found to sync.'));
    return;
  }

  // Show what will be synced
  console.log(chalk.cyan('Mods to sync:'));
  for (const mod of modsToSync) {
    const status = mod.exists
      ? (options.force ? chalk.yellow('(overwrite)') : chalk.gray('(exists, skip)'))
      : chalk.green('(new)');
    console.log(`  ${mod.metadata.name} v${mod.metadata.version} - ${mod.files.length} file(s) ${status}`);
  }

  // Filter out existing unless force
  const toUpload = options.force
    ? modsToSync
    : modsToSync.filter(m => !m.exists);

  if (toUpload.length === 0) {
    console.log(chalk.yellow('\nNo new mods to upload. Use --force to overwrite existing.'));
    return;
  }

  // Confirm
  const { confirmSync } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmSync',
      message: `Upload ${toUpload.length} mod(s) to library?`,
      default: true
    }
  ]);

  if (!confirmSync) {
    console.log(chalk.yellow('Sync cancelled.'));
    return;
  }

  // Upload each mod
  let successCount = 0;
  for (const mod of toUpload) {
    const spinner = ora(`Uploading ${mod.metadata.name}...`).start();

    try {
      await uploadModToLibrary(config.backupBucket, mod.metadata.name, mod.metadata, mod.files);
      spinner.succeed(`Uploaded ${mod.metadata.name}`);
      successCount++;
    } catch (error) {
      spinner.fail(`Failed to upload ${mod.metadata.name}: ${error.message}`);
    }
  }

  console.log(chalk.green(`\nSynced ${successCount}/${toUpload.length} mod(s) to library.`));
  if (successCount > 0) {
    console.log(`Assign to worlds with: ${chalk.cyan('huginbot worlds edit')}`);
  }
}

// Export for interactive menu
async function modsMenu() {
  const choices = [
    { name: 'List mods in library', value: 'list' },
    { name: 'Add mod to library (manual)', value: 'add' },
    { name: 'Sync from ./mods/ folder', value: 'sync' },
    { name: 'View mod details', value: 'info' },
    { name: 'Remove mod from library', value: 'remove' },
    new inquirer.Separator('--- Thunderstore ---'),
    { name: chalk.cyan('Search mods on Thunderstore'), value: 'search' },
    { name: chalk.cyan('Browse popular mods'), value: 'browse' },
    { name: chalk.cyan('Import from Thunderstore'), value: 'import' },
    new inquirer.Separator(),
    { name: chalk.gray('Back to main menu'), value: 'back' }
  ];

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'Mod Management:',
      choices
    }
  ]);

  switch (action) {
    case 'list':
      await listMods();
      break;
    case 'add':
      await addMod({});
      break;
    case 'sync':
      await syncLocalMods({});
      break;
    case 'info':
      await modInfo();
      break;
    case 'remove':
      await removeMod({});
      break;
    case 'search':
      const { query } = await inquirer.prompt([
        {
          type: 'input',
          name: 'query',
          message: 'Search query:',
          validate: input => input.trim() ? true : 'Please enter a search query'
        }
      ]);
      await searchThunderstore(query, { limit: '15' });
      break;
    case 'browse':
      await browseThunderstore({ limit: '20' });
      break;
    case 'import':
      await importFromThunderstore(null, { deps: true });
      break;
    case 'back':
      return;
  }

  // Return to mods menu after action (unless back was selected)
  if (action !== 'back') {
    console.log('');
    await modsMenu();
  }
}

module.exports = {
  register,
  listMods,
  addMod,
  removeMod,
  modInfo,
  modsMenu,
  searchThunderstore,
  browseThunderstore,
  importFromThunderstore,
  syncLocalMods
};
