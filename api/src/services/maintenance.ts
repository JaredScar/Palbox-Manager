import { getDb } from '../db/index.js';
import type { Instance } from '../db/types.js';
import { log } from '../lib/logger.js';
import { instAnnounce } from './connection.js';
import { broadcast } from '../ws.js';
import { logAction } from './audit.js';

export interface MaintenanceState {
  active: boolean;
  message: string;
  startedAt: number | null;
}

const stateMap = new Map<number, MaintenanceState>();

export function getMaintenanceState(instanceId: number): MaintenanceState {
  return stateMap.get(instanceId) ?? { active: false, message: '', startedAt: null };
}

export async function enableMaintenance(
  inst: Instance,
  message = 'Server is entering maintenance mode. Please come back later.',
  countdownMinutes = 5,
): Promise<void> {
  const state: MaintenanceState = { active: true, message, startedAt: Date.now() };
  stateMap.set(inst.id, state);

  log.info(`[${inst.name}] Maintenance mode enabled (countdown: ${countdownMinutes}m)`);
  logAction(inst.id, 'maintenance.enable', message);

  // Broadcast countdown warnings via RCON
  const warnings = countdownMinutes > 0
    ? [countdownMinutes, Math.floor(countdownMinutes / 2), 1].filter((m) => m > 0 && m <= countdownMinutes)
    : [];

  for (const minutesLeft of warnings) {
    const delay = (countdownMinutes - minutesLeft) * 60 * 1000;
    setTimeout(async () => {
      try {
        await instAnnounce(
          inst,
          `[Maintenance] Server entering maintenance in ${minutesLeft} minute${minutesLeft !== 1 ? 's' : ''}.`,
        );
      } catch { /* server might not be running */ }
    }, delay);
  }

  // Enable whitelist-only mode in DB settings (blocks new joins)
  getDb().prepare(
    "INSERT INTO settings (instance_id, key, value) VALUES (?, 'whitelist_mode', 'true') ON CONFLICT(instance_id, key) DO UPDATE SET value = 'true'",
  ).run(inst.id);

  broadcast({ type: 'maintenance', instanceId: inst.id, active: true, message });
}

export function disableMaintenance(inst: Instance): void {
  stateMap.set(inst.id, { active: false, message: '', startedAt: null });

  // Disable whitelist-only mode
  getDb().prepare(
    "INSERT INTO settings (instance_id, key, value) VALUES (?, 'whitelist_mode', 'false') ON CONFLICT(instance_id, key) DO UPDATE SET value = 'false'",
  ).run(inst.id);

  logAction(inst.id, 'maintenance.disable');
  broadcast({ type: 'maintenance', instanceId: inst.id, active: false });
  log.info(`[${inst.name}] Maintenance mode disabled`);
}
