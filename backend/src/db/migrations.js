const logger = require('../utils/logger');

// Define forward-only migrations
const migrations = [
  {
    name: '001_initial_schema',
    up: (db) => {
      // 1. users table
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'user',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);

      // 2. servers table
      db.exec(`
        CREATE TABLE IF NOT EXISTS servers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          description TEXT,
          install_path TEXT NOT NULL,
          port INTEGER,
          status TEXT NOT NULL DEFAULT 'stopped',
          autostart INTEGER NOT NULL DEFAULT 0,
          config_json TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          restart_policy TEXT NOT NULL DEFAULT 'never',
          restart_delay_s INTEGER NOT NULL DEFAULT 10,
          webhook_url TEXT,
          restart_schedule TEXT
        );
      `);

      // 3. server_logs table
      db.exec(`
        CREATE TABLE IF NOT EXISTS server_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
          stream TEXT NOT NULL DEFAULT 'stdout',
          line TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_server_logs_server_id ON server_logs(server_id);
      `);

      // 4. sessions table
      db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);

      // 5. audit_log table
      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          action TEXT NOT NULL,
          target TEXT,
          details TEXT,
          ip TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
      `);

      // 6. settings table
      db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);

      // 7. mod_conflicts table
      db.exec(`
        CREATE TABLE IF NOT EXISTS mod_conflicts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
          conflict_type TEXT NOT NULL,
          severity TEXT NOT NULL,
          mod1_name TEXT NOT NULL,
          mod1_version TEXT,
          mod2_name TEXT,
          mod2_version TEXT,
          details TEXT,
          detected_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_mod_conflicts_server_id ON mod_conflicts(server_id);
      `);

      // 8. installed_mods table
      db.exec(`
        CREATE TABLE IF NOT EXISTS installed_mods (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
          curseforge_mod_id TEXT NOT NULL,
          curseforge_file_id TEXT NOT NULL,
          mod_name TEXT,
          file_name TEXT NOT NULL,
          file_length INTEGER,
          file_fingerprint INTEGER,
          sha1 TEXT,
          cdn_url TEXT,
          cdn_url_resolved_at TEXT,
          manifest_json TEXT,
          installed_path TEXT,
          installed_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(server_id, curseforge_mod_id, curseforge_file_id)
        );
        CREATE INDEX IF NOT EXISTS idx_installed_mods_server_id ON installed_mods(server_id);
        CREATE INDEX IF NOT EXISTS idx_installed_mods_curseforge ON installed_mods(curseforge_mod_id, curseforge_file_id);
      `);

      // 9. mod_browser_cache table
      db.exec(`
        CREATE TABLE IF NOT EXISTS mod_browser_cache (
          source TEXT NOT NULL,
          source_mod_id TEXT NOT NULL,
          name TEXT NOT NULL,
          category TEXT,
          version TEXT,
          payload_json TEXT NOT NULL,
          synced_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (source, source_mod_id)
        );
        CREATE INDEX IF NOT EXISTS idx_mod_browser_cache_source_name ON mod_browser_cache(source, name);
        CREATE INDEX IF NOT EXISTS idx_mod_browser_cache_source_category ON mod_browser_cache(source, category);
        CREATE INDEX IF NOT EXISTS idx_mod_browser_cache_synced_at ON mod_browser_cache(synced_at);
      `);
    }
  },
  {
    name: '002_advanced_features',
    up: (db) => {
      // 1. server_schedules table
      db.exec(`
        CREATE TABLE IF NOT EXISTS server_schedules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          cron_expression TEXT NOT NULL,
          action TEXT NOT NULL,
          action_payload TEXT,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_server_schedules_server_id ON server_schedules(server_id);
      `);

      // 2. user_servers table
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_servers (
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
          PRIMARY KEY (user_id, server_id)
        );
      `);

      // 3. server_metrics table
      db.exec(`
        CREATE TABLE IF NOT EXISTS server_metrics (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
          cpu_percentage REAL NOT NULL,
          ram_bytes INTEGER NOT NULL,
          player_count INTEGER NOT NULL DEFAULT 0,
          recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_server_metrics_server_id_recorded ON server_metrics(server_id, recorded_at);
      `);
    }
  },
  {
    name: '003_system_metrics',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS system_metrics (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          cpu_percentage REAL NOT NULL,
          ram_bytes INTEGER NOT NULL,
          disk_bytes INTEGER NOT NULL,
          active_servers INTEGER NOT NULL DEFAULT 0,
          recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_system_metrics_recorded ON system_metrics(recorded_at);
      `);
    }
  },
  {
    name: '004_add_server_type',
    up: (db) => {
      try {
        db.exec("ALTER TABLE servers ADD COLUMN server_type TEXT DEFAULT 'Survival'");
      } catch (err) {
        logger.warn('Failed to add server_type column, it might already exist:', err.message);
      }
    }
  }
];

function runMigrations(db) {
  // Ensure schema_migrations table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  logger.info('Checking schema migrations...');
  
  const appliedMigrations = db.prepare('SELECT name FROM schema_migrations').all().map(row => row.name);
  
  for (const migration of migrations) {
    if (!appliedMigrations.includes(migration.name)) {
      logger.info(`Applying migration: ${migration.name}`);
      
      const transaction = db.transaction(() => {
        migration.up(db);
        db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(migration.name);
      });
      
      try {
        transaction();
        logger.info(`Successfully applied migration: ${migration.name}`);
      } catch (err) {
        logger.error(`Failed to apply migration: ${migration.name}`, err);
        throw err;
      }
    }
  }
  
  logger.info('Database migrations are up to date.');
}

module.exports = {
  runMigrations,
};
