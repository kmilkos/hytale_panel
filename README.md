# 🎮 Hytale Cluster Control Panel

A state-of-the-art, high-fidelity dark-themed glassmorphic cluster management dashboard designed to deploy, configure, automate, and monitor dedicated Hytale server instances. Powered by Node.js Express, React, Vite, WebSockets, and Eclipse Temurin OpenJDK 25 GA LTS.

---

## 🚀 Core Features

### 1. Central Installer Cache Pipeline
* **OAuth2 Device Authorization Flow**: Automates platform-specific Hytale Downloader binaries (`hytale-downloader-windows-amd64.exe` / `hytale-downloader-linux-amd64`) to fetch the official Hytale game payloads. Real-time stdout stream capture automatically parses and exposes OAuth2 browser verification links and entry codes inside a persistent settings card.
* **Low-Memory Off-Heap Extraction**: Utilizes native extraction sub-processes (`tar -xf` / PowerShell `Expand-Archive`) to unpack the 1.4 GB game release payload cleanly without Node.js heap memory allocation crashes (`Array buffer allocation failed`).
* **Offline Mock Fallback**: Includes a graceful try-catch structure to generate mock server assets (`Assets.zip` and `Server/HytaleServer.jar`) for offline local developer verification.

### 2. Zero-Footprint Instance Replication
* **Native Symbolic Linking**: Deploys server instances instantaneously by creating native directory junctions on Windows (`junction`) and symlinks on Linux (`dir`) pointing back to the central `shared/` installer cache, preserving storage and keeping deployment footprints to a minimum.
* **Resilient Copy Fallback**: Gracefully falls back to synchronous file duplication if elevated symbolic link creation privileges are absent.

### 3. Interactive Console Terminal & Autocomplete HUD
* **Smart Auto-Scroller**: Stays locked at the bottom scroll boundary as stdout logs stream in, and automatically pauses autoscroll when you scroll up to inspect historical logs. Uses direct element `.scrollTop` binding to avoid document-level jumping.
* **Interactive Parsed Web Links**: Automatically parses RCON authentication URLs and helper web links inside log lines using regular expression tokenizers and wraps them into styled clickable anchor tags targeting a new tab (`target="_blank"` with `rel="noopener noreferrer"`).
* **RCON Command Autocomplete overlay**: Exposes a floating suggestion dropdown positioned directly above the input box. Traverses options using `ArrowUp`/`ArrowDown` keys, cancels with `Escape`, and autocompletes using the `Tab` key (or direct click), offering visual `"Press Tab"` highlights.

### 4. Visual JSON Configuration Editor
* **Dual-Column Configuration Dashboard**: The left side configures standard JVM flags, server ports, webhook endpoints, and cron restarts. The right side renders a visual JSON configurator syncing directly to Hytale's `server.json` (Server Name, Description, Max Players, Bind Address, and Whitelist toggles) with uninstalled/graceful state fallbacks.

### 5. Multi-Role Scoping Permission Matrix
* **Role Hierarchies**: Locks down panel controls dynamically according to logged-in user tiers:
  * **Admin**: Master administrative controls (User management, server deletion danger zone, global updates check).
  * **Operator**: Process control actions (Start, Stop, Restart), configuration editing, schedules management, and backups control.
  * **Viewer**: Read-only visualization access (Input command disabled, forms, toggles, deletion, and settings buttons locked).
* **REST Security**: Middleware authorization scopes (`requireServerAccess` / `requireRole`) protect all Express API routes against unauthorized requests.

### 6. Cron Task Automation Scheduler
* **Standard 5-Field Matcher**: Custom matched regex crontab scheduler supporting cron templates (minutes, hours, day-of-month, month, day-of-week).
* **Automated Actions**: Schedules fully automated server actions including restarts, zip backups creation, and injecting commands directly into the server process stdin stream.

### 7. Real-Time Resource SVG Graphs
* **Background Metrics Collector**: A background ticker polling metrics (CPU utilization, RSS memory usage in bytes, online players) for active server PIDs on a 30s loop.
* **Dynamic Charting**: Responsive green CPU and blue RAM SVG charts displaying utilization graphs over the last 2 hours, built with zero-metric division guards.

### 8. Platform Auto-Start & Update Alerts
* **Template Generation**: Automatically creates auto-start service configurations (systemd files for Linux and PowerShell scheduled tasks templates for Windows).
* **Manifest Checks**: Checks current panels builds against GitHub releases, alerting administrators of newer releases.

---

## 🛠️ Technology Stack

