# Palbox — Palworld Server Panel

A self-hosted panel for managing a Palworld dedicated server on your VPS: start/stop/restart, SteamCMD update checks + one-click updates, RCON console, config editing, automated rolling 7-day backups, player moderation, mod management, and Discord alerts. Runs as a background service on the VPS and is reachable **two ways**: as a website (any browser, from anywhere, behind login) and as a **native desktop app** on the VPS itself (Electron, tray icon, launch-at-boot).

## Assumptions (flag if wrong)
- Server runs on a single Linux VPS (systemd-based), same box the panel runs on — the panel needs local shell/file access to `steamcmd`, the server binary, and the save directory.
- Palworld dedicated server is managed as a **systemd service** (recommended over a raw screen/tmux session) so the panel can start/stop it reliably and it survives VPS reboots.
- RCON is enabled in `PalWorldSettings.ini` (`RCONEnabled=True`) — used for graceful saves, broadcasts, and player list.
- Single admin operator — no need for multi-user roles, just one login.
- No Docker requirement, but the design doesn't preclude it later.
- Multi-server support assumes every instance lives on this same VPS (different ports, save dirs, systemd units). If you end up wanting to manage instances on *separate* VPSs from one panel, that's a bigger design (an agent process per box reporting back) — flag it if that's the direction and the plan adjusts.

If any of these don't match your setup (e.g. Palworld running in Docker, or panel needing to run on a *different* box than the game server), say so and the plan below adjusts.

---

## 1. Architecture

One backend, one frontend codebase, two ways in — a browser over the web, or a native window when you're on the VPS itself.

```
┌───────────────────────────────────────────────┐
│              VPS (same box as server)          │
│                                                  │
│  ┌────────────┐   systemd                       │
│  │ PalServer   │◄────────────┐                  │
│  │ (game proc) │              │                  │
│  └─────┬──────┘              │                  │
│        │ RCON (127.0.0.1)     │                  │
│  ┌─────▼───────────────────┐ │                  │
│  │ Palbox API (Node/TS)    │ │ systemd            │
│  │  - process control      │◄┘                   │
│  │  - steamcmd runner      │                     │
│  │  - backup scheduler     │                     │
│  │  - RCON client          │                     │
│  │  - WebSocket log tail   │                     │
│  │  - SQLite (metadata)    │                     │
│  │  - auth (JWT + bcrypt)  │                     │
│  └─────┬──────────┬────────┘                     │
│        │ :4000     │ same REST/WS API             │
│        │           │                              │
│  ┌─────▼─────┐ ┌───▼─────────────────┐           │
│  │ Caddy      │ │ Electron shell       │           │
│  │ (HTTPS,    │ │ (BrowserWindow →     │           │
│  │  serves    │ │  localhost:4000,     │           │
│  │  the SPA)  │ │  tray icon,          │           │
│  └─────┬─────┘ │  launch-at-boot)     │           │
│        │        └──────────────────────┘           │
└────────┼─────────────────────────────────────────┘
         │
   panel.yourdomain.com (browser, anywhere, behind login)

  /opt/palworld/Saved  ← backed up to → /opt/backups/palworld/*.tar.gz
```

**Backend:** Node.js + TypeScript (Express), matches your usual stack. Runs as its own systemd service (`palbox-api`), separate from the game server unit so the panel survives a game server crash/restart. This is the one place all the logic lives — both clients are just views onto it.

**Frontend (shared):** a single React + Vite SPA. It's built once and:
- served as static files behind Caddy for browser/web access, and
- loaded into an Electron `BrowserWindow` for the desktop app — pointed at `http://localhost:4000` by default since it runs on the same box as the API.

No duplicate UI code and no separate "desktop-only" feature set — same screens, same components, either way in.

**Desktop shell (Electron):** thin wrapper around the SPA — main process opens the window, adds a system tray icon (Palbox keeps running when the window is closed), registers as a login-item so it launches when the VPS boots, and can fire native OS notifications (backup failed, update completed, player joined). `electron-builder` for packaging; since this only needs to run on the VPS's own OS, you can target just that platform rather than building for all three.

**Data store:** SQLite (`better-sqlite3`) for backup metadata, update history, settings, player roster, and performance history. No Postgres/Supabase needed — this is a single-VPS tool with one admin user, so a server-side DB service is overkill. Same DB file is read by both access paths since there's only one API. With multi-server support, most tables (backups, settings, players, metrics) gain an `instance_id` column and every API route becomes instance-scoped — the frontend just adds a server switcher that changes which `instance_id` it's talking to.

**Reverse proxy:** Caddy in front of the API/SPA for the web path, HTTPS via your existing domain — reusing the pattern you already have set up for Gitea. The Electron app talks to the API directly over localhost, so it doesn't go through Caddy at all.

---

## 2. Core features

