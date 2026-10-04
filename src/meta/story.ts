/**
 * The season's story (the emotional journey): a recurring named RIVAL who follows you up the divisions and talks in
 * the NEWS, the story tag on the next match (DERBY DAY, TITLE DECIDER, SURVIVAL BATTLE...), the recent form, and the
 * queue of big moments the ROAD TO GLORY hub shows one at a time (an objective done, a milestone, a new stand open, a
 * legacy level). Pure rules and state; the screens are ui/career.ts.
 *
 * Runtime import cycle with career.ts (through market.ts): bindings are only used inside functions.
 */
import { hashString } from '../core/rng';
import { MATCHDAYS, TOP_DIVISION, BOTTOM_DIVISION, CLUBS_PER_DIVISION, YOU, leagueTable, type CareerState, type LeagueClub, type NextMatch } from './career';
import { pushNews, townOf, type NewsKind } from './market';
import type { FormationId, Kit } from '../sim/types';

/** The club that has it in for you: who they are, and how the derbies have gone. */
export interface RivalIdentity {
  name: string;
  short: string;
  kit: Kit;
  formation: FormationId;
  /** Derbies played, won, drawn and lost (yours). */
  met: number;
  won: number;
  drawn: number;
  lost: number;
}

export type MomentKind = 'board' | 'milestone' | 'build' | 'legacy' | 'record' | 'farewell' | 'trophy' | 'academy' | 'rival';

/** One big moment for the hub to show (a stamp card, then it's gone). */
export interface StoryMoment {
  kind: MomentKind;
  title: string;
  text: string;
  /** Coins it paid (already in the wallet, or paid with the moment: see board.ts). */
  coins?: number;
  /** Pixel icon. */
  icon: string;
}

export type FormMark = 'W' | 'D' | 'L';

export interface StoryState {
  rival: RivalIdentity | null;
  /** Moments waiting to be shown (oldest first). */
  moments: StoryMoment[];
  /** The last results in every competition, oldest first (morale reads the last three). */
  form: FormMark[];
  /** Story beats already told this season ("s3:derby-before"), so the news never says it twice. */
  fired: string[];
}

export const MOMENTS_MAX = 6;
export const FORM_MAX = 5;

export function defaultStory(): StoryState {
  return { rival: null, moments: [], form: [], fired: [] };
}

/** Queue a moment for the hub (the oldest go first when too many wait). */
export function addMoment(state: CareerState, m: StoryMoment): void {
  state.story.moments = [...state.story.moments, m].slice(-MOMENTS_MAX);
}

/** The next moment to show, taken off the queue. */
export function takeMoment(state: CareerState): StoryMoment | null {
  return state.story.moments.shift() ?? null;
}

export function addForm(state: CareerState, my: number, their: number, won?: boolean): void {
  const mark: FormMark = my > their || (my === their && won === true) ? 'W' : my === their && won === undefined ? 'D' : 'L';
  state.story.form = [...state.story.form, mark].slice(-FORM_MAX);
}

/** Tell a beat once per season: false (and nothing happens) when it was already told. */
function once(state: CareerState, key: string): boolean {
  const k = `s${state.season?.number ?? 0}:${key}`;
  if (state.story.fired.includes(k)) return false;
  state.story.fired = [...state.story.fired, k].slice(-40);
  return true;
}

function pick<T>(list: readonly T[], seed: string): T {
  return list[hashString(seed) % list.length];
}

export function storyNews(state: CareerState, text: string, kind: NewsKind = 'info'): void {
  pushNews(state, text, kind, false, true);
}

// ------------------------------------------------------------------ the rival

const TAUNT_START = [
  '{R} say they will finish above {Y} again this season',
  '{R} fans have already circled the derby on the calendar',
  '{R} boss: the derby against {Y} is the only date that matters',
];
const TAUNT_BEFORE = [
  'Derby day next! {R} say {Y} are no match for them',
  '{R} have been practising all week for the derby',
  'The whole town is talking about {Y} against {R}',
];
const DERBY_WON = ['{Y} win the derby! {R} fans go very quiet', 'Bragging rights to {Y}: {R} lose the derby', '{R} sulk after losing the derby to {Y}'];
const DERBY_DRAWN = ['Honours even in the derby between {Y} and {R}', '{Y} and {R} share the points in a tense derby'];
const DERBY_LOST = ['{R} win the derby and will not stop singing about it', '{R} take the derby. {Y} want revenge next time'];

