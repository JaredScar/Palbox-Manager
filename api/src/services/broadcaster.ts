import cron from 'node-cron';
import { getDb } from '../db/index.js';
import type { Instance, BroadcastSchedule } from '../db/types.js';
import { rconExec } from '../lib/rcon.js';
import { log } from '../lib/logger.js';

// Map of instanceId → Map<scheduleId, ScheduledTask>
const tasks = new Map<number, Map<number, cron.ScheduledTask>>();

function getInstanceTasks(instanceId: number): Map<number, cron.ScheduledTask> {
  if (!tasks.has(instanceId)) tasks.set(instanceId, new Map());
  return tasks.get(instanceId)!;
}

export function syncBroadcaster(inst: Instance): void {
  const instanceTasks = getInstanceTasks(inst.id);

  // Stop all existing tasks for this instance
  for (const task of instanceTasks.values()) task.stop();
  instanceTasks.clear();

  const schedules = getDb()
    .prepare('SELECT * FROM broadcast_schedules WHERE instance_id = ? AND enabled = 1')
    .all(inst.id) as BroadcastSchedule[];

  for (const sched of schedules) {
    if (!cron.validate(sched.cron)) {
      log.warn(`[${inst.name}] Invalid broadcast cron "${sched.cron}" for "${sched.name}"`);
      continue;
    }

    const task = cron.schedule(sched.cron, async () => {
      try {
        await rconExec(
          inst.rcon_host,
          inst.rcon_port,
          inst.rcon_password,
          `Broadcast ${sched.message}`,
        );
        log.info(`[${inst.name}] Broadcast: "${sched.message}"`);
      } catch (err) {
        log.warn(`[${inst.name}] Broadcast failed for "${sched.name}":`, err);
      }
    });

    instanceTasks.set(sched.id, task);
    log.info(`[${inst.name}] Broadcast "${sched.name}" scheduled: ${sched.cron}`);
  }
}
