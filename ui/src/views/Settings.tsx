import { useState, useEffect, useRef } from 'react';
import { useInstance } from '../context/InstanceContext';
import { Button } from '../components/ui/Button';
import { Switch } from '../components/ui/Switch';
import { ViewWrapper } from '../components/layout/ViewWrapper';
import { PanelSection, ToggleRow } from '../components/ui/PanelSection';
import { cn } from '../lib/cn';
import type { AlertRule, BroadcastSchedule, UserAccount, Instance, ConfigSnapshot, DiffLine } from '../api/client';
import { authApi, instanceApi } from '../api/client';
import { useTheme, THEMES } from '../contexts/ThemeContext';

/* ── Alert rules sub-section ──────────────────────────────────────────────── */
function AlertRulesSection() {
  const { api } = useInstance();
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [form, setForm] = useState({ name: '', metric: 'cpu', operator: 'gt', threshold: 90, cooldown_m: 30 });
  const [saving, setSaving] = useState(false);

  async function load() { try { setRules(await api!.listAlerts()); } catch {} }
  useEffect(() => { if (api) load(); }, [api]);

  async function add() {
    if (!api || !form.name) return;
    setSaving(true);
    try { await api.createAlert(form as Partial<AlertRule>); await load(); setForm({ name: '', metric: 'cpu', operator: 'gt', threshold: 90, cooldown_m: 30 }); }
    catch (e) { alert((e as Error).message); }
    setSaving(false);
  }

  async function del(id: number) {
    if (!api || !confirm('Delete this alert?')) return;
    try { await api.deleteAlert(id); await load(); } catch (e) { alert((e as Error).message); }
  }

  async function toggle(rule: AlertRule) {
    if (!api) return;
    try { await api.updateAlert(rule.id, { enabled: rule.enabled ? 0 : 1 }); await load(); } catch {}
  }

  const METRIC_LABELS = { cpu: 'CPU %', memory: 'Memory MB', players: 'Player count', status: 'Server status' };
  const OP_LABELS = { gt: '>', lt: '<', eq: '=' };

  return (
    <PanelSection title="Alert rules" description="Fires a Discord notification when a threshold is crossed. Requires a webhook URL above.">
      <div className="flex flex-wrap gap-2 mb-4 items-end">
        <div className="flex flex-col gap-1"><label className="text-[11px] text-fog font-semibold uppercase tracking-[0.09em]">Name</label>
          <input placeholder="e.g. High CPU" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="w-[140px]" /></div>
        <div className="flex flex-col gap-1"><label className="text-[11px] text-fog font-semibold uppercase tracking-[0.09em]">Metric</label>
          <select value={form.metric} onChange={(e) => setForm((f) => ({ ...f, metric: e.target.value }))} className="w-[130px]">
            {Object.entries(METRIC_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></div>
        <div className="flex flex-col gap-1"><label className="text-[11px] text-fog font-semibold uppercase tracking-[0.09em]">Operator</label>
          <select value={form.operator} onChange={(e) => setForm((f) => ({ ...f, operator: e.target.value }))} className="w-[80px]">
            {Object.entries(OP_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></div>
        <div className="flex flex-col gap-1"><label className="text-[11px] text-fog font-semibold uppercase tracking-[0.09em]">Value</label>
          <input type="number" value={form.threshold} onChange={(e) => setForm((f) => ({ ...f, threshold: parseFloat(e.target.value) }))} className="w-[90px]" /></div>
        <div className="flex flex-col gap-1"><label className="text-[11px] text-fog font-semibold uppercase tracking-[0.09em]">Cooldown (min)</label>
          <input type="number" value={form.cooldown_m} onChange={(e) => setForm((f) => ({ ...f, cooldown_m: parseInt(e.target.value, 10) }))} className="w-[100px]" /></div>
        <Button variant="crimson" loading={saving} onClick={add}>Add rule</Button>
      </div>
      {rules.length === 0 && <div className="text-fog/60 text-[13px]">No alert rules configured.</div>}
      {rules.map((r) => (
        <div key={r.id} className="flex items-center gap-3 py-2.5 border-b border-line/50 last:border-0">
          <div className="flex-1">
            <span className="text-[13.5px] font-medium text-bone">{r.name}</span>
            <span className="text-fog text-[12px] ml-2">{METRIC_LABELS[r.metric]} {OP_LABELS[r.operator]} {r.threshold} · {r.cooldown_m}m cooldown</span>
          </div>
          <Switch checked={!!r.enabled} onChange={() => toggle(r)} />
          <button onClick={() => del(r.id)} className="text-fog hover:text-rust transition-colors text-[18px] leading-none">×</button>
        </div>
      ))}
    </PanelSection>
  );
}

/* ── Timed broadcasts sub-section ─────────────────────────────────────────── */
function BroadcastSection() {
  const { api } = useInstance();
  const [items, setItems] = useState<BroadcastSchedule[]>([]);
  const [form, setForm] = useState({ name: '', message: '', cron: '0 * * * *' });
  const [saving, setSaving] = useState(false);

  async function load() { try { setItems(await api!.listBroadcasts()); } catch {} }
  useEffect(() => { if (api) load(); }, [api]);

  async function add() {
    if (!api || !form.name || !form.message) return;
    setSaving(true);
    try { await api.createBroadcast(form as Partial<BroadcastSchedule>); await load(); setForm({ name: '', message: '', cron: '0 * * * *' }); }
    catch (e) { alert((e as Error).message); }
    setSaving(false);
  }

  async function del(id: number) {
    if (!api || !confirm('Delete this broadcast?')) return;
    try { await api.deleteBroadcast(id); await load(); } catch (e) { alert((e as Error).message); }
  }

  async function toggle(item: BroadcastSchedule) {
    if (!api) return;
    try { await api.updateBroadcast(item.id, { enabled: item.enabled ? 0 : 1 }); await load(); } catch {}
  }

  return (
    <PanelSection title="Timed broadcasts" description="Sends scheduled in-game messages via RCON. Uses cron syntax (e.g. 0 * * * * = every hour).">
      <div className="flex flex-wrap gap-2 mb-4 items-end">
        <div className="flex flex-col gap-1"><label className="text-[11px] text-fog font-semibold uppercase tracking-[0.09em]">Name</label>
          <input placeholder="e.g. Hourly reminder" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="w-[140px]" /></div>
        <div className="flex flex-col gap-1"><label className="text-[11px] text-fog font-semibold uppercase tracking-[0.09em]">Message</label>
          <input placeholder="Server restart in 10 minutes" value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} className="w-[240px]" /></div>
        <div className="flex flex-col gap-1"><label className="text-[11px] text-fog font-semibold uppercase tracking-[0.09em]">Cron</label>
          <input placeholder="0 * * * *" value={form.cron} onChange={(e) => setForm((f) => ({ ...f, cron: e.target.value }))} className="w-[130px] font-mono" /></div>
        <Button variant="teal" loading={saving} onClick={add}>Add broadcast</Button>
      </div>
      {items.length === 0 && <div className="text-fog/60 text-[13px]">No broadcasts scheduled.</div>}
      {items.map((b) => (
        <div key={b.id} className="flex items-center gap-3 py-2.5 border-b border-line/50 last:border-0">
          <div className="flex-1">
            <span className="text-[13.5px] font-medium text-bone">{b.name}</span>
            <span className="text-fog text-[12px] ml-2 font-mono">{b.cron}</span>
            <span className="text-teal text-[12px] ml-2">"{b.message}"</span>
          </div>
          <Switch checked={!!b.enabled} onChange={() => toggle(b)} />
          <button onClick={() => del(b.id)} className="text-fog hover:text-rust transition-colors text-[18px] leading-none">×</button>
        </div>
      ))}
    </PanelSection>
  );
}

type Tab = 'world' | 'rates' | 'multiplayer' | 'combat' | 'building';

const TABS: { id: Tab; label: string; accent: string }[] = [
  { id: 'world',       label: 'World',              accent: '#7ce666' },
  { id: 'rates',       label: 'Rates & difficulty', accent: '#ffd447' },
  { id: 'multiplayer', label: 'Multiplayer',        accent: '#2fd9e8' },
  { id: 'combat',      label: 'Pals & combat',      accent: '#ff5d73' },
  { id: 'building',    label: 'Building',           accent: '#b27cf2' },
];

const inputCls = 'w-full focus:outline-none focus:border-aqua focus:ring-0';
const labelCls = 'text-[11px] uppercase tracking-[0.09em] text-fog font-semibold mb-1.5 block';

function Field({ label, name, settings, set, hint, type = 'text' }: {
  label: string; name: string; settings: Record<string, string>;
  set: (k: string, v: string) => void; hint?: string; type?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className={labelCls}>{label}</label>
      <input type={type} value={settings[name] ?? ''} onChange={(e) => set(name, e.target.value)} className={inputCls} />
      {hint && <span className="text-[11px] text-fog mt-0.5">{hint}</span>}
    </div>
  );
}

function SelectField({ label, name, options, settings, set }: {
  label: string; name: string; options: { value: string; label: string }[];
  settings: Record<string, string>; set: (k: string, v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className={labelCls}>{label}</label>
      <select value={settings[name] ?? ''} onChange={(e) => set(name, e.target.value)} className={inputCls}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function BoolField({ label, description, name, settings, set }: {
  label: string; description?: string; name: string;
  settings: Record<string, string>; set: (k: string, v: string) => void;
}) {
  return (
    <ToggleRow label={label} description={description}>
      <Switch checked={settings[name] === 'True'} onChange={(v) => set(name, v ? 'True' : 'False')} />
    </ToggleRow>
  );
}

export function Settings() {
  const { api } = useInstance();
  const [tab, setTab] = useState<Tab>('world');
  const [rawMode, setRawMode] = useState(false);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [rawIni, setRawIni] = useState('');
  const [appSettings, setAppSettings] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const setKey = (k: string, v: string) => setSettings((s) => ({ ...s, [k]: v }));
  const setApp = (k: string, v: string) => {
    setAppSettings((s) => ({ ...s, [k]: v }));
    api?.patchAppSettings({ [k]: v }).catch(() => {});
  };

  useEffect(() => {
    if (!api) return;
    Promise.all([api.getSettings(), api.getAppSettings(), api.getRawIni()])
      .then(([s, app, raw]) => { setSettings(s); setAppSettings(app); setRawIni(raw.content); })
      .catch(() => {});
  }, [api]);

  async function save() {
    if (!api) return;
    setSaving(true);
    try {
      if (rawMode) await api.putRawIni(rawIni);
      else await api.patchSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) { alert((e as Error).message); }
    setSaving(false);
  }

  return (
    <ViewWrapper eyebrow="Configuration" title="PalWorldSettings.ini"
      description="Every field writes straight to the server's .ini and flags a restart when a change needs one."
      accentVar="var(--aqua)"
      actions={
        <>
          <Button variant={rawMode ? 'aqua' : 'ghost'} onClick={() => setRawMode((m) => !m)}>
            {rawMode ? 'Back to form mode' : 'Raw .ini mode'}
          </Button>
          <Button variant="aqua" loading={saving} onClick={save}>
            {saved ? '✓ Saved' : 'Save changes'}
          </Button>
        </>
      }
    >
      {rawMode ? (
        <PanelSection>
          <textarea
            value={rawIni}
            onChange={(e) => setRawIni(e.target.value)}
            className="w-full bg-transparent font-mono text-[12.5px] text-bone-dim resize-none focus:outline-none leading-relaxed"
            style={{ minHeight: 400 }}
          />
        </PanelSection>
      ) : (
        <>
          {/* Tab bar */}
          <div className="flex gap-1.5 mb-5 bg-panel border border-line rounded-xl p-1.5">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={cn(
                  'flex items-center gap-2 flex-1 justify-center px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150',
                  tab === t.id ? 'text-void' : 'text-fog hover:text-bone',
                )}
                style={tab === t.id ? { background: t.accent } : undefined}
              >
                <span className="w-2 h-2 rounded-full" style={{ background: t.accent, opacity: tab === t.id ? 0.6 : 1 }} />
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'world' && (
            <PanelSection title="World">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Server name"         name="ServerName"        settings={settings} set={setKey} />
                <Field label="Server description"  name="ServerDescription" settings={settings} set={setKey} />
                <Field label="Server password"     name="ServerPassword"    settings={settings} set={setKey} type="password" />
                <Field label="Admin password"      name="AdminPassword"     settings={settings} set={setKey} type="password" />
                <Field label="Day time speed"      name="DayTimeSpeedRate"  settings={settings} set={setKey} hint="Multiplier, default 1.0" />
                <Field label="Night time speed"    name="NightTimeSpeedRate" settings={settings} set={setKey} />
              </div>
            </PanelSection>
          )}
          {tab === 'rates' && (
            <>
              <PanelSection title="Difficulty">
                <div className="grid grid-cols-2 gap-4">
                  <SelectField label="Difficulty preset" name="Difficulty" settings={settings} set={setKey}
                    options={[{value:'None',label:'Normal'},{value:'Difficult',label:'Hard'}]} />
                  <SelectField label="Death penalty" name="DeathPenalty" settings={settings} set={setKey}
                    options={[{value:'None',label:'None'},{value:'Item',label:'Item'},{value:'ItemAndEquipment',label:'ItemAndEquipment'},{value:'All',label:'All'}]} />
                </div>
              </PanelSection>
              <PanelSection title="Rates">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="EXP rate"               name="ExpRate"                   settings={settings} set={setKey} />
                  <Field label="Pal capture rate"       name="PalCaptureRate"            settings={settings} set={setKey} />
                  <Field label="Pal spawn rate"         name="PalSpawnNumRate"           settings={settings} set={setKey} />
                  <Field label="Pal attack damage"      name="PalDamageRateAttack"       settings={settings} set={setKey} />
                  <Field label="Pal defense damage"     name="PalDamageRateDefense"      settings={settings} set={setKey} />
                  <Field label="Player hunger"          name="PlayerStomachDecreaceRate" settings={settings} set={setKey} />
                  <Field label="Player stamina"         name="PlayerStaminaDecreaceRate" settings={settings} set={setKey} />
                  <Field label="Collection drop rate"   name="CollectionDropRate"        settings={settings} set={setKey} />
                </div>
              </PanelSection>
            </>
          )}
          {tab === 'multiplayer' && (
            <PanelSection title="Multiplayer">
              <div className="grid grid-cols-2 gap-4 mb-4">
                <Field label="Max players" name="ServerPlayerMaxNum" settings={settings} set={setKey} />
                <Field label="Server port" name="PublicPort"         settings={settings} set={setKey} />
                <Field label="Public IP"   name="PublicIP"           settings={settings} set={setKey} />
                <Field label="RCON port"   name="RCONPort"           settings={settings} set={setKey} />
              </div>
              <BoolField label="Multiplayer enabled" name="bIsMultiplay" settings={settings} set={setKey} description="Turn off to run as a solo/local world" />
              <BoolField label="RCON enabled"        name="RCONEnabled"  settings={settings} set={setKey} description="Required for Palbox's console tab and graceful restarts" />
              <BoolField label="Use Steam auth"      name="bUseAuth"     settings={settings} set={setKey} description="Recommended for public-facing servers" />
            </PanelSection>
          )}
          {tab === 'combat' && (
            <>
              <PanelSection title="PvP & loss rules">
                <BoolField label="PvP"             name="bEnablePlayerToPlayerDamage" settings={settings} set={setKey} description="Players can damage each other" />
                <BoolField label="Friendly fire"   name="bEnableFriendlyFire"         settings={settings} set={setKey} description="Guild members can damage each other" />
                <BoolField label="Invader enemies" name="bEnableInvaderEnemy"         settings={settings} set={setKey} description="Enables enemy base raids" />
              </PanelSection>
              <PanelSection title="Pals">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Max pals per base"     name="BaseCampWorkerMaxNum"    settings={settings} set={setKey} />
                  <Field label="Egg hatch time (h)"    name="PalEggDefaultHatchingTime" settings={settings} set={setKey} />
                </div>
              </PanelSection>
            </>
          )}
          {tab === 'building' && (
            <PanelSection title="Building & bases">
              <div className="grid grid-cols-2 gap-4 mb-4">
                <Field label="Base camp worker max" name="BaseCampWorkerMaxNum" settings={settings} set={setKey} />
                <Field label="Max drop item count"  name="DropItemMaxNum"       settings={settings} set={setKey} hint="0 = unlimited" />
              </div>
              <BoolField label="Enable predator Pals" name="bEnableInvaderEnemy" settings={settings} set={setKey} description="Stronger alpha spawns near bases" />
            </PanelSection>
          )}
        </>
      )}

      <PanelSection title="Automation">
        <ToggleRow label="Crash detection & auto-restart" description="If the process dies unexpectedly, restart it and log the reason">
          <Switch checked={appSettings.watchdog_enabled !== 'false'} onChange={(v) => setApp('watchdog_enabled', String(v))} />
        </ToggleRow>
        <ToggleRow label="Auto-update on new build" description="Otherwise you'll just get a notification to update manually">
          <Switch checked={appSettings.auto_update === 'true'} onChange={(v) => setApp('auto_update', String(v))} />
        </ToggleRow>
        <ToggleRow label="Warn players before restart" description="Broadcasts a countdown via RCON before any stop/update/scheduled restart">
          <Switch checked={appSettings.warn_before_restart !== 'false'} onChange={(v) => setApp('warn_before_restart', String(v))} />
        </ToggleRow>
      </PanelSection>

      <PanelSection title="Discord notifications" description="Posts rich embeds to a Discord channel via webhook — no bot required. Each event type can be toggled individually.">
        <div className="flex flex-col gap-1.5 mb-4">
          <label className={labelCls}>Webhook URL</label>
          <div className="flex gap-2">
            <input type="url" placeholder="https://discord.com/api/webhooks/..." value={appSettings.discord_webhook ?? ''} onChange={(e) => setApp('discord_webhook', e.target.value)} className={`${inputCls} flex-1`} />
            <button
              className="shrink-0 px-3 py-2 rounded-lg text-[12px] bg-panel-raised border border-line text-fog hover:text-bone transition-colors"
              onClick={async () => {
                const url = appSettings.discord_webhook;
                if (!url) return alert('Enter a webhook URL first.');
                try {
                  await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content: '✅ Palbox webhook test — connection working!' }),
                  });
                  alert('Test message sent!');
                } catch (e) { alert('Failed: ' + (e as Error).message); }
              }}
            >Test</button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-6">
          <ToggleRow label="Server comes online">
            <Switch checked={appSettings.discord_server_online !== 'false'} onChange={(v) => setApp('discord_server_online', String(v))} />
          </ToggleRow>
          <ToggleRow label="Server goes offline">
            <Switch checked={appSettings.discord_server_offline !== 'false'} onChange={(v) => setApp('discord_server_offline', String(v))} />
          </ToggleRow>
          <ToggleRow label="Server crashed / watchdog">
            <Switch checked={appSettings.discord_server_crashed !== 'false'} onChange={(v) => setApp('discord_server_crashed', String(v))} />
          </ToggleRow>
          <ToggleRow label="Player joined">
            <Switch checked={appSettings.discord_player_joined === 'true'} onChange={(v) => setApp('discord_player_joined', String(v))} />
          </ToggleRow>
          <ToggleRow label="Player left">
            <Switch checked={appSettings.discord_player_left === 'true'} onChange={(v) => setApp('discord_player_left', String(v))} />
          </ToggleRow>
          <ToggleRow label="Player banned">
            <Switch checked={appSettings.discord_player_banned !== 'false'} onChange={(v) => setApp('discord_player_banned', String(v))} />
          </ToggleRow>
          <ToggleRow label="Backup created">
            <Switch checked={appSettings.discord_backup_created === 'true'} onChange={(v) => setApp('discord_backup_created', String(v))} />
          </ToggleRow>
          <ToggleRow label="Backup failed">
            <Switch checked={appSettings.discord_backup_failed !== 'false'} onChange={(v) => setApp('discord_backup_failed', String(v))} />
          </ToggleRow>
          <ToggleRow label="Game update completed">
            <Switch checked={appSettings.discord_update_completed !== 'false'} onChange={(v) => setApp('discord_update_completed', String(v))} />
          </ToggleRow>
          <ToggleRow label="Alert rule fires">
            <Switch checked={appSettings.discord_alert !== 'false'} onChange={(v) => setApp('discord_alert', String(v))} />
          </ToggleRow>
          <ToggleRow label="Maintenance mode starts">
            <Switch checked={appSettings.discord_maintenance_start !== 'false'} onChange={(v) => setApp('discord_maintenance_start', String(v))} />
          </ToggleRow>
          <ToggleRow label="Maintenance mode ends">
            <Switch checked={appSettings.discord_maintenance_end !== 'false'} onChange={(v) => setApp('discord_maintenance_end', String(v))} />
          </ToggleRow>
        </div>
      </PanelSection>

      <PanelSection title="Application" description="This panel runs as a service on the VPS — reachable from a browser, or as a native window when on the box itself.">
        <ToggleRow label="Launch at system startup" description="Starts the desktop app automatically after the VPS boots">
          <Switch checked={appSettings.launch_at_startup !== 'false'} onChange={(v) => setApp('launch_at_startup', String(v))} />
        </ToggleRow>
        <ToggleRow label="Minimize to tray" description="Closing the window keeps Palbox running in the background">
          <Switch checked={appSettings.minimize_to_tray !== 'false'} onChange={(v) => setApp('minimize_to_tray', String(v))} />
        </ToggleRow>
      </PanelSection>

      <InstancesSection />
      <AlertRulesSection />
      <BroadcastSection />
      <UserManagementSection />
      <AppUpdateSection />
      <ConfigHistorySection />
      <WidgetSection />
      <ThemeSection />

      <PanelSection title="Danger zone">
        <div className="flex gap-2.5">
          <Button variant="danger" onClick={() => {
            if (confirm('Wipe world and restart fresh? This deletes all save data. Make sure you have a backup.'))
              alert('Wipe: stop server → delete Saved directory → start server. Implement in the API for your specific paths.');
          }}>
            Wipe world &amp; restart fresh
          </Button>
        </div>
      </PanelSection>
    </ViewWrapper>
  );
}

/* ── User Management ──────────────────────────────────────────────────────── */
function UserManagementSection() {
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [me, setMe] = useState<{ username: string; role: string } | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', role: 'operator' });
  const [saving, setSaving] = useState(false);

  // TOTP setup state
  const [totpPhase, setTotpPhase] = useState<null | 'setup' | 'confirm'>( null);
  const [totpData, setTotpData] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');

  // Password change state
  const [showPwChange, setShowPwChange] = useState(false);
  const [pwForm, setPwForm] = useState({ current: '', next: '' });

  async function load() {
    try {
      const [us, m] = await Promise.all([authApi.listUsers(), authApi.me()]);
      setUsers(us);
      setMe(m as { username: string; role: string });
    } catch {}
  }
  useEffect(() => { load(); }, []);

  async function addUser() {
    if (!form.username || !form.password) return;
    setSaving(true);
    try { await authApi.createUser(form.username, form.password, form.role); await load(); setShowAdd(false); setForm({ username: '', password: '', role: 'operator' }); }
    catch (e) { alert((e as Error).message); }
    setSaving(false);
  }

  async function deleteUser(id: number) {
    if (!confirm('Delete this user?')) return;
    try { await authApi.deleteUser(id); await load(); } catch (e) { alert((e as Error).message); }
  }

  async function setupTotp() {
    try {
      const data = await authApi.totpSetup();
      setTotpData(data);
      setTotpPhase('setup');
    } catch (e) { alert((e as Error).message); }
  }

  async function enableTotp() {
    try {
      await authApi.totpEnable(totpCode);
      setTotpPhase(null); setTotpData(null); setTotpCode('');
      await load();
    } catch (e) { alert((e as Error).message); }
  }

  async function disableTotp() {
    if (!confirm('Disable two-factor authentication?')) return;
    try { await authApi.totpDisable(); await load(); } catch (e) { alert((e as Error).message); }
  }

  async function changePassword() {
    try { await authApi.changePassword(pwForm.current, pwForm.next); setShowPwChange(false); setPwForm({ current: '', next: '' }); alert('Password updated.'); }
    catch (e) { alert((e as Error).message); }
  }

  const myAccount = users.find((u) => u.username === me?.username);
  const ROLE_COLORS: Record<string, string> = {
    owner: 'text-gold border-gold/30 bg-gold/10',
    operator: 'text-aqua border-aqua/30 bg-aqua/10',
    viewer: 'text-fog border-fog/30 bg-fog/10',
  };

  return (
    <PanelSection title="Users & Access" description="Manage who can access this panel. Owners can manage users; operators can control servers; viewers are read-only.">
      {/* User list */}
      <div className="flex flex-col gap-2 mb-4">
        {users.map((u) => (
          <div key={u.id} className="flex items-center gap-3 bg-[var(--panel-raised)] rounded-xl px-4 py-3 border border-[var(--line)]/50">
            <div className="flex-1 min-w-0">
              <span className="font-semibold text-[var(--bone)] text-sm">{u.username}</span>
              {myAccount?.id === u.id && <span className="ml-2 text-[10px] text-[var(--fog)]">(you)</span>}
            </div>
            <span className={cn('text-[10px] font-mono rounded-full px-2 py-0.5 border', ROLE_COLORS[u.role] ?? 'text-fog')}>
              {u.role}
            </span>
            <span className={cn('text-[10px] font-mono', u.totp_enabled ? 'text-lime' : 'text-fog')}>
              {u.totp_enabled ? '2FA on' : '2FA off'}
            </span>
            {me?.role === 'owner' && myAccount?.id !== u.id && (
              <button className="text-[var(--fog)] hover:text-[var(--rust)] text-xs" onClick={() => deleteUser(u.id)}>✕</button>
            )}
          </div>
        ))}
      </div>

      {/* My account actions */}
      <div className="flex flex-wrap gap-2 mb-4">
        <Button variant="ghost" onClick={() => setShowPwChange((s) => !s)}>Change password</Button>
        {myAccount?.totp_enabled ? (
          <Button variant="ghost" onClick={disableTotp}>Disable 2FA</Button>
        ) : (
          <Button variant="ghost" onClick={setupTotp}>Enable 2FA</Button>
        )}
      </div>

      {showPwChange && (
        <div className="flex flex-wrap gap-2 mb-4 items-end">
          <input type="password" placeholder="Current password" value={pwForm.current}
            onChange={(e) => setPwForm((f) => ({ ...f, current: e.target.value }))} className="w-[180px]" />
          <input type="password" placeholder="New password" value={pwForm.next}
            onChange={(e) => setPwForm((f) => ({ ...f, next: e.target.value }))} className="w-[180px]" />
          <Button variant="ghost" onClick={changePassword}>Save</Button>
          <Button variant="ghost" onClick={() => setShowPwChange(false)}>Cancel</Button>
        </div>
      )}

      {/* TOTP setup flow */}
      {totpPhase === 'setup' && totpData && (
        <div className="bg-[var(--panel-raised)] rounded-xl p-4 mb-4 flex flex-col gap-3 border border-[var(--line)]">
          <p className="text-sm font-semibold text-[var(--bone)]">Set up two-factor authentication</p>
          <p className="text-xs text-[var(--fog)]">Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.).</p>
          <img src={totpData.qrDataUrl} alt="TOTP QR code" className="w-36 h-36 rounded-lg bg-white p-1" />
          <p className="text-xs font-mono text-[var(--fog)]">Manual key: <span className="text-[var(--bone)]">{totpData.secret}</span></p>
          <div className="flex gap-2 items-center">
            <input
              value={totpCode} onChange={(e) => setTotpCode(e.target.value)}
              placeholder="Enter 6-digit code to verify"
              className="w-[200px] font-mono"
              maxLength={6}
              onKeyDown={(e) => e.key === 'Enter' && enableTotp()}
            />
            <Button variant="primary" onClick={enableTotp}>Enable 2FA</Button>
            <Button variant="ghost" onClick={() => { setTotpPhase(null); setTotpData(null); }}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Add user (owner only) */}
      {me?.role === 'owner' && (
        <>
          {showAdd && (
            <div className="flex flex-wrap gap-2 mb-3 items-end">
              <input placeholder="Username" value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} className="w-[140px]" />
              <input type="password" placeholder="Password" value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} className="w-[140px]" />
              <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} className="w-[120px]">
                <option value="owner">Owner</option>
                <option value="operator">Operator</option>
                <option value="viewer">Viewer</option>
              </select>
              <Button variant="aqua" onClick={addUser} disabled={saving}>Create user</Button>
              <Button variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
            </div>
          )}
          <Button variant="ghost" onClick={() => setShowAdd((s) => !s)}>
            {showAdd ? 'Cancel' : '+ Add user'}
          </Button>
        </>
      )}
    </PanelSection>
  );
}

