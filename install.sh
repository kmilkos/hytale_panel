#!/bin/bash
# Hytale Cluster Manager - Linux Installer / Uninstaller
# Supports Debian/Ubuntu (APT) and Fedora/CentOS/RHEL (DNF)
set -e

# Ensure running as root
if [ "$EUID" -ne 0 ]; then
  echo "[-] Error: This script must be run as root (sudo)." >&2
  exit 1
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="hytale-manager"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

# UNINSTALL MODE
if [ "$1" == "--uninstall" ]; then
  echo "[*] Uninstalling Hytale Cluster Manager Service..."
  
  if [ -f "$SERVICE_FILE" ]; then
    echo "[*] Stopping service..."
    systemctl stop $SERVICE_NAME || true
    echo "[*] Disabling service..."
    systemctl disable $SERVICE_NAME || true
    echo "[*] Removing systemd unit file..."
    rm -f "$SERVICE_FILE"
    systemctl daemon-reload
    echo "[+] Service wrapper uninstalled successfully."
  else
    echo "[!] Service is not currently installed."
  fi
  exit 0
fi

# INSTALL MODE
echo "[*] Installing dependencies for Hytale Cluster Manager..."

# Detect OS
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS=$ID
  OS_LIKE=$ID_LIKE
else
  echo "[-] Error: Cannot detect Linux distribution details." >&2
  exit 1
fi

echo "[*] Detected OS: $NAME ($VERSION)"

if [[ "$OS" == "debian" || "$OS" == "ubuntu" || "$OS_LIKE" == *"debian"* || "$OS_LIKE" == *"ubuntu"* ]]; then
  echo "[*] Updating apt package lists..."
  apt-get update -y
  
  echo "[*] Installing Git, Curl, Build tools, Python3, and SQLite headers..."
  apt-get install -y git curl build-essential python3 libsqlite3-dev

  # Install Node.js 22 LTS if not present
  if ! command -v node &> /dev/null; then
    echo "[*] Installing Node.js 22 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  else
    echo "[+] Node.js is already installed: $(node -v)"
  fi

  # Install Java JDK (Hytale requirements: Java 25 Adoptium recommended)
  echo "[*] Configuring Eclipse Adoptium package repository for Java 25..."
  apt-get install -y wget apt-transport-https gpg
  wget -qO - https://packages.adoptium.net/artifactory/api/gpg/key/public | gpg --dearmor | tee /etc/apt/trusted.gpg.d/adoptium.gpg > /dev/null
  CODENAME=$(awk -F= '/^VERSION_CODENAME/{print $2}' /etc/os-release)
  if [ -z "$CODENAME" ]; then
    CODENAME=$(lsb_release -cs 2>/dev/null || echo "stable")
  fi
  echo "deb https://packages.adoptium.net/artifactory/deb $CODENAME main" | tee /etc/apt/sources.list.d/adoptium.list
  apt-get update -y

  echo "[*] Installing Eclipse Temurin Java 25 JDK..."
  apt-get install -y temurin-25-jdk || {
    echo "[!] Adoptium package installation failed. Falling back to default repositories..."
    apt-get install -y openjdk-25-jdk-headless || apt-get install -y openjdk-21-jdk-headless || apt-get install -y default-jdk-headless
  }

elif [[ "$OS" == "fedora" || "$OS" == "centos" || "$OS" == "rhel" || "$OS_LIKE" == *"fedora"* || "$OS_LIKE" == *"rhel"* ]]; then
  echo "[*] Installing Git, Curl, Development Tools, Python3, and SQLite headers..."
  dnf groupinstall -y "Development Tools"
  dnf install -y git curl python3 sqlite-devel

  # Install Node.js if not present
  if ! command -v node &> /dev/null; then
    echo "[*] Installing Node.js..."
    dnf install -y nodejs npm
  else
    echo "[+] Node.js is already installed: $(node -v)"
  fi

  # Install Java JDK (Hytale requirements: Java 25 Adoptium recommended)
  echo "[*] Configuring Eclipse Adoptium package repository for Java 25..."
  REPO_OS="$OS"
  if [[ "$OS" == "rocky" || "$OS" == "almalinux" || "$OS" == "centos" ]]; then
    REPO_OS="centos"
  elif [[ "$OS" == "rhel" ]]; then
    REPO_OS="rhel"
  elif [[ "$OS" == "fedora" ]]; then
    REPO_OS="fedora"
  fi

  cat <<EOF > /etc/yum.repos.d/adoptium.repo
