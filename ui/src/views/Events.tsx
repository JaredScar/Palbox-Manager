import { useState, useEffect } from 'react';
import type { ScheduledEvent, EventInput } from '../api/client';
import { useInstance } from '../context/InstanceContext';
import { useAuth } from '../context/AuthContext';
import { ViewWrapper } from '../components/layout/ViewWrapper';
import { PanelSection } from '../components/ui/PanelSection';
import { Button } from '../components/ui/Button';
import { cn } from '../lib/cn';

const ACCENT = '#f59e0b';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Friendly names for the settings an event may drive. Anything the server
 * accepts but is not listed here still works; it just shows its raw key.
 */
const SETTING_LABELS: Record<string, string> = {
  ExpRate: 'Experience rate',
  PalCaptureRate: 'Capture rate',
  PalSpawnNumRate: 'Pal spawn density',
  WorkSpeedRate: 'Base work speed',
  DayTimeSpeedRate: 'Day length',
  NightTimeSpeedRate: 'Night length',
  PalDamageRateAttack: 'Pal damage dealt',
  PalDamageRateDefense: 'Pal damage taken',
  PlayerDamageRateAttack: 'Player damage dealt',
  PlayerDamageRateDefense: 'Player damage taken',
  PlayerStomachDecreaceRate: 'Player hunger drain',
  PlayerStaminaDecreaceRate: 'Player stamina drain',
  PalStomachDecreaceRate: 'Pal hunger drain',
  PalStaminaDecreaceRate: 'Pal stamina drain',
  PlayerAutoHPRegeneRate: 'Player HP regen',
  PlayerAutoHpRegeneRateInSleep: 'Player HP regen (sleep)',
  PalAutoHPRegeneRate: 'Pal HP regen',
  PalAutoHpRegeneRateInSleep: 'Pal HP regen (sleep)',
  CollectionDropRate: 'Gathering yield',
  CollectionObjectHpRate: 'Gatherable HP',
  CollectionObjectRespawnSpeedRate: 'Gatherable respawn',
  EnemyDropItemRate: 'Enemy drop rate',
  DropItemMaxNum: 'Max dropped items',
  DropItemAliveMaxHours: 'Dropped item lifetime',
  PalEggDefaultHatchingTime: 'Egg hatch time (hours)',
  BuildObjectDamageRate: 'Structure damage',
  BuildObjectDeteriorationDamageRate: 'Structure decay',
  DeathPenalty: 'Death penalty',
  bEnableInvaderEnemy: 'Raids enabled',
  bEnablePlayerToPlayerDamage: 'PvP damage',
  bEnableFriendlyFire: 'Friendly fire',
};

/** Ready-made events, since most servers want one of a handful of these. */
const PRESETS: { label: string; description: string; overrides: Record<string, string> }[] = [
  {
    label: 'Double XP weekend',
    description: 'Twice the experience from Friday evening through Sunday night.',
    overrides: { ExpRate: '2.000000' },
  },
  {
    label: 'Double capture weekend',
    description: 'Pals are twice as easy to catch.',
    overrides: { PalCaptureRate: '2.000000' },
  },
  {
    label: 'Gathering rush',
    description: 'Double gathering yield and faster node respawns.',
    overrides: { CollectionDropRate: '2.000000', CollectionObjectRespawnSpeedRate: '0.500000' },
  },
  {
    label: 'Breeding festival',
    description: 'Eggs hatch in a fraction of the time.',
    overrides: { PalEggDefaultHatchingTime: '2.000000' },
  },
  {
    label: 'Base building blitz',
    description: 'Pals work faster and structures take no decay damage.',
    overrides: { WorkSpeedRate: '2.000000', BuildObjectDeteriorationDamageRate: '0.000000' },
  },
  {
    label: 'Raid week',
    description: 'Invaders enabled with tougher Pals all round.',
    overrides: { bEnableInvaderEnemy: 'True', PalDamageRateAttack: '1.500000' },
  },
];

const BLANK: EventInput = {
  name: '',
  description: '',
  overrides: { ExpRate: '2.000000' },
  mode: 'weekly',
  start_dow: 5,
  start_time: '18:00',
  start_at: null,
  duration_hours: 48,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  warn_minutes: 5,
  start_message: '',
  end_message: '',
  enabled: true,
};

const inputCls = 'w-full bg-panel-raised border border-line rounded-lg px-3 py-2 text-[13px] text-bone focus:outline-none focus:border-[#f59e0b]/60 transition-colors';
const labelCls = 'text-[11px] uppercase tracking-widest text-fog font-medium mb-1';

const label = (key: string) => SETTING_LABELS[key] ?? key;

