/**
 * THE WEEK AT THE CLUB: everything a league matchday sets in motion in the long game, in one place, so the season
 * (career.ts resolveMatchday) calls one function and the rest stays in its own file:
 * the staff are paid, the squad trains (XP), injuries heal and happen, mentors teach, morale moves, scouts report,
 * the sponsor pays, promises and pledges are checked, and the next feature opens.
 *
 * Also here:
 * - SIM THIS MATCH: an ordinary league match settled in one tap by the same rating-based result the rest of the
 *   league uses (career.ts simulateScore), for half the coins. Derbies, deciders and cup ties are always played.
 * - The PACE MILESTONES (`UNLOCKS`): the long game opens a piece at a time over the first matches of a career, so
 *   there is something new every match or two and never everything at once.
 * - COMING UP: what is in progress right now (a build, a scout report, an injured player on his way back, a promise,
 *   the transfer window), for the hub and the NEXT GOAL bar. Something is always on its way.
 *
 * Every timer counts league matchdays played. Nothing reads a clock, so being away costs nothing.
 * Pure rules, no DOM. Runtime import cycle with career.ts: bindings from it are only used inside functions.
 */
import { Rng, hashString } from '../core/rng';
import { overall, teamRating, type PlayerDef } from '../sim/types';
import {
  HALF_SEASON, MATCHDAYS, SQUAD_MIN, afterMatch, groundBonus, matchReward, nextMatch, removeFromSquad, resolveMatchday, simulateScore,
  swapPlayers, type CareerState, type LeagueClub, type Wallet,
} from './career';
import { CUP_AFTER, ROUND_NAMES } from './cup';
import {
  addTimeline, injuryCard, isBigMatch, pendingEvent, tickEvents, youthCard,
} from './events';
import { GEM_PRICES } from './gems';
import { partDef } from './ground';
import {
  MENTOR_TRAIT_AFTER, TRAIT_INFO, XP_GOAL, XP_START, XP_SUB, XP_TRAIN, gainXp, mentorOf, snapshotGrowth, tickMentors, type GrowPlayer,
} from './growth';
import { fillSquad, type MatchFacts } from './life';
import { playerAge, pushNews, windowInfo } from './market';
import { isInjured, rotateSuggestion, scorerMorale, talkWait, weekMorale } from './morale';
import {
  PHYSIO_CUT, PHYSIO_RISK, REGIONS, SCOUT_SLOTS, commercialIncome, payStaff, staffLevel, tickScouts, unseenReports,
} from './staff';
import { addMoment, isDerby, storyTag } from './story';
import { simStats } from './stats';

const grow = (p: PlayerDef) => p as GrowPlayer;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const last = (name: string) => (name.split(' ').pop() ?? name).toUpperCase();

// ------------------------------------------------------------------ the pace milestones

export interface Unlock {
  id: 'talk' | 'staff' | 'focus' | 'rotate' | 'scouts' | 'sim' | 'mentors';
  /** Matches of yours (any competition) before it opens. */
  after: number;
  title: string;
  text: string;
  icon: string;
}

/** What opens when, over a career's first matches: one new thing every match or two. */
export const UNLOCKS: readonly Unlock[] = [
  { id: 'talk', after: 1, title: 'TEAM TALK', text: 'LIFT THE SQUAD BEFORE A MATCH, ON THE SQUAD SCREEN', icon: 'chat' },
  { id: 'staff', after: 2, title: 'STAFF', text: 'HIRE AN ASSISTANT COACH IN MY CLUB', icon: 'bolt' },
  { id: 'focus', after: 3, title: 'TRAINING FOCUS', text: 'PICK WHAT EACH PLAYER WORKS ON AND WATCH HIM GROW', icon: 'chart' },
  { id: 'rotate', after: 4, title: 'ROTATE', text: 'ONE TAP RESTS A STARTER FOR A MAN WHO WANTS A GAME', icon: 'swap' },
  { id: 'scouts', after: 5, title: 'SCOUTS', text: 'HIRE A SCOUT WHO KNOWS A REGION', icon: 'scout' },
  { id: 'sim', after: 6, title: 'SIM THIS MATCH', text: 'SETTLE AN ORDINARY LEAGUE MATCH IN ONE TAP', icon: 'clock' },
  { id: 'mentors', after: 7, title: 'MENTORS', text: 'A VETERAN CAN TEACH A YOUNGSTER OF HIS POSITION', icon: 'duo' },
];

export function isOpen(state: CareerState, id: Unlock['id']): boolean {
  return !!state.events?.open.includes(id);
}

