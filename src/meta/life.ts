/**
 * The living squad (the Sims-like attachment): players play, score and build up appearances for you, hit milestones,
 * age, peak and fade (meta/market.ts ageSquad), and retire with a farewell; the best go into the HALL OF FAME. A YOUTH
 * ACADEMY brings two or three prospects every season to promote or release. Morale (recent form) and chemistry (how
 * long the eleven have played together) stay light: a word and an icon each, and a small lift on the pitch when high.
 * Club records (top scorer, most appearances, biggest win, record signing) live in the legacy (meta/legacy.ts).
 * Pure rules and state; the screens are the ROAD TO GLORY hub (ui/career.ts).
 *
 * Runtime import cycle with career.ts: bindings from it are only used inside functions.
 */
import { Rng, hashString } from '../core/rng';
import { overall, type PlayerDef, type Role } from '../sim/types';
import {
  KEY_STATS, SQUAD_MAX, SQUAD_MIN, STAT_CAP, STAT_KEYS, divisionPlayerOverall, freeNumber, removeFromSquad, tuneToOverall, type CareerState, type ClubState,
} from './career';
import { makePlayer, surnameOf } from './data';
import { has } from './ground';
import { LEGACY_POINTS, LEGEND_APPS, LEGEND_GOALS, addLegacy, hasPerk, induct, milestoneOnce } from './legacy';
import { playerAge, playerPotential, pinMeta, type MetaPlayer } from './market';
import { addMoment, storyNews, type FormMark } from './story';
// The long game (runtime cycles: only ever used inside functions).
import { SCOUT_NETWORKS } from './gems';
import { teamMood, togetherness } from './morale';
import { DIRECTOR_EXTRA, DIRECTOR_OVR, DIRECTOR_STARS, staffLevel } from './staff';

/** A squad player's life with you (missing on old saves: zero, and a founding member). */
export interface LifePlayer extends MetaPlayer {
  /** Matches played for you (all competitions). */
  apps?: number;
  /** Goals for you. */
  goals?: number;
  /** Season he joined (missing: there from the start). */
  joined?: number;
  /** Came through your youth academy. */
  academy?: boolean;
}

export interface AcademyState {
  /** Season of the intake on offer (0: none yet). */
  season: number;
  /** Prospects waiting for a decision: promote or release. */
  prospects: LifePlayer[];
  /** Season you last promoted one (0: never): a board objective reads it. */
  promoted: number;
}

export interface Farewell {
  id: string;
  name: string;
  role: Role;
  age: number;
  apps: number;
  goals: number;
  /** Goes into the Hall of Fame. */
  legend: boolean;
}

/** What a match of yours leaves behind (from the full-time result: ui/career.ts). */
export interface MatchFacts {
  /** Squad ids who played (the eleven who started and anyone who came on). */
  played: string[];
  /** Squad id per goal of yours (own goals by the other side are not in it). */
  scorers: string[];
  my: number;
  their: number;
  /** Who it was against (for the record book). */
  vs: string;
}

export type Mood = 0 | 1 | 2;

export const GOAL_MILESTONES = [10, 25, 50, 100, 150, 200, 300] as const;
export const APP_MILESTONES = [25, 50, 100, 150, 200, 300] as const;
/** Ages that may retire at the end of a season, and how likely. */
export const RETIRE_CHANCE: Record<number, number> = { 33: 0.15, 34: 0.35, 35: 0.6 };
export const RETIRE_ALWAYS = 36;
/** Prospects per intake (three with the YOUTH ACADEMY building). */
export const INTAKE = 2;

export const MORALE_NAMES = ['LOW', 'STEADY', 'HIGH'] as const;
export const CHEMISTRY_NAMES = ['NEW', 'GOOD', 'STRONG'] as const;

const life = (p: PlayerDef) => p as LifePlayer;

export function defaultAcademy(): AcademyState {
  return { season: 0, prospects: [], promoted: 0 };
}

// ------------------------------------------------------------------ morale and chemistry

/** Morale from the last three results: HIGH on two wins and a draw or better, LOW on one point or fewer. */
export function morale(form: readonly FormMark[]): Mood {
  const last = form.slice(-3);
  if (last.length < 2) return 1;
  const pts = last.reduce((s, f) => s + (f === 'W' ? 3 : f === 'D' ? 1 : 0), 0);
  if (pts >= 7) return 2;
  if (pts <= 1 && last.length === 3) return 0;
  return 1;
}

