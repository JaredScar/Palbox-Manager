import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import fs from 'fs';
import readline from 'readline';
import type { Instance } from './db/types';
import { log } from './lib/logger';
import { onLogLine, clearPlayers, setPlayerEventCallback } from './services/playerTracker';
import { fireEvent } from './services/discord';
import { resolveLogFile, explainMissingLog } from './lib/logfile';

let wss: WebSocketServer | null = null;

interface TaggedWs extends WebSocket {
  instanceId?: number;
}

const clients = new Set<TaggedWs>();

// ── Per-instance in-memory ring buffer ───────────────────────────────────────
const LOG_BUFFER_SIZE = 500;
const logBuffers = new Map<number, string[]>();

function bufferLine(instanceId: number, line: string): void {
  if (!logBuffers.has(instanceId)) logBuffers.set(instanceId, []);
  const buf = logBuffers.get(instanceId)!;
  buf.push(line);
  if (buf.length > LOG_BUFFER_SIZE) buf.shift();
}

// ── WebSocket server ──────────────────────────────────────────────────────────
export function initWss(server: http.Server): void {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: TaggedWs, req) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const instanceId = parseInt(url.searchParams.get('instance') ?? '1', 10);
    ws.instanceId = isNaN(instanceId) ? 1 : instanceId;

    clients.add(ws);
    log.info(`WS client connected (instance=${ws.instanceId})`);

    // Send buffered history so the console isn't empty on first open
    const history = logBuffers.get(ws.instanceId) ?? [];
    if (history.length > 0) {
      for (const line of history) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'log', instanceId: ws.instanceId, line }), () => {});
        }
      }
    }

    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  log.info('WebSocket server ready');
}

export function broadcast(data: Record<string, unknown>): void {
  const msg = JSON.stringify(data);
  for (const ws of clients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    const instanceId = (data as { instanceId?: number }).instanceId;
    if (instanceId === undefined || ws.instanceId === instanceId) {
      ws.send(msg, () => {});
    }
  }
}

// ── Log tail (polling — more reliable than fs.watch on Windows) ───────────────
const tailIntervals = new Map<number, ReturnType<typeof setInterval>>();
const POLL_MS = 1000; // check every second
const RESOLVE_EVERY_TICKS = 15; // re-locate the log file every 15s
/** The file each instance is currently tailing, for diagnostics. */
const tailFiles = new Map<number, string>();

