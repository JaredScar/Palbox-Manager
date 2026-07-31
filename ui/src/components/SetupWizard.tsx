import { useState } from 'react';
import { instanceApi } from '../api/client';
import { Button } from './ui/Button';
import { cn } from '../lib/cn';

interface Props { onDone: () => void; }

interface FormData {
  name: string;
  exe_path: string;
  save_dir: string;
  backup_dir: string;
  log_file: string;
  rcon_host: string;
  rcon_port: string;
  rcon_password: string;
  steamcmd_exe: string;
}

const STEPS = [
  { id: 0, label: 'Server identity', icon: '🎮' },
  { id: 1, label: 'File paths',      icon: '📁' },
  { id: 2, label: 'RCON',            icon: '🖥️' },
  { id: 3, label: 'SteamCMD',        icon: '♨️' },
];

export function SetupWizard({ onDone }: Props) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormData>({
    name: 'My Palworld Server',
    exe_path: 'C:\\PalServer\\PalServer.exe',
    save_dir: 'C:\\PalServer\\Pal\\Saved',
    backup_dir: 'C:\\Palbox\\backups',
    log_file: '',
    rcon_host: '127.0.0.1',
    rcon_port: '25575',
    rcon_password: '',
    steamcmd_exe: 'C:\\steamcmd\\steamcmd.exe',
  });

  const set = (k: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value } as FormData));

  async function finish() {
    setSaving(true);
    try {
      await instanceApi.create({
        name: form.name,
        exe_path: form.exe_path,
        save_dir: form.save_dir,
        backup_dir: form.backup_dir,
        log_file: form.log_file,
        rcon_host: form.rcon_host,
        rcon_port: parseInt(form.rcon_port, 10) || 25575,
        rcon_password: form.rcon_password,
        steamcmd_exe: form.steamcmd_exe,
      });
      onDone();
    } catch (e) { alert((e as Error).message); }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-[100] bg-void/90 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="bg-panel border border-line rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-7 pt-7 pb-5 border-b border-line">
          <p className="text-[10.5px] uppercase tracking-[0.12em] text-fog mb-1">First-time setup</p>
          <h2 className="text-[20px] font-bold text-bone">Configure your server</h2>
          {/* Step pills */}
          <div className="flex gap-2 mt-4">
            {STEPS.map((s) => (
              <div key={s.id} className={cn(
                'flex-1 h-1 rounded-full transition-colors',
                step >= s.id ? 'bg-crimson' : 'bg-line',
              )} />
            ))}
          </div>
          <p className="text-[11.5px] text-fog mt-2.5">
            Step {step + 1} of {STEPS.length} — {STEPS[step].label}
          </p>
        </div>

        {/* Body */}
        <div className="px-7 py-6 flex flex-col gap-4">
          {step === 0 && (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10.5px] uppercase tracking-wide text-fog">Server name</label>
                <input value={form.name} onChange={set('name')} placeholder="My Palworld Server" />
              </div>
            </>
          )}
          {step === 1 && (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10.5px] uppercase tracking-wide text-fog">PalServer.exe path</label>
                <input value={form.exe_path} onChange={set('exe_path')} placeholder="C:\PalServer\PalServer.exe" className="font-mono text-[13px]" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10.5px] uppercase tracking-wide text-fog">Saved directory (for backups)</label>
                <input value={form.save_dir} onChange={set('save_dir')} placeholder="C:\PalServer\Pal\Saved" className="font-mono text-[13px]" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10.5px] uppercase tracking-wide text-fog">Backup output directory</label>
                <input value={form.backup_dir} onChange={set('backup_dir')} placeholder="C:\Palbox\backups" className="font-mono text-[13px]" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10.5px] uppercase tracking-wide text-fog">Server log file path (optional)</label>
                <input value={form.log_file} onChange={set('log_file')} placeholder="C:\PalServer\Pal\Saved\Logs\PalServer.log" className="font-mono text-[13px]" />
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <div className="bg-panel-raised border border-line/60 rounded-xl p-3 text-[12px] text-fog leading-relaxed">
                RCON must be enabled in <code className="text-aqua">PalWorldSettings.ini</code>. Set{' '}
                <code className="text-aqua">RCONEnabled=True</code> and configure a port and password.
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10.5px] uppercase tracking-wide text-fog">RCON host</label>
                <input value={form.rcon_host} onChange={set('rcon_host')} placeholder="127.0.0.1" className="font-mono text-[13px]" />
              </div>
              <div className="flex gap-3">
                <div className="flex flex-col gap-1.5 flex-1">
                  <label className="text-[10.5px] uppercase tracking-wide text-fog">Port</label>
                  <input value={form.rcon_port} onChange={set('rcon_port')} placeholder="25575" className="font-mono text-[13px]" />
                </div>
                <div className="flex flex-col gap-1.5 flex-[2]">
                  <label className="text-[10.5px] uppercase tracking-wide text-fog">Password</label>
                  <input type="password" value={form.rcon_password} onChange={set('rcon_password')} placeholder="Your RCON password" />
                </div>
              </div>
            </>
          )}
          {step === 3 && (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10.5px] uppercase tracking-wide text-fog">SteamCMD executable path</label>
                <input value={form.steamcmd_exe} onChange={set('steamcmd_exe')} placeholder="C:\steamcmd\steamcmd.exe" className="font-mono text-[13px]" />
                <p className="text-[11.5px] text-fog">Full path to <code className="text-aqua">steamcmd.exe</code>. Used for auto game updates.</p>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-7 pb-7 flex items-center justify-between gap-3">
          <button
            className="text-[12.5px] text-fog hover:text-bone transition-colors"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
          >
            ← Back
          </button>
          {step < STEPS.length - 1 ? (
            <Button variant="primary" onClick={() => setStep((s) => s + 1)}>
              Next →
            </Button>
          ) : (
            <Button variant="primary" onClick={finish} loading={saving}>
              Finish setup
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
