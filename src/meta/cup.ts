/**
 * BLOCKY CUP: the 8-club knockout (quarter-finals, semi-finals, final) inside every ROAD TO GLORY season. Its ties sit
 * between league matchdays (CUP_AFTER) and the draw mixes your league with clubs from the divisions round it, so a
 * Sunday League side can draw a League One giant. Pure rules and state: the season that holds the cup is
 * meta/career.ts, the screens are ui/career.ts (the ties) and ui/cup.ts (the bracket and the trophy lift).
 *
 * The player's ties are played for real (a level tie goes to penalties in the match sim). Every other tie is settled
 * by a seeded, rating-based result generator, with a simulated shootout for draws, in step with the season: a round
 * is settled when you play your tie in it, or (once you are out) when the league reaches that point of the calendar.
 *
 * The cup used to be a mode of its own (preset clubs, a difficulty pick). That mode is retired: only its save reader
 * is left (migrateCup), so an old save's cup can be closed cleanly (ui/career.ts) and nothing in it is lost.
 */
import { Rng, hashString } from '../core/rng';
import { shootoutWinner } from '../sim/shootout';
import { teamRating, type Side } from '../sim/types';
// Runtime import cycle (career.ts imports this file): only ever used inside functions, never at module top level.
import { BOTTOM_DIVISION, TOP_DIVISION, YOU, divisionLevel, rivalRating, simulateScore, type LeagueClub } from './career';
import { PRESET_CLUBS, makeTeam, randomClubSeed } from './data';

export const CUP_SIZE = 8;
export const ROUND_NAMES = ['QUARTER FINAL', 'SEMI FINAL', 'FINAL'] as const;
export const ROUND_SHORT = ['QF', 'SF', 'FINAL'] as const;
/** How far a run went (cupFinish): out in the QF, out in the SF, lost the final, won it. */
export const FINISH_NAMES = ['QUARTER FINALS', 'SEMI FINALS', 'RUNNERS UP', 'WINNERS'] as const;
/** Prize for winning each round, before the division scale (CUP_DIV_SCALE). */
export const ROUND_PRIZE = [100, 200, 400] as const;
/** For lifting the trophy, on top of the final's prize, before the division scale. */
export const TROPHY_PRIZE = 1000;
/**
 * The prize scale per division (index = division: 1 Elite League .. 6 Sunday League). The cup is a bonus on top of
 * the season, not a second economy: a whole winning run pays 680 in the Sunday League (a league title there pays
 * 1,040) and 1,530 in the Elite League (2,640). Each tie also pays the usual match fee (career.ts cupTieReward).
 */
export const CUP_DIV_SCALE = [0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.35, 0.3] as const;
/**
 * League matchdays played before each round is due, spread over the home and away season (14 matchdays): the QF after
 * matchday 4, the SF after 8, the final after 12 (the last two settle the league).
 */
export const CUP_AFTER = [4, 8, 12] as const;
/** A season that meets the cup part-way (a save from before it) still gets one while it fits: up to this many matchdays played. */
export const CUP_JOIN_BY = 8;
/** Where the five guests come from, in divisions from yours (clamped to the ladder): two up, one up twice, one down, two down. */
const GUEST_STEPS = [-2, -1, -1, 1, 2] as const;
/** League rivals in the draw (the other five entrants are the guests). */
const LEAGUE_ENTRANTS = 2;
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

/** A club in the draw: a league club plus the division it plays in. */
export type CupClub = LeagueClub & { division: number };

/** The season's cup (SeasonState.cup in meta/career.ts). */
export interface SeasonCup {
  /** Seeds the draw and every simulated tie. */
  seed: number;
  /** Club id per bracket slot: YOU, a league rival ('r1'..'r7') or a guest ('g1'..'g5'). */
  slots: string[];
  /** The clubs from other divisions (league rivals live in the season's `rivals`). */
  guests: CupClub[];
  /** Your bracket slot. */
  user: number;
  ties: CupTie[];
  /** Round being played: 0 QF, 1 SF, 2 final, 3 all done. */
  round: number;
  status: CupStatus;
  /** Prize money the cup has paid this season (before the full-time multipliers; match fees not included). */
  earned: number;
  /** Trophy lift already shown. */
  celebrated: boolean;
}