/**
 * Chemistry of the eleven: the seasons they have played together (STRONG from two), and how settled the eleven is
 * this season (meta/morale.ts togetherness: an eleven that keeps starting together gets there up to a season sooner).
 */
export function chemistry(club: ClubState, season: number): Mood {
  const xi = club.squad.slice(0, 11);
  if (!xi.length) return 0;
  const yrs = xi.reduce((s, p) => {
    const m = life(p);
    const from = m.joined ?? m.boughtSeason ?? 1;
    return s + Math.max(0, Math.min(3, season - from));
  }, 0) / xi.length;
  const settled = togetherness(club);
  const score = yrs + (settled >= 0.75 ? 1 : settled >= 0.4 ? 0.5 : 0);
  return score >= 2 ? 2 : score >= 1 ? 1 : 0;
}

/**
 * Stat points the whole side gets on the day: +1 for HIGH morale (the eleven's own, meta/morale.ts), +1 for STRONG
 * chemistry, +1 at home with the FAN ZONE, +1 after a TEAM TALK (at most +2); LOW morale takes one off.
 */
export function matchLift(state: CareerState, home: boolean): number {
  const club = state.club;
  if (!club || !state.season) return 0;
  let n = 0;
  const mood = teamMood(state);
  if (mood === 2) n++;
  if (chemistry(club, state.season.number) === 2) n++;
  if (home && has(state.ground, 'fanzone')) n++;
  if (state.events?.talk) n++;
  n = Math.min(2, n);
  return mood === 0 ? n - 1 : n;
}

/** The captain: the most appearances for you (then the best player). */
export function captainOf(club: ClubState): PlayerDef | undefined {
  return [...club.squad].sort((a, b) => (life(b).apps ?? 0) - (life(a).apps ?? 0) || overall(b) - overall(a))[0];
}

// ------------------------------------------------------------------ after every match

function milestone(state: CareerState, p: LifePlayer, kind: 'g' | 'a', n: number): void {
  if (!milestoneOnce(state, `${p.id}:${kind}:${n}`)) return;
  const what = kind === 'g' ? `${n} GOALS` : `${n} GAMES`;
  addMoment(state, { kind: 'milestone', icon: kind === 'g' ? 'ball' : 'shirt', title: what, text: `${p.name.toUpperCase()} HAS ${what} FOR ${state.club?.name.toUpperCase() ?? 'YOU'}` });
  storyNews(state, `Milestone: ${p.name} reaches ${n} ${kind === 'g' ? 'goals' : 'games'} for ${state.club?.name ?? 'the club'}`, 'good');
  addLegacy(state, LEGACY_POINTS.milestone, `${p.name.toUpperCase()}: ${what}`);
}

/** Club records: a new holder is a moment (but not the very first holder: that's just the book opening). */
function updateRecords(state: CareerState, f: MatchFacts): void {
  const rec = state.legacy.records;
  const club = state.club;
  if (!club) return;
  const season = state.season?.number ?? 0;
  const margin = f.my - f.their;
  if (margin > 0 && (!rec.biggestWin || margin > rec.biggestWin.my - rec.biggestWin.their || (margin === rec.biggestWin.my - rec.biggestWin.their && f.my > rec.biggestWin.my))) {
    const first = !rec.biggestWin;
    rec.biggestWin = { my: f.my, their: f.their, vs: f.vs, season };
    if (!first && margin >= 3) {
      addMoment(state, { kind: 'record', icon: 'trophy', title: 'CLUB RECORD', text: `BIGGEST WIN EVER: ${f.my}:${f.their} AGAINST ${f.vs.toUpperCase()}` });
      addLegacy(state, LEGACY_POINTS.record, 'RECORD WIN');
    }
  }
  for (const p of club.squad) {
    const m = life(p);
    const goals = m.goals ?? 0;
    const apps = m.apps ?? 0;
    if (goals > 0 && (!rec.topScorer || goals > rec.topScorer.goals)) {
      const was = rec.topScorer;
      rec.topScorer = { name: p.name, goals };
      if (was && was.name !== p.name && milestoneOnce(state, `${p.id}:topscorer`)) {
        addMoment(state, { kind: 'record', icon: 'ball', title: 'CLUB RECORD', text: `${p.name.toUpperCase()} IS YOUR ALL TIME TOP SCORER` });
        addLegacy(state, LEGACY_POINTS.record, `${p.name.toUpperCase()}: TOP SCORER`);
      }
    }
    if (apps > 0 && (!rec.mostApps || apps > rec.mostApps.apps)) rec.mostApps = { name: p.name, apps };
  }
}

