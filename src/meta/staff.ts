/**
 * THE STAFF (the owner: "upgrading youth academies, hiring scouts with distinct regional expertise, and managing
 * staff"). Six jobs, each with three levels, a signing fee and a wage paid after every league matchday:
 *
 * - ASSISTANT COACH: the squad learns faster (training and match XP, meta/growth.ts).
 * - PHYSIO, then a MEDICAL ROOM and a MEDICAL CENTRE: injuries are shorter and rarer (meta/week.ts).
 * - Two SCOUTS, each with a region he knows. A scout sends a REPORT every two or three matchdays: players of the kind
 *   his region is known for, to sign at a scout's price in or out of the transfer window.
 * - ACADEMY DIRECTOR: better prospects in every intake (meta/life.ts).
 * - COMMERCIAL MANAGER: coins at every home match and better sponsor deals (meta/events.ts).
 *
 * The higher levels need the ground's buildings (meta/ground.ts): the TRAINING GROUND for the coach and the medical
 * rooms, the YOUTH ACADEMY for the director, the BIG SCREEN and the MEGASTORE for the commercial side.
 *
 * Budget pressure, kept kind: wages leave the wallet after each league matchday. When the wallet can't cover them the
 * staff go unpaid and simply stop working until they are paid (no debt, nobody walks out, nothing is lost).
 * Nothing here runs on a clock: every timer counts league matchdays you play.
 *
 * Pure rules and state, no DOM. Runtime import cycle with career.ts: bindings from it are only used inside functions.
 */
import { Rng, hashString } from '../core/rng';
import { overall, type PlayerDef, type PlayerStats, type Role } from '../sim/types';
import {
  SQUAD_MAX, STAT_CAP, STAT_KEYS, divisionLevel, divisionPlayerOverall, freeNumber, playerPrice, tuneToOverall,
  type CareerState, type Wallet,
} from './career';
import { makeName, makePlayer, surnameOf } from './data';
import { has, partDef, type PartId } from './ground';
import { CEIL_HEADROOM, type GrowPlayer, type TraitId } from './growth';
import { prospectCeiling } from './life';
import { clubWageBudget, pinMeta, playerValue, pushNews, squadWages, wageOf } from './market';

export type StaffRole = 'assistant' | 'physio' | 'scout1' | 'scout2' | 'academy' | 'commercial';
export type ScoutSlot = 'scout1' | 'scout2';
export type RegionId = 'home' | 'north' | 'south' | 'east' | 'west';
/** What a scout is asked to find: youngsters with potential, or players ready for the first team. */
export type Brief = 'youth' | 'ready';

export const STAFF_ROLES: readonly StaffRole[] = ['assistant', 'physio', 'scout1', 'scout2', 'academy', 'commercial'];
export const SCOUT_SLOTS: readonly ScoutSlot[] = ['scout1', 'scout2'];
export const REGION_IDS: readonly RegionId[] = ['home', 'north', 'south', 'east', 'west'];
export const STAFF_MAX_LEVEL = 3;

export interface StaffMember {
  /** 1..STAFF_MAX_LEVEL. */
  level: number;
  name: string;
  /** Scouts: the region he knows (fixed when hired), the region he is scouting now, and what he looks for. */
  region?: RegionId;
  task?: RegionId;
  brief?: Brief;
}

export interface ScoutFind {
  player: GrowPlayer;
  fee: number;
  wage: number;
  kind: Brief;
}

export interface ScoutReport {
  slot: ScoutSlot;
  region: RegionId;
  season: number;
  /** League matchdays played when it came in. */
  md: number;
  finds: ScoutFind[];
  /** Looked at (the STAFF tab opened on it). */
  seen: boolean;
}

export interface StaffState {
  hired: Partial<Record<StaffRole, StaffMember>>;
  /** League matchdays until each scout's next report. */
  due: Partial<Record<ScoutSlot, number>>;
  /** The latest report of each scout. */
  reports: ScoutReport[];
  /** The wallet couldn't cover the wages last matchday: the staff stop working until they are paid. */
  unpaid: boolean;
  /** The Scouting Network tier owned (0..3): a mirror of SaveData.gems.network (meta/gems.ts), which owns it. */
  network: number;
  nextId: number;
}

export interface StaffLevel {
  /** What this level is called ("MEDICAL ROOM"); the job's own name when missing. */
  title?: string;
  /** Coins to hire or promote to this level, and the wage after every league matchday. */
  fee: number;
  wage: number;
  /** What it does, in a few words. */
  does: string;
  /** The part of the ground it needs (meta/ground.ts). */
  needs?: PartId;
}

