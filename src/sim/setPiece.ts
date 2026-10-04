import { clamp, dist2 } from '../core/math';
import { CURL_SPIN, SHOT_SPEED_BASE, SHOT_SPEED_POWER, skillErr, type Launch } from './actions';
import { HALF_L, HALF_W } from './constants';
import type { Match } from './match';
import type { Player } from './player';
import { newPenAim, PEN_AIM_EASE, PEN_AIM_RAMP, PEN_AIM_RAMP_T, placedMiss, solveStrike, steerPenAim, type PenAimState } from './shootout';
import type { Side } from './types';

/**
 * The human's free kicks and corners, aimed the way his penalties are (the owner, 2026-10-04: "freekick and corner
 * lines feel kind of useless icl, im not happy with them, but i am rly rly happy with the pens yo").
 *
 * Before: a free kick was aimed by turning the taker (an arrow on the grass) and its height came from the power alone,
 * with a miss on top the dotted preview never showed; a corner went along the arrow at whoever the pass assist found.
 * Neither line ended anywhere.
 *
 * Now, as a penalty:
 * - a SHOOTING free kick (keeper.ts isDirectFreeKick) has a reticle on the goal (FkAimState.pen: across and up, the
 *   stick puts it there and it stays). Hold SHOOT for the power; while it is held the reticle is fixed and the stick
 *   bends the ball instead (FkAimState.curl: sidespin, CURL_SPIN at full). The strike is solved on the ball's own
 *   flight to pass through the reticle (shootout.ts solveStrike, with the spin on it), so the preview is the kick: the
 *   power is its pace, and so how high it has to go to get there: a soft one loops over the wall and drops for the
 *   keeper to walk to, a hard one is flat and meets the wall. Bend takes it round the wall, and the wall and the keeper
 *   both have less of a bent one (Match.checkWall, the keeper's CURL_REACH). The miss is a penalty's (placedMiss), wider
 *   with the distance (FK_SPREAD_D).
 * - a corner or a wide free kick (ai.ts isCrossingRestart) has a landing ring in the box (ZoneAimState: the stick moves
 *   it over the area zoneBounds allows). CROSS floats it there, SHOOT drives it low, PASS plays it short. The runner
 *   whose zone is nearest attacks the ring (ai.ts setPieceAimAt).
 *
 * Pure functions here (no RNG but freeKickLaunch's miss), so the preview (game/ghostArc.ts) can call the very same
 * solve the kick does.
 */

/** A free kick's reticle: the penalty's aim point, and the bend (-1..1: towards world -z / +z) the stick puts on while SHOOT is held. */
export interface FkAimState {
  pen: PenAimState;
  curl: number;
  /** Seconds the curl keys have been held (their ramp). */
  curlHeld: number;
}

export function newFkAim(): FkAimState {
  return { pen: newPenAim(), curl: 0, curlHeld: 0 };
}

/** Keys: the bend slides at this rate (per s, the full range is 2) while held. Stick: it eases to where the stick is. */
const FK_CURL_RATE = 2.2;

/**
 * Move the free-kick aim for one frame. The stick is read against the line from the ball (`bx, bz`) to the middle of
 * the goal at x = `gx` (the lens looks along it): across it slides the reticle across the goal, along it up and down.
 * `charging` (SHOOT held): the reticle stays and the stick across bends the ball instead.
 */
export function steerFreeKick(a: FkAimState, mx: number, mz: number, bx: number, bz: number, gx: number, digital: boolean, charging: boolean, dt: number): void {
  const dl = Math.hypot(gx - bx, bz) || 1;
  const ux = (gx - bx) / dl;
  const uz = -bz / dl;
  // (World z is across the goal at either end: the lateral axis (-uz, ux) points to +z for a side attacking +x.)
  const across = (mx * -uz + mz * ux) * (Math.sign(ux) || 1);
  const up = mx * ux + mz * uz;
  if (!charging) {
    a.curlHeld = 0;
    steerPenAim(a.pen, across, up, digital, dt);
    return;
  }
  if (digital) {
    const s = Math.abs(across) > 0.38 ? Math.sign(across) : 0;
    if (s === 0) a.curlHeld = 0;
    else {
      a.curlHeld += dt;
      const k = PEN_AIM_RAMP + (1 - PEN_AIM_RAMP) * Math.min(1, a.curlHeld / PEN_AIM_RAMP_T);
      a.curl = clamp(a.curl + s * FK_CURL_RATE * k * dt, -1, 1);
    }
  } else if (Math.hypot(mx, mz) > 0.25) {
    const e = 1 - Math.exp(-PEN_AIM_EASE * dt);
    a.curl += (clamp(across / 0.85, -1, 1) - a.curl) * e;
  }
}

