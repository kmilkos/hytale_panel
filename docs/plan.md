# Hytale Server Manager — Build Plan

## Project Goal

A cross-platform desktop application that lets Hytale server operators:
1. Start, stop, and monitor their Hytale server process.
2. Browse and install mods from CurseForge without leaving the app.
3. Edit server configuration files through a form-based UI.
4. Manage multiple server profiles from one place.

Target user: non-technical Hytale community members who want to run a server without touching the command line.

---

## Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Desktop shell | Electron | Cross-platform; Node.js ecosystem; proven for game launchers |
| UI framework | React 18 + Tailwind CSS | Fast iteration; large component ecosystem |
| Local database | SQLite via `better-sqlite3` | Zero-setup; fast; good for config and mod metadata |
| HTTP client | Native `fetch` (Node 21+) | CurseForge API calls; no extra dependency |
| Process management | Node.js `child_process.spawn` | Direct control of the Java subprocess |
| Log streaming | Node.js `readline` on stdout/stderr | Line-buffered, low-latency stream to renderer via IPC |
| File operations | `fs-extra` | Reliable copy/move/backup with promise API |
| Config parsing | `@iarna/toml` + `JSON.parse` | Handle both TOML and JSON server configs |
| Packaging | `electron-builder` | Windows NSIS installer; later Linux AppImage and macOS DMG |
| IPC | Electron `ipcMain` / `ipcRenderer` | Main process ↔ renderer communication |

### Project structure
```
hytale-manager/
├── electron/
│   ├── main.ts           # Electron entry, window management
│   ├── ipc/              # IPC handler modules
│   │   ├── server.ts     # Start/stop/restart handlers
│   │   ├── mods.ts       # Install/uninstall/update handlers
│   │   └── config.ts     # Read/write config handlers
│   ├── services/
│   │   ├── ServerProcess.ts   # Spawns and monitors Java process
│   │   ├── ModManager.ts      # CurseForge API + local mod state
│   │   ├── ConfigParser.ts    # TOML/JSON read-write
│   │   ├── BackupService.ts   # Timestamped snapshots before mutations
│   │   └── DiscoveryClient.ts # Polls official server discovery API
│   └── db/
│       └── schema.ts     # SQLite schema (profiles, installed_mods, log_archive)
├── renderer/
│   ├── pages/
│   │   ├── Dashboard.tsx
│   │   ├── ModBrowser.tsx
│   │   ├── Console.tsx
│   │   └── Settings.tsx
│   └── components/       # Shared UI components
├── shared/
│   └── types.ts          # Shared TypeScript interfaces
└── package.json
```

---

## Database Schema (SQLite)

```sql
-- Server profiles
CREATE TABLE profiles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  jar_path    TEXT NOT NULL,
  server_dir  TEXT NOT NULL,
  jvm_args    TEXT DEFAULT '-Xmx2G -Xms1G',
  port        INTEGER DEFAULT 25565,
  auto_restart INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- Mods installed per profile
CREATE TABLE installed_mods (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id      INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
  curseforge_id   INTEGER NOT NULL,
  file_id         INTEGER NOT NULL,
  name            TEXT NOT NULL,
  version         TEXT NOT NULL,
  file_name       TEXT NOT NULL,
  mod_type        TEXT NOT NULL,  -- 'plugin' | 'pack' | 'early_plugin'
  enabled         INTEGER DEFAULT 1,
  installed_at    TEXT DEFAULT (datetime('now'))
);

-- App-level settings
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Default rows: curseforge_api_key, java_executable_path, theme, notifications_enabled
```

---

## Phase 1 — Core Server Manager (Weeks 1–4)

### Goals
- Working Electron app that can launch and manage a Hytale server process.
- Basic UI shell with sidebar navigation.
- Server profile storage in SQLite.

### Tasks

**Week 1–2: Electron scaffold + profile management**
- Set up Electron + React + Tailwind + TypeScript project (use `electron-vite` template).
- Implement sidebar with 4 nav items: Dashboard, Mods, Console, Settings.
- Build profile CRUD UI: create, rename, delete, switch active profile.
- Store profiles in SQLite. On first run, auto-detect Hytale install path from default OS locations.
- Settings page: Java executable path (auto-detect from `JAVA_HOME`), CurseForge API key input.

**Week 3–4: Server process lifecycle**
- `ServerProcess.ts` service:
  - `start(profile)`: spawn `java [jvm_args] -jar [jar_path]` in the server directory. Capture PID.
  - `stop()`: send `SIGTERM`; after 10s timeout send `SIGKILL`.
  - `restart()`: stop then start.
  - `status()`: returns `'running' | 'stopped' | 'starting' | 'crashed'`.
