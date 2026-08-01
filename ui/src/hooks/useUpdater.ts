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

export const UPDATE_POLL_OPTIONS = [
  { label: '1 minute',  value: 1  },
  { label: '5 minutes', value: 5  },
  { label: '15 minutes',value: 15 },
  { label: '30 minutes',value: 30 },
  { label: '1 hour',    value: 60 },
  { label: '6 hours',   value: 360 },
] as const;

export const UPDATE_POLL_KEY = 'palbox_update_poll_minutes';
const DEFAULT_POLL_MINUTES = 5;

function getPollMs(): number {
  const stored = parseInt(localStorage.getItem(UPDATE_POLL_KEY) ?? '', 10);
  const minutes = Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_POLL_MINUTES;
  return minutes * 60 * 1000;
}

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
      const body = await res.json().catch(() => ({ error: res.statusText })) as {
        error?: string; message?: string; logFile?: string;
      };
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      // Success — panel will go offline shortly; nothing more to do on the client
    } catch (e) {
      setError((e as Error).message);
      setPhase('error');
    }
  };

  // Shared check function used by both auto-poll and manual button.
  // When manual=true, ?force=true bypasses the server-side 1-hour cache so
  // the user always gets a live result from GitHub when they click the button.
  const runCheck = useCallback(async (manual = false) => {
    if (manual) { setChecking(true); dismissed.current = false; }
    try {
      const url = manual ? '/api/app-version?force=true' : '/api/app-version';
      const res  = await fetch(url, { credentials: 'include' });
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
      // ── Browser / headless mode: configurable poll interval ────────────────
      runCheck();

      let id = setInterval(() => {
        if (!dismissed.current) runCheck();
      }, getPollMs());

      // Re-create the interval whenever the user changes the setting
      const onStorage = (e: StorageEvent) => {
        if (e.key !== UPDATE_POLL_KEY) return;
        clearInterval(id);
        id = setInterval(() => {
          if (!dismissed.current) runCheck();
        }, getPollMs());
      };
      window.addEventListener('storage', onStorage);

      return () => { clearInterval(id); window.removeEventListener('storage', onStorage); };
    }
  }, [runCheck]);

  return { phase, version, percent, releaseUrl, error, checking, dismiss, checkNow, install, applyServerUpdate };
}
