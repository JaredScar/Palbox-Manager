import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { resolveInstance } from '../middleware/instance.js';
import { listNotifications, countUnread, markAllRead } from '../services/notifications.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, resolveInstance);

router.get('/', requirePermission('notifications.view'), (req, res) => {
  const limit = parseInt(String(req.query.limit ?? '50'), 10);
  res.json(listNotifications(req.instance!.id, limit));
});

router.get('/unread', requirePermission('notifications.view'), (req, res) => {
  res.json({ count: countUnread(req.instance!.id) });
});

router.post('/read', requirePermission('notifications.view'), (_req, res) => {
  // Accepts instanceId from resolveInstance middleware
  markAllRead(_req.instance!.id);
  res.json({ ok: true });
});

export default router;