/** The next feature to open, and the matches it still needs (null when everything is open). */
export function nextUnlock(state: CareerState): { unlock: Unlock; left: number } | null {
  const u = UNLOCKS.find((x) => !isOpen(state, x.id));
  return u ? { unlock: u, left: Math.max(1, u.after - state.events.played) } : null;
}

/** Open whatever the matches played have earned (each with its moment on the hub). `quiet`: an old save, no cards. */
export function checkUnlocks(state: CareerState, quiet = false): Unlock[] {
  const out: Unlock[] = [];
  for (const u of UNLOCKS) {
    if (isOpen(state, u.id) || state.events.played < u.after) continue;
    state.events.open = [...state.events.open, u.id];
    out.push(u);
    if (!quiet) addMoment(state, { kind: 'academy', icon: u.icon, title: `NEW: ${u.title}`, text: u.text });
  }
  return out;
}

/** A career from before the long game (it has played matches already): everything is open, with no flood of cards. */
export function openAll(state: CareerState): void {
  state.events.open = UNLOCKS.map((u) => u.id);
}

// ------------------------------------------------------------------ injuries

/** A league matchday: the chance one of the eleven picks up a knock, and one of the rest in training. */
export const INJURY_CHANCE = 0.14;
export const TRAINING_INJURY = 0.04;
/** Never more than this many out at once, and never in a career's first matches. */
export const INJURY_MAX = 2;
export const INJURY_FREE_MATCHES = 3;
/** A player you field hurt plays this many stat points down. */
export const INJURED_DIP = 8;

/** The injured come out of the eleven at once: the best fit man of the position goes in (so nobody plays hurt by accident). */
export function benchInjured(state: CareerState): number {
  const club = state.club;
  if (!club) return 0;
  let n = 0;
  for (let guard = 0; guard < 11; guard++) {
    const pick = rotateSuggestion(state);
    if (!pick || pick.why !== 'injured' || !swapPlayers(club, pick.out, pick.in)) break;
    n++;
  }
  return n;
}

/** Everyone out injured gets a matchday nearer; the ones who are fit again are news. */
function healWeek(state: CareerState): void {
  for (const p of state.club?.squad ?? []) {
    const g = grow(p);
    if (!g.inj) continue;
    g.inj = Math.max(0, Math.round(g.inj) - 1);
    if (g.inj === 0) {
      pushNews(state, `${p.name} is fit again`, 'good', true, true);
      addTimeline(state, `${p.name} is back from injury`, 'medic', 'good');
    }
  }
}

/**
 * This matchday's injury, if any (seeded by the matchday): a starter from the match, or now and then someone in
 * training. The physio makes them rarer and shorter. Never the keeper when there are not two fit ones, never when
 * the squad is short, never more than INJURY_MAX at once. The card to answer comes with it (meta/events.ts).
 */
function rollInjury(state: CareerState): void {
  const club = state.club;
  const season = state.season;
  if (!club || !season || state.events.played <= INJURY_FREE_MATCHES) return;
  const fit = club.squad.filter((p) => !isInjured(p));
  if (club.squad.length - fit.length >= INJURY_MAX || fit.length <= SQUAD_MIN - 1) return;
  const rng = new Rng(hashString(`${state.seed}|inj|${season.number}|${season.matchday}`));
  const physio = staffLevel(state, 'physio');
  const risk = PHYSIO_RISK[physio] ?? 1;
  const match = rng.chance(INJURY_CHANCE * risk);
  const training = !match && rng.chance(TRAINING_INJURY * risk);
  if (!match && !training) return;
  const keepers = fit.filter((p) => p.role === 'GK').length;
  const pool = (match ? club.squad.slice(0, 11) : club.squad.slice(11)).filter((p) => !isInjured(p) && (p.role !== 'GK' || keepers > 2));
  if (!pool.length) return;
  const p = rng.pick(pool);
  const weeks = Math.max(1, 1 + rng.int(3) + (rng.chance(0.2) ? 1 : 0) - (PHYSIO_CUT[physio] ?? 0));
  grow(p).inj = weeks;
  benchInjured(state);
  pushNews(state, `${p.name} is injured: out for ${plural(weeks, 'match', 'matches')}`, 'bad', true, true);
  addTimeline(state, `${p.name} was injured: out for ${plural(weeks, 'match', 'matches')}`, 'medic', 'bad');
  injuryCard(state, p, weeks, training, GEM_PRICES.healPlayer);
}

// ------------------------------------------------------------------ the league matchday

export interface WeekResult {
  my: number;
  their: number;
  home: boolean;
  derby: boolean;
}

