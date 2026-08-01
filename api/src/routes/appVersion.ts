import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';
import https from 'https';

const router = Router();

// ── Version resolution ────────────────────────────────────────────────────────
// Priority:
//  1. api-dist/version.json  — stamped by CI into the server package
//  2. api/package.json       — available in monorepo dev / Electron
//  3. npm_package_version    — npm-injected env var
function readCurrentVersion(): string {
  // 1. version.json next to the compiled routes (written by CI into api-dist/)
  const vJsonPath = join(__dirname, '../version.json');
  if (existsSync(vJsonPath)) {
    try {
      const vj = JSON.parse(readFileSync(vJsonPath, 'utf8')) as { version?: string };
      if (vj.version) return vj.version;
    } catch {}
  }
  // 2. package.json two levels up (monorepo dev: api/dist/routes → api/package.json)
  try {
    const pkgPath = join(__dirname, '../../package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    if (pkg.version) return pkg.version;
  } catch {}
  // 3. npm env var fallback
  return process.env.npm_package_version ?? '0.0.0';
}

const CURRENT_VERSION = readCurrentVersion();
const REPO = 'JaredScar/Palbox-Manager';
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`;

interface Cache { latest: string; url: string; assets: ReleaseAsset[]; checkedAt: number }
interface ReleaseAsset { name: string; browser_download_url: string; size: number }
let cache: Cache | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function semverGt(a: string, b: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const [aM, am, ap] = parse(a);
  const [bM, bm, bp] = parse(b);
  if (aM !== bM) return aM > bM;
  if (am !== bm) return am > bm;
  return ap > bp;
}

async function fetchLatest(force = false): Promise<Cache> {
  const now = Date.now();
  if (!force && cache && now - cache.checkedAt < CACHE_TTL_MS) return cache;
  const r = await fetch(RELEASES_API, { headers: { 'User-Agent': 'Palbox-Manager/1.0' } });
  if (!r.ok) throw new Error(`GitHub API ${r.status}`);
  const data = await r.json() as { tag_name: string; html_url: string; assets: ReleaseAsset[] };
  cache = {
    latest:    data.tag_name.replace(/^v/, ''),
    url:       data.html_url,
    assets:    data.assets ?? [],
    checkedAt: now,
  };
  return cache;
}

// ── GET /api/app-version ──────────────────────────────────────────────────────
// Pass ?force=true to bypass the in-memory cache and hit GitHub directly.
// Used by the manual "Check for updates" button.
router.get('/', requireAuth, async (req, res) => {
  const force = req.query.force === 'true';
  try {
    const info = await fetchLatest(force).catch(() => null);
    const latest = info?.latest ?? CURRENT_VERSION;
    res.json({
      current:         CURRENT_VERSION,
      latest,
      updateAvailable: semverGt(latest, CURRENT_VERSION),
      releaseUrl:      info?.url ?? `https://github.com/${REPO}/releases/latest`,
    });
  } catch {
    res.json({
      current:         CURRENT_VERSION,
      latest:          CURRENT_VERSION,
      updateAvailable: false,
      releaseUrl:      `https://github.com/${REPO}/releases/latest`,
    });
  }
});

