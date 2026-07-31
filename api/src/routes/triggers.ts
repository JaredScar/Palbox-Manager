import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { resolveInstance } from '../middleware/instance.js';
import { listTriggers, createTrigger, updateTrigger, deleteTrigger } from '../services/eventTriggers.js';
import { logAction } from '../services/audit.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, resolveInstance);

router.get('/', (req, res) => res.json(listTriggers(req.instance!.id)));

router.post('/', (req, res) => {
  try {
    const t = createTrigger(req.instance!.id, req.body);
    logAction(req.instance!.id, 'trigger.create', t.name);
    res.json(t);
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

router.patch('/:id', (req, res) => {
  try {
    updateTrigger(parseInt(req.params.id, 10), req.instance!.id, req.body);
    logAction(req.instance!.id, 'trigger.update', `id=${req.params.id}`);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

router.delete('/:id', (req, res) => {
  deleteTrigger(parseInt(req.params.id, 10), req.instance!.id);
  logAction(req.instance!.id, 'trigger.delete', `id=${req.params.id}`);
  res.json({ ok: true });
});

export default router;