- Pipe stdout and stderr through `readline` → IPC event `server:log-line` → renderer Console view.
- Dashboard: show server status badge, uptime timer, Start/Stop/Restart buttons, last-exit-code.
- JVM args editor: preset dropdown (Low memory: 1G, Balanced: 2G, High: 4G+) plus raw args text field.
- Java version validator: on profile save, run `java -version` on the configured executable and warn if not Java 25.

### Deliverable
App can start and stop a Hytale server and show its logs in real time.

---

## Phase 2 — Mod Browser and Installer (Weeks 5–8)

### Goals
- Full CurseForge browse/search integration.
- One-click install, uninstall, enable/disable, and update.

### CurseForge API Notes
- Base URL: `https://api.curseforge.com/v1`
- Auth header: `x-api-key: YOUR_KEY`
- Hytale game ID: look up via `GET /games` filtered by slug `hytale` on first run; cache in settings table.
- Key endpoints:
  - `GET /mods/search?gameId={id}&searchFilter={query}&classId={category}&sortField=2&pageSize=20&index={offset}`
  - `GET /mods/{modId}` — mod detail
  - `GET /mods/{modId}/files` — version history
  - `GET /mods/{modId}/files/{fileId}/download-url` — get actual download URL
  - `POST /mods` with body `{ modIds: [...] }` — batch fetch multiple mods

### Tasks

**Week 5–6: Browse and search UI**
- `ModManager.ts` service wrapping all CurseForge API calls with error handling and response caching (5-minute TTL in memory).
- Mod Browser page:
  - Search bar with debounced input (300ms).
  - Category filter: All / Plugins / Packs / Early Plugins.
  - Sort: Most Downloaded / Recently Updated / Newest.
  - Pagination (20 per page, Load More button).
  - Mod card: name, author, short description, download count, last-updated date, mod type badge, Install button (disabled if already installed).
- Mod detail panel (slide-in or modal):
  - Full description (render markdown).
  - Screenshots if available.
  - Version history table: version string, Hytale version compatibility, release date, file size.
  - Dependencies list.

**Week 7–8: Install, uninstall, update**
- Install flow:
  1. Fetch download URL from API.
  2. Stream download to a temp file, show progress bar.
  3. Verify file checksum (CurseForge provides SHA1/MD5 in the file object).
  4. Check `manifest.json` inside the JAR (if plugin) for `hytale_version` compatibility — warn if mismatched.
  5. Move file to the profile's `mods/` folder.
  6. Insert row into `installed_mods` table.
  7. Show success toast.
- Installed mods tab (within Mod Browser):
  - List all installed mods for active profile.
  - Enable/disable toggle: renames file to `filename.jar.disabled` / back (same pattern as manual management).
  - Uninstall: delete file + remove DB row, with confirmation dialog.
  - Update checker: on tab open, batch-fetch latest file IDs from CurseForge for all installed mods; highlight those where `installed file_id < latest file_id`; one-click update (install new version, delete old).
- `BackupService.ts`: before any install/uninstall/update, snapshot the current mods folder to `[server_dir]/.backups/mods/[timestamp]/`.

### Deliverable
Full mod lifecycle — browse, install, enable/disable, update — without leaving the app.

---

## Phase 3 — Config Editor and Profiles (Weeks 9–11)

### Goals
- Form-based config file editor (no raw text required).
- Profile switching with per-profile settings isolation.
- Backup before any config write.

### Tasks

**Week 9–10: Config editor**
- `ConfigParser.ts`: detect file format (TOML vs JSON) by extension; parse to JS object; write back to file preserving comments where possible.
- Config editor page sections (render as grouped form):
  - General: server name, MOTD, max players, port, online mode toggle.
  - World: world name, seed, game mode (survival/creative), difficulty.
  - Performance: view distance, tick rate, max entity count.
  - Advanced: raw key-value fallback table for any unrecognized keys.
- Validation: port must be 1024–65535; seed is optional string; max players must be integer > 0.
- Save button: backup current config → write new config → show diff summary toast.
- "Open in text editor" button for users who want raw access.

**Week 11: Profile system hardening**
- Duplicate profile: copy profile row + mods list + config snapshot to a new profile.
- Import profile: ZIP containing server JAR, mods folder, config files → unpack to new server dir → create profile.
- Export profile: same ZIP format — useful for sharing server setups.
- Profile-level notes field (freetext memo stored in SQLite).
- Profile switcher in the top bar dropdown — switching stops current server if running and warns the user.

### Deliverable
Multiple isolated server profiles, each with their own mods and configs, manageable from one app.

---

## Phase 4 — Dashboard and Monitoring (Weeks 12–14)

