import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
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

router.get('/', (req, res) => {
  res.json(
    getDb().prepare('SELECT * FROM players WHERE instance_id = ? ORDER BY last_seen DESC').all(req.instance!.id),
  );
});

router.post('/', (req, res) => {
  const { steam_id, name } = req.body as { steam_id?: string; name?: string };
  if (!steam_id || !name) { res.status(400).json({ error: 'steam_id and name required' }); return; }
  getDb().prepare(
    'INSERT OR IGNORE INTO players (instance_id, steam_id, name, whitelisted) VALUES (?,?,?,1)',
  ).run(req.instance!.id, steam_id, name);
  res.json({ ok: true });
});

router.patch('/:steamId/whitelist', (req, res) => {
  const { whitelisted } = req.body as { whitelisted?: boolean };
  if (whitelisted === undefined) { res.status(400).json({ error: 'whitelisted required' }); return; }
  getDb().prepare('UPDATE players SET whitelisted = ? WHERE instance_id = ? AND steam_id = ?')
    .run(whitelisted ? 1 : 0, req.instance!.id, req.params.steamId);
  res.json({ ok: true });
});

router.post('/:steamId/kick', async (req, res) => {
  const inst = req.instance!;
  try {
    await rconExec(inst.rcon_host, inst.rcon_port, inst.rcon_password, `KickPlayer ${req.params.steamId}`);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.post('/:steamId/ban', async (req, res) => {
  const inst = req.instance!;
  try {
    await rconExec(inst.rcon_host, inst.rcon_port, inst.rcon_password, `BanPlayer ${req.params.steamId}`);
    getDb().prepare('UPDATE players SET banned = 1 WHERE instance_id = ? AND steam_id = ?')
      .run(inst.id, req.params.steamId);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.post('/:steamId/unban', async (req, res) => {
  const inst = req.instance!;
  try {
    await rconExec(inst.rcon_host, inst.rcon_port, inst.rcon_password, `UnBanPlayer ${req.params.steamId}`);
    getDb().prepare('UPDATE players SET banned = 0 WHERE instance_id = ? AND steam_id = ?')
      .run(inst.id, req.params.steamId);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// Player event history
router.get('/events', (req, res) => {
  const limit = parseInt(String(req.query.limit ?? '100'), 10);
  res.json(
    getDb().prepare(
      'SELECT * FROM player_events WHERE instance_id = ? ORDER BY created_at DESC LIMIT ?',
    ).all(req.instance!.id, limit),
  );
});

export default router;
