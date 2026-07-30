import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { resolveInstance } from '../middleware/instance.js';
import { getDb } from '../db/index.js';
import type { AlertRule } from '../db/types.js';
import { logAction } from '../services/audit.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, resolveInstance);

router.get('/', (req, res) => {
  const rows = getDb()
    .prepare('SELECT * FROM alert_rules WHERE instance_id = ? ORDER BY created_at ASC')
    .all(req.instance!.id) as AlertRule[];
  res.json(rows);
});

router.post('/', (req, res) => {
  const inst = req.instance!;
  const { name, metric, operator, threshold, cooldown_m = 30, enabled = 1 } = req.body as Partial<AlertRule & { enabled: number; cooldown_m: number }>;
  if (!name || !metric || !operator || threshold === undefined) {
    res.status(400).json({ error: 'name, metric, operator, and threshold required' }); return;
  }
  const result = getDb()
    .prepare('INSERT INTO alert_rules (instance_id, name, metric, operator, threshold, cooldown_m, enabled) VALUES (?,?,?,?,?,?,?)')
    .run(inst.id, name, metric, operator, threshold, cooldown_m, enabled);
  logAction(inst.id, 'alert.create', `"${name}": ${metric} ${operator} ${threshold}`);
  res.json({ id: result.lastInsertRowid });
});

router.patch('/:id', (req, res) => {
  const inst = req.instance!;
  const { name, metric, operator, threshold, cooldown_m, enabled } = req.body as Partial<AlertRule>;
  const fields: string[] = [];
  const vals: unknown[] = [];
  if (name !== undefined)       { fields.push('name = ?');       vals.push(name); }
  if (metric !== undefined)     { fields.push('metric = ?');     vals.push(metric); }
  if (operator !== undefined)   { fields.push('operator = ?');   vals.push(operator); }
  if (threshold !== undefined)  { fields.push('threshold = ?');  vals.push(threshold); }
  if (cooldown_m !== undefined) { fields.push('cooldown_m = ?'); vals.push(cooldown_m); }
  if (enabled !== undefined)    { fields.push('enabled = ?');    vals.push(enabled); }
  if (fields.length === 0)      { res.status(400).json({ error: 'nothing to update' }); return; }
  vals.push(parseInt(req.params.id, 10), inst.id);
  getDb().prepare(`UPDATE alert_rules SET ${fields.join(', ')} WHERE id = ? AND instance_id = ?`).run(...vals);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const inst = req.instance!;
  const row = getDb().prepare('SELECT name FROM alert_rules WHERE id = ? AND instance_id = ?')
    .get(parseInt(req.params.id, 10), inst.id) as { name: string } | undefined;
  getDb().prepare('DELETE FROM alert_rules WHERE id = ? AND instance_id = ?')
    .run(parseInt(req.params.id, 10), inst.id);
  if (row) logAction(inst.id, 'alert.delete', row.name);
  res.json({ ok: true });
});

export default router;
