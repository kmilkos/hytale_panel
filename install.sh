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
  
  echo "[*] Installing Git, Curl, Build tools..."
  apt-get install -y git curl build-essential

  # Install Node.js 22 LTS if not present
  if ! command -v node &> /dev/null; then
    echo "[*] Installing Node.js 22 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  else
    echo "[+] Node.js is already installed: $(node -v)"
  fi

  # Install Java JDK (Hytale requirements Java 25 preferred)
  echo "[*] Installing Java JDK..."
  apt-get install -y openjdk-25-jdk-headless || apt-get install -y openjdk-21-jdk-headless || apt-get install -y default-jdk-headless

elif [[ "$OS" == "fedora" || "$OS" == "centos" || "$OS" == "rhel" || "$OS_LIKE" == *"fedora"* || "$OS_LIKE" == *"rhel"* ]]; then
  echo "[*] Installing Git, Curl, Development Tools..."
  dnf groupinstall -y "Development Tools"
  dnf install -y git curl

  # Install Node.js if not present
  if ! command -v node &> /dev/null; then
    echo "[*] Installing Node.js..."
    dnf install -y nodejs npm
  else
    echo "[+] Node.js is already installed: $(node -v)"
  fi

  # Install Java JDK
  echo "[*] Installing Java JDK..."
  dnf install -y java-25-openjdk-headless || dnf install -y java-latest-openjdk-headless || dnf install -y java-17-openjdk-headless
else
  echo "[!] Unsupported OS distribution. Attempting generic package managers installation..."
  # Try to install if package manager commands exist
  if command -v apt-get &> /dev/null; then
    apt-get update && apt-get install -y git nodejs openjdk-25-jdk-headless
  elif command -v dnf &> /dev/null; then
    dnf install -y git nodejs java-latest-openjdk-headless
  else
    echo "[-] Error: Supported package managers (apt, dnf) not found. Install Node.js, Java, and Git manually." >&2
    exit 1
  fi
fi

# Verify dependencies
echo "[*] Verifying runtime dependencies..."
node -v
npm -v
java -version || echo "[!] Java could not be verified automatically."

# Setup Application Workspace
echo "[*] Navigating to: $APP_DIR"
cd "$APP_DIR"

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
