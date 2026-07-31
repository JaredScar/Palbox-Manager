import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '../../lib/cn';
import { Instance } from '../../api/client';

const NAV = [
  { path: '/',          label: 'Dashboard', accent: '#ff5d73', icon: <DashIcon /> },
  { path: '/players',   label: 'Players',   accent: '#ff9d3d', icon: <PlayersIcon /> },
  { path: '/backups',   label: 'Backups',   accent: '#ffd447', icon: <BackupsIcon /> },
  { path: '/updates',   label: 'Updates',   accent: '#b27cf2', icon: <UpdatesIcon /> },
  { path: '/restarts',  label: 'Restarts',  accent: '#f97316', icon: <RestartsIcon /> },
  { path: '/metrics',   label: 'Metrics',   accent: '#2fd9e8', icon: <MetricsIcon /> },
  { path: '/triggers',  label: 'Triggers',  accent: '#f43f5e', icon: <TriggersIcon /> },
  { path: '/world',     label: 'World Map', accent: '#22d3ee', icon: <WorldIcon /> },
  { path: '/mods',      label: 'Mods',      accent: '#3fd8b4', icon: <ModsIcon /> },
  { path: '/console',   label: 'Console',   accent: '#7ce666', icon: <ConsoleIcon /> },
  { path: '/cluster',   label: 'Cluster',   accent: '#ff9d3d', icon: <ClusterIcon /> },
  { path: '/audit',     label: 'Audit log', accent: '#a79fc7', icon: <AuditIcon /> },
  { path: '/settings',  label: 'Settings',  accent: '#a79fc7', icon: <SettingsIcon /> },
];

interface SidebarProps {
  instances: Instance[];
  active: Instance | null;
  setActiveId: (id: number) => void;
  isElectron?: boolean;
}

export function Sidebar({ instances, active, setActiveId, isElectron }: SidebarProps) {
  const [open, setOpen] = useState(false);

  return (
    <aside className="w-[240px] shrink-0 bg-panel border-r border-line flex flex-col px-3.5 py-5 h-full overflow-hidden">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-2 pb-5 mb-4 border-b border-line">
        <img src="/logo.png" alt="Palbox" className="w-9 h-9 rounded-xl object-cover shrink-0" />
        <div className="leading-tight">
          <div className="text-[15px] font-display font-bold tracking-tight">Palbox</div>
          <div className="text-[11px] text-fog font-mono">palworld ops panel</div>
        </div>
      </div>

      {/* Server picker */}
      <div
        className="relative bg-panel-raised border border-line/70 rounded-xl px-3 py-2.5 mb-4 cursor-pointer hover:border-fog/40 transition-colors duration-150"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="text-[10px] uppercase tracking-[0.08em] text-fog mb-1">Active server</div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-mono text-[12.5px] text-bone truncate">
            <span className="w-[7px] h-[7px] rounded-full bg-lime shrink-0" />
            <span className="truncate">{active?.name ?? '–'} · :{active?.game_port ?? '–'}</span>
          </div>
          <svg
            className={cn('w-3 h-3 text-fog shrink-0 transition-transform duration-150', open && 'rotate-180')}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
        {instances.length > 1 && (
          <div className="text-[10px] text-fog mt-1">{instances.length} servers configured</div>
        )}

        {open && (
          <div
            className="absolute left-0 right-0 top-[calc(100%+4px)] bg-panel-raised border border-line rounded-xl overflow-hidden z-50 flex flex-col shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {instances.map((inst) => (
              <button
                key={inst.id}
                onClick={() => { setActiveId(inst.id); setOpen(false); }}
                className={cn(
                  'flex items-center gap-2 px-3 py-2.5 font-mono text-[12.5px] text-left w-full transition-colors duration-100',
                  inst.id === active?.id
                    ? 'text-lime bg-lime/5'
                    : 'text-fog hover:text-bone hover:bg-white/5',
                )}
              >
                <span className="w-[7px] h-[7px] rounded-full bg-current shrink-0" />
                {inst.name} · :{inst.game_port}
              </button>
            ))}
            <NavLink
              to="/settings#instances"
              onClick={() => setOpen(false)}
              className="block px-3 py-2.5 text-[11.5px] text-fog hover:text-bone border-t border-line hover:bg-white/4 transition-colors"
            >
              + Add server
            </NavLink>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-0.5">
        {NAV.map(({ path, label, accent, icon }) => (
          <NavLink
            key={path}
            to={path}
            end={path === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13.5px] font-medium',
                'transition-all duration-150',
                '[&_svg]:w-4 [&_svg]:h-4 [&_svg]:shrink-0 [&_svg]:transition-opacity',
                isActive
                  ? '[&_svg]:opacity-100 font-semibold'
                  : 'text-fog hover:text-bone hover:bg-panel-raised [&_svg]:opacity-60',
              )
            }
            style={({ isActive }) =>
              isActive
                ? {
                    color: accent,
                    background: `color-mix(in srgb, ${accent} 11%, transparent)`,
                    boxShadow: `inset 3px 0 0 ${accent}`,
                  }
                : undefined
            }
          >
            {icon}
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="mt-auto pt-4 border-t border-line flex justify-between font-mono text-[11px] text-fog">
        <span>v0.1.0</span>
        <span>{isElectron ? 'Desktop' : 'Browser'}</span>
      </div>
    </aside>
  );
}

/* ── Icons ─────────────────────────────────────────────────────────────────── */
function DashIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>; }
function PlayersIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>; }
function BackupsIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5"/><path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/></svg>; }
function UpdatesIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M21 12a9 9 0 1 1-3.3-6.95"/><path d="M21 3v6h-6"/></svg>; }
function MetricsIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>; }
function ModsIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 2l2.5 5 5.5.8-4 3.9.9 5.4-4.9-2.6-4.9 2.6.9-5.4-4-3.9 5.5-.8z"/></svg>; }
function ConsoleIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M4 17l6-5-6-5"/><path d="M12 19h8"/></svg>; }
function RestartsIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="9"/><polyline points="12 6 12 12 16 14"/></svg>; }
function AuditIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M9 12h6M9 16h6M9 8h6"/><path d="M5 3h14a2 2 0 012 2v16a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z"/></svg>; }
function ClusterIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="2" y="3" width="8" height="5" rx="1.5"/><rect x="14" y="3" width="8" height="5" rx="1.5"/><rect x="2" y="16" width="8" height="5" rx="1.5"/><rect x="14" y="16" width="8" height="5" rx="1.5"/><path d="M6 8v3M18 8v3M6 16v-3M18 16v-3M6 11h12"/></svg>; }
function SettingsIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>; }
function TriggersIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>; }
function WorldIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3a14.5 14.5 0 010 18M12 3a14.5 14.5 0 000 18"/></svg>; }
