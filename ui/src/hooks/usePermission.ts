import { useAuth } from '../context/AuthContext';

/**
 * Returns true if the current user has the given permission.
 * Usage: const canStop = usePermission('server.stop');
 */
export function usePermission(permission: string): boolean {
  const { can } = useAuth();
  return can(permission);
}

/**
 * Returns a function that checks multiple permissions at once.
 * Usage: const { can } = usePermissions(); if (can('server.stop') && can('server.restart')) ...
 */
export function usePermissions() {
  const { can, user } = useAuth();
  return { can, user, permissions: user?.permissions ?? [] };
}
