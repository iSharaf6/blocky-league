/**
 * Transfer market: listings from the league's other clubs (real squad players, so a signing weakens them) and
 * free agents, offers below asking with a one-week answer, selling to AI offers, AI-to-AI trades, scouting and
 * a shortlist. Pure state and rules (no DOM); the screen lives in ui/market.ts. Everything persists in
 * CareerState.tm (career.ts owns the migration). Every draw comes from the career seed + season + week, so
 * the same career always sees the same market.
 *
 * Runtime import cycle with career.ts: this file touches career.ts bindings only inside functions (never at
 * module top level) and career.ts does the same with this file's, so either module can load first.
 */
import { Rng, hashString } from '../core/rng';
import { overall } from '../sim/types';
import type { PlayerDef, PlayerStats, Role } from '../sim/types';
import { makePlayer, surnameOf } from './data';
// (Runtime cycle: only used inside functions.) A player's potential: the overall his natural growth stops at.
import { hasRoom, pinCeil } from './growth';
import {
  KEY_STATS, SQUAD_MAX, SQUAD_MIN, STAT_CAP, STAT_KEYS, canSell, clonePlayer, divisionLevel, divisionPlayerOverall, freeNumber,
  playerPrice, removeFromSquad, rivalRating, rivalSquad, tuneToOverall, wageBudgetFor,
  type CareerState, type ClubState, type LeagueClub, type TxFail, type Wallet,
} from './career';

// ------------------------------------------------------------------ constants

/** Listings kept on the market each week (12..20 always holds: leavers are replaced up to this). */
export const LISTING_TARGET = 16;
export const LISTINGS_MIN = 12;
export const LISTINGS_MAX = 20;
/** Free agents (not counting the youth prospect) on the market at any time. */
export const FREE_AGENTS = 4;
/** A rival never has more than this many players listed at once. */
export const PER_CLUB_MAX = 3;
export const SHORTLIST_MAX = 5;
export const SCOUT_COST = 30;
/** An offer is 60%..110% of the asking price. */
export const BID_MIN = 0.6;
export const BID_MAX = 1.1;
/** Weeks (matches played so far) the window is open: the first three of the season and two at the halfway point. */
export const OPEN_WEEKS: readonly number[] = [0, 1, 2];
export const MID_WEEKS: readonly number[] = [7, 8];
export const AI_TRADES_PER_WEEK = 2;
/** Weeks an AI offer for one of your listed players stays on the table. */
export const OFFER_LIFE = 2;
export const MAX_OFFERS = 2;
export const RIVAL_SQUAD_MAX = 18;
/** Stat points a player listed for sale loses in matches (morale) until he is unlisted or sold. */
export const MORALE_DIP = 2;
export const NEWS_MAX = 12;
/** Quick sale (instant, no offers): this share of the player's value. */
export const QUICK_SALE = 0.45;
/** Players up to this age have hidden potential (growth every season). */
export const YOUNG_AGE = 23;
/** Weekly wage of an overall `o` player: o²/40 (45 → 51, 60 → 90, 88 → 194). */
export const WAGE_DIV = 40;
/** Over the wage budget: this share of the weekly overspend leaves the wallet after every matchday. */
export const WAGE_DRAIN = 1.5;
/** Stat points every player loses in matches while wages are over budget (unpaid, unhappy). */
export const WAGE_DIP = 1;
/**
 * No flipping: AI offers for a player you signed this season stay at or under RESALE_CAP × what you paid until
 * he has made RESALE_STARTS league starts for you (or the season ends).
 */
export const RESALE_CAP = 1.1;
export const RESALE_STARTS = 6;

// ------------------------------------------------------------------ types

/** Career players carry a few meta fields the sim ignores (missing on old saves: derived from the id and name). */
export interface MetaPlayer extends PlayerDef {
  age?: number;
  /** 0 (none / too old) .. 5 stars. */
  potential?: number;
  /** Seasons left, 1..4. */
  contract?: number;
  /** Coins you paid to sign him on the market (unset for anyone else). */
  paid?: number;
  /** Season number you signed him in (the resale cap lasts that season). */
  boughtSeason?: number;
  /** League starts for you since you signed him (market signings only). */
  starts?: number;
}

export interface Listing {
  id: string;
  /** Snapshot; for a club player the id is his id in that rival's squad. */
  player: MetaPlayer;
  /** Rival id, or null for a free agent. */
  club: string | null;
  clubName: string;
  asking: number;
  wage: number;
  age: number;
  contract: number;
  /** Recent form -2..2 (priced in). */
  form: number;
  /** Other clubs are interested: pricier, leaves sooner, may be snapped up under a low offer. */
  hot: boolean;
  youth: boolean;
  scouted: boolean;
  potential: number;
  arrived: number;
  /** Week he leaves the market (removed once week >= leaves, unless an offer is live). */
  leaves: number;
}

export type BidStatus = 'pending' | 'countered';

export interface Bid {
  id: string;
  listingId: string;
  /** Coins put aside for the offer (refunded if it fails). */
  amount: number;
  week: number;
  status: BidStatus;
  /** The club's counter price (status 'countered'); answer before the next match or it lapses. */
  counter: number;
  player: MetaPlayer;
  clubName: string;
}

export interface SaleOffer {
  id: string;
  club: string;
  clubName: string;
  amount: number;
  week: number;
  expires: number;
}

export interface Sale {
  playerId: string;
  week: number;
  offers: SaleOffer[];
}

export type NewsKind = 'good' | 'bad' | 'info';

