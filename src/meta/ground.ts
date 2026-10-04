/**
 * THE GROUND: your stadium, built part by part instead of in five fixed levels. Stands on each side, floodlights, the
 * dome roof, a big screen, a megastore, a fan zone, a training ground and a youth academy. Each part costs coins and
 * takes a matchday or two to build (one build at a time, never sped up for money): something to look forward to.
 *
 * The old stadium level (0..5) is still what the rest of the game reads (gate money, crowd, wage budget, the render's
 * fallback): `groundLevel` derives it from the stands built, and an old save's level becomes exactly the parts that
 * made it (`groundFromLevel`). Pure rules, no DOM; the screen is MY CLUB > STADIUM (ui/club.ts) and every part shows
 * in matches (render/stadium.ts, the STRUCTURAL PARTS section).
 */
import type { StadiumParts } from '../render/stadium';

export type PartId = 'main' | 'near' | 'lights' | 'north' | 'south' | 'roof' | 'screen' | 'store' | 'fanzone' | 'training' | 'academy';

export interface PartStep {
  /** What the step is called once built ("MAIN STAND", "UPPER TIER"). */
  name: string;
  cost: number;
  /** League matchdays it takes to build. */
  weeks: number;
  /** Seats it adds. */
  seats: number;
}

export interface PartDef {
  id: PartId;
  /** The part's name on the list. */
  name: string;
  kind: 'stand' | 'facility';
  /** Pixel icon (ui/pixelIcons.ts). */
  icon: string;
  /** What it does, in a few words (the detail pane). */
  does: string;
  steps: readonly PartStep[];
}

export interface GroundState {
  /** Built level per part (missing = 0, not built). */
  built: Partial<Record<PartId, number>>;
  /** The part going up now (one at a time): the level it reaches and the league matchdays left. */
  building: { id: PartId; level: number; left: number } | null;
  /** Parts finished that the player has not been shown yet (the "now open" moment). */
  opened: PartId[];
}

export const PARTS: readonly PartDef[] = [
  {
    id: 'main', name: 'MAIN STAND', kind: 'stand', icon: 'flag', does: 'SEATS AND GATE MONEY',
    steps: [
      { name: 'MAIN STAND', cost: 800, weeks: 1, seats: 2200 },
      { name: 'UPPER TIER', cost: 3000, weeks: 2, seats: 5500 },
    ],
  },
  {
    id: 'near', name: 'FAMILY STAND', kind: 'stand', icon: 'duo', does: 'SEATS ALONG THE NEAR SIDE',
    steps: [
      { name: 'FAMILY STAND', cost: 1200, weeks: 1, seats: 3500 },
      { name: 'FULL LENGTH', cost: 1600, weeks: 1, seats: 2500 },
    ],
  },
  {
    id: 'lights', name: 'FLOODLIGHTS', kind: 'stand', icon: 'bolt', does: 'NIGHT GAMES, NEEDED FOR THE UPPER TIER',
    steps: [{ name: 'FLOODLIGHTS', cost: 1600, weeks: 1, seats: 0 }],
  },
  {
    id: 'north', name: 'NORTH END', kind: 'stand', icon: 'flag', does: 'A STAND BEHIND THE LEFT GOAL',
    steps: [{ name: 'NORTH END', cost: 3800, weeks: 2, seats: 6000 }],
  },
  {
    id: 'south', name: 'SOUTH END', kind: 'stand', icon: 'flag', does: 'A STAND BEHIND THE RIGHT GOAL',
    steps: [{ name: 'SOUTH END', cost: 3800, weeks: 2, seats: 6000 }],
  },
  {
    id: 'roof', name: 'THE DOME', kind: 'stand', icon: 'shield', does: 'A ROOF OVER THE BOWL, THE BIGGEST GROUND',
    steps: [{ name: 'THE DOME', cost: 9000, weeks: 2, seats: 16000 }],
  },
  {
    id: 'screen', name: 'BIG SCREEN', kind: 'facility', icon: 'film', does: 'SPONSORS PAY +5% MATCH COINS',
    steps: [{ name: 'BIG SCREEN', cost: 1500, weeks: 1, seats: 0 }],
  },
  {
    id: 'store', name: 'MEGASTORE', kind: 'facility', icon: 'shirt', does: 'SHIRT SALES AT EVERY HOME MATCH',
    steps: [{ name: 'MEGASTORE', cost: 2500, weeks: 1, seats: 0 }],
  },
  {
    id: 'fanzone', name: 'FAN ZONE', kind: 'facility', icon: 'fire', does: 'THE FANS ROAR YOU ON: +1 OVR AT HOME',
    steps: [{ name: 'FAN ZONE', cost: 1800, weeks: 1, seats: 0 }],
  },
  {
    id: 'training', name: 'TRAINING GROUND', kind: 'facility', icon: 'run', does: 'TRAINING COSTS 25% LESS',
    steps: [{ name: 'TRAINING GROUND', cost: 2000, weeks: 1, seats: 0 }],
  },
  {
    id: 'academy', name: 'YOUTH ACADEMY', kind: 'facility', icon: 'star', does: 'THREE PROSPECTS A SEASON, ONE STAR BETTER',
    steps: [{ name: 'YOUTH ACADEMY', cost: 3000, weeks: 2, seats: 0 }],
  },
];

