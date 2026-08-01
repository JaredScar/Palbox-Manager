import { useState, useEffect, useRef, useCallback } from 'react';
import { useInstance } from '../context/InstanceContext';
import { ViewWrapper } from '../components/layout/ViewWrapper';
import { PanelSection } from '../components/ui/PanelSection';
import { cn } from '../lib/cn';
import type { PalRestPlayer, ServerStatus } from '../api/client';
import { worldToUv, worldToGameCoords, worldLengthToUv } from '../lib/mapProject';
import type { BaseCamp, Guild, WorldSaveData } from '../api/client';

const MIN_SCALE = 1;
const MAX_SCALE = 8;

// The REST API reports ping as a float with full double precision.
const fmtPing = (p: number) => (p < 0 ? '-' : `${Math.round(p)} ms`);

/**
 * A stable colour per guild, so a guild keeps the same one across reloads and
 * between its territory circles and its row in the roster.
 */
const GUILD_COLOURS = [
  '#f472b6', '#facc15', '#4ade80', '#a78bfa', '#fb923c',
  '#38bdf8', '#f87171', '#2dd4bf', '#c084fc', '#a3e635',
];

function guildColour(guildId: string | null): string {
  if (!guildId) return '#94a3b8';
  let hash = 0;
  for (let i = 0; i < guildId.length; i++) hash = (hash * 31 + guildId.charCodeAt(i)) >>> 0;
  return GUILD_COLOURS[hash % GUILD_COLOURS.length];
}

/**
 * A base camp and the area it claims. The circle is drawn in map space so it
 * grows with zoom the way the terrain does, while the icon is counter-scaled
 * to stay legible.
 */
