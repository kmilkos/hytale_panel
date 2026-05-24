# Architecture

This document describes the high-level design of the Hytale Cluster Manager:
the process model, the directory layout, and how the major subsystems
(auth, server lifecycle, file manager, WebSocket) fit together.

## Overview

The application is a single Node.js backend serving:

- A JSON REST API at `/api/*`
- A WebSocket endpoint at `/ws`
- The built React SPA (in production)

In development the frontend runs under Vite on port 5501 and proxies
`/api` and `/ws` to the backend on port 5500. In production the backend
alone serves everything on `127.0.0.1:5500` behind a reverse proxy.

## High-level diagram

```
  [ Browser ]
      |
      | HTTPS
      v
  [ Reverse proxy ]  (nginx/caddy, TLS termination)
      |
      | HTTP + WS (127.0.0.1:5500)
      v
  [ Express app          ] ---> API routes (auth, servers, files, system, users)
      |
      |---> WebSocket server (/ws)
      |
      |---> SQLite (better-sqlite3)
      |---> Child processes (spawn game servers)
      |---> Filesystem (/opt/hytale-manager/servers/*)
```

## Directory layout

```
/opt/hytale-manager/
  backend/
    src/
      server.js          # Express + WS bootstrap
      config/           # env loading
      utils/            # logger, etc.
      db/               # SQLite init, migrations
      services/         # auth/server/file services
      middleware/       # auth, error handling
      routes/           # /api/*
      websocket/        # /ws handler
    data/               # SQLite file (gitignored)
    servers/            # one subdir per managed server
    uploads/            # transient upload temp/staging
    .env                # runtime secrets (gitignored)
  frontend/
    src/
      pages/            # route-level views
      components/       # Layout, ProtectedRoute
      hooks/            # useWebSocket, etc.
      context/          # AuthContext
      api/              # fetch client + endpoints
    dist/               # built by vite; served in prod
  scripts/               # admin utilities, systemd unit
  docs/                  # this folder
  README.md
```

## Backend subsystems

### `server.js`

The entry point. It:

1. Loads `.env` and normalizes config (`src/config/index.js`).
2. Initializes SQLite and runs migrations.
3. Bootstraps the admin user (if none exists) and prints the password
   to stderr on first run.
4. Builds the Express app with global middleware (helmet, json parser,
   request logging).
5. Mounts the API routers under `/api`.
6. In production, serves `frontend/dist` as static files with SPA fallback.
7. Attaches the WebSocket server to the HTTP server (same port).
8. Installs the 404 and error handlers last.

### Config (`src/config/index.js`)

Reads env vars, applies defaults, and exposes a frozen `config` object.
If `JWT_SECRET` is missing or too short, it is auto-generated and
persisted back to `.env` so it survives restarts. This file is the
single source of truth for runtime settings; nothing reads `process.env`
directly elsewhere.

### Database (`src/db/*`)

`better-sqlite3` is used for synchronous, single-process access. WAL
mode and `foreign_keys=ON` are set on boot. Migrations are forward-only
and tracked in `schema_migrations`.

Tables:

- `users` (id, username, password_hash, role, timestamps)
- `servers` (id, name, slug, install_path, port, status, autostart,
  config_json, timestamps)
- `server_logs` (id, server_id, stream, line, created_at)
- `sessions` (reserved for future token revocation)
- `audit_log` (user_id, action, target, details, ip, created_at)
- `settings` (key-value store for app-wide settings, including mod source API keys)
- `mod_conflicts` (dependency/version/conflict scan results)
- `installed_mods` (downloaded mod metadata, hashes, CDN URL cache, manifest snapshot)
- `mod_browser_cache` (source-aware CurseForge/Nexus browse cache)

### Auth service (`services/authService.js`)

- `bootstrapAdmin()` creates the initial admin on first run.
- `authenticate()` verifies a username/password with bcrypt.
- `issueToken()` and `verifyToken()` wrap `jsonwebtoken`.
- Passwords never leave this module in plaintext.

### Server service (`services/serverService.js`)

Owns everything lifecycle-related:

- CRUD for server records.
- `startServer()` / `stopServer()` / `restartServer()` manage child processes.
- A module-level `Map` holds running `child_process` handles keyed by
  server id.
- `EventEmitter` (`serverEvents`) emits `log` and `status` events that
  the WebSocket layer subscribes to.
- Logs are line-buffered, written to `server_logs`, classified for error/warning patterns, and broadcast live.
- Console issue classification flags likely mod/plugin/dependency/version failures for the server detail page.
- on SIGTERM / SIGINT, all running children are signaled to stop.

