import { useState, useEffect, useRef } from 'react';

export type UpdatePhase =
  | 'idle'
  | 'available'     // update found, downloading (Electron) or link shown (browser)
  | 'downloading'   // Electron only — download in progress
  | 'ready'         // Electron only — downloaded, ready to install
  | 'error';

export interface UpdateState {
  phase:      UpdatePhase;
  version:    string | null;
  percent:    number;            // 0–100, meaningful only during 'downloading'
  releaseUrl: string;
  error:      string | null;
  dismiss:    () => void;
  install:    () => void;        // Electron only — quits and installs
}

const GITHUB_RELEASES = 'https://github.com/JaredScar/Palbox-Manager/releases/latest';

/** Works in both Electron (via contextBridge IPC) and plain browser (via API polling). */
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

  const install = () => {
    window.palbox?.installUpdate();
  };

  useEffect(() => {
    const palbox = window.palbox;

    if (palbox) {
      // ── Electron mode: subscribe to IPC events ──────────────────────────
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
        dismissed.current = false; // always show the "restart" prompt
      });
      const offError      = palbox.onUpdateError((msg) => {
        setError(msg);
        setPhase('error');
      });

      return () => {
        offAvailable();
        offProgress();
        offDownloaded();
        offError();
      };
    } else {
      // ── Browser / headless mode: poll the API ───────────────────────────
      const check = async () => {
        if (dismissed.current) return;
        try {
          const res  = await fetch('/api/app-version');
          if (!res.ok) return;
          const data = await res.json() as {
            updateAvailable: boolean;
            latest: string;
            releaseUrl: string;
          };
          if (data.updateAvailable) {
            setVersion(data.latest);
            setReleaseUrl(data.releaseUrl ?? GITHUB_RELEASES);
            setPhase('available');
          }
        } catch { /* network unavailable — ignore */ }
      };

      check();
      const id = setInterval(check, 6 * 60 * 60 * 1000); // recheck every 6 h
      return () => clearInterval(id);
    }
  }, []);

  return { phase, version, percent, releaseUrl, error, dismiss, install };
}
