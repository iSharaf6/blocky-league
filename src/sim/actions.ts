import { clamp, dist2, pointSegDist } from '../core/math';
import { Ball, groundPassSpeed, rollTime, solveLob, type BallHit } from './ball';
import { BALL_R, GOAL_W, GRAVITY, HALF_L, HALF_W } from './constants';
import type { Match } from './match';
import type { KickOrder, Player } from './player';
import type { KickKind } from './types';

export interface Launch {
  vx: number;
  vy: number;
  vz: number;
  spinX: number;
  spinY: number;
  spinZ: number;
  target: number;
  kind: KickKind;
  power: number;
}

function dirOf(p: Player, order: KickOrder): { x: number; z: number } {
  const l = Math.hypot(order.dirX, order.dirZ);
  if (l > 0.2) return { x: order.dirX / l, z: order.dirZ / l };
  return { x: Math.cos(p.facing), z: Math.sin(p.facing) };
}

/** How dangerous a pass lane is: 0 = clear, 1 = an opponent is standing on it. */
export function laneRisk(m: Match, side: number, ax: number, az: number, bx: number, bz: number): number {
  let risk = 0;
  for (const o of m.players) {
    if (o.side === side) continue;
    const { d, t } = pointSegDist(o.pos.x, o.pos.z, ax, az, bx, bz);
    if (t < 0.04) continue;
    // Opponents further along the lane get more time to close it down.
    const reach = 0.9 + t * dist2(ax, az, bx, bz) * 0.06;
    const r = clamp(1 - d / (reach + 1.4), 0, 1);
    if (r > risk) risk = r;
  }
  return risk;
}

/** Launch speed of a ground pass to feet over `d` metres (firmer the longer it is). */
export function passSpeed(d: number): number {
  return Math.min(groundPassSpeed(d, clamp(7 + d * 0.2, 8, 13)), 28);
}

/** Launch speed of a through ball rolling `d` metres into space. */
export function throughSpeed(d: number): number {
  return Math.min(groundPassSpeed(d, 4.5), 28);
}

/**
 * Chance an opponent cuts out a ground ball struck at `v0` from A to B: for each opponent,
 * compare when the ball passes their closest point on the line with how long they need to
 * get there. Opponents near B are racing the receiver for it.
 */
export function interceptRisk(m: Match, side: number, ax: number, az: number, bx: number, bz: number, v0: number): number {
  const len = dist2(ax, az, bx, bz);
  if (len < 0.5) return 0;
  const ux = (bx - ax) / len;
  const uz = (bz - az) / len;
  let risk = 0;
  for (const o of m.players) {
    if (o.side === side) continue;
    const rx = o.pos.x - ax;
    const rz = o.pos.z - az;
    const along = rx * ux + rz * uz;
    if (along < 0.5) continue;
    const s = Math.min(along, len);
    const lat = along > len ? dist2(o.pos.x, o.pos.z, bx, bz) : Math.abs(rx * uz - rz * ux);
    const reach = o.isKeeper ? 1.1 : 0.95;
    let r: number;
    if (lat < reach) {
      // Standing in the lane: close up it's a block (about a coin flip), further out it's cut out.
      r = along < 3.8 ? 0.55 : 0.9;
    } else {
      // Only one defender reacts to a pass, and not instantly (calibrated against match outcomes).
      const tb = Math.min(rollTime(v0, s), 4);
      const to = (lat - reach) / (o.top * 0.85) + 0.32;
      r = clamp(0.4 + (tb - to) * 1.6, 0, 1);
    }
    if (along > len * 0.92) r *= 0.75; // at the end it's a duel with the receiver
    if (r > risk) risk = r;
  }
  return risk;
}

/** Pick the teammate the passer is aiming at. Returns -1 when nobody is in the cone. */
export function pickReceiver(m: Match, p: Player, dx: number, dz: number, mode: 'pass' | 'through' | 'lob'): number {
  let best = -1;
  let bestScore = -Infinity;
  const cone = mode === 'lob' ? 0.95 : 0.85;
  const maxD = mode === 'pass' ? 40 : 58;
  const ad = m.attackDir(p.side);
  for (const t of m.players) {
    if (t.side !== p.side || t === p) continue;
    const vx = t.pos.x - p.pos.x;
    const vz = t.pos.z - p.pos.z;
    const d = Math.hypot(vx, vz);
    if (d < 2.5 || d > maxD) continue;
    const cos = (vx * dx + vz * dz) / d;
    const ang = Math.acos(clamp(cos, -1, 1));
    if (ang > cone) continue;
    let score = cos * 2.2 - d * 0.012;
    if (mode === 'pass') score -= laneRisk(m, p.side, p.pos.x, p.pos.z, t.pos.x, t.pos.z) * 0.5;
    if (mode === 'through') score += ((t.pos.x - p.pos.x) * ad) / 40 + (t.vel.x * ad) / 20;
    if (t.isKeeper) score -= 1.2;
    if (score > bestScore) {
      bestScore = score;
      best = t.idx;
    }
  }
  return best;
}

