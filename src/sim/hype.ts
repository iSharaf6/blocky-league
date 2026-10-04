/**
 * HYPE: each side's meter, filled by stylish and smart play, and the SUPER SHOT it earns (MatchConfig.hype; the
 * session turns it on for classic matches, online ones too). Everything lives here; the rest of the sim calls in
 * through three one-line hooks, each guarded by the flag (a match without it never reaches this file, so every
 * AI v AI statistic and every lockstep baseline stays bit-identical):
 *
 *   Match.step             -> hypeStep    (the meters, read off the events this step pushed; 'hypeFull')
 *   Match.execute          -> superLaunch (a full side's next open-play shot is a SUPER SHOT: 'superShot')
 *   Match.checkKeeperHands -> superLive   (the keeper's reach is SUPER_REACH of itself, and he can only parry it)
 *
 * What fills it (HYPE_GAIN, out of HYPE_MAX), for whichever side did it, the AI's as much as the human's: a pass
 * that finds a team-mate (more for a one-touch one and for a long chain of them), a man beaten (a wrong-foot, a
 * SKILL move: a PERFECT most), a tackle won, a shot on target (a little for any shot), a block, a save, the
 * woodwork, and the crowd rising while the side keeps the ball in the final third. Defending well (tackles, blocks,
 * saves) is worth as much as attacking, so a side under the cosh can still earn one. Nothing is taken away, and
 * nothing is given for being behind: it is earned in play, the same way for both sides.
 *
 * The super shot: struck at SUPER_PACE (up to SUPER_TOP m/s), aimed on frame with SUPER_ERR of its error, re-solved
 * to cross the line at its intended height (like Blitz's mega, but never unsavable); the keeper reaches SUPER_REACH
 * of his usual reach for it and can't hold it, so a great save still beats it. A chip keeps the meter (a super
 * chip makes no sense) and so does a strike from beyond SUPER_RANGE m. Open play only: never a penalty, a free
 * kick or a shootout. Only the match's own state is read (no rng is drawn), so a seed replays exactly and two
 * lockstep peers agree.
 */
import { clamp, dist2 } from '../core/math';
import { GOAL_H, GOAL_W, GRAVITY, HALF_L } from './constants';
import type { Launch } from './actions';
import type { Match } from './match';
import type { MatchEvent, Side } from './types';

// ------------------------------------------------------------------ tunables

export const HYPE_MAX = 100;
/** What each thing is worth (HYPE_MAX fills it). */
export const HYPE_GAIN = {
  /** A pass that reaches a team-mate; a one-touch (first-time) one is worth `oneTouch` on top. */
  pass: 0.8,
  oneTouch: 2,
  /** From the CHAIN_FROM'th completed pass in a row, each one is worth `chain` more. */
  chain: 0.7,
  /** A defender wrong-footed (a cut, a feint, a SKILL move's victim). */
  beat: 4,
  /** SKILL moves by grade (on top of any 'beat' they caused). */
  perfect: 8,
  good: 4,
  plain: 1,
  show: 0.5,
  /** A skill chain's link (a cut or knock-on that beat a man and extended it). */
  link: 2,
  tackle: 6,
  slide: 7,
  shot: 1,
  onTarget: 3,
  block: 6,
  save: 14,
  claim: 2.5,
  post: 5,
} as const;
export const CHAIN_FROM = 3;
/** Per second the side keeps the ball in its final third (the crowd building). */
export const PRESSURE_RATE = 0.4;
/**
 * The super shot: pace (never past SUPER_TOP m/s), how much of its error is kept, how far inside the posts and under
 * the bar it is aimed at the least (m: it goes on frame), the keeper's reach against it, the longest range (m).
 */
export const SUPER_PACE = 1.1;
export const SUPER_TOP = 32;
export const SUPER_ERR = 0.4;
export const SUPER_FRAME = 0.5;
export const SUPER_REACH = 0.94;
export const SUPER_RANGE = 32;
/** A super shot counts as live (in flight, for the keeper and the render) this long after it is struck (s). */
export const SUPER_LIVE_S = 2.5;

// ------------------------------------------------------------------ state

interface HypeState {
  meter: [number, number];
  /** The kick id of each side's last super shot (-1: none yet). */
  superKick: [number, number];
  /** A pass on its way: who played it (-1: none), his side, and whether it was one-touch. */
  passBy: number;
  passSide: Side;
  passFirst: boolean;
  /** Completed passes in a row by the side in possession (cleared when the other side has it). */
  chain: [number, number];
  /** Totals (tests, measurements): meters filled, super shots struck. */
  fills: [number, number];
  supers: [number, number];
  /** Hype gained by source, per side (tuning: tests/hype.test.ts's measurement). */
  bySource: { [k: string]: [number, number] };
}

const STATES = new WeakMap<Match, HypeState>();

/** Local match recovery preserves the meter and the pass chain without drawing from the match RNG. */
export function savedHype(m: Match): HypeState | null { return STATES.get(m) ?? null; }
export function restoreHype(m: Match, state: HypeState | null): void {
  if (state) STATES.set(m, state); else STATES.delete(m);
}

