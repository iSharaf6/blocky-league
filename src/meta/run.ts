/**
 * Club Run: up to RUN_ROUNDS short matches against a ladder of stronger clubs; a loss ends the run, a draw goes
 * to penalties, and each win picks one of three perks for the rest of the run (docs/DESIGN_REVIEW.md).
 *
 * Rules (pure; ui/run.ts renders them and launches the matches, tests/run.test.ts pins them):
 * - START draws a per-run seed. The seed alone decides the ladder (7 of the preset clubs other than yours,
 *   weakest first by squad rating), every perk offer and the power-up POWER START hands you. Nothing here uses
 *   Math.random.
 * - Every match is a knockout with 1-minute halves: level at full time goes to penalties. Lose (or quit, or leave
 *   mid-match) and the run is over.
 * - After each win in rounds 1 to 6, pick 1 of up to 3 perks. Perks last for the rest of the run, except SOFT DRAW
 *   (weakerNext), which only makes the next match easier and can be offered again. A perk you hold is never
 *   offered twice, so late in a run the offer can shrink.
 * - Milestones for winning rounds 3, 5 and 7 pay coins, XP and a title once ever (RunState.milestones).
 * - The best run is the furthest round reached, with the club you met there ("BEST: ROUND 5 v NORTHWICK").
 */
import type { SaveData } from '../core/save';
import { Rng, hashString } from '../core/rng';
import { KIND_WEIGHTS } from '../sim/blitz';
import { teamRating, type MatchMode, type PowerUpKind, type Side } from '../sim/types';
import { PRESET_CLUBS, makeTeam } from './data';
import { addXp } from './season';

export const RUN_ROUNDS = 7;
export type RunPerkId = 'powerStart' | 'headStart' | 'weakerNext' | 'goldenFirst' | 'xpBoost' | 'keeperBoost';
export const RUN_PERKS: readonly RunPerkId[] = ['powerStart', 'headStart', 'weakerNext', 'goldenFirst', 'xpBoost', 'keeperBoost'];

/** Cards on offer after a win. */
export const RUN_OFFER = 3;
/** Minutes a half in a run match. */
export const RUN_HALF_MINUTES = 1;
/** XP BOOST: this share of each run match's XP again. */
export const RUN_XP_BOOST = 0.2;
/** SAFE HANDS: MatchConfig.keeperBoost for your side. */
export const RUN_KEEPER_BOOST = 0.3;
/** SOFT DRAW: the next opponent's AI plays this many sim difficulty levels lower (MatchConfig.sideDifficulty). */
export const RUN_WEAKER_BY = 1;
/** Crowd and ground grow as the run goes on. */
export const RUN_ATTENDANCE = [0.45, 0.55, 0.65, 0.72, 0.8, 0.9, 1] as const;
export const RUN_STADIUM = [1, 2, 3, 3, 4, 5, 5] as const;
/** Coin multiplier by difficulty (EASY .. LEGEND), as the other modes. */
export const RUN_DIFF_MULT = [0.8, 1, 1.35, 1.7] as const;

export const PERK_INFO: { readonly [k in RunPerkId]: { name: string; text: string; once: boolean } } = {
  powerStart: { name: 'POWER START', text: 'Every match is Blitz, and you kick off holding a power-up.', once: false },
  headStart: { name: 'HEAD START', text: 'Every match kicks off with you 1 goal up.', once: false },
  weakerNext: { name: 'SOFT DRAW', text: 'Your next opponent plays one level easier. Next match only.', once: true },
  goldenFirst: { name: 'GOLDEN FIRST', text: 'Your first goal of every match counts double.', once: false },
  xpBoost: { name: 'XP BOOST', text: '20% more XP from every run match.', once: false },
  keeperBoost: { name: 'SAFE HANDS', text: 'Your keeper reaches further and reacts faster.', once: false },
};

export interface RunMilestone {
  round: number;
  coins: number;
  xp: number;
  title: string;
}

/** Paid once ever, for winning that round. */
export const RUN_MILESTONES: readonly RunMilestone[] = [
  { round: 3, coins: 300, xp: 150, title: 'Run Rookie' },
  { round: 5, coins: 600, xp: 300, title: 'Cup Runner' },
  { round: 7, coins: 1200, xp: 600, title: 'Invincible' },
];

