import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { resolveInstance } from '../middleware/instance.js';
import { RconClient } from '../lib/rcon.js';
import { restGetInfo } from '../services/palrest.js';

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

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0']);
const isLoopback = (h: string) => LOOPBACK_HOSTS.has(h.trim().toLowerCase());
const LOOPBACK = '127.0.0.1';

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

// ── Individual probes ────────────────────────────────────────────────────────

async function probeRcon(host: string, port: number, password: string) {
  const t0 = Date.now();
  const client = new RconClient(host, port, password);
  try {
    await client.connect(5000);
    await client.send('Info');
    return { ok: true, latencyMs: Date.now() - t0, raw: null as string | null };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, raw: describeError(e) };
  } finally {
    client.disconnect();
  }
}

async function probeRest(host: string, port: number, password: string) {
  const t0 = Date.now();
  try {
    const info = await restGetInfo(host, port, password);
    return {
      ok: true, latencyMs: Date.now() - t0, raw: null as string | null,
      serverName: info.servername, version: info.version,
    };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, raw: describeError(e) };
  }
}

// ── Error → actionable message ───────────────────────────────────────────────

function explainRcon(raw: string, host: string, port: number): string {
  if (raw.includes('ECONNREFUSED'))
    return `Connection refused on ${host}:${port} — nothing is listening there. Check RCONEnabled=True and RCONPort=${port} in PalWorldSettings.ini, and restart the server.`;
  if (raw.includes('ETIMEDOUT') || raw.includes('timed out'))
    return `Timed out reaching ${host}:${port} — packets are being dropped, usually by a firewall.`;
  if (raw.includes('authentication'))
    return `Authentication failed — the RCON password does not match AdminPassword in PalWorldSettings.ini (case-sensitive).`;
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

// ── POST /instances/:id/server/diagnostics ───────────────────────────────────

router.post('/', requirePermission('server.view'), async (req, res) => {
  const inst = req.instance!;
  const restPort =
    ((inst as unknown as Record<string, unknown>).rest_api_port as number | undefined) ?? 8212;
  const host = inst.rcon_host;
  const hostIsRemote = host && !isLoopback(host);

  const rcon: DiagResult = { ok: false, latencyMs: null, error: null };
  const rest: DiagnosticsResponse['rest'] = { ok: false, latencyMs: null, error: null };

  // ── RCON ───────────────────────────────────────────────────────────────────
  if (!host || !inst.rcon_port || !inst.rcon_password) {
    rcon.error = 'RCON is not fully configured — host, port, and password are all required.';
  } else {
    const primary = await probeRcon(host, inst.rcon_port, inst.rcon_password);
    rcon.ok = primary.ok;
    rcon.latencyMs = primary.latencyMs;

    if (!primary.ok) {
      rcon.error = explainRcon(primary.raw!, host, inst.rcon_port);

      // The panel usually runs on the same box as the game server. Connecting to
      // the machine's own public IP frequently fails (no NAT hairpin / service
      // bound to a different interface) while loopback works fine.
      if (hostIsRemote) {
        const lb = await probeRcon(LOOPBACK, inst.rcon_port, inst.rcon_password);
        if (lb.ok) {
          rcon.hint = `RCON responded on ${LOOPBACK}:${inst.rcon_port} in ${lb.latencyMs}ms. Palbox is running on the same machine as the server, so change the RCON host from "${host}" to ${LOOPBACK}.`;
        }
      }
    }
  }

  // ── REST API ───────────────────────────────────────────────────────────────
  if (!inst.rcon_password) {
    rest.error = 'REST API password is not configured — it uses the same AdminPassword as RCON.';
  } else {
    const primary = await probeRest(host, restPort, inst.rcon_password);
    rest.ok = primary.ok;
    rest.latencyMs = primary.latencyMs;

    if (primary.ok) {
      rest.serverName = primary.serverName;
      rest.version = primary.version;
    } else {
      rest.error = explainRest(primary.raw!, host, restPort);

      if (hostIsRemote) {
        const lb = await probeRest(LOOPBACK, restPort, inst.rcon_password);
        if (lb.ok) {
          rest.hint = `The REST API responded on ${LOOPBACK}:${restPort} in ${lb.latencyMs}ms. Change the RCON host from "${host}" to ${LOOPBACK} — Palbox is running on the same machine as the server.`;
        }
      }
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  let summary: string;
  if (rcon.ok && rest.ok) {
    summary = 'Both RCON and the REST API are connected and working.';
  } else if (rcon.hint || rest.hint) {
    summary = `Both services are reachable on ${LOOPBACK} but not on "${host}". Change the RCON host to ${LOOPBACK} in this instance's settings.`;
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
