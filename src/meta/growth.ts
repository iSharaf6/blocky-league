/**
 * RPG PLAYER DEVELOPMENT (the owner: "Training young players over multiple seasons, watching their attributes grow,
 * and mentoring them through veteran squad members").
 *
 * - POTENTIAL: the overall a player can grow into (`ceil`). Natural growth stops there; paid +2 sessions do not.
 * - A GROWTH CURVE BY AGE: teenagers learn fastest, it tails off through the twenties and stops at 31.
 * - XP: every league matchday the whole squad trains (a little XP each); playing a match pays much more, a goal a
 *   little on top. A full bar is a stat point on each stat of his TRAINING FOCUS.
 * - A TRAINING FOCUS: one of three per player (or set for a whole position group in one tap).
 * - MENTORS: a veteran (28 or older) takes a youngster (21 or younger) of his position under his wing: 25% more XP,
 *   and after ten matchdays one of the veteran's traits rubs off.
 * - TRAITS: leader, hot head, big game player, loyal, ambitious, super sub. They steer the event cards
 *   (meta/events.ts) and give small tendencies on the pitch (`traitLift`).
 * - THE CHART: his overall at every half season with you (`hist`), drawn on the player card with his potential.
 *
 * Pure rules and state, no DOM. Everything is a few optional fields on the squad player (missing on old saves: the
 * potential and the traits are then derived from who he is, and pinned the first time he grows).
 *
 * Runtime import cycle with career.ts / market.ts / life.ts: their bindings are only used inside functions.
 */
import { hashString } from '../core/rng';
import { overall, type PlayerDef, type PlayerStats, type Role } from '../sim/types';
import { STAT_CAP, type CareerState, type ClubState } from './career';
import { has } from './ground';
import { prospectCeiling, type LifePlayer } from './life';
import { YOUNG_AGE, playerAge } from './market';
import { staffLevel } from './staff';

export type TraitId = 'leader' | 'hothead' | 'biggame' | 'loyal' | 'ambitious' | 'supersub';
export type FocusId = 'sharp' | 'athlete' | 'allround';

/** A squad player with everything the long game keeps on him (all optional: old saves have none of it). */
export interface GrowPlayer extends LifePlayer {
  /** POTENTIAL: the overall he can grow into. */
  ceil?: number;
  /** XP towards the next stat point (0..XP_LEVEL). */
  xp?: number;
  /** Training focus (missing: all round). */
  focus?: FocusId;
  /** Personality (at most two). */
  traits?: TraitId[];
  /** Squad id of the veteran mentoring him, and the league matchdays it has lasted. */
  mentor?: string;
  mentored?: number;
  /** His overall at each half season with you, oldest first (the growth chart). */
  hist?: number[];
  /** Morale 0..100 (meta/morale.ts; missing: 60). */
  mor?: number;
  /** League matchdays he is out injured. */
  inj?: number;
  /** League matchdays in a row without starting, and in a row starting (playing time, partnerships). */
  sat?: number;
  run?: number;
  /** His contract runs out and he goes at the season's end (he asked for a new one and got none). */
  leaving?: boolean;
}

export const TRAITS: readonly TraitId[] = ['leader', 'hothead', 'biggame', 'loyal', 'ambitious', 'supersub'];
export const FOCUSES: readonly FocusId[] = ['sharp', 'athlete', 'allround'];

export interface TraitInfo {
  name: string;
  /** Pixel icon (ui/pixelIcons.ts). */
  icon: string;
  /** What it does, in a few words. */
  does: string;
}

