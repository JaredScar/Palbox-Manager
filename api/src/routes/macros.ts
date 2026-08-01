import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { resolveInstance } from '../middleware/instance.js';
import { getDb } from '../db/index.js';
import type { RconMacro } from '../db/types.js';
import { instRcon } from '../services/connection.js';
import { logAction } from '../services/audit.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, resolveInstance);

router.get('/', requirePermission('macros.manage'), (req, res) => {
  const rows = getDb()
    .prepare('SELECT * FROM rcon_macros WHERE instance_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(req.instance!.id) as RconMacro[];
  res.json(rows);
});

router.post('/', requirePermission('macros.manage'), (req, res) => {
  const inst = req.instance!;
  const { name, command, description = '', color = '#a79fc7' } = req.body as Partial<RconMacro>;
  if (!name || !command) { res.status(400).json({ error: 'name and command required' }); return; }
  const result = getDb()
    .prepare('INSERT INTO rcon_macros (instance_id, name, command, description, color) VALUES (?,?,?,?,?)')
    .run(inst.id, name, command, description, color);
  logAction(inst.id, 'macro.create', `"${name}": ${command}`);
  res.json({ id: result.lastInsertRowid });
});

router.patch('/:id', requirePermission('macros.manage'), (req, res) => {
  const inst = req.instance!;
  const { name, command, description, color, sort_order } = req.body as Partial<RconMacro>;
  const fields: string[] = [];
  const vals: unknown[] = [];
  if (name !== undefined)       { fields.push('name = ?');        vals.push(name); }
  if (command !== undefined)    { fields.push('command = ?');     vals.push(command); }
  if (description !== undefined){ fields.push('description = ?'); vals.push(description); }
  if (color !== undefined)      { fields.push('color = ?');       vals.push(color); }
  if (sort_order !== undefined) { fields.push('sort_order = ?');  vals.push(sort_order); }
  if (fields.length === 0)      { res.status(400).json({ error: 'nothing to update' }); return; }
  vals.push(parseInt(req.params.id, 10), inst.id);
  getDb().prepare(`UPDATE rcon_macros SET ${fields.join(', ')} WHERE id = ? AND instance_id = ?`).run(...vals);
  res.json({ ok: true });
});

router.delete('/:id', requirePermission('macros.manage'), (req, res) => {
  const inst = req.instance!;
  const row = getDb().prepare('SELECT name FROM rcon_macros WHERE id = ? AND instance_id = ?')
    .get(parseInt(req.params.id, 10), inst.id) as { name: string } | undefined;
  getDb().prepare('DELETE FROM rcon_macros WHERE id = ? AND instance_id = ?')
    .run(parseInt(req.params.id, 10), inst.id);
  if (row) logAction(inst.id, 'macro.delete', row.name);
  res.json({ ok: true });
});

// Run a macro immediately
router.post('/:id/run', requirePermission('macros.manage'), async (req, res) => {
  const inst = req.instance!;
  const macro = getDb()
    .prepare('SELECT * FROM rcon_macros WHERE id = ? AND instance_id = ?')
    .get(parseInt(req.params.id, 10), inst.id) as RconMacro | undefined;
  if (!macro) { res.status(404).json({ error: 'Macro not found' }); return; }
  try {
    const result = await instRcon(inst, macro.command);
    logAction(inst.id, 'macro.run', `"${macro.name}": ${macro.command}`);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
