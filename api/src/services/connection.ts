/**
 * Connection layer for talking to a Palworld server.
 *
 * Transport preference: the REST API first, RCON only as a fallback. RCON is
 * legacy, and Palworld's implementation deviates from the Source protocol
 * (unreliable packet ids, no documented arbitrary-command endpoint), whereas
 * the REST API is documented and returns structured data.
 * https://docs.palworldgame.com/api/rest-api/palwold-rest-api/
 *
 * Host resolution: Palbox normally runs on the same machine as the game
 * server, but users naturally enter their public IP. Many hosts cannot reach
 * their own public address (no NAT hairpin, or the service is bound to another
 * interface), so every call tries the configured host, loopback, and the
 * public IP, remembering whichever answered.
 */
import type { Instance } from '../db/types.js';
import { rconExec } from '../lib/rcon.js';
import {
  restGetInfo, restGetPlayers, restGetSettings, restGetMetrics,
  restAnnounce, restKickPlayer, restBanPlayer, restUnbanPlayer,
  restSave, restShutdown, restStop,
  type PalRestInfo, type PalRestPlayer, type PalRestMetrics,
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

/** Hosts to try, best-known first, with no duplicates. */
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
      if (workingHost.get(cacheKey(inst.id, proto)) !== host) {
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

const viaRest = <T>(inst: Instance, fn: (h: string, p: number, pw: string) => Promise<T>) =>
  attempt(inst, 'rest', (h) => fn(h, restPortOf(inst), inst.rcon_password));

const viaRcon = (inst: Instance, command: string, timeoutMs = 5000) =>
  attempt(inst, 'rcon', (h) => rconExec(h, inst.rcon_port, inst.rcon_password, command, timeoutMs));

/**
 * Runs the REST implementation, falling back to RCON if it fails. The REST
 * error is surfaced when both fail, since that is the supported transport.
 */
async function preferRest<T>(rest: () => Promise<T>, rcon: () => Promise<T>): Promise<T> {
  try {
    return await rest();
  } catch (restErr) {
    try {
      return await rcon();
    } catch {
      throw restErr;
    }
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

export function instRestInfo(inst: Instance): Promise<PalRestInfo> {
  return viaRest(inst, restGetInfo);
}

export function instRestSettings(inst: Instance): Promise<Record<string, unknown>> {
  return viaRest(inst, restGetSettings);
}

export function instRestMetrics(inst: Instance): Promise<PalRestMetrics> {
  return viaRest(inst, restGetMetrics);
}

export function instRestPlayers(inst: Instance): Promise<PalRestPlayer[]> {
  return viaRest(inst, restGetPlayers);
}

export interface LivePlayer {
  name:      string;
  playerUid: string;
  steamId:   string;
  ping?:     number;
  level?:    number;
  locationX?: number;
  locationY?: number;
}

/**
 * Online players, preferring the REST API because it returns structured data
 * including ping, level, and coordinates. The RCON fallback parses the CSV
 * that `ShowPlayers` emits, which carries names and ids only.
 */
export function instPlayers(inst: Instance, timeoutMs = 5000): Promise<LivePlayer[]> {
  return preferRest(
    async () => (await instRestPlayers(inst)).map((p) => ({
      name:      p.name,
      playerUid: p.playerId,
      steamId:   p.userId,
      ping:      p.ping,
      level:     p.level,
      locationX: p.location_x,
      locationY: p.location_y,
    })),
    async () => {
      const raw = await viaRcon(inst, 'ShowPlayers', timeoutMs);
      // First line is the header "name,playeruid,steamid".
      return raw.split('\n').slice(1)
        .filter((l) => l.includes(','))
        .map((l) => {
          const parts = l.split(',');
          return {
            name:      parts[0]?.trim() ?? '',
            playerUid: parts[1]?.trim() ?? '',
            steamId:   parts[2]?.trim() ?? '',
          };
        });
    },
  );
}

// ── Actions ──────────────────────────────────────────────────────────────────

export function instAnnounce(inst: Instance, message: string): Promise<void> {
  return preferRest(
    () => viaRest(inst, (h, p, pw) => restAnnounce(h, p, pw, message)),
    async () => { await viaRcon(inst, `Broadcast ${message}`); },
  );
}

export function instSave(inst: Instance): Promise<void> {
  return preferRest(
    () => viaRest(inst, restSave),
    async () => { await viaRcon(inst, 'Save'); },
  );
}

export function instKick(inst: Instance, userId: string, message = ''): Promise<void> {
  return preferRest(
    () => viaRest(inst, (h, p, pw) => restKickPlayer(h, p, pw, userId, message)),
    async () => { await viaRcon(inst, `KickPlayer ${userId}`); },
  );
}

export function instBan(inst: Instance, userId: string, message = ''): Promise<void> {
  return preferRest(
    () => viaRest(inst, (h, p, pw) => restBanPlayer(h, p, pw, userId, message)),
    async () => { await viaRcon(inst, `BanPlayer ${userId}`); },
  );
}

export function instUnban(inst: Instance, userId: string): Promise<void> {
  return preferRest(
    () => viaRest(inst, (h, p, pw) => restUnbanPlayer(h, p, pw, userId)),
    async () => { await viaRcon(inst, `UnBanPlayer ${userId}`); },
  );
}

export function instShutdown(inst: Instance, seconds = 1, message = ''): Promise<void> {
  return preferRest(
    () => viaRest(inst, (h, p, pw) => restShutdown(h, p, pw, seconds, message)),
    async () => { await viaRcon(inst, `Shutdown ${seconds} ${message}`.trim()); },
  );
}

export function instForceStop(inst: Instance): Promise<void> {
  return preferRest(
    () => viaRest(inst, restStop),
    async () => { await viaRcon(inst, 'DoExit'); },
  );
}

/** Raw RCON. Only for the console tab — REST has no arbitrary-command endpoint. */
export function instRconRaw(inst: Instance, command: string, timeoutMs = 5000): Promise<string> {
  return viaRcon(inst, command, timeoutMs);
}

/**
 * Dispatches a free-form command string, routing the ones the REST API covers
 * to their dedicated endpoints and only falling through to raw RCON for the
 * rest. Used by the console, macros, and event triggers.
 */
export async function instCommand(inst: Instance, command: string): Promise<string> {
  const trimmed = command.trim();
  const [verb, ...rest] = trimmed.split(/\s+/);
  const arg = rest.join(' ');

  switch (verb.toLowerCase()) {
    case 'broadcast':
      await instAnnounce(inst, arg);
      return `Broadcast sent: ${arg}`;
    case 'save':
      await instSave(inst);
      return 'World saved.';
    case 'kickplayer':
      await instKick(inst, rest[0] ?? '');
      return `Kicked ${rest[0] ?? ''}`;
    case 'banplayer':
      await instBan(inst, rest[0] ?? '');
      return `Banned ${rest[0] ?? ''}`;
    case 'unbanplayer':
      await instUnban(inst, rest[0] ?? '');
      return `Unbanned ${rest[0] ?? ''}`;
    case 'showplayers': {
      const players = await instPlayers(inst);
      return ['name,playeruid,steamid', ...players.map((p) => `${p.name},${p.playerUid},${p.steamId}`)].join('\n');
    }
    default:
      return instRconRaw(inst, command);
  }
}
