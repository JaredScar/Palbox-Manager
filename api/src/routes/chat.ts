import { Router } from 'express';
import fs from 'fs';
import readline from 'readline';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { resolveInstance } from '../middleware/instance.js';
import { getDb } from '../db/index.js';
import type { ChatMessage } from '../db/types.js';
import { getTailStatus } from '../ws.js';
import { resolveLogFile, explainMissingLog } from '../lib/logfile.js';
import { enableFileLogging } from '../services/palserver.js';

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

  const logFile = resolveLogFile(inst).file;
  if (!logFile) {
    res.json({ lines: [] }); return;
  }

  try {
    const lines: string[] = [];
    const rl = readline.createInterface({ input: fs.createReadStream(logFile), crlfDelay: Infinity });
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
  const { tailing, buffered, file } = getTailStatus(inst.id);

  // Report the log actually in use, which is not necessarily the configured
  // one: Palworld names its log after the Unreal project (Pal.log), so a
  // configured PalServer.log is a common and previously silent misconfiguration.
  const resolution = resolveLogFile(inst);
  const logPath = file ?? resolution.file ?? inst.log_file ?? '';
  const exists = Boolean(logPath) && fs.existsSync(logPath);

  let sizeBytes: number | null = null;
  let modifiedAt: number | null = null;
  if (exists) {
    try {
      const st = fs.statSync(logPath);
      sizeBytes = st.size;
      modifiedAt = st.mtimeMs;
    } catch { /* raced with a rotation */ }
  }

  const configuredMismatch = Boolean(
    inst.log_file && resolution.file && inst.log_file !== resolution.file,
  );

  let reason: string | null = null;
  if (!exists) {
    reason = explainMissingLog(resolution)
      + (resolution.searched.length ? ` Searched: ${resolution.searched.join(', ')}.` : '');
  } else if (configuredMismatch) {
    reason = `Reading ${logPath}. The configured path (${inst.log_file}) does not exist - Palworld names its log after the Unreal project, so it is Pal.log rather than PalServer.log. Update the instance settings to silence this note.`;
  } else if (!tailing) {
    reason = 'The log file exists but the reader has not attached yet. It retries every 15 seconds.';
  } else if (buffered === 0) {
    reason = 'The reader is running but the server has not written any log lines yet.';
  }

  res.json({
    configured: Boolean(inst.log_file),
    path: logPath,
    configuredPath: inst.log_file ?? '',
    configuredMismatch,
    exists,
    sizeBytes,
    modifiedAt,
    tailing,
    buffered,
    reason,
  });
});

/**
 * Configures the server to produce a log file. Palworld only writes one when
 * launched with -log, so a server that was never given that flag has nothing
 * for the console to read no matter how it is configured here.
 */
router.post('/enable-logging', requirePermission('settings.manage'), async (req, res) => {
  try {
    res.json(await enableFileLogging(req.instance!));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
