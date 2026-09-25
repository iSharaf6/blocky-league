import { clamp, dist2 } from '../core/math';
import { BALL_R, BOX_DEPTH, BOX_W, GOAL_H, GOAL_W, GRAVITY, HALF_L } from './constants';
import type { Match } from './match';
import type { Player } from './player';

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
      const zc = b.pos.z + b.vel.z * t;
      const yc = Math.max(BALL_R, b.pos.y + b.vel.y * t - 0.5 * GRAVITY * t * t);
      const onFrame = Math.abs(zc) < GOAL_W / 2 + 0.9 && yc < GOAL_H + 0.6;
      if (onFrame) {
        const reaction = clamp(0.3 - keeping * 0.2 - m.keeperBonus(k.side), 0.07, 0.34);
        const lateral = zc - k.pos.z;
        if (Math.abs(lateral) < 0.55 && yc < 1.9) {
          // Straight at them: shuffle and let the catch check do the work.
          k.wantX = 0;
          k.wantZ = clamp(lateral * 3, -1, 1);
          k.sprint = false;
          return;
        }
        if (m.shotClock >= reaction) {
          const maxDive = 3.6 + keeping * 2.6 + m.keeperBonus(k.side) * 6;
          const need = Math.abs(lateral) / Math.max(t, 0.12);
          const vz = Math.sign(lateral) * Math.min(need * 1.05, maxDive);
          k.setState('dive');
          k.vel.z = vz;
          k.vel.x = ad * 0.8;
          k.vy = clamp(yc * 2.4 - 0.4, 1.2, 5.6);
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

  // ---- Claim loose balls in the box --------------------------------------------
  const ballInBox = inOwnBox(m, k.side, b.pos.x, b.pos.z);
  if (b.owner < 0 && ballInBox && b.hspeed() < 12) {
    const kd = dist2(k.pos.x, k.pos.z, b.pos.x, b.pos.z);
    let rival = Infinity;
    for (const o of m.players) {
      if (o.side === k.side) continue;
      rival = Math.min(rival, dist2(o.pos.x, o.pos.z, b.pos.x, b.pos.z));
    }
    if (kd < rival * 0.9 || kd < 3) {
      moveTo(k, b.pos.x + b.vel.x * 0.25, b.pos.z + b.vel.z * 0.25, true);
      return;
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

function nobodyCovering(m: Match, k: Player, c: Player): boolean {
  for (const o of m.players) {
    if (o.side !== k.side || o === k) continue;
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
