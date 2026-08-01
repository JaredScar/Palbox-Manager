/**
 * Palworld built-in REST API client (available since v0.1.4+).
 * The server exposes HTTP on RESTAPIPort (default 8212).
 * Auth: Basic auth with username "admin" and AdminPassword.
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

function makeAuth(password: string): string {
  return 'Basic ' + Buffer.from(`admin:${password}`).toString('base64');
}

async function get<T>(host: string, port: number, password: string, path: string): Promise<T> {
  const url = `http://${host}:${port}/v1/api${path}`;
  const resp = await fetch(url, {
    headers: {
      Authorization: makeAuth(password),
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(6000),
  });
  if (!resp.ok) throw new Error(`REST API ${resp.status}: ${await resp.text()}`);
  return resp.json() as T;
}

async function post<T>(host: string, port: number, password: string, path: string, body: unknown): Promise<T> {
  const url = `http://${host}:${port}/v1/api${path}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: makeAuth(password),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(6000),
  });
  if (!resp.ok) throw new Error(`REST API ${resp.status}: ${await resp.text()}`);
  return resp.json() as T;
}

export async function restGetInfo(host: string, port: number, password: string): Promise<PalRestInfo> {
  return get<PalRestInfo>(host, port, password, '/info');
}

export async function restGetPlayers(host: string, port: number, password: string): Promise<PalRestPlayer[]> {
  const data = await get<{ players: PalRestPlayer[] }>(host, port, password, '/players');
  return data.players ?? [];
}

export async function restSendCommand(host: string, port: number, password: string, command: string): Promise<string> {
  const data = await post<{ message: string }>(host, port, password, '/command', { command });
  return data.message ?? '';
}

export async function restKickPlayer(host: string, port: number, password: string, userId: string, message = ''): Promise<void> {
  await post(host, port, password, '/kick', { userid: userId, message });
}

export async function restBanPlayer(host: string, port: number, password: string, userId: string, message = ''): Promise<void> {
  await post(host, port, password, '/ban', { userid: userId, message });
}

export async function restSave(host: string, port: number, password: string): Promise<void> {
  await post(host, port, password, '/save', {});
}

export async function restAnnounce(host: string, port: number, password: string, message: string): Promise<void> {
  await post(host, port, password, '/announce', { message });
}
