import fs from 'fs';
import path from 'path';
import type { Instance } from '../db/types.js';

/**
 * Locating the Palworld server log.
 *
 * The dedicated server is an Unreal project named "Pal", and Unreal names its
 * log after the project - so the file is Pal\Saved\Logs\Pal.log, not the
 * PalServer.log that the executable name suggests. Setup guides get this wrong
 * often enough that the configured path cannot be trusted, and a wrong value
 * used to leave the console silent forever with no explanation.
 *
 * On every start Unreal renames the previous log to Pal-backup-<timestamp>.log
 * and opens a fresh Pal.log, so the presence of backups is a reliable sign
 * that file logging works even when no live log exists yet.
 */

const PREFERRED_NAMES = ['Pal.log', 'PalServer.log'];
const BACKUP_RE = /-backup-.*\.log$/i;

/** Directories worth searching, derived from whatever paths are configured. */
export function candidateLogDirs(inst: Instance): string[] {
  const dirs: string[] = [];
  const add = (d: string | null | undefined) => {
    if (d && !dirs.includes(d)) dirs.push(d);
  };

  // The directory of the configured log file, even if the filename is wrong.
  if (inst.log_file) add(path.dirname(inst.log_file));

  // Anything under a "Saved" folder tells us where Saved\Logs is.
  for (const p of [inst.save_dir, inst.log_file]) {
    if (!p) continue;
    const parts = p.split(/[\\/]/);
    const i = parts.findIndex((s) => s.toLowerCase() === 'saved');
    if (i > 0) add(path.join(...parts.slice(0, i + 1), 'Logs'));
  }

  // From the executable: either <root>\PalServer.exe or the shipping binary
  // three levels down in Pal\Binaries\Win64.
  if (inst.exe_path) {
    const exeDir = path.dirname(inst.exe_path);
    add(path.join(exeDir, 'Pal', 'Saved', 'Logs'));
    add(path.join(exeDir, 'Saved', 'Logs'));
    add(path.join(path.resolve(exeDir, '..', '..'), 'Saved', 'Logs'));
    add(path.join(path.resolve(exeDir, '..', '..', '..'), 'Pal', 'Saved', 'Logs'));
  }

  // The mods folder sits at Pal\Binaries\Win64\Mods, so Pal is three levels up.
  if (inst.mods_dir) {
    add(path.join(path.resolve(inst.mods_dir, '..', '..', '..'), 'Saved', 'Logs'));
  }

  return dirs;
}

export interface LogFileResolution {
  /** The log to tail, or null when nothing usable exists yet. */
  file: string | null;
  /** Directories that were searched, for reporting back to the user. */
  searched: string[];
  /** A rotated log was found, so file logging is working. */
  backupsFound: boolean;
}

export function resolveLogFile(inst: Instance): LogFileResolution {
  const searched = candidateLogDirs(inst);

  // An explicitly configured file that actually exists always wins, so anyone
  // with a non-standard setup keeps control.
  if (inst.log_file && fs.existsSync(inst.log_file)) {
    return { file: inst.log_file, searched, backupsFound: false };
  }

  let backupsFound = false;
  let newest: { file: string; mtime: number } | null = null;

  for (const dir of searched) {
    let entries: string[];
    try { entries = fs.readdirSync(dir); } catch { continue; }

    for (const name of PREFERRED_NAMES) {
      const hit = entries.find((e) => e.toLowerCase() === name.toLowerCase());
      if (hit) return { file: path.join(dir, hit), searched, backupsFound };
    }

    for (const entry of entries) {
      if (!entry.toLowerCase().endsWith('.log')) continue;
      if (BACKUP_RE.test(entry)) { backupsFound = true; continue; }
      const full = path.join(dir, entry);
      try {
        const { mtimeMs } = fs.statSync(full);
        if (!newest || mtimeMs > newest.mtime) newest = { file: full, mtime: mtimeMs };
      } catch { /* vanished between readdir and stat */ }
    }
  }

  return { file: newest?.file ?? null, searched, backupsFound };
}

/** Plain-language explanation of why no log could be found. */
export function explainMissingLog(res: LogFileResolution): string {
  if (res.file) return '';
  if (res.backupsFound) {
    return 'Only rotated logs (Pal-backup-*.log) were found, so file logging works but the server has not opened a new log this run. It should appear shortly after the server starts.';
  }
  return 'No log file was found. Palworld is an Unreal shipping build and only writes Pal\\Saved\\Logs\\Pal.log when it is launched with -log, so a server started without that flag produces no log at all. RCON and the REST API cannot fill the gap - neither exposes a log or console stream - so until logging is enabled the console shows Palbox\'s own event feed instead.';
}
