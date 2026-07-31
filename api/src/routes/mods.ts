import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import os from 'os';
import { requireAuth, requirePermission } from '../middleware/auth';
import { resolveInstance } from '../middleware/instance';
import { listMods, toggleMod, installModZip, removeMod } from '../services/mods';

const router = Router({ mergeParams: true });
router.use(requireAuth, resolveInstance);

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() === '.zip') cb(null, true);
    else cb(new Error('Only .zip files are accepted'));
  },
});

router.get('/', requirePermission('mods.view'), (req, res) => res.json(listMods(req.instance!.id)));

router.post('/upload', requirePermission('mods.manage'), upload.single('mod'), async (req, res) => {
  if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }
  const name = (req.body as { name?: string }).name ?? path.basename(req.file.originalname, '.zip');
  try {
    res.json(await installModZip(req.instance!, req.file.path, name));
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.patch('/:id/toggle', requirePermission('mods.manage'), (req, res) => {
  const { enabled } = req.body as { enabled?: boolean };
  if (enabled === undefined) { res.status(400).json({ error: 'enabled required' }); return; }
  try { toggleMod(parseInt(req.params.id, 10), req.instance!.id, enabled); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.delete('/:id', requirePermission('mods.manage'), (req, res) => {
  try { removeMod(parseInt(req.params.id, 10), req.instance!); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

export default router;
