const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const logger = require('../utils/logger');

// Scan and detect conflicts for a given server
async function detectConflicts(db, serverId) {
  // 1. Fetch server info
  const server = db.prepare('SELECT install_path FROM servers WHERE id = ?').get(serverId);
  if (!server) {
    throw new Error(`Server with ID ${serverId} not found.`);
  }

  const modsDir = path.join(server.install_path, 'mods');
  if (!fs.existsSync(modsDir)) {
    // If mods dir doesn't exist, create it and return empty conflicts
    fs.mkdirSync(modsDir, { recursive: true });
    // Clear old conflicts
    db.prepare('DELETE FROM mod_conflicts WHERE server_id = ?').run(serverId);
    return [];
  }

  // 2. Scan all files in mods directory
  const files = fs.readdirSync(modsDir);
  const mods = [];

  for (const filename of files) {
    const fullPath = path.join(modsDir, filename);
    const stats = fs.statSync(fullPath);
    const isDir = stats.isDirectory();
    const isZipOrJar = !isDir && (filename.endsWith('.jar') || filename.endsWith('.zip') || filename.endsWith('.jar.disabled') || filename.endsWith('.zip.disabled'));

    if (!isDir && !isZipOrJar) continue;

    const isActive = !filename.endsWith('.disabled');
    let modMeta = {
      filename,
      isActive,
      id: null,
      name: null,
      version: '1.0.0',
      dependencies: {},
      conflicts: [],
    };

    try {
      if (isDir) {
        // Look for manifest.json or mod.json in directory
        const manifestPaths = [
          path.join(fullPath, 'mod.json'),
          path.join(fullPath, 'manifest.json')
        ];
        let found = false;
        for (const p of manifestPaths) {
          if (fs.existsSync(p)) {
            const content = fs.readFileSync(p, 'utf8');
            const data = JSON.parse(content);
            modMeta = { ...modMeta, ...parseManifest(data) };
            found = true;
            break;
          }
        }
        if (!found) {
          // Guess from directory name
          const guessed = guessFromName(filename.replace('.disabled', ''));
          modMeta.id = guessed.id;
          modMeta.name = guessed.name;
          modMeta.version = guessed.version;
        }
      } else {
        // Read zip/jar manifest
        const zip = new AdmZip(fullPath);
        const entries = zip.getEntries();
        const manifestEntry = entries.find(e => 
          e.entryName === 'mod.json' || 
          e.entryName === 'manifest.json' ||
          e.entryName === 'manifests/mod.json' ||
          e.entryName === 'manifests/manifest.json'
        );

        if (manifestEntry) {
          const content = zip.readAsText(manifestEntry);
          const data = JSON.parse(content);
          modMeta = { ...modMeta, ...parseManifest(data) };
        } else {
          // Guess from filename
          const cleanedName = filename.replace('.disabled', '');
          const guessed = guessFromName(cleanedName);
          modMeta.id = guessed.id;
          modMeta.name = guessed.name;
          modMeta.version = guessed.version;
        }
      }
    } catch (err) {
      logger.warn(`Failed to parse mod manifest for ${filename}: ${err.message}`);
      // Fallback to name guessing
      const cleanedName = filename.replace('.disabled', '');
      const guessed = guessFromName(cleanedName);
      modMeta.id = guessed.id;
      modMeta.name = guessed.name;
      modMeta.version = guessed.version;
    }

    mods.push(modMeta);
  }

  // 3. Perform conflict checks
  const conflicts = [];
  const activeMods = mods.filter(m => m.isActive);

  // Check 1: Duplicate active mods (same ID)
  const idMap = new Map();
  for (const m of activeMods) {
    if (!m.id) continue;
    if (idMap.has(m.id)) {
      const dup = idMap.get(m.id);
      conflicts.push({
        conflict_type: 'duplicate_mod',
        severity: 'critical',
        mod1_name: m.name || m.id,
        mod1_version: m.version,
        mod2_name: dup.name || dup.id,
        mod2_version: dup.version,
        details: `Duplicate mod ID "${m.id}" found in files "${m.filename}" and "${dup.filename}". Hytale cannot load duplicate mods.`,
      });
    } else {
      idMap.set(m.id, m);
    }
  }

  // Check 2: Missing or disabled dependencies & version mismatches
  for (const m of activeMods) {
    if (!m.dependencies) continue;

    for (const [depId, versionConstraint] of Object.entries(m.dependencies)) {
      const installedDep = idMap.get(depId);
      if (!installedDep) {
        // Check if it exists but is disabled
        const disabledDep = mods.find(dm => !dm.isActive && dm.id === depId);
        const details = disabledDep
          ? `Dependency "${depId}" is installed but is currently disabled (${disabledDep.filename}). Please enable it.`
          : `Required dependency "${depId}" (version: ${versionConstraint || 'any'}) is missing. Please install it.`;

        conflicts.push({
          conflict_type: 'missing_dependency',
          severity: 'critical',
          mod1_name: m.name || m.id,
          mod1_version: m.version,
          mod2_name: depId,
          mod2_version: null,
          details,
        });
      } else {
        // Version check (very simple contains/equal check or semver-like check if needed)
        if (versionConstraint && versionConstraint !== '*' && versionConstraint !== 'any') {
          const isMatch = checkVersionConstraint(installedDep.version, versionConstraint);
          if (!isMatch) {
            conflicts.push({
              conflict_type: 'version_mismatch',
              severity: 'warning',
              mod1_name: m.name || m.id,
              mod1_version: m.version,
              mod2_name: installedDep.name || installedDep.id,
              mod2_version: installedDep.version,
              details: `Mod "${m.name}" requires "${depId}" version "${versionConstraint}", but version "${installedDep.version}" is installed.`,
            });
          }
        }
      }
    }
  }

  // Check 3: Explicit incompatibility / conflicts declared by mods
  for (const m of activeMods) {
    if (!m.conflicts || !Array.isArray(m.conflicts)) continue;

    for (const conflictId of m.conflicts) {
      const conflictingMod = idMap.get(conflictId);
      if (conflictingMod) {
        conflicts.push({
          conflict_type: 'incompatible_mods',
          severity: 'critical',
          mod1_name: m.name || m.id,
          mod1_version: m.version,
          mod2_name: conflictingMod.name || conflictingMod.id,
          mod2_version: conflictingMod.version,
          details: `Mod "${m.name}" is incompatible with "${conflictingMod.name}". Running both will cause server instability or crashes.`,
        });
      }
    }
  }

  // 4. Synchronize conflicts database table
  const dbTransaction = db.transaction(() => {
    // Delete existing conflicts for this server
    db.prepare('DELETE FROM mod_conflicts WHERE server_id = ?').run(serverId);

    const insert = db.prepare(`
      INSERT INTO mod_conflicts (server_id, conflict_type, severity, mod1_name, mod1_version, mod2_name, mod2_version, details, detected_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    for (const c of conflicts) {
      insert.run(
        serverId,
        c.conflict_type,
        c.severity,
        c.mod1_name,
        c.mod1_version,
        c.mod2_name,
        c.mod2_version,
        c.details
      );
    }
  });

  dbTransaction();
  
  return conflicts.map(c => ({
    ...c,
    serverId,
  }));
}

// Helpers
function parseManifest(data) {
  // Normalize fields from JSON structure
  const id = data.id || data.modId || data.name?.toLowerCase().replace(/\s+/g, '-');
  const name = data.name || id;
  const version = data.version || '1.0.0';
  
  // Format dependencies to object (modId -> constraint)
  let dependencies = {};
  if (data.dependencies) {
    if (Array.isArray(data.dependencies)) {
      for (const dep of data.dependencies) {
        if (typeof dep === 'string') {
          dependencies[dep] = '*';
        } else if (dep && dep.id) {
          dependencies[dep.id] = dep.version || '*';
        }
      }
    } else if (typeof data.dependencies === 'object') {
      dependencies = data.dependencies;
    }
  }

  // Format conflicts
  let conflicts = [];
  if (data.conflicts) {
    if (Array.isArray(data.conflicts)) {
      conflicts = data.conflicts;
    } else if (typeof data.conflicts === 'object') {
      conflicts = Object.keys(data.conflicts);
    }
  }

  return { id, name, version, dependencies, conflicts };
}

function guessFromName(filename) {
  // Try to parse filename like "mod-name-1.2.3.jar" or "mod_name_v2.0.zip"
  const cleanExt = filename.replace(/\.(jar|zip)$/i, '');
  const match = cleanExt.match(/^(.*?)[-_]v?(\d+\.\d+(?:\.\d+)?.*?)$/i);
  
  if (match) {
    const id = match[1].toLowerCase().replace(/\s+/g, '-');
    const name = match[1].replace(/[-_]/g, ' ');
    const version = match[2];
    return { id, name, version };
  }

  const id = cleanExt.toLowerCase().replace(/\s+/g, '-');
  const name = cleanExt.replace(/[-_]/g, ' ');
  return { id, name, version: '1.0.0' };
}

function checkVersionConstraint(version, constraint) {
  if (!constraint || constraint === '*' || constraint === 'any') return true;
  
  // Simple parse for helper ranges: e.g. ">=1.2.0" or "^1.0.0" or exact "1.2.0"
  const cleanVer = version.trim();
  const cleanConst = constraint.trim();
  
  if (cleanConst.startsWith('>=')) {
    return compareVersions(cleanVer, cleanConst.substring(2)) >= 0;
  }
  if (cleanConst.startsWith('<=')) {
    return compareVersions(cleanVer, cleanConst.substring(2)) <= 0;
  }
  if (cleanConst.startsWith('>')) {
    return compareVersions(cleanVer, cleanConst.substring(1)) > 0;
  }
  if (cleanConst.startsWith('<')) {
    return compareVersions(cleanVer, cleanConst.substring(1)) < 0;
  }
  if (cleanConst.startsWith('^') || cleanConst.startsWith('~')) {
    // Treat caret/tilde as minimum version compatible (greater or equal)
    return compareVersions(cleanVer, cleanConst.substring(1)) >= 0;
  }
  
  return cleanVer === cleanConst;
}

function compareVersions(v1, v2) {
  const parts1 = v1.split(/[-.]/).map(p => parseInt(p, 10) || 0);
  const parts2 = v2.split(/[-.]/).map(p => parseInt(p, 10) || 0);
  
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

module.exports = {
  detectConflicts,
};
