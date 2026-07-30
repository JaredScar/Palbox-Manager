import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { resolveInstance } from '../middleware/instance.js';
import { getDb } from '../db/index.js';
import type { BroadcastSchedule } from '../db/types.js';
import { syncBroadcaster } from '../services/broadcaster.js';
import { logAction } from '../services/audit.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, resolveInstance);

router.get('/', (req, res) => {
  const rows = getDb()
    .prepare('SELECT * FROM broadcast_schedules WHERE instance_id = ? ORDER BY created_at ASC')
    .all(req.instance!.id) as BroadcastSchedule[];
  res.json(rows);
});

router.post('/', (req, res) => {
  const inst = req.instance!;
  const { name, message, cron, enabled = 1 } = req.body as Partial<BroadcastSchedule & { enabled: number }>;
  if (!name || !message || !cron) { res.status(400).json({ error: 'name, message, and cron required' }); return; }
  const result = getDb()
    .prepare('INSERT INTO broadcast_schedules (instance_id, name, message, cron, enabled) VALUES (?,?,?,?,?)')
    .run(inst.id, name, message, cron, enabled);
  logAction(inst.id, 'broadcast.create', `"${name}": ${cron}`);
  syncBroadcaster(inst);
  res.json({ id: result.lastInsertRowid });
});

router.patch('/:id', (req, res) => {
  const inst = req.instance!;
  const { name, message, cron, enabled } = req.body as Partial<BroadcastSchedule>;
  const fields: string[] = [];
  const vals: unknown[] = [];
  if (name !== undefined)    { fields.push('name = ?');    vals.push(name); }
  if (message !== undefined) { fields.push('message = ?'); vals.push(message); }
  if (cron !== undefined)    { fields.push('cron = ?');    vals.push(cron); }
  if (enabled !== undefined) { fields.push('enabled = ?'); vals.push(enabled); }
  if (fields.length === 0)   { res.status(400).json({ error: 'nothing to update' }); return; }
  vals.push(parseInt(req.params.id, 10), inst.id);
  getDb().prepare(`UPDATE broadcast_schedules SET ${fields.join(', ')} WHERE id = ? AND instance_id = ?`).run(...vals);
  syncBroadcaster(inst);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const inst = req.instance!;
  const row = getDb().prepare('SELECT name FROM broadcast_schedules WHERE id = ? AND instance_id = ?')
    .get(parseInt(req.params.id, 10), inst.id) as { name: string } | undefined;
  getDb().prepare('DELETE FROM broadcast_schedules WHERE id = ? AND instance_id = ?')
    .run(parseInt(req.params.id, 10), inst.id);
  if (row) logAction(inst.id, 'broadcast.delete', row.name);
  syncBroadcaster(inst);
  res.json({ ok: true });
});

export default router;