[Adoptium]
name=Adoptium
baseurl=https://packages.adoptium.net/artifactory/rpm/${REPO_OS}/\$releasever/\$basearch
enabled=1
gpgcheck=1
gpgkey=https://packages.adoptium.net/artifactory/api/gpg/key/public
EOF

  echo "[*] Installing Eclipse Temurin Java 25 JDK..."
  dnf install -y temurin-25-jdk || {
    echo "[!] Adoptium package installation failed. Falling back to default repositories..."
    dnf install -y java-25-openjdk-headless || dnf install -y java-latest-openjdk-headless || dnf install -y java-17-openjdk-headless
  }
else
  echo "[!] Unsupported OS distribution. Attempting generic package managers installation..."
  # Try to install if package manager commands exist
  if command -v apt-get &> /dev/null; then
    apt-get update && apt-get install -y git curl build-essential python3 libsqlite3-dev nodejs openjdk-25-jdk-headless || apt-get install -y git curl build-essential python3 libsqlite3-dev nodejs default-jdk-headless
  elif command -v dnf &> /dev/null; then
    dnf install -y git curl python3 sqlite-devel nodejs java-25-openjdk-headless || dnf install -y git curl python3 sqlite-devel nodejs java-latest-openjdk-headless
  else
    echo "[-] Error: Supported package managers (apt, dnf) not found. Install Node.js, Java, and Git manually." >&2
    exit 1
  fi
fi

# Verify dependencies
echo "[*] Verifying runtime dependencies..."
echo -n "Node.js: " && node -v
echo -n "NPM: " && npm -v
if command -v java &> /dev/null; then
  echo -n "Java: " && java -version 2>&1 | head -n 1
  JAVA_VER=$(java -version 2>&1 | awk -F '"' '/version/ {print $2}')
  if [[ "$JAVA_VER" != "25"* ]]; then
    echo "[!] Warning: Default system Java is not version 25 (detected: $JAVA_VER)."
    if command -v update-alternatives &> /dev/null; then
      echo "[*] Attempting to select Java 25 default..."
      JAVA_25_BIN=$(update-alternatives --list java 2>/dev/null | grep -E "25|temurin-25" | head -n 1)
      if [ -n "$JAVA_25_BIN" ]; then
        update-alternatives --set java "$JAVA_25_BIN" || true
        echo "[+] Updated default Java to: $(java -version 2>&1 | head -n 1)"
      fi
    fi
  fi
else
  echo "[!] Java is not found in PATH."
fi

# Setup Application Workspace
echo "[*] Navigating to: $APP_DIR"
cd "$APP_DIR"

# Configure default environment variables in backend/.env if missing
ENV_FILE="backend/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "[*] Creating default backend environment file (.env)..."
  cat <<EOF > "$ENV_FILE"
NODE_ENV=production
PORT=5500
HOST=0.0.0.0
DB_PATH=data/hytale-manager.db
SERVERS_DIR=servers
UPLOADS_DIR=uploads
LOG_LEVEL=info
BCRYPT_COST=10
EOF
else
  # Ensure SERVERS_DIR is set to 'servers' to match the root folder relocation
  if grep -q "SERVERS_DIR=" "$ENV_FILE"; then
    echo "[*] Aligning SERVERS_DIR configuration inside .env..."
    sed -i 's|SERVERS_DIR=.*|SERVERS_DIR=servers|' "$ENV_FILE"
  else
    echo "SERVERS_DIR=servers" >> "$ENV_FILE"
  fi
fi

# Configure npm to use python3 for native builds
if command -v python3 &> /dev/null; then
  echo "[*] Configuring NPM to use Python3 for native C++ builds..."
  npm config set python python3
fi

echo "[*] Installing NPM dependencies..."
npm install

echo "[*] Compiling frontend production bundle..."
npm run build

# Configure Systemd daemon service
echo "[*] Creating systemd service file: $SERVICE_FILE"
cat <<EOF > "$SERVICE_FILE"
[Unit]
Description=Hytale Cluster Manager Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${APP_DIR}/backend
ExecStart=$(command -v node) src/server.js
Restart=always
Environment=NODE_ENV=production PORT=5500 HOST=0.0.0.0

[Install]
WantedBy=multi-user.target
EOF

echo "[*] Reloading systemd daemon..."
systemctl daemon-reload

echo "[*] Enabling and starting Hytale Cluster Manager service..."
systemctl enable hytale-manager
systemctl start hytale-manager

echo ""
echo "[+] SUCCESS: Hytale Cluster Manager installed and started successfully!"
echo "[+] You can access the panel at: http://127.0.0.1:5500"
echo "[+] Run log monitoring command: journalctl -u hytale-manager -f"
echo "[+] Uninstall the service at any time by running: sudo ./install.sh --uninstall"
EOF
