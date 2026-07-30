#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Palbox — Uninstaller.

.DESCRIPTION
    Stops and removes the Palbox Windows service. Optionally removes installed files.

.PARAMETER ServiceName
    The Windows service name. Default: PalboxAPI

.PARAMETER InstallPath
    Path to Palbox files to remove. Default: C:\Palbox

.PARAMETER RemoveFiles
    If specified, deletes the installation directory and all its contents.

.PARAMETER RemoveData
    If specified, also deletes the database and backups. USE WITH CAUTION.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$ServiceName  = 'PalboxAPI',
    [string]$InstallPath  = 'C:\Palbox',
    [switch]$RemoveFiles,
    [switch]$RemoveData
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Write-Host ""
Write-Host "  Palbox Uninstaller" -ForegroundColor Cyan
Write-Host "  ──────────────────" -ForegroundColor DarkGray
Write-Host ""

# ── Stop & remove service ─────────────────────────────────────────────────────

if (Get-Command nssm -ErrorAction SilentlyContinue) {
    $status = & nssm status $ServiceName 2>&1
    if ($status -notmatch 'No such service') {
        Write-Host "  Stopping service '$ServiceName' ..." -ForegroundColor Yellow
        & nssm stop $ServiceName 2>&1 | Out-Null
        Write-Host "  Removing service '$ServiceName' ..." -ForegroundColor Yellow
        & nssm remove $ServiceName confirm 2>&1 | Out-Null
        Write-Host "  ✓ Service removed." -ForegroundColor Green
    }
    else {
        Write-Host "  Service '$ServiceName' not found — skipping." -ForegroundColor DarkGray
    }
}
else {
    Write-Host "  NSSM not found — checking sc.exe ..." -ForegroundColor Yellow
    & sc.exe stop $ServiceName 2>&1 | Out-Null
    & sc.exe delete $ServiceName 2>&1 | Out-Null
}

# ── Remove files ──────────────────────────────────────────────────────────────

if ($RemoveFiles) {
    if (Test-Path $InstallPath) {
        if ($PSCmdlet.ShouldProcess($InstallPath, 'Remove directory')) {
            Remove-Item -Recurse -Force $InstallPath
            Write-Host "  ✓ Removed $InstallPath" -ForegroundColor Green
        }
    }
    else {
        Write-Host "  Directory not found: $InstallPath" -ForegroundColor DarkGray
    }
}
else {
    Write-Host "  Files kept at $InstallPath (pass -RemoveFiles to delete them)." -ForegroundColor DarkGray
}

if ($RemoveData) {
    $appData = Join-Path $env:APPDATA 'Palbox'
    if (Test-Path $appData) {
        if ($PSCmdlet.ShouldProcess($appData, 'Remove AppData')) {
            Remove-Item -Recurse -Force $appData
            Write-Host "  ✓ Removed AppData at $appData" -ForegroundColor Green
        }
    }
}

Write-Host ""
Write-Host "  ✓ Palbox uninstalled." -ForegroundColor Green
Write-Host ""
