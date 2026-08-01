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
 * Ordered by preference.
 *
 * The first is the game's own 8192x8192 t_worldmap texture, and it is not
 * interchangeable with the others: the projection that places players is an
 * affine transform calibrated against this exact framing. A wiki render of the
 * island crops and scales differently, so reusing those constants against one
 * puts every marker in the wrong place - which is exactly what happened while
 * a wiki image was being served.
 *
 * The fallbacks therefore only keep the map from being blank. The view is told
 * which source it got and stops claiming positions are accurate when the
 * calibrated texture is unavailable.
 */
export const CALIBRATED_SOURCE =
  'https://raw.githubusercontent.com/amantu-qbit/palworld-server-manager/1c1cee0783a2154d7df3c7912be28daf599d19bf/public/palworld-map.webp';

const SOURCES = [
  CALIBRATED_SOURCE,
  'https://palworld.wiki.gg/images/Palpagos_Islands_World_Map.webp',
  'https://palworld.wiki.gg/images/Palpagos_Islands_Square.png',
];

const CACHE_DIR = process.env.PALBOX_DATA_DIR ?? path.join(os.tmpdir(), 'palbox');
const CACHE_FILE = path.join(CACHE_DIR, 'palpagos-map');
const CACHE_META = path.join(CACHE_DIR, 'palpagos-map.json');
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const RETRY_AGE_MS = 24 * 60 * 60 * 1000;

interface Meta { contentType: string; fetchedAt: number; source?: string }

function readCache(): { body: Buffer; meta: Meta } | null {
  try {
    const meta = JSON.parse(fs.readFileSync(CACHE_META, 'utf8')) as Meta;
    // A cache from before the calibrated texture existed, or from a fallback
    // source, is retried within a day rather than held for a month - otherwise
    // an install that cached a wiki image would keep mispositioning players
    // long after the right one became reachable.
    const maxAge = meta.source === CALIBRATED_SOURCE ? MAX_AGE_MS : RETRY_AGE_MS;
    if (Date.now() - meta.fetchedAt > maxAge) return null;
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
        source: url,
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
  // Player positions are only trustworthy on the calibrated texture, so the
  // view needs to know which image it received.
  res.setHeader('X-Palbox-Map-Calibrated', String(cached.meta.source === CALIBRATED_SOURCE));
  res.send(cached.body);
});

/** Whether the served image is the one the projection was calibrated against. */
router.get('/info', requireAuth, async (_req, res) => {
  const cached = readCache() ?? (await download());
  res.json({
    available: cached !== null,
    calibrated: cached?.meta.source === CALIBRATED_SOURCE,
    source: cached?.meta.source ?? null,
  });
});

export default router;
