import { Router } from 'express';
import fs from 'fs';
import { requireAuth } from '../middleware/auth.js';
import { resolveInstance } from '../middleware/instance.js';
import { listBackups, createBackup, deleteBackup, getBackupSchedule, updateBackupSchedule } from '../services/backup.js';
import { stopServer, startServer } from '../services/palserver.js';
import { rconExec } from '../lib/rcon.js';
import { logAction } from '../services/audit.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, resolveInstance);

router.get('/', (req, res) => res.json(listBackups(req.instance!.id)));

router.post('/', async (req, res) => {
  try {
    const b = await createBackup(req.instance!, 'manual');
    logAction(req.instance!.id, 'backup.create', b.filename);
    res.json(b);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.delete('/:id', (req, res) => {
  try {
    deleteBackup(parseInt(req.params.id, 10), req.instance!.id);
    logAction(req.instance!.id, 'backup.delete', `id=${req.params.id}`);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.get('/:id/download', (req, res) => {
  const b = listBackups(req.instance!.id).find((x) => x.id === parseInt(req.params.id, 10));
  if (!b || !fs.existsSync(b.filepath)) { res.status(404).json({ error: 'Not found' }); return; }
  res.download(b.filepath, b.filename);
});

router.post('/:id/restore', async (req, res) => {
  const inst = req.instance!;
  const b = listBackups(inst.id).find((x) => x.id === parseInt(req.params.id, 10));
  if (!b || !fs.existsSync(b.filepath)) { res.status(404).json({ error: 'Not found' }); return; }

  logAction(inst.id, 'backup.restore', b.filename);
  res.json({ ok: true, message: 'Restore started — server will be briefly offline.' });
  (async () => {
    try {
      await createBackup(inst, 'manual');
      try { await rconExec(inst.rcon_host, inst.rcon_port, inst.rcon_password, 'Save'); } catch {}
      await stopServer(inst);
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      await execAsync(
        `powershell -NoProfile -NonInteractive -Command ` +
          `"Remove-Item -Path '${inst.save_dir}' -Recurse -Force; ` +
          `Expand-Archive -Path '${b.filepath}' -DestinationPath '${inst.save_dir}' -Force"`,
        { timeout: 120_000 },
      );
      await startServer(inst);
    } catch (err) { console.error('Restore failed:', err); }
  })();
});

// Backup schedule configuration
router.get('/schedule', (req, res) => {
  res.json(getBackupSchedule(req.instance!.id));
});

router.patch('/schedule', (req, res) => {
  try {
    updateBackupSchedule(req.instance!, req.body);
    logAction(req.instance!.id, 'backup.schedule.update', JSON.stringify(req.body));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

export default router;
