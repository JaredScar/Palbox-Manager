/**
 * Palworld world coordinates -> position on the in-game world map texture.
 *
 * The REST API reports Unreal world coordinates (location_x / location_y, the
 * same space the .sav files use). Turning those into a point on the map is not
 * a straight rescale, and two details account for essentially every
 * mispositioned marker:
 *
 *  1. The axes are swapped. The map's horizontal axis follows world Y
 *     (west to east) and its vertical axis follows world X (north to south).
 *  2. The origin is offset, not centred. The translation constants below are
 *     asymmetric, so treating the world as a symmetric square around zero puts
 *     everything in the wrong place.
 *
 * The constants come from the community palworld-coord reverse engineering and
 * are calibrated against the game's own 8192x8192 t_worldmap texture. They are
 * only valid for that image: a wiki render of the island crops and scales
 * differently, so serving one of those and applying these numbers is wrong.
 */

/** Native size of the square map texture, in pixels. */
export const MAP_SIZE = 8192;

const SCALE = 459;
const TRANSLATION_X = 123930;
const TRANSLATION_Y = 157935;

// Game-coordinate extents of the map, used to derive the game->pixel affine.
const GAME_MIN_X = -1951;
const GAME_MAX_X = 1198;
const GAME_MIN_Y = -1893;
const GAME_MAX_Y = 1243;

const TRANSFORM_A = MAP_SIZE / (GAME_MAX_X - GAME_MIN_X);
const TRANSFORM_B = 5075.45;
const TRANSFORM_C = -MAP_SIZE / (GAME_MAX_Y - GAME_MIN_Y);
const TRANSFORM_D = 4960.62;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * World position -> the coordinate pair the game shows players on its own map,
 * so a reading here can be compared against one read in game.
 */
export function worldToGameCoords(worldX: number, worldY: number): { x: number; y: number } {
  return {
    x: Math.round((worldY - TRANSLATION_Y) / SCALE),
    y: Math.round((worldX + TRANSLATION_X) / SCALE),
  };
}

/** World position -> pixel on the texture, in y-up space (0 = bottom). */
export function worldToPixel(worldX: number, worldY: number): { px: number; py: number } {
  const mapX = Math.round((worldY - TRANSLATION_Y) / SCALE);
  const mapY = Math.round((worldX + TRANSLATION_X) / SCALE) * -1;
  return {
    px: TRANSFORM_A * mapX + TRANSFORM_B,
    py: TRANSFORM_C * mapY + TRANSFORM_D,
  };
}

/**
 * World position -> { u, v } in [0,1] across the map image, with u running
 * west to east and v north to south, ready for CSS percentage offsets.
 */
export function worldToUv(worldX: number, worldY: number): { u: number; v: number } {
  const { px, py } = worldToPixel(worldX, worldY);
  return {
    u: clamp01(px / MAP_SIZE),
    v: clamp01(1 - py / MAP_SIZE),
  };
}
