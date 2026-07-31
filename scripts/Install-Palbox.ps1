#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Palbox -- Server-side installer for the Palworld management panel.

.DESCRIPTION
    Extracts the Palbox API, prompts for configuration, writes .env,
    and registers the service with NSSM so it starts automatically.
    Node.js 22 LTS is installed automatically if not already present.

.PARAMETER InstallPath
    Where to install Palbox files. Default: C:\Palbox

.PARAMETER ServiceName
    The Windows service name for the Palbox API. Default: PalboxAPI

.PARAMETER NoService
    Skip NSSM service registration (useful for manual / Docker setups).

.EXAMPLE
    .\Install-Palbox.ps1
    .\Install-Palbox.ps1 -InstallPath "D:\Apps\Palbox" -ServiceName "Palbox"
#>
[CmdletBinding()]
param(
    [string]$InstallPath = 'C:\Palbox',
    [string]$ServiceName = 'PalboxAPI',
    [switch]$NoService
)

Set-StrictMode -Version Latest
# Native commands (nssm, node, winget) write to stderr for informational output which
# would trigger Stop. We only want Stop for PowerShell cmdlet failures, so we manage
# it explicitly around native-command blocks.
$ErrorActionPreference = 'Stop'

# Helper: run a native command, suppress stderr-triggered errors, return combined output
function Invoke-Native {
    param([scriptblock]$Cmd)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $out = & $Cmd 2>&1; return $out }
    finally { $ErrorActionPreference = $prev }
}

# ── Helpers ──────────────────────────────────────────────────────────────────

function Write-Header {
    param([string]$Text)
    Write-Host ""
    Write-Host "  $Text" -ForegroundColor Cyan
    Write-Host ("  " + ("-" * ($Text.Length))) -ForegroundColor DarkGray
}

function Prompt-Value {
    param([string]$Label, [string]$Default = "", [switch]$Password)
    $hint = if ($Default) { " [$Default]" } else { "" }
    if ($Password) {
        $raw   = Read-Host "  $Label$hint" -AsSecureString
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
                     [Runtime.InteropServices.Marshal]::SecureStringToBSTR($raw))
        if (-not $plain -and $Default) { return $Default }
        return $plain
    }
    $val = Read-Host "  $Label$hint"
    if (-not $val) { return $Default }
    return $val
}

# ── Node.js auto-install ──────────────────────────────────────────────────────

function Install-NodeJS {
    # Resolve the latest Node.js 22 LTS version from the dist index
    $nodeVersion = $null
    Write-Host "  Resolving latest Node.js 22 LTS version from nodejs.org ..." -ForegroundColor Gray
    try {
        $index = Invoke-RestMethod 'https://nodejs.org/dist/index.json' -UseBasicParsing
        $lts   = $index | Where-Object { $_.lts -and $_.version -match '^v22\.' } | Select-Object -First 1
        if ($lts) { $nodeVersion = $lts.version.TrimStart('v') }
    } catch {
        Write-Host "  Could not query nodejs.org, using known LTS version." -ForegroundColor Yellow
    }
    if (-not $nodeVersion) { $nodeVersion = '22.23.2' }  # current LTS as of 2026-07-30

    # Try winget first (built into Windows 10 1809+ and Windows 11)
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Host "  Installing Node.js v$nodeVersion LTS via winget ..." -ForegroundColor Gray
        $wg = Start-Process winget `
              -ArgumentList 'install --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements' `
              -Wait -NoNewWindow -PassThru
        if ($wg.ExitCode -eq 0) {
            $env:PATH = [Environment]::GetEnvironmentVariable('PATH','Machine') + ';' +
                        [Environment]::GetEnvironmentVariable('PATH','User')
            Write-Host "  [OK] Node.js installed via winget." -ForegroundColor Green
            return
        }
        Write-Host "  winget returned $($wg.ExitCode) -- falling back to MSI download." -ForegroundColor Yellow
    }

    # Fall back: download the MSI from nodejs.org
    $msiUrl  = "https://nodejs.org/dist/v$nodeVersion/node-v$nodeVersion-x64.msi"
    $msiPath = "$env:TEMP\palbox-node-v$nodeVersion.msi"

    Write-Host "  Downloading Node.js v$nodeVersion LTS from nodejs.org ..." -ForegroundColor Gray
    try {
        Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath -UseBasicParsing
    } catch {
        Write-Host "  [FAIL] Download failed: $_" -ForegroundColor Red
        Write-Host "    Please install Node.js 22 manually: https://nodejs.org" -ForegroundColor Yellow
        exit 1
    }

    Write-Host "  Installing Node.js v$nodeVersion LTS (this may take a minute) ..." -ForegroundColor Gray
    $proc = Start-Process msiexec.exe `
                -ArgumentList "/i `"$msiPath`" /qn /norestart ADDLOCAL=ALL" `
                -Wait -NoNewWindow -PassThru
    Remove-Item $msiPath -Force -ErrorAction SilentlyContinue

    # Exit code 3010 = success, reboot required (safe to ignore for services)
    if ($proc.ExitCode -ne 0 -and $proc.ExitCode -ne 3010) {
        Write-Host "  [FAIL] Node.js MSI install failed (exit code $($proc.ExitCode))." -ForegroundColor Red
        exit 1
    }

    # Refresh PATH in this session
    $env:PATH = [Environment]::GetEnvironmentVariable('PATH','Machine') + ';' +
                [Environment]::GetEnvironmentVariable('PATH','User')

    Write-Host "  [OK] Node.js v$nodeVersion installed." -ForegroundColor Green
}

