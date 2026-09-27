/**
 * Career + My Club meta-game: pure state and rules (no DOM).
 * Everything persists in SaveData.career as a versioned CareerState; coins live in the shared wallet (SaveData.coins).
 */
import { Rng, hashString } from '../core/rng';
import { safeName, safeShort } from '../core/names';
import { FORMATIONS, FORMATION_IDS } from '../sim/formations';
import { overall, teamRating } from '../sim/types';
import type { FormationId, Kit, KitPattern, PlayerDef, PlayerStats, Role, TeamDef } from '../sim/types';
import { KIT_COLORS, dedupeSurnames, makePlayer, makeTeam, randomClubSeed, resolveKitClash } from './data';
// Runtime import cycle (market.ts imports this file): only ever used inside functions, never at module top level.
import {
  MORALE_DIP, NEWS_MAX, WAGE_DIP, ageSquad, applyWageDrain, canBid, clearMarket, defaultMarket, marketTick, placeBid, quickSaleValue,
  recordStarts, syncLegacyMarket, wageDrain,
  type Bid, type Listing, type MarketState, type NewsKind,
} from './market';
import { sep } from '../ui/text';

export const CAREER_VERSION = 1 as const;
export const TOP_DIVISION = 1;
export const BOTTOM_DIVISION = 6;
export const CLUBS_PER_DIVISION = 8;
export const MATCHDAYS = CLUBS_PER_DIVISION - 1;
export const SQUAD_MIN = 14;
export const SQUAD_MAX = 23;
/** Free agents on the market at any time (the legacy `state.market` view; see meta/market.ts FREE_AGENTS). */
export const MARKET_SIZE = 4;
export const STADIUM_MAX = 5;
export const STAT_CAP = 99;
export const TRAIN_STEP = 2;
export const START_LEVEL = 45;
/** League id of the player's own club. */
export const YOU = 'you';

export const ROLES: Role[] = ['GK', 'DF', 'MF', 'FW'];
export const PATTERNS: KitPattern[] = ['plain', 'stripes', 'hoops', 'halves', 'sash', 'sleeves'];
export const STAT_KEYS: (keyof PlayerStats)[] = ['pace', 'shooting', 'passing', 'dribbling', 'defending', 'keeping', 'stamina'];
export const STAT_SHORT: Record<keyof PlayerStats, string> = {
  pace: 'PAC', shooting: 'SHO', passing: 'PAS', dribbling: 'DRI', defending: 'DEF', keeping: 'GK', stamina: 'STA',
};
export const STAT_NAME: Record<keyof PlayerStats, string> = {
  pace: 'PACE', shooting: 'SHOOTING', passing: 'PASSING', dribbling: 'DRIBBLING', defending: 'DEFENDING', keeping: 'KEEPING', stamina: 'STAMINA',
};
/** The stats that matter most for each role (shown in lists, highlighted in training). */
export const KEY_STATS: Record<Role, (keyof PlayerStats)[]> = {
  GK: ['keeping', 'passing', 'defending'],
  DF: ['defending', 'pace', 'passing'],
  MF: ['passing', 'dribbling', 'stamina'],
  FW: ['shooting', 'pace', 'dribbling'],
};

const DIVISION_LEVEL = [0, 88, 79, 70, 60, 51, 42];
export const DIVISION_NAMES = ['', 'ELITE LEAGUE', 'CHAMPIONSHIP', 'LEAGUE ONE', 'NATIONAL LEAGUE', 'COUNTY LEAGUE', 'SUNDAY LEAGUE'];
export const STADIUM_NAMES = ['MUDDY FIELD', 'LOCAL GROUND', 'TOWN STADIUM', 'CITY ARENA', 'GRAND BOWL', 'MEGA DOME'];

const START_SQUAD: [Role, number][] = [['GK', 1], ['DF', 5], ['MF', 6], ['FW', 4]];
const NUMBER_PREFS: Record<Role, number[]> = {
  GK: [1, 13, 23, 31, 40],
  DF: [2, 3, 4, 5, 6, 12, 15, 22, 24, 26],
  MF: [8, 10, 7, 14, 16, 18, 17, 20, 21, 25],
  FW: [9, 11, 19, 27, 29, 30, 33],
};
/** Approximate overall a makePlayer() of `level` lands on, per role (from the overall() weights and ROLE_BIAS). */
const ROLE_OVR_OFFSET: Record<Role, number> = { GK: 7, DF: 3, MF: 4, FW: 7 };

// ------------------------------------------------------------------ types

export interface ClubState {
  name: string;
  short: string;
  kit: Kit;
  formation: FormationId;
  /** Whole squad; the first 11 are the starting XI in FORMATIONS[formation] slot order. */
  squad: PlayerDef[];
  /** Next numeric suffix for player ids (ids are `c<n>`). */
  nextId: number;
}

export interface LeagueClub {
  id: string;
  name: string;
  short: string;
  kit: Kit;
  formation: FormationId;
  level: number;
  rating: number;
  /** Ids of generated players sold on the transfer market (no longer in the squad). */
  out?: string[];
  /** Players signed on the transfer market (added to the generated squad). */
  in?: PlayerDef[];
}

export interface Fixture {
  md: number;
  home: string;
  away: string;
  hg: number | null;
  ag: number | null;
  forfeit?: boolean;
}

export interface SeasonState {
  number: number;
  division: number;
  seed: number;
  rivals: LeagueClub[];
  fixtures: Fixture[];
  /** Index of the next matchday to play (MATCHDAYS once the season is complete). */
  matchday: number;
}

export type Outcome = 'promoted' | 'relegated' | 'stayed';

export interface PrizeLine {
  label: string;
  coins: number;
}

export interface SeasonSummary {
  season: number;
  division: number;
  position: number;
  outcome: Outcome;
  champion: boolean;
  nextDivision: number;
  lines: PrizeLine[];
  prize: number;
}

export interface HistoryEntry {
  season: number;
  division: number;
  position: number;
  outcome: Outcome;
}