/** The last match of the current (or last) run, for the screen. */
export interface RunLast {
  /** Its round (1-based) and opponent (preset index). */
  round: number;
  vs: number;
  won: boolean;
  /** [you, them] at full time (penalties aside). */
  score: [number, number];
  pens: [number, number] | null;
  /** 'quit': walked off; 'left': the game closed mid-match; 'abandoned': ABANDON between matches. */
  how: 'played' | 'quit' | 'left' | 'abandoned';
}

export interface RunState {
  /** A run in progress (round reached so far, perks held, the club ladder by preset index). */
  active: boolean;
  /** Matches won in this run (0..RUN_ROUNDS); the next match is round + 1. */
  round: number;
  /** Perks picked, in order (perks[i] was picked after winning round i + 1). */
  perks: RunPerkId[];
  ladder: number[];
  /** Best round ever reached, runs started, full clears, milestone rounds already rewarded. */
  best: number;
  runs: number;
  cleared: number;
  milestones: number[];
  /** This run's seed (ladder, offers, the POWER START item). */
  seed: number;
  /** Your club (preset index) and difficulty (0 EASY .. 3 LEGEND) for this run, fixed at the start. */
  club: number;
  difficulty: number;
  /** The perk cards waiting to be picked (empty: nothing to pick). */
  offer: RunPerkId[];
  /** A run match was launched and hasn't reported yet (found like this later: the game closed mid-match). */
  inMatch: boolean;
  /** The club met at the best round (preset index, -1 none) and the best before this run started. */
  bestVs: number;
  startBest: number;
  last: RunLast | null;
  /** What this run has paid so far (match coins, milestone coins, milestone and XP BOOST XP). */
  coins: number;
  xp: number;
}

export function defaultRun(): RunState {
  return {
    active: false, round: 0, perks: [], ladder: [], best: 0, runs: 0, cleared: 0, milestones: [],
    seed: 0, club: 0, difficulty: 1, offer: [], inMatch: false, bestVs: -1, startBest: 0, last: null, coins: 0, xp: 0,
  };
}

const nat = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const isPerk = (x: unknown): x is RunPerkId => typeof x === 'string' && (RUN_PERKS as readonly string[]).includes(x);
const isClub = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0 && (x as number) < PRESET_CLUBS.length;

export function normalizeRun(raw: unknown): RunState {
  const d = defaultRun();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<RunState>;
  const ladder = Array.isArray(r.ladder) ? r.ladder.filter(isClub) : [];
  const st: RunState = {
    active: r.active === true,
    round: Math.min(RUN_ROUNDS, nat(r.round)),
    perks: Array.isArray(r.perks) ? r.perks.filter(isPerk) : [],
    ladder,
    best: Math.min(RUN_ROUNDS, nat(r.best)),
    runs: nat(r.runs),
    cleared: nat(r.cleared),
    milestones: Array.isArray(r.milestones)
      ? [...new Set(r.milestones.filter((x) => RUN_MILESTONES.some((m) => m.round === x)))]
      : [],
    seed: nat(r.seed) >>> 0,
    club: isClub(r.club) ? r.club : 0,
    difficulty: Math.min(3, nat(r.difficulty ?? 1)),
    offer: Array.isArray(r.offer) ? [...new Set(r.offer.filter(isPerk))].slice(0, RUN_OFFER) : [],
    inMatch: r.inMatch === true,
    bestVs: isClub(r.bestVs) ? r.bestVs : -1,
    startBest: Math.min(RUN_ROUNDS, nat(r.startBest)),
    last: normalizeLast(r.last),
    coins: nat(r.coins),
    xp: nat(r.xp),
  };
  // A run that can't be played on (damaged ladder, or every round already won) is over.
  if (st.active && (ladder.length !== RUN_ROUNDS || st.round >= RUN_ROUNDS)) st.active = false;
  if (!st.active) {
    st.offer = [];
    st.inMatch = false;
  }
  return st;
}

function normalizeLast(raw: unknown): RunLast | null {
  if (!raw || typeof raw !== 'object') return null;
  const l = raw as Partial<RunLast>;
  const pair = (v: unknown): [number, number] | null => (Array.isArray(v) && v.length === 2 ? [nat(v[0]), nat(v[1])] : null);
  const how = l.how === 'quit' || l.how === 'left' || l.how === 'abandoned' ? l.how : 'played';
  return {
    round: Math.max(1, Math.min(RUN_ROUNDS, nat(l.round))),
    vs: isClub(l.vs) ? l.vs : -1,
    won: l.won === true,
    score: pair(l.score) ?? [0, 0],
    pens: pair(l.pens),
    how,
  };
}

// ------------------------------------------------------------------ the ladder and the draws

