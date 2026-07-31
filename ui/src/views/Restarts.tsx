import { useState, useEffect } from 'react';
import { RestartSchedule } from '../api/client';
import { useInstance } from '../context/InstanceContext';
import { Button } from '../components/ui/Button';
import { ViewWrapper } from '../components/layout/ViewWrapper';
import { PanelSection } from '../components/ui/PanelSection';
import { cn } from '../lib/cn';

const inputCls =
  'bg-panel-raised border border-line rounded-lg px-3 py-2 text-[13px] text-bone ' +
  'focus:outline-none focus:border-[#f97316] transition-colors w-full';
const labelCls = 'text-[11px] uppercase tracking-widest text-fog font-medium mb-1.5 block';

const FREQ_OPTIONS: { value: RestartSchedule['frequency']; label: string; desc: string }[] = [
  { value: 'off',    label: 'Off',            desc: 'No scheduled restart' },
  { value: 'hourly', label: 'Every hour',     desc: 'At the same minute each hour' },
  { value: '3h',     label: 'Every 3 hours',  desc: 'At the same minute, every 3 h' },
  { value: '6h',     label: 'Every 6 hours',  desc: 'At the same minute, every 6 h' },
  { value: '12h',    label: 'Every 12 hours', desc: 'Twice daily at the same minute' },
  { value: 'daily',  label: 'Daily',          desc: 'Once per day at a fixed time' },
  { value: 'weekly', label: 'Weekly (Sun)',   desc: 'Every Sunday at a fixed time' },
  { value: 'custom', label: 'Custom cron',    desc: 'Full cron expression (advanced)' },
];

