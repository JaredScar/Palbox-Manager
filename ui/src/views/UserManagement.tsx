import { useState, useEffect, useCallback } from 'react';
import { authApi, UserAccount, Role } from '../api/client';
import { ViewWrapper } from '../components/layout/ViewWrapper';
import { PanelSection } from '../components/ui/PanelSection';
import { Button } from '../components/ui/Button';

// ── Helpers ───────────────────────────────────────────────────────────────────

function parsePerms(permissions: string): string[] {
  try { return JSON.parse(permissions) as string[]; } catch { return []; }
}

function fmtDate(ts: number | null) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString();
}

// Group permissions by prefix for a cleaner UI
const PERM_GROUPS: Record<string, string[]> = {
  'Server':        ['server.view','server.start','server.stop','server.restart','server.rcon','server.save'],
  'Players':       ['players.view','players.kick','players.ban','players.whitelist','players.notes'],
  'Backups':       ['backups.view','backups.create','backups.delete','backups.restore'],
  'Updates':       ['updates.view','updates.apply','panel.update'],
  'Mods':          ['mods.view','mods.manage'],
  'Console':       ['console.view','console.rcon','macros.manage'],
  'Metrics':       ['metrics.view'],
  'Restarts':      ['restarts.view','restarts.manage'],
  'Broadcasts':    ['broadcasts.manage'],
  'Alerts':        ['alerts.manage'],
  'Triggers':      ['triggers.manage'],
  'Events':        ['events.view','events.manage'],
  'Audit':         ['audit.view'],
  'Settings':      ['settings.view','settings.manage'],
  'Cluster/World': ['cluster.view','world.view','config.view'],
  'Pals':          ['pals.view','pals.spawn'],
  'Notifications': ['notifications.view'],
  'Maintenance':   ['maintenance.manage'],
  'Admin':         ['users.manage','roles.manage'],
};

function PermLabel({ perm }: { perm: string }) {
  const parts = perm.split('.');
  return (
    <span className="font-mono text-[11.5px]">
      <span className="text-fog">{parts[0]}.</span>
      <span className="text-bone">{parts.slice(1).join('.')}</span>
    </span>
  );
}

// ── Users Tab ─────────────────────────────────────────────────────────────────

