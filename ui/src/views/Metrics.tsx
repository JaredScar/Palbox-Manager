import { useState, useEffect } from 'react';
import {
  ResponsiveContainer, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { MetricPoint, UptimeData } from '../api/client';
import { useInstance } from '../context/InstanceContext';
import { ViewWrapper } from '../components/layout/ViewWrapper';
import { PanelSection } from '../components/ui/PanelSection';
import { cn } from '../lib/cn';

type Range = '1h' | '6h' | '24h' | '7d' | '30d';
const RANGES: { label: string; value: Range; hours: number }[] = [
  { label: '1h',  value: '1h',  hours: 1 },
  { label: '6h',  value: '6h',  hours: 6 },
  { label: '24h', value: '24h', hours: 24 },
  { label: '7d',  value: '7d',  hours: 168 },
  { label: '30d', value: '30d', hours: 720 },
];

const fmtTime = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDate = (ts: number) => new Date(ts * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' });
const fmtDuration = (sec: number) => {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
};

const TOOLTIP_STYLE = { background: '#1C1832', border: '1px solid #392F5A', borderRadius: 8, color: '#F3EFFC', fontSize: 12 };

export function Metrics() {
  const { api, active } = useInstance();
  const [range, setRange] = useState<Range>('24h');
  const [data, setData] = useState<MetricPoint[]>([]);
  const [uptime, setUptime] = useState<UptimeData | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!api) return;
    setLoading(true);
    try {
      const [metrics, uptimeData] = await Promise.all([
        api.metrics(RANGES.find((r) => r.value === range)!.hours),
        api.uptime(30).catch(() => null),
      ]);
      setData(metrics);
      setUptime(uptimeData);
    } catch {}
    setLoading(false);
  }
  useEffect(() => { load(); }, [api, range]);

  const avgPlayers  = data.length ? (data.reduce((s, d) => s + d.players, 0) / data.length).toFixed(1) : '–';
  const peakPlayers = data.length ? Math.max(...data.map((d) => d.players)) : 0;
  const avgCpu      = data.length ? (data.reduce((s, d) => s + d.cpu_pct, 0) / data.length).toFixed(1) : '–';
  const avgMem      = data.length ? (data.reduce((s, d) => s + d.mem_mb, 0) / data.length / 1024).toFixed(1) : '–';

  const hours = RANGES.find((r) => r.value === range)!.hours;
  const fmt = hours > 48 ? fmtDate : fmtTime;

  const sampled = data.length > 300 ? data.filter((_, i) => i % Math.ceil(data.length / 300) === 0) : data;
  const chartData = sampled.map((d) => ({
    label: fmt(d.recorded_at),
    players: d.players,
    cpu: parseFloat(d.cpu_pct.toFixed(1)),
    mem: parseFloat((d.mem_mb / 1024).toFixed(2)),
  }));

  const SUMMARY = [
    { key: 'Avg players',  val: avgPlayers,  color: 'text-aqua' },
    { key: 'Peak players', val: String(peakPlayers), color: 'text-aqua' },
    { key: 'Avg CPU',      val: `${avgCpu}%`, color: 'text-ember' },
    { key: 'Avg memory',   val: `${avgMem} GB`, color: 'text-violet' },
    { key: 'Data points',  val: data.length.toLocaleString(), color: 'text-fog' },
  ];

  const slaColor = !uptime ? 'text-fog'
    : uptime.sla.uptimePct >= 99 ? 'text-lime'
    : uptime.sla.uptimePct >= 95 ? 'text-gold'
    : 'text-rust';

  return (
    <ViewWrapper eyebrow="Performance history" title="Metrics"
      description={`Up to 30 days of sampled data for ${active?.name ?? 'this server'} — recorded every ~30 seconds.`}
      accentVar="var(--aqua)"
      actions={
        <div className="flex gap-1.5">
          {RANGES.map((r) => (
            <button key={r.value} onClick={() => setRange(r.value)}
              className={cn(
                'px-3.5 py-1.5 rounded-lg border font-mono text-[12px] transition-all duration-150',
                range === r.value
                  ? 'bg-aqua border-aqua text-void'
                  : 'bg-transparent border-line text-fog hover:text-bone hover:border-fog/60',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      }
    >
      {/* Summary cards */}
      <div className="grid grid-cols-5 gap-3 mb-5">
        {SUMMARY.map(({ key, val, color }) => (
          <div key={key} className="bg-panel-raised border border-line rounded-xl p-4">
            <div className="text-[10px] uppercase tracking-widest text-fog mb-1.5">{key}</div>
            <div className={cn('text-[26px] font-mono font-bold', color)}>{val}</div>
          </div>
        ))}
      </div>

      {/* Uptime SLA Panel */}
      {uptime && (
        <PanelSection title="Uptime SLA — last 30 days">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="bg-[var(--panel-raised)] rounded-xl p-4 text-center">
              <div className="text-[10px] uppercase tracking-widest text-[var(--fog)] mb-1">Uptime</div>
              <div className={cn('text-3xl font-mono font-bold', slaColor)}>{uptime.sla.uptimePct.toFixed(2)}%</div>
            </div>
            <div className="bg-[var(--panel-raised)] rounded-xl p-4 text-center">
              <div className="text-[10px] uppercase tracking-widest text-[var(--fog)] mb-1">Outages</div>
              <div className="text-3xl font-mono font-bold text-[var(--ember)]">{uptime.outages.count}</div>
            </div>
            <div className="bg-[var(--panel-raised)] rounded-xl p-4 text-center">
              <div className="text-[10px] uppercase tracking-widest text-[var(--fog)] mb-1">Longest</div>
              <div className="text-3xl font-mono font-bold text-[var(--rust)]">
                {uptime.outages.longestSec > 0 ? fmtDuration(uptime.outages.longestSec) : '–'}
              </div>
            </div>
            <div className="bg-[var(--panel-raised)] rounded-xl p-4 text-center">
              <div className="text-[10px] uppercase tracking-widest text-[var(--fog)] mb-1">Avg outage</div>
              <div className="text-3xl font-mono font-bold text-[var(--fog)]">
                {uptime.outages.avgSec > 0 ? fmtDuration(uptime.outages.avgSec) : '–'}
              </div>
            </div>
          </div>

          {/* Uptime timeline bar */}
          <div className="h-7 rounded-lg overflow-hidden flex" title="Uptime timeline (last 30 days)">
            {uptime.events.length === 0 ? (
              <div className="flex-1 bg-[var(--lime)] opacity-30 rounded-lg" />
            ) : (
              <UptimeBar events={uptime.events} days={30} />
            )}
          </div>
          <div className="flex justify-between text-[10px] text-[var(--fog)] mt-1">
            <span>30 days ago</span><span>Now</span>
          </div>
        </PanelSection>
      )}

      {loading ? (
        <div className="text-fog text-[14px] py-12 text-center">Loading metrics…</div>
      ) : data.length === 0 ? (
        <div className="text-fog text-[14px] py-12 text-center max-w-sm mx-auto">
          No metrics yet — the watchdog records a data point every 30 seconds once the server is running.
        </div>
      ) : (
        <>
          <PanelSection title="Players online">
            <div className="py-2">
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gAqua" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2FD9E8" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#2FD9E8" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e1a30" />
                  <XAxis dataKey="label" tick={{ fill: '#A79FC7', fontSize: 11 }} stroke="#392F5A" interval="preserveStartEnd" />
                  <YAxis allowDecimals={false} tick={{ fill: '#A79FC7', fontSize: 11 }} stroke="#392F5A" />
                  <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: '#A79FC7' }} />
                  <Area type="monotone" dataKey="players" name="Players" stroke="#2FD9E8" fill="url(#gAqua)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </PanelSection>

          <PanelSection title="CPU &amp; Memory">
            <div className="py-2">
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gEmber" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#FF9D3D" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#FF9D3D" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gViolet" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#B27CF2" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#B27CF2" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e1a30" />
                  <XAxis dataKey="label" tick={{ fill: '#A79FC7', fontSize: 11 }} stroke="#392F5A" interval="preserveStartEnd" />
                  <YAxis tick={{ fill: '#A79FC7', fontSize: 11 }} stroke="#392F5A" />
                  <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: '#A79FC7' }} />
                  <Legend wrapperStyle={{ color: '#A79FC7', fontSize: 12 }} />
                  <Area type="monotone" dataKey="cpu" name="CPU %" stroke="#FF9D3D" fill="url(#gEmber)" strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="mem" name="Memory (GB)" stroke="#B27CF2" fill="url(#gViolet)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </PanelSection>
        </>
      )}
    </ViewWrapper>
  );
}

function UptimeBar({ events, days }: { events: { status: string; started_at: number }[]; days: number }) {
  const now = Math.floor(Date.now() / 1000);
  const start = now - days * 86400;

  // Build segments
  const segments: { color: string; flex: number }[] = [];
  let cursor = start;

  for (let i = 0; i < events.length; i++) {
    const evt = events[i];
    const evtStart = Math.max(evt.started_at, start);
    const evtEnd = i + 1 < events.length ? events[i + 1].started_at : now;

    if (evtStart > cursor) {
      // Gap before this event — unknown/assume previous state
      segments.push({ color: 'var(--fog)', flex: evtStart - cursor });
    }
    segments.push({
      color: evt.status === 'online' ? 'var(--lime)' : 'var(--rust)',
      flex: Math.max(1, evtEnd - evtStart),
    });
    cursor = evtEnd;
  }

  if (cursor < now) {
    segments.push({ color: 'var(--fog)', flex: now - cursor });
  }

  const total = segments.reduce((s, seg) => s + seg.flex, 0);

  return (
    <>
      {segments.map((seg, i) => (
        <div
          key={i}
          style={{
            flex: seg.flex / total,
            background: seg.color,
            opacity: seg.color === 'var(--fog)' ? 0.2 : 0.75,
            minWidth: 1,
          }}
        />
      ))}
    </>
  );
}