/** A seeded stream for one purpose ('ladder', 'perks', 'power') at one round of a run. */
function rngFor(seed: number, round: number, salt: string): Rng {
  return new Rng((seed ^ hashString(`${salt}:${round}`)) >>> 0);
}

function shuffle<T>(a: T[], rng: Rng): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const ratings = new Map<number, number>();
/** Squad rating (OVR) of a preset club (cached). */
export function presetOvr(i: number): number {
  let r = ratings.get(i);
  if (r === undefined) {
    r = teamRating(makeTeam(PRESET_CLUBS[i]));
    ratings.set(i, r);
  }
  return r;
}

/** The seven opponents of a run (preset indices), weakest first: drawn by the seed from every club but yours. */
export function runLadder(seed: number, club: number): number[] {
  const pool = PRESET_CLUBS.map((_, i) => i).filter((i) => i !== club);
  shuffle(pool, rngFor(seed, 0, 'ladder'));
  return pool
    .slice(0, RUN_ROUNDS)
    .sort((a, b) => presetOvr(a) - presetOvr(b) || PRESET_CLUBS[a].level - PRESET_CLUBS[b].level || a - b);
}

/** The perk cards after the current win: up to RUN_OFFER distinct perks you don't hold (SOFT DRAW always eligible). */
export function drawOffer(state: Pick<RunState, 'seed' | 'round' | 'perks'>): RunPerkId[] {
  const pool = RUN_PERKS.filter((p) => PERK_INFO[p].once || !state.perks.includes(p));
  return shuffle(pool, rngFor(state.seed, state.round, 'perks')).slice(0, RUN_OFFER);
}

/** The power-up POWER START hands you for the next match (weighted like the pitch pickups). */
export function runPower(state: Pick<RunState, 'seed' | 'round'>): PowerUpKind {
  const rng = rngFor(state.seed, state.round, 'power');
  const total = KIND_WEIGHTS.reduce((n, [, w]) => n + w, 0);
  let x = rng.next() * total;
  for (const [kind, w] of KIND_WEIGHTS) {
    x -= w;
    if (x < 0) return kind;
  }
  return KIND_WEIGHTS[0][0];
}

// ------------------------------------------------------------------ state changes

function reach(state: RunState): void {
  const r = Math.min(RUN_ROUNDS, state.round + 1);
  if (r > state.best) {
    state.best = r;
    state.bestVs = state.ladder[r - 1] ?? -1;
  }
}

/** Start a run (no-op while one is active). `seed` is the run's only source of chance. */
export function startRun(state: RunState, opts: { seed: number; club: number; difficulty: number }): boolean {
  if (state.active) return false;
  const club = isClub(opts.club) ? opts.club : 0;
  const seed = (Math.floor(Math.abs(opts.seed)) >>> 0) || 1;
  state.active = true;
  state.round = 0;
  state.perks = [];
  state.offer = [];
  state.inMatch = false;
  state.seed = seed;
  state.club = club;
  state.difficulty = Math.max(0, Math.min(3, Math.floor(opts.difficulty) || 0));
  state.ladder = runLadder(seed, club);
  state.runs++;
  state.startBest = state.best;
  state.last = null;
  state.coins = 0;
  state.xp = 0;
  reach(state);
  return true;
}

/** Take one of the cards on offer. */
export function pickPerk(state: RunState, id: RunPerkId): boolean {
  if (!state.active || !state.offer.includes(id)) return false;
  state.perks.push(id);
  state.offer = [];
  return true;
}

/** SOFT DRAW applies to the coming match (it was the pick made right before it). */
export function weakerPending(state: RunState): boolean {
  return state.active && state.offer.length === 0 && state.round > 0 && state.perks[state.round - 1] === 'weakerNext';
}

/** Perks in force for the coming match, in the order picked (a used SOFT DRAW drops out). */
export function activePerks(state: RunState): RunPerkId[] {
  const out: RunPerkId[] = [];
  state.perks.forEach((p, i) => {
    if (p === 'weakerNext' ? i === state.round - 1 && weakerPending(state) : !out.includes(p)) out.push(p);
  });
  return out;
}

export function holds(state: RunState, id: Exclude<RunPerkId, 'weakerNext'>): boolean {
  return state.perks.includes(id);
}

/** The coming match's opponent (preset index), or -1. */
export function currentOpponent(state: RunState): number {
  return state.active ? state.ladder[state.round] ?? -1 : -1;
}

