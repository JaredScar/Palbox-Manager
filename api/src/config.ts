import 'dotenv/config';
import path from 'path';

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const cfg = {
  port: parseInt(optional('PORT', '4000'), 10),

  auth: {
    username: optional('ADMIN_USERNAME', 'admin'),
    password: optional('ADMIN_PASSWORD', 'changeme'),
    jwtSecret: optional('JWT_SECRET', 'dev-secret-change-in-production'),
    jwtExpiresIn: '8h',
    refreshExpiresIn: '7d',
  },

  palserver: {
    dir: optional('PALSERVER_DIR', 'C:\\PalServer'),
    exe: optional('PALSERVER_EXE', 'C:\\PalServer\\Pal\\Binaries\\Win64\\PalServer-Win64-Shipping-Cmd.exe'),
    serviceName: optional('PALSERVER_SERVICE', 'PalServer'),
    logFile: optional('PALSERVER_LOG', 'C:\\PalServer\\Pal\\Saved\\Logs\\PalServer.log'),
    settingsIni: optional('SETTINGS_INI', 'C:\\PalServer\\Pal\\Saved\\Config\\WindowsServer\\PalWorldSettings.ini'),
  },

  rcon: {
    host: optional('RCON_HOST', '127.0.0.1'),
    port: parseInt(optional('RCON_PORT', '25575'), 10),
    password: optional('RCON_PASSWORD', ''),
  },

  backup: {
    dir: optional('BACKUP_DIR', 'C:\\PalboxBackups'),
    saveDir: optional('SAVE_DIR', 'C:\\PalServer\\Pal\\Saved'),
    retentionDays: parseInt(optional('BACKUP_RETENTION_DAYS', '7'), 10),
    cron: optional('BACKUP_CRON', '0 4 * * *'),
  },

  steamcmd: {
    exe: optional('STEAMCMD_EXE', 'C:\\steamcmd\\steamcmd.exe'),
    appId: '2394010',
  },

  mods: {
    dir: optional('MODS_DIR', 'C:\\PalServer\\Pal\\Binaries\\Win64\\Mods'),
  },

  discord: {
    webhookUrl: optional('DISCORD_WEBHOOK', ''),
  },

  dbPath: optional('DB_PATH', path.join(process.cwd(), 'palbox.db')),
} as const;