# ── Banner ────────────────────────────────────────────────────────────────────

Clear-Host
Write-Host ""
Write-Host "  ==========================================" -ForegroundColor Magenta
Write-Host "   PALBOX - Palworld Server Management Panel" -ForegroundColor Magenta
Write-Host "  ==========================================" -ForegroundColor Magenta
Write-Host ""
Write-Host "  Installer v0.2.9" -ForegroundColor White
Write-Host ""

# ── Prerequisites ─────────────────────────────────────────────────────────────

Write-Header "Checking prerequisites"

# ── Node.js ───────────────────────────────────────────────────────────────────
$nodeOk = $false
if (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeVerStr = (Invoke-Native { node --version }).ToString().TrimStart('v')
    $nodeMajor  = [int]($nodeVerStr.Split('.')[0])
    if ($nodeMajor -ge 22) {
        Write-Host "  [OK] Node.js v$nodeVerStr" -ForegroundColor Green
        $nodeOk = $true
    } else {
        Write-Host "  [!]  Node.js v$nodeVerStr found but v22+ is required." -ForegroundColor Yellow
    }
} else {
    Write-Host "  [FAIL] Node.js not found." -ForegroundColor Red
}

if (-not $nodeOk) {
    $installNode = Prompt-Value "Install Node.js 22 LTS automatically? (Y/n)" "Y"
    if ($installNode -eq 'n') {
        Write-Host "  Cannot continue without Node.js 22+." -ForegroundColor Red
        Write-Host "  Please install it from https://nodejs.org and re-run this script." -ForegroundColor Yellow
        exit 1
    }
    Install-NodeJS
    # Re-validate after install
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Host "  [FAIL] node not found on PATH after install. You may need to open a new terminal." -ForegroundColor Red
        exit 1
    }
}

# ── NSSM auto-install ─────────────────────────────────────────────────────────

function Install-NSSM {
    param([string]$NssmDir = 'C:\nssm')

    $zipUrl  = 'https://nssm.cc/release/nssm-2.24.zip'
    $zipPath = "$env:TEMP\nssm-2.24.zip"
    $exePath = Join-Path $NssmDir 'nssm.exe'

    Write-Host "  Downloading NSSM 2.24 from nssm.cc ..." -ForegroundColor Gray
    try {
        Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
    } catch {
        Write-Host "  [FAIL] NSSM download failed: $_" -ForegroundColor Red
        Write-Host "    Please install NSSM manually: https://nssm.cc/download" -ForegroundColor Yellow
        exit 1
    }

    Write-Host "  Extracting NSSM ..." -ForegroundColor Gray
    $extractDir = "$env:TEMP\nssm-extract"
    Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue
    Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
    New-Item -ItemType Directory -Force -Path $NssmDir | Out-Null
    Copy-Item "$extractDir\nssm-2.24\win64\nssm.exe" $exePath -Force
    Remove-Item $zipPath         -Force -ErrorAction SilentlyContinue
    Remove-Item $extractDir      -Recurse -Force -ErrorAction SilentlyContinue

    # Persist to system PATH so NSSM survives reboots
    $machinePath = [Environment]::GetEnvironmentVariable('PATH', 'Machine')
    if ($machinePath -notlike "*$NssmDir*") {
        [Environment]::SetEnvironmentVariable('PATH', "$machinePath;$NssmDir", 'Machine')
    }
    # Refresh PATH in this session immediately
    $env:PATH = [Environment]::GetEnvironmentVariable('PATH','Machine') + ';' +
                [Environment]::GetEnvironmentVariable('PATH','User')

    Write-Host "  [OK] NSSM installed to $exePath" -ForegroundColor Green
}

