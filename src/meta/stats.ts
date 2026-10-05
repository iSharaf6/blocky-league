/**
 * What a player has done for your club: appearances, starts, minutes, goals, assists, his average rating, cards and
 * man of the match awards; for a keeper clean sheets, saves, goals conceded and penalties saved. Two running lines sit
 * on every squad player (meta/life.ts LifePlayer): `ssn` for the season being played (it starts again when a new
 * season's first match is recorded) and `tot` for every season at the club. A save from before this has neither:
 * every number reads as zero (apps and goals keep the totals they always had).
 *
 * A match of yours leaves a MatchStat per player who was in it (ui/forever.ts matchFacts builds them from the match;
 * simStats makes plausible ones for a simulated match), life.ts recordMatch adds them to the lines. The squad's leaders
 * (top scorer, most assists, most appearances, best average) are read from the lines. Pure rules; the screens are
 * ui/playerCard.ts and the STATS tab of MY CLUB.
 *
 * Import cycle: life.ts imports this file; this file only imports types from it.
 */
import { Rng } from '../core/rng';
import type { PlayerDef, Role } from '../sim/types';
import type { LifePlayer } from './life';

/** A running tally (one season, or every season at the club). */
export interface StatLine {
  apps: number;
  starts: number;
  mins: number;
  goals: number;
  assists: number;
  /** His ratings added up in tenths (a 7.4 adds 74), and the matches that had one: the average is rate / rated / 10. */
  rate: number;
  rated: number;
  yellow: number;
  red: number;
  /** Man of the match awards. */
  motm: number;
  /** Keepers: matches without a goal against (60 minutes or more), saves, goals against, penalties saved. */
  clean: number;
  saves: number;
  conceded: number;
  pens: number;
}

export interface SeasonLine extends StatLine {
  /** The season it counts (a line from an earlier season reads as zero in this one). */
  season: number;
}

/** What one match gave one player. */
export interface MatchStat {
  id: string;
  started: boolean;
  mins: number;
  goals: number;
  assists: number;
  /** One decimal; 0: not rated. */
  rating: number;
  yellow: number;
  red: number;
  motm: boolean;
  saves: number;
  conceded: number;
  pens: number;
  clean: boolean;
}

export const LINE_KEYS = ['apps', 'starts', 'mins', 'goals', 'assists', 'rate', 'rated', 'yellow', 'red', 'motm', 'clean', 'saves', 'conceded', 'pens'] as const;

export const emptyLine = (): StatLine => ({ apps: 0, starts: 0, mins: 0, goals: 0, assists: 0, rate: 0, rated: 0, yellow: 0, red: 0, motm: 0, clean: 0, saves: 0, conceded: 0, pens: 0 });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(hi, Math.round(v))) : 0);
const life = (p: PlayerDef) => p as LifePlayer;

/** A line read from a save: every number clamped, anything missing or wrong is zero. Undefined when there is no object. */
export function readLine(v: unknown): StatLine | undefined {
  if (!isObj(v)) return undefined;
  const l = emptyLine();
  for (const k of LINE_KEYS) l[k] = num(v[k], k === 'rate' ? 1e8 : k === 'mins' ? 1e7 : 1e6);
  // (More rated matches than appearances can't be: a hand edited save.)
  l.rated = Math.min(l.rated, l.apps);
  return l;
}

export function readSeasonLine(v: unknown): SeasonLine | undefined {
  const l = readLine(v);
  return l && isObj(v) ? { ...l, season: num(v.season, 1e6) } : undefined;
}

/** Every season at the club. Apps and goals are the totals the player always carried (an old save keeps them). */
export function careerLine(p: PlayerDef): StatLine {
  const m = life(p);
  const t = m.tot ?? emptyLine();
  return { ...emptyLine(), ...t, apps: Math.max(m.apps ?? 0, t.apps), goals: Math.max(m.goals ?? 0, t.goals) };
}

/** The season being played (zeros while it has not had a match for him). */
export function seasonLine(p: PlayerDef, season: number): StatLine {
  const s = life(p).ssn;
  return s && s.season === season ? { ...emptyLine(), ...s } : emptyLine();
}

