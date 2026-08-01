/**
 * Event trigger evaluator.
 * Called from the watchdog tick with current server metrics.
 *
 * Supported event_type:
 *   cpu_high | memory_high | player_count_zero | server_offline | server_online
 *
 * Supported action_type:
 *   backup | restart | rcon_command | broadcast_message | discord_webhook
 */
import { getDb } from '../db/index.js';
import type { Instance } from '../db/types.js';
import { log } from '../lib/logger.js';
import { pushNotification } from './notifications.js';
import { sendDiscord } from './discord.js';

export interface EventTrigger {
  id: number;
  instance_id: number;
  name: string;
  event_type: string;
  threshold: number;
  action_type: string;
  action_params: string;
  cooldown_m: number;
  enabled: number;
  last_fired: number | null;
  created_at: number;
}

interface Context {
  status: 'online' | 'offline' | string;
  prevStatus: 'online' | 'offline' | null;
  cpuPct: number;
  memMb: number;
  playerCount: number;
  prevPlayerCount: number;
}

export async function evaluateTriggers(inst: Instance, ctx: Context): Promise<void> {
  const db = getDb();
  const triggers = db
    .prepare('SELECT * FROM event_triggers WHERE instance_id = ? AND enabled = 1')
    .all(inst.id) as EventTrigger[];

  const nowSec = Math.floor(Date.now() / 1000);

  for (const trigger of triggers) {
    // Cooldown check
    if (trigger.last_fired && nowSec - trigger.last_fired < trigger.cooldown_m * 60) continue;

    let fired = false;
    const { event_type, threshold } = trigger;

    if (event_type === 'cpu_high' && ctx.cpuPct >= threshold) fired = true;
    if (event_type === 'memory_high' && ctx.memMb >= threshold) fired = true;
    if (event_type === 'player_count_zero' && ctx.playerCount === 0 && ctx.prevPlayerCount > 0) fired = true;
    if (event_type === 'server_offline' && ctx.status !== 'online' && ctx.prevStatus === 'online') fired = true;
    if (event_type === 'server_online'  && ctx.status === 'online' && ctx.prevStatus !== 'online') fired = true;

    if (!fired) continue;

    db.prepare('UPDATE event_triggers SET last_fired = ? WHERE id = ?').run(nowSec, trigger.id);
    log.info(`[${inst.name}] Event trigger fired: "${trigger.name}"`);

    let params: Record<string, string> = {};
    try { params = JSON.parse(trigger.action_params); } catch {}

    try {
      switch (trigger.action_type) {
        case 'backup': {
          const { createBackup } = await import('./backup.js');
          await createBackup(inst, 'auto');
          pushNotification(inst.id, `Auto-backup triggered`, `Trigger: ${trigger.name}`, 'info');
          break;
        }
        case 'restart': {
          const { restartServer } = await import('./palserver.js');
          await restartServer(inst);
          pushNotification(inst.id, `Server restarted by trigger`, trigger.name, 'warn');
          break;
        }
        case 'rcon_command': {
          const { instCommand } = await import('./connection.js');
          const result = await instCommand(inst, params.command ?? '');
          pushNotification(inst.id, `Command executed`, `${params.command} → ${result}`, 'info');
          break;
        }
        case 'broadcast_message': {
          const { instAnnounce } = await import('./connection.js');
          await instAnnounce(inst, params.message ?? '');
          pushNotification(inst.id, `Broadcast sent`, params.message ?? '', 'info');
          break;
        }
        case 'discord_webhook': {
          await sendDiscord(inst, params.message ?? `Trigger fired: ${trigger.name}`, 'alert');
          pushNotification(inst.id, `Discord notification sent`, trigger.name, 'info');
          break;
        }
      }
    } catch (err) {
      log.error(`[${inst.name}] Trigger "${trigger.name}" action failed:`, err);
      pushNotification(inst.id, `Trigger "${trigger.name}" failed`, (err as Error).message, 'error');
    }
  }
}

export function listTriggers(instanceId: number): EventTrigger[] {
  return getDb()
    .prepare('SELECT * FROM event_triggers WHERE instance_id = ? ORDER BY created_at ASC')
    .all(instanceId) as EventTrigger[];
}

export function createTrigger(instanceId: number, data: Omit<EventTrigger, 'id' | 'instance_id' | 'created_at' | 'last_fired'>): EventTrigger {
  const db = getDb();
  const result = db
    .prepare(`INSERT INTO event_triggers
      (instance_id, name, event_type, threshold, action_type, action_params, cooldown_m, enabled)
      VALUES (?,?,?,?,?,?,?,?)`)
    .run(instanceId, data.name, data.event_type, data.threshold, data.action_type, data.action_params, data.cooldown_m, data.enabled);
  return db.prepare('SELECT * FROM event_triggers WHERE id = ?').get(result.lastInsertRowid) as EventTrigger;
}

export function updateTrigger(id: number, instanceId: number, data: Partial<EventTrigger>): void {
  const fields = ['name','event_type','threshold','action_type','action_params','cooldown_m','enabled']
    .filter((f) => f in data);
  if (!fields.length) return;
  const set = fields.map((f) => `${f} = ?`).join(', ');
  getDb()
    .prepare(`UPDATE event_triggers SET ${set} WHERE id = ? AND instance_id = ?`)
    .run(...fields.map((f) => (data as Record<string, unknown>)[f]), id, instanceId);
}

export function deleteTrigger(id: number, instanceId: number): void {
  getDb().prepare('DELETE FROM event_triggers WHERE id = ? AND instance_id = ?').run(id, instanceId);
}
