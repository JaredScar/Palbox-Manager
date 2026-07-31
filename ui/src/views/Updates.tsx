import { useState, useEffect } from 'react';
import { BuildInfo } from '../api/client';
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

  async function load() {
    if (!api) return;
    try { setInfo(await api.buildInfo()); } catch {}
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

          <PanelSection title="Scheduled restarts">
            <div className="text-fog text-[13px]">
              Configure automated restart schedules from the{' '}
              <a href="/restarts" className="underline underline-offset-2 text-[#f97316] hover:text-[#f97316]/80">
                Restarts
              </a>{' '}
              page — now with more frequency options and a live countdown.
            </div>
          </PanelSection>
        </>
      )}
    </ViewWrapper>
  );
}
