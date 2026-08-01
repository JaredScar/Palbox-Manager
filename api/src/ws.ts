import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import fs from 'fs';
import readline from 'readline';
import type { Instance } from './db/types';
import { log } from './lib/logger';
import { onLogLine, clearPlayers, setPlayerEventCallback } from './services/playerTracker';
import { fireEvent } from './services/discord';

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

export function startLogTail(inst: Instance): void {
  // Stop any existing poller for this instance
  const existing = tailIntervals.get(inst.id);
  if (existing) clearInterval(existing);
  tailIntervals.delete(inst.id);

  const logFile = inst.log_file;
  if (!logFile) {
    log.warn(`[${inst.name}] No log_file configured — console live stream disabled.`);
    return;
  }

  // Wait until the file exists, then start
  function waitAndStart() {
    if (!fs.existsSync(logFile)) {
      log.info(`[${inst.name}] Log file not found yet, will retry in 15s: ${logFile}`);
      setTimeout(waitAndStart, 15_000);
      return;
    }

    let fileSize = 0;
    try { fileSize = fs.statSync(logFile).size; } catch { return; }

    // Clear stale player state before replaying the log (avoids phantom players)
    clearPlayers(inst.id);

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

    // Send the last 8 KB of existing content to the buffer so new clients get history
    const startPos = Math.max(0, fileSize - 8192);
    try {
      const stream = fs.createReadStream(logFile, { start: startPos, encoding: 'utf8' });
      const rl = readline.createInterface({ input: stream });
      rl.on('line', (line) => {
        if (!line.trim()) return;
        onLogLine(inst.id, line);           // track join/leave
        bufferLine(inst.id, line);
        broadcast({ type: 'log', instanceId: inst.id, line });
      });
    } catch (e) {
      log.warn(`[${inst.name}] Could not read initial log content:`, e);
    }

    // Poll for new content every second (reliable on Windows with NSSM)
    const timer = setInterval(() => {
      try {
        const stat = fs.statSync(logFile);
        const newSize = stat.size;

        if (newSize < fileSize) {
          // File was rotated / truncated — reset position and clear stale players
          fileSize = 0;
          clearPlayers(inst.id);
        }

        if (newSize > fileSize) {
          const chunk = fs.createReadStream(logFile, { start: fileSize, end: newSize - 1, encoding: 'utf8' });
          fileSize = newSize;
          const rl2 = readline.createInterface({ input: chunk });
          rl2.on('line', (line) => {
            if (!line.trim()) return;
            onLogLine(inst.id, line);       // track join/leave
            bufferLine(inst.id, line);
            broadcast({ type: 'log', instanceId: inst.id, line });
          });
        }
      } catch {
        // File disappeared (server stopped) — will resume on next stat success
      }
    }, POLL_MS);

    tailIntervals.set(inst.id, timer);
    log.info(`[${inst.name}] Log tail started: ${logFile}`);
  }

  waitAndStart();
}

export function stopLogTail(instanceId: number): void {
  const t = tailIntervals.get(instanceId);
  if (t) { clearInterval(t); tailIntervals.delete(instanceId); }
}

/**
 * Whether the poller is running and how much it has seen. An empty console is
 * otherwise indistinguishable from a quiet server, so the UI needs this to say
 * which one it is.
 */
export function getTailStatus(instanceId: number): { tailing: boolean; buffered: number } {
  return {
    tailing: tailIntervals.has(instanceId),
    buffered: logBuffers.get(instanceId)?.length ?? 0,
  };
}
