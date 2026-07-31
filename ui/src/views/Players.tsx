import { useState, useEffect } from 'react';
import { Player, PlayerEvent, PlayerNote, PlayerTag } from '../api/client';
import { useInstance } from '../context/InstanceContext';
import { Button } from '../components/ui/Button';
import { IconButton } from '../components/ui/IconButton';
import { Tag } from '../components/ui/Tag';
import { ViewWrapper } from '../components/layout/ViewWrapper';
import { PanelSection, ToggleRow } from '../components/ui/PanelSection';
import { Switch } from '../components/ui/Switch';
import { cn } from '../lib/cn';

const fmtPlaytime = (s: number) => `${Math.floor(s/3600)}h ${String(Math.floor((s%3600)/60)).padStart(2,'0')}m`;
const fmtLastSeen = (ts: number | null) => {
  if (!ts) return '–';
  const diff = (Date.now() - ts * 1000) / 1000;
  if (diff < 60)    return 'Online now';
  if (diff < 3600)  return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return new Date(ts*1000).toLocaleDateString();
};

const thCls = 'text-left text-[10px] uppercase tracking-[0.1em] text-fog font-semibold px-4 pb-3.5 pt-4 border-b border-line/70';
const tdCls = 'px-4 py-3.5 border-b border-line/50 last:border-b-0';

const PRESET_TAGS = [
  { tag: 'VIP', color: '#ffd447' },
  { tag: 'Admin', color: '#b27cf2' },
  { tag: 'Toxic', color: '#ff5c5c' },
  { tag: 'Trusted', color: '#3fd8b4' },
  { tag: 'New', color: '#2fd9e8' },
];