* **Frontend**: React, Vite, Vanilla HSL CSS Variables, dark themed glassmorphic UI.
* **Backend**: Node.js Express, SQLite (`better-sqlite3`), WebSockets (`ws`), dotenv, custom class winston logger.
* **Runtime JDK**: Adoptium Eclipse Temurin OpenJDK 25 GA LTS.
* **Process Manager**: `nodemon` (with custom watch isolation to prevent database file loops).

---

## 📂 Repository Structure

```text
hytale_panel/
├── backend/                  # Node.js Express Backend API
│   ├── data/                 # SQLite database storage (ignored by git)
│   ├── servers/              # Managed Hytale instance files (ignored by git)
│   ├── src/
│   │   ├── config/           # Environment configuration maps
│   │   ├── db/               # SQLite connection and schema migrations
│   │   ├── middleware/       # Auth guards, HTTP error handlers
│   │   ├── routes/           # REST endpoints routers
│   │   ├── services/         # Installer pipelines, process metrics, cron managers
│   │   └── server.js         # API & Websocket upgrade bootstrap
│   └── nodemon.json          # Isolated nodemon directories watcher config
├── frontend/                 # Vite + React Frontend Client
│   ├── src/
│   │   ├── views/            # Dashboard view, System settings, Server details panel
│   │   ├── App.jsx           # Routing mapping
│   │   └── index.css         # Core CSS custom tokens and glassmorphism styling
│   └── vite.config.js        # Vite bundler parameters
├── shared/                   # Hytale Central shared cache (Assets.zip / Server/)
├── java-25/                  # Local Java 25 GA JDK environment (ignored by git)
├── .gitignore                # Lightweight git tree directory filters
├── package.json              # Monorepo workspaces definition
└── README.md                 # Main documentation hub
```

---

## ⚙️ Installation & Setup

### 1. Prerequisites
Ensure you have **Node.js (v22+)** and **Git** installed on the host system.

### 2. Clone and Install Dependencies
```bash
# Clone the repository
git clone https://github.com/kmilkos/hytale_panel.git
cd hytale_panel

# Install monorepo dependencies
npm install
```

### 3. Environment Configuration
Create a `.env` file inside the `backend/` directory based on the following template:
```env
NODE_ENV=development
PORT=5600
HOST=127.0.0.1
DB_PATH=data/hytale-manager.db
SERVERS_DIR=servers
UPLOADS_DIR=uploads
LOG_LEVEL=info
BCRYPT_COST=10

# Adoptium Java 25 JDK path (Backend prepends this to spawned subprocess paths)
JAVA_HOME=c:/hytale_panel/java-25/jdk-25.0.3+9
```

### 4. Running the Development Servers
Run the development servers concurrently for both workspaces from the root folder:
```bash
npm run dev
```
* **Frontend Dashboard**: `http://localhost:5173`
* **Express Backend API**: `http://127.0.0.1:5600`

---

## 🎮 RCON Autocomplete Console Commands

| Command | Subcommands / Parameters | Effect |
| :--- | :--- | :--- |
| `/auth` | `status`, `login`, `select`, `logout`, `cancel`, `persistence` | Manage server OAuth2 authentication states |
| `/gamemode` | `adventure`, `creative`, `survival`, `spectator` | Toggle players active game mode |
| `/heal` | — | Refills stamina and health parameters to max |
| `/help` | — | Displays command help console logs |
| `/inventory` | — | Manage active players item inventories |
| `/op` | `self`, `add (player)`, `remove (player)` | Manage operator permissions |
| `/spawning` | — | Commands related to NPC spawning |
| `/stop` | `[--options]` | Stops the active server process |
| `/ban` | `(username) [--options]` | Bans a player from the server |
| `/unban` | `(username)` | Removes a player's ban |
| `/kick` | `(username)` | Disconnects an active player |
| `/kill` | — | Kills and respawns the target player |
| `/hide` | — | Hides or shows players to others |
| `/maxplayers`| `[--options]` | Overrides maximum server slot capacities |
| `/refer` | `(host) (port) [--options]` | Refers player to another cluster host for testing |
| `/tp` | `(player) (x) (y) (z)` | Teleports players to specific coordinates |

---

## 🛡️ Git Staging Rules

All massive binary files are excluded in the root `.gitignore` file to keep the repository under 10 MB:
* **Excluded**: `node_modules/`, `shared/` (1.4 GB caches), `java-25/`, `backend/servers/` (instance duplicates), `backend/data/` (SQLite databases), and all `.log` or `.env` configuration keys.
* **Contribution Workflow**: Stage and commit lightweight files only. Avoid pushing local `.env` keys or absolute installation paths to ensure cross-platform compatibility.
