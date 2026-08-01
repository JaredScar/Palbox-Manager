import { useState, useEffect, useRef, useCallback } from 'react';
import { useInstance } from '../context/InstanceContext';
import { ViewWrapper } from '../components/layout/ViewWrapper';
import { PanelSection } from '../components/ui/PanelSection';
import { cn } from '../lib/cn';
import type { PalRestPlayer, ServerStatus } from '../api/client';

// ── Palworld world coordinate bounds (Unreal Engine units) ───────────────────
// Calibrated from community data for the Palpagos Island map.
const WORLD_MIN_X = -596_000;
const WORLD_MAX_X =  596_000;
const WORLD_MIN_Y = -596_000;
const WORLD_MAX_Y =  596_000;

function worldToPercent(x: number, y: number): { px: number; py: number } {
  const px = ((x - WORLD_MIN_X) / (WORLD_MAX_X - WORLD_MIN_X)) * 100;
  // Y axis is inverted in UE vs screen
  const py = ((WORLD_MAX_Y - y) / (WORLD_MAX_Y - WORLD_MIN_Y)) * 100;
  return { px, py };
}

function fmtPing(p: number) { return p < 0 ? '–' : `${p} ms`; }

// Colour by ping quality
function pingColor(p: number) {
  if (p < 0)   return '#a79fc7';
  if (p < 60)  return '#7ce666';
  if (p < 120) return '#ffd447';
  return '#ff5d73';
}

