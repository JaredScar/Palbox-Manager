import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth';
import { resolveInstance } from '../middleware/instance';
import { getBuildInfo, checkForUpdate, runUpdate, getUpdateHistory } from '../services/steamcmd';
import { stopServer, startServer } from '../services/palserver';
import { rconExec } from '../lib/rcon';
import { broadcast } from '../ws';
import { getSchedule, updateSchedule, syncScheduler, getNextRestart } from '../services/scheduler';
import { pushNotification } from '../services/notifications';

const router = Router({ mergeParams: true });
router.use(requireAuth, resolveInstance);

router.get('/', requirePermission('updates.view'), (req, res) => {
  const inst = req.instance!;
  res.json({ ...getBuildInfo(inst), history: getUpdateHistory(inst.id) });
});

router.post('/check', requirePermission('updates.view'), async (req, res) => {
  try { res.json(await checkForUpdate(req.instance!)); }
  catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

const updatingInstances = new Set<number>();

router.post('/apply', requirePermission('updates.apply'), async (req, res) => {
  const inst = req.instance!;
  if (updatingInstances.has(inst.id)) { res.status(409).json({ error: 'Update already in progress' }); return; }
  updatingInstances.add(inst.id);
  res.json({ ok: true, message: 'Update started — watch the Console tab or the Updates page.' });
  pushNotification(inst.id, 'Game update started', `Updating ${inst.name} — server will restart.`, 'info');
  (async () => {
    try {
      try {
        await rconExec(inst.rcon_host, inst.rcon_port, inst.rcon_password, 'Broadcast Server is updating in 60 seconds.');
        await new Promise((r) => setTimeout(r, 50_000));
        await rconExec(inst.rcon_host, inst.rcon_port, inst.rcon_password, 'Broadcast Server updating in 10 seconds!');
        await new Promise((r) => setTimeout(r, 10_000));
        await rconExec(inst.rcon_host, inst.rcon_port, inst.rcon_password, 'Save');
      } catch {}
      await stopServer(inst);
      await runUpdate(inst, (line) => {
        broadcast({ type: 'log', instanceId: inst.id, line: `[steamcmd] ${line}` });
        broadcast({ type: 'update_progress', instanceId: inst.id, line });
      });
      await startServer(inst);
      broadcast({ type: 'update_complete', instanceId: inst.id });
      pushNotification(inst.id, 'Game update complete', `Server updated and restarted.`, 'success');
    } catch (err) {
      broadcast({ type: 'log', instanceId: inst.id, line: `[update error] ${(err as Error).message}` });
      pushNotification(inst.id, 'Game update failed', (err as Error).message, 'error');
    } finally { updatingInstances.delete(inst.id); }
  })();
});

// ── Scheduled restarts ────────────────────────────────────────────────────
router.get('/schedule', requirePermission('restarts.view'), (req, res) => {
  const sched = getSchedule(req.instance!.id);
  res.json({ ...sched, nextRestart: getNextRestart(req.instance!.id) });
});

router.patch('/schedule', requirePermission('restarts.manage'), (req, res) => {
  const inst = req.instance!;
  const patch = req.body as Parameters<typeof updateSchedule>[1];
  const updated = updateSchedule(inst.id, patch);
  syncScheduler(inst);
  res.json({ ...updated, nextRestart: getNextRestart(inst.id) });
});

export default router;