export interface NewsItem {
  season: number;
  week: number;
  text: string;
  kind: NewsKind;
  /** About your own business (answers to your offers, offers for your players, your deals, your wage bill). */
  own: boolean;
  /** Read: set for everything once the market screen has been opened (see markNewsSeen / marketUnread). */
  seen?: boolean;
  /** The club's story, not a transfer (derby talk, cup runs, milestones, farewells: meta/story.ts). */
  story?: boolean;
}

export interface MarketState {
  /** `${season}:${week}` the market was last ticked for. */
  key: string;
  listings: Listing[];
  bids: Bid[];
  sales: Sale[];
  /** Listing ids, at most SHORTLIST_MAX. */
  shortlist: string[];
  /** Newest first. */
  news: NewsItem[];
  /** Refunds that came due while no wallet was at hand; paid on the next wallet-bearing call. */
  owed: number;
  nextId: number;
}

export type MarketFail = TxFail | 'window-closed' | 'wages' | 'pending' | 'bad-amount' | 'shortlist-full' | 'expired';
export type MarketResult<T = object> = ({ ok: true } & T) | { ok: false; reason: MarketFail };

export interface WindowInfo {
  open: boolean;
  /** Weeks until it closes (open) or opens (closed); 0 when it doesn't reopen this season. */
  weeks: number;
  label: string;
}

// ------------------------------------------------------------------ helpers

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const round10 = (v: number) => Math.round(v / 10) * 10;
const fail = (reason: MarketFail): { ok: false; reason: MarketFail } => ({ ok: false, reason });