/** Everything a run match needs beyond the teams: the perks mapped onto MatchConfig fields. */
export interface RunMatchConfig {
  /** 1-based round, opponent and your club (preset indices), difficulty index (0..3). */
  round: number;
  opponent: number;
  club: number;
  difficulty: number;
  halfMinutes: number;
  humanSide: 0;
  knockout: true;
  mode: MatchMode;
  attendance: number;
  stadiumLevel: number;
  startScore?: [number, number];
  keeperBoost?: [number, number];
  goldenFirst?: Side;
  startPower?: [PowerUpKind | null, PowerUpKind | null];
  /** Sim difficulty (0..4, like MatchConfig.difficulty) per side. */
  sideDifficulty?: [number, number];
}

/**
 * The coming match's set-up, or null (no run, or a perk still to pick). `simLevel` is the sim difficulty the
 * run's difficulty index maps to (ui/menus.ts DIFF_LEVEL): SOFT DRAW sets the opponent's side RUN_WEAKER_BY below it.
 */
export function runMatchConfig(state: RunState, simLevel: number): RunMatchConfig | null {
  if (!state.active || state.offer.length > 0 || state.round >= RUN_ROUNDS) return null;
  const opponent = state.ladder[state.round];
  if (!isClub(opponent)) return null;
  const i = state.round;
  const cfg: RunMatchConfig = {
    round: i + 1,
    opponent,
    club: state.club,
    difficulty: state.difficulty,
    halfMinutes: RUN_HALF_MINUTES,
    humanSide: 0,
    knockout: true,
    mode: holds(state, 'powerStart') ? 'blitz' : 'classic',
    attendance: RUN_ATTENDANCE[i],
    stadiumLevel: RUN_STADIUM[i],
  };
  if (holds(state, 'powerStart')) cfg.startPower = [runPower(state), null];
  if (holds(state, 'headStart')) cfg.startScore = [1, 0];
  if (holds(state, 'goldenFirst')) cfg.goldenFirst = 0;
  if (holds(state, 'keeperBoost')) cfg.keeperBoost = [RUN_KEEPER_BOOST, 0];
  if (weakerPending(state)) cfg.sideDifficulty = [simLevel, Math.max(0, simLevel - RUN_WEAKER_BY)];
  return cfg;
}

/** Coins a run match pays (before main.ts's win-streak multiplier). */
export function runMatchCoins(round: number, difficulty: number, won: boolean, goals: number): number {
  const mult = RUN_DIFF_MULT[Math.max(0, Math.min(3, difficulty))];
  const scored = Math.min(3, nat(goals));
  const base = won ? 60 + 20 * round + 10 * scored : 25 + 5 * scored;
  return Math.round((base * mult) / 5) * 5;
}

export interface RunOutcome {
  won: boolean;
  /** [you, them] at full time. */
  score: [number, number];
  pens?: [number, number] | null;
  how?: RunLast['how'];
}

/**
 * A finished run match as an outcome (you are side 0). `winner` is MatchResult.winner: who went through, by the
 * score or by the shootout of a level knockout tie. A level score with no winner (no shootout happened) is not a
 * win: the run needs a winner to go on.
 */
export function runOutcome(score: readonly [number, number], winner: Side | undefined, pens: [number, number] | null = null): RunOutcome {
  const s: [number, number] = [nat(score[0]), nat(score[1])];
  const won = winner !== undefined ? winner === 0 : s[0] > s[1];
  return { won, score: s, pens: s[0] === s[1] ? pens : null, how: 'played' };
}

export interface RunStep {
  round: number;
  vs: number;
  won: boolean;
  pens: [number, number] | null;
  /** The run is over (lost, or all seven won). */
  ended: boolean;
  cleared: boolean;
  /** The milestone this win paid (first time only), else null. */
  milestone: RunMilestone | null;
  /** The match's coins (0 for a match that didn't finish). */
  coins: number;
  /** The run beat the best before it (only meaningful once ended). */
  newBest: boolean;
}