export interface CareerState {
  version: typeof CAREER_VERSION;
  seed: number;
  club: ClubState | null;
  season: SeasonState | null;
  /** Set when a season has just finished (prize already paid) until the player starts the next one. */
  summary: SeasonSummary | null;
  /** Legacy view for the career hub: the free agents on the market (a projection of `tm`, kept in sync). */
  market: PlayerDef[];
  /** `${season}:${matchday}` the market was generated for. */
  marketKey: string;
  /** The transfer market (meta/market.ts): listings, offers, sales, shortlist, news. */
  tm: MarketState;
  stadium: number;
  history: HistoryEntry[];
  /** One-shot message shown on the career hub (e.g. forfeit after quitting). */
  notice: string | null;
}

export interface Wallet {
  coins: number;
}

export type TxFail =
  | 'no-club' | 'not-found' | 'no-coins' | 'squad-full' | 'min-squad' | 'last-gk' | 'maxed'
  | 'window-closed' | 'wages' | 'pending' | 'bad-amount' | 'shortlist-full' | 'expired';
export type TxResult = { ok: true; delta: number } | { ok: false; reason: TxFail };

export interface TableRow {
  id: string;
  name: string;
  P: number;
  W: number;
  D: number;
  L: number;
  GF: number;
  GA: number;
  GD: number;
  PTS: number;
}

export interface NextMatch {
  md: number;
  fixture: Fixture;
  userHome: boolean;
  rival: LeagueClub;
  home: TeamDef;
  away: TeamDef;
  /** Worn kits: the home side keeps its kit, the away side changes on a clash. */
  kits: [Kit, Kit];
}

// ------------------------------------------------------------------ small helpers

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const round10 = (v: number) => Math.round(v / 10) * 10;
const fail = (reason: TxFail): TxResult => ({ ok: false, reason });

function shuffle<T>(rng: Rng, arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function colorDistance(a: number, b: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return Math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2);
}

export function clampDivision(d: number): number {
  return clamp(Math.round(d) || BOTTOM_DIVISION, TOP_DIVISION, BOTTOM_DIVISION);
}

export function divisionLevel(d: number): number {
  return DIVISION_LEVEL[clampDivision(d)];
}

// ------------------------------------------------------------------ names & kits