/** The average rating (one decimal); 0 before he has been rated. */
export function avgRating(l: StatLine): number {
  return l.rated > 0 ? Math.round(l.rate / l.rated) / 10 : 0;
}

export const ratingText = (l: StatLine): string => (l.rated > 0 ? avgRating(l).toFixed(1) : '0.0');

/** A match stat with nothing in it (a caller that only knows who played). */
export function blankStat(id: string, started: boolean, mins: number): MatchStat {
  return { id, started, mins, goals: 0, assists: 0, rating: 0, yellow: 0, red: 0, motm: false, saves: 0, conceded: 0, pens: 0, clean: false };
}

function addTo(l: StatLine, s: MatchStat): void {
  l.apps++;
  if (s.started) l.starts++;
  l.mins += Math.max(0, Math.round(s.mins));
  l.goals += s.goals;
  l.assists += s.assists;
  if (s.rating > 0) {
    l.rate += Math.round(s.rating * 10);
    l.rated++;
  }
  l.yellow += s.yellow;
  l.red += s.red;
  if (s.motm) l.motm++;
  if (s.clean) l.clean++;
  l.saves += s.saves;
  l.conceded += s.conceded;
  l.pens += s.pens;
}

/** Add one match to a player's season line (a new season starts it again) and to his career line. */
export function applyMatchStat(p: PlayerDef, s: MatchStat, season: number): void {
  const m = life(p);
  const tot = (m.tot ??= emptyLine());
  addTo(tot, s);
  if (!m.ssn || m.ssn.season !== season) m.ssn = { ...emptyLine(), season };
  addTo(m.ssn, s);
}

// ------------------------------------------------------------------ leaders

export type LeaderKind = 'goals' | 'assists' | 'apps' | 'rating';
export interface Leader {
  kind: LeaderKind;
  id: string;
  name: string;
  role: Role;
  /** Goals, assists, appearances, or the average rating times ten. */
  n: number;
}

/**
 * The squad's leaders in a scope: the top scorer, the most assists, the most appearances and the best average rating
 * (three matches or more). A category with nobody on the board is left out.
 */
export function squadLeaders(squad: readonly PlayerDef[], season: number, scope: 'season' | 'career'): Leader[] {
  const lines = squad.map((p) => ({ p, l: scope === 'season' ? seasonLine(p, season) : careerLine(p) }));
  const best = (kind: LeaderKind, val: (l: StatLine) => number, ok: (l: StatLine) => boolean = () => true): Leader | null => {
    let top: { p: PlayerDef; l: StatLine; n: number } | null = null;
    for (const x of lines) {
      if (!ok(x.l)) continue;
      const n = val(x.l);
      if (n <= 0) continue;
      // Ties: fewer appearances (more per game), then the squad order.
      if (!top || n > top.n || (n === top.n && x.l.apps < top.l.apps)) top = { ...x, n };
    }
    return top ? { kind, id: top.p.id, name: top.p.name, role: top.p.role, n: top.n } : null;
  };
  return [
    best('goals', (l) => l.goals),
    best('assists', (l) => l.assists),
    best('apps', (l) => l.apps),
    best('rating', (l) => Math.round(avgRating(l) * 10), (l) => l.rated >= 3),
  ].filter((x): x is Leader => !!x);
}

// ------------------------------------------------------------------ a simulated match

/** Assist odds of the other outfielders: the passers, by the job and the passing. */
const ASSIST_W: Record<Role, number> = { GK: 0, DF: 1.5, MF: 4, FW: 3 };
const YELLOW_P: Record<Role, number> = { GK: 0, DF: 0.1, MF: 0.07, FW: 0.04 };

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * Plausible numbers for a match settled without playing it (meta/week.ts simMatch): the eleven play, up to two tired
 * outfielders make way for a bench player of the same job after the hour, most goals have an assist (the passers
 * first), a few get booked, a keeper makes his saves, and the ratings follow the result, the goals and the cards.
 * The man of the match comes from the winners (sometimes from a draw). Seeded by `rng`, so the same fixture always sims
 * to the same numbers. `played` is every player who was on.
 */
