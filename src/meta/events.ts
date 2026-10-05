/**
 * EVENT CARDS: the club's emergent story (the owner: "Unscripted narratives emerge naturally, such as a rival coach
 * trash-talking the player in press conferences, or an academy graduate rising up to score a champions league-winning
 * goal"). Between matches a short card arrives with two or three answers. Every card comes from the real state of the
 * club (who is unhappy on the bench, whose contract is running out, who the rival is, how the board feels), and every
 * answer has a consequence you can feel and track: morale, board confidence, the rival's fire in the next derby, a
 * promise to keep, a sponsor's coins, a star sold.
 *
 * THE RULES (tests/glory.test.ts pins them):
 * - Deterministic: the same career, played the same way, sees the same cards (every draw is seeded by the career,
 *   the season and the matchday).
 * - Never unwinnable: every card has an answer that costs nothing, a card never takes coins you don't have, never
 *   sells your last keeper or takes the squad under its minimum, and nothing here ends a career (the board never
 *   sacks you).
 * - Never punishing absence: nothing runs on a clock. Cards wait as long as you like, and every timer (a promise, a
 *   pledge, a sponsor) counts league matchdays you play.
 * - Kid-safe: football stories only.
 *
 * The TIMELINE keeps the story so far (every card answered and every story line of the NEWS), newest first.
 * Pure rules and state, no DOM; the card and the timeline are drawn by ui/glory.ts.
 *
 * Runtime import cycle with career.ts: bindings from it are only used inside functions.
 */
import { Rng, hashString } from '../core/rng';
import { overall, type PlayerDef, type Role } from '../sim/types';
import {
  BOTTOM_DIVISION, HALF_SEASON, MATCHDAYS, canSell, nextMatch, removeFromSquad, type CareerState, type NextMatch, type Wallet,
} from './career';
import { randomClubSeed } from './data';
import { addTrait, autoMentors, canMentor, gainXp, hasTrait, mentorOf, pupilOf, setMentor, type GrowPlayer, type TraitId, TRAITS } from './growth';
import { captainOf, type LifePlayer } from './life';
import { contractOf, listPlayer, playerAge, playerValue, pushNews, saleFor, townOf, wageOf, windowOpen } from './market';
import { addMorale, expectsToPlay, isInjured, moraleOf } from './morale';
import { sponsorMult } from './staff';
import { addMoment, isDerby, storyTag } from './story';

export type EventKind =
  | 'press' | 'injury' | 'bench' | 'clash' | 'contract' | 'bid' | 'youth' | 'ultimatum' | 'protest' | 'festival' | 'sponsor' | 'mentor' | 'training' | 'community';

export type Tone = 'good' | 'bad' | 'info';
export type SponsorPay = 'match' | 'win';

/** One thing an answer does (plain data, so a card saves as it is). `who`: a squad id, or a group. */
export type Fx =
  | { t: 'morale'; who: string; d: number }
  | { t: 'coins'; d: number }
  | { t: 'board'; d: number }
  | { t: 'rival'; d: number }
  | { t: 'heal'; who: string; d: number }
  | { t: 'promise'; who: string; within: number }
  | { t: 'list'; who: string }
  | { t: 'sell'; who: string; coins: number; to: string }
  | { t: 'renew'; who: string; years: number }
  | { t: 'leave'; who: string }
  | { t: 'xp'; who: string; d: number }
  | { t: 'trait'; who: string; trait: TraitId }
  | { t: 'sponsor'; name: string; pay: SponsorPay; amount: number; left: number }
  | { t: 'pledge'; wins: number; within: number; coins: number; board: number; fail: number }
  | { t: 'fans'; d: number; left: number }
  | { t: 'vow'; win: number; lose: number }
  | { t: 'rebid'; who: string; coins: number; to: string }
  | { t: 'mentor'; kid: string; vet: string };

export interface EventChoice {
  /** The button: "FIRE BACK". */
  label: string;
  /** What it does, in a few words: "SQUAD FIRED UP. SO ARE THEY". */
  hint: string;
  /** The line it leaves in the timeline. */
  say: string;
  tone: Tone;
  /** Coins it costs (the answer is closed while the wallet is short), or gems (HEAL NOW: meta/gems.ts). */
  coins?: number;
  gems?: number;
  fx: Fx[];
}

export interface EventCard {
  id: string;
  kind: EventKind;
  season: number;
  md: number;
  title: string;
  text: string;
  /** Pixel icon (ui/pixelIcons.ts). */
  icon: string;
  /** Squad ids it is about (the first one's face is on the card). */
  who: string[];
  choices: EventChoice[];
}

export interface TimelineEntry {
  s: number;
  md: number;
  text: string;
  icon: string;
  tone: Tone;
  /** A season headline (the recap shows these). */
  big?: boolean;
}

/** A start you promised a player: kept when he starts a league match by `by` (an absolute matchday count). */
export interface MinutesPromise {
  who: string;
  name: string;
  by: number;
}

/** What you told the board you would do: `wins` wins by `until`. */
export interface Pledge {
  wins: number;
  have: number;
  until: number;
  coins: number;
  board: number;
  fail: number;
}

export interface Sponsor {
  name: string;
  pay: SponsorPay;
  amount: number;
  /** League matchdays the deal still runs. */
  left: number;
  /** Coins it has paid so far. */
  paid: number;
}

export interface EventsState {
  /** Cards waiting for an answer, oldest first. */
  queue: EventCard[];
  /** The story so far, newest first. */
  timeline: TimelineEntry[];
  /** When each kind of card last came (by key, an absolute league matchday count): the cooldowns. */
  last: Record<string, number>;
  /** League matchdays played in this career (the clock every timer here counts on). */
  clock: number;
  /** Matches of yours in this career, every competition (the pace milestones count on it: meta/week.ts). */
  played: number;
  /** Features opened so far (meta/week.ts UNLOCKS). */
  open: string[];
  /** The rival's fire for the next derby after the press conference: -1 relaxed .. 2 fired up (stat points). */
  rivalFire: number;
  /** TEAM TALK (meta/morale.ts): its lift is on for the next match; the matchday count it is ready again from. */
  talk: boolean;
  talkAt: number;
  promises: MinutesPromise[];
  pledge: Pledge | null;
  sponsor: Sponsor | null;
  /** The fans' mood at your next home matches: fuller or emptier stands (-1..2), and how many home matches it lasts. */
  fans: { d: number; left: number } | null;
  /** "We will win it": board confidence riding on the next big match. */
  vow: { win: number; lose: number } | null;
  /** A club that said it would come back with more for a player. */
  rebid: { who: string; coins: number; to: string } | null;
  nextId: number;
}

export const QUEUE_MAX = 3;
export const TIMELINE_MAX = 80;
/** No card for this many league matchdays: a small one comes anyway, so there is always something new. */
export const QUIET_MAX = 2;
/** A sponsor deal runs a season's worth of league matchdays (a literal: this file never reads career.ts at module load). */
export const SPONSOR_LENGTH = 14;
/** Matchdays a promised start has to come within, and what keeping or breaking it does to his morale. */
/** No club bids for your star in a career's first matches. */
export const BID_FREE_MATCHES = 4;
export const PROMISE_WITHIN = 3;
export const PROMISE_KEPT = 10;
export const PROMISE_BROKEN = -15;