/** Distance from `p` to the nearest opponent. */
export function nearestOppDist(m: Match, p: Player): number {
  let d = Infinity;
  for (const o of m.players) {
    if (o.side === p.side) continue;
    const e = dist2(o.pos.x, o.pos.z, p.pos.x, p.pos.z);
    if (e < d) d = e;
  }
  return d;
}

/** Error multiplier from difficulty / human control: ~1.3 at skill 0, ~0.8 at skill 4. */
export function skillErr(m: Match, p: Player): number {
  return 1.3 - m.kickSkill(p) * 0.125;
}

/** Being closed down makes every kick a little less clean. */
function pressureErr(m: Match, p: Player): number {
  const d = nearestOppDist(m, p);
  return 1 + clamp((2.8 - d) / 1.8, 0, 1) * 0.8;
}

function passError(p: Player, m: Match, scale: number): number {
  const acc = p.stat.passing / 100;
  return m.rng.gauss() * (1.1 - acc) * 0.1 * scale * skillErr(m, p) * pressureErr(m, p);
}

function rotate(x: number, z: number, a: number): { x: number; z: number } {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: x * c - z * s, z: x * s + z * c };
}

/** Solve the ball's launch for a kick order, from wherever the ball is right now. */
export function resolveKick(m: Match, p: Player, order: KickOrder): Launch {
  const b = m.ball.pos;
  const dir = dirOf(p, order);
  const ad = m.attackDir(p.side);
  const kind = order.kind;

  if (kind === 'shot' || (kind === 'header' && order.target < 0 && order.aimX === undefined)) {
    return resolveShot(m, p, order, kind === 'header');
  }

  if (kind === 'pass' || kind === 'throw' || kind === 'keeper') {
    const tgt = order.target >= 0 ? order.target : pickReceiver(m, p, dir.x, dir.z, 'pass');
    const throwIn = kind === 'throw' || kind === 'keeper';
    if (tgt >= 0) {
      const r = m.players[tgt];
      // Lead the receiver: iterate the travel time twice.
      let tx = r.pos.x;
      let tz = r.pos.z;
      let v0 = 12;
      for (let i = 0; i < 2; i++) {
        const d = Math.max(1, dist2(b.x, b.z, tx, tz));
        v0 = passSpeed(d);
        const t = Math.min(rollTime(v0, d), 3);
        tx = r.pos.x + r.vel.x * t * 0.85;
        tz = r.pos.z + r.vel.z * t * 0.85;
      }
      tx = clamp(tx, -HALF_L + 1, HALF_L - 1);
      tz = clamp(tz, -HALF_W + 0.8, HALF_W - 0.8);
      const d = dist2(b.x, b.z, tx, tz);
      if (throwIn) {
        // Thrown balls travel at catchable speeds: longer throws hang in the air longer.
        const flight = clamp(0.4 + d / 22, 0.55, 1.6);
        const s = solveLob(d, flight, 0.5);
        const ex = passError(p, m, 0.6);
        const u = rotate((tx - b.x) / d, (tz - b.z) / d, ex);
        // solveLob launches from grass height; we release from the hands.
        const vy = s.vy - (b.y - BALL_R) / flight;
        return launch(u.x * s.vh, vy, u.z * s.vh, 0, 0, 0, tgt, kind, 0.4);
      }
      const ex = passError(p, m, 1);
      const u = rotate((tx - b.x) / d, (tz - b.z) / d, ex);
      const sp = v0 * (1 + m.rng.gauss() * (1 - p.stat.passing / 100) * 0.05);
      return launch(u.x * sp, 0, u.z * sp, 0, 0, 0, tgt, kind, clamp(sp / 28, 0, 1));
    }
    // Pass into space along the stick.
    const sp = throwIn ? 9 : 13;
    return launch(dir.x * sp, throwIn ? 3 : 0, dir.z * sp, 0, 0, 0, -1, kind, 0.4);
  }

  if (kind === 'through') {
    const tgt = order.target >= 0 ? order.target : pickReceiver(m, p, dir.x, dir.z, 'through');
    let tx: number, tz: number;
    if (order.aimX !== undefined && order.aimZ !== undefined) {
      tx = order.aimX;
      tz = order.aimZ;
    } else if (tgt >= 0) {
      const r = m.players[tgt];
      // Into the space ahead of the runner, biased towards goal.
      const rs = Math.hypot(r.vel.x, r.vel.z);
      let rx = rs > 1.5 ? r.vel.x / rs : ad;
      let rz = rs > 1.5 ? r.vel.z / rs : 0;
      rx = rx * 0.6 + ad * 0.4;
      const rl = Math.hypot(rx, rz) || 1;
      const lead = 6 + rs * 0.7;
      tx = r.pos.x + (rx / rl) * lead;
      tz = r.pos.z + (rz / rl) * lead;
    } else {
      tx = b.x + dir.x * 18;
      tz = b.z + dir.z * 18;
    }
    tx = clamp(tx, -HALF_L + 2, HALF_L - 2);
    tz = clamp(tz, -HALF_W + 1.5, HALF_W - 1.5);
    const d = Math.max(2, dist2(b.x, b.z, tx, tz));
    const v0 = throughSpeed(d);
    const u = rotate((tx - b.x) / d, (tz - b.z) / d, passError(p, m, 1.3));
    return launch(u.x * v0, 0, u.z * v0, 0, 0, 0, tgt, kind, clamp(v0 / 28, 0, 1));
  }

  if (kind === 'lob' || kind === 'clear' || kind === 'header') {
    let tgt = order.target;
    let tx: number, tz: number;
    if (order.aimX !== undefined && order.aimZ !== undefined) {
      tx = order.aimX;
      tz = order.aimZ;
    } else {
      if (tgt < 0 && kind !== 'clear') tgt = pickReceiver(m, p, dir.x, dir.z, 'lob');
      if (tgt >= 0) {
        const r = m.players[tgt];
        const d0 = dist2(b.x, b.z, r.pos.x, r.pos.z);
        const t0 = 0.8 + d0 / 30;
        tx = r.pos.x + r.vel.x * t0 * 0.8;
        tz = r.pos.z + r.vel.z * t0 * 0.8;
      } else {
        const reach = kind === 'clear' ? 42 : 16 + order.power * 24;
        tx = b.x + dir.x * reach;
        tz = b.z + dir.z * reach;
      }
    }
    tx = clamp(tx, -HALF_L + 1, HALF_L - 1);
    tz = clamp(tz, -HALF_W + 1, HALF_W - 1);
    const d = Math.max(3, dist2(b.x, b.z, tx, tz));
    const flight = kind === 'header' ? clamp(0.5 + d / 30, 0.5, 1.2) : clamp(0.75 + d / 34, 0.9, 2.3);
    const land = order.land ?? (kind === 'clear' ? BALL_R : 1.3);
    const s = solveLob(d, flight, land);
    let err = passError(p, m, kind === 'clear' ? 2.2 : 1.4);
    // A scrambled clearance from inside our own box sometimes slices off behind for a corner.
    if (kind === 'clear' && Math.abs(b.x + ad * HALF_L) < 16 && m.rng.chance(0.14 * pressureErr(m, p))) {
      const toLine = -ad; // towards our own goal line
      const zs = Math.sign(b.z || 1);
      // Rotate so the ball heads for the byline on the near side, well wide of the goal.
      const want = Math.atan2(zs * 0.9, toLine * 0.45);
      err = want - Math.atan2((tz - b.z) / d, (tx - b.x) / d);
    }
    const u = rotate((tx - b.x) / d, (tz - b.z) / d, err);
    const vy = kind === 'header' ? s.vy - Math.max(0, b.y - BALL_R) / flight : s.vy;
    return launch(u.x * s.vh, vy, u.z * s.vh, 0, m.rng.gauss() * 1.5, 0, tgt, kind, clamp(s.vh / 28, 0, 1));
  }

  // Fallback: tap it forward.
  return launch(dir.x * 8, 0, dir.z * 8, 0, 0, 0, -1, kind, 0.3);
}