/** Characters allowed in a club name (letters in any script, digits, space and . ' & -). */
export const NAME_BAD = /[^\p{L}\p{N} .'&-]/gu;

export function sanitizeName(s: string): string {
  // Allowed characters, collapsed whitespace, 18 max; '' when the name is on the blocklist (core/names.ts).
  return safeName(s, { max: 18 });
}

export function sanitizeShort(s: string): string {
  // Three upper-case letters / digits; '' when what they spell is blocked.
  return safeShort(s);
}

/** "Pixel Park FC" -> "PIX". Falls back to initials, then pads with X. */
export function deriveShort(name: string): string {
  const words = name.toUpperCase().split(/\s+/).map((w) => w.replace(/[^A-Z0-9]/g, '')).filter(Boolean);
  const first = words[0] ?? '';
  let s = first.length >= 3 ? first.slice(0, 3) : words.join('').slice(0, 3);
  while (s.length < 3) s += 'X';
  return s;
}

/** Keeper jersey colour that stands out from both the outfield shirt and shorts. */
export function keeperColor(kit: Kit): number {
  const opts = [KIT_COLORS.lime, KIT_COLORS.orange, KIT_COLORS.pink, KIT_COLORS.yellow, KIT_COLORS.teal, KIT_COLORS.purple];
  let best = opts[0];
  let bestD = -1;
  for (const c of opts) {
    const d = Math.min(colorDistance(c, kit.shirt), colorDistance(c, kit.shirt2), colorDistance(c, kit.shorts));
    if (d > bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

export function randomKit(rng: Rng): Kit {
  const cols = Object.values(KIT_COLORS) as number[];
  const shirt = rng.pick(cols);
  let shirt2 = rng.pick(cols);
  if (colorDistance(shirt, shirt2) < 90) shirt2 = shirt === KIT_COLORS.white ? KIT_COLORS.black : KIT_COLORS.white;
  const kit: Kit = {
    shirt,
    shirt2,
    pattern: rng.pick(PATTERNS),
    shorts: rng.chance(0.5) ? shirt2 : shirt,
    socks: rng.chance(0.5) ? shirt : shirt2,
    gk: 0,
  };
  kit.gk = keeperColor(kit);
  return kit;
}

// ------------------------------------------------------------------ club & squad

export function freeNumber(squad: PlayerDef[], role: Role): number {
  const used = new Set(squad.map((p) => p.number));
  for (const n of NUMBER_PREFS[role]) if (!used.has(n)) return n;
  for (let n = 2; n <= 99; n++) if (!used.has(n)) return n;
  return 99;
}

export interface ClubInput {
  name: string;
  short: string;
  kit: Kit;
  formation: FormationId;
}

/** New club with a 16-man squad (1 GK, 5 DF, 6 MF, 4 FW) around START_LEVEL, XI auto-picked. */
export function createClub(input: ClubInput, seed: number, level = START_LEVEL): ClubState {
  const rng = new Rng(hashString(`club|${seed}`));
  const squad: PlayerDef[] = [];
  // One surname per player in the squad (no H. Costa and W. Costa).
  const names = new Set<string>();
  let nextId = 1;
  for (const [role, count] of START_SQUAD) {
    for (let i = 0; i < count; i++) {
      squad.push(makePlayer(rng, role, level + rng.int(5) - 2, freeNumber(squad, role), `c${nextId++}`, names));
    }
  }
  const name = sanitizeName(input.name) || 'Blocky FC';
  const short = sanitizeShort(input.short).length === 3 ? sanitizeShort(input.short) : deriveShort(name);
  const kit: Kit = { ...input.kit };
  kit.gk = keeperColor(kit);
  const club: ClubState = {
    name,
    short,
    kit,
    formation: FORMATIONS[input.formation] ? input.formation : '4-4-2',
    squad,
    nextId,
  };
  autoPick(club);
  return club;
}

function bestIndex(pool: PlayerDef[], ok: (p: PlayerDef) => boolean): number {
  let best = -1;
  for (let i = 0; i < pool.length; i++) {
    if (!ok(pool[i])) continue;
    if (best < 0 || overall(pool[i]) > overall(pool[best])) best = i;
  }
  return best;
}

const ROLE_ORDER: Record<Role, number> = { GK: 0, DF: 1, MF: 2, FW: 3 };

/** Best XI for the formation (matching roles first, strongest overall) and the rest sorted by role then overall. */
export function pickXI(squad: PlayerDef[], formation: FormationId): { xi: PlayerDef[]; rest: PlayerDef[] } {
  const pool = [...squad];
  const xi: PlayerDef[] = [];
  for (const slot of FORMATIONS[formation]) {
    if (!pool.length) break;
    let i = bestIndex(pool, (p) => p.role === slot.role);
    if (i < 0) i = bestIndex(pool, (p) => slot.role === 'GK' || p.role !== 'GK');
    if (i < 0) i = 0;
    xi.push(pool.splice(i, 1)[0]);
  }
  pool.sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || overall(b) - overall(a));
  return { xi, rest: pool };
}

/** Best XI for the formation (matching roles first, strongest overall), bench sorted by role then overall. */
export function autoPick(club: ClubState): void {
  const { xi, rest } = pickXI(club.squad, club.formation);
  club.squad = [...xi, ...rest];
}

/**
 * Take the player at `idx` out of the squad; a starter's slot goes to the best bench player for it (the
 * player is returned, not deleted elsewhere).
 */
export function removeFromSquad(club: ClubState, idx: number): PlayerDef | null {
  const p = club.squad[idx];
  if (!p) return null;
  if (idx < 11 && club.squad.length > 11) {
    const role = FORMATIONS[club.formation][idx].role;
    const bench = club.squad.slice(11);
    let j = bestIndex(bench, (q) => q.role === role);
    if (j < 0) j = bestIndex(bench, (q) => role === 'GK' || q.role !== 'GK');
    if (j < 0) j = 0;
    club.squad[idx] = bench[j];
    club.squad.splice(11 + j, 1);
  } else {
    club.squad.splice(idx, 1);
  }
  return p;
}

/** XI slot indices whose player's role doesn't match the formation slot. */
export function lineupIssues(club: ClubState): number[] {
  const out: number[] = [];
  FORMATIONS[club.formation].forEach((slot, i) => {
    if (club.squad[i] && club.squad[i].role !== slot.role) out.push(i);
  });
  return out;
}

export function swapPlayers(club: ClubState, i: number, j: number): boolean {
  const n = club.squad.length;
  if (i === j || i < 0 || j < 0 || i >= n || j >= n) return false;
  [club.squad[i], club.squad[j]] = [club.squad[j], club.squad[i]];
  return true;
}

export function setFormation(club: ClubState, f: FormationId): void {
  if (FORMATIONS[f]) club.formation = f;
}

export function clonePlayer(p: PlayerDef): PlayerDef {
  return { ...p, stats: { ...p.stats }, look: { ...p.look } };
}

/** Match-ready team: the first 11 players in formation slot order. */
export function clubTeam(club: ClubState): TeamDef {
  return {
    id: club.short,
    name: club.name,
    short: club.short,
    kit: { ...club.kit },
    formation: club.formation,
    players: club.squad.slice(0, 11).map(clonePlayer),
    bench: club.squad.slice(11, 18).map(clonePlayer),
  };
}

export function clubRating(club: ClubState): number {
  return teamRating(clubTeam(club));
}

// ------------------------------------------------------------------ training

export function trainingCost(p: PlayerDef): number {
  return 40 + overall(p) * 3;
}

export function trainPlayer(club: ClubState, wallet: Wallet, playerId: string, stat: keyof PlayerStats): TxResult {
  const p = club.squad.find((x) => x.id === playerId);
  if (!p) return fail('not-found');
  if (p.stats[stat] >= STAT_CAP) return fail('maxed');
  const cost = trainingCost(p);
  if (wallet.coins < cost) return fail('no-coins');
  wallet.coins -= cost;
  p.stats[stat] = Math.min(STAT_CAP, p.stats[stat] + TRAIN_STEP);
  return { ok: true, delta: -cost };
}

// ------------------------------------------------------------------ season

export function defaultCareer(seed: number): CareerState {
  return {
    version: CAREER_VERSION,
    seed: seed >>> 0,
    club: null,
    season: null,
    summary: null,
    market: [],
    marketKey: '',
    tm: defaultMarket(),
    stadium: 0,
    history: [],
    notice: null,
  };
}

/**
 * Single round robin via the circle method. ids[0] (the player's club) is fixed and alternates home/away
 * each matchday; every pair meets exactly once and every club plays once per matchday.
 */
export function buildFixtures(ids: string[], rng: Rng): Fixture[] {
  const n = ids.length;
  const fixed = ids[0];
  const rot = shuffle(rng, ids.slice(1));
  const m = rot.length;
  const out: Fixture[] = [];
  const fx = (md: number, home: string, away: string): Fixture => ({ md, home, away, hg: null, ag: null });
  for (let r = 0; r < m; r++) {
    const arr = rot.map((_, i) => rot[(i + r) % m]);
    out.push(r % 2 === 0 ? fx(r, fixed, arr[0]) : fx(r, arr[0], fixed));
    for (let k = 1; k < n / 2; k++) {
      const a = arr[k];
      const b = arr[m - k];
      out.push((r + k) % 2 === 0 ? fx(r, a, b) : fx(r, b, a));
    }
  }
  return out;
}

export function newSeason(state: CareerState, division: number, number: number): SeasonState {
  const div = clampDivision(division);
  const seed = hashString(`${state.seed}|season|${number}|${div}`);
  const rng = new Rng(seed);
  const level = divisionLevel(div);
  const offsets = shuffle(rng, [-5, -3, -2, 0, 1, 3, 5]);
  const takenShort = new Set<string>([state.club?.short ?? '']);
  const takenName = new Set<string>([(state.club?.name ?? '').toLowerCase()]);
  const rivals: LeagueClub[] = [];
  for (let i = 0; i < CLUBS_PER_DIVISION - 1; i++) {
    const lvl = clamp(level + offsets[i % offsets.length] + rng.int(3) - 1, level - 5, level + 5);
    let cs = randomClubSeed(rng, lvl);
    for (let t = 0; t < 60 && (takenShort.has(cs.short) || takenName.has(cs.name.toLowerCase())); t++) cs = randomClubSeed(rng, lvl);
    takenShort.add(cs.short);
    takenName.add(cs.name.toLowerCase());
    rivals.push({
      id: `r${i + 1}`,
      name: cs.name,
      short: cs.short,
      kit: cs.kit,
      formation: cs.formation,
      level: lvl,
      rating: teamRating(makeTeam(cs)),
    });
  }
  const fixtures = buildFixtures([YOU, ...rivals.map((r) => r.id)], rng);
  const season: SeasonState = { number, division: div, seed, rivals, fixtures, matchday: 0 };
  state.season = season;
  state.summary = null;
  // A fresh market for the season (any offer still live is refunded through tm.owed).
  clearMarket(state);
  refreshMarket(state);
  return season;
}

/** Everyone in the league including the player's club (id YOU). */
export function leagueClubs(state: CareerState): LeagueClub[] {
  const out: LeagueClub[] = [];
  if (state.club) {
    const c = state.club;
    const rating = clubRating(c);
    out.push({ id: YOU, name: c.name, short: c.short, kit: c.kit, formation: c.formation, level: rating, rating });
  }
  if (state.season) out.push(...state.season.rivals);
  return out;
}

export function userFixture(season: SeasonState, md: number): Fixture | undefined {
  return season.fixtures.find((f) => f.md === md && (f.home === YOU || f.away === YOU));
}

function poisson(rng: Rng, lambda: number): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng.next();
  } while (p > L && k < 12);
  return k - 1;
}

/** Rating-based scoreline for AI-vs-AI fixtures: Poisson goals, small home edge, each side capped at 4. */
export function simulateScore(rng: Rng, homeRating: number, awayRating: number): [number, number] {
  const d = (homeRating - awayRating) / 10;
  const lh = clamp(1.45 + d * 0.55, 0.25, 3.4);
  const la = clamp(1.15 - d * 0.55, 0.2, 3.2);
  return [Math.min(4, poisson(rng, lh)), Math.min(4, poisson(rng, la))];
}

/** Simulate every unplayed AI-vs-AI fixture on matchday `md` (seeded per fixture). */
export function simulateMatchday(state: CareerState, md: number): void {
  const season = state.season;
  if (!season) return;
  const ratings = new Map(leagueClubs(state).map((c) => [c.id, c.rating]));
  season.fixtures.forEach((f, idx) => {
    if (f.md !== md || f.hg !== null || f.home === YOU || f.away === YOU) return;
    const rng = new Rng(hashString(`${season.seed}|fx|${idx}`));
    const [hg, ag] = simulateScore(rng, ratings.get(f.home) ?? 50, ratings.get(f.away) ?? 50);
    f.hg = hg;
    f.ag = ag;
  });
}

/**
 * Record the player's result for matchday `md` (scores are home/away goals), simulate the rest of the
 * matchday, advance, refresh the market, and finish the season after the last matchday.
 * Returns false (and changes nothing) for a stale or already-played matchday.
 */
export function resolveMatchday(state: CareerState, wallet: Wallet, md: number, hg: number, ag: number, forfeit = false): boolean {
  const season = state.season;
  if (!season || !state.club || state.summary || season.matchday !== md || md >= MATCHDAYS) return false;
  const f = userFixture(season, md);
  if (!f || f.hg !== null) return false;
  f.hg = Math.max(0, Math.round(hg));
  f.ag = Math.max(0, Math.round(ag));
  if (forfeit) f.forfeit = true;
  simulateMatchday(state, md);
  recordStarts(state.club);
  season.matchday++;
  // The wage bill: over budget, 1.5× the overspend leaves the wallet after every matchday (market.ts).
  applyWageDrain(state, wallet);
  if (season.matchday >= MATCHDAYS) finishSeason(state, wallet);
  else refreshMarket(state, wallet);
  return true;
}

/** Forfeit scoreline (home, away) when the player walks off: a 3-0 defeat. */
export function forfeitScore(userHome: boolean): [number, number] {
  return userHome ? [0, 3] : [3, 0];
}

export function computeTable(clubs: { id: string; name: string }[], fixtures: Fixture[]): TableRow[] {
  const rows = new Map<string, TableRow>();
  for (const c of clubs) rows.set(c.id, { id: c.id, name: c.name, P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, PTS: 0 });
  for (const f of fixtures) {
    if (f.hg === null || f.ag === null) continue;
    const h = rows.get(f.home);
    const a = rows.get(f.away);
    if (!h || !a) continue;
    h.P++;
    a.P++;
    h.GF += f.hg;
    h.GA += f.ag;
    a.GF += f.ag;
    a.GA += f.hg;
    if (f.hg > f.ag) {
      h.W++;
      a.L++;
      h.PTS += 3;
    } else if (f.hg < f.ag) {
      a.W++;
      h.L++;
      a.PTS += 3;
    } else {
      h.D++;
      a.D++;
      h.PTS++;
      a.PTS++;
    }
  }
  const out = [...rows.values()];
  for (const r of out) r.GD = r.GF - r.GA;
  return out.sort((a, b) => b.PTS - a.PTS || b.GD - a.GD || b.GF - a.GF || a.name.localeCompare(b.name, 'en') || (a.id < b.id ? -1 : 1));
}

export function leagueTable(state: CareerState): TableRow[] {
  return state.season ? computeTable(leagueClubs(state), state.season.fixtures) : [];
}

export function userPosition(state: CareerState): number {
  return leagueTable(state).findIndex((r) => r.id === YOU) + 1;
}

/** Top 2 go up (never above division 1), bottom 2 go down (never below division 6). */
export function seasonOutcome(position: number, division: number): { outcome: Outcome; nextDivision: number } {
  const div = clampDivision(division);
  if (position <= 2 && div > TOP_DIVISION) return { outcome: 'promoted', nextDivision: div - 1 };
  if (position > CLUBS_PER_DIVISION - 2 && div < BOTTOM_DIVISION) return { outcome: 'relegated', nextDivision: div + 1 };
  return { outcome: 'stayed', nextDivision: div };
}

export function seasonPrizeLines(position: number, division: number): PrizeLine[] {
  const div = clampDivision(division);
  const lines: PrizeLine[] = [];
  const finish = (CLUBS_PER_DIVISION - position) * (20 + 10 * (BOTTOM_DIVISION - div));
  if (finish > 0) lines.push({ label: 'LEAGUE POSITION', coins: finish });
  if (position <= 2) lines.push({ label: div > TOP_DIVISION ? 'PROMOTION PRIZE' : 'TOP-TWO PRIZE', coins: 600 + 250 * (BOTTOM_DIVISION - div) });
  if (position === 1) lines.push({ label: 'CHAMPIONS BONUS', coins: 300 });
  return lines;
}

/** Close the season: pay the prize once, record history and leave a summary for the UI. */
export function finishSeason(state: CareerState, wallet: Wallet): SeasonSummary | null {
  const season = state.season;
  if (!season || state.summary || season.matchday < MATCHDAYS) return state.summary;
  const position = userPosition(state);
  const { outcome, nextDivision } = seasonOutcome(position, season.division);
  const lines = seasonPrizeLines(position, season.division);
  const prize = lines.reduce((s, l) => s + l.coins, 0);
  wallet.coins += prize;
  const summary: SeasonSummary = {
    season: season.number,
    division: season.division,
    position,
    outcome,
    champion: position === 1,
    nextDivision,
    lines,
    prize,
  };
  state.summary = summary;
  state.history = [...state.history, { season: season.number, division: season.division, position, outcome }].slice(-30);
  clearMarket(state, wallet);
  return summary;
}

export function startNextSeason(state: CareerState): SeasonState | null {
  const s = state.summary;
  if (!s) return null;
  // A year passes: the young grow into their potential, the old fade, contracts tick down.
  if (state.club) ageSquad(state.club);
  return newSeason(state, s.nextDivision, s.season + 1);
}

export function nextMatch(state: CareerState): NextMatch | null {
  const { club, season } = state;
  if (!club || !season || state.summary || season.matchday >= MATCHDAYS) return null;
  const fixture = userFixture(season, season.matchday);
  if (!fixture) return null;
  const userHome = fixture.home === YOU;
  const rival = season.rivals.find((r) => r.id === (userHome ? fixture.away : fixture.home));
  if (!rival) return null;
  const you = clubTeam(club);
  // Players you have put up for sale have their mind elsewhere (a small stat dip until unlisted or sold), and
  // a squad whose wages are over budget plays a point down across the board.
  const listed = new Set(state.tm.sales.map((s) => s.playerId));
  const unpaid = wageDrain(state) > 0 ? WAGE_DIP : 0;
  if (listed.size || unpaid) {
    for (const p of [...you.players, ...(you.bench ?? [])]) {
      const dip = unpaid + (listed.has(p.id) ? MORALE_DIP : 0);
      if (!dip) continue;
      for (const k of STAT_KEYS) p.stats[k] = Math.max(1, p.stats[k] - dip);
    }
  }
  const them = rivalTeam(rival);
  // No surname twice in the fixture: the rival's clashing players get another (deterministic) name.
  dedupeSurnames(you, them);
  const home = userHome ? you : them;
  const away = userHome ? them : you;
  return { md: season.matchday, fixture, userHome, rival, home, away, kits: [home.kit, resolveKitClash(home.kit, away.kit)] };
}

function rivalBase(r: LeagueClub): TeamDef {
  return makeTeam({ name: r.name, short: r.short, kit: r.kit, formation: r.formation, level: r.level }, r.id);
}

/** Everyone a rival has right now: its generated squad minus the players it sold, plus the ones it signed. */
export function rivalSquad(r: LeagueClub): PlayerDef[] {
  const base = rivalBase(r);
  const out = new Set(r.out ?? []);
  const own = [...base.players, ...(base.bench ?? [])].filter((p) => !out.has(p.id));
  return [...own, ...(r.in ?? []).map(clonePlayer)];
}

/** Match-ready rival: the generated squad, or (after transfers) the best XI of what it has now. */
export function rivalTeam(r: LeagueClub): TeamDef {
  const base = rivalBase(r);
  if (!r.out?.length && !r.in?.length) return base;
  const { xi, rest } = pickXI(rivalSquad(r), r.formation);
  return { ...base, players: xi, bench: rest.slice(0, 7) };
}

export function rivalRating(r: LeagueClub): number {
  return teamRating(rivalTeam(r));
}

// ------------------------------------------------------------------ match economy

/** Division -> DIFFICULTIES index: 6,5 easy / 4,3 normal / 2 hard / 1 legend. */
export function matchDifficulty(division: number): number {
  const d = clampDivision(division);
  return d >= 5 ? 0 : d >= 3 ? 1 : d === 2 ? 2 : 3;
}

/**
 * The ground a league rival plays at (0 park pitch .. STADIUM_MAX full bowl), for away matches: bigger in
 * higher divisions (Sunday League 0 .. Elite League 5), and the division's stronger sides a size up.
 */
export function rivalStadiumLevel(division: number, rival: Pick<LeagueClub, 'level'>): number {
  const d = clampDivision(division);
  const base = BOTTOM_DIVISION - d;
  const strong = rival.level > DIVISION_LEVEL[d] + 3 ? 1 : 0;
  return clamp(base + strong, 0, STADIUM_MAX);
}

export function matchAttendance(stadium: number): number {
  return Math.min(1, 0.35 + clamp(stadium, 0, STADIUM_MAX) * 0.12);
}

export function payTable(division: number, stadium: number): { win: number; draw: number; loss: number; goal: number; mult: number } {
  const win = 120 + 40 * (BOTTOM_DIVISION - clampDivision(division));
  const mult = 1 + 0.1 * clamp(stadium, 0, STADIUM_MAX);
  return {
    win: Math.round(win * mult),
    draw: Math.round(Math.round(win * 0.45) * mult),
    loss: Math.round(Math.round(win * 0.2) * mult),
    goal: Math.round(15 * mult),
    mult,
  };
}

export function matchCoins(division: number, stadium: number, my: number, their: number): number {
  const win = 120 + 40 * (BOTTOM_DIVISION - clampDivision(division));
  const base = my > their ? win : my === their ? Math.round(win * 0.45) : Math.round(win * 0.2);
  return Math.round((base + 15 * Math.max(0, my)) * (1 + 0.1 * clamp(stadium, 0, STADIUM_MAX)));
}

export function matchReward(division: number, stadium: number, my: number, their: number): { coins: number; label: string } {
  const base = my > their ? 'WIN BONUS' : my === their ? 'DRAW FEE' : 'MATCH FEE';
  const s = clamp(stadium, 0, STADIUM_MAX);
  // (HTML: the post-match reward line renders it; the divider is the ui/text.ts element, not a glyph.)
  return { coins: matchCoins(division, stadium, my, their), label: s > 0 ? `${base}${sep()}+${s * 10}% GATE` : base };
}

// ------------------------------------------------------------------ transfers
// The market itself (listings, offers, sales, AI trades, scouting) lives in meta/market.ts; what's here is the
// price scale, the legacy free-agent view used by the career hub, and the instant quick sale.

/** About three or four wins' pay for a squad-level signing (a 50-rated player costs ~630). */
export function playerPrice(p: PlayerDef): number {
  return round10(overall(p) ** 2 * 0.25);
}

/** What a quick sale pays now: 45% of the player's value (rating price by age and contract, market.ts). */
export function sellValue(p: PlayerDef): number {
  return quickSaleValue(p);
}

/**
 * Typical overall of a `role` player generated at this division's level (rival squads use the same scale),
 * so market players "around the division level" are genuinely comparable to the opposition.
 */
export function divisionPlayerOverall(division: number, role: Role): number {
  return divisionLevel(division) + ROLE_OVR_OFFSET[role];
}

export function tuneToOverall(p: PlayerDef, target: number): void {
  for (let pass = 0; pass < 3; pass++) {
    const d = target - overall(p);
    if (d === 0) return;
    for (const k of STAT_KEYS) p.stats[k] = clamp(p.stats[k] + d, 8, STAT_CAP);
  }
}

/**
 * Bring the transfer market up to the current matchday (market.ts marketTick: answers to your offers, AI
 * offers and trades, new listings) and refresh the legacy free-agent view. Pass the wallet when you have it
 * so refunds land at once (otherwise they wait in tm.owed).
 */
export function refreshMarket(state: CareerState, wallet?: Wallet): void {
  if (!state.season || state.summary) return;
  marketTick(state, wallet);
  if (state.marketKey !== state.tm.key) syncLegacyMarket(state);
}

/** The listing behind a legacy `state.market` entry (a free agent). */
function legacyListing(state: CareerState, idx: number): Listing | undefined {
  const p = state.market[idx];
  return p ? state.tm.listings.find((l) => !l.club && l.player.id === p.id) : undefined;
}

/** Legacy instant buy (career hub): a free agent at his asking price, under the market's window/wage/squad rules. */
export function canBuy(state: CareerState, coins: number, idx: number): TxResult {
  if (!state.club) return fail('no-club');
  const l = legacyListing(state, idx);
  if (!l) return fail('not-found');
  const check = canBid(state, coins, l.id, l.asking);
  return check.ok ? { ok: true, delta: -l.asking } : fail(check.reason);
}

export function buyPlayer(state: CareerState, wallet: Wallet, idx: number): TxResult & { player?: PlayerDef } {
  const check = canBuy(state, wallet.coins, idx);
  if (!check.ok) return check;
  const l = legacyListing(state, idx)!;
  const r = placeBid(state, wallet, l.id, l.asking);
  if (!r.ok) return fail(r.reason);
  return { ok: true, delta: check.delta, player: r.player };
}

export function canSell(state: CareerState, playerId: string): TxResult {
  const club = state.club;
  if (!club) return fail('no-club');
  const p = club.squad.find((x) => x.id === playerId);
  if (!p) return fail('not-found');
  if (club.squad.length <= SQUAD_MIN) return fail('min-squad');
  if (p.role === 'GK' && club.squad.filter((x) => x.role === 'GK').length <= 1) return fail('last-gk');
  return { ok: true, delta: sellValue(p) };
}

/** Quick sale: 45% of the player's value at once; a starter is replaced by the best bench player for that slot. */
export function sellPlayer(state: CareerState, wallet: Wallet, playerId: string): TxResult {
  const check = canSell(state, playerId);
  const club = state.club;
  if (!check.ok || !club) return check;
  removeFromSquad(club, club.squad.findIndex((x) => x.id === playerId));
  state.tm.sales = state.tm.sales.filter((s) => s.playerId !== playerId);
  wallet.coins += check.delta;
  return check;
}

// ------------------------------------------------------------------ stadium

export function stadiumUpgradeCost(level: number): number {
  if (level >= STADIUM_MAX) return Infinity;
  return round10(800 * (Math.max(0, level) + 1) ** 1.6);
}

export function upgradeStadium(state: CareerState, wallet: Wallet): TxResult {
  if (state.stadium >= STADIUM_MAX) return fail('maxed');
  const cost = stadiumUpgradeCost(state.stadium);
  if (wallet.coins < cost) return fail('no-coins');
  wallet.coins -= cost;
  state.stadium++;
  return { ok: true, delta: -cost };
}

// ------------------------------------------------------------------ save migration

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const int = (v: unknown, lo: number, hi: number, dflt: number): number => (isNum(v) ? clamp(Math.round(v), lo, hi) : dflt);

function readKit(v: unknown): Kit | null {
  if (!isObj(v)) return null;
  const { shirt, shirt2, shorts, socks, gk, pattern } = v;
  if (!isNum(shirt) || !isNum(shirt2) || !isNum(shorts) || !isNum(socks)) return null;
  if (!PATTERNS.includes(pattern as KitPattern)) return null;
  const c = (n: number) => clamp(Math.round(n), 0, 0xffffff);
  const kit: Kit = { shirt: c(shirt), shirt2: c(shirt2), pattern: pattern as KitPattern, shorts: c(shorts), socks: c(socks), gk: 0 };
  kit.gk = isNum(gk) ? c(gk) : keeperColor(kit);
  return kit;
}

function readFormation(v: unknown): FormationId | null {
  return FORMATION_IDS.includes(v as FormationId) ? (v as FormationId) : null;
}

function readPlayer(v: unknown): PlayerDef | null {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.name) || !ROLES.includes(v.role as Role) || !isObj(v.stats)) return null;
  const stats = {} as PlayerStats;
  for (const k of STAT_KEYS) {
    const s = v.stats[k];
    if (!isNum(s)) return null;
    stats[k] = clamp(Math.round(s), 1, STAT_CAP);
  }
  const look = isObj(v.look) ? v.look : {};
  const p: PlayerDef & { age?: number; potential?: number; contract?: number; paid?: number; boughtSeason?: number; starts?: number } = {
    id: v.id,
    name: v.name.slice(0, 24),
    number: int(v.number, 0, 99, 0),
    role: v.role as Role,
    stats,
    look: {
      skin: int(look.skin, 0, 5, 0),
      hair: int(look.hair, 0, 8, 0),
      hairColor: int(look.hairColor, 0, 7, 0),
      beard: int(look.beard, 0, 2, 0),
      boots: int(look.boots, 0, 0xffffff, 0x2a2a30),
    },
  };
  // Career meta (market.ts): only when the save has them, so older players keep deriving theirs.
  if (isNum(v.age)) p.age = int(v.age, 16, 40, 25);
  if (isNum(v.potential)) p.potential = int(v.potential, 0, 5, 0);
  if (isNum(v.contract)) p.contract = int(v.contract, 1, 4, 1);
  // Market signings: what was paid and when (the resale cap), starts since.
  if (isNum(v.paid)) p.paid = int(v.paid, 0, 1e9, 0);
  if (isNum(v.boughtSeason)) p.boughtSeason = int(v.boughtSeason, 0, 1e6, 0);
  if (isNum(v.starts)) p.starts = int(v.starts, 0, 1e6, 0);
  return p;
}

