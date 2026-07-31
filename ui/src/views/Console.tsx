import { useState, useEffect, useRef, KeyboardEvent } from 'react';
import { useInstance } from '../context/InstanceContext';
import { Button } from '../components/ui/Button';
import { ViewWrapper } from '../components/layout/ViewWrapper';
import { cn } from '../lib/cn';
import type { RconMacro } from '../api/client';

const RCON_COMMANDS = [
  'ShowPlayers', 'KickPlayer', 'BanPlayer', 'UnBanPlayer',
  'TeleportToPlayer', 'TeleportToMe', 'ShowAdminList',
  'AddAdminPlayer', 'RemoveAdminPlayer',
  'Broadcast ', 'Save', 'DoExit', 'Shutdown ',
  'Info', 'ServerInfo',
];
const HISTORY_KEY = 'palbox-rcon-history';

interface LogLine { id: number; text: string; ts: string; level: 'info' | 'warn' | 'sys' | 'err'; }

const LEVEL_COLORS: Record<string, string> = {
  warn: 'text-gold',
  err:  'text-rust',
  sys:  'text-aqua',
  info: 'text-fog',
};

function parseLevel(line: string): LogLine['level'] {
  if (/warn|warning/i.test(line)) return 'warn';
  if (/error|fatal/i.test(line))  return 'err';
  if (/\[sys\]|autosave|rcon/i.test(line)) return 'sys';
  return 'info';
}

let lineId = 0;

const MACRO_COLORS = ['#a79fc7', '#2fd9e8', '#7ce666', '#ffd447', '#ff9d3d', '#b27cf2', '#ff5d73', '#3fd8b4'];