### Server control
- Start / stop / restart via `systemctl` calls to the PalServer unit (needs sudoers rule scoped to just that unit + `systemctl` verbs, or the API runs as a user with permission — no full root).
- Before any stop/restart: send RCON `Save`, optionally broadcast a countdown warning to players first (toggle in Settings).
- Dashboard shows live status (online/offline), uptime, player count, CPU/RAM (via `pidusage` or reading `/proc`).

### SteamCMD updates
- Background job polls the Steam API / `steamcmd +app_info_print 2394010` every 30 min for the latest `buildid`, compares against the installed build (stored locally after each update).
- Dashboard/Updates page shows "Update available" banner when they differ.
- "Update & restart" flow: RCON save + broadcast → stop service → `steamcmd +login anonymous +app_update 2394010 validate +quit` → start service → verify it comes back up → log to update history.
- Optional "auto-update on new build" toggle for hands-off operation.

### Backups (7-day rolling)
- Nightly cron (`node-cron`) at a configurable time: tars the `Saved` directory (world data, player data, config) to `/opt/backups/palworld/YYYY-MM-DD_HHmm.tar.gz`.
- Retention: after each backup, delete any archive older than 7 days — a rolling window, not fixed daily slots. Manual backups count toward the same 7-day window (tagged `manual` vs `auto` so you can tell them apart).
- "Back up now" button for on-demand snapshots (e.g. before an update).
- Restore flow: pick a snapshot → confirm (destructive) → auto-safety-backup of current state first → stop server → extract → restart.
- Download button to pull a snapshot off the VPS directly.

### Live console
- Tail the PalServer stdout/log file, stream over WebSocket to the console view.
- Command bar sends RCON commands (broadcast, kick, ban, save, etc.) — reuses the same RCON client as the update/restart flow.

### Settings
- Full form-based editor for `PalWorldSettings.ini`, grouped into tabs so it doesn't become one giant wall of fields: **World** (name, description, passwords, day/night speed), **Rates & difficulty** (EXP, capture rate, damage rates, hunger/stamina, drop rates), **Multiplayer** (max players, ports, public IP, RCON, auth server), **Pals & combat** (PvP, friendly fire, death penalty, max pals per base, egg hatch time), **Building** (worker cap, build limits, area restriction, boss pal spawns).
- Every field writes straight back to the ini and the panel flags when a change needs a server restart to take effect (most do).
- **Raw .ini mode** toggle for anything not exposed as a dedicated field — direct text editor over the full file, with revert-to-last-saved.
- Automation toggles (nightly auto-backup on/off + schedule, auto-update on/off, pre-restart player warning) live in their own section here too.

### Players & moderation
- Roster table: whitelist status, ban status, playtime, last seen — pulled from RCON `ShowPlayers` plus a local players table that accumulates session history over time.
- Kick/ban/unban buttons issue RCON commands directly; whitelist toggle (server-wide) flips `bUseAuth`/whitelist config and restarts if needed.
- "Add player" for pre-whitelisting before someone's first join (by Steam ID).

### Crash detection & auto-restart (watchdog)
- A lightweight monitor (part of the API process) checks the systemd unit's active state plus an RCON heartbeat every ~30s. If the process is gone or RCON stops responding for longer than a grace period, log the event and restart the unit — same start path as a manual restart, so it goes through the usual pre-restart hooks.
- Dashboard shows watchdog status ("armed" / "disabled") and the last time it intervened, if ever.

### Scheduled restarts
- Separate from update/backup-triggered restarts — a plain periodic restart (daily/every-12h/weekly/off) to clear accumulated memory, with the same RCON warning broadcast beforehand. Configurable time and frequency in Settings.

### Historical performance metrics
- The watchdog's periodic check also records player count, CPU, and memory into a time-series table (SQLite is fine at this scale — a row every minute or so, pruned after some retention window, e.g. 30 days).
- Dashboard shows a simple last-24h sparkline for players online and CPU load. A dedicated history view with a real charting library (`recharts`, matching your usual stack) is the natural v2 if you want to drill in further than the dashboard sparkline.

