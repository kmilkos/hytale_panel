#!/bin/bash
# Hytale Panel - Linux Installer / Uninstaller
# Supports Debian/Ubuntu (APT) and Fedora/CentOS/RHEL (DNF)
set -e

# ANSI Color Codes
COLOR_PRIMARY='\033[1;35m'   # Bold Purple/Magenta
COLOR_SECONDARY='\033[1;36m' # Bold Cyan
COLOR_SUCCESS='\033[1;32m'   # Bold Green
COLOR_WARNING='\033[1;33m'   # Bold Yellow
COLOR_ERROR='\033[1;31m'     # Bold Red
COLOR_INFO='\033[1;34m'      # Bold Blue
COLOR_RESET='\033[0m'

# Formatting helpers
log_banner() {
  echo -e "${COLOR_PRIMARY}"
  cat << 'EOF'
  _   _         _        _        ____                  _ 
 | | | |_  _ __| |_ __ _| | ___  |  _ \ __ _ _ __   ___| |
 | |_| | | | '_ \ __/ _` | |/ _ \ | |_) / _` | '_ \ / _ \ |
 |  _  | |_| | | | || (_| | |  __/ |  __/ (_| | | | |  __/ |
 |_| |_|\__, |_|_|\__\__,_|_|\___| |_|   \__,_|_| |_|\___|_|
        |___/                                             
EOF
  echo -e "        Hytale Panel Installer${COLOR_RESET}\n"
}

log_step() {
  echo -e "${COLOR_PRIMARY}✦${COLOR_RESET} $1..."
}

log_success() {
  echo -e "${COLOR_SUCCESS}✔${COLOR_RESET} $1"
}

log_info() {
  echo -e "${COLOR_INFO}ℹ${COLOR_RESET} $1"
}

log_warning() {
  echo -e "${COLOR_WARNING}⚠ WARNING: $1${COLOR_RESET}"
}

log_error() {
  echo -e "${COLOR_ERROR}✖ ERROR: $1${COLOR_RESET}" >&2
}

# Parse options
VERBOSE=false
UNINSTALL=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --uninstall)
      UNINSTALL=true
      shift
      ;;
    -v|--verbose)
      VERBOSE=true
      shift
      ;;
    -h|--help)
      echo "Hytale Panel Installer"
      echo "Usage: sudo ./install.sh [options]"
      echo "Options:"
      echo "  -v, --verbose     Show detailed output of all installation steps"
      echo "  --uninstall       Uninstall the Hytale Panel service"
      echo "  -h, --help        Show this help message"
      exit 0
      ;;
    *)
      log_error "Unknown option: $1"
      echo "Use -h or --help for usage."
      exit 1
      ;;
  esac
done

# Ensure running as root
if [ "$EUID" -ne 0 ]; then
  log_error "This script must be run as root (sudo)."
  exit 1
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="hytale-manager"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
LOG_FILE="$APP_DIR/install.log"

# Setup cleanup trap to print logs on failure if not in verbose mode
cleanup() {
  local exit_code=$?
  if [ $exit_code -ne 0 ] && [ "$UNINSTALL" = false ] && [ "$VERBOSE" = false ]; then
    echo -e "\n${COLOR_ERROR}✖ ERROR: Installation failed with exit code $exit_code.${COLOR_RESET}"
    echo -e "${COLOR_WARNING}You can check the full installation log here: $LOG_FILE${COLOR_RESET}"
    echo -e "${COLOR_WARNING}Or run the installer with the verbose flag to see full output: sudo ./install.sh -v${COLOR_RESET}"
    echo -e "\n${COLOR_SECONDARY}--- Last 20 lines of the installation log ($LOG_FILE): ---${COLOR_RESET}"
    if [ -f "$LOG_FILE" ]; then
      tail -n 20 "$LOG_FILE"
    else
      echo "No log file found."
    fi
    echo -e "${COLOR_SECONDARY}-------------------------------------------------------${COLOR_RESET}"
  fi
}
trap cleanup EXIT

