[CmdletBinding()]
param (
    [switch]$Uninstall
)

# Setup custom styling and colors
$COLOR_PRIMARY = "`e[1;35m"   # Bold Purple
$COLOR_SECONDARY = "`e[1;36m" # Bold Cyan
$COLOR_SUCCESS = "`e[1;32m"   # Bold Green
$COLOR_WARNING = "`e[1;33m"   # Bold Yellow
$COLOR_ERROR = "`e[1;31m"     # Bold Red
$COLOR_INFO = "`e[1;34m"      # Bold Blue
$COLOR_RESET = "`e[0m"

function Write-LogBanner {
    Write-Host "${COLOR_PRIMARY}"
    Write-Host "  _   _         _        _        ____                  _"
    Write-Host " | | | |_  _ __| |_ __ _| | ___  |  _ \ __ _ _ __   ___| |"
    Write-Host " | |_| | | | '_ \ __/ _\` | |/ _ \ | |_) / _\` | '_ \ / _ \ |"
    Write-Host " |  _  | |_| | | | || (_| | |  __/ |  __/ (_| | | | |  __/ |"
    Write-Host " |_| |_|\__, |_|_|\__\__,_|_|\___| |_|   \__,_|_| |_|\___|_|"
    Write-Host "        |___/"
    Write-Host "        Hytale Panel Installer - Version 1.0.0${COLOR_RESET}`n"
}

function Write-LogStep ($Message) {
    Write-Host "${COLOR_PRIMARY}✦${COLOR_RESET} $Message..."
}

function Write-LogSuccess ($Message) {
    Write-Host "${COLOR_SUCCESS}✔${COLOR_RESET} $Message"
}

function Write-LogInfo ($Message) {
    Write-Host "${COLOR_INFO}ℹ${COLOR_RESET} $Message"
}

function Write-LogWarning ($Message) {
    Write-Host "${COLOR_WARNING}⚠ WARNING: $Message${COLOR_RESET}"
}

function Write-LogError ($Message) {
    Write-Host "${COLOR_ERROR}✖ ERROR: $Message${COLOR_RESET}"
}

# 1. Ensure elevated Administrator privileges
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-LogError "This script must be run as Administrator. Please relaunch PowerShell as Administrator."
    exit 1
}

$TaskName = "HytaleClusterManager"
$APP_DIR = $PSScriptRoot
if (-not $APP_DIR) {
    $APP_DIR = Get-Location
}
$LogPath = Join-Path $APP_DIR "install.log"

# Clean log file on start
if (-not $Uninstall) {
    "=== Hytale Installation Started: $(Get-Date) ===" | Out-File -FilePath $LogPath -Encoding utf8
}

function Invoke-Cmd {
    param(
        [string]$Command
    )
    if ($VerbosePreference -eq 'Continue') {
        Invoke-Expression $Command
    } else {
        # Redirect all streams (standard output, standard error, etc.) to log file
        Invoke-Expression "$Command *>> '$LogPath'"
    }
}

# UNINSTALL MODE
if ($Uninstall) {
    Write-LogBanner
    Write-LogInfo "Uninstalling Hytale Panel service task..."
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task) {
        Write-LogStep "Stopping active instances of the task"
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Write-LogStep "Unregistering scheduled task"
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-LogSuccess "Service task unregistered successfully."
    } else {
        Write-LogWarning "Scheduled task '$TaskName' was not found."
    }
    exit 0
}

# INSTALL MODE
Write-LogBanner
Write-LogInfo "Installing dependencies for Hytale Panel..."
if ($VerbosePreference -ne 'Continue') {
    Write-LogInfo "Detailed installation log is being written to: $LogPath"
}

# Check and install winget package installations
function Install-Dependency {
    param(
        [string]$Name,
        [string]$CheckCommand,
        [string]$WingetId
    )
    
    $installed = Get-Command $CheckCommand -ErrorAction SilentlyContinue
    if ($installed -and $CheckCommand -eq "java") {
        $versionOutput = & java -version 2>&1 | Out-String
        if ($versionOutput -notmatch 'version "25') {
            Write-LogWarning "Found existing Java version, but not Java 25. Upgrading to Adoptium Java 25..."
            $installed = $null
        }
    }

    if (-not $installed) {
        Write-LogStep "Installing $Name via winget"
        Invoke-Cmd "winget install -e --id $WingetId --silent --accept-package-agreements --accept-source-agreements"
        Write-LogSuccess "Successfully installed $Name."
    } else {
        Write-LogSuccess "$Name is already installed."
    }
}

