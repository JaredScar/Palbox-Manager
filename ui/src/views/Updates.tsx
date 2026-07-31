import { useState, useEffect } from 'react';
import { BuildInfo, RestartSchedule } from '../api/client';
import { useInstance } from '../context/InstanceContext';
import { Button } from '../components/ui/Button';
import { ViewWrapper } from '../components/layout/ViewWrapper';
import { PanelSection } from '../components/ui/PanelSection';
import { cn } from '../lib/cn';

const fmtTs  = (ts: number | null) => ts ? new Date(ts * 1000).toLocaleString() : '–';
const fmtMs  = (ts: number | null) => ts ? new Date(ts).toLocaleString() : '–';

const inputCls = 'bg-panel-raised border border-line rounded-lg px-3 py-2 text-[13px] text-bone focus:outline-none focus:border-aqua transition-colors w-full';
const labelCls = 'text-[11px] uppercase tracking-widest text-fog font-medium mb-1.5';

export function Updates() {
  const { api } = useInstance();
  const [info, setInfo] = useState<BuildInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [schedule, setSchedule] = useState<RestartSchedule | null>(null);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [schedDirty, setSchedDirty] = useState(false);

  async function load() {
    if (!api) return;
    try {
      const [i, s] = await Promise.all([api.buildInfo(), api.getSchedule()]);
      setInfo(i); setSchedule(s);
    } catch {}
    setLoading(false);
  }
  useEffect(() => { load(); }, [api]);

  async function handleCheck() {
    if (!api) return;
    setChecking(true);
    try { await api.checkUpdate(); await load(); } catch {}
    setChecking(false);
  }
  async function handleUpdate() {
    if (!api || !confirm('Update & restart the server now? Players will be warned via RCON first.')) return;
    setUpdating(true);
    try { await api.applyUpdate(); alert('Update started — watch the Console tab for progress.'); }
    catch (e) { alert((e as Error).message); }
    setUpdating(false);
  }

  function patchSched<K extends keyof RestartSchedule>(k: K, v: RestartSchedule[K]) {
    setSchedule((s) => s ? { ...s, [k]: v } : s);
    setSchedDirty(true);
  }
  async function saveSchedule() {
    if (!api || !schedule) return;
    setScheduleSaving(true);
    try {
      const u = await api.patchSchedule({ frequency: schedule.frequency, time: schedule.time, timezone: schedule.timezone, warn_minutes: schedule.warn_minutes, enabled: schedule.enabled });
      setSchedule(u); setSchedDirty(false);
    } catch (e) { alert((e as Error).message); }
    setScheduleSaving(false);
  }

  return (
    <ViewWrapper eyebrow="SteamCMD updates" title="Server build"
      description="Checked against Steam every 30 minutes. Updating saves via RCON, stops the server, runs SteamCMD, then restarts."
      accentVar="var(--violet)"
      actions={<Button variant="ghost" loading={checking} onClick={handleCheck}>Check now</Button>}
    >
      {loading ? <div className="text-fog py-8">Loading…</div> : (
        <>
          {info?.updateAvailable && (
            <div className="flex items-center justify-between p-5 rounded-2xl bg-violet/8 border border-violet/40 mb-5">
              <div className="flex items-center gap-3">
                <span className="pulse-dot text-violet w-2.5 h-2.5 rounded-full" style={{ color: 'var(--violet)' }} />
                <div>
                  <div className="font-display font-semibold text-[14.5px]">Update available</div>
                  <div className="font-mono text-[12px] text-fog mt-0.5">
                    buildid {info.installed} → {info.latest}
                    {info.lastChecked ? ` · checked ${fmtMs(info.lastChecked)}` : ''}
                  </div>
                </div>
              </div>
              <Button variant="violet" loading={updating} onClick={handleUpdate}>Update &amp; restart</Button>
            </div>
          )}
          {!info?.updateAvailable && (
            <div className="p-4 rounded-xl bg-lime/6 border border-lime/30 text-lime text-[13px] mb-5">
              Server is up to date (build {info?.installed ?? '–'}).{info?.lastChecked ? ` Checked ${fmtMs(info.lastChecked)}.` : ''}
            </div>
          )}

          <div className="grid grid-cols-[1fr,auto,1fr] gap-4 items-center mb-5">
            <div className="bg-panel border border-line rounded-2xl p-5">
              <div className="text-[10px] uppercase tracking-widest text-fog mb-2">Installed</div>
              <div className="font-mono text-[18px] font-medium">{info?.installed ?? '–'}</div>
              {!info?.installed && <div className="text-[11px] text-fog/60 mt-1">Not detected — run Check now or update via SteamCMD</div>}
            </div>
            <div className="text-fog text-[20px] text-center">→</div>
            <div className={cn('bg-panel border rounded-2xl p-5', info?.updateAvailable ? 'border-violet/40' : 'border-line')}>
              <div className="text-[10px] uppercase tracking-widest text-fog mb-2">Latest on Steam</div>
              <div className={cn('font-mono text-[18px] font-medium', info?.updateAvailable ? 'text-violet' : '')}>{info?.latest ?? '–'}</div>
            </div>
          </div>

          <PanelSection title="Update history">
            {info?.history.length === 0 && <div className="text-fog text-[13px] py-2">No updates recorded yet.</div>}
            {info?.history.map((h) => (
              <div key={h.id} className="flex items-center gap-3.5 py-3 border-b border-line last:border-b-0 text-[12.5px]">
                <span className="w-2 h-2 rounded-full bg-lime shrink-0" />
                Updated to {h.build_id}
                <span className="font-mono text-[11px] text-fog ml-auto">{fmtTs(h.created_at)}</span>
              </div>
            ))}
          </PanelSection>

          <PanelSection title="Scheduled restarts" description="A periodic server restart to clear memory — separate from update restarts.">
            {schedule ? (
              <>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className={labelCls}>Enabled</label>
                    <label className="relative inline-flex items-center cursor-pointer mt-1">
                      <input type="checkbox" className="sr-only" checked={schedule.enabled === 1} onChange={(e) => patchSched('enabled', e.target.checked ? 1 : 0)} />
                      <div className={cn('w-9 h-5 rounded-full transition-colors', schedule.enabled ? 'bg-violet' : 'bg-line')}>
                        <div className={cn('absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-void transition-transform', schedule.enabled ? 'translate-x-4' : '')} />
                      </div>
                    </label>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className={labelCls}>Frequency</label>
                    <select value={schedule.frequency} onChange={(e) => patchSched('frequency', e.target.value as RestartSchedule['frequency'])} className={inputCls}>
                      <option value="daily">Daily</option>
                      <option value="12h">Every 12 hours</option>
                      <option value="weekly">Weekly (Sunday)</option>
                      <option value="off">Off</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className={labelCls}>Time (server clock)</label>
                    <input type="time" value={schedule.time} onChange={(e) => patchSched('time', e.target.value)} className={inputCls} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className={labelCls}>Timezone</label>
                    <input type="text" placeholder="UTC" value={schedule.timezone} onChange={(e) => patchSched('timezone', e.target.value)} className={inputCls} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className={labelCls}>Warn players (min)</label>
                    <input type="number" min={0} max={30} value={schedule.warn_minutes} onChange={(e) => patchSched('warn_minutes', parseInt(e.target.value, 10))} className={inputCls} />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Button variant="violet" disabled={!schedDirty} loading={scheduleSaving} onClick={saveSchedule}>Save schedule</Button>
                  {!schedDirty && !scheduleSaving && (
                    <span className="font-mono text-[12px] text-fog">
                      {schedule.enabled ? `Active — ${schedule.frequency} at ${schedule.time}` : 'Disabled'}
                    </span>
                  )}
                </div>
              </>
            ) : <div className="text-fog text-[13px]">Loading…</div>}
          </PanelSection>
        </>
      )}
    </ViewWrapper>
  );
}
