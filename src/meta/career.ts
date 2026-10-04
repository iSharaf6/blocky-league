/**
 * Career + My Club meta-game: pure state and rules (no DOM).
 * Everything persists in SaveData.career as a versioned CareerState; coins live in the shared wallet (SaveData.coins).
 */
import { Rng, hashString } from '../core/rng';
import { safeName, safeShort } from '../core/names';
import { defaultCrest, normalizeCrest, setMyCrest, type CrestDesign } from '../core/crest';
import { FORMATIONS, FORMATION_IDS } from '../sim/formations';
import { overall, teamRating } from '../sim/types';
import type { FormationId, Kit, KitPattern, PlayerDef, PlayerStats, Role, TeamDef } from '../sim/types';
import { KIT_COLORS, dedupeSurnames, makePlayer, makeTeam, randomClubSeed, resolveKitClash, styleFor } from './data';
// Runtime import cycle (market.ts imports this file): only ever used inside functions, never at module top level.
import {
  MORALE_DIP, NEWS_MAX, WAGE_DIP, ageSquad, applyWageDrain, canBid, clearMarket, defaultMarket, marketTick, placeBid, quickSaleValue,
  recordStarts, syncLegacyMarket, wageDrain,
  type Bid, type Listing, type MarketState, type NewsKind,
} from './market';
// Runtime import cycle too (cup.ts imports this file): only ever used inside functions, never at module top level.
import {
  CUP_JOIN_BY, CUP_SIZE, ROUND_NAMES, ROUND_SHORT, cupFinish, cupRoundDue, drawCup, readCupTie, recordCupTie, settleCup, syncCup, userTie,
  type CupClub, type CupStatus, type RateClub, type SeasonCup, type TieOutcome,
} from './cup';
// The forever game (all runtime cycles: their bindings are only used inside functions here, and they do the same).
import {
  COMP_NAMES, STAGE_NAMES, advanceComp, compClub, compDue, compFinish, drawContinental, drawWorld, readComp, recordComp, settleComp,
  type CompKind, type CompOutcome, type Competition,
} from './comps';
import { checkBoard, confidenceBudget, defaultBoard, readBoard, setObjectives, type BoardState } from './board';
import {
  SCREEN_BONUS, TRAINING_DISCOUNT, defaultGround, groundFromLevel, groundLevel, has, megastoreCoins, partDef, readGround, startBuild, tickBuild,
  type BuildResult, type GroundState, type PartId,
} from './ground';
import {
  academyIntake, applyRetirements, captainOf, decideRetirements, defaultAcademy, matchLift, readAcademy, readFarewells, recordMatch, syncRecordSigning,
  type AcademyState, type Farewell, type LifePlayer, type MatchFacts,
} from './life';
import { LEGACY_POINTS, START_BONUS, addLegacy, archiveClub, defaultLegacy, hasPerk, readLegacy, type LegacyState } from './legacy';
import {
  addForm, addMoment, beforeMatchBeats, cupHeadline, defaultStory, derbyResult, matchHeadline, isDerby, placeRival, readStory, seasonStartBeats, storyNews, storyTag,
  type StoryState,
} from './story';
// The long game (runtime cycles again: only ever used inside functions): player development, the staff, the event
// cards and the club's week.
import { pinCeil, readGrow, traitLift, type GrowPlayer } from './growth';
import { defaultStaff, readStaff, type StaffState } from './staff';
import { addTimeline, afterAnyMatch, defaultEvents, readEvents, rollEvents, rollPress, type EventsState } from './events';
import { INJURED_DIP, matchXp, openAll, seasonStart, seasonTurn, weekTick } from './week';
import { sep } from '../ui/text';
import { archiveCareerHonours, type MasteryState } from './mastery';

export const CAREER_VERSION = 1 as const;
export const TOP_DIVISION = 1;
export const BOTTOM_DIVISION = 8;
/** Preserve the established economic/venue scale for existing clubs in divisions 1..6. */
const ORIGINAL_BOTTOM = 6;
export const CLUBS_PER_DIVISION = 8;
/** One round robin: the first half of the season (the second half is the return fixtures). */
export const HALF_SEASON = CLUBS_PER_DIVISION - 1;
/** A season is home and away: every club twice, 14 league matchdays. */
export const MATCHDAYS = HALF_SEASON * 2;
export const SQUAD_MIN = 14;
export const SQUAD_MAX = 23;
/** Free agents on the market at any time (the legacy `state.market` view; see meta/market.ts FREE_AGENTS). */
export const MARKET_SIZE = 4;
export const STADIUM_MAX = 5;
export const STAT_CAP = 99;
export const TRAIN_STEP = 2;
export const START_LEVEL = 35;
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

const DIVISION_LEVEL = [0, 88, 79, 70, 60, 51, 42, 38, 34];
export const DIVISION_NAMES = ['', 'ELITE LEAGUE', 'CHAMPIONSHIP', 'LEAGUE ONE', 'NATIONAL LEAGUE', 'COUNTY LEAGUE', 'SUNDAY LEAGUE', 'DISTRICT LEAGUE', 'PARK LEAGUE'];
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
  /** The club's crest as designed (core/crest.ts): always set on a club read from a save or made by createClub. */
  crest?: CrestDesign;
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
  /**
   * This season's BLOCKY CUP (meta/cup.ts): its ties come between league matchdays. Null only for a season that
   * was already too far along when the cup joined the career (a save from before it): the next season has one.
   */
  cup: SeasonCup | null;
  /** The CONTINENTAL CUP (Elite League seasons only; meta/comps.ts). */
  continental?: Competition | null;
  /** The WORLD CLUB CUP (the season after a league title in the Elite League or a Continental Cup). */
  world?: Competition | null;
  /** League id of your recurring rival this season (meta/story.ts): the derby. */
  derby?: string;
  /** This season's goals per squad id (the recap's top scorer). */
  scorers?: Record<string, { name: string; goals: number }>;
  /** Legacy points when the season began (the recap shows what it earned). */
  legacyAtStart?: number;
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
  /** How far the BLOCKY CUP run went (cup.ts FINISH_NAMES: 0 QF .. 3 winners); absent in a season without the cup. */
  cup?: number;
  /** How far the CONTINENTAL CUP / WORLD CLUB CUP runs went (comps.ts COMP_FINISH: 3 winners); absent when not in them. */
  continental?: number;
  world?: number;
  /** Players retiring this summer (they leave when the next season starts: the recap says farewell). */
  retiring?: Farewell[];
  /** Legacy points the season earned. */
  legacy?: number;
  /** League, Blocky Cup and Continental Cup in one season. */
  treble?: boolean;
}