export interface StaffDef {
  role: StaffRole;
  name: string;
  /** Pixel icon (ui/pixelIcons.ts). */
  icon: string;
  levels: readonly StaffLevel[];
}

const SCOUT_LEVELS: readonly StaffLevel[] = [
  { fee: 300, wage: 10, does: 'A REPORT EVERY 3 MATCHES: 2 PLAYERS' },
  { fee: 900, wage: 24, does: 'A REPORT EVERY 2 MATCHES: 3 PLAYERS' },
  { fee: 2200, wage: 48, does: 'EVERY 2 MATCHES: 3 BETTER PLAYERS' },
];

export const STAFF: readonly StaffDef[] = [
  {
    role: 'assistant', name: 'ASSISTANT COACH', icon: 'bolt',
    levels: [
      { fee: 400, wage: 12, does: 'THE SQUAD LEARNS 15% FASTER' },
      { fee: 1200, wage: 30, does: 'THE SQUAD LEARNS 30% FASTER', needs: 'training' },
      { fee: 3000, wage: 60, does: 'THE SQUAD LEARNS 50% FASTER', needs: 'training' },
    ],
  },
  {
    role: 'physio', name: 'PHYSIO', icon: 'medic',
    levels: [
      { fee: 400, wage: 12, does: 'INJURIES 1 MATCH SHORTER' },
      { title: 'MEDICAL ROOM', fee: 1200, wage: 30, does: 'FEWER INJURIES, 1 MATCH SHORTER', needs: 'training' },
      { title: 'MEDICAL CENTRE', fee: 3000, wage: 60, does: 'HALF THE INJURIES, 2 MATCHES SHORTER', needs: 'training' },
    ],
  },
  { role: 'scout1', name: 'SCOUT', icon: 'scout', levels: SCOUT_LEVELS },
  { role: 'scout2', name: 'SECOND SCOUT', icon: 'scout', levels: SCOUT_LEVELS },
  {
    role: 'academy', name: 'ACADEMY DIRECTOR', icon: 'star',
    levels: [
      { fee: 500, wage: 14, does: 'PROSPECTS ARRIVE 2 OVR BETTER' },
      { fee: 1500, wage: 32, does: 'AND WITH ONE MORE STAR', needs: 'academy' },
      { fee: 3500, wage: 64, does: 'AND ONE MORE PROSPECT A SEASON', needs: 'academy' },
    ],
  },
  {
    role: 'commercial', name: 'COMMERCIAL MANAGER', icon: 'coin',
    levels: [
      { fee: 500, wage: 14, does: '+40 A HOME MATCH, SPONSORS +25%' },
      { fee: 1500, wage: 32, does: '+80 A HOME MATCH, SPONSORS +50%', needs: 'screen' },
      { fee: 3500, wage: 64, does: '+130 A HOME MATCH, SPONSORS +75%', needs: 'store' },
    ],
  },
];

/** The physio: matchdays off every injury, and how likely one is, by level (0 none .. 3). */
export const PHYSIO_CUT = [0, 1, 1, 2] as const;
export const PHYSIO_RISK = [1, 1, 0.75, 0.5] as const;
/** The commercial manager: coins at every home match, and what sponsor deals are multiplied by, by level. */
export const COMMERCIAL_HOME = [0, 40, 80, 130] as const;
export const COMMERCIAL_SPONSOR = [1, 1.25, 1.5, 1.75] as const;
/** The academy director: overall points on every prospect, stars on every prospect, extra prospects, by level. */
export const DIRECTOR_OVR = [0, 2, 2, 2] as const;
export const DIRECTOR_STARS = [0, 0, 1, 1] as const;
export const DIRECTOR_EXTRA = [0, 0, 0, 1] as const;
/** League matchdays between a scout's reports, and players in one, by level; a region he doesn't know takes one more. */
export const SCOUT_EVERY = [0, 3, 2, 2] as const;
export const SCOUT_FINDS = [0, 2, 3, 3] as const;

export interface RegionDef {
  id: RegionId;
  name: string;
  /** The kind of player it is known for, in a few words. */
  does: string;
  /** Positions its players come in (drawn from, so a region leans one way). */
  roles: readonly Role[];
  /** Where its players are stronger and weaker than a typical one of their overall. */
  bias: Partial<Record<keyof PlayerStats, number>>;
  /** The trait its players often have. */
  trait: TraitId;
  /** Fee multiplier (local kids are cheap). */
  fee: number;
  /** Extra potential on its youngsters. */
  ceil: number;
}

