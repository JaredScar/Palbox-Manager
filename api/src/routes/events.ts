import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { resolveInstance } from '../middleware/instance.js';
import { getDb } from '../db/index.js';
import { logAction } from '../services/audit.js';
import {
  listEvents, getEvent, nextStart, windowStart,
  startEventNow, stopEventNow, syncEventScheduler, whyNotStart, whyNotStop,
  type ScheduledEvent,
} from '../services/events.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, resolveInstance);

/**
 * Only rate and rule settings can be driven by an event.
 *
 * Ports, passwords and the server name are excluded deliberately: an event
 * flipping those would lock players out or take the server off its port, and
 * the revert would be equally disruptive.
 */
const ALLOWED_KEYS = new Set([
  'ExpRate', 'PalCaptureRate', 'PalSpawnNumRate', 'WorkSpeedRate',
  'DayTimeSpeedRate', 'NightTimeSpeedRate',
  'PalDamageRateAttack', 'PalDamageRateDefense',
  'PlayerDamageRateAttack', 'PlayerDamageRateDefense',
  'PlayerStomachDecreaceRate', 'PlayerStaminaDecreaceRate',
  'PalStomachDecreaceRate', 'PalStaminaDecreaceRate',
  'PlayerAutoHPRegeneRate', 'PlayerAutoHpRegeneRateInSleep',
  'PalAutoHPRegeneRate', 'PalAutoHpRegeneRateInSleep',
  'CollectionDropRate', 'CollectionObjectHpRate', 'CollectionObjectRespawnSpeedRate',
  'EnemyDropItemRate', 'DropItemMaxNum', 'DropItemAliveMaxHours',
  'PalEggDefaultHatchingTime', 'BuildObjectDamageRate', 'BuildObjectDeteriorationDamageRate',
  'DeathPenalty', 'bEnableInvaderEnemy', 'bEnablePlayerToPlayerDamage', 'bEnableFriendlyFire',
]);

const shape = (ev: ScheduledEvent) => ({
  ...ev,
  enabled: !!ev.enabled,
  active: !!ev.active,
  overrides: JSON.parse(ev.overrides) as Record<string, string>,
  nextStart: nextStart(ev),
  /** Only meaningful for a scheduled run; a manual one has no window. */
  inWindow: windowStart(ev) !== null,
});

/** Rejects anything outside the safe key set before it reaches the ini. */
function cleanOverrides(input: unknown): Record<string, string> | string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'overrides must be an object';
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!ALLOWED_KEYS.has(k)) return `${k} cannot be changed by an event`;
    out[k] = String(v);
  }
  if (Object.keys(out).length === 0) return 'at least one setting is required';
  return out;
}

router.get('/', requirePermission('events.view'), (req, res) => {
  res.json({
    events: listEvents(req.instance!.id).map(shape),
    /** So the editor can offer exactly what the server will accept. */
    allowedKeys: [...ALLOWED_KEYS],
  });
});

