/**
 * Regression test for the Level.sav parser.
 *
 * It builds save files byte by byte using the layout documented by the
 * community palworld-save-tools writers, then checks the parser reads back
 * exactly what was written. Working from a synthetic fixture rather than a
 * real world keeps the test self-contained, and an error in either the reader
 * or the assumed layout shows up as a mismatch rather than as silently
 * plausible numbers on the map.
 */
import zlib from 'zlib';
import { parseLevelSave } from '../dist/lib/palsav/levelSave.js';

class Writer {
  constructor() { this.parts = []; }
  raw(b)   { this.parts.push(Buffer.from(b)); return this; }
  u8(v)    { const b = Buffer.alloc(1); b.writeUInt8(v); return this.raw(b); }
  u32(v)   { const b = Buffer.alloc(4); b.writeUInt32LE(v); return this.raw(b); }
  i32(v)   { const b = Buffer.alloc(4); b.writeInt32LE(v); return this.raw(b); }
  u64(v)   { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return this.raw(b); }
  i64(v)   { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(v)); return this.raw(b); }
  f32(v)   { const b = Buffer.alloc(4); b.writeFloatLE(v); return this.raw(b); }
  f64(v)   { const b = Buffer.alloc(8); b.writeDoubleLE(v); return this.raw(b); }
  fstring(s) {
    if (s === '') return this.i32(0);
    this.i32(s.length + 1);
    return this.raw(Buffer.from(s, 'latin1')).u8(0);
  }
  guid(s) { return this.raw(guidBytes(s)); }
  noGuid() { return this.u8(0); }
  /** Unreal writes a GUID as four little-endian 32-bit groups. */
  tarrayGuid(list) { this.u32(list.length); for (const g of list) this.guid(g); return this; }
  ftransform(x, y, z) {
    this.f64(0).f64(0).f64(0).f64(1);   // rotation
    this.f64(x).f64(y).f64(z);          // translation
    this.f64(1).f64(1).f64(1);          // scale
    return this;
  }
  done() { return Buffer.concat(this.parts); }
}

function guidBytes(s) {
  const hex = s.replace(/-/g, '');
  const b = Buffer.from(hex, 'hex');
  const out = Buffer.alloc(16);
  for (let g = 0; g < 16; g += 4) {
    out[g + 0] = b[g + 3]; out[g + 1] = b[g + 2];
    out[g + 2] = b[g + 1]; out[g + 3] = b[g + 0];
  }
  return out;
}

/** name + type + size + payload, the shape every GVAS property takes. */
function property(name, type, header, payload) {
  return new Writer()
    .fstring(name).fstring(type).u64(payload.length)
    .raw(header).raw(payload)
    .done();
}

function guildRawData(g) {
  const w = new Writer()
    .guid(g.groupId)
    .fstring(g.groupName)
    .u32(0)                       // character handle ids
    .u8(0)                        // org type
    .tarrayGuid(g.baseIds)
    .i32(g.baseCampLevel)
    .tarrayGuid([])               // base camp point instance ids
    .fstring(g.guildName)
    .guid(g.adminPlayerId)
    .i32(g.members.length);
  for (const m of g.members) w.guid(m.playerId).i64(m.lastOnline).fstring(m.name);
  return w.done();
}

function orgRawData(o) {
  return new Writer()
    .guid(o.groupId).fstring(o.groupName).u32(0)
    .u8(1).tarrayGuid(o.baseIds)
    .done();
}

function baseCampRawData(b) {
  return new Writer()
    .guid(b.id).fstring('').u8(b.state)
    .ftransform(b.x, b.y, b.z)
    .f32(b.areaRange)
    .guid(b.guildId)
    .ftransform(0, 0, 0)
    .guid('00000000-0000-0000-0000-000000000000')
    .done();
}

/** A map entry value: a GroupType enum (optional) plus the RawData blob. */
function entryValue(groupType, rawData) {
  const w = new Writer();
  if (groupType) {
    w.raw(property(
      'GroupType', 'EnumProperty',
      new Writer().fstring('EPalGroupType').noGuid().done(),
      new Writer().fstring(groupType).done(),
    ));
  }
  w.raw(property(
    'RawData', 'ArrayProperty',
    new Writer().fstring('ByteProperty').noGuid().done(),
    new Writer().u32(rawData.length).raw(rawData).done(),
  ));
  return w.fstring('None').done();
}

function mapProperty(name, entries) {
  const payload = new Writer();
  payload.u32(0).u32(entries.length);
  for (const e of entries) payload.guid(e.key).raw(e.value);
  return property(
    name, 'MapProperty',
    new Writer().fstring('StructProperty').fstring('StructProperty').noGuid().done(),
    payload.done(),
  );
}