function say(state: CareerState, lines: readonly string[], key: string, kind: NewsKind): void {
  const r = state.story.rival;
  const club = state.club;
  if (!r || !club || !once(state, key)) return;
  const text = pick(lines, `${state.seed}|${state.season?.number ?? 0}|${key}`).replace('{R}', townOf(r.name)).replace('{Y}', club.name);
  storyNews(state, text, kind);
}

/**
 * Bring the rival into this season's league (called by newSeason before the cup draw): on the first season the
 * strongest club but one becomes your rival; after that the same club follows you to whatever division you are in,
 * taking a league slot (its strength stays that of the slot, so a rival is never a walkover or a wall). Returns the
 * rival's league id, or undefined.
 */
export function placeRival(state: CareerState, rivals: LeagueClub[]): string | undefined {
  if (!rivals.length) return undefined;
  const story = state.story;
  const byLevel = [...rivals].sort((a, b) => b.level - a.level || (a.id < b.id ? -1 : 1));
  if (!story.rival) {
    const c = byLevel[Math.min(1, byLevel.length - 1)];
    story.rival = { name: c.name, short: c.short, kit: { ...c.kit }, formation: c.formation, met: 0, won: 0, drawn: 0, lost: 0 };
    return c.id;
  }
  const r = story.rival;
  // Its slot: a club already wearing its name or code (so no club appears twice), else the second strongest.
  const target =
    rivals.find((c) => c.name.toLowerCase() === r.name.toLowerCase() || c.short === r.short) ??
    byLevel[Math.min(1, byLevel.length - 1)];
  // (Nobody else in the league may share its name or short code.)
  if (rivals.some((c) => c !== target && (c.short === r.short || c.name.toLowerCase() === r.name.toLowerCase()))) return target.id;
  Object.assign(target, { name: r.name, short: r.short, kit: { ...r.kit }, formation: r.formation });
  return target.id;
}

/** Is this league rival your rival (the derby)? (newSeason recomputes the slot's rating after placeRival.) */
export function isDerby(state: CareerState, rivalId: string): boolean {
  return !!state.season?.derby && state.season.derby === rivalId;
}

/** The season opens: the rival's first jibe. */
export function seasonStartBeats(state: CareerState): void {
  if (state.season?.derby) say(state, TAUNT_START, 'rival-start', 'info');
}

/** Before the next match: derby build-up. */
export function beforeMatchBeats(state: CareerState, nm: NextMatch | null): void {
  if (nm && nm.competition === 'league' && isDerby(state, nm.rival.id)) say(state, TAUNT_BEFORE, `derby-before-${nm.md}`, 'info');
}

/** A derby was just played (league): the head to head and the news. */
export function derbyResult(state: CareerState, my: number, their: number): void {
  const r = state.story.rival;
  if (!r) return;
  r.met++;
  if (my > their) r.won++;
  else if (my === their) r.drawn++;
  else r.lost++;
  const key = `derby-${r.met}`;
  if (my > their) say(state, DERBY_WON, key, 'good');
  else if (my === their) say(state, DERBY_DRAWN, key, 'info');
  else say(state, DERBY_LOST, key, 'bad');
}

// ------------------------------------------------------------------ the story tag on the next match

export interface StoryTag {
  /** Short chip: "DERBY DAY", "TITLE DECIDER". */
  tag: string;
  /** One line under it: "WIN AND THE TITLE IS YOURS". */
  line: string;
  tone: 'hot' | 'gold' | 'danger';
}

