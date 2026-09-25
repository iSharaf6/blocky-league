import { clamp, dist2 } from '../core/math';
import { BALL_R, BOX_DEPTH, BOX_W, GOAL_H, GOAL_W, GRAVITY, HALF_L, MAGNUS, SIX_W, WALL_DIST } from './constants';
import type { Match } from './match';
import type { Player } from './player';
import type { Side } from './types';

type RestartLike = { kind: string; side: Side; x: number; z: number };

/**
 * Where a player may stand while a penalty is taken: outside the penalty area and at least ten
 * yards from the spot (the arc). Returns (x, z) moved to the nearest legal point.
 */
export function clearOfPenalty(m: Match, r: RestartLike, x: number, z: number, margin = 0.6): { x: number; z: number } {
  const ad = m.attackDir(r.side);
  const gx = ad * HALF_L;
  let px = x;
  let pz = z;
  const front = BOX_DEPTH + margin - Math.abs(px - gx);
  const side = BOX_W / 2 + margin - Math.abs(pz);
  if (front > 0 && side > 0) {
    if (front <= side) px = gx - ad * (BOX_DEPTH + margin);
    else pz = (Math.sign(pz) || 1) * (BOX_W / 2 + margin);
  }
  const min = WALL_DIST + 0.4;
  const d = dist2(px, pz, r.x, r.z);
  if (d < min) {
    if (d < 0.05) {
      px = r.x - ad * min;
      pz = r.z;
    } else {
      px = r.x + ((px - r.x) / d) * min;
      pz = r.z + ((pz - r.z) / d) * min;
    }
  }
  return { x: px, z: pz };
}

/** A free kick close and central enough to shoot from: the defence puts up a wall. */
export function isDirectFreeKick(m: Match, r: RestartLike): boolean {
  if (r.kind !== 'freekick') return false;
  const gx = m.attackDir(r.side) * HALF_L;
  return dist2(r.x, r.z, gx, 0) < 30 && Math.abs(r.z) < 14;
}

export interface WallPlan {
  /** Wall spots, shoulder to shoulder from the near-post end inwards. */
  spots: { x: number; z: number }[];
  /** Where the keeper stands: covering the part of the goal the wall doesn't hide. */
  keeper: { x: number; z: number };
}

/** Spacing between wall players (the models are ~1 m wide, so they stand shoulder to shoulder). */
export const WALL_GAP = 0.9;

/**
 * The wall for a direct free kick: 9.15 m from the ball, square to the ball-goal line, 4 men when
 * it's close (3 further out). The end man lines up just outside the near post; the keeper takes
 * the rest of the goal, from the wall's inside edge to the far post.
 */
export function freeKickWall(m: Match, r: RestartLike): WallPlan {
  const gx = m.attackDir(r.side) * HALF_L;
  const hw = GOAL_W / 2;
  const bx = r.x;
  const bz = r.z;
  const dg = Math.max(1, dist2(bx, bz, gx, 0));
  const ux = (gx - bx) / dg;
  const uz = -bz / dg;
  const wx = -uz;
  const wz = ux;
  const n = dg < 24 ? 4 : 3;
  const near = Math.sign(bz) || 1;
  // Lateral offset, at wall distance, of the line from the ball to (gx, z).
  const latAt = (z: number) => {
    const vx = gx - bx;
    const vz = z - bz;
    return ((vx * wx + vz * wz) * WALL_DIST) / Math.max(0.1, vx * ux + vz * uz);
  };
  const sNear = latAt(near * hw);
  const sFar = latAt(-near * hw);
  const out = Math.sign(sNear - sFar) || 1;
  const s0 = sNear + out * 0.35;
  const cx = bx + ux * WALL_DIST;
  const cz = bz + uz * WALL_DIST;
  const spots: { x: number; z: number }[] = [];
  for (let i = 0; i < n; i++) {
    const sl = s0 - out * i * WALL_GAP;
    spots.push({ x: cx + wx * sl, z: cz + wz * sl });
  }
  // Where the line past the wall's inside shoulder meets the goal line.
  const sIn = s0 - out * ((n - 1) * WALL_GAP + 0.45);
  const ex = cx + wx * sIn;
  const ez = cz + wz * sIn;
  const zIn = bz + (ez - bz) * ((gx - bx) / (Math.abs(ex - bx) > 1e-3 ? ex - bx : 1e-3));
  const zFar = -near * hw;
  // The wall hides the whole goal from here: stand just off-centre towards the far post.
  const kz = (zIn - zFar) * near <= 0.6 ? zFar * 0.3 : (zIn + zFar) / 2;
  return { spots, keeper: { x: gx - Math.sign(gx) * 0.9, z: clamp(kz, -hw + 0.6, hw - 0.6) } };
}

