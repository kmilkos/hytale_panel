const config = require('../config');
const logger = require('../utils/logger');
const { HttpError } = require('../middleware/errorHandler');

const BASE_URL = 'https://api.nexusmods.com/v1';
const DEFAULT_GAME = 'hytale';

// Helper to retrieve API key
function getApiKey(db) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('nexus_api_key');
  return row ? row.value : null;
}

// Request helper
async function requestNexus(db, endpoint, options = {}) {
  const apiKey = getApiKey(db);
  if (!apiKey) {
    throw new HttpError(400, 'Nexus Mods API key is not configured. Go to Settings page to add it.');
  }

  const url = `${BASE_URL}${endpoint}`;
  const headers = {
    'Accept': 'application/json',
    'apikey': apiKey,
    ...options.headers,
  };

  logger.debug(`Nexus Mods API Request: ${url}`);
  try {
    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      const errText = await res.text();
      logger.error(`Nexus Mods API error status ${res.status}: ${errText}`);
      throw new HttpError(res.status, `Nexus Mods API error: ${res.statusText}`);
    }
    return await res.json();
  } catch (err) {
    if (err instanceof HttpError) throw err;
    logger.error(`Nexus Mods fetch failed on ${endpoint}`, err);
    throw new HttpError(500, `Network failure reaching Nexus Mods API: ${err.message}`);
  }
}

// Normalizer
function normalizeNexusMod(mod) {
  return {
    id: String(mod.mod_id),
    name: mod.name,
    author: mod.author || 'Unknown',
    summary: mod.summary || '',
    description: mod.description || '',
    downloads: mod.downloads || 0,
    version: mod.version || '1.0.0',
    category: mod.category_name || 'General',
    logoUrl: mod.picture_url || '',
    updatedAt: mod.updated_time || new Date().toISOString(),
    latestFileId: null, // Nexus installs are manual/blocked
    fileName: '',
    fileLength: 0,
    fileFingerprint: null,
    hashes: [],
    sha1: null,
    websiteUrl: `https://www.nexusmods.com/${DEFAULT_GAME}/mods/${mod.mod_id}`,
    source: 'nexus',
  };
}

// Static mock Hytale mods for visual discovery when API is unconfigured/404s
const MOCK_HYTALE_MODS = [
  {
    mod_id: 101,
    name: 'Hytale Essentials Mod',
    author: 'OrbisCrafter',
    summary: 'A compilation of essential tools, UI improvements, and basic command shortcuts for server administrators.',
    description: 'A compilation of essential tools, UI improvements, and basic command shortcuts for server administrators. Features custom tab lists, warp points, and custom player welcome messages.',
    downloads: 12450,
    version: '1.2.0',
    category_name: 'Server Tools',
    picture_url: '',
    updated_time: new Date().toISOString(),
  },
  {
    mod_id: 102,
    name: 'Dungeon & Ruins Pack',
    author: 'AdventureCrafter',
    summary: 'Spawns custom dungeons, ancient temples, and ruins around the Hytale zones with custom loot tables.',
    description: 'Spawns custom dungeons, ancient temples, and ruins around the Hytale zones with custom loot tables. Designed to expand exploration gameplay.',
    downloads: 8720,
    version: '0.9.5-beta',
    category_name: 'World Generation',
    picture_url: '',
    updated_time: new Date().toISOString(),
  },
  {
    mod_id: 103,
    name: 'Advanced Economy System',
    author: 'CoinMaster',
    summary: 'Enables custom physical or virtual currencies, chest shops, player trading interfaces, and database synchronization.',
    description: 'Enables custom physical or virtual currencies, chest shops, player trading interfaces, and database synchronization. Includes web panel integration hooks.',
    downloads: 5410,
    version: '2.0.1',
    category_name: 'Mechanics',
    picture_url: '',
    updated_time: new Date().toISOString(),
  },
  {
    mod_id: 104,
    name: 'Medieval Weapons Expansion',
    author: 'HytaleBlacksmith',
    summary: 'Adds 25+ detailed medieval weapons, shields, and custom dynamic attack animations.',
    description: 'Adds 25+ detailed medieval weapons, shields, and custom dynamic attack animations including broadswords, halberds, and warhammers.',
    downloads: 15300,
    version: '1.0.4',
    category_name: 'Weapons & Armor',
    picture_url: '',
    updated_time: new Date().toISOString(),
  }
];

