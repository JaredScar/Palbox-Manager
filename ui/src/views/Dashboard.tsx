import { useState, useEffect, useCallback } from 'react';
import { ServerStatus, MetricPoint, WorldInfo, MaintenanceState } from '../api/client';
import { useInstance } from '../context/InstanceContext';
import { Button } from '../components/ui/Button';
import { ViewWrapper } from '../components/layout/ViewWrapper';
import { PanelSection } from '../components/ui/PanelSection';
import { IconButton } from '../components/ui/IconButton';
import { cn } from '../lib/cn';

function fmtUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h.toString().padStart(2, '0')}h ${m.toString().padStart(2, '0')}m`;
  return `${h.toString().padStart(2, '0')}h ${m.toString().padStart(2, '0')}m`;
}
function fmtMem(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return <svg className="w-full h-16" />;
  const w = 260; const h = 64;
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / max) * (h - 4) - 2}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-16 block">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} />
    </svg>
  );
}

const AVATAR_COLORS = ['#ff5d73', '#2fd9e8', '#b27cf2'];

export function Dashboard() {
  const { api, active } = useInstance();
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [metrics, setMetrics] = useState<MetricPoint[]>([]);
  const [world, setWorld] = useState<WorldInfo | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenanceState | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [showMaintenance, setShowMaintenance] = useState(false);
  const [maintMsg, setMaintMsg] = useState('Server is entering maintenance mode.');
  const [maintMins, setMaintMins] = useState(5);

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      const [s, m, w, maint] = await Promise.all([
        api.status(),
        api.metrics(24),
        api.worldInfo(),
        api.maintenanceStatus().catch(() => null),
      ]);
      setStatus(s); setMetrics(m); setWorld(w); setMaintenance(maint);
    } catch {}
    setLoading(false);
  }, [api]);

  useEffect(() => {
    setLoading(true);
    refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, [refresh]);

  async function doAction(action: 'start' | 'stop' | 'restart' | 'save') {
    if (!api) return;
    setActionPending(action);
    try { await api[action](); await refresh(); }
    catch (e) { alert((e as Error).message); }
    setActionPending(null);
  }

  async function toggleMaintenance() {
    if (!api) return;
    if (maintenance?.active) {
      setActionPending('maintenance');
      try { await api.disableMaintenance(); await refresh(); }
      catch (e) { alert((e as Error).message); }
      setActionPending(null);
      setShowMaintenance(false);
    } else {
      setShowMaintenance((s) => !s);
    }
  }

  async function startMaintenance() {
    if (!api) return;
    setActionPending('maintenance');
    try { await api.enableMaintenance(maintMsg, maintMins); await refresh(); setShowMaintenance(false); }
    catch (e) { alert((e as Error).message); }
    setActionPending(null);
  }

  const online = status?.status === 'online';
  const playerData = metrics.map((m) => m.players);
  const cpuData = metrics.map((m) => m.cpu_pct);

  const METRIC_CELLS = [
    { key: 'Players',  val: String(status?.players.length ?? 0), color: '#2fd9e8' },
    { key: 'Memory',   val: fmtMem(status?.memMb ?? 0),          color: '#b27cf2' },
    { key: 'CPU',      val: `${(status?.cpuPct ?? 0).toFixed(0)}%`, color: '#ff9d3d' },
  ];
  return (
    <ViewWrapper
      eyebrow="Server status"
      title={active?.name ?? 'Palworld Server'}
      description={status ? `${online ? 'Running' : 'Offline'} · ${status.uptime ? `Up ${fmtUptime(status.uptime)}` : '–'}` : undefined}
      accentVar="var(--crimson)"
      actions={
        <>
          <span className={cn(
            'inline-flex items-center gap-2 px-3 py-1.5 rounded-full font-mono text-[11px] border',
            online
              ? 'bg-lime/10 border-lime/35 text-lime'
              : 'bg-fog/10 border-fog/35 text-fog',
          )}>
            <span className="w-1.5 h-1.5 rounded-full bg-current" />
            Watchdog {status?.watchdogArmed ? 'armed' : 'off'}
          </span>
          <Button variant="ghost" loading={actionPending === 'restart'} onClick={() => doAction('restart')} disabled={!!actionPending}>
            Restart
          </Button>
          <Button
            variant={maintenance?.active ? 'primary' : 'ghost'}
            onClick={toggleMaintenance}
            disabled={!!actionPending}
            loading={actionPending === 'maintenance'}
          >
            {maintenance?.active ? 'End maintenance' : 'Maintenance'}
          </Button>
          <Button variant="danger" loading={actionPending === 'stop'} onClick={() => doAction('stop')} disabled={!!actionPending || !online}>
            Stop server
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="text-fog text-[14px] py-10">Loading…</div>
      ) : (
        <>
          {/* ── Maintenance mode ─────────────────────────────────────── */}
          {(maintenance?.active || showMaintenance) && (
            <div className={cn(
              'rounded-2xl border p-5 mb-4',
              maintenance?.active
                ? 'bg-ember/5 border-ember/30'
                : 'bg-panel border border-line',
            )}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-lg bg-ember/20 flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4 text-ember" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-sm text-ember">Maintenance mode {maintenance?.active ? 'active' : ''}</p>
                  {maintenance?.active && maintenance.message && (
                    <p className="text-xs text-fog mt-0.5">{maintenance.message}</p>
                  )}
                </div>
                <Button variant="ghost" className="ml-auto" onClick={toggleMaintenance}>
                  {maintenance?.active ? 'Disable' : 'Cancel'}
                </Button>
              </div>

              {!maintenance?.active && showMaintenance && (
                <div className="flex flex-col gap-3">
                  <input
                    value={maintMsg} onChange={(e) => setMaintMsg(e.target.value)}
                    placeholder="Broadcast message to players…"
                    className="w-full"
                  />
                  <div className="flex items-center gap-3">
                    <label className="text-xs text-fog shrink-0">Countdown</label>
                    <select value={maintMins} onChange={(e) => setMaintMins(Number(e.target.value))} className="flex-1">
                      {[0, 1, 2, 5, 10, 15].map((m) => (
                        <option key={m} value={m}>{m === 0 ? 'No countdown' : `${m} min warning`}</option>
                      ))}
                    </select>
                    <Button variant="primary" loading={actionPending === 'maintenance'} onClick={startMaintenance}>
                      Enable
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Status bar (full-width horizontal) ───────────────────────── */}
          <div className="bg-panel border border-line rounded-2xl p-5 flex items-center gap-5 mb-4 relative overflow-hidden">
            {/* Background glow */}
            <div
              className="absolute -top-6 -left-6 w-[200px] h-[200px] rounded-full blur-[60px] opacity-[0.12] pointer-events-none transition-colors duration-700"
              style={{ background: online ? 'var(--lime)' : 'var(--rust)' }}
            />

            {/* Status sphere */}
            <div className="relative w-[88px] h-[88px] shrink-0">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                <circle className="fill-none stroke-[7]" cx="60" cy="60" r="50"
                  style={{ stroke: online ? 'rgba(124,230,102,0.13)' : 'rgba(255,92,92,0.13)' }} />
                <circle
                  className="fill-none stroke-[7] [stroke-linecap:round] [stroke-dasharray:314] [stroke-dashoffset:17]"
                  cx="60" cy="60" r="50"
                  style={{ stroke: online ? 'var(--lime)' : 'var(--rust)' }}
                />
              </svg>
              <div className="absolute inset-[12px] rounded-full flex flex-col items-center justify-center"
                style={{ background: 'radial-gradient(circle at 35% 35%, #2e2548, #1c1832)' }}>
                <div className="text-[10px] font-display font-bold tracking-widest"
                  style={{ color: online ? 'var(--lime)' : 'var(--rust)' }}>
                  {(status?.status ?? 'offline').toUpperCase()}
                </div>
              </div>
            </div>

            {/* Vertical rule */}
            <div className="w-px self-stretch bg-line/50 shrink-0" />

            {/* Server info + quick actions */}
            <div className="flex-1 min-w-0">
              <div className="font-display font-bold text-[17px] text-bone leading-tight">
                {active?.name ?? 'Palworld Server'}
              </div>
              <div className="font-mono text-[11.5px] text-fog mt-0.5">
                <span className={cn('mr-1.5', online ? 'text-lime' : 'text-rust')}>●</span>
                {status?.players.length ?? 0} players online
                <span className="mx-2 text-line">·</span>
                port {active?.game_port ?? '–'}
                {status?.uptime ? (
                  <>
                    <span className="mx-2 text-line">·</span>
                    up {fmtUptime(status.uptime)}
                  </>
                ) : null}
              </div>
              <div className="flex gap-2 mt-3 flex-wrap">
                <Button variant="lime" loading={actionPending === 'save'} onClick={() => doAction('save')} disabled={!!actionPending || !online}>
                  Save world
                </Button>
                {!online ? (
                  <Button variant="ghost" loading={actionPending === 'start'} onClick={() => doAction('start')} disabled={!!actionPending}>
                    Start server
                  </Button>
                ) : (
                  <Button variant="ghost" className="text-rust/70 border-rust/20 hover:text-rust hover:border-rust/40"
                    loading={actionPending === 'stop'} onClick={() => doAction('stop')} disabled={!!actionPending}>
                    Stop server
                  </Button>
                )}
              </div>
            </div>

            {/* Vertical rule */}
            <div className="w-px self-stretch bg-line/50 shrink-0" />

            {/* Live metric tiles */}
            <div className="flex gap-3 shrink-0">
              {METRIC_CELLS.map(({ key, val, color }) => (
                <div key={key} className="relative w-[128px] bg-panel-raised rounded-xl px-4 py-3 overflow-hidden border border-line/50">
                  <div className="absolute inset-x-0 top-0 h-[2px] rounded-t-xl" style={{ background: color }} />
                  <div className="text-[9.5px] uppercase tracking-[0.1em] text-fog mb-1.5">{key}</div>
                  <div className="font-mono text-[21px] font-semibold leading-none" style={{ color }}>{val}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Online now ──────────────────────────────────────────────────── */}
          <div className="bg-panel border border-line rounded-2xl px-5 py-4 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="text-[10px] uppercase tracking-[0.1em] text-fog font-semibold">Online now</div>
              <div className={cn(
                'ml-auto flex items-center gap-1.5 font-mono text-[10.5px] px-2.5 py-0.5 rounded-full border',
                online ? 'bg-lime/10 border-lime/30 text-lime' : 'bg-fog/10 border-fog/25 text-fog',
              )}>
                <span className={cn('w-1.5 h-1.5 rounded-full', online && 'animate-[pulse-dot_1.8s_ease-in-out_infinite]')}
                  style={{ background: 'currentColor' }} />
                {online ? 'live' : 'paused'}
              </div>
            </div>
            {(status?.players.length ?? 0) === 0 ? (
              <div className="text-[12.5px] text-fog/50 py-2">No players online</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {status?.players.map((p, i) => (
                  <div key={p.steamId || i} className="flex items-center gap-2 pl-2 pr-1.5 py-1.5 bg-panel-raised rounded-xl border border-line/50 text-[12.5px]">
                    <span className="w-5 h-5 rounded-md shrink-0 flex items-center justify-center text-[9px] font-bold text-void"
                      style={{ background: AVATAR_COLORS[i % 3] }}>
                      {p.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="text-bone">{p.name}</span>
                    <IconButton label="Kick" onClick={() => api?.kickPlayer(p.steamId)}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M18 6L6 18M6 6l12 12" /></svg>
                    </IconButton>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Performance charts ───────────────────────────────────────── */}
          <PanelSection title="Performance, last 24h">
            <div className="grid grid-cols-2 gap-5">
              {[
                { label: 'Players online', data: playerData, color: '#2fd9e8' },
                { label: 'CPU load',       data: cpuData,    color: '#ff9d3d' },
              ].map(({ label, data, color }) => (
                <div key={label}>
                  <div className="text-[10px] uppercase tracking-[0.1em] text-fog mb-2 flex items-center gap-1.5 font-semibold">
                    <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: color }} />
                    {label}
                  </div>
                  <Sparkline data={data} color={color} />
                </div>
              ))}
            </div>
          </PanelSection>

          {/* ── Backups ──────────────────────────────────────────────────── */}
          <PanelSection title="Backups" description="Nightly auto-backup with a 7-day rolling window.">
            <div className="flex gap-2.5">
              <Button variant="gold" onClick={() => api?.createBackup()}>Back up now</Button>
              <Button variant="ghost" onClick={() => window.location.assign('/backups')}>View all backups →</Button>
            </div>
          </PanelSection>

          {/* ── World overview ────────────────────────────────────────────── */}
          {world && Object.keys(world).length > 0 && (
            <PanelSection title="World overview">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {[
                  { label: 'Server name',    val: world.serverName || '–' },
                  { label: 'Max players',    val: String(world.maxPlayers) },
                  { label: 'Mode',           val: world.isPvP ? 'PvP' : 'PvE' },
                  { label: 'Difficulty',     val: world.difficulty || 'None' },
                  { label: 'EXP rate',       val: `×${world.expRate?.toFixed(2)}` },
                  { label: 'Pal capture',    val: `×${world.palCaptureRate?.toFixed(2)}` },
                  { label: 'Work speed',     val: `×${world.workSpeedRate?.toFixed(2)}` },
                  { label: 'Death penalty',  val: world.deathPenalty || '–' },
                  { label: 'Day speed',      val: `×${world.dayTimeSpeedRate?.toFixed(2)}` },
                  { label: 'Night speed',    val: `×${world.nightTimeSpeedRate?.toFixed(2)}` },
                  { label: 'Guild max',      val: String(world.guildPlayerMaxNum) },
                  { label: 'RCON enabled',   val: world.rconEnabled ? 'Yes' : 'No' },
                ].map(({ label, val }) => (
                  <div key={label} className="bg-panel-raised rounded-xl px-3 py-2.5 border border-line/50">
                    <div className="text-[9.5px] uppercase tracking-[0.1em] text-fog mb-1">{label}</div>
                    <div className="text-[13px] font-medium text-bone truncate">{val}</div>
                  </div>
                ))}
              </div>
              {world.serverDescription && (
                <p className="text-[12.5px] text-fog mt-3 leading-relaxed">{world.serverDescription}</p>
              )}
            </PanelSection>
          )}
        </>
      )}
    </ViewWrapper>
  );
}
