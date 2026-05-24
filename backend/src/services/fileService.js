const fs = require('fs');
const path = require('path');
const { HttpError } = require('../middleware/errorHandler');

// Enforce path traversal protection
function resolveSafePath(installPath, relPath = '') {
  // Normalize base install path
  const base = path.resolve(installPath);
  
  // Clean relative path (remove leading/trailing slashes, multiple dots, etc.)
  const cleanRel = relPath.replace(/^[\/\\]+/, '');
  
  const resolved = path.resolve(base, cleanRel);
  
  // Strict boundary check: must start with base + path separator (or equal base)
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new HttpError(403, 'Access denied: Path escape detected.');
  }
  
  // Prevent following symlinks if path exists
  if (fs.existsSync(resolved)) {
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink()) {
      throw new HttpError(403, 'Access denied: Symbolic links are not followed.');
    }
  }
  
  return resolved;
}

function listDirectory(installPath, relPath) {
  const safePath = resolveSafePath(installPath, relPath);
  
  if (!fs.existsSync(safePath)) {
    throw new HttpError(404, 'Directory not found.');
  }
  
  const stat = fs.statSync(safePath);
  if (!stat.isDirectory()) {
    throw new HttpError(400, 'Path is not a directory.');
  }
  
  const files = fs.readdirSync(safePath);
  
  return files.map(file => {
    const filePath = path.join(safePath, file);
    const lstat = fs.lstatSync(filePath);
    
    // Skip symlinks
    if (lstat.isSymbolicLink()) return null;
    
    const isDir = lstat.isDirectory();
    return {
      name: file,
      isDir,
      size: isDir ? 0 : lstat.size,
      mtime: lstat.mtime,
    };
  }).filter(Boolean);
}

function readFileText(installPath, relPath) {
  const safePath = resolveSafePath(installPath, relPath);
  
  if (!fs.existsSync(safePath)) {
    throw new HttpError(404, 'File not found.');
  }
  
  const stat = fs.statSync(safePath);
  if (stat.isDirectory()) {
    throw new HttpError(400, 'Path is a directory, not a file.');
  }
  
  // Enforce size limit for editor (e.g. max 5MB)
  if (stat.size > 5 * 1024 * 1024) {
    throw new HttpError(400, 'File is too large to open in the editor (max 5MB).');
  }
  
  return fs.readFileSync(safePath, 'utf8');
}

function writeFileText(installPath, relPath, content) {
  const safePath = resolveSafePath(installPath, relPath);
  
  // Enforce parent folder existence
  const parent = path.dirname(safePath);
  if (!fs.existsSync(parent)) {
    fs.mkdirSync(parent, { recursive: true });
  }
  
  fs.writeFileSync(safePath, content, 'utf8');
}

function createDirectory(installPath, relPath) {
  const safePath = resolveSafePath(installPath, relPath);
  if (fs.existsSync(safePath)) {
    throw new HttpError(400, 'Path already exists.');
  }
  fs.mkdirSync(safePath, { recursive: true });
}

function renamePath(installPath, oldRelPath, newRelPath) {
  const safeOld = resolveSafePath(installPath, oldRelPath);
  const safeNew = resolveSafePath(installPath, newRelPath);
  
  if (!fs.existsSync(safeOld)) {
    throw new HttpError(404, 'Source path not found.');
  }
  if (fs.existsSync(safeNew)) {
    throw new HttpError(400, 'Destination path already exists.');
  }
  
  fs.renameSync(safeOld, safeNew);
}

function deletePath(installPath, relPath) {
  const safePath = resolveSafePath(installPath, relPath);
  
  if (!fs.existsSync(safePath)) {
    throw new HttpError(404, 'Path not found.');
  }
  
  const stat = fs.statSync(safePath);
  if (stat.isDirectory()) {
    fs.rmSync(safePath, { recursive: true, force: true });
  } else {
    fs.unlinkSync(safePath);
  }
}

module.exports = {
  resolveSafePath,
  listDirectory,
  readFileText,
  writeFileText,
  createDirectory,
  renamePath,
  deletePath,
};
