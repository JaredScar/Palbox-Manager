/**
 * Browsing the Pals in a world, and spawning new ones.
 *
 * Browsing is served from the cached save scan. Spawning is not something
 * vanilla Palworld can do at all - neither RCON nor the REST API has a command
 * for it - so it goes through the PalDefender mod when that is installed, and
 * the capability endpoint exists so the UI can say so plainly instead of
 * offering a button that silently does nothing.
 */
import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { resolveInstance } from '../middleware/instance.js';
import { getDb } from '../db/index.js';
import { logAction } from '../services/audit.js';
import { instRconRaw, instPlayers } from '../services/connection.js';
import { PALDEX, palName } from '../lib/paldex.js';
import type { Instance } from '../db/types.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, resolveInstance);

interface PalRow {
  instance_uid: string;
  character_id: string;
  nickname: string | null;
  level: number;
  gender: string | null;
  lucky: number;
  boss: number;
  rank: number;
  talent_hp: number;
  talent_melee: number;
  talent_shot: number;
  talent_defense: number;
  soul_hp: number;
  soul_attack: number;
  soul_defence: number;
  soul_craftspeed: number;
  passives: string;
  owner_player_id: string | null;
}

const MAX_PAGE = 500;

router.get('/', requirePermission('pals.view'), (req, res) => {
  const db = getDb();
  const id = req.instance!.id;

  const rows = db
    .prepare('SELECT * FROM pals WHERE instance_id = ? ORDER BY level DESC, character_id ASC')
    .all(id) as PalRow[];

  const owners = db
    .prepare('SELECT player_id, name, level FROM save_players WHERE instance_id = ?')
    .all(id) as { player_id: string; name: string; level: number }[];

  const pals = rows.map((p) => ({
    uid: p.instance_uid,
    characterId: p.character_id,
    name: palName(p.character_id),
    nickname: p.nickname,
    level: p.level,
    gender: p.gender,
    lucky: !!p.lucky,
    boss: !!p.boss,
    rank: p.rank,
    ivs: {
      hp: p.talent_hp, melee: p.talent_melee,
      shot: p.talent_shot, defense: p.talent_defense,
    },
    souls: {
      hp: p.soul_hp, attack: p.soul_attack,
      defence: p.soul_defence, craftSpeed: p.soul_craftspeed,
    },
    passives: JSON.parse(p.passives) as string[],
    ownerPlayerId: p.owner_player_id,
  }));

  res.json({
    pals,
    owners: owners.map((o) => ({ playerId: o.player_id, name: o.name, level: o.level })),
  });
});

/** The reference table the UI renders names, elements and icons from. */
router.get('/dex', requirePermission('pals.view'), (_req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.json(PALDEX);
});

/**
 * Asks PalDefender which commands it exposes. A plain RCON error means the mod
 * is not there, which is not a failure worth surfacing as one.
 */
async function probeSpawnSupport(inst: Instance): Promise<{ available: boolean; commands: string[]; detail: string }> {
  let raw: string;
  try {
    raw = await instRconRaw(inst, 'getrconcmds', 8000);
  } catch (e) {
    return {
      available: false,
      commands: [],
      detail: `Could not reach the server over RCON: ${(e as Error).message}`,
    };
  }

  // PalDefender answers with its command list; vanilla answers with an
  // "unknown command" style string, or echoes nothing useful.
  const commands = [...raw.matchAll(/[a-z_]{3,}/gi)].map((m) => m[0].toLowerCase());
  const canGive = commands.includes('givepal');
  const canSpawn = commands.includes('spawnpal');

  if (!canGive && !canSpawn) {
    return {
      available: false,
      commands: [],
      detail: 'PalDefender was not detected. Vanilla Palworld has no command for '
        + 'spawning Pals, so this needs the PalDefender mod installed on the server.',
    };
  }

  return {
    available: true,
    commands: [canGive && 'givepal', canSpawn && 'spawnpal'].filter(Boolean) as string[],
    detail: 'PalDefender detected.',
  };
}

router.get('/spawn-capability', requirePermission('pals.view'), async (req, res) => {
  res.json(await probeSpawnSupport(req.instance!));
});

interface SpawnBody {
  characterId?: string;
  level?: number;
  /** Give straight to a player, by their in-game user id. */
  playerUid?: string;
  /** Or drop into the world at in-game map coordinates. */
  x?: number;
  y?: number;
}

router.post('/spawn', requirePermission('pals.spawn'), async (req, res) => {
  const inst = req.instance!;
  const { characterId, level = 1, playerUid, x, y } = req.body as SpawnBody;

  if (!characterId || !PALDEX[characterId]) {
    res.status(400).json({ error: 'Unknown Pal. Pick one from the list.' });
    return;
  }
  if (!Number.isInteger(level) || level < 1 || level > 255) {
    res.status(400).json({ error: 'Level must be a whole number between 1 and 255.' });
    return;
  }

  const capability = await probeSpawnSupport(inst);
  if (!capability.available) {
    res.status(409).json({ error: capability.detail });
    return;
  }

  const toPlayer = typeof playerUid === 'string' && playerUid.length > 0;
  if (!toPlayer && (typeof x !== 'number' || typeof y !== 'number')) {
    res.status(400).json({ error: 'Choose a player to give the Pal to, or a point on the map.' });
    return;
  }

  const label = `${palName(characterId)} (Lv ${level})`;
  const command = toPlayer
    ? `givepal ${playerUid} ${characterId} ${level}`
    // PalDefender takes the in-game map coordinates the player sees, not raw
    // world units, and requires all three even though Z is ignored on land.
    : `spawnpal ${characterId} ${Math.round(x as number)} ${Math.round(y as number)} 0 ${level}`;

  try {
    const result = await instRconRaw(inst, command, 10_000);
    logAction(inst.id, 'pal.spawn', toPlayer
      ? `${label} to player ${playerUid}`
      : `${label} at ${Math.round(x as number)}, ${Math.round(y as number)}`);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/** Online players, so the give-to-player picker has something to choose from. */
router.get('/targets', requirePermission('pals.view'), async (req, res) => {
  try {
    const players = await instPlayers(req.instance!);
    res.json(players.map((p) => ({ name: p.name, playerUid: p.playerUid, level: p.level })));
  } catch {
    res.json([]);
  }
});

export default router;