# Initialize log file
if [ "$UNINSTALL" = false ]; then
  echo "=== Hytale Installation Started: $(date) ===" > "$LOG_FILE"
  if [ "$VERBOSE" = false ]; then
    log_info "Detailed installation log is being written to: $LOG_FILE"
  fi
fi

# Helper to run commands silently or verbosely
run_cmd() {
  local cmd="$1"
  if [ "$VERBOSE" = true ]; then
    eval "$cmd"
  else
    echo "Executing: $cmd" >> "$LOG_FILE"
    eval "$cmd" >> "$LOG_FILE" 2>&1
  fi
}

# UNINSTALL MODE
if [ "$UNINSTALL" = true ]; then
  log_banner
  log_info "Uninstalling Hytale Panel Service..."
  
  if [ -f "$SERVICE_FILE" ]; then
    log_step "Stopping service"
    systemctl stop $SERVICE_NAME || true
    
    log_step "Disabling service"
    systemctl disable $SERVICE_NAME || true
    
    log_step "Removing systemd unit file"
    rm -f "$SERVICE_FILE"
    systemctl daemon-reload
    
    log_success "Service wrapper uninstalled successfully."
  else
    log_warning "Service is not currently installed."
  fi
  exit 0
fi

# INSTALL MODE
log_banner
log_info "Installing dependencies for Hytale Panel..."

# Detect OS
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS=$ID
  OS_LIKE=$ID_LIKE
else
  log_error "Cannot detect Linux distribution details."
  exit 1
fi

log_info "Detected OS: $NAME ($VERSION)"

if [[ "$OS" == "debian" || "$OS" == "ubuntu" || "$OS_LIKE" == *"debian"* || "$OS_LIKE" == *"ubuntu"* ]]; then
  log_step "Updating apt package lists"
  run_cmd "apt-get update -y"
  log_success "Package lists updated"
  
  log_step "Installing Git, Curl, Build tools, Python3, and SQLite headers"
  run_cmd "apt-get install -y git curl build-essential python3 libsqlite3-dev"
  log_success "Development dependencies installed"

  # Install Node.js 22 LTS if not present
  if ! command -v node &> /dev/null; then
    log_step "Installing Node.js 22 LTS"
    run_cmd "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -"
    run_cmd "apt-get install -y nodejs"
    log_success "Node.js 22 LTS installed successfully"
  else
    log_success "Node.js is already installed: $(node -v)"
  fi

  # Install Java JDK (Hytale requirements: Java 25 Adoptium recommended)
  log_step "Configuring Eclipse Adoptium package repository for Java 25"
  run_cmd "apt-get install -y wget apt-transport-https gpg"
  run_cmd "wget -qO - https://packages.adoptium.net/artifactory/api/gpg/key/public | gpg --dearmor | tee /etc/apt/trusted.gpg.d/adoptium.gpg > /dev/null"
  CODENAME=$(awk -F= '/^VERSION_CODENAME/{print $2}' /etc/os-release)
  if [ -z "$CODENAME" ]; then
    CODENAME=$(lsb_release -cs 2>/dev/null || echo "stable")
  fi
  run_cmd "echo \"deb https://packages.adoptium.net/artifactory/deb $CODENAME main\" | tee /etc/apt/sources.list.d/adoptium.list"
  run_cmd "apt-get update -y"
  log_success "Eclipse Adoptium repository configured"

  log_step "Installing Eclipse Temurin Java 25 JDK"
  if run_cmd "apt-get install -y temurin-25-jdk"; then
    log_success "Eclipse Temurin Java 25 JDK installed successfully"
  else
    log_warning "Adoptium package installation failed. Falling back to default repositories..."
    log_step "Attempting openjdk-25-jdk-headless fallback"
    if run_cmd "apt-get install -y openjdk-25-jdk-headless"; then
      log_success "Java 25 JDK installed from fallback"
    else
      log_step "Attempting openjdk-21-jdk-headless fallback"
      if run_cmd "apt-get install -y openjdk-21-jdk-headless"; then
        log_success "Java 21 JDK installed from fallback"
      else
        log_step "Attempting default-jdk-headless fallback"
        run_cmd "apt-get install -y default-jdk-headless"
        log_success "Default JDK installed from fallback"
      fi
    fi
  fi

