import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import path from 'path';
import fs from 'fs';
import https from 'https';

const router = Router();
const execAsync = promisify(exec);

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

async function fetchLatest(): Promise<Cache> {
  const now = Date.now();
  if (cache && now - cache.checkedAt < CACHE_TTL_MS) return cache;
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
router.get('/', requireAuth, async (_req, res) => {
  try {
    const info = await fetchLatest().catch(() => null);
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
// 1. Downloads the latest palbox-server-*.zip to a temp directory.
// 2. Writes an apply-update.ps1 script.
// 3. Registers a Windows Scheduled Task (runs as SYSTEM, outside the service
//    process tree) that fires immediately — so killing the NSSM service does
//    NOT kill the updater.
// Only works on Windows + server package.
router.post('/update', requireAuth, async (_req, res) => {
  if (os.platform() !== 'win32') {
    return res.status(400).json({ error: 'Self-update is only supported on Windows server deployments.' });
  }

  try {
    const info = await fetchLatest();
    if (!semverGt(info.latest, CURRENT_VERSION)) {
      return res.json({ ok: true, message: 'Already on the latest version.' });
    }

    // Find the server ZIP asset
    const asset = info.assets.find((a) => /^palbox-server-.+\.zip$/i.test(a.name));
    if (!asset) {
      return res.status(404).json({ error: 'Server ZIP asset not found in the latest release.' });
    }

    // Install directory: NSSM sets AppDirectory = install path (e.g. C:\Palbox)
    const installDir = process.env.PALBOX_INSTALL_DIR ?? process.cwd();
    const palboxService = process.env.PALBOX_SERVICE ?? 'PalboxAPI';
    const tmpDir = path.join(os.tmpdir(), `palbox-update-${Date.now()}`);
    const zipPath = path.join(tmpDir, asset.name);
    const extractDir = path.join(tmpDir, 'extracted');
    const logFile = path.join(installDir, 'palbox-update.log');

    fs.mkdirSync(tmpDir, { recursive: true });

    // ── Download ZIP (follow GitHub CDN redirects) ─────────────────────────
    await new Promise<void>((resolve, reject) => {
      const follow = (url: string, redirects = 0) => {
        if (redirects > 10) { reject(new Error('Too many redirects')); return; }
        https.get(url, { headers: { 'User-Agent': 'Palbox-Manager/1.0' } }, (resp) => {
          const loc = resp.headers.location;
          if ((resp.statusCode === 301 || resp.statusCode === 302 || resp.statusCode === 307) && loc) {
            resp.resume();
            follow(loc, redirects + 1);
            return;
          }
          if (resp.statusCode !== 200) {
            resp.resume();
            reject(new Error(`Download failed: HTTP ${resp.statusCode}`));
            return;
          }
          const out = fs.createWriteStream(zipPath);
          resp.pipe(out);
          out.on('finish', resolve);
          out.on('error', reject);
        }).on('error', reject);
      };
      follow(asset.browser_download_url);
    });

    // ── Write apply-update.ps1 ─────────────────────────────────────────────
    // Uses no $ErrorActionPreference = Stop so that NSSM stderr doesn't abort it.
    // Searches for nssm.exe in common locations if not in PATH.
    const psScript = path.join(tmpDir, 'apply-update.ps1');

    // Escape single-quote-sensitive strings for PS single-quoted literals
    const esc = (s: string) => s.replace(/'/g, "''");

    const ps = [
      `# Palbox self-update script — generated at ${new Date().toISOString()}`,
      `$ErrorActionPreference = 'Continue'`,
      `$logFile = '${esc(logFile)}'`,
      `function Log { param($m) $ts = [DateTime]::Now.ToString('HH:mm:ss'); "$ts  $m" | Tee-Object -FilePath $logFile -Append | Out-Null }`,
      ``,
      `Log "=== Palbox self-update started ==="`,
      ``,
      `# Locate nssm.exe`,
      `$nssmExe = $null`,
      `foreach ($loc in @('nssm','C:\\nssm\\nssm.exe','C:\\Palbox\\nssm.exe','C:\\tools\\nssm.exe')) {`,
      `  try { $r = Get-Command $loc -ErrorAction SilentlyContinue; if ($r) { $nssmExe = $r.Source; break } } catch {}`,
      `}`,
      `if (-not $nssmExe) { Log "WARNING: nssm not found in PATH or common locations — service will not be auto-restarted" }`,
      `else { Log "nssm found: $nssmExe" }`,
      ``,
      `# Give the API time to send its HTTP response before we kill it`,
      `Log "Waiting 6 seconds before stopping service..."`,
      `Start-Sleep -Seconds 6`,
      ``,
      `# Stop service`,
      `if ($nssmExe) {`,
      `  Log "Stopping service '${esc(palboxService)}'..."`,
      `  & $nssmExe stop '${esc(palboxService)}' 2>&1 | Out-Null`,
      `  Start-Sleep -Seconds 5`,
      `  Log "Service stopped."`,
      `}`,
      ``,
      `# Extract ZIP`,
      `Log "Extracting archive..."`,
      `try {`,
      `  Expand-Archive -Path '${esc(zipPath)}' -DestinationPath '${esc(extractDir)}' -Force`,
      `  Log "Extraction complete."`,
      `} catch {`,
      `  Log "ERROR extracting ZIP: $_"`,
      `  if ($nssmExe) { & $nssmExe start '${esc(palboxService)}' 2>&1 | Out-Null }`,
      `  exit 1`,
      `}`,
      ``,
      `# Swap files`,
      `Log "Copying new files to install directory..."`,
      `$src = '${esc(extractDir)}'`,
      `$dst = '${esc(installDir)}'`,
      `foreach ($folder in @('api-dist','node_modules','ui-dist')) {`,
      `  $s = Join-Path $src $folder`,
      `  $d = Join-Path $dst $folder`,
      `  if (Test-Path $s) {`,
      `    Log "  Replacing $folder..."`,
      `    Remove-Item $d -Recurse -Force -ErrorAction SilentlyContinue`,
      `    Copy-Item $s $d -Recurse -Force`,
      `    Log "  $folder done."`,
      `  } else {`,
      `    Log "  SKIP $folder (not in archive)"`,
      `  }`,
      `}`,
      ``,
      `# Clean up temp dir`,
      `Remove-Item '${esc(tmpDir)}' -Recurse -Force -ErrorAction SilentlyContinue`,
      ``,
      `# Restart service`,
      `if ($nssmExe) {`,
      `  Log "Starting service '${esc(palboxService)}'..."`,
      `  & $nssmExe start '${esc(palboxService)}' 2>&1 | Out-Null`,
      `  Start-Sleep -Seconds 3`,
      `  $status = (& $nssmExe status '${esc(palboxService)}' 2>&1) -join ''`,
      `  Log "Service status: $status"`,
      `} else {`,
      `  Log "WARNING: Please start the '${esc(palboxService)}' service manually."`,
      `}`,
      ``,
      `# Remove this scheduled task`,
      `schtasks /Delete /TN "PalboxSelfUpdate" /F 2>&1 | Out-Null`,
      ``,
      `Log "=== Palbox self-update complete ==="`,
    ].join('\r\n');

    fs.writeFileSync(psScript, ps, 'utf8');

    // ── Schedule the update script via Windows Task Scheduler ─────────────
    // Scheduled tasks run outside the NSSM service process tree, so stopping
    // the service does NOT kill the updater.
    const taskName = 'PalboxSelfUpdate';
    // Delete any leftover task from a previous attempt
    await execAsync(`schtasks /Delete /TN "${taskName}" /F`).catch(() => {});

    // Create a task that runs as SYSTEM so it has the needed privileges
    const createCmd = [
      `schtasks /Create /F`,
      `/TN "${taskName}"`,
      `/TR "powershell.exe -NonInteractive -ExecutionPolicy Bypass -File \\"${psScript}\\""`,
      `/SC ONCE /ST 00:00`,   // time doesn't matter; we /Run it immediately
      `/RL HIGHEST`,
      `/RU SYSTEM`,
    ].join(' ');
    await execAsync(createCmd);

    // Trigger the task immediately (runs outside our process tree)
    await execAsync(`schtasks /Run /TN "${taskName}"`);

    res.json({
      ok: true,
      version: info.latest,
      message: `Update to v${info.latest} queued. The panel will go offline in ~10 seconds and restart automatically once the files are swapped. Check palbox-update.log in the install directory if anything goes wrong.`,
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