/**
 * A league matchday has been played (career.ts resolveMatchday calls this once, after the result is in the table).
 * In order: the clock, the staff's wages, the commercial manager's coins at home, the week's training, injuries
 * healing and happening, mentors, morale, the scouts' reports, everything the event cards set running, the halfway
 * point of the growth chart, and whatever feature the matches played have opened.
 */
export function weekTick(state: CareerState, wallet: Wallet, res: WeekResult): void {
  const club = state.club;
  const season = state.season;
  if (!club || !season) return;
  const ev = state.events;
  ev.clock = Math.min(1e7, ev.clock + 1);
  const started = new Set(club.squad.slice(0, 11).map((p) => p.id));
  payStaff(state, wallet);
  if (res.home) wallet.coins += commercialIncome(state);
  for (const p of club.squad) if (!isInjured(p)) gainXp(state, p, XP_TRAIN);
  healWeek(state);
  rollInjury(state);
  for (const m of tickMentors(club)) {
    const what = TRAIT_INFO[m.trait].name;
    addMoment(state, { kind: 'academy', icon: 'duo', title: 'LESSON LEARNED', text: `${m.kid.name.toUpperCase()} IS NOW A ${what}, THANKS TO ${m.vet.name.toUpperCase()}` });
    addTimeline(state, `${m.kid.name} learned from ${m.vet.name}: now a ${what.toLowerCase()}`, 'duo', 'good', true);
  }
  weekMorale(state, res.my, res.their);
  for (const r of tickScouts(state)) {
    const where = REGIONS[r.region].name;
    pushNews(state, `Scout report: ${plural(r.finds.length, 'player', 'players')} found in ${where.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}`, 'good', true, true);
    addMoment(state, { kind: 'academy', icon: 'scout', title: 'SCOUT REPORT', text: `${plural(r.finds.length, 'PLAYER', 'PLAYERS')} FOUND IN ${where}. SEE THEM IN MY CLUB, STAFF` });
  }
  tickEvents(state, wallet, res, started);
  if (season.matchday === HALF_SEASON) snapshotGrowth(club);
  checkUnlocks(state);
}

/**
 * What a match of yours (any competition) teaches the players who were in it: XP for the starters, half for anyone
 * who came on, a little more for each goal; a goal lifts the scorer's morale; and an academy graduate scoring in a
 * win is a story (meta/events.ts youthCard). career.ts afterMatch calls this with what the match left behind.
 */
export function matchXp(state: CareerState, f: MatchFacts, started: ReadonlySet<string>): void {
  const club = state.club;
  if (!club) return;
  const played = new Set(f.played);
  for (const p of club.squad) {
    if (!played.has(p.id)) continue;
    const goals = f.scorers.filter((id) => id === p.id).length;
    gainXp(state, p, (started.has(p.id) ? XP_START : XP_SUB) + goals * XP_GOAL);
    // (He got on: his wait is over.)
    if (!started.has(p.id)) grow(p).sat = 0;
  }
  scorerMorale(club, f.scorers);
  youthCard(state, f.scorers, f.my, f.their, f.vs);
}

// ------------------------------------------------------------------ the season turns

/**
 * The summer (career.ts startNextSeason, before the retirements): players whose contract ran out without a new deal
 * leave, knocks heal, and what was promised for last season is forgotten. The squad is topped up afterwards by the
 * retirements' own fill (life.ts), so it is always playable.
 */
export function seasonTurn(state: CareerState): void {
  const club = state.club;
  if (!club) return;
  for (const p of [...club.squad]) {
    const g = grow(p);
    g.inj = 0;
    if (!g.leaving) continue;
    const idx = club.squad.indexOf(p);
    // (Never the last keeper: he signs on for a year instead.)
    if (p.role === 'GK' && club.squad.filter((q) => q.role === 'GK').length <= 1) {
      delete g.leaving;
      continue;
    }
    removeFromSquad(club, idx);
    pushNews(state, `${p.name} left at the end of his contract`, 'info', true, true);
    addTimeline(state, `${p.name} left at the end of his contract`, 'shirt', 'info', true);
  }
  const ev = state.events;
  ev.promises = [];
  ev.pledge = null;
  ev.vow = null;
  ev.rebid = null;
  ev.rivalFire = 0;
  ev.talk = false;
  fillSquad(state);
}

/** The new season has started (career.ts startNextSeason, after the draw): a point on everyone's growth chart. */
export function seasonStart(state: CareerState): void {
  if (state.club) snapshotGrowth(state.club);
}

// ------------------------------------------------------------------ SIM THIS MATCH