/**
 * A match of yours is over: appearances and goals go on the players, this season's scorers, the record book and
 * any milestone reached (each a moment on the hub, a NEWS line and a few legacy points).
 */
export function recordMatch(state: CareerState, f: MatchFacts): void {
  const club = state.club;
  const season = state.season;
  if (!club || !season) return;
  const byId = new Map(club.squad.map((p) => [p.id, life(p)]));
  for (const id of new Set(f.played)) {
    const p = byId.get(id);
    if (!p) continue;
    p.apps = (p.apps ?? 0) + 1;
    for (const n of APP_MILESTONES) if (p.apps === n) milestone(state, p, 'a', n);
  }
  for (const id of f.scorers) {
    const p = byId.get(id);
    if (!p) continue;
    p.goals = (p.goals ?? 0) + 1;
    const s = (season.scorers ??= {});
    s[id] = { name: p.name, goals: (s[id]?.goals ?? 0) + 1 };
    for (const n of GOAL_MILESTONES) if (p.goals === n) milestone(state, p, 'g', n);
  }
  updateRecords(state, f);
}

/** The record signing: the most you ever paid (checked after every visit to the market). */
export function syncRecordSigning(state: CareerState): void {
  const club = state.club;
  if (!club) return;
  const rec = state.legacy.records;
  for (const p of club.squad) {
    const m = life(p);
    if (!m.paid || (rec.recordSigning && m.paid <= rec.recordSigning.paid)) continue;
    const first = !rec.recordSigning;
    rec.recordSigning = { name: p.name, paid: m.paid, season: m.boughtSeason ?? state.season?.number ?? 0 };
    if (!first && milestoneOnce(state, `${p.id}:signing`)) {
      addMoment(state, { kind: 'record', icon: 'swap', title: 'RECORD SIGNING', text: `${p.name.toUpperCase()} JOINS FOR ${m.paid.toLocaleString('en-US')}` });
      storyNews(state, `Record signing! ${p.name} is the most expensive player in ${club.name} history`, 'good');
    }
  }
}

/** This season's top scorer (from the season's tally), or null before anyone has scored. */
export function seasonTopScorer(state: CareerState): { name: string; goals: number } | null {
  const s = state.season?.scorers;
  if (!s) return null;
  let best: { name: string; goals: number } | null = null;
  for (const v of Object.values(s)) if (!best || v.goals > best.goals) best = v;
  return best;
}

// ------------------------------------------------------------------ retirement (decided at the season's end)

/** Who hangs up his boots this summer (deterministic per career and season): the old, by RETIRE_CHANCE. */
export function decideRetirements(state: CareerState): Farewell[] {
  const club = state.club;
  const season = state.season;
  if (!club || !season) return [];
  const capId = captainOf(club)?.id;
  const out: Farewell[] = [];
  for (const p of club.squad) {
    const age = playerAge(p);
    const chance = age >= RETIRE_ALWAYS ? 1 : RETIRE_CHANCE[age] ?? 0;
    if (!chance) continue;
    const roll = (hashString(`${state.seed}|retire|${season.number}|${p.id}`) % 1000) / 1000;
    if (roll >= chance) continue;
    const m = life(p);
    const apps = m.apps ?? 0;
    const goals = m.goals ?? 0;
    out.push({ id: p.id, name: p.name, role: p.role, age, apps, goals, legend: apps >= LEGEND_APPS || goals >= LEGEND_GOALS || (p.id === capId && apps >= 20) });
  }
  return out;
}

/**
 * The new season: the retired leave (a farewell each, legends into the Hall of Fame), and the squad is kept playable:
 * at least SQUAD_MIN players and two keepers, from the academy first (youngsters straight up) and then free youth.
 */
