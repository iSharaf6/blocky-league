import { clamp } from '../core/math';
import type { Rng } from '../core/rng';
import type { Launch } from './actions';
import { Ball, type BallHit } from './ball';
import { BALL_R, BOX_DEPTH, DT, GOAL_H, GOAL_W, GRAVITY, HALF_L } from './constants';
import type { Match } from './match';
import type { Player } from './player';
import type { Side } from './types';

/** Kicks each side takes before sudden death. */
export const SHOOTOUT_ROUNDS = 5;
/** Seconds a kick may take to resolve after the strike (a feeble roller that never arrives). */
export const KICK_TIMEOUT = 2.5;
/** Beat after each kick before the next taker is on the spot. */
export const RESULT_BEAT = 1.2;
/** Beat before the first kick so the "PENALTIES" banner can land. */
export const INTRO_BEAT = 2.2;
/** Seconds a human taker gets before the kick goes automatically. */
export const HUMAN_WINDOW = 10;

export type KickHow = 'goal' | 'saved' | 'post' | 'wide' | 'over';

/** Where a penalty is meant to go: lateral `z` across the goal mouth, height `h` at the line. */
export interface PenAim {
  z: number;
  h: number;
  power: number;
  /**
   * The human's own aim point (steerPenAim): `h` is where he put it, so the power no longer lifts it, the miss
   * falls either side of the point, and the launch is solved on the ball's own flight to pass through it.
   * Left out (the AI's kicks): the original model, untouched.
   */
  placed?: boolean;
}

/**
 * The human's penalty aim (in a match or a shootout): a point on the goal line, `z` across the mouth and `h` up
 * it (the ball's centre, m), kept PEN_AIM_MARGIN inside the posts and under the bar. It starts in the middle.
 */
export const PEN_AIM_MARGIN = 0.45;
export const PEN_AIM_Z = GOAL_W / 2 - PEN_AIM_MARGIN;
export const PEN_AIM_H_MIN = BALL_R + 0.03;
export const PEN_AIM_H_MAX = GOAL_H - PEN_AIM_MARGIN;
export const PEN_AIM_H0 = (PEN_AIM_H_MIN + PEN_AIM_H_MAX) / 2;
/**
 * Keys: a held key slides the aim across (A / D) or up and down (W / S) the goal at these rates (m/s), from
 * PEN_AIM_RAMP of them at the press up to full speed over PEN_AIM_RAMP_T s, so a tap nudges it and a hold
 * crosses from the middle to a post in under a second.
 */
export const PEN_AIM_SPEED_Z = 4.4;
export const PEN_AIM_SPEED_H = 2.6;
export const PEN_AIM_RAMP = 0.45;
export const PEN_AIM_RAMP_T = 0.3;
/** Analog stick / touch: the aim eases to the point the stick is held at, at this rate (1/s). */
export const PEN_AIM_EASE = 14;

export interface PenAimState {
  z: number;
  h: number;
  /** Seconds the aim keys have been held (the slide's ramp); 0 when none is. */
  held: number;
  /** Seconds the aim has sat within PEN_TELL_BAND of a post (the keeper's read of it: penaltyTell). */
  dwell: number;
}

export function newPenAim(): PenAimState {
  return { z: 0, h: PEN_AIM_H0, held: 0, dwell: 0 };
}

/**
 * The tell: an aim left sitting by a post (within PEN_TELL_BAND m of the furthest it goes) for more than
 * PEN_TELL_FROM s gives the keeper up to PEN_TELL_MAX more chance of reading the kick (keeperGuess), reached
 * PEN_TELL_SPAN s later. Picking the spot late keeps him guessing.
 */
export const PEN_TELL_BAND = 0.9;
export const PEN_TELL_FROM = 1;
export const PEN_TELL_SPAN = 2;
export const PEN_TELL_MAX = 0.15;

export function penaltyTell(dwell: number): number {
  return clamp((dwell - PEN_TELL_FROM) / PEN_TELL_SPAN, 0, 1) * PEN_TELL_MAX;
}