router.post('/', requirePermission('events.manage'), (req, res) => {
  const inst = req.instance!;
  const b = req.body as Record<string, unknown>;
  const name = String(b.name ?? '').trim();
  if (!name) { res.status(400).json({ error: 'name required' }); return; }

  const overrides = cleanOverrides(b.overrides);
  if (typeof overrides === 'string') { res.status(400).json({ error: overrides }); return; }

  const result = getDb().prepare(
    `INSERT INTO scheduled_events
       (instance_id, name, description, overrides, mode, start_dow, start_time, start_at,
        duration_hours, timezone, warn_minutes, start_message, end_message, enabled)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    inst.id, name, String(b.description ?? ''), JSON.stringify(overrides),
    b.mode === 'once' ? 'once' : 'weekly',
    Number(b.start_dow ?? 5), String(b.start_time ?? '18:00'),
    b.start_at ? Number(b.start_at) : null,
    Number(b.duration_hours ?? 48), String(b.timezone ?? 'UTC'),
    Number(b.warn_minutes ?? 5),
    String(b.start_message ?? ''), String(b.end_message ?? ''),
    b.enabled === false ? 0 : 1,
  );

  logAction(inst.id, 'event.create', name);
  syncEventScheduler(inst);
  res.status(201).json(shape(getEvent(inst.id, Number(result.lastInsertRowid))!));
});

router.patch('/:id', requirePermission('events.manage'), (req, res) => {
  const inst = req.instance!;
  const id = parseInt(req.params.id, 10);
  const existing = getEvent(inst.id, id);
  if (!existing) { res.status(404).json({ error: 'Event not found' }); return; }

  const b = req.body as Record<string, unknown>;
  const fields: string[] = [];
  const vals: unknown[] = [];

  if (b.overrides !== undefined) {
    const overrides = cleanOverrides(b.overrides);
    if (typeof overrides === 'string') { res.status(400).json({ error: overrides }); return; }
    // Editing while running would leave saved_settings describing keys that are
    // no longer in play, so the revert could not be trusted.
    if (existing.active) { res.status(409).json({ error: 'Stop the event before changing its settings' }); return; }
    fields.push('overrides = ?'); vals.push(JSON.stringify(overrides));
  }

  const simple: [string, unknown][] = [
    ['name', b.name], ['description', b.description], ['mode', b.mode],
    ['start_dow', b.start_dow], ['start_time', b.start_time], ['start_at', b.start_at],
    ['duration_hours', b.duration_hours], ['timezone', b.timezone],
    ['warn_minutes', b.warn_minutes],
    ['start_message', b.start_message], ['end_message', b.end_message],
  ];
  for (const [key, value] of simple) {
    if (value === undefined) continue;
    fields.push(`${key} = ?`);
    vals.push(value);
  }
  if (b.enabled !== undefined) { fields.push('enabled = ?'); vals.push(b.enabled ? 1 : 0); }

  if (fields.length > 0) {
    vals.push(id, inst.id);
    getDb().prepare(`UPDATE scheduled_events SET ${fields.join(', ')} WHERE id = ? AND instance_id = ?`).run(...vals);
    logAction(inst.id, 'event.update', existing.name);
  }
  syncEventScheduler(inst);
  res.json(shape(getEvent(inst.id, id)!));
});

router.delete('/:id', requirePermission('events.manage'), (req, res) => {
  const inst = req.instance!;
  const ev = getEvent(inst.id, parseInt(req.params.id, 10));
  if (!ev) { res.status(404).json({ error: 'Event not found' }); return; }
  if (ev.active) { res.status(409).json({ error: 'Stop the event before deleting it' }); return; }

  getDb().prepare('DELETE FROM scheduled_events WHERE id = ? AND instance_id = ?').run(ev.id, inst.id);
  logAction(inst.id, 'event.delete', ev.name);
  res.json({ ok: true });
});

/** Starting and stopping by hand, for events that do not fit a schedule. */
const MANUAL = [
  { action: 'start', check: whyNotStart, run: startEventNow },
  { action: 'stop',  check: whyNotStop,  run: stopEventNow },
] as const;

for (const { action, check, run } of MANUAL) {
  router.post(`/:id/${action}`, requirePermission('events.manage'), (req, res) => {
    const inst = req.instance!;
    const ev = getEvent(inst.id, parseInt(req.params.id, 10));
    if (!ev) { res.status(404).json({ error: 'Event not found' }); return; }

    const refusal = check(ev);
    if (refusal) { res.status(409).json({ error: refusal }); return; }

    // The transition includes a warned restart, so it runs in the background
    // and the client watches the event's state rather than this request.
    run(inst, ev).catch((err) => {
      getDb().prepare('UPDATE scheduled_events SET last_error = ? WHERE id = ?')
        .run((err as Error).message, ev.id);
    });
    logAction(inst.id, `event.${action}.manual`, ev.name);
    res.json({ ok: true });
  });
}

export default router;
