/**
 * Timed rule changes: double XP weekends, boosted capture windows, and so on.
 *
 * Palworld reads PalWorldSettings.ini once, at boot, and there is no RCON or
 * REST command that changes a rate on a running server. So an event is a pair
 * of warned restarts - one to bring the boosted values in, one to put the
 * originals back - and the UI says so rather than pretending otherwise.
 *
 * Scheduling is a one-minute tick that compares "should this be running now"
 * against "is it running", instead of cron jobs firing at the boundaries. That
 * costs almost nothing and means a panel that was down over a boundary, or
 * started mid-window, still ends up in the right state.
 */
import { getDb } from '../db';
import type { Instance } from '../db/types';
import { log } from '../lib/logger';
import { readSettings, writeSettings } from './ini';
import { restartWithWarning } from './scheduler';
import { getStatus } from './palserver';
import { instAnnounce } from './connection';
import { pushNotification } from './notifications';
import { logAction } from './audit';

export interface ScheduledEvent {
  id: number;
  instance_id: number;
  name: string;
  description: string;
  overrides: string;
  mode: 'weekly' | 'once';
  start_dow: number;
  start_time: string;
  start_at: number | null;
  duration_hours: number;
  timezone: string;
  warn_minutes: number;
  start_message: string;
  end_message: string;
  enabled: number;
  active: number;
  saved_settings: string | null;
  activated_at: number | null;
  ends_at: number | null;
  last_error: string | null;
  created_at: number;
}

const HOUR_MS = 3_600_000;

export function listEvents(instanceId: number): ScheduledEvent[] {
  return getDb()
    .prepare('SELECT * FROM scheduled_events WHERE instance_id = ? ORDER BY id')
    .all(instanceId) as ScheduledEvent[];
}

export function getEvent(instanceId: number, id: number): ScheduledEvent | undefined {
  return getDb()
    .prepare('SELECT * FROM scheduled_events WHERE instance_id = ? AND id = ?')
    .get(instanceId, id) as ScheduledEvent | undefined;
}

const parseOverrides = (json: string): Record<string, string> => {
  try {
    const v = JSON.parse(json) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, String(x)]),
    );
  } catch {
    return {};
  }
};

/**
 * Reads a wall-clock time in the event's own timezone.
 *
 * A "Friday 18:00" event means Friday evening where the server's players are,
 * and that has to survive daylight saving, so the comparison is done against
 * the zone's formatted parts rather than by offsetting a UTC timestamp.
 */
function zoned(at: Date, tz: string): { dow: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz || 'UTC',
    weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(at);

  const num = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10);
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    .indexOf(parts.find((p) => p.type === 'weekday')?.value ?? 'Sun');

  return { dow: dow < 0 ? 0 : dow, minutes: (num('hour') % 24) * 60 + num('minute') };
}

/**
 * When the window containing `now` began, or null if none does.
 *
 * A weekly window can be longer than a week's gap between starts, so this walks
 * back over the last eight days of candidate starts rather than only checking
 * the most recent one.
 */
export function windowStart(ev: ScheduledEvent, now = Date.now()): number | null {
  const durationMs = Math.max(0, ev.duration_hours) * HOUR_MS;
  if (durationMs === 0) return null;

  if (ev.mode === 'once') {
    if (!ev.start_at) return null;
    const start = ev.start_at * 1000;
    return now >= start && now < start + durationMs ? start : null;
  }

  const [h, m] = (ev.start_time || '00:00').split(':').map((s) => parseInt(s, 10));
  const target = (h || 0) * 60 + (m || 0);

  // Candidate starts are minute-aligned, so search back day by day and then
  // resolve the exact instant by subtracting the zone-local offset into the day.
  for (let back = 0; back <= 8; back++) {
    const probe = new Date(now - back * 86_400_000);
    const { dow, minutes } = zoned(probe, ev.timezone);
    if (dow !== ev.start_dow) continue;

    const start = probe.getTime() - (minutes - target) * 60_000;
    if (start <= now && now < start + durationMs) return start;
  }
  return null;
}

/** Next time this event will begin, for display. Null if it never will again. */
export function nextStart(ev: ScheduledEvent, now = Date.now()): number | null {
  if (!ev.enabled) return null;

  if (ev.mode === 'once') {
    const start = (ev.start_at ?? 0) * 1000;
    return start > now ? start : null;
  }

  const [h, m] = (ev.start_time || '00:00').split(':').map((s) => parseInt(s, 10));
  const target = (h || 0) * 60 + (m || 0);

  for (let ahead = 0; ahead <= 8; ahead++) {
    const probe = new Date(now + ahead * 86_400_000);
    const { dow, minutes } = zoned(probe, ev.timezone);
    if (dow !== ev.start_dow) continue;

    const start = probe.getTime() - (minutes - target) * 60_000;
    if (start > now) return start;
  }
  return null;
}

async function announce(inst: Instance, message: string): Promise<void> {
  if (!message.trim()) return;
  try {
    await instAnnounce(inst, message);
  } catch {
    // An event should not fail because nobody was online to hear about it.
  }
}

/**
 * Applies an event's overrides and restarts so the game picks them up.
 *
 * The displaced values are captured first and stored on the row, so ending the
 * event restores what was actually configured rather than a stock default.
 */
