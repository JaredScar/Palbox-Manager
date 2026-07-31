import https from 'https';
import { getDb } from '../db';
import type { Instance } from '../db/types';
import { log } from '../lib/logger';

export type DiscordEventKey =
  | 'server_online'
  | 'server_offline'
  | 'server_crashed'
  | 'backup_created'
  | 'backup_failed'
  | 'update_completed'
  | 'player_joined'
  | 'player_left'
  | 'player_banned'
  | 'maintenance_start'
  | 'maintenance_end'
  | 'alert';

// Colour codes for each event type (decimal for Discord embed)
const EVENT_COLORS: Record<DiscordEventKey, number> = {
  server_online:      0x7ce666,   // lime
  server_offline:     0xff5d73,   // red
  server_crashed:     0xff2222,   // bright red
  backup_created:     0xffd447,   // gold
  backup_failed:      0xff5c5c,   // orange-red
  update_completed:   0xb27cf2,   // violet
  player_joined:      0x2fd9e8,   // aqua
  player_left:        0xa79fc7,   // muted purple
  player_banned:      0xff5d73,   // red
  maintenance_start:  0xf97316,   // orange
  maintenance_end:    0x7ce666,   // lime
  alert:              0xffd447,   // gold
};

function isEventEnabled(inst: Instance, key: DiscordEventKey): boolean {
  const row = getDb()
    .prepare('SELECT value FROM settings WHERE instance_id = ? AND key = ?')
    .get(inst.id, `discord_${key}`) as { value: string } | undefined;
  // Default enabled for all events unless explicitly disabled
  return row?.value !== 'false';
}

function getWebhookUrl(inst: Instance): string {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE instance_id = ? AND key = 'discord_webhook'")
    .get(inst.id) as { value: string } | undefined;
  return row?.value ?? '';
}

export interface DiscordPayload {
  /** If provided, sends a Discord embed instead of a plain message. */
  title?: string;
  description?: string;
  fields?: { name: string; value: string; inline?: boolean }[];
}

export async function sendDiscord(
  inst: Instance,
  content: string,
  event?: DiscordEventKey,
  payload?: DiscordPayload,
): Promise<void> {
  const url = getWebhookUrl(inst);
  if (!url) return;
  if (event && !isEventEnabled(inst, event)) return;

  const now = Math.floor(Date.now() / 1000);
  const body = payload?.title
    ? JSON.stringify({
        embeds: [{
          title:       payload.title,
          description: payload.description ?? content,
          color:       event ? EVENT_COLORS[event] : 0xa79fc7,
          fields:      payload.fields ?? [],
          footer:      { text: `Palbox · ${inst.name}` },
          timestamp:   new Date().toISOString(),
        }],
      })
    : JSON.stringify({ content });

  return new Promise((resolve) => {
    let urlObj: URL;
    try { urlObj = new URL(url); } catch { log.warn('Discord: invalid webhook URL'); resolve(); return; }

    const req = https.request(
      {
        hostname: urlObj.hostname,
        path:     urlObj.pathname + urlObj.search,
        method:  'POST',
        headers: {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 8_000,
      },
      (res) => { res.resume(); res.on('end', () => resolve()); },
    );
    req.on('error', (e) => { log.warn('Discord webhook error:', e.message); resolve(); });
    req.on('timeout', () => { req.destroy(); resolve(); });
    req.write(body);
    req.end();
  });
}

/** Convenience: fire a structured Discord embed for a standard event. */
export async function fireEvent(
  inst: Instance,
  event: DiscordEventKey,
  title: string,
  description: string,
  fields?: { name: string; value: string; inline?: boolean }[],
): Promise<void> {
  return sendDiscord(inst, description, event, { title, description, fields });
}

export const ALL_DISCORD_EVENTS: DiscordEventKey[] = [
  'server_online', 'server_offline', 'server_crashed',
  'backup_created', 'backup_failed',
  'update_completed',
  'player_joined', 'player_left', 'player_banned',
  'maintenance_start', 'maintenance_end',
  'alert',
];

export const DISCORD_EVENT_LABELS: Record<DiscordEventKey, string> = {
  server_online:     'Server comes online',
  server_offline:    'Server goes offline',
  server_crashed:    'Server crashes / watchdog intervenes',
  backup_created:    'Backup created',
  backup_failed:     'Backup failed',
  update_completed:  'Game update completed',
  player_joined:     'Player joins',
  player_left:       'Player leaves',
  player_banned:     'Player banned',
  maintenance_start: 'Maintenance mode starts',
  maintenance_end:   'Maintenance mode ends',
  alert:             'Alert rule fires',
};
