import { exec } from 'child_process';
import { promisify } from 'util';
import https from 'https';
import { getDb } from '../db';
import type { Instance } from '../db/types';
import { log } from '../lib/logger';
import { sendDiscord } from './discord';

const execAsync = promisify(exec);

export interface BuildInfo {
  installed: string | null;
  latest: string | null;
  updateAvailable: boolean;
  lastChecked: number | null;
}

// Per-instance state
const latestBuildId = new Map<number, string>();
const lastChecked = new Map<number, number>();

export function getInstalledBuildId(instanceId: number): string | null {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE instance_id = ? AND key = 'installed_build_id'")
    .get(instanceId) as { value: string } | undefined;
  return row?.value ?? null;
}

function setInstalledBuildId(instanceId: number, id: string): void {
  getDb()
    .prepare("INSERT OR REPLACE INTO settings (instance_id, key, value) VALUES (?, 'installed_build_id', ?)")
    .run(instanceId, id);
}

const APP_ID = '2394010';

async function fetchLatestBuildId(): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(`https://api.steamcmd.net/v1/info/${APP_ID}`, { timeout: 10_000 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const buildId = json?.data?.[APP_ID]?.depots?.branches?.public?.buildid ?? null;
          if (!buildId) reject(new Error('Could not parse buildid from Steam API'));
          else resolve(String(buildId));
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

export async function checkForUpdate(inst: Instance): Promise<BuildInfo> {
  try {
    const latest = await fetchLatestBuildId();
    latestBuildId.set(inst.id, latest);
    lastChecked.set(inst.id, Date.now());
  } catch (err) {
    log.warn(`[${inst.name}] Steam build check failed:`, err);
  }
  const installed = getInstalledBuildId(inst.id);
  const latest = latestBuildId.get(inst.id) ?? null;
  return {
    installed,
    latest,
    updateAvailable: !!latest && !!installed && latest !== installed,
    lastChecked: lastChecked.get(inst.id) ?? null,
  };
}

export function getBuildInfo(inst: Instance): BuildInfo {
  const installed = getInstalledBuildId(inst.id);
  const latest = latestBuildId.get(inst.id) ?? null;
  return {
    installed,
    latest,
    updateAvailable: !!latest && !!installed && latest !== installed,
    lastChecked: lastChecked.get(inst.id) ?? null,
  };
}

export async function runUpdate(inst: Instance, onOutput?: (line: string) => void): Promise<void> {
  const steamcmdExe = inst.steamcmd_exe || 'C:\\steamcmd\\steamcmd.exe';
  const args = `+login anonymous +app_update ${APP_ID} validate +quit`;
  const cmd = `"${steamcmdExe}" ${args}`;

  log.info(`[${inst.name}] Running SteamCMD: ${cmd}`);
  await new Promise<void>((resolve, reject) => {
    const child = exec(cmd, { timeout: 10 * 60 * 1000 });
    child.stdout?.on('data', (d: string) => { const l = d.toString().trim(); if (l) onOutput?.(l); });
    child.stderr?.on('data', (d: string) => { const l = d.toString().trim(); if (l) onOutput?.(l); });
    child.on('exit', (code) => { if (code === 0) resolve(); else reject(new Error(`steamcmd exited ${code}`)); });
    child.on('error', reject);
  });

  const latest = latestBuildId.get(inst.id);
  if (latest) {
    setInstalledBuildId(inst.id, latest);
    getDb().prepare('INSERT INTO update_history (instance_id, build_id) VALUES (?,?)').run(inst.id, latest);
    await sendDiscord(inst, `**Palbox** — \`${inst.name}\` updated to build \`${latest}\``, 'update_completed');
  }
}

export function getUpdateHistory(instanceId: number): { id: number; build_id: string; created_at: number }[] {
  return getDb()
    .prepare('SELECT * FROM update_history WHERE instance_id = ? ORDER BY created_at DESC LIMIT 20')
    .all(instanceId) as { id: number; build_id: string; created_at: number }[];
}

const pollerStarted = new Set<number>();

export function startUpdatePoller(inst: Instance): void {
  if (pollerStarted.has(inst.id)) return;
  pollerStarted.add(inst.id);
  checkForUpdate(inst).catch(() => {});
  setInterval(() => checkForUpdate(inst).catch(() => {}), 30 * 60 * 1000);
  log.info(`[${inst.name}] Update poller started (every 30 min)`);
}