/** A free kick's pace (m/s) at `power` by a taker with `acc` (shooting / 100): the dead-ball strike's (actions.ts resolveShot). */
export function fkSpeed(power: number, acc: number): number {
  return Math.min(35, SHOT_SPEED_BASE + clamp(power, 0, 1) * SHOT_SPEED_POWER * (0.78 + acc * 0.3));
}

/** The sidespin (rad/s) of a strike going towards `gx` bent `curl` (-1..1, towards world -z / +z): actions.ts bendShot's. */
export function fkSpin(curl: number, bx: number, gx: number): number {
  return -clamp(curl, -1, 1) * CURL_SPIN * (Math.sign(gx - bx) || 1);
}

const solved = { vx: 0, vy: 0, vz: 0 };

/**
 * The launch that sends a free kick from (bx, by, bz) through (gx, h, z) on the goal line at `power`, bent `curl`: the
 * same solve for the kick and for its preview. (FK_SOLVE_ITERS passes: a bent one from 28 m starts well off its line.)
 */
export function freeKickSolve(
  bx: number, by: number, bz: number, gx: number, z: number, h: number, power: number, acc: number, curl: number,
  out: { vx: number; vy: number; vz: number },
): { vx: number; vy: number; vz: number; spinY: number } {
  const spinY = fkSpin(curl, bx, gx);
  const v = solveStrike(bx, by, bz, gx, z, h, fkSpeed(power, acc), spinY, out, FK_SOLVE_ITERS);
  return { vx: v.vx, vy: v.vy, vz: v.vz, spinY };
}
const FK_SOLVE_ITERS = 6;

/** His free kick's power when his time runs out with SHOOT not held (a firm, placed one). */
export const FK_AUTO_POWER = 0.62;

/** The human's placed free kick: where on the goal (z across, h up), how hard, how bent. */
export interface FkAim {
  z: number;
  h: number;
  power: number;
  curl: number;
}

/** A free kick's miss is a penalty's (twelve yards), this much wider per metre beyond FK_SPREAD_FROM m, and FK_CURL_ERR more of it fully bent. */
const FK_SPREAD_FROM = 11;
const FK_SPREAD_D = 0.045;
const FK_CURL_ERR = 0.25;

/**
 * Strike the human's placed free kick: solved on the ball's flight to pass through his reticle, less a miss that
 * grows with the taker's shooting, the power (a blast most of all), the distance and the bend.
 */
export function freeKickLaunch(m: Match, p: Player, aim: FkAim): Launch {
  const b = m.ball.pos;
  const gx = m.attackDir(p.side) * HALF_L;
  const acc = p.stat.shooting / 100;
  const power = clamp(aim.power, 0.15, 1);
  const d = dist2(b.x, b.z, gx, aim.z);
  const far = 1 + Math.max(0, d - FK_SPREAD_FROM) * FK_SPREAD_D;
  const spread = (0.1 + (1 - acc) * 0.75) * (0.65 + power * 0.5) * skillErr(m, p) * far * (1 + Math.abs(aim.curl) * FK_CURL_ERR);
  const miss = placedMiss(spread, power, m.rng.gauss(), m.rng.gauss());
  const v = freeKickSolve(b.x, b.y, b.z, gx, aim.z + miss.z, Math.max(0.15, aim.h + miss.h), power, acc, aim.curl, solved);
  // (A straight one still has a little natural spin, as any strike.)
  const spinY = Math.abs(aim.curl) > 0.02 ? v.spinY : m.rng.gauss() * 0.8;
  return { vx: v.vx, vy: v.vy, vz: v.vz, spinX: 0, spinY, spinZ: 0, target: -1, kind: 'shot', power };
}

// ------------------------------------------------------------------ the wall

/** How much higher (m) than a shoulder the wall reaches for a straight (unbent) free kick, and how much lower against a fully bent one. */
export const WALL_HEAD = 0.18;
export const WALL_CURL_DIP = 0.55;
/** The wall jumps this long (s) after the strike, at this pace (m/s); a jump comes down at WALL_JUMP_G m/s2 (Player.step). */
export const WALL_JUMP_AT = 0.06;
export const WALL_JUMP_VY = 3.4;
const WALL_JUMP_G = 18;