function readPlayers(v: unknown): PlayerDef[] {
  if (!Array.isArray(v)) return [];
  const out: PlayerDef[] = [];
  for (const x of v) {
    const p = readPlayer(x);
    if (p) out.push(p);
  }
  return out;
}

function readClub(v: unknown): ClubState | null {
  if (!isObj(v) || !isStr(v.name) || !isStr(v.short)) return null;
  const kit = readKit(v.kit);
  const formation = readFormation(v.formation);
  const squad = readPlayers(v.squad);
  if (!kit || !formation || squad.length < 11 || !squad.some((p) => p.role === 'GK')) return null;
  const maxId = squad.reduce((m, p) => Math.max(m, Number(p.id.replace(/\D/g, '')) || 0), 0);
  const short = sanitizeShort(v.short);
  const name = sanitizeName(v.name) || 'Blocky FC';
  return {
    name,
    short: short.length === 3 ? short : deriveShort(name),
    kit,
    formation,
    squad: squad.slice(0, SQUAD_MAX + 4),
    nextId: Math.max(int(v.nextId, 1, 1e9, 1), maxId + 1),
  };
}

function readLeagueClub(v: unknown): LeagueClub | null {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.name) || !isStr(v.short)) return null;
  const kit = readKit(v.kit);
  const formation = readFormation(v.formation);
  if (!kit || !formation || !isNum(v.level)) return null;
  const c: LeagueClub = {
    id: v.id,
    name: v.name,
    short: v.short,
    kit,
    formation,
    level: clamp(Math.round(v.level), 1, 99),
    rating: int(v.rating, 1, 99, clamp(Math.round(v.level), 1, 99)),
  };
  if (Array.isArray(v.out)) c.out = v.out.filter(isStr).slice(0, 40);
  if (Array.isArray(v.in)) c.in = readPlayers(v.in).slice(0, 12);
  return c;
}

