import { clamp, dist2, pointSegDist } from '../core/math';
import { groundPassSpeed, rollTime, solveLob } from './ball';
import { BALL_R, GOAL_H, GOAL_W, GRAVITY, HALF_L, HALF_W } from './constants';
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

function passError(p: Player, m: Match, scale: number): number {
  const acc = p.stat.passing / 100;
  return m.rng.gauss() * (1.05 - acc) * 0.075 * scale;
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
        const arrive = clamp(3.8 + d * 0.11, 4, 9);
        v0 = Math.min(groundPassSpeed(d, arrive), 30);
        const t = Math.min(rollTime(v0, d), 3);
        tx = r.pos.x + r.vel.x * t * 0.85;
        tz = r.pos.z + r.vel.z * t * 0.85;
      }
      tx = clamp(tx, -HALF_L + 1, HALF_L - 1);
      tz = clamp(tz, -HALF_W + 0.8, HALF_W - 0.8);
      const d = dist2(b.x, b.z, tx, tz);
      if (throwIn) {
        const flight = clamp(0.45 + d / 30, 0.5, 1.1);
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
    const v0 = Math.min(groundPassSpeed(d, 2.6), 30);
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
    const land = kind === 'clear' ? BALL_R : 1.3;
    const s = solveLob(d, flight, land);
    const err = passError(p, m, kind === 'clear' ? 2.2 : 1.4);
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

  // Aim: stick across the goal picks a corner; otherwise go away from the keeper.
  const keeper = m.keeperOf(p.side === 0 ? 1 : 0);
  const lateral = clamp(order.dirZ * ad * ad, -1, 1); // world z is lateral for both ends
  let aimZ: number;
  if (Math.abs(lateral) > 0.3) {
    aimZ = Math.sign(lateral) * (hw - 0.55);
  } else {
    const kz = keeper ? keeper.pos.z : 0;
    const away = kz > b.z * 0.15 ? -1 : 1;
    aimZ = away * (hw - 0.8);
  }
  const d = Math.max(2, dist2(b.x, b.z, gx, aimZ));
  const composure = header ? 0.75 : 1;
  const errZ = m.rng.gauss() * (0.25 + d * 0.035) * (1.15 - acc) * (0.55 + power * 0.7) / composure;
  const tz = aimZ + errZ;
  // Height at the line: placed shots stay low, blasted ones climb (and can fly over).
  const skew = Math.abs(m.rng.gauss()) * (1.1 - acc) * power * 1.6;
  let h = header ? 0.35 + power * 0.9 + skew * 0.5 : 0.3 + power * power * 1.55 + skew;
  if (!header && b.y > 0.7) h += b.y * 0.35; // volleys fly
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
  const curl = m.rng.gauss() * 1.2 + (order.dirX !== 0 || order.dirZ !== 0 ? 0 : 0);
  return launch(ux * speed, vy, uz * speed, 0, curl, 0, -1, header ? 'header' : 'shot', power);
}

function launch(
  vx: number, vy: number, vz: number,
  spinX: number, spinY: number, spinZ: number,
  target: number, kind: KickKind, power: number,
): Launch {
  return { vx, vy, vz, spinX, spinY, spinZ, target, kind, power };
}

/** Is the shot's current trajectory going to end up between the posts? */
export function onTarget(m: Match, side: number): boolean {
  const b = m.ball;
  const ad = m.attackDir(side as 0 | 1);
  const gx = ad * HALF_L;
  if (b.vel.x * ad <= 0.5) return false;
  const t = (gx - b.pos.x) / b.vel.x;
  if (t < 0 || t > 3) return false;
  const z = b.pos.z + b.vel.z * t;
  const y = b.pos.y + b.vel.y * t - 0.5 * GRAVITY * t * t;
  return Math.abs(z) < GOAL_W / 2 + 0.1 && y < GOAL_H + 0.1;
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
