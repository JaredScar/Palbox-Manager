import type { UpdateState } from '../hooks/useUpdater';

interface Props {
  updater: UpdateState;
  isElectron: boolean;
  isServerMode?: boolean; // headless server package — can self-update
}

export function UpdateBanner({ updater, isElectron, isServerMode }: Props) {
  const { phase, version, percent, releaseUrl, error, dismiss, install, applyServerUpdate } = updater;

  if (phase === 'idle' || phase === 'checking') return null;

  // ── Up to date ────────────────────────────────────────────────────────────
  if (phase === 'up_to_date') {
    return (
      <div className="relative flex items-center gap-3 px-4 py-2 text-[12.5px] font-medium shrink-0 border-b border-line/60 bg-[#7ce666]/10 text-[#7ce666]">
        <CheckCircleIcon />
        <span>Palbox is up to date.</span>
        <button onClick={dismiss} className="ml-auto text-[#7ce666]/50 hover:text-[#7ce666] transition-colors">
          <XIcon />
        </button>
      </div>
    );
  }

  const base =
    'relative flex items-center gap-3 px-4 py-2.5 text-[12.5px] font-medium shrink-0 ' +
    'border-b border-line/60 transition-all';

  // ── Error ─────────────────────────────────────────────────────────────────
  if (phase === 'error') {
    return (
      <div className={`${base} bg-rust/10 text-rust`}>
        <AlertIcon />
        <span>Auto-update error: {error}</span>
        <button onClick={dismiss} className="ml-auto text-rust/60 hover:text-rust transition-colors">
          <XIcon />
        </button>
      </div>
    );
  }

  // ── Ready to install (Electron only) ─────────────────────────────────────
  if (phase === 'ready') {
    return (
      <div className={`${base} bg-lime/10 text-lime`}>
        <CheckCircleIcon />
        <span>
          Palbox <strong>v{version}</strong> downloaded and ready to install.
        </span>
        <button
          onClick={install}
          className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded-md bg-lime text-void text-[11px] font-bold hover:bg-lime/90 transition-colors"
        >
          <DownloadIcon />
          Restart &amp; Install
        </button>
        <button onClick={dismiss} className="text-lime/50 hover:text-lime transition-colors ml-1">
          <XIcon />
        </button>
      </div>
    );
  }

  // ── Downloading (Electron only) ───────────────────────────────────────────
  if (phase === 'downloading') {
    return (
      <div className={`${base} bg-accent/10 text-accent`}>
        <DownloadIcon />
        <span>
          Downloading Palbox <strong>v{version}</strong>…
        </span>
        <div className="flex-1 mx-4 h-1.5 bg-panel-raised rounded-full overflow-hidden max-w-48">
          <div
            className="h-full bg-accent rounded-full transition-all duration-300"
            style={{ width: `${Math.round(percent)}%` }}
          />
        </div>
        <span className="text-fog text-[11px] font-mono">{Math.round(percent)}%</span>
      </div>
    );
  }

  // ── Applying server update ────────────────────────────────────────────────
  if (phase === 'applying') {
    return (
      <div className={`${base} bg-accent/10 text-accent`}>
        <SpinnerIcon />
        <span>
          Applying update… The panel will go offline briefly while the service restarts.
        </span>
      </div>
    );
  }

  // ── Update available ──────────────────────────────────────────────────────
  return (
    <div className={`${base} bg-accent/10 text-accent`}>
      <UpdateIcon />
      <span>
        Palbox <strong>v{version}</strong> is available.{' '}
        {isElectron && <span className="text-fog">Downloading automatically…</span>}
      </span>
      <div className="ml-auto flex items-center gap-2">
        {isServerMode && !isElectron && (
          <button
            onClick={applyServerUpdate}
            className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-accent text-void text-[11px] font-bold hover:bg-accent/90 transition-colors"
          >
            <DownloadIcon />
            Apply Update
          </button>
        )}
        {!isElectron && !isServerMode && (
          <a
            href={releaseUrl}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 text-accent hover:text-accent/80 transition-colors text-[12.5px]"
          >
            View release →
          </a>
        )}
        <button onClick={dismiss} className="text-accent/50 hover:text-accent transition-colors">
          <XIcon />
        </button>
      </div>
    </div>
  );
}

// ── Micro-icons ───────────────────────────────────────────────────────────────

function XIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function UpdateIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
      className="animate-spin">
      <path d="M21 12a9 9 0 11-6.219-8.56" />
    </svg>
  );
}
