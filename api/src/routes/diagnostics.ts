import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { resolveInstance } from '../middleware/instance.js';
import { RCON_STRATEGIES, type RconStrategyName, type RconAttempt } from '../lib/rcon.js';
import { restGetInfo } from '../services/palrest.js';
import { candidateHosts, restPortOf } from '../services/connection.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, resolveInstance);

export interface DiagResult {
  ok:         boolean;
  latencyMs:  number | null;
  error:      string | null;
  /** Actionable next step shown beneath the error in the UI. */
  hint?:      string;
  /** Implementation that answered, when more than one was tried. */
  strategy?:  string;
  /** Outcome per RCON implementation, for pinning down protocol quirks. */
  attempts?:  { strategy: string; error: string }[];
}

export interface DiagnosticsResponse {
  rcon:    DiagResult;
  rest:    DiagResult & { serverName?: string; version?: string };
  summary: string;
  /** True when something needs the user's attention. RCON alone failing does not. */
  degraded: boolean;
}

// Probe budget. Every host is probed concurrently, so the whole request is
// bounded by the slowest single probe rather than the sum of all of them.
const PROBE_MS = 4000;

/**
 * Node's fetch throws a generic `TypeError: fetch failed` and stores the real
 * network error (ECONNREFUSED, ETIMEDOUT, ...) on `cause`. Without unwrapping
 * this, every REST failure looks identical and error mapping never matches.
 */
function describeError(e: unknown): string {
  const err = e as { message?: string; cause?: { code?: string; message?: string } };
  const code = err?.cause?.code;
  const causeMsg = err?.cause?.message;
  if (code) return causeMsg ? `${code} (${causeMsg})` : code;
  return causeMsg ?? err?.message ?? String(e);
}

interface Probe { host: string; ok: boolean; latencyMs: number; raw: string | null }
interface RconProbe extends Probe { strategy?: RconStrategyName; perStrategy: RconAttempt[] }
interface RestProbe extends Probe { serverName?: string; version?: string }

/**
 * Probes every RCON implementation independently rather than stopping at the
 * first success, so the report shows which ones this server tolerates instead
 * of collapsing to a single yes/no.
 */
async function probeRcon(host: string, port: number, password: string): Promise<RconProbe> {
  const t0 = Date.now();
  const perStrategy: RconAttempt[] = [];
  let winner: RconStrategyName | undefined;

  for (const strategy of RCON_STRATEGIES) {
    try {
      await strategy.exec(host, port, password, 'Info', PROBE_MS);
      perStrategy.push({ strategy: strategy.name, error: 'OK' });
      winner ??= strategy.name;
    } catch (e) {
      perStrategy.push({ strategy: strategy.name, error: describeError(e) });
    }
  }

  const ok = winner !== undefined;
  return {
    host,
    ok,
    latencyMs: Date.now() - t0,
    raw: ok ? null : (perStrategy[0]?.error ?? 'no strategies ran'),
    strategy: winner,
    perStrategy,
  };
}

async function probeRest(host: string, port: number, password: string): Promise<RestProbe> {
  const t0 = Date.now();
  try {
    const info = await restGetInfo(host, port, password);
    return {
      host, ok: true, latencyMs: Date.now() - t0, raw: null,
      serverName: info.servername, version: info.version,
    };
  } catch (e) {
    return { host, ok: false, latencyMs: Date.now() - t0, raw: describeError(e) };
  }
}

// ── Error -> actionable message ──────────────────────────────────────────────

function explainRcon(raw: string, host: string, port: number): string {
  if (raw.includes('RCON_BAD_PASSWORD'))
    return `The server rejected the RCON password. It must match AdminPassword in PalWorldSettings.ini exactly (case-sensitive).`;
  if (raw.includes('RCON_NO_REPLY')) {
    // The client appends the raw bytes when a frame arrived but stalled, which
    // is the difference between "nothing is speaking RCON" and "it replied
    // with something we could not frame".
    const stall = raw.match(/sent ([0-9a-f]+) but declared a longer packet/)?.[1];
    return stall
      ? `Connected to ${host}:${port} and the server replied, but the packet it sent (0x${stall}) declares a longer length than it actually delivered, so the response could never be completed. This is a malformed RCON frame from the game server.`
      : `Connected to ${host}:${port}, but the server never replied to the authentication request. Something is listening on that port but is not answering as RCON — confirm RCONEnabled=True and that RCONPort really is ${port}.`;
  }
  if (raw.includes('RCON_UNREACHABLE') || raw.includes('ETIMEDOUT'))
    return `No TCP connection to ${host}:${port} within ${PROBE_MS}ms — packets are being dropped, usually by a firewall.`;
  if (raw.includes('ECONNREFUSED'))
    return `Connection refused on ${host}:${port} — nothing is listening there. Check RCONEnabled=True and RCONPort=${port} in PalWorldSettings.ini, then restart the server.`;
  if (raw.includes('ECONNRESET'))
    return `Connection reset by ${host}:${port} — the server accepted then dropped the connection.`;
  if (raw.includes('ENOTFOUND') || raw.includes('EAI_AGAIN'))
    return `Cannot resolve host "${host}".`;
  return raw;
}

