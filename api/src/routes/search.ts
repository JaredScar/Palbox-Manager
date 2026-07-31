import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getDb } from '../db/index.js';

const router = Router();

export interface SearchResult {
  type: 'player' | 'chat' | 'audit' | 'note';
  title: string;
  subtitle: string;
  meta?: string;
  instanceId: number;
  instanceName: string;
  ts?: number;
  link?: string;   // front-end route hint
}

/**
 * GET /api/search?q=<query>&instanceId=<id>
 *
 * Searches across:
 *   - players (name, steam_id)
 *   - chat_messages (content, player_name)
 *   - audit_log (action, detail, actor)
 *   - player_notes (note, author)
 *
 * instanceId is optional; omit to search all instances the user can see.
 */
router.get('/', requireAuth, (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (!q || q.length < 2) { res.json({ results: [] }); return; }

  const rawInstanceId = req.query.instanceId ? parseInt(String(req.query.instanceId), 10) : null;
  const like = `%${q}%`;
  const db = getDb();
  const results: SearchResult[] = [];

  // Helper: get instance name
  const instanceNameCache = new Map<number, string>();
  function instanceName(id: number): string {
    if (!instanceNameCache.has(id)) {
      const row = db.prepare('SELECT name FROM instances WHERE id = ?').get(id) as { name: string } | undefined;
      instanceNameCache.set(id, row?.name ?? `#${id}`);
    }
    return instanceNameCache.get(id)!;
  }

  const instanceFilter = rawInstanceId ? 'AND instance_id = ?' : '';
  const instanceParams = rawInstanceId ? [rawInstanceId] : [];

  // ── Players ───────────────────────────────────────────────────────────────
  const players = db.prepare(
    `SELECT instance_id, name, steam_id, last_seen, banned FROM players
     WHERE (name LIKE ? OR steam_id LIKE ?) ${instanceFilter}
     ORDER BY last_seen DESC LIMIT 15`,
  ).all(like, like, ...instanceParams) as {
    instance_id: number; name: string; steam_id: string; last_seen: number | null; banned: number;
  }[];

  for (const p of players) {
    results.push({
      type: 'player',
      title: p.name,
      subtitle: p.steam_id,
      meta: p.banned ? 'banned' : undefined,
      instanceId: p.instance_id,
      instanceName: instanceName(p.instance_id),
      ts: p.last_seen ?? undefined,
      link: '/players',
    });
  }

  // ── Chat messages ──────────────────────────────────────────────────────────
  const chats = db.prepare(
    `SELECT instance_id, player_name, content, captured_at FROM chat_messages
     WHERE (content LIKE ? OR player_name LIKE ?) ${instanceFilter}
     ORDER BY captured_at DESC LIMIT 10`,
  ).all(like, like, ...instanceParams) as {
    instance_id: number; player_name: string; content: string; captured_at: number;
  }[];

  for (const c of chats) {
    results.push({
      type: 'chat',
      title: c.player_name,
      subtitle: c.content.length > 100 ? c.content.slice(0, 97) + '…' : c.content,
      instanceId: c.instance_id,
      instanceName: instanceName(c.instance_id),
      ts: c.captured_at,
      link: '/console',
    });
  }

  // ── Audit log ──────────────────────────────────────────────────────────────
  const audits = db.prepare(
    `SELECT instance_id, actor, action, detail, created_at FROM audit_log
     WHERE (action LIKE ? OR detail LIKE ? OR actor LIKE ?) ${rawInstanceId ? 'AND instance_id = ?' : ''}
     ORDER BY created_at DESC LIMIT 10`,
  ).all(like, like, like, ...(rawInstanceId ? [rawInstanceId] : [])) as {
    instance_id: number | null; actor: string; action: string; detail: string; created_at: number;
  }[];

  for (const a of audits) {
    results.push({
      type: 'audit',
      title: `${a.actor} → ${a.action}`,
      subtitle: a.detail.length > 100 ? a.detail.slice(0, 97) + '…' : a.detail,
      instanceId: a.instance_id ?? 0,
      instanceName: a.instance_id ? instanceName(a.instance_id) : 'Global',
      ts: a.created_at,
      link: '/audit',
    });
  }

  // ── Player notes ───────────────────────────────────────────────────────────
  const notes = db.prepare(
    `SELECT instance_id, steam_id, note, author, created_at FROM player_notes
     WHERE (note LIKE ? OR author LIKE ?) ${instanceFilter}
     ORDER BY created_at DESC LIMIT 10`,
  ).all(like, like, ...instanceParams) as {
    instance_id: number; steam_id: string; note: string; author: string; created_at: number;
  }[];

  for (const n of notes) {
    results.push({
      type: 'note',
      title: `Note by ${n.author}`,
      subtitle: n.note.length > 100 ? n.note.slice(0, 97) + '…' : n.note,
      meta: n.steam_id,
      instanceId: n.instance_id,
      instanceName: instanceName(n.instance_id),
      ts: n.created_at,
      link: '/players',
    });
  }

  // Sort by recency
  results.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));

  res.json({ query: q, results: results.slice(0, 40) });
});

export default router;
