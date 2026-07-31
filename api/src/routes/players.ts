import { Router } from 'express';
import https from 'https';
import { requireAuth, requirePermission } from '../middleware/auth';
import { fireEvent } from '../services/discord';
import { resolveInstance } from '../middleware/instance';
import { getDb } from '../db';
import { rconExec } from '../lib/rcon';

const router = Router({ mergeParams: true });
router.use(requireAuth, resolveInstance);

interface Player {
  id: number;
  instance_id: number;
  steam_id: string;
  name: string;
  playtime_s: number;
  last_seen: number | null;
  whitelisted: number;
  banned: number;
}

router.get('/', requirePermission('players.view'), (req, res) => {
  res.json(
    getDb().prepare('SELECT * FROM players WHERE instance_id = ? ORDER BY last_seen DESC').all(req.instance!.id),
  );
});

// Top players by playtime
router.get('/leaderboard', requirePermission('players.view'), (req, res) => {
  const limit = parseInt(String(req.query.limit ?? '10'), 10);
  res.json(
    getDb()
      .prepare('SELECT steam_id, name, playtime_s FROM players WHERE instance_id = ? AND banned = 0 ORDER BY playtime_s DESC LIMIT ?')
      .all(req.instance!.id, limit),
  );
});

// All banned players for the Ban Manager page
router.get('/bans', requirePermission('players.ban'), (req, res) => {
  const now = Math.floor(Date.now() / 1000);
  res.json(
    getDb()
      .prepare('SELECT * FROM players WHERE instance_id = ? AND (banned = 1 OR (ban_expires IS NOT NULL AND ban_expires > ?))')
      .all(req.instance!.id, now),
  );
});

// Geo / Steam profile country lookup (server-side proxy to avoid CORS)
const geoCache = new Map<string, { country: string; flag: string; ts: number }>();

router.get('/:steamId/geo', requirePermission('players.view'), (req, res) => {
  const { steamId } = req.params;
  const cached = geoCache.get(steamId);
  if (cached && Date.now() - cached.ts < 24 * 3600 * 1000) { res.json(cached); return; }

  const url = `https://steamcommunity.com/profiles/${steamId}/?xml=1`;
  https.get(url, { headers: { 'User-Agent': 'Palbox/1.0' } }, (resp) => {
    let data = '';
    resp.on('data', (c: Buffer) => (data += c.toString()));
    resp.on('end', () => {
      try {
        const locMatch = data.match(/<location>([^<]+)<\/location>/);
        const country = locMatch?.[1]?.trim() ?? 'Unknown';
        // Map common Steam location strings to emoji flags
        const countryToFlag: Record<string, string> = {
          'United States': '🇺🇸', 'United Kingdom': '🇬🇧', 'Germany': '🇩🇪',
          'France': '🇫🇷', 'Canada': '🇨🇦', 'Australia': '🇦🇺',
          'Japan': '🇯🇵', 'South Korea': '🇰🇷', 'Brazil': '🇧🇷',
          'Russia': '🇷🇺', 'Netherlands': '🇳🇱', 'Sweden': '🇸🇪',
          'Norway': '🇳🇴', 'Finland': '🇫🇮', 'Poland': '🇵🇱',
          'Spain': '🇪🇸', 'Italy': '🇮🇹', 'China': '🇨🇳',
          'Mexico': '🇲🇽', 'Argentina': '🇦🇷', 'New Zealand': '🇳🇿',
          'Turkey': '🇹🇷', 'Portugal': '🇵🇹', 'Belgium': '🇧🇪',
        };
        const flag = countryToFlag[country] ?? '🌐';
        const result = { country, flag, ts: Date.now() };
        geoCache.set(steamId, result);
        res.json(result);
      } catch { res.json({ country: 'Unknown', flag: '🌐', ts: Date.now() }); }
    });
  }).on('error', () => res.json({ country: 'Unknown', flag: '🌐', ts: Date.now() }));
});

router.post('/', (req, res) => {
  const { steam_id, name } = req.body as { steam_id?: string; name?: string };
  if (!steam_id || !name) { res.status(400).json({ error: 'steam_id and name required' }); return; }
  getDb().prepare(
    'INSERT OR IGNORE INTO players (instance_id, steam_id, name, whitelisted) VALUES (?,?,?,1)',
  ).run(req.instance!.id, steam_id, name);
  res.json({ ok: true });
});

router.patch('/:steamId/whitelist', requirePermission('players.whitelist'), (req, res) => {
  const { whitelisted } = req.body as { whitelisted?: boolean };
  if (whitelisted === undefined) { res.status(400).json({ error: 'whitelisted required' }); return; }
  getDb().prepare('UPDATE players SET whitelisted = ? WHERE instance_id = ? AND steam_id = ?')
    .run(whitelisted ? 1 : 0, req.instance!.id, req.params.steamId);
  res.json({ ok: true });
});

router.post('/:steamId/kick', requirePermission('players.kick'), async (req, res) => {
  const inst = req.instance!;
  try {
    await rconExec(inst.rcon_host, inst.rcon_port, inst.rcon_password, `KickPlayer ${req.params.steamId}`);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.post('/:steamId/ban', requirePermission('players.ban'), async (req, res) => {
  const inst = req.instance!;
  const { reason, expires } = req.body as { reason?: string; expires?: number };
  try {
    await rconExec(inst.rcon_host, inst.rcon_port, inst.rcon_password, `BanPlayer ${req.params.steamId}`).catch(() => {});
    const player = getDb()
      .prepare('SELECT name FROM players WHERE instance_id = ? AND steam_id = ?')
      .get(inst.id, req.params.steamId) as { name: string } | undefined;
    getDb()
      .prepare('UPDATE players SET banned = 1, ban_reason = ?, ban_expires = ? WHERE instance_id = ? AND steam_id = ?')
      .run(reason ?? null, expires ?? null, inst.id, req.params.steamId);
    fireEvent(inst, 'player_banned', '🔨 Player Banned',
      `**${player?.name ?? req.params.steamId}** was banned.`,
      reason ? [{ name: 'Reason', value: reason }] : undefined,
    ).catch(() => {});
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.post('/:steamId/unban', requirePermission('players.ban'), async (req, res) => {
  const inst = req.instance!;
  try {
    await rconExec(inst.rcon_host, inst.rcon_port, inst.rcon_password, `UnBanPlayer ${req.params.steamId}`);
    getDb().prepare('UPDATE players SET banned = 0 WHERE instance_id = ? AND steam_id = ?')
      .run(inst.id, req.params.steamId);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// Player event history
router.get('/events', requirePermission('players.view'), (req, res) => {
  const limit = parseInt(String(req.query.limit ?? '100'), 10);
  res.json(
    getDb().prepare(
      'SELECT * FROM player_events WHERE instance_id = ? ORDER BY created_at DESC LIMIT ?',
    ).all(req.instance!.id, limit),
  );
});

export default router;