// ── Player dot overlay ───────────────────────────────────────────────────────
function PlayerDot({
  player,
  hovered,
  onEnter,
  onLeave,
}: {
  player: PalRestPlayer;
  hovered: boolean;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const { px, py } = worldToPercent(player.location_x, player.location_y);

  return (
    <div
      className="absolute group"
      style={{
        left:      `${px}%`,
        top:       `${py}%`,
        transform: 'translate(-50%, -50%)',
        zIndex:    hovered ? 20 : 10,
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {/* Pulse ring */}
      <div
        className={cn(
          'absolute inset-0 rounded-full animate-ping',
          hovered ? 'opacity-60' : 'opacity-30',
        )}
        style={{ background: '#2fd9e8', transform: 'scale(2)' }}
      />
      {/* Dot */}
      <div
        className="relative w-3 h-3 rounded-full border-2 border-void cursor-pointer"
        style={{ background: '#2fd9e8', boxShadow: '0 0 6px #2fd9e8aa' }}
      />
      {/* Tooltip */}
      {hovered && (
        <div
          className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-max max-w-[160px] bg-panel border border-line rounded-xl px-3 py-2 shadow-xl pointer-events-none"
          style={{ zIndex: 30 }}
        >
          <div className="text-[13px] font-semibold text-bone truncate">{player.name}</div>
          <div className="text-[11px] text-fog mt-0.5">Lv {player.level}</div>
          <div className="text-[11px] text-fog">
            Ping: <span style={{ color: pingColor(player.ping) }}>{fmtPing(player.ping)}</span>
          </div>
          <div className="text-[10px] text-fog/50 font-mono mt-0.5">
            {Math.round(player.location_x)}, {Math.round(player.location_y)}
          </div>
        </div>
      )}
    </div>
  );
}

export function WorldMap() {
  const { api, active } = useInstance();

  const [status,     setStatus]     = useState<ServerStatus | null>(null);
  const [players,    setPlayers]    = useState<PalRestPlayer[]>([]);
  const [restError,  setRestError]  = useState(false);
  const [loading,    setLoading]    = useState(true);
  const [hovered,    setHovered]    = useState<string | null>(null);
  const [tab,        setTab]        = useState<'map' | 'reference'>('map');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const load = useCallback(async () => {
    if (!api) return;
    try { setStatus(await api.status()); } catch {}
    try {
      const pls = await api.palrestPlayers();
      setPlayers(pls);
      setRestError(false);
    } catch {
      setRestError(true);
      setPlayers([]);
    }
    setLoading(false);
  }, [api]);

  useEffect(() => {
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [load]);

  const isOnline   = status?.status === 'online';
  const playerCount = players.length || (status?.players?.length ?? 0);

  // Fallback player list from server status if REST API is unavailable
  const fallbackPlayers = status?.players as { name: string; steamId?: string }[] | undefined;

  return (
    <ViewWrapper eyebrow="Palworld" title="World Map" accentVar="#22d3ee">
      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: 'Status',    val: status?.status ?? '–',         color: isOnline ? 'text-[#7ce666]' : 'text-[#ff5d73]' },
          { label: 'Players',   val: `${playerCount} online`,       color: 'text-[#2fd9e8]' },
          { label: 'In-world',  val: restError ? 'REST API off' : `${players.length} located`, color: restError ? 'text-[#a79fc7]' : 'text-[#7ce666]' },
        ].map((s) => (
          <div key={s.label} className="bg-panel border border-line rounded-2xl p-4 text-center">
            <div className="text-[10.5px] uppercase tracking-widest text-fog mb-1.5">{s.label}</div>
            <div className={cn('font-mono text-[16px] font-semibold capitalize', s.color)}>{s.val}</div>
          </div>
        ))}
      </div>

      {/* Tab selector */}
      <div className="flex gap-1 mb-4 bg-panel border border-line rounded-xl p-1 w-fit">
        {(['map', 'reference'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-1.5 rounded-lg text-[12.5px] font-medium transition-all',
              tab === t
                ? 'bg-panel-raised text-bone border border-line'
                : 'text-fog hover:text-bone',
            )}
          >
            {t === 'map' ? '📍 Player Positions' : '🗺️ Interactive Map'}
          </button>
        ))}
      </div>

      {/* ── Player Position Map ───────────────────────────────────────────── */}
      {tab === 'map' && (
        <PanelSection
          title="Player Positions"
          description="Live player locations from the Palworld REST API. Requires REST API enabled on your server (RESTAPIEnabled=true in PalWorldSettings.ini, default port 8212)."
        >
          {restError ? (
            <div className="rounded-xl bg-panel-raised border border-line p-6 text-center space-y-3">
              <div className="text-[32px]">🗺️</div>
              <div className="text-[14px] font-semibold text-bone">REST API not available</div>
              <div className="text-[12.5px] text-fog max-w-sm mx-auto">
                Enable the Palworld REST API to see live player positions on the map.
                Add <code className="bg-panel border border-line px-1.5 py-0.5 rounded text-[11px] font-mono">RESTAPIEnabled=True</code> to your <code className="bg-panel border border-line px-1.5 py-0.5 rounded text-[11px] font-mono">PalWorldSettings.ini</code>, then restart the server.
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
              {/* Map canvas */}
              <div
                className="relative w-full rounded-xl overflow-hidden border border-line bg-[#060d18]"
                style={{ aspectRatio: '1 / 1', maxHeight: '65vh' }}
              >
                {/* Actual Palworld map image */}
                <img
                  src="https://palworld-map.appsample.com/static/media/palpagos-islands.webp"
                  alt="Palpagos Island"
                  className="absolute inset-0 w-full h-full object-cover opacity-80"
                  onError={(e) => {
                    // Fallback to wiki image if CDN is unavailable
                    (e.target as HTMLImageElement).src =
                      'https://palworld.wiki.gg/images/thumb/4/4e/Palpagos_Island.png/1200px-Palpagos_Island.png';
                  }}
                />

                {/* Dark vignette */}
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    background:
                      'radial-gradient(ellipse at center, transparent 60%, rgba(4,8,20,0.7) 100%)',
                  }}
                />

                {/* Grid reference */}
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    backgroundImage:
                      'linear-gradient(rgba(45,217,232,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(45,217,232,0.05) 1px, transparent 1px)',
                    backgroundSize: '10% 10%',
                  }}
                />

                {/* Player markers */}
                {players.map((p) => (
                  <PlayerDot
                    key={p.userId}
                    player={p}
                    hovered={hovered === p.userId}
                    onEnter={() => setHovered(p.userId)}
                    onLeave={() => setHovered(null)}
                  />
                ))}

                {/* No players message */}
                {!loading && players.length === 0 && !restError && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="bg-panel/80 backdrop-blur-sm border border-line rounded-xl px-5 py-3 text-[13px] text-fog">
                      No players currently online
                    </div>
                  </div>
                )}

                {/* Loading */}
                {loading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <div className="w-5 h-5 border-2 border-fog/40 border-t-fog rounded-full animate-spin" />
                  </div>
                )}

                {/* Legend */}
                <div className="absolute bottom-3 right-3 flex items-center gap-1.5 bg-panel/80 backdrop-blur-sm border border-line rounded-lg px-2.5 py-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#2fd9e8]" />
                  <span className="text-[11px] text-fog">Player</span>
                </div>

                {/* Server name */}
                <div className="absolute top-3 left-3 bg-panel/80 backdrop-blur-sm border border-line rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-bone">
                  {active?.name ?? 'Palworld Server'}
                </div>
              </div>

              {/* Player list */}
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
                          Lv {p.level} ·{' '}
                          <span style={{ color: pingColor(p.ping) }}>{fmtPing(p.ping)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </PanelSection>
      )}

      {/* ── Interactive Reference Map (embed) ─────────────────────────────── */}
      {tab === 'reference' && (
        <PanelSection
          title="Palpagos Islands — Interactive Map"
          description="Full interactive map by palworld-map.appsample.com — browse locations, fast travel points, boss spawns, and more."
        >
          <div className="rounded-xl overflow-hidden border border-line" style={{ height: '70vh' }}>
            <iframe
              ref={iframeRef}
              src="https://palworld-map.appsample.com/?no_heading=1"
              title="Palworld Interactive Map"
              className="w-full h-full"
              style={{ border: 'none', background: '#060d18' }}
              loading="lazy"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          </div>
          <p className="mt-2 text-[11px] text-fog/50 text-center">
            Map data © <a
              href="https://palworld-map.appsample.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-fog"
            >palworld-map.appsample.com</a>
          </p>
        </PanelSection>
      )}
    </ViewWrapper>
  );
}
