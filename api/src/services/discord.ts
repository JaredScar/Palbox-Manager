import https from 'https';
import { getDb } from '../db';
import type { Instance } from '../db/types';
import { log } from '../lib/logger';

export type DiscordEventKey =
  | 'server_offline'
  | 'backup_failed'
  | 'update_completed'
  | 'player_joined'
  | 'player_left'
  | 'alert';

function isEventEnabled(inst: Instance, key: DiscordEventKey): boolean {
  const row = getDb()
    .prepare('SELECT value FROM settings WHERE instance_id = ? AND key = ?')
    .get(inst.id, `discord_${key}`) as { value: string } | undefined;
  return row?.value !== 'false';
}

function getWebhookUrl(inst: Instance): string {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE instance_id = ? AND key = 'discord_webhook'")
    .get(inst.id) as { value: string } | undefined;
  return row?.value ?? '';
}

export async function sendDiscord(
  inst: Instance,
  content: string,
  event?: DiscordEventKey,
): Promise<void> {
  const url = getWebhookUrl(inst);
  if (!url) return;
  if (event && !isEventEnabled(inst, event)) return;

  const body = JSON.stringify({ content });
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const req = https.request(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 8_000,
      },
      (res) => { res.resume(); res.on('end', () => resolve()); },
    );
    req.on('error', (e) => { log.warn('Discord webhook error:', e.message); resolve(); });
    req.write(body);
    req.end();
  });
}
