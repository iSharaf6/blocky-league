import { clamp, dist2 } from '../core/math';
import { LOB_MAX_SPEED, SHOT_SPEED_BASE, SHOT_SPEED_POWER } from '../sim/actions';
import { Ball, solveLob, type BallHit } from '../sim/ball';
import { BALL_R, DT, GOAL_W, GRAVITY, HALF_L, HALF_W } from '../sim/constants';

/**
 * Set-piece "ghost" arc (Easy / Normal only): where the human's free kick, corner or penalty will go for the
 * aim and power he has on right now, drawn as a dotted line before he strikes it (render/ghostArc.ts).
 *
 * The launch mirrors the sim's own models with the noise left out (sim/actions.ts resolveShot's dead-ball strike,
 * the lofted ball's solveLob flight, sim/shootout.ts penaltyLaunch), and the flight is the sim's own Ball physics
 * stepped on a private ball: no RNG is touched and the match is never read from after it returns, so the
 * preview can never change what happens.
 */

/** Longest a preview runs (s) and how often a dot is dropped (sim steps). */
export const GHOST_MAX_S = 2.6;
export const GHOST_EVERY = 3;
/** Most dots a path holds (GHOST_MAX_S / (GHOST_EVERY x DT), rounded up). */
export const GHOST_MAX_PTS = Math.ceil(GHOST_MAX_S / (GHOST_EVERY * DT)) + 1;

/** (Copied from the sim's launch models: where a strike's height starts to be capped with range.) */
const LONG_RISE_FROM = 20;
const LOB_MAX_FLIGHT = 3.2;
const DRIVEN_HANG = 0.3;

export interface GhostLaunch {
  /** Where the ball is struck from. */
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
}

/**
 * A dead-ball strike at the goal at x = `gx` (free kick / penalty), aimed at `aimZ` on the goal line, `power` 0..1
 * by a taker with `acc` (shooting / 100). As resolveShot for a set piece: the height at the line 0.25 + p^2 x 1.25
 * (less from range), the pace SHOT_SPEED_BASE + p x SHOT_SPEED_POWER x (0.78 + acc x 0.3).
 */
export function strikeLaunch(bx: number, by: number, bz: number, gx: number, aimZ: number, power: number, acc: number, out: GhostLaunch): GhostLaunch {
  const p = clamp(power, 0, 1);
  const hw = GOAL_W / 2;
  const tz = clamp(aimZ, -hw - 4, hw + 4);
  const d = Math.max(2, dist2(bx, bz, gx, tz));
  const rise = clamp(1 - (d - LONG_RISE_FROM) * 0.035, 0.62, 1);
  const h = 0.25 + p * p * 1.25 * rise;
  const speed = Math.min(35, SHOT_SPEED_BASE + p * SHOT_SPEED_POWER * (0.78 + acc * 0.3));
  return aimed(bx, by, bz, gx, tz, h, speed, 0.9, -2, 13, out);
}

/** A penalty in a shootout (penaltyLaunch without the noise): aimed at `aimZ`, the height it was set to rise to. */
export function penaltyGhost(bx: number, by: number, bz: number, gx: number, aimZ: number, power: number, acc: number, out: GhostLaunch): GhostLaunch {
  const p = clamp(power, 0.15, 1);
  const h = Math.max(0.15, 0.3 + p * 0.75 + p * p * 0.45);
  const speed = Math.min(34, 16 + p * 15 * (0.8 + acc * 0.3));
  return aimed(bx, by, bz, gx, aimZ, h, speed, 0.93, -2, 12, out);
}

function aimed(
  bx: number, by: number, bz: number, gx: number, tz: number, h: number, speed: number, slow: number, vyMin: number, vyMax: number, out: GhostLaunch,
): GhostLaunch {
  const dx = gx - bx;
  const dz = tz - bz;
  const dl = Math.hypot(dx, dz) || 1;
  const t = dl / (speed * slow);
  const vy = clamp((h - by + 0.5 * GRAVITY * t * t) / t, vyMin, vyMax);
  out.x = bx; out.y = Math.max(BALL_R, by); out.z = bz;
  out.vx = (dx / dl) * speed;
  out.vy = vy;
  out.vz = (dz / dl) * speed;
  return out;
}

/**
 * A lofted delivery (a corner, a crossed free kick) from (bx, bz) to land at (tx, tz): the lob's flight time
 * (a driven one flatter and faster), solveLob, and the sim's cap on how hard anyone hits it.
 */
export function lobLaunch(bx: number, by: number, bz: number, tx: number, tz: number, power: number, driven: boolean, out: GhostLaunch): GhostLaunch {
  const cx = clamp(tx, -HALF_L, HALF_L);
  const cz = clamp(tz, -HALF_W, HALF_W);
  const d = Math.max(3, dist2(bx, bz, cx, cz));
  let flight = driven
    ? clamp(0.42 + d / 42, 0.6, 1.3) * (1 + (1 - clamp(power, 0, 1)) * DRIVEN_HANG)
    : clamp(0.75 + d / 34, 0.9, LOB_MAX_FLIGHT);
  const land = driven ? 1.1 : 1.3;
  const max = driven ? 30 : LOB_MAX_SPEED;
  let s = solveLob(d, flight, land);
  while (Math.hypot(s.vh, s.vy) > max && flight < LOB_MAX_FLIGHT) {
    flight = Math.min(LOB_MAX_FLIGHT, flight + (driven ? 0.03 : 0.1));
    const n = solveLob(d, flight, land);
    if (Math.hypot(n.vh, n.vy) >= Math.hypot(s.vh, s.vy)) break;
    s = n;
  }
  const sp = Math.hypot(s.vh, s.vy);
  const k = sp > max ? max / sp : 1;
  out.x = bx; out.y = Math.max(BALL_R, by); out.z = bz;
  out.vx = ((cx - bx) / d) * s.vh * k;
  out.vy = s.vy * k;
  out.vz = ((cz - bz) / d) * s.vh * k;
  return out;
}

const ghostBall = new Ball();
const hits: BallHit[] = [];

/**
 * Fly `L` on the sim's ball physics and write the path into `out` (x, y, z per dot, a dot every GHOST_EVERY
 * steps): until it is in or behind the goal / off the pitch, it has stopped, or GHOST_MAX_S. Returns the dots.
 */
export function flyGhost(L: GhostLaunch, out: Float32Array): number {
  const b = ghostBall;
  b.reset(L.x, L.z);
  b.pos.y = L.y;
  b.vel.x = L.vx;
  b.vel.y = L.vy;
  b.vel.z = L.vz;
  let n = 0;
  const max = Math.min(GHOST_MAX_PTS, Math.floor(out.length / 3));
  const steps = Math.round(GHOST_MAX_S / DT);
  for (let i = 0; i <= steps && n < max; i++) {
    if (i % GHOST_EVERY === 0) {
      out[n * 3] = b.pos.x;
      out[n * 3 + 1] = b.pos.y;
      out[n * 3 + 2] = b.pos.z;
      n++;
    }
    hits.length = 0;
    b.step(DT, hits);
    // In the net, off the frame and away, or out of play: the preview ends there.
    if (b.inGoal !== 0 || Math.abs(b.pos.x) > HALF_L + 0.6 || Math.abs(b.pos.z) > HALF_W + 0.6) {
      if (n < max) {
        out[n * 3] = b.pos.x;
        out[n * 3 + 1] = b.pos.y;
        out[n * 3 + 2] = b.pos.z;
        n++;
      }
      break;
    }
    if (b.onGround && b.hspeed() < 1.5) break;
  }
  return n;
}