export const TRAIT_INFO: Record<TraitId, TraitInfo> = {
  leader: { name: 'LEADER', icon: 'shield', does: 'LIFTS THE DRESSING ROOM' },
  hothead: { name: 'HOT HEAD', icon: 'fire', does: 'FIERY: TACKLES HARD, CLASHES EASILY' },
  biggame: { name: 'BIG GAME', icon: 'trophy', does: '+2 IN DERBIES AND FINALS' },
  loyal: { name: 'LOYAL', icon: 'shirt', does: 'STAYS, AND SIGNS FOR LESS' },
  ambitious: { name: 'AMBITIOUS', icon: 'star', does: 'LEARNS FAST, WANTS THE TOP' },
  supersub: { name: 'SUPER SUB', icon: 'swap', does: '+2 OFF THE BENCH, HAPPY THERE' },
};

/** The three focuses of each position: what it is called and the stats a full XP bar adds a point to. */
export const FOCUS_INFO: Record<Role, Record<FocusId, { name: string; stats: readonly (keyof PlayerStats)[] }>> = {
  GK: {
    sharp: { name: 'SHOT STOPPING', stats: ['keeping', 'keeping', 'defending'] },
    athlete: { name: 'SWEEPER', stats: ['pace', 'passing', 'keeping'] },
    allround: { name: 'ALL ROUND', stats: ['keeping', 'passing', 'defending'] },
  },
  DF: {
    sharp: { name: 'TACKLING', stats: ['defending', 'defending', 'stamina'] },
    athlete: { name: 'PACE', stats: ['pace', 'stamina', 'defending'] },
    allround: { name: 'ALL ROUND', stats: ['defending', 'passing', 'pace'] },
  },
  MF: {
    sharp: { name: 'PLAYMAKER', stats: ['passing', 'passing', 'dribbling'] },
    athlete: { name: 'ENGINE', stats: ['stamina', 'pace', 'defending'] },
    allround: { name: 'ALL ROUND', stats: ['passing', 'dribbling', 'shooting'] },
  },
  FW: {
    sharp: { name: 'FINISHING', stats: ['shooting', 'shooting', 'dribbling'] },
    athlete: { name: 'PACE', stats: ['pace', 'pace', 'stamina'] },
    allround: { name: 'ALL ROUND', stats: ['shooting', 'pace', 'dribbling'] },
  },
};

/** XP that fills the bar (a stat point on each stat of the focus). */
export const XP_LEVEL = 100;
/** The week's training, for everyone in the squad, every league matchday. */
export const XP_TRAIN = 12;
/** Starting a match, coming on in one, and a goal on top. */
export const XP_START = 22;
export const XP_SUB = 11;
export const XP_GOAL = 5;
/** A mentored youngster learns this much faster; the TRAINING GROUND and the ambitious learn a little faster too. */
export const MENTOR_BOOST = 0.25;
export const GROUND_BOOST = 0.1;
export const AMBITION_BOOST = 0.1;
/** The assistant coach's training speed by level (0 none .. 3). */
export const ASSISTANT_BOOST = [0, 0.15, 0.3, 0.5] as const;
/** League matchdays of mentoring before a trait rubs off. */
export const MENTOR_TRAIT_AFTER = 10;
export const MENTOR_MIN_AGE = 28;
export const PUPIL_MAX_AGE = 21;
/** Points of the chart kept (two a season: about eight seasons). */
export const HIST_MAX = 16;
/** How far over what the years alone would bring a young player's potential lies (playing and training earn it). */
export const CEIL_HEADROOM = 4;

const grow = (p: PlayerDef) => p as GrowPlayer;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// ------------------------------------------------------------------ potential and the curve

/** How fast a player of this age learns (1 at 19 and under, nothing from 31). */
export function ageRate(age: number): number {
  if (age <= 19) return 1;
  if (age <= 21) return 0.8;
  if (age <= YOUNG_AGE) return 0.6;
  if (age <= 27) return 0.3;
  if (age <= 30) return 0.12;
  return 0;
}

/** The potential a player has when none is pinned yet: what the years would bring a young one, and a little more. */
function derivedCeil(p: PlayerDef): number {
  const age = playerAge(p);
  const ovr = overall(p);
  if (age <= YOUNG_AGE) return Math.min(STAT_CAP, prospectCeiling(p) + CEIL_HEADROOM);
  if (age <= 27) return Math.min(STAT_CAP, ovr + (28 - age));
  return ovr;
}

