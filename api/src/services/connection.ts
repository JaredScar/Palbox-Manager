/**
 * Connection layer for talking to a Palworld server.
 *
 * Palbox normally runs on the same machine as the game server, but users
 * naturally enter their public IP as the host. Many hosts cannot connect to
 * their own public address (no NAT hairpin, or the service is bound to a
 * different interface), so those connections fail even though the ports are
 * fully reachable from the internet.
 *
 * Every call therefore tries the configured host and falls back to loopback,
 * remembering whichever answered so later calls go straight to it.
 */
import type { Instance } from '../db/types.js';
import { rconExec } from '../lib/rcon.js';
import {
  restGetInfo, restGetPlayers, restSendCommand,
  restKickPlayer, restBanPlayer, restSave, restAnnounce,
  type PalRestInfo, type PalRestPlayer,
} from './palrest.js';
import { log } from '../lib/logger.js';

export const LOOPBACK = '127.0.0.1';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0']);
export const isLoopback = (h: string | null | undefined) =>
  LOOPBACK_HOSTS.has((h ?? '').trim().toLowerCase());

export const restPortOf = (inst: Instance): number =>
  ((inst as unknown as Record<string, unknown>).rest_api_port as number | undefined) ?? 8212;

type Proto = 'rcon' | 'rest';

/** Host that most recently answered, keyed by `${instanceId}:${proto}`. */
const workingHost = new Map<string, string>();
const cacheKey = (id: number, proto: Proto) => `${id}:${proto}`;

/** Drop cached hosts for an instance — call when its settings change. */
export function forgetInstanceHosts(instanceId: number): void {
  workingHost.delete(cacheKey(instanceId, 'rcon'));
  workingHost.delete(cacheKey(instanceId, 'rest'));
}

/**
 * Hosts to try, best-known first, with no duplicates. The public IP is
 * included because Palworld can end up bound to that interface alone, in
 * which case loopback fails even though the service is running locally.
 */
export function candidateHosts(inst: Instance, proto: Proto): string[] {
  const hosts: string[] = [];
  const push = (h: string | null | undefined) => {
    const v = (h ?? '').trim();
    if (v && !hosts.includes(v)) hosts.push(v);
  };
  push(workingHost.get(cacheKey(inst.id, proto)));
  push(inst.rcon_host);
  push(LOOPBACK);
  push(inst.public_ip);
  return hosts;
}

async function attempt<T>(
  inst: Instance,
  proto: Proto,
  fn: (host: string) => Promise<T>,
): Promise<T> {
  const hosts = candidateHosts(inst, proto);
  let lastErr: unknown = new Error(`No ${proto} host configured`);

  for (const host of hosts) {
    try {
      const result = await fn(host);
      const previous = workingHost.get(cacheKey(inst.id, proto));
      if (previous !== host) {
        workingHost.set(cacheKey(inst.id, proto), host);
        if (host !== inst.rcon_host) {
          log.info(
            `[${inst.name}] ${proto.toUpperCase()} reachable on ${host} but not on the configured host "${inst.rcon_host}" — using ${host}. Set the RCON host to ${host} to avoid the extra attempt.`,
          );
        }
      }
      return result;
    } catch (e) {
      lastErr = e;
    }
  }

  workingHost.delete(cacheKey(inst.id, proto));
  throw lastErr;
}

// ── RCON ─────────────────────────────────────────────────────────────────────

/**
 * Runs a command, preferring RCON. Palworld's REST API exposes the same
 * command surface, so if RCON is unreachable on every candidate host the
 * command still goes through and the panel keeps working.
 */
export async function instRcon(inst: Instance, command: string, timeoutMs = 5000): Promise<string> {
  try {
    return await attempt(inst, 'rcon', (host) =>
      rconExec(host, inst.rcon_port, inst.rcon_password, command, timeoutMs),
    );
  } catch (rconErr) {
    try {
      return await instRestCommand(inst, command);
    } catch {
      throw rconErr; // the RCON failure is the more useful one to surface
    }
  }
}

// ── Palworld REST API ────────────────────────────────────────────────────────

export function instRestInfo(inst: Instance): Promise<PalRestInfo> {
  return attempt(inst, 'rest', (h) => restGetInfo(h, restPortOf(inst), inst.rcon_password));
}

export function instRestPlayers(inst: Instance): Promise<PalRestPlayer[]> {
  return attempt(inst, 'rest', (h) => restGetPlayers(h, restPortOf(inst), inst.rcon_password));
}

export function instRestCommand(inst: Instance, command: string): Promise<string> {
  return attempt(inst, 'rest', (h) => restSendCommand(h, restPortOf(inst), inst.rcon_password, command));
}

export function instRestKick(inst: Instance, userId: string, message = ''): Promise<void> {
  return attempt(inst, 'rest', (h) => restKickPlayer(h, restPortOf(inst), inst.rcon_password, userId, message));
}

export function instRestBan(inst: Instance, userId: string, message = ''): Promise<void> {
  return attempt(inst, 'rest', (h) => restBanPlayer(h, restPortOf(inst), inst.rcon_password, userId, message));
}

export function instRestSave(inst: Instance): Promise<void> {
  return attempt(inst, 'rest', (h) => restSave(h, restPortOf(inst), inst.rcon_password));
}

export function instRestAnnounce(inst: Instance, message: string): Promise<void> {
  return attempt(inst, 'rest', (h) => restAnnounce(h, restPortOf(inst), inst.rcon_password, message));
}
