# Hytale Cluster Manager Technical Recreation Specification

This document describes the current Hytale Cluster Manager web app in enough detail for another engineer or AI system to recreate the application from scratch.

## 1. Product summary

Hytale Cluster Manager is a self-hosted web control panel for managing multiple Hytale dedicated server instances from one browser UI. It provides authenticated administration, server lifecycle control, live console streaming, file management, backups, mod browsing/installing, mod compatibility checks, player administration, resource monitoring, and public server listing.

The application is a Node.js monorepo with:

- Backend: Node.js, Express, SQLite, WebSocket.
- Frontend: React, Vite, React Router.
- Runtime target: Linux server with systemd, Node.js 20+, Java 25+ for Hytale servers.

The canonical deployment path is `/opt/hytale-manager`, but the user-facing product name is **Hytale Cluster Manager**.

## 2. Core goals

1. Manage many Hytale server instances from a single dashboard.
2. Keep each server isolated in its own install directory.
3. Provide direct lifecycle controls: install, start, stop, restart.
4. Stream live server console output and allow command input.
5. Help admins diagnose console errors, especially mod/plugin failures.
6. Provide safe file browsing/editing scoped to each server directory.
7. Support Hytale mod management through upload, CurseForge installs, Nexus discovery, conflict scanning, and metadata tracking.
8. Keep the app self-hosted and simple to deploy.
9. Use role-based authentication and audit sensitive actions.

## 3. Repository structure

```text
hytale-manager/
  package.json                  # npm workspace root
  package-lock.json
  README.md
  REASEARCH.md                  # CurseForge CDN/Hytale mod research note
  docs/
    ARCHITECTURE.md
    DEPLOYMENT.md
    SECURITY.md
    TECHNICAL_RECREATION_SPEC.md
  backend/
    package.json
    src/
      server.js                 # Express + HTTP + WebSocket bootstrap
      config/index.js           # env/default config
      db/index.js               # SQLite connection
      db/migrations.js          # schema migrations
      middleware/
        auth.js                 # JWT auth/roles
        errorHandler.js
        notFoundHandler.js
      routes/
        auth.js
        files.js
        mods.js
        public.js
        servers.js
        system.js
        users.js
      services/
        authService.js
        backupService.js
        conflictDetectionService.js
        curseForgeService.js
        fileService.js
        installService.js
        modDownloadService.js
        nexusModsService.js
        serverService.js
        userService.js
      utils/logger.js
      websocket/index.js
    data/                       # runtime SQLite DB, gitignored in production
    servers/                    # managed server installs
  frontend/
    package.json
    index.html
    src/
      api/client.js
      api/endpoints.js
      components/Layout.jsx
      components/ProtectedRoute.jsx
      context/AuthContext.jsx
      hooks/useTheme.js
      hooks/useWebSocket.js
      pages/*.jsx
      styles.css
  scripts/
    deploy*.sh
    setup*.sh
    systemd/hytale-manager.service
```

## 4. Runtime architecture

### 4.1 Backend

The backend is a single Express process. It serves:

- REST API under `/api/*`.
- WebSocket endpoint at `/ws`.
- Built frontend from `frontend/dist` in production.

It opens one SQLite database via `better-sqlite3`, runs migrations at startup, bootstraps an initial admin user, initializes server lifecycle recovery, and attaches WebSocket handling to the same HTTP server.

### 4.2 Frontend

The frontend is a React SPA built with Vite. In development, Vite runs on port `5501` and proxies API/WebSocket requests to the backend on port `5500`. In production, Express serves `frontend/dist`.

### 4.3 Server child processes

Each running Hytale server is a `child_process.spawn()` child tracked in memory by `serverService.js`:

```js
Map<serverId, { proc, startedAt }>
```

Servers are launched from their install directory with:

```text
/bin/bash --norc --noprofile <installPath>/start.sh --bind 0.0.0.0:<port>
```

If `JAVA_HOME` is configured, it is injected into the child process environment.

