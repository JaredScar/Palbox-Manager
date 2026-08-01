import { Router } from 'express';
import fs from 'fs';
import readline from 'readline';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { resolveInstance } from '../middleware/instance.js';
import { getDb } from '../db/index.js';
import type { ChatMessage } from '../db/types.js';
import { getTailStatus } from '../ws.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, resolveInstance);

// Return stored chat messages (captured by log poller)
router.get('/', requirePermission('console.view'), (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? '100'), 10), 500);
  const rows = getDb()
    .prepare('SELECT * FROM chat_messages WHERE instance_id = ? ORDER BY captured_at DESC LIMIT ?')
    .all(req.instance!.id, limit) as ChatMessage[];
  res.json(rows.reverse());
});

// Return raw log lines (last N lines, with optional search)
router.get('/log', requirePermission('console.view'), async (req, res) => {
  const inst = req.instance!;
  const search = String(req.query.search ?? '').toLowerCase();
  const tail = Math.min(parseInt(String(req.query.tail ?? '200'), 10), 1000);

  if (!inst.log_file || !fs.existsSync(inst.log_file)) {
    res.json({ lines: [] }); return;
  }

  try {
    const lines: string[] = [];
    const rl = readline.createInterface({ input: fs.createReadStream(inst.log_file), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!search || line.toLowerCase().includes(search)) lines.push(line);
    }
    res.json({ lines: lines.slice(-tail) });
  } catch {
    res.json({ lines: [] });
  }
});

/**
 * Why the live console is or is not producing output. The stream goes quiet
 * for several unrelated reasons - no log path set, path set but the file is
 * missing, poller not started - and they need different fixes.
 */
router.get('/log-status', requirePermission('console.view'), (req, res) => {
  const inst = req.instance!;
  const path = inst.log_file ?? '';
  const configured = Boolean(path);
  const exists = configured && fs.existsSync(path);

  let sizeBytes: number | null = null;
  let modifiedAt: number | null = null;
  if (exists) {
    try {
      const st = fs.statSync(path);
      sizeBytes = st.size;
      modifiedAt = st.mtimeMs;
    } catch { /* raced with a rotation */ }
  }

  const { tailing, buffered } = getTailStatus(inst.id);

  let reason: string | null = null;
  if (!configured) {
    reason = 'No log file is configured for this server, so there is nothing to stream. Set "Log file" in the instance settings to your Palworld log, usually Pal\\Saved\\Logs\\Pal.log inside the server folder.';
  } else if (!exists) {
    reason = `The configured log file does not exist yet: ${path}. Palworld creates it on first start, and Palbox retries every 15 seconds.`;
  } else if (!tailing) {
    reason = 'The log file exists but the reader is not running. Restarting the Palbox service will start it.';
  } else if (buffered === 0) {
    reason = 'The reader is running but the server has not written any log lines yet.';
  }

  res.json({ configured, path, exists, sizeBytes, modifiedAt, tailing, buffered, reason });
});

export default router;
