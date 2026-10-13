/**
 * CLUB INCOME: the ticket office and the club shop take a little money while the player is away, collected with one
 * tap on the hub ("YOUR CLUB EARNED N COINS WHILE YOU WERE AWAY"). It is the reason a bigger ground matters between
 * sessions: the rate comes from what the player has built.
 *
 * - The TICKET OFFICE pays by the ground's level (meta/ground.ts groundLevel: 0 a park pitch .. 5 the dome).
 * - The CLUB SHOP adds a little once the MEGASTORE is built.
 * - The COMMERCIAL MANAGER (meta/staff.ts, only while paid) and the club's ATMOSPHERE (meta/atmosphere.ts) add a
 *   percentage on top.
 *
 * Kept small on purpose (docs/ECONOMY.md): it stops after INCOME_CAP_HOURS hours, so a full office is a good night's
 * sleep, never a chore, and a full collection is about a quarter of a regular player's day at the very top of the
 * ladder and far less before. Nothing is lost by staying away longer: the office simply waits, full.
 *
 * The one real clock in the game, so it only ever moves forward: `income.at` is a high-water mark, time that the
 * device's clock takes back accrues nothing, and a clock set forward and back again earns nothing until real time
 * has caught up (tests/clubIncome.test.ts). Pure rules, no DOM; the state is SaveData.comeback.income.
 */
import { INCOME_BANK_MAX, comebackOf } from '../core/comebackState';
import type { SaveData } from '../core/save';
import { atmosphereOf } from './atmosphere';
import type { CareerState } from './career';
import { groundLevel, has, type GroundState } from './ground';
import { creditCoins } from './shop';
import { staffLevel } from './staff';

/** The office stops filling after this many hours. */
export const INCOME_CAP_HOURS = 8;
/**
 * Coins an hour from the ticket office, by ground level (0 a park pitch .. 5 the dome).
 * (15 October 2026, economy v7. Before: 16 / 19 / 22 / 25 / 28 / 32, 52 an hour and a 416 coin office at the very most.
 * After: 16 / 18 / 20 / 22 / 24 / 26, 43 an hour and 344 at the very most. The model, scripts/economy-model.ts: a keen
 * player who collects twice a day took 26.6% of the rest of his day's coins from the office in days 31 to 90, over
 * the quarter the owner set; it is 22.3% now, the most any profile reaches at any stage. A new club's rate is the same
 * 16, and a saved office keeps every coin it had banked.)
 */
export const TICKET_OFFICE: readonly number[] = [16, 18, 20, 22, 24, 26];
/** Coins an hour the club shop adds once the MEGASTORE is built. */
export const CLUB_SHOP = 5;
/** Per cent on top from the commercial manager, by level (0 none .. 3). */
export const COMMERCIAL_BOOST: readonly number[] = [0, 10, 20, 30];
/** Per cent on top from a full atmosphere (rating 100); less in proportion. */
export const ATMOSPHERE_BOOST = 10;

const HOUR = 3_600_000;

export interface IncomeSource {
  /** Ground level 0..5. */
  level: number;
  store: boolean;
  /** Commercial manager level at work (0 while unpaid). */
  commercial: number;
  /** Atmosphere rating 0..100. */
  atmosphere: number;
}

type IncomeSave = Pick<SaveData, 'comeback' | 'coins' | 'shop' | 'progress' | 'settings'>;

/** What the rate is made of for this save: its club's ground and staff (a park pitch before there is a club). */
export function incomeSource(career: CareerState | null, save: Pick<SaveData, 'shop' | 'progress' | 'settings'>): IncomeSource {
  const club = career?.club ? career : null;
  const ground: GroundState | null = club?.ground ?? null;
  let atmosphere = 0;
  try {
    atmosphere = atmosphereOf(save, ground).rating;
  } catch {
    atmosphere = 0;
  }
  return {
    level: ground ? groundLevel(ground) : 0,
    store: !!ground && has(ground, 'store'),
    commercial: club ? staffLevel(club, 'commercial') : 0,
    atmosphere,
  };
}

/** Coins an hour. */
export function incomeRate(src: IncomeSource): number {
  const level = Math.max(0, Math.min(TICKET_OFFICE.length - 1, Math.round(src.level) || 0));
  const base = TICKET_OFFICE[level] + (src.store ? CLUB_SHOP : 0);
  const staff = COMMERCIAL_BOOST[Math.max(0, Math.min(COMMERCIAL_BOOST.length - 1, Math.round(src.commercial) || 0))];
  const crowd = Math.round((ATMOSPHERE_BOOST * Math.max(0, Math.min(100, src.atmosphere || 0))) / 100);
  return Math.round((base * (100 + staff + crowd)) / 100);
}