export interface HistoryEntry {
  season: number;
  division: number;
  position: number;
  outcome: Outcome;
  /** The BLOCKY CUP run that season (0 out in the QF .. 3 winners: a trophy); absent before the cup joined the career. */
  cup?: number;
  /** CONTINENTAL CUP / WORLD CLUB CUP runs (3 winners); absent when the club wasn't in them. */
  continental?: number;
  world?: number;
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
  /** The ground's level 0..5 (derived from `ground` by ground.ts groundLevel: what gates, crowds and wages read). */
  stadium: number;
  history: HistoryEntry[];
  /** One-shot message shown on the career hub (e.g. forfeit after quitting). */
  notice: string | null;
  /** The board's objectives this season and its confidence (meta/board.ts). */
  board: BoardState;
  /** The ground, part by part (meta/ground.ts). */
  ground: GroundState;
  /** The youth academy's prospects (meta/life.ts). */
  academy: AcademyState;
  /** Club legacy, the Hall of Fame and the record book (meta/legacy.ts): it survives starting a new club. */
  legacy: LegacyState;
  /** The rival, the form and the moments waiting for the hub (meta/story.ts). */
  story: StoryState;
  /** The staff: coach, physio, scouts and their reports, academy director, commercial manager (meta/staff.ts). */
  staff: StaffState;
  /** The event cards waiting, the timeline, and everything an answer set running (meta/events.ts). */
  events: EventsState;
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
  /** The league matchday it is played on, or before (a cup tie comes between matchdays). */
  md: number;
  /** The league fixture; for a cup tie, the tie as a fixture (YOU and the rival's id, never in season.fixtures). */
  fixture: Fixture;
  userHome: boolean;
  rival: LeagueClub;
  home: TeamDef;
  away: TeamDef;
  /** Worn kits: the home side keeps its kit, the away side changes on a clash. */
  kits: [Kit, Kit];
  /** A league matchday, a BLOCKY CUP tie, or a CONTINENTAL / WORLD CLUB CUP fixture (meta/comps.ts). */
  competition: 'league' | 'cup' | CompKind;
  /** Comps: the fixture's stage (a group game can end level; the semi and final go to penalties). */
  stage?: 'group' | 'sf' | 'final';
  /** What the match is, for cards and the menu tile: "MATCHDAY 3" or "BLOCKY CUP QUARTER FINAL". */
  label: string;
  /** The same, short, for tight spaces: "MD 3" or "CUP QF". */
  tag: string;
  /** Cup ties: the round (0 QF, 1 SF, 2 final); -1 for a league match. */
  cupRound: number;
  /** The rival's division (a cup draw can bring a club from another division). */
  rivalDivision: number;
  /** The cup final: a neutral ground (the big bowl), neither side at home. */
  neutral: boolean;
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
  /** The crest designed in the club creator (default: one from the name and colours). */
  crest?: CrestDesign;
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
    crest: normalizeCrest(input.crest, defaultCrest(name, short, kit)),
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
  // (Your crest as you designed it, wherever this club's crest is drawn from here on: core/crest.ts crestFor.)
  setMyCrest(club);
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

/** A +2 session; `discount` (0..1) comes from the TRAINING GROUND and the legacy coach perk (trainingDiscount). */
export function trainingCost(p: PlayerDef, discount = 0): number {
  const base = 40 + overall(p) * 3;
  return discount > 0 ? round10(base * (1 - Math.min(0.5, discount))) : base;
}

/** What training is off at your club: 25% with the TRAINING GROUND, 10% more with the legacy coach perk. */
export function trainingDiscount(state: CareerState): number {
  return (has(state.ground, 'training') ? TRAINING_DISCOUNT : 0) + (hasPerk(state.legacy, 'coach') ? 0.1 : 0);
}

/** The squad level a new club starts at: a legend's new club (legacy perk) starts stronger. */
export function newClubLevel(state: CareerState): number {
  return START_LEVEL + (hasPerk(state.legacy, 'legend') ? START_BONUS : 0);
}

export function trainPlayer(club: ClubState, wallet: Wallet, playerId: string, stat: keyof PlayerStats, discount = 0): TxResult {
  const p = club.squad.find((x) => x.id === playerId);
  if (!p) return fail('not-found');
  if (p.stats[stat] >= STAT_CAP) return fail('maxed');
  const cost = trainingCost(p, discount);
  if (wallet.coins < cost) return fail('no-coins');
  wallet.coins -= cost;
  // (His potential is what he can grow into by himself: a paid session never moves it.)
  pinCeil(p);
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
    board: defaultBoard(),
    ground: defaultGround(),
    academy: defaultAcademy(),
    legacy: defaultLegacy(),
    story: defaultStory(),
    staff: defaultStaff(),
    events: defaultEvents(),
  };
}

