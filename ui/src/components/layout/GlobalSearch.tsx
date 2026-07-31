import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchApi } from '../../api/client';
import type { SearchResult } from '../../api/client';
import { useInstance } from '../../context/InstanceContext';
import { cn } from '../../lib/cn';

const TYPE_ICONS: Record<SearchResult['type'], string> = {
  player: '👤',
  chat:   '💬',
  audit:  '📋',
  note:   '📝',
};

const TYPE_LABELS: Record<SearchResult['type'], string> = {
  player: 'Player',
  chat:   'Chat',
  audit:  'Audit',
  note:   'Note',
};

function fmtAgo(ts?: number) {
  if (!ts) return '';
  const d = Math.floor((Date.now() / 1000 - ts) / 86400);
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d}d ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function GlobalSearch({ open, onClose }: Props) {
  const { active: instance } = useInstance();
  const navigate    = useNavigate();
  const inputRef    = useRef<HTMLInputElement>(null);
  const listRef     = useRef<HTMLDivElement>(null);

  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [active,  setActive]  = useState(0);

  // Focus input when opened
  useEffect(() => {
    if (open) { setQuery(''); setResults([]); setActive(0); setTimeout(() => inputRef.current?.focus(), 50); }
  }, [open]);

  // Debounced search
  useEffect(() => {
    if (!open || query.length < 2) { setResults([]); return; }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await searchApi.search(query, instance?.id);
        setResults(res.results);
        setActive(0);
      } catch {}
      finally { setLoading(false); }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, open, instance?.id]);

  const goTo = useCallback((r: SearchResult) => {
    onClose();
    navigate(r.link ?? '/');
  }, [navigate, onClose]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
      if (e.key === 'Enter' && results[active]) { goTo(results[active]); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, results, active, goTo, onClose]);

  // Scroll active into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${active}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-2xl rounded-2xl border border-line bg-panel shadow-2xl overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-line">
          <svg className="w-4.5 h-4.5 text-fog shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="8" /><path strokeLinecap="round" d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search players, chat, audit log, notes…"
            className="flex-1 bg-transparent text-[14px] text-bone placeholder:text-fog/50 outline-none border-none"
          />
          {loading && <div className="w-4 h-4 border-2 border-fog/30 border-t-fog rounded-full animate-spin shrink-0" />}
          <kbd className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono bg-panel-raised border border-line text-fog">ESC</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[60vh] overflow-y-auto">
          {results.length === 0 && query.length >= 2 && !loading && (
            <div className="px-4 py-8 text-center text-fog/60 text-[13px]">
              No results for &ldquo;{query}&rdquo;
            </div>
          )}

          {results.length === 0 && query.length < 2 && (
            <div className="px-4 py-6 text-center text-fog/40 text-[12px]">
              Type at least 2 characters to search
            </div>
          )}

          {results.length > 0 && (() => {
            // Group by type
            const groups: { type: SearchResult['type']; items: { result: SearchResult; idx: number }[] }[] = [];
            const seen = new Map<SearchResult['type'], { result: SearchResult; idx: number }[]>();
            results.forEach((r, idx) => {
              if (!seen.has(r.type)) { seen.set(r.type, []); groups.push({ type: r.type, items: seen.get(r.type)! }); }
              seen.get(r.type)!.push({ result: r, idx });
            });

            return groups.map(({ type, items }) => (
              <div key={type}>
                <div className="sticky top-0 px-4 py-1.5 bg-panel border-b border-line/50 text-[10px] font-semibold uppercase tracking-[0.1em] text-fog/60">
                  {TYPE_LABELS[type]}
                </div>
                {items.map(({ result: r, idx }) => (
                  <div
                    key={idx}
                    data-idx={idx}
                    onClick={() => goTo(r)}
                    onMouseEnter={() => setActive(idx)}
                    className={cn(
                      'flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors border-b border-line/30 last:border-0',
                      idx === active ? 'bg-panel-raised' : 'hover:bg-panel-raised/60',
                    )}
                  >
                    <span className="text-[16px] shrink-0 mt-0.5">{TYPE_ICONS[r.type]}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[13.5px] font-medium text-bone truncate">{r.title}</span>
                        {r.meta && (
                          <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-rust/20 text-rust border border-rust/30">{r.meta}</span>
                        )}
                      </div>
                      <span className="block text-[12px] text-fog truncate mt-0.5">{r.subtitle}</span>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="text-[11px] text-fog/50">{r.instanceName}</span>
                      {r.ts && <span className="block text-[10px] text-fog/40 mt-0.5">{fmtAgo(r.ts)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            ));
          })()}
        </div>

        {results.length > 0 && (
          <div className="px-4 py-2 border-t border-line flex items-center gap-3 text-[11px] text-fog/50">
            <span><kbd className="font-mono bg-panel-raised px-1 rounded text-fog">↑↓</kbd> navigate</span>
            <span><kbd className="font-mono bg-panel-raised px-1 rounded text-fog">↵</kbd> open</span>
            <span><kbd className="font-mono bg-panel-raised px-1 rounded text-fog">ESC</kbd> close</span>
            <span className="ml-auto">{results.length} result{results.length !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>
    </div>
  );
}