/**
 * Move the human's penalty aim `a` for one frame of `dt` s. `across` is the stick along world z (across the
 * goal mouth), `up` along the way to the goal (up the goal: W on the behind-the-ball lens). Keys (`digital`)
 * slide it at a steady rate while held (it used to snap to straight left, straight right or the middle);
 * each key's direction is snapped back to the goal's own axes first, so D on a lens a few degrees off the
 * line doesn't creep it up or down. An analog stick puts it where the stick points (the full push at the
 * post or the bar, eased), and let go it stays put. Always inside the frame (PEN_AIM_MARGIN).
 */
export function steerPenAim(a: PenAimState, across: number, up: number, digital: boolean, dt: number): void {
  const len = Math.hypot(across, up);
  if (digital) {
    const sx = len > 0.3 && Math.abs(across) / len > 0.38 ? Math.sign(across) : 0;
    const sy = len > 0.3 && Math.abs(up) / len > 0.38 ? Math.sign(up) : 0;
    if (sx === 0 && sy === 0) {
      a.held = 0;
    } else {
      a.held += dt;
      const k = PEN_AIM_RAMP + (1 - PEN_AIM_RAMP) * Math.min(1, a.held / PEN_AIM_RAMP_T);
      a.z += sx * PEN_AIM_SPEED_Z * k * dt;
      a.h += sy * PEN_AIM_SPEED_H * k * dt;
    }
  } else {
    a.held = 0;
    if (len > 0.25) {
      const tz = clamp(across / 0.9, -1, 1) * PEN_AIM_Z;
      const u = clamp(up / 0.9, -1, 1);
      const th = PEN_AIM_H0 + u * (u > 0 ? PEN_AIM_H_MAX - PEN_AIM_H0 : PEN_AIM_H0 - PEN_AIM_H_MIN);
      const e = 1 - Math.exp(-PEN_AIM_EASE * dt);
      a.z += (tz - a.z) * e;
      a.h += (th - a.h) * e;
    }
  }
  a.z = clamp(a.z, -PEN_AIM_Z, PEN_AIM_Z);
  a.h = clamp(a.h, PEN_AIM_H_MIN, PEN_AIM_H_MAX);
  a.dwell = Math.abs(a.z) >= PEN_AIM_Z - PEN_TELL_BAND ? a.dwell + dt : 0;
}

const probe = new Ball();
const probeHits: BallHit[] = [];
/** solveStrike's probe stops this far (m) short of the goal line: clear of the posts and bar (BALL_R + POST_R). */
const PROBE_SHORT = 0.45;

/**
 * The launch velocity (written into `out`) that sends a ball struck from (bx, by, bz) at `speed` m/s, with
 * sidespin `spinY`, through (gx, h, tz) on the goal line: the drag-allowance solve penaltyLaunch has always
 * used (which lands ~0.1-0.2 m low from twelve yards), then corrected on the sim's own Ball flight until it
 * crosses the line at the point. Pure: no RNG, nothing in the match is touched (the ghost arc uses it too).
 */