function stateOf(m: Match): HypeState {
  let s = STATES.get(m);
  if (!s) {
    s = { meter: [0, 0], superKick: [-1, -1], passBy: -1, passSide: 0, passFirst: false, chain: [0, 0], fills: [0, 0], supers: [0, 0], bySource: {} };
    STATES.set(m, s);
  }
  return s;
}

const other = (s: Side): Side => (s === 0 ? 1 : 0);

// ------------------------------------------------------------------ queries (the HUD, the render, the hash)

/** How full `side`'s meter is, 0..1. */
export function hypeOf(m: Match, side: Side): number {
  const s = STATES.get(m);
  return s ? s.meter[side] / HYPE_MAX : 0;
}

/** `side`'s next open-play shot will be a SUPER SHOT. */
export function superArmed(m: Match, side: Side): boolean {
  return !!m.cfg.hype && hypeOf(m, side) >= 1;
}

/** The ball in flight is a super shot, and whose (-1: it isn't). */
export function superBall(m: Match): Side | -1 {
  const s = STATES.get(m);
  if (!s || m.shotKick !== m.kickId || m.shotClock > SUPER_LIVE_S) return -1;
  return s.superKick[m.shotSide] === m.shotKick ? m.shotSide : -1;
}

/** Totals so far (meters filled, super shots struck), per side. */
export function hypeStats(m: Match): { fills: [number, number]; supers: [number, number]; bySource: { [k: string]: [number, number] } } {
  const s = stateOf(m);
  return { fills: [...s.fills] as [number, number], supers: [...s.supers] as [number, number], bySource: s.bySource };
}

/** The raw meters (net/hash.ts folds them in when the match has hype). */
export function hypeMeters(m: Match): readonly [number, number] {
  return STATES.get(m)?.meter ?? [0, 0];
}

// ------------------------------------------------------------------ the step

function add(m: Match, s: HypeState, side: Side, v: number, src: string): void {
  if (v <= 0) return;
  (s.bySource[src] ??= [0, 0])[side] += v;
  const was = s.meter[side];
  if (was >= HYPE_MAX) return;
  const now = Math.min(HYPE_MAX, was + v);
  s.meter[side] = now;
  if (now >= HYPE_MAX) {
    s.fills[side]++;
    m.events.push({ type: 'hypeFull', side });
  }
}

const sideOf = (m: Match, i: number | undefined): Side | -1 => (i !== undefined && i >= 0 && i < m.players.length ? m.players[i].side : -1);

function onEvent(m: Match, s: HypeState, e: MatchEvent): void {
  switch (e.type) {
    case 'kick': {
      const side = sideOf(m, e.player);
      if (side === -1) break;
      // (Any touch by the other side breaks a chain of passes.)
      s.chain[other(side)] = 0;
      if (e.kind === 'pass' || e.kind === 'through' || e.kind === 'lob') {
        s.passBy = e.player!;
        s.passSide = side;
        s.passFirst = !!e.firstTime;
      } else {
        s.passBy = -1;
        if (e.kind === 'shot' || (e.kind === 'header' && m.shotKick === m.kickId && m.shotClock < 0.05)) {
          add(m, s, side, HYPE_GAIN.shot + (m.shotOnTarget ? HYPE_GAIN.onTarget : 0), 'shot');
        }
      }
      break;
    }
    case 'control': {
      const side = sideOf(m, e.player);
      if (side === -1) break;
      if (s.passBy >= 0 && s.passSide === side && s.passBy !== e.player) {
        s.chain[side]++;
        add(m, s, side, HYPE_GAIN.pass + (s.passFirst ? HYPE_GAIN.oneTouch : 0) + (s.chain[side] >= CHAIN_FROM ? HYPE_GAIN.chain : 0), 'pass');
      }
      s.chain[other(side)] = 0;
      s.passBy = -1;
      break;
    }
    case 'beat': {
      const side = sideOf(m, e.by);
      if (side !== -1) add(m, s, side, HYPE_GAIN.beat, 'beat');
      break;
    }
    case 'skillMove': {
      const side = sideOf(m, e.player);
      if (side === -1) break;
      if (e.move === 'cut' || e.move === 'knock' || e.move === 'past') add(m, s, side, HYPE_GAIN.link, 'skill');
      else add(m, s, side, HYPE_GAIN[e.grade], 'skill');
      break;
    }
    case 'tackle': {
      if (!e.won) break;
      const side = sideOf(m, e.by);
      if (side === -1) break;
      add(m, s, side, e.slide ? HYPE_GAIN.slide : HYPE_GAIN.tackle, 'tackle');
      s.chain[other(side)] = 0;
      break;
    }
    case 'block': {
      const side = sideOf(m, e.by);
      if (side !== -1) add(m, s, side, e.shot ? HYPE_GAIN.block : Math.round(HYPE_GAIN.block / 2), 'block');
      break;
    }
    case 'save': {
      const side = sideOf(m, e.keeper);
      if (side !== -1) add(m, s, side, HYPE_GAIN.save, 'save');
      break;
    }
    case 'claim': {
      const side = sideOf(m, e.keeper);
      if (side !== -1) add(m, s, side, HYPE_GAIN.claim, 'claim');
      break;
    }
    case 'post':
      if (m.shotClock < 2) add(m, s, m.shotSide, HYPE_GAIN.post, 'post');
      break;
    case 'goal':
    case 'restart':
      s.chain[0] = s.chain[1] = 0;
      s.passBy = -1;
      break;
    default:
      break;
  }
}

