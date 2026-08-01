/**
 * Client for Palworld's built-in REST API.
 * https://docs.palworldgame.com/api/rest-api/palwold-rest-api/
 *
 * Requires RESTAPIEnabled=True in PalWorldSettings.ini. The server listens on
 * RESTAPIPort (default 8212) and authenticates with HTTP Basic auth using the
 * username "admin" and AdminPassword.
 *
 * This is the preferred transport: RCON is legacy and Palworld's RCON
 * implementation deviates from the Source protocol in awkward ways.
 */

export interface PalRestPlayer {
  name: string;
  playerId: string;
  userId: string;
  ip: string;
  ping: number;
  location_x: number;
  location_y: number;
  level: number;
}

export interface PalRestInfo {
  version: string;
  servername: string;
  description: string;
  worldguid: string;
  days: number;
}

export interface PalRestMetrics {
  serverfps: number;
  currentplayernum: number;
  serverframetime: number;
  maxplayernum: number;
  uptime: number;
  days: number;
}

const TIMEOUT_MS = 6000;

function makeAuth(password: string): string {
  return 'Basic ' + Buffer.from(`admin:${password}`).toString('base64');
}

function baseUrl(host: string, port: number, path: string): string {
  return `http://${host}:${port}/v1/api${path}`;
}

async function get<T>(host: string, port: number, password: string, path: string): Promise<T> {
  const resp = await fetch(baseUrl(host, port, path), {
    headers: {
      Authorization: makeAuth(password),
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`REST API ${resp.status}: ${await resp.text()}`);
  return resp.json() as Promise<T>;
}

/**
 * Most POST endpoints reply with an empty body. Parsing unconditionally made
 * every successful save/announce/kick throw "Unexpected end of JSON input",
 * so the body is only parsed when there is actually something to parse.
 */
async function post<T>(
  host: string, port: number, password: string, path: string, body?: unknown,
): Promise<T | null> {
  const resp = await fetch(baseUrl(host, port, path), {
    method: 'POST',
    headers: {
      Authorization: makeAuth(password),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`REST API ${resp.status}: ${await resp.text()}`);
  const text = await resp.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

export function restGetInfo(host: string, port: number, password: string): Promise<PalRestInfo> {
  return get<PalRestInfo>(host, port, password, '/info');
}

export async function restGetPlayers(host: string, port: number, password: string): Promise<PalRestPlayer[]> {
  const data = await get<{ players: PalRestPlayer[] }>(host, port, password, '/players');
  return data.players ?? [];
}

export function restGetSettings(host: string, port: number, password: string): Promise<Record<string, unknown>> {
  return get<Record<string, unknown>>(host, port, password, '/settings');
}

export function restGetMetrics(host: string, port: number, password: string): Promise<PalRestMetrics> {
  return get<PalRestMetrics>(host, port, password, '/metrics');
}

// ── Actions ──────────────────────────────────────────────────────────────────

export async function restAnnounce(host: string, port: number, password: string, message: string): Promise<void> {
  await post(host, port, password, '/announce', { message });
}

export async function restKickPlayer(host: string, port: number, password: string, userId: string, message = ''): Promise<void> {
  await post(host, port, password, '/kick', { userid: userId, message });
}

export async function restBanPlayer(host: string, port: number, password: string, userId: string, message = ''): Promise<void> {
  await post(host, port, password, '/ban', { userid: userId, message });
}

export async function restUnbanPlayer(host: string, port: number, password: string, userId: string): Promise<void> {
  await post(host, port, password, '/unban', { userid: userId });
}

export async function restSave(host: string, port: number, password: string): Promise<void> {
  await post(host, port, password, '/save');
}

/** Graceful shutdown after `waittime` seconds, announcing `message` first. */
export async function restShutdown(host: string, port: number, password: string, waittime = 1, message = ''): Promise<void> {
  await post(host, port, password, '/shutdown', { waittime, message });
}

/** Immediate, ungraceful stop. */
export async function restStop(host: string, port: number, password: string): Promise<void> {
  await post(host, port, password, '/stop');
}
