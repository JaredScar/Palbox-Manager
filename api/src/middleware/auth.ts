import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { cfg } from '../config.js';
import { userHasPermission } from '../services/permissionCache.js';

export interface AuthPayload {
  sub: string;       // userId as string
  username: string;
  role: string;      // role name (built-in or custom)
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token =
    req.cookies?.palbox_token ??
    req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const payload = jwt.verify(token, cfg.auth.jwtSecret) as AuthPayload;
    req.auth = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/** Legacy role-level guard — kept for backward compatibility. Prefer requirePermission. */
export function requireRole(minRole: 'owner' | 'operator') {
  return requirePermission(minRole === 'owner' ? 'users.manage' : 'server.start');
}

/** Fine-grained permission guard. */
export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = req.auth?.role;
    if (!role) { res.status(401).json({ error: 'Unauthorized' }); return; }
    if (!userHasPermission(role, permission)) {
      res.status(403).json({ error: `Permission denied: requires '${permission}'` });
      return;
    }
    next();
  };
}