export const PART_IDS: readonly PartId[] = PARTS.map((p) => p.id);
/** A park pitch holds this many before anything is built. */
export const BASE_SEATS = 300;
/** Training discount with the TRAINING GROUND. */
export const TRAINING_DISCOUNT = 0.25;
/** Match coins on top with the BIG SCREEN. */
export const SCREEN_BONUS = 0.05;

export function partDef(id: PartId): PartDef {
  return PARTS.find((p) => p.id === id)!;
}

export function defaultGround(): GroundState {
  return { built: {}, building: null, opened: [] };
}

export function builtLevel(g: GroundState, id: PartId): number {
  return Math.max(0, Math.min(partDef(id).steps.length, Math.round(g.built[id] ?? 0)));
}

export function has(g: GroundState, id: PartId): boolean {
  return builtLevel(g, id) > 0;
}

/**
 * The stadium level the rest of the game reads (0 park pitch .. 5 the dome), from the stands: 1 a main stand, 2 a
 * family stand too, 3 the upper tier, the full-length family stand and floodlights, 4 both ends, 5 the dome.
 */
export function groundLevel(g: GroundState): number {
  const m = builtLevel(g, 'main');
  const n = builtLevel(g, 'near');
  if (m < 1) return 0;
  if (n < 1) return 1;
  if (m < 2 || n < 2 || !has(g, 'lights')) return 2;
  if (!has(g, 'north') || !has(g, 'south')) return 3;
  if (!has(g, 'roof')) return 4;
  return 5;
}

/** The parts an old save's stadium level stood for (so a level-3 ground is still exactly that ground). */
export function groundFromLevel(level: number): GroundState {
  const l = Math.max(0, Math.min(5, Math.round(level) || 0));
  const g = defaultGround();
  if (l >= 1) g.built.main = 1;
  if (l >= 2) g.built.near = 1;
  if (l >= 3) Object.assign(g.built, { main: 2, near: 2, lights: 1 });
  // (A level-4 ground always had the scoreboard on its south end: it keeps it, as the BIG SCREEN.)
  if (l >= 4) Object.assign(g.built, { north: 1, south: 1, screen: 1 });
  if (l >= 5) g.built.roof = 1;
  return g;
}

/** Seats in the ground (the number the stadium screen shows). */
export function capacity(g: GroundState): number {
  let n = BASE_SEATS;
  for (const p of PARTS) {
    const lv = builtLevel(g, p.id);
    for (let i = 0; i < lv; i++) n += p.steps[i].seats;
  }
  return n;
}

/** Why a part can't be built yet (a short line), or null when it can (`ok` also covers fully built). */
export function partNeeds(g: GroundState, id: PartId): string | null {
  const lv = builtLevel(g, id);
  const m = builtLevel(g, 'main');
  switch (id) {
    case 'main':
      return lv === 1 && !has(g, 'lights') ? 'NEEDS FLOODLIGHTS' : null;
    case 'near':
      if (m < 1) return 'NEEDS THE MAIN STAND';
      return lv === 1 && m < 2 ? 'NEEDS THE UPPER TIER' : null;
    case 'lights':
    case 'screen':
    case 'store':
      return m < 1 ? 'NEEDS THE MAIN STAND' : null;
    case 'fanzone':
      return builtLevel(g, 'near') < 1 ? 'NEEDS THE FAMILY STAND' : null;
    case 'north':
    case 'south':
      return m < 2 || builtLevel(g, 'near') < 2 ? 'NEEDS BOTH SIDES FULL' : null;
    case 'roof':
      return !has(g, 'north') || !has(g, 'south') ? 'NEEDS BOTH ENDS' : null;
    case 'training':
      return null;
    case 'academy':
      return has(g, 'training') ? null : 'NEEDS THE TRAINING GROUND';
  }
}

