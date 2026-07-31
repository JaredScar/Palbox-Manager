import { Router } from 'express';
import fs from 'fs';
import readline from 'readline';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { resolveInstance } from '../middleware/instance.js';
import { getDb } from '../db/index.js';
import type { ChatMessage } from '../db/types.js';

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

export default router;
