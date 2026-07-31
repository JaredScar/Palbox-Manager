/**
 * Public (unauthenticated) status endpoint.
 * Exposes a safe subset of server info for sharing with community members.
 * GET /api/public/status?instance=1
 */
import { Router } from 'express';
import { getDb } from '../db/index.js';
import type { Instance } from '../db/types.js';
import { getStatus } from '../services/palserver.js';
import { getOnlinePlayers } from '../services/playerTracker.js';
import { readSettings } from '../services/ini.js';

const router = Router();

router.get('/status', async (req, res) => {
  const instanceId = parseInt(String(req.query.instance ?? '1'), 10);
  const inst = getDb()
    .prepare('SELECT * FROM instances WHERE id = ?')
    .get(instanceId) as Instance | undefined;

  if (!inst) {
    res.status(404).json({ error: 'Instance not found' });
    return;
  }

  try {
    const { status, uptime } = await getStatus(inst);
    const players = getOnlinePlayers(inst.id);

    // Read a safe subset of INI settings for the status page
    let serverName = inst.name;
    let maxPlayers = 32;
    try {
      const s = readSettings(inst);
      if (s.ServerName) serverName = s.ServerName;
      if (s.ServerPlayerMaxNum) maxPlayers = parseInt(s.ServerPlayerMaxNum, 10);
    } catch { /* ini not readable */ }

    res.json({
      instanceId: inst.id,
      serverName,
      status,
      uptime,
      playerCount: players.length,
      maxPlayers,
      players: players.map((p) => ({ name: p.name, joinedAt: p.joinedAt })),
      gamePort: inst.game_port,
      publicIp: inst.public_ip || null,
      checkedAt: Date.now(),
    });
  } catch {
    res.status(500).json({ error: 'Status check failed' });
  }
});

/**
 * Embeddable widget — serves a self-contained JavaScript badge.
 * Usage: <script src="http://your-panel:4000/api/public/widget.js?instance=1"></script>
 */
router.get('/widget.js', (req, res) => {
  const instanceId = parseInt(String(req.query.instance ?? '1'), 10);
  // The base URL is the origin of the request
  const origin = `${req.protocol}://${req.get('host')}`;

  const js = `
(function(){
  var root=document.currentScript&&document.currentScript.parentNode||document.body;
  var el=document.createElement('div');
  el.style='display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;font-family:system-ui,sans-serif;font-size:12px;background:#12111a;border:1px solid rgba(255,255,255,0.12);color:#f3effc;';
  root.appendChild(el);
  function update(){
    fetch('${origin}/api/public/status?instance=${instanceId}')
      .then(function(r){return r.json();})
      .then(function(d){
        var online=d.status==='online';
        el.innerHTML='<span style="width:8px;height:8px;border-radius:50%;background:'+(online?'#7ce666':'#ff5d73')+'"></span>'
          +'<strong style="color:#f3effc">'+d.serverName+'</strong>'
          +'<span style="color:#a79fc7">'+d.playerCount+'/'+d.maxPlayers+' online</span>';
        el.title='Last checked: '+new Date().toLocaleTimeString();
      })
      .catch(function(){el.innerHTML='<span style="color:#a79fc7">Status unavailable</span>';});
  }
  update();
  setInterval(update,60000);
})();
`.trim();

  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.send(js);
});

export default router;
