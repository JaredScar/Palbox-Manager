import { useState, useEffect, useCallback } from 'react';
import { useInstance } from '../context/InstanceContext';
import { ViewWrapper } from '../components/layout/ViewWrapper';
import { PanelSection } from '../components/ui/PanelSection';
import { cn } from '../lib/cn';
import type { SaveEntry } from '../api/client';

function fmtSize(b: number) {
  return b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB`
       : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB`
       : b >= 1e3 ? `${(b / 1e3).toFixed(0)} KB`
       : `${b} B`;
}
function fmtDate(ts: number) { return new Date(ts * 1000).toLocaleString(); }

function Breadcrumbs({ dir, onNav }: { dir: string; onNav: (d: string) => void }) {
  const parts = dir ? dir.replace(/\\/g, '/').split('/') : [];
  return (
    <nav className="flex items-center gap-1 text-[12.5px] text-fog overflow-x-auto pb-0.5 flex-wrap">
      <button
        onClick={() => onNav('')}
        className="hover:text-bone transition-colors shrink-0"
      >Save folder</button>
      {parts.map((part, i) => {
        const upTo = parts.slice(0, i + 1).join('/');
        const isLast = i === parts.length - 1;
        return (
          <span key={i} className="flex items-center gap-1 shrink-0">
            <span className="text-line">/</span>
            {isLast ? (
              <span className="text-bone font-medium">{part}</span>
            ) : (
              <button onClick={() => onNav(upTo)} className="hover:text-bone transition-colors">{part}</button>
            )}
          </span>
        );
      })}
    </nav>
  );
}

// File-type icon heuristic
function FileIcon({ name }: { name: string }) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const icons: Record<string, string> = {
    sav: '💾', db: '🗄️', json: '📋', ini: '⚙️', log: '📜', txt: '📄',
    png: '🖼️', jpg: '🖼️', jpeg: '🖼️', bak: '📦', zip: '🗜️',
  };
  return <span className="text-[14px] select-none">{icons[ext] ?? '📄'}</span>;
}

export default function SaveBrowser() {
  const { api } = useInstance();
  const [dir, setDir]         = useState('');
  const [entries, setEntries] = useState<SaveEntry[]>([]);
  const [saveDir, setSaveDir] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const load = useCallback(async (target: string) => {
    if (!api) return;
    setLoading(true); setError('');
    try {
      const res = await api.saveBrowser(target);
      setSaveDir(res.saveDir);
      setEntries(res.entries);
      setDir(target);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(''); }, [load]);

  function navigate(entry: SaveEntry) {
    if (entry.isDir) load(entry.relativePath);
  }

  function download(entry: SaveEntry) {
    if (!api || entry.isDir) return;
    const url = api.saveFileDownloadUrl(entry.relativePath);
    const a = document.createElement('a');
    a.href = url;
    a.download = entry.name;
    a.click();
  }

  return (
    <ViewWrapper title="Save Browser" eyebrow="Files">
      <PanelSection
        title="Save directory"
        description={saveDir || 'Configure save_dir in Settings to enable this view.'}
      >
        {error && (
          <div className="mb-4 px-4 py-3 rounded-xl bg-rust/10 border border-rust/30 text-rust text-[13px]">
            {error}
          </div>
        )}

        <div className="mb-3">
          <Breadcrumbs dir={dir} onNav={load} />
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-fog text-[13px] py-6">
            <div className="w-4 h-4 border-2 border-fog/40 border-t-fog rounded-full animate-spin" />
            Loading…
          </div>
        )}

        {!loading && entries.length === 0 && !error && (
          <div className="text-fog/60 text-[13px] py-6 text-center">
            {saveDir ? 'This directory is empty.' : 'No save_dir configured for this instance.'}
          </div>
        )}

        {!loading && entries.length > 0 && (
          <div className="rounded-xl border border-line overflow-hidden">
            {/* back button */}
            {dir && (
              <button
                onClick={() => {
                  const parts = dir.replace(/\\/g, '/').split('/');
                  load(parts.slice(0, -1).join('/'));
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-panel-raised transition-colors border-b border-line"
              >
                <span className="text-[14px]">⬅</span>
                <span className="text-[13px] text-fog italic">..</span>
              </button>
            )}

            {entries.map((entry) => (
              <div
                key={entry.relativePath}
                className={cn(
                  'flex items-center gap-3 px-4 py-2.5 border-b border-line/50 last:border-0 group',
                  entry.isDir
                    ? 'hover:bg-panel-raised cursor-pointer'
                    : 'hover:bg-panel-raised/50',
                )}
                onClick={() => entry.isDir && navigate(entry)}
              >
                <span className="text-[14px] select-none shrink-0">
                  {entry.isDir ? '📁' : <FileIcon name={entry.name} />}
                </span>

                <div className="flex-1 min-w-0">
                  <span className={cn(
                    'text-[13.5px] font-medium truncate block',
                    entry.isDir ? 'text-bone' : 'text-fog group-hover:text-bone transition-colors',
                  )}>
                    {entry.name}
                  </span>
                  <span className="text-[11px] text-fog/60">
                    {fmtDate(entry.modifiedAt)}{!entry.isDir && ` · ${fmtSize(entry.size)}`}
                  </span>
                </div>

                {!entry.isDir && (
                  <button
                    onClick={(e) => { e.stopPropagation(); download(entry); }}
                    className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-panel border border-line text-[12px] text-fog hover:text-bone"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download
                  </button>
                )}

                {entry.isDir && (
                  <svg className="w-4 h-4 text-fog/40 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                )}
              </div>
            ))}
          </div>
        )}
      </PanelSection>
    </ViewWrapper>
  );
}