/** POTENTIAL: the overall he can grow into (never under what he already is). */
export function ceilOf(p: PlayerDef): number {
  const c = grow(p).ceil;
  const ovr = overall(p);
  return typeof c === 'number' && Number.isFinite(c) ? clamp(Math.max(Math.round(c), ovr), 1, STAT_CAP) : derivedCeil(p);
}

/** Pin his potential (before he grows or is trained, so growing never moves the goal). */
export function pinCeil(p: PlayerDef): number {
  const g = grow(p);
  if (typeof g.ceil !== 'number' || !Number.isFinite(g.ceil)) g.ceil = derivedCeil(p);
  return g.ceil;
}

/** Can he still grow by himself (the yearly growth and XP both stop at his potential)? */
export function hasRoom(p: PlayerDef): boolean {
  return overall(p) < ceilOf(p);
}

// ------------------------------------------------------------------ traits

/** His traits: the pinned ones, else what his name says (about four players in ten have one). */
export function traitsOf(p: PlayerDef): TraitId[] {
  const t = grow(p).traits;
  if (Array.isArray(t)) return t.filter((x) => TRAITS.includes(x)).slice(0, 2);
  const h = hashString(`${p.name}|trait`);
  return h % 100 < 40 ? [TRAITS[(h >>> 8) % TRAITS.length]] : [];
}

export function hasTrait(p: PlayerDef, t: TraitId): boolean {
  return traitsOf(p).includes(t);
}

/** Give him a trait (at most two, never the same twice). False when he has no room for it. */
export function addTrait(p: PlayerDef, t: TraitId): boolean {
  const cur = traitsOf(p);
  if (cur.includes(t) || cur.length >= 2) return false;
  grow(p).traits = [...cur, t];
  return true;
}

/**
 * The small tendency a trait gives on the day, in stat points: a BIG GAME player in a derby, a decider or a final,
 * a SUPER SUB on the bench, a HOT HEAD who tackles harder and passes worse.
 */
export function traitLift(p: PlayerDef, ctx: { big: boolean; bench: boolean }): Partial<Record<keyof PlayerStats, number>> | number {
  const t = traitsOf(p);
  let all = 0;
  if (ctx.big && t.includes('biggame')) all += 2;
  if (ctx.bench && t.includes('supersub')) all += 2;
  if (t.includes('hothead')) return { pace: all + 1, shooting: all, passing: all - 2, dribbling: all, defending: all + 2, keeping: all, stamina: all };
  return all;
}

// ------------------------------------------------------------------ the training focus

export function focusOf(p: PlayerDef): FocusId {
  const f = grow(p).focus;
  return f && FOCUSES.includes(f) ? f : 'allround';
}

export function setFocus(club: ClubState, playerId: string, focus: FocusId): boolean {
  const p = club.squad.find((x) => x.id === playerId);
  if (!p || !FOCUSES.includes(focus)) return false;
  grow(p).focus = focus;
  return true;
}

/** One tap: the same focus for everyone in a position. Returns how many it changed. */
export function setGroupFocus(club: ClubState, role: Role, focus: FocusId): number {
  if (!FOCUSES.includes(focus)) return 0;
  let n = 0;
  for (const p of club.squad) {
    if (p.role !== role || focusOf(p) === focus) continue;
    grow(p).focus = focus;
    n++;
  }
  return n;
}

// ------------------------------------------------------------------ XP

/** What multiplies his XP: his age, the assistant coach, the training ground, a mentor, his ambition. */
export function xpRate(state: CareerState, p: PlayerDef): number {
  const rate = ageRate(playerAge(p));
  if (!rate) return 0;
  let boost = ASSISTANT_BOOST[staffLevel(state, 'assistant')] ?? 0;
  if (has(state.ground, 'training')) boost += GROUND_BOOST;
  if (mentorOf(state.club, p)) boost += MENTOR_BOOST;
  if (hasTrait(p, 'ambitious')) boost += AMBITION_BOOST;
  return rate * (1 + boost);
}

