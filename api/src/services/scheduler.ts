import cron from 'node-cron';
import { getDb } from '../db';
import type { Instance } from '../db/types';
import { log } from '../lib/logger';
import { stopServer, startServer } from './palserver';
import { rconExec } from '../lib/rcon';

export interface RestartSchedule {
  id: number;
  instance_id: number;
  frequency: 'off' | 'daily' | '12h' | 'weekly';
  time: string;
  timezone: string;
  warn_minutes: number;
  enabled: number;
}

const scheduleJobs = new Map<number, ReturnType<typeof cron.schedule>>();

function timeToCron(time: string, frequency: string): string {
  const [hStr, mStr] = time.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr ?? '0', 10);
  switch (frequency) {
    case 'daily':   return `${m} ${h} * * *`;
    case '12h':     return `${m} ${h},${(h + 12) % 24} * * *`;
    case 'weekly':  return `${m} ${h} * * 0`;   // Sundays
    default:        return '';
  }
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

  const expr = timeToCron(sched.time, sched.frequency);
  if (!expr) return;

  const job = cron.schedule(expr, () => {
    doScheduledRestart(inst, sched.warn_minutes).catch((err) =>
      log.error(`[${inst.name}] Scheduled restart failed:`, err),
    );
  }, { timezone: sched.timezone || 'UTC' });

  scheduleJobs.set(inst.id, job);
  log.info(`[${inst.name}] Scheduled restart armed (${sched.frequency} at ${sched.time}, cron: ${expr})`);
}