/**
 * Sideways drift still to come from the ball's sidespin (Magnus), over `t` seconds: a keeper reads
 * part of a curler's bend as it comes.
 */
export function curlDrift(m: Match, t: number): number {
  const b = m.ball;
  const az = MAGNUS * (b.spin.x * b.vel.y - b.spin.y * b.vel.x);
  // Spin fades as it flies (SPIN_DECAY ~0.7/s): ~0.8 of the undecayed drift over a typical shot.
  return 0.5 * az * t * t * Math.exp(-0.25 * t);
}

/** Is the point inside the penalty area that `side` defends? */
export function inOwnBox(m: Match, side: 0 | 1, x: number, z: number): boolean {
  const gx = -m.attackDir(side) * HALF_L;
  return Math.abs(x - gx) < BOX_DEPTH && Math.abs(z) < BOX_W / 2;
}

/**
 * Keeper brain: positioning on the ball–goal line, shot reading with a reaction delay,
 * dives with limited reach, rushing out to smother, and distribution after a catch.
 */
export function updateKeeper(m: Match, k: Player, dt: number): void {
  const b = m.ball;
  const ad = m.attackDir(k.side);
  const gx = -ad * HALF_L;
  const keeping = k.stat.keeping / 100;
  k.faceTarget = null;

  if (k.state === 'hold') {
    b.pos.x = k.pos.x + Math.cos(k.facing) * 0.35;
    b.pos.z = k.pos.z + Math.sin(k.facing) * 0.35;
    b.pos.y = 1.05;
    b.vel.x = b.vel.y = b.vel.z = 0;
    k.facing = ad > 0 ? 0 : Math.PI;
    // Human keepers wait for input (handled by the match); AI keepers distribute.
    if (!m.isHumanControlled(k) && k.stateT > m.keeperHoldTime) m.keeperDistribute(k);
    else if (m.isHumanControlled(k) && k.stateT > 4) m.keeperDistribute(k);
    return;
  }
  if (k.state !== 'move') return;

  // ---- Penalty against us: on the line, in the middle of the goal.
  const r = m.restart;
  if ((m.phase === 'restart' || m.phase === 'out') && r && r.kind === 'penalty' && r.side !== k.side) {
    moveTo(k, gx + ad * 0.3, 0, false);
    k.faceTarget = Math.atan2(r.z - k.pos.z, r.x - k.pos.x);
    return;
  }

  // ---- Free kick against us: take the side of the goal the wall doesn't cover.
  if ((m.phase === 'restart' || m.phase === 'out') && r && r.side !== k.side && isDirectFreeKick(m, r)) {
    const w = freeKickWall(m, r);
    moveTo(k, w.keeper.x, w.keeper.z, false);
    k.faceTarget = Math.atan2(r.z - k.pos.z, r.x - k.pos.x);
    return;
  }

  // ---- Ball at our feet (back-pass): move it on quickly.
  if (b.owner === k.idx && !b.held) {
    k.wantX = k.wantZ = 0;
    k.aiT -= dt;
    if (k.aiT <= 0 && !k.order) {
      k.aiT = 0.5;
      m.keeperClear(k);
    }
    return;
  }
  k.aiT = 0.35 + m.rng.next() * 0.4;

  // ---- Shot reading --------------------------------------------------------
  const toward = b.vel.x * -ad; // positive when heading to our goal
  if (b.owner < 0 && !b.held && toward > 7 && m.shotClock < 1.6) {
    const t = (k.pos.x - b.pos.x) / b.vel.x;
    if (t > 0 && t < 1.6) {
      // A curler's bend is only half read.
      const zc = b.pos.z + b.vel.z * t + curlDrift(m, t) * 0.5;
      const yc = Math.max(BALL_R, b.pos.y + b.vel.y * t - 0.5 * GRAVITY * t * t);
      const onFrame = Math.abs(zc) < GOAL_W / 2 + 0.9 && yc < GOAL_H + 0.6;
      if (onFrame) {
        const reaction = clamp(0.33 - keeping * 0.2 - m.keeperBonus(k.side), 0.09, 0.37);
        const lateral = zc - k.pos.z;
        if (Math.abs(lateral) < 0.55 && yc < 1.9) {
          // Straight at them: shuffle and let the catch check do the work.
          k.wantX = 0;
          k.wantZ = clamp(lateral * 3, -1, 1);
          k.sprint = false;
          return;
        }
        if (m.shotClock >= reaction) {
          // Lateral dive speed (m/s): enough for the corners from range, not from close in.
          const maxDive = (4.6 + keeping * 3 + m.keeperBonus(k.side) * 8) * 0.72;
          const need = Math.abs(lateral) / Math.max(t, 0.12);
          const vz = Math.sign(lateral) * Math.min(need * 1.05, maxDive);
          k.setState('dive');
          k.vel.z = vz;
          k.vel.x = ad * 0.8;
          // Low shots: a skidding dive; high shots: a proper leap (peak ~0.5-0.9 m).
          k.vy = yc > 0.6 ? clamp(yc * 2.6 + 0.6, 3.2, 6.2) : clamp(yc * 2.4, 1.4, 3);
          k.y = 0.01;
          // +1 = dive to the keeper's own right (facing +x, right is +z).
          k.diveDir = Math.sign(lateral) * (Math.cos(k.facing) >= 0 ? 1 : -1);
          return;
        }
        // Still reacting: set the feet.
        k.wantX = k.wantZ = 0;
        return;
      }
    }
  }

  // ---- Crosses: come and claim high balls dropping into the goal area --------------
  if (b.owner < 0 && !b.held && m.shotClock > 0.6 && m.kickSide !== k.side && m.sinceKick < 3.5) {
    const c = crossDrop(m, k);
    if (c) {
      if (k.claimKick !== m.kickId) {
        k.claimKick = m.kickId;
        const tK = dist2(k.pos.x, k.pos.z, c.x, c.z) / (k.top * 0.95) + 0.12;
        // Traffic around where it drops (a packed six-yard box at a corner, runners on their way in)
        // makes keepers stay on their line.
        let crowd = 0;
        for (const o of m.players) {
          if (!o.isKeeper && !o.sentOff && dist2(o.pos.x, o.pos.z, c.x, c.z) < 5) crowd++;
        }
        const traffic = clamp(1.1 - crowd * 0.12, 0.3, 1);
        // A set-piece delivery into a loaded box is mostly left to the defenders.
        const sp = m.setPieceKick === m.kickId ? 0.4 : 1;
        k.claiming = tK < c.t + 0.08 && m.rng.chance((0.5 + keeping * 0.35 + m.keeperBonus(k.side) * 2) * traffic * sp);
      }
      if (k.claiming) {
        moveTo(k, c.x, c.z, true);
        k.faceTarget = Math.atan2(b.pos.z - k.pos.z, b.pos.x - k.pos.x);
        // Leap for it as it arrives.
        if (k.y === 0 && b.pos.y > 1.9 && dist2(k.pos.x, k.pos.z, b.pos.x, b.pos.z) < 2) {
          k.vy = 4;
          k.y = 0.01;
        }
        return;
      }
    } else {
      k.claiming = false;
    }
  } else {
    k.claiming = false;
  }

  // ---- Sweep up loose balls we reach first ------------------------------------------
  if (b.owner < 0 && !b.held && m.shotClock > 0.5) {
    const toward = b.vel.x * -ad;
    const near = dist2(b.pos.x, b.pos.z, gx, 0) < BOX_DEPTH + 14;
    if (near && (toward > 1 || inOwnBox(m, k.side, b.pos.x, b.pos.z)) && b.hspeed() < 18) {
      const i = reach(m, k);
      if (inOwnBox(m, k.side, i.x, i.z)) {
        let rivalT = Infinity;
        for (const o of m.players) {
          if (o.side === k.side || o.sentOff) continue;
          rivalT = Math.min(rivalT, reach(m, o).t);
        }
        const kd = dist2(k.pos.x, k.pos.z, b.pos.x, b.pos.z);
        if (i.t < rivalT - 0.12 || kd < 2.5) {
          moveTo(k, i.x, i.z, true);
          return;
        }
      }
    }
  }

  // ---- 1v1: rush the carrier ----------------------------------------------------
  if (b.owner >= 0) {
    const c = m.players[b.owner];
    if (c.side !== k.side) {
      const cd = dist2(c.pos.x, c.pos.z, gx, 0);
      const kd = dist2(k.pos.x, k.pos.z, c.pos.x, c.pos.z);
      if (cd < 15 && Math.abs(c.pos.z) < BOX_W / 2 - 2 && kd < 9 && nobodyCovering(m, k, c)) {
        moveTo(k, c.pos.x - ad * 0.8, c.pos.z, true);
        return;
      }
    }
  }

  // ---- Positioning on the angle -----------------------------------------------
  const bx = b.pos.x;
  const bz = b.pos.z;
  const dx = bx - gx;
  const dz = bz;
  const dd = Math.max(0.1, Math.hypot(dx, dz));
  const dOut = clamp(0.7 + dd * 0.055, 0.7, 3.4);
  let tx = gx + (dx / dd) * dOut;
  let tz = (dz / dd) * dOut;
  // Keep the near post covered.
  tz = clamp(tz + bz * 0.04, -GOAL_W / 2 + 0.45, GOAL_W / 2 - 0.45);
  if (Math.abs(tx - gx) < 0.5) tx = gx + ad * 0.5;
  moveTo(k, tx, tz, false);
  k.faceTarget = Math.atan2(bz - k.pos.z, bx - k.pos.x);
}

