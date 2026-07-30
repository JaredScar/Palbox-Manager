# Palbox — Palworld Server Manager

Self-hosted ops panel for your Palworld dedicated server(s).  
Web UI for the browser or a native Electron window on the VPS.

---

## Installation

### Option A — Desktop installer (recommended for local / VPS use)

1. Go to the [**Releases**](../../releases/latest) page.
2. Download **`Palbox-Setup-vX.Y.Z.exe`**.
3. Run the installer (Administrator rights may be required).
4. On first launch Palbox creates a config file at  
   `%APPDATA%\Palbox\.env` — edit it with your server paths and RCON credentials.

> **Requirement:** [Node.js 22+](https://nodejs.org) must be installed on the machine.

---

### Option B — Headless server package (NSSM service on a Windows VPS)

1. Go to the [**Releases**](../../releases/latest) page.
2. Download **`palbox-server-vX.Y.Z.zip`** and extract it.
3. Open **PowerShell as Administrator** inside the extracted folder:
   ```powershell
   .\Install-Palbox.ps1
   ```
4. Follow the prompts — the script checks prerequisites, writes `.env`, and registers a Windows service via NSSM.

**Requirements:**
- [Node.js 22+](https://nodejs.org)
- [NSSM](https://nssm.cc/download) — extract `nssm.exe` somewhere on `PATH` (e.g. `C:\nssm\`)

After setup the panel is available at **http://localhost:4000** (or whichever port you chose).

---

### Option C — Build from source

```bat
git clone <repo>
cd Palbox-Manager
npm install
cp .env.example api/.env
# Edit api/.env with your server details
npm run dev          # http://localhost:5173 (dev proxy)
```

For production, build then register as a service:
```bat
npm run build
nssm install PalboxAPI "C:\Program Files\nodejs\node.exe" "C:\Palbox\api\dist\index.js"
nssm set PalboxAPI AppDirectory C:\Palbox\api
nssm set PalboxAPI AppEnvironmentExtra "DOTENV_CONFIG_PATH=C:\Palbox\.env"
nssm start PalboxAPI
```

---

## Upgrading

**Server package:**
```powershell
nssm stop PalboxAPI
# Extract the new palbox-server-*.zip and overwrite api-dist/ + node_modules/
# Your .env is preserved (located at C:\Palbox\.env by default)
nssm start PalboxAPI
```

**Desktop installer:** Re-run the new `Palbox-Setup-*.exe` — it will upgrade in place.

---

## Features

### Phase 1 (core)
| Feature | Details |
|---|---|
| **Authentication** | Username + password + optional TOTP 2FA, JWT cookie |
| **Server control** | Start / Stop / Restart / Save via NSSM + RCON |
| **Live console** | Tail `PalServer.log` over WebSocket, send RCON commands |
| **Backups** | Manual & scheduled `.zip` archives, rolling retention, restore |
| **SteamCMD updates** | Steam API polling, one-click update with RCON warning |
| **Settings editor** | Form + raw INI modes for `PalWorldSettings.ini` |
| **Mods (UE4SS)** | List / enable / disable / upload / remove mods |
| **Player roster** | View history, kick / ban / unban, whitelist |
| **Discord webhooks** | Per-event notifications |

### Phase 2 (advanced)
| Feature | Details |
|---|---|
| **Multi-server** | Add any number of instances; sidebar switcher changes active server |
| **Watchdog** | RCON heartbeat every 30 s, grace period, auto-restart if offline |
| **Player join/leave events** | Detected via `ShowPlayers` diff, stored in DB, Discord notified |
| **Scheduled restarts** | Daily / 12 h / Weekly cron, configurable time + timezone + warn |
| **Historical metrics** | Up to 30 days of player / CPU / memory data charted |
| **RCON Macros** | Named command presets, run with one click |
| **Timed Broadcasts** | Recurring in-game messages on a cron schedule |
| **Alert Rules** | CPU / memory / player-count / status thresholds → Discord |
| **Chat Log** | Live server log viewer |
| **Player Profiles** | Notes, tags, playtime history per player |
| **Audit Log** | All admin actions recorded |
| **World Overview** | Key settings parsed from `PalWorldSettings.ini` |
| **Multi-user accounts** | Owner / Operator / Viewer roles with JWT auth |
| **Two-factor auth** | TOTP (Google Authenticator / Authy) via QR code |
| **Maintenance mode** | RCON broadcast warnings + whitelist lockdown |
| **Uptime tracker** | SLA %, outage count, status timeline |
| **Player notes & tags** | Custom colour-tagged labels per player |
| **Cluster view** | Single-page grid of all instances with live metrics |
| **Palworld REST API** | Proxy to the game's built-in HTTP API (port 8212) |
| **Color themes** | Violet / Emerald / Ocean / Crimson / High Contrast |

---

## Architecture

```
Palbox-Manager/
├── api/          Express + TypeScript backend  (port 4000)
├── ui/           React + Vite SPA              (proxied in dev, static in prod)
├── electron/     Desktop shell (optional)
└── scripts/      Install-Palbox.ps1, Uninstall-Palbox.ps1
```

All three packages are npm workspaces.

---

## CI / CD

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` | Push / PR to `main` | Builds UI + API + type-checks Electron |
| `release.yml` | Push of a `v*.*.*` tag | Builds both artifacts, creates a GitHub Release |

**To publish a release:**
```bash
git tag v1.0.0
git push origin v1.0.0
```
GitHub Actions will build and attach:
- `Palbox-Setup-1.0.0.exe` (Electron NSIS installer)
- `palbox-server-1.0.0.zip` (headless server package)

---

## Multi-server support

Palbox can manage **multiple Palworld instances** on the same VPS (or different ports).

1. Start Palbox — it seeds a **Default** instance from your `.env` values.
2. Open **Settings → Instances → Add server** to create more.
3. Each instance stores its own: service name, paths, RCON port, backup dir.
4. Use the **server picker** in the sidebar to switch — every view updates.

---

## Environment variables reference

See `.env.example` for the full list. Variables for the default instance are seeded
into the `instances` table on first boot; you can change paths later via the Settings UI.

---

## License

MIT