/** Apply the launched match's result (once: needs `inMatch`, which ui/run.ts sets at kick-off). */
export function recordRunResult(state: RunState, o: RunOutcome): RunStep | null {
  if (!state.active || !state.inMatch) return null;
  state.inMatch = false;
  const round = state.round + 1;
  const vs = state.ladder[state.round] ?? -1;
  const how = o.how ?? 'played';
  const score: [number, number] = [nat(o.score[0]), nat(o.score[1])];
  const pens = o.pens ?? null;
  state.last = { round, vs, won: o.won, score, pens, how };
  const coins = how === 'played' ? runMatchCoins(round, state.difficulty, o.won, score[0]) : 0;
  let milestone: RunMilestone | null = null;
  if (o.won) {
    state.round = round;
    const m = RUN_MILESTONES.find((x) => x.round === round);
    if (m && !state.milestones.includes(round)) {
      state.milestones.push(round);
      milestone = m;
    }
    if (round >= RUN_ROUNDS) {
      state.active = false;
      state.cleared++;
      state.offer = [];
    } else {
      reach(state);
      state.offer = drawOffer(state);
    }
  } else {
    state.active = false;
    state.offer = [];
  }
  return {
    round, vs, won: o.won, pens, ended: !state.active, cleared: o.won && round >= RUN_ROUNDS, milestone, coins,
    newBest: state.best > state.startBest,
  };
}

/** A run match's result applied to the save: the run moves on and a first-time milestone pays its coins and XP. */
export function settleRunMatch(save: Pick<SaveData, 'coins' | 'progress' | 'season'> & { run?: RunState }, o: RunOutcome, now: Date = new Date()): RunStep | null {
  const st = save.run;
  if (!st) return null;
  const step = recordRunResult(st, o);
  if (step?.milestone) {
    save.coins += step.milestone.coins;
    st.coins += step.milestone.coins;
    st.xp += step.milestone.xp;
    addXp(save, step.milestone.xp, now);
  }
  return step;
}

/** XP BOOST: 20% of the match's XP again (call after the match's XP is in). Returns the bonus given. */
export function runXpBonus(save: Pick<SaveData, 'progress' | 'season'> & { run?: RunState }, matchXp: number, now: Date = new Date()): number {
  const st = save.run;
  if (!st || !st.perks.includes('xpBoost')) return 0;
  const bonus = Math.round(Math.max(0, matchXp) * RUN_XP_BOOST);
  if (bonus > 0) {
    addXp(save, bonus, now);
    st.xp += bonus;
  }
  return bonus;
}

/** ABANDON between matches: the run ends (best and milestones stay). */
export function abandonRun(state: RunState): boolean {
  if (!state.active) return false;
  state.last = { round: state.round + 1, vs: state.ladder[state.round] ?? -1, won: false, score: [0, 0], pens: null, how: 'abandoned' };
  state.active = false;
  state.offer = [];
  state.inMatch = false;
  return true;
}

/** A run match that never reported (the game closed mid-match) counts as a loss. Returns the step, or null. */
export function resolveStaleMatch(state: RunState): RunStep | null {
  if (!state.active || !state.inMatch) return null;
  return recordRunResult(state, { won: false, score: [0, 0], how: 'left' });
}

// ------------------------------------------------------------------ for the screens and the main menu

/** The save's run state, created if missing (a brand-new save from defaultSave() has none until it's reloaded). */
export function runOf(save: { run?: RunState }): RunState {
  if (!save.run) save.run = defaultRun();
  return save.run;
}

/** First word of a preset club's name, upper case ("NORTHWICK"). */
export function clubWord(i: number): string {
  const c = PRESET_CLUBS[i];
  return c ? c.name.split(' ')[0].toUpperCase() : '';
}

export function nextMilestone(state: RunState): RunMilestone | null {
  return RUN_MILESTONES.find((m) => !state.milestones.includes(m.round)) ?? null;
}

export function runTitles(state: RunState): string[] {
  return RUN_MILESTONES.filter((m) => state.milestones.includes(m.round)).map((m) => m.title);
}

/** "BEST: ROUND 5 v NORTHWICK", "BEST: ALL 7 WON", or "NO RUNS YET". */
export function bestText(state: RunState): string {
  if (state.cleared > 0) return `BEST: ALL ${RUN_ROUNDS} WON`;
  if (state.best > 0 && state.bestVs >= 0) return `BEST: ROUND ${state.best} v ${clubWord(state.bestVs)}`;
  return 'NO RUNS YET';
}

/**
 * For the main menu's CLUB RUN tile: a stale match is settled first (see resolveStaleMatch), then one line
 * ("ROUND 3 OF 7 v CRUMBLETON", "PICK A PERK", or the best run).
 */
export function runTileText(save: { run?: RunState }): string {
  const st = save.run;
  if (!st) return '7 WINS, ONE LIFE';
  resolveStaleMatch(st);
  if (st.active && st.offer.length) return 'PICK A PERK';
  if (st.active) return `ROUND ${st.round + 1} OF ${RUN_ROUNDS} v ${clubWord(currentOpponent(st))}`;
  return st.runs ? bestText(st) : '7 WINS, ONE LIFE';
}