/** A full bar: a point on each stat of his focus (twice on a stat named twice). */
function levelUp(p: PlayerDef): void {
  for (const k of FOCUS_INFO[p.role][focusOf(p)].stats) p.stats[k] = Math.min(STAT_CAP, p.stats[k] + 1);
}

/**
 * Give him `base` XP (scaled by `xpRate`). Every full bar is a level up while he is under his potential; at his
 * potential the bar simply stays full. Returns the overall points he gained.
 */
export function gainXp(state: CareerState, p: PlayerDef, base: number): number {
  const g = grow(p);
  const rate = xpRate(state, p);
  if (!(base > 0) || !rate) return 0;
  pinCeil(p);
  const before = overall(p);
  let xp = Math.max(0, Math.round(g.xp ?? 0)) + Math.round(base * rate);
  for (let guard = 0; guard < 6 && xp >= XP_LEVEL && hasRoom(p); guard++) {
    xp -= XP_LEVEL;
    levelUp(p);
  }
  g.xp = Math.min(XP_LEVEL, xp);
  return overall(p) - before;
}

// ------------------------------------------------------------------ mentors

/** The veteran mentoring him (still in the squad), or undefined. */
export function mentorOf(club: ClubState | null, p: PlayerDef): PlayerDef | undefined {
  const id = grow(p).mentor;
  return id && club ? club.squad.find((q) => q.id === id && q.id !== p.id) : undefined;
}

/** The youngster a veteran is mentoring, or undefined. */
export function pupilOf(club: ClubState, vet: PlayerDef): PlayerDef | undefined {
  return club.squad.find((q) => grow(q).mentor === vet.id && q.id !== vet.id);
}

export function canMentor(vet: PlayerDef, kid: PlayerDef): boolean {
  return vet.id !== kid.id && vet.role === kid.role && playerAge(vet) >= MENTOR_MIN_AGE && playerAge(kid) <= PUPIL_MAX_AGE && overall(vet) >= overall(kid);
}

/** The veterans who could mentor this youngster (free ones first, then the best). */
export function mentorsFor(club: ClubState, kid: PlayerDef): PlayerDef[] {
  return club.squad
    .filter((v) => canMentor(v, kid))
    .sort((a, b) => Number(!!pupilOf(club, a)) - Number(!!pupilOf(club, b)) || overall(b) - overall(a));
}

/** Put a youngster under a veteran's wing (or end it with null). A veteran has one pupil at a time. */
export function setMentor(club: ClubState, kidId: string, vetId: string | null): boolean {
  const kid = club.squad.find((p) => p.id === kidId);
  if (!kid) return false;
  const g = grow(kid);
  if (vetId === null) {
    delete g.mentor;
    delete g.mentored;
    return true;
  }
  const vet = club.squad.find((p) => p.id === vetId);
  if (!vet || !canMentor(vet, kid)) return false;
  const other = pupilOf(club, vet);
  if (other && other.id !== kid.id) {
    delete grow(other).mentor;
    delete grow(other).mentored;
  }
  if (g.mentor !== vet.id) g.mentored = 0;
  g.mentor = vet.id;
  return true;
}

/**
 * One tap: every youngster with the most to gain gets the best free veteran of his position. Returns the pairs made.
 */
export function autoMentors(club: ClubState): { kid: PlayerDef; vet: PlayerDef }[] {
  const out: { kid: PlayerDef; vet: PlayerDef }[] = [];
  const kids = club.squad
    .filter((p) => playerAge(p) <= PUPIL_MAX_AGE && !mentorOf(club, p))
    .sort((a, b) => ceilOf(b) - overall(b) - (ceilOf(a) - overall(a)) || overall(b) - overall(a));
  for (const kid of kids) {
    const vet = mentorsFor(club, kid).find((v) => !pupilOf(club, v));
    if (vet && setMentor(club, kid.id, vet.id)) out.push({ kid, vet });
  }
  return out;
}

