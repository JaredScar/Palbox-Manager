import { useState, useEffect } from 'react';
import { Player } from '../api/client';
import { useInstance } from '../context/InstanceContext';
import { Button } from '../components/ui/Button';
import { ViewWrapper } from '../components/layout/ViewWrapper';
import { PanelSection } from '../components/ui/PanelSection';
import { cn } from '../lib/cn';

const fmtDate = (ts: number | null) =>
  ts ? new Date(ts * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '–';

const thCls = 'text-left text-[10px] uppercase tracking-[0.1em] text-fog font-semibold px-4 pb-3 pt-4 border-b border-line/70';
const tdCls = 'px-4 py-3.5 border-b border-line/50 last:border-b-0 text-[13px]';

interface BanFormState {
  steamId: string;
  name: string;
  reason: string;
  expires: string; // ISO date string or empty
}

export function Bans() {
  const { api } = useInstance();
  const [bans, setBans] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<BanFormState>({ steamId: '', name: '', reason: '', expires: '' });

  async function load() {
    if (!api) return;
    setLoading(true);
    try { setBans(await api.listBans()); } catch {}
    setLoading(false);
  }
  useEffect(() => { load(); }, [api]);

  async function unban(player: Player) {
    if (!api || !confirm(`Unban ${player.name}?`)) return;
    setPending(player.steam_id);
    try { await api.unbanPlayer(player.steam_id); await load(); } catch (e) { alert((e as Error).message); }
    setPending(null);
  }

  async function addBan() {
    if (!api) return;
    if (!form.steamId.trim()) { alert('Steam ID is required'); return; }
    const expires = form.expires ? Math.floor(new Date(form.expires).getTime() / 1000) : undefined;
    setPending('new');
    try {
      await api.banPlayer(form.steamId.trim(), form.reason || undefined, expires);
      setForm({ steamId: '', name: '', reason: '', expires: '' });
      setShowForm(false);
      await load();
    } catch (e) { alert((e as Error).message); }
    setPending(null);
  }

  const isExpired = (p: Player) => p.ban_expires !== null && p.ban_expires < Math.floor(Date.now() / 1000);

  return (
    <ViewWrapper
      eyebrow="Player management"
      title="Ban manager"
      description="View all banned players, add manual bans, and unban players."
      accentVar="var(--rust)"
      actions={
        <Button variant="primary" onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Cancel' : '+ Add ban'}
        </Button>
      }
    >
      {showForm && (
        <div className="bg-panel border border-line rounded-2xl p-5 mb-4 grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10.5px] uppercase tracking-wide text-fog">Steam ID *</label>
            <input placeholder="76561198XXXXXXXXX" value={form.steamId}
              onChange={(e) => setForm((f) => ({ ...f, steamId: e.target.value }))}
              className="font-mono text-[13px]" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10.5px] uppercase tracking-wide text-fog">Reason (optional)</label>
            <input placeholder="e.g. Cheating, harassment…" value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              className="text-[13px]" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10.5px] uppercase tracking-wide text-fog">Expires (optional)</label>
            <input type="date" value={form.expires}
              onChange={(e) => setForm((f) => ({ ...f, expires: e.target.value }))}
              className="text-[13px]" />
          </div>
          <div className="flex items-end">
            <Button variant="danger" onClick={addBan} loading={pending === 'new'} className="w-full justify-center">
              Ban player
            </Button>
          </div>
        </div>
      )}

      <PanelSection title="Active bans">
        {loading ? (
          <div className="text-fog text-[13px] py-6">Loading…</div>
        ) : bans.length === 0 ? (
          <div className="text-fog text-[13px] py-6">No banned players. The server is all clear.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={thCls}>Player</th>
                  <th className={thCls}>Steam ID</th>
                  <th className={thCls}>Reason</th>
                  <th className={thCls}>Banned until</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {bans.map((p) => (
                  <tr key={p.steam_id} className="hover:bg-panel-raised/50 transition-colors">
                    <td className={cn(tdCls, 'font-medium')}>{p.name}</td>
                    <td className={cn(tdCls, 'font-mono text-fog text-[11px]')}>{p.steam_id}</td>
                    <td className={cn(tdCls, 'text-fog')}>{p.ban_reason ?? '–'}</td>
                    <td className={cn(tdCls, 'font-mono text-[12px]')}>{fmtDate(p.ban_expires)}</td>
                    <td className={tdCls}>
                      <span className={cn(
                        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold',
                        isExpired(p) ? 'bg-fog/10 text-fog' : 'bg-rust/10 text-rust',
                      )}>
                        <span className="w-1 h-1 rounded-full bg-current" />
                        {isExpired(p) ? 'Expired' : 'Active'}
                      </span>
                    </td>
                    <td className={tdCls}>
                      <Button variant="ghost" onClick={() => unban(p)} loading={pending === p.steam_id}>
                        Unban
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PanelSection>
    </ViewWrapper>
  );
}