function readFixture(v: unknown, ids: Set<string>): Fixture | null {
  if (!isObj(v) || !isStr(v.home) || !isStr(v.away) || !ids.has(v.home) || !ids.has(v.away)) return null;
  const played = isNum(v.hg) && isNum(v.ag);
  const f: Fixture = {
    md: int(v.md, 0, MATCHDAYS - 1, 0),
    home: v.home,
    away: v.away,
    hg: played ? int(v.hg, 0, 99, 0) : null,
    ag: played ? int(v.ag, 0, 99, 0) : null,
  };
  if (v.forfeit === true) f.forfeit = true;
  return f;
}

function readSeason(v: unknown): SeasonState | null {
  if (!isObj(v) || !Array.isArray(v.rivals) || !Array.isArray(v.fixtures)) return null;
  const rivals: LeagueClub[] = [];
  for (const r of v.rivals) {
    const c = readLeagueClub(r);
    if (!c) return null;
    rivals.push(c);
  }
  if (rivals.length !== CLUBS_PER_DIVISION - 1) return null;
  const ids = new Set([YOU, ...rivals.map((r) => r.id)]);
  const fixtures: Fixture[] = [];
  for (const x of v.fixtures) {
    const f = readFixture(x, ids);
    if (!f) return null;
    fixtures.push(f);
  }
  if (fixtures.length !== (CLUBS_PER_DIVISION / 2) * MATCHDAYS) return null;
  return {
    number: int(v.number, 1, 1e6, 1),
    division: clampDivision(isNum(v.division) ? v.division : BOTTOM_DIVISION),
    seed: isNum(v.seed) ? v.seed >>> 0 : 1,
    rivals,
    fixtures,
    matchday: int(v.matchday, 0, MATCHDAYS, 0),
  };
}

