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
import type { Guid, MapEntry, PropValue, Vector } from './reader.js';

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

/** Comfortably above any real world, well below anything that would OOM us. */
const MAX_INFLATED_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * Palworld 1.0 switched its save container from zlib to Oodle/Kraken. Oodle
 * itself is proprietary, but the open source `ooz` reimplementation decodes it,
 * and `ooz-wasm` packages that as WebAssembly, so there is no native build step
 * and no platform-specific binary to ship.
 */
const OOZ_MODULE = 'ooz-wasm';

/**
 * A real dynamic import even though this file compiles to CommonJS. TypeScript
 * would otherwise rewrite `import()` into `require()`, which cannot load
 * ooz-wasm at all: it is pure ESM and initialises its WebAssembly with a
 * top-level await, so require throws ERR_REQUIRE_ASYNC_MODULE.
 */
const importModule = new Function('s', 'return import(s)') as (s: string) => Promise<unknown>;

export const OODLE_MISSING_MESSAGE =
  'This world uses Palworld 1.0 Oodle compression, but the "ooz-wasm" decoder ' +
  'could not be loaded. It ships with Palbox, so this usually means an ' +
  'incomplete install - reinstall or re-run the updater, then rescan.';

interface OozModule { decompress(data: Uint8Array, rawSize: number): Uint8Array }

let oozModule: Promise<OozModule> | null = null;

async function loadOoz(): Promise<OozModule> {
  if (!oozModule) {
    oozModule = importModule(OOZ_MODULE)
      .then((m) => {
        const mod = (m as { default?: OozModule }).default ?? (m as OozModule);
        if (typeof mod?.decompress !== 'function') throw new Error('no decompress export');
        return mod;
      })
      .catch(() => {
        oozModule = null;               // let a later install be picked up
        throw new Error(OODLE_MISSING_MESSAGE);
      });
  }
  return oozModule;
}

interface SavHeader {
  magic: string;
  saveType: number;
  /** Offset of the compressed payload. */
  start: number;
  /** Size the payload inflates to, which Oodle needs up front. */
  uncompressedLen: number;
}

function readHeader(data: Buffer): SavHeader {
  if (data.length < 24) throw new Error('File is too short to be a Palworld save');

  let uncompressedLen = data.readUInt32LE(0);
  let magic = data.subarray(8, 11).toString('latin1');
  let saveType = data[11];
  let start = 12;

  // Xbox writes a chunked container with a second header inside the first.
  if (magic === 'CNK') {
    uncompressedLen = data.readUInt32LE(12);
    magic = data.subarray(20, 23).toString('latin1');
    saveType = data[23];
    start = 24;
  }

  return { magic, saveType, start, uncompressedLen };
}

/**
 * Strips Palworld's compression header and inflates the GVAS payload.
 *
 * Inflation runs on libuv's thread pool rather than synchronously, so parsing
 * a large world does not stall the API for the seconds it takes.
 */
