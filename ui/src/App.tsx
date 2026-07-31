import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { authApi } from './api/client';
import { InstanceProvider, useInstance } from './context/InstanceContext';
import { Sidebar } from './components/layout/Sidebar';
import { Titlebar } from './components/layout/Titlebar';
import { UpdateBanner } from './components/UpdateBanner';
import { useUpdater } from './hooks/useUpdater';
import { Login } from './views/Login';
import { Dashboard } from './views/Dashboard';
import { Players } from './views/Players';
import { Backups } from './views/Backups';
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
  const { instances, active, setActiveId } = useInstance();
  const updater = useUpdater();

  return (
    <div className="flex flex-col h-screen bg-void text-bone overflow-hidden">
      <Titlebar isElectron={isElectron} onToggleMode={() => {}} />
      <UpdateBanner updater={updater} isElectron={isElectron} isServerMode={isServerMode} />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <Sidebar instances={instances} active={active} setActiveId={setActiveId} isElectron={isElectron} />
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden relative">
          {/* Notification bell — absolute top-right of content area */}
          <div className="absolute top-4 right-5 z-40">
            <NotificationBell />
          </div>
          <Routes>
            <Route path="/"         element={<Dashboard />} />
            <Route path="/players"  element={<Players />} />
            <Route path="/backups"  element={<Backups />} />
            <Route path="/updates"  element={<Updates />} />
            <Route path="/metrics"  element={<Metrics />} />
            <Route path="/mods"     element={<Mods />} />
            <Route path="/console"  element={<Console />} />
            <Route path="/restarts" element={<Restarts />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/audit"    element={<Audit />} />
            <Route path="/cluster"  element={<Cluster />} />
            <Route path="/triggers" element={<Triggers />} />
            <Route path="/world"    element={<WorldMap />} />
            <Route path="*"         element={<Navigate to="/" replace />} />
          </Routes>
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
    <InstanceProvider>
      <AppShell />
    </InstanceProvider>
  );
}