/**
 * Called at the end of Match.step (MatchConfig.hype only) with the events list's length when the step began:
 * reads what this step did and fills the meters; the crowd builds while a side keeps the ball in its final third.
 */
export function hypeStep(m: Match, dt: number, from: number): void {
  const s = stateOf(m);
  const ev = m.events;
  // (A list drained since: everything in it is this step's.)
  for (let i = Math.min(from, ev.length); i < ev.length; i++) onEvent(m, s, ev[i]);
  if (m.phase !== 'play') return;
  const b = m.ball;
  if (b.owner < 0 || b.held) return;
  const side = m.players[b.owner].side;
  if (b.pos.x * m.attackDir(side) > HALF_L / 3) add(m, s, side, PRESSURE_RATE * dt, 'pressure');
}

// ------------------------------------------------------------------ the super shot

/**
 * Match.execute, right after the launch is solved: a full side's open-play shot (not a chip, from inside
 * SUPER_RANGE m) becomes a SUPER SHOT: SUPER_PACE the pace, SUPER_ERR of its error, re-solved flat to cross the
 * line at its intended height (under the bar), struck straight (no bend). The launch is changed in place; the meter empties.
 */
export function superLaunch(m: Match, p: { idx: number; side: Side; isKeeper: boolean }, L: Launch): void {
  const s = STATES.get(m);
  if (!s || L.kind !== 'shot' || L.style === 'chip' || m.phase !== 'play' || p.isKeeper || s.meter[p.side] < HYPE_MAX) return;
  const b = m.ball.pos;
  const gx = m.attackDir(p.side) * HALF_L;
  if (dist2(b.x, b.z, gx, 0) > SUPER_RANGE) return;
  const k = Math.min(SUPER_PACE, SUPER_TOP / Math.max(1, Math.hypot(L.vx, L.vy, L.vz)));
  L.vx *= Math.max(1, k);
  L.vz *= Math.max(1, k);
  const hs = Math.hypot(L.vx, L.vz);
  if (L.aim) {
    // On frame: aimed inside the posts and under the bar, with SUPER_ERR of its error. (The aim keeps it: timed
    // finishing's second tap re-aims from it, Match.finishTap.)
    const post = GOAL_W / 2 - SUPER_FRAME;
    L.aim.z = clamp(L.aim.z, -post, post);
    L.aim.h = clamp(L.aim.h, 0.25, GOAL_H - SUPER_FRAME);
    L.aim.errZ *= SUPER_ERR;
    L.aim.errH *= SUPER_ERR;
    const tz = L.aim.z + L.aim.errZ;
    const h = clamp(L.aim.h + L.aim.errH, 0.25, GOAL_H - 0.4);
    const dx = L.aim.gx - b.x;
    const dz = tz - b.z;
    const dl = Math.hypot(dx, dz) || 1;
    L.vx = (dx / dl) * hs;
    L.vz = (dz / dl) * hs;
    // (The shot model's drag allowance: it gets there at ~0.9 of its launch pace.)
    const t = dl / (hs * 0.9);
    L.vy = clamp((h - b.y + 0.5 * GRAVITY * t * t) / t, -2, 12);
    // A straight rocket: no bend to take it off the line it was re-aimed on.
    L.spinY = 0;
  } else L.spinY *= 0.5;
  L.power = Math.max(L.power, 1);
  s.meter[p.side] = 0;
  // (Match.execute counts the kick after this: the super shot's kick id is the next one.)
  s.superKick[p.side] = m.kickId + 1;
  s.supers[p.side]++;
  m.events.push({ type: 'superShot', side: p.side, player: p.idx });
}

/** Match.checkKeeperHands: the live shot keeper side `k` faces is the other side's super shot. */
export function superLive(m: Match, k: Side): boolean {
  const s = STATES.get(m);
  const side = other(k);
  return !!s && m.shotSide === side && m.shotKick === m.kickId && s.superKick[side] === m.shotKick && m.shotClock < SUPER_LIVE_S;
}

// ------------------------------------------------------------------ dev

/** Dev builds (window.__bl.superShot): `side`'s meter full now (a local match only: never online). */
export function devFillHype(m: Match, side: Side): void {
  if (!m.cfg.hype) return;
  const s = stateOf(m);
  s.meter[side] = HYPE_MAX - 0.01;
  add(m, s, side, 1, 'dev');
}
