import { useState, useEffect } from 'react';
import { AuditEntry } from '../api/client';
import { useInstance } from '../context/InstanceContext';
import { ViewWrapper } from '../components/layout/ViewWrapper';
import { PanelSection } from '../components/ui/PanelSection';
import { cn } from '../lib/cn';

const ACTION_COLORS: Record<string, string> = {
  'server.start':   'text-lime',
  'server.stop':    'text-rust',
  'server.restart': 'text-ember',
  'server.save':    'text-teal',
  'backup.create':  'text-gold',
  'backup.delete':  'text-rust',
  'backup.restore': 'text-ember',
  'rcon':           'text-aqua',
  'macro.run':      'text-violet',
  'macro.create':   'text-violet',
  'macro.delete':   'text-fog',
  'alert.create':   'text-crimson',
  'alert.delete':   'text-fog',
  'broadcast.create': 'text-teal',
};

function actionColor(action: string): string {
  return ACTION_COLORS[action] ?? 'text-bone-dim';
}

function actionIcon(action: string): string {
  if (action.startsWith('server.')) return '⚡';
  if (action.startsWith('backup.')) return '💾';
  if (action.startsWith('rcon'))    return '>';
  if (action.startsWith('macro'))   return '▶';
  if (action.startsWith('alert'))   return '🔔';
  if (action.startsWith('broadcast')) return '📢';
  return '·';
}

function fmtTs(ts: number) {
  return new Date(ts * 1000).toLocaleString();
}

export function Audit() {
  const { api } = useInstance();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!api) return;
    api.auditLog(300).then(setEntries).catch(() => {}).finally(() => setLoading(false));
  }, [api]);

  const filtered = filter
    ? entries.filter((e) => e.action.includes(filter) || e.detail.includes(filter) || e.actor.includes(filter))
    : entries;

  return (
    <ViewWrapper
      eyebrow="Audit"
      title="Audit log"
      description="Every admin action recorded — server controls, backups, RCON commands, and configuration changes."
      accentVar="var(--fog)"
    >
      <PanelSection noPad>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-line/50">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-fog shrink-0"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          <input
            placeholder="Filter by action, detail, or actor…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="flex-1 border-0 bg-transparent px-0 py-0 text-[13px] focus:outline-none focus:ring-0 focus:border-0 placeholder:text-fog/40"
          />
          {entries.length > 0 && (
            <span className="font-mono text-[11px] text-fog shrink-0">{filtered.length} / {entries.length}</span>
          )}
        </div>

        <div className="max-h-[calc(100vh-320px)] overflow-y-auto">
          {loading && (
            <div className="text-fog text-[13px] px-4 py-8 text-center">Loading…</div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="text-fog/50 text-[13px] px-4 py-8 text-center">
              {filter ? 'No matching entries.' : 'No audit entries yet. Actions will appear here as you use the panel.'}
            </div>
          )}
          {filtered.map((e) => (
            <div key={e.id} className="flex items-start gap-3 px-4 py-3 border-b border-line/40 last:border-b-0 hover:bg-white/[0.02] transition-colors">
              <span className="font-mono text-[13px] shrink-0 mt-0.5">{actionIcon(e.action)}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn('font-mono text-[12.5px] font-medium', actionColor(e.action))}>{e.action}</span>
                  {e.detail && (
                    <span className="text-[12px] text-fog/80 truncate max-w-[340px]">{e.detail}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[11px] text-fog/60 font-mono">{fmtTs(e.created_at)}</span>
                  <span className="text-[11px] text-fog/40">·</span>
                  <span className="text-[11px] text-fog/60">{e.actor}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </PanelSection>
    </ViewWrapper>
  );
}