### Mods (UE4SS)
- Assumes [UE4SS](https://github.com/UE4SS-RE/RE-UE4SS) as the mod loader, since that's the standard for Palworld — Palbox manages mods on top of it rather than reinventing a loader.
- Mods list: name, version, enabled/disabled toggle, remove button. "Upload mod .zip" extracts into the UE4SS Mods folder and registers it.
- Flags a compatibility warning when the installed server build changed since a mod was last verified — the most common cause of mod-related crashes after a SteamCMD update.

### Discord notifications
- Webhook URL field in Settings, no bot/OAuth needed. Per-event toggles: server offline/crashed, backup failed, update completed, player joined/left. Fires from the same event points the watchdog/backup/update flows already hit — no separate notification engine needed.

### Multi-server support
- Sidebar server switcher lists all configured instances; every view (dashboard, backups, updates, console, settings, players, mods) operates on whichever instance is selected.
- Each instance gets its own systemd unit, save directory, backup folder, RCON port, and settings — the panel is instance-aware everywhere it currently assumes "the" server. Given how much this touches, it's worth treating as its own phase after the single-server version is working (see Build order below) rather than building it into every feature from day one.


- Single admin account. Password set via env var or a first-run setup screen, sessions via JWT in an HTTP-only cookie. No need for a full user/roles system.
- **Since this is going on the public internet:** bcrypt-hashed password (never stored plain), rate-limited/backoff'd login endpoint, HTTPS enforced via Caddy (no plain-HTTP fallback), and a short JWT expiry with refresh rather than a long-lived token. Worth adding a basic fail2ban rule on the login route once it's live, and 2FA (TOTP) is a reasonable v2 addition given the panel can stop/wipe the server.

---

## 3. Tech stack

| Layer | Choice |
|---|---|
| Backend | Node.js, TypeScript, Express |
| Frontend (shared) | React + Vite |
| Desktop shell | Electron + `electron-builder`, loads the same SPA |
| DB | SQLite (`better-sqlite3`) |
| Process mgmt | systemd (game server unit + panel API unit) |
| Scheduling | `node-cron` |
| RCON | lightweight RCON client lib (Palworld uses Source-style RCON) |
| Realtime | `ws` for log tail + live status push |
| Reverse proxy | Caddy (matches your existing VPS setup, web access only) |
| Mod loader | UE4SS (external, Palbox manages files/toggles on top of it) |
| Notifications | Discord webhooks (plain HTTPS POST, no bot needed) |
| Metrics charting | `recharts` for the (later) dedicated history view — dashboard sparklines are just inline SVG |

---

## 4. Build order

**Phase 1 — single-server MVP** (everything from the original plan, gets you a working panel fastest):

1. **Backend skeleton** — Express app, systemd unit for the API, Caddy site config, SQLite schema (backups, update_history, settings tables).
2. **Server control** — start/stop/restart endpoints + status polling; wire up the Dashboard.
3. **RCON client** — save, broadcast, player list, generic command passthrough; needed by nearly every feature below.
4. **Backups** — manual backup endpoint first, then the nightly cron + 7-day pruning, then restore + download.
5. **SteamCMD updates** — build-check polling, then the full update-and-restart flow (this depends on RCON + server control from steps 2–3).
6. **Live console** — WebSocket log tail + RCON command bar.
7. **Settings** — parse/write the full `PalWorldSettings.ini`, map fields into the World/Rates/Multiplayer/Combat/Building tabs, raw mode as the fallback for anything not mapped, automation toggles.
8. **Auth** — lock everything behind login before exposing the panel publicly. Desktop app still logs in against the same API (convenience: offer a "remember me" that keeps the session alive locally, since anyone with a shell on the VPS already has access to more than the panel).
9. **Electron shell** — wrap the built SPA in a `BrowserWindow` pointed at `localhost:4000`, add tray icon + minimize-to-tray, register as a login item, wire up native notifications. Package with `electron-builder` for whichever OS the VPS runs.
10. **Polish** — mobile-responsive pass (web path), error states, confirm dialogs on destructive actions (stop, restore, wipe).

**Phase 2 — expanded features** (builds on Phase 1's RCON client, event hooks, and auth):

11. **Watchdog** — periodic systemd/RCON health check, auto-restart on failure, status surfaced on the Dashboard.
12. **Scheduled restarts** — cron-based, reuses the same pre-restart warning/save path as updates.
13. **Players & moderation** — roster table backed by RCON player list + a local players table for playtime/history, kick/ban/whitelist actions.
14. **Historical metrics** — watchdog's health-check tick also writes a metrics row; dashboard sparklines first, dedicated `recharts` history view later if needed.
15. **Discord notifications** — webhook sender wired into the event points that already exist from backups/updates/watchdog.
16. **Mods (UE4SS)** — mod list/enable/disable/upload, build-compatibility flag.
17. **Multi-server support** — add the `instances` table, scope every existing route/table by `instance_id`, add the sidebar server switcher. Deliberately last, since it touches every feature that came before it.

---

## 5. Open questions for you
- Preferred backup storage location / any size cap on the VPS disk we should account for?
- Is UE4SS already installed for the mod loader, or should Phase 2's mod feature include installing it?
- Roughly how many server instances do you expect to run — worth knowing before Phase 2 to size the multi-server work correctly?
- Decided: panel will be reachable from the public internet, behind login — see the hardening notes in the Auth section above.
- Still unconfirmed: whether the Palworld server is already a systemd service or running in screen/tmux (see step 0 below).

## 0. First thing to check
Run this on the VPS before we start building step 1:
```bash
systemctl status palworld 2>/dev/null || systemctl status palserver 2>/dev/null
ps aux | grep -i palserver
```
- If a systemd unit shows up → we already have step 1's foundation, skip straight to writing the panel.
- If only a `PalServer.sh` process shows up (likely started in screen/tmux) → step 1 includes writing a proper systemd unit file for it first, since the panel needs `systemctl start/stop/restart` to work reliably and survive VPS reboots.
