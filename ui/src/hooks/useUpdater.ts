import { useState, useEffect, useRef } from 'react';

export type UpdatePhase =
  | 'idle'
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
  dismiss:    () => void;
  install:    () => void;          // Electron: quit & install
  applyServerUpdate: () => void;   // Browser/server: trigger self-update via API
}

const GITHUB_RELEASES = 'https://github.com/JaredScar/Palbox-Manager/releases/latest';

export function useUpdater(): UpdateState {
  const [phase,      setPhase]      = useState<UpdatePhase>('idle');
  const [version,    setVersion]    = useState<string | null>(null);
  const [percent,    setPercent]    = useState(0);
  const [releaseUrl, setReleaseUrl] = useState(GITHUB_RELEASES);
  const [error,      setError]      = useState<string | null>(null);

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
      // ── Browser / headless mode: poll the API ─────────────────────────────
      const check = async () => {
        if (dismissed.current) return;
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
          }
        } catch { /* offline */ }
      };

      check();
      const id = setInterval(check, 6 * 60 * 60 * 1000);
      return () => clearInterval(id);
    }
  }, []);

  return { phase, version, percent, releaseUrl, error, dismiss, install, applyServerUpdate };
}
