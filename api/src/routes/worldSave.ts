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
import { palName, palEntry } from '../lib/paldex.js';

interface WorkerRow {
  instance_uid: string;
  character_id: string;
  nickname: string | null;
  level: number;
  gender: string | null;
  lucky: number;
  boss: number;
  rank: number;
  soul_craftspeed: number;
  sanity: number;
  sick: number;
  owner_player_id: string | null;
}

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
  worker_container_id: string | null;
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
      hasWorkers: b.worker_container_id !== null,
    }));

  res.json({ guilds, bases, scan: getScanStatus(id) });
});

/**
 * One base camp, with the Pals working it.
 *
 * A Pal carries no reference to the camp it works at; the link runs the other
 * way, from the camp's worker container to whatever sits in it.
 */
router.get('/bases/:baseId', requirePermission('world.view'), (req, res) => {
  const db = getDb();
  const id = req.instance!.id;

  const base = db
    .prepare('SELECT * FROM base_camps WHERE instance_id = ? AND base_id = ?')
    .get(id, req.params.baseId) as BaseRow | undefined;
  if (!base) { res.status(404).json({ error: 'Base camp not found' }); return; }

  const guild = base.guild_id
    ? db.prepare('SELECT group_id, name, base_camp_level, members FROM guilds WHERE instance_id = ? AND group_id = ?')
      .get(id, base.guild_id) as { group_id: string; name: string; base_camp_level: number; members: string } | undefined
    : undefined;

  const workers = base.worker_container_id
    ? (db.prepare(
      `SELECT instance_uid, character_id, nickname, level, gender, lucky, boss, rank,
              soul_craftspeed, sanity, sick, owner_player_id
       FROM pals WHERE instance_id = ? AND container_id = ?
       ORDER BY level DESC`,
    ).all(id, base.worker_container_id) as WorkerRow[])
    : [];

  res.json({
    baseId: base.base_id,
    x: base.x, y: base.y, z: base.z,
    areaRange: base.area_range,
    state: base.state,
    /** Null when the save had no worker container, which is not the same as an empty base. */
    workersKnown: base.worker_container_id !== null,
    guild: guild
      ? {
        groupId: guild.group_id,
        name: guild.name,
        baseCampLevel: guild.base_camp_level,
        members: JSON.parse(guild.members) as { playerId: string; name: string; lastOnline: number | null }[],
      }
      : null,
    workers: workers.map((w) => ({
      uid: w.instance_uid,
      characterId: w.character_id,
      name: palName(w.character_id),
      nickname: w.nickname,
      level: w.level,
      gender: w.gender,
      lucky: !!w.lucky,
      boss: !!w.boss,
      rank: w.rank,
      workSpeedBonus: w.soul_craftspeed,
      sanity: w.sanity,
      sick: !!w.sick,
      // Species work suitabilities, so the client can total up coverage.
      work: palEntry(w.character_id)?.work ?? {},
    })),
  });
});

/** Forces a re-read, for when someone does not want to wait for the next scan. */
router.post('/scan', requirePermission('world.view'), async (req, res) => {
  const status = await scanWorldSave(req.instance!, true);
  res.json(status);
});

export default router;
