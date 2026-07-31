import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { cfg } from '../config.js';
import { getDb } from '../db/index.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { logAction } from '../services/audit.js';
import { getPermissionsForRole, invalidatePermissionCache } from '../services/permissionCache.js';
import { ALL_PERMISSIONS } from '../permissions.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts — try again in 15 minutes' },
});

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: string;
  role_id: number | null;
  totp_enabled: number;
  totp_secret: string | null;
  created_at: number;
  last_login: number | null;
}

interface RoleRow { name: string; }

function effectiveRoleName(user: UserRow): string {
  if (user.role_id != null) {
    const r = getDb()
      .prepare('SELECT name FROM roles WHERE id = ?')
      .get(user.role_id) as RoleRow | undefined;
    if (r) return r.name;
  }
  return user.role;
}

function issueToken(user: UserRow): string {
  return jwt.sign(
    { sub: String(user.id), username: user.username, role: effectiveRoleName(user) },
    cfg.auth.jwtSecret,
    { expiresIn: cfg.auth.jwtExpiresIn } as jwt.SignOptions,
  );
}

function setCookie(res: import('express').Response, token: string): void {
  res.cookie('palbox_token', token, {
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 8 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production',
  });
}

// ── Login ─────────────────────────────────────────────────────────────────────
router.post('/login', loginLimiter, async (req, res) => {
  const { username, password, totpCode } = req.body as {
    username?: string; password?: string; totpCode?: string;
  };
  if (!username || !password) {
    res.status(400).json({ error: 'username and password required' }); return;
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
  if (!user) { res.status(401).json({ error: 'Invalid credentials' }); return; }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) { res.status(401).json({ error: 'Invalid credentials' }); return; }

  // TOTP check
  if (user.totp_enabled && user.totp_secret) {
    if (!totpCode) {
      res.status(200).json({ requireTotp: true }); return;
    }
    const valid = speakeasy.totp.verify({ token: totpCode, secret: user.totp_secret, encoding: 'base32' });
    if (!valid) { res.status(401).json({ error: 'Invalid 2FA code' }); return; }
  }

  db.prepare('UPDATE users SET last_login = unixepoch() WHERE id = ?').run(user.id);
  logAction(null, 'auth.login', user.username, user.username);

  const token = issueToken(user);
  setCookie(res, token);
  res.json({ ok: true, role: user.role, username: user.username });
});

router.post('/logout', (_req, res) => {
  res.clearCookie('palbox_token');
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const token = req.cookies?.palbox_token ?? req.headers.authorization?.replace('Bearer ', '');
  if (!token) { res.status(401).json({ authenticated: false }); return; }
  try {
    const payload = jwt.verify(token, cfg.auth.jwtSecret) as { sub: string; username: string; role: string };
    const permissions = getPermissionsForRole(payload.role);
    res.json({ authenticated: true, username: payload.username, role: payload.role, permissions });
  } catch {
    res.status(401).json({ authenticated: false });
  }
});

// ── User management (requires users.manage) ───────────────────────────────────
router.get('/users', requireAuth, requirePermission('users.manage'), (_req, res) => {
  const users = getDb()
    .prepare(`SELECT u.id, u.username, u.role, u.role_id,
               COALESCE(r.name, u.role) as effective_role,
               u.totp_enabled, u.created_at, u.last_login
              FROM users u LEFT JOIN roles r ON u.role_id = r.id
              ORDER BY u.id`)
    .all();
  res.json(users);
});

router.post('/users', requireAuth, requirePermission('users.manage'), async (req, res) => {
  const { username, password, role = 'operator', role_id } = req.body as {
    username?: string; password?: string; role?: string; role_id?: number;
  };
  if (!username || !password) { res.status(400).json({ error: 'username and password required' }); return; }
  const hash = await bcrypt.hash(password, 12);
  try {
    const result = getDb()
      .prepare("INSERT INTO users (username, password_hash, role, role_id) VALUES (?, ?, ?, ?)")
      .run(username, hash, role, role_id ?? null);
    logAction(null, 'user.create', username);
    res.json({ id: result.lastInsertRowid });
  } catch {
    res.status(409).json({ error: 'Username already exists' });
  }
});

router.patch('/users/:id', requireAuth, requirePermission('users.manage'), async (req, res) => {
  const { password, role, role_id } = req.body as { password?: string; role?: string; role_id?: number | null };
  const id = parseInt(req.params.id, 10);
  const db = getDb();
  if (password) {
    const hash = await bcrypt.hash(password, 12);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
  }
  if (role !== undefined) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  if (role_id !== undefined) db.prepare('UPDATE users SET role_id = ? WHERE id = ?').run(role_id, id);
  logAction(null, 'user.update', `id=${id}`);
  res.json({ ok: true });
});

router.delete('/users/:id', requireAuth, requirePermission('users.manage'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const me = (req.auth as { sub: string }).sub;
  if (String(id) === me) { res.status(400).json({ error: 'Cannot delete yourself' }); return; }
  const row = getDb().prepare('SELECT username FROM users WHERE id = ?').get(id) as { username: string } | undefined;
  getDb().prepare('DELETE FROM users WHERE id = ?').run(id);
  if (row) logAction(null, 'user.delete', row.username);
  res.json({ ok: true });
});

