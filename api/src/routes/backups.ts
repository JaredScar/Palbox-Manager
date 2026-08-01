import { Router } from 'express';
import fs from 'fs';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { resolveInstance } from '../middleware/instance.js';
import { listBackups, createBackup, deleteBackup, getBackupSchedule, updateBackupSchedule } from '../services/backup.js';
import { stopServer, startServer } from '../services/palserver.js';
import { instRcon } from '../services/connection.js';
import { logAction } from '../services/audit.js';
import { broadcast } from '../ws.js';
import { fireEvent } from '../services/discord.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, resolveInstance);

router.get('/', requirePermission('backups.view'), (req, res) => res.json(listBackups(req.instance!.id)));

router.post('/', requirePermission('backups.create'), async (req, res) => {
  const inst = req.instance!;
  try {
    const b = await createBackup(inst, 'manual');
    logAction(inst.id, 'backup.create', b.filename);
    fireEvent(inst, 'backup_created', '💾 Backup Created', `Manual backup \`${b.filename}\` created.`,
      [{ name: 'Size', value: `${(b.size_bytes / 1024 / 1024).toFixed(1)} MB`, inline: true }],
    ).catch(() => {});
    res.json(b);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.delete('/:id', requirePermission('backups.delete'), (req, res) => {
  try {
    deleteBackup(parseInt(req.params.id, 10), req.instance!.id);
    logAction(req.instance!.id, 'backup.delete', `id=${req.params.id}`);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.get('/:id/download', requirePermission('backups.view'), (req, res) => {
  const b = listBackups(req.instance!.id).find((x) => x.id === parseInt(req.params.id, 10));
  if (!b || !fs.existsSync(b.filepath)) { res.status(404).json({ error: 'Not found' }); return; }
  res.download(b.filepath, b.filename);
});

// Track active restores so the UI can query progress without a WS connection
const restoreProgress = new Map<number, { step: string; done: boolean; error: string | null }>();

router.get('/:id/restore/status', requirePermission('backups.restore'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  res.json(restoreProgress.get(id) ?? { step: '', done: true, error: null });
});

router.post('/:id/restore', requirePermission('backups.restore'), async (req, res) => {
  const inst = req.instance!;
  const b = listBackups(inst.id).find((x) => x.id === parseInt(req.params.id, 10));
  if (!b || !fs.existsSync(b.filepath)) { res.status(404).json({ error: 'Not found' }); return; }

  const emit = (step: string, done = false, error: string | null = null) => {
    restoreProgress.set(b.id, { step, done, error });
    broadcast({ type: 'restore_progress', instanceId: inst.id, backupId: b.id, step, done, error });
  };

  logAction(inst.id, 'backup.restore', b.filename);
  res.json({ ok: true, message: 'Restore started — watch the progress indicator.' });

  (async () => {
    try {
      emit('Creating safety backup…');
      await createBackup(inst, 'manual');

      emit('Saving world via RCON…');
      try { await instRcon(inst, 'Save'); } catch {}

      emit('Stopping server…');
      await stopServer(inst);

      emit('Extracting backup…');
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      const psCmd =
        `Remove-Item -Path '${inst.save_dir.replace(/'/g, "''")}' -Recurse -Force -ErrorAction SilentlyContinue; ` +
        `Expand-Archive -Path '${b.filepath.replace(/'/g, "''")}' -DestinationPath '${inst.save_dir.replace(/'/g, "''")}' -Force`;
      const encoded = Buffer.from(psCmd, 'utf16le').toString('base64');
      await execAsync(
        `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`,
        { timeout: 120_000 },
      );

      emit('Starting server…');
      await startServer(inst);

      emit('Restore complete!', true);
    } catch (err) {
      emit(`Error: ${(err as Error).message}`, true, (err as Error).message);
    } finally {
      setTimeout(() => restoreProgress.delete(b.id), 5 * 60 * 1000);
    }
  })();
});

// Backup schedule configuration
router.get('/schedule', requirePermission('backups.view'), (req, res) => {
  res.json(getBackupSchedule(req.instance!.id));
});

router.patch('/schedule', requirePermission('backups.create'), (req, res) => {
  try {
    updateBackupSchedule(req.instance!, req.body);
    logAction(req.instance!.id, 'backup.schedule.update', JSON.stringify(req.body));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

export default router;