stdout/stderr are line-buffered, persisted to SQLite, classified for issues, and broadcast over WebSocket.

## 5. Configuration

Backend configuration comes from environment variables with defaults:

| Variable | Purpose |
|---|---|
| `NODE_ENV` | development/production |
| `HOST` | backend bind host |
| `PORT` | backend HTTP/WS port, default 5500 |
| `JWT_SECRET` | JWT signing secret; auto-generated if missing/weak |
| `JWT_EXPIRES_IN` | token lifetime, default `12h` |
| `BCRYPT_COST` | bcrypt work factor |
| `ADMIN_USERNAME` | bootstrap admin username |
| `ADMIN_PASSWORD` | bootstrap admin password or generated |
| `DB_PATH` | SQLite DB path |
| `SERVERS_DIR` | parent directory for server installs |
| `UPLOADS_DIR` | upload temp/staging path |
| `JAVA_HOME` | Java 25+ path for Hytale server processes |
| `LOG_LEVEL` | logger verbosity |

Runtime integrations such as `curseforge_api_key` and `nexus_api_key` are stored in the SQLite `settings` table and managed from the Settings UI.

## 6. Database schema

Migrations are forward-only and stored in `backend/src/db/migrations.js`. A recreation should include at least the following tables.

### 6.1 `schema_migrations`

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 6.2 `users`

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Roles are `admin` and `user`.

### 6.3 `servers`

```sql
CREATE TABLE servers (
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
```

Status values include `stopped`, `running`, `installing`, and `error`.

### 6.4 `server_logs`

```sql
CREATE TABLE server_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  stream TEXT NOT NULL DEFAULT 'stdout',
  line TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_server_logs_server_id ON server_logs(server_id);
```

`stream` values include `stdout`, `stderr`, `system`, and frontend-only `sent`.

### 6.5 `sessions`

Reserved table for future token revocation:

```sql
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 6.6 `audit_log`

```sql
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target TEXT,
  details TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_log_action ON audit_log(action);
