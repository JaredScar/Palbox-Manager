import { getDb } from '../db/index.js';

export function logAction(
  instanceId: number | null,
  action: string,
  detail = '',
  actor = 'admin',
): void {
  getDb()
    .prepare('INSERT INTO audit_log (instance_id, actor, action, detail) VALUES (?,?,?,?)')
    .run(instanceId ?? null, actor, action, detail);
}

export function getAuditLog(
  instanceId: number | null,
  limit = 200,
): { id: number; instance_id: number | null; actor: string; action: string; detail: string; created_at: number }[] {
  const db = getDb();
  if (instanceId !== null) {
    return db
      .prepare(
        'SELECT * FROM audit_log WHERE instance_id = ? OR instance_id IS NULL ORDER BY created_at DESC LIMIT ?',
      )
      .all(instanceId, limit) as ReturnType<typeof getAuditLog>;
  }
  return db
    .prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?')
    .all(limit) as ReturnType<typeof getAuditLog>;
}
