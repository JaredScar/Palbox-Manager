import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { resolveInstance } from '../middleware/instance.js';
import { getAuditLog } from '../services/audit.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, resolveInstance);

router.get('/', (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? '200'), 10), 500);
  res.json(getAuditLog(req.instance!.id, limit));
});

export default router;