export function applyRetirements(state: CareerState, leaving: readonly Farewell[]): void {
  const club = state.club;
  if (!club) return;
  const season = state.season?.number ?? 0;
  const legends: string[] = [];
  for (const f of leaving) {
    const idx = club.squad.findIndex((p) => p.id === f.id);
    if (idx < 0) continue;
    removeFromSquad(club, idx);
    const stats = f.apps ? ` after ${f.apps} games and ${f.goals} goals` : '';
    storyNews(state, `Farewell, ${f.name}! He retires at ${f.age}${stats}`, 'info');
    if (f.legend) {
      const why = f.goals >= LEGEND_GOALS ? `${f.goals} GOALS` : `${f.apps} GAMES`;
      if (induct(state, { id: f.id, name: f.name, role: f.role, club: club.name, apps: f.apps, goals: f.goals, season: Math.max(1, season - 1), why })) legends.push(f.name.toUpperCase());
    }
  }
  // One card for the summer's legends, however many.
  if (legends.length) {
    const names = legends.length === 1 ? legends[0] : `${legends.slice(0, -1).join(', ')} AND ${legends[legends.length - 1]}`;
    addMoment(state, { kind: 'farewell', icon: 'star', title: 'HALL OF FAME', text: `${names} ${legends.length === 1 ? 'RETIRES A CLUB LEGEND' : 'RETIRE AS CLUB LEGENDS'}` });
  }
  fillSquad(state);
}

/** Top the squad up to SQUAD_MIN with two keepers: best academy prospects first, then generated youngsters. */
export function fillSquad(state: CareerState): void {
  const club = state.club;
  if (!club) return;
  const gks = () => club.squad.filter((p) => p.role === 'GK').length;
  for (let guard = 0; guard < 30 && (club.squad.length < SQUAD_MIN || gks() < 2) && club.squad.length < SQUAD_MAX; guard++) {
    const needGk = gks() < 2;
    const pool = state.academy.prospects;
    let idx = pool.findIndex((p) => (needGk ? p.role === 'GK' : true));
    if (idx >= 0 && !needGk) idx = bestProspectIndex(state);
    if (idx >= 0) {
      promoteAt(state, idx, false);
      continue;
    }
    const p = youngster(state, needGk ? 'GK' : (['DF', 'MF', 'FW'] as Role[])[guard % 3], `fill${guard}`);
    joinSquad(state, p);
  }
}

// ------------------------------------------------------------------ the youth academy

/** A 16 or 17 year old with potential, a dozen points under the division's typical player. */
function youngster(state: CareerState, role: Role, salt: string): LifePlayer {
  const season = state.season;
  const div = season?.division ?? 6;
  const rng = new Rng(hashString(`${state.seed}|academy|${season?.number ?? 0}|${salt}`));
  const names = new Set<string>([...(state.club?.squad ?? []).map((p) => surnameOf(p.name)), ...state.academy.prospects.map((p) => surnameOf(p.name))]);
  // (The ACADEMY DIRECTOR, meta/staff.ts: prospects arrive a little better, and with a star more from level 2.)
  const director = staffLevel(state, 'academy');
  const target = divisionPlayerOverall(div, role) - 12 - rng.int(5) + (DIRECTOR_OVR[director] ?? 0);
  const p = makePlayer(rng, role, target - 6, 0, `y${season?.number ?? 0}${salt}`, names);
  tuneToOverall(p, Math.max(20, target));
  let pot = 2 + rng.int(3) + (DIRECTOR_STARS[director] ?? 0);
  if (has(state.ground, 'academy')) pot++;
  if (hasPerk(state.legacy, 'scouts')) pot++;
  const m = pinMeta(p, { age: 16 + rng.int(2), potential: Math.min(5, pot), contract: 3 }) as LifePlayer;
  m.academy = true;
  return m;
}

/** The season's intake: two prospects (three with the YOUTH ACADEMY), a keeper among them when the squad is short of one. Last year's undecided ones move on. */
export function academyIntake(state: CareerState): void {
  const season = state.season;
  const club = state.club;
  if (!season || !club || state.academy.season === season.number) return;
  const old = state.academy.prospects;
  if (old.length) storyNews(state, `${old.length === 1 ? old[0].name : `${old.length} academy prospects`} left to find a club elsewhere`, 'info');
  state.academy.prospects = [];
  state.academy.season = season.number;
  // The SCOUTING NETWORK (meta/gems.ts, mirrored into the career by meta/premium.ts): a stated guarantee, never odds.
  const network = SCOUT_NETWORKS[(state.staff?.network ?? 0) - 1];
  const n = INTAKE + (has(state.ground, 'academy') ? 1 : 0) + (DIRECTOR_EXTRA[staffLevel(state, 'academy')] ?? 0) + (network?.extra ?? 0);
  const rng = new Rng(hashString(`${state.seed}|intake|${season.number}`));
  const short = club.squad.filter((p) => p.role === 'GK').length < 2;
  const roles: Role[] = ['DF', 'MF', 'FW', 'MF', 'FW', 'DF'];
  for (let i = 0; i < n; i++) {
    const role: Role = i === 0 && short ? 'GK' : roles[(rng.int(roles.length) + i) % roles.length];
    state.academy.prospects.push(youngster(state, role, `p${i}`));
  }
  // The network's promise: the best of the intake has at least its stars, every time.
  if (network) {
    const top = state.academy.prospects[bestProspectIndex(state)];
    if (top && playerPotential(top) < network.minStars) top.potential = network.minStars;
  }
  const best = state.academy.prospects[bestProspectIndex(state)];
  storyNews(state, `Academy intake: ${n} prospects are ready${best ? `, ${best.name} looks special` : ''}`, 'good');
}