export async function decompressSav(data: Buffer): Promise<Buffer> {
  const { magic, saveType, start, uncompressedLen } = readHeader(data);
  const payload = data.subarray(start);

  if (magic === 'PlZ') {
    if (saveType !== 0x31 && saveType !== 0x32) {
      throw new Error(`Unsupported zlib save type: 0x${saveType.toString(16)}`);
    }
    // Bounded so a corrupt or hostile header cannot expand into an allocation
    // large enough to take the panel down.
    const opts = { maxOutputLength: MAX_INFLATED_BYTES };
    let out = (await inflate(payload, opts)) as Buffer;
    if (saveType === 0x32) out = (await inflate(out, opts)) as Buffer;
    return out;
  }

  if (magic === 'PlM') {
    if (uncompressedLen <= 0 || uncompressedLen > MAX_INFLATED_BYTES) {
      throw new Error(`Save header declares an implausible size of ${uncompressedLen} bytes`);
    }
    const ooz = await loadOoz();
    const out = ooz.decompress(new Uint8Array(payload), uncompressedLen);
    if (out.length !== uncompressedLen) {
      throw new Error(`Oodle produced ${out.length} bytes, header expected ${uncompressedLen}`);
    }
    // Copied out because the module hands back a view into WASM memory that
    // the next call would overwrite.
    return Buffer.from(out);
  }

  throw new Error(
    `Not a Palworld save: expected "PlZ" or "PlM" magic, found "${magic}"`,
  );
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
 * Palworld 1.0 inserted two 4-byte fields into the guild struct, one before
 * the base id list and one before the base camp level. Reading a 1.0 save with
 * the older layout desynchronises everything after the first insertion, so
 * both are supported and the file is measured against each.
 */
type GuildLayout = 'legacy' | 'v1';

const MAX_ARRAY_ITEMS = 100_000;
const MAX_MEMBERS = 10_000;

/**
 * Reads an array length, rejecting anything the remaining bytes could not
 * possibly hold. This is what makes a wrong layout fail loudly instead of
 * quietly producing nonsense.
 */
function readCount(r: SavReader, itemSize: number): number {
  const n = r.u32();
  if (n > MAX_ARRAY_ITEMS || n * itemSize > r.remaining) {
    throw new Error(`Implausible array length ${n}`);
  }
  return n;
}

interface GuildDecode { guild: Guild | null; leftover: number }

/**
 * Guild fields live in an opaque RawData byte array rather than as properties,
 * so the bytes are decoded positionally. The layout varies by group type, and
 * only real guilds carry names and member lists.
 */
function decodeGuildRawData(raw: Buffer, groupType: string, layout: GuildLayout): GuildDecode {
  const isGuild = groupType === 'EPalGroupType::Guild' || groupType === 'EPalGroupType::IndependentGuild';
  const hasBases = isGuild || groupType === 'EPalGroupType::Organization';
  if (!hasBases) return { guild: null, leftover: 0 };

  const r = new SavReader(raw);
  const groupId = r.guid();
  const groupName = r.fstring();
  r.skip(readCount(r, 32) * 32);                     // character handle ids

  r.u8();                                            // org type
  if (layout === 'v1') r.skip(4);
  const baseCount = readCount(r, 16);
  const baseIds: Guid[] = [];
  for (let i = 0; i < baseCount; i++) baseIds.push(r.guid());

  if (!isGuild) {
    return {
      guild: { groupId, name: groupName, baseCampLevel: 0, adminPlayerId: null, members: [], baseIds },
      leftover: r.remaining,
    };
  }

  if (layout === 'v1') r.skip(4);
  const baseCampLevel = r.i32();
  r.skip(readCount(r, 16) * 16);                     // base camp point instance ids
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
    if (count < 0 || count > MAX_MEMBERS) throw new Error(`Implausible member count ${count}`);
    for (let i = 0; i < count; i++) {
      const playerId = r.guid();
      const lastOnline = r.i64();
      const name = r.fstring();
      members.push({ playerId, name, lastOnline });
    }
  }

  return {
    guild: {
      groupId,
      name: guildName || groupName,
      baseCampLevel,
      adminPlayerId: adminPlayerId === NULL_GUID ? null : adminPlayerId,
      members,
      baseIds,
    },
    leftover: r.remaining,
  };
}

/**
 * Picks the layout that reads the file best: most groups decoded, and of those
 * the one leaving fewest bytes unaccounted for. Detecting rather than assuming
 * means a save from either era works without configuration.
 */
function detectGuildLayout(entries: { raw: Buffer; groupType: string }[]): GuildLayout {
  let best: { layout: GuildLayout; ok: number; leftover: number } | null = null;

  for (const layout of ['v1', 'legacy'] as const) {
    let ok = 0;
    let leftover = 0;
    for (const e of entries) {
      try {
        const d = decodeGuildRawData(e.raw, e.groupType, layout);
        if (d.guild) { ok++; leftover += d.leftover; }
      } catch { /* this layout cannot read this group */ }
    }
    if (!best || ok > best.ok || (ok === best.ok && leftover < best.leftover)) {
      best = { layout, ok, leftover };
    }
  }

  return best?.layout ?? 'v1';
}

