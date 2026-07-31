import { getDb } from '../db/index.js';
import { BUILTIN_ROLE_PERMISSIONS } from '../permissions.js';

/** In-memory permission cache: roleName → permission string[]. */
const cache = new Map<string, string[]>();

export function invalidatePermissionCache(roleName?: string): void {
  if (roleName) cache.delete(roleName);
  else cache.clear();
}

export function getPermissionsForRole(roleName: string): string[] {
  if (cache.has(roleName)) return cache.get(roleName)!;

  // Check built-in roles first (they never need a DB lookup)
  if (roleName in BUILTIN_ROLE_PERMISSIONS) {
    const perms = BUILTIN_ROLE_PERMISSIONS[roleName] as string[];
    cache.set(roleName, perms);
    return perms;
  }

  // Custom role — look up in DB
  try {
    const row = getDb()
      .prepare('SELECT permissions FROM roles WHERE name = ?')
      .get(roleName) as { permissions: string } | undefined;

    const perms: string[] = row ? (JSON.parse(row.permissions) as string[]) : [];
    cache.set(roleName, perms);
    return perms;
  } catch {
    return [];
  }
}

export function userHasPermission(roleName: string, permission: string): boolean {
  return getPermissionsForRole(roleName).includes(permission);
}
