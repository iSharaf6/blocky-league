/**
 * CLUB LEGACY: the number that keeps rising, forever. Trophies, promotions, board objectives, records and legends all
 * add legacy points; levels unlock small perks that stay with you for good (also with the next club you start as a
 * legend). The HALL OF FAME keeps your legends (players who gave the most) and every club you built before. The
 * dynasty goal is the TREBLE: the Elite League, the Blocky Cup and the Continental Cup in one season.
 * Pure rules and state; the screen is the CLUB tab of the ROAD TO GLORY hub (ui/career.ts).
 */
import type { Kit, Role } from '../sim/types';
import type { CareerState } from './career';
import { addMoment } from './story';

export interface Legend {
  /** `${gen}:${player id}`: unique across your clubs. */
  key: string;
  name: string;
  role: Role;
  club: string;
  apps: number;
  goals: number;
  /** Season he retired or left in. */
  season: number;
  /** Why he is a legend ("100 GOALS", "200 APPEARANCES", "CLUB CAPTAIN"). */
  why: string;
}

export interface ClubRecords {
  topScorer: { name: string; goals: number } | null;
  mostApps: { name: string; apps: number } | null;
  biggestWin: { my: number; their: number; vs: string; season: number } | null;
  recordSigning: { name: string; paid: number; season: number } | null;
}

/** A club you built and left to start again as a legend (it stays in the Hall of Fame). */
export interface PastClub {
  name: string;
  short: string;
  kit: Kit;
  seasons: number;
  titles: number;
  cups: number;
  continental: number;
  world: number;
  /** Best division reached (1 = the Elite League). */
  best: number;
}

export interface LegacyEvent {
  season: number;
  text: string;
  points: number;
}

export interface LegacyState {
  points: number;
  /** Your clubs so far, minus one: 0 while on the first. Player keys carry it, so two clubs' c7 never mix. */
  gen: number;
  legends: Legend[];
  past: PastClub[];
  records: ClubRecords;
  /** Milestones already celebrated (keys), so none is said twice. */
  milestones: string[];
  trebles: number;
  /** Newest first. */
  log: LegacyEvent[];
}

export interface Perk {
  level: number;
  id: 'scouts' | 'gate' | 'coach' | 'legend' | 'budget';
  text: string;
}

export const LEGACY_PERKS: readonly Perk[] = [
  { level: 2, id: 'scouts', text: 'ACADEMY PROSPECTS +1 STAR' },
  { level: 3, id: 'gate', text: '+5% MATCH COINS' },
  { level: 5, id: 'coach', text: 'TRAINING 10% CHEAPER' },
  { level: 7, id: 'legend', text: 'NEW CLUBS START 4 OVR STRONGER' },
  { level: 10, id: 'budget', text: '+10% WAGE BUDGET' },
];

/** Legacy points for the big things (the division scales a title). */
export const LEGACY_POINTS = {
  title: (division: number) => 100 + 40 * (6 - Math.max(1, Math.min(6, division))),
  promotion: 60,
  cup: 80,
  cupFinal: 30,
  continental: 300,
  world: 500,
  treble: 400,
  objective: 15,
  legend: 25,
  milestone: 5,
  record: 5,
} as const;

/** The legend perk: a new club's squad starts this much stronger. */
export const START_BONUS = 4;
export const LEGENDS_MAX = 40;
export const PAST_MAX = 20;
/** Who makes the Hall of Fame on leaving: this many appearances or goals for you, or the captain's armband. */
export const LEGEND_APPS = 60;
export const LEGEND_GOALS = 30;

export function defaultRecords(): ClubRecords {
  return { topScorer: null, mostApps: null, biggestWin: null, recordSigning: null };
}

export function defaultLegacy(): LegacyState {
  return { points: 0, gen: 0, legends: [], past: [], records: defaultRecords(), milestones: [], trebles: 0, log: [] };
}

/** Points needed to reach level n: 50 n (n + 1), so 100, 300, 600, 1000, 1500... It never runs out. */
export function legacyNeed(level: number): number {
  return 50 * level * (level + 1);
}

export function legacyLevel(points: number): { level: number; into: number; need: number; next: number } {
  let level = 0;
  while (legacyNeed(level + 1) <= points) level++;
  const base = legacyNeed(level);
  const next = legacyNeed(level + 1);
  return { level, into: points - base, need: next - base, next };
}

export function hasPerk(legacy: LegacyState | undefined, id: Perk['id']): boolean {
  const lv = legacyLevel(legacy?.points ?? 0).level;
  return LEGACY_PERKS.some((p) => p.id === id && lv >= p.level);
}

export function nextPerk(points: number): Perk | null {
  const lv = legacyLevel(points).level;
  return LEGACY_PERKS.find((p) => p.level > lv) ?? null;
}

/** Add legacy points (with a line for the log); a new level is a moment on the hub, with the perk it brings. */
export function addLegacy(state: CareerState, points: number, text: string): void {
  if (points <= 0) return;
  const lg = state.legacy;
  const before = legacyLevel(lg.points).level;
  lg.points += Math.round(points);
  lg.log = [{ season: state.season?.number ?? 0, text, points: Math.round(points) }, ...lg.log].slice(0, 12);
  const after = legacyLevel(lg.points).level;
  for (let l = before + 1; l <= after; l++) {
    const perk = LEGACY_PERKS.find((p) => p.level === l);
    addMoment(state, { kind: 'legacy', icon: 'crown', title: `LEGACY LEVEL ${l}`, text: perk ? `NEW PERK: ${perk.text}` : 'YOUR NAME GROWS IN THE GAME' });
  }
}