```

### 6.7 `settings`

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Keys include:

- `curseforge_api_key`
- `nexus_api_key`

### 6.8 `mod_conflicts`

```sql
CREATE TABLE mod_conflicts (
  id INTEGER PRIMARY KEY,
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
CREATE INDEX idx_mod_conflicts_server_id ON mod_conflicts(server_id);
```

### 6.9 `installed_mods`

```sql
CREATE TABLE installed_mods (
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
CREATE INDEX idx_installed_mods_server_id ON installed_mods(server_id);
CREATE INDEX idx_installed_mods_curseforge ON installed_mods(curseforge_mod_id, curseforge_file_id);
```

This table is currently CurseForge-specific but should be generalized later to `source`, `source_mod_id`, `source_file_id`.

### 6.10 `mod_browser_cache`

```sql
CREATE TABLE mod_browser_cache (
  source TEXT NOT NULL,
  source_mod_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  version TEXT,
  payload_json TEXT NOT NULL,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (source, source_mod_id)
);
CREATE INDEX idx_mod_browser_cache_source_name ON mod_browser_cache(source, name);
CREATE INDEX idx_mod_browser_cache_source_category ON mod_browser_cache(source, category);
CREATE INDEX idx_mod_browser_cache_synced_at ON mod_browser_cache(synced_at);
```

`source` values currently include `curseforge` and `nexusmods`.

## 7. Authentication and authorization

Authentication uses JWT bearer tokens.

- Login verifies bcrypt password hashes.
- Token payload includes user identity/role.
- Token expiry defaults to 12 hours.
- Protected routes use `requireAuth`.
- Admin-only routes use `requireRole('admin')`.
- Auth failures return JSON errors.

Important auth endpoints:

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/login` | username/password login |
| GET | `/api/auth/me` | current user |
| POST | `/api/auth/logout` | client-side logout/audit |
| POST | `/api/auth/change-password` | update own password |

Admin user management endpoints live under `/api/users`.

## 8. REST API surface

All protected routes require `Authorization: Bearer <jwt>` unless explicitly public.

### 8.1 Servers

Base: `/api/servers`

| Method | Path | Description |
|---|---|---|
| GET | `/` | list servers |
| GET | `/:id` | get normalized server record |
| POST | `/` | create server |
| PATCH | `/:id` | update server settings |
| DELETE | `/:id` | delete DB record, not files |
| POST | `/:id/start` | start server child process |
| POST | `/:id/stop` | stop server |
| POST | `/:id/restart` | restart server |
| POST | `/:id/command` | send console command |
| GET | `/:id/logs` | query stored logs |
| GET | `/:id/issues` | classify recent logs and return detected issues |
| GET | `/:id/resources` | live process CPU/RAM/PID/uptime |
| POST | `/:id/install` | install Hytale server files in background |
| GET | `/:id/config` | read server JSON config files |
| PUT | `/:id/config` | write config/bans/permissions/whitelist |
| GET | `/:id/players/online` | send `list`, parse online players |
| POST | `/:id/webhook/test` | send test webhook |

Backups:

| Method | Path | Description |
|---|---|---|
| GET | `/:id/backups` | list backups |
| POST | `/:id/backups` | create backup |
| POST | `/:id/backups/:filename/restore` | restore backup |

### 8.2 Files

Base: `/api/files`

Expected operations:

- list directory scoped to server install path
- read text file
- write text file
- create directory
- rename path
- delete path
- upload files
- download file

Every file operation must include `serverId` and must resolve paths under that server's `install_path`. Never accept absolute paths.

### 8.3 Mods

Base pattern: `/api/servers/:id/mods`

Installed/local mods:

| Method | Path | Description |
|---|---|---|
| GET | `/` | list installed mods, enriched with source/update metadata |
| POST | `/` | upload `.jar` or `.zip` |
| POST | `/:modName/toggle` | enable/disable mod by renaming |
| POST | `/scan` | rescan local mod metadata |
| DELETE | `/:modName?keepData=true` | remove mod, optionally keep companion data dirs |
| POST | `/scan-conflicts` | run conflict/dependency scanner |
| GET | `/conflicts` | list stored conflict results |

Browser/discovery:

| Method | Path | Description |
|---|---|---|
| GET | `/browser/search?q=&category=&limit=&source=` | search source or cached browse results |
| POST | `/browser/sync` | sync latest mods for source into cache |
| GET | `/browser/:modId/files?source=&limit=` | list files/versions |
| POST | `/browser/install` | install selected CurseForge file |

`source` values:

- `curseforge`: automated install source.
- `nexusmods`: authenticated discovery/manual-open source.

Nexus install is intentionally blocked unless direct `.jar`/`.zip` download behavior is verified.

### 8.4 System

Base: `/api/system`

| Method | Path | Description |
|---|---|---|
| GET | `/info` | app/node/host/path info |
| GET | `/stats` | memory/load/disk stats |
| GET | `/audit?limit=` | recent audit entries, admin-only |
| GET | `/settings` | all settings, admin-only |
| PUT | `/settings` | update settings, admin-only |
| GET | `/mod-sources` | configured source status |

`/mod-sources` returns:

```json
{
  "sources": [
    { "id": "curseforge", "name": "CurseForge", "needsConfig": true, "configured": true, "installable": true },
    { "id": "nexusmods", "name": "Nexus Mods", "needsConfig": true, "configured": true, "installable": false }
  ]
}
```

### 8.5 Public

The public API exposes unauthenticated server listing for the landing page. It should not reveal admin-only details or filesystem paths.

## 9. WebSocket protocol

Connect to:

```text
/ws?token=<JWT>&serverId=<id>
```

Client messages:

```json
{ "type": "subscribe", "serverId": 2 }
{ "type": "unsubscribe", "serverId": 2 }
{ "type": "command", "serverId": 2, "command": "list" }
{ "type": "ping" }
```

Server events include:

```json
{
  "type": "log",
  "serverId": 2,
  "stream": "stdout",
  "line": "...",
  "ts": 1779210000000,
  "issue": null
}
```

If a log line is classified as problematic, `issue` is an object:

```json
{
  "severity": "error",
  "type": "dependency",
  "title": "Missing class or library",
  "hint": "A mod may require another mod/library or a different server build.",
  "modFile": "ExampleMod.jar",
  "line": "java.lang.NoClassDefFoundError ..."
}
```

Status events:

```json
{ "type": "status", "serverId": 2, "status": "running" }
```

## 10. Server lifecycle behavior

### 10.1 Create server

When creating a server:

1. Validate name and slug.
2. Ensure slug/name uniqueness.
3. Resolve install path under `SERVERS_DIR`.
4. Create the directory.
5. Insert DB row.

Slug regex:

```text
^[a-z0-9][a-z0-9-]{0,62}$
```

### 10.2 Start server

1. Load server row.
2. Refuse if already running.
3. Validate install path exists.
4. If `start.sh` exists, spawn it through bash.
5. If server has a port, append `--bind 0.0.0.0:<port>`.
6. Store process in running map.
7. Set status `running`.
8. Persist system log.
9. Attach stdout/stderr line buffers.
10. On exit, persist exit log, set status stopped, and apply restart policy.

### 10.3 Stop/restart

Stop sends `SIGTERM`, waits up to 15 seconds, then sends `SIGKILL` if still running. Restart calls stop then start.

### 10.4 Restart policies

`restart_policy` values:

- `never`
- `on-failure`
- `always`

`restart_delay_s` controls delay before auto-restart.

### 10.5 Scheduled restarts

A scheduler checks every minute for servers with `restart_schedule` (`HH:mm`). It sends warning commands before restart and triggers restart near the scheduled time.

## 11. Console issue catcher

The backend classifies each persisted line with `classifyConsoleIssue(line, stream)`.

Detection signals include:

- stream is `stderr`
- `error`
- `exception`
- `fatal`
- `failed`
- `failure`
- `crash`
- `could not`
- `unable to`
- `NoSuchFileException`
- `ClassNotFoundException`
- `NoClassDefFoundError`
- `NullPointerException`
- `IllegalStateException`
- `stacktrace`
- `warn`
- `warning`
- `missing dependency`
- `incompatible`
- `conflict`
- `deprecated`

Mod-likeness signals include:

- `mod`
- `plugin`
- `.jar`
- `dependency`
- `manifest`
- `loader`
- `classpath`
- `permission`
- `resourcepack`
- `datapack`

The classifier returns severity, type, title, hint, optional mod filename, and original line.

The frontend ServerDetail page:

- loads recent issues via `GET /api/servers/:id/issues`
- updates issues live from WebSocket log events
- shows a dismissible issue banner above the console
- highlights problematic console lines

This is advisory and should not perform automatic remediation.

## 12. Online players flow

There is no separate Hytale query protocol integration. Online players are fetched by console command:

1. `GET /api/servers/:id/players/online` is called.
2. Backend checks server exists and is running.
3. It records the latest `server_logs.id`.
4. It sends `list` to the server stdin.
5. It waits briefly, around 1500 ms.
6. It reads new log lines.
7. It parses common player-list formats.
8. It returns `{ running, players, count, max, warning, rawLines, source: 'console-list' }`.

The server Players page has tabs:

- Online
- Whitelist
- Bans
- Permissions

Quick commands with `<player>` placeholders open an online-player picker in ServerDetail.

## 13. File manager security model

All file operations are scoped to a selected server.

Rules:

1. Load server `install_path` from DB.
2. Strip leading slashes from requested relative paths.
3. Resolve joined path with `path.resolve`.
4. Reject if it does not start with `install_path + path.sep`.
5. Use `lstat` for listings.
6. Do not follow symlinks.
7. Cap reads/writes/uploads.
8. Sanitize upload filenames.

## 14. Mod management

### 14.1 Installed mod discovery

Installed mods live under:

```text
<server install path>/Server/mods
```

Supported installed artifact types:

- `.jar`
- `.jar.disabled`
- directories that contain known metadata files

Known directory metadata files:

- `mod.json`
- `hytale.json`
- `fabric.mod.json`
- `plugin.yml`
- `forge.mod.json`

JAR metadata is read from `META-INF/MANIFEST.MF` using `unzip -p`.

Directory metadata is read from JSON/YAML-like files.

Each installed mod entry includes:

```js
{
  name,
  rawName,
  type: 'jar' | 'directory',
  enabled,
  size,
  title,
  version,
  author,
  description,
  dataDirs,
  source,
  sourceModId,
  sourceFileId,
  installedSha1,
  installedAt,
  updateAvailable
}
```

### 14.2 Enable/disable

For JAR files, toggling renames:

```text
mod.jar <-> mod.jar.disabled
```

Directories use a `-disabled` suffix.

### 14.3 Remove

Deleting a mod removes the enabled or disabled artifact. If `keepData=false`, companion data dirs likely matching the JAR base name are also removed. Matching `installed_mods` metadata is deleted.

### 14.4 Upload install

- `.jar` uploads are copied into `Server/mods`.
- `.zip` uploads are extracted into `Server/mods` with `unzip -o`.

### 14.5 Conflict/dependency scanning

`conflictDetectionService.js` scans mod manifests and writes results to `mod_conflicts`.

Manifest parsing supports uppercase and lowercase fields:

- `Name` / `name` / `id`
- `Version` / `version`
- `Dependencies` / `dependencies`
- `OptionalDependencies` / `optionalDependencies` / `optional_dependencies`
- `ServerVersion` / `serverVersion` / `hytale_version`

It ignores Hytale core modules in conflict detection.

## 15. Mod source architecture

### 15.1 Source status

`GET /api/system/mod-sources` reports available sources and whether required API keys are configured.

### 15.2 CurseForge

CurseForge is the primary automated source.

Constants:

```js
BASE_URL = 'https://api.curseforge.com/v1'
GAME_ID = 70216 // Hytale
```

Auth header:

```js
'x-api-key': curseforge_api_key
```

Important methods:

- `searchMods({ query, classId, categoryId, limit, sortField, sortOrder })`
- `getMod(modId)`
- `getModFile(modId, fileId)`
- `getModFiles(modId, { limit })`
- `getModFileDownloadUrl(modId, fileId)`

Mapped mod format:

```js
{
  id,
  name,
  author,
  summary,
  description,
  downloads,
  version,
  category,
  logoUrl,
  updatedAt,
  latestFileId,
  fileName,
  fileLength,
  fileFingerprint,
  hashes,
  sha1,
  latestFile,
  websiteUrl
}
```

### 15.3 CurseForge CDN install pipeline

`installCurseForgeModFromCdn(db, { serverId, installPath, mod, modId, fileId })`:

1. Ensure `Server/mods` exists.
2. Resolve file metadata.
3. Require SHA1 hash.
4. Sanitize file name and require `.jar` or `.zip`.
5. Reject if final file path already exists.
6. Create `.downloads/<fileName>.part`.
7. Use cached CDN URL if present, else resolve via CurseForge API.
8. Download from CDN without API key.
9. Support one resume attempt using `Range`.
10. Emit progress logs every 5% or about every second.
11. Verify SHA1.
12. Parse manifest and emit warnings.
13. Move temp file into final mods dir.
14. Upsert `installed_mods` metadata.
15. Return install result and warnings.

Cached CDN URLs are refreshed on `403`, `404`, or `410`.

### 15.4 Nexus Mods

Nexus Mods is integrated as authenticated discovery.

Constants:

```js
BASE_URL = 'https://api.nexusmods.com/v1'
GAME_DOMAIN = 'hytale'
```

Auth header:

```js
apikey: nexus_api_key
```

Verified endpoints:

- `/games/hytale.json`
- `/games/hytale/mods/latest_added.json`
- `/games/hytale/mods/latest_updated.json`
- `/games/hytale/mods/trending.json`

`/games/hytale/mods.json` returns 404 and should not be used.

Nexus discovery method tries:

1. latest added
2. latest updated
3. trending

Mapped mod format mirrors CurseForge but includes:

```js
source: 'nexusmods'
websiteUrl: `https://www.nexusmods.com/<domain>/mods/<id>`
```

Nexus file listing uses:

```text
/games/hytale/mods/{modId}/files.json
```

Some Nexus mods/files may return 403, e.g. unavailable mods. Handle this gracefully in the UI.

Nexus one-click install is intentionally disabled until direct artifact links and integrity metadata are confirmed reliable.

### 15.5 Persistent browse cache

Search/sync results are stored in `mod_browser_cache` by source. Empty browse queries use the cache. Search queries call the provider and update the cache.

Installed mod update checks prefer exact `installed_mods` CurseForge IDs where available, then fall back to fuzzy name/version matching.

## 16. Frontend pages

### 16.1 Public/Login

- Public landing shows server browser and login card.
- Login page authenticates and stores JWT in local storage/context.

### 16.2 Layout

Sidebar navigation:

- Dashboard
- Servers
- Administrators (`/users`)
- Settings

Branding:

- `Hytale`
- `Cluster Manager`

### 16.3 Dashboard

Shows host/system stats and server overview table with status and IP:port.

### 16.4 Servers page

Lists servers and provides create/navigation actions.

### 16.5 Server detail

Main server management page:

- Header identity
- Status card with large status and radiating circle
  - green when running
  - red when stopped/error
  - white when server files are not installed
- Uptime card
- CPU card
- Memory card
- Controls: start/stop/restart/install
- Navigation: files, backups, mods, config, players, map
- Live console
- Console issue catcher banner
- Search and stream filter
- Download current logs
- Clear local console view
- Quick commands
- Player-targeted command picker
- Command input
- Settings section for autostart/restart policy/scheduled restart/webhook

### 16.6 Mods page

Tabs:

- Installed
- Browse

Installed tab:

- Upload `.jar`/`.zip`
- Scan metadata
- Verify compatibility
- Search installed mods
- Sort by name/size/type
- Toggle enabled
- Remove with optional data-dir preservation
- Show update badges
- Show CurseForge source IDs when known

Browse tab:

- Source selector: CurseForge or Nexus Mods
- Sync latest
- Search
- Category filter
- Limit selector
- Grid of mod cards
- Details modal
- File/version selector
- CurseForge install/update buttons
- Nexus Open-on-Nexus links
- Missing source config warning

### 16.7 Players page

Tabs:

- Online
- Whitelist
- Bans
- Permissions

Online tab calls `/players/online` and displays current players or parser warnings.

Whitelist, bans, and permissions edit files under `Server/` through the config API.

### 16.8 Files page

Filesystem browser scoped to server install directory with text editor and upload/download operations.

### 16.9 Backups page

List/create/restore backups.

### 16.10 Settings page

Sections:

- Account info
- Integrations, admin only:
  - CurseForge API key
  - Nexus Mods API key
- Change password
- System info

### 16.11 Administrators page

Admin-only user management. The navigation label is **Administrators**, even if the component/file remains named `UsersPage`.

## 17. UI design system

The app uses a custom CSS theme in `frontend/src/styles.css`.

Key concepts:

- Hytale/gaming visual style
- cards
- stat cards
- pills
- buttons
- inputs
- console styles
- theme variables
- `pulse-green` animation for running server status indicator

Avoid adding a full UI framework unless recreating intentionally with equivalent custom components.

## 18. Security requirements

1. Never expose unauthenticated admin APIs.
2. All protected routes require JWT.
3. Admin-only actions require role check.
4. Validate HTTP bodies and params with zod or equivalent.
5. Never concatenate user input into shell commands.
6. File operations must stay inside server install path.
7. Do not follow symlinks in file manager.
8. Treat API keys in `settings` as secrets.
9. Treat uploaded/downloaded mods as untrusted code.
10. Keep Nexus installs manual until direct artifacts and integrity metadata are verified.
11. Do not auto-delete server install paths when deleting DB records.

## 19. Deployment model

Production recommended topology:

- Install path: `/opt/hytale-manager`
- Runtime user: `hytale`
- Service: `hytale-manager.service`
- Backend bind: `127.0.0.1:5500`
- Reverse proxy: nginx/caddy with TLS
- Java 25 installed under `/opt/java/25`

The backend serves the built frontend in production.

Deployment scripts support SCP/rsync or git-based deploys. Runtime data that must be preserved:

- `backend/data/`
- `backend/servers/`
- `backend/uploads/`
- `backend/.env`

## 20. Build and run commands

Root package uses npm workspaces.

Development:

```bash
npm run dev
```

This runs backend and frontend concurrently.

Frontend build:

```bash
npm run build
```

Backend syntax checks used during development:

```bash
node --check backend/src/services/serverService.js
node --check backend/src/routes/servers.js
node --check backend/src/routes/mods.js
node --check backend/src/routes/system.js
node --check backend/src/services/curseForgeService.js
node --check backend/src/services/nexusModsService.js
```

## 21. Important implementation details and edge cases

### 21.1 Backend route order

In `servers.js`, specific nested routes like `/:id/players/online`, `/:id/issues`, and `/:id/resources` must be declared before any broader catch-all route if one is added later.

### 21.2 Server detail normalization

`GET /api/servers/:id` must return normalized live state via `getServer()`/`rowToServer()`, not raw DB rows, otherwise status/resource cards will break.

### 21.3 WebSocket command fallback

Frontend sends commands over WebSocket when possible and falls back to `POST /api/servers/:id/command` if WS send fails.

The HTTP route must call:

```js
sendCommand(db, id, command)
```

not `sendCommand(id, command)`.

### 21.4 Online player parser limitations

The online player list is best-effort because it parses console output from `list`. Always return parser warnings and raw lines instead of throwing when format is unknown.

### 21.5 Nexus endpoints

Do not use:

```text
/games/hytale/mods.json
```

It returns 404. Use latest/trending endpoints.

### 21.6 Mod install replacement

Current CurseForge install rejects if a file with the same name already exists. A future update flow should remove/replace the old version safely rather than leaving old files side-by-side.

### 21.7 Project naming

User-facing name is Hytale Cluster Manager. Operational names and paths may still contain `hytale-manager`.

## 22. Minimum recreation checklist

To recreate the app, implement these in order:

1. Node/Express backend with config, logger, SQLite migrations, and error handler.
2. JWT auth, admin bootstrap, users CRUD.
3. Servers CRUD and lifecycle process management.
4. WebSocket log/status stream and command relay.
5. Server logs persistence and console issue classification.
6. React auth context, API client, layout, protected routes.
7. Dashboard and servers pages.
8. Server detail page with status/resource cards, live console, commands, issue catcher.
9. File manager with path safety.
10. Config/players pages.
11. Backup service/pages.
12. Mods page with installed mod listing, upload/toggle/remove.
13. CurseForge service and CDN download installer.
14. Persistent mod browser cache.
15. Nexus Mods discovery source.
16. Settings page for API keys.
17. Docs/deployment/security hardening.

## 23. Suggested future improvements

- Generalize `installed_mods` from CurseForge-specific columns to source-neutral fields.
- Add safe update replacement for CurseForge installs.
- Enable Nexus direct installs only after validating download-link behavior, file extensions, and integrity metadata.
- Add a real Hytale query protocol if the server exposes structured player data.
- Add per-server issue history tables if issue classification should be durable beyond raw logs.
- Add CI checks for frontend build and backend syntax.
