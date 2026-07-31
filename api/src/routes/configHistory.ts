import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { resolveInstance } from '../middleware/instance.js';
import { listSnapshots, getSnapshot, diffSnapshots } from '../services/configHistory.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, resolveInstance);

router.get('/', (req, res) => {
  res.json(listSnapshots(req.instance!.id));
});

router.get('/:id', (req, res) => {
  const snap = getSnapshot(parseInt(req.params.id, 10), req.instance!.id);
  if (!snap) { res.status(404).json({ error: 'Snapshot not found' }); return; }
  res.json(snap);
});

router.get('/:id/diff', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const snap = getSnapshot(id, req.instance!.id);
  if (!snap) { res.status(404).json({ error: 'Snapshot not found' }); return; }

  // Get previous snapshot
  const all = listSnapshots(req.instance!.id);
  const idx = all.findIndex((s) => s.id === id);
  const prevId = all[idx + 1]?.id;
  if (!prevId) { res.json({ diff: snap.content.split('\n').map((l) => ({ type: '+', line: l })) }); return; }

  const prev = getSnapshot(prevId, req.instance!.id);
  if (!prev) { res.status(404).json({ error: 'Previous snapshot not found' }); return; }

  res.json({ diff: diffSnapshots(prev.content, snap.content), from: prev.created_at, to: snap.created_at });
});

export default router;