function resolveShot(m: Match, p: Player, order: KickOrder, header: boolean): Launch {
  const b = m.ball.pos;
  const ad = m.attackDir(p.side);
  const gx = ad * HALF_L;
  const acc = p.stat.shooting / 100;
  const power = clamp(order.power, 0, 1);
  const hw = GOAL_W / 2;
  const sk = skillErr(m, p);
  const press = pressureErr(m, p);

  // Aim: stick across the goal picks a corner; otherwise the side the keeper leaves open.
  const keeper = m.keeperOf(p.side === 0 ? 1 : 0);
  const lateral = clamp(order.dirZ, -1, 1); // world z is lateral for both ends
  let aimZ: number;
  if (Math.abs(lateral) > 0.3) {
    aimZ = Math.sign(lateral) * (hw - 0.5);
  } else {
    // Where the keeper blocks the goal line, seen from the ball.
    let kLine = 0;
    if (keeper) {
      const kdx = keeper.pos.x - b.x;
      const t = Math.abs(kdx) > 0.3 ? clamp((gx - b.x) / kdx, 1, 5) : 1;
      kLine = clamp(b.z + (keeper.pos.z - b.z) * t, -hw, hw);
    }
    const gapR = hw - kLine;
    const gapL = kLine + hw;
    let dir = gapR >= gapL ? 1 : -1;
    // Similar gaps: mix it up (near post / far post) so keepers can't cheat.
    if (Math.abs(gapR - gapL) < 0.9 && m.rng.chance(0.4)) dir = -dir;
    aimZ = dir * (hw - 0.35 - m.rng.next() * 0.55);
    if (header) aimZ *= 0.75;
  }
  const d = Math.max(2, dist2(b.x, b.z, gx, aimZ));
  const composure = header ? 0.4 : 1;
  const errZ = (m.rng.gauss() * (0.82 + d * 0.066) * (1.3 - acc) * (0.6 + power * 0.6) * sk * press) / composure;
  const tz = aimZ + errZ;
  // Height at the line: placed shots stay low, blasted ones climb (and can fly over).
  const skew = Math.abs(m.rng.gauss()) * (1.15 - acc) * (0.35 + power) * 2.1 * sk * press;
  let h = header
    ? 0.3 + power * 0.8 + skew * 0.9 + m.rng.gauss() * 0.55
    : 0.25 + power * power * 1.25 + skew + m.rng.gauss() * 0.25;
  if (!header && b.y > 0.7) h += b.y * 0.35; // volleys fly
  h = Math.max(0.15, h);
  let speed = header ? 11 + power * 8 + acc * 3 : 15 + power * 16 * (0.78 + acc * 0.3);
  speed = Math.min(speed, 35);
  const dx = gx - b.x;
  const dz = tz - b.z;
  const dl = Math.hypot(dx, dz);
  const t = dl / (speed * 0.9);
  let vy = (h - b.y + 0.5 * GRAVITY * t * t) / t;
  vy = clamp(vy, header ? -6 : -2, 13);
  const ux = dx / dl;
  const uz = dz / dl;
  // A little natural curl so shots don't look like laser beams.
  const curl = m.rng.gauss() * 1.2;
  return launch(ux * speed, vy, uz * speed, 0, curl, 0, -1, header ? 'header' : 'shot', power);
}

