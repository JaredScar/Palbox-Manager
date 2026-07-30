import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { resolveInstance } from '../middleware/instance.js';
import { getStatus, startServer, stopServer, restartServer, getCpuAndMemory } from '../services/palserver.js';
import { rconExec } from '../lib/rcon.js';
import { getDb } from '../db/index.js';
import { sendDiscord } from '../services/discord.js';
import { isArmed, getLastIntervention, getMetrics24h } from '../services/watchdog.js';
import { getInstalledBuildId } from '../services/steamcmd.js';
import { readSettings } from '../services/ini.js';
import { logAction } from '../services/audit.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, resolveInstance);

router.get('/status', async (req, res) => {
  const inst = req.instance!;
  const [{ status, uptime }, { cpuPct, memMb }] = await Promise.all([
    getStatus(inst),
    getCpuAndMemory(inst),
  ]);

  let players: { name: string; playerUid: string; steamId: string }[] = [];
  try {
    const raw = await rconExec(inst.rcon_host, inst.rcon_port, inst.rcon_password, 'ShowPlayers');
    players = raw.split('\n').filter((l) => l.includes(',')).map((l) => {
      const parts = l.split(',');
      return { name: parts[0]?.trim() ?? '', playerUid: parts[1]?.trim() ?? '', steamId: parts[2]?.trim() ?? '' };
    });
  } catch { /* offline */ }

  res.json({
    status,
    uptime,
    cpuPct,
    memMb,
    players,
    buildId: getInstalledBuildId(inst.id),
    watchdogArmed: isArmed(inst.id),
    lastWatchdogIntervention: getLastIntervention(inst.id),
    instance: inst,
  });
});

router.get('/metrics', (req, res) => {
  const hours = parseInt(String(req.query.hours ?? '24'), 10);
  const { getMetrics } = require('../services/watchdog');
  res.json(getMetrics(req.instance!.id, hours));
});

router.post('/start', async (req, res) => {
  try {
    await startServer(req.instance!);
    logAction(req.instance!.id, 'server.start');
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.post('/stop', async (req, res) => {
  try {
    await sendDiscord(req.instance!, `**Palbox** — \`${req.instance!.name}\` is stopping.`, 'server_offline');
    await stopServer(req.instance!);
    logAction(req.instance!.id, 'server.stop');
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.post('/restart', async (req, res) => {
  try {
    await restartServer(req.instance!);
    logAction(req.instance!.id, 'server.restart');
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.post('/save', async (req, res) => {
  const inst = req.instance!;
  try {
    await rconExec(inst.rcon_host, inst.rcon_port, inst.rcon_password, 'Save');
    logAction(inst.id, 'server.save');
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.post('/rcon', async (req, res) => {
  const inst = req.instance!;
  const { command } = req.body as { command?: string };
  if (!command) { res.status(400).json({ error: 'command required' }); return; }
  try {
    const result = await rconExec(inst.rcon_host, inst.rcon_port, inst.rcon_password, command);
    logAction(inst.id, 'rcon', command);
    res.json({ ok: true, result });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.get('/watchdog', (req, res) => {
  const { getWatchdogEvents } = require('../services/watchdog');
  res.json({
    armed: isArmed(req.instance!.id),
    lastIntervention: getLastIntervention(req.instance!.id),
    events: getWatchdogEvents(req.instance!.id),
  });
});

router.patch('/watchdog', (req, res) => {
  const { setArmed } = require('../services/watchdog');
  const { armed } = req.body as { armed?: boolean };
  if (armed !== undefined) setArmed(req.instance!.id, armed);
  res.json({ ok: true });
});

// World overview — key settings parsed from the ini file
router.get('/world', (req, res) => {
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
