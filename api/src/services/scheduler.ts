import cron from 'node-cron';
import { getDb } from '../db';
import type { Instance } from '../db/types';
import { log } from '../lib/logger';
import { stopServer, startServer } from './palserver';
import { rconExec } from '../lib/rcon';

export interface RestartSchedule {
  id: number;
  instance_id: number;
  frequency: 'off' | 'hourly' | '3h' | '6h' | '12h' | 'daily' | 'weekly' | 'custom';
  time: string;       // HH:MM for fixed-time schedules
  cron_expr: string;  // used when frequency === 'custom'
  timezone: string;
  warn_minutes: number;
  enabled: number;
}

const scheduleJobs = new Map<number, ReturnType<typeof cron.schedule>>();

function timeToCron(sched: RestartSchedule): string {
  if (sched.frequency === 'custom') return sched.cron_expr ?? '';
  const [hStr, mStr] = (sched.time ?? '06:00').split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr ?? '0', 10);
  switch (sched.frequency) {
    case 'hourly': return `${m} * * * *`;
    case '3h':     return `${m} */3 * * *`;
    case '6h':     return `${m} */6 * * *`;
    case '12h':    return `${m} ${h},${(h + 12) % 24} * * *`;
    case 'daily':  return `${m} ${h} * * *`;
    case 'weekly': return `${m} ${h} * * 0`;   // Sundays
    default:       return '';
  }
}

/**
 * Return the next scheduled restart as a Unix timestamp (ms), or null if
 * no schedule is active.  We compute it by finding the next Date that
 * matches the cron expression without relying on node-cron internals.
 */
export function getNextRestart(instanceId: number): number | null {
  const sched = getSchedule(instanceId);
  if (!sched.enabled || sched.frequency === 'off') return null;

  const expr = timeToCron(sched);
  if (!expr) return null;

  // Walk forward minute-by-minute (max 1 week) to find the next match
  const parts = expr.split(' '); // min hour dom month dow
  const [minPart, hourPart, , , dowPart] = parts;

  const expandField = (field: string, max: number): number[] => {
    if (field === '*') return Array.from({ length: max }, (_, i) => i);
    return field.split(',').flatMap((seg) => {
      if (seg.startsWith('*/')) {
        const step = parseInt(seg.slice(2), 10);
        return Array.from({ length: Math.ceil(max / step) }, (_, i) => i * step).filter((v) => v < max);
      }
      return [parseInt(seg, 10)];
    });
  };

  const validMins  = expandField(minPart,  60);
  const validHours = expandField(hourPart, 24);
  const validDows  = dowPart === '*' ? [0,1,2,3,4,5,6] : expandField(dowPart, 7);

  const tz = sched.timezone || 'UTC';
  const now = new Date();
  const candidate = new Date(now.getTime() + 60_000); // start 1 min from now

  for (let i = 0; i < 60 * 24 * 7; i++) {
    const local = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: 'numeric', minute: 'numeric',
      weekday: 'narrow', hour12: false,
    }).formatToParts(candidate);

    const get = (t: string) => parseInt(local.find((p) => p.type === t)?.value ?? '0', 10);
    const h   = get('hour') % 24;
    const min = get('minute');
    const dow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
      .indexOf(local.find((p) => p.type === 'weekday')?.value ?? 'Sun');

    if (validHours.includes(h) && validMins.includes(min) && validDows.includes(dow)) {
      return candidate.getTime();
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }
  return null;
}

export function getSchedule(instanceId: number): RestartSchedule {
  const db = getDb();
  let row = db
    .prepare('SELECT * FROM scheduled_restarts WHERE instance_id = ?')
    .get(instanceId) as RestartSchedule | undefined;
  if (!row) {
    db.prepare(
      'INSERT INTO scheduled_restarts (instance_id) VALUES (?)',
    ).run(instanceId);
    row = db
      .prepare('SELECT * FROM scheduled_restarts WHERE instance_id = ?')
      .get(instanceId) as RestartSchedule;
  }
  return row;
}

export function updateSchedule(
  instanceId: number,
  patch: Partial<Pick<RestartSchedule, 'frequency' | 'time' | 'timezone' | 'warn_minutes' | 'enabled'>>,
): RestartSchedule {
  const db = getDb();
  getSchedule(instanceId); // ensure row exists
  const fields = Object.keys(patch).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE scheduled_restarts SET ${fields} WHERE instance_id = @instance_id`).run({
    ...patch,
    instance_id: instanceId,
  });
  return getSchedule(instanceId);
}

async function doScheduledRestart(inst: Instance, warnMinutes: number): Promise<void> {
  log.info(`[${inst.name}] Starting scheduled restart (warn=${warnMinutes}m)…`);
  const warnMs = warnMinutes * 60 * 1000;

  try {
    if (warnMinutes > 0) {
      await rconExec(
        inst.rcon_host,
        inst.rcon_port,
        inst.rcon_password,
        `Broadcast Server restarting in ${warnMinutes} minute${warnMinutes === 1 ? '' : 's'}.`,
      );
    }
    if (warnMs > 10_000) {
      await new Promise((r) => setTimeout(r, warnMs - 10_000));
      await rconExec(inst.rcon_host, inst.rcon_port, inst.rcon_password, 'Broadcast Server restarting in 10 seconds!');
      await new Promise((r) => setTimeout(r, 10_000));
    } else if (warnMs > 0) {
      await new Promise((r) => setTimeout(r, warnMs));
    }
    await rconExec(inst.rcon_host, inst.rcon_port, inst.rcon_password, 'Save');
  } catch {
    // RCON might fail if server is already down — continue anyway
  }

  await stopServer(inst);
  await new Promise((r) => setTimeout(r, 5_000));
  await startServer(inst);
  log.info(`[${inst.name}] Scheduled restart complete`);
}

export function syncScheduler(inst: Instance): void {
  const existing = scheduleJobs.get(inst.id);
  if (existing) { existing.stop(); scheduleJobs.delete(inst.id); }

  const sched = getSchedule(inst.id);
  if (sched.frequency === 'off' || !sched.enabled) return;

  const expr = timeToCron(sched);
  if (!expr) return;

  const job = cron.schedule(expr, () => {
    doScheduledRestart(inst, sched.warn_minutes).catch((err) =>
      log.error(`[${inst.name}] Scheduled restart failed:`, err),
    );
  }, { timezone: sched.timezone || 'UTC' });

  scheduleJobs.set(inst.id, job);
  const next = getNextRestart(inst.id);
  const nextStr = next ? new Date(next).toLocaleString() : 'unknown';
  log.info(`[${inst.name}] Scheduled restart armed (${sched.frequency}, cron: ${expr}, next: ${nextStr})`);
}