function shuffle<T>(rng: Rng, a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** "Lakemoor Sporting" -> "Lakemoor" (news lines). */
export function townOf(name: string): string {
  return name.split(' ')[0] || name;
}

export function defaultMarket(): MarketState {
  return { key: '', listings: [], bids: [], sales: [], shortlist: [], news: [], owed: 0, nextId: 1 };
}

export function marketWeek(state: CareerState): number {
  return state.season?.matchday ?? 0;
}

export function windowOpen(week: number): boolean {
  return OPEN_WEEKS.includes(week) || MID_WEEKS.includes(week);
}

export function windowInfo(week: number): WindowInfo {
  if (windowOpen(week)) {
    let n = 0;
    while (windowOpen(week + n)) n++;
    return { open: true, weeks: n, label: n === 1 ? 'WINDOW CLOSES AFTER THIS MATCH' : `WINDOW OPEN FOR ${n} MORE MATCHES` };
  }
  const next = [...OPEN_WEEKS, ...MID_WEEKS].filter((w) => w > week).sort((a, b) => a - b)[0];
  if (next === undefined) return { open: false, weeks: 0, label: 'WINDOW CLOSED UNTIL NEXT SEASON' };
  const n = next - week;
  return { open: false, weeks: n, label: n === 1 ? 'WINDOW OPENS AFTER THIS MATCH' : `WINDOW OPENS IN ${n} MATCHES` };
}

// ------------------------------------------------------------------ player meta (age, potential, contract, wages, value)

export function playerAge(p: PlayerDef): number {
  const a = (p as MetaPlayer).age;
  if (typeof a === 'number' && Number.isFinite(a)) return clamp(Math.round(a), 16, 40);
  const h = hashString(`${p.id}|${p.name}|age`);
  // 17..33, most in their mid twenties.
  return 17 + (h % 9) + ((h >>> 8) % 9);
}

export function playerPotential(p: PlayerDef): number {
  const v = (p as MetaPlayer).potential;
  if (typeof v === 'number' && Number.isFinite(v)) return clamp(Math.round(v), 0, 5);
  if (playerAge(p) > YOUNG_AGE) return 0;
  return 1 + (hashString(`${p.id}|${p.name}|pot`) % 5);
}

export function contractOf(p: PlayerDef): number {
  const v = (p as MetaPlayer).contract;
  if (typeof v === 'number' && Number.isFinite(v)) return clamp(Math.round(v), 1, 4);
  return 1 + (hashString(`${p.id}|${p.name}|ctr`) % 4);
}

/** Pin the derived meta onto the player object (done when he joins a squad, since his id changes). */
export function pinMeta(p: PlayerDef, meta?: { age?: number; potential?: number; contract?: number }): MetaPlayer {
  const m = p as MetaPlayer;
  m.age = meta?.age ?? playerAge(p);
  m.potential = meta?.potential ?? playerPotential(p);
  m.contract = meta?.contract ?? contractOf(p);
  return m;
}

export function wageOf(p: PlayerDef): number {
  return Math.round(overall(p) ** 2 / WAGE_DIV);
}

export function squadWages(club: ClubState): number {
  return club.squad.reduce((s, p) => s + wageOf(p), 0);
}

/**
 * Weekly wage budget: what a full SQUAD_MAX squad of the division's typical player earns, plus 5% per stadium
 * level (a new club's 16 start at roughly 75% of it, so two or three signings fit before selling is needed).
 */
export function wageBudget(division: number, stadium: number): number {
  const typ = divisionLevel(division) + 5;
  return round10((typ ** 2 / WAGE_DIV) * SQUAD_MAX * (1 + 0.05 * clamp(stadium, 0, 5)));
}

/** Your club's wage budget: the division's and the ground's, moved by board confidence and the legacy perk (career.ts). */
export function clubWageBudget(state: CareerState): number {
  return wageBudgetFor(state, wageBudget(state.season?.division ?? 6, state.stadium));
}

/** Price multiplier by age: peak 24-28, cheap raw kids and veterans. */
export function ageFactor(age: number): number {
  if (age <= 19) return 0.9;
  if (age <= 23) return 1.05;
  if (age <= 28) return 1.1;
  if (age <= 30) return 0.95;
  if (age <= 32) return 0.75;
  return 0.55;
}

/** A player's transfer value: his rating price (career.ts playerPrice) by age and contract length. */
export function playerValue(p: PlayerDef): number {
  return round10(playerPrice(p) * ageFactor(playerAge(p)) * (1 + 0.08 * (contractOf(p) - 1)));
}

/** What a quick sale pays right now (45% of value); AI offers on a listed player run 70-95%. */
export function quickSaleValue(p: PlayerDef): number {
  return round10(playerValue(p) * QUICK_SALE);
}

export function bidRange(l: Pick<Listing, 'asking'>): [number, number] {
  return [round10(l.asking * BID_MIN), round10(l.asking * BID_MAX)];
}

// ------------------------------------------------------------------ growth (season rollover)

/**
 * Age everyone a year, grow the young by their potential stars (up to the overall they can reach: growth.ts ceilOf),
 * fade the old. Contracts tick down (never below 1).
 */
export function ageSquad(club: ClubState): void {
  for (const p of club.squad) {
    const m = pinMeta(p);
    // (His potential is fixed before the year moves him.)
    pinCeil(p);
    m.age = (m.age ?? playerAge(p)) + 1;
    m.contract = Math.max(1, (m.contract ?? 1) - 1);
    const grow = m.age <= YOUNG_AGE && hasRoom(p) ? (m.potential ?? 0) : 0;
    const keys = new Set<keyof PlayerStats>(KEY_STATS[p.role]);
    for (const k of STAT_KEYS) {
      let d = 0;
      if (grow) d = keys.has(k) ? grow : Math.ceil(grow / 2);
      else if (m.age >= 32) d = k === 'pace' || k === 'stamina' ? -2 : -1;
      else if (m.age >= 30 && (k === 'pace' || k === 'stamina')) d = -1;
      p.stats[k] = clamp(p.stats[k] + d, 8, STAT_CAP);
    }
    if (m.age > YOUNG_AGE) m.potential = 0;
  }
}

// ------------------------------------------------------------------ lookups

export function listingById(state: CareerState, id: string): Listing | undefined {
  return state.tm.listings.find((l) => l.id === id);
}

export function bidFor(state: CareerState, listingId: string): Bid | undefined {
  return state.tm.bids.find((b) => b.listingId === listingId);
}

export function saleFor(state: CareerState, playerId: string): Sale | undefined {
  return state.tm.sales.find((s) => s.playerId === playerId);
}

function rivalById(state: CareerState, id: string | null): LeagueClub | undefined {
  return id ? state.season?.rivals.find((r) => r.id === id) : undefined;
}

/** Put a line at the top of the club's NEWS (also used by meta/story.ts for derby talk, cup runs and milestones). */
export function pushNews(state: CareerState, text: string, kind: NewsKind, own = false, story = false): void {
  const tm = state.tm;
  const item: NewsItem = { season: state.season?.number ?? 0, week: marketWeek(state), text, kind, own, seen: false };
  if (story) item.story = true;
  tm.news = [item, ...tm.news].slice(0, NEWS_MAX);
}

const fmtN = (n: number) => n.toLocaleString('en-US');

/** Everything read (the market screen opened): nothing counts as unread any more. */
export function markNewsSeen(state: CareerState): void {
  for (const n of state.tm.news) if (!n.seen) n.seen = true;
}

/** Items about your own business you have not seen yet (the MARKET button badge). */
export function marketUnread(state: CareerState): number {
  return state.tm.news.filter((n) => n.own && !n.seen).length;
}

/**
 * The news strip: your own items come first (answers to your offers never hide behind AI gossip) when they are
 * from this week or last, or still unread (`fresh`: the unseen set captured before markNewsSeen); then
 * everything else. Each group newest first.
 */
export function newsStrip(state: CareerState, max = 4, fresh?: ReadonlySet<NewsItem>): NewsItem[] {
  const season = state.season?.number ?? 0;
  const week = marketWeek(state);
  const mine = (n: NewsItem) => n.own && ((n.season === season && n.week >= week - 1) || !n.seen || !!fresh?.has(n));
  const news = state.tm.news;
  return [...news.filter(mine), ...news.filter((n) => !mine(n))].slice(0, max);
}

function refund(state: CareerState, wallet: Wallet | undefined, amount: number): void {
  if (amount <= 0) return;
  if (wallet) wallet.coins += amount;
  else state.tm.owed += amount;
}

/** Pay out refunds that fell due while no wallet was available. */
export function settleOwed(state: CareerState, wallet: Wallet): void {
  if (state.tm.owed > 0) {
    wallet.coins += state.tm.owed;
    state.tm.owed = 0;
  }
}

function dropListing(state: CareerState, id: string): void {
  const tm = state.tm;
  tm.listings = tm.listings.filter((l) => l.id !== id);
  tm.shortlist = tm.shortlist.filter((x) => x !== id);
}

function pendingBids(state: CareerState): Bid[] {
  return state.tm.bids;
}

/** Squad size and wages once every live offer came off (signing more than you can fit is refused). */
export function committed(state: CareerState): { players: number; wages: number } {
  const club = state.club;
  const bids = pendingBids(state);
  let wages = club ? squadWages(club) : 0;
  for (const b of bids) wages += wageOf(b.player);
  return { players: (club?.squad.length ?? 0) + bids.length, wages };
}

export interface MarketSummary {
  week: number;
  window: WindowInfo;
  squad: number;
  wages: number;
  budget: number;
  pending: number;
  /** Coins that leave the wallet after every matchday while wages are over budget (0 under it). */
  drain: number;
}

export function marketSummary(state: CareerState): MarketSummary {
  const week = marketWeek(state);
  const c = committed(state);
  return {
    week,
    window: windowInfo(week),
    squad: state.club?.squad.length ?? 0,
    wages: state.club ? squadWages(state.club) : 0,
    budget: clubWageBudget(state),
    pending: c.players - (state.club?.squad.length ?? 0),
    drain: wageDrain(state),
  };
}

// ------------------------------------------------------------------ wage bill

/** The weekly overspend (0 when wages fit the budget). */
export function wageOverspend(state: CareerState): number {
  if (!state.club) return 0;
  return Math.max(0, squadWages(state.club) - clubWageBudget(state));
}

/** What an over-budget wage bill costs after each matchday: WAGE_DRAIN × the overspend; nothing under budget. */
export function wageDrain(state: CareerState): number {
  const over = wageOverspend(state);
  return over > 0 ? Math.round(over * WAGE_DRAIN) : 0;
}

/**
 * Settle the wage bill after a matchday (career.ts resolveMatchday): over budget, WAGE_DRAIN × the overspend
 * leaves the wallet (never below zero) and the news says so. Returns the coins taken.
 */
export function applyWageDrain(state: CareerState, wallet: Wallet): number {
  const drain = wageDrain(state);
  if (!drain || !state.club) return 0;
  const taken = Math.min(drain, Math.max(0, Math.floor(wallet.coins)));
  wallet.coins -= taken;
  const wages = squadWages(state.club);
  const budget = clubWageBudget(state);
  pushNews(
    state,
    `Wages over budget (${fmtN(wages)} of ${fmtN(budget)} a week): ${fmtN(taken)} coins deducted${taken < drain ? ', all you had' : ''}`,
    'bad',
    true,
  );
  return taken;
}

// ------------------------------------------------------------------ resale cap (no flipping)

/**
 * The most an AI club offers for a player you signed this season: RESALE_CAP × what you paid, until he has made
 * RESALE_STARTS league starts for you or a season has passed. null when no cap applies.
 */
export function resaleCap(state: CareerState, p: PlayerDef): number | null {
  const m = p as MetaPlayer;
  if (typeof m.paid !== 'number' || !(m.paid > 0) || typeof m.boughtSeason !== 'number') return null;
  if ((state.season?.number ?? 0) !== m.boughtSeason) return null;
  if ((m.starts ?? 0) >= RESALE_STARTS) return null;
  return round10(m.paid * RESALE_CAP);
}

/** After a matchday: one more start for every market signing in the XI (lifts his resale cap at RESALE_STARTS). */
export function recordStarts(club: ClubState): void {
  for (const p of club.squad.slice(0, 11)) {
    const m = p as MetaPlayer;
    if (typeof m.boughtSeason === 'number') m.starts = (m.starts ?? 0) + 1;
  }
}

// ------------------------------------------------------------------ listings

function roleNeed(club: LeagueClub, role: Role): boolean {
  const n = rivalSquad(club).filter((p) => p.role === role).length;
  return n <= (role === 'GK' ? 2 : role === 'FW' ? 3 : 4);
}

/** Can a rival let this player go: it keeps SQUAD_MIN players and never loses its last keeper. */
function canSpare(squad: PlayerDef[], p: Pick<PlayerDef, 'role'>): boolean {
  if (squad.length - 1 < SQUAD_MIN) return false;
  return p.role !== 'GK' || squad.filter((q) => q.role === 'GK').length >= 2;
}

/** The asking price: value by form, hot interest and the selling club's need; free agents ask their rating price. */
export function askingPrice(p: PlayerDef, club: LeagueClub | null, hot: boolean, form: number, youth: boolean): number {
  if (!club) return youth ? round10(playerPrice(p) * 0.5) : playerPrice(p);
  return round10(playerValue(p) * (1 + 0.04 * form) * (hot ? 1.15 : 1) * (roleNeed(club, p.role) ? 1.2 : 1));
}

function makeListing(state: CareerState, rng: Rng, week: number, player: MetaPlayer, club: LeagueClub | null, youth: boolean): Listing {
  const form = youth ? 0 : rng.int(5) - 2;
  const hot = !youth && rng.chance(0.25);
  const age = playerAge(player);
  return {
    id: `l${state.tm.nextId++}`,
    player,
    club: club?.id ?? null,
    clubName: club?.name ?? '',
    asking: askingPrice(player, club, hot, form, youth),
    wage: wageOf(player),
    age,
    contract: contractOf(player),
    form,
    hot,
    youth,
    scouted: false,
    potential: playerPotential(player),
    arrived: week,
    leaves: youth ? 3 : week + (hot ? 1 + rng.int(2) : 2 + rng.int(3)),
  };
}

const FREE_ROLES: Role[] = ['GK', 'DF', 'DF', 'MF', 'MF', 'FW', 'FW'];
const YOUTH_ROLES: Role[] = ['DF', 'MF', 'MF', 'FW', 'FW'];

function rotateListings(state: CareerState, week: number, rng: Rng): void {
  const tm = state.tm;
  const season = state.season;
  const club = state.club;
  if (!season || !club) return;
  const live = new Set(tm.bids.map((b) => b.listingId));
  const gone = tm.listings.filter((l) => l.leaves <= week && !live.has(l.id));
  tm.listings = tm.listings.filter((l) => l.leaves > week || live.has(l.id));
  tm.shortlist = tm.shortlist.filter((id) => tm.listings.some((l) => l.id === id));
  for (const l of gone) if (l.hot || l.youth) pushNews(state, `${l.player.name} has left the market`, 'info');
  // Nobody on the market shares a surname with your squad or with another listing.
  const names = new Set<string>([...club.squad.map((p) => surnameOf(p.name)), ...tm.listings.map((l) => surnameOf(l.player.name))]);
  const lvl = divisionLevel(season.division);
  const freeAgent = (role: Role, level: number, target: number, meta: { age: number; potential: number; contract: number }): MetaPlayer => {
    const p = makePlayer(rng, role, level, 0, `f${season.number}-${week}-${tm.nextId++}`, names);
    tuneToOverall(p, clamp(target, 20, 95));
    return pinMeta(p, meta);
  };
  // One youth prospect a season: a cheap 17-19 year old with top potential, around for the first window.
  if (week === 0 && !tm.listings.some((l) => l.youth)) {
    const role = rng.pick(YOUTH_ROLES);
    const p = freeAgent(role, lvl - 8, divisionPlayerOverall(season.division, role) - 6 - rng.int(3), { age: 17 + rng.int(3), potential: 5, contract: 3 });
    tm.listings.push(makeListing(state, rng, week, p, null, true));
    pushNews(state, `Youth prospect ${p.name} (${playerAge(p)}) is looking for a club`, 'good');
  }
  // Free agents: experienced players at the division's level.
  let free = tm.listings.filter((l) => !l.club && !l.youth).length;
  while (free < FREE_AGENTS) {
    const role = rng.pick(FREE_ROLES);
    const target = divisionPlayerOverall(season.division, role) + rng.int(11) - 5;
    const p = freeAgent(role, lvl + rng.int(11) - 5, target, { age: 24 + rng.int(11), potential: 0, contract: 1 + rng.int(2) });
    tm.listings.push(makeListing(state, rng, week, p, null, false));
    free++;
  }
  // Club players: anyone a rival can spare (it keeps SQUAD_MIN), at most PER_CLUB_MAX per club.
  const listed = new Set(tm.listings.map((l) => l.player.id));
  const perClub = new Map<string, number>();
  for (const l of tm.listings) if (l.club) perClub.set(l.club, (perClub.get(l.club) ?? 0) + 1);
  const cands: [LeagueClub, PlayerDef][] = [];
  for (const r of season.rivals) {
    const squad = rivalSquad(r);
    if (squad.length <= SQUAD_MIN) continue;
    // (One keeper per club on the market at a time, and only when it has a spare.)
    const gkListed = tm.listings.some((l) => l.club === r.id && l.player.role === 'GK');
    for (const p of squad) {
      if (listed.has(p.id) || names.has(surnameOf(p.name)) || !canSpare(squad, p)) continue;
      if (p.role === 'GK' && gkListed) continue;
      cands.push([r, p]);
    }
  }
  shuffle(rng, cands);
  while (tm.listings.length < LISTING_TARGET && cands.length) {
    const [r, p] = cands.pop()!;
    const sn = surnameOf(p.name);
    if ((perClub.get(r.id) ?? 0) >= PER_CLUB_MAX || names.has(sn)) continue;
    names.add(sn);
    perClub.set(r.id, (perClub.get(r.id) ?? 0) + 1);
    tm.listings.push(makeListing(state, rng, week, clonePlayer(p), r, false));
  }
}

// ------------------------------------------------------------------ signing

function signListing(state: CareerState, listing: Listing, paid: number): MetaPlayer | 'squad-full' | 'wages' {
  const club = state.club!;
  if (club.squad.length >= SQUAD_MAX) return 'squad-full';
  if (squadWages(club) + listing.wage > clubWageBudget(state)) return 'wages';
  const p = pinMeta({ ...clonePlayer(listing.player), id: `c${club.nextId++}`, number: freeNumber(club.squad, listing.player.role) }, {
    age: listing.age,
    potential: listing.potential,
    contract: listing.contract,
  });
  // What you paid and when: his resale value stays near it this season (resaleCap).
  p.paid = paid;
  p.boughtSeason = state.season?.number ?? 0;
  p.starts = 0;
  club.squad.push(p);
  const r = rivalById(state, listing.club);
  if (r) {
    (r.out ??= []).push(listing.player.id);
    r.rating = rivalRating(r);
  }
  dropListing(state, listing.id);
  state.tm.bids = state.tm.bids.filter((b) => b.listingId !== listing.id);
  pushNews(state, `${p.name} joins you from ${r ? townOf(r.name) : 'the free agents'} for ${fmtN(paid)}`, 'good', true);
  return p;
}

export function canBid(state: CareerState, coins: number, listingId: string, amount: number): MarketResult<{ instant: boolean }> {
  const club = state.club;
  if (!club || !state.season) return fail('no-club');
  const l = listingById(state, listingId);
  if (!l) return fail('not-found');
  if (!windowOpen(marketWeek(state))) return fail('window-closed');
  if (bidFor(state, l.id)) return fail('pending');
  const [lo, hi] = bidRange(l);
  if (!Number.isFinite(amount) || amount < lo || amount > hi) return fail('bad-amount');
  const c = committed(state);
  if (c.players >= SQUAD_MAX) return fail('squad-full');
  if (c.wages + l.wage > clubWageBudget(state)) return fail('wages');
  if (coins < amount) return fail('no-coins');
  // A free agent has no club to consult: his asking price signs him on the spot.
  return { ok: true, instant: !l.club && amount >= l.asking };
}

/**
 * Offer `amount` for a listing. Coins are put aside at once; a free agent at his asking price signs now
 * (`player` set), anyone else answers after the next match (accept / counter / reject).
 */
export function placeBid(state: CareerState, wallet: Wallet, listingId: string, amount: number): MarketResult<{ instant: boolean; player?: MetaPlayer }> {
  settleOwed(state, wallet);
  const check = canBid(state, wallet.coins, listingId, amount);
  if (!check.ok) return check;
  const l = listingById(state, listingId)!;
  wallet.coins -= amount;
  if (check.instant) {
    const p = signListing(state, l, amount);
    if (typeof p === 'string') {
      wallet.coins += amount;
      return fail(p);
    }
    syncLegacyMarket(state);
    return { ok: true, instant: true, player: p };
  }
  state.tm.bids.push({
    id: `b${state.tm.nextId++}`,
    listingId,
    amount,
    week: marketWeek(state),
    status: 'pending',
    counter: 0,
    player: l.player,
    clubName: l.clubName,
  });
  return { ok: true, instant: false };
}

export function withdrawBid(state: CareerState, wallet: Wallet, bidId: string): MarketResult {
  settleOwed(state, wallet);
  const b = state.tm.bids.find((x) => x.id === bidId);
  if (!b) return fail('not-found');
  state.tm.bids = state.tm.bids.filter((x) => x !== b);
  wallet.coins += b.amount;
  return { ok: true };
}

/** Take the club's counter price: the extra coins are paid now and the player signs at once. */
export function acceptCounter(state: CareerState, wallet: Wallet, bidId: string): MarketResult<{ player: MetaPlayer }> {
  settleOwed(state, wallet);
  const b = state.tm.bids.find((x) => x.id === bidId);
  if (!b) return fail('not-found');
  if (b.status !== 'countered') return fail('pending');
  const l = listingById(state, b.listingId);
  if (!l) return fail('expired');
  const extra = b.counter - b.amount;
  if (wallet.coins < extra) return fail('no-coins');
  wallet.coins -= extra;
  const p = signListing(state, l, b.counter);
  if (typeof p === 'string') {
    wallet.coins += b.counter;
    state.tm.bids = state.tm.bids.filter((x) => x !== b);
    return fail(p);
  }
  syncLegacyMarket(state);
  return { ok: true, player: p };
}

/** Hand a listed player to a rival (an AI trade, or a club beating you to a hot player). */
function tradeToRival(state: CareerState, l: Listing, buyer: LeagueClub): void {
  const seller = rivalById(state, l.club);
  if (seller) {
    (seller.out ??= []).push(l.player.id);
    seller.rating = rivalRating(seller);
  }
  const p = pinMeta({ ...clonePlayer(l.player), id: `${buyer.id}-t${state.tm.nextId++}`, number: freeNumber(rivalSquad(buyer), l.player.role) }, {
    age: l.age,
    potential: l.potential,
    contract: l.contract,
  });
  (buyer.in ??= []).push(p);
  buyer.rating = rivalRating(buyer);
  dropListing(state, l.id);
}

/** Answer last week's offers. Each answer is seeded by the offer itself, so it never depends on the order of play. */
function resolveBids(state: CareerState, wallet: Wallet | undefined, week: number): void {
  const tm = state.tm;
  for (const b of [...tm.bids]) {
    if (!tm.bids.includes(b)) continue;
    const l = listingById(state, b.listingId);
    const drop = () => (tm.bids = tm.bids.filter((x) => x !== b));
    if (!l) {
      drop();
      refund(state, wallet, b.amount);
      pushNews(state, `${b.player.name} is no longer available; your ${fmtN(b.amount)} came back`, 'bad', true);
      continue;
    }
    if (b.status === 'countered') {
      // A counter not taken before the match lapses.
      drop();
      refund(state, wallet, b.amount);
      pushNews(state, `${townOf(l.clubName) || 'The agent'} withdrew the ${fmtN(b.counter)} counter for ${l.player.name}; your ${fmtN(b.amount)} came back`, 'info', true);
      continue;
    }
    if (b.week >= week) continue;
    const who = l.club ? townOf(l.clubName) : `${l.player.name}'s agent`;
    const ratio = b.amount / l.asking;
    const r = new Rng(hashString(`${state.seed}|bid|${b.id}`));
    let threshold: number;
    let counterFloor: number;
    let refuse = false;
    if (!l.club) {
      threshold = 0.9;
      counterFloor = 0.6;
    } else {
      const seller = rivalById(state, l.club);
      const squad = seller ? rivalSquad(seller) : [];
      refuse = !canSpare(squad, l.player);
      const starter = [...squad].sort((x, y) => overall(y) - overall(x)).findIndex((p) => p.id === l.player.id) < 11;
      threshold = (starter ? 1 : 0.9) + (l.hot ? 0.05 : 0) - (l.age >= 31 ? 0.1 : 0) + (r.next() - 0.5) * 0.06;
      counterFloor = threshold - 0.2;
    }
    if (!refuse && ratio >= threshold) {
      const p = signListing(state, l, b.amount);
      if (typeof p === 'string') {
        drop();
        refund(state, wallet, b.amount);
        pushNews(state, `${who} accepted, but you had no room for ${l.player.name} (${p === 'wages' ? 'wage budget' : 'squad full'}); your ${fmtN(b.amount)} came back`, 'bad', true);
      } else {
        pushNews(state, `${who} accept your ${fmtN(b.amount)} offer for ${p.name}`, 'good', true);
      }
      continue;
    }
    // Hot players under a low offer can be snapped up by another club.
    if (l.hot && r.chance(0.4)) {
      const buyers = (state.season?.rivals ?? []).filter((x) => x.id !== l.club && rivalSquad(x).length < RIVAL_SQUAD_MAX);
      if (buyers.length) {
        const buyer = r.pick(buyers);
        drop();
        refund(state, wallet, b.amount);
        tradeToRival(state, l, buyer);
        pushNews(state, `${townOf(buyer.name)} beat you to ${l.player.name}; your ${fmtN(b.amount)} came back`, 'bad', true);
        continue;
      }
    }
    if (!refuse && ratio >= counterFloor) {
      const [, hi] = bidRange(l);
      b.status = 'countered';
      b.counter = l.club ? clamp(round10(l.asking * (threshold + 0.03)), b.amount + 10, hi) : l.asking;
      pushNews(state, `${who} want ${fmtN(b.counter)} for ${l.player.name} (you offered ${fmtN(b.amount)}): answer before the next match`, 'info', true);
      continue;
    }
    drop();
    refund(state, wallet, b.amount);
    pushNews(state, refuse ? `${who} won't let ${l.player.name} go; your ${fmtN(b.amount)} came back` : `${who} reject your ${fmtN(b.amount)} offer for ${l.player.name}; it came back`, 'bad', true);
  }
}

// ------------------------------------------------------------------ selling

export function listPlayer(state: CareerState, playerId: string): MarketResult {
  const club = state.club;
  if (!club) return fail('no-club');
  const p = club.squad.find((x) => x.id === playerId);
  if (!p) return fail('not-found');
  if (saleFor(state, playerId)) return fail('pending');
  const check = canSell(state, playerId);
  if (!check.ok) return fail(check.reason);
  state.tm.sales.push({ playerId, week: marketWeek(state), offers: [] });
  return { ok: true };
}

export function unlistPlayer(state: CareerState, playerId: string): MarketResult {
  if (!saleFor(state, playerId)) return fail('not-found');
  state.tm.sales = state.tm.sales.filter((s) => s.playerId !== playerId);
  return { ok: true };
}

export function acceptOffer(state: CareerState, wallet: Wallet, playerId: string, offerId: string): MarketResult<{ delta: number; player: PlayerDef }> {
  settleOwed(state, wallet);
  const club = state.club;
  if (!club) return fail('no-club');
  const sale = saleFor(state, playerId);
  const offer = sale?.offers.find((o) => o.id === offerId);
  if (!sale || !offer) return fail('not-found');
  const buyer = rivalById(state, offer.club);
  if (!buyer) return fail('expired');
  const check = canSell(state, playerId);
  if (!check.ok) return fail(check.reason);
  const idx = club.squad.findIndex((x) => x.id === playerId);
  const p = club.squad[idx];
  removeFromSquad(club, idx);
  const moved = pinMeta({ ...clonePlayer(p), id: `${buyer.id}-t${state.tm.nextId++}`, number: freeNumber(rivalSquad(buyer), p.role) });
  (buyer.in ??= []).push(moved);
  buyer.rating = rivalRating(buyer);
  state.tm.sales = state.tm.sales.filter((s) => s !== sale);
  wallet.coins += offer.amount;
  pushNews(state, `${p.name} sold to ${townOf(buyer.name)} for ${fmtN(offer.amount)}`, 'good', true);
  return { ok: true, delta: offer.amount, player: p };
}

export function rejectOffer(state: CareerState, playerId: string, offerId: string): MarketResult {
  const sale = saleFor(state, playerId);
  if (!sale || !sale.offers.some((o) => o.id === offerId)) return fail('not-found');
  sale.offers = sale.offers.filter((o) => o.id !== offerId);
  return { ok: true };
}

function tickSales(state: CareerState, week: number, rng: Rng): void {
  const tm = state.tm;
  const club = state.club;
  const season = state.season;
  if (!club || !season) return;
  tm.sales = tm.sales.filter((s) => club.squad.some((p) => p.id === s.playerId));
  for (const s of tm.sales) {
    const p = club.squad.find((x) => x.id === s.playerId)!;
    // An offer not answered within OFFER_LIFE weeks is withdrawn (and you hear about it).
    for (const o of s.offers) if (o.expires <= week) pushNews(state, `${townOf(o.clubName)} withdrew their ${fmtN(o.amount)} offer for ${p.name}`, 'info', true);
    s.offers = s.offers.filter((o) => o.expires > week);
    if (!windowOpen(week) || s.offers.length >= MAX_OFFERS || !rng.chance(0.65)) continue;
    const taken = new Set(s.offers.map((o) => o.club));
    const buyers = season.rivals.filter((r) => !taken.has(r.id) && rivalSquad(r).length < RIVAL_SQUAD_MAX);
    if (!buyers.length) continue;
    const buyer = rng.pick(buyers);
    let amount = round10(playerValue(p) * (0.7 + rng.next() * 0.25));
    // No flipping: a player you signed this season fetches at most RESALE_CAP × what you paid until he has played.
    const cap = resaleCap(state, p);
    if (cap !== null) amount = Math.min(amount, cap);
    s.offers.push({ id: `o${tm.nextId++}`, club: buyer.id, clubName: buyer.name, amount, week, expires: week + OFFER_LIFE });
    pushNews(state, `${townOf(buyer.name)} offer ${fmtN(amount)} for ${p.name}`, 'info', true);
  }
}

// ------------------------------------------------------------------ AI clubs

function aiTrades(state: CareerState, week: number, rng: Rng): void {
  const season = state.season;
  if (!season || !windowOpen(week)) return;
  const tm = state.tm;
  for (let t = 0; t < AI_TRADES_PER_WEEK; t++) {
    const live = new Set(tm.bids.map((b) => b.listingId));
    const buyers = season.rivals.filter((r) => rivalSquad(r).length < RIVAL_SQUAD_MAX).sort((a, b) => a.rating - b.rating);
    if (!buyers.length) return;
    const buyer = rng.pick(buyers.slice(0, 3));
    const mine = rivalSquad(buyer);
    const count = (role: Role) => mine.filter((p) => p.role === role).length;
    const cands = tm.listings.filter((l) => !l.youth && l.club !== buyer.id && !live.has(l.id));
    if (!cands.length) return;
    let best: Listing | null = null;
    let bestScore = -1;
    for (const l of cands) {
      const seller = rivalById(state, l.club);
      if (seller && !canSpare(rivalSquad(seller), l.player)) continue;
      const score = (l.hot ? 2 : 0) + (roleNeed(buyer, l.player.role) ? 1 : 0) + (count(l.player.role) < 2 ? 1 : 0) + rng.next() * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = l;
      }
    }
    if (!best) return;
    const from = best.club ? townOf(best.clubName) : 'the free agents';
    tradeToRival(state, best, buyer);
    pushNews(state, `${townOf(buyer.name)} sign ${best.player.name} from ${from}`, 'info');
  }
}