elif [[ "$OS" == "fedora" || "$OS" == "centos" || "$OS" == "rhel" || "$OS_LIKE" == *"fedora"* || "$OS_LIKE" == *"rhel"* ]]; then
  log_step "Installing Git, Curl, Development Tools, Python3, and SQLite headers"
  run_cmd "dnf groupinstall -y \"Development Tools\""
  run_cmd "dnf install -y git curl python3 sqlite-devel"
  log_success "Development dependencies installed"

  # Install Node.js if not present
  if ! command -v node &> /dev/null; then
    log_step "Installing Node.js"
    run_cmd "dnf install -y nodejs npm"
    log_success "Node.js installed successfully"
  else
    log_success "Node.js is already installed: $(node -v)"
  fi

  # Install Java JDK (Hytale requirements: Java 25 Adoptium recommended)
  log_step "Configuring Eclipse Adoptium package repository for Java 25"
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
  log_success "Eclipse Adoptium repository configured"

  log_step "Installing Eclipse Temurin Java 25 JDK"
  if run_cmd "dnf install -y temurin-25-jdk"; then
    log_success "Eclipse Temurin Java 25 JDK installed successfully"
  else
    log_warning "Adoptium package installation failed. Falling back to default repositories..."
    log_step "Attempting java-25-openjdk-headless fallback"
    if run_cmd "dnf install -y java-25-openjdk-headless"; then
      log_success "Java 25 JDK installed from fallback"
    else
      log_step "Attempting java-latest-openjdk-headless fallback"
      if run_cmd "dnf install -y java-latest-openjdk-headless"; then
        log_success "Latest Java JDK installed from fallback"
      else
        log_step "Attempting java-17-openjdk-headless fallback"
        run_cmd "dnf install -y java-17-openjdk-headless"
        log_success "Java 17 JDK installed from fallback"
      fi
    fi
  fi
else
  log_warning "Unsupported OS distribution. Attempting generic package managers installation..."
  # Try to install if package manager commands exist
  if command -v apt-get &> /dev/null; then
    log_step "Running generic apt-get installation"
    if run_cmd "apt-get update && apt-get install -y git curl build-essential python3 libsqlite3-dev nodejs openjdk-25-jdk-headless"; then
      log_success "Generic apt dependencies installed successfully"
    else
      log_step "Attempting generic apt fallback with default-jdk-headless"
      run_cmd "apt-get install -y git curl build-essential python3 libsqlite3-dev nodejs default-jdk-headless"
      log_success "Generic apt dependencies installed from fallback"
    fi
  elif command -v dnf &> /dev/null; then
    log_step "Running generic dnf installation"
    if run_cmd "dnf install -y git curl python3 sqlite-devel nodejs java-25-openjdk-headless"; then
      log_success "Generic dnf dependencies installed successfully"
    else
      log_step "Attempting generic dnf fallback with java-latest-openjdk-headless"
      run_cmd "dnf install -y git curl python3 sqlite-devel nodejs java-latest-openjdk-headless"
      log_success "Generic dnf dependencies installed from fallback"
    fi
  else
    log_error "Supported package managers (apt, dnf) not found. Install Node.js, Java, and Git manually."
    exit 1
  fi
fi

# Verify dependencies
log_step "Verifying runtime dependencies"
NODE_VER=$(node -v)
NPM_VER=$(npm -v)
log_info "Node.js version: $NODE_VER"
log_info "NPM version: $NPM_VER"

