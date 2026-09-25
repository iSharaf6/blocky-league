import { clamp } from '../core/math';
import type { Rng } from '../core/rng';
import type { Launch } from './actions';
import type { Ball } from './ball';
import { BALL_R, BOX_DEPTH, GOAL_W, GRAVITY, HALF_L } from './constants';
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
  /** Human aim across the goal mouth (world z), kept when the stick is released. */
  aimZ: number;
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

/**
 * Solve a penalty strike. Unpressured from twelve yards, so far tighter than open play, but the
 * taker's shooting, the AI level and the power all widen the spread; a blast can fly over the bar.
 */
export function penaltyLaunch(m: Match, p: Player, aim: PenAim): Launch {
  const b = m.ball.pos;
  const gx = m.attackDir(p.side) * HALF_L;
  const acc = p.stat.shooting / 100;
  const power = clamp(aim.power, 0.15, 1);
  const sk = 1.3 - m.kickSkill(p) * 0.125;
  const spread = (0.1 + (1 - acc) * 0.75) * (0.65 + power * 0.5) * sk;
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
 * the taker (and gets away early); otherwise a guess, now and then staying big in the middle.
 * -1 / +1 = world -z / +z.
 */
export function keeperGuess(rng: Rng, keeping: number, bonus: number, predZ: number): { dir: -1 | 0 | 1; read: boolean } {
  const pRead = clamp(0.1 + keeping * 0.1 + bonus * 2, 0.05, 0.35);
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
