import { useEffect, useState } from 'react';
import { instanceApi, makeApi, type Instance, type ServerStatus } from '../api/client';
import { ViewWrapper } from '../components/layout/ViewWrapper';

interface InstanceCard {
  inst: Instance;
  status: ServerStatus | null;
  loading: boolean;
  error: string | null;
}

export default function Cluster() {
  const [cards, setCards] = useState<InstanceCard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        const instances = await instanceApi.list();
        const initial = instances.map((inst) => ({ inst, status: null, loading: true, error: null }));
        if (mounted) setCards(initial);

        // Fetch status for each instance in parallel
        const results = await Promise.allSettled(
          instances.map((inst) => makeApi(inst.id).status()),
        );
        if (!mounted) return;
        setCards(
          instances.map((inst, i) => {
            const r = results[i];
            return {
              inst,
              status: r.status === 'fulfilled' ? r.value : null,
              loading: false,
              error: r.status === 'rejected' ? String(r.reason) : null,
            };
          }),
        );
      } catch (e) {
        console.error(e);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 30_000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  return (
    <ViewWrapper eyebrow="Cluster" title="Cluster Overview" description={`${cards.length} server${cards.length !== 1 ? 's' : ''}`}>
      {loading && cards.length === 0 ? (
        <div className="flex items-center justify-center h-40 text-[var(--fog)]">Loading instances…</div>
      ) : cards.length === 0 ? (
        <p className="text-[var(--fog)] text-sm">No instances configured yet.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {cards.map(({ inst, status, loading: cardLoading }) => (
            <ClusterCard key={inst.id} inst={inst} status={status} loading={cardLoading} />
          ))}
        </div>
      )}
    </ViewWrapper>
  );
}

function ClusterCard({ inst, status, loading }: { inst: Instance; status: ServerStatus | null; loading: boolean }) {
  const online = status?.status === 'online';
  const players = status?.players?.length ?? 0;
  const cpu = status?.cpuPct ?? 0;
  const mem = status?.memMb ?? 0;

  return (
    <div
      className="relative rounded-xl overflow-hidden border border-[var(--line)] bg-[var(--panel)] p-5 flex flex-col gap-4"
      style={{ boxShadow: online ? '0 0 0 1px rgba(124,230,102,0.15), inset 0 0 30px rgba(124,230,102,0.03)' : undefined }}
    >
      {/* Top strip */}
      <div
        className="absolute top-0 left-0 right-0 h-0.5"
        style={{ background: online ? 'var(--lime)' : 'var(--fog)', opacity: 0.6 }}
      />

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-[var(--bone)] text-sm leading-tight">{inst.name}</h3>
          <p className="text-xs text-[var(--fog)] mt-0.5">{inst.rcon_host}:{inst.game_port}</p>
        </div>
        {loading ? (
          <div className="w-3 h-3 rounded-full border border-[var(--fog)] border-t-transparent animate-spin" />
        ) : (
          <div className="flex items-center gap-1.5">
            <div
              className="w-2 h-2 rounded-full pulse-dot"
              style={{ color: online ? 'var(--lime)' : 'var(--fog)' }}
            />
            <span className={`text-xs font-medium ${online ? 'text-[var(--lime)]' : 'text-[var(--fog)]'}`}>
              {status?.status ?? 'unknown'}
            </span>
          </div>
        )}
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-3 gap-2">
        <Metric label="Players" value={players} suffix="" highlight={players > 0} />
        <Metric label="CPU" value={`${cpu.toFixed(1)}`} suffix="%" highlight={cpu > 80} warn={cpu > 80} />
        <Metric label="RAM" value={mem >= 1024 ? (mem / 1024).toFixed(1) : mem} suffix={mem >= 1024 ? 'GB' : 'MB'} />
      </div>

      {/* Uptime */}
      {status?.uptime != null && (
        <p className="text-xs text-[var(--fog)]">
          Up for <span className="text-[var(--bone-dim)]">{fmtUptime(status.uptime)}</span>
        </p>
      )}

      {/* Player list preview */}
      {players > 0 && status?.players && (
        <div className="flex flex-wrap gap-1">
          {status.players.slice(0, 5).map((p) => (
            <span key={p.steamId} className="text-xs bg-[var(--panel-raised)] text-[var(--bone-dim)] rounded px-1.5 py-0.5">
              {p.name}
            </span>
          ))}
          {players > 5 && (
            <span className="text-xs text-[var(--fog)]">+{players - 5} more</span>
          )}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, suffix, highlight, warn }: {
  label: string; value: string | number; suffix: string;
  highlight?: boolean; warn?: boolean;
}) {
  return (
    <div className="bg-[var(--panel-raised)] rounded-lg px-3 py-2 text-center">
      <p className="text-[10px] uppercase tracking-wide text-[var(--fog)] mb-0.5">{label}</p>
      <p className={`text-sm font-bold tabular-nums ${warn ? 'text-[var(--rust)]' : highlight ? 'text-[var(--lime)]' : 'text-[var(--bone)]'}`}>
        {value}<span className="text-[10px] font-normal text-[var(--fog)] ml-0.5">{suffix}</span>
      </p>
    </div>
  );
}

function fmtUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
