import { useState, useEffect, useRef } from 'react';
import { AppNotification } from '../api/client';
import { useInstance } from '../context/InstanceContext';
import { cn } from '../lib/cn';

const LEVEL_COLOR: Record<string, string> = {
  info:    'text-aqua',
  warn:    'text-gold',
  error:   'text-rust',
  success: 'text-lime',
};
const LEVEL_DOT: Record<string, string> = {
  info:    'bg-aqua',
  warn:    'bg-gold',
  error:   'bg-rust',
  success: 'bg-lime',
};

function fmtTs(sec: number): string {
  const diff = Math.floor(Date.now() / 1000) - sec;
  if (diff < 60)   return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(sec * 1000).toLocaleDateString();
}

export function NotificationBell() {
  const { api, active } = useInstance();
  const [open, setOpen]         = useState(false);
  const [notifs, setNotifs]     = useState<AppNotification[]>([]);
  const [unread, setUnread]     = useState(0);
  const panelRef                = useRef<HTMLDivElement>(null);

  async function load() {
    if (!api) return;
    try {
      const [list, cnt] = await Promise.all([api.listNotifications(30), api.unreadCount()]);
      setNotifs(list);
      setUnread(cnt.count);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  // Listen for live WS notification events
  useEffect(() => {
    if (!active) return;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/ws?instance=${active.id}`);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as { type: string; notification?: AppNotification };
        if (msg.type === 'notification' && msg.notification) {
          setNotifs((prev) => [msg.notification!, ...prev].slice(0, 30));
          setUnread((c) => c + 1);
        }
      } catch { /* ignore */ }
    };
    return () => ws.close();
  }, [active?.id]);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  async function handleOpen() {
    setOpen((o) => !o);
    if (!open && unread > 0 && api) {
      await api.markAllRead().catch(() => {});
      setUnread(0);
      setNotifs((prev) => prev.map((n) => ({ ...n, read: 1 })));
    }
  }

  return (
    <div ref={panelRef} className="relative">
      <button
        onClick={handleOpen}
        className={cn(
          'relative flex items-center justify-center w-8 h-8 rounded-xl transition-colors',
          open ? 'bg-panel-raised text-bone' : 'text-fog hover:text-bone hover:bg-panel-raised',
        )}
        title="Notifications"
      >
        <BellIcon />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] flex items-center justify-center
            bg-rust text-[9px] font-bold text-white rounded-full px-0.5 leading-none">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] w-80 bg-panel border border-line rounded-2xl shadow-2xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-line">
            <span className="text-[12px] font-semibold uppercase tracking-wider text-fog">Notifications</span>
            {notifs.length > 0 && (
              <button onClick={async () => { await api?.markAllRead().catch(() => {}); setUnread(0); setNotifs((p) => p.map((n) => ({ ...n, read: 1 }))); }}
                className="text-[11px] text-fog/60 hover:text-fog transition-colors">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {notifs.length === 0 && (
              <div className="text-center text-fog text-[12px] py-8">No notifications yet</div>
            )}
            {notifs.map((n) => (
              <div key={n.id} className={cn('flex gap-3 px-4 py-3 border-b border-line/50 last:border-0 hover:bg-white/[0.02]', n.read === 0 && 'bg-white/[0.02]')}>
                <div className={cn('w-2 h-2 rounded-full mt-1.5 shrink-0', LEVEL_DOT[n.level] ?? 'bg-fog')} />
                <div className="flex-1 min-w-0">
                  <div className={cn('text-[12.5px] font-medium truncate', LEVEL_COLOR[n.level] ?? 'text-bone')}>
                    {n.title}
                  </div>
                  {n.body && <div className="text-[11.5px] text-fog mt-0.5 truncate">{n.body}</div>}
                  <div className="text-[10.5px] text-fog/50 mt-1 font-mono">{fmtTs(n.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BellIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 01-3.46 0"/>
    </svg>
  );
}
