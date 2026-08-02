import Database from 'better-sqlite3';
import { cfg } from '../config';
import { ALL_PERMISSIONS, BUILTIN_ROLE_PERMISSIONS, BUILTIN_ROLE_DESCRIPTIONS } from '../permissions';

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(cfg.dbPath);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    applySchema(_db);
  }
  return _db;
}

function applySchema(db: Database.Database): void {
  db.exec(`
    -- ── Instances (multi-server) ────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS instances (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL,
      service_name    TEXT NOT NULL,
      exe_path        TEXT NOT NULL DEFAULT '',
      save_dir        TEXT NOT NULL,
      backup_dir      TEXT NOT NULL,
      settings_ini    TEXT NOT NULL,
      log_file        TEXT NOT NULL DEFAULT '',
      rcon_host       TEXT NOT NULL DEFAULT '127.0.0.1',
      rcon_port       INTEGER NOT NULL DEFAULT 25575,
      rcon_password   TEXT NOT NULL DEFAULT '',
      public_ip       TEXT NOT NULL DEFAULT '',
      game_port       INTEGER NOT NULL DEFAULT 8211,
      steamcmd_exe    TEXT NOT NULL DEFAULT '',
      mods_dir        TEXT NOT NULL DEFAULT '',
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- ── Backups ─────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS backups (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id INTEGER NOT NULL DEFAULT 1 REFERENCES instances(id) ON DELETE CASCADE,
      filename    TEXT NOT NULL,
      filepath    TEXT NOT NULL,
      size_bytes  INTEGER NOT NULL DEFAULT 0,
      type        TEXT NOT NULL CHECK(type IN ('auto','manual')),
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(instance_id, filename)
    );

    -- ── Update history ───────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS update_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id INTEGER NOT NULL DEFAULT 1 REFERENCES instances(id) ON DELETE CASCADE,
      build_id    TEXT NOT NULL,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- ── Players ──────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS players (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id INTEGER NOT NULL DEFAULT 1 REFERENCES instances(id) ON DELETE CASCADE,
      steam_id    TEXT NOT NULL,
      name        TEXT NOT NULL,
      playtime_s  INTEGER NOT NULL DEFAULT 0,
      last_seen   INTEGER,
      whitelisted INTEGER NOT NULL DEFAULT 0,
      banned      INTEGER NOT NULL DEFAULT 0,
      session_start INTEGER,
      UNIQUE(instance_id, steam_id)
    );

    -- ── Metrics ──────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS metrics (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id INTEGER NOT NULL DEFAULT 1 REFERENCES instances(id) ON DELETE CASCADE,
      players     INTEGER NOT NULL DEFAULT 0,
      cpu_pct     REAL NOT NULL DEFAULT 0,
      mem_mb      REAL NOT NULL DEFAULT 0,
      recorded_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- ── Per-instance key-value settings ─────────────────────────────────────
    CREATE TABLE IF NOT EXISTS settings (
      instance_id INTEGER NOT NULL DEFAULT 1 REFERENCES instances(id) ON DELETE CASCADE,
      key         TEXT NOT NULL,
      value       TEXT NOT NULL,
      PRIMARY KEY (instance_id, key)
    );

    -- ── Mods ─────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS mods (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id INTEGER NOT NULL DEFAULT 1 REFERENCES instances(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      folder_name TEXT NOT NULL,
      version     TEXT NOT NULL DEFAULT '0.0.0',
      enabled     INTEGER NOT NULL DEFAULT 1,
      build_id    TEXT NOT NULL DEFAULT '',
      installed_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(instance_id, folder_name)
    );

    -- ── Watchdog events ──────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS watchdog_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id INTEGER NOT NULL DEFAULT 1 REFERENCES instances(id) ON DELETE CASCADE,
      event       TEXT NOT NULL,
      detail      TEXT,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- ── Scheduled restarts ───────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS scheduled_restarts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id INTEGER NOT NULL DEFAULT 1 REFERENCES instances(id) ON DELETE CASCADE,
      frequency   TEXT NOT NULL DEFAULT 'off' CHECK(frequency IN ('off','hourly','3h','6h','12h','daily','weekly','custom')),
      time        TEXT NOT NULL DEFAULT '06:00',
      cron_expr   TEXT NOT NULL DEFAULT '',
      timezone    TEXT NOT NULL DEFAULT 'UTC',
      warn_minutes INTEGER NOT NULL DEFAULT 5,
      enabled     INTEGER NOT NULL DEFAULT 0
    );

    -- ── Player session events (join/leave) ───────────────────────────────────
    CREATE TABLE IF NOT EXISTS player_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id INTEGER NOT NULL DEFAULT 1 REFERENCES instances(id) ON DELETE CASCADE,
      steam_id    TEXT NOT NULL,
      player_name TEXT NOT NULL,
      event       TEXT NOT NULL CHECK(event IN ('join','leave')),
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- ── RCON macros ──────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS rcon_macros (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      command     TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      color       TEXT NOT NULL DEFAULT '#a79fc7',
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- ── Broadcast schedules ──────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS broadcast_schedules (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      message     TEXT NOT NULL,
      cron        TEXT NOT NULL,
      enabled     INTEGER NOT NULL DEFAULT 1,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- ── Guilds and base camps (read out of Level.sav) ────────────────────────
    -- Mirrors of what the save file says, refreshed wholesale on each scan, so
    -- rows here are a cache and never a source of truth.
    CREATE TABLE IF NOT EXISTS guilds (
      instance_id     INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
      group_id        TEXT NOT NULL,
      name            TEXT NOT NULL DEFAULT '',
      base_camp_level INTEGER NOT NULL DEFAULT 0,
      admin_player_id TEXT,
      members         TEXT NOT NULL DEFAULT '[]',
      member_count    INTEGER NOT NULL DEFAULT 0,
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (instance_id, group_id)
    );

    CREATE TABLE IF NOT EXISTS base_camps (
      instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
      base_id     TEXT NOT NULL,
      guild_id    TEXT,
      x           REAL NOT NULL,
      y           REAL NOT NULL,
      z           REAL NOT NULL,
      area_range  REAL NOT NULL DEFAULT 0,
      state       INTEGER NOT NULL DEFAULT 0,
      worker_container_id TEXT,
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (instance_id, base_id)
    );

    -- ── Pals read from the world save ────────────────────────────────────────
    -- A cache, rebuilt on every scan, so the save stays the source of truth.
    CREATE TABLE IF NOT EXISTS pals (
      instance_id     INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
      instance_uid    TEXT NOT NULL,
      character_id    TEXT NOT NULL,
      nickname        TEXT,
      level           INTEGER NOT NULL DEFAULT 1,
      exp             INTEGER NOT NULL DEFAULT 0,
      gender          TEXT,
      lucky           INTEGER NOT NULL DEFAULT 0,
      boss            INTEGER NOT NULL DEFAULT 0,
      rank            INTEGER NOT NULL DEFAULT 1,
      talent_hp       INTEGER NOT NULL DEFAULT 0,
      talent_melee    INTEGER NOT NULL DEFAULT 0,
      talent_shot     INTEGER NOT NULL DEFAULT 0,
      talent_defense  INTEGER NOT NULL DEFAULT 0,
      soul_hp         INTEGER NOT NULL DEFAULT 0,
      soul_attack     INTEGER NOT NULL DEFAULT 0,
      soul_defence    INTEGER NOT NULL DEFAULT 0,
      soul_craftspeed INTEGER NOT NULL DEFAULT 0,
      passives        TEXT NOT NULL DEFAULT '[]',
      owner_player_id TEXT,
      container_id    TEXT,
      sanity          REAL NOT NULL DEFAULT 100,
      sick            INTEGER NOT NULL DEFAULT 0,
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (instance_id, instance_uid)
    );
    CREATE INDEX IF NOT EXISTS idx_pals_owner ON pals(instance_id, owner_player_id);
    CREATE INDEX IF NOT EXISTS idx_pals_character ON pals(instance_id, character_id);
    CREATE INDEX IF NOT EXISTS idx_pals_container ON pals(instance_id, container_id);

    -- Names for the owner ids above, also read from the save.
    CREATE TABLE IF NOT EXISTS save_players (
      instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
      player_id   TEXT NOT NULL,
      name        TEXT NOT NULL DEFAULT '',
      level       INTEGER NOT NULL DEFAULT 1,
      exp         INTEGER NOT NULL DEFAULT 0,
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (instance_id, player_id)
    );

    -- ── Alert rules ──────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS alert_rules (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      metric      TEXT NOT NULL CHECK(metric IN ('cpu','memory','players','status')),
      operator    TEXT NOT NULL CHECK(operator IN ('gt','lt','eq')),
      threshold   REAL NOT NULL DEFAULT 0,
      cooldown_m  INTEGER NOT NULL DEFAULT 30,
      enabled     INTEGER NOT NULL DEFAULT 1,
      last_fired  INTEGER,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- ── Audit log ────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS audit_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id INTEGER REFERENCES instances(id) ON DELETE SET NULL,
      actor       TEXT NOT NULL DEFAULT 'admin',
      action      TEXT NOT NULL,
      detail      TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- ── Chat messages (log-captured) ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS chat_messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
      player_name TEXT NOT NULL DEFAULT 'System',
      content     TEXT NOT NULL,
      captured_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- ── Backup schedule config ───────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS backup_schedule (
      instance_id INTEGER PRIMARY KEY REFERENCES instances(id) ON DELETE CASCADE,
      frequency   TEXT NOT NULL DEFAULT 'daily' CHECK(frequency IN ('off','hourly','daily','weekly')),
      hour        INTEGER NOT NULL DEFAULT 3,
      day_of_week INTEGER NOT NULL DEFAULT 0,
      enabled     INTEGER NOT NULL DEFAULT 1
    );

    -- ── Users (multi-user auth) ───────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'operator' CHECK(role IN ('owner','operator','viewer')),
      totp_enabled  INTEGER NOT NULL DEFAULT 0,
      totp_secret   TEXT,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      last_login    INTEGER
    );

    -- ── Player notes ─────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS player_notes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
      steam_id    TEXT NOT NULL,
      note        TEXT NOT NULL,
      author      TEXT NOT NULL DEFAULT 'admin',
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- ── Player tags ──────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS player_tags (
      instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
      steam_id    TEXT NOT NULL,
      tag         TEXT NOT NULL,
      color       TEXT NOT NULL DEFAULT '#a79fc7',
      PRIMARY KEY (instance_id, steam_id, tag)
    );

    -- ── Uptime events ────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS uptime_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
      status      TEXT NOT NULL CHECK(status IN ('online','offline')),
      started_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- ── Config snapshots (INI diff history) ─────────────────────────────────
    CREATE TABLE IF NOT EXISTS config_snapshots (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
      content     TEXT NOT NULL,
      hash        TEXT NOT NULL,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- ── Event triggers (if-this-then-that) ──────────────────────────────────
    CREATE TABLE IF NOT EXISTS event_triggers (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id  INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      event_type   TEXT NOT NULL,
      threshold    REAL NOT NULL DEFAULT 0,
      action_type  TEXT NOT NULL,
      action_params TEXT NOT NULL DEFAULT '{}',
      cooldown_m   INTEGER NOT NULL DEFAULT 30,
      enabled      INTEGER NOT NULL DEFAULT 1,
      last_fired   INTEGER,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- ── In-panel notifications ───────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS notifications (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id INTEGER REFERENCES instances(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      body        TEXT NOT NULL DEFAULT '',
      level       TEXT NOT NULL DEFAULT 'info' CHECK(level IN ('info','warn','error','success')),
      read        INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- ── Custom roles (PAM) ────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS roles (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      permissions TEXT NOT NULL DEFAULT '[]',
      is_builtin  INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  // ── Migrations (idempotent column additions) ──────────────────────────────
  const addColIfMissing = (table: string, col: string, def: string) => {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); } catch { /* already exists */ }
  };
  addColIfMissing('scheduled_restarts', 'cron_expr', "TEXT NOT NULL DEFAULT ''");
  addColIfMissing('players', 'ban_reason',  "TEXT");
  addColIfMissing('players', 'ban_expires', "INTEGER");
  addColIfMissing('users', 'role_id', "INTEGER REFERENCES roles(id) ON DELETE SET NULL");
  // Mods are discovered on disk, not just installed through the panel, so a
  // row now records where it came from and what kind of mod it is.
  addColIfMissing('mods', 'kind',      "TEXT NOT NULL DEFAULT 'ue4ss'");
  addColIfMissing('mods', 'builtin',   'INTEGER NOT NULL DEFAULT 0');
  addColIfMissing('mods', 'rel_path',  "TEXT NOT NULL DEFAULT ''");

  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_events (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id   INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      -- Settings this event forces while it runs, as a JSON object of
      -- PalWorldSettings keys to values.
      overrides     TEXT NOT NULL DEFAULT '{}',
      -- 'weekly' repeats on the given weekday; 'once' runs at start_at.
      mode          TEXT NOT NULL DEFAULT 'weekly',
      start_dow     INTEGER NOT NULL DEFAULT 5,
      start_time    TEXT NOT NULL DEFAULT '18:00',
      start_at      INTEGER,
      duration_hours REAL NOT NULL DEFAULT 48,
      timezone      TEXT NOT NULL DEFAULT 'UTC',
      warn_minutes  INTEGER NOT NULL DEFAULT 5,
      start_message TEXT NOT NULL DEFAULT '',
      end_message   TEXT NOT NULL DEFAULT '',
      enabled       INTEGER NOT NULL DEFAULT 1,
      -- Live state. saved_settings holds the values displaced at activation so
      -- they can be put back exactly, rather than reset to a guessed default.
      active        INTEGER NOT NULL DEFAULT 0,
      saved_settings TEXT,
      activated_at  INTEGER,
      ends_at       INTEGER,
      last_error    TEXT,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_events_instance ON scheduled_events(instance_id);
  `);

  // Base camps gained a worker container, and Pals the container plus the
  // condition fields, once the camp inspector needed to join the two.
  addColIfMissing('base_camps', 'worker_container_id', 'TEXT');
  addColIfMissing('pals', 'container_id', 'TEXT');
  addColIfMissing('pals', 'sanity', 'REAL NOT NULL DEFAULT 100');
  addColIfMissing('pals', 'sick',   'INTEGER NOT NULL DEFAULT 0');

  // ── Seed built-in roles ───────────────────────────────────────────────────
  for (const roleName of ['owner', 'operator', 'viewer'] as const) {
    const existing = db.prepare('SELECT id FROM roles WHERE name = ?').get(roleName);
    if (!existing) {
      const perms = JSON.stringify(BUILTIN_ROLE_PERMISSIONS[roleName]);
      db.prepare(
        'INSERT INTO roles (name, description, permissions, is_builtin) VALUES (?, ?, ?, 1)',
      ).run(roleName, BUILTIN_ROLE_DESCRIPTIONS[roleName], perms);
    } else {
      // Keep permissions in sync with code definitions
      db.prepare('UPDATE roles SET permissions = ?, is_builtin = 1 WHERE name = ?')
        .run(JSON.stringify(BUILTIN_ROLE_PERMISSIONS[roleName]), roleName);
    }
  }

  // Seed the default instance from env config if none exist
  const count = (db.prepare('SELECT COUNT(*) as c FROM instances').get() as { c: number }).c;
  if (count === 0) {
    db.prepare(`
      INSERT INTO instances
        (name, service_name, exe_path, save_dir, backup_dir, settings_ini,
         log_file, rcon_host, rcon_port, rcon_password, public_ip, game_port,
         steamcmd_exe, mods_dir)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'Palworld Server',
      cfg.palserver.serviceName,
      cfg.palserver.exe,
      cfg.backup.saveDir,
      cfg.backup.dir,
      cfg.palserver.settingsIni,
      cfg.palserver.logFile,
      cfg.rcon.host,
      cfg.rcon.port,
      cfg.rcon.password,
      '',
      8211,
      cfg.steamcmd.exe,
      cfg.mods.dir,
    );
  }

  // Seed the owner user from env config if no users exist
  const userCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
  if (userCount === 0) {
    const bcrypt = require('bcryptjs') as typeof import('bcryptjs');
    const hash = bcrypt.hashSync(cfg.auth.password, 12);
    db.prepare(
      "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'owner')",
    ).run(cfg.auth.username, hash);
  }
}
