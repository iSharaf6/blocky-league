import {
  AIR_DRAG, BALL_R, BOUNCE, GOAL_DEPTH, GOAL_H, GOAL_W, GRAVITY, HALF_L, MAGNUS,
  POST_R, ROLL_A, ROLL_B, SPIN_DECAY,
} from './constants';

export interface V3 { x: number; y: number; z: number }

export type BallHit =
  | { kind: 'post'; x: number; y: number; z: number; speed: number }
  | { kind: 'bounce'; speed: number }
  | { kind: 'net'; x: number; y: number; z: number; speed: number };

export class Ball {
  pos: V3 = { x: 0, y: BALL_R, z: 0 };
  vel: V3 = { x: 0, y: 0, z: 0 };
  spin: V3 = { x: 0, y: 0, z: 0 };
  /** Index of the player dribbling it, -1 when loose. */
  owner = -1;
  /** Keeper holding the ball in hands (ball is parked at their hands). */
  held = false;
  lastTouch = -1;
  lastTouchSide: -1 | 0 | 1 = -1;
  /** Which goal (+1 at +x, -1 at -x) the ball is currently inside, 0 when not in a net. */
  inGoal = 0;

  reset(x = 0, z = 0): void {
    this.pos.x = x;
    this.pos.y = BALL_R;
    this.pos.z = z;
    this.vel.x = this.vel.y = this.vel.z = 0;
    this.spin.x = this.spin.y = this.spin.z = 0;
    this.owner = -1;
    this.held = false;
    this.inGoal = 0;
  }

  get onGround(): boolean {
    return this.pos.y <= BALL_R + 0.02 && Math.abs(this.vel.y) < 0.6;
  }

  speed(): number {
    const v = this.vel;
    return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  }

  hspeed(): number {
    return Math.sqrt(this.vel.x * this.vel.x + this.vel.z * this.vel.z);
  }

  step(dt: number, hits: BallHit[]): void {
    if (this.held) return;
    const p = this.pos;
    const v = this.vel;
    const s = this.spin;
    const grounded = p.y <= BALL_R + 0.005 && Math.abs(v.y) < 0.9;

    if (grounded) {
      p.y = BALL_R;
      v.y = 0;
      const sh = Math.sqrt(v.x * v.x + v.z * v.z);
      if (sh > 1e-4) {
        const ns = Math.max(0, sh - (ROLL_A + ROLL_B * sh) * dt);
        const k = ns / sh;
        v.x *= k;
        v.z *= k;
      } else {
        v.x = v.z = 0;
      }
      // Grass scrubs spin off quickly once the ball is rolling.
      const sk = Math.exp(-SPIN_DECAY * 4 * dt);
      s.x *= sk; s.y *= sk; s.z *= sk;
    } else {
      v.y -= GRAVITY * dt;
      const sp = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
      const drag = AIR_DRAG * sp * dt;
      v.x -= v.x * drag;
      v.y -= v.y * drag;
      v.z -= v.z * drag;
      // Magnus: a = k * (spin x v)
      v.x += MAGNUS * (s.y * v.z - s.z * v.y) * dt;
      v.y += MAGNUS * (s.z * v.x - s.x * v.z) * dt;
      v.z += MAGNUS * (s.x * v.y - s.y * v.x) * dt;
      const sk = Math.exp(-SPIN_DECAY * dt);
      s.x *= sk; s.y *= sk; s.z *= sk;
    }

    p.x += v.x * dt;
    p.y += v.y * dt;
    p.z += v.z * dt;

    if (p.y < BALL_R) {
      p.y = BALL_R;
      if (v.y < -1.1) {
        const impact = -v.y;
        v.y = impact * BOUNCE;
        v.x *= 0.86;
        v.z *= 0.86;
        if (impact > 2.5) hits.push({ kind: 'bounce', speed: impact });
      } else {
        v.y = 0;
      }
    }

    this.collideFrame(hits);
    this.collideNet(hits);
  }