/** Opponents (outfield) standing in the shooting lane from `p` to the middle of the goal. */
export function shotBlockers(m: Match, p: Player): number {
  const ad = m.attackDir(p.side);
  const gx = ad * HALF_L;
  let n = 0;
  for (const o of m.players) {
    if (o.side === p.side || o.isKeeper) continue;
    const { d, t } = pointSegDist(o.pos.x, o.pos.z, p.pos.x, p.pos.z, gx, clamp(p.pos.z * 0.2, -1.5, 1.5));
    if (t > 0.02 && t < 0.97 && d < 0.6 + t * 1.1) n += d < 0.5 ? 1 : 0.5;
  }
  return n;
}

function launch(
  vx: number, vy: number, vz: number,
  spinX: number, spinY: number, spinZ: number,
  target: number, kind: KickKind, power: number,
): Launch {
  return { vx, vy, vz, spinX, spinY, spinZ, target, kind, power };
}

const scratch = new Ball();
const scratchHits: BallHit[] = [];

/**
 * Is the ball's current flight going to end up in the net if nobody touches it? Runs the real
 * ball physics (drag, curl, posts) on a scratch ball, so shots off the woodwork don't count.
 */
export function onTarget(m: Match, side: number): boolean {
  const b = m.ball;
  const ad = m.attackDir(side as 0 | 1);
  if (b.vel.x * ad <= 0.5) return false;
  scratch.reset(b.pos.x, b.pos.z);
  scratch.pos.y = b.pos.y;
  scratch.vel.x = b.vel.x;
  scratch.vel.y = b.vel.y;
  scratch.vel.z = b.vel.z;
  scratch.spin.x = b.spin.x;
  scratch.spin.y = b.spin.y;
  scratch.spin.z = b.spin.z;
  for (let i = 0; i < 240; i++) {
    scratchHits.length = 0;
    scratch.step(1 / 60, scratchHits);
    if (scratch.inGoal !== 0) return scratch.inGoal === ad;
    if (Math.abs(scratch.pos.x) > HALF_L + 0.5 || scratch.hspeed() < 0.5) return false;
  }
  return false;
}

/** Approximate chance a shot from here goes in, used by the AI to decide when to shoot. */
export function shotQuality(x: number, z: number, ad: number): number {
  const gx = ad * HALF_L;
  const hw = GOAL_W / 2;
  const a1 = Math.atan2(-hw - z, gx - x);
  const a2 = Math.atan2(hw - z, gx - x);
  let width = Math.abs(a2 - a1);
  if (width > Math.PI) width = Math.PI * 2 - width;
  const d = dist2(x, z, gx, 0);
  return clamp(Math.pow(width / 0.8, 1.1) * Math.exp(-d / 21), 0, 0.85);
}
