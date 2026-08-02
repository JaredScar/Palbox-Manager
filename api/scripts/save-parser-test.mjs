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

/**
 * Palworld 1.0 inserted a 4-byte field before the base id list and another
 * before the base camp level. `layout` picks which era to emit.
 */
function guildRawData(g, layout = 'legacy') {
  const w = new Writer()
    .guid(g.groupId)
    .fstring(g.groupName)
    .u32(0)                       // character handle ids
    .u8(0);                       // org type
  if (layout === 'v1') w.i32(0);
  w.tarrayGuid(g.baseIds);
  if (layout === 'v1') w.i32(0);
  w.i32(g.baseCampLevel)
    .tarrayGuid([])               // base camp point instance ids
    .fstring(g.guildName)
    .guid(g.adminPlayerId)
    .i32(g.members.length);
  for (const m of g.members) w.guid(m.playerId).i64(m.lastOnline).fstring(m.name);
  return w.done();
}

function orgRawData(o, layout = 'legacy') {
  const w = new Writer().guid(o.groupId).fstring(o.groupName).u32(0).u8(1);
  if (layout === 'v1') w.i32(0);
  return w.tarrayGuid(o.baseIds).done();
}

/** `pad` simulates a future patch inserting fields ahead of the transform. */
function baseCampRawData(b, pad = 0) {
  const w = new Writer().guid(b.id).fstring('').u8(b.state);
  for (let i = 0; i < pad; i++) w.u8(0x7f);
  return w
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

// ── Character map ────────────────────────────────────────────────────────────
// Its keys are a struct of two GUIDs rather than the bare GUID the other maps
// use, which is the case the reader has to be told about.
function characterKey(playerId, instanceId) {
  return new Writer()
    .raw(property('PlayerUId', 'StructProperty',
      new Writer().fstring('Guid').raw(Buffer.alloc(16)).noGuid().done(),
      new Writer().guid(playerId).done()))
    .raw(property('InstanceId', 'StructProperty',
      new Writer().fstring('Guid').raw(Buffer.alloc(16)).noGuid().done(),
      new Writer().guid(instanceId).done()))
    .fstring('None')
    .done();
}

const intProp   = (n, v) => property(n, 'IntProperty', new Writer().noGuid().done(), new Writer().i32(v).done());
const boolProp  = (n, v) => property(n, 'BoolProperty', new Writer().done(), new Writer().u8(v ? 1 : 0).u8(0).done());
const strProp   = (n, v) => property(n, 'StrProperty', new Writer().noGuid().done(), new Writer().fstring(v).done());
const nameProp  = (n, v) => property(n, 'NameProperty', new Writer().noGuid().done(), new Writer().fstring(v).done());
const enumProp  = (n, t, v) => property(n, 'EnumProperty', new Writer().fstring(t).noGuid().done(), new Writer().fstring(v).done());
const guidProp  = (n, v) => property(n, 'StructProperty',
  new Writer().fstring('Guid').raw(Buffer.alloc(16)).noGuid().done(),
  new Writer().guid(v).done());
const nameArray = (n, list) => property(n, 'ArrayProperty',
  new Writer().fstring('NameProperty').noGuid().done(),
  (() => { const w = new Writer().u32(list.length); for (const s of list) w.fstring(s); return w.done(); })());
const guidArray = (n, list) => property(n, 'ArrayProperty',
  new Writer().fstring('Guid').noGuid().done(),
  (() => { const w = new Writer().u32(list.length); for (const g of list) w.guid(g); return w.done(); })());

/**
 * A Set is what Palworld 1.0 uses for the Pal-box locker index. It has to be
 * skipped by its declared size or everything after it is misread.
 */
function setProp(name, payloadBytes) {
  return property(name, 'SetProperty',
    new Writer().fstring('StructProperty').noGuid().done(),
    Buffer.alloc(payloadBytes, 0x5a));
}

function palRawData(p, opts = {}) {
  const inner = new Writer()
    .raw(nameProp('CharacterID', p.characterId))
    .raw(boolProp('IsRarePal', !!p.lucky))
    .raw(intProp('Level', p.level))
    .raw(intProp('Exp', p.exp ?? 0))
    .raw(intProp('Rank', p.rank ?? 1))
    .raw(enumProp('Gender', 'EPalGenderType', `EPalGenderType::${p.gender}`))
    .raw(intProp('Talent_HP', p.ivs[0]))
    .raw(intProp('Talent_Melee', p.ivs[1]))
    .raw(intProp('Talent_Shot', p.ivs[2]))
    .raw(intProp('Talent_Defense', p.ivs[3]));

  if (opts.withSet) inner.raw(setProp('InLockerCharacterInstanceIDArray', 24));

  inner.raw(nameArray('PassiveSkillList', p.passives ?? []));
  if (p.nickname) inner.raw(strProp('NickName', p.nickname));
  if (p.owner) inner.raw(guidProp('OwnerPlayerUId', p.owner));
  if (p.oldOwners) inner.raw(guidArray('OldOwnerPlayerUIds', p.oldOwners));
  inner.fstring('None');

  const w = new Writer()
    .raw(property('SaveParameter', 'StructProperty',
      new Writer().fstring('PalIndividualCharacterSaveParameter').raw(Buffer.alloc(16)).noGuid().done(),
      inner.done()))
    .fstring('None');

  // 1.0 appends fields after the property list; the None sentinel ends it and
  // the extra bytes must simply be ignored.
  if (opts.trailing) w.raw(Buffer.alloc(opts.trailing, 0x33));
  return w.done();
}

function playerRawData(pl) {
  const inner = new Writer()
    .raw(boolProp('IsPlayer', true))
    .raw(strProp('NickName', pl.name))
    .raw(intProp('Level', pl.level))
    .raw(intProp('Exp', pl.exp ?? 0))
    .fstring('None');
  return new Writer()
    .raw(property('SaveParameter', 'StructProperty',
      new Writer().fstring('PalIndividualCharacterSaveParameter').raw(Buffer.alloc(16)).noGuid().done(),
      inner.done()))
    .fstring('None')
    .done();
}

function characterMap(entries) {
  const payload = new Writer();
  payload.u32(0).u32(entries.length);
  for (const e of entries) payload.raw(characterKey(e.playerId, e.instanceId)).raw(entryValue(null, e.raw));
  return property(
    'CharacterSaveParameterMap', 'MapProperty',
    new Writer().fstring('StructProperty').fstring('StructProperty').noGuid().done(),
    payload.done(),
  );
}

function buildSav(body, saveType = 0x31, magic = 'PlZ') {
  let compressed = zlib.deflateSync(body);
  if (saveType === 0x32) compressed = zlib.deflateSync(compressed);
  return Buffer.concat([
    new Writer().u32(body.length).u32(saveType === 0x32 ? zlib.deflateSync(body).length : compressed.length).done(),
    Buffer.from(magic, 'latin1'), Buffer.from([saveType]),
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

const org = { groupId: ORG_ID, groupName: 'org', baseIds: [] };

const PAL_A = '11111111-aaaa-bbbb-cccc-000000000001';
const PAL_B = '22222222-aaaa-bbbb-cccc-000000000002';
const PAL_C = '33333333-aaaa-bbbb-cccc-000000000003';

const palFixtures = [
  {
    playerId: ADMIN, instanceId: PAL_A,
    raw: palRawData({
      characterId: 'SheepBall', nickname: 'Fluff', level: 24, exp: 400, rank: 3,
      gender: 'Female', lucky: true, ivs: [70, 40, 55, 60],
      passives: ['PAL_ALLAttack_up2', 'Legend'], owner: ADMIN,
    }, { withSet: true, trailing: 16 }),
  },
  {
    playerId: MEMBER, instanceId: PAL_B,
    raw: palRawData({
      characterId: 'BOSS_Anubis', level: 45, rank: 1, gender: 'Male',
      ivs: [90, 95, 20, 30], owner: MEMBER,
    }),
  },
  {
    // A base worker: no current owner, but it remembers who caught it.
    playerId: ADMIN, instanceId: PAL_C,
    raw: palRawData({
      characterId: 'PinkCat', level: 7, rank: 1, gender: 'Male',
      ivs: [10, 10, 10, 10], oldOwners: [MEMBER],
    }),
  },
];

/** A whole world file, in either the pre-1.0 or the 1.0 guild layout. */
function buildBody(layout, basePad = 0) {
  return Buffer.concat([
    Buffer.from('GVAS'), Buffer.alloc(64),  // header stand-in; the parser scans past it
    decoy,
    mapProperty('GroupSaveDataMap', [
      { key: GUILD_ID, value: entryValue('EPalGroupType::Guild', guildRawData(guild, layout)) },
      { key: ORG_ID,   value: entryValue('EPalGroupType::Organization', orgRawData(org, layout)) },
    ]),
    mapProperty('BaseCampSaveData', bases.map((b) => ({
      key: b.id, value: entryValue(null, baseCampRawData(b, basePad)),
    }))),
    characterMap([
      ...palFixtures,
      { playerId: ADMIN, instanceId: 'aaaa0000-0000-0000-0000-000000000001', raw: playerRawData({ name: 'Badger', level: 38, exp: 9000 }) },
    ]),
    new Writer().fstring('None').done(),
  ]);
}

const body = buildBody('legacy');

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

  // Pals and players out of the character map.
  {
    const { pals, players } = await parseLevelSave(buildSav(body));
    const byId = Object.fromEntries(pals.map((p) => [p.instanceId, p]));
    const a = byId[PAL_A];

    check('pal count excludes players', pals.length, 3);
    check('player extracted separately', players.length, 1);
    check('player name', players[0]?.name, 'Badger');
    check('player level', players[0]?.level, 38);

    check('pal character id', a?.characterId, 'SheepBall');
    check('pal nickname', a?.nickname, 'Fluff');
    check('pal level', a?.level, 24);
    check('pal rank', a?.rank, 3);
    check('pal gender', a?.gender, 'Female');
    check('pal lucky', a?.lucky, true);
    check('pal is not boss', a?.boss, false);
    check('pal ivs', JSON.stringify([a?.talentHp, a?.talentMelee, a?.talentShot, a?.talentDefense]), '[70,40,55,60]');
    check('pal passives', JSON.stringify(a?.passives), '["PAL_ALLAttack_up2","Legend"]');
    check('pal owner', a?.ownerPlayerId, ADMIN);

    check('alpha detected from id', byId[PAL_B]?.boss, true);
    check('alpha level', byId[PAL_B]?.level, 45);
    // A base worker has no OwnerPlayerUId, so it must fall back to its captor.
    check('base pal falls back to previous owner', byId[PAL_C]?.ownerPlayerId, MEMBER);
  }

  // A Palworld 1.0 world, with the two inserted guild fields. The layout has
  // to be detected from the file, since nothing in it announces the version.
  {
    const { guilds, bases: pb } = await parseLevelSave(buildSav(buildBody('v1')));
    const g = guilds.find((x) => x.groupId === GUILD_ID);
    check('[v1] guild count', guilds.length, 2);
    check('[v1] guild name', g?.name, 'Kabizzle Crew');
    check('[v1] base camp level', g?.baseCampLevel, 4);
    check('[v1] member count', g?.members.length, 2);
    check('[v1] member name', g?.members[1]?.name, 'Rein');
    check('[v1] admin player id', g?.adminPlayerId, ADMIN);
    check('[v1] guild base id count', g?.baseIds.length, 2);
    check('[v1] org has no members', guilds.find((x) => x.groupId === ORG_ID)?.members.length, 0);
    check('[v1] base joins to guild', pb.find((b) => b.id === BASE_A)?.guildId, GUILD_ID);
  }

  // A base camp struct that has grown ahead of the transform must still be
  // located rather than silently plotted somewhere wrong.
  {
    const { bases: pb } = await parseLevelSave(buildSav(buildBody('v1', 12)));
    const a = pb.find((b) => b.id === BASE_A);
    check('[shifted] base found', !!a, true);
    check('[shifted] base x', a?.x, -288669);
    check('[shifted] base y', a?.y, 329207);
    check('[shifted] base area range', a?.areaRange, 2200);
    check('[shifted] base joins to guild', a?.guildId, GUILD_ID);
  }

  // Empty and absent data must yield empty results, not throw.
  const bare = await parseLevelSave(buildSav(Buffer.concat([Buffer.from('GVAS'), Buffer.alloc(64)])));
  check('save without guild data returns empty', bare.guilds.length + bare.bases.length, 0);

  const failure = async (data) => {
    try { await parseLevelSave(data); return ''; } catch (e) { return e.message; }
  };

  const junk = Buffer.concat([Buffer.alloc(8), Buffer.from('XXX'), Buffer.from([0x31]), Buffer.alloc(32)]);
  check('non-Palworld file is rejected', /expected "PlZ" or "PlM"/.test(await failure(junk)), true);
  check('file too short is rejected', /too short/.test(await failure(Buffer.alloc(8))), true);

  // Palworld 1.0 saves are Oodle-compressed and the decoder ships with Palbox,
  // so a PlM container must reach it. The decoder is ESM while the API compiles
  // to CommonJS, which is exactly the combination that breaks silently, so the
  // check is that we get a decode failure rather than a "cannot load" failure.
  const msg = await failure(buildSav(body, 0x31, 'PlM'));
  check('Oodle decoder is reachable', /ooz-wasm/.test(msg), false);
  check('Oodle container is recognised', /expected "PlZ" or "PlM"/.test(msg), false);
  check('Oodle payload was actually decoded', /decode/i.test(msg), true);

  console.log(failures === 0 ? '\nAll save parser checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
