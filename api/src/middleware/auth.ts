import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { cfg } from '../config.js';

export interface AuthPayload {
  sub: string;       // userId as string
  username: string;
  role: 'owner' | 'operator' | 'viewer';
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

export function requireRole(minRole: 'owner' | 'operator') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = req.auth?.role;
    if (minRole === 'owner' && role !== 'owner') {
      res.status(403).json({ error: 'Owner role required' });
      return;
    }
    if (minRole === 'operator' && role === 'viewer') {
      res.status(403).json({ error: 'Operator role required' });
      return;
    }
    next();
  };
}
