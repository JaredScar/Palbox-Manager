interface TitlebarProps {
  isElectron: boolean;
  onToggleMode: () => void;
}

export function Titlebar({ isElectron, onToggleMode }: TitlebarProps) {
  if (!isElectron) return null;
  return (
    <div className="h-10 bg-panel border-b border-line flex items-center justify-between px-4 select-none shrink-0 [-webkit-app-region:drag]">
      <div className="flex items-center gap-3 [-webkit-app-region:no-drag]">
        <div className="w-3 h-3 rounded-full bg-rust" />
        <div className="w-3 h-3 rounded-full bg-gold" />
        <div className="w-3 h-3 rounded-full bg-lime" />
        <span className="ml-2 text-[12px] text-fog font-mono">Palbox — Palworld Panel</span>
      </div>
      <div className="flex items-center bg-panel-raised border border-line rounded-lg p-0.5 gap-0.5 [-webkit-app-region:no-drag]">
        <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] text-bone bg-line/60 transition-all">
          <MonitorIcon /> Desktop app
        </button>
        <button
          onClick={onToggleMode}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] text-fog hover:text-bone transition-all"
        >
          <GlobeIcon /> Browser
        </button>
      </div>
    </div>
  );
}

function MonitorIcon() {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}
function GlobeIcon() {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 010 18 14 14 0 010-18z" />
    </svg>
  );
}
