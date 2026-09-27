/**
 * Blocky Cup: an 8-club knockout (quarter-finals, semi-finals, final). Pure rules and state; the screens live
 * in ui/cup.ts. The user's ties are played for real (a level tie goes to penalties in the match sim); every
 * other tie is settled by a seeded, rating-based result generator, with a simulated shootout for draws.
 */
import { Rng, hashString } from '../core/rng';
import { shootoutWinner } from '../sim/shootout';
import { teamRating, type Side } from '../sim/types';
import { simulateScore } from './career';
import { PRESET_CLUBS, makeTeam } from './data';

export const CUP_VERSION = 1 as const;
export const CUP_SIZE = 8;
export const ROUND_NAMES = ['QUARTER-FINAL', 'SEMI-FINAL', 'FINAL'] as const;
export const ROUND_SHORT = ['QF', 'SF', 'FINAL'] as const;
/** Coins for winning each round, before the difficulty multiplier. */
export const ROUND_PRIZE = [100, 200, 400] as const;
export const TROPHY_PRIZE = 1000;
/** Same scale as the quick-match payout (standardReward in main.ts). */
export const DIFF_MULT = [0.8, 1, 1.35, 1.7] as const;
/** Opponent level the draw centres on, per difficulty (PRESET_CLUBS levels run 42..92). */
const DIFF_TARGET = [50, 63, 76, 87];
/** Tie indices per round: 0-3 quarter-finals, 4-5 semi-finals, 6 final. */
export const ROUND_TIES: readonly (readonly number[])[] = [[0, 1, 2, 3], [4, 5], [6]];
/** Which two earlier ties feed each later tie. */
const FEEDS: Record<number, [number, number]> = { 4: [0, 1], 5: [2, 3], 6: [4, 5] };

export interface CupTie {
  /** Bracket slots (0..7); -1 until the previous round decides them. */
  home: number;
  away: number;
  hg: number | null;
  ag: number | null;
  /** Shootout goals [home, away] when the tie finished level. */
  pens: [number, number] | null;
  /** Winning bracket slot, -1 while unplayed. */
  winner: number;
}

export type CupStatus = 'active' | 'won' | 'out';

export interface CupState {
  version: typeof CUP_VERSION;
  seed: number;
  /** DIFFICULTIES index (0 easy .. 3 legend). */
  difficulty: number;
  /** PRESET_CLUBS index per bracket slot. */
  clubs: number[];
  /** The user's bracket slot. */
  user: number;
  ties: CupTie[];
  /** Round being played: 0 QF, 1 SF, 2 final, 3 all done. */
  round: number;
  status: CupStatus;
  /** Coins won in this cup so far. */
  earned: number;
  /** Trophy celebration already shown. */
  celebrated: boolean;
}

export interface TieOutcome {
  round: number;
  won: boolean;
  trophy: boolean;
  coins: number;
}

const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

