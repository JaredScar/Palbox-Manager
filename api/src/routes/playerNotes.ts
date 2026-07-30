import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { getDb } from '../db/index.js';
import { logAction } from '../services/audit.js';

const router = Router({ mergeParams: true });

// ── Notes ────────────────────────────────────────────────────────────────────

router.get('/:steamId/notes', requireAuth, (req, res) => {
  const instanceId = parseInt(req.params.instanceId, 10);
  const { steamId } = req.params;
  const notes = getDb()
    .prepare('SELECT * FROM player_notes WHERE instance_id = ? AND steam_id = ? ORDER BY created_at DESC')
    .all(instanceId, steamId);
  res.json(notes);
});

router.post('/:steamId/notes', requireAuth, requireRole('operator'), (req, res) => {
  const instanceId = parseInt(req.params.instanceId, 10);
  const { steamId } = req.params;
  const { note } = req.body as { note?: string };
  if (!note?.trim()) { res.status(400).json({ error: 'note required' }); return; }
  const author = req.auth?.username ?? 'admin';
  const result = getDb()
    .prepare('INSERT INTO player_notes (instance_id, steam_id, note, author) VALUES (?, ?, ?, ?)')
    .run(instanceId, steamId, note.trim(), author);
  logAction(instanceId, 'player.note', `${steamId}: ${note.trim()}`, author);
  res.json({ id: result.lastInsertRowid });
});

router.delete('/:steamId/notes/:noteId', requireAuth, requireRole('operator'), (req, res) => {
  const instanceId = parseInt(req.params.instanceId, 10);
  const { steamId, noteId } = req.params;
  getDb().prepare('DELETE FROM player_notes WHERE id = ? AND instance_id = ? AND steam_id = ?')
    .run(parseInt(noteId, 10), instanceId, steamId);
  res.json({ ok: true });
});

// ── Tags ─────────────────────────────────────────────────────────────────────

router.get('/:steamId/tags', requireAuth, (req, res) => {
  const instanceId = parseInt(req.params.instanceId, 10);
  const { steamId } = req.params;
  const tags = getDb()
    .prepare('SELECT tag, color FROM player_tags WHERE instance_id = ? AND steam_id = ?')
    .all(instanceId, steamId);
  res.json(tags);
});

router.put('/:steamId/tags', requireAuth, requireRole('operator'), (req, res) => {
  const instanceId = parseInt(req.params.instanceId, 10);
  const { steamId } = req.params;
  const { tag, color = '#a79fc7' } = req.body as { tag?: string; color?: string };
  if (!tag?.trim()) { res.status(400).json({ error: 'tag required' }); return; }
  getDb().prepare(
    'INSERT OR REPLACE INTO player_tags (instance_id, steam_id, tag, color) VALUES (?, ?, ?, ?)',
  ).run(instanceId, steamId, tag.trim(), color);
  logAction(instanceId, 'player.tag', `${steamId}: +${tag.trim()}`);
  res.json({ ok: true });
});

router.delete('/:steamId/tags/:tag', requireAuth, requireRole('operator'), (req, res) => {
  const instanceId = parseInt(req.params.instanceId, 10);
  const { steamId, tag } = req.params;
  getDb().prepare('DELETE FROM player_tags WHERE instance_id = ? AND steam_id = ? AND tag = ?')
    .run(instanceId, steamId, tag);
  res.json({ ok: true });
});

export default router;