  /** Posts and crossbar as capsules; square voxel posts are drawn but round ones feel fairer. */
  private collideFrame(hits: BallHit[]): void {
    const p = this.pos;
    if (Math.abs(Math.abs(p.x) - HALF_L) > 1.2) return;
    const gx = p.x > 0 ? HALF_L : -HALF_L;
    const hw = GOAL_W / 2;
    const r = BALL_R + POST_R;
    // Two posts (vertical) and the bar (along z).
    for (let i = 0; i < 3; i++) {
      let cx: number, cy: number, cz: number;
      if (i < 2) {
        cx = gx;
        cz = i === 0 ? -hw : hw;
        cy = Math.min(Math.max(p.y, 0), GOAL_H);
      } else {
        cx = gx;
        cy = GOAL_H;
        cz = Math.min(Math.max(p.z, -hw), hw);
      }
      const dx = p.x - cx;
      const dy = p.y - cy;
      const dz = p.z - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < r * r && d2 > 1e-8) {
        const d = Math.sqrt(d2);
        const nx = dx / d, ny = dy / d, nz = dz / d;
        p.x = cx + nx * r;
        p.y = cy + ny * r;
        p.z = cz + nz * r;
        const vn = this.vel.x * nx + this.vel.y * ny + this.vel.z * nz;
        if (vn < 0) {
          const e = 1 + 0.62;
          this.vel.x -= e * vn * nx;
          this.vel.y -= e * vn * ny;
          this.vel.z -= e * vn * nz;
          this.spin.x *= 0.3; this.spin.y *= 0.3; this.spin.z *= 0.3;
          if (-vn > 2) hits.push({ kind: 'post', x: cx, y: cy, z: cz, speed: -vn });
        }
      }
    }
  }

  /** Keep a ball that went in bouncing around inside the net box. */
  private collideNet(hits: BallHit[]): void {
    const p = this.pos;
    const v = this.vel;
    const ax = Math.abs(p.x);
    const hw = GOAL_W / 2;
    if (this.inGoal === 0) {
      // Entering the goal mouth from the pitch side.
      if (ax > HALF_L + BALL_R * 0.2 && ax < HALF_L + GOAL_DEPTH && Math.abs(p.z) < hw && p.y < GOAL_H) {
        this.inGoal = p.x > 0 ? 1 : -1;
      } else if (ax > HALF_L && ax < HALF_L + GOAL_DEPTH + 0.3) {
        // Side netting / roof from the outside: bounce the ball away.
        const outsideSide = Math.abs(p.z) > hw && Math.abs(p.z) < hw + BALL_R && p.y < GOAL_H;
        const onRoof = Math.abs(p.z) < hw && p.y > GOAL_H && p.y < GOAL_H + BALL_R;
        if (outsideSide) {
          p.z = Math.sign(p.z) * (hw + BALL_R);
          v.z = Math.abs(v.z) * 0.25 * Math.sign(p.z);
          v.x *= 0.5;
        } else if (onRoof) {
          p.y = GOAL_H + BALL_R;
          v.y = Math.abs(v.y) * 0.25;
          v.x *= 0.6;
        }
      }
      return;
    }
    const sgn = this.inGoal;
    const back = HALF_L + GOAL_DEPTH - BALL_R;
    let hit = 0;
    if (ax > back) {
      p.x = sgn * back;
      hit = Math.max(hit, Math.abs(v.x));
      v.x = -v.x * 0.12;
      v.z *= 0.6;
      v.y *= 0.6;
    }
    const zl = hw - BALL_R;
    if (Math.abs(p.z) > zl) {
      p.z = Math.sign(p.z) * zl;
      hit = Math.max(hit, Math.abs(v.z));
      v.z = -v.z * 0.15;
      v.x *= 0.7;
    }
    const yl = GOAL_H - BALL_R;
    if (p.y > yl) {
      p.y = yl;
      hit = Math.max(hit, Math.abs(v.y));
      v.y = -Math.abs(v.y) * 0.1;
      v.x *= 0.7;
    }
    // Don't let it roll back out onto the pitch.
    if (ax < HALF_L + BALL_R) {
      p.x = sgn * (HALF_L + BALL_R);
      v.x = Math.abs(v.x) * 0.1 * sgn;
    }
    if (hit > 1.5) hits.push({ kind: 'net', x: p.x, y: p.y, z: p.z, speed: hit });
  }
}

/**
 * Distance a ground ball rolls while slowing from v0 to v1 under
 * dv/dt = -(A + B v). Closed form of ∫ v / (A + B v) dv.
 */
export function rollDistance(v0: number, v1: number): number {
  const a = ROLL_A;
  const b = ROLL_B;
  if (v0 <= v1) return 0;
  return (v0 - v1) / b - (a / (b * b)) * Math.log((a + b * v0) / (a + b * v1));
}

/** Initial speed so a ground pass covers `d` metres and still arrives at `vArrive`. */
export function groundPassSpeed(d: number, vArrive: number): number {
  let lo = vArrive;
  let hi = 60;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (rollDistance(mid, vArrive) < d) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Time for a ground ball to travel `d` metres from v0 (Infinity if it stops first). */
export function rollTime(v0: number, d: number): number {
  if (rollDistance(v0, 0.01) < d) return Infinity;
  // Solve for the speed at distance d, then time = ln((A+Bv0)/(A+Bv1))/B.
  let lo = 0;
  let hi = v0;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (rollDistance(v0, mid) > d) lo = mid;
    else hi = mid;
  }
  const v1 = (lo + hi) / 2;
  return Math.log((ROLL_A + ROLL_B * v0) / (ROLL_A + ROLL_B * v1)) / ROLL_B;
}

/**
 * Horizontal launch speed + vertical speed for a lofted ball that lands `d` metres away
 * after roughly `flight` seconds, simulated with the real drag so it lands where aimed.
 */
export function solveLob(d: number, flight: number, landHeight = BALL_R): { vh: number; vy: number } {
  const vy = (landHeight - BALL_R + 0.5 * GRAVITY * flight * flight) / flight;
  let lo = d / flight;
  let hi = lo * 2.5;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (simulateCarry(mid, vy, landHeight) < d) lo = mid;
    else hi = mid;
  }
  return { vh: (lo + hi) / 2, vy };
}

function simulateCarry(vh: number, vy: number, landHeight: number): number {
  const dt = 1 / 120;
  let x = 0;
  let y = BALL_R;
  let h = vh;
  let v = vy;
  for (let i = 0; i < 1200; i++) {
    v -= GRAVITY * dt;
    const sp = Math.sqrt(h * h + v * v);
    const drag = AIR_DRAG * sp * dt;
    h -= h * drag;
    v -= v * drag;
    x += h * dt;
    y += v * dt;
    if (v < 0 && y <= landHeight) return x;
  }
  return x;
}
