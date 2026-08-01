import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { resolveInstance } from '../middleware/instance.js';
import { RconClient } from '../lib/rcon.js';
import { restGetInfo } from '../services/palrest.js';
import { isLoopback, LOOPBACK, restPortOf } from '../services/connection.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, resolveInstance);

export interface DiagResult {
  ok:         boolean;
  latencyMs:  number | null;
  error:      string | null;
  /** Actionable next step shown beneath the error in the UI. */
  hint?:      string;
}

export interface DiagnosticsResponse {
  rcon:    DiagResult;
  rest:    DiagResult & { serverName?: string; version?: string };
  summary: string;
}

// Probe budget. Every probe runs concurrently, so the whole request is bounded
// by the slowest single probe rather than the sum of all of them.
const PROBE_MS = 5000;

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

interface Probe { ok: boolean; latencyMs: number; raw: string | null }
interface RestProbe extends Probe { serverName?: string; version?: string }

async function probeRcon(host: string, port: number, password: string): Promise<Probe> {
  const t0 = Date.now();
  const client = new RconClient(host, port, password);
  try {
    await client.connect(PROBE_MS);
    await client.send('Info', PROBE_MS);
    return { ok: true, latencyMs: Date.now() - t0, raw: null };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, raw: describeError(e) };
  } finally {
    client.disconnect();
  }
}

async function probeRest(host: string, port: number, password: string): Promise<RestProbe> {
  const t0 = Date.now();
  try {
    const info = await restGetInfo(host, port, password);
    return {
      ok: true, latencyMs: Date.now() - t0, raw: null,
      serverName: info.servername, version: info.version,
    };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, raw: describeError(e) };
  }
}

// ── Error -> actionable message ──────────────────────────────────────────────

function explainRcon(raw: string, host: string, port: number): string {
  if (raw.includes('ECONNREFUSED'))
    return `Connection refused on ${host}:${port} — nothing is listening on that address. Check RCONEnabled=True and RCONPort=${port} in PalWorldSettings.ini, then restart the server.`;
  if (raw.includes('ETIMEDOUT') || raw.includes('timed out'))
    return `Timed out reaching ${host}:${port} — packets are being dropped, usually by a firewall.`;
  if (raw.includes('authentication'))
    return `Authentication failed — the RCON password does not match AdminPassword in PalWorldSettings.ini (case-sensitive).`;
  if (raw.includes('ENOTFOUND') || raw.includes('EAI_AGAIN'))
    return `Cannot resolve host "${host}".`;
  if (raw.includes('ECONNRESET'))
    return `Connection reset by ${host}:${port} — the server accepted then dropped the connection, which usually means the RCON password is wrong.`;
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

// ── POST /instances/:id/server/diagnostics ───────────────────────────────────

router.post('/', requirePermission('server.view'), async (req, res) => {
  const inst = req.instance!;
  const restPort = restPortOf(inst);
  const host = inst.rcon_host;
  const pass = inst.rcon_password;

  const rconConfigured = Boolean(host && inst.rcon_port && pass);
  const restConfigured = Boolean(host && pass);
  // The panel usually runs on the same box as the game server. Connecting to
  // the machine's own public IP often fails (no NAT hairpin) even when the
  // service is perfectly reachable from the internet, so probe loopback too.
  const alsoTryLoopback = Boolean(host) && !isLoopback(host);

  // All probes run concurrently — sequential probing previously exceeded the
  // client's request timeout and surfaced as "signal timed out".
  const [rconMain, rconLoop, restMain, restLoop] = await Promise.all([
    rconConfigured ? probeRcon(host, inst.rcon_port, pass) : null,
    rconConfigured && alsoTryLoopback ? probeRcon(LOOPBACK, inst.rcon_port, pass) : null,
    restConfigured ? probeRest(host, restPort, pass) : null,
    restConfigured && alsoTryLoopback ? probeRest(LOOPBACK, restPort, pass) : null,
  ]);

  // ── RCON result ────────────────────────────────────────────────────────────
  const rcon: DiagResult = { ok: false, latencyMs: null, error: null };
  if (!rconConfigured) {
    rcon.error = 'RCON is not fully configured — host, port, and password are all required.';
  } else {
    rcon.ok = rconMain!.ok;
    rcon.latencyMs = rconMain!.latencyMs;
    if (!rconMain!.ok) {
      rcon.error = explainRcon(rconMain!.raw!, host, inst.rcon_port);
      if (rconLoop?.ok) {
        rcon.hint = `RCON answered on ${LOOPBACK}:${inst.rcon_port} in ${rconLoop.latencyMs}ms, so Palbox will use that automatically. Set the RCON host to ${LOOPBACK} to skip the failed attempt on every call.`;
      }
    }
  }

  // ── REST result ────────────────────────────────────────────────────────────
  const rest: DiagnosticsResponse['rest'] = { ok: false, latencyMs: null, error: null };
  if (!restConfigured) {
    rest.error = 'REST API is not configured — it needs the host and the AdminPassword.';
  } else if (restMain!.ok) {
    rest.ok = true;
    rest.latencyMs = restMain!.latencyMs;
    rest.serverName = restMain!.serverName;
    rest.version = restMain!.version;
  } else {
    rest.latencyMs = restMain!.latencyMs;
    rest.error = explainRest(restMain!.raw!, host, restPort);
    if (restLoop?.ok) {
      rest.hint = `The REST API answered on ${LOOPBACK}:${restPort} in ${restLoop.latencyMs}ms (server: ${restLoop.serverName}), so Palbox will use that automatically. Set the RCON host to ${LOOPBACK} to skip the failed attempt on every call.`;
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const loopbackWorks = Boolean(rconLoop?.ok || restLoop?.ok);
  let summary: string;
  if (rcon.ok && rest.ok) {
    summary = 'Both RCON and the REST API are connected and working.';
  } else if (loopbackWorks) {
    summary = `Reachable on ${LOOPBACK} but not on "${host}" — this machine cannot connect to its own public IP, which is normal and does not affect players. Palbox falls back to ${LOOPBACK} automatically, so everything works; set the RCON host to ${LOOPBACK} to make it direct.`;
  } else if (rcon.ok) {
    summary = 'RCON is working but the REST API is not — player positions and world map data will be unavailable.';
  } else if (rest.ok) {
    summary = 'The REST API is working but RCON is not — some console commands may be unavailable.';
  } else {
    summary = 'Neither RCON nor the REST API could connect. Check your server settings and firewall.';
  }

  res.json({ rcon, rest, summary } satisfies DiagnosticsResponse);
});

export default router;
