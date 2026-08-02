const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) },
      // Without this a stalled endpoint hangs the caller forever; polled views
      // then queue requests until the browser's connection limit freezes the UI.
      signal: AbortSignal.timeout(30_000),
      ...options,
    });
  } catch (e) {
    // AbortSignal.timeout throws a TimeoutError DOMException whose message
    // ("signal timed out") is meaningless to a user.
    if (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      throw new Error(`Request to ${path} timed out — the server did not respond in time.`);
    }
    throw e;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? res.statusText);
  }
  return res.json();
}

// ── Instances ────────────────────────────────────────────────────────────────
export const instanceApi = {
  list: () => request<Instance[]>('/instances'),
  create: (data: Partial<Instance>) =>
    request<Instance>('/instances', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: Partial<Instance>) =>
    request<Instance>(`/instances/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: number) => request(`/instances/${id}`, { method: 'DELETE' }),
};

// ── Per-instance API factory ──────────────────────────────────────────────────
export interface GuildMember {
  playerId: string;
  name: string;
  lastOnline: number | null;
}

export interface Guild {
  groupId: string;
  name: string;
  baseCampLevel: number;
  adminPlayerId: string | null;
  memberCount: number;
  members: GuildMember[];
  updatedAt: number;
}

export interface BaseCamp {
  baseId: string;
  guildId: string | null;
  /** Unreal world coordinates, the same space player positions use. */
  x: number; y: number; z: number;
  areaRange: number;
  state: number;
}

export interface WorldScanStatus {
  file: string | null;
  scannedAt: number | null;
  savedAt: number | null;
  guilds: number;
  bases: number;
  error: string | null;
  scanning: boolean;
}

export interface WorldSaveData {
  guilds: Guild[];
  bases: BaseCamp[];
  scan: WorldScanStatus | null;
}

/** Static reference data for a species, generated from the game's own tables. */
export interface PalDexEntry {
  name: string;
  tribe: string;
  dex: number;
  elements: string[];
  rarity: number;
  boss: boolean;
  raid: boolean;
  nocturnal: boolean;
  icon: string | null;
  hp: number;
  attack: number;
  defense: number;
  work: Record<string, number>;
}

/** One creature as it exists in the world save. */
export interface Pal {
  uid: string;
  characterId: string;
  name: string;
  nickname: string | null;
  level: number;
  gender: 'Male' | 'Female' | null;
  lucky: boolean;
  boss: boolean;
  rank: number;
  ivs: { hp: number; melee: number; shot: number; defense: number };
  souls: { hp: number; attack: number; defence: number; craftSpeed: number };
  passives: string[];
  ownerPlayerId: string | null;
}

export interface PalOwner {
  playerId: string;
  name: string;
  level: number;
}

export interface PalsResponse {
  pals: Pal[];
  owners: PalOwner[];
}

/** Whether the server can spawn Pals at all, which needs the PalDefender mod. */
export interface PalSpawnCapability {
  available: boolean;
  commands: string[];
  detail: string;
}

export interface PalSpawnTarget {
  name: string;
  playerUid: string;
  level: number;
}

export interface SpawnPalRequest {
  characterId: string;
  level: number;
  playerUid?: string;
  x?: number;
  y?: number;
}

export function makeApi(instanceId: number) {
  const p = (path: string) => `/instances/${instanceId}${path}`;

  return {
    // Server
    status: () => request<ServerStatus>(p('/server/status')),
    metrics: (hours = 24) => request<MetricPoint[]>(p(`/server/metrics?hours=${hours}`)),
    heatmap: () => request<HeatmapCell[]>(p('/server/metrics/heatmap')),
    exportMetrics: (from: number, to: number, format: 'csv' | 'json') =>
      `${p(`/server/metrics/export`)}?from=${from}&to=${to}&format=${format}`,
    start:   () => request(p('/server/start'),   { method: 'POST' }),
    stop:    () => request(p('/server/stop'),    { method: 'POST' }),
    restart: () => request(p('/server/restart'), { method: 'POST' }),
    save:    () => request(p('/server/save'),    { method: 'POST' }),
    rcon: (command: string) =>
      request<{ result: string }>(p('/server/rcon'), { method: 'POST', body: JSON.stringify({ command }) }),
    watchdog: () => request<WatchdogInfo>(p('/server/watchdog')),
    setWatchdog: (armed: boolean) =>
      request(p('/server/watchdog'), { method: 'PATCH', body: JSON.stringify({ armed }) }),

    // Backups
    listBackups:    () => request<Backup[]>(p('/backups')),
    createBackup:   () => request<Backup>(p('/backups'), { method: 'POST' }),
    deleteBackup:   (id: number) => request(p(`/backups/${id}`), { method: 'DELETE' }),
    downloadUrl:    (id: number) => `${BASE}/instances/${instanceId}/backups/${id}/download`,
    restoreBackup:  (id: number) => request(p(`/backups/${id}/restore`), { method: 'POST' }),

    // Save file browser
    saveBrowser: (dir = '') => request<{ saveDir: string; dir: string; entries: SaveEntry[] }>(
      p(`/savebrowser${dir ? `?dir=${encodeURIComponent(dir)}` : ''}`),
    ),
    saveFileDownloadUrl: (filePath: string) =>
      `${BASE}/instances/${instanceId}/savebrowser/download?path=${encodeURIComponent(filePath)}`,

    // Updates
    buildInfo:    () => request<BuildInfo>(p('/updates')),
    checkUpdate:  () => request(p('/updates/check'), { method: 'POST' }),
    applyUpdate:  () => request(p('/updates/apply'), { method: 'POST' }),
    getSchedule:  () => request<RestartSchedule>(p('/updates/schedule')),
    patchSchedule: (data: Partial<RestartSchedule>) =>
      request<RestartSchedule>(p('/updates/schedule'), { method: 'PATCH', body: JSON.stringify(data) }),

    // Triggers
    listTriggers:   () => request<EventTrigger[]>(`${BASE}/instances/${instanceId}/triggers`),
    createTrigger:  (data: Partial<EventTrigger>) =>
      request<EventTrigger>(`${BASE}/instances/${instanceId}/triggers`, { method: 'POST', body: JSON.stringify(data) }),
    updateTrigger:  (id: number, data: Partial<EventTrigger>) =>
      request(`${BASE}/instances/${instanceId}/triggers/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    deleteTrigger:  (id: number) =>
      request(`${BASE}/instances/${instanceId}/triggers/${id}`, { method: 'DELETE' }),

    // Notifications
    listNotifications: (limit = 50) =>
      request<AppNotification[]>(`${BASE}/instances/${instanceId}/notifications?limit=${limit}`),
    unreadCount:    () => request<{ count: number }>(`${BASE}/instances/${instanceId}/notifications/unread`),
    markAllRead:    () =>
      request(`${BASE}/instances/${instanceId}/notifications/read`, { method: 'POST' }),

    // Config history
    listConfigHistory: () =>
      request<ConfigSnapshot[]>(p('/server/config-history')),
    getConfigSnapshot:  (id: number) =>
      request<ConfigSnapshot & { content: string }>(p(`/server/config-history/${id}`)),
    diffConfigSnapshot: (id: number) =>
      request<{ diff: DiffLine[]; from?: number; to?: number }>(p(`/server/config-history/${id}/diff`)),

    // Settings
    getSettings:  () => request<Record<string, string>>(p('/settings')),
    patchSettings: (data: Record<string, string>) =>
      request(p('/settings'), { method: 'PATCH', body: JSON.stringify(data) }),
    getRawIni:    () => request<{ content: string }>(p('/settings/raw')),
    putRawIni:    (content: string) =>
      request(p('/settings/raw'), { method: 'PUT', body: JSON.stringify({ content }) }),
    getAppSettings:   () => request<Record<string, string>>(p('/settings/app')),
    patchAppSettings: (data: Record<string, string>) =>
      request(p('/settings/app'), { method: 'PATCH', body: JSON.stringify(data) }),

    // Players
    listPlayers: () => request<Player[]>(p('/players')),
    playerLeaderboard: (limit = 10) => request<{ steam_id: string; name: string; playtime_s: number }[]>(p(`/players/leaderboard?limit=${limit}`)),
    listBans: () => request<Player[]>(p('/players/bans')),
    playerEvents: (limit = 100) => request<PlayerEvent[]>(p(`/players/events?limit=${limit}`)),
    playerGeo: (steamId: string) => request<{ country: string; flag: string }>(p(`/players/${steamId}/geo`)),
    addPlayer: (steam_id: string, name: string) =>
      request(p('/players'), { method: 'POST', body: JSON.stringify({ steam_id, name }) }),
    setWhitelist: (steamId: string, whitelisted: boolean) =>
      request(p(`/players/${steamId}/whitelist`), { method: 'PATCH', body: JSON.stringify({ whitelisted }) }),
    kickPlayer: (steamId: string, reason?: string) =>
      request(p(`/players/${steamId}/kick`), { method: 'POST', body: JSON.stringify({ reason }) }),
    banPlayer:  (steamId: string, reason?: string, expires?: number) =>
      request(p(`/players/${steamId}/ban`),   { method: 'POST', body: JSON.stringify({ reason, expires }) }),
    unbanPlayer:(steamId: string) => request(p(`/players/${steamId}/unban`), { method: 'POST' }),

    // Mods
    listMods:   () => request<Mod[]>(p('/mods')),
    toggleMod:  (id: number, enabled: boolean) =>
      request(p(`/mods/${id}/toggle`), { method: 'PATCH', body: JSON.stringify({ enabled }) }),
    removeMod:  (id: number) => request(p(`/mods/${id}`), { method: 'DELETE' }),

    // RCON Macros
    listMacros:  () => request<RconMacro[]>(p('/macros')),
    createMacro: (data: Partial<RconMacro>) =>
      request<{ id: number }>(p('/macros'), { method: 'POST', body: JSON.stringify(data) }),
    updateMacro: (id: number, data: Partial<RconMacro>) =>
      request(p(`/macros/${id}`), { method: 'PATCH', body: JSON.stringify(data) }),
    deleteMacro: (id: number) => request(p(`/macros/${id}`), { method: 'DELETE' }),
    runMacro:    (id: number) => request<{ result: string }>(p(`/macros/${id}/run`), { method: 'POST' }),

    // Timed Broadcasts
    listBroadcasts:  () => request<BroadcastSchedule[]>(p('/broadcasts')),
    createBroadcast: (data: Partial<BroadcastSchedule>) =>
      request<{ id: number }>(p('/broadcasts'), { method: 'POST', body: JSON.stringify(data) }),
    updateBroadcast: (id: number, data: Partial<BroadcastSchedule>) =>
      request(p(`/broadcasts/${id}`), { method: 'PATCH', body: JSON.stringify(data) }),
    deleteBroadcast: (id: number) => request(p(`/broadcasts/${id}`), { method: 'DELETE' }),

    // Alert Rules
    listAlerts:  () => request<AlertRule[]>(p('/alerts')),
    createAlert: (data: Partial<AlertRule>) =>
      request<{ id: number }>(p('/alerts'), { method: 'POST', body: JSON.stringify(data) }),
    updateAlert: (id: number, data: Partial<AlertRule>) =>
      request(p(`/alerts/${id}`), { method: 'PATCH', body: JSON.stringify(data) }),
    deleteAlert: (id: number) => request(p(`/alerts/${id}`), { method: 'DELETE' }),

    // Audit log
    auditLog: (limit = 200) => request<AuditEntry[]>(p(`/audit?limit=${limit}`)),

    // Chat / log
    chatMessages: (limit = 100) => request<ChatMessage[]>(p(`/chat?limit=${limit}`)),
    logLines: (tail = 200, search = '') =>
      request<{ lines: string[] }>(p(`/chat/log?tail=${tail}&search=${encodeURIComponent(search)}`)),
    logStatus: () => request<LogStatus>(p('/chat/log-status')),
  enableLogging: () => request<{ changed: boolean; restartRequired: boolean; message: string }>(
    p('/chat/enable-logging'), { method: 'POST' },
  ),

    // Backup schedule
    getBackupSchedule: () => request<BackupScheduleConfig>(p('/backups/schedule')),
    patchBackupSchedule: (data: Partial<BackupScheduleConfig>) =>
      request(p('/backups/schedule'), { method: 'PATCH', body: JSON.stringify(data) }),

    // World overview
    worldInfo: () => request<WorldInfo>(p('/server/world')),

    // Maintenance mode
    maintenanceStatus: () => request<MaintenanceState>(p('/maintenance')),
    enableMaintenance: (message?: string, countdownMinutes?: number) =>
      request(p('/maintenance/enable'), { method: 'POST', body: JSON.stringify({ message, countdownMinutes }) }),
    disableMaintenance: () => request(p('/maintenance/disable'), { method: 'POST' }),

    // Player notes & tags
    playerNotes: (steamId: string) => request<PlayerNote[]>(p(`/players/${steamId}/notes`)),
    addPlayerNote: (steamId: string, note: string) =>
      request<{ id: number }>(p(`/players/${steamId}/notes`), { method: 'POST', body: JSON.stringify({ note }) }),
    deletePlayerNote: (steamId: string, noteId: number) =>
      request(p(`/players/${steamId}/notes/${noteId}`), { method: 'DELETE' }),
    playerTags: (steamId: string) => request<PlayerTag[]>(p(`/players/${steamId}/tags`)),
    addPlayerTag: (steamId: string, tag: string, color?: string) =>
      request(p(`/players/${steamId}/tags`), { method: 'PUT', body: JSON.stringify({ tag, color }) }),
    removePlayerTag: (steamId: string, tag: string) =>
      request(p(`/players/${steamId}/tags/${encodeURIComponent(tag)}`), { method: 'DELETE' }),

    // Uptime tracker
    uptime: (days = 30) => request<UptimeData>(p(`/uptime?days=${days}`)),

    // Palworld REST API info
    palrestInfo: () => request<PalRestInfo>(p('/palrest/info')),
    palrestPlayers: () => request<PalRestPlayer[]>(p('/palrest/players')),

    // Guilds and base camps, read out of Level.sav rather than any live API
    worldSave: () => request<WorldSaveData>(p('/world-save')),
    scanWorldSave: () => request<WorldScanStatus>(p('/world-save/scan'), { method: 'POST' }),

    // Pals, also read out of the save. The dex is static reference data.
    pals: () => request<PalsResponse>(p('/pals')),
    palDex: () => request<Record<string, PalDexEntry>>(p('/pals/dex')),
    palSpawnCapability: () => request<PalSpawnCapability>(p('/pals/spawn-capability')),
    palSpawnTargets: () => request<PalSpawnTarget[]>(p('/pals/targets')),
    spawnPal: (body: SpawnPalRequest) =>
      request<{ ok: boolean; result: string }>(p('/pals/spawn'), {
        method: 'POST',
        body: JSON.stringify(body),
      }),

    // Connection diagnostics — probes can legitimately take a few seconds each,
    // so this gets a longer budget than the default request timeout.
    diagnostics: () =>
      request<DiagnosticsResponse>(p('/server/diagnostics'), {
        method: 'POST',
        signal: AbortSignal.timeout(60_000),
      }),
  };
}