function shuffle<T>(rng: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const ratings = new Map<number, number>();

/** Overall rating of a preset club's generated squad (deterministic, cached). */
export function clubRating(club: number): number {
  let r = ratings.get(club);
  if (r === undefined) {
    r = teamRating(makeTeam(PRESET_CLUBS[club]));
    ratings.set(club, r);
  }
  return r;
}

/** The seven rivals: the preset clubs whose level sits nearest the difficulty's target, with a little luck. */
export function pickOpponents(userClub: number, difficulty: number, rng: Rng): number[] {
  const target = DIFF_TARGET[clampInt(difficulty, 0, 3)];
  return PRESET_CLUBS.map((c, i) => ({ i, s: Math.abs(c.level - target) + rng.next() * 8 }))
    .filter((c) => c.i !== userClub)
    .sort((a, b) => a.s - b.s)
    .slice(0, CUP_SIZE - 1)
    .map((c) => c.i);
}

const emptyTie = (home: number, away: number): CupTie => ({ home, away, hg: null, ag: null, pens: null, winner: -1 });

/** A fresh cup with a seeded draw. */
export function newCup(seed: number, userClub: number, difficulty: number): CupState {
  const rng = new Rng(seed >>> 0);
  const user = clampInt(userClub, 0, PRESET_CLUBS.length - 1);
  const d = clampInt(difficulty, 0, 3);
  const clubs = shuffle(rng, [user, ...pickOpponents(user, d, rng)]);
  const ties: CupTie[] = [];
  for (let i = 0; i < 7; i++) ties.push(i < 4 ? emptyTie(i * 2, i * 2 + 1) : emptyTie(-1, -1));
  return {
    version: CUP_VERSION, seed: seed >>> 0, difficulty: d, clubs, user: clubs.indexOf(user), ties,
    round: 0, status: 'active', earned: 0, celebrated: false,
  };
}

/** Coins for a result in `round` at `difficulty` (winning the final also brings the trophy bonus). */
export function cupPrize(round: number, won: boolean, difficulty: number): number {
  if (!won) return 0;
  const mult = DIFF_MULT[clampInt(difficulty, 0, 3)];
  const r = clampInt(round, 0, 2);
  return Math.round(ROUND_PRIZE[r] * mult) + (r === 2 ? Math.round(TROPHY_PRIZE * mult) : 0);
}

/** Simulated shootout between clubs rated `ra` / `rb`: [goals a, goals b], never level. */
export function simulateShootout(rng: Rng, ra: number, rb: number): [number, number] {
  const kicks: [boolean[], boolean[]] = [[], []];
  const conv = (r: number, o: number) => Math.max(0.55, Math.min(0.9, 0.74 + (r - o) * 0.004));
  let turn: Side = rng.chance(0.5) ? 0 : 1;
  for (let n = 0; n < 60 && shootoutWinner(kicks) < 0; n++) {
    kicks[turn].push(rng.chance(turn === 0 ? conv(ra, rb) : conv(rb, ra)));
    turn = turn === 0 ? 1 : 0;
  }
  const a = kicks[0].filter(Boolean).length;
  const b = kicks[1].filter(Boolean).length;
  // Sixty kicks without a winner can't really happen; settle it anyway.
  if (a === b) return ra >= rb ? [a + 1, b] : [a, b + 1];
  return [a, b];
}

/** Seeded AI-vs-AI result: a rating-based scoreline, penalties if level. */
export function simulateTie(rng: Rng, homeRating: number, awayRating: number): Pick<CupTie, 'hg' | 'ag' | 'pens'> {
  const [hg, ag] = simulateScore(rng, homeRating, awayRating);
  return { hg, ag, pens: hg === ag ? simulateShootout(rng, homeRating, awayRating) : null };
}

function tieWinner(t: CupTie): number {
  if (t.hg === null || t.ag === null) return -1;
  if (t.hg !== t.ag) return t.hg > t.ag ? t.home : t.away;
  if (!t.pens) return -1;
  return t.pens[0] > t.pens[1] ? t.home : t.away;
}

/** Deterministic per cup and tie, whatever order ties get played in. */
function tieRng(st: CupState, idx: number): Rng {
  return new Rng(hashString(`cup:${st.seed}:${idx}`));
}

/** The user's tie in the current round, if they're still in. */
export function userTie(st: CupState): { idx: number; tie: CupTie; rival: number; userHome: boolean } | null {
  if (st.status !== 'active' || st.round > 2) return null;
  for (const idx of ROUND_TIES[st.round]) {
    const tie = st.ties[idx];
    if (tie.winner >= 0) continue;
    if (tie.home === st.user) return { idx, tie, rival: tie.away, userHome: true };
    if (tie.away === st.user) return { idx, tie, rival: tie.home, userHome: false };
  }
  return null;
}

/** Settle every unplayed tie of the current round (except the user's), then draw the next round. */
function finishRound(st: CupState): void {
  for (const idx of ROUND_TIES[st.round]) {
    const t = st.ties[idx];
    if (t.winner >= 0 || t.home < 0 || t.away < 0) continue;
    if (st.status === 'active' && (t.home === st.user || t.away === st.user)) continue;
    Object.assign(t, simulateTie(tieRng(st, idx), clubRating(st.clubs[t.home]), clubRating(st.clubs[t.away])));
    t.winner = tieWinner(t);
  }
  if (ROUND_TIES[st.round].some((i) => st.ties[i].winner < 0)) return;
  st.round++;
  if (st.round > 2) return;
  for (const idx of ROUND_TIES[st.round]) {
    const [a, b] = FEEDS[idx];
    st.ties[idx] = emptyTie(st.ties[a].winner, st.ties[b].winner);
  }
}

/** Play out the rest of the bracket (after the user is knocked out) so it still crowns a champion. */
function simulateRest(st: CupState): void {
  for (let guard = 0; guard < 4 && st.round <= 2; guard++) finishRound(st);
}

/**
 * Record the user's current tie: `my`/`their` goals after 90, `won` decides a level tie (the shootout), and
 * `pens` is [user, rival] shootout goals when there was one. Settles the rest of the round and advances.
 */
export function recordUserTie(st: CupState, my: number, their: number, won: boolean, pens: [number, number] | null = null): TieOutcome | null {
  const cur = userTie(st);
  if (!cur) return null;
  const { tie, userHome } = cur;
  const round = st.round;
  const mine = Math.max(0, Math.round(my));
  const theirs = Math.max(0, Math.round(their));
  const win = mine !== theirs ? mine > theirs : won;
  tie.hg = userHome ? mine : theirs;
  tie.ag = userHome ? theirs : mine;
  if (mine === theirs) {
    // Keep the shootout score consistent with who went through.
    let p: [number, number] = pens && pens[0] !== pens[1] && pens[0] > pens[1] === win ? pens : win ? [1, 0] : [0, 1];
    p = [Math.max(0, Math.round(p[0])), Math.max(0, Math.round(p[1]))];
    tie.pens = userHome ? p : [p[1], p[0]];
  } else {
    tie.pens = null;
  }
  tie.winner = win ? st.user : cur.rival;
  const coins = cupPrize(round, win, st.difficulty);
  st.earned += coins;
  const trophy = win && round === 2;
  if (!win) st.status = 'out';
  else if (trophy) st.status = 'won';
  finishRound(st);
  if (!win) simulateRest(st);
  return { round, won: win, trophy, coins };
}

/** The bracket slot that won the final, -1 while undecided. */
export function champion(st: CupState): number {
  return st.ties[6]?.winner ?? -1;
}

/** Where the user's run ended: the round they went out in (or won), for the result card. */
export function exitRound(st: CupState): number {
  let last = 0;
  for (let r = 0; r < 3; r++) {
    for (const idx of ROUND_TIES[r]) {
      const t = st.ties[idx];
      if (t.home === st.user || t.away === st.user) last = r;
    }
  }
  return last;
}

// ------------------------------------------------------------------ save migration

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const goalsOk = (v: unknown) => v === null || isInt(v, 0, 99);

function readTie(raw: unknown): CupTie | null {
  if (!isObj(raw)) return null;
  const { home, away, hg, ag, pens, winner } = raw;
  if (!isInt(home, -1, CUP_SIZE - 1) || !isInt(away, -1, CUP_SIZE - 1) || !isInt(winner, -1, CUP_SIZE - 1)) return null;
  if (!goalsOk(hg) || !goalsOk(ag)) return null;
  let p: [number, number] | null = null;
  if (pens !== null && pens !== undefined) {
    if (!Array.isArray(pens) || pens.length !== 2 || !isInt(pens[0], 0, 99) || !isInt(pens[1], 0, 99)) return null;
    p = [pens[0], pens[1]];
  }
  if (winner >= 0 && winner !== home && winner !== away) return null;
  return { home, away, hg: hg as number | null, ag: ag as number | null, pens: p, winner };
}

/** A validated CupState from whatever is in the save, or null (no cup / unreadable). */
export function migrateCup(raw: unknown): CupState | null {
  if (!isObj(raw) || raw.version !== CUP_VERSION) return null;
  const { seed, difficulty, clubs, user, ties, round, status, earned, celebrated } = raw;
  if (typeof seed !== 'number' || !Number.isFinite(seed)) return null;
  if (!isInt(difficulty, 0, 3) || !isInt(user, 0, CUP_SIZE - 1) || !isInt(round, 0, 3)) return null;
  if (!Array.isArray(clubs) || clubs.length !== CUP_SIZE || !clubs.every((c) => isInt(c, 0, PRESET_CLUBS.length - 1))) return null;
  if (new Set(clubs).size !== CUP_SIZE) return null;
  if (status !== 'active' && status !== 'won' && status !== 'out') return null;
  if (!Array.isArray(ties) || ties.length !== 7) return null;
  const read = ties.map(readTie);
  if (read.some((t) => t === null)) return null;
  return {
    version: CUP_VERSION,
    seed: seed >>> 0,
    difficulty,
    clubs: [...clubs] as number[],
    user,
    ties: read as CupTie[],
    round,
    status,
    earned: typeof earned === 'number' && Number.isFinite(earned) ? Math.max(0, Math.round(earned)) : 0,
    celebrated: celebrated === true,
  };
}
