/**
 * Extracts guilds and base camps from a Palworld `Level.sav`.
 *
 * Level.sav is a zlib-compressed GVAS archive, and most of its bulk is
 * character data we have no use for. Rather than walking the whole property
 * tree, we locate the two properties we want by their on-disk byte signature
 * and parse only those, which keeps a multi-hundred-megabyte world cheap to
 * read.
 *
 * The guild and base camp layouts are ports of the community
 * palworld-save-tools rawdata decoders.
 */
import zlib from 'zlib';
import { promisify } from 'util';
import { SavReader, findProperty, NULL_GUID } from './reader.js';
import type { Guid, MapEntry, PropValue } from './reader.js';

const inflate = promisify(zlib.inflate);

export interface GuildMember {
  playerId: Guid;
  name: string;
  lastOnline: number | null;
}

export interface Guild {
  groupId: Guid;
  name: string;
  baseCampLevel: number;
  adminPlayerId: Guid | null;
  members: GuildMember[];
  baseIds: Guid[];
}

export interface BaseCamp {
  id: Guid;
  guildId: Guid | null;
  /** Unreal world coordinates, the same space the REST API reports players in. */
  x: number;
  y: number;
  z: number;
  /** Radius of the camp's build area, in world units. */
  areaRange: number;
  state: number;
}

export interface LevelSaveData {
  guilds: Guild[];
  bases: BaseCamp[];
}

const MAGIC = 'PlZ';

/** Comfortably above any real world, well below anything that would OOM us. */
const MAX_INFLATED_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * Strips Palworld's compression header and inflates the GVAS payload.
 *
 * Inflation runs on libuv's thread pool rather than synchronously, so parsing
 * a large world does not stall the API for the seconds it takes.
 */
export async function decompressSav(data: Buffer): Promise<Buffer> {
  let start = 12;
  let magic = data.subarray(8, 11).toString('latin1');
  let saveType = data[11];

  // Chunked saves carry a second header immediately after the first.
  if (data.subarray(8, 11).toString('latin1') === 'CNK') {
    magic = data.subarray(20, 23).toString('latin1');
    saveType = data[23];
    start = 24;
  }

  if (magic !== MAGIC) {
    throw new Error(`Not a Palworld save: expected "${MAGIC}" magic, found "${magic}"`);
  }
  if (saveType !== 0x31 && saveType !== 0x32) {
    throw new Error(`Unsupported save compression type: 0x${saveType.toString(16)}`);
  }

  // Bounded so a corrupt or hostile header cannot expand into an allocation
  // large enough to take the panel down.
  const opts = { maxOutputLength: MAX_INFLATED_BYTES };
  let out = (await inflate(data.subarray(start), opts)) as Buffer;
  if (saveType === 0x32) out = (await inflate(out, opts)) as Buffer;
  return out;
}

/** Reads a MapProperty's entries starting just past its name and type tags. */
function readMapAt(gvas: Buffer, offset: number): MapEntry[] {
  const r = new SavReader(gvas, offset);
  const size = r.u64();
  const prop = r.property('MapProperty', size);
  return prop.value as MapEntry[];
}

const asProps = (v: unknown) => (v ?? {}) as Record<string, PropValue>;

/**
 * Guild fields live in an opaque RawData byte array rather than as properties,
 * so the bytes are decoded positionally. The layout varies by group type, and
 * only real guilds carry names and member lists.
 */
function decodeGuildRawData(raw: Buffer, groupType: string): Guild | null {
  const isGuild = groupType === 'EPalGroupType::Guild' || groupType === 'EPalGroupType::IndependentGuild';
  const hasBases = isGuild || groupType === 'EPalGroupType::Organization';
  if (!hasBases) return null;

  const r = new SavReader(raw);
  const groupId = r.guid();
  const groupName = r.fstring();
  r.tarray((rr) => { rr.skip(32); return null; });   // character handle ids

  r.u8();                                            // org type
  const baseIds = r.tarray((rr) => rr.guid());
  if (!isGuild) {
    return { groupId, name: groupName, baseCampLevel: 0, adminPlayerId: null, members: [], baseIds };
  }

  const baseCampLevel = r.i32();
  r.tarray((rr) => rr.guid());                       // base camp point instance ids
  const guildName = r.fstring();

  const members: GuildMember[] = [];
  let adminPlayerId: Guid | null = null;

  if (groupType === 'EPalGroupType::IndependentGuild') {
    const playerId = r.guid();
    r.fstring();                                     // name repeated
    const lastOnline = r.i64();
    const name = r.fstring();
    adminPlayerId = playerId;
    members.push({ playerId, name, lastOnline });
  } else {
    adminPlayerId = r.guid();
    const count = r.i32();
    for (let i = 0; i < count; i++) {
      const playerId = r.guid();
      const lastOnline = r.i64();
      const name = r.fstring();
      members.push({ playerId, name, lastOnline });
    }
  }

  return {
    groupId,
    name: guildName || groupName,
    baseCampLevel,
    adminPlayerId: adminPlayerId === NULL_GUID ? null : adminPlayerId,
    members,
    baseIds,
  };
}

/** Base camp fields are likewise packed positionally into RawData. */
function decodeBaseCampRawData(raw: Buffer): BaseCamp {
  const r = new SavReader(raw);
  const id = r.guid();
  r.fstring();                                       // name, always empty in practice
  const state = r.u8();
  const { translation } = r.ftransform();
  const areaRange = r.f32();
  const guildId = r.guid();
  return {
    id,
    guildId: guildId === NULL_GUID ? null : guildId,
    x: translation.x,
    y: translation.y,
    z: translation.z,
    areaRange,
    state,
  };
}

function parseGuilds(gvas: Buffer): Guild[] {
  const at = findProperty(gvas, 'GroupSaveDataMap', 'MapProperty');
  if (at === null) return [];

  const guilds: Guild[] = [];
  for (const entry of readMapAt(gvas, at)) {
    const props = asProps(entry.value);
    const groupType = props.GroupType?.value;
    const raw = props.RawData?.value;
    if (typeof groupType !== 'string' || !Buffer.isBuffer(raw)) continue;
    try {
      const guild = decodeGuildRawData(raw, groupType);
      if (guild) guilds.push(guild);
    } catch {
      // One malformed group should not cost us the rest of them.
    }
  }
  return guilds;
}

function parseBaseCamps(gvas: Buffer): BaseCamp[] {
  const at = findProperty(gvas, 'BaseCampSaveData', 'MapProperty');
  if (at === null) return [];

  const bases: BaseCamp[] = [];
  for (const entry of readMapAt(gvas, at)) {
    const raw = asProps(entry.value).RawData?.value;
    if (!Buffer.isBuffer(raw)) continue;
    try {
      bases.push(decodeBaseCampRawData(raw));
    } catch {
      // Same tolerance as guilds: skip the bad one, keep the good ones.
    }
  }
  return bases;
}

/** Decompresses and extracts everything the map view needs from a Level.sav. */
export async function parseLevelSave(data: Buffer): Promise<LevelSaveData> {
  const gvas = await decompressSav(data);
  return { guilds: parseGuilds(gvas), bases: parseBaseCamps(gvas) };
}

export { parseGuilds, parseBaseCamps };
