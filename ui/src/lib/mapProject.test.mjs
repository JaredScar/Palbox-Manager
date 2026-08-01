// Checks the map projection against the reference values published by the
// community palworld-coord library, which is where the constants come from.
// Getting the axis swap or the origin offset wrong still produces plausible
// looking numbers, so the reference points are the only real check.
const SCALE = 459;
const TRANSLATION_X = 123930;
const TRANSLATION_Y = 157935;
const MAP_SIZE = 8192;
const GAME_MIN_X = -1951, GAME_MAX_X = 1198, GAME_MIN_Y = -1893, GAME_MAX_Y = 1243;
const TRANSFORM_A = MAP_SIZE / (GAME_MAX_X - GAME_MIN_X);
const TRANSFORM_B = 5075.45;
const TRANSFORM_C = -MAP_SIZE / (GAME_MAX_Y - GAME_MIN_Y);
const TRANSFORM_D = 4960.62;
const clamp01 = (n) => Math.min(1, Math.max(0, n));

const worldToGameCoords = (x, y) => ({
  x: Math.round((y - TRANSLATION_Y) / SCALE),
  y: Math.round((x + TRANSLATION_X) / SCALE),
});
const worldToUv = (x, y) => {
  const mapX = Math.round((y - TRANSLATION_Y) / SCALE);
  const mapY = Math.round((x + TRANSLATION_X) / SCALE) * -1;
  const px = TRANSFORM_A * mapX + TRANSFORM_B;
  const py = TRANSFORM_C * mapY + TRANSFORM_D;
  return { u: clamp01(px / MAP_SIZE), v: clamp01(1 - py / MAP_SIZE) };
};

let failures = 0;
const check = (label, actual, expected, tolerance) => {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(46)} got ${String(actual).padEnd(10)} want ~${expected}`);
};

// palworld-coord's own documented example: the Anubis boss location.
const anubis = worldToGameCoords(-167230, 96430);
check('Anubis game coord x', anubis.x, -134, 1);
check('Anubis game coord y', anubis.y, -94, 1);

// Its inverse example: map (373, -359) came from sav (-288669, 329207).
const base = worldToGameCoords(-288669, 329207);
check('known base game coord x', base.x, 373, 1);
check('known base game coord y', base.y, -359, 1);

// The axis swap is the bug this guards: world Y must drive the horizontal
// axis. Moving only world Y must move u and leave v alone.
const a = worldToUv(0, 0);
const movedY = worldToUv(0, 200000);
const movedX = worldToUv(200000, 0);
check('world Y shifts u', Math.abs(movedY.u - a.u) > 0.05 ? 1 : 0, 1, 0);
check('world Y leaves v', Math.abs(movedY.v - a.v) < 1e-9 ? 1 : 0, 1, 0);
check('world X shifts v', Math.abs(movedX.v - a.v) > 0.05 ? 1 : 0, 1, 0);
check('world X leaves u', Math.abs(movedX.u - a.u) < 1e-9 ? 1 : 0, 1, 0);

// Direction check anchored on a landmark rather than an assumption: the Anubis
// boss arena sits in the desert in the north-east of Palpagos, so it must land
// right of centre and above it. This is what catches a flipped vertical axis.
const anubisUv = worldToUv(-167230, 96430);
check('Anubis is east of centre', anubisUv.u > 0.5 ? 1 : 0, 1, 0);
check('Anubis is north of centre', anubisUv.v < 0.5 ? 1 : 0, 1, 0);
// Consistent with that, larger world X is further north.
check('larger world X is further north', worldToUv(400000, 0).v < worldToUv(-400000, 0).v ? 1 : 0, 1, 0);

// Everything on the island must land inside the image.
for (const [x, y] of [[0, 0], [-167230, 96430], [-288669, 329207], [-600000, -400000], [400000, 500000]]) {
  const { u, v } = worldToUv(x, y);
  const inside = u >= 0 && u <= 1 && v >= 0 && v <= 1;
  check(`(${x},${y}) inside image`, inside ? 1 : 0, 1, 0);
}

console.log(failures === 0 ? '\nAll projection checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
