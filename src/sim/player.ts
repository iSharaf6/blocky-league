import { angleDiff, clamp, turnToward, wrapAngle } from '../core/math';
import { ACCEL, CONTROL_R, DECEL, DRIBBLE_MULT, JOG_SPEED, SPRINT_SPEED, STRIDE } from './constants';
import type { KickKind, PlayerDef, Role, Side } from './types';

export type PState =
  | 'move' // normal locomotion, can dribble
  | 'kick' // wind-up then strike
  | 'slide' // slide tackle
  | 'fallen' // on the floor after being tackled
  | 'stand' // getting back up
  | 'dive' // keeper dive
  | 'hold' // keeper holding the ball
  | 'throw' // throw-in / keeper throw wind-up
  | 'celebrate'
  | 'dejected';

/**
 * An intent to strike the ball. The actual launch velocity is solved at the moment of
 * contact (see actions.resolveKick) so first-time volleys aim from wherever the ball is.
 */
export interface KickOrder {
  kind: KickKind;
  /** World-space aim direction (stick or AI choice); zero = use facing. */
  dirX: number;
  dirZ: number;
  power: number; // 0..1
  /** Receiver chosen by the AI, or -1 to let the solver pick from the direction. */
  target: number;
  /** Optional explicit landing / aim point (AI through balls, clearances). */
  aimX?: number;
  aimZ?: number;
  /** Optional landing height for lofted balls (default: head height for lobs, grass for clears). */
  land?: number;
  /** Seconds this order stays valid while waiting for a loose ball to arrive. */
  expires: number;
  firstTime: boolean;
}

export class Player {
  pos = { x: 0, z: 0 };
  vel = { x: 0, z: 0 };
  facing = 0;
  state: PState = 'move';
  stateT = 0;

  // Controls, written every tick by the human controller or the AI.
  wantX = 0;
  wantZ = 0;
  sprint = false;
  faceTarget: number | null = null;

  stamina = 1;
  kickCooldown = 0;
  tackleCooldown = 0;
  order: KickOrder | null = null;

  // Keeper dive / jump physics.
  y = 0;
  vy = 0;
  diveDir = 0; // -1 / +1 relative to facing for animation
  // Animation bookkeeping (recorded for replays).
  runPhase = 0;
  kickT = 0; // 0..1 swing progress, drives the kicking leg
  kickLeg = 1; // 1 right, -1 left
  headerT = 0;
  celebrate = 0; // style index
  lean = 0;

  slideHit = false;

  // AI scratch state.
  aiT = 0;
  aiDirX = 1;
  aiDirZ = 0;
  runT = 0;
  running = false;
  /** Seconds this player has had the ball at their feet (reset on every new control). */
  ballT = 0;
  /** What the AI carrier is currently doing between decisions. */
  aiMode: 'dribble' | 'shield' = 'dribble';
  /** Kick id of the last ball this player already tried (and failed) to block. */
  blockKick = -1;
  /** Keeper: kick id of the cross last judged, and whether they decided to come for it. */
  claimKick = -1;
  claiming = false;
  /** Kick id of the last ball this player already decided whether to hit first time. */
  volleyKick = -1;
  /** Seconds left on a committed tackle attempt (pressing AI). */
  commitT = 0;
  /** How long the AI carrier means to keep the ball before moving it on (set on each control). */
  holdT = 1;
  /** Seconds spent jockeying the current carrier (presser escalates to a tackle over time). */
  jockeyT = 0;
  /** Wrong-footed by a take-on: slower to react for this long. */
  slowT = 0;

  readonly role: Role;
  readonly isKeeper: boolean;
  jog: number;
  top: number;

  constructor(
    readonly idx: number,
    readonly side: Side,
    readonly slot: number,
    public def: PlayerDef,
  ) {
    this.role = def.role;
    this.isKeeper = slot === 0;
    const pace = def.stats.pace / 100;
    this.jog = JOG_SPEED * (0.86 + pace * 0.22);
    this.top = SPRINT_SPEED * (0.82 + pace * 0.26);
  }

  get stat() {
    return this.def.stats;
  }

  /** Where the ball sits when this player dribbles. */
  footX(): number {
    return this.pos.x + Math.cos(this.facing) * this.footReach();
  }

  footZ(): number {
    return this.pos.z + Math.sin(this.facing) * this.footReach();
  }

  footReach(): number {
    const sp = Math.sqrt(this.vel.x * this.vel.x + this.vel.z * this.vel.z);
    return 0.52 + Math.min(sp, 8) * 0.045;
  }

  controlRadius(): number {
    return CONTROL_R + (this.stat.dribbling / 100) * 0.18;
  }

  speed(): number {
    return Math.sqrt(this.vel.x * this.vel.x + this.vel.z * this.vel.z);
  }

  setState(s: PState): void {
    this.state = s;
    this.stateT = 0;
  }

  canAct(): boolean {
    return this.state === 'move';
  }

