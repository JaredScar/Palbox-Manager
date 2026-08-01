import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { resolveInstance } from '../middleware/instance.js';
import { getStatus, startServer, stopServer, restartServer, getCpuAndMemory } from '../services/palserver.js';
import { instPlayers, instSave, instCommand } from '../services/connection.js';
import { getDb } from '../db/index.js';
import { sendDiscord, fireEvent } from '../services/discord.js';
import { isArmed, getLastIntervention, getMetrics24h } from '../services/watchdog.js';
import { resolveInstalledBuildId } from '../services/steamcmd.js';
import { readSettings } from '../services/ini.js';
import { logAction } from '../services/audit.js';
import { getOnlinePlayers, clearPlayers } from '../services/playerTracker.js';
import { emitConsole } from '../ws.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, resolveInstance);

/**
 * Rejects if `p` has not settled within `ms`. Used to keep polled endpoints
 * responsive — a stalled network call must never hold the HTTP response open.
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

router.get('/status', requirePermission('server.view'), async (req, res) => {
  const inst = req.instance!;
  const [{ status, uptime }, { cpuPct, memMb }] = await Promise.all([
    getStatus(inst),
    getCpuAndMemory(inst),
  ]);

  // Clear stale players if the server is offline
  if (status === 'offline') clearPlayers(inst.id);

  // ── Player list ────────────────────────────────────────────────────────────
  // Baseline: in-memory tracker populated by log-file parsing, always
  // available even when neither REST nor RCON is configured.
  let players = getOnlinePlayers(inst.id);

  // Prefer a live query — the REST API returns ping, level, and coordinates,
  // and RCON at least gives authoritative names and ids.
  if (status === 'online' && inst.rcon_password) {
    try {
      // Hard-capped: /status is polled every 10s by the dashboard, so a slow
      // or unreachable host must degrade to the log-based list, never stall.
      const live = await withTimeout(instPlayers(inst, 1500), 9000, 'Player query');
      if (live.length > 0) {
        players = live.map((p) => ({ ...p, joinedAt: 0 }));
      }
      // Zero players is a legitimate answer, so fall through to the log list
      // only when the query itself failed.
    } catch { /* server unreachable — stick with the log-based list */ }
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
  const inst = req.instance!;
  try {
    await startServer(inst);
    logAction(inst.id, 'server.start');
    emitConsole(inst.id, 'Start requested from the panel.');
    fireEvent(inst, 'server_online', '🟢 Server Online', `**${inst.name}** has started.`).catch(() => {});
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.post('/stop', requirePermission('server.stop'), async (req, res) => {
  const inst = req.instance!;
  try {
    fireEvent(inst, 'server_offline', '🔴 Server Offline', `**${inst.name}** is stopping.`).catch(() => {});
    emitConsole(inst.id, 'Stop requested from the panel.');
    await stopServer(inst);
    logAction(inst.id, 'server.stop');
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.post('/restart', requirePermission('server.restart'), async (req, res) => {
  try {
    emitConsole(req.instance!.id, 'Restart requested from the panel.');
    await restartServer(req.instance!);
    logAction(req.instance!.id, 'server.restart');
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.post('/save', requirePermission('server.save'), async (req, res) => {
  const inst = req.instance!;
  try {
    await instSave(inst);
    logAction(inst.id, 'server.save');
    emitConsole(inst.id, 'World saved.');
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.post('/rcon', requirePermission('console.rcon'), async (req, res) => {
  const inst = req.instance!;
  const { command } = req.body as { command?: string };
  if (!command) { res.status(400).json({ error: 'command required' }); return; }
  try {
    emitConsole(inst.id, `> ${command}`);
    const result = await instCommand(inst, command);
    logAction(inst.id, 'rcon', command);
    // Echoing the reply is what makes the console a usable command surface
    // when the game writes no log of its own.
    if (result?.trim()) emitConsole(inst.id, result.trim());
    res.json({ ok: true, result });
  } catch (err) {
    emitConsole(inst.id, `Command failed: ${(err as Error).message}`);
    res.status(500).json({ error: (err as Error).message });
  }
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