function PlayerPanel({ player, onClose }: { player: Player; onClose: () => void }) {
  const { api } = useInstance();
  const [notes, setNotes] = useState<PlayerNote[]>([]);
  const [tags, setTags] = useState<PlayerTag[]>([]);
  const [newNote, setNewNote] = useState('');
  const [newTag, setNewTag] = useState('');
  const [newTagColor, setNewTagColor] = useState('#a79fc7');
  const [saving, setSaving] = useState(false);

  async function loadDetails() {
    if (!api) return;
    const [n, t] = await Promise.all([
      api.playerNotes(player.steam_id).catch(() => [] as PlayerNote[]),
      api.playerTags(player.steam_id).catch(() => [] as PlayerTag[]),
    ]);
    setNotes(n); setTags(t);
  }
  useEffect(() => { loadDetails(); }, [player.steam_id]);

  async function addNote() {
    if (!newNote.trim() || !api) return;
    setSaving(true);
    try { await api.addPlayerNote(player.steam_id, newNote.trim()); setNewNote(''); await loadDetails(); }
    catch (e) { alert((e as Error).message); }
    finally { setSaving(false); }
  }
  async function deleteNote(id: number) {
    await api?.deletePlayerNote(player.steam_id, id); await loadDetails();
  }
  async function addTag(tag: string, color: string) {
    await api?.addPlayerTag(player.steam_id, tag, color); await loadDetails();
  }
  async function removeTag(tag: string) {
    await api?.removePlayerTag(player.steam_id, tag); await loadDetails();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="bg-[var(--panel)] border border-[var(--line)] rounded-xl w-full max-w-md p-5 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-[var(--bone)] text-base">{player.name}</h3>
            <p className="text-xs text-[var(--fog)] font-mono mt-0.5">{player.steam_id}</p>
          </div>
          <button className="text-[var(--fog)] hover:text-[var(--bone)] text-lg" onClick={onClose}>✕</button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-2 text-[12.5px]">
          <div className="bg-[var(--panel-raised)] rounded-lg p-2.5">
            <p className="text-[10px] uppercase tracking-wider text-[var(--fog)] mb-0.5">Playtime</p>
            <p className="font-mono text-[var(--bone)]">{fmtPlaytime(player.playtime_s)}</p>
          </div>
          <div className="bg-[var(--panel-raised)] rounded-lg p-2.5">
            <p className="text-[10px] uppercase tracking-wider text-[var(--fog)] mb-0.5">Last seen</p>
            <p className="font-mono text-[var(--bone)]">{fmtLastSeen(player.last_seen)}</p>
          </div>
        </div>

        {/* Tags */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--fog)] mb-2">Tags</p>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {tags.map((t) => (
              <span
                key={t.tag}
                className="flex items-center gap-1 text-[11px] rounded-full px-2 py-0.5 cursor-pointer"
                style={{ background: t.color + '25', color: t.color, border: `1px solid ${t.color}50` }}
                onClick={() => removeTag(t.tag)}
                title="Click to remove"
              >
                {t.tag} ×
              </span>
            ))}
            {tags.length === 0 && <span className="text-xs text-[var(--fog)]">No tags</span>}
          </div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {PRESET_TAGS.filter((pt) => !tags.find((t) => t.tag === pt.tag)).map((pt) => (
              <button
                key={pt.tag}
                className="text-[11px] rounded-full px-2 py-0.5 opacity-50 hover:opacity-100 transition-opacity"
                style={{ background: pt.color + '20', color: pt.color, border: `1px solid ${pt.color}40` }}
                onClick={() => addTag(pt.tag, pt.color)}
              >+ {pt.tag}</button>
            ))}
          </div>
          <div className="flex gap-1.5 items-center">
            <input
              value={newTag} onChange={(e) => setNewTag(e.target.value)}
              placeholder="Custom tag…" className="flex-1 text-xs" style={{ height: 30 }}
            />
            <input type="color" value={newTagColor} onChange={(e) => setNewTagColor(e.target.value)}
              className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent p-0"
            />
            <Button variant="ghost" onClick={() => { addTag(newTag, newTagColor); setNewTag(''); }}>Add</Button>
          </div>
        </div>

        {/* Notes */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--fog)] mb-2">Notes</p>
          <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto mb-2">
            {notes.map((n) => (
              <div key={n.id} className="bg-[var(--panel-raised)] rounded-lg px-3 py-2 text-[12.5px] flex items-start gap-2">
                <span className="flex-1 text-[var(--bone-dim)]">{n.note}</span>
                <span className="text-[10px] text-[var(--fog)] shrink-0">{n.author}</span>
                <button className="text-[var(--fog)] hover:text-[var(--rust)] ml-1 text-xs" onClick={() => deleteNote(n.id)}>✕</button>
              </div>
            ))}
            {notes.length === 0 && <p className="text-xs text-[var(--fog)]">No notes yet</p>}
          </div>
          <div className="flex gap-1.5">
            <input
              value={newNote} onChange={(e) => setNewNote(e.target.value)}
              placeholder="Add a note…" className="flex-1 text-xs"
              onKeyDown={(e) => e.key === 'Enter' && addNote()}
            />
            <Button variant="ghost" onClick={addNote} disabled={saving}>Add</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Players() {
  const { api } = useInstance();
  const [players, setPlayers] = useState<Player[]>([]);
  const [events, setEvents] = useState<PlayerEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [whitelistMode, setWhitelistMode] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showEvents, setShowEvents] = useState(false);
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [detailPlayer, setDetailPlayer] = useState<Player | null>(null);
  const [geoMap, setGeoMap] = useState<Record<string, { country: string; flag: string }>>({});

  async function load() {
    if (!api) return;
    try {
      const ps = await api.listPlayers();
      setPlayers(ps);
      // Fetch geo in the background for players without cached data
      for (const p of ps.slice(0, 20)) {
        if (geoMap[p.steam_id]) continue;
        api.playerGeo(p.steam_id).then((geo) =>
          setGeoMap((prev) => ({ ...prev, [p.steam_id]: geo })),
        ).catch(() => {});
      }
    } catch {}
    setLoading(false);
  }
  useEffect(() => { load(); }, [api]);

  async function loadEvents() {
    if (!api) return;
    try { setEvents(await api.playerEvents(200)); } catch {}
    setShowEvents(true);
  }

  async function handleKick(sid: string) {
    if (!confirm('Kick this player?')) return;
    try { await api?.kickPlayer(sid); } catch (e) { alert((e as Error).message); }
  }
  async function handleBan(sid: string) {
    if (!confirm('Ban this player?')) return;
    try { await api?.banPlayer(sid); await load(); } catch (e) { alert((e as Error).message); }
  }
  async function handleUnban(sid: string) {
    try { await api?.unbanPlayer(sid); await load(); } catch (e) { alert((e as Error).message); }
  }
  async function handleAdd() {
    if (!newId || !newName) return;
    try { await api?.addPlayer(newId, newName); setNewId(''); setNewName(''); setShowAdd(false); await load(); }
    catch (e) { alert((e as Error).message); }
  }

  const inputCls = 'flex-1 min-w-[160px]';

  return (
    <ViewWrapper eyebrow="Players" title="Roster & moderation"
      description="Kick/ban actions go out over RCON immediately. Join/leave events tracked by the watchdog."
      accentVar="var(--ember)"
      actions={
        <>
          <Button variant="ghost" onClick={() => showEvents ? setShowEvents(false) : loadEvents()}>
            {showEvents ? 'Hide events' : 'Event log'}
          </Button>
          <Button variant="aqua" onClick={() => setShowAdd((s) => !s)}>Add player</Button>
        </>
      }
    >
      {detailPlayer && (
        <PlayerPanel player={detailPlayer} onClose={() => { setDetailPlayer(null); load(); }} />
      )}

      {showAdd && (
        <PanelSection title="Pre-whitelist a player" description="Add by Steam ID before their first join.">
          <div className="flex gap-2.5 flex-wrap items-center">
            <input placeholder="Steam ID (76561198…)" value={newId} onChange={(e) => setNewId(e.target.value)} className={inputCls} />
            <input placeholder="Display name" value={newName} onChange={(e) => setNewName(e.target.value)} className={inputCls} />
            <Button variant="aqua" onClick={handleAdd}>Add</Button>
            <Button variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
          </div>
        </PanelSection>
      )}

      {showEvents && (
        <PanelSection title="Join / leave event log" description="Last 200 events recorded by the watchdog.">
          {events.length === 0 ? <div className="text-fog text-[13px] py-2">No events yet.</div> : (
            <div className="flex flex-col max-h-72 overflow-y-auto">
              {events.map((ev) => (
                <div key={ev.id} className={cn('flex items-center gap-3 py-2.5 border-b border-line last:border-b-0 text-[12.5px]',
                  ev.event === 'join' ? 'text-lime' : 'text-rust',
                )}>
                  <span className="w-2 h-2 rounded-full bg-current shrink-0" />
                  <span className="font-mono text-bone">{ev.player_name}</span>
                  <span className="text-[11px] uppercase tracking-wider">{ev.event}</span>
                  <span className="font-mono text-[11px] text-fog ml-auto">{new Date(ev.created_at*1000).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </PanelSection>
      )}

      <PanelSection noPad>
        <table className="w-full border-collapse text-[13px]">
          <thead><tr>
            {['Player','Region','Status','Playtime','Last seen',''].map((h,i) => <th key={i} className={thCls}>{h}</th>)}
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="text-center text-fog px-4 py-8">Loading…</td></tr>}
            {!loading && players.length === 0 && <tr><td colSpan={6} className="text-center text-fog px-4 py-8">No players in roster yet.</td></tr>}
            {players.map((p) => {
              const geo = geoMap[p.steam_id];
              return (
              <tr key={p.steam_id} className="hover:bg-white/[0.02] cursor-pointer" onClick={() => setDetailPlayer(p)}>
                <td className={cn(tdCls, 'font-mono text-[12.5px] text-bone-dim')}>
                  <span className="text-bone">{p.name}</span>
                  <span className="text-fog ml-1.5 text-[11px]">{p.steam_id.slice(0,12)}…</span>
                </td>
                <td className={tdCls}>
                  {geo ? (
                    <span className="flex items-center gap-1.5 text-[12px]">
                      <span className="text-[16px]">{geo.flag}</span>
                      <span className="text-fog">{geo.country}</span>
                    </span>
                  ) : (
                    <span className="text-fog/40 text-[11px]">–</span>
                  )}
                </td>
                <td className={tdCls}>
                  {p.banned ? <Tag variant="banned">banned</Tag>
                    : p.whitelisted ? <Tag variant="whitelist">whitelisted</Tag>
                    : <Tag variant="disabled">none</Tag>}
                </td>
                <td className={cn(tdCls, 'font-mono text-fog text-[12.5px]')}>{fmtPlaytime(p.playtime_s)}</td>
                <td className={cn(tdCls, 'font-mono text-fog text-[12.5px]')}>{fmtLastSeen(p.last_seen)}</td>
                <td className={tdCls} onClick={(e) => e.stopPropagation()}>
                  <div className="flex gap-1 justify-end">
                    {p.banned ? (
                      <IconButton label="Unban" onClick={() => handleUnban(p.steam_id)}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                      </IconButton>
                    ) : (
                      <>
                        <IconButton label="Kick" onClick={() => handleKick(p.steam_id)}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M18 6L6 18M6 6l12 12"/></svg>
                        </IconButton>
                        <IconButton label="Ban" onClick={() => handleBan(p.steam_id)}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="9"/><path d="M5 5l14 14"/></svg>
                        </IconButton>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );})}
          </tbody>
        </table>
      </PanelSection>

      <PanelSection title="Whitelist mode" description="Only players in the roster can join when enabled.">
        <ToggleRow label="Require whitelist to join" description="Recommended once the server is public.">
          <Switch checked={whitelistMode} onChange={setWhitelistMode} />
        </ToggleRow>
      </PanelSection>
    </ViewWrapper>
  );
}