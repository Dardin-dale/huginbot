/**
 * Mod configuration types for HuginBot per-world mod support
 */

/**
 * Metadata for a single mod in the library
 */
export interface ModMetadata {
  name: string;              // Mod display name
  version: string;           // Mod version (e.g., "1.0.0")
  source: 'manual' | 'thunderstore';  // Where the mod came from
  description?: string;      // Optional description
  files: string[];           // List of plugin files (e.g., ["ValheimPlus.dll"])
  dependencies?: string[];   // Optional dependencies on other mods
  uploadedAt: string;        // ISO timestamp when mod was added
  sourceUrl?: string;        // Original download URL (for reference/updates)
}

/**
 * Manifest tracking all mods in the library
 */
export interface ModManifest {
  version: string;           // Manifest schema version
  mods: Record<string, ModMetadata>;  // Map of mod name to metadata
  lastUpdated: string;       // ISO timestamp of last update
}

/**
 * Per-world mod configuration stored in world.overrides.MODS
 */
export interface WorldModConfig {
  mods: string[];            // Array of mod names enabled for this world
}

/**
 * Valheim game modifier configuration
 */
export interface ValheimModifiers {
  combat?: 'veryeasy' | 'easy' | 'normal' | 'hard' | 'veryhard';
  deathpenalty?: 'casual' | 'veryeasy' | 'easy' | 'normal' | 'hard' | 'hardcore';
  resources?: 'muchless' | 'less' | 'normal' | 'more' | 'muchmore' | 'most';
  raids?: 'none' | 'muchless' | 'less' | 'normal' | 'more' | 'muchmore';
  portals?: 'casual' | 'normal' | 'hard' | 'veryhard';
  preset?: 'casual' | 'easy' | 'normal' | 'hard' | 'hardcore' | 'immersive' | 'hammer';
}

/**
 * Create an empty mod manifest
 */
export function createEmptyManifest(): ModManifest {
  return {
    version: '1.0',
    mods: {},
    lastUpdated: new Date().toISOString()
  };
}

/**
 * Create metadata for a manually uploaded mod
 */
export function createModMetadata(
  name: string,
  version: string,
  files: string[],
  description?: string,
  dependencies?: string[]
): ModMetadata {
  return {
    name,
    version,
    source: 'manual',
    description,
    files,
    dependencies,
    uploadedAt: new Date().toISOString()
  };
}

/**
 * Parse mod list from world overrides
 * @param overrides World overrides object containing MODS
 * @returns Array of mod names or empty array
 */
export function parseModsFromOverrides(overrides?: Record<string, string>): string[] {
  if (!overrides?.MODS) {
    return [];
  }

  try {
    const parsed = JSON.parse(overrides.MODS);
    if (Array.isArray(parsed)) {
      return parsed.filter(mod => typeof mod === 'string');
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Parse Valheim modifiers from world overrides
 * @param overrides World overrides object containing MODIFIERS
 * @returns ValheimModifiers object or null
 */
export function parseModifiersFromOverrides(overrides?: Record<string, string>): ValheimModifiers | null {
  if (!overrides?.MODIFIERS) {
    return null;
  }

  try {
    return JSON.parse(overrides.MODIFIERS) as ValheimModifiers;
  } catch {
    return null;
  }
}

/**
 * Build SERVER_ARGS string from Valheim modifiers
 * @param modifiers ValheimModifiers configuration
 * @param includeBase Whether to include base args like -crossplay
 * @returns SERVER_ARGS string
 */
export function buildServerArgsFromModifiers(
  modifiers: ValheimModifiers,
  includeBase: boolean = true
): string {
  const args: string[] = [];

  if (includeBase) {
    args.push('-crossplay');
  }

  // If a preset is specified, use it instead of individual modifiers
  if (modifiers.preset) {
    args.push(`-preset ${modifiers.preset}`);
  } else {
    // Add individual modifiers
    if (modifiers.combat && modifiers.combat !== 'normal') {
      args.push(`-modifier combat ${modifiers.combat}`);
    }
    if (modifiers.deathpenalty && modifiers.deathpenalty !== 'normal') {
      args.push(`-modifier deathpenalty ${modifiers.deathpenalty}`);
    }
    if (modifiers.resources && modifiers.resources !== 'normal') {
      args.push(`-modifier resources ${modifiers.resources}`);
    }
    if (modifiers.raids && modifiers.raids !== 'normal') {
      args.push(`-modifier raids ${modifiers.raids}`);
    }
    if (modifiers.portals && modifiers.portals !== 'normal') {
      args.push(`-modifier portals ${modifiers.portals}`);
    }
  }

  return args.join(' ');
}

/**
 * Validate mod name format
 * @param name Mod name to validate
 * @returns Array of validation errors (empty if valid)
 */
export function validateModName(name: string): string[] {
  const errors: string[] = [];

  if (!name || name.trim() === '') {
    errors.push('Mod name cannot be empty');
  } else if (name.length < 2) {
    errors.push('Mod name must be at least 2 characters');
  } else if (name.length > 64) {
    errors.push('Mod name cannot exceed 64 characters');
  } else if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    errors.push('Mod name can only contain letters, numbers, underscores, and hyphens');
  }

  return errors;
}

/**
 * Resolve mod dependencies recursively
 * @param modNames Array of mod names to resolve
 * @param manifest Full mod manifest
 * @returns Array of all mods including dependencies
 */
export function resolveModDependencies(
  modNames: string[],
  manifest: ModManifest
): string[] {
  const resolved = new Set<string>();
  const toProcess = [...modNames];

  while (toProcess.length > 0) {
    const modName = toProcess.pop()!;

    if (resolved.has(modName)) {
      continue;
    }

    resolved.add(modName);

    const mod = manifest.mods[modName];
    if (mod?.dependencies) {
      for (const dep of mod.dependencies) {
        if (!resolved.has(dep)) {
          toProcess.push(dep);
        }
      }
    }
  }

  return Array.from(resolved);
}
