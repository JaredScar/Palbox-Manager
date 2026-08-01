import { exec, execFile, spawn } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import path from 'path';
import type { Instance } from '../db/types';
import { log } from '../lib/logger';

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
 * Makes the server write a log file.
 *
 * Palworld is an Unreal shipping build, which only opens Pal\Saved\Logs\Pal.log
 * when launched with -log. Without it no log is ever produced, and no amount of
 * searching will find one - which is why the console can appear permanently
 * empty on an otherwise healthy server. RCON and the REST API are no
 * substitute: neither exposes a log or console stream.
 */
export async function enableFileLogging(inst: Instance): Promise<LoggingSetupResult> {
  if (os.platform() !== 'win32') {
    return { changed: false, restartRequired: false, message: 'Only supported on Windows.' };
  }

  const hasService = inst.service_name ? await nssmServiceExists(inst.service_name) : false;
  if (!hasService) {
    // Direct launches get -log added by startServer, so there is no persistent
    // configuration to change.
    return {
      changed: false,
      restartRequired: true,
      message: inst.service_name
        ? `No NSSM service named "${inst.service_name}" was found. Palbox launches the executable directly and now passes -log, so restart the server from the panel to start producing a log.`
        : 'This instance launches the executable directly. Palbox now passes -log, so restart the server from the panel to start producing a log.',
    };
  }

  let params: string;
  try {
    params = await nssmGet(inst.service_name, 'AppParameters');
  } catch (e) {
    throw new Error(
      `Could not read the launch arguments for service "${inst.service_name}" via nssm: ${(e as Error).message}`,
    );
  }

  const alreadyLogging = /(^|\s)-log(\s|$)/i.test(params);
  if (!alreadyLogging) {
    const updated = params ? `${params} -log` : '-log';
    await nssmSet(inst.service_name, 'AppParameters', updated);
    log.info(`[${inst.name}] Added -log to service launch arguments: ${updated}`);
  }

  // Capturing stdout as well means the console has something to show even if
  // the game's own log stays empty.
  let stdoutCaptured = false;
  try {
    const consoleLog = path.join(path.dirname(inst.exe_path || 'C:\\'), 'palbox-console.log');
    await nssmSet(inst.service_name, 'AppStdout', consoleLog);
    await nssmSet(inst.service_name, 'AppStderr', consoleLog);
    await nssmSet(inst.service_name, 'AppRotateFiles', '1');
    stdoutCaptured = true;
  } catch (e) {
    log.warn(`[${inst.name}] Could not configure stdout capture:`, e);
  }

  if (alreadyLogging && !stdoutCaptured) {
    return {
      changed: false,
      restartRequired: false,
      message: 'The server is already configured with -log. If no log appears, check that the server has been restarted since it was set.',
    };
  }

  return {
    changed: true,
    restartRequired: true,
    message: `Logging configured for "${inst.service_name}"${alreadyLogging ? '' : ' (-log added)'}${stdoutCaptured ? ' and console output is now captured' : ''}. Restart the server for it to take effect.`,
  };
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
  // -log makes the Unreal shipping build open Pal\Saved\Logs\Pal.log. Without
  // it the server writes no log at all and the live console has no source.
  const child = spawn(`"${inst.exe_path}"`, ['-log'], {
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