# ── NSSM prerequisite check ───────────────────────────────────────────────────

if (-not $NoService) {
    if (Get-Command nssm -ErrorAction SilentlyContinue) {
        Write-Host "  [OK] NSSM found" -ForegroundColor Green
    } else {
        Write-Host "  [FAIL] NSSM not found in PATH." -ForegroundColor Red
        $installNssm = Prompt-Value "Install NSSM 2.24 automatically? (Y/n)" "Y"
        if ($installNssm -eq 'n') {
            Write-Host "    Download manually: https://nssm.cc/download" -ForegroundColor Yellow
            $skip = Prompt-Value "Continue without registering a Windows service? (y/N)" "N"
            if ($skip -ne 'y') { exit 1 }
            $NoService = $true
        } else {
            Install-NSSM
            if (-not (Get-Command nssm -ErrorAction SilentlyContinue)) {
                Write-Host "  [FAIL] nssm still not on PATH after install -- please open a new terminal and re-run." -ForegroundColor Red
                exit 1
            }
        }
    }
}

# ── Install path ──────────────────────────────────────────────────────────────

Write-Header "Installation directory"
$InstallPath = Prompt-Value "Install to" $InstallPath
if (-not (Test-Path $InstallPath)) {
    New-Item -ItemType Directory -Force -Path $InstallPath | Out-Null
    Write-Host "  Created $InstallPath" -ForegroundColor Green
} else {
    Write-Host "  Using existing: $InstallPath" -ForegroundColor Yellow
}

# ── Copy files ────────────────────────────────────────────────────────────────

Write-Header "Copying files"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$items = @('api-dist', 'node_modules', 'ui-dist')
foreach ($item in $items) {
    $src = Join-Path $scriptDir $item
    if (-not (Test-Path $src)) {
        Write-Host "  [FAIL] Missing: $src" -ForegroundColor Red
        Write-Host "    Make sure you extracted the full .zip archive." -ForegroundColor Yellow
        exit 1
    }
    $dest = Join-Path $InstallPath $item
    Write-Host "  Copying $item ..." -ForegroundColor Gray
    Copy-Item -Recurse -Force $src $dest
    Write-Host "  [OK] $item" -ForegroundColor Green
}

# ── Configuration wizard ──────────────────────────────────────────────────────

Write-Header "Configuration"
Write-Host "  Press Enter to accept defaults shown in [brackets]." -ForegroundColor DarkGray
Write-Host ""

$adminUser = Prompt-Value "Admin username" "admin"
$adminPass = Prompt-Value "Admin password" "" -Password
while (-not $adminPass) {
    Write-Host "  Password cannot be empty." -ForegroundColor Red
    $adminPass = Prompt-Value "Admin password" "" -Password
}

$rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
$rngBytes = New-Object byte[] 48
$rng.GetBytes($rngBytes)
$jwtSecret = [Convert]::ToBase64String($rngBytes)
$apiPort   = Prompt-Value "API port" "4000"

Write-Host ""
Write-Host "  -- PalServer paths --" -ForegroundColor DarkGray

$palserverDir   = Prompt-Value "PalServer directory"        "C:\PalServer"
$palserverExe   = Prompt-Value "PalServer.exe path"         "$palserverDir\Pal\Binaries\Win64\PalServer-Win64-Shipping-Cmd.exe"
$settingsIni    = Prompt-Value "PalWorldSettings.ini"       "$palserverDir\Pal\Saved\Config\WindowsServer\PalWorldSettings.ini"
$palserviceName = Prompt-Value "PalServer NSSM service name" "PalServer"
$palserverLog   = Prompt-Value "PalServer log file"         "$palserverDir\Pal\Saved\Logs\PalServer.log"

Write-Host ""
Write-Host "  -- RCON --" -ForegroundColor DarkGray

$rconHost = Prompt-Value "RCON host" "127.0.0.1"
$rconPort = Prompt-Value "RCON port" "25575"
$rconPass = Prompt-Value "RCON password" "" -Password

Write-Host ""
Write-Host "  -- Backups --" -ForegroundColor DarkGray

$backupDir  = Prompt-Value "Backup output directory" "C:\PalboxBackups"
$saveDir    = Prompt-Value "Save data directory"     "$palserverDir\Pal\Saved"
$modsDir    = Prompt-Value "Mods directory"          "$palserverDir\Pal\Binaries\Win64\Mods"
$steamcmd   = Prompt-Value "SteamCMD path"           "C:\steamcmd\steamcmd.exe"

