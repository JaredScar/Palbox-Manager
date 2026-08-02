/**
 * Keeps the guild and base camp cache in step with the server's Level.sav.
 *
 * None of this data is reachable over RCON or the REST API, so the save file
 * is the only source for it. Scans are driven by the file's modification time
 * rather than a fixed schedule: Palworld rewrites Level.sav on each autosave,
 * and re-reading an unchanged world would be pure waste.
 */
import fs from 'fs';
import path from 'path';
import { getDb } from '../db/index.js';
import { log } from '../lib/logger.js';
import { parseLevelSave, parsePalStorage } from '../lib/palsav/levelSave.js';
import type { PalRecord } from '../lib/palsav/characters.js';
import type { Instance } from '../db/types.js';

const SCAN_INTERVAL_MS = 5 * 60 * 1000;
/**
 * Guards against loading something enormous into memory by accident. Real
 * worlds are tens of megabytes; anything past this is not a save we can help
 * with, and refusing beats exhausting the host's RAM.
 */
const MAX_SAVE_BYTES = 512 * 1024 * 1024;

const timers = new Map<number, NodeJS.Timeout>();
const lastScanned = new Map<number, number>();
const status = new Map<number, ScanStatus>();

export interface ScanStatus {
  file: string | null;
  scannedAt: number | null;
  savedAt: number | null;
  guilds: number;
  bases: number;
  pals: number;
  error: string | null;
  scanning: boolean;
}

/** A status for a scan that could not run, so callers always get the shape. */
function failed(file: string | null, savedAt: number | null, error: string): ScanStatus {
  return { file, scannedAt: Date.now(), savedAt, guilds: 0, bases: 0, pals: 0, error, scanning: false };
}

/**
 * Finds Level.sav under the instance's save directory.
 *
 * Palworld nests it as SaveGames/<userId>/<worldId>/Level.sav, and a host that
 * has run more than one world will have several. The most recently written one
 * is the live world.
 */
export function findLevelSave(inst: Instance): string | null {
  if (!inst.save_dir) return null;

  const roots = [
    path.join(inst.save_dir, 'SaveGames'),
    // Tolerate save_dir pointing at SaveGames, or at a world folder directly.
    inst.save_dir,
  ];

  const found: { file: string; mtime: number }[] = [];

  const walk = (dir: string, depth: number) => {
    if (depth > 3) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full, depth + 1);
      } else if (e.name.toLowerCase() === 'level.sav') {
        try {
          const st = fs.statSync(full);
          if (st.isFile()) found.push({ file: full, mtime: st.mtimeMs });
        } catch { /* vanished between readdir and stat */ }
      }
    }
  };

  for (const root of roots) {
    walk(root, 0);
    if (found.length) break;
  }

  found.sort((a, b) => b.mtime - a.mtime);
  return found[0]?.file ?? null;
}

/** Player save file names are a GUID with the dashes stripped. */
function uidFromFileName(name: string): string | null {
  const hex = name.replace(/_dps\.sav$/i, '').replace(/\.sav$/i, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) return null;
  const g = hex.toLowerCase();
  return `${g.slice(0, 8)}-${g.slice(8, 12)}-${g.slice(12, 16)}-${g.slice(16, 20)}-${g.slice(20)}`;
}

/**
 * Reads the Pal box storage that sits beside a world save.
 *
 * Failures here are per-file and silent by design: an unreadable storage file
 * should cost that player's Pal box, not the whole scan.
 */
async function readPalStorage(levelSaveFile: string): Promise<PalRecord[]> {
  const dir = path.join(path.dirname(levelSaveFile), 'Players');
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => /_dps\.sav$/i.test(f));
  } catch {
    return [];
  }

  const out: PalRecord[] = [];
  for (const file of files) {
    const full = path.join(dir, file);
    try {
      if (fs.statSync(full).size > MAX_SAVE_BYTES) continue;
      const pals = await parsePalStorage(await fs.promises.readFile(full));
      // Stored Pals often have no owner recorded on the record itself, so the
      // file they live in is what attributes them.
      const owner = uidFromFileName(file);
      for (const p of pals) out.push({ ...p, ownerPlayerId: p.ownerPlayerId ?? owner });
    } catch {
      continue;
    }
  }
  return out;
}