### Goals
- Live server metrics.
- Crash detection and auto-restart.
- Official discovery service integration.
- Desktop notifications.

### Tasks

**Week 12: Live metrics**
- Parse log lines to extract:
  - Player join/leave events → maintain live player list.
  - Player count (show in dashboard and system tray tooltip).
  - Warning/error lines → highlight in console and increment error counter.
- Memory usage: parse JVM GC log output if `-Xlog:gc` flag is set, or read `/proc/[pid]/status` on Linux; use `process.memoryMaps()` approximation on Windows.
- Dashboard metrics panel: Uptime, Players Online, RAM Used, Errors (last hour), Warnings (last hour).
- Uptime timer: starts on process spawn, resets on each restart.

**Week 13: Crash detection and auto-restart**
- Detect unexpected exit: `child_process` `'exit'` event with non-zero exit code or `'error'` event.
- On crash:
  1. Set status to `'crashed'`.
  2. Capture last 100 lines of log and store in `log_archive` table with timestamp.
  3. Show crash banner in UI with last error lines.
  4. If `auto_restart` is enabled for the profile: wait 5 seconds, then restart up to `max_restarts` (configurable, default 3) within a 10-minute window. After max restarts reached, give up and alert.
- Crash history view: list of past crashes for the profile, expandable to show captured log tail.

**Week 14: Discovery integration and notifications**
- `DiscoveryClient.ts`:
  - If the user has a discovery token (entered in Settings), poll `https://api.hytale.com/servers/discovery` (or the equivalent endpoint — verify from official docs) every 2 minutes to confirm the server is listed.
  - Show listing status in dashboard: Listed / Hidden / Unverified.
  - Link to the server's CurseForge / official listing page.
- Electron `Notification` API:
  - Server crashed → notification.
  - Mod updates available → notification (checked on app start).
  - Server started/stopped → optional notification (user-configurable).
- System tray icon: right-click menu with Start/Stop/Restart and player count in tooltip.

### Deliverable
Fully featured dashboard with live monitoring, crash recovery, and discovery service visibility.

---

## Phase 5 — Polish and Release (Weeks 15–18)

- Windows NSIS installer via `electron-builder`. Auto-updater using `electron-updater` + GitHub Releases.
- Linux AppImage build.
- macOS DMG build (unsigned initially; notarization later).
- Onboarding wizard: first-run guide — detect Java, locate or download Hytale server JAR, create first profile, enter CurseForge API key.
- Accessibility: keyboard navigation, focus rings, screen-reader labels on all icon-only buttons.
- Dark/light mode following OS preference.
- Localization scaffolding (i18n strings in JSON, English only initially).
- Public beta via GitHub Releases or itch.io.

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Hytale EA updates change server JAR API | High | High | Watch official blog; abstract all Hytale-specific paths behind configurable constants; ship updates quickly |
| Mod folder path changes between EA updates | High | Medium | Store path as user-editable setting with auto-detect on each launch |
| CurseForge API changes or rate limits | Medium | Medium | Cache responses; handle 429 gracefully; pin API version header |
| Java 25 requirement not met on user machine | High | High | Detect on startup; show clear error with Adoptium download link |
| Visual scripting "behavior packs" ship before app is ready | Medium | Low | Design mod installer to be type-agnostic (mod_type column in DB); add new type via config not code change |
| Server source code release reveals config format changes | Medium | Medium | Subscribe to official Hytale blog RSS; maintain a format compatibility matrix in ConfigParser |
| User accidentally corrupts server with bad mod | Medium | High | Mandatory backup before every install/update/uninstall action |
| CurseForge API key management complexity | Low | Medium | Allow a project-level API key bundled with the app (apply via CurseForge developer portal) to avoid requiring users to create keys |

---

## Out of Scope (v1)

- Hytale client launcher (this tool is server-side only).
- Paid/marketplace mod support (CurseForge does not currently have paid Hytale mods).
- Visual scripting behavior pack editor (wait for Hytale to ship the format).
- Remote server management over SSH (v2 candidate).
- Mobile companion app (v2 candidate).
- Multi-server network management (BungeeCord-style proxy) — Hytale does not yet have a proxy server concept.

---

## Immediate Next Steps

1. Confirm current Hytale server JAR download method (via official launcher CLI or manual extraction).
2. Register for a CurseForge API key at `console.curseforge.com` and verify the Hytale `gameId`.
3. Spin up a local Hytale server manually to document the exact startup command, config file locations, and log format.
4. Scaffold the Electron + React + TypeScript project using `electron-vite`.
5. Implement `ServerProcess.ts` as a standalone module with unit tests before wiring to the UI.