export function solveStrike(
  bx: number, by: number, bz: number, gx: number, tz: number, h: number, speed: number, spinY: number,
  out: { vx: number; vy: number; vz: number },
  iters = 3,
): { vx: number; vy: number; vz: number } {
  const dx = gx - bx;
  const dz = tz - bz;
  const dl = Math.hypot(dx, dz) || 1;
  const t0 = dl / (speed * 0.93);
  let vx = (dx / dl) * speed;
  let vz = (dz / dl) * speed;
  let vy = clamp((h - by + 0.5 * GRAVITY * t0 * t0) / t0, -2, 12);
  const ad = Math.sign(dx) || 1;
  // (Flown to just short of the frame, PROBE_SHORT m, so a post or the bar never knocks the probe about; the last
  // few centimetres on its line.)
  const short = gx - ad * PROBE_SHORT;
  // (`iters`: a penalty's three; a bent free kick from range, setPiece.ts, takes a few more to settle on its point.)
  for (let iter = 0; iter < iters; iter++) {
    probe.reset(bx, bz);
    probe.pos.y = Math.max(BALL_R, by);
    probe.vel.x = vx;
    probe.vel.y = vy;
    probe.vel.z = vz;
    probe.spin.y = spinY;
    let hit: { z: number; y: number; t: number } | null = null;
    for (let i = 0; i < 240; i++) {
      const q = probe.pos;
      const w = probe.vel;
      if (w.x * ad < 0.5) break;
      // (Checked before the step: the step itself would already meet a post.)
      if ((q.x + w.x * DT - short) * ad >= 0) {
        const u = (gx - q.x) / w.x;
        hit = { z: q.z + w.z * u, y: q.y + w.y * u - 0.5 * GRAVITY * u * u, t: i * DT + u };
        break;
      }
      probeHits.length = 0;
      probe.step(DT, probeHits);
    }
    if (!hit || hit.t < 0.05) break;
    const ez = tz - hit.z;
    const ey = h - hit.y;
    if (Math.abs(ez) < 0.005 && Math.abs(ey) < 0.005) break;
    // (Drag takes ~7% of the pace on the way: a change in launch velocity moves the crossing a little less than v x t.)
    vz += ez / (hit.t * 0.95);
    vy = clamp(vy + ey / (hit.t * 0.95), -2, 12);
    // (The same pace along the ground as asked for: only its line changes.)
    const hs = Math.hypot(vx, vz) || 1;
    vx *= speed / hs;
    vz *= speed / hs;
  }
  out.vx = vx;
  out.vy = vy;
  out.vz = vz;
  return out;
}

export interface KeeperDive {
  /** Seconds after the strike the keeper leaves the line. */
  at: number;
  z: number;
  y: number;
  /** Predicted seconds from the strike until the ball reaches the line. */
  arrive: number;
  /** Extra dive pace when the keeper read the taker (anticipation). */
  boost: number;
}

export interface ShootoutState {
  /** Result of every kick so far, per side. */
  kicks: [boolean[], boolean[]];
  /** Side taking the current (or just-taken) kick. */
  turn: Side;
  winner: Side | -1;
  first: Side;
  /** Every kick is taken at the same end: +1 = the goal at +x. */
  goal: 1 | -1;
  /** Taker rotation per side (player indices, best shooter first). */
  order: [number[], number[]];
  stage: 'intro' | 'aim' | 'flight' | 'result';
  /** Seconds in the current stage. */
  t: number;
  taker: number;
  keeper: number;
  /** Human aim across the goal mouth (world z) and up it (m), kept when the stick is released (steerPenAim). */
  aimZ: number;
  aimH: number;
  /** Latest human stick (world space): a keeper dives where it points as the ball is struck. */
  stick: { x: number; z: number };
  /** Aim of the kick being struck. */
  pen: PenAim | null;
  /** Keeper's committed dive, waiting on the reaction delay. */
  dive: KeeperDive | null;
  /** The current kick has hit the woodwork. */
  post: boolean;
  last: { side: Side; taker: number; scored: boolean; how: KickHow } | null;
}

export function goalsOf(kicks: boolean[]): number {
  let n = 0;
  for (const k of kicks) if (k) n++;
  return n;
}

/**
 * Winner of a shootout tally, or -1 while it is still live. Best of `rounds`, stopping as soon as
 * one side can't catch up; after that, sudden death decided on each completed pair of kicks.
 */
export function shootoutWinner(kicks: [boolean[], boolean[]], rounds = SHOOTOUT_ROUNDS): Side | -1 {
  const [a, b] = kicks;
  const ga = goalsOf(a);
  const gb = goalsOf(b);
  if (a.length <= rounds && b.length <= rounds) {
    if (ga > gb + (rounds - b.length)) return 0;
    if (gb > ga + (rounds - a.length)) return 1;
    return -1;
  }
  if (a.length === b.length && ga !== gb) return ga > gb ? 0 : 1;
  return -1;
}

