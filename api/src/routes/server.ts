import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { resolveInstance } from '../middleware/instance.js';
import { getStatus, startServer, stopServer, restartServer, getCpuAndMemory } from '../services/palserver.js';
import { rconExec } from '../lib/rcon.js';
import { getDb } from '../db/index.js';
import { sendDiscord } from '../services/discord.js';
import { isArmed, getLastIntervention, getMetrics24h } from '../services/watchdog.js';
import { resolveInstalledBuildId } from '../services/steamcmd.js';
import { readSettings } from '../services/ini.js';
import { logAction } from '../services/audit.js';
import { getOnlinePlayers, clearPlayers } from '../services/playerTracker.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, resolveInstance);

router.get('/status', requirePermission('server.view'), async (req, res) => {
  const inst = req.instance!;
  const [{ status, uptime }, { cpuPct, memMb }] = await Promise.all([
    getStatus(inst),
    getCpuAndMemory(inst),
  ]);

  // Clear stale players if the server is offline
  if (status === 'offline') clearPlayers(inst.id);

  // ── Player list ────────────────────────────────────────────────────────────
  // Primary source: in-memory tracker populated by log-file parsing (always
  // available even when RCON is not configured).
  let players = getOnlinePlayers(inst.id);

  // Supplement with RCON ShowPlayers if configured — it provides richer data
  // (steam IDs) and is authoritative when available.
  if (status === 'online' && inst.rcon_password) {
    try {
      const raw = await rconExec(inst.rcon_host, inst.rcon_port, inst.rcon_password, 'ShowPlayers');
      // Response: first line is a header "name,playeruid,steamid" — skip it.
      const lines = raw.split('\n').slice(1).filter((l) => l.includes(','));
      if (lines.length > 0) {
        // RCON is working and has real data — prefer it over log tracking
        players = lines.map((l) => {
          const parts = l.split(',');
          return {
            name:      parts[0]?.trim() ?? '',
            playerUid: parts[1]?.trim() ?? '',
            steamId:   parts[2]?.trim() ?? '',
            joinedAt:  0,
          };
        });
      }
      // If RCON returned 0 lines (empty server), fall through to log-based count
    } catch { /* RCON not reachable — stick with log-based list */ }
  }

  res.json({
    status,
    uptime,
    cpuPct,
    memMb,
    players,
    buildId: resolveInstalledBuildId(inst),
    watchdogArmed: isArmed(inst.id),
    lastWatchdogIntervention: getLastIntervention(inst.id),
    instance: inst,
  });
});

router.get('/metrics', requirePermission('metrics.view'), (req, res) => {
  const hours = parseInt(String(req.query.hours ?? '24'), 10);
  const { getMetrics } = require('../services/watchdog');
  res.json(getMetrics(req.instance!.id, hours));
});

// Metrics export (CSV / JSON) with custom date range
router.get('/metrics/export', requirePermission('metrics.view'), (req, res) => {
  const nowSec = Math.floor(Date.now() / 1000);
  const from = parseInt(String(req.query.from ?? nowSec - 7 * 86400), 10);
  const to   = parseInt(String(req.query.to   ?? nowSec), 10);
  const fmt  = String(req.query.format ?? 'json');

  const rows = getDb()
    .prepare(`SELECT * FROM metrics WHERE instance_id = ? AND recorded_at BETWEEN ? AND ? ORDER BY recorded_at`)
    .all(req.instance!.id, from, to) as { id: number; players: number; cpu_pct: number; mem_mb: number; recorded_at: number }[];

  if (fmt === 'csv') {
    const name = `metrics-${req.instance!.id}-${from}-${to}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    const lines = ['timestamp,datetime,players,cpu_pct,mem_mb',
      ...rows.map((r) => `${r.recorded_at},${new Date(r.recorded_at * 1000).toISOString()},${r.players},${r.cpu_pct.toFixed(2)},${r.mem_mb.toFixed(1)}`),
    ];
    res.send(lines.join('\r\n'));
  } else {
    const name = `metrics-${req.instance!.id}-${from}-${to}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.json(rows);
  }
});