Write-Host ""
Write-Host "  -- Discord (optional) --" -ForegroundColor DarkGray

$discordWebhook = Prompt-Value "Discord webhook URL (leave blank to skip)" ""

# ── Write .env ────────────────────────────────────────────────────────────────

Write-Header "Writing configuration"

$envPath = Join-Path $InstallPath '.env'

$envContent = @"
# Palbox configuration -- generated by installer on $(Get-Date -Format 'yyyy-MM-dd HH:mm')

ADMIN_USERNAME=$adminUser
ADMIN_PASSWORD=$adminPass
JWT_SECRET=$jwtSecret
PORT=$apiPort

PALSERVER_DIR=$palserverDir
PALSERVER_EXE=$palserverExe
SETTINGS_INI=$settingsIni
PALSERVER_SERVICE=$palserviceName
PALSERVER_LOG=$palserverLog

RCON_HOST=$rconHost
RCON_PORT=$rconPort
RCON_PASSWORD=$rconPass

BACKUP_DIR=$backupDir
SAVE_DIR=$saveDir
BACKUP_RETENTION_DAYS=7
BACKUP_CRON=0 4 * * *

STEAMCMD_EXE=$steamcmd
MODS_DIR=$modsDir

DISCORD_WEBHOOK=$discordWebhook

PALBOX_SERVICE=$ServiceName
"@

Set-Content -Path $envPath -Value $envContent -Encoding UTF8
Write-Host "  [OK] .env written to $envPath" -ForegroundColor Green

# ── NSSM service ──────────────────────────────────────────────────────────────

if (-not $NoService) {
    Write-Header "Registering Windows service"

    $nodeExe   = (Get-Command node).Source
    $apiScript = Join-Path $InstallPath 'api-dist\index.js'

    $existing = Invoke-Native { nssm status $ServiceName }
    if (($existing -join ' ') -notmatch 'No such service') {
        Write-Host "  Removing existing service '$ServiceName' ..." -ForegroundColor Yellow
        Invoke-Native { nssm stop   $ServiceName } | Out-Null
        Invoke-Native { nssm remove $ServiceName confirm } | Out-Null
    }

    $uiDistPath = Join-Path $InstallPath 'ui-dist'

    Invoke-Native { nssm install $ServiceName $nodeExe $apiScript } | Out-Null
    Invoke-Native { nssm set $ServiceName AppDirectory        $InstallPath } | Out-Null
    Invoke-Native { nssm set $ServiceName AppEnvironmentExtra "DOTENV_CONFIG_PATH=$envPath" "UI_DIST=$uiDistPath" } | Out-Null
    Invoke-Native { nssm set $ServiceName AppStdout           (Join-Path $InstallPath 'palbox.log') } | Out-Null
    Invoke-Native { nssm set $ServiceName AppStderr           (Join-Path $InstallPath 'palbox-error.log') } | Out-Null
    Invoke-Native { nssm set $ServiceName AppRotateFiles      1 } | Out-Null
    Invoke-Native { nssm set $ServiceName AppRotateBytes      10485760 } | Out-Null
    Invoke-Native { nssm set $ServiceName Start               SERVICE_AUTO_START } | Out-Null
    Invoke-Native { nssm set $ServiceName DisplayName         'Palbox - Palworld Server Panel' } | Out-Null
    Invoke-Native { nssm set $ServiceName Description         'Self-hosted Palworld server management API.' } | Out-Null

    Write-Host "  [OK] Service '$ServiceName' registered" -ForegroundColor Green

    $startNow = Prompt-Value "Start service now? (Y/n)" "Y"
    if ($startNow -ne 'n') {
        Invoke-Native { nssm start $ServiceName } | Out-Null
        Start-Sleep -Seconds 2
        $status = (Invoke-Native { nssm status $ServiceName }) -join ''
        Write-Host "  Service status: $status" -ForegroundColor Cyan
    }
}

# ── Done ──────────────────────────────────────────────────────────────────────

$port = $apiPort
Write-Host ""
Write-Host "  ==========================================" -ForegroundColor Magenta
Write-Host "  [OK] Palbox installed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "  Open the panel at: http://localhost:$port" -ForegroundColor White
if (-not $NoService) {
    Write-Host "  Service '$ServiceName' will start automatically on boot." -ForegroundColor White
}
Write-Host "  To edit config: $envPath" -ForegroundColor DarkGray
Write-Host "  ==========================================" -ForegroundColor Magenta
Write-Host ""