/** The five regions: each produces a different kind of player (names from the game's own map: meta/comps.ts). */
export const REGIONS: Record<RegionId, RegionDef> = {
  home: { id: 'home', name: 'HOME TOWNS', does: 'LOYAL LOCAL PLAYERS, CHEAP', roles: ['DF', 'MF', 'FW', 'GK', 'MF', 'FW'], bias: {}, trait: 'loyal', fee: 0.75, ceil: 0 },
  north: { id: 'north', name: 'BLOKARIA', does: 'TOUGH DEFENDERS AND KEEPERS', roles: ['DF', 'DF', 'GK', 'DF', 'MF'], bias: { defending: 6, stamina: 4, keeping: 4, pace: -3 }, trait: 'leader', fee: 1, ceil: 2 },
  south: { id: 'south', name: 'CUBALIA', does: 'FORWARDS WITH FLAIR', roles: ['FW', 'FW', 'MF', 'FW'], bias: { dribbling: 6, shooting: 4, defending: -4 }, trait: 'biggame', fee: 1.1, ceil: 3 },
  east: { id: 'east', name: 'PIXLAND', does: 'CLEVER PASSERS', roles: ['MF', 'MF', 'DF', 'MF'], bias: { passing: 7, dribbling: 2, pace: -3 }, trait: 'ambitious', fee: 1, ceil: 2 },
  west: { id: 'west', name: 'VOXONIA', does: 'RAPID WINGERS', roles: ['FW', 'MF', 'DF', 'FW'], bias: { pace: 8, stamina: 2, passing: -3 }, trait: 'supersub', fee: 1, ceil: 2 },
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const round10 = (v: number) => Math.round(v / 10) * 10;
const fmt = (n: number) => n.toLocaleString('en-US');

export function defaultStaff(): StaffState {
  return { hired: {}, due: {}, reports: [], unpaid: false, network: 0, nextId: 1 };
}

export function staffDef(role: StaffRole): StaffDef {
  return STAFF.find((d) => d.role === role)!;
}

export const isScout = (role: StaffRole): role is ScoutSlot => role === 'scout1' || role === 'scout2';

/** The level hired (0 none), whether or not they were paid. */
export function hiredLevel(state: CareerState, role: StaffRole): number {
  return clamp(Math.round(state.staff?.hired[role]?.level ?? 0), 0, STAFF_MAX_LEVEL);
}

/** The level at work now: 0 while the staff are unpaid. */
export function staffLevel(state: CareerState, role: StaffRole): number {
  return state.staff?.unpaid ? 0 : hiredLevel(state, role);
}

/** What the level is called ("PHYSIO", "MEDICAL ROOM"). */
export function staffTitle(role: StaffRole, level: number): string {
  const def = staffDef(role);
  return def.levels[clamp(level, 1, STAFF_MAX_LEVEL) - 1]?.title ?? def.name;
}

/** The wage bill after every league matchday. */
export function staffWages(state: CareerState): number {
  let n = 0;
  for (const role of STAFF_ROLES) {
    const lv = hiredLevel(state, role);
    if (lv > 0) n += staffDef(role).levels[lv - 1].wage;
  }
  return n;
}

export type StaffFail = 'maxed' | 'locked' | 'no-coins' | 'not-found' | 'squad-full' | 'wages';
export type StaffResult<T = object> = ({ ok: true } & T) | { ok: false; reason: StaffFail };

/** Why the next level of a job can't be hired yet (a short line), or null. */
export function staffNeeds(state: CareerState, role: StaffRole): string | null {
  const lv = hiredLevel(state, role);
  const next = staffDef(role).levels[lv];
  if (!next) return null;
  if (role === 'scout2' && !state.staff.hired.scout1) return 'HIRE YOUR FIRST SCOUT';
  if (next.needs && !has(state.ground, next.needs)) return `NEEDS THE ${partDef(next.needs).name}`;
  return null;
}

export function canHire(state: CareerState, coins: number, role: StaffRole): StaffResult<{ cost: number; level: number }> {
  const lv = hiredLevel(state, role);
  const next = staffDef(role).levels[lv];
  if (!next) return { ok: false, reason: 'maxed' };
  if (staffNeeds(state, role)) return { ok: false, reason: 'locked' };
  if (coins < next.fee) return { ok: false, reason: 'no-coins' };
  return { ok: true, cost: next.fee, level: lv + 1 };
}

/** League matchdays between this scout's reports (a region he doesn't know takes one more). */
export function scoutEvery(m: StaffMember): number {
  const base = SCOUT_EVERY[clamp(m.level, 1, STAFF_MAX_LEVEL)];
  return base + ((m.task ?? m.region) !== m.region ? 1 : 0);
}

/**
 * Hire for a job, or promote whoever has it to the next level: the fee leaves the wallet now, the wage after every
 * league matchday. A scout is hired for the region he knows (`region`) and starts on it at once.
 */
export function hireStaff(state: CareerState, wallet: Wallet, role: StaffRole, region: RegionId = 'home'): StaffResult<{ cost: number; level: number }> {
  const r = canHire(state, wallet.coins, role);
  if (!r.ok) return r;
  const staff = state.staff;
  wallet.coins -= r.cost;
  const cur = staff.hired[role];
  if (cur) cur.level = r.level;
  else {
    const name = makeName(new Rng(hashString(`${state.seed}|staff|${role}|${staff.nextId++}`)));
    const m: StaffMember = { level: r.level, name };
    if (isScout(role)) {
      m.region = REGION_IDS.includes(region) ? region : 'home';
      m.task = m.region;
      m.brief = 'youth';
    }
    staff.hired[role] = m;
  }
  const m = staff.hired[role]!;
  // (A promoted scout keeps the report he is working on, never a longer wait than his new level's.)
  if (isScout(role)) staff.due[role] = Math.min(staff.due[role] ?? Infinity, scoutEvery(m));
  return r;
}

/** Let someone go (no fee back). A scout's report goes with him. */
export function releaseStaff(state: CareerState, role: StaffRole): boolean {
  const staff = state.staff;
  if (!staff.hired[role]) return false;
  delete staff.hired[role];
  if (isScout(role)) {
    delete staff.due[role];
    staff.reports = staff.reports.filter((r) => r.slot !== role);
  }
  // (The second scout can't stay without the first: he takes the first chair.)
  if (role === 'scout1' && staff.hired.scout2) {
    staff.hired.scout1 = staff.hired.scout2;
    delete staff.hired.scout2;
    if (staff.due.scout2 !== undefined) staff.due.scout1 = staff.due.scout2;
    delete staff.due.scout2;
    staff.reports = staff.reports.map((r) => (r.slot === 'scout2' ? { ...r, slot: 'scout1' as ScoutSlot } : r));
  }
  return true;
}

/** Point a scout at a region or change what he looks for. A new region starts his next report afresh. */
export function setScout(state: CareerState, slot: ScoutSlot, change: { task?: RegionId; brief?: Brief }): boolean {
  const m = state.staff.hired[slot];
  if (!m) return false;
  if (change.brief === 'youth' || change.brief === 'ready') m.brief = change.brief;
  if (change.task && REGION_IDS.includes(change.task) && change.task !== (m.task ?? m.region)) {
    m.task = change.task;
    state.staff.due[slot] = scoutEvery(m);
  }
  return true;
}

/**
 * Pay the staff after a league matchday. Enough in the wallet: the wages leave it and everyone works. Not enough:
 * nothing is taken, the staff go unpaid and stop working until the next matchday they are paid (never a debt).
 * Returns the coins paid.
 */
export function payStaff(state: CareerState, wallet: Wallet): number {
  const staff = state.staff;
  const wages = staffWages(state);
  if (!wages) {
    staff.unpaid = false;
    return 0;
  }
  if (Math.floor(wallet.coins) >= wages) {
    wallet.coins -= wages;
    if (staff.unpaid) pushNews(state, 'The staff are paid and back at work', 'good', true);
    staff.unpaid = false;
    return wages;
  }
  if (!staff.unpaid) pushNews(state, `Not enough coins for the staff wages (${fmt(wages)} a match): they wait until they are paid`, 'bad', true);
  staff.unpaid = true;
  return 0;
}

// ------------------------------------------------------------------ scout reports

function makeFind(state: CareerState, rng: Rng, m: StaffMember, region: RegionDef, kind: Brief, names: Set<string>): ScoutFind {
  const season = state.season;
  const div = season?.division ?? 6;
  const role = rng.pick(region.roles);
  const expert = (m.task ?? m.region) === m.region;
  const better = (m.level >= 3 ? 2 : 0) + (expert ? 1 : 0);
  const youth = kind === 'youth';
  const target = youth
    ? divisionPlayerOverall(div, role) - 11 + better + rng.int(4)
    : divisionPlayerOverall(div, role) + rng.int(4) + better;
  const p = makePlayer(rng, role, divisionLevel(div) + (youth ? -8 : 0), 0, `s${state.staff.nextId++}`, names);
  names.add(surnameOf(p.name));
  // What the region is known for: its players lean that way, at the same overall.
  for (const k of STAT_KEYS) p.stats[k] = clamp(p.stats[k] + (region.bias[k] ?? 0), 8, STAT_CAP);
  tuneToOverall(p, clamp(target, 20, 95));
  const age = youth ? 16 + rng.int(4) : 22 + rng.int(7);
  const stars = youth ? Math.min(5, 3 + rng.int(2) + (m.level >= 3 ? 1 : 0)) : age <= 23 ? 1 + rng.int(2) : 0;
  const g = pinMeta(p, { age, potential: stars, contract: youth ? 3 : 2 + rng.int(2) }) as GrowPlayer;
  g.ceil = Math.min(STAT_CAP, youth ? prospectCeiling(g) + CEIL_HEADROOM + region.ceil : overall(g) + Math.max(0, 27 - age));
  g.traits = rng.chance(0.6) ? [region.trait] : [];
  const fee = round10(Math.max(40, (youth ? playerPrice(g) * 0.6 : playerValue(g) * 0.9) * region.fee));
  return { player: g, fee, wage: wageOf(g), kind };
}

/** A scout's report: players from the region he is on, of the kind he was asked for (seeded by the matchday). */
function makeReport(state: CareerState, slot: ScoutSlot): ScoutReport | null {
  const m = state.staff.hired[slot];
  const season = state.season;
  const club = state.club;
  if (!m || !season || !club) return null;
  const region = REGIONS[m.task ?? m.region ?? 'home'];
  const rng = new Rng(hashString(`${state.seed}|scout|${season.number}|${season.matchday}|${slot}`));
  const names = new Set<string>([
    ...club.squad.map((p) => surnameOf(p.name)),
    ...state.staff.reports.flatMap((r) => r.finds.map((f) => surnameOf(f.player.name))),
  ]);
  const n = SCOUT_FINDS[clamp(m.level, 1, STAFF_MAX_LEVEL)];
  const brief = m.brief ?? 'youth';
  const finds: ScoutFind[] = [];
  // Mostly what he was asked for, and one of the other kind so there is always a choice.
  for (let i = 0; i < n; i++) finds.push(makeFind(state, rng, m, region, i === n - 1 ? (brief === 'youth' ? 'ready' : 'youth') : brief, names));
  return { slot, region: region.id, season: season.number, md: season.matchday, finds, seen: false };
}

/**
 * A league matchday passes for the scouts (only while the staff are paid): a report that is due comes in (it replaces
 * that scout's last one) and the next one starts. Returns the reports that came in.
 */
export function tickScouts(state: CareerState): ScoutReport[] {
  const staff = state.staff;
  const out: ScoutReport[] = [];
  if (staff.unpaid) return out;
  for (const slot of SCOUT_SLOTS) {
    const m = staff.hired[slot];
    if (!m) continue;
    const left = (staff.due[slot] ?? scoutEvery(m)) - 1;
    if (left > 0) {
      staff.due[slot] = left;
      continue;
    }
    const report = makeReport(state, slot);
    staff.due[slot] = scoutEvery(m);
    if (!report) continue;
    staff.reports = [...staff.reports.filter((r) => r.slot !== slot), report];
    out.push(report);
  }
  return out;
}

export function reportOf(state: CareerState, slot: ScoutSlot): ScoutReport | undefined {
  return state.staff.reports.find((r) => r.slot === slot);
}

/** Reports nobody has looked at yet (the STAFF badge and the NEXT GOAL line). */
export function unseenReports(state: CareerState): ScoutReport[] {
  return state.staff.reports.filter((r) => !r.seen && r.finds.length > 0);
}

export function canSignFind(state: CareerState, coins: number, slot: ScoutSlot, idx: number): StaffResult<{ fee: number }> {
  const club = state.club;
  const find = reportOf(state, slot)?.finds[idx];
  if (!club || !find) return { ok: false, reason: 'not-found' };
  if (club.squad.length >= SQUAD_MAX) return { ok: false, reason: 'squad-full' };
  if (squadWages(club) + find.wage > clubWageBudget(state)) return { ok: false, reason: 'wages' };
  if (coins < find.fee) return { ok: false, reason: 'no-coins' };
  return { ok: true, fee: find.fee };
}

/**
 * Sign a player off a scout's report: at the scout's price, in or out of the transfer window (the squad size and
 * the wage budget still hold). He joins the reserves.
 */
export function signFind(state: CareerState, wallet: Wallet, slot: ScoutSlot, idx: number): StaffResult<{ fee: number; player: GrowPlayer }> {
  const check = canSignFind(state, wallet.coins, slot, idx);
  if (!check.ok) return check;
  const club = state.club!;
  const report = reportOf(state, slot)!;
  const find = report.finds[idx];
  wallet.coins -= find.fee;
  const p: GrowPlayer = { ...find.player, stats: { ...find.player.stats }, look: { ...find.player.look }, id: `c${club.nextId++}`, number: freeNumber(club.squad, find.player.role) };
  p.paid = find.fee;
  p.boughtSeason = state.season?.number ?? 0;
  p.starts = 0;
  p.joined = state.season?.number ?? 1;
  p.hist = [overall(p)];
  club.squad.push(p);
  report.finds.splice(idx, 1);
  pushNews(state, `${p.name} joins from ${REGIONS[report.region].name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())} for ${fmt(find.fee)}: your scout found him`, 'good', true);
  return { ok: true, fee: find.fee, player: p };
}

// ------------------------------------------------------------------ what the staff add up to

/** Coins the commercial manager brings in at a home match. */
export function commercialIncome(state: CareerState): number {
  return COMMERCIAL_HOME[staffLevel(state, 'commercial')] ?? 0;
}

/** What sponsor deals are multiplied by (the commercial manager). */
export function sponsorMult(state: CareerState): number {
  return COMMERCIAL_SPONSOR[staffLevel(state, 'commercial')] ?? 1;
}

// ------------------------------------------------------------------ save

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const int = (v: unknown, lo: number, hi: number, d: number) => (isNum(v) ? clamp(Math.round(v), lo, hi) : d);

export function readStaff(v: unknown, readPlayer: (x: unknown) => PlayerDef | null): StaffState {
  const s = defaultStaff();
  if (!isObj(v)) return s;
  s.unpaid = v.unpaid === true;
  s.network = int(v.network, 0, 3, 0);
  s.nextId = int(v.nextId, 1, 1e9, 1);
  if (isObj(v.hired)) {
    for (const role of STAFF_ROLES) {
      const m = v.hired[role];
      if (!isObj(m) || !isNum(m.level) || m.level < 1) continue;
      const out: StaffMember = { level: int(m.level, 1, STAFF_MAX_LEVEL, 1), name: typeof m.name === 'string' ? m.name.slice(0, 24) : 'Staff' };
      if (isScout(role)) {
        out.region = REGION_IDS.includes(m.region as RegionId) ? (m.region as RegionId) : 'home';
        out.task = REGION_IDS.includes(m.task as RegionId) ? (m.task as RegionId) : out.region;
        out.brief = m.brief === 'ready' ? 'ready' : 'youth';
      }
      s.hired[role] = out;
    }
  }
  // (A second scout without a first can't be: he takes the first chair.)
  if (s.hired.scout2 && !s.hired.scout1) {
    s.hired.scout1 = s.hired.scout2;
    delete s.hired.scout2;
  }
  if (isObj(v.due)) for (const slot of SCOUT_SLOTS) if (s.hired[slot] && isNum(v.due[slot])) s.due[slot] = int(v.due[slot], 1, 6, 3);
  if (Array.isArray(v.reports)) {
    for (const r of v.reports.slice(0, 4)) {
      if (!isObj(r) || !SCOUT_SLOTS.includes(r.slot as ScoutSlot) || !s.hired[r.slot as ScoutSlot] || !Array.isArray(r.finds)) continue;
      if (s.reports.some((x) => x.slot === r.slot)) continue;
      const finds: ScoutFind[] = [];
      for (const f of r.finds.slice(0, 4)) {
        if (!isObj(f)) continue;
        const player = readPlayer(f.player) as GrowPlayer | null;
        if (!player) continue;
        finds.push({ player, fee: int(f.fee, 0, 1e9, 0), wage: int(f.wage, 0, 1e6, 0), kind: f.kind === 'ready' ? 'ready' : 'youth' });
      }
      s.reports.push({
        slot: r.slot as ScoutSlot, region: REGION_IDS.includes(r.region as RegionId) ? (r.region as RegionId) : 'home',
        season: int(r.season, 0, 1e6, 0), md: int(r.md, 0, 99, 0), finds, seen: r.seen === true,
      });
    }
  }
  return s;
}