/**
 * A home and away season via the circle method: a round robin (ids[0], the player's club, is fixed and alternates
 * home/away each matchday), then the same fixtures again with the grounds swapped. Every pair meets twice, once at
 * each ground, and every club plays once per matchday.
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
  return [...out, ...returnFixtures(out, m)];
}

/** The second half of a season: every first-half fixture again, `half` matchdays later, at the other ground. */
export function returnFixtures(firstHalf: readonly Fixture[], half: number): Fixture[] {
  return firstHalf.map((f) => ({ md: f.md + half, home: f.away, away: f.home, hg: null, ag: null }));
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
  // Your recurring rival takes a slot in this league (story.ts): it follows you up and down the divisions.
  const derby = state.club ? placeRival(state, rivals) : undefined;
  const rv = derby ? rivals.find((r) => r.id === derby) : undefined;
  if (rv) rv.rating = teamRating(makeTeam({ name: rv.name, short: rv.short, kit: rv.kit, formation: rv.formation, level: rv.level }));
  // The cup draw has its own seeded stream (cup.ts), so the league above comes out as it always did.
  const cup = drawCup(seed, div, rivals, state.club);
  const season: SeasonState = { number, division: div, seed, rivals, fixtures, matchday: 0, cup };
  if (derby) season.derby = derby;
  if (state.legacy) season.legacyAtStart = state.legacy.points;
  // The Elite League brings the CONTINENTAL CUP (comps.ts): every season up there.
  if (div === TOP_DIVISION && state.club) season.continental = drawContinental(seed, state.club, rivals);
  state.season = season;
  state.summary = null;
  // A fresh market for the season (any offer still live is refunded through tm.owed).
  clearMarket(state);
  refreshMarket(state);
  if (state.club) {
    // The academy opens from the club's second season (the first is for finding your feet).
    if (number > 1) academyIntake(state);
    setObjectives(state);
    seasonStartBeats(state);
  }
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
  // A cup tie (or a Continental / World Club Cup fixture) that is due comes first (nextMatch offers it first).
  if (cupRoundDue(season.cup, season.matchday) >= 0 || compsDue(state)) return false;
  const f = userFixture(season, md);
  if (!f || f.hg !== null) return false;
  f.hg = Math.max(0, Math.round(hg));
  f.ag = Math.max(0, Math.round(ag));
  if (forfeit) f.forfeit = true;
  simulateMatchday(state, md);
  recordStarts(state.club);
  season.matchday++;
  // Out of the cup: its later rounds are still played, as the calendar reaches them.
  if (season.cup) syncCup(season.cup, season.matchday, clubRater(state));
  for (const comp of [season.world, season.continental]) if (comp) advanceComp(comp, season.matchday, clubRater(state));
  // The wage bill: over budget, 1.5× the overspend leaves the wallet after every matchday (market.ts).
  applyWageDrain(state, wallet);
  // The story: the form, the derby, the ground going up, the board's objectives.
  const home = f.home === YOU;
  const [my, their] = home ? [f.hg, f.ag] : [f.ag, f.hg];
  addForm(state, my, their);
  matchHeadline(state, md, my, their, home, forfeit);
  const derby = !!season.derby && (f.home === season.derby || f.away === season.derby);
  if (derby) derbyResult(state, my, their);
  buildWeek(state);
  // The week at the club (meta/week.ts): the staff are paid, the squad trains, injuries, mentors, morale, the
  // scouts, the sponsor, promises. A walk-off is a result like any other here.
  afterAnyMatch(state, my > their);
  weekTick(state, wallet, { my, their, home, derby });
  if (season.matchday >= MATCHDAYS) finishSeason(state, wallet);
  else {
    checkBoard(state);
    refreshMarket(state, wallet);
    const next = nextMatch(state);
    beforeMatchBeats(state, next);
    // What the week brought: at most one new card to answer (meta/events.ts).
    rollEvents(state, { my, their }, next);
  }
  return true;
}

/** A league matchday passed: the build moves on; a part that opens is a moment and lifts the ground's level. */
function buildWeek(state: CareerState, all = false): void {
  const opened = tickBuild(state.ground, all);
  if (!opened) return;
  state.stadium = Math.max(0, Math.min(STADIUM_MAX, groundLevel(state.ground)));
  const name = partDef(opened).steps[(state.ground.built[opened] ?? 1) - 1]?.name ?? partDef(opened).name;
  addMoment(state, { kind: 'build', icon: partDef(opened).icon, title: 'NOW OPEN', text: `THE ${name} IS READY FOR MATCHDAY` });
  storyNews(state, `${state.club?.name ?? 'The club'} open the ${name.toLowerCase()}`, 'good');
}

/** FINISH NOW (meta/premium.ts): the part being built opens at once, with its moment. False when nothing is going up. */
export function finishBuild(state: CareerState): boolean {
  if (!state.ground.building) return false;
  buildWeek(state, true);
  return true;
}

/** One matchday off the build without a match (meta/premium.ts, the rewarded ad). False when nothing is going up. */
export function skipBuild(state: CareerState): boolean {
  if (!state.ground.building) return false;
  buildWeek(state);
  return true;
}

/** The Continental or World Club Cup fixture of yours due now, if any (World first: it opens the season). */
export function compsDue(state: CareerState): { comp: Competition; idx: number } | null {
  const s = state.season;
  if (!s || state.summary || !state.club) return null;
  for (const comp of [s.world, s.continental]) {
    const idx = compDue(comp, s.matchday);
    if (comp && idx >= 0) return { comp, idx };
  }
  return null;
}

/**
 * Record your CONTINENTAL / WORLD CLUB CUP fixture due now (as resolveCupTie): goals after 90, `won` settles a level
 * knockout, `pens` its shootout. The prize comes back in the outcome (compTieReward pays it with the match). Null when
 * nothing is due (a stale request can't play a fixture twice).
 */
export function resolveCompTie(state: CareerState, my: number, their: number, won: boolean, pens: [number, number] | null = null): CompOutcome | null {
  const season = state.season;
  const due = compsDue(state);
  if (!season || !due || cupRoundDue(season.cup, season.matchday) >= 0) return null;
  const out = recordComp(due.comp, season.matchday, clubRater(state), my, their, won, pens);
  if (!out) return null;
  addForm(state, my, their, my === their && out.stage !== 'group' ? out.won : undefined);
  afterAnyMatch(state, out.won);
  if (out.stage !== 'group' || out.trophy) cupHeadline(state, COMP_NAMES[out.kind].toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()), STAGE_NAMES[out.stage], out.won, out.trophy);
  if (out.trophy) {
    due.comp.celebrated = true;
    addMoment(state, {
      kind: 'trophy', icon: 'trophy', coins: out.coins, title: out.kind === 'world' ? 'WORLD CHAMPIONS!' : 'CHAMPIONS OF THE CONTINENT!',
      text: `${state.club!.name.toUpperCase()} WIN THE ${COMP_NAMES[out.kind]}`,
    });
  }
  checkBoard(state);
  // (A semi final or a final next: the press wants a word.)
  rollPress(state);
  return out;
}

/** What a Continental / World Club Cup fixture pays at full time: the match fee plus the stage's prize. */
export function compTieReward(division: number, stadium: number, my: number, their: number, out: CompOutcome | null): { coins: number; label: string } {
  const fee = matchCoins(division, stadium, my, their);
  if (!out) return { coins: fee, label: 'CUP FIXTURE' };
  const name = out.kind === 'world' ? 'WORLD' : 'CONTINENTAL';
  const label = out.trophy ? `${name} WINNERS!` : out.won ? `${out.stage === 'group' ? 'GROUP' : out.stage === 'sf' ? 'SF' : 'FINAL'} WIN BONUS` : out.stage === 'group' ? 'GROUP MATCH' : 'KNOCKED OUT';
  return { coins: fee + out.coins, label };
}

