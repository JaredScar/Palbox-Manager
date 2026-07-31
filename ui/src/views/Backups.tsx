import { useState, useEffect, useRef } from 'react';
import { Backup, BackupScheduleConfig } from '../api/client';
import { useInstance } from '../context/InstanceContext';
import { Button } from '../components/ui/Button';
import { IconButton } from '../components/ui/IconButton';
import { Tag } from '../components/ui/Tag';
import { ViewWrapper } from '../components/layout/ViewWrapper';
import { PanelSection } from '../components/ui/PanelSection';
import { cn } from '../lib/cn';

function fmtSize(b: number) { return b >= 1e9 ? `${(b/1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b/1e6).toFixed(0)} MB` : `${(b/1024).toFixed(0)} KB`; }
function fmtDate(ts: number) { return new Date(ts * 1000).toLocaleString(); }

const DAY_NAMES = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

function RetentionStrip({ backups }: { backups: Backup[] }) {
  const today = new Date();
  const days = Array.from({ length: 8 }, (_, i) => { const d = new Date(today); d.setDate(d.getDate() - (7 - i)); return d; });
  return (
    <div className="flex gap-2 mb-5">
      {days.map((day, i) => {
        const isToday = i === 7;
        const hasBak = backups.some((b) => new Date(b.created_at * 1000).toDateString() === day.toDateString());
        return (
          <div key={i} className={cn(
            'flex-1 rounded-xl p-2.5 text-center border transition-colors',
            isToday && 'ring-1 ring-gold/40',
            hasBak
              ? 'bg-gold/10 border-gold/40 text-gold'
              : 'bg-panel border-line text-fog',
          )}>
            <div className="text-[9.5px] font-mono uppercase tracking-wider">{isToday ? 'TODAY' : DAY_NAMES[day.getDay()]}</div>
            <div className="text-[11px] font-mono mt-0.5">{`${day.getMonth()+1}/${day.getDate()}`}</div>
          </div>
        );
      })}
    </div>
  );
}

const thCls = 'text-left text-[10.5px] uppercase tracking-widest text-fog font-medium px-4 pb-3 border-b border-line';
const tdCls = 'px-4 py-3.5 border-b border-line text-[13px] last-of-type:border-0';

interface RestoreState {
  backupId: number;
  step: string;
  done: boolean;
  error: string | null;
}

