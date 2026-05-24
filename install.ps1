param (
    [switch]$Uninstall
)

# 1. Ensure elevated Administrator privileges
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Error "[-] Error: This script must be run as Administrator. Please relaunch PowerShell as Administrator."
    exit 1
}

$TaskName = "HytaleClusterManager"
$APP_DIR = $PSScriptRoot
if (-not $APP_DIR) {
    $APP_DIR = Get-Location
}

# UNINSTALL MODE
if ($Uninstall) {
    Write-Host "[*] Uninstalling Hytale Cluster Manager service task..."
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task) {
        Write-Host "[*] Stopping active instances of the task..."
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Write-Host "[*] Unregistering scheduled task..."
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "[+] Service task unregistered successfully."
    } else {
        Write-Warning "[!] Scheduled task '$TaskName' was not found."
    }
    exit 0
}

# INSTALL MODE
Write-Host "[*] Installing dependencies for Hytale Cluster Manager..."

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
            Write-Host "[!] Found existing Java version, but not Java 25. Upgrading to Adoptium Java 25..."
            $installed = $null
        }
    }

    if (-not $installed) {
        Write-Host "[*] $Name is missing or outdated. Installing via winget..."
        winget install -e --id $WingetId --silent --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "[!] Winget installation for $Name failed. Please install it manually."
        } else {
            Write-Host "[+] Successfully installed $Name."
        }
    } else {
        Write-Host "[+] $Name is already installed and matches required version."
    }
}

# Install Git, Node.js, and Java Adoptium JDK
Install-Dependency "Git" "git" "Git.Git"
Install-Dependency "Node.js 22 LTS" "node" "OpenJS.NodeJS.LTS"
Install-Dependency "Eclipse Adoptium OpenJDK 25" "java" "EclipseAdoptium.Temurin.25.JDK"

# Refresh PATH environment variable in the current session
Write-Host "[*] Refreshing session environment path..."
$env:PATH = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User") + ";" + $env:PATH

# Verify paths resolved
$nodeCheck = Get-Command "node" -ErrorAction SilentlyContinue
$npmCheck = Get-Command "npm" -ErrorAction SilentlyContinue
if (-not $nodeCheck -or -not $npmCheck) {
    Write-Warning "[!] Node.js/NPM path could not be resolved automatically in this session. Please close and reopen PowerShell to update paths, then rerun the installer."
    exit 1
}

Write-Host "[+] Node.js version: $((node -v))"
Write-Host "[+] NPM version: $((npm -v))"

# Setup Application Workspaces
Write-Host "[*] Navigating to project directory: $APP_DIR"
Set-Location $APP_DIR

Write-Host "[*] Installing NPM workspace packages..."
# Run npm install using cmd.exe to avoid powershell scripts policy locks
cmd.exe /c "npm install"

Write-Host "[*] Building frontend assets..."
cmd.exe /c "npm run build"

# Configure Task Scheduler wrapper service
Write-Host "[*] Configuring startup background task service..."
$taskCheck = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($taskCheck) {
    Write-Host "[*] Found existing task. Cleaning up..."
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# Locate node.exe executable path
$nodePath = (Get-Command "node").Source

$Action = New-ScheduledTaskAction -Execute $nodePath -Argument "src/server.js" -WorkingDirectory "$APP_DIR\backend"
$Trigger = New-ScheduledTaskTrigger -AtStartup
$Principal = New-ScheduledTaskPrincipal -UserId "NT AUTHORITY\SYSTEM" -LogonType ServiceAccount
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Write-Host "[*] Registering Scheduled Task '$TaskName' under SYSTEM..."
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings | Out-Null

Write-Host "[*] Booting the background service task..."
Start-ScheduledTask -TaskName $TaskName

Write-Host ""
Write-Host "[+] SUCCESS: Hytale Cluster Manager installer completed!"
Write-Host "[+] Access the panel at: http://127.0.0.1:5500"
Write-Host "[+] You can stop the panel at any time by stopping task: Stop-ScheduledTask -TaskName $TaskName"
Write-Host "[+] Uninstall the service at any time by running: .\install.ps1 -Uninstall"