function persist(instanceId: number, data: Awaited<ReturnType<typeof parseLevelSave>>): void {
  const db = getDb();
  // Replaced in one transaction so a reader never sees a half-updated world.
  const write = db.transaction(() => {
    db.prepare('DELETE FROM guilds WHERE instance_id = ?').run(instanceId);
    db.prepare('DELETE FROM base_camps WHERE instance_id = ?').run(instanceId);

    const insGuild = db.prepare(
      `INSERT INTO guilds (instance_id, group_id, name, base_camp_level, admin_player_id, members, member_count, updated_at)
       VALUES (?,?,?,?,?,?,?,unixepoch())`,
    );
    for (const g of data.guilds) {
      insGuild.run(
        instanceId, g.groupId, g.name, g.baseCampLevel, g.adminPlayerId,
        JSON.stringify(g.members), g.members.length,
      );
    }

    const insBase = db.prepare(
      `INSERT INTO base_camps
         (instance_id, base_id, guild_id, x, y, z, area_range, state, worker_container_id, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,unixepoch())`,
    );
    for (const b of data.bases) {
      insBase.run(instanceId, b.id, b.guildId, b.x, b.y, b.z, b.areaRange, b.state, b.workerContainerId);
    }

    db.prepare('DELETE FROM pals WHERE instance_id = ?').run(instanceId);
    const insPal = db.prepare(
      `INSERT OR REPLACE INTO pals (
         instance_id, instance_uid, character_id, nickname, level, exp, gender,
         lucky, boss, rank, talent_hp, talent_melee, talent_shot, talent_defense,
         soul_hp, soul_attack, soul_defence, soul_craftspeed, passives,
         owner_player_id, container_id, sanity, sick, updated_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,unixepoch())`,
    );
    for (const p of data.pals) {
      insPal.run(
        instanceId, p.instanceId, p.characterId, p.nickname, p.level, p.exp, p.gender,
        p.lucky ? 1 : 0, p.boss ? 1 : 0, p.rank,
        p.talentHp, p.talentMelee, p.talentShot, p.talentDefense,
        p.soulHp, p.soulAttack, p.soulDefence, p.soulCraftSpeed,
        JSON.stringify(p.passives), p.ownerPlayerId,
        p.containerId, p.sanity, p.sick ? 1 : 0,
      );
    }

    db.prepare('DELETE FROM save_players WHERE instance_id = ?').run(instanceId);
    const insPlayer = db.prepare(
      `INSERT OR REPLACE INTO save_players (instance_id, player_id, name, level, exp, updated_at)
       VALUES (?,?,?,?,?,unixepoch())`,
    );
    for (const pl of data.players) {
      insPlayer.run(instanceId, pl.playerId, pl.name, pl.level, pl.exp);
    }
  });
  write();
}

/**
 * Reads the save if it has changed since the last scan.
 * `force` re-reads regardless, for the manual refresh button.
 */
export async function scanWorldSave(inst: Instance, force = false): Promise<ScanStatus> {
  const current = status.get(inst.id);
  if (current?.scanning) return current;

  const file = findLevelSave(inst);
  if (!file) {
    const s = failed(null, null, inst.save_dir
      ? `No Level.sav found under ${inst.save_dir}. Check the save directory in instance settings.`
      : 'No save directory configured for this instance.');
    status.set(inst.id, s);
    return s;
  }

  let mtime = 0;
  let size = 0;
  try {
    const st = fs.statSync(file);
    mtime = st.mtimeMs;
    size = st.size;
  } catch (e) {
    const s = failed(file, null, `Could not read ${file}: ${(e as Error).message}`);
    status.set(inst.id, s);
    return s;
  }

  if (!force && lastScanned.get(inst.id) === mtime && current && !current.error) return current;

  if (size > MAX_SAVE_BYTES) {
    const s = failed(file, mtime,
      `Level.sav is ${(size / 1024 / 1024).toFixed(0)} MB, above the ${MAX_SAVE_BYTES / 1024 / 1024} MB limit for scanning.`);
    status.set(inst.id, s);
    return s;
  }

  status.set(inst.id, {
    file,
    savedAt: mtime,
    scannedAt: current?.scannedAt ?? null,
    guilds: current?.guilds ?? 0,
    bases: current?.bases ?? 0,
    pals: current?.pals ?? 0,
    error: null,
    scanning: true,
  });

  try {
    const started = Date.now();
    const data = await parseLevelSave(await fs.promises.readFile(file));

    // Merge in the Pal boxes, skipping anything the world already accounted for.
    const seen = new Set(data.pals.map((p) => p.instanceId));
    for (const p of await readPalStorage(file)) {
      if (!seen.has(p.instanceId)) { seen.add(p.instanceId); data.pals.push(p); }
    }

    persist(inst.id, data);
    lastScanned.set(inst.id, mtime);

    const s: ScanStatus = {
      file, scannedAt: Date.now(), savedAt: mtime,
      guilds: data.guilds.length, bases: data.bases.length, pals: data.pals.length,
      error: null, scanning: false,
    };
    status.set(inst.id, s);
    log.info(
      `[${inst.name}] World save scanned in ${Date.now() - started}ms: ` +
      `${data.guilds.length} guild(s), ${data.bases.length} base camp(s), ${data.pals.length} pal(s)`,
    );
    return s;
  } catch (e) {
    const s = failed(file, mtime, `Could not read the world save: ${(e as Error).message}`);
    status.set(inst.id, s);
    log.warn(`[${inst.name}] World save scan failed:`, e);
    return s;
  }
}

export function getScanStatus(instanceId: number): ScanStatus | null {
  return status.get(instanceId) ?? null;
}

export function startWorldSaveScanner(inst: Instance): void {
  if (timers.has(inst.id)) clearInterval(timers.get(inst.id)!);
  timers.set(inst.id, setInterval(() => {
    scanWorldSave(inst).catch((e) => log.warn(`[${inst.name}] World save scan tick failed:`, e));
  }, SCAN_INTERVAL_MS));
  // Delayed so a panel restart is not competing with the server coming up.
  setTimeout(() => { scanWorldSave(inst).catch(() => {}); }, 20_000);
}

export function stopWorldSaveScanner(instanceId: number): void {
  const t = timers.get(instanceId);
  if (t) { clearInterval(t); timers.delete(instanceId); }
}