export function Backups() {
  const { api, active } = useInstance();
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [restoreState, setRestoreState] = useState<RestoreState | null>(null);
  const [schedule, setSchedule] = useState<BackupScheduleConfig>({ frequency: 'daily', hour: 3, day_of_week: 0, enabled: 1 });
  const [savingSched, setSavingSched] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // Subscribe to restore_progress WebSocket events
  useEffect(() => {
    if (!active) return;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/ws?instance=${active.id}`);
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as {
          type: string; instanceId: number; backupId: number;
          step: string; done: boolean; error: string | null;
        };
        if (msg.type === 'restore_progress' && msg.instanceId === active.id) {
          setRestoreState({ backupId: msg.backupId, step: msg.step, done: msg.done, error: msg.error });
          if (msg.done) {
            setRestoring(null);
            // Reload backup list after a short delay
            setTimeout(() => load(), 1500);
          }
        }
      } catch { /* ignore */ }
    };
    return () => { ws.close(); wsRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  async function load() {
    if (!api) return;
    try {
      const [b, s] = await Promise.all([api.listBackups(), api.getBackupSchedule()]);
      setBackups(b); setSchedule(s);
    } catch {}
    setLoading(false);
  }
  useEffect(() => { load(); }, [api]);

  async function handleBackup() {
    if (!api) return;
    setCreating(true);
    try { await api.createBackup(); await load(); } catch (e) { alert((e as Error).message); }
    setCreating(false);
  }
  async function handleRestore(id: number) {
    if (!api || !confirm('Restore this snapshot? The server will stop briefly, and the current save will be backed up first.')) return;
    setRestoring(id);
    setRestoreState({ backupId: id, step: 'Starting restore…', done: false, error: null });
    try { await api.restoreBackup(id); }
    catch (e) {
      alert((e as Error).message);
      setRestoring(null);
      setRestoreState(null);
    }
  }
  async function handleDelete(id: number) {
    if (!api || !confirm('Delete this backup? This cannot be undone.')) return;
    try { await api.deleteBackup(id); await load(); } catch (e) { alert((e as Error).message); }
  }
  async function saveSchedule() {
    if (!api) return;
    setSavingSched(true);
    try { await api.patchBackupSchedule(schedule); } catch (e) { alert((e as Error).message); }
    setSavingSched(false);
  }

  const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const HOURS = Array.from({ length: 24 }, (_, i) => i);

  const RESTORE_STEPS = [
    'Creating safety backup…',
    'Saving world via RCON…',
    'Stopping server…',
    'Extracting backup…',
    'Starting server…',
    'Restore complete!',
  ];

  return (
    <ViewWrapper eyebrow="Backups" title="Backup manager"
      description="Configure automatic backups and manage your snapshot history."
      accentVar="var(--gold)"
      actions={<Button variant="gold" loading={creating} onClick={handleBackup}>Back up now</Button>}
    >
      {/* Restore progress overlay */}
      {restoreState && !restoreState.done && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-panel border border-line rounded-2xl shadow-xl p-8 max-w-sm w-full mx-4">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-8 h-8 rounded-full border-2 border-gold border-t-transparent animate-spin" />
              <div>
                <div className="text-[15px] font-semibold">Restoring backup</div>
                <div className="text-[12px] text-fog mt-0.5">Please wait — do not close this tab</div>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              {RESTORE_STEPS.map((step, i) => {
                const currentIdx = RESTORE_STEPS.indexOf(restoreState.step);
                const isDone = i < currentIdx;
                const isActive = i === currentIdx;
                return (
                  <div key={i} className={cn('flex items-center gap-2.5 text-[13px]',
                    isDone ? 'text-lime' : isActive ? 'text-gold' : 'text-fog/40')}>
                    <div className={cn('w-1.5 h-1.5 rounded-full shrink-0',
                      isDone ? 'bg-lime' : isActive ? 'bg-gold animate-pulse' : 'bg-fog/20')} />
                    {step}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Restore complete / error toast */}
      {restoreState?.done && (
        <div className={cn(
          'fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-xl border text-[13px] font-medium',
          restoreState.error
            ? 'bg-rust/10 border-rust/30 text-rust'
            : 'bg-lime/10 border-lime/30 text-lime',
        )}>
          <span>{restoreState.error ? `Restore failed: ${restoreState.error}` : 'Restore complete! Server is back online.'}</span>
          <button onClick={() => setRestoreState(null)} className="ml-2 text-fog/60 hover:text-fog text-[16px] leading-none">&times;</button>
        </div>
      )}
      {/* Backup schedule config */}
      <PanelSection title="Auto-backup schedule">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5 min-w-[140px]">
            <label className="text-[11px] uppercase tracking-[0.09em] text-fog font-semibold">Frequency</label>
            <select value={schedule.frequency} onChange={(e) => setSchedule((s) => ({ ...s, frequency: e.target.value as BackupScheduleConfig['frequency'] }))}
              className="w-full focus:border-gold focus:outline-none">
              <option value="off">Disabled</option>
              <option value="hourly">Every hour</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>
          {(schedule.frequency === 'daily' || schedule.frequency === 'weekly') && (
            <div className="flex flex-col gap-1.5 min-w-[120px]">
              <label className="text-[11px] uppercase tracking-[0.09em] text-fog font-semibold">Hour (UTC)</label>
              <select value={schedule.hour} onChange={(e) => setSchedule((s) => ({ ...s, hour: parseInt(e.target.value, 10) }))}
                className="w-full focus:border-gold focus:outline-none">
                {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </select>
            </div>
          )}
          {schedule.frequency === 'weekly' && (
            <div className="flex flex-col gap-1.5 min-w-[140px]">
              <label className="text-[11px] uppercase tracking-[0.09em] text-fog font-semibold">Day of week</label>
              <select value={schedule.day_of_week} onChange={(e) => setSchedule((s) => ({ ...s, day_of_week: parseInt(e.target.value, 10) }))}
                className="w-full focus:border-gold focus:outline-none">
                {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
            </div>
          )}
          <Button variant="gold" loading={savingSched} onClick={saveSchedule}>Save schedule</Button>
        </div>
      </PanelSection>

      <RetentionStrip backups={backups} />

      <PanelSection noPad>
        <table className="w-full border-collapse text-[13px]">
          <thead><tr>
            {['Snapshot','Type','Size','Created',''].map((h,i) => (
              <th key={i} className={thCls}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="text-center text-fog px-4 py-8">Loading…</td></tr>}
            {!loading && backups.length === 0 && (
              <tr><td colSpan={5} className="text-center text-fog px-4 py-8">No backups yet — click "Back up now" to create one.</td></tr>
            )}
            {backups.map((b) => (
              <tr key={b.id} className="hover:bg-white/[0.02]">
                <td className={cn(tdCls, 'font-mono text-bone-dim')}>{b.filename}</td>
                <td className={tdCls}><Tag variant={b.type}>{b.type}</Tag></td>
                <td className={cn(tdCls, 'font-mono text-fog')}>{fmtSize(b.size_bytes)}</td>
                <td className={cn(tdCls, 'font-mono text-fog')}>{fmtDate(b.created_at)}</td>
                <td className={tdCls}>
                  <div className="flex items-center gap-1 justify-end">
                    <IconButton label="Restore" onClick={() => handleRestore(b.id)} disabled={restoring === b.id}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                    </IconButton>
                    <a href={api?.downloadUrl(b.id)} download={b.filename}>
                      <IconButton label="Download">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/></svg>
                      </IconButton>
                    </a>
                    <IconButton label="Delete" onClick={() => handleDelete(b.id)}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></svg>
                    </IconButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </PanelSection>
    </ViewWrapper>
  );
}