export function simStats(
  squad: readonly PlayerDef[],
  scorerIds: readonly string[],
  my: number,
  their: number,
  rng: Rng,
): { played: string[]; stats: MatchStat[]; assists: string[] } {
  const xi = squad.slice(0, 11);
  const bench = squad.slice(11).filter((b) => !((b as { inj?: number }).inj ?? 0));
  const rows = new Map<string, MatchStat>();
  const byId = new Map(squad.map((p) => [p.id, p]));
  for (const p of xi) rows.set(p.id, blankStat(p.id, true, 90));
  // The changes.
  const taken = new Set<string>();
  let changes = 0;
  for (const p of xi) {
    if (changes >= 2 || p.role === 'GK' || !rng.chance(0.32)) continue;
    const on = bench.find((b) => b.role === p.role && !taken.has(b.id));
    if (!on) continue;
    taken.add(on.id);
    const at = 55 + rng.int(31);
    rows.get(p.id)!.mins = at;
    rows.set(on.id, blankStat(on.id, false, 90 - at));
    changes++;
  }
  const playing = [...rows.keys()];
  // Goals and their makers.
  for (const id of scorerIds) {
    const row = rows.get(id);
    if (row) row.goals++;
  }
  const assists: string[] = [];
  for (const sid of scorerIds) {
    if (!rng.chance(0.72)) continue;
    const pool = playing.map((id) => byId.get(id)!).filter((p) => p.id !== sid && ASSIST_W[p.role] > 0);
    const total = pool.reduce((s, p) => s + ASSIST_W[p.role] * p.stats.passing, 0);
    if (total <= 0) continue;
    let roll = rng.next() * total;
    for (const p of pool) {
      roll -= ASSIST_W[p.role] * p.stats.passing;
      if (roll <= 0) {
        rows.get(p.id)!.assists++;
        assists.push(p.id);
        break;
      }
    }
  }
  // The keeper, the cards.
  const gk = xi[0];
  if (gk) {
    const row = rows.get(gk.id)!;
    row.conceded = their;
    row.saves = 1 + rng.int(5) + (their > 1 ? 1 : 0);
    row.clean = their === 0;
    if (rng.chance(0.03)) {
      row.pens = 1;
      row.saves++;
    }
  }
  for (const id of playing) {
    const p = byId.get(id)!;
    const row = rows.get(id)!;
    if (p.role === 'GK') continue;
    if (rng.chance(0.004)) {
      row.red = 1;
      row.mins = Math.min(row.mins, 25 + rng.int(55));
    } else if (rng.chance(YELLOW_P[p.role] * (row.started ? 1 : 0.5))) row.yellow = 1;
  }
  // The ratings.
  const result = my > their ? 0.45 : my < their ? -0.35 : 0.05;
  for (const id of playing) {
    const p = byId.get(id)!;
    const row = rows.get(id)!;
    let r = 6.3 + result + row.goals * 0.95 + row.assists * 0.5 + (rng.next() - 0.5) * 1.1;
    if (p.role === 'GK') r += (row.clean ? 0.7 : 0) - row.conceded * 0.2 + row.saves * 0.12;
    else if (p.role === 'DF') r += (their === 0 ? 0.3 : 0) - their * 0.08;
    r -= row.yellow * 0.25 + row.red * 1.2;
    // (A short stay can't swing it far from the middle.)
    r = 6.2 + (r - 6.2) * clamp(row.mins / 60, 0.4, 1);
    row.rating = Math.round(clamp(r, 4.5, 9.9) * 10) / 10;
  }
  // The man of the match: the best of the winners, now and then of a draw.
  if (my > their || (my === their && rng.chance(0.4))) {
    let top: MatchStat | null = null;
    for (const id of playing) {
      const row = rows.get(id)!;
      if (!top || row.rating > top.rating) top = row;
    }
    if (top) top.motm = true;
  }
  return { played: playing, stats: playing.map((id) => rows.get(id)!), assists };
}