// Cache search result helper
function cacheMods(db, mods) {
  try {
    const insert = db.prepare(`
      INSERT INTO mod_browser_cache (source, source_mod_id, name, category, version, payload_json, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(source, source_mod_id) DO UPDATE SET
        name = excluded.name,
        category = excluded.category,
        version = excluded.version,
        payload_json = excluded.payload_json,
        synced_at = datetime('now')
    `);
    
    const transaction = db.transaction((modsList) => {
      for (const m of mods) {
        insert.run('nexus', m.id, m.name, m.category, m.version, JSON.stringify(m));
      }
    });
    
    transaction(mods);
  } catch (err) {
    logger.warn('Failed to cache Nexus Mods results in database', err);
  }
}

// Search and list mods
async function searchMods(db, { query = '', categoryId = null, offset = 0, limit = 20 }) {
  const apiKey = getApiKey(db);
  let modsData = [];

  if (!apiKey) {
    // Return filtered mock mods if API key is not configured
    logger.debug('Nexus Mods API key missing, returning mock Hytale mods');
    modsData = MOCK_HYTALE_MODS;
  } else {
    try {
      // Fetch trending mods as standard browse feed
      const endpoint = `/games/${DEFAULT_GAME}/mods/trending.json`;
      const res = await requestNexus(db, endpoint);
      modsData = Array.isArray(res) ? res : [];
    } catch (err) {
      logger.warn(`Failed to fetch live mods from Nexus Mods API: ${err.message}. Falling back to cached database or mock data.`);
      
      // Fallback 1: Query database cache
      try {
        let dbQuery = 'SELECT payload_json FROM mod_browser_cache WHERE source = ?';
        const params = ['nexus'];
        if (query) {
          dbQuery += ' AND name LIKE ?';
          params.push(`%${query}%`);
        }
        const cached = db.prepare(dbQuery).all(...params);
        if (cached.length > 0) {
          return cached.map(row => JSON.parse(row.payload_json));
        }
      } catch (cacheErr) {
        logger.error('Error querying mod_browser_cache', cacheErr);
      }

      // Fallback 2: Mock mods
      modsData = MOCK_HYTALE_MODS;
    }
  }

  // Map and filter results
  let normalized = modsData.map(normalizeNexusMod);

  if (query) {
    const q = query.toLowerCase();
    normalized = normalized.filter(m => 
      m.name.toLowerCase().includes(q) || 
      m.summary.toLowerCase().includes(q) || 
      m.description.toLowerCase().includes(q)
    );
  }

  // Paginate
  const sliced = normalized.slice(offset, offset + limit);

  // Store in cache
  if (apiKey && sliced.length > 0) {
    cacheMods(db, sliced);
  }

  return sliced;
}

async function getMod(db, modId) {
  const apiKey = getApiKey(db);
  if (!apiKey) {
    const mock = MOCK_HYTALE_MODS.find(m => String(m.mod_id) === String(modId));
    if (mock) return normalizeNexusMod(mock);
    throw new HttpError(404, 'Mod not found in offline mock dataset.');
  }

  try {
    const res = await requestNexus(db, `/games/${DEFAULT_GAME}/mods/${modId}.json`);
    return normalizeNexusMod(res);
  } catch (err) {
    // Try to retrieve from database cache
    const row = db.prepare('SELECT payload_json FROM mod_browser_cache WHERE source = ? AND source_mod_id = ?')
      .get('nexus', String(modId));
    if (row) {
      return JSON.parse(row.payload_json);
    }
    throw err;
  }
}

async function getModFiles(db, modId) {
  const apiKey = getApiKey(db);
  if (!apiKey) {
    return [
      {
        id: '1',
        displayName: 'v1.2.0 Release (Manual Install)',
        fileName: 'nexus_mod_install_manually.zip',
        fileLength: 1024 * 1024 * 5,
        releaseDate: new Date().toISOString(),
        hashes: [],
        downloadUrl: `https://www.nexusmods.com/${DEFAULT_GAME}/mods/${modId}`,
        gameVersions: ['1.0.0'],
      }
    ];
  }

  const res = await requestNexus(db, `/games/${DEFAULT_GAME}/mods/${modId}/files.json`);
  const files = res.files || [];
  return files.map(file => ({
    id: String(file.file_id),
    displayName: file.name,
    fileName: file.file_name,
    fileLength: file.size_in_bytes || file.size_kb * 1024,
    releaseDate: file.uploaded_time,
    hashes: [],
    downloadUrl: file.content_preview_link || `https://www.nexusmods.com/${DEFAULT_GAME}/mods/${modId}`,
    gameVersions: [file.version],
  }));
}

module.exports = {
  searchMods,
  getMod,
  getModFiles,
};
