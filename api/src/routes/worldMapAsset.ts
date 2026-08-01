/**
 * Serves the Palpagos Island map image used by the World Map view.
 *
 * The browser cannot load these sources directly: the hosts either refuse
 * hotlinked requests based on the Referer header or omit CORS headers, so an
 * <img> pointed straight at them renders nothing. Fetching server-side sheds
 * both constraints, and the result is cached on disk so the view keeps working
 * offline and does not hammer someone else's CDN.
 */
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { requireAuth } from '../middleware/auth.js';
import { log } from '../lib/logger.js';

const router = Router();

/**
 * Ordered by preference. The first is 2048x2048, and a square source matters:
 * the view maps world coordinates onto the image assuming equal extents on
 * both axes, so a non-square one would skew every player position.
 *
 * These are resolved live rather than hardcoded as thumbnail paths, because
 * the previously hardcoded URLs all became 404s and left the map blank.
 */
const SOURCES = [
  'https://palworld.wiki.gg/images/Palpagos_Islands_World_Map.webp',
  'https://palworld.wiki.gg/images/Palpagos_Islands_Square.png',
];

const CACHE_DIR = process.env.PALBOX_DATA_DIR ?? path.join(os.tmpdir(), 'palbox');
const CACHE_FILE = path.join(CACHE_DIR, 'palpagos-map');
const CACHE_META = path.join(CACHE_DIR, 'palpagos-map.json');
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface Meta { contentType: string; fetchedAt: number }

function readCache(): { body: Buffer; meta: Meta } | null {
  try {
    const meta = JSON.parse(fs.readFileSync(CACHE_META, 'utf8')) as Meta;
    if (Date.now() - meta.fetchedAt > MAX_AGE_MS) return null;
    return { body: fs.readFileSync(CACHE_FILE), meta };
  } catch {
    return null;
  }
}

async function download(): Promise<{ body: Buffer; meta: Meta } | null> {
  for (const url of SOURCES) {
    try {
      const resp = await fetch(url, {
        // Some hosts reject requests without a browser-shaped User-Agent.
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Palbox-Manager)' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) continue;
      const body = Buffer.from(await resp.arrayBuffer());
      if (body.length < 1024) continue; // an error page, not an image
      const meta: Meta = {
        contentType: resp.headers.get('content-type') ?? 'image/png',
        fetchedAt: Date.now(),
      };
      try {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(CACHE_FILE, body);
        fs.writeFileSync(CACHE_META, JSON.stringify(meta));
      } catch (e) {
        log.warn('Could not cache the world map image:', e);
      }
      return { body, meta };
    } catch { /* try the next source */ }
  }
  return null;
}

router.get('/', requireAuth, async (_req, res) => {
  const cached = readCache() ?? (await download());
  if (!cached) {
    // The view falls back to its own rendering when this 404s.
    res.status(404).json({ error: 'Map image unavailable' });
    return;
  }
  res.setHeader('Content-Type', cached.meta.contentType);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(cached.body);
});

export default router;