// Player peak hours — 7×24 heatmap (avg player count per day-of-week + hour)
router.get('/metrics/heatmap', requirePermission('metrics.view'), (req, res) => {
  const rows = getDb()
    .prepare(`
      SELECT
        CAST(strftime('%w', datetime(recorded_at, 'unixepoch')) AS INTEGER) AS dow,
        CAST(strftime('%H', datetime(recorded_at, 'unixepoch')) AS INTEGER) AS hour,
        AVG(players) AS avg_players,
        MAX(players) AS max_players,
        COUNT(*) AS samples
      FROM metrics
      WHERE instance_id = ?
      GROUP BY dow, hour
    `)
    .all(req.instance!.id) as { dow: number; hour: number; avg_players: number; max_players: number; samples: number }[];
  res.json(rows);
});

router.post('/start', requirePermission('server.start'), async (req, res) => {
  try {
    await startServer(req.instance!);
    logAction(req.instance!.id, 'server.start');
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.post('/stop', requirePermission('server.stop'), async (req, res) => {
  try {
    await sendDiscord(req.instance!, `**Palbox** — \`${req.instance!.name}\` is stopping.`, 'server_offline');
    await stopServer(req.instance!);
    logAction(req.instance!.id, 'server.stop');
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.post('/restart', requirePermission('server.restart'), async (req, res) => {
  try {
    await restartServer(req.instance!);
    logAction(req.instance!.id, 'server.restart');
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.post('/save', requirePermission('server.save'), async (req, res) => {
  const inst = req.instance!;
  try {
    await rconExec(inst.rcon_host, inst.rcon_port, inst.rcon_password, 'Save');
    logAction(inst.id, 'server.save');
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.post('/rcon', requirePermission('console.rcon'), async (req, res) => {
  const inst = req.instance!;
  const { command } = req.body as { command?: string };
  if (!command) { res.status(400).json({ error: 'command required' }); return; }
  try {
    const result = await rconExec(inst.rcon_host, inst.rcon_port, inst.rcon_password, command);
    logAction(inst.id, 'rcon', command);
    res.json({ ok: true, result });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.get('/watchdog', requirePermission('server.view'), (req, res) => {
  const { getWatchdogEvents } = require('../services/watchdog');
  res.json({
    armed: isArmed(req.instance!.id),
    lastIntervention: getLastIntervention(req.instance!.id),
    events: getWatchdogEvents(req.instance!.id),
  });
});

router.patch('/watchdog', requirePermission('settings.manage'), (req, res) => {
  const { setArmed } = require('../services/watchdog');
  const { armed } = req.body as { armed?: boolean };
  if (armed !== undefined) setArmed(req.instance!.id, armed);
  res.json({ ok: true });
});

// World overview — key settings parsed from the ini file
router.get('/world', requirePermission('world.view'), (req, res) => {
  try {
    const s = readSettings(req.instance!);
    res.json({
      serverName: s.ServerName,
      serverDescription: s.ServerDescription,
      maxPlayers: parseInt(s.ServerPlayerMaxNum, 10),
      isPvP: s.bIsPvP === 'True',
      isMultiplay: s.bIsMultiplay === 'True',
      difficulty: s.Difficulty,
      expRate: parseFloat(s.ExpRate),
      palCaptureRate: parseFloat(s.PalCaptureRate),
      deathPenalty: s.DeathPenalty,
      workSpeedRate: parseFloat(s.WorkSpeedRate),
      dayTimeSpeedRate: parseFloat(s.DayTimeSpeedRate),
      nightTimeSpeedRate: parseFloat(s.NightTimeSpeedRate),
      guildPlayerMaxNum: parseInt(s.GuildPlayerMaxNum, 10),
      enableFriendlyFire: s.bEnableFriendlyFire === 'True',
      enablePvp: s.bEnablePlayerToPlayerDamage === 'True',
      rconEnabled: s.RCONEnabled === 'True',
      region: s.Region,
    });
  } catch {
    res.json({});
  }
});

export default router;