  step(dt: number, dribbling: boolean): void {
    this.stateT += dt;
    this.kickCooldown = Math.max(0, this.kickCooldown - dt);
    this.tackleCooldown = Math.max(0, this.tackleCooldown - dt);
    this.slowT = Math.max(0, this.slowT - dt);

    switch (this.state) {
      case 'move':
        this.locomote(dt, dribbling);
        break;
      case 'kick':
      case 'throw':
        this.brake(dt, 10);
        this.kickT = Math.min(1, this.kickT + dt / 0.34);
        if (this.stateT > 0.34) {
          this.setState('move');
          this.kickT = 0;
        }
        break;
      case 'slide':
        this.brake(dt, this.stateT < 0.35 ? 1.2 : 6);
        if (this.stateT > 0.75) this.setState('stand');
        break;
      case 'fallen':
        this.brake(dt, 5);
        if (this.stateT > 1.05) this.setState('stand');
        break;
      case 'stand':
        this.brake(dt, 12);
        if (this.stateT > 0.38) this.setState('move');
        break;
      case 'dive':
        this.y += this.vy * dt;
        this.vy -= 14 * dt;
        if (this.y <= 0) {
          this.y = 0;
          this.vy = 0;
          this.brake(dt, 6);
        }
        if (this.stateT > 1.25) {
          this.setState('stand');
          this.y = 0;
        }
        break;
      case 'hold':
        this.brake(dt, 10);
        break;
      case 'celebrate':
      case 'dejected':
        this.locomote(dt, false);
        break;
    }

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    if (this.state !== 'dive' && this.y > 0) {
      this.y = Math.max(0, this.y + this.vy * dt);
      this.vy -= 18 * dt;
      if (this.y <= 0) this.vy = 0;
    }

    const sp = this.speed();
    this.runPhase = (this.runPhase + (sp * dt) / (STRIDE * 2)) % 1;

    // Stamina: sprinting drains, everything else recovers.
    const sprinting = this.sprint && sp > this.jog * 0.95;
    const drain = 0.055 * (1.3 - this.stat.stamina / 100);
    this.stamina = clamp(this.stamina + (sprinting ? -drain : 0.03) * dt, 0.15, 1);
    if (this.headerT > 0) this.headerT = Math.max(0, this.headerT - dt / 0.45);
  }

  private locomote(dt: number, dribbling: boolean): void {
    let max = this.sprint ? this.top * (0.72 + 0.28 * this.stamina) : this.jog;
    if (dribbling) max *= DRIBBLE_MULT * (0.9 + (this.stat.dribbling / 100) * 0.12);
    let tx = this.wantX;
    let tz = this.wantZ;
    const tl = Math.sqrt(tx * tx + tz * tz);
    if (tl > 1) {
      tx /= tl;
      tz /= tl;
    }
    // Backpedalling while facing a target (jockeying) is slower than running forwards.
    if (this.faceTarget !== null && tl > 0.05) {
      const back = -(Math.cos(this.facing) * tx + Math.sin(this.facing) * tz) / Math.min(tl, 1);
      if (back > 0.3) max *= 1 - 0.2 * Math.min(1, (back - 0.3) / 0.5);
    }
    if (this.slowT > 0) max *= 0.55;
    tx *= max;
    tz *= max;

    // Sharp turns at speed bleed momentum like a real plant-and-turn.
    const sp = this.speed();
    let accel = tl > 0.05 ? ACCEL : DECEL;
    if (this.slowT > 0) accel *= 0.5;
    if (sp > 2 && tl > 0.05) {
      const cur = Math.atan2(this.vel.z, this.vel.x);
      const want = Math.atan2(tz, tx);
      const turn = Math.abs(angleDiff(cur, want));
      if (turn > 1.6) accel = DECEL * 1.1;
    }
    const dx = tx - this.vel.x;
    const dz = tz - this.vel.z;
    const dl = Math.sqrt(dx * dx + dz * dz);
    const step = accel * dt;
    if (dl <= step) {
      this.vel.x = tx;
      this.vel.z = tz;
    } else {
      this.vel.x += (dx / dl) * step;
      this.vel.z += (dz / dl) * step;
    }

    const nsp = this.speed();
    const turnRate = dribbling ? 9 - nsp * 0.5 : 13 - nsp * 0.7;
    let face: number | null = this.faceTarget;
    if (face === null && nsp > 0.35) face = Math.atan2(this.vel.z, this.vel.x);
    if (face !== null) this.facing = turnToward(this.facing, face, Math.max(4, turnRate) * dt);
    this.facing = wrapAngle(this.facing);
    // Lean into acceleration for the animation.
    this.lean += ((nsp / this.top) * 0.35 - this.lean) * Math.min(1, dt * 6);
  }

  brake(dt: number, rate: number): void {
    const k = Math.exp(-rate * dt);
    this.vel.x *= k;
    this.vel.z *= k;
  }
}