/** A simulated match pays this share of what playing it would. */
export const SIM_PAY = 0.5;

export interface SimResult {
  my: number;
  their: number;
  coins: number;
  rival: LeagueClub;
  /** Your scorers' names, in order. */
  scorers: string[];
}

/** Why the next match can't be simulated (a short line), or null when it can. */
export function simBlock(state: CareerState): string | null {
  if (!isOpen(state, 'sim')) return 'OPENS AFTER A FEW MATCHES';
  const nm = nextMatch(state);
  if (!nm) return 'NO MATCH';
  if (nm.competition !== 'league') return 'CUP TIES ARE PLAYED';
  if (isBigMatch(state, nm) || storyTag(state, nm)) return 'TOO BIG TO SIM';
  return null;
}

/**
 * SIM THIS MATCH: the next league match settled now, by the rating-based result the league's other matches use
 * (your eleven as it stands, morale and all, against theirs), seeded by the fixture. The table, the week and the
 * record book move on exactly as if it had been played; it pays SIM_PAY of the coins. Null when it can't be simmed.
 */
export function simMatch(state: CareerState, wallet: Wallet): SimResult | null {
  if (simBlock(state)) return null;
  const nm = nextMatch(state);
  const season = state.season;
  const club = state.club;
  if (!nm || !season || !club) return null;
  const rng = new Rng(hashString(`${season.seed}|sim|${nm.md}`));
  const [hg, ag] = simulateScore(rng, teamRating(nm.home), teamRating(nm.away));
  const my = nm.userHome ? hg : ag;
  const their = nm.userHome ? ag : hg;
  const division = season.division;
  const stadium = state.stadium;
  const xi = club.squad.slice(0, 11);
  if (!resolveMatchday(state, wallet, nm.md, hg, ag)) return null;
  // Who scored: the forwards most, by their shooting.
  const weight = (p: PlayerDef) => (p.role === 'FW' ? 5 : p.role === 'MF' ? 3 : p.role === 'DF' ? 1 : 0) * p.stats.shooting;
  const total = xi.reduce((s, p) => s + weight(p), 0);
  const scorers: PlayerDef[] = [];
  for (let g = 0; g < my && total > 0; g++) {
    let roll = rng.next() * total;
    for (const p of xi) {
      roll -= weight(p);
      if (roll <= 0) {
        scorers.push(p);
        break;
      }
    }
  }
  // Who else played, the assists, the cards and the ratings (a seeded stream of its own: the score and scorers above stay as they were).
  const made = simStats(club.squad, scorers.map((p) => p.id), my, their, new Rng(hashString(`${season.seed}|simstats|${nm.md}`)));
  afterMatch(state, { played: made.played, scorers: scorers.map((p) => p.id), my, their, vs: nm.rival.name, stats: made.stats });
  const coins = Math.round(groundBonus(state, matchReward(division, stadium, my, their), nm.userHome, division).coins * SIM_PAY);
  wallet.coins += coins;
  return { my, their, coins, rival: nm.rival, scorers: scorers.map((p) => p.name) };
}

// ------------------------------------------------------------------ COMING UP (the come-back hooks)

export type SoonGo = 'career' | 'staff' | 'stadium' | 'market' | 'squad' | 'train';

export type SoonKind =
  | 'card' | 'report' | 'talk' | 'build' | 'scout' | 'injury' | 'promise' | 'pledge' | 'mentor' | 'sponsor' | 'window' | 'cup' | 'unlock' | 'chart' | 'intake';

export interface Soon {
  kind: SoonKind;
  text: string;
  icon: string;
  /** League matchdays until it happens (0: it is waiting for you now). */
  in: number;
  go: SoonGo;
}

/**
 * What is in progress at the club right now, the nearest first: a card to answer, a scout report in, a build, the
 * next report, an injured player on his way back, a promise to keep, the board's pledge, a youngster about to learn
 * a trait, the sponsor, the transfer window, the next cup round, the next feature. There is always something.
 */
