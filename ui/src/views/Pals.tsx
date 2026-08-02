import { useState, useEffect, useMemo, useCallback } from 'react';
import { useInstance } from '../context/InstanceContext';
import { useAuth } from '../context/AuthContext';
import { ViewWrapper } from '../components/layout/ViewWrapper';
import { PanelSection } from '../components/ui/PanelSection';
import { PalIcon } from '../components/PalIcon';
import { cn } from '../lib/cn';
import {
  dexIndex, lookup, ELEMENTS, elementColour, WORK_LABELS, ivPercent,
} from '../lib/palDex';
import type {
  Pal, PalDexEntry, PalOwner, PalSpawnCapability, PalSpawnTarget,
} from '../api/client';

type Tab = 'browser' | 'spawn';
type SortKey = 'level' | 'name' | 'ivs' | 'rank';

const RARITY_COLOUR = (r: number) =>
  r >= 8 ? '#f59e0b' : r >= 5 ? '#a855f7' : r >= 3 ? '#38bdf8' : '#64748b';

function ElementChip({ element }: { element: string }) {
  const colour = elementColour(element);
  return (
    <span
      className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
      style={{ color: colour, background: `${colour}1f`, border: `1px solid ${colour}44` }}
    >
      {element}
    </span>
  );
}

/** A 0-100 individual value, shown as a bar because the number alone is noise. */
function IvBar({ label, value }: { label: string; value: number }) {
  const colour = value >= 90 ? '#4ade80' : value >= 70 ? '#facc15' : value >= 50 ? '#94a3b8' : '#64748b';
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-fog w-8 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-line/60 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${value}%`, background: colour }} />
      </div>
      <span className="text-[10px] text-bone/80 w-6 text-right tabular-nums">{value}</span>
    </div>
  );
}

function PalCard({ pal, entry, owner, onClick }: {
  pal: Pal;
  entry: PalDexEntry | null;
  owner: PalOwner | undefined;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="text-left bg-ink/40 border border-line/70 rounded-xl p-3 hover:border-line transition-colors focus:outline-none focus:ring-1 focus:ring-fog/40"
    >
      <div className="flex items-start gap-3">
        <PalIcon icon={entry?.icon ?? null} name={pal.name} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[13px] font-semibold text-bone truncate">
              {pal.nickname || pal.name}
            </span>
            {pal.lucky && <span className="text-[9px] font-bold text-amber-300">LUCKY</span>}
            {pal.boss && <span className="text-[9px] font-bold text-rose-400">ALPHA</span>}
          </div>
          {pal.nickname && (
            <div className="text-[10.5px] text-fog truncate">{pal.name}</div>
          )}
          <div className="flex items-center gap-2 mt-1 text-[11px] text-fog">
            <span className="text-bone/90 font-medium">Lv {pal.level}</span>
            {pal.gender && <span>{pal.gender === 'Male' ? '♂' : '♀'}</span>}
            {pal.rank > 1 && <span className="text-amber-300">{'★'.repeat(Math.min(pal.rank - 1, 4))}</span>}
          </div>
          <div className="flex gap-1 mt-1.5 flex-wrap">
            {entry?.elements.map((e) => <ElementChip key={e} element={e} />)}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[15px] font-bold text-bone tabular-nums">{ivPercent(pal.ivs)}%</div>
          <div className="text-[9px] uppercase tracking-wider text-fog">IVs</div>
        </div>
      </div>
      {owner && (
        <div className="mt-2 pt-2 border-t border-line/50 text-[10.5px] text-fog truncate">
          {owner.name}
        </div>
      )}
    </button>
  );
}

function PalDetail({ pal, entry, owner, onClose }: {
  pal: Pal;
  entry: PalDexEntry | null;
  owner: PalOwner | undefined;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-panel border border-line rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-line flex items-start gap-4">
          <PalIcon icon={entry?.icon ?? null} name={pal.name} size={64} />
          <div className="min-w-0 flex-1">
            <div className="text-[18px] font-bold text-bone">{pal.nickname || pal.name}</div>
            <div className="text-[12px] text-fog">
              {pal.name}
              {entry ? ` · #${entry.dex}` : ''}
              {pal.gender ? ` · ${pal.gender}` : ''}
            </div>
            <div className="flex gap-1.5 mt-2 flex-wrap">
              {entry?.elements.map((e) => <ElementChip key={e} element={e} />)}
              {pal.lucky && <span className="text-[10px] font-bold text-amber-300 px-1.5 py-0.5">LUCKY</span>}
              {pal.boss && <span className="text-[10px] font-bold text-rose-400 px-1.5 py-0.5">ALPHA</span>}
            </div>
          </div>
          <button onClick={onClose} className="text-fog hover:text-bone text-lg leading-none">×</button>
        </div>

        <div className="p-5 grid grid-cols-2 gap-5">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-fog mb-2">Individual values</div>
            <div className="space-y-1.5">
              <IvBar label="HP" value={pal.ivs.hp} />
              <IvBar label="Melee" value={pal.ivs.melee} />
              <IvBar label="Shot" value={pal.ivs.shot} />
              <IvBar label="Def" value={pal.ivs.defense} />
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-fog mb-2">Details</div>
            <dl className="text-[12px] space-y-1">
              <div className="flex justify-between gap-3">
                <dt className="text-fog">Level</dt><dd className="text-bone">{pal.level}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-fog">Condensed</dt>
                <dd className="text-bone">{pal.rank > 1 ? `Rank ${pal.rank}` : 'No'}</dd>
              </div>
              {entry && (
                <>
                  <div className="flex justify-between gap-3">
                    <dt className="text-fog">Base HP</dt><dd className="text-bone">{entry.hp}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-fog">Base ATK</dt><dd className="text-bone">{entry.attack}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-fog">Base DEF</dt><dd className="text-bone">{entry.defense}</dd>
                  </div>
                </>
              )}
              <div className="flex justify-between gap-3">
                <dt className="text-fog">Owner</dt>
                <dd className="text-bone truncate">{owner?.name ?? 'Unowned'}</dd>
              </div>
            </dl>
          </div>
        </div>

        {(pal.souls.hp + pal.souls.attack + pal.souls.defence + pal.souls.craftSpeed) > 0 && (
          <div className="px-5 pb-4">
            <div className="text-[10px] uppercase tracking-wider text-fog mb-2">Soul upgrades</div>
            <div className="flex gap-3 text-[12px] text-bone">
              <span>HP +{pal.souls.hp}</span>
              <span>ATK +{pal.souls.attack}</span>
              <span>DEF +{pal.souls.defence}</span>
              <span>Work +{pal.souls.craftSpeed}</span>
            </div>
          </div>
        )}

        {pal.passives.length > 0 && (
          <div className="px-5 pb-4">
            <div className="text-[10px] uppercase tracking-wider text-fog mb-2">Passive skills</div>
            <div className="flex flex-wrap gap-1.5">
              {pal.passives.map((p) => (
                <span key={p} className="text-[11px] px-2 py-0.5 rounded bg-ink/60 border border-line/70 text-bone/90">
                  {p}
                </span>
              ))}
            </div>
          </div>
        )}

        {entry && Object.keys(entry.work).length > 0 && (
          <div className="px-5 pb-5">
            <div className="text-[10px] uppercase tracking-wider text-fog mb-2">Work suitability</div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(entry.work).map(([k, v]) => (
                <span key={k} className="text-[11px] px-2 py-0.5 rounded bg-ink/60 border border-line/70 text-bone/90">
                  {WORK_LABELS[k] ?? k} {v}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Browser ──────────────────────────────────────────────────────────────────

const PAGE_SIZE = 60;

function Browser({ pals, owners, dex, loading, error }: {
  pals: Pal[];
  owners: PalOwner[];
  dex: Record<string, PalDexEntry>;
  loading: boolean;
  error: string | null;
}) {
  const [search, setSearch]   = useState('');
  const [owner, setOwner]     = useState('all');
  const [element, setElement] = useState('all');
  const [onlyAlpha, setOnlyAlpha] = useState(false);
  const [onlyLucky, setOnlyLucky] = useState(false);
  const [sort, setSort]       = useState<SortKey>('level');
  const [limit, setLimit]     = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<Pal | null>(null);

  const index = useMemo(() => dexIndex(dex), [dex]);
  const ownerById = useMemo(
    () => new Map(owners.map((o) => [o.playerId, o])),
    [owners],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const out = pals.filter((p) => {
      if (onlyAlpha && !p.boss) return false;
      if (onlyLucky && !p.lucky) return false;
      if (owner === 'unowned' ? p.ownerPlayerId !== null : owner !== 'all' && p.ownerPlayerId !== owner) return false;
      if (element !== 'all') {
        const entry = lookup(index, p.characterId);
        if (!entry?.elements.includes(element)) return false;
      }
      if (term) {
        return p.name.toLowerCase().includes(term)
          || (p.nickname ?? '').toLowerCase().includes(term);
      }
      return true;
    });

    out.sort((a, b) => {
      switch (sort) {
        case 'name':  return a.name.localeCompare(b.name) || b.level - a.level;
        case 'ivs':   return ivPercent(b.ivs) - ivPercent(a.ivs);
        case 'rank':  return b.rank - a.rank || b.level - a.level;
        default:      return b.level - a.level;
      }
    });
    return out;
  }, [pals, search, owner, element, onlyAlpha, onlyLucky, sort, index]);

  useEffect(() => { setLimit(PAGE_SIZE); }, [search, owner, element, onlyAlpha, onlyLucky, sort]);

  const select = 'bg-ink border border-line rounded-lg px-2.5 py-1.5 text-[12px] text-bone focus:outline-none focus:border-fog/50';

  if (loading) return <PanelSection><div className="text-[13px] text-fog">Reading the world save…</div></PanelSection>;

  if (error) {
    return (
      <PanelSection title="Pals unavailable">
        <p className="text-[13px] text-fog leading-relaxed">{error}</p>
      </PanelSection>
    );
  }

  if (pals.length === 0) {
    return (
      <PanelSection title="No Pals found">
        <p className="text-[13px] text-fog leading-relaxed">
          Nothing has been read out of <code>Level.sav</code> yet. Pals appear after the
          next world scan, which runs a few minutes after the server saves. Check the
          save directory in instance settings if this stays empty.
        </p>
      </PanelSection>
    );
  }

  return (
    <>
      <PanelSection>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or nickname…"
            className={cn(select, 'flex-1 min-w-[200px]')}
          />
          <select value={owner} onChange={(e) => setOwner(e.target.value)} className={select}>
            <option value="all">All owners</option>
            <option value="unowned">Unowned / wild</option>
            {owners.map((o) => <option key={o.playerId} value={o.playerId}>{o.name}</option>)}
          </select>
          <select value={element} onChange={(e) => setElement(e.target.value)} className={select}>
            <option value="all">All elements</option>
            {ELEMENTS.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={select}>
            <option value="level">Highest level</option>
            <option value="ivs">Best IVs</option>
            <option value="rank">Most condensed</option>
            <option value="name">Name</option>
          </select>
          <label className="flex items-center gap-1.5 text-[12px] text-fog cursor-pointer">
            <input type="checkbox" checked={onlyAlpha} onChange={(e) => setOnlyAlpha(e.target.checked)} />
            Alphas
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-fog cursor-pointer">
            <input type="checkbox" checked={onlyLucky} onChange={(e) => setOnlyLucky(e.target.checked)} />
            Lucky
          </label>
        </div>
        <div className="mt-3 text-[11.5px] text-fog">
          {filtered.length.toLocaleString()} of {pals.length.toLocaleString()} Pals
        </div>
      </PanelSection>

      <div className="grid gap-2.5 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {filtered.slice(0, limit).map((p) => (
          <PalCard
            key={p.uid}
            pal={p}
            entry={lookup(index, p.characterId)}
            owner={p.ownerPlayerId ? ownerById.get(p.ownerPlayerId) : undefined}
            onClick={() => setSelected(p)}
          />
        ))}
      </div>

      {filtered.length > limit && (
        <div className="mt-4 text-center">
          <button
            onClick={() => setLimit((l) => l + PAGE_SIZE)}
            className="text-[12px] px-4 py-2 rounded-lg bg-ink border border-line text-bone hover:border-fog/50"
          >
            Show more ({filtered.length - limit} left)
          </button>
        </div>
      )}

      {selected && (
        <PalDetail
          pal={selected}
          entry={lookup(index, selected.characterId)}
          owner={selected.ownerPlayerId ? ownerById.get(selected.ownerPlayerId) : undefined}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

// ── Spawn ────────────────────────────────────────────────────────────────────

function Spawn({ dex }: { dex: Record<string, PalDexEntry> }) {
  const { api } = useInstance();
  const { can } = useAuth();

  const [capability, setCapability] = useState<PalSpawnCapability | null>(null);
  const [targets, setTargets] = useState<PalSpawnTarget[]>([]);
  const [search, setSearch]   = useState('');
  const [picked, setPicked]   = useState<string | null>(null);
  const [level, setLevel]     = useState(1);
  const [mode, setMode]       = useState<'player' | 'coords'>('player');
  const [playerUid, setPlayerUid] = useState('');
  const [coords, setCoords]   = useState({ x: 0, y: 0 });
  const [busy, setBusy]       = useState(false);
  const [result, setResult]   = useState<{ ok: boolean; message: string } | null>(null);

  const refresh = useCallback(() => {
    if (!api) return;
    api.palSpawnCapability().then(setCapability).catch(() => setCapability(null));
    api.palSpawnTargets().then(setTargets).catch(() => setTargets([]));
  }, [api]);

  useEffect(refresh, [refresh]);

  // Only real, spawnable species; raid boss parts and NPCs are noise here.
  const options = useMemo(() => {
    const term = search.trim().toLowerCase();
    return Object.entries(dex)
      .filter(([, e]) => !e.raid && e.icon)
      .filter(([id, e]) => !term || e.name.toLowerCase().includes(term) || id.toLowerCase().includes(term))
      .sort((a, b) => a[1].dex - b[1].dex || a[1].name.localeCompare(b[1].name))
      .slice(0, 200);
  }, [dex, search]);

  const pickedEntry = picked ? dex[picked] : null;

  const submit = async () => {
    if (!picked || !api) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await api.spawnPal({
        characterId: picked,
        level,
        ...(mode === 'player' ? { playerUid } : { x: coords.x, y: coords.y }),
      });
      setResult({ ok: true, message: res.result || 'Done.' });
    } catch (e) {
      setResult({ ok: false, message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const input = 'bg-ink border border-line rounded-lg px-2.5 py-1.5 text-[12px] text-bone focus:outline-none focus:border-fog/50';

  if (!can('pals.spawn')) {
    return (
      <PanelSection title="Not permitted">
        <p className="text-[13px] text-fog leading-relaxed">
          Spawning Pals rewrites the server economy, so it is not granted to operators
          by default. An owner can enable it for your role under Users &amp; Roles.
        </p>
      </PanelSection>
    );
  }

  return (
    <>
      <PanelSection title="Server capability">
        {capability === null ? (
          <div className="text-[13px] text-fog">Checking…</div>
        ) : capability.available ? (
          <p className="text-[13px] text-emerald-400/90">
            {capability.detail} Available commands: {capability.commands.join(', ')}.
          </p>
        ) : (
          <div className="text-[13px] text-fog leading-relaxed space-y-2">
            <p className="text-amber-400/90">{capability.detail}</p>
            <p>
              Vanilla Palworld has no spawn command over RCON or the REST API. Install{' '}
              <a
                href="https://www.nexusmods.com/palworld/mods/451"
                target="_blank" rel="noreferrer"
                className="text-bone underline decoration-line hover:decoration-fog"
              >
                PalDefender
              </a>{' '}
              on the server to enable this tab, then re-check.
            </p>
            <button onClick={refresh} className={cn(input, 'hover:border-fog/50')}>Re-check</button>
          </div>
        )}
      </PanelSection>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px] items-start">
        <PanelSection title="Choose a Pal" className="mb-0">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Pals…"
            className={cn(input, 'w-full mb-3')}
          />
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 max-h-[460px] overflow-y-auto pr-1">
            {options.map(([id, entry]) => (
              <button
                key={id}
                onClick={() => setPicked(id)}
                className={cn(
                  'flex items-center gap-2 p-2 rounded-lg border text-left transition-colors',
                  picked === id
                    ? 'border-fog/70 bg-ink'
                    : 'border-line/70 bg-ink/40 hover:border-line',
                )}
              >
                <PalIcon icon={entry.icon} name={entry.name} size={32} />
                <div className="min-w-0">
                  <div className="text-[12px] text-bone truncate">{entry.name}</div>
                  <div className="text-[10px] truncate" style={{ color: RARITY_COLOUR(entry.rarity) }}>
                    #{entry.dex} · {entry.elements.join('/')}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </PanelSection>

        <PanelSection title="Spawn" className="mb-0">
          {pickedEntry ? (
            <div className="flex items-center gap-3 mb-4">
              <PalIcon icon={pickedEntry.icon} name={pickedEntry.name} size={48} />
              <div className="min-w-0">
                <div className="text-[14px] font-semibold text-bone">{pickedEntry.name}</div>
                <div className="flex gap-1 mt-1 flex-wrap">
                  {pickedEntry.elements.map((e) => <ElementChip key={e} element={e} />)}
                </div>
                <div className="text-[11px] text-fog mt-1">
                  HP {pickedEntry.hp} · ATK {pickedEntry.attack} · DEF {pickedEntry.defense}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-[12.5px] text-fog mb-4">Pick a Pal from the list.</p>
          )}

          <label className="block text-[11px] uppercase tracking-wider text-fog mb-1">Level</label>
          <input
            type="number" min={1} max={255} value={level}
            onChange={(e) => setLevel(Math.max(1, Math.min(255, parseInt(e.target.value, 10) || 1)))}
            className={cn(input, 'w-full mb-4')}
          />

          <div className="flex gap-1 mb-3">
            {(['player', 'coords'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  'flex-1 text-[11.5px] py-1.5 rounded-lg border transition-colors',
                  mode === m ? 'border-fog/70 bg-ink text-bone' : 'border-line/70 text-fog hover:border-line',
                )}
              >
                {m === 'player' ? 'Give to player' : 'Spawn on map'}
              </button>
            ))}
          </div>

          {mode === 'player' ? (
            <select
              value={playerUid}
              onChange={(e) => setPlayerUid(e.target.value)}
              className={cn(input, 'w-full')}
            >
              <option value="">Select an online player…</option>
              {targets.map((t) => (
                <option key={t.playerUid} value={t.playerUid}>{t.name} (Lv {t.level})</option>
              ))}
            </select>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] text-fog mb-1">Map X</label>
                <input
                  type="number" value={coords.x}
                  onChange={(e) => setCoords((c) => ({ ...c, x: parseInt(e.target.value, 10) || 0 }))}
                  className={cn(input, 'w-full')}
                />
              </div>
              <div>
                <label className="block text-[10px] text-fog mb-1">Map Y</label>
                <input
                  type="number" value={coords.y}
                  onChange={(e) => setCoords((c) => ({ ...c, y: parseInt(e.target.value, 10) || 0 }))}
                  className={cn(input, 'w-full')}
                />
              </div>
              <p className="col-span-2 text-[10.5px] text-fog leading-snug">
                The in-game map coordinates, the same numbers shown on the World Map tab.
              </p>
            </div>
          )}

          <button
            onClick={submit}
            disabled={busy || !picked || !capability?.available || (mode === 'player' && !playerUid)}
            className="w-full mt-4 py-2 rounded-lg text-[12.5px] font-semibold bg-bone text-ink disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? 'Spawning…' : 'Spawn Pal'}
          </button>

          {result && (
            <p className={cn('mt-3 text-[12px] leading-snug', result.ok ? 'text-emerald-400/90' : 'text-rose-400/90')}>
              {result.message}
            </p>
          )}
        </PanelSection>
      </div>
    </>
  );
}

// ── View ─────────────────────────────────────────────────────────────────────

export function Pals() {
  const { api, active } = useInstance();

  const [tab, setTab]   = useState<Tab>('browser');
  const [pals, setPals] = useState<Pal[]>([]);
  const [owners, setOwners] = useState<PalOwner[]>([]);
  const [dex, setDex]   = useState<Record<string, PalDexEntry>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([api.pals(), api.palDex()])
      .then(([data, dexData]) => {
        if (cancelled) return;
        setPals(data.pals);
        setOwners(data.owners);
        setDex(dexData);
      })
      .catch((e) => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [api, active?.id]);

  const tabButton = (id: Tab, label: string) => (
    <button
      key={id}
      onClick={() => setTab(id)}
      className={cn(
        'text-[12px] px-3 py-1.5 rounded-lg border transition-colors',
        tab === id ? 'border-fog/70 bg-ink text-bone' : 'border-line/70 text-fog hover:border-line',
      )}
    >
      {label}
    </button>
  );

  return (
    <ViewWrapper
      eyebrow="Palbox"
      title="Pals"
      description="Every Pal in the world, read straight out of the save, plus spawning for servers running PalDefender."
      accentVar="#5eead4"
      actions={<div className="flex gap-1.5">{tabButton('browser', 'Browser')}{tabButton('spawn', 'Spawn')}</div>}
    >
      {tab === 'browser'
        ? <Browser pals={pals} owners={owners} dex={dex} loading={loading} error={error} />
        : <Spawn dex={dex} />}
    </ViewWrapper>
  );
}