export function Console() {
  const { api, active } = useInstance();
  const [tab, setTab] = useState<'live' | 'log'>('live');
  const [lines, setLines] = useState<LogLine[]>([]);
  const [cmd, setCmd] = useState('');
  const [sending, setSending] = useState(false);
  const [cmdHistory, setCmdHistory] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]'); } catch { return []; }
  });
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [macros, setMacros] = useState<RconMacro[]>([]);
  const [showAddMacro, setShowAddMacro] = useState(false);
  const [macroForm, setMacroForm] = useState({ name: '', command: '', description: '', color: '#a79fc7' });
  const [savingMacro, setSavingMacro] = useState(false);
  const [runningMacro, setRunningMacro] = useState<number | null>(null);
  // Log viewer
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logSearch, setLogSearch] = useState('');
  const [logLoading, setLogLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Load macros
  async function loadMacros() {
    if (!api) return;
    try { setMacros(await api.listMacros()); } catch {}
  }
  useEffect(() => { loadMacros(); }, [api]);

  // WebSocket log tail
  useEffect(() => {
    wsRef.current?.close();
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/ws?instance=${active?.id ?? 1}`);
    wsRef.current = ws;
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data as string);
        if (data.type === 'log') {
          const line = data.line as string;
          setLines((prev) => [
            ...prev.slice(-500),
            { id: lineId++, text: line, ts: new Date().toTimeString().slice(0, 8), level: parseLevel(line) },
          ]);
        }
      } catch {}
    };
    return () => ws.close();
  }, [active?.id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [lines]);

  // Load historical log file
  async function loadLog() {
    if (!api) return;
    setLogLoading(true);
    try {
      const { lines: l } = await api.logLines(300, logSearch);
      setLogLines(l);
    } catch { setLogLines([]); }
    setLogLoading(false);
  }
  useEffect(() => { if (tab === 'log') loadLog(); }, [tab, api]);

  async function send() {
    if (!cmd.trim() || !api) return;
    setSending(true);
    const sent = cmd.trim();
    // Persist to history
    const newHistory = [sent, ...cmdHistory.filter((c) => c !== sent)].slice(0, 100);
    setCmdHistory(newHistory);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(newHistory));
    setHistoryIdx(-1);
    setSuggestions([]);
    try {
      const { result } = await api.rcon(sent);
      setLines((prev) => [
        ...prev,
        { id: lineId++, text: `> ${sent}`, ts: new Date().toTimeString().slice(0, 8), level: 'sys' },
        ...(result ? [{ id: lineId++, text: result, ts: new Date().toTimeString().slice(0, 8), level: 'info' as const }] : []),
      ]);
      setCmd('');
    } catch (e) {
      setLines((prev) => [...prev, { id: lineId++, text: `Error: ${(e as Error).message}`, ts: new Date().toTimeString().slice(0, 8), level: 'err' }]);
    }
    setSending(false);
  }

  function handleCmdKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { send(); return; }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.min(historyIdx + 1, cmdHistory.length - 1);
      setHistoryIdx(next);
      if (cmdHistory[next] !== undefined) { setCmd(cmdHistory[next]); setSuggestions([]); }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = historyIdx - 1;
      setHistoryIdx(next);
      if (next < 0) { setCmd(''); } else if (cmdHistory[next] !== undefined) { setCmd(cmdHistory[next]); }
      setSuggestions([]);
      return;
    }
    if (e.key === 'Escape') { setSuggestions([]); return; }
    if (e.key === 'Tab' && suggestions.length > 0) {
      e.preventDefault();
      setCmd(suggestions[0]);
      setSuggestions([]);
      return;
    }
  }

  function handleCmdChange(val: string) {
    setCmd(val);
    setHistoryIdx(-1);
    if (val.length >= 1) {
      const lower = val.toLowerCase();
      const matches = RCON_COMMANDS.filter((c) => c.toLowerCase().startsWith(lower));
      setSuggestions(matches.slice(0, 6));
    } else {
      setSuggestions([]);
    }
  }

  async function runMacro(id: number) {
    if (!api) return;
    setRunningMacro(id);
    try {
      const { result } = await api.runMacro(id);
      const macro = macros.find((m) => m.id === id);
      setLines((prev) => [
        ...prev,
        { id: lineId++, text: `[macro] ${macro?.name ?? id}: ${macro?.command ?? ''}`, ts: new Date().toTimeString().slice(0, 8), level: 'sys' },
        ...(result ? [{ id: lineId++, text: result, ts: new Date().toTimeString().slice(0, 8), level: 'info' as const }] : []),
      ]);
    } catch (e) {
      setLines((prev) => [...prev, { id: lineId++, text: `Macro error: ${(e as Error).message}`, ts: new Date().toTimeString().slice(0, 8), level: 'err' }]);
    }
    setRunningMacro(null);
  }

  async function saveMacro() {
    if (!api || !macroForm.name || !macroForm.command) return;
    setSavingMacro(true);
    try {
      await api.createMacro(macroForm);
      setMacroForm({ name: '', command: '', description: '', color: '#a79fc7' });
      setShowAddMacro(false);
      await loadMacros();
    } catch (e) { alert((e as Error).message); }
    setSavingMacro(false);
  }

  async function deleteMacro(id: number) {
    if (!api || !confirm('Delete this macro?')) return;
    try { await api.deleteMacro(id); await loadMacros(); } catch (e) { alert((e as Error).message); }
  }

  return (
    <ViewWrapper eyebrow="Live console" title="Server console"
      description="Streaming stdout over WebSocket. Send RCON commands or run saved macros."
      accentVar="var(--lime)"
      actions={
        <>
          <div className="flex gap-0.5 bg-panel-raised border border-line rounded-lg p-0.5">
            {(['live', 'log'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={cn('px-3 py-1.5 rounded-md text-[12px] font-medium transition-all capitalize',
                  tab === t ? 'bg-lime/15 text-lime' : 'text-fog hover:text-bone')}>
                {t === 'live' ? 'Live stream' : 'Log viewer'}
              </button>
            ))}
          </div>
          <Button variant="ghost" onClick={() => setLines([])}>Clear</Button>
        </>
      }
    >
      <div className="grid grid-cols-[1fr,220px] gap-4 items-start">
        {/* Main console / log panel */}
        <div className="flex flex-col gap-3">
          {tab === 'live' ? (
            <>
              <div className="bg-panel border border-line rounded-2xl flex flex-col" style={{ height: 'calc(100vh - 340px)', minHeight: 280 }}>
                <div className="flex-1 overflow-y-auto p-4 font-mono text-[12px] leading-relaxed">
                  {lines.length === 0 && <div className="text-fog/50">Waiting for log output…</div>}
                  {lines.map((l) => (
                    <div key={l.id} className="flex gap-3 hover:bg-white/[0.02] px-1 rounded">
                      <span className="text-fog/50 shrink-0 w-16">{l.ts}</span>
                      <span className={cn('shrink-0 w-10 text-[10px] font-bold', LEVEL_COLORS[l.level])}>{l.level.toUpperCase()}</span>
                      <span className="text-bone-dim break-all">{l.text}</span>
                    </div>
                  ))}
                  <div ref={bottomRef} />
                </div>
              </div>
              <div className="flex gap-2 relative">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    placeholder="RCON command — ↑↓ history, Tab to autocomplete"
                    value={cmd}
                    onChange={(e) => handleCmdChange(e.target.value)}
                    onKeyDown={handleCmdKey}
                    disabled={sending}
                    className="w-full font-mono text-[13px] focus:border-lime focus:outline-none disabled:opacity-50"
                  />
                  {suggestions.length > 0 && (
                    <div className="absolute bottom-[calc(100%+4px)] left-0 right-0 bg-panel border border-line rounded-xl shadow-xl overflow-hidden z-50">
                      {suggestions.map((s) => (
                        <button key={s} onClick={() => { setCmd(s); setSuggestions([]); }}
                          className="block w-full text-left px-3 py-2 font-mono text-[12.5px] text-fog hover:bg-white/[0.06] hover:text-bone transition-colors">
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <Button variant="lime" onClick={send} loading={sending} disabled={!cmd.trim()}>Send</Button>
              </div>
            </>
          ) : (
            <>
              <div className="flex gap-2">
                <input
                  placeholder="Search log…"
                  value={logSearch}
                  onChange={(e) => setLogSearch(e.target.value)}
                  onKeyDown={(e: KeyboardEvent) => e.key === 'Enter' && loadLog()}
                  className="flex-1 font-mono text-[13px] focus:border-aqua focus:outline-none"
                />
                <Button variant="ghost" onClick={loadLog} loading={logLoading}>Search</Button>
              </div>
              <div className="bg-panel border border-line rounded-2xl font-mono text-[12px]" style={{ height: 'calc(100vh - 370px)', minHeight: 280, overflowY: 'auto' }}>
                <div className="p-4 leading-relaxed">
                  {logLoading && <div className="text-fog/50">Loading…</div>}
                  {!logLoading && logLines.length === 0 && <div className="text-fog/50">No log lines found. Check the log_file path in your instance settings.</div>}
                  {logLines.map((l, i) => (
                    <div key={i} className={cn('break-all px-1 hover:bg-white/[0.02] rounded', parseLevel(l) === 'err' ? 'text-rust' : parseLevel(l) === 'warn' ? 'text-gold' : parseLevel(l) === 'sys' ? 'text-aqua' : 'text-fog')}>
                      {l}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* RCON Macros sidebar */}
        <div className="bg-panel border border-line rounded-2xl flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-line/50">
            <div className="text-[11px] uppercase tracking-[0.1em] text-fog font-semibold">Macros</div>
            <button onClick={() => setShowAddMacro((s) => !s)}
              className="w-5 h-5 rounded-md bg-panel-raised border border-line text-fog hover:text-bone flex items-center justify-center text-[14px] transition-colors">
              {showAddMacro ? '−' : '+'}
            </button>
          </div>

          {showAddMacro && (
            <div className="p-3 border-b border-line/50 flex flex-col gap-2">
              <input placeholder="Name" value={macroForm.name} onChange={(e) => setMacroForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full text-[12px] focus:border-violet focus:outline-none" />
              <input placeholder="RCON command" value={macroForm.command} onChange={(e) => setMacroForm((f) => ({ ...f, command: e.target.value }))}
                className="w-full font-mono text-[12px] focus:border-violet focus:outline-none" />
              <input placeholder="Description (optional)" value={macroForm.description} onChange={(e) => setMacroForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full text-[12px] focus:border-violet focus:outline-none" />
              <div className="flex gap-1.5 flex-wrap">
                {MACRO_COLORS.map((c) => (
                  <button key={c} onClick={() => setMacroForm((f) => ({ ...f, color: c }))}
                    className={cn('w-5 h-5 rounded-full border-2 transition-all', macroForm.color === c ? 'border-bone scale-110' : 'border-transparent')}
                    style={{ background: c }} />
                ))}
              </div>
              <div className="flex gap-1.5 mt-0.5">
                <Button variant="violet" className="flex-1 justify-center text-[12px] py-1.5" loading={savingMacro} onClick={saveMacro}>Save</Button>
                <Button variant="ghost" className="text-[12px] py-1.5" onClick={() => setShowAddMacro(false)}>×</Button>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5" style={{ maxHeight: 'calc(100vh - 380px)', minHeight: 200 }}>
            {macros.length === 0 && (
              <div className="text-fog/50 text-[12px] px-2 py-4 text-center">
                No macros yet.<br />Click + to add one.
              </div>
            )}
            {macros.map((m) => (
              <div key={m.id} className="group flex items-center gap-2 px-2.5 py-2 rounded-xl hover:bg-panel-raised border border-transparent hover:border-line/50 transition-all">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: m.color }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-medium text-bone truncate">{m.name}</div>
                  {m.description && <div className="text-[10.5px] text-fog/70 truncate">{m.description}</div>}
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button onClick={() => runMacro(m.id)}
                    disabled={runningMacro === m.id}
                    className="w-6 h-6 rounded-md flex items-center justify-center text-lime hover:bg-lime/10 transition-colors disabled:opacity-50"
                    title="Run">
                    {runningMacro === m.id
                      ? <span className="w-3 h-3 border border-lime/40 border-t-lime rounded-full animate-spin block" />
                      : <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3"><path d="M8 5v14l11-7z"/></svg>}
                  </button>
                  <button onClick={() => deleteMacro(m.id)}
                    className="w-6 h-6 rounded-md flex items-center justify-center text-fog hover:text-rust hover:bg-rust/10 transition-colors"
                    title="Delete">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ViewWrapper>
  );
}
