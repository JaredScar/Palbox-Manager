import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getDb } from '../db';
import type { Instance } from '../db/types';
import { log } from '../lib/logger';

const execAsync = promisify(exec);

export interface Mod {
  id: number;
  instance_id: number;
  name: string;
  folder_name: string;
  version: string;
  enabled: number;
  build_id: string;
  installed_at: number;
}

export function listMods(instanceId: number): Mod[] {
  return getDb().prepare('SELECT * FROM mods WHERE instance_id = ? ORDER BY name ASC').all(instanceId) as Mod[];
}

export function toggleMod(id: number, instanceId: number, enabled: boolean): void {
  const db = getDb();
  const mod = db.prepare('SELECT * FROM mods WHERE id = ? AND instance_id = ?').get(id, instanceId) as Mod | undefined;
  if (!mod) throw new Error('Mod not found');

  const inst = db.prepare('SELECT * FROM instances WHERE id = ?').get(instanceId) as Instance | undefined;
  const modsDir = inst?.mods_dir ?? '';
  if (modsDir) {
    const disabledMarker = path.join(modsDir, mod.folder_name, '.disabled');
    if (enabled) { if (fs.existsSync(disabledMarker)) fs.unlinkSync(disabledMarker); }
    else { fs.mkdirSync(path.dirname(disabledMarker), { recursive: true }); fs.writeFileSync(disabledMarker, ''); }
  }

  db.prepare('UPDATE mods SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  log.info(`Mod ${mod.name} ${enabled ? 'enabled' : 'disabled'}`);
}

export async function installModZip(inst: Instance, zipPath: string, modName: string): Promise<Mod> {
  if (!inst.mods_dir) {
    throw new Error('mods_dir is not configured for this instance. Set it in Settings → Server instances.');
  }

  const folderName = modName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const destDir = path.join(inst.mods_dir, folderName);
  fs.mkdirSync(destDir, { recursive: true });

  // Use -EncodedCommand to avoid shell quoting issues under NSSM/SYSTEM
  const psCmd = `Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`;
  const encoded = Buffer.from(psCmd, 'utf16le').toString('base64');
  await execAsync(
    `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`,
    { timeout: 30_000 },
  );
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

  const db = getDb();
  const existing = db.prepare('SELECT * FROM mods WHERE instance_id = ? AND folder_name = ?').get(inst.id, folderName) as Mod | undefined;
  if (existing) {
    db.prepare('UPDATE mods SET name = ?, installed_at = unixepoch() WHERE id = ?').run(modName, existing.id);
    return db.prepare('SELECT * FROM mods WHERE id = ?').get(existing.id) as Mod;
  }

  const result = db.prepare('INSERT INTO mods (instance_id, name, folder_name, version, enabled) VALUES (?,?,?,?,1)')
    .run(inst.id, modName, folderName, '0.0.0');
  return db.prepare('SELECT * FROM mods WHERE id = ?').get(result.lastInsertRowid) as Mod;
}

export function removeMod(id: number, inst: Instance): void {
  const db = getDb();
  const mod = db.prepare('SELECT * FROM mods WHERE id = ? AND instance_id = ?').get(id, inst.id) as Mod | undefined;
  if (!mod) throw new Error('Mod not found');
  const modFolder = path.join(inst.mods_dir, mod.folder_name);
  if (fs.existsSync(modFolder)) fs.rmSync(modFolder, { recursive: true, force: true });
  db.prepare('DELETE FROM mods WHERE id = ?').run(id);
}
