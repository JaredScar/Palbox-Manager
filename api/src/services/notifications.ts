import { getDb } from '../db/index.js';
import { broadcast } from '../ws.js';

export interface Notification {
  id: number;
  instance_id: number | null;
  title: string;
  body: string;
  level: 'info' | 'warn' | 'error' | 'success';
  read: number;
  created_at: number;
}

export function pushNotification(
  instanceId: number | null,
  title: string,
  body = '',
  level: Notification['level'] = 'info',
): void {
  const db = getDb();
  const result = db
    .prepare('INSERT INTO notifications (instance_id, title, body, level) VALUES (?,?,?,?)')
    .run(instanceId, title, body, level);

  const notif: Notification = {
    id: Number(result.lastInsertRowid),
    instance_id: instanceId,
    title,
    body,
    level,
    read: 0,
    created_at: Math.floor(Date.now() / 1000),
  };

  // Broadcast to all WS clients so the bell updates in real-time
  broadcast({ type: 'notification', notification: notif });

  // Keep only last 100 per instance
  db.prepare(
    `DELETE FROM notifications WHERE instance_id ${instanceId == null ? 'IS NULL' : '= ?'}
     AND id NOT IN (
       SELECT id FROM notifications WHERE instance_id ${instanceId == null ? 'IS NULL' : '= ?'}
       ORDER BY created_at DESC LIMIT 100
     )`,
  ).run(...(instanceId == null ? [] : [instanceId, instanceId]));
}

export function listNotifications(instanceId: number | null, limit = 50): Notification[] {
  const db = getDb();
  if (instanceId == null) {
    return db
      .prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Notification[];
  }
  return db
    .prepare('SELECT * FROM notifications WHERE instance_id = ? OR instance_id IS NULL ORDER BY created_at DESC LIMIT ?')
    .all(instanceId, limit) as Notification[];
}

export function countUnread(instanceId: number | null): number {
  const db = getDb();
  if (instanceId == null) {
    return (db.prepare('SELECT COUNT(*) as c FROM notifications WHERE read = 0').get() as { c: number }).c;
  }
  return (
    db.prepare('SELECT COUNT(*) as c FROM notifications WHERE read = 0 AND (instance_id = ? OR instance_id IS NULL)').get(instanceId) as { c: number }
  ).c;
}

export function markAllRead(instanceId: number | null): void {
  const db = getDb();
  if (instanceId == null) {
    db.prepare('UPDATE notifications SET read = 1').run();
  } else {
    db.prepare('UPDATE notifications SET read = 1 WHERE instance_id = ? OR instance_id IS NULL').run(instanceId);
  }
}