/** What makes the next match special (a derby, a decider, a scrap at the bottom), or null for an ordinary one. */
export function storyTag(state: CareerState, nm: NextMatch | null): StoryTag | null {
  const season = state.season;
  if (!nm || !season) return null;
  if (nm.competition !== 'league') return null;
  const table = leagueTable(state);
  const me = table.findIndex((r) => r.id === YOU);
  if (me < 0) return null;
  const pts = (i: number) => table[i]?.PTS ?? 0;
  const myPts = pts(me);
  const left = MATCHDAYS - season.matchday;
  const last = left === 1;
  const derby = isDerby(state, nm.rival.id);
  const gapTop = pts(0) - myPts;
  // The last matchday's deciders come first: the title, promotion, survival.
  if (last) {
    if (me === 0 && myPts - pts(1) <= 3) return { tag: 'TITLE DECIDER', line: myPts - pts(1) > 0 ? 'WIN AND THE TITLE IS YOURS' : 'WIN TO LIFT THE TITLE', tone: 'gold' };
    if (me > 0 && gapTop <= 3) return { tag: 'TITLE DECIDER', line: 'WIN AND HOPE THE LEADERS SLIP', tone: 'gold' };
    if (season.division > TOP_DIVISION && me <= 3 && Math.abs(pts(1) - myPts) <= 3) return { tag: 'PROMOTION DECIDER', line: me <= 1 ? 'WIN AND YOU GO UP' : 'WIN TO CHASE PROMOTION', tone: 'gold' };
    if (season.division < BOTTOM_DIVISION && me >= CLUBS_PER_DIVISION - 2 && pts(CLUBS_PER_DIVISION - 3) - myPts <= 3) return { tag: 'SURVIVAL BATTLE', line: 'WIN TO STAY UP', tone: 'danger' };
  }
  // Then the derby, whenever it comes.
  if (derby) {
    const r = state.story.rival;
    const h2h = r && r.met ? `${r.won}W ${r.drawn}D ${r.lost}L IN DERBIES` : 'THE FIRST DERBY';
    return { tag: 'DERBY DAY', line: h2h, tone: 'hot' };
  }
  // The run in: a title race, a relegation scare.
  if (season.matchday >= 3 && !last) {
    if (season.division < BOTTOM_DIVISION && me >= CLUBS_PER_DIVISION - 2 && pts(CLUBS_PER_DIVISION - 3) - myPts <= 3 * left) return { tag: 'RELEGATION SCARE', line: 'POINTS NEEDED TO STAY UP', tone: 'danger' };
    if (left <= 3 && me <= 2 && gapTop <= 3) return { tag: 'TITLE RACE', line: me === 0 ? 'STAY AHEAD OF THE PACK' : `${gapTop} POINTS OFF THE TOP`, tone: 'gold' };
  }
  return null;
}

/** A cup run in the NEWS: headlines when you go through, and when the run ends. */
export function cupHeadline(state: CareerState, comp: string, round: string, won: boolean, trophy: boolean): void {
  const club = state.club;
  if (!club) return;
  const key = `cup-${comp}-${round}-${won ? 'w' : 'l'}`;
  if (!once(state, key)) return;
  const text = trophy ? `${club.name} win the ${comp}! A night the fans will never forget` : won ? `Cup run! ${club.name} are through the ${comp} ${round.toLowerCase()}` : `${club.name} are out of the ${comp} after the ${round.toLowerCase()}`;
  storyNews(state, text, won ? 'good' : 'bad');
}

// ------------------------------------------------------------------ save

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const MOMENT_KINDS: MomentKind[] = ['board', 'milestone', 'build', 'legacy', 'record', 'farewell', 'trophy', 'academy', 'rival'];
const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(9999, Math.round(v))) : 0);

export function readStory(v: unknown, readKit: (x: unknown) => Kit | null, readFormation: (x: unknown) => FormationId | null): StoryState {
  const s = defaultStory();
  if (!isObj(v)) return s;
  const r = v.rival;
  if (isObj(r) && typeof r.name === 'string' && typeof r.short === 'string') {
    const kit = readKit(r.kit);
    const formation = readFormation(r.formation);
    if (kit && formation) {
      s.rival = { name: r.name.slice(0, 40), short: r.short.slice(0, 3), kit, formation, met: count(r.met), won: count(r.won), drawn: count(r.drawn), lost: count(r.lost) };
    }
  }
  if (Array.isArray(v.moments)) {
    s.moments = v.moments
      .filter((m): m is Obj => isObj(m) && MOMENT_KINDS.includes(m.kind as MomentKind) && typeof m.title === 'string' && typeof m.text === 'string')
      .slice(-MOMENTS_MAX)
      .map((m) => {
        const out: StoryMoment = { kind: m.kind as MomentKind, title: (m.title as string).slice(0, 60), text: (m.text as string).slice(0, 160), icon: typeof m.icon === 'string' ? m.icon.slice(0, 20) : 'star' };
        if (typeof m.coins === 'number' && Number.isFinite(m.coins)) out.coins = Math.max(0, Math.round(m.coins));
        return out;
      });
  }
  if (Array.isArray(v.form)) s.form = v.form.filter((f): f is FormMark => f === 'W' || f === 'D' || f === 'L').slice(-FORM_MAX);
  if (Array.isArray(v.fired)) s.fired = v.fired.filter((f): f is string => typeof f === 'string').slice(-40);
  return s;
}
