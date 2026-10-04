/**
 * MORALE AND CHEMISTRY, player by player (the owner: "Managing squad chemistry, dealing with unhappy bench players
 * demanding game time").
 *
 * - Every player has MORALE (0..100, steady at 60): results move it, playing moves it up, sitting out moves it down
 *   for a player good enough to expect a game, and event cards and promises move it (meta/events.ts).
 * - The eleven's average is the TEAM MOOD: HIGH lifts the side a point on the pitch, LOW costs it one (life.ts
 *   matchLift, the "+1" on the match card).
 * - PARTNERSHIPS: two men of the same line who have started the last five league games together. A settled eleven
 *   reaches GOOD and STRONG chemistry sooner (life.ts chemistry).
 * - One-tap helpers: ROTATE (the swap that fixes the biggest problem: an injured starter, else the unhappiest man
 *   who deserves a game) and TEAM TALK (a lift for everyone and +1 on the pitch for the next match, every third
 *   matchday).
 *
 * Kept light on purpose: one number per player, shown as an icon on his chip. Pure rules, no DOM.
 * Runtime import cycle with career.ts: bindings from it are only used inside functions.
 */
import { FORMATIONS } from '../sim/formations';
import { overall, type PlayerDef, type Role } from '../sim/types';
import { swapPlayers, type CareerState, type ClubState } from './career';
import { hasTrait, type GrowPlayer } from './growth';
import { morale as formMorale, type Mood } from './life';
import { playerAge } from './market';

export const MORALE_START = 60;
export const MORALE_HIGH = 70;
export const MORALE_LOW = 40;
/** What a league win and a league defeat do to a starter's morale (the rest of the squad feel less of both). */
export const WIN_LIFT = 5;
export const LOSS_DROP = 6;
/** League matchdays on the bench before a player who expects to play starts to mind. */
export const SAT_UNHAPPY = 3;
/** League starts in a row, both men, that make a partnership. */
export const PARTNER_RUN = 5;
/** League matchdays between team talks, and what one is worth to everyone's morale (more with a leader in the eleven). */
export const TALK_COOLDOWN = 3;
export const TALK_LIFT = 6;
export const TALK_LEADER_LIFT = 9;
/** ROTATE never weakens the eleven by more than this many overall points. */
export const ROTATE_MAX_DROP = 4;

const grow = (p: PlayerDef) => p as GrowPlayer;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function moraleOf(p: PlayerDef): number {
  const m = grow(p).mor;
  return typeof m === 'number' && Number.isFinite(m) ? clamp(Math.round(m), 0, 100) : MORALE_START;
}

/** LOW, STEADY or HIGH (the icon on the chip). */
export function moodOf(m: number): Mood {
  return m >= MORALE_HIGH ? 2 : m <= MORALE_LOW ? 0 : 1;
}

export function addMorale(p: PlayerDef, d: number): void {
  grow(p).mor = clamp(Math.round(moraleOf(p) + d), 0, 100);
}

/** Is he out injured (meta/week.ts)? */
export function isInjured(p: PlayerDef): boolean {
  return (grow(p).inj ?? 0) > 0;
}

/** The eleven's average morale. */
export function squadMorale(club: ClubState): number {
  const xi = club.squad.slice(0, 11);
  return xi.length ? Math.round(xi.reduce((s, p) => s + moraleOf(p), 0) / xi.length) : MORALE_START;
}

/**
 * The team's mood: the eleven's average once the players have a morale of their own, else (a save from before, or a
 * season not yet started) the last three results, as it always was.
 */
export function teamMood(state: CareerState): Mood {
  const club = state.club;
  if (!club) return 1;
  if (!club.squad.slice(0, 11).some((p) => typeof grow(p).mor === 'number')) return formMorale(state.story.form);
  return moodOf(squadMorale(club));
}

/**
 * Does he expect to be playing? A starter does; off the bench, a man about as good as the weakest starter in his
 * position (a teenager has to be clearly better). A SUPER SUB is happy where he is.
 */
export function expectsToPlay(club: ClubState, p: PlayerDef): boolean {
  const idx = club.squad.indexOf(p);
  if (idx >= 0 && idx < 11) return true;
  if (hasTrait(p, 'supersub')) return false;
  const xi = club.squad.slice(0, 11);
  const same = xi.filter((q) => q.role === p.role);
  const pool = same.length ? same : xi;
  if (!pool.length) return false;
  const weakest = Math.min(...pool.map(overall));
  return overall(p) >= (playerAge(p) <= 19 ? weakest + 2 : weakest - 1);
}

/**
 * A league matchday's morale: the result (a LEADER in the eleven halves what a defeat costs), playing time (the
 * starters' runs go on, the others' time on the bench does, and it starts to hurt after SAT_UNHAPPY matchdays for a
 * man who expects to play), and a slow drift back towards steady.
 */
export function weekMorale(state: CareerState, my: number, their: number): void {
  const club = state.club;
  if (!club) return;
  const xi = club.squad.slice(0, 11);
  const leader = xi.some((p) => hasTrait(p, 'leader'));
  const res = my > their ? 1 : my === their ? 0 : -1;
  // (Who expects a game is judged on the eleven as it stood, before anyone's numbers move.)
  const wants = new Set(club.squad.filter((p) => expectsToPlay(club, p)).map((p) => p.id));
  club.squad.forEach((p, i) => {
    const g = grow(p);
    const starter = i < 11;
    let d = 0;
    if (res > 0) d += starter ? WIN_LIFT : 2;
    else if (res < 0) d -= leader ? (starter ? LOSS_DROP / 2 : 2) : starter ? LOSS_DROP : 3;
    if (starter) {
      g.run = Math.min(999, Math.round(g.run ?? 0) + 1);
      g.sat = 0;
      d += 1;
    } else if (!isInjured(p)) {
      g.sat = Math.min(99, Math.round(g.sat ?? 0) + 1);
      g.run = 0;
      if (g.sat >= SAT_UNHAPPY && wants.has(p.id)) d -= hasTrait(p, 'hothead') ? 4 : 3;
    } else {
      g.run = 0;
    }
    const m = moraleOf(p);
    if (m > MORALE_START + 2) d -= 1;
    else if (m < MORALE_START - 2) d += 1;
    addMorale(p, d);
  });
}