/** Where a lofted ball first drops to catchable height inside the keeper's claiming area. */
function crossDrop(m: Match, k: Player): { x: number; z: number; t: number } | null {
  const b = m.ball;
  if (b.pos.y < 1 && b.vel.y < 1.5) return null;
  const gx = -m.attackDir(k.side) * HALF_L;
  let i = 0;
  for (const s of m.ballPath) {
    i++;
    if (s.y <= 2.8 && Math.abs(s.x - gx) < 6.5 && Math.abs(s.z) < SIX_W / 2 + 1.5) {
      return s.y >= 0.9 ? { x: s.x, z: s.z, t: s.t } : null;
    }
    if (s.y < 0.4 && i > 4) return null; // lands before it reaches us
  }
  return null;
}

/** Earliest point on the predicted ball path that `p` can get to (ground/low balls). */
function reach(m: Match, p: Player): { x: number; z: number; t: number } {
  const path = m.ballPath;
  const top = p.top * 0.92;
  for (const s of path) {
    if (s.y > (p.isKeeper ? 2.6 : 2.1)) continue;
    const d = Math.max(0, dist2(p.pos.x, p.pos.z, s.x, s.z) - 0.55);
    if (d / top + 0.12 <= s.t) return s;
  }
  const last = path[path.length - 1];
  return { x: last.x, z: last.z, t: Math.max(last.t, dist2(p.pos.x, p.pos.z, last.x, last.z) / top) };
}

function nobodyCovering(m: Match, k: Player, c: Player): boolean {
  for (const o of m.players) {
    if (o.side !== k.side || o === k || o.sentOff) continue;
    if (dist2(o.pos.x, o.pos.z, c.pos.x, c.pos.z) < 2.2) return false;
  }
  return true;
}

function moveTo(p: Player, x: number, z: number, urgent: boolean): void {
  const dx = x - p.pos.x;
  const dz = z - p.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.15) {
    p.wantX = p.wantZ = 0;
    p.sprint = false;
    return;
  }
  const f = Math.min(1, d / (urgent ? 1 : 2.5));
  p.wantX = (dx / d) * f;
  p.wantZ = (dz / d) * f;
  p.sprint = urgent || d > 6;
}
