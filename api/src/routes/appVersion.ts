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
// Downloads the latest palbox-server-*.zip, extracts to a temp dir, then
// spawns a detached PowerShell script that stops the NSSM service, swaps
// the files, and restarts it.  Only works on Windows + server package.
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

    // Install directory is the cwd (set by NSSM AppDirectory)
    const installDir = process.cwd();
    const palboxService = process.env.PALBOX_SERVICE ?? 'PalboxAPI';
    const tmpDir = path.join(os.tmpdir(), `palbox-update-${Date.now()}`);
    const zipPath = path.join(tmpDir, asset.name);
    const extractDir = path.join(tmpDir, 'extracted');

    fs.mkdirSync(tmpDir, { recursive: true });

    // Download zip
    await new Promise<void>((resolve, reject) => {
      const follow = (url: string) => {
        https.get(url, { headers: { 'User-Agent': 'Palbox-Manager/1.0' } }, (resp) => {
          if (resp.statusCode === 301 || resp.statusCode === 302) {
            follow(resp.headers.location!);
            return;
          }
          if (resp.statusCode !== 200) { reject(new Error(`Download failed: ${resp.statusCode}`)); return; }
          const out = fs.createWriteStream(zipPath);
          resp.pipe(out);
          out.on('finish', resolve);
          out.on('error', reject);
        }).on('error', reject);
      };
      follow(asset.browser_download_url);
    });

    // Write the updater PowerShell script
    const psScript = path.join(tmpDir, 'apply-update.ps1');
    const ps = [
      `$ErrorActionPreference = 'Stop'`,
      `Start-Sleep -Seconds 5`,
      `# Extract ZIP`,
      `Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force`,
      `# Swap files (stop → copy → start)`,
      `try { & nssm stop '${palboxService}' 2>&1 | Out-Null } catch {}`,
      `Start-Sleep -Seconds 3`,
      `$src = '${extractDir}'`,
      `$dst = '${installDir}'`,
      `foreach ($folder in @('api-dist','node_modules','ui-dist')) {`,
      `  $s = Join-Path $src $folder`,
      `  if (Test-Path $s) {`,
      `    Remove-Item (Join-Path $dst $folder) -Recurse -Force -ErrorAction SilentlyContinue`,
      `    Copy-Item $s (Join-Path $dst $folder) -Recurse -Force`,
      `  }`,
      `}`,
      `# Clean up temp files`,
      `Remove-Item '${tmpDir}' -Recurse -Force -ErrorAction SilentlyContinue`,
      `# Restart service`,
      `& nssm start '${palboxService}' 2>&1 | Out-Null`,
    ].join('\r\n');
    fs.writeFileSync(psScript, ps, 'utf8');

    // Launch detached — this process will be killed by nssm stop, so use cmd to schedule it
    const cmd = `cmd /c start "" /B powershell -NonInteractive -ExecutionPolicy Bypass -File "${psScript}"`;
    execAsync(cmd).catch(() => {});

    res.json({
      ok: true,
      version: info.latest,
      message: `Downloading and applying v${info.latest}. The panel will restart in ~30 seconds.`,
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