/** Kicks alternate, `first` going first in every pair. */
export function nextTurn(kicks: [boolean[], boolean[]], first: Side): Side {
  const other: Side = first === 0 ? 1 : 0;
  return kicks[first].length > kicks[other].length ? other : first;
}

/**
 * The side stepping up, for the tracker (ui/shootoutHud.ts): once a kick is settled (the result beat) it is the NEXT
 * taker's, not the side that has just kicked (`turn` only moves on when the next man is on the spot).
 */
export function steppingUp(s: { kicks: [boolean[], boolean[]]; turn: Side; first?: Side; stage?: string }): Side {
  return s.stage === 'result' && s.first !== undefined ? nextTurn(s.kicks, s.first) : s.turn;
}

/** Outfield takers, best shooter first (the keeper never takes one). */
export function takerOrder(team: Player[]): number[] {
  return team
    .filter((p) => !p.isKeeper)
    .sort((a, b) => b.stat.shooting - a.stat.shooting || a.slot - b.slot)
    .map((p) => p.idx);
}

/**
 * Where a player not involved in the kick waits: outfielders arm in arm along the halfway line (home
 * one side of the centre spot, away the other), the kicking side's keeper at the edge of the box.
 */
export function lineupSpot(p: Player, goal: number): { x: number; z: number; facing: number } {
  const facing = goal > 0 ? 0 : Math.PI;
  if (p.isKeeper) return { x: goal * (HALF_L - BOX_DEPTH - 1.5), z: -13, facing };
  const i = p.slot - 1;
  return { x: goal * 1.2, z: (p.side === 0 ? -1 : 1) * (0.9 + i * 1.05), facing };
}

/** Where (and when) the ball will cross the goal line `gx`, ignoring drag and curl. */
export function predictCrossing(ball: Ball, gx: number): { z: number; y: number; t: number } {
  const vx = ball.vel.x;
  if (Math.abs(vx) < 1) return { z: ball.pos.z, y: ball.pos.y, t: 1 };
  // Air drag costs a strike ~10% of its pace over twelve yards.
  const t = Math.max(0.05, ((gx - ball.pos.x) / vx) * 1.06);
  const y = Math.max(BALL_R, ball.pos.y + ball.vel.y * t - 0.5 * GRAVITY * t * t);
  return { z: ball.pos.z + ball.vel.z * t, y, t };
}

/**
 * AI taker: mostly a corner (with a spread of how far across), sometimes down the middle; mostly low.
 * How well it comes off is down to the taker (see penaltyLaunch).
 */
export function aiPenaltyAim(rng: Rng): PenAim {
  let z: number;
  if (rng.chance(0.1)) z = rng.gauss() * 0.35;
  else z = (rng.chance(0.5) ? 1 : -1) * (2 + rng.next() * 1.3);
  const h = 0.2 + rng.next() * rng.next() * 1.6;
  const power = 0.6 + rng.next() * 0.34;
  return { z: clamp(z, -3.3, 3.3), h, power };
}

/** A penalty's pace (m/s) at `power` by a taker with `acc` (shooting / 100): penaltyLaunch, and the ghost arc. */
export function penaltySpeed(power: number, acc: number): number {
  return Math.min(34, 16 + clamp(power, 0.15, 1) * 15 * (0.8 + acc * 0.3));
}

/**
 * The miss on a placed penalty (PenAim.placed), from two unit normals: across the goal `gz` x the spread (a
 * blast, power over 0.82, up to BLAST_WIDE more of it); up and down `gh` x PLACED_H_ERR of it either way, and a
 * blast pushing it up as well, so a full bar at the top corner can still clear the bar and one by a post can
 * still hit it.
 */
const PLACED_H_ERR = 0.6;
const BLAST_LIFT = 1.8;
const BLAST_WIDE = 0.5;
export function placedMiss(spread: number, power: number, gz: number, gh: number): { z: number; h: number } {
  const blast = clamp((power - 0.82) / 0.18, 0, 1);
  return { z: gz * spread * (1 + blast * BLAST_WIDE), h: spread * (gh * PLACED_H_ERR + Math.abs(gh) * blast * BLAST_LIFT) };
}