/** The trait a veteran passes on: one of his own that can be taught, else the bond with the club (loyal). */
export function mentorTrait(vet: PlayerDef): TraitId {
  const teach: TraitId[] = ['leader', 'biggame', 'supersub', 'loyal'];
  return traitsOf(vet).find((t) => teach.includes(t)) ?? 'loyal';
}

/**
 * A league matchday of mentoring: pairs whose veteran has gone are ended; a pair that reaches MENTOR_TRAIT_AFTER
 * matchdays passes a trait on (once). Returns what was learned, for the story.
 */
export function tickMentors(club: ClubState): { kid: PlayerDef; vet: PlayerDef; trait: TraitId }[] {
  const out: { kid: PlayerDef; vet: PlayerDef; trait: TraitId }[] = [];
  for (const kid of club.squad) {
    const g = grow(kid);
    if (!g.mentor) continue;
    const vet = mentorOf(club, kid);
    if (!vet || playerAge(kid) > PUPIL_MAX_AGE + 2) {
      delete g.mentor;
      delete g.mentored;
      continue;
    }
    g.mentored = Math.min(999, Math.round(g.mentored ?? 0) + 1);
    if (g.mentored === MENTOR_TRAIT_AFTER) {
      const trait = mentorTrait(vet);
      if (addTrait(kid, trait)) out.push({ kid, vet, trait });
    }
  }
  return out;
}

// ------------------------------------------------------------------ the chart

/** A point on everyone's chart (his overall now): at the start of a season and at its halfway point. */
export function snapshotGrowth(club: ClubState): void {
  for (const p of club.squad) {
    const g = grow(p);
    g.hist = [...(g.hist ?? []), overall(p)].slice(-HIST_MAX);
  }
}

/** The chart's points: his history, then where he is now. */
export function growthChart(p: PlayerDef): { points: number[]; ceil: number } {
  const hist = (grow(p).hist ?? []).filter((v) => typeof v === 'number' && Number.isFinite(v));
  const now = overall(p);
  const points = hist.length && hist[hist.length - 1] === now ? [...hist] : [...hist, now];
  return { points, ceil: ceilOf(p) };
}

// ------------------------------------------------------------------ save

type Obj = Record<string, unknown>;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const int = (v: unknown, lo: number, hi: number): number | undefined => (isNum(v) ? clamp(Math.round(v), lo, hi) : undefined);

/** The long game's fields of a saved player, validated onto `p` (only the ones the save has). */
export function readGrow(v: Obj, p: PlayerDef): void {
  const g = grow(p);
  const set = <K extends keyof GrowPlayer>(k: K, val: GrowPlayer[K] | undefined) => {
    if (val !== undefined) g[k] = val;
  };
  set('ceil', int(v.ceil, 1, STAT_CAP));
  set('xp', int(v.xp, 0, XP_LEVEL));
  if (FOCUSES.includes(v.focus as FocusId)) g.focus = v.focus as FocusId;
  if (Array.isArray(v.traits)) g.traits = [...new Set(v.traits.filter((t): t is TraitId => TRAITS.includes(t as TraitId)))].slice(0, 2);
  if (typeof v.mentor === 'string' && v.mentor.length <= 16) g.mentor = v.mentor;
  set('mentored', int(v.mentored, 0, 999));
  if (Array.isArray(v.hist)) g.hist = v.hist.filter(isNum).slice(-HIST_MAX).map((n) => clamp(Math.round(n), 1, STAT_CAP));
  set('mor', int(v.mor, 0, 100));
  set('inj', int(v.inj, 0, 12));
  set('sat', int(v.sat, 0, 99));
  set('run', int(v.run, 0, 999));
  if (v.leaving === true) g.leaving = true;
}