// ------------------------------------------------------------------ scouting & shortlist

export function scoutListing(state: CareerState, wallet: Wallet, listingId: string): MarketResult<{ potential: number }> {
  settleOwed(state, wallet);
  const l = listingById(state, listingId);
  if (!l) return fail('not-found');
  if (l.scouted) return { ok: true, potential: l.potential };
  if (wallet.coins < SCOUT_COST) return fail('no-coins');
  wallet.coins -= SCOUT_COST;
  l.scouted = true;
  return { ok: true, potential: l.potential };
}

export function toggleShortlist(state: CareerState, listingId: string): MarketResult<{ on: boolean }> {
  const tm = state.tm;
  if (tm.shortlist.includes(listingId)) {
    tm.shortlist = tm.shortlist.filter((x) => x !== listingId);
    return { ok: true, on: false };
  }
  if (!listingById(state, listingId)) return fail('not-found');
  if (tm.shortlist.length >= SHORTLIST_MAX) return fail('shortlist-full');
  tm.shortlist.push(listingId);
  return { ok: true, on: true };
}

export function shortlisted(state: CareerState): Listing[] {
  return state.tm.shortlist.map((id) => listingById(state, id)).filter((l): l is Listing => !!l);
}

// ------------------------------------------------------------------ the weekly tick

