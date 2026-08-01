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
  detail?:    string;
}

export interface DiagnosticsResponse {
  rcon:    DiagResult & { authenticated?: boolean };
  rest:    DiagResult & { serverName?: string; version?: string };
  summary: string;
}

/** POST /instances/:id/server/diagnostics — live connection test */
router.post('/', requirePermission('server.view'), async (req, res) => {
  const inst = req.instance!;

  // ── RCON test ──────────────────────────────────────────────────────────────
  const rconResult: DiagnosticsResponse['rcon'] = {
    ok: false, latencyMs: null, error: null, authenticated: false,
  };

  if (!inst.rcon_host || !inst.rcon_port || !inst.rcon_password) {
    rconResult.error = 'RCON not configured (host, port, or password missing in instance settings)';
  } else {
    const t0 = Date.now();
    const client = new RconClient(inst.rcon_host, inst.rcon_port, inst.rcon_password);
    try {
      await client.connect();
      rconResult.authenticated = true;
      // Send a harmless command to confirm the connection is live
      await client.send('Info');
      rconResult.ok = true;
      rconResult.latencyMs = Date.now() - t0;
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      rconResult.latencyMs = Date.now() - t0;

      // Make errors actionable
      if (msg.includes('ECONNREFUSED'))
        rconResult.error = `Connection refused on ${inst.rcon_host}:${inst.rcon_port} — is the server running and RCONEnabled=true in PalWorldSettings.ini?`;
      else if (msg.includes('ETIMEDOUT') || msg.includes('timed out'))
        rconResult.error = `Timed out connecting to ${inst.rcon_host}:${inst.rcon_port} — check your firewall and that RCON port ${inst.rcon_port} is open.`;
      else if (msg.includes('authentication') || msg.includes('auth'))
        rconResult.error = `Authentication failed — verify the RCON password matches AdminPassword in PalWorldSettings.ini.`;
      else if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo'))
        rconResult.error = `Cannot resolve host "${inst.rcon_host}" — check the RCON host setting.`;
      else
        rconResult.error = msg;
    } finally {
      client.disconnect();
    }
  }

  // ── REST API test ──────────────────────────────────────────────────────────
  const restResult: DiagnosticsResponse['rest'] = {
    ok: false, latencyMs: null, error: null,
  };

  const restPort = (inst as unknown as Record<string, unknown>).rest_api_port as number | undefined ?? 8212;

  if (!inst.rcon_password) {
    restResult.error = 'REST API password not configured (uses AdminPassword / RCON password).';
  } else {
    const t0 = Date.now();
    try {
      const info = await restGetInfo(inst.rcon_host, restPort, inst.rcon_password);
      restResult.ok         = true;
      restResult.latencyMs  = Date.now() - t0;
      restResult.serverName = info.servername;
      restResult.version    = info.version;
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      restResult.latencyMs = Date.now() - t0;

      if (msg.includes('ECONNREFUSED'))
        restResult.error = `Connection refused on ${inst.rcon_host}:${restPort} — is RESTAPIEnabled=True and RESTAPIPort=${restPort} in PalWorldSettings.ini?`;
      else if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('403'))
        restResult.error = `Authentication failed — verify the Admin Password matches AdminPassword in PalWorldSettings.ini.`;
      else if (msg.includes('ETIMEDOUT') || msg.includes('timed out') || msg.includes('abort'))
        restResult.error = `Timed out on ${inst.rcon_host}:${restPort} — check your firewall and that REST API port ${restPort} is open.`;
      else if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo'))
        restResult.error = `Cannot resolve host "${inst.rcon_host}".`;
      else
        restResult.error = msg;
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  let summary: string;
  if (rconResult.ok && restResult.ok)
    summary = 'Both RCON and REST API are connected and working.';
  else if (rconResult.ok && !restResult.ok)
    summary = 'RCON is working but REST API is not — player position data and some commands will be unavailable.';
  else if (!rconResult.ok && restResult.ok)
    summary = 'REST API is working but RCON is not — some commands and chat logging may be unavailable.';
  else
    summary = 'Neither RCON nor REST API could connect. Check your server settings and firewall.';

  res.json({ rcon: rconResult, rest: restResult, summary } satisfies DiagnosticsResponse);
});

export default router;