const SPONSORS = ['PIXEL PIZZA', 'BLOCK JUICE', 'VOXEL TOYS', 'CUBE CARS', 'BRICK BIKES', 'SQUARE SNACKS'] as const;

export const EVENT_ICON: Record<EventKind, string> = {
  press: 'chat', injury: 'medic', bench: 'shirt', clash: 'fire', contract: 'gift', bid: 'swap', youth: 'star', ultimatum: 'clock',
  protest: 'flag', festival: 'burst', sponsor: 'coin', mentor: 'duo', training: 'bolt', community: 'ball',
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const round10 = (v: number) => Math.round(v / 10) * 10;
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const grow = (p: PlayerDef) => p as GrowPlayer;
const last = (name: string) => name.split(' ').pop() ?? name;

export function defaultEvents(): EventsState {
  return {
    queue: [], timeline: [], last: {}, clock: 0, played: 0, open: [], rivalFire: 0, talk: false, talkAt: 0,
    promises: [], pledge: null, sponsor: null, fans: null, vow: null, rebid: null, nextId: 1,
  };
}

// ------------------------------------------------------------------ the timeline

/** A line in the club's story (newest first). `big` makes it one of the season's headlines. */
export function addTimeline(state: CareerState, text: string, icon = 'ball', tone: Tone = 'info', big = false): void {
  const ev = state.events;
  if (!ev) return;
  const e: TimelineEntry = { s: state.season?.number ?? 0, md: state.season?.matchday ?? 0, text: text.slice(0, 140), icon, tone };
  if (big) e.big = true;
  ev.timeline = [e, ...ev.timeline].slice(0, TIMELINE_MAX);
}

/** This season's headlines, newest first. */
export function seasonHeadlines(state: CareerState, season = state.season?.number ?? 0, max = 6): TimelineEntry[] {
  return state.events.timeline.filter((e) => e.s === season && e.big).slice(0, max);
}

// ------------------------------------------------------------------ what makes a match big

/** A derby, a decider, a cup semi final or final, a knockout abroad: where a BIG GAME player lifts and the press comes. */
export function isBigMatch(state: CareerState, nm: NextMatch | null): boolean {
  if (!nm) return false;
  if (nm.competition === 'cup') return nm.cupRound >= 1;
  if (nm.competition !== 'league') return nm.stage !== 'group';
  if (isDerby(state, nm.rival.id)) return true;
  const tag = storyTag(state, nm);
  return !!tag && /DECIDER|SURVIVAL/.test(tag.tag);
}

// ------------------------------------------------------------------ cooldowns and the queue

function ready(state: CareerState, key: string, gap: number): boolean {
  const at = state.events.last[key];
  return at === undefined || state.events.clock - at >= gap;
}

function mark(state: CareerState, key: string): void {
  const l = state.events.last;
  l[key] = state.events.clock;
  // (Per-player keys pile up over the seasons: the oldest go.)
  const keys = Object.keys(l);
  if (keys.length > 120) for (const k of keys.sort((a, b) => l[a] - l[b]).slice(0, keys.length - 120)) delete l[k];
}

function card(state: CareerState, kind: EventKind, title: string, text: string, who: string[], choices: EventChoice[]): EventCard {
  return {
    id: `e${state.events.nextId++}`, kind, season: state.season?.number ?? 0, md: state.season?.matchday ?? 0,
    title, text, icon: EVENT_ICON[kind], who, choices,
  };
}

function push(state: CareerState, c: EventCard | null): boolean {
  if (!c || state.events.queue.length >= QUEUE_MAX) return false;
  state.events.queue.push(c);
  mark(state, 'any');
  return true;
}

/** Injury offers stop being useful once the player has recovered (or left the squad). Never charge for them. */
function dropRecoveredInjuries(state: CareerState): void {
  const ev = state.events;
  if (!ev) return;
  ev.queue = ev.queue.filter((c) => c.kind !== 'injury' || state.club?.squad.some((p) => c.who.includes(p.id) && isInjured(p)));
}

/** The oldest card waiting for an answer, after discarding obsolete injury offers, or null. */
export function pendingEvent(state: CareerState): EventCard | null {
  dropRecoveredInjuries(state);
  return state.events?.queue[0] ?? null;
}

/** Can this answer be taken with what is in the wallet (and the gem wallet)? Every card has one that always can. */
export function choiceOpen(c: EventChoice, coins: number, gems = 0): boolean {
  return (c.coins ?? 0) <= coins && (c.gems ?? 0) <= gems;
}

// ------------------------------------------------------------------ applying an answer

function squadIds(state: CareerState, who: string): PlayerDef[] {
  const squad = state.club?.squad ?? [];
  switch (who) {
    case 'all': return squad;
    case 'xi': return squad.slice(0, 11);
    case 'bench': return squad.slice(11);
    case 'young': return squad.filter((p) => playerAge(p) <= 21);
    case 'GK': case 'DF': case 'MF': case 'FW': return squad.filter((p) => p.role === (who as Role));
    default: return squad.filter((p) => p.id === who);
  }
}

function applyFx(state: CareerState, wallet: Wallet, fx: Fx): void {
  const ev = state.events;
  const club = state.club;
  if (!club) return;
  switch (fx.t) {
    case 'morale':
      for (const p of squadIds(state, fx.who)) addMorale(p, fx.d);
      break;
    case 'coins':
      wallet.coins = Math.max(0, wallet.coins + fx.d);
      break;
    case 'board':
      state.board.confidence = clamp(state.board.confidence + fx.d, 0, 100);
      break;
    case 'rival':
      ev.rivalFire = clamp(fx.d, -1, 2);
      break;
    case 'heal':
      for (const p of squadIds(state, fx.who)) {
        const g = grow(p);
        g.inj = Math.max(0, Math.round(g.inj ?? 0) - fx.d);
      }
      break;
    case 'promise': {
      const p = club.squad.find((q) => q.id === fx.who);
      if (p) ev.promises = [...ev.promises.filter((x) => x.who !== p.id), { who: p.id, name: p.name, by: ev.clock + fx.within }].slice(-4);
      break;
    }
    case 'list':
      listPlayer(state, fx.who);
      break;
    case 'sell': {
      const idx = club.squad.findIndex((q) => q.id === fx.who);
      if (idx < 0 || !canSell(state, fx.who).ok) break;
      const p = club.squad[idx];
      removeFromSquad(club, idx);
      state.tm.sales = state.tm.sales.filter((s) => s.playerId !== p.id);
      wallet.coins += fx.coins;
      pushNews(state, `${p.name} sold to ${fx.to} for ${fmt(fx.coins)}`, 'good', true);
      break;
    }
    case 'renew':
      for (const p of squadIds(state, fx.who)) {
        const g = grow(p);
        g.contract = clamp(contractOf(p) + fx.years, 1, 4);
        delete g.leaving;
      }
      break;
    case 'leave':
      for (const p of squadIds(state, fx.who)) grow(p).leaving = true;
      break;
    case 'xp':
      for (const p of squadIds(state, fx.who)) gainXp(state, p, fx.d);
      break;
    case 'trait':
      for (const p of squadIds(state, fx.who)) addTrait(p, fx.trait);
      break;
    case 'sponsor':
      ev.sponsor = { name: fx.name, pay: fx.pay, amount: fx.amount, left: fx.left, paid: 0 };
      break;
    case 'pledge':
      ev.pledge = { wins: fx.wins, have: 0, until: ev.clock + fx.within, coins: fx.coins, board: fx.board, fail: fx.fail };
      break;
    case 'fans':
      ev.fans = fx.d ? { d: clamp(fx.d, -1, 2), left: Math.max(1, fx.left) } : null;
      break;
    case 'vow':
      ev.vow = { win: fx.win, lose: fx.lose };
      break;
    case 'rebid':
      ev.rebid = { who: fx.who, coins: fx.coins, to: fx.to };
      break;
    case 'mentor':
      setMentor(club, fx.kid, fx.vet);
      break;
  }
}

export type EventFail = 'not-found' | 'no-coins' | 'no-gems';
export type EventResult = { ok: true; card: EventCard; choice: EventChoice } | { ok: false; reason: EventFail };

/**
 * Answer a card. The answer's coins leave the wallet (an answer the wallet can't cover is refused, and nothing
 * changes); an answer that costs gems calls `spendGems` (meta/gems.ts spendGems bound to the save) and is refused when
 * that says no. Then everything the answer does happens, the story gets its line, and the card is gone.
 */
export function resolveEvent(
  state: CareerState, wallet: Wallet, cardId: string, idx: number, spendGems?: (n: number, reason: string) => boolean,
): EventResult {
  // A card can have waited while the player healed naturally, was treated on his GROW card, or left the squad.
  // Revalidate before either wallet is touched, including when the stale card is already on screen.
  dropRecoveredInjuries(state);
  const ev = state.events;
  const c = ev.queue.find((x) => x.id === cardId);
  const choice = c?.choices[idx];
  if (!c || !choice) return { ok: false, reason: 'not-found' };
  const cost = choice.coins ?? 0;
  if (cost > wallet.coins) return { ok: false, reason: 'no-coins' };
  if (choice.gems && !(spendGems?.(choice.gems, `event:${c.kind}`) ?? false)) return { ok: false, reason: 'no-gems' };
  wallet.coins -= cost;
  for (const fx of choice.fx) applyFx(state, wallet, fx);
  ev.queue = ev.queue.filter((x) => x !== c);
  addTimeline(state, choice.say, c.icon, choice.tone, c.kind !== 'training' && c.kind !== 'community');
  return { ok: true, card: c, choice };
}

// ------------------------------------------------------------------ the cards

type Squad = PlayerDef[];
const named = (p: PlayerDef) => last(p.name).toUpperCase();
const step = (state: CareerState) => BOTTOM_DIVISION - (state.season?.division ?? BOTTOM_DIVISION);

function leaderOf(squad: Squad): PlayerDef | undefined {
  return squad.filter((p) => hasTrait(p, 'leader')).sort((a, b) => overall(b) - overall(a))[0];
}

/** The press before a derby: the rival coach has been talking, and what you say shows up on derby day. */
function derbyPress(state: CareerState, nm: NextMatch): EventCard | null {
  const club = state.club!;
  const r = state.story.rival;
  const town = townOf(nm.rival.name);
  const ahead = !!r && r.won > r.lost;
  const text = ahead
    ? `The ${town} boss says this derby will be different. The reporters turn to you.`
    : `The ${town} boss says your lot will not get a kick on derby day. The reporters turn to you.`;
  const leader = leaderOf(club.squad);
  const third: EventChoice = leader
    ? { label: `LET ${named(leader)} TALK`, hint: 'YOUR LEADER LIFTS THE SQUAD', say: `${leader.name} did the talking before the derby`, tone: 'good', fx: [{ t: 'morale', who: 'all', d: 4 }, { t: 'rival', d: 0 }] }
    : { label: 'BACK YOUR KIDS', hint: 'THE YOUNG PLAYERS GROW A FOOT', say: 'You backed your young players before the derby', tone: 'good', fx: [{ t: 'morale', who: 'young', d: 8 }, { t: 'rival', d: 0 }] };
  return card(state, 'press', 'PRESS CONFERENCE', text, [], [
    { label: 'FIRE BACK', hint: 'SQUAD FIRED UP. SO ARE THEY: +1', say: `You fired back at the ${town} boss. Derby day will be lively`, tone: 'info', fx: [{ t: 'morale', who: 'all', d: 6 }, { t: 'rival', d: 1 }] },
    { label: 'STAY HUMBLE', hint: 'CALM HEADS. THEY RELAX: 1 DOWN', say: `You praised ${town} before the derby. They relaxed`, tone: 'info', fx: [{ t: 'morale', who: 'xi', d: 2 }, { t: 'rival', d: -1 }] },
    third,
  ]);
}

/** The press before a final, a semi final or a decider. */
function bigPress(state: CareerState, nm: NextMatch): EventCard | null {
  const what = nm.competition === 'league' ? storyTag(state, nm)?.tag ?? 'BIG MATCH' : nm.label;
  return card(state, 'press', 'PRESS CONFERENCE', `The ${what.toLowerCase()} is next. What do you tell the reporters?`, [], [
    { label: 'WE WILL WIN IT', hint: 'MORALE UP. THE BOARD HOLDS YOU TO IT', say: `You promised to win the ${what.toLowerCase()}`, tone: 'info', fx: [{ t: 'morale', who: 'all', d: 6 }, { t: 'vow', win: 6, lose: 4 }] },
    { label: 'ONE GAME AT A TIME', hint: 'STEADY HEADS', say: `You kept calm before the ${what.toLowerCase()}`, tone: 'info', fx: [{ t: 'morale', who: 'xi', d: 3 }] },
    { label: 'THIS IS FOR THE FANS', hint: 'FULLER STANDS AT HOME', say: `You dedicated the ${what.toLowerCase()} to the fans`, tone: 'good', fx: [{ t: 'morale', who: 'all', d: 2 }, { t: 'fans', d: 1, left: 2 }] },
  ]);
}

/**
 * The press conference before the next match, when it is a big one (once per match). Called after a league matchday
 * and after a cup tie, so a final always gets its build up.
 */
export function rollPress(state: CareerState, next?: NextMatch | null): boolean {
  const season = state.season;
  if (!season || !state.club || state.summary || state.events.queue.length >= QUEUE_MAX) return false;
  let nm: NextMatch | null = next ?? null;
  if (next === undefined) {
    try {
      nm = nextMatch(state);
    } catch {
      nm = null;
    }
  }
  if (!nm || !isBigMatch(state, nm)) return false;
  const key = `press:${season.number}:${nm.competition}:${nm.md}:${nm.cupRound}`;
  if (state.events.last[key] !== undefined) return false;
  const c = nm.competition === 'league' && isDerby(state, nm.rival.id) ? derbyPress(state, nm) : bigPress(state, nm);
  if (!push(state, c)) return false;
  mark(state, key);
  return true;
}

/** An injury (meta/week.ts decides who and how long): rest him, pay for extra physio, or heal him now with gems. */
export function injuryCard(state: CareerState, p: PlayerDef, weeks: number, training: boolean, healGems: number): boolean {
  const name = last(p.name);
  const choices: EventChoice[] = [
    { label: 'REST HIM', hint: `BACK AFTER ${weeks} ${weeks === 1 ? 'MATCH' : 'MATCHES'}`, say: `${p.name} is out for ${weeks} ${weeks === 1 ? 'match' : 'matches'}`, tone: 'bad', fx: [] },
  ];
  if (weeks >= 2) {
    choices.push({
      label: 'EXTRA PHYSIO', hint: 'BACK 1 MATCH SOONER', coins: round10(40 + overall(p) * 2), tone: 'info',
      say: `Extra physio for ${p.name}: back a match sooner`, fx: [{ t: 'heal', who: p.id, d: 1 }],
    });
  }
  if (healGems > 0) {
    choices.push({ label: 'HEAL NOW', hint: 'FIT FOR THE NEXT MATCH', gems: healGems, tone: 'good', say: `${p.name} was back on his feet at once`, fx: [{ t: 'heal', who: p.id, d: 99 }] });
  }
  const text = training ? `${name} pulled up in training. He is out for ${weeks} ${weeks === 1 ? 'match' : 'matches'}.` : `${name} limped off at full time. He is out for ${weeks} ${weeks === 1 ? 'match' : 'matches'}.`;
  return push(state, card(state, 'injury', 'INJURY', text, [p.id], choices));
}

/** A bench player who expects a game and has not had one: he wants minutes. */
function benchCard(state: CareerState): EventCard | null {
  const club = state.club!;
  const sad = club.squad
    .slice(11)
    .filter((p) => !isInjured(p) && moraleOf(p) <= 45 && (grow(p).sat ?? 0) >= 4 && expectsToPlay(club, p) && ready(state, `bench:${p.id}`, 8) && !state.events.promises.some((x) => x.who === p.id))
    .sort((a, b) => moraleOf(a) - moraleOf(b) || overall(b) - overall(a))[0];
  if (!sad) return null;
  mark(state, `bench:${sad.id}`);
  const loyal = hasTrait(sad, 'loyal');
  const choices: EventChoice[] = [
    { label: 'PROMISE HIM A START', hint: `START HIM WITHIN ${PROMISE_WITHIN} MATCHES`, say: `You promised ${sad.name} a start`, tone: 'info', fx: [{ t: 'morale', who: sad.id, d: 8 }, { t: 'promise', who: sad.id, within: PROMISE_WITHIN }] },
    loyal
      ? { label: 'ASK FOR PATIENCE', hint: 'HE IS LOYAL: HE WAITS', say: `${sad.name} agreed to wait for his chance`, tone: 'info', fx: [{ t: 'morale', who: sad.id, d: 2 }] }
      : { label: 'ASK FOR PATIENCE', hint: 'HE STAYS UNHAPPY', say: `${sad.name} was told to wait for his chance`, tone: 'bad', fx: [{ t: 'morale', who: sad.id, d: -4 }] },
  ];
  if (canSell(state, sad.id).ok && !saleFor(state, sad.id)) {
    choices.push({ label: 'LET HIM GO', hint: 'ON THE TRANSFER LIST', say: `${sad.name} went on the transfer list`, tone: 'info', fx: [{ t: 'list', who: sad.id }] });
  }
  return card(state, 'bench', 'HE WANTS TO PLAY', `${last(sad.name)} knocks on your door. He has sat out ${grow(sad).sat} matches and wants a game.`, [sad.id], choices);
}

/** Two big characters fall out: a hot head and whoever is nearest. */
function clashCard(state: CareerState, rng: Rng, lost: boolean): EventCard | null {
  const club = state.club!;
  const pool = club.squad.slice(0, 18).filter((p) => !isInjured(p));
  const hot = pool.filter((p) => hasTrait(p, 'hothead'));
  if (!hot.length || !rng.chance(lost ? 0.5 : 0.2)) return null;
  const a = rng.pick(hot);
  const others = pool.filter((p) => p.id !== a.id && (p.role === a.role || hasTrait(p, 'ambitious') || hasTrait(p, 'hothead')));
  const b = others.sort((x, y) => overall(y) - overall(x))[0] ?? pool.find((p) => p.id !== a.id);
  if (!b) return null;
  const leader = leaderOf(club.squad.filter((p) => p.id !== a.id && p.id !== b.id));
  return card(state, 'clash', 'LOCKER ROOM ROW', `${last(a.name)} and ${last(b.name)} had words after training. The squad is watching what you do.`, [a.id, b.id], [
    { label: `BACK ${named(a)}`, hint: `${named(a)} UP, ${named(b)} DOWN`, say: `You backed ${a.name} in a row with ${b.name}`, tone: 'info', fx: [{ t: 'morale', who: a.id, d: 8 }, { t: 'morale', who: b.id, d: -8 }] },
    { label: `BACK ${named(b)}`, hint: `${named(b)} UP, ${named(a)} DOWN`, say: `You backed ${b.name} in a row with ${a.name}`, tone: 'info', fx: [{ t: 'morale', who: b.id, d: 8 }, { t: 'morale', who: a.id, d: -8 }] },
    leader
      ? { label: 'SIT THEM DOWN', hint: `${named(leader)} SORTS IT OUT`, say: `${leader.name} settled a row between ${a.name} and ${b.name}`, tone: 'good', fx: [{ t: 'morale', who: a.id, d: 3 }, { t: 'morale', who: b.id, d: 3 }] }
      : { label: 'SIT THEM DOWN', hint: 'BOTH SULK A LITTLE', say: `${a.name} and ${b.name} were told to shake hands`, tone: 'info', fx: [{ t: 'morale', who: a.id, d: -2 }, { t: 'morale', who: b.id, d: -2 }] },
  ]);
}

/** A key player in the last year of his contract wants to talk (once a season each, in the second half). */
function contractCard(state: CareerState): EventCard | null {
  const club = state.club!;
  const season = state.season!;
  if (season.matchday < HALF_SEASON + 1 || season.matchday > MATCHDAYS - 2) return null;
  const avg = club.squad.reduce((s, p) => s + overall(p), 0) / Math.max(1, club.squad.length);
  const p = club.squad
    .filter((q) => contractOf(q) <= 1 && !grow(q).leaving && playerAge(q) <= 32 && overall(q) >= avg - 1 && state.events.last[`contract:${season.number}:${q.id}`] === undefined)
    .sort((a, b) => overall(b) - overall(a))[0];
  if (!p || !ready(state, 'contract', 2)) return null;
  mark(state, 'contract');
  mark(state, `contract:${season.number}:${p.id}`);
  const loyal = hasTrait(p, 'loyal');
  const bonus = round10(wageOf(p) * (loyal ? 2 : hasTrait(p, 'ambitious') ? 6 : 4));
  return card(state, 'contract', 'CONTRACT TALKS', `${last(p.name)}'s contract runs out this summer. ${loyal ? 'He wants to stay.' : 'His agent wants an answer.'}`, [p.id], [
    { label: 'NEW 3 YEAR DEAL', hint: 'HE STAYS 3 YEARS, MORALE UP', coins: bonus, say: `${p.name} signed a new three year deal`, tone: 'good', fx: [{ t: 'renew', who: p.id, years: 3 }, { t: 'morale', who: p.id, d: 8 }] },
    { label: 'ONE MORE YEAR', hint: 'HE STAYS 1 YEAR, THEN TALKS AGAIN', coins: round10(bonus * 0.4), say: `${p.name} signed for one more year`, tone: 'info', fx: [{ t: 'renew', who: p.id, years: 1 }, { t: 'morale', who: p.id, d: hasTrait(p, 'ambitious') ? -4 : 2 }] },
    loyal
      ? { label: 'NO NEW DEAL', hint: 'LOYAL: HE STAYS A YEAR ANYWAY', say: `${p.name} stayed on without a new deal`, tone: 'info', fx: [{ t: 'renew', who: p.id, years: 1 }, { t: 'morale', who: p.id, d: -3 }] }
      : { label: 'LET IT RUN OUT', hint: 'HE LEAVES IN THE SUMMER', say: `${p.name} will leave when his contract runs out`, tone: 'bad', fx: [{ t: 'leave', who: p.id }, { t: 'morale', who: p.id, d: -6 }] },
  ]);
}

/** A bigger club offers for your star (only while the window is open). */
function bidCard(state: CareerState, rng: Rng, again?: { who: string; coins: number; to: string }): EventCard | null {
  const club = state.club!;
  const season = state.season!;
  let p: PlayerDef | undefined;
  let coins = 0;
  let to = '';
  if (again) {
    p = club.squad.find((q) => q.id === again.who);
    coins = again.coins;
    to = again.to;
  } else {
    // (Never in a career's first matches: learn the club before somebody bids for its star.)
    if (state.events.played < BID_FREE_MATCHES || !windowOpen(season.matchday) || !ready(state, 'bid', 5) || !rng.chance(0.35)) return null;
    const stars = [...club.squad].sort((a, b) => overall(b) - overall(a)).slice(0, 3).filter((q) => canSell(state, q.id).ok && !saleFor(state, q.id) && !isInjured(q));
    if (!stars.length) return null;
    p = stars[rng.int(stars.length)];
    coins = round10(playerValue(p) * (1.25 + rng.next() * 0.35));
    to = randomClubSeed(rng, 60).name;
  }
  if (!p || !canSell(state, p.id).ok || coins <= 0) return null;
  mark(state, 'bid');
  const amb = hasTrait(p, 'ambitious');
  const loyal = hasTrait(p, 'loyal');
  const keep: EventChoice = amb
    ? { label: 'NOT FOR SALE', hint: 'HE STAYS, BUT HE WANTED THE MOVE', say: `You turned down ${fmt(coins)} from ${to} for ${p.name}. He is not pleased`, tone: 'info', fx: [{ t: 'morale', who: p.id, d: -10 }] }
    : { label: 'NOT FOR SALE', hint: loyal ? 'HE STAYS, AND IS GLAD TO' : 'HE STAYS, THE FANS LOVE IT', say: `You turned down ${fmt(coins)} from ${to} for ${p.name}`, tone: 'good', fx: [{ t: 'morale', who: p.id, d: loyal ? 6 : 2 }, { t: 'morale', who: 'xi', d: 1 }] };
  const choices: EventChoice[] = [
    { label: `SELL FOR ${fmt(coins)}`, hint: 'HE LEAVES NOW, SQUAD MORALE DOWN', say: `${p.name} was sold to ${to} for ${fmt(coins)}`, tone: 'info', fx: [{ t: 'sell', who: p.id, coins, to }, { t: 'morale', who: 'xi', d: -2 }] },
    keep,
  ];
  if (!again) {
    choices.push({ label: 'ASK FOR MORE', hint: 'HE STAYS FOR NOW, THEY MAY OFFER 20% MORE', say: `You asked ${to} for more for ${p.name}`, tone: 'info', fx: [{ t: 'rebid', who: p.id, coins: round10(coins * 1.2), to }] });
  }
  return card(state, 'bid', again ? 'THEY ARE BACK' : 'A BID FOR YOUR STAR', `${to} offer ${fmt(coins)} coins for ${last(p.name)}.`, [p.id], choices);
}

/** The board is nervous: a pledge to make. Never a sacking. */
function ultimatumCard(state: CareerState): EventCard | null {
  if (state.board.confidence > 30 || state.events.pledge || !ready(state, 'ultimatum', 12)) return null;
  const left = MATCHDAYS - (state.season?.matchday ?? 0);
  if (left < 4) return null;
  mark(state, 'ultimatum');
  const prize = 150 + 40 * step(state);
  return card(state, 'ultimatum', 'THE BOARD WANTS RESULTS', 'The board is nervous about how the season is going. They want to hear a plan.', [], [
    { label: '2 WINS IN THE NEXT 4', hint: `DO IT: +15 CONFIDENCE, +${fmt(prize)} COINS`, say: 'You promised the board two wins in four', tone: 'info', fx: [{ t: 'pledge', wins: 2, within: 4, coins: prize, board: 15, fail: 8 }] },
    { label: 'ASK FOR TIME', hint: '1 WIN IN 4: +8 CONFIDENCE', say: 'You asked the board for time', tone: 'info', fx: [{ t: 'pledge', wins: 1, within: 4, coins: 0, board: 8, fail: 4 }] },
    { label: 'TRUST THE KIDS', hint: 'CALM FOR NOW, NO REWARD', say: 'You told the board the young players will come good', tone: 'info', fx: [{ t: 'board', d: 3 }, { t: 'morale', who: 'young', d: 5 }] },
  ]);
}

function protestCard(state: CareerState): EventCard | null {
  const f = state.story.form;
  if (f.length < 3 || f.slice(-3).some((x) => x !== 'L') || !ready(state, 'protest', 10)) return null;
  mark(state, 'protest');
  const cost = 60 + 20 * step(state);
  return card(state, 'protest', 'THE FANS ARE GRUMBLING', 'Three defeats in a row. A few fans are waiting outside the ground with questions.', [], [
    { label: 'MEET THE FANS', hint: 'THEY GET BEHIND YOU AGAIN', say: 'You met the fans after three defeats. They are behind the team', tone: 'good', fx: [{ t: 'fans', d: 1, left: 2 }, { t: 'morale', who: 'all', d: 3 }] },
    { label: 'CHEAP TICKETS', hint: 'A FULL HOUSE FOR 3 HOME GAMES', coins: cost, say: 'Cheap tickets brought the fans back', tone: 'good', fx: [{ t: 'fans', d: 2, left: 3 }, { t: 'morale', who: 'all', d: 2 }] },
    { label: 'KEEP WORKING', hint: 'QUIET STANDS FOR 2 HOME GAMES', say: 'You asked the fans to be patient. The stands are quiet', tone: 'bad', fx: [{ t: 'fans', d: -1, left: 2 }] },
  ]);
}

function festivalCard(state: CareerState): EventCard | null {
  const f = state.story.form;
  if (f.length < 4 || f.slice(-4).some((x) => x !== 'W') || !ready(state, 'festival', 10)) return null;
  mark(state, 'festival');
  const coins = 80 + 30 * step(state);
  return card(state, 'festival', 'THE TOWN IS BUZZING', 'Four wins in a row! The whole town wants to celebrate with the team.', [], [
    { label: 'OPEN TRAINING DAY', hint: 'MORALE UP, FULLER STANDS', say: 'An open training day for the fans after four wins', tone: 'good', fx: [{ t: 'morale', who: 'all', d: 6 }, { t: 'fans', d: 1, left: 2 }] },
    { label: 'FAN DAY SALE', hint: `+${fmt(coins)} COINS`, say: `A fan day at the ground raised ${fmt(coins)} coins`, tone: 'good', fx: [{ t: 'coins', d: coins }, { t: 'fans', d: 1, left: 1 }] },
    { label: 'A DAY OFF', hint: 'A BIG LIFT FOR THE SQUAD', say: 'The squad got a day off after four wins', tone: 'good', fx: [{ t: 'morale', who: 'all', d: 9 }] },
  ]);
}

/** A sponsor wants the shirt (whenever you have none): every match, a win bonus, or cash now. */
function sponsorCard(state: CareerState, rng: Rng): EventCard | null {
  if (state.events.sponsor || !ready(state, 'sponsor', 3) || state.events.played < 1) return null;
  mark(state, 'sponsor');
  const name = rng.pick(SPONSORS);
  const base = round10((20 + 12 * step(state)) * sponsorMult(state));
  const win = round10(base * 2.2);
  const now = round10(base * 8);
  const n = SPONSOR_LENGTH;
  return card(state, 'sponsor', 'A SPONSOR CALLS', `${name} want their name on your shirts. Which deal do you take?`, [], [
    { label: 'EVERY MATCH', hint: `+${fmt(base)} A LEAGUE MATCH FOR ${n}`, say: `${name} sponsor the club: ${fmt(base)} coins a match`, tone: 'good', fx: [{ t: 'sponsor', name, pay: 'match', amount: base, left: n }] },
    { label: 'WIN BONUS', hint: `+${fmt(win)} A LEAGUE WIN FOR ${n}`, say: `${name} sponsor the club: ${fmt(win)} coins a win`, tone: 'good', fx: [{ t: 'sponsor', name, pay: 'win', amount: win, left: n }] },
    { label: 'CASH NOW', hint: `+${fmt(now)} COINS TODAY`, say: `${name} paid ${fmt(now)} coins for a one off deal`, tone: 'good', fx: [{ t: 'coins', d: now }] },
  ]);
}

/** A veteran offers to take a youngster under his wing (once mentors are open). */
function mentorCard(state: CareerState, rng: Rng): EventCard | null {
  const club = state.club!;
  if (!state.events.open.includes('mentors') || !ready(state, 'mentor', 6) || !rng.chance(0.6)) return null;
  const kid = club.squad.filter((p) => playerAge(p) <= 21 && !mentorOf(club, p)).sort((a, b) => overall(b) - overall(a))[0];
  const vet = kid ? club.squad.filter((v) => canMentor(v, kid) && !pupilOf(club, v)).sort((a, b) => overall(b) - overall(a))[0] : undefined;
  if (!kid || !vet) return null;
  mark(state, 'mentor');
  return card(state, 'mentor', 'A WORD FROM A VETERAN', `${last(vet.name)} (${playerAge(vet)}) offers to take ${last(kid.name)} (${playerAge(kid)}) under his wing.`, [kid.id, vet.id], [
    { label: 'YES, TEACH HIM', hint: 'HE LEARNS 25% FASTER, AND A TRAIT', say: `${vet.name} is mentoring ${kid.name}`, tone: 'good', fx: [{ t: 'mentor', kid: kid.id, vet: vet.id }, { t: 'morale', who: kid.id, d: 4 }] },
    { label: 'NOT NOW', hint: 'NOTHING CHANGES', say: `${kid.name} trains on his own for now`, tone: 'info', fx: [] },
  ]);
}

function trainingCard(state: CareerState): EventCard {
  return card(state, 'training', 'A FREE AFTERNOON', 'The training ground is free this afternoon. Who gets the extra session?', [], [
    { label: 'THE DEFENCE', hint: 'XP FOR KEEPERS AND DEFENDERS', say: 'An extra session for the defence', tone: 'good', fx: [{ t: 'xp', who: 'DF', d: 30 }, { t: 'xp', who: 'GK', d: 30 }] },
    { label: 'THE MIDFIELD', hint: 'XP FOR THE MIDFIELDERS', say: 'An extra session for the midfield', tone: 'good', fx: [{ t: 'xp', who: 'MF', d: 30 }] },
    { label: 'THE ATTACK', hint: 'XP FOR THE FORWARDS', say: 'An extra session for the attack', tone: 'good', fx: [{ t: 'xp', who: 'FW', d: 30 }] },
  ]);
}

function communityCard(state: CareerState): EventCard {
  return card(state, 'community', 'A SCHOOL VISIT', 'The local school asks if the players can come and say hello.', [], [
    { label: 'SEND EVERYONE', hint: 'MORALE UP, FULLER STANDS', say: 'The whole squad visited the local school', tone: 'good', fx: [{ t: 'morale', who: 'all', d: 3 }, { t: 'fans', d: 1, left: 1 }] },
    { label: 'SEND THE KIDS', hint: 'THE YOUNG PLAYERS LOVE IT', say: 'The young players visited the local school', tone: 'good', fx: [{ t: 'morale', who: 'young', d: 7 }] },
  ]);
}

/** An academy graduate scores in a win: the story the owner asked for. Once per player. */
export function youthCard(state: CareerState, scorerIds: readonly string[], my: number, their: number, vs: string): boolean {
  const club = state.club;
  if (!club || my <= their) return false;
  const hero = club.squad.find((p) => scorerIds.includes(p.id) && (p as LifePlayer).academy === true && playerAge(p) <= 21 && state.events.last[`youth:${p.id}`] === undefined);
  if (!hero) return false;
  mark(state, `youth:${hero.id}`);
  const winner = my - their === 1;
  const text = `${last(hero.name)} (${playerAge(hero)}), from your own academy, scored ${winner ? 'the winner' : 'in the win'} against ${vs}!`;
  addMoment(state, { kind: 'academy', icon: 'star', title: 'ACADEMY HERO', text: `${hero.name.toUpperCase()} SCORES ${winner ? 'THE WINNER' : 'FOR THE FIRST TEAM'}` });
  addTimeline(state, `Academy graduate ${hero.name} scored ${winner ? 'the winner' : 'in a win'} against ${vs}`, 'star', 'good', true);
  return push(state, card(state, 'youth', 'ACADEMY HERO', text, [hero.id], [
    { label: 'KEEP HIM IN THE TEAM', hint: 'PROMISE: START HIM AGAIN SOON', say: `${hero.name} keeps his place after his big day`, tone: 'good', fx: [{ t: 'morale', who: hero.id, d: 10 }, { t: 'xp', who: hero.id, d: 30 }, { t: 'promise', who: hero.id, within: 2 }] },
    { label: 'FEET ON THE GROUND', hint: 'EXTRA TRAINING: HE LEARNS FAST', say: `${hero.name} was sent straight back to work`, tone: 'info', fx: [{ t: 'xp', who: hero.id, d: 70 }] },
    { label: 'A NEW CONTRACT', hint: '+3 YEARS, AND HE TURNS LOYAL', coins: round10(wageOf(hero) * 2), say: `${hero.name} signed a new deal with his boyhood club`, tone: 'good', fx: [{ t: 'renew', who: hero.id, years: 3 }, { t: 'trait', who: hero.id, trait: 'loyal' }, { t: 'morale', who: hero.id, d: 6 }] },
  ]));
}

/**
 * After a league matchday: at most one new card, the first that the club's real state calls for (the press before a
 * big match, the board, a club coming back with more, a contract, a bid, an unhappy player, a row, the fans, a
 * sponsor, a mentor), else a small one when it has been quiet for QUIET_MAX matchdays. Seeded by the matchday.
 */
export function rollEvents(state: CareerState, res: { my: number; their: number }, next?: NextMatch | null): EventCard | null {
  const season = state.season;
  const club = state.club;
  const ev = state.events;
  if (!season || !club || state.summary || ev.queue.length >= QUEUE_MAX) return null;
  const before = ev.queue.length;
  if (rollPress(state, next)) return ev.queue[ev.queue.length - 1];
  const rng = new Rng(hashString(`${state.seed}|ev|${season.number}|${season.matchday}`));
  const again = ev.rebid;
  ev.rebid = null;
  const makers: (() => EventCard | null)[] = [
    () => ultimatumCard(state),
    () => {
      if (!again) return null;
      // They said they might come back: six times in ten they do, with what you asked for.
      if (rng.chance(0.6)) return bidCard(state, rng, again);
      addTimeline(state, `${again.to} walked away from the deal`, 'swap', 'info');
      return null;
    },
    // (A sponsor before anything else that can wait: a career's first card is a good one.)
    () => sponsorCard(state, rng),
    () => contractCard(state),
    () => bidCard(state, rng),
    () => benchCard(state),
    () => (ready(state, 'clash', 9) ? clashCard(state, rng, res.my < res.their) : null),
    () => protestCard(state),
    () => festivalCard(state),
    () => mentorCard(state, rng),
    () => {
      if (!ready(state, 'any', QUIET_MAX)) return null;
      const pick = (ev.last.filler ?? 0) % 2 === 0;
      return pick ? trainingCard(state) : communityCard(state);
    },
  ];
  for (const make of makers) {
    const c = make();
    if (!c) continue;
    if (c.kind === 'clash') mark(state, 'clash');
    if (c.kind === 'training' || c.kind === 'community') ev.last.filler = (ev.last.filler ?? 0) + 1;
    push(state, c);
    break;
  }
  return ev.queue.length > before ? ev.queue[ev.queue.length - 1] : null;
}

// ------------------------------------------------------------------ the running things, matchday by matchday

/**
 * A league matchday for everything an answer set running: the sponsor pays, the pledge to the board counts the win
 * (met: confidence and coins, with a moment; out of time: confidence drops, nothing worse), promised starts are kept
 * or broken, the fans' mood wears off at home. `started`: the squad ids who started.
 */
export function tickEvents(state: CareerState, wallet: Wallet, res: { my: number; their: number; home: boolean; derby: boolean }, started: ReadonlySet<string>): void {
  const ev = state.events;
  const club = state.club;
  if (!club) return;
  const won = res.my > res.their;
  const sp = ev.sponsor;
  if (sp) {
    const pay = sp.pay === 'match' || won ? sp.amount : 0;
    wallet.coins += pay;
    sp.paid += pay;
    sp.left--;
    if (sp.left <= 0) {
      addTimeline(state, `The ${sp.name} deal ended: it paid ${fmt(sp.paid)} coins`, 'coin', 'info');
      ev.sponsor = null;
    }
  }
  const pl = ev.pledge;
  if (pl) {
    if (won) pl.have++;
    if (pl.have >= pl.wins) {
      state.board.confidence = clamp(state.board.confidence + pl.board, 0, 100);
      state.board.owed += pl.coins;
      addMoment(state, { kind: 'board', icon: 'star', title: 'PROMISE KEPT', text: 'THE BOARD GOT THE WINS YOU PROMISED', ...(pl.coins ? { coins: pl.coins } : {}) });
      addTimeline(state, 'You kept your promise to the board', 'star', 'good', true);
      ev.pledge = null;
    } else if (ev.clock >= pl.until) {
      state.board.confidence = clamp(state.board.confidence - pl.fail, 0, 100);
      addTimeline(state, 'The wins you promised the board did not come', 'clock', 'bad', true);
      ev.pledge = null;
    }
  }
  const keep: MinutesPromise[] = [];
  for (const pr of ev.promises) {
    const p = club.squad.find((q) => q.id === pr.who);
    if (!p) continue;
    if (started.has(p.id)) {
      addMorale(p, PROMISE_KEPT);
      addTimeline(state, `Promise kept: ${p.name} started`, 'shirt', 'good');
    } else if (ev.clock >= pr.by) {
      addMorale(p, PROMISE_BROKEN);
      for (const q of club.squad) if (q.id !== p.id) addMorale(q, -1);
      addTimeline(state, `Promise broken: ${p.name} did not get his start`, 'shirt', 'bad', true);
    } else keep.push(pr);
  }
  ev.promises = keep;
  if (ev.fans && res.home) {
    ev.fans.left--;
    if (ev.fans.left <= 0) ev.fans = null;
  }
  if (res.derby) ev.rivalFire = 0;
}

/** Any match of yours is over (league or cup): the vow you made to the press is settled, the team talk is spent. */
export function afterAnyMatch(state: CareerState, won: boolean): void {
  const ev = state.events;
  ev.played = Math.min(1e6, ev.played + 1);
  ev.talk = false;
  if (ev.vow) {
    state.board.confidence = clamp(state.board.confidence + (won ? ev.vow.win : -ev.vow.lose), 0, 100);
    addTimeline(state, won ? 'You said you would win it, and you did' : 'You said you would win it. The board noticed', 'chat', won ? 'good' : 'bad', true);
    ev.vow = null;
  }
}

/** How much fuller (or emptier) the stands are at home, as a share of attendance (-0.1 .. +0.2). */
export function fanAttendance(state: CareerState): number {
  return (state.events?.fans?.d ?? 0) * 0.1;
}

/** The squad's captain says goodbye when his contract runs out and he was told it would not be renewed. */
export function leavers(state: CareerState): PlayerDef[] {
  return (state.club?.squad ?? []).filter((p) => grow(p).leaving === true);
}

/** One tap: pair every youngster with a free veteran (meta/growth.ts), with the story. Returns the pairs made. */
export function assignMentors(state: CareerState): number {
  if (!state.club) return 0;
  const pairs = autoMentors(state.club);
  for (const { kid, vet } of pairs) addTimeline(state, `${vet.name} is mentoring ${kid.name}`, 'duo', 'good');
  return pairs.length;
}

/** The captain (for cards that name him). */
export function captainName(state: CareerState): string {
  const c = state.club ? captainOf(state.club) : undefined;
  return c ? c.name : 'the captain';
}

// ------------------------------------------------------------------ save

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const int = (v: unknown, lo: number, hi: number, d: number) => (isNum(v) ? clamp(Math.round(v), lo, hi) : d);
const TONES: Tone[] = ['good', 'bad', 'info'];
const KINDS: EventKind[] = ['press', 'injury', 'bench', 'clash', 'contract', 'bid', 'youth', 'ultimatum', 'protest', 'festival', 'sponsor', 'mentor', 'training', 'community'];
const tone = (v: unknown): Tone => (TONES.includes(v as Tone) ? (v as Tone) : 'info');
const id = (v: unknown): string => (isStr(v) ? v.slice(0, 16) : '');

function readFx(v: unknown): Fx | null {
  if (!isObj(v) || !isStr(v.t)) return null;
  const n = (x: unknown, lo: number, hi: number) => int(x, lo, hi, 0);
  switch (v.t) {
    case 'morale': return { t: 'morale', who: id(v.who), d: n(v.d, -100, 100) };
    case 'coins': return { t: 'coins', d: n(v.d, 0, 1e7) };
    case 'board': return { t: 'board', d: n(v.d, -100, 100) };
    case 'rival': return { t: 'rival', d: n(v.d, -1, 2) };
    case 'heal': return { t: 'heal', who: id(v.who), d: n(v.d, 0, 99) };
    case 'promise': return { t: 'promise', who: id(v.who), within: n(v.within, 1, 14) };
    case 'list': return { t: 'list', who: id(v.who) };
    case 'sell': return { t: 'sell', who: id(v.who), coins: n(v.coins, 0, 1e9), to: isStr(v.to) ? v.to.slice(0, 40) : '' };
    case 'renew': return { t: 'renew', who: id(v.who), years: n(v.years, 1, 4) };
    case 'leave': return { t: 'leave', who: id(v.who) };
    case 'xp': return { t: 'xp', who: id(v.who), d: n(v.d, 0, 500) };
    case 'trait': return TRAITS.includes(v.trait as TraitId) ? { t: 'trait', who: id(v.who), trait: v.trait as TraitId } : null;
    case 'sponsor': return { t: 'sponsor', name: isStr(v.name) ? v.name.slice(0, 24) : 'SPONSOR', pay: v.pay === 'win' ? 'win' : 'match', amount: n(v.amount, 0, 1e6), left: n(v.left, 1, 40) };
    case 'pledge': return { t: 'pledge', wins: n(v.wins, 1, 14), within: n(v.within, 1, 14), coins: n(v.coins, 0, 1e6), board: n(v.board, 0, 100), fail: n(v.fail, 0, 100) };
    case 'fans': return { t: 'fans', d: n(v.d, -1, 2), left: n(v.left, 1, 14) };
    case 'vow': return { t: 'vow', win: n(v.win, 0, 100), lose: n(v.lose, 0, 100) };
    case 'rebid': return { t: 'rebid', who: id(v.who), coins: n(v.coins, 0, 1e9), to: isStr(v.to) ? v.to.slice(0, 40) : '' };
    case 'mentor': return { t: 'mentor', kid: id(v.kid), vet: id(v.vet) };
    default: return null;
  }
}

function readCard(v: unknown): EventCard | null {
  if (!isObj(v) || !isStr(v.id) || !KINDS.includes(v.kind as EventKind) || !isStr(v.title) || !isStr(v.text) || !Array.isArray(v.choices)) return null;
  const choices: EventChoice[] = [];
  for (const c of v.choices.slice(0, 3)) {
    if (!isObj(c) || !isStr(c.label) || !Array.isArray(c.fx)) continue;
    const out: EventChoice = {
      label: c.label.slice(0, 40), hint: isStr(c.hint) ? c.hint.slice(0, 60) : '', say: isStr(c.say) ? c.say.slice(0, 140) : '', tone: tone(c.tone),
      fx: c.fx.map(readFx).filter((f): f is Fx => !!f).slice(0, 6),
    };
    if (isNum(c.coins) && c.coins > 0) out.coins = int(c.coins, 0, 1e7, 0);
    if (isNum(c.gems) && c.gems > 0) out.gems = int(c.gems, 0, 1e5, 0);
    choices.push(out);
  }
  // Never a card without a free answer (a damaged one is dropped: the rule that keeps the game winnable).
  if (choices.length < 2 || !choices.some((c) => !c.coins && !c.gems)) return null;
  return {
    id: v.id.slice(0, 16), kind: v.kind as EventKind, season: int(v.season, 0, 1e6, 0), md: int(v.md, 0, 99, 0),
    title: v.title.slice(0, 40), text: v.text.slice(0, 200), icon: isStr(v.icon) ? v.icon.slice(0, 16) : EVENT_ICON[v.kind as EventKind],
    who: Array.isArray(v.who) ? v.who.filter(isStr).slice(0, 2).map((s) => s.slice(0, 16)) : [], choices,
  };
}

export function readEvents(v: unknown): EventsState {
  const e = defaultEvents();
  if (!isObj(v)) return e;
  if (Array.isArray(v.queue)) e.queue = v.queue.map(readCard).filter((c): c is EventCard => !!c).slice(0, QUEUE_MAX);
  if (Array.isArray(v.timeline)) {
    e.timeline = v.timeline
      .filter((t): t is Obj => isObj(t) && isStr(t.text))
      .slice(0, TIMELINE_MAX)
      .map((t) => {
        const out: TimelineEntry = { s: int(t.s, 0, 1e6, 0), md: int(t.md, 0, 99, 0), text: (t.text as string).slice(0, 140), icon: isStr(t.icon) ? t.icon.slice(0, 16) : 'ball', tone: tone(t.tone) };
        if (t.big === true) out.big = true;
        return out;
      });
  }
  if (isObj(v.last)) for (const [k, n] of Object.entries(v.last).slice(0, 160)) if (isNum(n)) e.last[k.slice(0, 60)] = int(n, -1e6, 1e7, 0);
  e.clock = int(v.clock, 0, 1e7, 0);
  e.played = int(v.played, 0, 1e6, 0);
  if (Array.isArray(v.open)) e.open = [...new Set(v.open.filter(isStr).map((s) => s.slice(0, 20)))].slice(0, 20);
  e.rivalFire = int(v.rivalFire, -1, 2, 0);
  e.talk = v.talk === true;
  e.talkAt = int(v.talkAt, 0, 1e7, 0);
  if (Array.isArray(v.promises)) {
    e.promises = v.promises
      .filter((p): p is Obj => isObj(p) && isStr(p.who) && isNum(p.by))
      .slice(0, 4)
      .map((p) => ({ who: (p.who as string).slice(0, 16), name: isStr(p.name) ? p.name.slice(0, 24) : '', by: int(p.by, 0, 1e7, 0) }));
  }
  const pl = v.pledge;
  if (isObj(pl) && isNum(pl.wins) && isNum(pl.until)) {
    e.pledge = { wins: int(pl.wins, 1, 14, 1), have: int(pl.have, 0, 14, 0), until: int(pl.until, 0, 1e7, 0), coins: int(pl.coins, 0, 1e6, 0), board: int(pl.board, 0, 100, 0), fail: int(pl.fail, 0, 100, 0) };
  }
  const sp = v.sponsor;
  if (isObj(sp) && isStr(sp.name) && isNum(sp.amount)) {
    e.sponsor = { name: sp.name.slice(0, 24), pay: sp.pay === 'win' ? 'win' : 'match', amount: int(sp.amount, 0, 1e6, 0), left: int(sp.left, 1, 40, 1), paid: int(sp.paid, 0, 1e9, 0) };
  }
  if (isObj(v.fans) && isNum(v.fans.d) && v.fans.d !== 0) e.fans = { d: int(v.fans.d, -1, 2, 1), left: int(v.fans.left, 1, 14, 1) };
  if (isObj(v.vow)) e.vow = { win: int(v.vow.win, 0, 100, 0), lose: int(v.vow.lose, 0, 100, 0) };
  if (isObj(v.rebid) && isStr(v.rebid.who)) e.rebid = { who: v.rebid.who.slice(0, 16), coins: int(v.rebid.coins, 0, 1e9, 0), to: isStr(v.rebid.to) ? v.rebid.to.slice(0, 40) : '' };
  e.nextId = int(v.nextId, 1, 1e9, 1);
  return e;
}
