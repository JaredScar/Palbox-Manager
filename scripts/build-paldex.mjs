/**
 * Regenerates the bundled Pal reference data and icons.
 *
 * This is a maintenance script, not part of the build: it needs network access
 * and ffmpeg, and its outputs are committed. Re-run it when Palworld adds Pals.
 *
 *   node scripts/build-paldex.mjs
 *
 * Source data is palworld-save-pal's extracted game tables, which are keyed on
 * the same internal CharacterIDs that appear in Level.sav (including variant
 * suffixes), so no name matching guesswork is involved.
 *
 * Outputs:
 *   api/src/data/paldex.json   compact id -> name/elements/stats/icon
 *   ui/public/pals/<icon>.webp 96px icons, downscaled from the 430px originals
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache', 'paldex');
const OUT_DATA = path.join(ROOT, 'api', 'src', 'data', 'paldex.json');
const OUT_ICONS = path.join(ROOT, 'ui', 'public', 'pals');

const REPO = 'https://raw.githubusercontent.com/oMaN-Rod/palworld-save-pal/main';
const IMG = `${REPO}/ui/src/lib/assets/img`;

/** The game's internal element names are not the ones players see. */
const ELEMENTS = {
  Normal: 'Neutral',
  Leaf: 'Grass',
  Electricity: 'Electric',
  Earth: 'Ground',
};

const ICON_SIZE = 96;
const CONCURRENCY = 12;

async function fetchCached(url, file) {
  const dest = path.join(CACHE, file);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  const res = await fetch(url);
  if (!res.ok) return null;
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

async function pool(items, worker) {
  const queue = [...items];
  const runners = Array.from({ length: CONCURRENCY }, async () => {
    for (let next = queue.pop(); next !== undefined; next = queue.pop()) await worker(next);
  });
  await Promise.all(runners);
}

/**
 * Variant ids reuse their base species artwork, so an id that has no icon of
 * its own is progressively stripped down to something that does.
 */
function stripVariant(s) {
  return s.toLowerCase()
    .replace(/^(boss_|raid_|gym_|police_|quest_|predator_)/, '')
    .replace(/_(2|3|otomo|avatar|servant|oilrig|tower|quest|quest_enemy|quest_friend|flying|max)$/, '');
}

function resolveIcon(id, tribe, available) {
  const candidates = [
    id.toLowerCase(),
    stripVariant(id),
    stripVariant(stripVariant(id)),
    (tribe || '').toLowerCase(),
    stripVariant(tribe || ''),
  ];
  return candidates.find((c) => c && available.has(c)) ?? null;
}

async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  fs.mkdirSync(path.dirname(OUT_DATA), { recursive: true });
  fs.mkdirSync(OUT_ICONS, { recursive: true });

  try {
    await run('ffmpeg', ['-version']);
  } catch {
    console.error('ffmpeg is required to downscale the icons.');
    process.exit(1);
  }

  const statsFile = await fetchCached(`${REPO}/data/json/pals.json`, 'pals.json');
  const namesFile = await fetchCached(`${REPO}/data/json/l10n/en/pals.json`, 'names.json');
  if (!statsFile || !namesFile) throw new Error('could not download source data');

  const stats = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
  const names = JSON.parse(fs.readFileSync(namesFile, 'utf8'));

  const pals = Object.entries(stats).filter(([, v]) => v.is_pal && !v.disabled);
  console.log(`${pals.length} pals in source data`);

  // Fetch every candidate icon once, then work out what each id can use.
  const wanted = new Set();
  for (const [id, v] of pals) {
    wanted.add(id.toLowerCase());
    wanted.add(stripVariant(id));
    if (v.tribe) wanted.add(v.tribe.toLowerCase());
  }

  const available = new Set();
  await pool([...wanted], async (key) => {
    // Two naming conventions are in use for the same artwork.
    const got = await fetchCached(`${IMG}/${key}.webp`, `${key}.webp`)
      ?? await fetchCached(`${IMG}/t_${key}_icon_normal.webp`, `${key}.webp`);
    if (got) available.add(key);
  });
  console.log(`${available.size} icon files available`);

  const dex = {};
  const used = new Set();
  let missing = 0;

  for (const [id, v] of pals) {
    const icon = resolveIcon(id, v.tribe, available);
    if (icon) used.add(icon); else missing++;
    dex[id] = {
      name: names[id]?.localized_name ?? id,
      tribe: v.tribe,
      dex: v.pal_deck_index ?? 0,
      elements: (v.element_types ?? []).map((e) => ELEMENTS[e] ?? e),
      rarity: v.rarity ?? 0,
      boss: !!v.is_boss,
      raid: !!v.is_raid_boss,
      nocturnal: !!v.nocturnal,
      icon,
      hp: v.scaling?.hp ?? 0,
      attack: v.scaling?.attack ?? 0,
      defense: v.scaling?.defense ?? 0,
      // Only the jobs a Pal can actually do; the zeros are noise.
      work: Object.fromEntries(Object.entries(v.work_suitability ?? {}).filter(([, n]) => n > 0)),
    };
  }

  fs.writeFileSync(OUT_DATA, JSON.stringify(dex));
  console.log(`wrote ${OUT_DATA} (${(fs.statSync(OUT_DATA).size / 1024).toFixed(0)} KB, ${missing} without icons)`);

  for (const f of fs.readdirSync(OUT_ICONS)) fs.unlinkSync(path.join(OUT_ICONS, f));
  await pool([...used], async (key) => {
    await run('ffmpeg', [
      '-v', 'error', '-i', path.join(CACHE, `${key}.webp`),
      '-vf', `scale=${ICON_SIZE}:${ICON_SIZE}`, '-q:v', '78',
      '-y', path.join(OUT_ICONS, `${key}.webp`),
    ]);
  });

  const total = fs.readdirSync(OUT_ICONS).reduce((n, f) => n + fs.statSync(path.join(OUT_ICONS, f)).size, 0);
  console.log(`wrote ${used.size} icons to ${OUT_ICONS} (${(total / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