/** Nothing in Palpagos is anywhere near this far from the origin. */
const WORLD_LIMIT = 5_000_000;
const MAX_AREA_RANGE = 100_000;

/**
 * An FTransform is a quaternion, a translation and a scale. Base camps are
 * always unscaled, so a scale of exactly (1,1,1) followed by a translation
 * inside the world is a signature precise enough to find the transform by,
 * which is what lets this survive a patch inserting fields ahead of it.
 */
function transformAt(raw: Buffer, off: number): Vector | null {
  if (off + 80 > raw.length) return null;
  const isOne = (v: number) => Math.abs(v - 1) < 1e-6;
  if (!isOne(raw.readDoubleLE(off + 56)) ||
      !isOne(raw.readDoubleLE(off + 64)) ||
      !isOne(raw.readDoubleLE(off + 72))) return null;

  const x = raw.readDoubleLE(off + 32);
  const y = raw.readDoubleLE(off + 40);
  const z = raw.readDoubleLE(off + 48);
  if (![x, y, z].every((v) => Number.isFinite(v) && Math.abs(v) < WORLD_LIMIT)) return null;
  return { x, y, z };
}

/** Reads the area radius and owning guild that follow a transform. */
function tailAt(raw: Buffer, off: number): { areaRange: number; guildId: Guid | null } | null {
  const r = new SavReader(raw, off + 80);
  if (r.remaining < 4 + 16) return null;
  const areaRange = r.f32();
  if (!Number.isFinite(areaRange) || areaRange <= 0 || areaRange > MAX_AREA_RANGE) return null;
  const guildId = r.guid();
  return { areaRange, guildId: guildId === NULL_GUID ? null : guildId };
}

/**
 * Base camp fields are likewise packed positionally into RawData. The expected
 * offset is tried first; if the layout has moved, the transform is located by
 * its signature rather than giving up, since a camp in the wrong place would
 * be worse than none at all.
 */
function decodeBaseCampRawData(raw: Buffer): BaseCamp | null {
  const id = raw.length >= 16 ? new SavReader(raw).guid() : null;
  if (!id) return null;

  let expected = -1;
  let state = 0;
  try {
    const r = new SavReader(raw);
    r.guid();
    r.fstring();                                     // name, always empty in practice
    state = r.u8();
    expected = r.offset;
  } catch { /* fall through to the search */ }

  // The expected offset is only the first candidate; everything else is a
  // fallback scan for when the layout has shifted.
  const candidates = [expected];
  for (let off = 0; off + 80 <= raw.length; off++) {
    if (off !== expected) candidates.push(off);
  }

  for (const off of candidates) {
    if (off < 0) continue;
    const t = transformAt(raw, off);
    if (!t) continue;
    const tail = tailAt(raw, off);
    if (!tail) continue;
    return { id, guildId: tail.guildId, x: t.x, y: t.y, z: t.z, areaRange: tail.areaRange, state };
  }
  return null;
}

function parseGuilds(gvas: Buffer): Guild[] {
  const at = findProperty(gvas, 'GroupSaveDataMap', 'MapProperty');
  if (at === null) return [];

  const entries: { raw: Buffer; groupType: string }[] = [];
  for (const entry of readMapAt(gvas, at)) {
    const props = asProps(entry.value);
    const groupType = props.GroupType?.value;
    const raw = props.RawData?.value;
    if (typeof groupType === 'string' && Buffer.isBuffer(raw)) entries.push({ raw, groupType });
  }

  const layout = detectGuildLayout(entries);
  const guilds: Guild[] = [];
  for (const e of entries) {
    try {
      const { guild } = decodeGuildRawData(e.raw, e.groupType, layout);
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
      const base = decodeBaseCampRawData(raw);
      if (base) bases.push(base);
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
