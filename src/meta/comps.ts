/**
 * The forever horizon after the Elite League: two competitions that slot into the season's calendar between league
 * matchdays, the same way the BLOCKY CUP does (meta/cup.ts).
 * - CONTINENTAL CUP: every Elite League season. Two groups of four (one round robin: three group games), the top two
 *   of each into the semi finals (A1 v B2, B1 v A2), then the final on neutral ground. Seven clubs from abroad.
 * - WORLD CLUB CUP: the season after you win the Elite League or the Continental Cup. Four champions, a semi final
 *   and a final, played as the season opens.
 * Your fixtures are played for real; every other one is a seeded, rating-based result (meta/career.ts simulateScore,
 * a shootout for level knockouts), settled in step with the calendar. Pure rules and state, no DOM.
 *
 * Runtime import cycle with career.ts: bindings from it are only used inside functions, never at module top level.
 */
import { Rng, hashString } from '../core/rng';
import { YOU, computeTable, divisionLevel, rivalRating, simulateScore, type Fixture, type LeagueClub, type TableRow } from './career';
import { simulateShootout } from './cup';
import { KIT_COLORS } from './data';
import type { FormationId, Kit, KitPattern } from '../sim/types';

export type CompKind = 'continental' | 'world';
export type CompStage = 'group' | 'sf' | 'final';
export type CompStatus = 'active' | 'won' | 'out';

/** A club from abroad, with the country it plays in (flavour on the draw). */
export interface CompClub extends LeagueClub {
  nation: string;
}

export interface CompFixture {
  /** League matchdays played before it is due. */
  after: number;
  stage: CompStage;
  /** Group index for group games, -1 for knockouts. */
  group: number;
  /** Club ids ('' until the earlier stage decides a knockout). */
  home: string;
  away: string;
  hg: number | null;
  ag: number | null;
  /** Shootout goals [home, away] when a knockout finished level. */
  pens: [number, number] | null;
}

export interface Competition {
  kind: CompKind;
  seed: number;
  /** Everyone in it but you. */
  clubs: CompClub[];
  /** Continental: two groups of four ids (you in group 0). World: none. */
  groups: string[][];
  fixtures: CompFixture[];
  status: CompStatus;
  /** Prize money it has paid this season (before the full-time multipliers). */
  earned: number;
  /** Trophy lift shown. */
  celebrated: boolean;
}

export interface CompOutcome {
  kind: CompKind;
  stage: CompStage;
  won: boolean;
  trophy: boolean;
  /** The prize for this result (0 for a loss or a draw); the match fee comes on top. */
  coins: number;
}

export const COMP_NAMES: Record<CompKind, string> = { continental: 'CONTINENTAL CUP', world: 'WORLD CLUB CUP' };
export const COMP_SHORT: Record<CompKind, string> = { continental: 'CONT', world: 'WORLD' };
export const STAGE_NAMES: Record<CompStage, string> = { group: 'GROUP', sf: 'SEMI FINAL', final: 'FINAL' };
/** League matchdays played before each Continental group round, the semi finals and the final. */
export const CONT_GROUP_AFTER = [1, 2, 3] as const;
export const CONT_SF_AFTER = 5;
export const CONT_FINAL_AFTER = 6;
/** The World Club Cup opens the season: both rounds before the first league matchday. */
export const WORLD_AFTER = 0;
/** Prizes: a group win, a semi final won, the final won (plus the trophy). */
export const CONT_PRIZE = { group: 150, sf: 400, final: 800, trophy: 2000 } as const;
export const WORLD_PRIZE = { group: 0, sf: 600, final: 1200, trophy: 3000 } as const;
/** How far a run went (compFinish): 0 out in the group (or the world semi), 1 out in the semi, 2 runners up, 3 winners. */
export const COMP_FINISH = ['GROUP STAGE', 'SEMI FINALS', 'RUNNERS UP', 'WINNERS'] as const;