const solved = { vx: 0, vy: 0, vz: 0 };

/**
 * Solve a penalty strike. Unpressured from twelve yards, so far tighter than open play, but the
 * taker's shooting, the AI level and the power all widen the spread; a blast can fly over the bar.
 * A placed aim (the human's) is struck at its point: the miss is placedMiss's, and the launch is solved on
 * the ball's own flight (solveStrike), so with no miss it crosses the line exactly there.
 */
export function penaltyLaunch(m: Match, p: Player, aim: PenAim): Launch {
  const b = m.ball.pos;
  const gx = m.attackDir(p.side) * HALF_L;
  const acc = p.stat.shooting / 100;
  const power = clamp(aim.power, 0.15, 1);
  const sk = 1.3 - m.kickSkill(p) * 0.125;
  const spread = (0.1 + (1 - acc) * 0.75) * (0.65 + power * 0.5) * sk;
  if (aim.placed) {
    const miss = placedMiss(spread, power, m.rng.gauss(), m.rng.gauss());
    const spinY = m.rng.gauss() * 0.8;
    const v = solveStrike(b.x, b.y, b.z, gx, aim.z + miss.z, Math.max(0.15, aim.h + miss.h), penaltySpeed(power, acc), spinY, solved);
    return { vx: v.vx, vy: v.vy, vz: v.vz, spinX: 0, spinY, spinZ: 0, target: -1, kind: 'shot', power };
  }
  const tz = aim.z + m.rng.gauss() * spread;
  const blast = clamp((power - 0.82) / 0.18, 0, 1);
  const h = Math.max(0.15, aim.h + power * power * 0.45 + Math.abs(m.rng.gauss()) * spread * (0.6 + blast * 1.8));
  const speed = Math.min(34, 16 + power * 15 * (0.8 + acc * 0.3));
  const dx = gx - b.x;
  const dz = tz - b.z;
  const dl = Math.hypot(dx, dz) || 1;
  const t = dl / (speed * 0.93);
  const vy = clamp((h - b.y + 0.5 * GRAVITY * t * t) / t, -2, 12);
  return {
    vx: (dx / dl) * speed, vy, vz: (dz / dl) * speed,
    spinX: 0, spinY: m.rng.gauss() * 0.8, spinZ: 0,
    target: -1, kind: 'shot', power,
  };
}

/**
 * AI keeper: commits before the ball is struck. A small chance (better keepers, harder AI) of reading
 * the taker (and gets away early), `tell` more against a human who left his aim by a post (penaltyTell);
 * otherwise a guess, now and then staying big in the middle. -1 / +1 = world -z / +z.
 */
export function keeperGuess(rng: Rng, keeping: number, bonus: number, predZ: number, tell = 0): { dir: -1 | 0 | 1; read: boolean } {
  const pRead = clamp(0.1 + keeping * 0.1 + bonus * 2, 0.05, 0.35) + tell;
  if (rng.chance(pRead)) return { dir: Math.abs(predZ) < 1 ? 0 : predZ > 0 ? 1 : -1, read: true };
  const r = rng.next();
  return { dir: r < 0.14 ? 0 : r < 0.57 ? -1 : 1, read: false };
}

/**
 * Turn a committed side into a dive target. The right way: go for the ball itself. The wrong way:
 * a full-stretch dive at nothing. Staying central meets anything near the middle and nothing else.
 */
export function divePlan(dir: -1 | 0 | 1, pred: { z: number; y: number }, rng: Rng): { z: number; y: number } | null {
  if (dir === 0) return Math.abs(pred.z) < GOAL_W / 5 ? { z: pred.z, y: pred.y } : null;
  if (Math.sign(pred.z) === dir && Math.abs(pred.z) > 0.4) return { z: pred.z, y: pred.y };
  return { z: dir * (2.1 + rng.next() * 0.9), y: 0.5 + rng.next() * 1.1 };
}
