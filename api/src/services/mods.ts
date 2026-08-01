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
  kind: 'ue4ss' | 'pak';
  /** Ships with UE4SS rather than installed by the user. */
  builtin: number;
  rel_path: string;
}

/** Mods that ship with UE4SS itself rather than being installed by the user. */
const UE4SS_BUILTINS = new Set([
  'BPML_GenericFunctions', 'BPModLoaderMod', 'ConsoleCommandsMod', 'ConsoleEnablerMod',
  'SplitScreenMod', 'LineTraceMod', 'jsbLuaProfilerMod', 'Keybinds', 'shared',
]);

interface Discovered {
  folderName: string;
  name: string;
  version: string;
  kind: 'ue4ss' | 'pak';
  enabled: boolean;
  builtin: boolean;
  relPath: string;
}

const readIfPresent = (p: string): string | null => {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
};

/**
 * Version out of a mod's own metadata, when it bothers to ship any. UE4SS has
 * no standard manifest, so several community conventions are tried.
 */
function readVersion(modDir: string): string {
  for (const file of ['mod.json', 'manifest.json', 'package.json', 'modinfo.json']) {
    const raw = readIfPresent(path.join(modDir, file));
    if (!raw) continue;
    try {
      const j = JSON.parse(raw) as Record<string, unknown>;
      const v = j.version ?? j.version_number ?? j.Version;
      if (typeof v === 'string' && v.trim()) return v.trim();
    } catch { /* not valid JSON */ }
  }
  return '0.0.0';
}

/**
 * UE4SS enables mods two ways, and both have to be honoured or the panel will
 * misreport state: an `enabled.txt` inside the mod folder, and a `mods.txt`
 * beside them listing "ModName : 1". Palbox's own `.disabled` marker overrides
 * either, since it is what the toggle in the UI writes.
 */
function ue4ssEnabledState(modsDir: string): (folder: string, modDir: string) => boolean {
  const listed = new Map<string, boolean>();
  const raw = readIfPresent(path.join(modsDir, 'mods.txt'));
  if (raw) {
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) continue;
      const m = trimmed.match(/^(.+?)\s*:\s*(\d)/);
      if (m) listed.set(m[1].trim(), m[2] === '1');
    }
  }
  return (folder, modDir) => {
    if (fs.existsSync(path.join(modDir, '.disabled'))) return false;
    if (listed.has(folder)) return listed.get(folder)!;
    if (fs.existsSync(path.join(modDir, 'enabled.txt'))) return true;
    // No marker anywhere: UE4SS loads it, so report it as enabled.
    return true;
  };
}

/**
 * Pak mods live outside the UE4SS folder entirely, under Content\Paks. The
 * configured mods_dir normally points at Pal\Binaries\Win64\Mods, so the game
 * root is three levels up.
 */
function pakDirs(modsDir: string): string[] {
  const palRoot = path.resolve(modsDir, '..', '..', '..');
  return [
    path.join(palRoot, 'Content', 'Paks', '~mods'),
    path.join(palRoot, 'Content', 'Paks', 'LogicMods'),
  ];
}

/** Everything actually present on disk, across both mod layouts. */
export function scanModsDir(modsDir: string): Discovered[] {
  const found: Discovered[] = [];
  if (!modsDir) return found;

  if (fs.existsSync(modsDir)) {
    const isEnabled = ue4ssEnabledState(modsDir);
    for (const entry of fs.readdirSync(modsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const modDir = path.join(modsDir, entry.name);
      found.push({
        folderName: entry.name,
        name: entry.name,
        version: readVersion(modDir),
        kind: 'ue4ss',
        enabled: isEnabled(entry.name, modDir),
        builtin: UE4SS_BUILTINS.has(entry.name),
        relPath: modDir,
      });
    }
  }

  for (const dir of pakDirs(modsDir)) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      // A .pak renamed to .pak.disabled is the usual way to switch one off.
      if (!entry.isFile() || !/\.pak(\.disabled)?$/i.test(entry.name)) continue;
      const disabled = entry.name.toLowerCase().endsWith('.disabled');
      const base = entry.name.replace(/\.disabled$/i, '');
      found.push({
        folderName: base,
        name: base.replace(/\.pak$/i, ''),
        version: '0.0.0',
        kind: 'pak',
        enabled: !disabled,
        builtin: false,
        relPath: path.join(dir, entry.name),
      });
    }
  }

  return found;
}

/**
 * Reconciles the database against what is on disk.
 *
 * Rows used to be created only by the panel's own upload, so mods installed by
 * hand - which is how most people install them - never appeared at all. Disk
 * is the source of truth for existence and enabled state; the database only
 * carries the id that the toggle and delete endpoints refer to.
 */
