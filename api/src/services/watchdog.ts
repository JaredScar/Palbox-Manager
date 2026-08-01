import { getDb } from '../db/index.js';
import type { Instance, AlertRule } from '../db/types.js';
import { log } from '../lib/logger.js';
import { getStatus, startServer, getCpuAndMemory } from './palserver.js';
import { instPlayers } from './connection.js';
import { sendDiscord } from './discord.js';
import { broadcast } from '../ws.js';
import { evaluateTriggers } from './eventTriggers.js';
import { pushNotification } from './notifications.js';
import { snapshotConfig } from './configHistory.js';

interface WatchdogState {
  armed: boolean;
  lastIntervention: number | null;
  consecutiveFailures: number;
  previousPlayers: Set<string>; // steam IDs currently tracked as online
  lastStatus: 'online' | 'offline' | null;
  previousPlayerCount: number;
}

const state = new Map<number, WatchdogState>();
const timers = new Map<number, NodeJS.Timeout>();

function getState(instanceId: number): WatchdogState {
  if (!state.has(instanceId)) {
    state.set(instanceId, {
      armed: true,
      lastIntervention: null,
      consecutiveFailures: 0,
      previousPlayers: new Set(),
      lastStatus: null,
      previousPlayerCount: 0,
    });
  }
  return state.get(instanceId)!;
}

export function isArmed(instanceId: number): boolean {
  return getState(instanceId).armed;
}
export function setArmed(instanceId: number, v: boolean): void {
  getState(instanceId).armed = v;
}
export function getLastIntervention(instanceId: number): number | null {
  return getState(instanceId).lastIntervention;
}

async function checkHealth(inst: Instance): Promise<void> {
  const s = getState(inst.id);
  const db = getDb();
  const { status, uptime } = await getStatus(inst);
  const { cpuPct, memMb } = await getCpuAndMemory(inst);

  // Liveness heartbeat + player list (REST preferred, RCON fallback)
  let players: { name: string; steamId: string }[] = [];
  let rconOk = false;
  try {
    players = await instPlayers(inst);
    rconOk = true;
    s.consecutiveFailures = 0;
  } catch {
    if (status === 'online') s.consecutiveFailures++;
  }

  // ── Player join/leave events ──────────────────────────────────────────────
  if (rconOk) {
    const currentIds = new Set(players.map((p) => p.steamId));
    const byId = new Map(players.map((p) => [p.steamId, p.name]));

    // Joins
    for (const [sid, name] of byId) {
      if (!s.previousPlayers.has(sid)) {
        db.prepare(
          'INSERT INTO player_events (instance_id, steam_id, player_name, event) VALUES (?,?,?,?)',
        ).run(inst.id, sid, name, 'join');

        // Upsert player record, start session
        db.prepare(`
          INSERT INTO players (instance_id, steam_id, name, last_seen, session_start)
          VALUES (?,?,?,unixepoch(),unixepoch())
          ON CONFLICT(instance_id, steam_id) DO UPDATE SET
            name = excluded.name,
            last_seen = unixepoch(),
            session_start = unixepoch()
        `).run(inst.id, sid, name);

        await sendDiscord(inst, `**${inst.name}** — \`${name}\` joined the server.`, 'player_joined');
        log.info(`[${inst.name}] ${name} joined`);
      }
    }

    // Leaves
    for (const sid of s.previousPlayers) {
      if (!currentIds.has(sid)) {
        const playerRow = db
          .prepare('SELECT name, session_start FROM players WHERE instance_id = ? AND steam_id = ?')
          .get(inst.id, sid) as { name: string; session_start: number | null } | undefined;
        const name = playerRow?.name ?? sid;

        db.prepare(
          'INSERT INTO player_events (instance_id, steam_id, player_name, event) VALUES (?,?,?,?)',
        ).run(inst.id, sid, name, 'leave');

        // Accumulate playtime
        if (playerRow?.session_start) {
          const sessionSeconds = Math.floor(Date.now() / 1000) - playerRow.session_start;
          db.prepare(
            'UPDATE players SET playtime_s = playtime_s + ?, last_seen = unixepoch(), session_start = NULL WHERE instance_id = ? AND steam_id = ?',
          ).run(sessionSeconds, inst.id, sid);
        }

        await sendDiscord(inst, `**${inst.name}** — \`${name}\` left the server.`, 'player_left');
        log.info(`[${inst.name}] ${name} left`);
      }
    }

    s.previousPlayers = currentIds;
  }

  // ── Record metrics ─────────────────────────────────────────────────────────
  db.prepare('INSERT INTO metrics (instance_id, players, cpu_pct, mem_mb) VALUES (?,?,?,?)').run(
    inst.id, players.length, cpuPct, memMb,
  );
  // Prune metrics older than 30 days
  const cutoff = Math.floor(Date.now() / 1000) - 30 * 86400;
  db.prepare('DELETE FROM metrics WHERE instance_id = ? AND recorded_at < ?').run(inst.id, cutoff);

  // ── Broadcast live status ──────────────────────────────────────────────────
  broadcast({
    type: 'status',
    instanceId: inst.id,
    status,
    uptime,
    playerCount: players.length,
    players,
    cpuPct,
    memMb,
  });

  // ── Evaluate event triggers ────────────────────────────────────────────────
  const curStatus: 'online' | 'offline' = status === 'online' ? 'online' : 'offline';
  await evaluateTriggers(inst, {
    status: curStatus,
    prevStatus: s.lastStatus,
    cpuPct,
    memMb,
    playerCount: players.length,
    prevPlayerCount: s.previousPlayerCount,
  }).catch((err) => log.warn(`[${inst.name}] Trigger eval error:`, err));
  s.previousPlayerCount = players.length;

  // ── Auto-restart if armed ──────────────────────────────────────────────────
  const gracePeriod = 2; // consecutive failures before restart
  if (s.armed && status === 'offline' && s.consecutiveFailures >= gracePeriod) {
    log.warn(`[${inst.name}] Watchdog: server offline — restarting…`);
    s.lastIntervention = Date.now();
    s.consecutiveFailures = 0;
    db.prepare(
      "INSERT INTO watchdog_events (instance_id, event, detail) VALUES (?, 'restart', 'Server offline')",
    ).run(inst.id);
    await sendDiscord(inst, `**Palbox watchdog** — \`${inst.name}\` was offline and has been restarted.`, 'server_offline');
    pushNotification(inst.id, 'Watchdog restarted server', `${inst.name} was offline and has been auto-restarted.`, 'warn');
    try {
      await startServer(inst);
    } catch (err) {
      log.error(`[${inst.name}] Watchdog restart failed:`, err);
    }
    broadcast({ type: 'watchdog', instanceId: inst.id, event: 'restart', ts: s.lastIntervention });
  }

  // ── Uptime status transitions ──────────────────────────────────────────────
  if (s.lastStatus !== curStatus) {
    db.prepare('INSERT INTO uptime_events (instance_id, status) VALUES (?, ?)').run(inst.id, curStatus);
    if (curStatus === 'offline') {
      pushNotification(inst.id, 'Server went offline', inst.name, 'error');
    } else {
      pushNotification(inst.id, 'Server is online', inst.name, 'success');
    }
    s.lastStatus = curStatus;
  }

  // ── Snapshot INI config (detect changes) ─────────────────────────────────
  snapshotConfig(inst);

  // ── Check alert rules ──────────────────────────────────────────────────────
  const alertRules = db
    .prepare('SELECT * FROM alert_rules WHERE instance_id = ? AND enabled = 1')
    .all(inst.id) as AlertRule[];

  const nowSec = Math.floor(Date.now() / 1000);
  for (const rule of alertRules) {
    // Check cooldown
    if (rule.last_fired && nowSec - rule.last_fired < rule.cooldown_m * 60) continue;

    let actual: number | null = null;
    if (rule.metric === 'cpu')     actual = cpuPct;
    if (rule.metric === 'memory')  actual = memMb;
    if (rule.metric === 'players') actual = players.length;
    if (rule.metric === 'status')  actual = status === 'online' ? 1 : 0;
    if (actual === null) continue;

    const triggered =
      (rule.operator === 'gt' && actual > rule.threshold) ||
      (rule.operator === 'lt' && actual < rule.threshold) ||
      (rule.operator === 'eq' && actual === rule.threshold);

    if (triggered) {
      const detail = `${rule.metric} is ${actual} (${rule.operator} ${rule.threshold})`;
      const msg = `**Palbox alert** — \`${inst.name}\` | ${rule.name}: ${detail}`;
      await sendDiscord(inst, msg, 'alert');
      db.prepare('UPDATE alert_rules SET last_fired = ? WHERE id = ?').run(nowSec, rule.id);
      pushNotification(inst.id, `Alert: ${rule.name}`, detail, 'warn');
      log.warn(`[${inst.name}] Alert fired: "${rule.name}"`);
    }
  }
}

