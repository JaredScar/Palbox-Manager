import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { getDb } from '../db/index.js';
import type { Instance } from '../db/types.js';
import { restGetInfo, restGetPlayers, restSendCommand } from '../services/palrest.js';

const router = Router({ mergeParams: true });

function getInstance(instanceId: number): Instance | undefined {
  return getDb().prepare('SELECT * FROM instances WHERE id = ?').get(instanceId) as Instance | undefined;
}

router.get('/info', requireAuth, requirePermission('server.view'), async (req, res) => {
  const inst = getInstance(parseInt(req.params.instanceId, 10));
  if (!inst) { res.status(404).json({ error: 'Instance not found' }); return; }
  // rest_api_port defaults to 8212, password is the RCON password (same as AdminPassword usually)
  const port = (inst as unknown as Record<string, unknown>).rest_api_port as number | undefined ?? 8212;
  try {
    const info = await restGetInfo(inst.rcon_host, port, inst.rcon_password);
    res.json(info);
  } catch (err) {
    res.status(503).json({ error: 'REST API unavailable', detail: String(err) });
  }
});

router.get('/players', requireAuth, requirePermission('players.view'), async (req, res) => {
  const inst = getInstance(parseInt(req.params.instanceId, 10));
  if (!inst) { res.status(404).json({ error: 'Instance not found' }); return; }
  const port = (inst as unknown as Record<string, unknown>).rest_api_port as number | undefined ?? 8212;
  try {
    const players = await restGetPlayers(inst.rcon_host, port, inst.rcon_password);
    res.json(players);
  } catch (err) {
    res.status(503).json({ error: 'REST API unavailable', detail: String(err) });
  }
});

router.post('/command', requireAuth, requirePermission('console.rcon'), async (req, res) => {
  const inst = getInstance(parseInt(req.params.instanceId, 10));
  if (!inst) { res.status(404).json({ error: 'Instance not found' }); return; }
  const { command } = req.body as { command?: string };
  if (!command) { res.status(400).json({ error: 'command required' }); return; }
  const port = (inst as unknown as Record<string, unknown>).rest_api_port as number | undefined ?? 8212;
  try {
    const result = await restSendCommand(inst.rcon_host, port, inst.rcon_password, command);
    res.json({ result });
  } catch (err) {
    res.status(503).json({ error: 'REST API unavailable', detail: String(err) });
  }
});

export default router;
