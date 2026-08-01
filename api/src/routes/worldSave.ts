/**
 * Guilds and base camps read out of the world save.
 *
 * Reads are served from the cached scan rather than touching the save file, so
 * the map can poll these freely.
 */
import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { resolveInstance } from '../middleware/instance.js';
import { getDb } from '../db/index.js';
import { scanWorldSave, getScanStatus } from '../services/worldSave.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, resolveInstance);

interface GuildRow {
  group_id: string;
  name: string;
  base_camp_level: number;
  admin_player_id: string | null;
  members: string;
  member_count: number;
  updated_at: number;
}

interface BaseRow {
  base_id: string;
  guild_id: string | null;
  x: number; y: number; z: number;
  area_range: number;
  state: number;
}

router.get('/', requirePermission('world.view'), (req, res) => {
  const db = getDb();
  const id = req.instance!.id;

  const guilds = (db
    .prepare('SELECT * FROM guilds WHERE instance_id = ? ORDER BY member_count DESC, name ASC')
    .all(id) as GuildRow[])
    .map((g) => ({
      groupId: g.group_id,
      name: g.name,
      baseCampLevel: g.base_camp_level,
      adminPlayerId: g.admin_player_id,
      memberCount: g.member_count,
      members: JSON.parse(g.members) as { playerId: string; name: string; lastOnline: number | null }[],
      updatedAt: g.updated_at,
    }));

  const bases = (db
    .prepare('SELECT * FROM base_camps WHERE instance_id = ?')
    .all(id) as BaseRow[])
    .map((b) => ({
      baseId: b.base_id,
      guildId: b.guild_id,
      x: b.x, y: b.y, z: b.z,
      areaRange: b.area_range,
      state: b.state,
    }));

  res.json({ guilds, bases, scan: getScanStatus(id) });
});

/** Forces a re-read, for when someone does not want to wait for the next scan. */
router.post('/scan', requirePermission('world.view'), async (req, res) => {
  const status = await scanWorldSave(req.instance!, true);
  res.json(status);
});

export default router;