/** A goal of his in any competition: a small lift. */
export function scorerMorale(club: ClubState, ids: readonly string[]): void {
  for (const id of new Set(ids)) {
    const p = club.squad.find((q) => q.id === id);
    if (p) addMorale(p, 3);
  }
}

// ------------------------------------------------------------------ partnerships

export interface Partnership {
  a: PlayerDef;
  b: PlayerDef;
  role: Role;
}

/** Pairs in the same line of the eleven who have both started the last PARTNER_RUN league games (the best first). */
export function partnerships(club: ClubState): Partnership[] {
  const slots = FORMATIONS[club.formation] ?? FORMATIONS['4-4-2'];
  const out: Partnership[] = [];
  const settled = club.squad.slice(0, 11).map((p, i) => ({ p, role: slots[i]?.role ?? p.role })).filter((x) => (grow(x.p).run ?? 0) >= PARTNER_RUN);
  for (const role of ['DF', 'MF', 'FW'] as Role[]) {
    const line = settled.filter((x) => x.role === role).sort((a, b) => overall(b.p) - overall(a.p));
    for (let i = 0; i + 1 < line.length; i += 2) out.push({ a: line[i].p, b: line[i + 1].p, role });
  }
  return out;
}

/** How settled the eleven is, 0..1: the share of the last eight league games each of them started. */
export function togetherness(club: ClubState): number {
  const xi = club.squad.slice(0, 11);
  if (!xi.length) return 0;
  return xi.reduce((s, p) => s + Math.min(8, grow(p).run ?? 0), 0) / (xi.length * 8);
}

// ------------------------------------------------------------------ ROTATE

export interface RotatePick {
  /** Squad indices: the starter to rest and the man to bring in. */
  out: number;
  in: number;
  why: 'injured' | 'unhappy';
}

/**
 * ROTATE: the one swap that helps most. An injured starter comes out for the best fit man in his position; else the
 * unhappiest fit player who expects a game goes in for the starter in his position with the longest run, as long as
 * the eleven loses no more than ROTATE_MAX_DROP overall points. Null when nothing needs doing.
 */
export function rotateSuggestion(state: CareerState): RotatePick | null {
  const club = state.club;
  if (!club || club.squad.length <= 11) return null;
  const slots = FORMATIONS[club.formation] ?? FORMATIONS['4-4-2'];
  const rest = club.squad.map((p, i) => ({ p, i })).slice(11).filter((x) => !isInjured(x.p));
  for (let i = 0; i < Math.min(11, club.squad.length); i++) {
    if (!isInjured(club.squad[i])) continue;
    const role = slots[i]?.role ?? club.squad[i].role;
    const same = rest.filter((x) => x.p.role === role).sort((a, b) => overall(b.p) - overall(a.p));
    const any = rest.filter((x) => role === 'GK' || x.p.role !== 'GK').sort((a, b) => overall(b.p) - overall(a.p));
    const pick = same[0] ?? any[0];
    if (pick) return { out: i, in: pick.i, why: 'injured' };
  }
  const sad = rest
    .filter((x) => moraleOf(x.p) < 50 && (grow(x.p).sat ?? 0) >= SAT_UNHAPPY && expectsToPlay(club, x.p))
    .sort((a, b) => moraleOf(a.p) - moraleOf(b.p) || overall(b.p) - overall(a.p));
  for (const s of sad) {
    const starters = club.squad
      .slice(0, 11)
      .map((p, i) => ({ p, i }))
      .filter((x) => (slots[x.i]?.role ?? x.p.role) === s.p.role && overall(x.p) - overall(s.p) <= ROTATE_MAX_DROP)
      .sort((a, b) => (grow(b.p).run ?? 0) - (grow(a.p).run ?? 0) || moraleOf(b.p) - moraleOf(a.p));
    if (starters[0]) return { out: starters[0].i, in: s.i, why: 'unhappy' };
  }
  return null;
}

/** Apply ROTATE (the suggestion as it stands now). Returns what it did, or null. */
export function rotate(state: CareerState): RotatePick | null {
  const pick = rotateSuggestion(state);
  if (!pick || !state.club || !swapPlayers(state.club, pick.out, pick.in)) return null;
  return pick;
}

// ------------------------------------------------------------------ TEAM TALK

/** League matchdays until the next team talk (0: ready now). */
export function talkWait(state: CareerState): number {
  return Math.max(0, state.events.talkAt - state.events.clock);
}

/**
 * TEAM TALK: everyone's morale up (more with a LEADER in the eleven) and a point on the pitch for the next match of
 * yours. Ready again after TALK_COOLDOWN league matchdays. Returns the morale it added, or 0 when it isn't ready.
 */
export function teamTalk(state: CareerState): number {
  const club = state.club;
  if (!club || talkWait(state) > 0 || state.events.talk) return 0;
  const lift = club.squad.slice(0, 11).some((p) => hasTrait(p, 'leader')) ? TALK_LEADER_LIFT : TALK_LIFT;
  for (const p of club.squad) addMorale(p, lift);
  state.events.talk = true;
  state.events.talkAt = state.events.clock + TALK_COOLDOWN;
  return lift;
}
