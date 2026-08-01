import { useState, useEffect, useRef, useCallback } from 'react';

export type UpdatePhase =
  | 'idle'
  | 'checking'     // manual check in progress
  | 'up_to_date'   // checked — already on latest
  | 'available'    // update found
  | 'downloading'  // Electron only
  | 'ready'        // Electron only — downloaded, waiting for restart
  | 'applying'     // server mode — update triggered, service restarting
  | 'error';

export interface UpdateState {
  phase:      UpdatePhase;
  version:    string | null;
  percent:    number;
  releaseUrl: string;
  error:      string | null;
  checking:   boolean;
  dismiss:    () => void;
  checkNow:   () => void;          // Manual trigger
  install:    () => void;          // Electron: quit & install
  applyServerUpdate: () => void;   // Browser/server: trigger self-update via API
}

const GITHUB_RELEASES = 'https://github.com/JaredScar/Palbox-Manager/releases/latest';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export function useUpdater(): UpdateState {
  const [phase,      setPhase]      = useState<UpdatePhase>('idle');
  const [version,    setVersion]    = useState<string | null>(null);
  const [percent,    setPercent]    = useState(0);
  const [releaseUrl, setReleaseUrl] = useState(GITHUB_RELEASES);
  const [error,      setError]      = useState<string | null>(null);
  const [checking,   setChecking]   = useState(false);

  const dismissed = useRef(false);

  const dismiss = () => {
    dismissed.current = true;
    setPhase('idle');
  };

  const install = () => window.palbox?.installUpdate();

  const applyServerUpdate = async () => {
    setPhase('applying');
    try {
      const res = await fetch('/api/app-version/update', { method: 'POST', credentials: 'include' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
        throw new Error(body.error ?? res.statusText);
      }
    } catch (e) {
      setError((e as Error).message);
      setPhase('error');
    }
  };

  // Shared check function used by both auto-poll and manual button
  const runCheck = useCallback(async (manual = false) => {
    if (manual) { setChecking(true); dismissed.current = false; }
    try {
      const res  = await fetch('/api/app-version', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json() as {
        updateAvailable: boolean; latest: string; releaseUrl: string;
      };
      if (data.updateAvailable) {
        setVersion(data.latest);
        setReleaseUrl(data.releaseUrl ?? GITHUB_RELEASES);
        setPhase('available');
      } else if (manual) {
        setPhase('up_to_date');
        // Auto-clear "up to date" after 4 seconds
        setTimeout(() => setPhase((p) => p === 'up_to_date' ? 'idle' : p), 4000);
      }
    } catch { /* offline */ }
    finally { if (manual) setChecking(false); }
  }, []);

  const checkNow = useCallback(() => { runCheck(true); }, [runCheck]);

  useEffect(() => {
    const palbox = window.palbox;

    if (palbox) {
      // ── Electron mode ─────────────────────────────────────────────────────
      const offAvailable  = palbox.onUpdateAvailable((info) => {
        if (dismissed.current) return;
        setVersion(info.version);
        setPhase('available');
      });
      const offProgress   = palbox.onUpdateProgress((p) => {
        if (dismissed.current) return;
        setPercent(p.percent);
        setPhase('downloading');
      });
      const offDownloaded = palbox.onUpdateDownloaded((info) => {
        setVersion(info.version);
        setPhase('ready');
        dismissed.current = false;
      });
      const offError = palbox.onUpdateError((msg) => {
        setError(msg);
        setPhase('error');
      });
      return () => { offAvailable(); offProgress(); offDownloaded(); offError(); };
    } else {
      // ── Browser / headless mode: poll every 5 minutes ─────────────────────
      runCheck();
      const id = setInterval(() => {
        if (!dismissed.current) runCheck();
      }, POLL_INTERVAL_MS);
      return () => clearInterval(id);
    }
  }, [runCheck]);

  return { phase, version, percent, releaseUrl, error, checking, dismiss, checkNow, install, applyServerUpdate };
}
