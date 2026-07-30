import { useState, useEffect } from 'react';
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

export function Backups() {
  const { api } = useInstance();
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [schedule, setSchedule] = useState<BackupScheduleConfig>({ frequency: 'daily', hour: 3, day_of_week: 0, enabled: 1 });
  const [savingSched, setSavingSched] = useState(false);

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
    try { await api.restoreBackup(id); alert('Restore started — server will restart automatically.'); }
    catch (e) { alert((e as Error).message); }
    setRestoring(null);
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

  return (
    <ViewWrapper eyebrow="Backups" title="Backup manager"
      description="Configure automatic backups and manage your snapshot history."
      accentVar="var(--gold)"
      actions={<Button variant="gold" loading={creating} onClick={handleBackup}>Back up now</Button>}
    >
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
