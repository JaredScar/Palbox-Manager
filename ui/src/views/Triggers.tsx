import { useState, useEffect } from 'react';
import { EventTrigger } from '../api/client';
import { useInstance } from '../context/InstanceContext';
import { ViewWrapper } from '../components/layout/ViewWrapper';
import { PanelSection } from '../components/ui/PanelSection';
import { Button } from '../components/ui/Button';
import { cn } from '../lib/cn';

const EVENT_TYPES = [
  { value: 'cpu_high',          label: 'CPU usage high',         hasThreshold: true,  unit: '%' },
  { value: 'memory_high',       label: 'Memory usage high',      hasThreshold: true,  unit: 'MB' },
  { value: 'player_count_zero', label: 'Players drop to zero',   hasThreshold: false, unit: '' },
  { value: 'server_offline',    label: 'Server goes offline',    hasThreshold: false, unit: '' },
  { value: 'server_online',     label: 'Server comes online',    hasThreshold: false, unit: '' },
];

const ACTION_TYPES = [
  { value: 'backup',            label: 'Create backup',          params: [] },
  { value: 'restart',           label: 'Restart server',         params: [] },
  { value: 'rcon_command',      label: 'Run RCON command',       params: ['command'] },
  { value: 'broadcast_message', label: 'Broadcast message',      params: ['message'] },
  { value: 'discord_webhook',   label: 'Discord notification',   params: ['message'] },
];

const BLANK: Partial<EventTrigger> = {
  name: '',
  event_type: 'cpu_high',
  threshold: 90,
  action_type: 'backup',
  action_params: '{}',
  cooldown_m: 30,
  enabled: 1,
};

const inputCls = 'w-full bg-panel-raised border border-line rounded-lg px-3 py-2 text-[13px] text-bone focus:outline-none focus:border-[#f43f5e]/60 transition-colors';
const labelCls = 'text-[11px] uppercase tracking-widest text-fog font-medium mb-1';

function getParams(paramsJson: string): Record<string, string> {
  try { return JSON.parse(paramsJson) ?? {}; } catch { return {}; }
}