// ── POST /api/app-version/update — headless server self-update ────────────────
// Strategy:
//  1. Download the latest palbox-server-*.zip (in this Node process, before responding).
//  2. Write apply-update.ps1 to a fixed, space-free path.
//  3. Spawn PowerShell as a fully detached process with stdio ignored.
//     The detached + unref() combo means the child survives NSSM killing Node.
//  4. Respond 200 to the browser immediately — the panel goes quiet in ~8s.
router.post('/update', requireAuth, async (_req, res) => {
  if (os.platform() !== 'win32') {
    res.status(400).json({ error: 'Self-update is only supported on Windows server deployments.' });
    return;
  }

  try {
    const info = await fetchLatest();
    if (!semverGt(info.latest, CURRENT_VERSION)) {
      res.json({ ok: true, message: 'Already on the latest version.' });
      return;
    }

    // Find the server ZIP asset
    const asset = info.assets.find((a) => /^palbox-server-.+\.zip$/i.test(a.name));
    if (!asset) {
      res.status(404).json({ error: 'Server ZIP asset not found in the latest release.' });
      return;
    }

    // ── Paths — kept short and space-free to avoid PowerShell quoting hell ─
    const installDir    = process.env.PALBOX_INSTALL_DIR ?? process.cwd();
    const palboxService = process.env.PALBOX_SERVICE ?? 'PalboxManager';
    const updateDir     = 'C:\\PalboxUpdate';
    const zipPath       = path.join(updateDir, asset.name);
    const extractDir    = path.join(updateDir, 'extracted');
    const psScript      = path.join(updateDir, 'apply-update.ps1');
    // Log lives in the SAME directory as the PS script — this is guaranteed
    // writable (we just created it above). Using installDir caused the detached
    // PowerShell process to silently fail because the CWD may differ at runtime.
    const logFile       = path.join(updateDir, 'update.log');
    const transcriptFile = path.join(updateDir, 'transcript.log');

    fs.mkdirSync(updateDir, { recursive: true });

    // ── Write the first log lines from Node so there is always a trail ──────
    const firstLine = `${new Date().toISOString()}  Palbox update to v${info.latest} initiated -- downloading ${asset.name}\r\n`;
    fs.writeFileSync(logFile, firstLine, 'utf8');

    // ── Download ZIP (follow GitHub CDN redirects) ─────────────────────────
    await new Promise<void>((resolve, reject) => {
      const follow = (url: string, redirects = 0) => {
        if (redirects > 10) { reject(new Error('Too many redirects')); return; }
        https.get(url, { headers: { 'User-Agent': 'Palbox-Manager/1.0' } }, (resp) => {
          const loc = resp.headers.location;
          if (resp.statusCode && resp.statusCode >= 300 && resp.statusCode < 400 && loc) {
            resp.resume(); follow(loc, redirects + 1); return;
          }
          if (resp.statusCode !== 200) {
            resp.resume(); reject(new Error(`Download failed: HTTP ${resp.statusCode}`)); return;
          }
          const out = fs.createWriteStream(zipPath);
          resp.pipe(out);
          out.on('finish', resolve);
          out.on('error', reject);
        }).on('error', reject);
      };
      follow(asset.browser_download_url);
    });

    fs.appendFileSync(logFile, `${new Date().toISOString()}  Download complete (${(fs.statSync(zipPath).size / 1024 / 1024).toFixed(1)} MB)\r\n`);

    // ── Write apply-update.ps1 ─────────────────────────────────────────────
    // Escape single-quote-sensitive strings for PS single-quoted literals
    const esc = (s: string) => s.replace(/'/g, "''");

    const ps = `# Palbox self-update -- ${new Date().toISOString()}
$ErrorActionPreference = 'Continue'
$logFile      = '${esc(logFile)}'
$transcriptF  = '${esc(transcriptFile)}'
$zipPath      = '${esc(zipPath)}'
$extractDir   = '${esc(extractDir)}'
$installDir   = '${esc(installDir)}'
$svcName      = '${esc(palboxService)}'

# Start-Transcript captures EVERYTHING -- failsafe if Log() ever misfires
try { Start-Transcript -Path $transcriptF -Append -Force | Out-Null } catch {}

# Log() uses .NET file I/O directly -- no PS host/output-stream dependency
function Log {
  param($m)
  $ts   = [System.DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
  $line = "$ts  $m\`r\`n"
  try {
    [System.IO.File]::AppendAllText($logFile, $line, [System.Text.Encoding]::UTF8)
  } catch {
    # If the primary log write fails, at least transcript has it
  }
  Write-Host $m  # also captured by transcript
}

Log '=== apply-update.ps1 started ==='
Log "installDir : $installDir"
Log "svcName    : $svcName"
Log "zipPath    : $zipPath"

# Stopping and starting a service needs Administrator. When Palbox runs as a
# service under LocalSystem this is already true, but when it is started by
# hand from an ordinary shell the child inherits that unprivileged token and
# every service call below fails. Say so plainly rather than failing obscurely.
$isAdmin = $false
try {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $isAdmin = (New-Object Security.Principal.WindowsPrincipal $id).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
} catch {}
Log "user       : $([Environment]::UserName) (administrator: $isAdmin)"
if (-not $isAdmin) {
  Log 'WARNING: not running as Administrator. Stopping and starting the Palbox service will fail.'
  Log "WARNING: to finish manually, open an elevated PowerShell and run: $PSCommandPath"
}

# Locate nssm.exe -- fixed paths first to avoid slow PATH scan
$nssmExe = $null
$candidates = @(
  'C:\\nssm\\nssm.exe',
  'C:\\Palbox\\nssm.exe',
  'C:\\tools\\nssm.exe',
  (Join-Path $installDir 'nssm.exe'),
  'C:\\ProgramData\\chocolatey\\bin\\nssm.exe'
)
foreach ($loc in $candidates) {
  if (Test-Path $loc -PathType Leaf -ErrorAction SilentlyContinue) { $nssmExe = $loc; break }
}
if (-not $nssmExe) {
  try {
    $found = Get-Command 'nssm.exe' -ErrorAction SilentlyContinue
    if ($found) { $nssmExe = $found.Source }
  } catch {}
}

if ($nssmExe) { Log "nssm       : $nssmExe" }
else          { Log 'nssm not found -- using the service manager directly' }

# --- Service control --------------------------------------------------------
# These talk to the Windows service manager instead of shelling out to nssm.
# "nssm start | Out-Null" builds a pipeline, and PowerShell will not move on
# until that pipeline closes, which is how a start could wedge the script
# forever. WaitForStatus is bounded by a timeout and cannot do that.
function Get-SvcOrNull {
  param($n)
  try { return Get-Service -Name $n -ErrorAction Stop } catch { return $null }
}

function Stop-Palbox {
  $svc = Get-SvcOrNull $svcName
  if (-not $svc)                  { Log "Service '$svcName' is not registered -- nothing to stop."; return }
  if ($svc.Status -eq 'Stopped')  { Log 'Service already stopped.'; return }
  Log "Stopping service '$svcName' (currently $($svc.Status))..."
  try { Stop-Service -Name $svcName -Force -ErrorAction Stop } catch { Log "  Stop-Service: $_" }
  try {
    $svc.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(60))
    Log 'Service stopped.'
  } catch {
    Log 'WARNING: service never reported Stopped within 60s -- continuing anyway.'
  }
}

function Start-Palbox {
  Log "Starting service '$svcName'..."
  try {
    Start-Service -Name $svcName -ErrorAction Stop
    $svc = Get-SvcOrNull $svcName
    if ($svc) { $svc.WaitForStatus('Running', [TimeSpan]::FromSeconds(90)) }
    Log 'Service is running.'
    return $true
  } catch {
    Log "  Start-Service failed: $_"
  }
  if ($nssmExe) {
    Log '  Retrying via nssm...'
    try {
      $p = Start-Process -FilePath $nssmExe -ArgumentList @('start', $svcName) -NoNewWindow -PassThru
      if (-not $p.WaitForExit(60000)) { try { $p.Kill() } catch {}; Log '  nssm start timed out after 60s.' }
    } catch { Log "  nssm start error: $_" }
    Start-Sleep -Seconds 3
    $svc = Get-SvcOrNull $svcName
    if ($svc -and $svc.Status -eq 'Running') { Log 'Service is running.'; return $true }
  }
  Log "ERROR: '$svcName' did not start. Start it by hand with:  Start-Service $svcName"
  return $false
}

Log 'Waiting 10 seconds for Node.js API to finish responding...'
Start-Sleep -Seconds 10

Stop-Palbox

# Extract ZIP
Log "Extracting $zipPath ..."
try {
  if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
  Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
  Log 'Extraction complete.'
} catch {
  Log "ERROR extracting: $_"
  $null = Start-Palbox
  try { Stop-Transcript | Out-Null } catch {}
  exit 1
}

# Descend into single root folder if present (e.g. palbox-server-0.7.0/)
$children = @(Get-ChildItem $extractDir)
$src = $extractDir
if ($children.Count -eq 1 -and $children[0].PSIsContainer) {
  $src = $children[0].FullName
  Log "ZIP root folder: $src"
}

# Copy new files into installDir
Log "Copying files to $installDir ..."
foreach ($folder in @('api-dist','node_modules','ui-dist')) {
  $s = Join-Path $src $folder
  $d = Join-Path $installDir $folder
  if (Test-Path $s) {
    Log "  Replacing $folder ..."
    if (Test-Path $d) { Remove-Item $d -Recurse -Force }
    Copy-Item $s $d -Recurse -Force
    Log "  $folder OK"
  } else {
    Log "  SKIP $folder (not in archive)"
  }
}
Log 'Copy complete.'

# Bring the service back BEFORE any cleanup. Wiping the staging directory here
# also deletes the log this script is still appending to, after which every
# remaining Log call fails silently and the run looks like it stopped dead.
$startedOk = Start-Palbox

# Remove the payload only. The script, its log, and the transcript stay until
# the very end so a failed run is still diagnosable.
try { Remove-Item $zipPath    -Force          -ErrorAction SilentlyContinue } catch {}
try { Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue } catch {}

if ($startedOk) { Log '=== apply-update.ps1 complete ===' }
else            { Log '=== apply-update.ps1 finished WITH ERRORS ===' }

# Leave copies where the panel can surface them
try { Copy-Item $logFile (Join-Path $installDir 'palbox-update.log') -Force -ErrorAction SilentlyContinue } catch {}
try { Stop-Transcript | Out-Null } catch {}
try { Copy-Item $transcriptF (Join-Path $installDir 'palbox-transcript.log') -Force -ErrorAction SilentlyContinue } catch {}
`;

    // Write with UTF-8 BOM (\uFEFF) so PowerShell 5.1 detects the encoding
    // correctly on any system locale, avoiding garbled multi-byte characters.
    fs.writeFileSync(psScript, '\uFEFF' + ps, 'utf8');
    // ── Spawn PowerShell detached ──────────────────────────────────────────
    // detached: true + unref() = the child process gets its own process group
    // and survives the Node.js/NSSM service being stopped.
    //
    // An absolute path is used because a service started by NSSM does not
    // reliably inherit a PATH containing System32\WindowsPowerShell, and a
    // bare "powershell.exe" that cannot be resolved fails silently.
    const systemRoot = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows';
    const psExe = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const psExeResolved = fs.existsSync(psExe) ? psExe : 'powershell.exe';

    fs.appendFileSync(logFile, `${new Date().toISOString()}  Script written to ${psScript} -- launching ${psExeResolved}\r\n`);

    // The child's own output goes to a file rather than being discarded. If
    // PowerShell dies before the script's logging starts - a blocked execution
    // policy, a parse error - this is the only place that failure is visible,
    // and discarding it is what made this look like nothing happened at all.
    const bootstrapLog = path.join(updateDir, 'bootstrap.log');
    let stdio: 'ignore' | ['ignore', number, number] = 'ignore';
    try {
      const fd = fs.openSync(bootstrapLog, 'a');
      stdio = ['ignore', fd, fd];
    } catch { /* fall back to discarding output */ }

    const child = spawn(
      psExeResolved,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psScript],
      { detached: true, stdio, windowsHide: true },
    );

    const note = (msg: string) => {
      try { fs.appendFileSync(logFile, `${new Date().toISOString()}  ${msg}\r\n`); } catch { /* best effort */ }
    };

    child.on('error', (err) => {
      note(`FAILED to launch PowerShell: ${(err as Error).message}. The update has not been applied.`);
    });
    // A script that runs correctly stops this process before it can exit, so a
    // fast exit means it failed and the reason is worth recording.
    child.on('exit', (code) => {
      if (code !== 0) note(`PowerShell exited early with code ${code}. See ${bootstrapLog}.`);
    });

    if (child.pid) note(`PowerShell started (pid ${child.pid}).`);
    child.unref();

    res.json({
      ok: true,
      version: info.latest,
      logFile,
      transcriptFile,
      message: `Updating to v${info.latest}. The panel will restart in ~20 seconds. Progress: ${logFile} | Transcript: ${transcriptFile}`,
    });
  } catch (e) {
    const msg = (e as Error).message;
    try {
      const installDir = process.env.PALBOX_INSTALL_DIR ?? process.cwd();
      fs.appendFileSync(
        path.join(installDir, 'palbox-update.log'),
        `${new Date().toISOString()}  ERROR in update route: ${msg}\r\n`,
      );
    } catch {}
    res.status(500).json({ error: msg });
  }
});

/**
 * The tail of the update log. The update runs in a detached process that
 * outlives this one, so its progress and any failure are otherwise only
 * visible by opening files on the server - which is no help to someone
 * watching the panel.
 */
router.get('/update-log', requireAuth, (_req, res) => {
  const installDir = process.env.PALBOX_INSTALL_DIR ?? process.cwd();
  const sources = [
    path.join('C:\\PalboxUpdate', 'update.log'),
    path.join(installDir, 'palbox-update.log'),
    path.join('C:\\PalboxUpdate', 'bootstrap.log'),
  ];

  let newest: { file: string; mtime: number } | null = null;
  for (const file of sources) {
    try {
      const { mtimeMs } = fs.statSync(file);
      if (!newest || mtimeMs > newest.mtime) newest = { file, mtime: mtimeMs };
    } catch { /* not created yet */ }
  }

  if (!newest) {
    res.json({ found: false, file: null, lines: [], modifiedAt: null });
    return;
  }

  try {
    const lines = fs.readFileSync(newest.file, 'utf8').split(/\r?\n/).filter(Boolean);
    res.json({ found: true, file: newest.file, lines: lines.slice(-200), modifiedAt: newest.mtime });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