const OUTCOMES: Outcome[] = ['promoted', 'relegated', 'stayed'];

function readSummary(v: unknown): SeasonSummary | null {
  if (!isObj(v) || !OUTCOMES.includes(v.outcome as Outcome) || !isNum(v.position) || !isNum(v.season)) return null;
  const lines: PrizeLine[] = Array.isArray(v.lines)
    ? v.lines.filter((l): l is { label: string; coins: number } => isObj(l) && isStr(l.label) && isNum(l.coins)).map((l) => ({ label: l.label, coins: l.coins }))
    : [];
  return {
    season: int(v.season, 1, 1e6, 1),
    division: clampDivision(isNum(v.division) ? v.division : BOTTOM_DIVISION),
    position: int(v.position, 1, CLUBS_PER_DIVISION, CLUBS_PER_DIVISION),
    outcome: v.outcome as Outcome,
    champion: v.champion === true,
    nextDivision: clampDivision(isNum(v.nextDivision) ? v.nextDivision : BOTTOM_DIVISION),
    lines,
    prize: int(v.prize, 0, 1e9, 0),
  };
}

function readHistory(v: unknown): HistoryEntry[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((h): h is Obj => isObj(h) && OUTCOMES.includes(h.outcome as Outcome))
    .map((h) => ({
      season: int(h.season, 1, 1e6, 1),
      division: clampDivision(isNum(h.division) ? h.division : BOTTOM_DIVISION),
      position: int(h.position, 1, CLUBS_PER_DIVISION, CLUBS_PER_DIVISION),
      outcome: h.outcome as Outcome,
    }))
    .slice(-30);
}

