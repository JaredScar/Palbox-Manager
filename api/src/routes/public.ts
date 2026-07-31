/**
 * Public (unauthenticated) status endpoint.
 * Exposes a safe subset of server info for sharing with community members.
 * GET /api/public/status?instance=1
 */
import { Router } from 'express';
import { getDb } from '../db/index.js';
import type { Instance } from '../db/types.js';
import { getStatus } from '../services/palserver.js';
import { getOnlinePlayers } from '../services/playerTracker.js';
import { readSettings } from '../services/ini.js';

const router = Router();

router.get('/status', async (req, res) => {
  const instanceId = parseInt(String(req.query.instance ?? '1'), 10);
  const inst = getDb()
    .prepare('SELECT * FROM instances WHERE id = ?')
    .get(instanceId) as Instance | undefined;

  if (!inst) {
    res.status(404).json({ error: 'Instance not found' });
    return;
  }

  try {
    const { status, uptime } = await getStatus(inst);
    const players = getOnlinePlayers(inst.id);

    // Read a safe subset of INI settings for the status page
    let serverName = inst.name;
    let maxPlayers = 32;
    try {
      const s = readSettings(inst);
      if (s.ServerName) serverName = s.ServerName;
      if (s.ServerPlayerMaxNum) maxPlayers = parseInt(s.ServerPlayerMaxNum, 10);
    } catch { /* ini not readable */ }

    res.json({
      instanceId: inst.id,
      serverName,
      status,
      uptime,
      playerCount: players.length,
      maxPlayers,
      players: players.map((p) => ({ name: p.name, joinedAt: p.joinedAt })),
      gamePort: inst.game_port,
      publicIp: inst.public_ip || null,
      checkedAt: Date.now(),
    });
  } catch {
    res.status(500).json({ error: 'Status check failed' });
  }
});

export default router;
