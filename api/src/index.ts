import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { cfg } from './config.js';
import { getDb } from './db/index.js';
import type { Instance } from './db/types.js';
import { log } from './lib/logger.js';
import { initWss, startLogTail } from './ws.js';
import { startBackupScheduler } from './services/backup.js';
import { startUpdatePoller } from './services/steamcmd.js';
import { startWatchdog } from './services/watchdog.js';
import { syncScheduler } from './services/scheduler.js';
import { syncBroadcaster } from './services/broadcaster.js';

import authRoutes from './routes/auth.js';
import instanceRoutes from './routes/instances.js';
import serverRoutes from './routes/server.js';
import backupRoutes from './routes/backups.js';
import updateRoutes from './routes/updates.js';
import settingsRoutes from './routes/settings.js';
import playerRoutes from './routes/players.js';
import modRoutes from './routes/mods.js';
import macroRoutes from './routes/macros.js';
import broadcastRoutes from './routes/broadcasts.js';
import alertRoutes from './routes/alerts.js';
import auditRoutes from './routes/audit.js';
import chatRoutes from './routes/chat.js';
import maintenanceRoutes from './routes/maintenance.js';
import playerNotesRoutes from './routes/playerNotes.js';
import uptimeRoutes from './routes/uptime.js';
import palrestRoutes from './routes/palrest.js';
import appVersionRoutes from './routes/appVersion.js';

const app = express();

app.use(cors({ origin: process.env.NODE_ENV === 'production' ? false : true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));

// Auth
app.use('/api/auth', authRoutes);

// Instance management (no instance context needed)
app.use('/api/instances', instanceRoutes);

// Instance-scoped routes: /api/instances/:instanceId/<resource>
app.use('/api/instances/:instanceId/server',     serverRoutes);
app.use('/api/instances/:instanceId/backups',    backupRoutes);
app.use('/api/instances/:instanceId/updates',    updateRoutes);
app.use('/api/instances/:instanceId/settings',   settingsRoutes);
app.use('/api/instances/:instanceId/players',    playerRoutes);
app.use('/api/instances/:instanceId/mods',       modRoutes);
app.use('/api/instances/:instanceId/macros',     macroRoutes);
app.use('/api/instances/:instanceId/broadcasts', broadcastRoutes);
app.use('/api/instances/:instanceId/alerts',     alertRoutes);
app.use('/api/instances/:instanceId/audit',      auditRoutes);
app.use('/api/instances/:instanceId/chat',       chatRoutes);
app.use('/api/instances/:instanceId/maintenance', maintenanceRoutes);
app.use('/api/instances/:instanceId/players',    playerNotesRoutes);
app.use('/api/instances/:instanceId/uptime',     uptimeRoutes);
app.use('/api/instances/:instanceId/palrest',    palrestRoutes);

// App version / update check (for browser / headless deployments)
app.use('/api/app-version', appVersionRoutes);

// Health check
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Serve built SPA
const uiDist = path.join(__dirname, '../../ui/dist');
app.use(express.static(uiDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(uiDist, 'index.html'), (err) => {
    if (err) res.status(404).send('UI not built — run: npm run build --workspace=ui');
  });
});

const server = http.createServer(app);
initWss(server);

// Boot DB
getDb();

// Start background services for all configured instances
function bootInstances(): void {
  const instances = getDb().prepare('SELECT * FROM instances').all() as Instance[];
  for (const inst of instances) {
    startBackupScheduler(inst);
    startUpdatePoller(inst);
    startWatchdog(inst);
    syncScheduler(inst);
    syncBroadcaster(inst);
    startLogTail(inst);
    log.info(`[${inst.name}] Services started`);
  }
}
bootInstances();

server.listen(cfg.port, () => {
  log.info(`Palbox API running on http://localhost:${cfg.port}`);
});

process.on('uncaughtException',  (err) => log.error('Uncaught exception:',  err));
process.on('unhandledRejection', (err) => log.error('Unhandled rejection:', err));