/**
 * The ground and legacy on top of a match's pay (your stadium's own level is already in it): the BIG SCREEN's
 * sponsors and the legacy gate perk (+5% each), and the MEGASTORE's shirt sales at a home match.
 */
export function groundBonus(state: CareerState, r: { coins: number; label: string }, home: boolean, division: number): { coins: number; label: string } {
  let mult = 0;
  if (has(state.ground, 'screen')) mult += SCREEN_BONUS;
  if (hasPerk(state.legacy, 'gate')) mult += 0.05;
  let coins = Math.round(r.coins * (1 + mult));
  let label = r.label;
  if (home && has(state.ground, 'store')) {
    coins += megastoreCoins(division);
    label = `${label}${sep()}MEGASTORE`;
  }
  return { coins, label };
}

/**
 * After any match of yours (league, cup or comp): appearances, goals, records and milestones (life.ts), the record
 * signing, and the board checked once more. The UI calls it at full time with what the match left behind.
 */
export function afterMatch(state: CareerState, facts: MatchFacts): void {
  if (!state.club || !state.season) return;
  recordMatch(state, facts);
  syncRecordSigning(state);
  // What the match taught them (meta/week.ts): XP for those who played, and an academy graduate's big day.
  matchXp(state, facts, new Set(state.club.squad.slice(0, 11).map((p) => p.id)));
  if (!state.summary) checkBoard(state);
}

/** Forfeit scoreline (home, away) when the player walks off: a 3-0 defeat. */
export function forfeitScore(userHome: boolean): [number, number] {
  return userHome ? [0, 3] : [3, 0];
}

// ------------------------------------------------------------------ the BLOCKY CUP in the season

/** Ratings the cup's simulated ties use: your club as it is now, league rivals as the league rates them. */
function clubRater(state: CareerState): RateClub {
  const rivals = new Map((state.season?.rivals ?? []).map((r) => [r.id, r.rating]));
  return (id) => (id === YOU ? (state.club ? clubRating(state.club) : 50) : rivals.get(id) ?? 50);
}

/** Every club in this season's cup draw by id (you, your league rivals, the guests), each with its division. */
export function cupClubs(state: CareerState): Map<string, CupClub> {
  const out = new Map<string, CupClub>();
  const season = state.season;
  if (!season) return out;
  for (const c of leagueClubs(state)) out.set(c.id, { ...c, division: season.division });
  for (const g of season.cup?.guests ?? []) out.set(g.id, g);
  return out;
}

/** The cup round due before the next league matchday, or -1 (none due, out, or no cup this season). */
export function cupDue(state: CareerState): number {
  const s = state.season;
  if (!s || state.summary || !state.club) return -1;
  return cupRoundDue(s.cup, s.matchday);
}

/**
 * Record the player's BLOCKY CUP tie: goals for and against after 90, `won` settles a level tie (the shootout),
 * `pens` the shootout goals [yours, theirs]. The rest of the round is settled and the next drawn. The round's prize
 * comes back in the outcome, for the full-time reward to pay with the match (cupTieReward). Null (and nothing
 * changes) when no tie is due: a stale request can't play a tie twice.
 */
