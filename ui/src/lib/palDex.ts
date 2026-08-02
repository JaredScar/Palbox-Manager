import type { PalDexEntry } from '../api/client';

/** Builds a lookup once, for screens that resolve hundreds of Pals at a time. */
export function dexIndex(dex: Record<string, PalDexEntry>): Map<string, PalDexEntry> {
  const map = new Map<string, PalDexEntry>();
  for (const [id, entry] of Object.entries(dex)) map.set(id.toLowerCase(), entry);
  return map;
}

/**
 * The save file and the game's own data tables disagree about capitalisation
 * ("SheepBall" versus "Sheepball"), and Alphas appear as BOSS_<species> without
 * an entry of their own, so lookups normalise both.
 */
export function lookup(index: Map<string, PalDexEntry>, characterId: string): PalDexEntry | null {
  const lower = characterId.toLowerCase();
  return index.get(lower) ?? index.get(lower.replace(/^boss_/, '')) ?? null;
}

export const ELEMENT_COLOURS: Record<string, string> = {
  Neutral:  '#cbd5e1',
  Fire:     '#f97316',
  Water:    '#38bdf8',
  Grass:    '#4ade80',
  Electric: '#facc15',
  Ice:      '#a5f3fc',
  Ground:   '#c2874a',
  Dark:     '#8b5cf6',
  Dragon:   '#d946ef',
};

export const ELEMENTS = Object.keys(ELEMENT_COLOURS);

export function elementColour(element: string): string {
  return ELEMENT_COLOURS[element] ?? '#94a3b8';
}

/** Work suitability ids are internal; these are the in-game labels. */
export const WORK_LABELS: Record<string, string> = {
  EmitFlame: 'Kindling',
  Watering: 'Watering',
  Seeding: 'Planting',
  GenerateElectricity: 'Electricity',
  Handcraft: 'Handiwork',
  Collection: 'Gathering',
  Deforest: 'Lumbering',
  Mining: 'Mining',
  OilExtraction: 'Oil',
  ProductMedicine: 'Medicine',
  Cool: 'Cooling',
  Transport: 'Transporting',
  MonsterFarm: 'Farming',
};

/** Sum of the four individual values, as a percentage of the 400 point cap. */
export function ivPercent(ivs: { hp: number; melee: number; shot: number; defense: number }): number {
  return Math.round(((ivs.hp + ivs.melee + ivs.shot + ivs.defense) / 400) * 100);
}
