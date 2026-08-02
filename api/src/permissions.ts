// All granular permission strings used across the platform.
export const ALL_PERMISSIONS = [
  // Server status + control
  'server.view',    'server.start',    'server.stop',
  'server.restart', 'server.rcon',     'server.save',
  // Players
  'players.view',   'players.kick',    'players.ban',
  'players.whitelist', 'players.notes',
  // Backups
  'backups.view',   'backups.create',  'backups.delete',  'backups.restore',
  // Updates
  'updates.view',   'updates.apply',   'panel.update',
  // Mods
  'mods.view',      'mods.manage',
  // Console / RCON macros
  'console.view',   'console.rcon',    'macros.manage',
  // Metrics
  'metrics.view',
  // Scheduled restarts
  'restarts.view',  'restarts.manage',
  // Broadcasts & alerts
  'broadcasts.manage', 'alerts.manage',
  // Event triggers
  'triggers.manage',
  // Audit log
  'audit.view',
  // Settings
  'settings.view',  'settings.manage',
  // User + role management (owner only by default)
  'users.manage',   'roles.manage',
  // Maintenance mode
  'maintenance.manage',
  // Cluster / World map / Config history / Notifications
  'cluster.view',   'world.view',  'config.view',  'notifications.view',
  // Pals read from the world save, and spawning them (needs the PalDefender mod)
  'pals.view',      'pals.spawn',
  // Timed rule changes, such as a double XP weekend
  'events.view',    'events.manage',
] as const;

export type Permission = typeof ALL_PERMISSIONS[number];

// ── Built-in role permission sets ─────────────────────────────────────────────
const VIEWER_PERMS: Permission[] = [
  'server.view',
  'players.view',
  'backups.view',
  'updates.view',
  'mods.view',
  'console.view',
  'metrics.view',
  'restarts.view',
  'audit.view',
  'settings.view',
  'cluster.view', 'world.view', 'config.view', 'notifications.view',
  'pals.view',
  'events.view',
];

const OPERATOR_PERMS: Permission[] = [
  ...VIEWER_PERMS,
  'server.start', 'server.stop', 'server.restart', 'server.rcon', 'server.save',
  'players.kick', 'players.ban', 'players.whitelist', 'players.notes',
  'backups.create',
  'mods.manage',
  'console.rcon', 'macros.manage',
  'restarts.manage',
  'broadcasts.manage', 'alerts.manage',
  'triggers.manage',
  'maintenance.manage',
  'events.manage',
  // Not pals.spawn: handing out Pals rewrites the server economy, so it stays
  // an owner-granted power rather than something every operator has.
];

const OWNER_PERMS: Permission[] = ALL_PERMISSIONS as unknown as Permission[];

export const BUILTIN_ROLE_PERMISSIONS: Record<string, Permission[]> = {
  owner:    OWNER_PERMS,
  operator: OPERATOR_PERMS,
  viewer:   VIEWER_PERMS,
};

export const BUILTIN_ROLE_DESCRIPTIONS: Record<string, string> = {
  owner:    'Full access to all features including user and role management.',
  operator: 'Can operate and manage the server but cannot manage users or change critical settings.',
  viewer:   'Read-only access to all dashboards and logs.',
};