export function resolveCupTie(state: CareerState, my: number, their: number, won: boolean, pens: [number, number] | null = null): TieOutcome | null {
  const season = state.season;
  if (!season?.cup || !state.club || cupDue(state) < 0) return null;
  // (No market week passes and no wages drain: those go by league matchdays. Nor do cup starts lift a signing's
  // resale cap: that counts league starts, market.ts RESALE_STARTS.)
  const out = recordCupTie(season.cup, season.division, season.matchday, clubRater(state), my, their, won, pens);
  if (out) {
    addForm(state, my, their, my === their ? out.won : undefined);
    afterAnyMatch(state, out.won);
    cupHeadline(state, 'Blocky Cup', ROUND_NAMES[out.round], out.won, out.trophy);
    checkBoard(state);
    rollPress(state);
  }
  return out;
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

/** Top 2 go up (never above division 1), bottom 2 go down (never below division 8). */
export function seasonOutcome(position: number, division: number): { outcome: Outcome; nextDivision: number } {
  const div = clampDivision(division);
  if (position <= 2 && div > TOP_DIVISION) return { outcome: 'promoted', nextDivision: div - 1 };
  if (position > CLUBS_PER_DIVISION - 2 && div < BOTTOM_DIVISION) return { outcome: 'relegated', nextDivision: div + 1 };
  return { outcome: 'stayed', nextDivision: div };
}

export function seasonPrizeLines(position: number, division: number): PrizeLine[] {
  const div = clampDivision(division);
  const lines: PrizeLine[] = [];
  const finish = (CLUBS_PER_DIVISION - position) * (20 + 10 * (Math.max(0, ORIGINAL_BOTTOM - div)));
  if (finish > 0) lines.push({ label: 'LEAGUE POSITION', coins: finish });
  if (position <= 2) lines.push({ label: div > TOP_DIVISION ? 'PROMOTION PRIZE' : 'TOP TWO PRIZE', coins: 600 + 250 * (Math.max(0, ORIGINAL_BOTTOM - div)) });
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
  // The cup is over by now (the league waits for every tie); a damaged save's leftover tie is settled here.
  const cup = season.cup;
  if (cup) settleCup(cup, season.division, clubRater(state));
  const finish = cup ? cupFinish(cup) : -1;
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
  const entry: HistoryEntry = { season: season.number, division: season.division, position, outcome };
  if (finish >= 0) summary.cup = entry.cup = finish;
  // The Continental and World Club Cups are over too (a leftover fixture of yours is a walk-over).
  for (const comp of [season.world, season.continental]) {
    if (!comp) continue;
    settleComp(comp, clubRater(state));
    const f = compFinish(comp);
    if (comp.kind === 'world') summary.world = entry.world = f;
    else summary.continental = entry.continental = f;
  }
  state.summary = summary;
  state.history = [...state.history, entry].slice(-30);
  clearMarket(state, wallet);
  // The board's verdict (the finish judged, anything still open failed), the legacy the season earned, and who retires.
  checkBoard(state, true);
  seasonLegacy(state, summary);
  summary.legacy = Math.max(0, state.legacy.points - (season.legacyAtStart ?? state.legacy.points));
  const retiring = decideRetirements(state);
  if (retiring.length) summary.retiring = retiring;
  return summary;
}

/** Legacy for the season's big things: the title, promotion, the cups, and the treble (the dynasty goal). */
function seasonLegacy(state: CareerState, s: SeasonSummary): void {
  const name = DIVISION_NAMES[s.division] ?? 'LEAGUE';
  if (s.champion) addLegacy(state, LEGACY_POINTS.title(s.division), `${name} CHAMPIONS`);
  if (s.outcome === 'promoted') addLegacy(state, LEGACY_POINTS.promotion, `PROMOTED TO THE ${DIVISION_NAMES[s.nextDivision] ?? 'NEXT LEAGUE'}`);
  if (s.cup === 3) addLegacy(state, LEGACY_POINTS.cup, 'BLOCKY CUP WINNERS');
  else if (s.cup === 2) addLegacy(state, LEGACY_POINTS.cupFinal, 'BLOCKY CUP FINALISTS');
  if (s.continental === 3) addLegacy(state, LEGACY_POINTS.continental, 'CONTINENTAL CUP WINNERS');
  if (s.world === 3) addLegacy(state, LEGACY_POINTS.world, 'WORLD CLUB CHAMPIONS');
  if (s.division === TOP_DIVISION && s.champion && s.cup === 3 && s.continental === 3) {
    s.treble = true;
    state.legacy.trebles++;
    addLegacy(state, LEGACY_POINTS.treble, 'THE TREBLE');
    addMoment(state, { kind: 'trophy', icon: 'crown', title: 'THE TREBLE', text: 'LEAGUE, BLOCKY CUP AND CONTINENTAL CUP IN ONE SEASON' });
  }
}

export function startNextSeason(state: CareerState): SeasonState | null {
  const s = state.summary;
  if (!s) return null;
  const club = state.club;
  if (club) {
    // A year passes: the young grow into their potential, the old fade, contracts tick down; the retired say goodbye.
    ageSquad(club);
    // The summer (meta/week.ts): contracts that ran out without a new deal, knocks healed, old promises forgotten.
    seasonTurn(state);
    applyRetirements(state, s.retiring ?? []);
    // A new captain is news (the most games for you).
    const cap = captainOf(club) as LifePlayer | undefined;
    if (cap && (cap.apps ?? 0) >= 10 && !state.legacy.milestones.includes(`${state.legacy.gen}:captain:${cap.id}`)) {
      state.legacy.milestones = [...state.legacy.milestones, `${state.legacy.gen}:captain:${cap.id}`].slice(-300);
      storyNews(state, `${cap.name} is the new club captain`, 'good');
    }
  }
  // Over the summer the builders finish whatever is going up.
  buildWeek(state, true);
  const season = newSeason(state, s.nextDivision, s.season + 1);
  // Champions of the Elite League or of the continent are invited to the WORLD CLUB CUP (it opens the season).
  if (club && s.division === TOP_DIVISION && (s.champion || s.continental === 3)) {
    season.world = drawWorld(season.seed, club);
    storyNews(state, `${club.name} are invited to the World Club Cup!`, 'good');
  }
  // A point on everyone's growth chart, after the summer's growth.
  seasonStart(state);
  return season;
}

/**
 * START A NEW CLUB AS A LEGEND (after an Elite League title or a treble): this club goes into the Hall of Fame and the
 * road starts again with a club you found. Legacy, legends, perks, coins and cosmetics stay; the squad, the ground,
 * the league and the market start over. Returns false when it isn't open yet.
 */
export function startAsLegend(state: CareerState, mastery?: MasteryState): boolean {
  if (!archiveClub(state)) return false;
  if (mastery) archiveCareerHonours(mastery, state);
  const keep = { seed: state.seed, legacy: state.legacy, story: state.story, events: state.events, network: state.staff.network };
  const fresh = defaultCareer((hashString(`${keep.seed}|legend|${keep.legacy.gen}`) >>> 0) || 1);
  Object.assign(state, fresh, { legacy: keep.legacy, story: { ...defaultStory(), moments: keep.story.moments } });
  // What a legend has learned stays open (no second tutorial), and so does the Scouting Network; the staff, the
  // cards and the timeline start again with the new club.
  state.events.open = [...keep.events.open];
  state.events.played = keep.events.played;
  state.staff.network = keep.network;
  return true;
}

/**
 * The player's next match: a BLOCKY CUP tie when one is due (it comes before the league matchday it precedes),
 * otherwise the league fixture. Null when the season is over (or there's no club).
 */
export function nextMatch(state: CareerState): NextMatch | null {
  const { club, season } = state;
  if (!club || !season || state.summary || season.matchday >= MATCHDAYS) return null;
  const due = cupDue(state);
  if (due >= 0 && season.cup) return nextCupTie(state, club, season, season.cup, due);
  const comp = compsDue(state);
  if (comp) return nextCompTie(state, club, season, comp.comp, comp.idx);
  const fixture = userFixture(season, season.matchday);
  if (!fixture) return null;
  const userHome = fixture.home === YOU;
  const rival = season.rivals.find((r) => r.id === (userHome ? fixture.away : fixture.home));
  if (!rival) return null;
  const md = season.matchday;
  // A derby or a decider: a BIG GAME player lifts (meta/growth.ts), and the rival may be fired up (the press).
  const tag = storyTag(state, { competition: 'league', rival, md } as NextMatch);
  const big = isDerby(state, rival.id) || (!!tag && /DECIDER|SURVIVAL/.test(tag.tag));
  const [home, away] = matchSides(state, club, rival, userHome, big);
  return {
    md, fixture, userHome, rival, home, away, kits: [home.kit, resolveKitClash(home.kit, away.kit)],
    competition: 'league', label: `MATCHDAY ${md + 1}`, tag: `MD ${md + 1}`, cupRound: -1, rivalDivision: season.division, neutral: false,
  };
}

function nextCupTie(state: CareerState, club: ClubState, season: SeasonState, cup: SeasonCup, round: number): NextMatch | null {
  const ut = userTie(cup);
  const rivalId = ut ? cup.slots[ut.rival] : undefined;
  const rival = rivalId ? cupClubs(state).get(rivalId) : undefined;
  if (!ut || !rivalId || !rival) return null;
  // The final is at a neutral ground: you wear your own kit (listed first), neither side is at home.
  const neutral = round === 2;
  const userHome = neutral || ut.userHome;
  const [home, away] = matchSides(state, club, rival, userHome, round >= 1);
  const md = season.matchday;
  const fixture: Fixture = { md, home: userHome ? YOU : rivalId, away: userHome ? rivalId : YOU, hg: null, ag: null };
  return {
    md, fixture, userHome, rival, home, away, kits: [home.kit, resolveKitClash(home.kit, away.kit)],
    competition: 'cup', label: `BLOCKY CUP ${ROUND_NAMES[round]}`, tag: `CUP ${ROUND_SHORT[round]}`, cupRound: round,
    rivalDivision: rival.division, neutral,
  };
}

/** A CONTINENTAL / WORLD CLUB CUP fixture: group games at home or away, the semi and the final as knockouts, the final on neutral ground. */
function nextCompTie(state: CareerState, club: ClubState, season: SeasonState, comp: Competition, idx: number): NextMatch | null {
  const f = comp.fixtures[idx];
  const rivalId = f.home === YOU ? f.away : f.home;
  const rival = compClub(comp, rivalId);
  if (!rival) return null;
  const neutral = f.stage === 'final';
  const userHome = neutral || f.home === YOU;
  const [home, away] = matchSides(state, club, rival, userHome, f.stage !== 'group');
  const md = season.matchday;
  const fixture: Fixture = { md, home: userHome ? YOU : rivalId, away: userHome ? rivalId : YOU, hg: null, ag: null };
  const name = COMP_NAMES[comp.kind];
  const round = f.stage === 'group' ? `GROUP GAME ${comp.fixtures.filter((x, i) => i <= idx && x.stage === 'group' && (x.home === YOU || x.away === YOU)).length}` : STAGE_NAMES[f.stage];
  return {
    md, fixture, userHome, rival, home, away, kits: [home.kit, resolveKitClash(home.kit, away.kit)],
    competition: comp.kind, stage: f.stage, label: `${name} ${round}`, tag: `${comp.kind === 'world' ? 'WORLD' : 'CONT'} ${f.stage === 'group' ? 'GROUP' : f.stage === 'sf' ? 'SF' : 'FINAL'}`,
    cupRound: f.stage === 'group' ? 0 : f.stage === 'sf' ? 1 : 2, rivalDivision: 0, neutral,
  };
}

/**
 * [home, away] teams for a match of yours against `rival`: your XI as it plays now, and the rival's. `big`: a derby,
 * a decider, a semi final or a final (where a BIG GAME player lifts).
 */
function matchSides(state: CareerState, club: ClubState, rival: LeagueClub, userHome: boolean, big = false): [TeamDef, TeamDef] {
  const you = clubTeam(club);
  // Players you have put up for sale have their mind elsewhere (a small stat dip until unlisted or sold), and
  // a squad whose wages are over budget plays a point down across the board.
  const listed = new Set(state.tm.sales.map((s) => s.playerId));
  const unpaid = wageDrain(state) > 0 ? WAGE_DIP : 0;
  // HIGH morale, STRONG chemistry, a TEAM TALK and the FAN ZONE at home lift the whole side a little, LOW morale
  // costs it a point (life.ts, -1 to +2).
  const lift = matchLift(state, userHome);
  const tune = (p: PlayerDef, bench: boolean): void => {
    // A man fielded hurt plays well below himself; his traits show on the day (meta/growth.ts traitLift).
    const d = lift - unpaid - (listed.has(p.id) ? MORALE_DIP : 0) - (((p as GrowPlayer).inj ?? 0) > 0 ? INJURED_DIP : 0);
    const t = traitLift(p, { big, bench });
    for (const k of STAT_KEYS) {
      const add = d + (typeof t === 'number' ? t : t[k] ?? 0);
      if (add) p.stats[k] = clamp(p.stats[k] + add, 1, STAT_CAP);
    }
  };
  you.players.forEach((p) => tune(p, false));
  (you.bench ?? []).forEach((p) => tune(p, true));
  const them = rivalTeam(rival);
  // What you said to the press before the derby shows up in it: the rival fired up, or relaxed (meta/events.ts).
  const fire = isDerby(state, rival.id) ? state.events?.rivalFire ?? 0 : 0;
  if (fire) for (const p of [...them.players, ...(them.bench ?? [])]) for (const k of STAT_KEYS) p.stats[k] = clamp(p.stats[k] + fire, 1, STAT_CAP);
  // No surname twice in the fixture: the rival's clashing players get another (deterministic) name.
  dedupeSurnames(you, them);
  return userHome ? [you, them] : [them, you];
}

/** Generated rival squads, by what they are generated from (a squad is asked for many times a matchday). */
const rivalBaseCache = new Map<string, TeamDef>();

function rivalBase(r: LeagueClub): TeamDef {
  // Each league rival plays its own way (styleFor is deterministic from the name, so a club keeps its style).
  // The squad itself is deterministic from the club's id, name, level and shape, so it is generated once and
  // handed out as fresh copies (callers rename and tune their copy).
  const key = `${r.id}|${r.name}|${r.short}|${r.level}|${r.formation}`;
  let t = rivalBaseCache.get(key);
  if (!t) {
    if (rivalBaseCache.size > 96) rivalBaseCache.clear();
    t = makeTeam({ name: r.name, short: r.short, kit: r.kit, formation: r.formation, level: r.level, style: styleFor(r.name) }, r.id);
    rivalBaseCache.set(key, t);
  }
  return { ...t, kit: r.kit, players: t.players.map(clonePlayer), bench: (t.bench ?? []).map(clonePlayer) };
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
  const base = Math.max(0, ORIGINAL_BOTTOM - d);
  const strong = rival.level > DIVISION_LEVEL[d] + 3 ? 1 : 0;
  return clamp(base + strong, 0, STADIUM_MAX);
}

export function matchAttendance(stadium: number): number {
  return Math.min(1, 0.35 + clamp(stadium, 0, STADIUM_MAX) * 0.12);
}

export function payTable(division: number, stadium: number): { win: number; draw: number; loss: number; goal: number; mult: number } {
  const win = 120 + 40 * (Math.max(0, ORIGINAL_BOTTOM - clampDivision(division)));
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
  const win = 120 + 40 * (Math.max(0, ORIGINAL_BOTTOM - clampDivision(division)));
  const base = my > their ? win : my === their ? Math.round(win * 0.45) : Math.round(win * 0.2);
  return Math.round((base + 15 * Math.max(0, my)) * (1 + 0.1 * clamp(stadium, 0, STADIUM_MAX)));
}

export function matchReward(division: number, stadium: number, my: number, their: number): { coins: number; label: string } {
  const base = my > their ? 'WIN BONUS' : my === their ? 'DRAW FEE' : 'MATCH FEE';
  const s = clamp(stadium, 0, STADIUM_MAX);
  // (HTML: the post-match reward line renders it; the divider is the ui/text.ts element, not a glyph.)
  return { coins: matchCoins(division, stadium, my, their), label: s > 0 ? `${base}${sep()}+${s * 10}% GATE` : base };
}

/**
 * What a BLOCKY CUP tie pays at full time: the usual match fee (as a league match: result, goals, your ground's
 * gate) plus the round's prize when you go through (`outcome` from resolveCupTie; null = a stale tie, fee only).
 */
export function cupTieReward(division: number, stadium: number, my: number, their: number, outcome: TieOutcome | null): { coins: number; label: string } {
  const fee = matchCoins(division, stadium, my, their);
  if (!outcome) return { coins: fee, label: 'CUP TIE' };
  const label = outcome.trophy ? 'CUP WINNERS!' : outcome.won ? `${ROUND_SHORT[outcome.round]} WIN BONUS` : 'KNOCKED OUT';
  return { coins: fee + outcome.coins, label };
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

/**
 * The old one-step upgrade (whole levels, built at once). The game now builds part by part (ground.ts startBuild,
 * MY CLUB > STADIUM); this stays for old callers: it puts up the stands of the next level and keeps any facility.
 */
export function upgradeStadium(state: CareerState, wallet: Wallet): TxResult {
  if (state.stadium >= STADIUM_MAX) return fail('maxed');
  const cost = stadiumUpgradeCost(state.stadium);
  if (wallet.coins < cost) return fail('no-coins');
  wallet.coins -= cost;
  state.stadium++;
  const g = groundFromLevel(state.stadium);
  for (const [id, lv] of Object.entries(g.built)) state.ground.built[id as PartId] = Math.max(state.ground.built[id as PartId] ?? 0, lv ?? 0);
  return { ok: true, delta: -cost };
}

/** Build the next step of a part of the ground (ground.ts): coins now, open after a matchday or two. */
export function buildPart(state: CareerState, wallet: Wallet, id: PartId): BuildResult {
  return startBuild(state.ground, wallet, id);
}

/** The weekly wage budget with the board's confidence and the legacy budget perk in it. */
export function wageBudgetFor(state: CareerState, base: number): number {
  return Math.round((base * confidenceBudget(state.board) * (hasPerk(state.legacy, 'budget') ? 1.1 : 1)) / 10) * 10;
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
  // His life at the club (life.ts): games, goals, the season he joined, an academy graduate.
  const lp = p as LifePlayer;
  if (isNum(v.apps)) lp.apps = int(v.apps, 0, 1e6, 0);
  if (isNum(v.goals)) lp.goals = int(v.goals, 0, 1e6, 0);
  if (isNum(v.joined)) lp.joined = int(v.joined, 0, 1e6, 0);
  if (v.academy === true) lp.academy = true;
  // The long game (growth.ts): potential, XP, focus, traits, a mentor, the chart, morale, an injury.
  readGrow(v, p);
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
  const code = short.length === 3 ? short : deriveShort(name);
  return {
    name,
    short: code,
    kit,
    // (A club from before the crest designer gets one from its name and colours.)
    crest: normalizeCrest(v.crest, defaultCrest(name, code, kit)),
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

const CUP_STATUS: CupStatus[] = ['active', 'won', 'out'];

/** The season's saved cup, validated against its league (every slot a club that exists), or null. */
function readCup(v: unknown, rivals: LeagueClub[]): SeasonCup | null {
  if (!isObj(v) || !Array.isArray(v.slots) || !Array.isArray(v.guests) || !Array.isArray(v.ties) || v.ties.length !== 7) return null;
  if (!CUP_STATUS.includes(v.status as CupStatus)) return null;
  const known = new Set<string>([YOU, ...rivals.map((r) => r.id)]);
  const guests: CupClub[] = [];
  for (const g of v.guests) {
    const c = readLeagueClub(g);
    if (!c || !isObj(g) || known.has(c.id)) return null;
    known.add(c.id);
    guests.push({ ...c, division: clampDivision(isNum(g.division) ? g.division : BOTTOM_DIVISION) });
  }
  const slots = v.slots;
  if (slots.length !== CUP_SIZE || new Set(slots).size !== CUP_SIZE || !slots.every((s): s is string => isStr(s) && known.has(s))) return null;
  const ties = v.ties.map(readCupTie);
  if (ties.some((t) => t === null)) return null;
  return {
    seed: isNum(v.seed) ? v.seed >>> 0 : 1,
    slots: [...slots],
    guests,
    user: slots.indexOf(YOU),
    ties: ties as SeasonCup['ties'],
    round: int(v.round, 0, 3, 0),
    status: v.status as CupStatus,
    earned: int(v.earned, 0, 1e9, 0),
    celebrated: v.celebrated === true,
  };
}

function readSeason(v: unknown, club: ClubState | null): SeasonState | null {
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
  const perMatchday = CLUBS_PER_DIVISION / 2;
  // A season saved when it was one round robin (seven matchdays): it becomes a home and away season. Every result
  // played stays where it is, and the return fixtures are added behind it (the matchday counter carries on).
  if (fixtures.length === perMatchday * HALF_SEASON && fixtures.every((f) => f.md < HALF_SEASON)) fixtures.push(...returnFixtures(fixtures, HALF_SEASON));
  if (fixtures.length !== perMatchday * MATCHDAYS) return null;
  const season: SeasonState = {
    number: int(v.number, 1, 1e6, 1),
    division: clampDivision(isNum(v.division) ? v.division : BOTTOM_DIVISION),
    seed: isNum(v.seed) ? v.seed >>> 0 : 1,
    rivals,
    fixtures,
    matchday: int(v.matchday, 0, MATCHDAYS, 0),
    cup: null,
  };
  // The BLOCKY CUP as saved. A save from before the cup (or a damaged one) gets this season's draw while there is
  // still room for it (CUP_JOIN_BY; a round already passed is played straight away); later on, next season has it.
  // A cup saved as null (no room when it joined) stays that way.
  if (v.cup !== null) {
    season.cup = readCup(v.cup, rivals) ?? (season.matchday <= CUP_JOIN_BY ? drawCup(season.seed, season.division, rivals, club) : null);
  }
  // The forever extras (absent on older saves: a season simply plays on without them).
  const continental = v.continental === undefined ? undefined : readComp(v.continental, readLeagueClub);
  if (continental !== undefined) season.continental = continental;
  const world = v.world === undefined ? undefined : readComp(v.world, readLeagueClub);
  if (world !== undefined) season.world = world;
  if (isStr(v.derby) && rivals.some((r) => r.id === v.derby)) season.derby = v.derby;
  if (isNum(v.legacyAtStart)) season.legacyAtStart = int(v.legacyAtStart, 0, 1e9, 0);
  if (isObj(v.scorers)) {
    const sc: Record<string, { name: string; goals: number }> = {};
    for (const [id, x] of Object.entries(v.scorers).slice(0, 40)) if (isObj(x) && isStr(x.name)) sc[id] = { name: x.name.slice(0, 40), goals: int(x.goals, 0, 999, 0) };
    season.scorers = sc;
  }
  return season;
}

const OUTCOMES: Outcome[] = ['promoted', 'relegated', 'stayed'];

function readSummary(v: unknown): SeasonSummary | null {
  if (!isObj(v) || !OUTCOMES.includes(v.outcome as Outcome) || !isNum(v.position) || !isNum(v.season)) return null;
  const lines: PrizeLine[] = Array.isArray(v.lines)
    ? v.lines.filter((l): l is { label: string; coins: number } => isObj(l) && isStr(l.label) && isNum(l.coins)).map((l) => ({ label: l.label, coins: l.coins }))
    : [];
  const s: SeasonSummary = {
    season: int(v.season, 1, 1e6, 1),
    division: clampDivision(isNum(v.division) ? v.division : BOTTOM_DIVISION),
    position: int(v.position, 1, CLUBS_PER_DIVISION, CLUBS_PER_DIVISION),
    outcome: v.outcome as Outcome,
    champion: v.champion === true,
    nextDivision: clampDivision(isNum(v.nextDivision) ? v.nextDivision : BOTTOM_DIVISION),
    lines,
    prize: int(v.prize, 0, 1e9, 0),
  };
  if (isNum(v.cup)) s.cup = int(v.cup, 0, 3, 0);
  if (isNum(v.continental)) s.continental = int(v.continental, 0, 3, 0);
  if (isNum(v.world)) s.world = int(v.world, 0, 3, 0);
  if (Array.isArray(v.retiring)) s.retiring = readFarewells(v.retiring);
  if (isNum(v.legacy)) s.legacy = int(v.legacy, 0, 1e7, 0);
  if (v.treble === true) s.treble = true;
  return s;
}

function readHistory(v: unknown): HistoryEntry[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((h): h is Obj => isObj(h) && OUTCOMES.includes(h.outcome as Outcome))
    .map((h) => {
      const e: HistoryEntry = {
        season: int(h.season, 1, 1e6, 1),
        division: clampDivision(isNum(h.division) ? h.division : BOTTOM_DIVISION),
        position: int(h.position, 1, CLUBS_PER_DIVISION, CLUBS_PER_DIVISION),
        outcome: h.outcome as Outcome,
      };
      // The cup run that season (a 3 is a trophy); seasons from before the cup have none.
      if (isNum(h.cup)) e.cup = int(h.cup, 0, 3, 0);
      if (isNum(h.continental)) e.continental = int(h.continental, 0, 3, 0);
      if (isNum(h.world)) e.world = int(h.world, 0, 3, 0);
      return e;
    })
    .slice(-30);
}

/** Trophies won: league titles (finished first) and BLOCKY CUPs, over the club's history (and the big two abroad). */
export function trophyCount(state: CareerState): { titles: number; cups: number; continental: number; world: number } {
  return {
    titles: state.history.filter((h) => h.position === 1).length,
    cups: state.history.filter((h) => h.cup === 3).length,
    continental: state.history.filter((h) => h.continental === 3).length,
    world: state.history.filter((h) => h.world === 3).length,
  };
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
          // The club's story lines (story.ts), kept apart from transfer gossip.
          ...(n.story === true ? { story: true } : {}),
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
  const season = club ? readSeason(raw.season, club) : null;
  const summary = season ? readSummary(raw.summary) : null;
  const live = !!season && !summary;
  const tm = readMarket(raw.tm, live);
  // Own players a sale record points at must exist.
  if (club) tm.sales = tm.sales.filter((s) => club.squad.some((p) => p.id === s.playerId));
  const stadium = int(raw.stadium, 0, STADIUM_MAX, 0);
  const st: CareerState = {
    version: CAREER_VERSION,
    seed: isNum(raw.seed) ? raw.seed >>> 0 : base.seed,
    club,
    season,
    summary,
    market: [],
    marketKey: '',
    tm,
    stadium,
    history: readHistory(raw.history),
    notice: isStr(raw.notice) ? raw.notice.slice(0, 200) : null,
    // The forever game's state (older saves: sensible defaults; an old stadium level becomes the parts that made it).
    board: readBoard(raw.board),
    ground: readGround(raw.ground, stadium),
    academy: readAcademy(raw.academy, readPlayer),
    legacy: readLegacy(raw.legacy, readKit),
    story: readStory(raw.story, readKit, readFormation),
    staff: readStaff(raw.staff, readPlayer),
    events: readEvents(raw.events),
  };
  // A career from before the long game that has already been played: everything it adds is open at once (no
  // tutorial cards for a manager seasons in), and the clock starts from where the career is.
  if (raw.events === undefined && club && (st.history.length > 0 || (season?.matchday ?? 0) > 0)) {
    openAll(st);
    st.events.played = st.history.length * MATCHDAYS + (season?.matchday ?? 0);
    addTimeline(st, `${club.name}: the story so far starts here`, 'flag', 'info');
  }
  if (live) syncLegacyMarket(st);
  // A save from before the board, mid-season: the board sets this season's objectives now (judged from here on).
  if (club && season && !summary && st.board.season !== season.number && raw.board === undefined) setObjectives(st);
  return st;
}