export interface TieOutcome {
  round: number;
  won: boolean;
  trophy: boolean;
  /** The round's prize (0 when knocked out); the match fee is on top (career.ts cupTieReward). */
  coins: number;
}

/** Rating of a club in the draw by id (the career knows its own club and league; guests carry theirs). */
export type RateClub = (id: string) => number;

/** What the bracket engine reads and writes (the season cup and the retired standalone cup both have it). */
interface Bracket {
  user: number;
  ties: CupTie[];
  round: number;
  status: CupStatus;
}

type SlotRating = (slot: number) => number;

const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

function shuffle<T>(rng: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const emptyTie = (home: number, away: number): CupTie => ({ home, away, hg: null, ag: null, pens: null, winner: -1 });

// ------------------------------------------------------------------ the draw

/**
 * A fresh cup for a season (seeded by it): you, two of your league rivals and five guests from the divisions round
 * yours. Like a real draw the favourite is kept apart from you: the strongest club starts in the other half, so you
 * can only meet it in the final. `own` is your club (its name and short name stay unique in the draw).
 */
export function drawCup(seasonSeed: number, division: number, rivals: readonly LeagueClub[], own: { name: string; short: string } | null): SeasonCup {
  const seed = hashString(`${seasonSeed}|cup`) >>> 0;
  const rng = new Rng(seed);
  const div = clampInt(division, TOP_DIVISION, BOTTOM_DIVISION);
  const names = new Set<string>([(own?.name ?? '').toLowerCase(), ...rivals.map((r) => r.name.toLowerCase())]);
  const shorts = new Set<string>([own?.short ?? '', ...rivals.map((r) => r.short)]);
  const guests = GUEST_STEPS.map((step, i): CupClub => {
    const gd = clampInt(div + step, TOP_DIVISION, BOTTOM_DIVISION);
    const level = clampInt(divisionLevel(gd) + rng.int(7) - 3, 1, 99);
    let cs = randomClubSeed(rng, level);
    for (let t = 0; t < 60 && (shorts.has(cs.short) || names.has(cs.name.toLowerCase())); t++) cs = randomClubSeed(rng, level);
    names.add(cs.name.toLowerCase());
    shorts.add(cs.short);
    const g: CupClub = { id: `g${i + 1}`, name: cs.name, short: cs.short, kit: cs.kit, formation: cs.formation, level, rating: 0, division: gd };
    g.rating = rivalRating(g);
    return g;
  });
  const league = shuffle(rng, rivals.map((r) => r.id)).slice(0, LEAGUE_ENTRANTS);
  const slots = shuffle(rng, [YOU, ...league, ...guests.map((g) => g.id)]);
  const rate = (id: string) => guests.find((g) => g.id === id)?.rating ?? rivals.find((r) => r.id === id)?.rating ?? 0;
  let user = slots.indexOf(YOU);
  let top = -1;
  slots.forEach((id, s) => {
    if (id !== YOU && (top < 0 || rate(id) > rate(slots[top]))) top = s;
  });
  if (top >= 0 && top >> 2 === user >> 2) {
    // Same half: the favourite swaps with the club in its place in the other half.
    const other = top ^ 4;
    [slots[top], slots[other]] = [slots[other], slots[top]];
    user = slots.indexOf(YOU);
  }
  const ties: CupTie[] = [];
  for (let i = 0; i < 7; i++) ties.push(i < 4 ? emptyTie(i * 2, i * 2 + 1) : emptyTie(-1, -1));
  return { seed, slots, guests, user, ties, round: 0, status: 'active', earned: 0, celebrated: false };
}

// ------------------------------------------------------------------ results

/** Prize for a result in `round` in a cup played from `division` (winning the final also brings the trophy bonus). */
export function cupPrize(round: number, won: boolean, division: number): number {
  if (!won) return 0;
  const mult = CUP_DIV_SCALE[clampInt(division, TOP_DIVISION, BOTTOM_DIVISION)];
  const r = clampInt(round, 0, 2);
  return Math.round(ROUND_PRIZE[r] * mult) + (r === 2 ? Math.round(TROPHY_PRIZE * mult) : 0);
}

/** Everything a winning run pays in prizes from `division` (match fees not included). */
export function cupPrizeTotal(division: number): number {
  return cupPrize(0, true, division) + cupPrize(1, true, division) + cupPrize(2, true, division);
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
function tieRng(seed: number, idx: number): Rng {
  return new Rng(hashString(`cup:${seed}:${idx}`));
}

/** The user's tie in the current round, if they're still in. */
export function userTie(st: Bracket): { idx: number; tie: CupTie; rival: number; userHome: boolean } | null {
  if (st.status !== 'active' || st.round > 2) return null;
  for (const idx of ROUND_TIES[st.round]) {
    const tie = st.ties[idx];
    if (tie.winner >= 0) continue;
    if (tie.home === st.user) return { idx, tie, rival: tie.away, userHome: true };
    if (tie.away === st.user) return { idx, tie, rival: tie.home, userHome: false };
  }
  return null;
}

/** Settle every unplayed tie of the current round (except the user's while still in), then draw the next round. */
function finishRound(st: Bracket, seed: number, rating: SlotRating): void {
  for (const idx of ROUND_TIES[st.round]) {
    const t = st.ties[idx];
    if (t.winner >= 0 || t.home < 0 || t.away < 0) continue;
    if (st.status === 'active' && (t.home === st.user || t.away === st.user)) continue;
    Object.assign(t, simulateTie(tieRng(seed, idx), rating(t.home), rating(t.away)));
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

function slotRating(cup: SeasonCup, rate: RateClub): SlotRating {
  return (slot) => {
    const id = cup.slots[slot];
    return cup.guests.find((g) => g.id === id)?.rating ?? rate(id);
  };
}

/** The cup round due now (your tie, before the next league matchday), or -1. `matchday` = league matchdays played. */
export function cupRoundDue(cup: SeasonCup | null | undefined, matchday: number): number {
  if (!cup || cup.status !== 'active' || cup.round > 2 || matchday < CUP_AFTER[cup.round]) return -1;
  // (A tie without a drawn opponent, only in a damaged save, never holds the league up: the season's end settles it.)
  const ut = userTie(cup);
  return ut && ut.rival >= 0 ? cup.round : -1;
}

/**
 * Once you are out, the rest of the cup keeps the calendar: each round is settled when the league reaches it
 * (`matchday` = league matchdays played; MATCHDAYS or more settles everything).
 */
export function syncCup(cup: SeasonCup, matchday: number, rate: RateClub): void {
  if (cup.status === 'active') return;
  const r = slotRating(cup, rate);
  for (let guard = 0; guard < 4 && cup.round <= 2 && matchday >= CUP_AFTER[cup.round]; guard++) finishRound(cup, cup.seed, r);
}

/**
 * Record your current tie: `my`/`their` goals after 90, `won` decides a level tie (the shootout), and `pens` is
 * [yours, theirs] shootout goals when there was one. Settles the rest of the round and draws the next; the prize
 * (by `division`) comes back in the outcome for the caller to pay with the match. `matchday` (league matchdays
 * played) keeps a knocked-out cup in step with the calendar.
 */
export function recordCupTie(
  cup: SeasonCup, division: number, matchday: number, rate: RateClub, my: number, their: number, won: boolean, pens: [number, number] | null = null,
): TieOutcome | null {
  const cur = userTie(cup);
  if (!cur) return null;
  const { tie, userHome } = cur;
  const round = cup.round;
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
  tie.winner = win ? cup.user : cur.rival;
  const coins = cupPrize(round, win, division);
  cup.earned += coins;
  const trophy = win && round === 2;
  if (!win) cup.status = 'out';
  else if (trophy) cup.status = 'won';
  finishRound(cup, cup.seed, slotRating(cup, rate));
  syncCup(cup, matchday, rate);
  return { round, won: win, trophy, coins };
}

/**
 * Close a cup at the end of the season. A tie of yours still unplayed (only a damaged save can get here: the league
 * waits for every tie) counts as a walk-over defeat with no prize; the rest is settled.
 */
export function settleCup(cup: SeasonCup, division: number, rate: RateClub): void {
  if (userTie(cup)) recordCupTie(cup, division, Number.MAX_SAFE_INTEGER, rate, 0, 3, false);
  if (cup.status === 'active') cup.status = 'out';
  syncCup(cup, Number.MAX_SAFE_INTEGER, rate);
}

/** The bracket slot that won the final, -1 while undecided. */
export function champion(st: Bracket): number {
  return st.ties[6]?.winner ?? -1;
}

/** The last round the user played in (where a run ended, or got to). */
export function exitRound(st: Bracket): number {
  let last = 0;
  for (let r = 0; r < 3; r++) {
    for (const idx of ROUND_TIES[r]) {
      const t = st.ties[idx];
      if (t.home === st.user || t.away === st.user) last = r;
    }
  }
  return last;
}

/** How far you went (FINISH_NAMES): 0 out in the QF, 1 out in the SF, 2 runners up, 3 winners; -1 while still in it. */
export function cupFinish(st: Bracket): number {
  if (st.status === 'won') return 3;
  if (st.status === 'out') return exitRound(st);
  return -1;
}

// ------------------------------------------------------------------ the retired standalone cup (old saves)

export const CUP_VERSION = 1 as const;

/** The old standalone cup (SaveData.cup): preset clubs and a difficulty. Only read now, to retire it. */
export interface CupState {
  version: typeof CUP_VERSION;
  seed: number;
  /** DIFFICULTIES index (0 easy .. 3 legend). */
  difficulty: number;
  /** PRESET_CLUBS index per bracket slot. */
  clubs: number[];
  user: number;
  ties: CupTie[];
  round: number;
  status: CupStatus;
  /** Coins it paid out (already in the wallet: each tie paid at full time). */
  earned: number;
  celebrated: boolean;
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

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const goalsOk = (v: unknown) => v === null || isInt(v, 0, 99);

/** One saved tie, validated (shared by the season cup's reader in career.ts), or null. */
export function readCupTie(raw: unknown): CupTie | null {
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

/** The old standalone cup in a save, validated, or null (none / unreadable). */
export function migrateCup(raw: unknown): CupState | null {
  if (!isObj(raw) || raw.version !== CUP_VERSION) return null;
  const { seed, difficulty, clubs, user, ties, round, status, earned, celebrated } = raw;
  if (typeof seed !== 'number' || !Number.isFinite(seed)) return null;
  if (!isInt(difficulty, 0, 3) || !isInt(user, 0, CUP_SIZE - 1) || !isInt(round, 0, 3)) return null;
  if (!Array.isArray(clubs) || clubs.length !== CUP_SIZE || !clubs.every((c) => isInt(c, 0, PRESET_CLUBS.length - 1))) return null;
  if (new Set(clubs).size !== CUP_SIZE) return null;
  if (status !== 'active' && status !== 'won' && status !== 'out') return null;
  if (!Array.isArray(ties) || ties.length !== 7) return null;
  const read = ties.map(readCupTie);
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

/**
 * Retire an old standalone cup found in a save: what it was (for a one-off note) or null when there was none. Its
 * coins were paid tie by tie at full time, so they are already in the wallet: nothing is taken back.
 */
export function retiredCupNote(raw: unknown): string | null {
  const old = migrateCup(raw);
  if (!old) return null;
  const club = PRESET_CLUBS[old.clubs[old.user]]?.name ?? 'Your club';
  const coins = old.earned.toLocaleString('en-US');
  // (Short: a career notice keeps 200 characters.)
  return [
    old.status === 'won' ? `${club} won the old Blocky Cup!` : '',
    'The Blocky Cup is part of Road to Glory now: your club plays it every season.',
    old.status === 'active'
      ? `Your old cup run is closed${old.earned > 0 ? ` and the ${coins} coins it won are yours to keep` : ''}.`
      : old.earned > 0 ? `The ${coins} coins it won are yours to keep.` : '',
  ].filter(Boolean).join(' ');
}
