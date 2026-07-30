import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import fs from 'fs';
import readline from 'readline';
import type { Instance } from './db/types';
import { log } from './lib/logger';

let wss: WebSocketServer | null = null;

interface TaggedWs extends WebSocket {
  instanceId?: number;
}

const clients = new Set<TaggedWs>();

export function initWss(server: http.Server): void {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: TaggedWs, req) => {
    // Parse ?instance=N from the WS URL
    const url = new URL(req.url ?? '/', 'http://localhost');
    const instanceId = parseInt(url.searchParams.get('instance') ?? '1', 10);
    ws.instanceId = isNaN(instanceId) ? 1 : instanceId;

    clients.add(ws);
    log.info(`WS client connected (instance=${ws.instanceId})`);
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

const tailWatchers = new Map<number, fs.FSWatcher>();

export function startLogTail(inst: Instance): void {
  tailWatchers.get(inst.id)?.close();

  const logFile = inst.log_file;
  if (!logFile) return;

  if (!fs.existsSync(logFile)) {
    setTimeout(() => startLogTail(inst), 15_000);
    return;
  }

  let fileSize = fs.statSync(logFile).size;
  // Read last 8 KB on attach
  const stream = fs.createReadStream(logFile, { start: Math.max(0, fileSize - 8192), encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream });
  rl.on('line', (line) => broadcast({ type: 'log', instanceId: inst.id, line }));
  rl.on('close', () => {
    const watcher = fs.watch(logFile, () => {
      const newSize = fs.statSync(logFile).size;
      if (newSize <= fileSize) { fileSize = newSize; return; }
      const chunk = fs.createReadStream(logFile, { start: fileSize, encoding: 'utf8' });
      fileSize = newSize;
      const rl2 = readline.createInterface({ input: chunk });
      rl2.on('line', (line) => { if (line) broadcast({ type: 'log', instanceId: inst.id, line }); });
    });
    tailWatchers.set(inst.id, watcher);
  });
}