const CITIES = ['Cubetto', 'Voxograd', 'Blokka', 'Pixelle', 'Quadra', 'Bricka', 'Tilia', 'Kubus', 'Mosaika', 'Cuboa', 'Squarena', 'Blokholm', 'Voxeira', 'Kubrava'];
const PREFIX = ['Real', 'Dynamo', 'Sporting', 'Olympique', 'Atletico', 'Inter', 'Racing', 'Union', 'Rapid'];
const NATIONS = ['CUBALIA', 'VOXONIA', 'PIXLAND', 'BLOKARIA', 'QUADRIA'];
const WORLD_CITIES = ['Rio Cubano', 'Puerto Voxel', 'Bloquilla', 'Tokubo', 'Lagoxel', 'Pixalco', 'Seoblok', 'Kairoxel'];
const WORLD_SUFFIX = ['Stars', 'Club', 'United', 'Deportivo', 'City'];
const WORLD_NATIONS = ['SOUTH VOXICA', 'EAST PIXIA', 'CUBAFRICA', 'NORTH BLOKICA'];

const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

function shuffle<T>(rng: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function randomKit(rng: Rng): Kit {
  const cols = Object.values(KIT_COLORS) as number[];
  const shirt = rng.pick(cols);
  let shirt2 = rng.pick(cols);
  if (shirt2 === shirt) shirt2 = shirt === KIT_COLORS.white ? KIT_COLORS.black : KIT_COLORS.white;
  const patterns: KitPattern[] = ['plain', 'stripes', 'hoops', 'halves', 'sash', 'sleeves'];
  return { shirt, shirt2, pattern: rng.pick(patterns), shorts: rng.chance(0.5) ? KIT_COLORS.white : shirt2, socks: shirt, gk: rng.pick([KIT_COLORS.lime, KIT_COLORS.orange, KIT_COLORS.pink]) };
}

/** `n` clubs from abroad around `level` (names and short codes kept apart from `taken`). */
function foreignClubs(rng: Rng, n: number, level: number, spread: number, world: boolean, taken: Set<string>): CompClub[] {
  const out: CompClub[] = [];
  const formations: FormationId[] = ['4-4-2', '4-3-3', '4-2-3-1', '3-5-2'];
  for (let i = 0; out.length < n && i < 200; i++) {
    const city = rng.pick(world ? WORLD_CITIES : CITIES);
    const name = world ? `${city} ${rng.pick(WORLD_SUFFIX)}` : `${rng.pick(PREFIX)} ${city}`;
    const short = city.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
    if (taken.has(name.toLowerCase()) || taken.has(short)) continue;
    taken.add(name.toLowerCase());
    taken.add(short);
    const lvl = clampInt(level + rng.int(spread * 2 + 1) - spread, 1, 99);
    const c: CompClub = {
      id: `${world ? 'w' : 'e'}${out.length + 1}`, name, short, kit: randomKit(rng), formation: rng.pick(formations), level: lvl, rating: 0,
      nation: rng.pick(world ? WORLD_NATIONS : NATIONS),
    };
    c.rating = rivalRating(c);
    out.push(c);
  }
  return out;
}

const fx = (after: number, stage: CompStage, group: number, home: string, away: string): CompFixture => ({ after, stage, group, home, away, hg: null, ag: null, pens: null });

/** This season's CONTINENTAL CUP draw (Elite League seasons). `own`: your club (kept unique in the draw). */
export function drawContinental(seasonSeed: number, own: { name: string; short: string }, league: readonly LeagueClub[]): Competition {
  const seed = hashString(`${seasonSeed}|continental`) >>> 0;
  const rng = new Rng(seed);
  const taken = new Set<string>([own.name.toLowerCase(), own.short, ...league.flatMap((c) => [c.name.toLowerCase(), c.short])]);
  const clubs = foreignClubs(rng, 7, divisionLevel(1), 4, false, taken);
  const ids = shuffle(rng, clubs.map((c) => c.id));
  const groups = [[YOU, ...ids.slice(0, 3)], ids.slice(3, 7)].map((g) => shuffle(rng, g));
  const fixtures: CompFixture[] = [];
  // One round robin per group of four: (0 v 1, 2 v 3), (0 v 2, 3 v 1), (3 v 0, 1 v 2).
  const rounds: [number, number][][] = [[[0, 1], [2, 3]], [[0, 2], [3, 1]], [[3, 0], [1, 2]]];
  rounds.forEach((pairs, r) => {
    groups.forEach((g, gi) => pairs.forEach(([a, b]) => fixtures.push(fx(CONT_GROUP_AFTER[r], 'group', gi, g[a], g[b]))));
  });
  fixtures.push(fx(CONT_SF_AFTER, 'sf', -1, '', ''), fx(CONT_SF_AFTER, 'sf', -1, '', ''), fx(CONT_FINAL_AFTER, 'final', -1, '', ''));
  return { kind: 'continental', seed, clubs, groups, fixtures, status: 'active', earned: 0, celebrated: false };
}

/** The WORLD CLUB CUP: you and three champions from other continents; the strongest is kept for the final. */
export function drawWorld(seasonSeed: number, own: { name: string; short: string }): Competition {
  const seed = hashString(`${seasonSeed}|world`) >>> 0;
  const rng = new Rng(seed);
  const clubs = foreignClubs(rng, 3, divisionLevel(1) + 3, 3, true, new Set([own.name.toLowerCase(), own.short]));
  const order = [...clubs].sort((a, b) => b.rating - a.rating);
  // You play the weaker of the other two in your semi final; the favourite waits in the other half.
  const fixtures = [
    fx(WORLD_AFTER, 'sf', -1, YOU, order[2].id),
    fx(WORLD_AFTER, 'sf', -1, order[0].id, order[1].id),
    fx(WORLD_AFTER, 'final', -1, '', ''),
  ];
  return { kind: 'world', seed, clubs, groups: [], fixtures, status: 'active', earned: 0, celebrated: false };
}

// ------------------------------------------------------------------ reading the state

export type Rate = (id: string) => number;

const isUser = (f: CompFixture) => f.home === YOU || f.away === YOU;
const played = (f: CompFixture) => f.hg !== null && f.ag !== null;

export function compClub(comp: Competition, id: string): CompClub | undefined {
  return comp.clubs.find((c) => c.id === id);
}

/** Winner of a played fixture ('' for a group draw or an unplayed one). */
export function fixtureWinner(f: CompFixture): string {
  if (!played(f)) return '';
  if (f.hg! !== f.ag!) return f.hg! > f.ag! ? f.home : f.away;
  if (!f.pens) return '';
  return f.pens[0] > f.pens[1] ? f.home : f.away;
}

/** A group's table (your club named "you" here: the UI names it). */
export function groupTable(comp: Competition, gi: number): TableRow[] {
  const ids = comp.groups[gi] ?? [];
  const fixtures: Fixture[] = comp.fixtures
    .filter((f) => f.stage === 'group' && f.group === gi)
    .map((f) => ({ md: 0, home: f.home, away: f.away, hg: f.hg, ag: f.ag }));
  return computeTable(ids.map((id) => ({ id, name: id === YOU ? 'zzz' : compClub(comp, id)?.name ?? id })), fixtures);
}

/** Your fixture due now (index into `fixtures`), or -1. `matchday` = league matchdays played. */
export function compDue(comp: Competition | null | undefined, matchday: number): number {
  if (!comp || comp.status !== 'active') return -1;
  return comp.fixtures.findIndex((f) => isUser(f) && !played(f) && f.after <= matchday && f.home !== '' && f.away !== '');
}

/** The furthest you got: 0 the group (or, in the World Club Cup, its semi), 1 the semi, 2 the final, 3 winners. */
export function compReached(comp: Competition): number {
  if (comp.status === 'won') return 3;
  const mine = comp.fixtures.filter(isUser);
  if (mine.some((f) => f.stage === 'final')) return 2;
  if (comp.kind === 'continental' && mine.some((f) => f.stage === 'sf')) return 1;
  return comp.kind === 'world' ? 1 : 0;
}

/** How a run ended (COMP_FINISH index), or -1 while still in it. */
export function compFinish(comp: Competition): number {
  if (comp.status === 'won') return 3;
  if (comp.status === 'active') return -1;
  const mine = comp.fixtures.filter(isUser);
  if (mine.some((f) => f.stage === 'final')) return 2;
  if (mine.some((f) => f.stage === 'sf')) return 1;
  return 0;
}

// ------------------------------------------------------------------ moving it on

function simulate(comp: Competition, idx: number, rate: Rate): void {
  const f = comp.fixtures[idx];
  const rng = new Rng(hashString(`comp:${comp.seed}:${idx}`));
  const [hg, ag] = simulateScore(rng, rate(f.home), rate(f.away));
  f.hg = hg;
  f.ag = ag;
  f.pens = f.stage !== 'group' && hg === ag ? simulateShootout(rng, rate(f.home), rate(f.away)) : null;
}

/** Fill the knockout ties once the stage before them is complete; you're out when you don't go through. */
function drawKnockouts(comp: Competition): boolean {
  let changed = false;
  const sfs = comp.fixtures.filter((f) => f.stage === 'sf');
  const fin = comp.fixtures.find((f) => f.stage === 'final')!;
  if (comp.kind === 'continental' && sfs[0].home === '') {
    const groupsDone = comp.fixtures.filter((f) => f.stage === 'group').every(played);
    if (!groupsDone) return false;
    const [a, b] = [groupTable(comp, 0), groupTable(comp, 1)];
    Object.assign(sfs[0], { home: a[0].id, away: b[1].id });
    Object.assign(sfs[1], { home: b[0].id, away: a[1].id });
    if (comp.status === 'active' && !sfs.some(isUser)) comp.status = 'out';
    changed = true;
  }
  if (fin.home === '' && sfs.every(played)) {
    fin.home = fixtureWinner(sfs[0]);
    fin.away = fixtureWinner(sfs[1]);
    if (comp.status === 'active' && !isUser(fin)) comp.status = 'out';
    changed = true;
  }
  return changed;
}

/**
 * Bring the competition up to the calendar (`matchday` = league matchdays played; Infinity settles it all): every
 * other fixture due by then is played, and the knockouts are drawn as stages complete. Your own fixtures wait for
 * you (finishSeason settles a leftover one as a walk-over first).
 */
export function advanceComp(comp: Competition, matchday: number, rate: Rate): void {
  for (let guard = 0; guard < 6; guard++) {
    let changed = false;
    comp.fixtures.forEach((f, i) => {
      if (played(f) || f.after > matchday || f.home === '' || f.away === '' || isUser(f)) return;
      simulate(comp, i, rate);
      changed = true;
    });
    if (drawKnockouts(comp)) changed = true;
    if (!changed) return;
  }
}

function prizeFor(comp: Competition, stage: CompStage): number {
  const table = comp.kind === 'world' ? WORLD_PRIZE : CONT_PRIZE;
  return table[stage];
}

/**
 * Record your fixture due now: goals for and against, `won` settles a level knockout (the shootout), `pens` its goals
 * [yours, theirs]. Returns the outcome (its prize to pay with the match), or null when nothing is due (a stale request).
 */
export function recordComp(
  comp: Competition, matchday: number, rate: Rate, my: number, their: number, won: boolean, pens: [number, number] | null = null,
): CompOutcome | null {
  const idx = compDue(comp, matchday);
  if (idx < 0) return null;
  const f = comp.fixtures[idx];
  const home = f.home === YOU;
  const mine = Math.max(0, Math.round(my));
  const theirs = Math.max(0, Math.round(their));
  f.hg = home ? mine : theirs;
  f.ag = home ? theirs : mine;
  f.pens = null;
  let win = mine > theirs;
  if (f.stage !== 'group' && mine === theirs) {
    win = won;
    const p: [number, number] = pens && pens[0] !== pens[1] && pens[0] > pens[1] === won ? pens : won ? [1, 0] : [0, 1];
    f.pens = home ? p : [p[1], p[0]];
  }
  let coins = win ? prizeFor(comp, f.stage) : 0;
  const trophy = win && f.stage === 'final';
  if (trophy) {
    coins += comp.kind === 'world' ? WORLD_PRIZE.trophy : CONT_PRIZE.trophy;
    comp.status = 'won';
  } else if (!win && f.stage !== 'group') {
    comp.status = 'out';
  }
  comp.earned += coins;
  advanceComp(comp, matchday, rate);
  return { kind: comp.kind, stage: f.stage, won: win, trophy, coins };
}

/** Close it at the season's end: a fixture of yours still due is a walk-over defeat (no prize), the rest is settled. */
export function settleComp(comp: Competition, rate: Rate): void {
  for (let guard = 0; guard < 6 && compDue(comp, Number.MAX_SAFE_INTEGER) >= 0; guard++) recordComp(comp, Number.MAX_SAFE_INTEGER, rate, 0, 3, false);
  advanceComp(comp, Number.MAX_SAFE_INTEGER, rate);
  if (comp.status === 'active') comp.status = 'out';
}

// ------------------------------------------------------------------ save

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const goals = (v: unknown) => (v === null ? null : isNum(v) ? clampInt(v, 0, 99) : undefined);

/**
 * A saved competition, validated (`readClub` is career.ts's club reader), or null when anything is off: a season
 * whose competition is unreadable just plays on without it.
 */
export function readComp(v: unknown, readClub: (x: unknown) => LeagueClub | null): Competition | null {
  if (!isObj(v) || (v.kind !== 'continental' && v.kind !== 'world')) return null;
  if (!Array.isArray(v.clubs) || !Array.isArray(v.fixtures) || !Array.isArray(v.groups)) return null;
  if (v.status !== 'active' && v.status !== 'won' && v.status !== 'out') return null;
  const clubs: CompClub[] = [];
  for (const x of v.clubs) {
    const c = readClub(x);
    if (!c || !isObj(x)) return null;
    clubs.push({ ...c, nation: typeof x.nation === 'string' ? x.nation.slice(0, 24) : '' });
  }
  const ids = new Set([YOU, ...clubs.map((c) => c.id)]);
  const known = (s: unknown): s is string => typeof s === 'string' && (s === '' || ids.has(s));
  const groups = v.groups.map((g) => (Array.isArray(g) ? g.filter((s): s is string => typeof s === 'string' && ids.has(s)) : []));
  const fixtures: CompFixture[] = [];
  for (const x of v.fixtures) {
    if (!isObj(x) || !known(x.home) || !known(x.away) || (x.stage !== 'group' && x.stage !== 'sf' && x.stage !== 'final')) return null;
    const hg = goals(x.hg);
    const ag = goals(x.ag);
    if (hg === undefined || ag === undefined || (hg === null) !== (ag === null)) return null;
    let pens: [number, number] | null = null;
    if (Array.isArray(x.pens) && x.pens.length === 2 && isNum(x.pens[0]) && isNum(x.pens[1])) pens = [clampInt(x.pens[0], 0, 99), clampInt(x.pens[1], 0, 99)];
    fixtures.push({ after: clampInt(isNum(x.after) ? x.after : 0, 0, 7), stage: x.stage, group: clampInt(isNum(x.group) ? x.group : -1, -1, 1), home: x.home, away: x.away, hg, ag, pens });
  }
  if (!fixtures.length) return null;
  return {
    kind: v.kind,
    seed: isNum(v.seed) ? v.seed >>> 0 : 1,
    clubs,
    groups,
    fixtures,
    status: v.status,
    earned: isNum(v.earned) ? clampInt(v.earned, 0, 1e9) : 0,
    celebrated: v.celebrated === true,
  };
}