function explainRest(raw: string, host: string, port: number): string {
  if (raw.includes('ECONNREFUSED'))
    return `Connection refused on ${host}:${port} — nothing is listening there. Check RESTAPIEnabled=True and RESTAPIPort=${port} in PalWorldSettings.ini. The REST API only starts after a full server restart.`;
  if (raw.includes('401'))
    return `401 Unauthorized — the password does not match AdminPassword in PalWorldSettings.ini (case-sensitive).`;
  if (raw.includes('403'))
    return `403 Forbidden — the server rejected these credentials.`;
  if (raw.includes('ETIMEDOUT') || raw.includes('timed out') || raw.includes('abort'))
    return `Timed out on ${host}:${port} — packets are being dropped, usually by a firewall.`;
  if (raw.includes('ENOTFOUND') || raw.includes('EAI_AGAIN'))
    return `Cannot resolve host "${host}".`;
  return `${raw} (tried http://${host}:${port}/v1/api/info)`;
}

/** One line per host tried, so the user can see exactly what was attempted. */
function attemptBreakdown(probes: Probe[], port: number): string {
  return probes
    .map((p) => `${p.host}:${port} → ${p.ok ? `OK (${p.latencyMs}ms)` : (p.raw ?? 'failed').split(':')[0]}`)
    .join(' · ');
}

// ── POST /instances/:id/server/diagnostics ───────────────────────────────────

router.post('/', requirePermission('server.view'), async (req, res) => {
  const inst = req.instance!;
  const restPort = restPortOf(inst);
  const pass = inst.rcon_password;
  const configured = inst.rcon_host;

  const rconConfigured = Boolean(configured && inst.rcon_port && pass);
  const restConfigured = Boolean(configured && pass);

  // Probe every host the runtime would fall back to, not just the configured
  // one, so the result shows which address actually answers.
  const rconHosts = rconConfigured ? candidateHosts(inst, 'rcon') : [];
  const restHosts = restConfigured ? candidateHosts(inst, 'rest') : [];

  const [rconProbes, restProbes] = await Promise.all([
    Promise.all(rconHosts.map((h) => probeRcon(h, inst.rcon_port, pass))),
    Promise.all(restHosts.map((h) => probeRest(h, restPort, pass))),
  ]);

  const pick = <T extends Probe>(probes: T[]): { main?: T; working?: T } => ({
    main: probes.find((p) => p.host === configured) ?? probes[0],
    working: probes.find((p) => p.ok),
  });

  // ── RCON result ────────────────────────────────────────────────────────────
  const rcon: DiagResult = { ok: false, latencyMs: null, error: null };
  if (!rconConfigured) {
    rcon.error = 'RCON is not fully configured — host, port, and password are all required.';
  } else {
    const { main, working } = pick(rconProbes);
    rcon.ok = Boolean(working);
    rcon.latencyMs = (working ?? main)!.latencyMs;
    rcon.strategy = working?.strategy;
    // Reported for whichever host got furthest, so a failure shows how each
    // implementation reacted rather than one merged message.
    rcon.attempts = (working ?? main)!.perStrategy;

    if (working && working.host !== configured) {
      rcon.hint = `RCON answered on ${working.host}:${inst.rcon_port} rather than the configured "${configured}". Palbox uses the working address automatically; set the RCON host to ${working.host} to skip the failed attempt.`;
    } else if (!working) {
      rcon.error = explainRcon(main!.raw!, main!.host, inst.rcon_port);
      if (rconProbes.length > 1) {
        rcon.hint = `Tried ${attemptBreakdown(rconProbes, inst.rcon_port)}`;
      }
    }
  }

  // ── REST result ────────────────────────────────────────────────────────────
  const rest: DiagnosticsResponse['rest'] = { ok: false, latencyMs: null, error: null };
  if (!restConfigured) {
    rest.error = 'REST API is not configured — it needs the host and the AdminPassword.';
  } else {
    const { main, working } = pick(restProbes);
    rest.ok = Boolean(working);
    rest.latencyMs = (working ?? main)!.latencyMs;

    if (working) {
      rest.serverName = working.serverName;
      rest.version = working.version;
      if (working.host !== configured) {
        rest.hint = `The REST API answered on ${working.host}:${restPort} rather than the configured "${configured}". Palbox uses it automatically; set the RCON host to ${working.host} to make it direct.`;
      }
    } else {
      rest.error = explainRest(main!.raw!, main!.host, restPort);
      if (restProbes.length > 1) {
        rest.hint = `Tried ${attemptBreakdown(restProbes, restPort)}`;
      }
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  // The REST API is the transport Palbox prefers; RCON is legacy and is only
  // needed for free-form console commands, so it failing is not a fault state.
  let summary: string;
  if (rest.ok && rcon.ok) {
    summary = rest.hint || rcon.hint
      ? 'The REST API and RCON are both working, using an address other than the one configured.'
      : 'The REST API and RCON are both connected and working.';
  } else if (rest.ok) {
    summary = 'The REST API is connected and working. RCON did not respond, which is fine — Palbox uses the REST API for everything except free-form console commands.';
  } else if (rcon.ok) {
    summary = 'RCON is working but the REST API is not. Set RESTAPIEnabled=True and open the REST API port; player positions, world map data, and metrics need it.';
  } else {
    summary = 'Neither the REST API nor RCON could connect. Check your server settings and firewall.';
  }

  res.json({ rcon, rest, summary, degraded: !rest.ok } satisfies DiagnosticsResponse);
});

export default router;