const BID_STATUS = ['pending', 'countered'];
const NEWS_KINDS = ['good', 'bad', 'info'];

function readListing(v: unknown, ids: Set<string>): Listing | null {
  if (!isObj(v) || !isStr(v.id) || ids.has(v.id)) return null;
  const player = readPlayer(v.player);
  if (!player || !isNum(v.asking)) return null;
  ids.add(v.id);
  return {
    id: v.id,
    player,
    club: isStr(v.club) ? v.club : null,
    clubName: isStr(v.clubName) ? v.clubName.slice(0, 40) : '',
    asking: int(v.asking, 0, 1e9, 0),
    wage: int(v.wage, 0, 1e6, 0),
    age: int(v.age, 16, 40, 25),
    contract: int(v.contract, 1, 4, 1),
    form: int(v.form, -2, 2, 0),
    hot: v.hot === true,
    youth: v.youth === true,
    scouted: v.scouted === true,
    potential: int(v.potential, 0, 5, 0),
    arrived: int(v.arrived, 0, MATCHDAYS, 0),
    leaves: int(v.leaves, 0, MATCHDAYS + 4, 0),
  };
}

/** The market blob; anything off is dropped (escrowed coins of a dropped offer go to `owed`). */
function readMarket(v: unknown, live: boolean): MarketState {
  const tm = defaultMarket();
  if (!isObj(v)) return tm;
  tm.owed = int(v.owed, 0, 1e9, 0);
  tm.nextId = int(v.nextId, 1, 1e9, 1);
  tm.news = Array.isArray(v.news)
    ? v.news
        .filter((n): n is Obj => isObj(n) && isStr(n.text) && NEWS_KINDS.includes(n.kind as string))
        .slice(0, NEWS_MAX)
        .map((n) => ({
          season: int(n.season, 0, 1e6, 0),
          week: int(n.week, 0, MATCHDAYS, 0),
          text: (n.text as string).slice(0, 160),
          kind: n.kind as NewsKind,
          // Saves from before the flags: nothing is "yours" (so nothing unread) and nothing is unseen.
          own: n.own === true,
          seen: n.seen === true,
        }))
    : [];
  if (!live) return tm;
  tm.key = isStr(v.key) ? v.key : '';
  const ids = new Set<string>();
  if (Array.isArray(v.listings)) {
    for (const x of v.listings.slice(0, 24)) {
      const l = readListing(x, ids);
      if (l) tm.listings.push(l);
    }
  }
  if (Array.isArray(v.bids)) {
    for (const x of v.bids) {
      if (!isObj(x) || !isStr(x.id) || !isStr(x.listingId) || !isNum(x.amount)) continue;
      const player = readPlayer(x.player);
      const amount = int(x.amount, 0, 1e9, 0);
      if (!player || !ids.has(x.listingId) || tm.bids.some((b) => b.listingId === x.listingId)) {
        tm.owed += amount;
        continue;
      }
      tm.bids.push({
        id: x.id,
        listingId: x.listingId,
        amount,
        week: int(x.week, 0, MATCHDAYS, 0),
        status: BID_STATUS.includes(x.status as string) ? (x.status as Bid['status']) : 'pending',
        counter: int(x.counter, 0, 1e9, 0),
        player,
        clubName: isStr(x.clubName) ? x.clubName.slice(0, 40) : '',
      });
    }
  }
  if (Array.isArray(v.sales)) {
    for (const x of v.sales) {
      if (!isObj(x) || !isStr(x.playerId) || tm.sales.some((s) => s.playerId === x.playerId)) continue;
      const offers = Array.isArray(x.offers)
        ? x.offers
            .filter((o): o is Obj => isObj(o) && isStr(o.id) && isStr(o.club) && isNum(o.amount))
            .map((o) => ({
              id: o.id as string,
              club: o.club as string,
              clubName: isStr(o.clubName) ? o.clubName.slice(0, 40) : '',
              amount: int(o.amount, 0, 1e9, 0),
              week: int(o.week, 0, MATCHDAYS, 0),
              expires: int(o.expires, 0, MATCHDAYS + 4, 0),
            }))
        : [];
      tm.sales.push({ playerId: x.playerId, week: int(x.week, 0, MATCHDAYS, 0), offers });
    }
  }
  if (Array.isArray(v.shortlist)) tm.shortlist = [...new Set(v.shortlist.filter((s): s is string => isStr(s) && ids.has(s)))].slice(0, 5);
  return tm;
}

