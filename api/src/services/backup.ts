import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import cron from 'node-cron';
import { getDb } from '../db';
import type { Instance } from '../db/types';
import { log } from '../lib/logger';
import { sendDiscord } from './discord';

export interface BackupRecord {
  id: number;
  instance_id: number;
  filename: string;
  filepath: string;
  size_bytes: number;
  type: 'auto' | 'manual';
  created_at: number;
}

export function listBackups(instanceId: number): BackupRecord[] {
  return getDb()
    .prepare('SELECT * FROM backups WHERE instance_id = ? ORDER BY created_at DESC')
    .all(instanceId) as BackupRecord[];
}

export async function createBackup(inst: Instance, type: 'auto' | 'manual'): Promise<BackupRecord> {
  const now = new Date();
  const stamp = now.toISOString().replace(/:/g, '').replace('T', '_').slice(0, 15);
  const filename = `${stamp}.zip`;
  const filepath = path.join(inst.backup_dir, filename);

  fs.mkdirSync(inst.backup_dir, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(filepath);
    const archive = archiver('zip', { zlib: { level: 6 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(inst.save_dir, false);
    archive.finalize();
  });

  const size = fs.statSync(filepath).size;
  const db = getDb();
  const result = db
    .prepare('INSERT INTO backups (instance_id, filename, filepath, size_bytes, type) VALUES (?,?,?,?,?)')
    .run(inst.id, filename, filepath, size, type);

  await pruneOldBackups(inst);
  log.info(`[${inst.name}] Backup created: ${filename} (${(size / 1024 / 1024).toFixed(1)} MB)`);

  return db.prepare('SELECT * FROM backups WHERE id = ?').get(result.lastInsertRowid) as BackupRecord;
}

async function pruneOldBackups(inst: Instance): Promise<void> {
  const db = getDb();
  const settings = db.prepare("SELECT value FROM settings WHERE instance_id = ? AND key = 'backup_retention_days'")
    .get(inst.id) as { value: string } | undefined;
  const retentionDays = settings ? parseInt(settings.value, 10) : 7;
  const cutoff = Math.floor(Date.now() / 1000) - retentionDays * 86400;
  const old = db
    .prepare('SELECT * FROM backups WHERE instance_id = ? AND created_at < ?')
    .all(inst.id, cutoff) as BackupRecord[];
  for (const b of old) {
    try {
      if (fs.existsSync(b.filepath)) fs.unlinkSync(b.filepath);
      db.prepare('DELETE FROM backups WHERE id = ?').run(b.id);
      log.info(`[${inst.name}] Pruned old backup: ${b.filename}`);
    } catch (err) {
      log.warn(`Failed to prune backup ${b.filename}:`, err);
    }
  }
}

export function deleteBackup(id: number, instanceId: number): void {
  const db = getDb();
  const b = db.prepare('SELECT * FROM backups WHERE id = ? AND instance_id = ?').get(id, instanceId) as BackupRecord | undefined;
  if (!b) throw new Error('Backup not found');
  if (fs.existsSync(b.filepath)) fs.unlinkSync(b.filepath);
  db.prepare('DELETE FROM backups WHERE id = ?').run(id);
}

const cronJobs = new Map<number, ReturnType<typeof cron.schedule>>();

export function startBackupScheduler(inst: Instance): void {
  cronJobs.get(inst.id)?.stop();

  const db = getDb();

  // Check the new backup_schedule table first
  const schedRow = db.prepare('SELECT * FROM backup_schedule WHERE instance_id = ?').get(inst.id) as
    | { frequency: string; hour: number; day_of_week: number; enabled: number } | undefined;

  // Derive cron expression from schedule config
  let cronExpr: string;
  if (!schedRow || !schedRow.enabled || schedRow.frequency === 'off') {
    log.info(`[${inst.name}] Backup scheduler disabled`);
    return;
  } else if (schedRow.frequency === 'hourly') {
    cronExpr = `0 * * * *`;
  } else if (schedRow.frequency === 'weekly') {
    cronExpr = `0 ${schedRow.hour} * * ${schedRow.day_of_week}`;
  } else {
    // daily (default)
    cronExpr = `0 ${schedRow.hour} * * *`;
  }

  // Fall back to legacy settings key
  if (!schedRow) {
    const cronRow = db.prepare("SELECT value FROM settings WHERE instance_id = ? AND key = 'backup_cron'").get(inst.id) as { value: string } | undefined;
    cronExpr = cronRow?.value ?? '0 4 * * *';
  }

  const job = cron.schedule(cronExpr, async () => {
    log.info(`[${inst.name}] Running scheduled backup…`);
    try {
      await createBackup(inst, 'auto');
    } catch (err) {
      log.error(`[${inst.name}] Scheduled backup failed:`, err);
      await sendDiscord(inst, `**Palbox** — \`${inst.name}\` backup failed: ${(err as Error).message}`, 'backup_failed');
    }
  });

  cronJobs.set(inst.id, job);
  log.info(`[${inst.name}] Backup scheduler started (${cronExpr})`);
}

export function getBackupSchedule(instanceId: number): { frequency: string; hour: number; day_of_week: number; enabled: number } {
  const db = getDb();
  const row = db.prepare('SELECT * FROM backup_schedule WHERE instance_id = ?').get(instanceId) as
    { frequency: string; hour: number; day_of_week: number; enabled: number } | undefined;
  return row ?? { frequency: 'daily', hour: 3, day_of_week: 0, enabled: 1 };
}

export function updateBackupSchedule(
  inst: Instance,
  patch: Partial<{ frequency: string; hour: number; day_of_week: number; enabled: number }>,
): void {
  const db = getDb();
  const current = getBackupSchedule(inst.id);
  const merged = { ...current, ...patch };
  db.prepare(`
    INSERT INTO backup_schedule (instance_id, frequency, hour, day_of_week, enabled)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(instance_id) DO UPDATE SET
      frequency = excluded.frequency,
      hour = excluded.hour,
      day_of_week = excluded.day_of_week,
      enabled = excluded.enabled
  `).run(inst.id, merged.frequency, merged.hour, merged.day_of_week, merged.enabled);
  startBackupScheduler(inst);
}