if command -v java &> /dev/null; then
  JAVA_LINE=$(java -version 2>&1 | head -n 1)
  log_info "Java version: $JAVA_LINE"
  JAVA_VER=$(java -version 2>&1 | awk -F '"' '/version/ {print $2}')
  if [[ "$JAVA_VER" != "25"* ]]; then
    log_warning "Default system Java is not version 25 (detected: $JAVA_VER)."
    if command -v update-alternatives &> /dev/null; then
      log_step "Attempting to select Java 25 default automatically"
      JAVA_25_BIN=$(update-alternatives --list java 2>/dev/null | grep -E "25|temurin-25" | head -n 1)
      if [ -n "$JAVA_25_BIN" ]; then
        run_cmd "update-alternatives --set java \"$JAVA_25_BIN\""
        log_success "Updated default Java to: $(java -version 2>&1 | head -n 1)"
      else
        log_info "Java 25 binary not found in update-alternatives. Please configure default version manually if needed."
      fi
    fi
  fi
else
  log_warning "Java is not found in PATH."
fi

# Setup Application Workspace
log_step "Navigating to: $APP_DIR"
cd "$APP_DIR"

# Configure default environment variables in backend/.env if missing
ENV_FILE="backend/.env"
if [ ! -f "$ENV_FILE" ]; then
  log_step "Creating default backend environment file (.env)"
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
  log_success "Backend environment file created"
else
  # Ensure SERVERS_DIR is set to 'servers' to match the root folder relocation
  log_step "Aligning SERVERS_DIR configuration inside backend/.env"
  if grep -q "SERVERS_DIR=" "$ENV_FILE"; then
    run_cmd "sed -i 's|SERVERS_DIR=.*|SERVERS_DIR=servers|' \"$ENV_FILE\""
  else
    run_cmd "echo \"SERVERS_DIR=servers\" >> \"$ENV_FILE\""
  fi
  log_success "SERVERS_DIR configuration aligned"
fi

# Configure npm to use python3 for native builds
if command -v python3 &> /dev/null; then
  log_info "Configuring NPM to use Python3 for native C++ builds"
  export PYTHON=python3
fi

log_step "Installing NPM workspace dependencies"
run_cmd "npm install"
log_success "Workspace dependencies installed successfully"

log_step "Compiling frontend production bundle"
run_cmd "npm run build"
log_success "Frontend production bundle compiled successfully"

# Configure Systemd daemon service
if command -v systemctl &>/dev/null && [ -d /run/systemd/system ]; then
  log_step "Creating systemd service file: $SERVICE_FILE"
  NODE_BIN=$(command -v node || which node || echo "/usr/bin/node")
  cat <<EOF > "$SERVICE_FILE"
[Unit]
Description=Hytale Panel Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${APP_DIR}/backend
ExecStart=$NODE_BIN ${APP_DIR}/backend/src/server.js
Restart=always
Environment="NODE_ENV=production" "PORT=5500" "HOST=0.0.0.0"

[Install]
WantedBy=multi-user.target
EOF

  log_step "Reloading systemd daemon"
  run_cmd "systemctl daemon-reload"

  log_step "Enabling and starting Hytale Panel service"
  run_cmd "systemctl enable hytale-manager"
  run_cmd "systemctl start hytale-manager"
  log_success "Hytale Panel service enabled and started successfully"
else
  log_warning "Systemd is not running or not available. Skipping systemd service setup."
  log_info "You can run the application manually by navigating to ${APP_DIR}/backend and running: node src/server.js"
fi

echo -e "\n${COLOR_SUCCESS}================================================================${COLOR_RESET}"
echo -e "${COLOR_SUCCESS}   SUCCESS: Hytale Panel installed successfully!      ${COLOR_RESET}"
echo -e "${COLOR_SUCCESS}================================================================${COLOR_RESET}\n"
echo -e "${COLOR_SECONDARY}➤ Access the panel at: ${COLOR_SUCCESS}http://127.0.0.1:5500${COLOR_RESET}"
echo -e "${COLOR_SECONDARY}➤ Run log monitoring:   ${COLOR_PRIMARY}journalctl -u hytale-manager -f${COLOR_RESET}"
echo -e "${COLOR_SECONDARY}➤ Uninstall service:    ${COLOR_PRIMARY}sudo ./install.sh --uninstall${COLOR_RESET}"
echo ""
