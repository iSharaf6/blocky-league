import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { crossingZ } from '../src/sim/actions';
import { DT, GOAL_W, HALF_L, HALF_W } from '../src/sim/constants';
import { EMPTY_PAD, Match, type Pad } from '../src/sim/match';
import type { Player } from '../src/sim/player';

/*
 * The shooting bench: a striker with 81 shooting alone against a set keeper (1.5 m off his line), every trial its own
 * seed. It was written in tests/knuckleRates.test.ts for the knuckleball (whose header table is these trials and these
 * seeds: do not change either without re-measuring it) and is shared with tests/rangeShots.test.ts, which pins the
 * placed strike and the curler from range on it.
 */

/** The menu's levels in sim units (ui/menus.ts DIFF_LEVEL). */
export const EASY = 0.6;
export const NORMAL = 1.8;
export const HARD = 3;
export const LEGEND = 4;

export function benchMatch(seed: number, difficulty = NORMAL): Match {
  return new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 120, difficulty, humanSide: 0, seed });
}

function place(p: Player, x: number, z: number): void {
  p.pos.x = x;
  p.pos.z = z;
  p.vel.x = p.vel.z = 0;
  p.setState('move');
  p.order = null;
}

const phase = (m: Match): string => m.phase;

export interface Strike {
  /** Seconds SHOOT is held. */
  hold: number;
  /** The stick while it is held and at the strike, across the goal (world z). */
  lat?: number;
  /** ... and towards their goal (1: all the way). With `lat`, a diagonal: under 60% of the bar that is the finesse shot. */
  fwd?: number;
  /** The stick's sideways push after the strike (aftertouch), world z: without looking. */
  after?: number;
  /**
   * A player who reads his own shot: `react` s after it is struck he pushes the stick all the way (world z) to bend it
   * towards a spot `read` m inside the post on the side it is heading for (in if it is going wide, out if it is central).
   */
  read?: number;
  react?: number;
}

export interface Outcome { res: 'goal' | 'saved' | 'held' | 'off' | 'post'; style: string | null }

/** SHOOT held 0.2 s with the stick left alone: the shot assist's placed strike. */
export const PLACED: Strike = { hold: 0.2 };
/** The stick right across the goal (towards +z) at the strike: the CURLER (actions.ts CURLER_BEND). */
export const CURLED: Strike = { hold: 0.36, lat: 1 };

/**
 * The ball `dist` m from the middle of the goal, `z` m off the pitch's axis; only the keeper (1.5 m off his line) to
 * beat. `watch`: called after every step from the strike on (a probe for a test that wants to see the flight).
 */
export function strikeTrial(seed: number, dist: number, z: number, s: Strike, difficulty = NORMAL, watch?: (m: Match, sinceStrike: number) => void): Outcome {
  const m = benchMatch(seed, difficulty);
  m.phase = 'play';
  m.restart = null;
  m.clock = 20;
  m.players.forEach((p, i) => place(p, -40 + i * 3.6, -HALF_W + 1.5));
  const ad = m.attackDir(0);
  const gx = ad * HALF_L;
  const p = m.players[9];
  place(p, ad * (HALF_L - Math.sqrt(dist * dist - z * z) - 0.5), z);
  p.facing = Math.atan2(-z * 0.3, ad);
  place(m.keeperOf(1)!, ad * (HALF_L - 1.5), 0);
  const b = m.ball;
  b.reset(p.pos.x + ad * 0.5, p.pos.z);
  b.owner = p.idx;
  b.lastTouch = p.idx;
  b.lastTouchSide = 0;
  m.active = p.idx;
  m.updateBallPath();
  for (let i = 0; i < 4; i++) m.step(DT, EMPTY_PAD);
  m.drainEvents();
  const stick: Pad = { ...EMPTY_PAD, mx: s.fwd ? s.fwd * ad : 0, mz: s.lat ?? 0 };
  for (let i = 0; i < Math.round(s.hold / DT); i++) m.step(DT, { ...stick, shoot: true });
  const g0 = m.score[0];
  let style: string | null = null;
  let struck = -1;
  let saved = false;
  let held = false;
  let post = false;
  let push = s.after ?? 0;
  for (let i = 0; i < 260; i++) {
    // The stick stays where it was until the boot meets the ball; then the aftertouch (if any) moves it.
    const pushing = struck >= 0 && push !== 0 && i - struck < 40 && (i - struck) * DT >= (s.react ?? 0);
    m.step(DT, struck >= 0 && i - struck >= 40 ? EMPTY_PAD : pushing ? { ...EMPTY_PAD, mz: Math.max(-1, Math.min(1, (s.lat ?? 0) + push)) } : stick);
    for (const e of m.drainEvents()) {
      if (e.type === 'kick' && e.kind === 'shot' && struck < 0) {
        struck = i;
        style = e.style ?? null;
        if (s.read !== undefined) {
          const z0 = crossingZ(b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z, b.spin.y, gx);
          if (z0 !== null) {
            const zt = (Math.sign(z0) || 1) * (GOAL_W / 2 - s.read);
            if (Math.abs(zt - z0) > 0.25) push = Math.sign(zt - z0) * 2;
          }
        }
      }
      if (e.type === 'save') {
        saved = true;
        held = e.caught;
      }
      if (e.type === 'post') post = true;
    }
    if (struck >= 0) watch?.(m, i - struck);
    if (m.score[0] > g0) return { res: 'goal', style };
    if (phase(m) === 'out' || (m.ball.owner >= 0 && m.players[m.ball.owner].side === 1) || m.ball.held) break;
  }
  return { res: held ? 'held' : saved ? 'saved' : post ? 'post' : 'off', style };
}

export interface Rates { n: number; goal: number; saved: number; held: number; off: number; post: number; styles: Record<string, number> }

/** The bench's mix of spots: a third of the trials from the pitch's axis, a third from 5 m either side of it. */
export const SPOTS: readonly number[] = [0, 5, -5];

/** `n` trials from `dist` m, from `zs` in turn (by default a third of them from 5 m either side of the pitch's axis), each on its own seed. */
export function rates(dist: number, s: Strike, n: number, difficulty = NORMAL, zs: readonly number[] = SPOTS): Rates {
  const r: Rates = { n: 0, goal: 0, saved: 0, held: 0, off: 0, post: 0, styles: {} };
  for (let k = 0; k < n; k++) {
    const o = strikeTrial(11 + k * 7 + Math.round(dist * 2) * 1013, dist, zs[k % zs.length], s, difficulty);
    r.n++;
    r[o.res]++;
    const st = o.style ?? 'plain';
    r.styles[st] = (r.styles[st] ?? 0) + 1;
  }
  r.goal /= n;
  r.saved /= n;
  r.held /= n;
  r.off /= n;
  r.post /= n;
  return r;
}

const pc = (v: number) => `${(v * 100).toFixed(0)}%`.padStart(4);
export const fmtRates = (label: string, r: Rates) =>
  `${label.padEnd(36)} goal ${pc(r.goal)} | parried ${pc(r.saved)} | held ${pc(r.held)} | off ${pc(r.off)} | post ${pc(r.post)}`;
