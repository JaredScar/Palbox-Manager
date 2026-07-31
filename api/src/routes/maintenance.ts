import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { getDb } from '../db/index.js';
import type { Instance } from '../db/types.js';
import { enableMaintenance, disableMaintenance, getMaintenanceState } from '../services/maintenance.js';

const router = Router({ mergeParams: true });

router.get('/', requireAuth, requirePermission('server.view'), (req, res) => {
  const instanceId = parseInt(req.params.instanceId, 10);
  res.json(getMaintenanceState(instanceId));
});

router.post('/enable', requireAuth, requirePermission('maintenance.manage'), async (req, res) => {
  const instanceId = parseInt(req.params.instanceId, 10);
  const { message, countdownMinutes = 5 } = req.body as {
    message?: string; countdownMinutes?: number;
  };
  const inst = getDb().prepare('SELECT * FROM instances WHERE id = ?').get(instanceId) as Instance | undefined;
  if (!inst) { res.status(404).json({ error: 'Instance not found' }); return; }

  await enableMaintenance(inst, message, countdownMinutes);
  res.json({ ok: true });
});

router.post('/disable', requireAuth, requirePermission('maintenance.manage'), (req, res) => {
  const instanceId = parseInt(req.params.instanceId, 10);
  const inst = getDb().prepare('SELECT * FROM instances WHERE id = ?').get(instanceId) as Instance | undefined;
  if (!inst) { res.status(404).json({ error: 'Instance not found' }); return; }

  disableMaintenance(inst);
  res.json({ ok: true });
});

export default router;
