import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth';
import { resolveInstance } from '../middleware/instance';
import { readSettings, writeSettings, readIniRaw, writeIniRaw } from '../services/ini';
import { getDb } from '../db';
import { setArmed } from '../services/watchdog';

const router = Router({ mergeParams: true });
router.use(requireAuth, resolveInstance);

router.get('/', requirePermission('settings.view'), (req, res) => {
  try { res.json(readSettings(req.instance!)); }
  catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.patch('/', requirePermission('settings.manage'), (req, res) => {
  try { writeSettings(req.instance!, req.body as Record<string, string>); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.get('/raw', requirePermission('settings.view'), (req, res) => {
  try { res.json({ content: readIniRaw(req.instance!) }); }
  catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.put('/raw', requirePermission('settings.manage'), (req, res) => {
  const { content } = req.body as { content?: string };
  if (typeof content !== 'string') { res.status(400).json({ error: 'content required' }); return; }
  try { writeIniRaw(req.instance!, content); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.get('/app', requirePermission('settings.view'), (req, res) => {
  const rows = getDb()
    .prepare('SELECT key, value FROM settings WHERE instance_id = ?')
    .all(req.instance!.id) as { key: string; value: string }[];
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  res.json(map);
});

router.patch('/app', requirePermission('settings.manage'), (req, res) => {
  const inst = req.instance!;
  const db = getDb();
  const updates = req.body as Record<string, string>;
  for (const [key, value] of Object.entries(updates)) {
    db.prepare('INSERT OR REPLACE INTO settings (instance_id, key, value) VALUES (?,?,?)')
      .run(inst.id, key, String(value));
  }
  if ('watchdog_enabled' in updates) setArmed(inst.id, updates.watchdog_enabled === 'true');
  res.json({ ok: true });
});

export default router;