export function startWatchdog(inst: Instance): void {
  if (timers.has(inst.id)) clearInterval(timers.get(inst.id)!);
  const timer = setInterval(() => {
    checkHealth(inst).catch((err) => log.warn(`[${inst.name}] Watchdog tick error:`, err));
  }, 30_000);
  timers.set(inst.id, timer);
  setTimeout(() => checkHealth(inst).catch(() => {}), 5_000);
  log.info(`[${inst.name}] Watchdog started`);
}

export function getMetrics24h(
  instanceId: number,
): { players: number; cpu_pct: number; mem_mb: number; recorded_at: number }[] {
  const cutoff = Math.floor(Date.now() / 1000) - 86400;
  return getDb()
    .prepare(
      'SELECT players, cpu_pct, mem_mb, recorded_at FROM metrics WHERE instance_id = ? AND recorded_at > ? ORDER BY recorded_at ASC',
    )
    .all(instanceId, cutoff) as { players: number; cpu_pct: number; mem_mb: number; recorded_at: number }[];
}

export function getMetrics(
  instanceId: number,
  hours: number,
): { players: number; cpu_pct: number; mem_mb: number; recorded_at: number }[] {
  const cutoff = Math.floor(Date.now() / 1000) - hours * 3600;
  return getDb()
    .prepare(
      'SELECT players, cpu_pct, mem_mb, recorded_at FROM metrics WHERE instance_id = ? AND recorded_at > ? ORDER BY recorded_at ASC',
    )
    .all(instanceId, cutoff) as { players: number; cpu_pct: number; mem_mb: number; recorded_at: number }[];
}

export function getWatchdogEvents(
  instanceId: number,
): { id: number; event: string; detail: string | null; created_at: number }[] {
  return getDb()
    .prepare('SELECT * FROM watchdog_events WHERE instance_id = ? ORDER BY created_at DESC LIMIT 50')
    .all(instanceId) as { id: number; event: string; detail: string | null; created_at: number }[];
}