/**
 * Bring the market up to the current week (idempotent): answer last week's offers, let clubs bid for your
 * listed players, trade among themselves and rotate the listings. Called by career.ts whenever the
 * matchday changes; refunds go to `wallet` when given, else wait in `owed`.
 */
export function marketTick(state: CareerState, wallet?: Wallet): boolean {
  const season = state.season;
  if (!season || !state.club || state.summary) return false;
  if (wallet) settleOwed(state, wallet);
  const week = season.matchday;
  const key = `${season.number}:${week}`;
  if (state.tm.key === key) return false;
  const rng = new Rng(hashString(`${state.seed}|tm|${season.number}|${week}`));
  resolveBids(state, wallet, week);
  tickSales(state, week, rng);
  aiTrades(state, week, rng);
  rotateListings(state, week, rng);
  state.tm.key = key;
  syncLegacyMarket(state);
  return true;
}

/** Season over (or abandoned): refund live offers and clear the market; the news stays. */
export function clearMarket(state: CareerState, wallet?: Wallet): void {
  const tm = state.tm;
  for (const b of tm.bids) refund(state, wallet, b.amount);
  tm.bids = [];
  tm.listings = [];
  tm.sales = [];
  tm.shortlist = [];
  tm.key = '';
  if (wallet) settleOwed(state, wallet);
  state.market = [];
  state.marketKey = '';
}

/**
 * The legacy `state.market` (career hub TRANSFERS tab): the free agents on the market, who sign at once at
 * their asking price (career.ts canBuy / buyPlayer route through placeBid).
 */
export function syncLegacyMarket(state: CareerState): void {
  state.market = state.tm.listings.filter((l) => !l.club && !l.youth).map((l) => l.player);
  state.marketKey = state.tm.key;
}

/** Listings sorted for the BUY tab. */
export function sortListings(list: Listing[], by: 'price' | 'ovr' | 'age'): Listing[] {
  const out = [...list];
  if (by === 'price') out.sort((a, b) => a.asking - b.asking || overall(b.player) - overall(a.player));
  else if (by === 'ovr') out.sort((a, b) => overall(b.player) - overall(a.player) || a.asking - b.asking);
  else out.sort((a, b) => a.age - b.age || overall(b.player) - overall(a.player));
  return out;
}

export function filterListings(list: Listing[], role: Role | 'ALL'): Listing[] {
  return role === 'ALL' ? list : list.filter((l) => l.player.role === role);
}