function UsersTab({ roles }: { roles: Role[] }) {
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', role: 'operator', role_id: '' });
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ password: '', role: '', role_id: '' });
  const [pending, setPending] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setUsers(await authApi.listUsers()); } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createUser() {
    if (!form.username || !form.password) return;
    setPending(-1);
    try {
      const roleId = form.role_id ? parseInt(form.role_id, 10) : undefined;
      await authApi.createUser(form.username, form.password, form.role, roleId);
      setForm({ username: '', password: '', role: 'operator', role_id: '' });
      setShowCreate(false);
      await load();
    } catch (e) { alert((e as Error).message); }
    setPending(null);
  }

  async function saveEdit(id: number) {
    setPending(id);
    try {
      const data: { password?: string; role?: string; role_id?: number | null } = {};
      if (editForm.password) data.password = editForm.password;
      if (editForm.role)     data.role     = editForm.role;
      data.role_id = editForm.role_id ? parseInt(editForm.role_id, 10) : null;
      await authApi.updateUser(id, data);
      setEditId(null);
      await load();
    } catch (e) { alert((e as Error).message); }
    setPending(null);
  }

  async function deleteUser(id: number) {
    if (!confirm('Delete this user?')) return;
    setPending(id);
    try { await authApi.deleteUser(id); await load(); }
    catch (e) { alert((e as Error).message); }
    setPending(null);
  }

  const inputCls = 'bg-panel-raised border border-line rounded-lg px-3 py-2 text-[13px] text-bone placeholder:text-fog/50 focus:outline-none focus:border-aqua';

  function RoleSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="bg-panel-raised border border-line rounded-lg px-3 py-2 text-[13px] text-bone focus:outline-none focus:border-aqua">
        <optgroup label="Built-in roles">
          <option value="owner">owner</option>
          <option value="operator">operator</option>
          <option value="viewer">viewer</option>
        </optgroup>
        {roles.filter((r) => !r.is_builtin).length > 0 && (
          <optgroup label="Custom roles">
            {roles.filter((r) => !r.is_builtin).map((r) => (
              <option key={r.id} value={String(r.id)}>{r.name}</option>
            ))}
          </optgroup>
        )}
      </select>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PanelSection
        title="Users"
        description="Manage panel accounts. Each user can be assigned a built-in or custom role."
      >
        <div className="flex justify-end mb-4">
          <Button variant="ghost" onClick={() => setShowCreate((s) => !s)}>
            {showCreate ? 'Cancel' : '+ New user'}
          </Button>
        </div>
        {showCreate && (
          <div className="mb-4 bg-panel-raised/50 border border-line rounded-2xl p-4 flex flex-col gap-3">
            <div className="text-[12px] text-fog uppercase tracking-wider font-semibold">Create user</div>
            <div className="grid grid-cols-2 gap-3">
              <input placeholder="Username" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                className={inputCls} />
              <input placeholder="Password" type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                className={inputCls} />
            </div>
            <div className="flex gap-3 items-center">
              <span className="text-[12px] text-fog">Role:</span>
              <RoleSelect value={form.role_id || form.role} onChange={(v) => {
                const isId = /^\d+$/.test(v);
                setForm((f) => ({ ...f, role_id: isId ? v : '', role: isId ? 'operator' : v }));
              }} />
              <Button variant="primary" onClick={createUser} loading={pending === -1}>Create</Button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-fog text-[13px] py-4">Loading…</div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-fog text-left border-b border-line">
                <th className="pb-2 font-medium">Username</th>
                <th className="pb-2 font-medium">Role</th>
                <th className="pb-2 font-medium">2FA</th>
                <th className="pb-2 font-medium">Last login</th>
                <th className="pb-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-line/40 last:border-0">
                  {editId === u.id ? (
                    <td colSpan={5} className="py-3">
                      <div className="flex gap-3 flex-wrap items-center">
                        <input placeholder="New password" type="password" value={editForm.password}
                          onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))}
                          className={`${inputCls} flex-1`} />
                        <RoleSelect value={editForm.role_id || editForm.role} onChange={(v) => {
                          const isId = /^\d+$/.test(v);
                          setEditForm((f) => ({ ...f, role_id: isId ? v : '', role: isId ? f.role : v }));
                        }} />
                        <Button variant="primary" onClick={() => saveEdit(u.id)} loading={pending === u.id}>Save</Button>
                        <Button variant="ghost" onClick={() => setEditId(null)}>Cancel</Button>
                      </div>
                    </td>
                  ) : (
                    <>
                      <td className="py-3 font-medium">{u.username}</td>
                      <td className="py-3">
                        <span className="px-2 py-0.5 rounded-full text-[11px] bg-panel-raised border border-line capitalize">
                          {u.effective_role}
                        </span>
                      </td>
                      <td className="py-3">
                        <span className={u.totp_enabled ? 'text-lime text-[12px]' : 'text-fog text-[12px]'}>
                          {u.totp_enabled ? '✓ Enabled' : '—'}
                        </span>
                      </td>
                      <td className="py-3 text-fog text-[12px] font-mono">{fmtDate(u.last_login)}</td>
                      <td className="py-3 flex gap-2 justify-end">
                        <Button variant="ghost" onClick={() => {
                          setEditId(u.id);
                          setEditForm({ password: '', role: u.role, role_id: u.role_id ? String(u.role_id) : '' });
                        }}>Edit</Button>
                        <Button variant="danger" onClick={() => deleteUser(u.id)} loading={pending === u.id}>
                          Delete
                        </Button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PanelSection>
    </div>
  );
}

// ── Roles Tab ─────────────────────────────────────────────────────────────────