export function syncMods(inst: Instance): void {
  const db = getDb();
  const modsDir = inst.mods_dir ?? '';
  if (!modsDir) return;

  let discovered: Discovered[];
  try {
    discovered = scanModsDir(modsDir);
  } catch (e) {
    log.warn(`[${inst.name}] Could not scan the mods directory:`, e);
    return;
  }

  const onDisk = new Set(discovered.map((d) => d.folderName));
  const rows = db.prepare('SELECT * FROM mods WHERE instance_id = ?').all(inst.id) as Mod[];
  const byFolder = new Map(rows.map((r) => [r.folder_name, r]));

  const upsert = db.transaction(() => {
    for (const d of discovered) {
      const existing = byFolder.get(d.folderName);
      if (existing) {
        db.prepare(
          'UPDATE mods SET enabled = ?, version = ?, kind = ?, builtin = ?, rel_path = ? WHERE id = ?',
        ).run(d.enabled ? 1 : 0, d.version, d.kind, d.builtin ? 1 : 0, d.relPath, existing.id);
      } else {
        db.prepare(
          `INSERT INTO mods (instance_id, name, folder_name, version, enabled, kind, builtin, rel_path)
           VALUES (?,?,?,?,?,?,?,?)`,
        ).run(inst.id, d.name, d.folderName, d.version, d.enabled ? 1 : 0, d.kind, d.builtin ? 1 : 0, d.relPath);
      }
    }
    // Drop rows for mods deleted outside the panel.
    for (const row of rows) {
      if (!onDisk.has(row.folder_name)) {
        db.prepare('DELETE FROM mods WHERE id = ?').run(row.id);
      }
    }
  });
  upsert();
}

export function listMods(instanceId: number): Mod[] {
  const inst = getDb().prepare('SELECT * FROM instances WHERE id = ?').get(instanceId) as Instance | undefined;
  if (inst) syncMods(inst);
  return getDb().prepare('SELECT * FROM mods WHERE instance_id = ? ORDER BY builtin ASC, name ASC').all(instanceId) as Mod[];
}

/**
 * Keeps mods.txt in step with a toggle. Where UE4SS is configured through that
 * file it takes precedence over enabled.txt, so leaving it stale would let a
 * mod switched off in the panel keep loading in game.
 */
function syncModsTxt(modsDir: string, folder: string, enabled: boolean): void {
  const file = path.join(modsDir, 'mods.txt');
  const raw = readIfPresent(file);
  if (raw === null) return; // not the convention this install uses

  const flag = enabled ? '1' : '0';
  let replaced = false;
  const lines = raw.split(/\r?\n/).map((line) => {
    const m = line.match(/^(\s*)(.+?)(\s*:\s*)(\d)(.*)$/);
    if (m && m[2].trim() === folder) {
      replaced = true;
      return `${m[1]}${m[2]}${m[3]}${flag}${m[5]}`;
    }
    return line;
  });
  if (!replaced) lines.push(`${folder} : ${flag}`);

  try {
    fs.writeFileSync(file, lines.join('\r\n'));
  } catch (e) {
    log.warn(`Could not update ${file}:`, e);
  }
}

export function toggleMod(id: number, instanceId: number, enabled: boolean): void {
  const db = getDb();
  const mod = db.prepare('SELECT * FROM mods WHERE id = ? AND instance_id = ?').get(id, instanceId) as Mod | undefined;
  if (!mod) throw new Error('Mod not found');

  const inst = db.prepare('SELECT * FROM instances WHERE id = ?').get(instanceId) as Instance | undefined;
  const modsDir = inst?.mods_dir ?? '';

  if (mod.kind === 'pak') {
    // A pak is a single file, so it is switched off by renaming rather than
    // by dropping a marker beside it.
    const current = mod.rel_path;
    if (!current || !fs.existsSync(current)) throw new Error(`Mod file not found: ${current}`);
    const target = enabled
      ? current.replace(/\.disabled$/i, '')
      : (current.toLowerCase().endsWith('.disabled') ? current : `${current}.disabled`);
    if (target !== current) fs.renameSync(current, target);
    db.prepare('UPDATE mods SET enabled = ?, rel_path = ? WHERE id = ?').run(enabled ? 1 : 0, target, id);
  } else {
    if (modsDir) {
      const modDir = path.join(modsDir, mod.folder_name);
      const disabledMarker = path.join(modDir, '.disabled');
      if (enabled) {
        if (fs.existsSync(disabledMarker)) fs.unlinkSync(disabledMarker);
        // UE4SS looks for this, so a mod re-enabled here also loads in game.
        if (fs.existsSync(modDir)) fs.writeFileSync(path.join(modDir, 'enabled.txt'), '');
      } else {
        fs.mkdirSync(modDir, { recursive: true });
        fs.writeFileSync(disabledMarker, '');
        try { fs.unlinkSync(path.join(modDir, 'enabled.txt')); } catch { /* was not present */ }
      }
      syncModsTxt(modsDir, mod.folder_name, enabled);
    }
    db.prepare('UPDATE mods SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  }

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
  if (mod.builtin) throw new Error(`${mod.name} ships with UE4SS and cannot be removed here.`);

  // rel_path is set by the scanner and is the only thing that locates a pak,
  // which lives outside mods_dir entirely.
  const target = mod.rel_path || path.join(inst.mods_dir, mod.folder_name);
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
  db.prepare('DELETE FROM mods WHERE id = ?').run(id);
}