function buildSav(body, saveType = 0x31) {
  let compressed = zlib.deflateSync(body);
  if (saveType === 0x32) compressed = zlib.deflateSync(compressed);
  return Buffer.concat([
    new Writer().u32(body.length).u32(saveType === 0x32 ? zlib.deflateSync(body).length : compressed.length).done(),
    Buffer.from('PlZ', 'latin1'), Buffer.from([saveType]),
    compressed,
  ]);
}

// ── Fixture ──────────────────────────────────────────────────────────────────
const GUILD_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
const ORG_ID   = 'bbbbbbbb-1111-2222-3333-444444444444';
const BASE_A   = 'cccccccc-1111-2222-3333-444444444444';
const BASE_B   = 'dddddddd-1111-2222-3333-444444444444';
const ADMIN    = 'eeeeeeee-1111-2222-3333-444444444444';
const MEMBER   = 'ffffffff-1111-2222-3333-444444444444';

const guild = {
  groupId: GUILD_ID, groupName: 'internal', guildName: 'Kabizzle Crew',
  baseCampLevel: 4, adminPlayerId: ADMIN, baseIds: [BASE_A, BASE_B],
  members: [
    { playerId: ADMIN,  lastOnline: 133700000000000000, name: 'Badger' },
    { playerId: MEMBER, lastOnline: 133700000000000001, name: 'Rein' },
  ],
};

const bases = [
  { id: BASE_A, guildId: GUILD_ID, x: -288669, y: 329207, z: 1500, areaRange: 2200, state: 1 },
  { id: BASE_B, guildId: GUILD_ID, x: -167230, y: 96430,  z: 900,  areaRange: 1800, state: 2 },
];

// A decoy occurrence of the property name, to prove the search validates the
// type tag that must follow rather than trusting the first byte match.
const decoy = new Writer().fstring('GroupSaveDataMap').fstring('StrProperty').done();

const body = Buffer.concat([
  Buffer.from('GVAS'), Buffer.alloc(64),  // header stand-in; the parser scans past it
  decoy,
  mapProperty('GroupSaveDataMap', [
    { key: GUILD_ID, value: entryValue('EPalGroupType::Guild', guildRawData(guild)) },
    { key: ORG_ID,   value: entryValue('EPalGroupType::Organization', orgRawData({ groupId: ORG_ID, groupName: 'org', baseIds: [] })) },
  ]),
  mapProperty('BaseCampSaveData', bases.map((b) => ({ key: b.id, value: entryValue(null, baseCampRawData(b)) }))),
  new Writer().fstring('None').done(),
]);

// ── Checks ───────────────────────────────────────────────────────────────────
let failures = 0;
const check = (label, actual, expected) => {
  const ok = Object.is(actual, expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(44)} ${ok ? '' : `got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`}`);
};

async function run() {
  for (const saveType of [0x31, 0x32]) {
    const label = saveType === 0x31 ? 'single-zlib' : 'double-zlib';
    const { guilds, bases: parsedBases } = await parseLevelSave(buildSav(body, saveType));

    check(`[${label}] guild count`, guilds.length, 2);

    const g = guilds.find((x) => x.groupId === GUILD_ID);
    check(`[${label}] guild found by id`, !!g, true);
    check(`[${label}] guild name`, g?.name, 'Kabizzle Crew');
    check(`[${label}] base camp level`, g?.baseCampLevel, 4);
    check(`[${label}] admin player id`, g?.adminPlayerId, ADMIN);
    check(`[${label}] member count`, g?.members.length, 2);
    check(`[${label}] member name`, g?.members[1]?.name, 'Rein');
    check(`[${label}] member last online`, g?.members[0]?.lastOnline, 133700000000000000);
    check(`[${label}] guild base id count`, g?.baseIds.length, 2);

    // An Organization has bases but no guild name or roster, and must not be
    // decoded with the guild layout.
    const org = guilds.find((x) => x.groupId === ORG_ID);
    check(`[${label}] org parsed`, !!org, true);
    check(`[${label}] org has no members`, org?.members.length, 0);

    check(`[${label}] base count`, parsedBases.length, 2);
    const a = parsedBases.find((b) => b.id === BASE_A);
    check(`[${label}] base x`, a?.x, -288669);
    check(`[${label}] base y`, a?.y, 329207);
    check(`[${label}] base area range`, a?.areaRange, 2200);
    check(`[${label}] base joins to guild`, a?.guildId, GUILD_ID);
    check(`[${label}] base state`, a?.state, 1);
  }

  // Empty and absent data must yield empty results, not throw.
  const bare = await parseLevelSave(buildSav(Buffer.concat([Buffer.from('GVAS'), Buffer.alloc(64)])));
  check('save without guild data returns empty', bare.guilds.length + bare.bases.length, 0);

  let rejected = false;
  try { await parseLevelSave(Buffer.concat([Buffer.alloc(8), Buffer.from('XXX'), Buffer.from([0x31])])); }
  catch { rejected = true; }
  check('non-Palworld file is rejected', rejected, true);

  console.log(failures === 0 ? '\nAll save parser checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