function RolesTab({ roles, onRolesChange }: { roles: Role[]; onRolesChange: () => void }) {
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', description: '', permissions: [] as string[] });
  const [editId, setEditId] = useState<number | null>(null);
  const [editPerms, setEditPerms] = useState<string[]>([]);
  const [editDesc, setEditDesc] = useState('');
  const [pending, setPending] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const inputCls = 'bg-panel-raised border border-line rounded-lg px-3 py-2 text-[13px] text-bone placeholder:text-fog/50 focus:outline-none focus:border-aqua';

  function togglePerm(perms: string[], perm: string, set: (p: string[]) => void) {
    set(perms.includes(perm) ? perms.filter((p) => p !== perm) : [...perms, perm]);
  }

  function PermGrid({ value, onChange, disabled }: { value: string[]; onChange: (p: string[]) => void; disabled?: boolean }) {
    return (
      <div className="flex flex-col gap-4 mt-3">
        {Object.entries(PERM_GROUPS).map(([group, perms]) => (
          <div key={group}>
            <div className="text-[11px] uppercase tracking-wider text-fog font-semibold mb-2">{group}</div>
            <div className="flex flex-wrap gap-2">
              {perms.map((perm) => (
                <label key={perm} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                  value.includes(perm)
                    ? 'bg-aqua/10 border-aqua/40 text-aqua'
                    : 'bg-panel-raised border-line text-fog hover:border-fog/50'
                } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}>
                  <input type="checkbox" className="hidden" checked={value.includes(perm)}
                    disabled={disabled}
                    onChange={() => !disabled && togglePerm(value, perm, onChange)} />
                  <PermLabel perm={perm} />
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  async function createRole() {
    if (!createForm.name) return;
    setPending(-1);
    try {
      await authApi.createRole(createForm.name, createForm.description, createForm.permissions);
      setCreateForm({ name: '', description: '', permissions: [] });
      setShowCreate(false);
      onRolesChange();
    } catch (e) { alert((e as Error).message); }
    setPending(null);
  }

  async function saveRole(id: number) {
    setPending(id);
    try {
      await authApi.updateRole(id, { description: editDesc, permissions: editPerms });
      setEditId(null);
      onRolesChange();
    } catch (e) { alert((e as Error).message); }
    setPending(null);
  }

  async function deleteRole(id: number) {
    if (!confirm('Delete this role? Users assigned to it will revert to their base role.')) return;
    setPending(id);
    try { await authApi.deleteRole(id); onRolesChange(); }
    catch (e) { alert((e as Error).message); }
    setPending(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <PanelSection
        title="Roles"
        description="Define named roles with specific permission sets. Built-in roles cannot be edited."
      >
        <div className="flex justify-end mb-4">
          <Button variant="ghost" onClick={() => setShowCreate((s) => !s)}>
            {showCreate ? 'Cancel' : '+ New role'}
          </Button>
        </div>
        {showCreate && (
          <div className="mb-6 bg-panel-raised/50 border border-line rounded-2xl p-4 flex flex-col gap-3">
            <div className="text-[12px] text-fog uppercase tracking-wider font-semibold">Create custom role</div>
            <div className="grid grid-cols-2 gap-3">
              <input placeholder="Role name" value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                className={inputCls} />
              <input placeholder="Description (optional)" value={createForm.description}
                onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
                className={inputCls} />
            </div>
            <PermGrid value={createForm.permissions} onChange={(p) => setCreateForm((f) => ({ ...f, permissions: p }))} />
            <div className="flex gap-2 mt-2">
              <Button variant="primary" onClick={createRole} loading={pending === -1}>Create role</Button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {roles.map((r) => {
            const perms = parsePerms(r.permissions);
            const isEditing = editId === r.id;
            const isExpanded = expandedId === r.id || isEditing;
            return (
              <div key={r.id} className="bg-panel border border-line rounded-2xl overflow-hidden">
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-panel-raised/30 transition-colors"
                  onClick={() => setExpandedId(isExpanded && !isEditing ? null : r.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[14px] capitalize">{r.name}</span>
                      {r.is_builtin ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet/20 text-violet border border-violet/30">built-in</span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-aqua/10 text-aqua border border-aqua/30">custom</span>
                      )}
                      <span className="text-fog text-[12px]">{perms.length} permissions</span>
                    </div>
                    {r.description && <div className="text-[12px] text-fog mt-0.5">{r.description}</div>}
                  </div>
                  <div className="flex gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                    {!r.is_builtin && !isEditing && (
                      <>
                        <Button variant="ghost" onClick={() => {
                          setEditId(r.id);
                          setEditPerms(perms);
                          setEditDesc(r.description);
                          setExpandedId(r.id);
                        }}>Edit</Button>
                        <Button variant="danger" onClick={() => deleteRole(r.id)} loading={pending === r.id}>Delete</Button>
                      </>
                    )}
                    {isEditing && (
                      <>
                        <Button variant="primary" onClick={() => saveRole(r.id)} loading={pending === r.id}>Save</Button>
                        <Button variant="ghost" onClick={() => setEditId(null)}>Cancel</Button>
                      </>
                    )}
                  </div>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
                    className={`w-4 h-4 text-fog transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`}>
                    <path d="M6 9l6 6 6-6"/>
                  </svg>
                </div>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-line/50">
                    <PermGrid
                      value={isEditing ? editPerms : perms}
                      onChange={(p) => isEditing && setEditPerms(p)}
                      disabled={!isEditing}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </PanelSection>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function UserManagement() {
  const [tab, setTab] = useState<'users' | 'roles'>('users');
  const [roles, setRoles] = useState<Role[]>([]);
  const [rolesLoading, setRolesLoading] = useState(true);

  const loadRoles = useCallback(async () => {
    setRolesLoading(true);
    try { setRoles(await authApi.listRoles()); } catch {}
    setRolesLoading(false);
  }, []);

  useEffect(() => { loadRoles(); }, [loadRoles]);

  const TAB_CLS = (active: boolean) =>
    `px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${
      active ? 'bg-panel-raised text-bone' : 'text-fog hover:text-bone'
    }`;

  return (
    <ViewWrapper eyebrow="Administration" title="Users & Roles" description="Manage panel users, assign roles, and define custom permission sets.">
      {/* Tab switcher */}
      <div className="flex gap-1 mb-6 bg-panel border border-line rounded-xl p-1 w-fit">
        <button className={TAB_CLS(tab === 'users')} onClick={() => setTab('users')}>Users</button>
        <button className={TAB_CLS(tab === 'roles')} onClick={() => setTab('roles')}>Roles & Permissions</button>
      </div>

      {rolesLoading ? (
        <div className="text-fog text-[13px]">Loading…</div>
      ) : tab === 'users' ? (
        <UsersTab roles={roles} />
      ) : (
        <RolesTab roles={roles} onRolesChange={loadRoles} />
      )}
    </ViewWrapper>
  );
}
