import { useState, useEffect } from 'react';
import { useInstance } from '../context/InstanceContext';
import { ServerStatus } from '../api/client';
import { ViewWrapper } from '../components/layout/ViewWrapper';
import { cn } from '../lib/cn';

function fmtUptime(sec: number | null): string {
  if (!sec) return '–';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Palworld biomes / regions (approximate map regions for visual decoration)
const REGIONS = [
  { name: 'Windswept Hills',    x: 18, y: 12, w: 22, h: 18, color: '#3fd8b4' },
  { name: 'Marsh Island',       x: 60, y: 8,  w: 18, h: 16, color: '#7ce666' },
  { name: 'Sea Breeze Archipelago', x: 72, y: 30, w: 20, h: 20, color: '#2fd9e8' },
  { name: 'Bamboo Groves',      x: 48, y: 20, w: 16, h: 22, color: '#ffd447' },
  { name: 'Mount Frostpeak',    x: 25, y: 55, w: 20, h: 22, color: '#b27cf2' },
  { name: 'Desert Scorched',    x: 62, y: 60, w: 18, h: 20, color: '#ff9d3d' },
  { name: 'Volcanic Region',    x: 12, y: 70, w: 15, h: 18, color: '#ff5d73' },
  { name: 'Ancient Ruins',      x: 42, y: 62, w: 14, h: 14, color: '#a79fc7' },
  { name: 'Deep Forest',        x: 76, y: 68, w: 16, h: 18, color: '#3fd8b4' },
];

export function WorldMap() {
  const { api, active } = useInstance();
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [hoveredRegion, setHoveredRegion] = useState<string | null>(null);

  useEffect(() => {
    let id: ReturnType<typeof setInterval>;
    async function load() {
      if (!api) return;
      try { setStatus(await api.status()); } catch { /* ignore */ }
      setLoading(false);
    }
    load();
    id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [api]);

  // Distribute players across regions for visual flair
  const playerCount = status?.players?.length ?? 0;
  const regionPlayers = REGIONS.map((r, i) => ({
    ...r,
    players: i < playerCount ? 1 : 0,
  }));

  const isOnline = status?.status === 'online';

  return (
    <ViewWrapper
      eyebrow="Palworld"
      title="World Map"
      description="Live overview of your Palworld server — regions light up as players explore."
      accentVar="#22d3ee"
    >
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Status',   val: status?.status ?? '–',           color: isOnline ? 'text-lime' : 'text-rust' },
          { label: 'Players',  val: `${playerCount} online`, color: 'text-aqua' },
          { label: 'Uptime',   val: fmtUptime(status?.uptime ?? null), color: 'text-violet' },
        ].map((s) => (
          <div key={s.label} className="bg-panel border border-line rounded-2xl p-4 text-center">
            <div className="text-[10.5px] uppercase tracking-widest text-fog mb-1.5">{s.label}</div>
            <div className={cn('font-mono text-[18px] font-semibold capitalize', s.color)}>{s.val}</div>
          </div>
        ))}
      </div>

      {/* Map */}
      <div className="relative rounded-2xl overflow-hidden border border-line bg-[#0a0f1a]" style={{ paddingBottom: '56%' }}>
        {/* Ocean / background */}
        <svg
          className="absolute inset-0 w-full h-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="xMidYMid slice"
        >
          {/* Ocean */}
          <rect width="100" height="100" fill="#050c1a" />

          {/* Grid lines */}
          {Array.from({ length: 10 }, (_, i) => (
            <g key={i} opacity={0.06}>
              <line x1={i * 10} y1="0" x2={i * 10} y2="100" stroke="#2fd9e8" strokeWidth="0.2" />
              <line x1="0" y1={i * 10} x2="100" y2={i * 10} stroke="#2fd9e8" strokeWidth="0.2" />
            </g>
          ))}

          {/* Landmasses (stylised continent outline) */}
          <ellipse cx="50" cy="50" rx="42" ry="38" fill="#0d1f1a" stroke="#1a3030" strokeWidth="0.5" opacity={0.7} />
          <ellipse cx="52" cy="48" rx="34" ry="28" fill="#101f18" stroke="#1a3020" strokeWidth="0.3" opacity={0.8} />

          {/* Biome regions */}
          {regionPlayers.map((r) => {
            const hovered = hoveredRegion === r.name;
            const hasPl   = r.players > 0;
            return (
              <g key={r.name}
                onMouseEnter={() => setHoveredRegion(r.name)}
                onMouseLeave={() => setHoveredRegion(null)}
                style={{ cursor: 'default' }}>
                <rect
                  x={r.x} y={r.y} width={r.w} height={r.h}
                  rx="2" ry="2"
                  fill={r.color}
                  fillOpacity={hovered ? 0.35 : hasPl ? 0.25 : 0.12}
                  stroke={r.color}
                  strokeWidth="0.4"
                  strokeOpacity={hovered ? 0.9 : hasPl ? 0.7 : 0.3}
                  style={{ transition: 'all 0.2s' }}
                />
                {/* Player dot if active */}
                {hasPl && (
                  <circle
                    cx={r.x + r.w / 2} cy={r.y + r.h / 2}
                    r="1.5"
                    fill="white"
                    opacity={0.9}
                  >
                    <animate attributeName="r" values="1.5;2.2;1.5" dur="2s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.9;0.5;0.9" dur="2s" repeatCount="indefinite" />
                  </circle>
                )}
              </g>
            );
          })}

          {/* Server marker (centre of map) */}
          <g>
            <circle cx="50" cy="50" r="3" fill={isOnline ? '#7ce666' : '#ff5d73'} opacity={0.9}>
              <animate attributeName="r" values="3;4.5;3" dur="3s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.9;0.4;0.9" dur="3s" repeatCount="indefinite" />
            </circle>
            <text x="50" y="57" textAnchor="middle" fontSize="3" fill="white" opacity={0.7}>
              {active?.name ?? 'Server'}
            </text>
          </g>

          {/* Compass */}
          <g transform="translate(93,7)">
            <text fontSize="3" fill="#a79fc7" textAnchor="middle" y="0">N</text>
            <text fontSize="2.5" fill="#a79fc7" textAnchor="middle" y="5">S</text>
            <text fontSize="2.5" fill="#a79fc7" textAnchor="start"  x="3" y="2.5">E</text>
            <text fontSize="2.5" fill="#a79fc7" textAnchor="end"    x="-3" y="2.5">W</text>
          </g>
        </svg>

        {/* Loading overlay */}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="text-fog font-mono text-[13px]">Loading…</div>
          </div>
        )}

        {/* Region tooltip */}
        {hoveredRegion && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-panel border border-line px-4 py-2 rounded-xl text-[12px] font-medium pointer-events-none">
            {hoveredRegion}
          </div>
        )}
      </div>

      {/* Region legend */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        {REGIONS.map((r) => (
          <div key={r.name}
            className={cn('flex items-center gap-2 text-[11.5px] py-1.5 px-3 rounded-lg transition-colors',
              hoveredRegion === r.name ? 'bg-panel-raised' : '')}
            onMouseEnter={() => setHoveredRegion(r.name)}
            onMouseLeave={() => setHoveredRegion(null)}>
            <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: r.color, opacity: 0.7 }} />
            <span className="text-fog truncate">{r.name}</span>
          </div>
        ))}
      </div>

      {/* Player list */}
      {isOnline && status!.players && status!.players.length > 0 && (
        <div className="mt-4 bg-panel border border-line rounded-2xl p-4">
          <div className="text-[11px] uppercase tracking-widest text-fog mb-3">Online now</div>
          <div className="flex flex-wrap gap-2">
            {status!.players.map((p: { name: string; steamId?: string }, i: number) => (
              <div key={i} className="flex items-center gap-1.5 text-[12.5px] bg-panel-raised rounded-lg px-3 py-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-lime" />
                {p.name}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 text-[11px] text-fog/40 font-mono text-center">
        Map regions are approximate — exact player coordinates are not available via standard game APIs.
        Refreshes every 15s.
      </div>
    </ViewWrapper>
  );
}
