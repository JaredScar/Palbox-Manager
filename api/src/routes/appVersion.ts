import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const router = Router();

// Resolve current version from the API package.json
function readCurrentVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '../../package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return process.env.npm_package_version ?? '0.0.0';
  }
}

const CURRENT_VERSION = readCurrentVersion();
const REPO = 'JaredScar/Palbox-Manager';
const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

interface Cache { latest: string; url: string; checkedAt: number }
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

router.get('/', requireAuth, async (_req, res) => {
  try {
    const now = Date.now();
    if (!cache || now - cache.checkedAt > CACHE_TTL_MS) {
      const r = await fetch(RELEASES_URL, {
        headers: { 'User-Agent': 'Palbox-Manager/1.0' },
      });
      if (r.ok) {
        const data = await r.json() as { tag_name: string; html_url: string };
        cache = {
          latest:    data.tag_name.replace(/^v/, ''),
          url:       data.html_url,
          checkedAt: now,
        };
      }
    }

    const latest = cache?.latest ?? CURRENT_VERSION;
    res.json({
      current:        CURRENT_VERSION,
      latest,
      updateAvailable: semverGt(latest, CURRENT_VERSION),
      releaseUrl:     cache?.url ?? `https://github.com/${REPO}/releases/latest`,
    });
  } catch {
    res.json({
      current:        CURRENT_VERSION,
      latest:         CURRENT_VERSION,
      updateAvailable: false,
      releaseUrl:     `https://github.com/${REPO}/releases/latest`,
    });
  }
});

export default router;
