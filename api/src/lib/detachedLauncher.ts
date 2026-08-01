import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execFileAsync = promisify(execFile);

/**
 * Launching a process that must outlive this one.
 *
 * The updater has to stop the Palbox service, which kills this process, and
 * then keep working. That is harder than it sounds on Windows: a service and
 * its children run inside a job object, and terminating the service tears down
 * the whole job. Node's `detached` option sets DETACHED_PROCESS but not
 * CREATE_BREAKAWAY_FROM_JOB, so a "detached" child is still in the job and
 * still dies with it - which is exactly the failure where the update log stops
 * at the moment the service is stopped.
 *
 * Task Scheduler is the way out: it runs the script under its own service, in
 * its own job, as SYSTEM, so it is both genuinely independent and elevated
 * enough to control services. The rest are fallbacks for machines where Task
 * Scheduler is unavailable or locked down.
 *
 * Two details are load-bearing. Every strategy runs a generated .cmd wrapper
 * rather than a command line with arguments, because quoting a path inside
 * schtasks /TR and inside "start" is where this breaks in practice. And
 * success is confirmed by watching for a marker the script itself writes: a
 * process id proves only that something was spawned, not that PowerShell ever
 * ran the script, which is precisely how a failed update came to look like a
 * successful one.
 */

export type LaunchStrategy = 'scheduled-task' | 'cmd-start' | 'spawn';

export interface LaunchAttempt {
  strategy: LaunchStrategy;
  ok: boolean;
  detail: string;
}

export interface LaunchResult {
  ok: boolean;
  strategy: LaunchStrategy | null;
  attempts: LaunchAttempt[];
}

export function powershellPath(): string {
  const systemRoot = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows';
  const abs = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return fs.existsSync(abs) ? abs : 'powershell.exe';
}

/**
 * A .cmd that runs the script with no arguments of its own, so no strategy has
 * to quote anything beyond a single path.
 */
function writeWrapper(script: string, outputLog?: string): string {
  const wrapper = script.replace(/\.ps1$/i, '') + '-run.cmd';
  const redirect = outputLog ? ` >> "${outputLog}" 2>&1` : '';
  const body = [
    '@echo off',
    `"${powershellPath()}" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${script}"${redirect}`,
    '',
  ].join('\r\n');
  fs.writeFileSync(wrapper, body, 'ascii');
  return wrapper;
}

/** HH:mm a couple of minutes out, which schtasks requires even when run on demand. */
function soonHHmm(): string {
  const t = new Date(Date.now() + 2 * 60_000);
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
}

async function viaScheduledTask(wrapper: string, taskName: string): Promise<string> {
  await execFileAsync('schtasks', [
    '/Create', '/TN', taskName, '/TR', wrapper,
    '/SC', 'ONCE', '/ST', soonHHmm(),
    '/RU', 'SYSTEM', '/RL', 'HIGHEST', '/F',
  ], { timeout: 20_000, windowsHide: true });

  await execFileAsync('schtasks', ['/Run', '/TN', taskName], { timeout: 20_000, windowsHide: true });
  return `task "${taskName}" running as SYSTEM`;
}

async function viaCmdStart(wrapper: string): Promise<string> {
  // "start" hands the process to the shell rather than parenting it here, so
  // it outlives this process even though it stays inside the job.
  const child = spawn('cmd.exe', ['/c', 'start', '/b', wrapper], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  if (!child.pid) throw new Error('cmd.exe produced no pid');
  child.unref();
  return `cmd start (pid ${child.pid})`;
}

async function viaSpawn(wrapper: string): Promise<string> {
  const child = spawn(wrapper, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    shell: true,
  });
  if (!child.pid) throw new Error('spawn produced no pid');
  child.unref();
  return `direct spawn (pid ${child.pid})`;
}

function markerSeen(marker: string, since: number): boolean {
  try { return fs.statSync(marker).mtimeMs >= since; } catch { return false; }
}

/**
 * Runs a PowerShell script independently of this process, trying each strategy
 * until the script confirms it is running by writing `marker`. Every attempt is
 * reported so a failure names the mechanism that was refused and why.
 */
export async function launchDetachedPowerShell(
  script: string,
  opts: {
    taskName: string;
    /** File the script writes as its first action; proof it really started. */
    marker: string;
    outputLog?: string;
    verifyTimeoutMs?: number;
  },
): Promise<LaunchResult> {
  const attempts: LaunchAttempt[] = [];
  const wrapper = writeWrapper(script, opts.outputLog);
  const verifyMs = opts.verifyTimeoutMs ?? 6000;
  const startedAt = Date.now();

  const strategies: [LaunchStrategy, () => Promise<string>][] = [
    ['scheduled-task', () => viaScheduledTask(wrapper, opts.taskName)],
    ['cmd-start',      () => viaCmdStart(wrapper)],
    ['spawn',          () => viaSpawn(wrapper)],
  ];

  for (const [strategy, run] of strategies) {
    let detail: string;
    try {
      detail = await run();
    } catch (e) {
      attempts.push({ strategy, ok: false, detail: (e as Error).message.trim().split('\n')[0] });
      continue;
    }

    const deadline = Date.now() + verifyMs;
    while (Date.now() < deadline) {
      if (markerSeen(opts.marker, startedAt)) {
        attempts.push({ strategy, ok: true, detail });
        return { ok: true, strategy, attempts };
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    attempts.push({
      strategy,
      ok: false,
      detail: `${detail}, but the script never started within ${verifyMs / 1000}s`,
    });
  }

  return { ok: false, strategy: null, attempts };
}
