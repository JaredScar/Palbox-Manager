import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import type { Instance } from '../db/types';
import { log } from '../lib/logger';

const execAsync = promisify(exec);

export type ServerStatus = 'online' | 'offline' | 'starting' | 'stopping';

async function psCommand(cmd: string): Promise<string> {
  const { stdout } = await execAsync(
    `powershell -NoProfile -NonInteractive -Command "${cmd}"`,
    { timeout: 10_000 },
  );
  return stdout.trim();
}

async function nssmCommand(serviceName: string, verb: string): Promise<string> {
  const { stdout, stderr } = await execAsync(
    `nssm ${verb} "${serviceName}"`,
    { timeout: 15_000 },
  );
  const combined = (stdout + stderr).toLowerCase();
  if (combined.includes("can't open service") || combined.includes('no such service')) {
    throw new Error(`NSSM service "${serviceName}" not found`);
  }
  return stdout.trim();
}

/** Check whether an NSSM service exists without throwing. */
async function nssmServiceExists(serviceName: string): Promise<boolean> {
  try {
    const { stdout, stderr } = await execAsync(`nssm status "${serviceName}"`, { timeout: 8_000 });
    const out = (stdout + stderr).toLowerCase();
    return !out.includes("can't open service") && !out.includes('no such service');
  } catch {
    return false;
  }
}

export async function getStatus(inst: Instance): Promise<{ status: ServerStatus; uptime: number | null }> {
  try {
    const out = await psCommand(
      `(Get-Service -Name '${inst.service_name}' -ErrorAction SilentlyContinue).Status`,
    );
    if (out === 'Running') {
      try {
        const exeName = inst.exe_path
          ? inst.exe_path.split('\\').pop()?.replace('.exe', '') ?? 'PalServer'
          : 'PalServer-Win64-Shipping-Cmd';
        const uptimeStr = await psCommand(
          `$p = Get-Process -Name '${exeName}' -ErrorAction SilentlyContinue | Select-Object -First 1; ` +
            `if($p){ [string]((Get-Date) - $p.StartTime).TotalSeconds } else { '' }`,
        );
        const uptime = parseFloat(uptimeStr);
        return { status: 'online', uptime: isNaN(uptime) ? null : Math.floor(uptime) };
      } catch {
        return { status: 'online', uptime: null };
      }
    }
    if (out === 'Stopped')     return { status: 'offline',  uptime: null };
    if (out === 'StartPending') return { status: 'starting', uptime: null };
    if (out === 'StopPending')  return { status: 'stopping', uptime: null };
    return { status: 'offline', uptime: null };
  } catch (err) {
    log.warn(`getStatus(${inst.name}) failed:`, err);
    return { status: 'offline', uptime: null };
  }
}

export async function startServer(inst: Instance): Promise<void> {
  log.info(`Starting ${inst.name}...`);
  const hasService = inst.service_name ? await nssmServiceExists(inst.service_name) : false;
  if (hasService) {
    await nssmCommand(inst.service_name, 'start');
    return;
  }
  // Fall back: launch the exe directly as a detached process
  if (!inst.exe_path) {
    throw new Error(
      `NSSM service "${inst.service_name || '(none)'}" does not exist and no exe_path is configured.` +
      ` Please register the server as a Windows service via NSSM or set the exe path in Settings → Server instances.`,
    );
  }
  log.warn(`NSSM service "${inst.service_name}" not found — launching "${inst.exe_path}" directly.`);
  const child = spawn(`"${inst.exe_path}"`, [], {
    shell: true,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

export async function stopServer(inst: Instance): Promise<void> {
  log.info(`Stopping ${inst.name}...`);
  const hasService = inst.service_name ? await nssmServiceExists(inst.service_name) : false;
  if (hasService) {
    await nssmCommand(inst.service_name, 'stop');
    return;
  }
  // Fall back: kill by exe name via PowerShell
  if (inst.exe_path) {
    const exeName = inst.exe_path.split('\\').pop()?.replace(/\.exe$/i, '') ?? 'PalServer';
    await psCommand(`Stop-Process -Name '${exeName}' -Force -ErrorAction SilentlyContinue`);
  }
}

export async function restartServer(inst: Instance): Promise<void> {
  log.info(`Restarting ${inst.name}...`);
  const hasService = inst.service_name ? await nssmServiceExists(inst.service_name) : false;
  if (hasService) {
    await nssmCommand(inst.service_name, 'restart');
    return;
  }
  await stopServer(inst);
  await new Promise((r) => setTimeout(r, 3000));
  await startServer(inst);
}

export async function getCpuAndMemory(inst: Instance): Promise<{ cpuPct: number; memMb: number }> {
  try {
    const exeName = inst.exe_path
      ? inst.exe_path.split('\\').pop()?.replace('.exe', '') ?? 'PalServer'
      : 'PalServer-Win64-Shipping-Cmd';

    const out = await psCommand(
      `$p = Get-Process -Name '${exeName}' -ErrorAction SilentlyContinue | Select-Object -First 1; ` +
        `if($p){ [string]$p.WorkingSet64 + ' 0' } else { '0 0' }`,
    );
    const parts = out.split(' ');
    const memMb = parseFloat(parts[0]) / 1024 / 1024;
    return { cpuPct: 0, memMb: isNaN(memMb) ? 0 : memMb };
  } catch {
    return { cpuPct: 0, memMb: 0 };
  }
}
