import { useState, useEffect, useRef } from 'react';
import { Mod } from '../api/client';
import { useInstance } from '../context/InstanceContext';
import { Button } from '../components/ui/Button';
import { IconButton } from '../components/ui/IconButton';
import { Tag } from '../components/ui/Tag';
import { ViewWrapper } from '../components/layout/ViewWrapper';
import { PanelSection } from '../components/ui/PanelSection';

const thCls = 'text-left text-[10.5px] uppercase tracking-widest text-fog font-medium px-4 pb-3 border-b border-line';
const tdCls = 'px-4 py-3.5 border-b border-line last:border-b-0 text-[13px]';

export function Mods() {
  const { api, active } = useInstance();
  const [mods, setMods] = useState<Mod[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    if (!api) return;
    try { setMods(await api.listMods()); } catch {}
    setLoading(false);
  }
  useEffect(() => { load(); }, [api]);

  async function handleToggle(mod: Mod) {
    if (!api) return;
    try { await api.toggleMod(mod.id, mod.enabled === 0); await load(); }
    catch (e) { alert((e as Error).message); }
  }
  async function handleRemove(mod: Mod) {
    if (!api || !confirm(`Remove mod "${mod.name}"?`)) return;
    try { await api.removeMod(mod.id); await load(); } catch (e) { alert((e as Error).message); }
  }
  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !active) return;
    setUploading(true);
    const form = new FormData();
    form.append('mod', file);
    form.append('name', file.name.replace('.zip', ''));
    try {
      await fetch(`/api/instances/${active.id}/mods/upload`, { method: 'POST', credentials: 'include', body: form });
      await load();
    } catch (err) { alert((err as Error).message); }
    setUploading(false);
    e.target.value = '';
  }

  return (
    <ViewWrapper eyebrow="Mods" title="UE4SS mod manager"
      description="Enable, disable, and install mods without touching the file system directly."
      accentVar="var(--teal)"
      actions={
        <>
          <input ref={fileRef} type="file" accept=".zip" className="hidden" onChange={handleUpload} />
          <Button variant="teal" loading={uploading} onClick={() => fileRef.current?.click()}>Upload mod .zip</Button>
        </>
      }
    >
      {/* UE4SS banner */}
      <div className="flex items-center justify-between p-5 rounded-2xl bg-teal/8 border border-teal/35 mb-5">
        <div className="flex items-center gap-3">
          <span className="pulse-dot" style={{ color: 'var(--teal)' }} />
          <div>
            <div className="font-display font-semibold text-[14.5px]">UE4SS mod loader installed</div>
            <div className="font-mono text-[12px] text-fog mt-0.5">
              Manages mods inside {active?.mods_dir || 'mods_dir not configured'}
            </div>
          </div>
        </div>
        <Button variant="ghost">Reinstall loader</Button>
      </div>

      <PanelSection noPad>
        <table className="w-full border-collapse">
          <thead><tr>
            {['Mod','Version','Status',''].map((h,i) => <th key={i} className={thCls}>{h}</th>)}
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={4} className="text-center text-fog px-4 py-8">Loading…</td></tr>}
            {!loading && mods.length === 0 && (
              <tr><td colSpan={4} className="text-center text-fog px-4 py-8">
                {active?.mods_dir
                  ? <>Nothing found in <span className="font-mono text-[12px]">{active.mods_dir}</span> or the pak folders beside it. Upload a .zip, or install mods there and they will appear here.</>
                  : <>No mods directory configured. Set it in Settings → Server instances, usually <span className="font-mono text-[12px]">Pal\Binaries\Win64\Mods</span>.</>}
              </td></tr>
            )}
            {mods.map((mod) => (
              <tr key={mod.id} className="hover:bg-white/[0.02]">
                <td className={tdCls}>
                  <div className="flex items-center gap-2">
                    <span className={mod.builtin ? 'text-fog' : undefined}>{mod.name}</span>
                    <span className="text-[10px] uppercase tracking-wider text-fog/60 border border-line rounded px-1.5 py-0.5">
                      {mod.kind === 'pak' ? 'pak' : 'ue4ss'}
                    </span>
                    {mod.builtin > 0 && (
                      <span className="text-[10px] uppercase tracking-wider text-fog/50">built-in</span>
                    )}
                  </div>
                </td>
                <td className={`${tdCls} font-mono text-fog`}>{mod.version}</td>
                <td className={tdCls}>
                  <button onClick={() => handleToggle(mod)}>
                    <Tag variant={mod.enabled ? 'enabled' : 'disabled'}>{mod.enabled ? 'enabled' : 'disabled'}</Tag>
                  </button>
                </td>
                <td className={tdCls}>
                  <div className="flex justify-end">
                    {mod.builtin === 0 && (
                      <IconButton label="Remove" onClick={() => handleRemove(mod)}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></svg>
                      </IconButton>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </PanelSection>

      <PanelSection title="Compatibility" description="Mods are checked against the installed server build before enabling. A build mismatch is the most common cause of mod-related crashes after an update." />
    </ViewWrapper>
  );
}
