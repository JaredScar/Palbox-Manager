/**
 * Extracts players and their Pals from a decompressed Level.sav.
 *
 * Pal records live in `CharacterSaveParameterMap`, one entry per creature in
 * the world - captured, working a base, or still wild. Each entry's fields are
 * a property block inside an opaque RawData byte array, the same shape the
 * guild data uses.
 */
import { SavReader, findProperty, NULL_GUID } from './reader.js';
import type { PropValue, MapEntry } from './reader.js';

export interface PalRecord {
  instanceId: string;
  /** Internal id as the save spells it, e.g. "SheepBall" or "BOSS_Anubis". */
  characterId: string;
  nickname: string | null;
  level: number;
  exp: number;
  gender: 'Male' | 'Female' | null;
  /** "Lucky" Pals, the shiny equivalent. */
  lucky: boolean;
  /** Alpha / field boss, derived from the id prefix. */
  boss: boolean;
  /** Condensation rank, 1 to 5. */
  rank: number;
  /** Individual values, each 0-100. */
  talentHp: number;
  talentMelee: number;
  talentShot: number;
  talentDefense: number;
  /** Soul upgrade levels. */
  soulHp: number;
  soulAttack: number;
  soulDefence: number;
  soulCraftSpeed: number;
  passives: string[];
  ownerPlayerId: string | null;
}

export interface PlayerRecord {
  playerId: string;
  name: string;
  level: number;
  exp: number;
}

export interface CharacterData {
  pals: PalRecord[];
  players: PlayerRecord[];
}

/** A world with more entries than this is not one we should try to hold. */
const MAX_CHARACTERS = 500_000;

const num = (p?: PropValue): number => (typeof p?.value === 'number' ? p.value : 0);
const text = (p?: PropValue): string => (typeof p?.value === 'string' ? p.value : '');
const flag = (p?: PropValue): boolean => p?.value === true;

/** Struct properties holding a bare GUID come back as the string itself. */
function guidOf(p?: PropValue): string | null {
  const v = p?.value;
  if (typeof v !== 'string' || v === NULL_GUID) return null;
  return v;
}

function stringList(p?: PropValue): string[] {
  return Array.isArray(p?.value) ? (p.value as unknown[]).filter((v): v is string => typeof v === 'string') : [];
}

/** "EPalGenderType::Male" -> "Male". */
function genderOf(p?: PropValue): 'Male' | 'Female' | null {
  const v = text(p);
  if (v.endsWith('Male')) return 'Male';
  if (v.endsWith('Female')) return 'Female';
  return null;
}

const asProps = (v: unknown): Record<string, PropValue> => (v ?? {}) as Record<string, PropValue>;

/**
 * The character map's keys are a struct rather than a plain GUID, carrying both
 * the owning player and the creature's own instance id.
 */
function keyIds(entry: MapEntry): { playerId: string | null; instanceId: string | null } {
  const k = asProps(entry.key);
  return { playerId: guidOf(k.PlayerUId), instanceId: guidOf(k.InstanceId) };
}

/**
 * Reads one creature. Palworld 1.0 appended fields to this struct, which is
 * harmless here: the property block ends at its own None sentinel and anything
 * after it is ignored rather than treated as a parse failure.
 */
function decodeCharacter(raw: Buffer): Record<string, PropValue> | null {
  const props = new SavReader(raw).propertiesUntilNone();
  const save = props.SaveParameter;
  if (!save || save.type !== 'StructProperty') return null;
  return asProps(save.value);
}

export function parseCharacters(gvas: Buffer): CharacterData {
  const at = findProperty(gvas, 'CharacterSaveParameterMap', 'MapProperty');
  if (at === null) return { pals: [], players: [] };

  const r = new SavReader(gvas, at);
  const size = r.u64();
  const prop = r.property('MapProperty', size, { keyStruct: 'CharacterKey' });
  const entries = prop.value as MapEntry[];
  if (entries.length > MAX_CHARACTERS) {
    throw new Error(`Character map is implausibly large (${entries.length} entries)`);
  }

  const pals: PalRecord[] = [];
  const players: PlayerRecord[] = [];

  for (const entry of entries) {
    const rawData = asProps(entry.value).RawData?.value;
    if (!Buffer.isBuffer(rawData)) continue;

    let p: Record<string, PropValue> | null = null;
    try {
      p = decodeCharacter(rawData);
    } catch {
      // One unreadable creature should not cost us the rest of the world.
      continue;
    }
    if (!p) continue;

    const { playerId, instanceId } = keyIds(entry);

    if (flag(p.IsPlayer)) {
      if (playerId) {
        players.push({
          playerId,
          name: text(p.NickName) || '?',
          level: num(p.Level) || 1,
          exp: num(p.Exp),
        });
      }
      continue;
    }

    const characterId = text(p.CharacterID);
    if (!characterId || !instanceId) continue;

    pals.push({
      instanceId,
      characterId,
      nickname: text(p.NickName) || null,
      level: num(p.Level) || 1,
      exp: num(p.Exp),
      gender: genderOf(p.Gender),
      lucky: flag(p.IsRarePal),
      boss: /^boss_/i.test(characterId),
      rank: num(p.Rank) || 1,
      talentHp: num(p.Talent_HP),
      talentMelee: num(p.Talent_Melee),
      talentShot: num(p.Talent_Shot),
      talentDefense: num(p.Talent_Defense),
      soulHp: num(p.Rank_HP),
      soulAttack: num(p.Rank_Attack),
      soulDefence: num(p.Rank_Defence),
      soulCraftSpeed: num(p.Rank_CraftSpeed),
      passives: stringList(p.PassiveSkillList),
      // A Pal working a base has no current owner but remembers its captor, so
      // falling back keeps base Pals attributed to the player who caught them.
      ownerPlayerId: guidOf(p.OwnerPlayerUId) ?? lastOldOwner(p.OldOwnerPlayerUIds),
    });
  }

  return { pals, players };
}

function lastOldOwner(p?: PropValue): string | null {
  const list = Array.isArray(p?.value) ? (p.value as unknown[]) : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const v = list[i];
    if (typeof v === 'string' && v !== NULL_GUID) return v;
  }
  return null;
}