/** Into the Hall of Fame (once per player). */
export function induct(state: CareerState, l: Omit<Legend, 'key'> & { id: string }): boolean {
  const key = `${state.legacy.gen}:${l.id}`;
  if (state.legacy.legends.some((x) => x.key === key)) return false;
  const { id: _id, ...rest } = l;
  void _id;
  state.legacy.legends = [{ key, ...rest }, ...state.legacy.legends].slice(0, LEGENDS_MAX);
  addLegacy(state, LEGACY_POINTS.legend, `${l.name} INTO THE HALL OF FAME`);
  return true;
}

/** Celebrate a milestone once: true the first time `key` is seen. */
export function milestoneOnce(state: CareerState, key: string): boolean {
  const k = `${state.legacy.gen}:${key}`;
  if (state.legacy.milestones.includes(k)) return false;
  state.legacy.milestones = [...state.legacy.milestones, k].slice(-300);
  return true;
}

/** Can the club be handed on to start again as a legend: after an Elite League title (or a treble). */
export function canStartAsLegend(state: CareerState): boolean {
  return state.history.some((h) => h.division === 1 && h.position === 1) || state.legacy.trebles > 0;
}

/**
 * Start a new club as a legend: the current club goes into the Hall of Fame with its trophies, and the road starts
 * again in the Sunday League with a club you name. Legacy points, perks, legends, coins and cosmetics stay. Returns
 * false (and changes nothing) when it isn't open yet. The caller (career.ts) resets the rest of the career.
 */
export function archiveClub(state: CareerState): boolean {
  const club = state.club;
  if (!club || !canStartAsLegend(state)) return false;
  const lg = state.legacy;
  const h = state.history;
  lg.past = [
    {
      name: club.name, short: club.short, kit: { ...club.kit }, seasons: h.length,
      titles: h.filter((x) => x.position === 1).length,
      cups: h.filter((x) => x.cup === 3).length,
      continental: h.filter((x) => x.continental === 3).length,
      world: h.filter((x) => x.world === 3).length,
      best: h.reduce((b, x) => Math.min(b, x.division), 8),
    },
    ...lg.past,
  ].slice(0, PAST_MAX);
  lg.gen++;
  lg.records = defaultRecords();
  return true;
}

// ------------------------------------------------------------------ save

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const int = (v: unknown, lo: number, hi: number, d: number) => (isNum(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);
const str = (v: unknown, max: number, d = '') => (typeof v === 'string' ? v.slice(0, max) : d);
const ROLES: Role[] = ['GK', 'DF', 'MF', 'FW'];

function readRecords(v: unknown): ClubRecords {
  const r = defaultRecords();
  if (!isObj(v)) return r;
  const o = (x: unknown) => (isObj(x) ? x : null);
  const ts = o(v.topScorer);
  if (ts && typeof ts.name === 'string') r.topScorer = { name: str(ts.name, 40), goals: int(ts.goals, 0, 1e6, 0) };
  const ma = o(v.mostApps);
  if (ma && typeof ma.name === 'string') r.mostApps = { name: str(ma.name, 40), apps: int(ma.apps, 0, 1e6, 0) };
  const bw = o(v.biggestWin);
  if (bw && isNum(bw.my) && isNum(bw.their)) r.biggestWin = { my: int(bw.my, 0, 99, 0), their: int(bw.their, 0, 99, 0), vs: str(bw.vs, 40), season: int(bw.season, 0, 1e6, 0) };
  const rs = o(v.recordSigning);
  if (rs && typeof rs.name === 'string') r.recordSigning = { name: str(rs.name, 40), paid: int(rs.paid, 0, 1e9, 0), season: int(rs.season, 0, 1e6, 0) };
  return r;
}

export function readLegacy(v: unknown, readKit: (x: unknown) => Kit | null): LegacyState {
  const lg = defaultLegacy();
  if (!isObj(v)) return lg;
  lg.points = int(v.points, 0, 1e9, 0);
  lg.gen = int(v.gen, 0, 1e4, 0);
  lg.trebles = int(v.trebles, 0, 1e4, 0);
  lg.records = readRecords(v.records);
  if (Array.isArray(v.legends)) {
    lg.legends = v.legends
      .filter((l): l is Obj => isObj(l) && typeof l.key === 'string' && typeof l.name === 'string' && ROLES.includes(l.role as Role))
      .slice(0, LEGENDS_MAX)
      .map((l) => ({
        key: str(l.key, 40), name: str(l.name, 40), role: l.role as Role, club: str(l.club, 40),
        apps: int(l.apps, 0, 1e6, 0), goals: int(l.goals, 0, 1e6, 0), season: int(l.season, 0, 1e6, 0), why: str(l.why, 40),
      }));
  }
  if (Array.isArray(v.past)) {
    for (const p of v.past.slice(0, PAST_MAX)) {
      if (!isObj(p) || typeof p.name !== 'string') continue;
      const kit = readKit(p.kit);
      if (!kit) continue;
      lg.past.push({
        name: str(p.name, 40), short: str(p.short, 3), kit, seasons: int(p.seasons, 0, 1e6, 0), titles: int(p.titles, 0, 1e6, 0),
        cups: int(p.cups, 0, 1e6, 0), continental: int(p.continental, 0, 1e6, 0), world: int(p.world, 0, 1e6, 0), best: int(p.best, 1, 8, 6),
      });
    }
  }
  if (Array.isArray(v.milestones)) lg.milestones = v.milestones.filter((m): m is string => typeof m === 'string').slice(-300);
  if (Array.isArray(v.log)) {
    lg.log = v.log
      .filter((e): e is Obj => isObj(e) && typeof e.text === 'string')
      .slice(0, 12)
      .map((e) => ({ season: int(e.season, 0, 1e6, 0), text: str(e.text, 80), points: int(e.points, 0, 1e6, 0) }));
  }
  return lg;
}