export function comingUp(state: CareerState): Soon[] {
  const club = state.club;
  const season = state.season;
  if (!club || !season || state.summary) return [];
  const ev = state.events;
  const out: Soon[] = [];
  const after = (n: number) => `AFTER ${plural(n, 'MATCH', 'MATCHES')}`;
  const card = pendingEvent(state);
  if (card) out.push({ kind: 'card', text: `A DECISION IS WAITING: ${card.title}`, icon: card.icon, in: 0, go: 'career' });
  for (const r of unseenReports(state)) out.push({ kind: 'report', text: `SCOUT REPORT IN: ${plural(r.finds.length, 'PLAYER', 'PLAYERS')} FROM ${REGIONS[r.region].name}`, icon: 'scout', in: 0, go: 'staff' });
  if (isOpen(state, 'talk') && talkWait(state) === 0 && !ev.talk) out.push({ kind: 'talk', text: 'TEAM TALK IS READY', icon: 'chat', in: 0, go: 'squad' });
  const b = state.ground.building;
  if (b) out.push({ kind: 'build', text: `THE ${partDef(b.id).steps[b.level - 1]?.name ?? partDef(b.id).name} OPENS ${after(b.left)}`, icon: 'flag', in: b.left, go: 'stadium' });
  for (const slot of SCOUT_SLOTS) {
    const m = state.staff.hired[slot];
    const left = state.staff.due[slot];
    if (m && left && !state.staff.unpaid) out.push({ kind: 'scout', text: `SCOUT REPORT FROM ${REGIONS[m.task ?? m.region ?? 'home'].name} ${after(left)}`, icon: 'scout', in: left, go: 'staff' });
  }
  for (const p of [...club.squad].filter(isInjured).sort((a, b2) => overall(b2) - overall(a))) {
    const n = grow(p).inj ?? 0;
    out.push({ kind: 'injury', text: `${last(p.name)} IS BACK ${after(n)}`, icon: 'medic', in: n, go: 'squad' });
  }
  for (const pr of ev.promises) out.push({ kind: 'promise', text: `PROMISED: START ${last(pr.name)} WITHIN ${plural(Math.max(1, pr.by - ev.clock), 'MATCH', 'MATCHES')}`, icon: 'shirt', in: Math.max(1, pr.by - ev.clock), go: 'squad' });
  if (ev.pledge) {
    const n = Math.max(1, ev.pledge.until - ev.clock);
    out.push({ kind: 'pledge', text: `THE BOARD: ${plural(ev.pledge.wins - ev.pledge.have, 'MORE WIN', 'MORE WINS')} IN ${plural(n, 'MATCH', 'MATCHES')}`, icon: 'clock', in: n, go: 'career' });
  }
  for (const p of club.squad) {
    const g = grow(p);
    if (!g.mentor || !mentorOf(club, p) || (g.mentored ?? 0) >= MENTOR_TRAIT_AFTER) continue;
    const n = MENTOR_TRAIT_AFTER - (g.mentored ?? 0);
    out.push({ kind: 'mentor', text: `${last(p.name)} LEARNS A TRAIT ${after(n)}`, icon: 'duo', in: n, go: 'train' });
  }
  if (ev.sponsor) out.push({ kind: 'sponsor', text: `${ev.sponsor.name}: ${plural(ev.sponsor.left, 'MATCH', 'MATCHES')} LEFT ON THE DEAL`, icon: 'coin', in: ev.sponsor.left, go: 'career' });
  const win = windowInfo(season.matchday);
  if (!win.open && win.weeks > 0) out.push({ kind: 'window', text: `THE TRANSFER WINDOW OPENS ${after(win.weeks)}`, icon: 'swap', in: win.weeks, go: 'market' });
  const cup = season.cup;
  if (cup && cup.status === 'active' && cup.round <= 2) {
    const n = CUP_AFTER[cup.round] - season.matchday;
    if (n > 0) out.push({ kind: 'cup', text: `BLOCKY CUP ${ROUND_NAMES[cup.round]} ${after(n)}`, icon: 'trophy', in: n, go: 'career' });
  }
  const nu = nextUnlock(state);
  if (nu) out.push({ kind: 'unlock', text: `NEW: ${nu.unlock.title} ${after(nu.left)}`, icon: nu.unlock.icon, in: nu.left, go: 'career' });
  const left = MATCHDAYS - season.matchday;
  const kids = club.squad.filter((p) => playerAge(p) <= 21).length;
  if (kids && season.matchday < HALF_SEASON) out.push({ kind: 'chart', text: `HALFWAY: ${plural(kids, 'YOUNGSTER', 'YOUNGSTERS')} ON THE GROWTH CHART`, icon: 'chart', in: HALF_SEASON - season.matchday, go: 'train' });
  if (left > 0 && season.number >= 1) out.push({ kind: 'intake', text: `ACADEMY INTAKE ${after(left)}`, icon: 'star', in: left, go: 'career' });
  return out.sort((a, c) => a.in - c.in);
}

/** Is this the derby (for the match card's "RIVALS FIRED UP" chip)? */
export function rivalFire(state: CareerState, rivalId: string): number {
  return isDerby(state, rivalId) ? state.events?.rivalFire ?? 0 : 0;
}
