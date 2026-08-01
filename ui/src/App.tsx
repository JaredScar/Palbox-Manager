import { useState, useEffect, useCallback } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { authApi } from './api/client';
import { AuthProvider, useAuth } from './context/AuthContext';
import { InstanceProvider, useInstance } from './context/InstanceContext';
import { Sidebar } from './components/layout/Sidebar';
import { Titlebar } from './components/layout/Titlebar';
import { UpdateBanner } from './components/UpdateBanner';
import { SetupWizard } from './components/SetupWizard';
import { GlobalSearch } from './components/layout/GlobalSearch';
import { useUpdater } from './hooks/useUpdater';
import { Login } from './views/Login';
import { Dashboard } from './views/Dashboard';
import { Players } from './views/Players';
import { Bans } from './views/Bans';
import { Backups } from './views/Backups';
import SaveBrowser from './views/SaveBrowser';
import { Updates } from './views/Updates';
import { Metrics } from './views/Metrics';
import { Mods } from './views/Mods';
import { Console } from './views/Console';
import { Settings } from './views/Settings';
import { Audit } from './views/Audit';
import { Restarts } from './views/Restarts';
import { PublicStatus } from './views/PublicStatus';
import { Triggers } from './views/Triggers';
import { WorldMap } from './views/WorldMap';
import { UserManagement } from './views/UserManagement';
import Cluster from './views/Cluster';
import { NotificationBell } from './components/NotificationBell';

/** True when running inside the Electron desktop shell. */
const isElectron = !!window.palbox?.isElectron;
/**
 * True when served from the headless server package (no Electron, but accessed
 * via a browser — meaning the API can perform a self-update via PowerShell).
 */
const isServerMode = !isElectron && typeof window !== 'undefined';

function AppShell() {
  const { instances, active, setActiveId, reload } = useInstance();
  const updater = useUpdater();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const showWizard = instances.length === 0;

  // Ctrl+K / Cmd+K opens global search
  const openSearch = useCallback(() => setSearchOpen(true), []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openSearch(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [openSearch]);

  return (
    <div className="flex flex-col h-screen bg-void text-bone overflow-hidden">
      {showWizard && <SetupWizard onDone={() => reload()} />}
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
      <Titlebar isElectron={isElectron} onToggleMode={() => {}} />
      <UpdateBanner updater={updater} isElectron={isElectron} isServerMode={isServerMode} />

      {/* Mobile top bar */}
      <div className="lg:hidden flex items-center gap-3 px-4 py-3 border-b border-line bg-panel shrink-0">
        <button onClick={() => setMobileSidebarOpen(true)}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-panel-raised transition-colors">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5 text-fog">
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>
        <img src="/logo.png" alt="Palbox" className="w-6 h-6 rounded-lg object-cover" />
        <span className="font-display font-bold text-[15px]">Palbox</span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={openSearch}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-panel-raised transition-colors text-fog hover:text-bone">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="11" cy="11" r="8" /><path strokeLinecap="round" d="m21 21-4.35-4.35" />
            </svg>
          </button>
          {!isElectron && (
            <button onClick={updater.checkNow} disabled={updater.checking}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-panel-raised transition-colors text-fog hover:text-bone disabled:opacity-40"
              title="Check for updates">
              <svg className={`w-4 h-4 ${updater.checking ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
              </svg>
            </button>
          )}
          <NotificationBell />
        </div>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Mobile overlay */}
        {mobileSidebarOpen && (
          <div className="lg:hidden fixed inset-0 z-50 flex">
            <div className="absolute inset-0 bg-void/60 backdrop-blur-sm" onClick={() => setMobileSidebarOpen(false)} />
            <div className="relative z-10 h-full">
              <Sidebar instances={instances} active={active} setActiveId={setActiveId} isElectron={isElectron}
                onClose={() => setMobileSidebarOpen(false)} />
            </div>
          </div>
        )}
        {/* Desktop sidebar */}
        <div className="hidden lg:flex">
          <Sidebar instances={instances} active={active} setActiveId={setActiveId} isElectron={isElectron} />
        </div>

        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          {/* Desktop top bar — search + check updates + notifications */}
          <div className="hidden lg:flex items-center justify-end gap-2 px-5 py-2.5 border-b border-line bg-panel shrink-0">
            <button onClick={openSearch}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-panel-raised border border-line text-fog hover:text-bone hover:border-fog/40 transition-colors text-[12px]">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <circle cx="11" cy="11" r="8" /><path strokeLinecap="round" d="m21 21-4.35-4.35" />
              </svg>
              Search
              <kbd className="ml-1 font-mono text-[10px] opacity-60">Ctrl+K</kbd>
            </button>
            {/* Check for updates button — browser/server mode only (Electron handles it automatically) */}
            {!isElectron && (
              <button
                onClick={updater.checkNow}
                disabled={updater.checking}
                title="Check for panel updates"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-panel-raised border border-line text-fog hover:text-bone hover:border-fog/40 transition-colors text-[12px] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg
                  className={`w-3.5 h-3.5 ${updater.checking ? 'animate-spin' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
                </svg>
                {updater.checking ? 'Checking…' : 'Check updates'}
              </button>
            )}
            <NotificationBell />
          </div>
          <div className="flex-1 min-h-0 overflow-hidden relative">
          <Routes>
            <Route path="/"             element={<Dashboard />} />
            <Route path="/players"      element={<Players />} />
            <Route path="/bans"         element={<Bans />} />
            <Route path="/backups"      element={<Backups />} />
            <Route path="/savebrowser"  element={<SaveBrowser />} />
            <Route path="/updates"      element={<Updates />} />
            <Route path="/metrics"      element={<Metrics />} />
            <Route path="/mods"         element={<Mods />} />
            <Route path="/console"      element={<Console />} />
            <Route path="/restarts"     element={<Restarts />} />
            <Route path="/settings"     element={<Settings />} />
            <Route path="/audit"        element={<Audit />} />
            <Route path="/cluster"      element={<Cluster />} />
            <Route path="/triggers"     element={<Triggers />} />
            <Route path="/world"        element={<WorldMap />} />
            <Route path="/users"        element={<UserManagement />} />
            <Route path="*"             element={<Navigate to="/" replace />} />
          </Routes>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  // Public status page never requires auth — check path before anything else
  if (window.location.pathname === '/public') return <PublicStatus />;

  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    authApi.me()
      .then((r) => setAuthed(r.authenticated))
      .catch(() => setAuthed(false));
  }, []);

  if (authed === null) return (
    <div className="flex items-center justify-center h-screen bg-void text-fog font-mono text-[13px]">
      Loading…
    </div>
  );
  if (!authed) return <Login onLogin={() => setAuthed(true)} />;

  return (
    <AuthProvider>
      <InstanceProvider>
        <AppShell />
      </InstanceProvider>
    </AuthProvider>
  );
}
