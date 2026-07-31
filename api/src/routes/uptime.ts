import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { getDb } from '../db/index.js';

const router = Router({ mergeParams: true });

/**
 * GET /api/instances/:instanceId/uptime
 * Returns uptime events and computed SLA stats for the last N days (default 30).
 */
router.get('/', requireAuth, requirePermission('server.view'), (req, res) => {
  const instanceId = parseInt(req.params.instanceId, 10);
  const days = Math.min(parseInt(String(req.query.days ?? '30'), 10), 365);
  const since = Math.floor(Date.now() / 1000) - days * 86400;

  const events = getDb()
    .prepare('SELECT * FROM uptime_events WHERE instance_id = ? AND started_at >= ? ORDER BY started_at ASC')
    .all(instanceId, since) as Array<{ id: number; status: string; started_at: number }>;

  // Calculate SLA %
  const now = Math.floor(Date.now() / 1000);
  const windowSec = days * 86400;
  let offlineSec = 0;

  for (let i = 0; i < events.length; i++) {
    const evt = events[i];
    const nextEvt = events[i + 1];
    if (evt.status === 'offline') {
      const end = nextEvt ? nextEvt.started_at : now;
      offlineSec += end - evt.started_at;
    }
  }

  const uptimePct = Math.max(0, Math.min(100, ((windowSec - offlineSec) / windowSec) * 100));

  // Compute outages
  const outages = events
    .filter((e) => e.status === 'offline')
    .map((e, idx, arr) => {
      const nextOnline = events.find((ev) => ev.status === 'online' && ev.started_at > e.started_at);
      const durationSec = nextOnline ? nextOnline.started_at - e.started_at : now - e.started_at;
      return { startedAt: e.started_at, durationSec };
    });

  const longestOutageSec = outages.length ? Math.max(...outages.map((o) => o.durationSec)) : 0;
  const avgOutageSec = outages.length ? outages.reduce((sum, o) => sum + o.durationSec, 0) / outages.length : 0;

  res.json({
    events,
    sla: { uptimePct: Math.round(uptimePct * 100) / 100, offlineSec, days },
    outages: { count: outages.length, longestSec: longestOutageSec, avgSec: Math.round(avgOutageSec) },
  });
});

export default router;
