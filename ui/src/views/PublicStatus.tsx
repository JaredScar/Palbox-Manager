/**
 * Public server status page — no login required.
 * Share the URL  http://your-server:4000/public  with your community.
 */
import { useState, useEffect } from 'react';

interface PublicData {
  instanceId: number;
  serverName: string;
  status: 'online' | 'offline' | 'starting' | 'stopping';
  uptime: number | null;
  playerCount: number;
  maxPlayers: number;
  players: { name: string; joinedAt: number }[];
  gamePort: number;
  publicIp: string | null;
  checkedAt: number;
}

function fmtUptime(sec: number | null): string {
  if (!sec) return '–';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0)  return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtSession(joinedAt: number): string {
  if (!joinedAt) return '';
  const sec = Math.floor((Date.now() - joinedAt) / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const STATUS_COLOR: Record<string, string> = {
  online:   '#7ce666',
  offline:  '#ff5d73',
  starting: '#ffd447',
  stopping: '#ff9d3d',
};

export function PublicStatus() {
  const [data, setData]     = useState<PublicData | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const [lastOk, setLastOk] = useState<Date | null>(null);

  // Parse ?instance=N from the URL, default 1
  const params = new URLSearchParams(window.location.search);
  const instanceId = params.get('instance') ?? '1';

  async function fetch_() {
    try {
      const res = await fetch(`/api/public/status?instance=${instanceId}`);
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json() as PublicData;
      setData(json);
      setLastOk(new Date());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    fetch_();
    const id = setInterval(fetch_, 30_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  const color   = data ? (STATUS_COLOR[data.status] ?? '#a79fc7') : '#a79fc7';
  const isOnline = data?.status === 'online';

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-6"
      style={{ background: '#0a0a0f', color: '#f3effc', fontFamily: 'Inter, sans-serif' }}
    >
      {/* Brand */}
      <div className="flex items-center gap-3 mb-10">
        <img src="/logo.png" alt="Palbox" className="w-10 h-10 rounded-xl" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        <div>
          <div className="text-[17px] font-bold tracking-tight">Palbox</div>
          <div className="text-[11px] text-[#a79fc7] font-mono">server status</div>
        </div>
      </div>

      {error && !data && (
        <div className="text-[#ff5d73] text-[14px] bg-[#ff5d73]/10 border border-[#ff5d73]/30 px-6 py-4 rounded-2xl">
          {error}
        </div>
      )}

      {data && (
        <div className="w-full max-w-lg flex flex-col gap-4">
          {/* Status card */}
          <div
            className="rounded-2xl border p-6"
            style={{
              background: `color-mix(in srgb, ${color} 5%, #12111a)`,
              borderColor: `color-mix(in srgb, ${color} 30%, transparent)`,
            }}
          >
            <div className="flex items-center justify-between mb-5">
              <div>
                <div className="text-[22px] font-bold leading-tight">{data.serverName}</div>
                {data.publicIp && (
                  <div className="text-[12px] text-[#a79fc7] font-mono mt-0.5">
                    {data.publicIp}:{data.gamePort}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full"
                style={{ background: `color-mix(in srgb, ${color} 15%, transparent)` }}>
                <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: color }} />
                <span className="text-[13px] font-semibold capitalize" style={{ color }}>{data.status}</span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Players', val: isOnline ? `${data.playerCount} / ${data.maxPlayers}` : '– / –' },
                { label: 'Uptime',  val: fmtUptime(data.uptime) },
                { label: 'Port',    val: String(data.gamePort) },
              ].map((s) => (
                <div key={s.label}
                  className="rounded-xl p-3 text-center"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                  <div className="text-[10px] uppercase tracking-[0.1em] text-[#a79fc7] font-medium mb-1">{s.label}</div>
                  <div className="font-mono text-[16px] font-semibold">{s.val}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Player list */}
          {isOnline && data.players.length > 0 && (
            <div className="rounded-2xl border p-4"
              style={{ background: '#12111a', borderColor: 'rgba(255,255,255,0.08)' }}>
              <div className="text-[11px] uppercase tracking-[0.1em] text-[#a79fc7] font-medium mb-3">
                Online now
              </div>
              <div className="flex flex-col gap-1.5">
                {data.players.map((p, i) => (
                  <div key={i} className="flex items-center justify-between text-[13px]">
                    <span className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#7ce666' }} />
                      {p.name}
                    </span>
                    {p.joinedAt > 0 && (
                      <span className="text-[11px] text-[#a79fc7] font-mono">{fmtSession(p.joinedAt)}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {isOnline && data.playerCount === 0 && (
            <div className="text-center text-[13px] text-[#a79fc7] py-2">
              No players online — be the first to join!
            </div>
          )}

          <div className="text-center text-[11px] text-[#a79fc7]/50 font-mono mt-2">
            Updated {lastOk ? lastOk.toLocaleTimeString() : '–'} · refreshes every 30s
          </div>
        </div>
      )}
    </div>
  );
}
