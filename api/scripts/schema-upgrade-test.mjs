/**
 * Checks that the schema applies to an *existing* database, not just a fresh one.
 *
 * CREATE TABLE IF NOT EXISTS is a no-op on a database that already has the
 * table, so a column added to one of those definitions only reaches an upgraded
 * install through the ALTER TABLE migrations further down. Anything that refers
 * to such a column - an index, most easily - has to run after those migrations,
 * or the panel refuses to boot on every existing install while looking perfectly
 * healthy on a new one.
 *
 * Each phase runs in its own process because the module caches its connection,
 * and a service start is exactly a fresh process opening an existing file.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import Database from 'better-sqlite3';

const here = path.dirname(fileURLToPath(import.meta.url));
// Forward slashes so the path survives being embedded in the child's source.
const dbModule = path.join(here, '..', 'dist', 'db', 'index.js').replace(/\\/g, '/');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'palbox-schema-'));
const dbPath = path.join(dir, 'palbox.db');

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`PASS  ${label}`);
  } catch (err) {
    failures++;
    const detail = (err.stderr?.toString() || err.message).trim().split('\n').slice(0, 4).join('\n      ');
    console.log(`FAIL  ${label}\n      ${detail}`);
  }
}

/** Boots the schema the way the server does: a new process opening cfg.dbPath. */
const applySchema = () => execFileSync(
  process.execPath,
  ['-e', `require(${JSON.stringify(dbModule)}).getDb()`],
  { env: { ...process.env, DB_PATH: dbPath }, cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] },
);

const columns = (db, table) =>
  db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

check('schema applies to a new database', applySchema);

check('new database has the joined columns', () => {
  const db = new Database(dbPath);
  try {
    for (const [table, col] of [['pals', 'container_id'], ['base_camps', 'worker_container_id']]) {
      if (!columns(db, table).includes(col)) throw new Error(`${table}.${col} missing`);
    }
  } finally { db.close(); }
});

// Rewind to a database shaped like one from before the camp inspector. Dropping
// the columns is the closest we get to an older install without committing a
// fixture database.
check('rewind the database to the previous schema', () => {
  const db = new Database(dbPath);
  try {
    db.exec('DROP INDEX IF EXISTS idx_pals_container');
    for (const [table, col] of [
      ['pals', 'container_id'], ['pals', 'sanity'], ['pals', 'sick'],
      ['base_camps', 'worker_container_id'],
    ]) {
      db.exec(`ALTER TABLE ${table} DROP COLUMN ${col}`);
    }
  } finally { db.close(); }
});

check('schema applies to a database predating the camp inspector', applySchema);

check('upgraded database regains the columns and the index', () => {
  const db = new Database(dbPath);
  try {
    if (!columns(db, 'pals').includes('container_id')) throw new Error('pals.container_id missing');
    if (!columns(db, 'base_camps').includes('worker_container_id')) throw new Error('base_camps.worker_container_id missing');
    const index = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_pals_container'",
    ).get();
    if (!index) throw new Error('idx_pals_container was not created');
  } finally { db.close(); }
});

fs.rmSync(dir, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} schema check(s) failed.`);
  process.exit(1);
}
console.log('\nAll schema upgrade checks passed.');
