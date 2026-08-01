import { exec, execFile, spawn } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import fs from 'fs';
import type { Instance } from '../db/types';
import { log } from '../lib/logger';
import { stdoutCapturePath } from '../lib/logfile.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export type ServerStatus = 'online' | 'offline' | 'starting' | 'stopping';

async function psCommand(cmd: string): Promise<string> {
  // Use -ExecutionPolicy Bypass so it works under any NSSM/SYSTEM account context.
  // Escape internal double-quotes by passing the command via -EncodedCommand to avoid
  // shell quoting issues on Windows when running as a service.
  const encoded = Buffer.from(cmd, 'utf16le').toString('base64');
  const { stdout } = await execAsync(
    `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`,
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

/**
 * NSSM writes its output as UTF-16LE on Windows, which decodes to garbage if
 * read as UTF-8.
 */
function decodeNssm(buf: Buffer): string {
  const looksUtf16 = buf.length >= 2 && buf.indexOf(0) >= 0;
  const text = looksUtf16 ? buf.toString('utf16le') : buf.toString('utf8');
  return text.replace(/\uFEFF/g, '').replace(/\0/g, '').trim();
}

async function nssmGet(serviceName: string, param: string): Promise<string> {
  const { stdout } = await execFileAsync('nssm', ['get', serviceName, param], {
    timeout: 8_000,
    encoding: 'buffer',
  });
  return decodeNssm(stdout as unknown as Buffer);
}

async function nssmSet(serviceName: string, param: string, value: string): Promise<void> {
  // execFile rather than exec: the value can contain spaces and quotes, and
  // passing it as an argument avoids building a shell command around it.
  await execFileAsync('nssm', ['set', serviceName, param, value], { timeout: 8_000 });
}

export interface LoggingSetupResult {
  changed: boolean;
  restartRequired: boolean;
  message: string;
}

/**
 * Redirects the server's console output to a file, which is the only way to
 * see it.
 *
 * Palworld writes no log: Pocket Pair ships the dedicated server with Unreal's
 * log output disabled, so Pal\Saved\Logs\Pal.log does not exist and no launch
 * argument creates one. Everything goes to stdout and is discarded when the
 * process exits. NSSM can redirect that stream to a file, which is how other
 * panels show a live console, and what makes player connects, save events and
 * crash traces visible here.
 *
 * Only works for servers run as a service. A directly launched process has no
 * console to redirect, so those keep the Palbox event feed alone.
 */
export async function enableFileLogging(inst: Instance): Promise<LoggingSetupResult> {
  if (os.platform() !== 'win32') {
    return { changed: false, restartRequired: false, message: 'Only supported on Windows.' };
  }

  const hasService = inst.service_name ? await nssmServiceExists(inst.service_name) : false;
  if (!hasService) {
    return {
      changed: false,
      restartRequired: false,
      message: inst.service_name
        ? `No NSSM service named "${inst.service_name}" was found. Palworld writes no log of its own, and its console output can only be captured when it runs as a service, so register it with NSSM to get real console output.`
        : 'This instance launches the executable directly. Palworld writes no log of its own, and its console output can only be captured when it runs as a service, so register it with NSSM to get real console output.',
    };
  }

  const target = stdoutCapturePath(inst);
  if (!target) {
    throw new Error('Set the server executable path for this instance first — it determines where the captured output is written.');
  }

  const already = await nssmGet(inst.service_name, 'AppStdout').catch(() => '');
  await configureOutputCapture(inst.service_name, target);

  const sameAsBefore = already.trim().toLowerCase() === target.toLowerCase();
  return {
    changed: !sameAsBefore,
    restartRequired: true,
    message: sameAsBefore
      ? `Console output was already being captured to ${target}. If it is empty, the server has not been restarted since capture was set up — Palworld only writes to a console it was started with.`
      : `Console output will be captured to ${target}. Restart the server for it to take effect; Palworld only writes to the console it was started with.`,
  };
}

/** Points the service's stdout and stderr at a file, with rotation so it cannot grow without bound. */
async function configureOutputCapture(serviceName: string, target: string): Promise<void> {
  await nssmSet(serviceName, 'AppStdout', target);
  await nssmSet(serviceName, 'AppStderr', target);
  // Rotate rather than truncate, so a restart does not throw away the output
  // that explains why the previous run ended.
  await nssmSet(serviceName, 'AppRotateFiles', '1');
  await nssmSet(serviceName, 'AppRotateOnline', '1');
  await nssmSet(serviceName, 'AppRotateBytes', String(20 * 1024 * 1024));
}

/**
 * Sets up output capture before a start, if it is not already configured.
 *
 * Redirection can only be applied while the service is stopped and only takes
 * effect on the next start, so doing it here means the console works without
 * the user having to know any of this.
 */
async function ensureOutputCapture(inst: Instance): Promise<void> {
  if (os.platform() !== 'win32' || !inst.service_name) return;
  const target = stdoutCapturePath(inst);
  if (!target) return;

  // A read failure must not stop the write: nssm can exit non-zero simply
  // because the parameter has never been set, which is the case that needs
  // configuring most.
  const current = await nssmGet(inst.service_name, 'AppStdout').catch(() => '');
  if (current.trim()) return; // already redirected somewhere

  try {
    await configureOutputCapture(inst.service_name, target);
    log.info(`[${inst.name}] Console output will be captured to ${target}`);
  } catch (e) {
    // Never block a start over this.
    log.warn(`[${inst.name}] Could not configure console capture:`, e);
  }
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

/** Derive the bare exe name (no extension) to use with Get-Process. */
function exeBaseName(inst: Instance): string {
  if (inst.exe_path) {
    const name = inst.exe_path.split('\\').pop() ?? '';
    return name.replace(/\.exe$/i, '') || 'PalServer-Win64-Shipping-Cmd';
  }
  return 'PalServer-Win64-Shipping-Cmd';
}

/** Check whether the game process is running by name and return uptime seconds. */
async function checkProcessDirect(inst: Instance): Promise<{ status: ServerStatus; uptime: number | null }> {
  const name = exeBaseName(inst);
  const out = await psCommand(
    `$p = Get-Process -Name '${name}' -ErrorAction SilentlyContinue | Select-Object -First 1; ` +
    `if($p){ [string]((Get-Date) - $p.StartTime).TotalSeconds } else { '' }`,
  );
  if (out) {
    const uptime = parseFloat(out);
    return { status: 'online', uptime: isNaN(uptime) ? null : Math.floor(uptime) };
  }
  return { status: 'offline', uptime: null };
}

export async function getStatus(inst: Instance): Promise<{ status: ServerStatus; uptime: number | null }> {
  try {
    // ── 1. Try the Windows service (authoritative when NSSM is configured) ──
    if (inst.service_name) {
      try {
        const svcStatus = await psCommand(
          `(Get-Service -Name '${inst.service_name}' -ErrorAction SilentlyContinue).Status`,
        );
        if (svcStatus === 'StartPending') return { status: 'starting', uptime: null };
        if (svcStatus === 'StopPending')  return { status: 'stopping', uptime: null };
        if (svcStatus === 'Stopped')      return { status: 'offline',  uptime: null };
        if (svcStatus === 'Running') {
          // Service is running — get process uptime if we can, otherwise trust the service
          const proc = await checkProcessDirect(inst);
          return proc.status === 'online'
            ? proc
            : { status: 'online', uptime: null }; // trust NSSM even if exe name mismatch
        }
        // Empty result = service not found → fall through to direct process check
      } catch { /* service query failed — fall through */ }
    }

    // ── 2. Fallback: check the process directly ──────────────────────────────
    // Handles: direct-launch (no NSSM), or service_name not configured yet.
    return await checkProcessDirect(inst);
  } catch (err) {
    log.warn(`getStatus(${inst.name}) failed:`, err);
    return { status: 'offline', uptime: null };
  }
}

export async function startServer(inst: Instance): Promise<void> {
  log.info(`Starting ${inst.name}...`);
  const hasService = inst.service_name ? await nssmServiceExists(inst.service_name) : false;
  if (hasService) {
    // Redirection can only be set while stopped and only applies to the next
    // start, so this is the one moment it can be arranged.
    await ensureOutputCapture(inst);
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
  // Console output is redirected to the same file the service would use, so a
  // directly launched server still gets a live console. Palworld writes no log
  // of its own, so without this there is nothing to read.
  const capture = stdoutCapturePath(inst);
  let out: number | 'ignore' = 'ignore';
  if (capture) {
    try { out = fs.openSync(capture, 'a'); } catch { out = 'ignore'; }
  }
  const child = spawn(`"${inst.exe_path}"`, [], {
    shell: true,
    detached: true,
    stdio: out === 'ignore' ? 'ignore' : ['ignore', out, out],
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
    const exeName = exeBaseName(inst);

    // Get memory from Get-Process (always reliable) and CPU% from the WMI
    // performance-data class (Win32_PerfFormattedData_PerfProc_Process).
    // PercentProcessorTime there is the raw counter that can exceed 100 on
    // multi-core machines, so we divide by the logical processor count to
    // get a 0-100 system-level percentage.
    const out = await psCommand(
      `$p = Get-Process -Name '${exeName}' -ErrorAction SilentlyContinue | Select-Object -First 1; ` +
      `if ($p) {` +
      `  $cim = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter "IDProcess=$($p.Id)" -ErrorAction SilentlyContinue | Select-Object -First 1;` +
      `  $cores = [Environment]::ProcessorCount; if ($cores -lt 1) { $cores = 1 };` +
      `  $cpu = if ($cim) { [Math]::Round([double]$cim.PercentProcessorTime / $cores, 1) } else { 0 };` +
      `  "$($p.WorkingSet64) $cpu"` +
      `} else { '0 0' }`,
    );

    const parts = out.split(' ');
    const memMb  = parseFloat(parts[0]) / 1024 / 1024;
    const cpuPct = parseFloat(parts[1] ?? '0');
    return {
      cpuPct: isNaN(cpuPct) ? 0 : Math.min(cpuPct, 100),
      memMb:  isNaN(memMb)  ? 0 : memMb,
    };
  } catch {
    return { cpuPct: 0, memMb: 0 };
  }
}