// Global search (cross-instance)
export const searchApi = {
  search: (q: string, instanceId?: number) =>
    request<{ query: string; results: SearchResult[] }>(
      `/api/search?q=${encodeURIComponent(q)}${instanceId != null ? `&instanceId=${instanceId}` : ''}`,
    ),
};

// Convenience: read auth state
export const authApi = {
  login:  (username: string, password: string, totpCode?: string) =>
    request<{ ok?: boolean; requireTotp?: boolean; role?: string; username?: string }>(
      '/auth/login', { method: 'POST', body: JSON.stringify({ username, password, totpCode }) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  me:     () => request<{ authenticated: boolean; username?: string; role?: string; permissions?: string[] }>('/auth/me'),

  // User management
  listUsers: () => request<UserAccount[]>('/auth/users'),
  createUser: (username: string, password: string, role: string, role_id?: number) =>
    request<{ id: number }>('/auth/users', { method: 'POST', body: JSON.stringify({ username, password, role, role_id }) }),
  updateUser: (id: number, data: { password?: string; role?: string; role_id?: number | null }) =>
    request(`/auth/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteUser: (id: number) => request(`/auth/users/${id}`, { method: 'DELETE' }),

  // Role management
  listRoles: () => request<Role[]>('/auth/roles'),
  listAllPermissions: () => request<string[]>('/auth/roles/permissions'),
  createRole: (name: string, description: string, permissions: string[]) =>
    request<{ id: number }>('/auth/roles', { method: 'POST', body: JSON.stringify({ name, description, permissions }) }),
  updateRole: (id: number, data: { description?: string; permissions?: string[] }) =>
    request(`/auth/roles/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteRole: (id: number) => request(`/auth/roles/${id}`, { method: 'DELETE' }),

  // TOTP 2FA
  totpSetup: () => request<{ secret: string; qrDataUrl: string; otpAuthUrl: string }>('/auth/totp/setup', { method: 'POST' }),
  totpEnable: (code: string) => request('/auth/totp/enable', { method: 'POST', body: JSON.stringify({ code }) }),
  totpDisable: () => request('/auth/totp/disable', { method: 'POST' }),

  // Password change
  changePassword: (currentPassword: string, newPassword: string) =>
    request('/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
};

// ── Types ────────────────────────────────────────────────────────────────────

export interface Instance {
  id: number;
  name: string;
  service_name: string;
  exe_path: string;
  save_dir: string;
  backup_dir: string;
  settings_ini: string;
  log_file: string;
  rcon_host: string;
  rcon_port: number;
  rcon_password: string;
  public_ip: string;
  game_port: number;
  steamcmd_exe: string;
  mods_dir: string;
  created_at: number;
}

export interface ServerStatus {
  status: 'online' | 'offline' | 'starting' | 'stopping';
  uptime: number | null;
  cpuPct: number;
  memMb: number;
  players: { name: string; playerUid: string; steamId: string }[];
  buildId: string | null;
  watchdogArmed: boolean;
  lastWatchdogIntervention: number | null;
  instance: Instance;
}

export interface WatchdogInfo {
  armed: boolean;
  lastIntervention: number | null;
  events: { id: number; event: string; detail: string | null; created_at: number }[];
}

export interface MetricPoint {
  players: number;
  cpu_pct: number;
  mem_mb: number;
  recorded_at: number;
}

export interface Backup {
  id: number;
  instance_id: number;
  filename: string;
  filepath: string;
  size_bytes: number;
  type: 'auto' | 'manual';
  created_at: number;
}

export interface BuildInfo {
  installed: string | null;
  latest: string | null;
  updateAvailable: boolean;
  lastChecked: number | null;
  history: { id: number; build_id: string; created_at: number }[];
}

export interface RestartSchedule {
  id: number;
  instance_id: number;
  frequency: 'off' | 'hourly' | '3h' | '6h' | '12h' | 'daily' | 'weekly' | 'custom';
  time: string;
  cron_expr: string;
  timezone: string;
  warn_minutes: number;
  enabled: number;
  nextRestart: number | null; // unix ms
}

export interface Player {
  id: number;
  instance_id: number;
  steam_id: string;
  name: string;
  playtime_s: number;
  last_seen: number | null;
  whitelisted: number;
  banned: number;
  ban_reason: string | null;
  ban_expires: number | null;
}

export interface PlayerEvent {
  id: number;
  instance_id: number;
  steam_id: string;
  player_name: string;
  event: 'join' | 'leave';
  created_at: number;
}

export interface Mod {
  id: number;
  instance_id: number;
  name: string;
  folder_name: string;
  version: string;
  enabled: number;
  build_id: string;
  installed_at: number;
  /** UE4SS script mod, or a .pak under Content\Paks. */
  kind: 'ue4ss' | 'pak';
  /** Ships with UE4SS rather than installed by the user. */
  builtin: number;
  rel_path: string;
}

export interface RconMacro {
  id: number;
  instance_id: number;
  name: string;
  command: string;
  description: string;
  color: string;
  sort_order: number;
  created_at: number;
}

export interface BroadcastSchedule {
  id: number;
  instance_id: number;
  name: string;
  message: string;
  cron: string;
  enabled: number;
  created_at: number;
}

export interface AlertRule {
  id: number;
  instance_id: number;
  name: string;
  metric: 'cpu' | 'memory' | 'players' | 'status';
  operator: 'gt' | 'lt' | 'eq';
  threshold: number;
  cooldown_m: number;
  enabled: number;
  last_fired: number | null;
  created_at: number;
}

export interface AuditEntry {
  id: number;
  instance_id: number | null;
  actor: string;
  action: string;
  detail: string;
  created_at: number;
}

export interface ChatMessage {
  id: number;
  instance_id: number;
  player_name: string;
  content: string;
  captured_at: number;
}

export interface BackupScheduleConfig {
  instance_id?: number;
  frequency: 'off' | 'hourly' | 'daily' | 'weekly';
  hour: number;
  day_of_week: number;
  enabled: number;
}

export interface WorldInfo {
  serverName: string;
  serverDescription: string;
  maxPlayers: number;
  isPvP: boolean;
  isMultiplay: boolean;
  difficulty: string;
  expRate: number;
  palCaptureRate: number;
  deathPenalty: string;
  workSpeedRate: number;
  dayTimeSpeedRate: number;
  nightTimeSpeedRate: number;
  guildPlayerMaxNum: number;
  enableFriendlyFire: boolean;
  enablePvp: boolean;
  rconEnabled: boolean;
  region: string;
}

export interface MaintenanceState {
  active: boolean;
  message: string;
  startedAt: number | null;
}

export interface PlayerNote {
  id: number;
  instance_id: number;
  steam_id: string;
  note: string;
  author: string;
  created_at: number;
}

export interface PlayerTag {
  tag: string;
  color: string;
}

export interface UptimeData {
  events: Array<{ id: number; status: string; started_at: number }>;
  sla: { uptimePct: number; offlineSec: number; days: number };
  outages: { count: number; longestSec: number; avgSec: number };
}

export interface UserAccount {
  id: number;
  username: string;
  role: string;
  role_id: number | null;
  effective_role: string;
  totp_enabled: number;
  created_at: number;
  last_login: number | null;
}

export interface Role {
  id: number;
  name: string;
  description: string;
  permissions: string;   // JSON array stored as string from SQLite
  is_builtin: number;
  created_at: number;
}

export interface SaveEntry {
  name: string;
  relativePath: string;
  isDir: boolean;
  size: number;
  modifiedAt: number;
}

export interface SearchResult {
  type: 'player' | 'chat' | 'audit' | 'note';
  title: string;
  subtitle: string;
  meta?: string;
  instanceId: number;
  instanceName: string;
  ts?: number;
  link?: string;
}

export interface PalRestInfo {
  version: string;
  servername: string;
  description: string;
  worldguid: string;
  days: number;
}

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

export interface HeatmapCell {
  dow: number;         // 0=Sun … 6=Sat
  hour: number;        // 0-23
  avg_players: number;
  max_players: number;
  samples: number;
}

export interface EventTrigger {
  id: number;
  instance_id: number;
  name: string;
  event_type: string;
  threshold: number;
  action_type: string;
  action_params: string;
  cooldown_m: number;
  enabled: number;
  last_fired: number | null;
  created_at: number;
}

export interface AppNotification {
  id: number;
  instance_id: number | null;
  title: string;
  body: string;
  level: 'info' | 'warn' | 'error' | 'success';
  read: number;
  created_at: number;
}

export interface ConfigSnapshot {
  id: number;
  instance_id: number;
  hash: string;
  created_at: number;
}

export interface DiffLine {
  type: '+' | '-' | ' ';
  line: string;
}

export interface DiagResult {
  ok:         boolean;
  latencyMs:  number | null;
  error:      string | null;
  /** Actionable next step, e.g. "switch the RCON host to 127.0.0.1". */
  hint?:      string;
  /** Implementation that answered, when more than one was tried. */
  strategy?:  string;
  /** Outcome per RCON implementation, for pinning down protocol quirks. */
  attempts?:  { strategy: string; error: string }[];
}

export interface LogStatus {
  configured: boolean;
  /** The log actually in use, which may differ from the configured path. */
  path:       string;
  configuredPath: string;
  /** The configured path is wrong but a real log was found anyway. */
  configuredMismatch: boolean;
  exists:     boolean;
  sizeBytes:  number | null;
  modifiedAt: number | null;
  tailing:    boolean;
  buffered:   number;
  /** Set when the live stream cannot produce output; explains which fix applies. */
  reason:     string | null;
}

export interface DiagnosticsResponse {
  rcon:    DiagResult;
  rest:    DiagResult & { serverName?: string; version?: string };
  summary: string;
  /** True when something needs attention. RCON alone failing does not. */
  degraded: boolean;
  /** Server process is up but too young to have opened its listeners yet. */
  warmingUp: boolean;
  uptimeSeconds: number | null;
}
