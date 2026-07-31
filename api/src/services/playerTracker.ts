/**
 * Log-based player tracker.
 *
 * Palworld dedicated server writes join/leave events to its log file.
 * We parse them here so the dashboard always shows an accurate player
 * count even when RCON is unavailable.
 *
 * Recognised log patterns:
 *   Join: LogPalOnlineSessionSettings: NotifyPlayerJoined name=X uid=Y steamid=Z
 *   Leave: LogPalOnlineSessionSettings: NotifyPlayerLeft uid=Y steamid=Z
 *
 * Fallbacks (older / community server builds):
 *   Join: LogNet: Join succeeded: PlayerName
 *   Leave: LogNet: UChannel::CloseActorChannels (connection closed — drops unknown uid)
 */

export interface TrackedPlayer {
  name:     string;
  playerUid: string;
  steamId:  string;
  joinedAt: number; // unix ms
}

// instanceId → map of uid → player
const onlinePlayers = new Map<number, Map<string, TrackedPlayer>>();

function getMap(instanceId: number): Map<string, TrackedPlayer> {
  if (!onlinePlayers.has(instanceId)) onlinePlayers.set(instanceId, new Map());
  return onlinePlayers.get(instanceId)!;
}

// Primary patterns (preferred — contain uid for clean deduplication)
const JOIN_RE  = /NotifyPlayerJoined\s+name=(.+?)\s+uid=(\S+?)(?:\s+steamid=(\S+))?$/i;
const LEAVE_RE = /NotifyPlayerLeft\s+uid=(\S+)/i;

// Secondary patterns (older logs / community servers)
const JOIN_SIMPLE_RE  = /LogNet:.*Join\s+succeeded:\s+(.+)$/i;

export type PlayerEvent = { event: 'join' | 'leave'; player: TrackedPlayer };
export type PlayerEventCallback = (evt: PlayerEvent) => void;

const eventListeners = new Map<number, PlayerEventCallback>();

export function setPlayerEventCallback(instanceId: number, cb: PlayerEventCallback): void {
  eventListeners.set(instanceId, cb);
}

export function onLogLine(instanceId: number, line: string): void {
  const players = getMap(instanceId);
  const emit = (evt: PlayerEvent) => eventListeners.get(instanceId)?.(evt);

  // ── Primary join ──────────────────────────────────────────────────────────
  const jm = JOIN_RE.exec(line);
  if (jm) {
    const [, name, uid, steamId = ''] = jm;
    const player: TrackedPlayer = { name: name.trim(), playerUid: uid, steamId, joinedAt: Date.now() };
    players.set(uid, player);
    emit({ event: 'join', player });
    return;
  }

  // ── Primary leave ─────────────────────────────────────────────────────────
  const lm = LEAVE_RE.exec(line);
  if (lm) {
    const player = players.get(lm[1]);
    players.delete(lm[1]);
    if (player) emit({ event: 'leave', player });
    return;
  }

  // ── Secondary join (no uid — use name as key) ─────────────────────────────
  const jsm = JOIN_SIMPLE_RE.exec(line);
  if (jsm) {
    const name = jsm[1].trim();
    if (!players.has(name)) {
      const player: TrackedPlayer = { name, playerUid: name, steamId: '', joinedAt: Date.now() };
      players.set(name, player);
      emit({ event: 'join', player });
    }
    return;
  }
}

/** Return current online players for the given instance. */
export function getOnlinePlayers(instanceId: number): TrackedPlayer[] {
  return Array.from(getMap(instanceId).values());
}

/** Clear players when the server goes offline (prevents stale count). */
export function clearPlayers(instanceId: number): void {
  getMap(instanceId).clear();
}
