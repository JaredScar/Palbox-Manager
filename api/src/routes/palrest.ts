import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { getDb } from '../db/index.js';
import type { Instance } from '../db/types.js';
import { instRestInfo, instRestPlayers, instRestCommand } from '../services/connection.js';

const router = Router({ mergeParams: true });

function getInstance(instanceId: number): Instance | undefined {
  return getDb().prepare('SELECT * FROM instances WHERE id = ?').get(instanceId) as Instance | undefined;
}

router.get('/info', requireAuth, requirePermission('server.view'), async (req, res) => {
  const inst = getInstance(parseInt(req.params.instanceId, 10));
  if (!inst) { res.status(404).json({ error: 'Instance not found' }); return; }
  try {
    res.json(await instRestInfo(inst));
  } catch (err) {
    res.status(503).json({ error: 'REST API unavailable', detail: String(err) });
  }
});

router.get('/players', requireAuth, requirePermission('players.view'), async (req, res) => {
  const inst = getInstance(parseInt(req.params.instanceId, 10));
  if (!inst) { res.status(404).json({ error: 'Instance not found' }); return; }
  try {
    res.json(await instRestPlayers(inst));
  } catch (err) {
    res.status(503).json({ error: 'REST API unavailable', detail: String(err) });
  }
});

router.post('/command', requireAuth, requirePermission('console.rcon'), async (req, res) => {
  const inst = getInstance(parseInt(req.params.instanceId, 10));
  if (!inst) { res.status(404).json({ error: 'Instance not found' }); return; }
  const { command } = req.body as { command?: string };
  if (!command) { res.status(400).json({ error: 'command required' }); return; }
  try {
    res.json({ result: await instRestCommand(inst, command) });
  } catch (err) {
    res.status(503).json({ error: 'REST API unavailable', detail: String(err) });
  }
});

export default router;