function BaseMarker({
  base, guild, scale, hovered, onEnter, onLeave,
}: {
  base: BaseCamp;
  guild: Guild | undefined;
  scale: number;
  hovered: boolean;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const { u, v } = worldToUv(base.x, base.y);
  const colour = guildColour(base.guildId);
  const diameter = worldLengthToUv(base.areaRange) * 2 * 100;

  return (
    <>
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          left: `${u * 100}%`,
          top: `${v * 100}%`,
          width: `${diameter}%`,
          height: `${diameter}%`,
          transform: 'translate(-50%, -50%)',
          background: `${colour}1f`,
          border: `1px solid ${colour}${hovered ? 'cc' : '66'}`,
          zIndex: 4,
        }}
      />
      <div
        className="absolute"
        style={{
          left: `${u * 100}%`,
          top: `${v * 100}%`,
          transform: `translate(-50%, -50%) scale(${1 / scale})`,
          zIndex: hovered ? 19 : 5,
        }}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
      >
        <div
          className="w-2.5 h-2.5 rotate-45 border cursor-pointer"
          style={{ background: `${colour}dd`, borderColor: '#0b1220' }}
        />
        {hovered && (
          <div
            className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-max max-w-[200px] bg-panel border border-line rounded-xl px-3 py-2 shadow-xl pointer-events-none"
            style={{ zIndex: 30 }}
          >
            <div className="text-[13px] font-semibold text-bone truncate">
              {guild?.name || 'Unclaimed base'}
            </div>
            <div className="text-[11px] text-fog mt-0.5">
              Base camp{guild ? ` · Lv ${guild.baseCampLevel}` : ''}
            </div>
            <div className="text-[10px] text-fog/50 font-mono mt-0.5">
              {(() => { const g = worldToGameCoords(base.x, base.y); return `${g.x}, ${g.y}`; })()}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

const fmtLastOnline = (ticks: number | null) => {
  // Unreal writes .NET-style ticks: 100ns units since year 1.
  if (!ticks) return 'never';
  const ms = ticks / 10_000 - 62_135_596_800_000;
  if (!Number.isFinite(ms) || ms <= 0) return 'never';
  const days = (Date.now() - ms) / 86_400_000;
  if (days < 0) return 'just now';
  if (days < 1) return 'today';
  if (days < 2) return 'yesterday';
  if (days < 30) return `${Math.floor(days)} days ago`;
  return new Date(ms).toLocaleDateString();
};

/**
 * Guilds read out of the save file. This is the one place in the panel that
 * knows about offline players, since the live APIs only ever report who is
 * connected right now.
 */
function GuildRoster({
  world, scanning, onRescan, hoveredBase, onHoverGuild,
}: {
  world: WorldSaveData | null;
  scanning: boolean;
  onRescan: () => void;
  hoveredBase: string | null;
  onHoverGuild: (baseId: string | null) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const scan = world?.scan;
  const guilds = world?.guilds ?? [];

  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[13px] font-semibold text-bone">Guilds</div>
          <div className="text-[11px] text-fog/60">
            {scan?.scannedAt
              ? `Read from the world save · ${guilds.length} guild(s), ${world?.bases.length ?? 0} base camp(s)`
              : 'Read from the world save'}
          </div>
        </div>
        <button
          onClick={onRescan}
          disabled={scanning}
          className="text-[11.5px] px-2.5 py-1.5 rounded-lg border border-line text-fog hover:text-bone hover:bg-panel-raised transition-colors disabled:opacity-40"
        >
          {scanning ? 'Reading…' : 'Rescan save'}
        </button>
      </div>

      {scan?.error ? (
        <div className="text-[12px] rounded-lg px-3 py-2 bg-amber-500/10 text-amber-300 border border-amber-500/30">
          {scan.error}
        </div>
      ) : guilds.length === 0 ? (
        <div className="text-[12px] text-fog/60">
          No guilds found yet. The world save is read a few minutes after the panel starts and
          again whenever the server autosaves.
        </div>
      ) : (
        <div className="space-y-1.5">
          {guilds.map((g) => {
            const bases = world?.bases.filter((b) => b.guildId === g.groupId) ?? [];
            const isOpen = expanded === g.groupId;
            const isHighlighted = bases.some((b) => b.baseId === hoveredBase);
            return (
              <div
                key={g.groupId}
                className={cn(
                  'rounded-xl border transition-colors',
                  isHighlighted ? 'border-line/80 bg-panel-raised' : 'border-line bg-panel',
                )}
                onMouseEnter={() => onHoverGuild(bases[0]?.baseId ?? null)}
                onMouseLeave={() => onHoverGuild(null)}
              >
                <button
                  onClick={() => setExpanded(isOpen ? null : g.groupId)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left"
                >
                  <div className="w-2.5 h-2.5 rotate-45 shrink-0" style={{ background: guildColour(g.groupId) }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium text-bone truncate">{g.name || 'Unnamed guild'}</div>
                    <div className="text-[10.5px] text-fog">
                      {g.memberCount} member{g.memberCount === 1 ? '' : 's'} · {bases.length} base
                      {bases.length === 1 ? '' : 's'} · Lv {g.baseCampLevel}
                    </div>
                  </div>
                  <svg
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
                    className={cn('w-3.5 h-3.5 text-fog/50 transition-transform', isOpen && 'rotate-180')}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                {isOpen && (
                  <div className="px-3 pb-2.5 -mt-0.5 space-y-1">
                    {g.members.map((m) => (
                      <div key={m.playerId} className="flex items-center justify-between text-[11.5px]">
                        <span className="text-fog truncate">
                          {m.name || 'Unknown'}
                          {m.playerId === g.adminPlayerId && (
                            <span className="ml-1.5 text-[10px] text-fog/50">admin</span>
                          )}
                        </span>
                        <span className="text-fog/50 shrink-0 ml-3">{fmtLastOnline(m.lastOnline)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function pingColor(p: number) {
  if (p < 0)   return '#a79fc7';
  if (p < 60)  return '#7ce666';
  if (p < 120) return '#ffd447';
  return '#ff5d73';
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface View { scale: number; x: number; y: number }

/**
 * Marker for one player. Counter-scaled by the current zoom so the dot and its
 * tooltip stay a constant size on screen while the map grows beneath them.
 */
function PlayerDot({
  player, hovered, scale, onEnter, onLeave,
}: {
  player: PalRestPlayer;
  hovered: boolean;
  scale: number;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const { u, v } = worldToUv(player.location_x, player.location_y);

  return (
    <div
      className="absolute"
      style={{
        left: `${u * 100}%`,
        top: `${v * 100}%`,
        transform: `translate(-50%, -50%) scale(${1 / scale})`,
        zIndex: hovered ? 20 : 10,
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div
        className={cn('absolute inset-0 rounded-full animate-ping', hovered ? 'opacity-60' : 'opacity-30')}
        style={{ background: '#2fd9e8', transform: 'scale(2)' }}
      />
      <div
        className="relative w-3 h-3 rounded-full border-2 border-void cursor-pointer"
        style={{ background: '#2fd9e8', boxShadow: '0 0 6px #2fd9e8aa' }}
      />
      {hovered && (
        <div
          className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-max max-w-[180px] bg-panel border border-line rounded-xl px-3 py-2 shadow-xl pointer-events-none"
          style={{ zIndex: 30 }}
        >
          <div className="text-[13px] font-semibold text-bone truncate">{player.name}</div>
          <div className="text-[11px] text-fog mt-0.5">Lv {player.level}</div>
          <div className="text-[11px] text-fog">
            Ping: <span style={{ color: pingColor(player.ping) }}>{fmtPing(player.ping)}</span>
          </div>
          {/* The in-game readout, so it can be checked against the map in
              game rather than against raw Unreal units. */}
          <div className="text-[10px] text-fog/50 font-mono mt-0.5">
            {(() => {
              const g = worldToGameCoords(player.location_x, player.location_y);
              return `${g.x}, ${g.y}`;
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

export function WorldMap() {
  const { api, active } = useInstance();

  const [status,    setStatus]    = useState<ServerStatus | null>(null);
  const [players,   setPlayers]   = useState<PalRestPlayer[]>([]);
  const [restError, setRestError] = useState(false);
  const [loading,   setLoading]   = useState(true);
  const [hovered,   setHovered]   = useState<string | null>(null);
  const [mapFailed, setMapFailed] = useState(false);
  const [mapInfo, setMapInfo] = useState<{ available: boolean; calibrated: boolean } | null>(null);
  const [world,     setWorld]     = useState<WorldSaveData | null>(null);
  const [showBases, setShowBases] = useState(true);
  const [scanning,  setScanning]  = useState(false);
  const [hoveredBase, setHoveredBase] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/world-map-image/info', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setMapInfo(d as { available: boolean; calibrated: boolean }))
      .catch(() => { /* older server without this endpoint */ });
  }, []);

  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    try { setStatus(await api.status()); } catch { /* status is optional here */ }
    try {
      setPlayers(await api.palrestPlayers());
      setRestError(false);
    } catch {
      setRestError(true);
      setPlayers([]);
    }
    // Guilds come from the save file, so they are still available even when
    // the REST API is down or the server is stopped.
    try { setWorld(await api.worldSave()); } catch { /* older server */ }
    setLoading(false);
  }, [api]);

  const rescan = useCallback(async () => {
    if (!api) return;
    setScanning(true);
    try {
      await api.scanWorldSave();
      setWorld(await api.worldSave());
    } catch { /* the scan status carries the reason */ }
    setScanning(false);
  }, [api]);

  useEffect(() => {
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [load]);

  /**
   * Keeps the map from being dragged off screen. At scale 1 there is no slack,
   * so panning is pinned to centre; beyond that the edges may travel exactly as
   * far as the overflow allows.
   */
  const clampView = useCallback((v: View): View => {
    const el = viewportRef.current;
    if (!el) return v;
    const { width, height } = el.getBoundingClientRect();
    const slackX = (width  * v.scale - width)  / 2;
    const slackY = (height * v.scale - height) / 2;
    return { ...v, x: clamp(v.x, -slackX, slackX), y: clamp(v.y, -slackY, slackY) };
  }, []);

  const zoomBy = useCallback((factor: number, originX?: number, originY?: number) => {
    setView((v) => {
      const scale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE);
      const applied = scale / v.scale;
      const el = viewportRef.current;
      if (!el || originX === undefined || originY === undefined) {
        return clampView({ scale, x: v.x * applied, y: v.y * applied });
      }
      // Anchor the zoom on the cursor so the point under it stays put.
      const rect = el.getBoundingClientRect();
      const cx = originX - rect.left - rect.width / 2;
      const cy = originY - rect.top - rect.height / 2;
      return clampView({
        scale,
        x: cx - (cx - v.x) * applied,
        y: cy - (cy - v.y) * applied,
      });
    });
  }, [clampView]);

  // Wheel zoom. Registered natively because React marks wheel handlers passive,
  // which makes preventDefault a no-op and lets the page scroll instead.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX, e.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  function onPointerDown(e: React.PointerEvent) {
    if (view.scale <= MIN_SCALE) return;
    dragRef.current = { x: e.clientX, y: e.clientY, ox: view.x, oy: view.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    setView((v) => clampView({ ...v, x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) }));
  }
  function onPointerUp(e: React.PointerEvent) {
    dragRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }

  const isOnline = status?.status === 'online';
  const playerCount = players.length || (status?.players?.length ?? 0);
  const fallbackPlayers = status?.players as { name: string; steamId?: string }[] | undefined;
  const canPan = view.scale > MIN_SCALE;

  return (
    <ViewWrapper eyebrow="Palworld" title="World Map" accentVar="#22d3ee">
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: 'Status',   val: status?.status ?? '-', color: isOnline ? 'text-[#7ce666]' : 'text-[#ff5d73]' },
          { label: 'Players',  val: `${playerCount} online`, color: 'text-[#2fd9e8]' },
          { label: 'In-world', val: restError ? 'REST API off' : `${players.length} located`,
            color: restError ? 'text-[#a79fc7]' : 'text-[#7ce666]' },
        ].map((s) => (
          <div key={s.label} className="bg-panel border border-line rounded-2xl p-4 text-center">
            <div className="text-[10.5px] uppercase tracking-widest text-fog mb-1.5">{s.label}</div>
            <div className={cn('font-mono text-[16px] font-semibold capitalize', s.color)}>{s.val}</div>
          </div>
        ))}
      </div>

      <PanelSection
        title="Palpagos Island"
        description="Live player positions from the Palworld REST API. Scroll to zoom, drag to pan."
      >
        {/* Positions are only accurate on the game's own map texture, because
            the projection is an affine transform calibrated to its framing. */}
        {mapInfo && mapInfo.available && !mapInfo.calibrated && (
          <div className="mb-3 text-[12px] rounded-lg px-3 py-2 bg-amber-500/10 text-amber-300 border border-amber-500/30">
            Showing a fallback map image because the in-game map texture could not be downloaded.
            Player markers will be approximate until it is reachable again.
          </div>
        )}
        {restError ? (
          <div className="rounded-xl bg-panel-raised border border-line p-6 text-center space-y-3">
            <div className="text-[14px] font-semibold text-bone">REST API not available</div>
            <div className="text-[12.5px] text-fog max-w-sm mx-auto">
              Enable the Palworld REST API to see live player positions. Add{' '}
              <code className="bg-panel border border-line px-1.5 py-0.5 rounded text-[11px] font-mono">RESTAPIEnabled=True</code>{' '}
              to your{' '}
              <code className="bg-panel border border-line px-1.5 py-0.5 rounded text-[11px] font-mono">PalWorldSettings.ini</code>,
              then restart the server.
            </div>
            {fallbackPlayers && fallbackPlayers.length > 0 && (
              <div className="mt-4">
                <div className="text-[11px] uppercase tracking-widest text-fog mb-2">Online (from RCON)</div>
                <div className="flex flex-wrap gap-2 justify-center">
                  {fallbackPlayers.map((p, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[12.5px] bg-panel rounded-lg px-3 py-1.5 border border-line">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#7ce666]" />
                      {p.name}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            <div
              ref={viewportRef}
              className={cn(
                'relative w-full mx-auto rounded-xl overflow-hidden border border-line bg-[#060d18] touch-none select-none',
                canPan ? (dragRef.current ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default',
              )}
              // Capped on width rather than height so the box stays exactly
              // square. Markers are positioned as a percentage of it, so any
              // deviation from the texture's own square aspect shifts them.
              style={{ aspectRatio: '1 / 1', maxWidth: '70vh' }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onDoubleClick={(e) => zoomBy(1.6, e.clientX, e.clientY)}
            >
              {/* Everything that should move together lives inside this one
                  transform, so markers stay pinned to the terrain as it moves. */}
              <div
                className="absolute inset-0"
                style={{
                  transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
                  transformOrigin: 'center center',
                  transition: dragRef.current ? 'none' : 'transform 120ms ease-out',
                }}
              >
                {!mapFailed ? (
                  // Proxied through the API: the upstream hosts refuse
                  // hotlinked requests, so a direct <img> renders nothing.
                  <img
                    src="/api/world-map-image"
                    alt="Palpagos Island"
                    // "fill" not "cover": cover crops the texture, and the
                    // projection assumes the whole image is visible and maps
                    // linearly onto this box.
                    className="absolute inset-0 w-full h-full object-fill"
                    draggable={false}
                    onError={() => setMapFailed(true)}
                  />
                ) : (
                  <div className="absolute inset-0 bg-[#08131f]">
                    <div
                      className="absolute inset-0"
                      style={{
                        backgroundImage:
                          'radial-gradient(circle at 50% 45%, rgba(45,217,232,0.16) 0%, transparent 55%)',
                      }}
                    />
                  </div>
                )}

                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    backgroundImage:
                      'linear-gradient(rgba(45,217,232,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(45,217,232,0.05) 1px, transparent 1px)',
                    backgroundSize: '10% 10%',
                  }}
                />

                {/* Bases first so live players always draw on top of them */}
                {showBases && world?.bases.map((b) => (
                  <BaseMarker
                    key={b.baseId}
                    base={b}
                    guild={world.guilds.find((g) => g.groupId === b.guildId)}
                    scale={view.scale}
                    hovered={hoveredBase === b.baseId}
                    onEnter={() => setHoveredBase(b.baseId)}
                    onLeave={() => setHoveredBase(null)}
                  />
                ))}

                {players.map((p) => (
                  <PlayerDot
                    key={p.userId}
                    player={p}
                    scale={view.scale}
                    hovered={hovered === p.userId}
                    onEnter={() => setHovered(p.userId)}
                    onLeave={() => setHovered(null)}
                  />
                ))}
              </div>

              {/* Chrome sits outside the transform so it stays put while panning */}
              <div className="absolute top-3 left-3 bg-panel/80 backdrop-blur-sm border border-line rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-bone pointer-events-none">
                {active?.name ?? 'Palworld Server'}
              </div>

              <div className="absolute top-3 right-3 flex flex-col gap-1">
                {[
                  { label: '+', title: 'Zoom in',  onClick: () => zoomBy(1.4) },
                  { label: '−', title: 'Zoom out', onClick: () => zoomBy(1 / 1.4) },
                ].map((b) => (
                  <button
                    key={b.title}
                    title={b.title}
                    onClick={b.onClick}
                    className="w-7 h-7 rounded-lg bg-panel/85 backdrop-blur-sm border border-line text-fog hover:text-bone hover:border-line/80 flex items-center justify-center text-[15px] leading-none transition-colors"
                  >
                    {b.label}
                  </button>
                ))}
                <button
                  title="Reset view"
                  onClick={() => setView({ scale: 1, x: 0, y: 0 })}
                  disabled={view.scale === 1 && view.x === 0 && view.y === 0}
                  className="w-7 h-7 rounded-lg bg-panel/85 backdrop-blur-sm border border-line text-fog hover:text-bone flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-default"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                    <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />
                  </svg>
                </button>
              </div>

              <div className="absolute bottom-3 right-3 flex items-center gap-2 bg-panel/80 backdrop-blur-sm border border-line rounded-lg px-2.5 py-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-[#2fd9e8]" />
                <span className="text-[11px] text-fog">Player</span>
                {(world?.bases.length ?? 0) > 0 && (
                  <button
                    onClick={() => setShowBases((s) => !s)}
                    title={showBases ? 'Hide base camps' : 'Show base camps'}
                    className="flex items-center gap-2 border-l border-line pl-2 transition-opacity"
                    style={{ opacity: showBases ? 1 : 0.4 }}
                  >
                    <div className="w-2.5 h-2.5 rotate-45 bg-fog" />
                    <span className="text-[11px] text-fog">Bases</span>
                  </button>
                )}
                {view.scale > 1 && (
                  <span className="text-[11px] text-fog/60 font-mono border-l border-line pl-2">
                    {view.scale.toFixed(1)}x
                  </span>
                )}
              </div>

              {!loading && players.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="bg-panel/80 backdrop-blur-sm border border-line rounded-xl px-5 py-3 text-[13px] text-fog">
                    No players currently online
                  </div>
                </div>
              )}

              {loading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                  <div className="w-5 h-5 border-2 border-fog/40 border-t-fog rounded-full animate-spin" />
                </div>
              )}
            </div>

            {players.length > 0 && (
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {players.map((p) => (
                  <div
                    key={p.userId}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 rounded-xl border transition-colors cursor-default',
                      hovered === p.userId
                        ? 'border-[#2fd9e8]/50 bg-[#2fd9e8]/10'
                        : 'border-line bg-panel hover:bg-panel-raised',
                    )}
                    onMouseEnter={() => setHovered(p.userId)}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <div className="w-2 h-2 rounded-full bg-[#2fd9e8] shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-medium text-bone truncate">{p.name}</div>
                      <div className="text-[10.5px] text-fog">
                        Lv {p.level} · <span style={{ color: pingColor(p.ping) }}>{fmtPing(p.ping)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <GuildRoster
              world={world}
              scanning={scanning}
              onRescan={rescan}
              hoveredBase={hoveredBase}
              onHoverGuild={setHoveredBase}
            />

            <p className="mt-3 text-[11px] text-fog/50 text-center">
              Looking for spawns, chests, and fast travel points?{' '}
              <a
                href="https://palworld-map.appsample.com"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-fog"
              >
                Open the full reference map
              </a>
            </p>
          </>
        )}
      </PanelSection>
    </ViewWrapper>
  );
}
