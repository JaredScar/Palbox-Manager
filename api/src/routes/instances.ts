import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getDb } from '../db';
import type { Instance } from '../db/types';
import { startBackupScheduler } from '../services/backup';
import { startUpdatePoller } from '../services/steamcmd';
import { startWatchdog } from '../services/watchdog';
import { syncScheduler } from '../services/scheduler';

const router = Router();
router.use(requireAuth);

router.get('/', (_req, res) => {
  const instances = getDb().prepare('SELECT * FROM instances ORDER BY id ASC').all() as Instance[];
  res.json(instances);
});

router.post('/', requirePermission('settings.manage'), (req, res) => {
  const body = req.body as Partial<Instance>;
  const { name, service_name, save_dir, backup_dir, settings_ini } = body;
  if (!name || !service_name || !save_dir || !backup_dir || !settings_ini) {
    res.status(400).json({ error: 'name, service_name, save_dir, backup_dir, settings_ini are required' });
    return;
  }
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO instances (name, service_name, exe_path, save_dir, backup_dir, settings_ini,
      log_file, rcon_host, rcon_port, rcon_password, public_ip, game_port, steamcmd_exe, mods_dir)
    VALUES (@name, @service_name, @exe_path, @save_dir, @backup_dir, @settings_ini,
      @log_file, @rcon_host, @rcon_port, @rcon_password, @public_ip, @game_port, @steamcmd_exe, @mods_dir)
  `).run({
    name,
    service_name,
    exe_path: body.exe_path ?? '',
    save_dir,
    backup_dir,
    settings_ini,
    log_file: body.log_file ?? '',
    rcon_host: body.rcon_host ?? '127.0.0.1',
    rcon_port: body.rcon_port ?? 25575,
    rcon_password: body.rcon_password ?? '',
    public_ip: body.public_ip ?? '',
    game_port: body.game_port ?? 8211,
    steamcmd_exe: body.steamcmd_exe ?? '',
    mods_dir: body.mods_dir ?? '',
  });
  const inst = db.prepare('SELECT * FROM instances WHERE id = ?').get(result.lastInsertRowid) as Instance;

  // Start background services for the new instance
  startBackupScheduler(inst);
  startUpdatePoller(inst);
  startWatchdog(inst);
  syncScheduler(inst);

  res.status(201).json(inst);
});

router.patch('/:id', requirePermission('settings.manage'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const db = getDb();
  const inst = db.prepare('SELECT * FROM instances WHERE id = ?').get(id) as Instance | undefined;
  if (!inst) { res.status(404).json({ error: 'Not found' }); return; }

  const allowed: (keyof Instance)[] = [
    'name', 'service_name', 'exe_path', 'save_dir', 'backup_dir',
    'settings_ini', 'log_file', 'rcon_host', 'rcon_port', 'rcon_password',
    'public_ip', 'game_port', 'steamcmd_exe', 'mods_dir',
  ];
  const updates = req.body as Partial<Instance>;
  const fields = allowed.filter((k) => k in updates);
  if (fields.length === 0) { res.status(400).json({ error: 'No valid fields to update' }); return; }

  const set = fields.map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE instances SET ${set} WHERE id = @id`).run({ ...updates, id });
  const updated = db.prepare('SELECT * FROM instances WHERE id = ?').get(id) as Instance;
  res.json(updated);
});

router.delete('/:id', requirePermission('settings.manage'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const db = getDb();
  const count = (db.prepare('SELECT COUNT(*) as c FROM instances').get() as { c: number }).c;
  if (count <= 1) { res.status(400).json({ error: 'Cannot delete the last instance' }); return; }
  db.prepare('DELETE FROM instances WHERE id = ?').run(id);
  res.json({ ok: true });
});

export default router;