export type PartStatus = 'built' | 'building' | 'ready' | 'locked';

export interface PartView {
  def: PartDef;
  /** Built level now (0..steps). */
  level: number;
  /** The next step (undefined when fully built). */
  next?: PartStep;
  status: PartStatus;
  /** Matchdays left while building. */
  left: number;
  /** Why it is locked. */
  needs: string | null;
}

export function partView(g: GroundState, id: PartId): PartView {
  const def = partDef(id);
  const level = builtLevel(g, id);
  const next = def.steps[level];
  const building = g.building?.id === id;
  const needs = next ? partNeeds(g, id) : null;
  const status: PartStatus = building ? 'building' : !next ? 'built' : needs ? 'locked' : 'ready';
  return { def, level, next, status, left: building ? g.building!.left : 0, needs };
}

export type BuildFail = 'busy' | 'maxed' | 'locked' | 'no-coins';
export type BuildResult = { ok: true; cost: number; weeks: number } | { ok: false; reason: BuildFail };

export function canBuild(g: GroundState, coins: number, id: PartId): BuildResult {
  const v = partView(g, id);
  if (!v.next) return { ok: false, reason: 'maxed' };
  if (g.building) return { ok: false, reason: 'busy' };
  if (v.needs) return { ok: false, reason: 'locked' };
  if (coins < v.next.cost) return { ok: false, reason: 'no-coins' };
  return { ok: true, cost: v.next.cost, weeks: v.next.weeks };
}

/** Pay for the next step of a part and start building it. */
export function startBuild(g: GroundState, wallet: { coins: number }, id: PartId): BuildResult {
  const r = canBuild(g, wallet.coins, id);
  if (!r.ok) return r;
  wallet.coins -= r.cost;
  g.building = { id, level: builtLevel(g, id) + 1, left: r.weeks };
  return r;
}

/** One league matchday passes: the build moves on, and opens when it is done. Returns the part opened, if any. */
export function tickBuild(g: GroundState, all = false): PartId | null {
  const b = g.building;
  if (!b) return null;
  b.left = all ? 0 : b.left - 1;
  if (b.left > 0) return null;
  g.built[b.id] = Math.max(builtLevel(g, b.id), b.level);
  g.building = null;
  if (!g.opened.includes(b.id)) g.opened.push(b.id);
  return b.id;
}

/** The cheapest part that can be built next (for the hub's NEXT GOAL), or null when everything is built. */
export function nextBuild(g: GroundState): { id: PartId; name: string; cost: number } | null {
  let best: { id: PartId; name: string; cost: number } | null = null;
  for (const p of PARTS) {
    const v = partView(g, p.id);
    if (v.status !== 'ready' || !v.next) continue;
    if (!best || v.next.cost < best.cost) best = { id: p.id, name: v.next.name, cost: v.next.cost };
  }
  return best;
}

/** What the renderer draws: built levels by part (render/stadium.ts StadiumParts). */
export function stadiumParts(g: GroundState): StadiumParts {
  const out: StadiumParts = {};
  for (const id of PART_IDS) {
    const lv = builtLevel(g, id);
    if (lv > 0) out[id] = lv;
  }
  return out;
}

/** Shirt sales at a home match with the MEGASTORE (bigger crowds in higher divisions). */
export function megastoreCoins(division: number): number {
  const d = Math.max(1, Math.min(6, Math.round(division) || 6));
  return 60 + 20 * (6 - d);
}

// ------------------------------------------------------------------ save

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The saved ground, or the parts of the old stadium level (`level`) when the save is from before parts. */
export function readGround(v: unknown, level: number): GroundState {
  if (!isObj(v) || !isObj(v.built)) return groundFromLevel(level);
  const g = defaultGround();
  for (const id of PART_IDS) {
    const n = v.built[id];
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) g.built[id] = Math.min(partDef(id).steps.length, Math.round(n));
  }
  const b = v.building;
  if (isObj(b) && PART_IDS.includes(b.id as PartId) && typeof b.level === 'number' && typeof b.left === 'number') {
    const id = b.id as PartId;
    const level = Math.round(b.level);
    if (level === builtLevel(g, id) + 1 && level <= partDef(id).steps.length) g.building = { id, level, left: Math.max(1, Math.min(4, Math.round(b.left))) };
  }
  if (Array.isArray(v.opened)) g.opened = [...new Set(v.opened.filter((x): x is PartId => PART_IDS.includes(x as PartId)))];
  return g;
}