/** Strips the live state off an event so only editable fields go back up. */
const toInput = (ev: ScheduledEvent): EventInput & { id: number } => ({
  id: ev.id,
  name: ev.name,
  description: ev.description,
  overrides: ev.overrides,
  mode: ev.mode,
  start_dow: ev.start_dow,
  start_time: ev.start_time,
  start_at: ev.start_at,
  duration_hours: ev.duration_hours,
  timezone: ev.timezone,
  warn_minutes: ev.warn_minutes,
  start_message: ev.start_message,
  end_message: ev.end_message,
  enabled: ev.enabled,
});

const fmtDuration = (hours: number) => {
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${+hours.toFixed(1)} hours`;
  return `${+(hours / 24).toFixed(1)} days`;
};

/** "Friday 18:00 for 2 days", or the one-off date. */
function describeSchedule(ev: ScheduledEvent | EventInput): string {
  const every = ev.mode === 'once'
    ? (ev.start_at ? new Date(ev.start_at * 1000).toLocaleString() : 'not scheduled')
    : `${DAYS[ev.start_dow] ?? 'Sunday'}s at ${ev.start_time}`;
  return `${every} for ${fmtDuration(ev.duration_hours)}`;
}

function EventEditor({
  value, onChange, onSave, onCancel, saving, allowedKeys,
}: {
  value: EventInput & { id?: number };
  onChange: (next: EventInput & { id?: number }) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  allowedKeys: string[];
}) {
  const set = <K extends keyof EventInput>(key: K, v: EventInput[K]) =>
    onChange({ ...value, [key]: v });

  const setOverride = (key: string, v: string) =>
    set('overrides', { ...value.overrides, [key]: v });

  const removeOverride = (key: string) => {
    const next = { ...value.overrides };
    delete next[key];
    set('overrides', next);
  };

  const unused = allowedKeys.filter((k) => !(k in value.overrides));

  return (
    <PanelSection title={value.id ? 'Edit event' : 'New event'}>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className={labelCls}>Event name</div>
          <input
            className={inputCls} value={value.name} placeholder="e.g. Double XP weekend"
            onChange={(e) => set('name', e.target.value)}
          />
        </div>
        <div>
          <div className={labelCls}>Description</div>
          <input
            className={inputCls} value={value.description} placeholder="Shown in the panel only"
            onChange={(e) => set('description', e.target.value)}
          />
        </div>

        <div className="col-span-2">
          <div className={labelCls}>Settings while running</div>
          <div className="space-y-2">
            {Object.entries(value.overrides).map(([key, v]) => (
              <div key={key} className="flex items-center gap-2">
                <span className="text-[12.5px] text-bone w-[190px] shrink-0 truncate">{label(key)}</span>
                <input
                  className={cn(inputCls, 'flex-1')} value={v}
                  onChange={(e) => setOverride(key, e.target.value)}
                />
                <button
                  onClick={() => removeOverride(key)}
                  className="text-[11px] px-2.5 py-1.5 rounded-lg border border-rust/30 text-rust hover:border-rust transition-colors shrink-0"
                >
                  Remove
                </button>
              </div>
            ))}
            {unused.length > 0 && (
              <select
                className={inputCls} value=""
                onChange={(e) => e.target.value && setOverride(e.target.value, '1.000000')}
              >
                <option value="">+ Add a setting…</option>
                {unused.map((k) => <option key={k} value={k}>{label(k)}</option>)}
              </select>
            )}
          </div>
        </div>

        <div>
          <div className={labelCls}>Repeats</div>
          <select
            className={inputCls} value={value.mode}
            onChange={(e) => set('mode', e.target.value as 'weekly' | 'once')}
          >
            <option value="weekly">Every week</option>
            <option value="once">Once</option>
          </select>
        </div>

        {value.mode === 'weekly' ? (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className={labelCls}>Starts on</div>
              <select
                className={inputCls} value={value.start_dow}
                onChange={(e) => set('start_dow', parseInt(e.target.value, 10))}
              >
                {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            </div>
            <div>
              <div className={labelCls}>At</div>
              <input
                type="time" className={inputCls} value={value.start_time}
                onChange={(e) => set('start_time', e.target.value)}
              />
            </div>
          </div>
        ) : (
          <div>
            <div className={labelCls}>Starts at</div>
            <input
              type="datetime-local" className={inputCls}
              value={value.start_at ? new Date(value.start_at * 1000).toISOString().slice(0, 16) : ''}
              onChange={(e) => set('start_at', e.target.value ? Math.floor(new Date(e.target.value).getTime() / 1000) : null)}
            />
          </div>
        )}

        <div>
          <div className={labelCls}>Runs for (hours)</div>
          <input
            type="number" min={0.5} step={0.5} className={inputCls} value={value.duration_hours}
            onChange={(e) => set('duration_hours', parseFloat(e.target.value) || 0)}
          />
        </div>
        <div>
          <div className={labelCls}>Timezone</div>
          <input
            className={inputCls} value={value.timezone} placeholder="e.g. Europe/London"
            onChange={(e) => set('timezone', e.target.value)}
          />
        </div>

        <div>
          <div className={labelCls}>Restart warning (minutes)</div>
          <input
            type="number" min={0} className={inputCls} value={value.warn_minutes}
            onChange={(e) => set('warn_minutes', parseInt(e.target.value, 10) || 0)}
          />
        </div>
        <div />

        <div>
          <div className={labelCls}>Announcement at start</div>
          <input
            className={inputCls} value={value.start_message}
            placeholder="Double XP is live!"
            onChange={(e) => set('start_message', e.target.value)}
          />
        </div>
        <div>
          <div className={labelCls}>Announcement at end</div>
          <input
            className={inputCls} value={value.end_message}
            placeholder="Double XP has ended."
            onChange={(e) => set('end_message', e.target.value)}
          />
        </div>
      </div>

      <div className="text-[12px] text-fog mt-4">
        Scheduled: <span className="text-bone">{describeSchedule(value)}</span> ({value.timezone})
      </div>

      <div className="flex gap-3 mt-5">
        <Button variant="ghost" onClick={onSave} loading={saving}>Save event</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </PanelSection>
  );
}

export function Events() {
  const { api } = useInstance();
  const { can } = useAuth();
  const canManage = can('events.manage');

  const [events, setEvents] = useState<ScheduledEvent[]>([]);
  const [allowedKeys, setAllowedKeys] = useState<string[]>([]);
  const [editing, setEditing] = useState<(EventInput & { id?: number }) | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    if (!api) return;
    try {
      const res = await api.events();
      setEvents(res.events);
      setAllowedKeys(res.allowedKeys);
    } catch { /* the empty state covers it */ }
  }

  useEffect(() => { load(); }, [api]);

  // A start or stop takes a restart to complete, so the list refreshes itself
  // while one is in flight rather than leaving stale state on screen.
  useEffect(() => {
    const timer = setInterval(load, 20_000);
    return () => clearInterval(timer);
  }, [api]);

  async function save() {
    if (!api || !editing) return;
    setSaving(true);
    try {
      const { id, ...body } = editing;
      if (id) await api.updateEvent(id, body);
      else await api.createEvent(body);
      setEditing(null);
      await load();
    } catch (e) { alert((e as Error).message); }
    setSaving(false);
  }

  async function act(ev: ScheduledEvent, action: 'start' | 'stop') {
    if (!api) return;
    const warning = ev.warn_minutes > 0
      ? `Players get a ${ev.warn_minutes} minute warning first.`
      : 'The server restarts immediately.';
    if (!confirm(`${action === 'start' ? 'Start' : 'Stop'} "${ev.name}"? The server must restart for this to take effect. ${warning}`)) return;

    try {
      if (action === 'start') await api.startEvent(ev.id);
      else await api.stopEvent(ev.id);
      await load();
    } catch (e) { alert((e as Error).message); }
  }

  async function toggle(ev: ScheduledEvent) {
    if (!api) return;
    await api.updateEvent(ev.id, { enabled: !ev.enabled });
    await load();
  }

  async function del(ev: ScheduledEvent) {
    if (!api || !confirm(`Delete event "${ev.name}"?`)) return;
    try {
      await api.deleteEvent(ev.id);
      await load();
    } catch (e) { alert((e as Error).message); }
  }

  return (
    <ViewWrapper
      eyebrow="Automation"
      title="Scheduled events"
      description="Boost rates for a window of time — a double XP weekend, a capture rush — then put everything back automatically."
      accentVar={ACCENT}
      actions={canManage && (
        <Button
          style={{ background: `${ACCENT}20`, color: ACCENT, border: `1px solid ${ACCENT}50` }}
          onClick={() => setEditing({ ...BLANK })}
        >
          + New event
        </Button>
      )}
    >
      <div className="text-[12.5px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 mb-5 leading-relaxed">
        Palworld only reads its settings when it boots, so an event costs two server
        restarts: one when it starts and one when it ends. Players are warned first,
        and the world is saved before each.
      </div>

      {editing && (
        <EventEditor
          value={editing}
          onChange={setEditing}
          onSave={save}
          onCancel={() => setEditing(null)}
          saving={saving}
          allowedKeys={allowedKeys}
        />
      )}

      <PanelSection noPad>
        {events.length === 0 && !editing && (
          <div className="text-fog text-[13px] text-center py-10">
            No events yet{canManage ? ' — pick a preset below or create your own.' : '.'}
          </div>
        )}
        {events.map((ev) => (
          <div
            key={ev.id}
            className={cn(
              'flex items-center gap-4 px-5 py-4 border-b border-line last:border-0',
              !ev.enabled && !ev.active && 'opacity-50',
              ev.active && 'bg-amber-500/[0.06]',
            )}
          >
            <div
              className={cn('w-2 h-2 rounded-full shrink-0', ev.active && 'animate-pulse')}
              style={{ background: ev.active ? ACCENT : ev.enabled ? `${ACCENT}70` : '#6b7280' }}
            />

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-[13.5px] truncate">{ev.name}</span>
                {ev.active && (
                  <span className="text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: `${ACCENT}25`, color: ACCENT }}>
                    Live
                  </span>
                )}
              </div>
              <div className="text-[11.5px] text-fog mt-0.5 truncate">
                {Object.entries(ev.overrides).map(([k, v]) => `${label(k)} ${v}`).join(' · ')}
              </div>
              <div className="text-[11px] text-fog/60 mt-0.5 truncate">
                {ev.active && ev.ends_at
                  ? `Ends ${new Date(ev.ends_at * 1000).toLocaleString()}`
                  : ev.enabled && ev.nextStart
                    ? `Next: ${new Date(ev.nextStart).toLocaleString()} · ${describeSchedule(ev)}`
                    : describeSchedule(ev)}
              </div>
              {ev.last_error && (
                <div className="text-[11px] text-rust mt-0.5 truncate">{ev.last_error}</div>
              )}
            </div>

            {canManage && (
              <div className="flex gap-1.5 shrink-0">
                <button
                  onClick={() => act(ev, ev.active ? 'stop' : 'start')}
                  className="text-[11px] px-2.5 py-1 rounded-lg border transition-colors"
                  style={{ borderColor: `${ACCENT}60`, color: ACCENT }}
                >
                  {ev.active ? 'End now' : 'Start now'}
                </button>
                <button
                  onClick={() => toggle(ev)}
                  disabled={ev.active}
                  className="text-[11px] px-2.5 py-1 rounded-lg border border-fog/30 text-fog hover:text-bone transition-colors disabled:opacity-30"
                >
                  {ev.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  onClick={() => setEditing(toInput(ev))}
                  className="text-[11px] px-2.5 py-1 rounded-lg border border-fog/30 text-fog hover:text-bone transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => del(ev)}
                  disabled={ev.active}
                  className="text-[11px] px-2.5 py-1 rounded-lg border border-rust/30 text-rust hover:border-rust transition-colors disabled:opacity-30"
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        ))}
      </PanelSection>

      {canManage && (
        <PanelSection title="Presets">
          <div className="grid grid-cols-2 gap-3">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                onClick={() => setEditing({
                  ...BLANK,
                  name: preset.label,
                  description: preset.description,
                  overrides: preset.overrides,
                  start_message: `${preset.label} is live!`,
                  end_message: `${preset.label} has ended.`,
                })}
                className="text-left rounded-xl border border-line bg-panel hover:bg-panel-raised hover:border-line/80 px-4 py-3 transition-colors"
              >
                <div className="text-[13px] font-medium text-bone">{preset.label}</div>
                <div className="text-[11.5px] text-fog mt-0.5">{preset.description}</div>
                <div className="text-[11px] mt-1.5" style={{ color: ACCENT }}>
                  {Object.entries(preset.overrides).map(([k, v]) => `${label(k)} ${v}`).join(' · ')}
                </div>
              </button>
            ))}
          </div>
        </PanelSection>
      )}

      <PanelSection title="How events work">
        <div className="text-[13px] text-fog leading-relaxed space-y-2">
          <p>
            Every minute the panel checks whether each event should be running. When a
            window opens it records the settings currently in force, writes the event's
            values over them, warns players, and restarts. When the window closes it puts
            the recorded values back and restarts again — so an event never resets a
            setting to a stock default it was not already at.
          </p>
          <p>
            <strong className="text-bone">One event runs at a time.</strong> If two windows
            overlap the second waits, which keeps two events from fighting over the same
            setting and restoring each other's values.
          </p>
          <p>
            If the server is stopped when a window opens, the new settings are still written
            and simply take effect the next time it starts — nothing is booted up behind you.
          </p>
        </div>
      </PanelSection>
    </ViewWrapper>
  );
}