async function activate(inst: Instance, ev: ScheduledEvent, endsAt: number): Promise<void> {
  const overrides = parseOverrides(ev.overrides);
  const keys = Object.keys(overrides);
  if (keys.length === 0) throw new Error('Event has no settings to apply');

  const current = readSettings(inst);
  const saved = Object.fromEntries(keys.map((k) => [k, current[k] ?? '']));

  writeSettings(inst, overrides);
  getDb().prepare(
    `UPDATE scheduled_events
     SET active = 1, saved_settings = ?, activated_at = unixepoch(), ends_at = ?, last_error = NULL
     WHERE id = ?`,
  ).run(JSON.stringify(saved), Math.round(endsAt / 1000), ev.id);

  log.info(`[${inst.name}] Event "${ev.name}" starting: ${keys.join(', ')}`);
  await announce(inst, ev.start_message || `${ev.name} starts now!`);
  await restartForEvent(inst, ev, `${ev.name} is starting.`);

  pushNotification(
    inst.id,
    `Event started: ${ev.name}`,
    keys.map((k) => `${k} = ${overrides[k]}`).join(', '),
  );
  logAction(inst.id, 'event.start', ev.name, 'scheduler');
}

/** Puts back whatever the settings were before the event took over. */
async function deactivate(inst: Instance, ev: ScheduledEvent): Promise<void> {
  const saved = ev.saved_settings ? parseOverrides(ev.saved_settings) : {};
  if (Object.keys(saved).length > 0) writeSettings(inst, saved);

  getDb().prepare(
    `UPDATE scheduled_events
     SET active = 0, saved_settings = NULL, activated_at = NULL, ends_at = NULL, last_error = NULL
     WHERE id = ?`,
  ).run(ev.id);

  log.info(`[${inst.name}] Event "${ev.name}" ending, settings restored`);
  await announce(inst, ev.end_message || `${ev.name} has ended.`);
  await restartForEvent(inst, ev, `${ev.name} has ended.`);

  pushNotification(inst.id, `Event ended: ${ev.name}`, 'Previous settings restored.');
  logAction(inst.id, 'event.end', ev.name, 'scheduler');
}

/**
 * Restarts only if there is something to restart.
 *
 * A stopped server does not need bouncing, and starting one that an admin
 * deliberately left down would be a nasty surprise - the new ini is already on
 * disk and will be read whenever they do start it.
 */
async function restartForEvent(inst: Instance, ev: ScheduledEvent, reason: string): Promise<void> {
  const { status } = await getStatus(inst);
  if (status !== 'online') {
    log.info(`[${inst.name}] Server is ${status}; event settings apply on next start`);
    return;
  }
  await restartWithWarning(inst, ev.warn_minutes, reason);
}

/** Guards against two events fighting over the same settings key. */
function activeEvent(instanceId: number): ScheduledEvent | undefined {
  return getDb()
    .prepare('SELECT * FROM scheduled_events WHERE instance_id = ? AND active = 1 LIMIT 1')
    .get(instanceId) as ScheduledEvent | undefined;
}

/**
 * Why a manual start would be refused, or null if it would be allowed.
 *
 * Kept separate from the start itself because starting includes a restart that
 * takes minutes; the caller needs the verdict now and the work in the
 * background.
 */
export function whyNotStart(ev: ScheduledEvent): string | null {
  if (ev.active) return 'Event is already running';
  const running = activeEvent(ev.instance_id);
  if (running) return `"${running.name}" is already running; stop it first`;
  return null;
}

export const whyNotStop = (ev: ScheduledEvent): string | null =>
  (ev.active ? null : 'Event is not running');

export async function startEventNow(inst: Instance, ev: ScheduledEvent): Promise<void> {
  const refusal = whyNotStart(ev);
  if (refusal) throw new Error(refusal);
  await activate(inst, ev, Date.now() + Math.max(0, ev.duration_hours) * HOUR_MS);
}

export async function stopEventNow(inst: Instance, ev: ScheduledEvent): Promise<void> {
  const refusal = whyNotStop(ev);
  if (refusal) throw new Error(refusal);
  await deactivate(inst, ev);
}

/** True while a transition is in flight, since restarts take minutes. */
const busy = new Set<number>();

async function tick(inst: Instance): Promise<void> {
  if (busy.has(inst.id)) return;
  busy.add(inst.id);
  try {
    const events = listEvents(inst.id);
    const now = Date.now();

    // End first: a window closing frees the slot for one opening in the same
    // tick, which is what back-to-back events look like.
    for (const ev of events) {
      if (!ev.active) continue;
      // A manually started event has no schedule to fall out of, so it runs
      // until its duration is up rather than until its window closes.
      const scheduled = ev.enabled ? windowStart(ev, now) !== null : false;
      const expired = ev.ends_at !== null && now >= ev.ends_at * 1000;
      if (!scheduled && expired) await deactivate(inst, ev);
    }

    if (activeEvent(inst.id)) return;

    for (const ev of listEvents(inst.id)) {
      if (!ev.enabled || ev.active) continue;
      const start = windowStart(ev, now);
      if (start === null) continue;

      try {
        await activate(inst, ev, start + Math.max(0, ev.duration_hours) * HOUR_MS);
      } catch (err) {
        const message = (err as Error).message;
        log.error(`[${inst.name}] Event "${ev.name}" failed to start: ${message}`);
        getDb().prepare('UPDATE scheduled_events SET last_error = ? WHERE id = ?')
          .run(message, ev.id);
      }
      break; // one at a time
    }
  } finally {
    busy.delete(inst.id);
  }
}

const timers = new Map<number, NodeJS.Timeout>();

export function syncEventScheduler(inst: Instance): void {
  const existing = timers.get(inst.id);
  if (existing) clearInterval(existing);

  const timer = setInterval(() => {
    tick(inst).catch((err) => log.error(`[${inst.name}] Event tick failed:`, err));
  }, 60_000);
  timer.unref?.();
  timers.set(inst.id, timer);

  // Catch up immediately, in case the panel was down across a boundary.
  tick(inst).catch(() => {});
}