/* ── Instance management ──────────────────────────────────────────────────── */
const BLANK_INSTANCE: Partial<Instance> = {
  name: '', service_name: '', exe_path: '', save_dir: '', backup_dir: '',
  settings_ini: '', log_file: '', rcon_host: '127.0.0.1', rcon_port: 25575,
  rcon_password: '', public_ip: '', game_port: 8211, steamcmd_exe: '', mods_dir: '',
};

function InstanceField({ label, field, form, set, type = 'text', placeholder }: {
  label: string; field: keyof Instance; form: Partial<Instance>;
  set: (f: keyof Instance, v: string | number) => void;
  type?: string; placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10.5px] uppercase tracking-[0.09em] text-fog font-semibold">{label}</label>
      <input
        type={type}
        placeholder={placeholder}
        value={(form[field] as string | number) ?? ''}
        onChange={(e) => set(field, type === 'number' ? Number(e.target.value) : e.target.value)}
      />
    </div>
  );
}

function InstanceForm({ initial, onSave, onCancel, saving }: {
  initial: Partial<Instance>;
  onSave: (data: Partial<Instance>) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<Partial<Instance>>(initial);
  const set = (f: keyof Instance, v: string | number) => setForm((p) => ({ ...p, [f]: v }));

  return (
    <div className="rounded-xl border border-line/60 bg-panel-raised p-5 flex flex-col gap-5 mt-3">
      <div className="grid grid-cols-2 gap-4">
        <InstanceField label="Display name"          field="name"         form={form} set={set} placeholder="My Palworld Server" />
        <InstanceField label="Windows service name"  field="service_name" form={form} set={set} placeholder="PalServer" />
        <InstanceField label="PalServer.exe path"    field="exe_path"     form={form} set={set} placeholder="C:\PalServer\Pal\Binaries\Win64\PalServer-Win64-Shipping-Cmd.exe" />
        <InstanceField label="PalWorldSettings.ini"  field="settings_ini" form={form} set={set} placeholder="C:\PalServer\Pal\Saved\Config\WindowsServer\PalWorldSettings.ini" />
        <InstanceField label="Save data directory"   field="save_dir"     form={form} set={set} placeholder="C:\PalServer\Pal\Saved" />
        <InstanceField label="Backup output dir"     field="backup_dir"   form={form} set={set} placeholder="C:\PalboxBackups" />
        <InstanceField label="Log file path"         field="log_file"     form={form} set={set} placeholder="C:\PalServer\Pal\Saved\Logs\PalServer.log" />
        <InstanceField label="Mods directory"        field="mods_dir"     form={form} set={set} placeholder="C:\PalServer\Pal\Binaries\Win64\Mods" />
        <InstanceField label="SteamCMD path"         field="steamcmd_exe" form={form} set={set} placeholder="C:\steamcmd\steamcmd.exe" />
        <InstanceField label="Public IP"             field="public_ip"    form={form} set={set} placeholder="0.0.0.0" />
        <InstanceField label="Game port"             field="game_port"    form={form} set={set} type="number" placeholder="8211" />
        <InstanceField label="RCON host"             field="rcon_host"    form={form} set={set} placeholder="127.0.0.1" />
        <InstanceField label="RCON port"             field="rcon_port"    form={form} set={set} type="number" placeholder="25575" />
        <InstanceField label="RCON password"         field="rcon_password" form={form} set={set} type="password" />
      </div>
      <div className="flex gap-2 pt-1 border-t border-line/40">
        <Button variant="aqua" loading={saving} onClick={() => onSave(form)}>Save server</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function InstancesSection() {
  const { instances, setActiveId, reload } = useInstance();
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [saving, setSaving] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);

  // Scroll into view when navigated via "Add server" sidebar link
  useEffect(() => {
    if (window.location.hash === '#instances') {
      sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setEditing('new');
    }
  }, []);

  async function save(data: Partial<Instance>) {
    if (!data.name?.trim()) { alert('Display name is required.'); return; }
    setSaving(true);
    try {
      if (editing === 'new') {
        const created = await instanceApi.create(data);
        setActiveId(created.id);
      } else if (typeof editing === 'number') {
        await instanceApi.update(editing, data);
      }
      await reload();
      setEditing(null);
    } catch (e) { alert((e as Error).message); }
    setSaving(false);
  }

  async function del(id: number) {
    if (!confirm('Remove this server from Palbox? (Does not delete any files.)')) return;
    try { await instanceApi.delete(id); await reload(); } catch (e) { alert((e as Error).message); }
  }

  const editingInstance = typeof editing === 'number' ? instances.find((i) => i.id === editing) : undefined;

  return (
    <div ref={sectionRef} id="instances">
      <PanelSection
        title="Server instances"
        description="Each instance is an independent Palworld server. Switch between them in the sidebar."
      >
        <div className="flex flex-col gap-2">
          {instances.map((inst) => (
            <div key={inst.id} className="flex items-center gap-3 px-4 py-3 bg-void/40 rounded-xl border border-line/50">
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-bone text-[13.5px]">{inst.name}</span>
                <span className="ml-2 text-fog text-[11.5px] font-mono">:{inst.game_port} · {inst.service_name}</span>
              </div>
              <Button variant="ghost" onClick={() => setEditing(inst.id)}>Edit</Button>
              {instances.length > 1 && (
                <button onClick={() => del(inst.id)} className="text-fog hover:text-rust transition-colors text-[18px] leading-none">×</button>
              )}
            </div>
          ))}
        </div>

        {editing === 'new' && (
          <InstanceForm initial={BLANK_INSTANCE} onSave={save} onCancel={() => setEditing(null)} saving={saving} />
        )}
        {typeof editing === 'number' && editingInstance && (
          <InstanceForm initial={editingInstance} onSave={save} onCancel={() => setEditing(null)} saving={saving} />
        )}

        {editing === null && (
          <Button variant="ghost" onClick={() => setEditing('new')} className="mt-3">
            + Add server
          </Button>
        )}
      </PanelSection>
    </div>
  );
}

/* ── App / panel self-update ──────────────────────────────────────────────── */
function AppUpdateSection() {
  const [info, setInfo] = useState<{ current: string; latest: string; updateAvailable: boolean; releaseUrl: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/app-version', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setInfo(d as { current: string; latest: string; updateAvailable: boolean; releaseUrl: string }))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function applyUpdate() {
    if (!confirm(`Apply update to v${info?.latest}? The panel will go offline briefly while it restarts.`)) return;
    setApplying(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch('/api/app-version/update', { method: 'POST', credentials: 'include' });
      const body = await res.json() as { ok?: boolean; message?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      setMessage(body.message ?? 'Update queued — the panel will restart shortly.');
    } catch (e) {
      setError((e as Error).message);
      setApplying(false);
    }
  }

  return (
    <PanelSection title="Panel updates" description="The Palbox management panel version running on this server.">
      {loading ? (
        <div className="text-fog text-[13px]">Checking…</div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="bg-void/40 border border-line/50 rounded-xl px-4 py-3 flex flex-col gap-0.5">
              <span className="text-[10px] uppercase tracking-widest text-fog font-medium">Installed</span>
              <span className="font-mono text-[15px] font-semibold">{info?.current ?? '–'}</span>
            </div>
            <div className="text-fog text-[18px]">→</div>
            <div className={cn('border rounded-xl px-4 py-3 flex flex-col gap-0.5',
              info?.updateAvailable ? 'border-violet/40 bg-violet/5' : 'border-line/50 bg-void/40')}>
              <span className="text-[10px] uppercase tracking-widest text-fog font-medium">Latest on GitHub</span>
              <span className={cn('font-mono text-[15px] font-semibold', info?.updateAvailable ? 'text-violet' : '')}>
                {info?.latest ?? '–'}
              </span>
            </div>
            {info?.updateAvailable && !applying && !message && (
              <Button variant="violet" onClick={applyUpdate}>Apply update</Button>
            )}
            {applying && (
              <div className="flex items-center gap-2 text-[13px] text-fog">
                <svg className="animate-spin w-4 h-4 text-violet" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <path d="M21 12a9 9 0 11-6.219-8.56" />
                </svg>
                Applying…
              </div>
            )}
          </div>

          {message && (
            <div className="p-3.5 rounded-xl bg-lime/6 border border-lime/30 text-lime text-[12.5px] leading-relaxed">
              {message}
              <div className="mt-2 text-fog/70">
                Check <code className="font-mono text-[11px]">palbox-update.log</code> in your install directory for progress details.
              </div>
            </div>
          )}
          {error && (
            <div className="p-3.5 rounded-xl bg-rust/8 border border-rust/30 text-rust text-[12.5px]">
              {error}
            </div>
          )}

          {!info?.updateAvailable && !message && (
            <div className="text-fog text-[13px]">Panel is up to date.</div>
          )}
        </div>
      )}
    </PanelSection>
  );
}

/* ── Config history ───────────────────────────────────────────────────────── */
function ConfigHistorySection() {
  const { api, active } = useInstance();
  const [snapshots, setSnapshots] = useState<{ id: number; hash: string; created_at: number }[]>([]);
  const [diffData, setDiffData]   = useState<{ diff: { type: '+' | '-' | ' '; line: string }[]; from?: number; to?: number } | null>(null);
  const [loading, setLoading]     = useState(false);

  useEffect(() => {
    if (!api) return;
    api.listConfigHistory().then(setSnapshots).catch(() => {});
  }, [api, active?.id]);

  async function viewDiff(id: number) {
    if (!api) return;
    setLoading(true);
    try { setDiffData(await api.diffConfigSnapshot(id)); } catch { /* ignore */ }
    setLoading(false);
  }

  return (
    <PanelSection title="Config snapshot history"
      description="A new snapshot is saved automatically whenever PalWorldSettings.ini changes. Click any entry to view the diff from the previous version.">
      {snapshots.length === 0 && <div className="text-fog text-[13px] py-2">No snapshots yet — one will be saved on next watchdog tick.</div>}
      <div className="flex flex-col gap-1.5">
        {snapshots.slice(0, 10).map((s) => (
          <button key={s.id} onClick={() => viewDiff(s.id)}
            className="flex items-center justify-between px-4 py-2.5 rounded-xl border border-line hover:border-aqua/40 hover:bg-aqua/4 text-left transition-colors">
            <div className="flex items-center gap-3">
              <span className="w-1.5 h-1.5 rounded-full bg-aqua shrink-0" />
              <span className="font-mono text-[12px] text-fog/60">{s.hash.slice(0, 8)}</span>
            </div>
            <span className="text-[12px] text-fog">{new Date(s.created_at * 1000).toLocaleString()}</span>
          </button>
        ))}
      </div>
      {diffData && (
        <div className="mt-4">
          <div className="text-[11px] uppercase tracking-widest text-fog mb-2">
            Diff
            {diffData.from && diffData.to && ` · ${new Date(diffData.from * 1000).toLocaleString()} → ${new Date(diffData.to * 1000).toLocaleString()}`}
          </div>
          <div className="bg-panel-raised border border-line rounded-xl overflow-auto max-h-64 p-3 font-mono text-[11.5px] leading-relaxed">
            {diffData.diff.filter((l) => l.type !== ' ' || l.line.trim()).map((l, i) => (
              <div key={i} className={l.type === '+' ? 'text-lime' : l.type === '-' ? 'text-rust' : 'text-fog/40'}>
                {l.type} {l.line}
              </div>
            ))}
          </div>
          <button onClick={() => setDiffData(null)} className="mt-2 text-[11px] text-fog/50 hover:text-fog">Close diff</button>
        </div>
      )}
      {loading && <div className="text-fog text-[13px] mt-2">Loading diff…</div>}
    </PanelSection>
  );
}

/* ── Embeddable widget ───────────────────────────────────────────────────────── */
function WidgetSection() {
  const { active } = useInstance();
  const [copied, setCopied] = useState(false);
  const origin = window.location.origin;
  const instanceId = active?.id ?? 1;

  const embedCode =
    `<div id="palbox-status"></div>\n<script src="${origin}/api/public/widget.js?instance=${instanceId}"></script>`;
  const iframeSrc = `${origin}/public?instance=${instanceId}`;

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  return (
    <PanelSection title="Share your server"
      description="Embed a live status badge on any external website, or share the full status page URL with your community.">
      <div className="space-y-4">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-fog mb-2">Status badge embed</div>
          <div className="bg-panel-raised border border-line rounded-xl p-3 font-mono text-[11.5px] text-bone-dim break-all leading-relaxed">
            {embedCode}
          </div>
          <button onClick={() => copy(embedCode)}
            className="mt-2 text-[12px] px-3 py-1.5 rounded-lg bg-aqua/10 border border-aqua/30 text-aqua hover:bg-aqua/20 transition-colors">
            {copied ? 'Copied!' : 'Copy snippet'}
          </button>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-widest text-fog mb-2">Public status page URL</div>
          <div className="flex items-center gap-3">
            <div className="bg-panel-raised border border-line rounded-xl px-3 py-2 font-mono text-[12px] text-bone-dim flex-1 truncate">
              {iframeSrc}
            </div>
            <a href={iframeSrc} target="_blank" rel="noreferrer"
              className="shrink-0 text-[12px] px-3 py-1.5 rounded-lg bg-aqua/10 border border-aqua/30 text-aqua hover:bg-aqua/20 transition-colors">
              Open
            </a>
            <button onClick={() => copy(iframeSrc)}
              className="shrink-0 text-[12px] px-3 py-1.5 rounded-lg bg-panel-raised border border-line text-fog hover:text-bone transition-colors">
              Copy
            </button>
          </div>
        </div>
      </div>
    </PanelSection>
  );
}

/* ── Theme switcher ───────────────────────────────────────────────────────── */
function ThemeSection() {
  const { theme, setTheme } = useTheme();

  return (
    <PanelSection title="Appearance" description="Choose a color theme for the panel. Your preference is stored locally in the browser.">
      <div className="flex flex-wrap gap-3">
        {THEMES.map((t) => (
          <button
            key={t.id}
            onClick={() => setTheme(t.id)}
            className={cn(
              'flex items-center gap-2.5 px-4 py-2.5 rounded-xl border text-sm font-medium transition-all duration-150',
              theme === t.id
                ? 'border-2 text-[var(--bone)]'
                : 'border-[var(--line)] text-[var(--fog)] hover:text-[var(--bone)] hover:border-[var(--fog)]/40',
            )}
            style={theme === t.id ? { borderColor: t.color, boxShadow: `0 0 0 1px ${t.color}30` } : undefined}
          >
            <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: t.color }} />
            {t.label}
            {theme === t.id && <span className="ml-1 text-[10px] text-[var(--fog)]">active</span>}
          </button>
        ))}
      </div>
    </PanelSection>
  );
}