/** The prospect worth most: potential first, then the overall. */
export function bestProspectIndex(state: CareerState): number {
  const ps = state.academy.prospects;
  let best = -1;
  ps.forEach((p, i) => {
    const score = playerPotential(p) * 100 + overall(p);
    if (best < 0 || score > playerPotential(ps[best]) * 100 + overall(ps[best])) best = i;
  });
  return best;
}

function joinSquad(state: CareerState, p: LifePlayer): LifePlayer {
  const club = state.club!;
  const m: LifePlayer = { ...p, id: `c${club.nextId++}`, number: freeNumber(club.squad, p.role), joined: state.season?.number ?? 1 };
  m.academy = p.academy;
  club.squad.push(m);
  return m;
}

function promoteAt(state: CareerState, idx: number, news = true): LifePlayer | null {
  const p = state.academy.prospects[idx];
  if (!p || !state.club) return null;
  state.academy.prospects.splice(idx, 1);
  const m = joinSquad(state, p);
  state.academy.promoted = state.season?.number ?? 0;
  if (news) storyNews(state, `${m.name} (${playerAge(m)}) is promoted from the academy`, 'good');
  return m;
}

export type AcademyFail = 'not-found' | 'squad-full';

/** Promote a prospect into the squad (he joins the reserves). */
export function promoteProspect(state: CareerState, idx: number): { ok: true; player: LifePlayer } | { ok: false; reason: AcademyFail } {
  if (!state.academy.prospects[idx]) return { ok: false, reason: 'not-found' };
  if ((state.club?.squad.length ?? SQUAD_MAX) >= SQUAD_MAX) return { ok: false, reason: 'squad-full' };
  return { ok: true, player: promoteAt(state, idx)! };
}

export function releaseProspect(state: CareerState, idx: number): boolean {
  const p = state.academy.prospects[idx];
  if (!p) return false;
  state.academy.prospects.splice(idx, 1);
  return true;
}

/** What a prospect may become (an honest range: potential stars over the seasons until 23). */
export function prospectCeiling(p: PlayerDef): number {
  const growth = Math.max(0, 23 - playerAge(p)) * playerPotential(p);
  const keys = KEY_STATS[p.role].length;
  return Math.min(STAT_CAP, overall(p) + Math.round((growth * (keys + (STAT_KEYS.length - keys) / 2)) / STAT_KEYS.length));
}

// ------------------------------------------------------------------ save

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function readAcademy(v: unknown, readPlayer: (x: unknown) => PlayerDef | null): AcademyState {
  const a = defaultAcademy();
  if (!isObj(v)) return a;
  a.season = isNum(v.season) ? Math.max(0, Math.round(v.season)) : 0;
  a.promoted = isNum(v.promoted) ? Math.max(0, Math.round(v.promoted)) : 0;
  if (Array.isArray(v.prospects)) {
    for (const x of v.prospects.slice(0, 6)) {
      const p = readPlayer(x) as LifePlayer | null;
      if (p) a.prospects.push(p);
    }
  }
  return a;
}

/** The decided retirements carried in the summary (validated). */
export function readFarewells(v: unknown): Farewell[] {
  if (!Array.isArray(v)) return [];
  const roles: Role[] = ['GK', 'DF', 'MF', 'FW'];
  return v
    .filter((f): f is Obj => isObj(f) && typeof f.id === 'string' && typeof f.name === 'string' && roles.includes(f.role as Role))
    .slice(0, 8)
    .map((f) => ({
      id: f.id as string, name: (f.name as string).slice(0, 40), role: f.role as Role,
      age: isNum(f.age) ? Math.round(f.age) : 34, apps: isNum(f.apps) ? Math.max(0, Math.round(f.apps)) : 0,
      goals: isNum(f.goals) ? Math.max(0, Math.round(f.goals)) : 0, legend: f.legend === true,
    }));
}