// ── Role management (requires roles.manage) ───────────────────────────────────
router.get('/roles', requireAuth, (_req, res) => {
  // All authenticated users can see role names (for display); full perms list only for managers
  res.json(getDb().prepare('SELECT * FROM roles ORDER BY is_builtin DESC, id ASC').all());
});

router.get('/roles/permissions', requireAuth, (_req, res) => {
  res.json(ALL_PERMISSIONS);
});

router.post('/roles', requireAuth, requirePermission('roles.manage'), (req, res) => {
  const { name, description = '', permissions = [] } = req.body as {
    name?: string; description?: string; permissions?: string[];
  };
  if (!name) { res.status(400).json({ error: 'name required' }); return; }
  try {
    const r = getDb()
      .prepare('INSERT INTO roles (name, description, permissions, is_builtin) VALUES (?, ?, ?, 0)')
      .run(name, description, JSON.stringify(permissions));
    invalidatePermissionCache(name);
    logAction(null, 'role.create', name);
    res.json({ id: r.lastInsertRowid });
  } catch { res.status(409).json({ error: 'Role name already exists' }); }
});

router.patch('/roles/:id', requireAuth, requirePermission('roles.manage'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { description, permissions } = req.body as { description?: string; permissions?: string[] };
  const db = getDb();
  const row = db.prepare('SELECT name, is_builtin FROM roles WHERE id = ?').get(id) as
    { name: string; is_builtin: number } | undefined;
  if (!row) { res.status(404).json({ error: 'Role not found' }); return; }
  if (row.is_builtin) { res.status(400).json({ error: 'Built-in roles cannot be edited' }); return; }
  if (description !== undefined) db.prepare('UPDATE roles SET description = ? WHERE id = ?').run(description, id);
  if (permissions !== undefined) db.prepare('UPDATE roles SET permissions = ? WHERE id = ?').run(JSON.stringify(permissions), id);
  invalidatePermissionCache(row.name);
  logAction(null, 'role.update', row.name);
  res.json({ ok: true });
});

router.delete('/roles/:id', requireAuth, requirePermission('roles.manage'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const db = getDb();
  const row = db.prepare('SELECT name, is_builtin FROM roles WHERE id = ?').get(id) as
    { name: string; is_builtin: number } | undefined;
  if (!row) { res.status(404).json({ error: 'Role not found' }); return; }
  if (row.is_builtin) { res.status(400).json({ error: 'Built-in roles cannot be deleted' }); return; }
  // Unassign this role from any users
  db.prepare('UPDATE users SET role_id = NULL WHERE role_id = ?').run(id);
  db.prepare('DELETE FROM roles WHERE id = ?').run(id);
  invalidatePermissionCache(row.name);
  logAction(null, 'role.delete', row.name);
  res.json({ ok: true });
});

// ── TOTP 2FA ──────────────────────────────────────────────────────────────────

// Step 1: generate a new TOTP secret (not yet enabled)
router.post('/totp/setup', requireAuth, async (req, res) => {
  const userId = parseInt((req.auth as { sub: string }).sub, 10);
  const user = getDb().prepare('SELECT username FROM users WHERE id = ?').get(userId) as { username: string } | undefined;
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }

  const secretObj = speakeasy.generateSecret({ length: 20 });
  const secret = secretObj.base32;
  getDb().prepare('UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?').run(secret, userId);

  const otpAuthUrl = speakeasy.otpauthURL({ type: 'totp', label: user.username, secret, issuer: 'Palbox', encoding: 'base32' });
  const qrDataUrl = await QRCode.toDataURL(otpAuthUrl);

  res.json({ secret, qrDataUrl, otpAuthUrl });
});

// Step 2: verify & enable TOTP
router.post('/totp/enable', requireAuth, (req, res) => {
  const { code } = req.body as { code?: string };
  const userId = parseInt((req.auth as { sub: string }).sub, 10);
  const user = getDb().prepare('SELECT totp_secret FROM users WHERE id = ?').get(userId) as
    { totp_secret: string | null } | undefined;

  if (!user?.totp_secret) { res.status(400).json({ error: 'Run /totp/setup first' }); return; }
  const valid = speakeasy.totp.verify({ token: code ?? '', secret: user.totp_secret, encoding: 'base32' });
  if (!valid) { res.status(401).json({ error: 'Invalid code' }); return; }

  getDb().prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(userId);
  logAction(null, 'auth.totp.enabled', `userId=${userId}`);
  res.json({ ok: true });
});

// Disable TOTP
router.post('/totp/disable', requireAuth, (req, res) => {
  const userId = parseInt((req.auth as { sub: string }).sub, 10);
  getDb().prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(userId);
  logAction(null, 'auth.totp.disabled', `userId=${userId}`);
  res.json({ ok: true });
});

// Change own password
router.post('/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
  if (!currentPassword || !newPassword) { res.status(400).json({ error: 'currentPassword and newPassword required' }); return; }
  const userId = parseInt((req.auth as { sub: string }).sub, 10);
  const user = getDb().prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as
    { password_hash: string } | undefined;
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  const ok = await bcrypt.compare(currentPassword, user.password_hash);
  if (!ok) { res.status(401).json({ error: 'Current password is incorrect' }); return; }
  const hash = await bcrypt.hash(newPassword, 12);
  getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
  logAction(null, 'auth.password_changed', `userId=${userId}`);
  res.json({ ok: true });
});

export default router;
