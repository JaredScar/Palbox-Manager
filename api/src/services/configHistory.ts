import crypto from 'crypto';
import fs from 'fs';
import { getDb } from '../db/index.js';
import type { Instance } from '../db/types.js';

export interface ConfigSnapshot {
  id: number;
  instance_id: number;
  content: string;
  hash: string;
  created_at: number;
}

/** Save a new config snapshot if the content has changed since the last one. */
export function snapshotConfig(inst: Instance): void {
  if (!inst.settings_ini || !fs.existsSync(inst.settings_ini)) return;
  try {
    const content = fs.readFileSync(inst.settings_ini, 'utf8');
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const db = getDb();
    const last = db
      .prepare('SELECT hash FROM config_snapshots WHERE instance_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(inst.id) as { hash: string } | undefined;
    if (last?.hash === hash) return; // no change
    db.prepare('INSERT INTO config_snapshots (instance_id, content, hash) VALUES (?,?,?)').run(inst.id, content, hash);
    // Keep last 30 snapshots
    db.prepare(`
      DELETE FROM config_snapshots WHERE instance_id = ? AND id NOT IN (
        SELECT id FROM config_snapshots WHERE instance_id = ? ORDER BY created_at DESC LIMIT 30
      )
    `).run(inst.id, inst.id);
  } catch { /* file not readable */ }
}

export function listSnapshots(instanceId: number): Omit<ConfigSnapshot, 'content'>[] {
  return getDb()
    .prepare('SELECT id, instance_id, hash, created_at FROM config_snapshots WHERE instance_id = ? ORDER BY created_at DESC')
    .all(instanceId) as Omit<ConfigSnapshot, 'content'>[];
}

export function getSnapshot(id: number, instanceId: number): ConfigSnapshot | undefined {
  return getDb()
    .prepare('SELECT * FROM config_snapshots WHERE id = ? AND instance_id = ?')
    .get(id, instanceId) as ConfigSnapshot | undefined;
}

/** Produce a simple line-by-line diff between two snapshot contents. */
export function diffSnapshots(older: string, newer: string): { type: '+' | '-' | ' '; line: string }[] {
  const oldLines = older.split('\n');
  const newLines = newer.split('\n');
  const result: { type: '+' | '-' | ' '; line: string }[] = [];

  // Create sets for quick lookup
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);

  // Walk old lines
  for (const line of oldLines) {
    if (newSet.has(line)) result.push({ type: ' ', line });
    else result.push({ type: '-', line });
  }
  // Add new lines not in old
  for (const line of newLines) {
    if (!oldSet.has(line)) result.push({ type: '+', line });
  }
  return result;
}