/** The most the office holds at this rate. */
export function incomeCap(rate: number): number {
  return Math.min(INCOME_BANK_MAX, Math.max(0, Math.round(rate)) * INCOME_CAP_HOURS);
}

/** The best rate anything in the game adds up to (the dome, the megastore, a level 3 manager, a full atmosphere). */
export function incomeRateMax(): number {
  return incomeRate({ level: TICKET_OFFICE.length - 1, store: true, commercial: COMMERCIAL_BOOST.length - 1, atmosphere: 100 });
}

/** Coins in the office at `now` (fractions and all), without changing anything. */
function pending(save: IncomeSave, now: number, rate: number): number {
  const s = comebackOf(save).income;
  const cap = incomeCap(rate);
  const banked = Math.max(0, Math.min(INCOME_BANK_MAX, s.banked || 0));
  if (!s.at || !Number.isFinite(now) || now <= s.at || banked >= cap) return banked;
  return Math.min(cap, banked + ((now - s.at) / HOUR) * Math.max(0, rate));
}

/**
 * Bank the time gone by. The first call opens the office (nothing is owed for before it). The clock mark only moves
 * forward: a `now` earlier than the mark (the device's clock set back) banks nothing and leaves the mark alone.
 */
export function accrueIncome(save: IncomeSave, now: number, rate: number): void {
  if (!Number.isFinite(now) || now <= 0) return;
  const s = comebackOf(save).income;
  if (!s.at) {
    s.at = Math.floor(now);
    s.banked = 0;
    return;
  }
  if (now <= s.at) return;
  s.banked = pending(save, now, rate);
  s.at = Math.floor(now);
}

export interface IncomeView {
  rate: number;
  cap: number;
  /** Whole coins that a tap collects now. */
  coins: number;
  /** How full the office is, 0..1. */
  fill: number;
  full: boolean;
  /** Milliseconds until it is full at this rate (0 when full). */
  fullInMs: number;
}

/** The office as the hub shows it. Reads only. */
export function incomeView(save: IncomeSave, now: number, rate: number): IncomeView {
  const cap = incomeCap(rate);
  const have = pending(save, now, rate);
  const full = cap > 0 && have >= cap;
  return {
    rate, cap, coins: Math.floor(have), fill: cap > 0 ? Math.max(0, Math.min(1, have / cap)) : 0, full,
    fullInMs: full || rate <= 0 ? 0 : Math.ceil(((cap - have) / rate) * HOUR),
  };
}

/** One tap: the whole coins in the office go to the wallet (fractions stay). Returns the coins collected. */
export function collectIncome(save: IncomeSave, now: number, rate: number): number {
  accrueIncome(save, now, rate);
  const s = comebackOf(save).income;
  const coins = Math.floor(s.banked);
  if (coins <= 0) return 0;
  s.banked -= coins;
  creditCoins(save, coins);
  return coins;
}

/** "FULL IN 3H 05M" (the minutes always two digits), or "FULL". */
export function fullInText(ms: number): string {
  if (!(ms > 0)) return 'FULL';
  const mins = Math.max(1, Math.ceil(ms / 60_000));
  return `FULL IN ${Math.floor(mins / 60)}H ${String(mins % 60).padStart(2, '0')}M`;
}

/** What makes up a rate, as short lines for the ground screen ("TICKET OFFICE 22", "CLUB SHOP +5", "MANAGER +20%"). */
export function incomeParts(src: IncomeSource): string[] {
  const level = Math.max(0, Math.min(TICKET_OFFICE.length - 1, Math.round(src.level) || 0));
  const out = [`TICKET OFFICE ${TICKET_OFFICE[level]}`];
  if (src.store) out.push(`CLUB SHOP +${CLUB_SHOP}`);
  const staff = COMMERCIAL_BOOST[Math.max(0, Math.min(COMMERCIAL_BOOST.length - 1, Math.round(src.commercial) || 0))];
  if (staff) out.push(`MANAGER +${staff}%`);
  const crowd = Math.round((ATMOSPHERE_BOOST * Math.max(0, Math.min(100, src.atmosphere || 0))) / 100);
  if (crowd) out.push(`ATMOSPHERE +${crowd}%`);
  return out;
}