export function Triggers() {
  const { api } = useInstance();
  const [triggers, setTriggers] = useState<EventTrigger[]>([]);
  const [editing, setEditing]   = useState<Partial<EventTrigger> | null>(null);
  const [saving, setSaving]     = useState(false);

  async function load() {
    if (!api) return;
    try { setTriggers(await api.listTriggers()); } catch { /* ignore */ }
  }
  useEffect(() => { load(); }, [api]);

  async function save() {
    if (!api || !editing) return;
    setSaving(true);
    try {
      if (editing.id) await api.updateTrigger(editing.id, editing);
      else await api.createTrigger(editing);
      setEditing(null);
      await load();
    } catch (e) { alert((e as Error).message); }
    setSaving(false);
  }

  async function toggle(t: EventTrigger) {
    if (!api) return;
    await api.updateTrigger(t.id, { enabled: t.enabled ? 0 : 1 });
    await load();
  }

  async function del(t: EventTrigger) {
    if (!api || !confirm(`Delete trigger "${t.name}"?`)) return;
    await api.deleteTrigger(t.id);
    await load();
  }

  const eventInfo = EVENT_TYPES.find((e) => e.value === editing?.event_type);
  const actionInfo = ACTION_TYPES.find((a) => a.value === editing?.action_type);
  const params = getParams(editing?.action_params ?? '{}');

  function setParam(key: string, val: string) {
    const p = getParams(editing?.action_params ?? '{}');
    p[key] = val;
    setEditing((e) => e ? { ...e, action_params: JSON.stringify(p) } : null);
  }

  return (
    <ViewWrapper
      eyebrow="Automation"
      title="Event triggers"
      description="Define if-this-then-that rules. Each trigger fires an action when a server condition is met."
      accentVar="#f43f5e"
      actions={<Button style={{ background: '#f43f5e20', color: '#f43f5e', border: '1px solid #f43f5e50' }}
        onClick={() => setEditing({ ...BLANK })}>+ New trigger</Button>}
    >
      {/* Form */}
      {editing && (
        <PanelSection title={editing.id ? 'Edit trigger' : 'New trigger'}>
          <div className="grid grid-cols-2 gap-4">
            {/* Name */}
            <div className="col-span-2">
              <div className={labelCls}>Trigger name</div>
              <input className={inputCls} value={editing.name ?? ''} placeholder="e.g. CPU spike backup"
                onChange={(e) => setEditing((v) => v ? { ...v, name: e.target.value } : null)} />
            </div>

            {/* Event type */}
            <div>
              <div className={labelCls}>When…</div>
              <select className={inputCls}
                value={editing.event_type}
                onChange={(e) => setEditing((v) => v ? { ...v, event_type: e.target.value } : null)}>
                {EVENT_TYPES.map((et) => <option key={et.value} value={et.value}>{et.label}</option>)}
              </select>
            </div>

            {/* Threshold (conditional) */}
            {eventInfo?.hasThreshold && (
              <div>
                <div className={labelCls}>Threshold ({eventInfo.unit})</div>
                <input type="number" className={inputCls}
                  value={editing.threshold ?? 0}
                  onChange={(e) => setEditing((v) => v ? { ...v, threshold: parseFloat(e.target.value) } : null)} />
              </div>
            )}

            {/* Action type */}
            <div>
              <div className={labelCls}>Then…</div>
              <select className={inputCls}
                value={editing.action_type}
                onChange={(e) => setEditing((v) => v ? { ...v, action_type: e.target.value, action_params: '{}' } : null)}>
                {ACTION_TYPES.map((at) => <option key={at.value} value={at.value}>{at.label}</option>)}
              </select>
            </div>

            {/* Action params */}
            {actionInfo?.params.map((param) => (
              <div key={param} className={actionInfo.params.length === 1 && !eventInfo?.hasThreshold ? 'col-span-2' : ''}>
                <div className={labelCls}>{param.charAt(0).toUpperCase() + param.slice(1)}</div>
                <input className={inputCls} value={params[param] ?? ''}
                  placeholder={param === 'command' ? 'e.g. Broadcast Hello!' : 'e.g. Server CPU is high!'}
                  onChange={(e) => setParam(param, e.target.value)} />
              </div>
            ))}

            {/* Cooldown */}
            <div>
              <div className={labelCls}>Cooldown (minutes)</div>
              <input type="number" className={inputCls}
                value={editing.cooldown_m ?? 30}
                onChange={(e) => setEditing((v) => v ? { ...v, cooldown_m: parseInt(e.target.value, 10) } : null)} />
            </div>
          </div>

          <div className="flex gap-3 mt-5">
            <Button variant="ghost" onClick={save} loading={saving}>Save trigger</Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </PanelSection>
      )}

      {/* Trigger list */}
      <PanelSection noPad>
        {triggers.length === 0 && !editing && (
          <div className="text-fog text-[13px] text-center py-10">
            No triggers yet — click <strong>+ New trigger</strong> to add one.
          </div>
        )}
        {triggers.map((t) => {
          const ev = EVENT_TYPES.find((e) => e.value === t.event_type);
          const ac = ACTION_TYPES.find((a) => a.value === t.action_type);
          const p  = getParams(t.action_params);
          return (
            <div key={t.id} className={cn('flex items-center gap-4 px-5 py-4 border-b border-line last:border-0 hover:bg-white/[0.02]', !t.enabled && 'opacity-50')}>
              {/* Status dot */}
              <div className={cn('w-2 h-2 rounded-full shrink-0', t.enabled ? 'bg-[#f43f5e]' : 'bg-fog')} />

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="font-medium text-[13.5px] truncate">{t.name}</div>
                <div className="text-[11.5px] text-fog mt-0.5 truncate">
                  {ev?.label ?? t.event_type}
                  {ev?.hasThreshold ? ` ≥ ${t.threshold}${ev.unit}` : ''}
                  {' → '}
                  {ac?.label ?? t.action_type}
                  {p.command ? `: ${p.command}` : p.message ? `: ${p.message}` : ''}
                </div>
              </div>

              {/* Last fired */}
              {t.last_fired && (
                <div className="text-[11px] text-fog/50 font-mono shrink-0">
                  {new Date(t.last_fired * 1000).toLocaleString()}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-1.5 shrink-0">
                <button onClick={() => toggle(t)}
                  className={cn('text-[11px] px-2.5 py-1 rounded-lg border transition-colors',
                    t.enabled ? 'border-fog/30 text-fog hover:text-bone' : 'border-[#f43f5e]/40 text-[#f43f5e] hover:border-[#f43f5e]')}>
                  {t.enabled ? 'Disable' : 'Enable'}
                </button>
                <button onClick={() => setEditing({ ...t })}
                  className="text-[11px] px-2.5 py-1 rounded-lg border border-fog/30 text-fog hover:text-bone transition-colors">
                  Edit
                </button>
                <button onClick={() => del(t)}
                  className="text-[11px] px-2.5 py-1 rounded-lg border border-rust/30 text-rust hover:border-rust transition-colors">
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </PanelSection>

      {/* How it works */}
      <PanelSection title="How triggers work">
        <div className="text-[13px] text-fog leading-relaxed space-y-2">
          <p>Triggers are evaluated every ~30 seconds by the watchdog. When a condition is met the chosen action fires, then enters a cooldown period so it doesn't repeat immediately.</p>
          <p>
            <strong className="text-bone">State-change events</strong> (server offline/online, players drop to zero) fire once at the moment the state changes.{' '}
            <strong className="text-bone">Threshold events</strong> (CPU high, memory high) fire whenever the value exceeds the threshold after the cooldown has expired.
          </p>
        </div>
      </PanelSection>
    </ViewWrapper>
  );
}