export function startLogTail(inst: Instance): void {
  // Stop any existing poller for this instance
  const existing = tailIntervals.get(inst.id);
  if (existing) clearInterval(existing);
  tailIntervals.delete(inst.id);

  // Wire Discord notifications for player join/leave events
  setPlayerEventCallback(inst.id, ({ event, player }) => {
    if (event === 'join') {
      fireEvent(inst, 'player_joined', '➕ Player Joined',
        `**${player.name}** joined **${inst.name}**.`).catch(() => {});
    } else {
      fireEvent(inst, 'player_left', '➖ Player Left',
        `**${player.name}** left **${inst.name}**.`).catch(() => {});
    }
  });

  // The file is resolved rather than taken as configured, because the log is
  // named after the Unreal project (Pal.log) and not after the executable, so
  // a configured PalServer.log never appears. Resolution is retried while
  // detached, since the log only exists once the server has started, and is
  // rechecked periodically so a rotation onto a new file is picked up.
  let current: string | null = null;
  let fileSize = 0;
  let ticksSinceResolve = 0;
  let lastReported = '';

  const emit = (line: string) => {
    if (!line.trim()) return;
    onLogLine(inst.id, line);
    bufferLine(inst.id, line);
    broadcast({ type: 'log', instanceId: inst.id, line });
  };

  const readFrom = (file: string, start: number, end?: number) => {
    const stream = fs.createReadStream(file, end === undefined
      ? { start, encoding: 'utf8' }
      : { start, end, encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream });
    rl.on('line', emit);
    rl.on('error', () => {});
    stream.on('error', () => {});
  };

  const attach = (file: string) => {
    try { fileSize = fs.statSync(file).size; } catch { return; }
    current = file;
    tailFiles.set(inst.id, file);
    // Stale player state would otherwise survive into the replay below.
    clearPlayers(inst.id);
    // Replay the tail end so clients connecting later still get history.
    try { readFrom(file, Math.max(0, fileSize - 8192)); }
    catch (e) { log.warn(`[${inst.name}] Could not read initial log content:`, e); }
    log.info(`[${inst.name}] Log tail started: ${file}`);
  };

  const tryResolve = () => {
    const res = resolveLogFile(inst);
    if (res.file) { attach(res.file); return; }
    const msg = explainMissingLog(res);
    // Only log a change of state, so a stopped server does not fill the log
    // with the same line every fifteen seconds.
    if (msg !== lastReported) {
      lastReported = msg;
      log.info(`[${inst.name}] ${msg} Searched: ${res.searched.join(', ') || 'no candidate directories'}`);
    }
  };

  const timer = setInterval(() => {
    ticksSinceResolve++;

    if (!current) {
      if (ticksSinceResolve >= RESOLVE_EVERY_TICKS) { ticksSinceResolve = 0; tryResolve(); }
      return;
    }

    try {
      const newSize = fs.statSync(current).size;

      if (newSize < fileSize) {
        // Truncated or replaced in place by a restart.
        fileSize = 0;
        clearPlayers(inst.id);
      }
      if (newSize > fileSize) {
        const from = fileSize;
        fileSize = newSize;
        readFrom(current, from, newSize - 1);
      }
    } catch {
      // Gone: the server was stopped, or the log rotated to a new name.
      current = null;
      tailFiles.delete(inst.id);
      ticksSinceResolve = RESOLVE_EVERY_TICKS;
      return;
    }

    // A restart can rotate Pal.log to a backup and open a new file, which the
    // size check above cannot see if the path stayed valid.
    if (ticksSinceResolve >= RESOLVE_EVERY_TICKS) {
      ticksSinceResolve = 0;
      const res = resolveLogFile(inst);
      if (res.file && res.file !== current) attach(res.file);
    }
  }, POLL_MS);

  tailIntervals.set(inst.id, timer);
  tryResolve();
}

export function stopLogTail(instanceId: number): void {
  const t = tailIntervals.get(instanceId);
  if (t) { clearInterval(t); tailIntervals.delete(instanceId); }
  tailFiles.delete(instanceId);
}

/**
 * Whether the poller is running and how much it has seen. An empty console is
 * otherwise indistinguishable from a quiet server, so the UI needs this to say
 * which one it is.
 */
/**
 * Whether a real log file is being read, as opposed to the console showing
 * only Palbox's own event feed.
 */
export function isTailingFile(instanceId: number): boolean {
  return tailFiles.has(instanceId);
}

/**
 * Writes a line into the console from Palbox itself.
 *
 * Palworld exposes no log or console stream over RCON or the REST API - only
 * state queries and actions - so when the server writes no log file there is
 * nothing to stream. These synthesised lines are what keeps the console
 * useful in that case, and they are prefixed so they are never mistaken for
 * output from the game.
 */
export function emitConsole(instanceId: number, message: string): void {
  const ts = new Date().toTimeString().slice(0, 8);
  const line = `[${ts}][Palbox] ${message}`;
  bufferLine(instanceId, line);
  broadcast({ type: 'log', instanceId, line });
}

export function getTailStatus(instanceId: number): { tailing: boolean; buffered: number; file: string | null } {
  return {
    // Attached to a real file, rather than merely polling for one to appear.
    tailing: tailFiles.has(instanceId),
    buffered: logBuffers.get(instanceId)?.length ?? 0,
    file: tailFiles.get(instanceId) ?? null,
  };
}