/**
 * Turn whatever is in SaveData.career (null on a fresh save, or an older/corrupt blob) into a valid
 * CareerState. Invalid parts fall back to safe defaults instead of throwing. A save from before the transfer
 * market (no `tm`) gets an empty market that fills on the next refreshMarket.
 */
export function migrateCareer(raw: unknown, freshSeed: number): CareerState {
  const base = defaultCareer(freshSeed);
  if (!isObj(raw)) return base;
  const club = readClub(raw.club);
  const season = club ? readSeason(raw.season) : null;
  const summary = season ? readSummary(raw.summary) : null;
  const live = !!season && !summary;
  const tm = readMarket(raw.tm, live);
  // Own players a sale record points at must exist.
  if (club) tm.sales = tm.sales.filter((s) => club.squad.some((p) => p.id === s.playerId));
  const st: CareerState = {
    version: CAREER_VERSION,
    seed: isNum(raw.seed) ? raw.seed >>> 0 : base.seed,
    club,
    season,
    summary,
    market: [],
    marketKey: '',
    tm,
    stadium: int(raw.stadium, 0, STADIUM_MAX, 0),
    history: readHistory(raw.history),
    notice: isStr(raw.notice) ? raw.notice.slice(0, 200) : null,
  };
  if (live) syncLegacyMarket(st);
  return st;
}