### File service (`services/fileService.js`)

All file operations go through `resolveSafePath(installPath, relPath)`,
which enforces the security boundary. See `SECURITY.md` for the full
threat analysis. This module exposes:

- `listDirectory()`
- `readFileText()`
- `writeFileText()`
- `createDirectory()`
- `renamePath()`
- `deletePath()`
- `resolveForDownload()`, `resolveUploadDestination()`

### Routes (`routes/*`)

One router per resource. Each route validates input with `zod`, calls the
appropriate service, and writes an audit entry where relevant. Errors
are thrown as `HttpError`; the error handler converts them to JSON.

### Mod sources

The mod browser is source-aware. CurseForge is the primary automated install
source: API calls resolve project/file metadata, CDN URLs are downloaded without
API credentials, SHA1 hashes are verified, and manifests are inspected before
moving files into `Server/mods`. Nexus Mods is integrated as an authenticated
API discovery source for Hytale; results can be browsed from the same UI, while
one-click installs remain limited to sources with verified direct `.jar`/`.zip`
download behavior. Browse metadata is cached in `mod_browser_cache` by source.

### WebSocket (`websocket/index.js`)

- Single endpoint at `/ws`. The JWT is passed as a query param
  (`?token=...`) and verified on the HTTP upgrade.
- After upgrade, each socket has a `subs` Set of server ids it wants
  updates for. Client messages (`subscribe`, `unsubscribe`, `command`,
  `ping`) are validated with `zod`.
- The server forwards `serverEvents` (`log`, `status`) to every socket
  that is subscribed to the relevant server id.
- A 30s heartbeat (ws ping) drops dead connections.

## Frontend

### Stack

- React 18, React Router 6, Vite 5.
- No UI framework; a small hand-written design system in `styles.css`.
- State is local to pages; only auth is shared via context.

### Key pieces

- `api/client.js` is a thin `fetch()` wrapper that attaches the JWT,
  throws `ApiError` on non-2xx, and dispatches `api:unauthorized` on
  401s so the auth context can react.
- `api/endpoints.js` groups calls into objects (`AuthAPI`, `ServersAPI`,
  `FilesAPI`, `SystemAPI`, `UsersAPI`).
- `context/AuthContext` holds the current user and token and listens
  for `api:unauthorized`.
- `hooks/useWebSocket.js` manages a reconnecting WS connection with
  exponential backoff and hands events off via callbacks.
- `components/Layout.jsx` provides the sidebar + topbar shell.
  `components/ProtectedRoute.jsx` guards authenticated routes.

### Pages

- `LoginPage` - credentials form.
- `DashboardPage` - host/app stats + server summary.
- `ServersPage` / `ServerCreatePage` / `ServerDetailPage`
  (includes the live console, issue catcher, quick commands, and resource cards).
- `ModsPage` - installed mods, CurseForge installs, Nexus discovery, update hints, conflict scans.
- `PlayersPage` - online players, whitelist, bans, and permissions.
- `FilesPage` - browse, edit, upload, rename, delete.
- `UsersPage` (admin-only) - manage administrators.
- `SettingsPage` - change password, system info, and mod source API keys.
- `NotFoundPage` - 404.

## Deployment flow

1. Copy the project files to the production host (e.g. via `scp`, `rsync`,
   or `git pull`) into `/opt/hytale-manager`.
2. On the production host, run `npm install` in `backend/` and build the
   frontend (`npm run build` in `frontend/`).
3. Secrets and data (`.env`, `backend/data/`, `backend/servers/`) are kept
   outside version control and persist across releases.
4. `systemd` supervises the process: see
   `scripts/systemd/hytale-manager.service`.
5. To reset the admin password run:
   `node scripts/reset-admin-password.js`

## Extension points

- **Backups**: add a route that archives an install path to a dated tar.
- **Scheduled tasks**: e.g. auto-restart at a cutoff time, powered by
  an in-process cron-like scheduler.
- **Multi-host**: the record model already includes `install_path`, so a
  future `host_id` column could support managing servers on remote
  machines over SSH.
- **Metrics export**: expose a Prometheus endpoint alongside `/api`.
- **Integrations**: webhooks/Discord notifications on status changes.
- **Mod sources**: add more provider implementations behind the normalized
  browser/install interface once their APIs expose stable metadata, hashes,
  dependency data, and direct downloadable artifacts.
