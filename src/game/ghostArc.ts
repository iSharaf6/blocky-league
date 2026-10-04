import { clamp, dist2 } from '../core/math';
import { LOB_MAX_SPEED, SHOT_SPEED_BASE, SHOT_SPEED_POWER } from '../sim/actions';
import { Ball, solveLob, type BallHit } from '../sim/ball';
import { BALL_R, DT, GOAL_W, GRAVITY, HALF_L, HALF_W } from '../sim/constants';
import { freeKickSolve, wallJump, wallRadius, wallTop } from '../sim/setPiece';
import { penaltySpeed, solveStrike } from '../sim/shootout';

const solved = { vx: 0, vy: 0, vz: 0 };

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
  /** Sidespin (rad/s: a bent free kick's). Left out: none. */
  spinY?: number;
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

/**
 * A penalty (penaltyLaunch without the noise), aimed at `aimZ` across the goal. With `aimH` it is the human's
 * placed aim (the reticle): solved on the ball's own flight to cross the line at (aimZ, aimH), exactly as the
 * strike is (shootout.solveStrike). Without it, the old model: the height the power makes it rise to.
 */
export function penaltyGhost(
  bx: number, by: number, bz: number, gx: number, aimZ: number, power: number, acc: number, out: GhostLaunch, aimH?: number,
): GhostLaunch {
  if (aimH !== undefined) {
    const v = solveStrike(bx, by, bz, gx, aimZ, aimH, penaltySpeed(power, acc), 0, solved);
    out.x = bx; out.y = Math.max(BALL_R, by); out.z = bz;
    out.vx = v.vx;
    out.vy = v.vy;
    out.vz = v.vz;
    return out;
  }
  const p = clamp(power, 0.15, 1);
  const h = Math.max(0.15, 0.3 + p * 0.75 + p * p * 0.45);
  const speed = Math.min(34, 16 + p * 15 * (0.8 + acc * 0.3));
  return aimed(bx, by, bz, gx, aimZ, h, speed, 0.93, -2, 12, out);
}

/**
 * The human's placed free kick (sim/setPiece.ts freeKickLaunch without the miss): through the reticle at (gx, aimH,
 * aimZ) at `power`, bent `curl`: the very solve the kick uses, so the preview is the kick.
 */
export function freeKickGhost(
  bx: number, by: number, bz: number, gx: number, aimZ: number, aimH: number, power: number, acc: number, curl: number, out: GhostLaunch,
): GhostLaunch {
  const v = freeKickSolve(bx, by, bz, gx, aimZ, aimH, power, acc, curl, solved);
  out.x = bx; out.y = Math.max(BALL_R, by); out.z = bz;
  out.vx = v.vx;
  out.vy = v.vy;
  out.vz = v.vz;
  out.spinY = Math.abs(curl) > 0.02 ? v.spinY : 0;
  return out;
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
  out.spinY = 0;
  return out;
}

/**
 * A lofted delivery (a corner, a crossed free kick) from (bx, bz) to land at (tx, tz): the lob's flight time
 * (a driven one flatter and faster), solveLob, and the sim's cap on how hard anyone hits it. `dropTo` / `hang`: the
 * height it drops to and the extra hang the kick is ordered with (sim/setPiece.ts deliveryShape), else the lob's own.
 */
export function lobLaunch(
  bx: number, by: number, bz: number, tx: number, tz: number, power: number, driven: boolean, out: GhostLaunch, dropTo?: number, hang = 0,
): GhostLaunch {
  const cx = clamp(tx, -HALF_L, HALF_L);
  const cz = clamp(tz, -HALF_W, HALF_W);
  const d = Math.max(3, dist2(bx, bz, cx, cz));
  let flight = driven
    ? clamp(0.42 + d / 42, 0.6, 1.3) * (1 + (1 - clamp(power, 0, 1)) * DRIVEN_HANG)
    : clamp(0.75 + d / 34, 0.9, LOB_MAX_FLIGHT) + hang;
  const land = dropTo ?? (driven ? 1.1 : 1.3);
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
  out.spinY = 0;
  return out;
}

const ghostBall = new Ball();
const hits: BallHit[] = [];

/** The men in a free kick's wall (where they stand), and how bent the kick is (0..1): Match.checkWall's test. */
export interface GhostWall {
  spots: readonly { x: number; z: number }[];
  bend: number;
}

/** flyGhost's last path met the wall (it ends there). */
export let ghostBlocked = false;

/**
 * Fly `L` on the sim's ball physics and write the path into `out` (x, y, z per dot, a dot every GHOST_EVERY
 * steps): until it is in or behind the goal / off the pitch, it has stopped, or GHOST_MAX_S. Returns the dots.
 * With `wall` (a shooting free kick) it also ends where a man in the jumping wall would block it (ghostBlocked).
 */
export function flyGhost(L: GhostLaunch, out: Float32Array, wall?: GhostWall): number {
  const b = ghostBall;
  b.reset(L.x, L.z);
  b.pos.y = L.y;
  b.vel.x = L.vx;
  b.vel.y = L.vy;
  b.vel.z = L.vz;
  b.spin.y = L.spinY ?? 0;
  ghostBlocked = false;
  const top = wall ? wallTop(wall.bend) : 0;
  const rad = wall ? wallRadius(wall.bend) : 0;
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
    const px = b.pos.x;
    const py = b.pos.y;
    const pz = b.pos.z;
    b.step(DT, hits);
    if (wall && i * DT <= 0.9) {
      // (Swept over the step, as the sim does: a 30 m/s strike covers half a metre a frame.)
      const jump = wallJump((i + 1) * DT);
      for (const w of wall.spots) {
        const sx = b.pos.x - px;
        const sz = b.pos.z - pz;
        const l2 = sx * sx + sz * sz || 1;
        const t = clamp(((w.x - px) * sx + (w.z - pz) * sz) / l2, 0, 1);
        if (Math.hypot(px + sx * t - w.x, pz + sz * t - w.z) < rad && py + (b.pos.y - py) * t < top + jump) {
          ghostBlocked = true;
          if (n < max) {
            out[n * 3] = px + sx * t;
            out[n * 3 + 1] = Math.max(BALL_R, py + (b.pos.y - py) * t);
            out[n * 3 + 2] = pz + sz * t;
            n++;
          }
          return n;
        }
      }
    }
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
