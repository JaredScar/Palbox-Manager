import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { resolveInstance } from '../middleware/instance.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, resolveInstance);

export interface SaveEntry {
  name: string;
  relativePath: string;
  isDir: boolean;
  size: number;
  modifiedAt: number;   // unix seconds
}

function listDir(baseDir: string, relDir = ''): SaveEntry[] {
  const absDir = path.join(baseDir, relDir);
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(absDir, { withFileTypes: true }); }
  catch { return []; }

  const result: SaveEntry[] = [];
  for (const ent of entries) {
    const relPath = relDir ? `${relDir}/${ent.name}` : ent.name;
    try {
      const stat = fs.statSync(path.join(absDir, ent.name));
      result.push({
        name: ent.name,
        relativePath: relPath,
        isDir: ent.isDirectory(),
        size: stat.isFile() ? stat.size : 0,
        modifiedAt: Math.floor(stat.mtimeMs / 1000),
      });
    } catch {}
  }
  // Directories first, then files; each group sorted alphabetically
  result.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return result;
}

/** GET /instances/:id/savebrowser?dir=... — list a directory in the save folder */
router.get('/', requirePermission('backups.view'), (req, res) => {
  const inst = req.instance!;
  if (!inst.save_dir) { res.status(400).json({ error: 'No save_dir configured' }); return; }

  // Sanitise the requested sub-dir — prevent path traversal
  const rawDir = String(req.query.dir ?? '');
  const safeDir = path.normalize(rawDir).replace(/^(\.\.(\/|\\|$))+/, '');

  const entries = listDir(inst.save_dir, safeDir);
  res.json({ saveDir: inst.save_dir, dir: safeDir, entries });
});

/** GET /instances/:id/savebrowser/download?path=... — download a single file */
router.get('/download', requirePermission('backups.view'), (req, res) => {
  const inst = req.instance!;
  if (!inst.save_dir) { res.status(400).json({ error: 'No save_dir configured' }); return; }

  const rawPath = String(req.query.path ?? '');
  if (!rawPath) { res.status(400).json({ error: 'path required' }); return; }

  // Sanitise — prevent path traversal
  const safePath = path.normalize(rawPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const absPath  = path.join(inst.save_dir, safePath);

  // Ensure the resolved path is still inside save_dir
  if (!absPath.startsWith(path.resolve(inst.save_dir))) {
    res.status(403).json({ error: 'Forbidden' }); return;
  }

  if (!fs.existsSync(absPath) || fs.statSync(absPath).isDirectory()) {
    res.status(404).json({ error: 'File not found' }); return;
  }

  res.download(absPath, path.basename(absPath));
});

export default router;
