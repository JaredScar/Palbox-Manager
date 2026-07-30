import { Request, Response, NextFunction } from 'express';
import { getDb } from '../db';
import type { Instance } from '../db/types';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      instance?: Instance;
    }
  }
}

export function resolveInstance(req: Request, res: Response, next: NextFunction): void {
  const rawId = req.params.instanceId ?? req.query.instance ?? '1';
  const id = parseInt(String(rawId), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid instance ID' });
    return;
  }
  const db = getDb();
  const inst = db.prepare('SELECT * FROM instances WHERE id = ?').get(id) as Instance | undefined;
  if (!inst) {
    res.status(404).json({ error: 'Instance not found' });
    return;
  }
  req.instance = inst;
  next();
}

export function getDefaultInstance(): Instance {
  const db = getDb();
  return db.prepare('SELECT * FROM instances ORDER BY id ASC LIMIT 1').get() as Instance;
}