# Install Git, Node.js, and Java Adoptium JDK
Install-Dependency "Git" "git" "Git.Git"
Install-Dependency "Node.js 22 LTS" "node" "OpenJS.NodeJS.LTS"
Install-Dependency "Eclipse Adoptium OpenJDK 25" "java" "EclipseAdoptium.Temurin.25.JDK"

# Refresh PATH environment variable in the current session
Write-LogStep "Refreshing session environment path"
$env:PATH = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User") + ";" + $env:PATH
Write-LogSuccess "Session path refreshed."

# Verify paths resolved
$nodeCheck = Get-Command "node" -ErrorAction SilentlyContinue
$npmCheck = Get-Command "npm" -ErrorAction SilentlyContinue
if (-not $nodeCheck -or -not $npmCheck) {
    Write-LogWarning "Node.js/NPM path could not be resolved automatically in this session. Please close and reopen PowerShell to update paths, then rerun the installer."
    exit 1
}

Write-LogInfo "Node.js version: $((node -v))"
Write-LogInfo "NPM version: $((npm -v))"

# Setup Application Workspaces
Write-LogStep "Navigating to project directory: $APP_DIR"
Set-Location $APP_DIR

# Configure default environment variables in backend/.env if missing
$EnvFile = Join-Path $APP_DIR "backend\.env"
if (-not (Test-Path $EnvFile)) {
    Write-LogStep "Creating default backend environment file (.env)"
    $defaultEnv = @"
NODE_ENV=production
PORT=5500
HOST=0.0.0.0
DB_PATH=data/hytale-manager.db
SERVERS_DIR=servers
UPLOADS_DIR=uploads
LOG_LEVEL=info
BCRYPT_COST=10
"@
    Set-Content -Path $EnvFile -Value $defaultEnv -Encoding utf8
    Write-LogSuccess "Backend environment file created."
} else {
    Write-LogStep "Aligning SERVERS_DIR configuration inside .env"
    $envContent = Get-Content -Path $EnvFile
    $hasServersDir = $false
    for ($i = 0; $i -lt $envContent.Length; $i++) {
        if ($envContent[$i] -match "^SERVERS_DIR=") {
            $envContent[$i] = "SERVERS_DIR=servers"
            $hasServersDir = $true
            break
        }
    }
    if (-not $hasServersDir) {
        $envContent += "SERVERS_DIR=servers"
    }
    Set-Content -Path $EnvFile -Value $envContent -Encoding utf8
    Write-LogSuccess "SERVERS_DIR configuration aligned."
}

Write-LogStep "Installing NPM workspace packages"
Invoke-Cmd "cmd.exe /c 'npm install'"
Write-LogSuccess "Workspace packages installed successfully."

Write-LogStep "Building frontend assets"
Invoke-Cmd "cmd.exe /c 'npm run build'"
Write-LogSuccess "Frontend assets compiled successfully."

# Configure Task Scheduler wrapper service
Write-LogStep "Configuring startup background task service"
$taskCheck = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($taskCheck) {
    Write-LogStep "Cleaning up existing scheduler task"
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# Locate node.exe executable path
$nodePath = (Get-Command "node").Source

$Action = New-ScheduledTaskAction -Execute $nodePath -Argument "src/server.js" -WorkingDirectory "$APP_DIR\backend"
$Trigger = New-ScheduledTaskTrigger -AtStartup
$Principal = New-ScheduledTaskPrincipal -UserId "NT AUTHORITY\SYSTEM" -LogonType ServiceAccount
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Write-LogStep "Registering Scheduled Task '$TaskName' under SYSTEM account"
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings | Out-Null
Write-LogSuccess "Scheduled task registered successfully."

Write-LogStep "Booting the background service task"
Start-ScheduledTask -TaskName $TaskName
Write-LogSuccess "Background service task booted."

Write-Host ""
Write-Host "${COLOR_SUCCESS}================================================================${COLOR_RESET}"
Write-Host "${COLOR_SUCCESS}   SUCCESS: Hytale Panel installed successfully!      ${COLOR_RESET}"
Write-Host "${COLOR_SUCCESS}================================================================${COLOR_RESET}`n"
Write-Host "${COLOR_SECONDARY}➤ Access the panel at: ${COLOR_SUCCESS}http://127.0.0.1:5500${COLOR_RESET}"
Write-Host "${COLOR_SECONDARY}➤ Stop background task: ${COLOR_PRIMARY}Stop-ScheduledTask -TaskName $TaskName${COLOR_RESET}"
Write-Host "${COLOR_SECONDARY}➤ Uninstall service:    ${COLOR_PRIMARY}.\install.ps1 -Uninstall${COLOR_RESET}"
Write-Host ""