function fmtCountdown(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function Restarts() {
  const { api } = useInstance();
  const [sched, setSched]   = useState<RestartSchedule | null>(null);
  const [draft, setDraft]   = useState<RestartSchedule | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty,  setDirty]  = useState(false);
  const [now,    setNow]    = useState(Date.now());

  // Live countdown tick
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!api) return;
    api.getSchedule().then((s) => { setSched(s); setDraft(s); }).catch(() => {});
  }, [api]);

  function patch<K extends keyof RestartSchedule>(k: K, v: RestartSchedule[K]) {
    setDraft((d) => d ? { ...d, [k]: v } : d);
    setDirty(true);
  }

  async function save() {
    if (!api || !draft) return;
    setSaving(true);
    try {
      const updated = await api.patchSchedule({
        frequency:   draft.frequency,
        time:        draft.time,
        cron_expr:   draft.cron_expr ?? '',
        timezone:    draft.timezone,
        warn_minutes: draft.warn_minutes,
        enabled:     draft.enabled,
      });
      setSched(updated); setDraft(updated); setDirty(false);
    } catch (e) { alert((e as Error).message); }
    setSaving(false);
  }

  async function triggerNow() {
    if (!api || !confirm('Trigger an immediate restart? Players will be warned first.')) return;
    try { await api.restart(); } catch (e) { alert((e as Error).message); }
  }

  const nextMs = sched?.nextRestart ?? null;
  const msUntil = nextMs ? nextMs - now : null;
  const isActive = draft?.enabled === 1 && draft?.frequency !== 'off';
  const showTime = draft && ['daily','weekly','12h'].includes(draft.frequency);

  return (
    <ViewWrapper
      eyebrow="Scheduled restarts"
      title="Restart scheduler"
      description="Keep your server fresh by automatically restarting on a schedule. Players are warned via RCON before each restart."
      accentVar="var(--orange, #f97316)"
      actions={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={triggerNow}>Restart now</Button>
          <Button
            variant="ghost"
            style={{ background: '#f97316', color: '#0a0a0f', borderColor: 'transparent' }}
            loading={saving}
            disabled={!dirty}
            onClick={save}
          >
            Save schedule
          </Button>
        </div>
      }
    >
      {/* ── Next restart countdown ───────────────────────────────────────── */}
      {nextMs && msUntil !== null && msUntil > 0 && (
        <div className="flex items-center gap-4 p-5 rounded-2xl mb-5 border"
          style={{ background: 'color-mix(in srgb,#f97316 7%,transparent)', borderColor: 'color-mix(in srgb,#f97316 35%,transparent)' }}>
          <div className="w-2.5 h-2.5 rounded-full shrink-0 animate-pulse" style={{ background: '#f97316' }} />
          <div>
            <div className="font-display font-semibold text-[14.5px]">Next restart</div>
            <div className="font-mono text-[12px] text-fog mt-0.5">
              {new Date(nextMs).toLocaleString()} · in{' '}
              <span style={{ color: '#f97316' }} className="font-semibold">{fmtCountdown(msUntil)}</span>
            </div>
          </div>
        </div>
      )}

      {!isActive && (
        <div className="p-4 rounded-xl bg-fog/5 border border-line text-fog text-[13px] mb-5">
          No restart schedule is active. Configure one below and enable it.
        </div>
      )}

      {draft && (
        <>
          <PanelSection title="Schedule" description="Choose how often the server should restart.">
            {/* Frequency picker */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
              {FREQ_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => patch('frequency', opt.value)}
                  className={cn(
                    'flex flex-col gap-0.5 p-3 rounded-xl border text-left transition-all text-[12.5px]',
                    draft.frequency === opt.value
                      ? 'border-[#f97316]/60 text-bone font-semibold'
                      : 'border-line text-fog hover:text-bone hover:border-fog/40',
                  )}
                  style={draft.frequency === opt.value
                    ? { background: 'color-mix(in srgb,#f97316 10%,transparent)' }
                    : undefined}
                >
                  <span className="font-semibold">{opt.label}</span>
                  <span className="text-[11px] text-fog/80 font-normal">{opt.desc}</span>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Time (shown for fixed-time frequencies) */}
              {showTime && (
                <div>
                  <label className={labelCls}>Restart time</label>
                  <input type="time" value={draft.time ?? '06:00'}
                    onChange={(e) => patch('time', e.target.value)} className={inputCls} />
                </div>
              )}

              {/* Custom cron */}
              {draft.frequency === 'custom' && (
                <div className="col-span-2">
                  <label className={labelCls}>Cron expression</label>
                  <input
                    value={draft.cron_expr ?? ''}
                    onChange={(e) => patch('cron_expr', e.target.value)}
                    placeholder="e.g. 0 */4 * * *  (every 4 hours)"
                    className={inputCls}
                  />
                  <div className="text-[11px] text-fog mt-1.5">
                    Format: minute hour day-of-month month day-of-week. All times are in the timezone below.
                  </div>
                </div>
              )}

              {/* Timezone */}
              <div>
                <label className={labelCls}>Timezone</label>
                <input value={draft.timezone ?? 'UTC'}
                  onChange={(e) => patch('timezone', e.target.value)}
                  placeholder="UTC" className={inputCls} />
              </div>

              {/* Warn minutes */}
              <div>
                <label className={labelCls}>Warn players (minutes before)</label>
                <input type="number" min={0} max={60} value={draft.warn_minutes ?? 5}
                  onChange={(e) => patch('warn_minutes', parseInt(e.target.value, 10))}
                  className={inputCls} />
              </div>
            </div>
          </PanelSection>

          <PanelSection title="Enable">
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <div className="relative" onClick={() => patch('enabled', draft.enabled ? 0 : 1)}>
                <div className={cn('w-10 h-5.5 rounded-full transition-colors', draft.enabled ? 'bg-[#f97316]' : 'bg-line')} />
                <div className={cn('absolute top-0.5 left-0.5 w-4.5 h-4.5 rounded-full bg-void transition-transform shadow',
                  draft.enabled ? 'translate-x-4.5' : '')} />
              </div>
              <span className="text-[13.5px]">
                {draft.enabled ? 'Schedule is enabled' : 'Schedule is disabled'}
              </span>
            </label>
            {dirty && (
              <div className="mt-3 text-[12px] text-fog">
                You have unsaved changes. Click <strong>Save schedule</strong> to apply.
              </div>
            )}
          </PanelSection>

          <PanelSection title="What happens during a restart">
            <ol className="list-none flex flex-col gap-2 text-[13px] text-fog">
              {[
                `RCON: Broadcast "Server restarting in ${draft.warn_minutes} minute${draft.warn_minutes === 1 ? '' : 's'}."`,
                draft.warn_minutes > 0 ? `Wait ${draft.warn_minutes} minute${draft.warn_minutes === 1 ? '' : 's'}` : null,
                'RCON: Broadcast "Server restarting in 10 seconds!"',
                'Wait 10 seconds',
                'RCON: Save',
                'Stop the server',
                'Wait 5 seconds',
                'Start the server',
              ].filter(Boolean).map((step, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold"
                    style={{ background: 'color-mix(in srgb,#f97316 15%,transparent)', color: '#f97316' }}>
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </PanelSection>
        </>
      )}
    </ViewWrapper>
  );
}