/** The height (m, standing) under which a man in the wall blocks a free kick bent `bend` (0..1), and how near (m) it has to pass him. */
export function wallTop(bend: number): number {
  return 1.8 + WALL_HEAD * (1 - bend) - WALL_CURL_DIP * bend;
}
export function wallRadius(bend: number): number {
  return 0.5 - 0.15 * bend;
}
/** How high (m) the wall's jump has it `t` s after the strike. */
export function wallJump(t: number): number {
  const u = t - WALL_JUMP_AT;
  return u <= 0 ? 0 : Math.max(0, WALL_JUMP_VY * u - 0.5 * WALL_JUMP_G * u * u);
}

// ------------------------------------------------------------------ the landing ring

/** A floated delivery's power, a driven one's (flat and fast, short of full power so it hangs a touch), and where each drops to (m). */
const FLOAT_POWER = 0.7;
const DRIVEN_POWER = 0.65;
const DRIVEN_LAND = 1.0;
/** Extra hang time (s) on a corner floated beyond the near post, so it clears the near-post crowd. */
const FAR_POST_HANG = 0.22;

/**
 * How the human's delivery to (.., aimZ) is struck (Match.deliverTo, and its preview): its power, the height it drops
 * to (undefined: a lofted ball's own), and the extra hang of a corner (`corner`, taken from z = takerZ) floated beyond
 * the near post.
 */
export function deliveryShape(corner: boolean, takerZ: number, aimZ: number, driven: boolean): { power: number; land: number | undefined; hang: number } {
  if (driven) return { power: DRIVEN_POWER, land: DRIVEN_LAND, hang: 0 };
  return { power: FLOAT_POWER, land: undefined, hang: corner && aimZ * (Math.sign(takerZ) || 1) < 1 ? FAR_POST_HANG : 0 };
}

/** A delivery's landing ring (a corner, a wide free kick): where on the grass (world x, z). */
export interface ZoneAimState {
  x: number;
  z: number;
  /** Seconds the aim keys have been held (the slide's ramp). */
  held: number;
}

/** The ring stays this far (m) off the goal line (the keeper's) and within this of the middle; it reaches this far out. */
const ZONE_NEAR = 3.5;
const ZONE_FAR = 19;
const ZONE_HALF_W = 14;
/** Keys: the ring slides at this pace (m/s). */
const ZONE_SPEED = 13;

/** The area the landing ring may sit in for `side`'s delivery, and its middle (where it starts: the penalty spot's zone). */
export function zoneBounds(m: Match, side: Side): { x0: number; x1: number; z0: number; z1: number; cx: number; cz: number } {
  const ad = m.attackDir(side);
  const gx = ad * HALF_L;
  const a = gx - ad * ZONE_NEAR;
  const b = gx - ad * ZONE_FAR;
  return { x0: Math.min(a, b), x1: Math.max(a, b), z0: -ZONE_HALF_W, z1: ZONE_HALF_W, cx: (a + b) / 2, cz: 0 };
}

export function newZoneAim(m: Match, side: Side): ZoneAimState {
  const b = zoneBounds(m, side);
  return { x: b.cx, z: b.cz, held: 0 };
}

/**
 * Move the landing ring for one frame: the stick (world space, as the lens shows it) puts it there (the full push at
 * the edge of the area, eased), and let go it stays; keys slide it.
 */
export function steerZone(a: ZoneAimState, mx: number, mz: number, digital: boolean, dt: number, b: { x0: number; x1: number; z0: number; z1: number; cx: number; cz: number }): void {
  const len = Math.hypot(mx, mz);
  if (digital) {
    const sx = len > 0.3 && Math.abs(mx) / len > 0.38 ? Math.sign(mx) : 0;
    const sz = len > 0.3 && Math.abs(mz) / len > 0.38 ? Math.sign(mz) : 0;
    if (sx === 0 && sz === 0) a.held = 0;
    else {
      a.held += dt;
      const k = PEN_AIM_RAMP + (1 - PEN_AIM_RAMP) * Math.min(1, a.held / PEN_AIM_RAMP_T);
      a.x += sx * ZONE_SPEED * k * dt;
      a.z += sz * ZONE_SPEED * k * dt;
    }
  } else {
    a.held = 0;
    if (len > 0.25) {
      const tx = b.cx + clamp(mx / 0.9, -1, 1) * ((b.x1 - b.x0) / 2);
      const tz = b.cz + clamp(mz / 0.9, -1, 1) * ((b.z1 - b.z0) / 2);
      const e = 1 - Math.exp(-PEN_AIM_EASE * dt);
      a.x += (tx - a.x) * e;
      a.z += (tz - a.z) * e;
    }
  }
  a.x = clamp(a.x, Math.max(b.x0, -HALF_L + 1), Math.min(b.x1, HALF_L - 1));
  a.z = clamp(a.z, Math.max(b.z0, -HALF_W + 1), Math.min(b.z1, HALF_W - 1));
}
