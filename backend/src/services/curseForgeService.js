const config = require('../config');
const logger = require('../utils/logger');
const { HttpError } = require('../middleware/errorHandler');

const BASE_URL = 'https://api.curseforge.com/v1';
const GAME_ID = 70216; // Hytale

function getApiKey(db) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('curseforge_api_key');
  if (!row || !row.value) {
    throw new HttpError(400, 'CurseForge API key is not configured. Go to Settings page to add it.');
  }
  return row.value;
}

/**
 * Build a direct CDN download URL from a numeric fileId and fileName.
 * This mirrors the pattern used by Prism Launcher, MultiMC, and ATLauncher:
 *   https://edge.forgecdn.net/files/{Math.floor(id/1000)}/{id%1000}/{fileName}
 * Works without any API key.
 */
function buildCdnUrl(fileId, fileName) {
  const id = parseInt(fileId, 10);
  const part1 = Math.floor(id / 1000);
  const part2 = id % 1000;
  return `https://edge.forgecdn.net/files/${part1}/${part2}/${encodeURIComponent(fileName)}`;
}

async function requestCF(db, endpoint, options = {}) {
  const apiKey = getApiKey(db);
  const url = `${BASE_URL}${endpoint}`;
  
  const headers = {
    'Accept': 'application/json',
    'x-api-key': apiKey,
    ...options.headers,
  };
  
  logger.debug(`CurseForge API Request: ${url}`);
  
  try {
    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      const errText = await res.text();
      logger.error(`CurseForge API returned error status ${res.status}: ${errText}`);
      throw new HttpError(res.status, `CurseForge API error: ${res.statusText}`);
    }
    return await res.json();
  } catch (err) {
    if (err instanceof HttpError) throw err;
    logger.error(`CurseForge fetch failed on ${endpoint}`, err);
    throw new HttpError(500, `Network failure reaching CurseForge API: ${err.message}`);
  }
}

function normalizeMod(mod) {
  const latestFile = mod.latestFiles && mod.latestFiles[0] ? mod.latestFiles[0] : null;
  const sha1Hash = latestFile && latestFile.hashes ? latestFile.hashes.find(h => h.algo === 1 || h.algo === 'sha1') : null;

  return {
    id: String(mod.id),
    name: mod.name,
    author: mod.authors ? mod.authors.map(a => a.name).join(', ') : 'Unknown',
    summary: mod.summary || '',
    description: mod.description || '',
    downloads: mod.downloadCount || 0,
    version: latestFile ? latestFile.displayName : '',
    category: mod.categories ? mod.categories.map(c => c.name).join(', ') : '',
    logoUrl: mod.logo ? mod.logo.url : '',
    updatedAt: mod.dateModified,
    latestFileId: latestFile ? String(latestFile.id) : null,
    fileName: latestFile ? latestFile.fileName : '',
    fileLength: latestFile ? latestFile.fileLength : 0,
    fileFingerprint: latestFile ? latestFile.fileFingerprint : null,
    hashes: latestFile ? latestFile.hashes : [],
    sha1: sha1Hash ? sha1Hash.value : null,
    websiteUrl: mod.links ? mod.links.websiteUrl : '',
    source: 'curseforge',
  };
}

async function searchMods(db, { query = '', categoryId = null, offset = 0, limit = 20, sortBy = 'featured' }) {
  let endpoint = `/mods/search?gameId=${GAME_ID}&index=${offset}&pageSize=${limit}`;
  if (query) {
    endpoint += `&searchFilter=${encodeURIComponent(query)}`;
  }
  if (categoryId) {
    endpoint += `&classId=${categoryId}`;
  }
  
  let sortField = 1; // Featured
  let sortOrder = 'desc';
  
  if (sortBy === 'popularity') {
    sortField = 6; // TotalDownloads
    sortOrder = 'desc';
  } else if (sortBy === 'latest_updated') {
    sortField = 3; // LastUpdated
    sortOrder = 'desc';
  } else if (sortBy === 'latest_released') {
    sortField = 1; // Featured / Latest Released
    sortOrder = 'desc';
  } else if (sortBy === 'name') {
    sortField = 4; // Name
    sortOrder = 'asc';
  }
  
  endpoint += `&sortField=${sortField}&sortOrder=${sortOrder}`;
  
  const res = await requestCF(db, endpoint);
  return (res.data || []).map(normalizeMod);
}

async function getMod(db, modId) {
  const res = await requestCF(db, `/mods/${modId}`);
  if (!res.data) throw new HttpError(404, 'Mod not found on CurseForge.');
  return normalizeMod(res.data);
}

async function getModFiles(db, modId, { limit = 20 } = {}) {
  const res = await requestCF(db, `/mods/${modId}/files?pageSize=${limit}`);
  return (res.data || []).map(file => ({
    id: String(file.id),
    displayName: file.displayName,
    fileName: file.fileName,
    fileLength: file.fileLength,
    releaseDate: file.fileDate,
    hashes: file.hashes,
    // Use API-provided URL when available; always include CDN fallback
    downloadUrl: file.downloadUrl || buildCdnUrl(file.id, file.fileName),
    cdnUrl: buildCdnUrl(file.id, file.fileName),
    gameVersions: file.gameVersions,
  }));
}

async function getModFile(db, modId, fileId) {
  const res = await requestCF(db, `/mods/${modId}/files/${fileId}`);
  if (!res.data) throw new HttpError(404, 'Mod file not found on CurseForge.');
  return res.data;
}

async function getModFileDownloadUrl(db, modId, fileId, fileName = null) {
  // If no API key is configured, fall back to the keyless CDN URL pattern
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('curseforge_api_key');
  if (!row || !row.value) {
    if (!fileName) {
      throw new HttpError(400, 'CurseForge API key is not configured and no fileName was provided for CDN fallback.');
    }
    const cdnUrl = buildCdnUrl(fileId, fileName);
    logger.info(`No CurseForge API key — using keyless CDN URL for file ${fileId}: ${cdnUrl}`);
    return cdnUrl;
  }

  try {
    const res = await requestCF(db, `/mods/${modId}/files/${fileId}/download-url`);
    if (!res.data) throw new HttpError(404, 'Download URL not resolved by CurseForge.');
    return res.data;
  } catch (err) {
    // If the API call fails but we have a fileName, fall back to CDN construction
    if (fileName) {
      const cdnUrl = buildCdnUrl(fileId, fileName);
      logger.warn(`CurseForge download-url API failed (${err.message}), falling back to CDN URL: ${cdnUrl}`);
      return cdnUrl;
    }
    throw err;
  }
}

module.exports = {
  searchMods,
  getMod,
  getModFiles,
  getModFile,
  getModFileDownloadUrl,
  buildCdnUrl,
};
