import type { CelebrationId } from '../core/save';
import { clamp, wrapAngle } from '../core/math';
import { PF } from '../game/replay';
import { HALF_L, HALF_W, STRIDE } from '../sim/constants';
import { CELEB, PSTATE } from './characters';

/**
 * Goal choreography for the iconic celebrations (the owner: "more iconic like backflips or other team
 * celebrations"). The sim keeps running its own celebration (the scorer's sprint to the corner flag, the mob
 * chasing him); this rig takes over the DRAWN frame for the scoring side's outfield players while the goal
 * phase lasts, so the sim, its frames and the replays stay untouched. It moves the dancers itself (a small
 * kinematic mover), and writes their position, facing, state, the move's clock (stateT), its 0..1 progress or
 * bank (kickT) and the pose style (characters.CELEB) into the frame MatchView.apply is about to draw.
 *
 * Timeline (s from the goal): the camera stays wide for ~0.7 s, then cuts to the scorer; each signature moment
 * (the slide, the flip, the pile) lands after that cut, and `holdS` keeps the replay / kick-off off until it has.
 */

/** Who the rig moves: the scorer (role 0), the mob that joins in (1..4, by distance) and the rest (-1). */
interface Dancer {
  idx: number;
  role: number;
  x: number;
  z: number;
  y: number;
  vx: number;
  vz: number;
  facing: number;
  runPhase: number;
  speed: number;
  /** Pose style (characters.CELEB), the move's clock and its progress / bank. */
  style: number;
  t: number;
  prog: number;
  /** Per-move scratch: arrival flag, the jump's start clock, a stack slot. */
  arrived: boolean;
  jumpT: number;
  slot: number;
}

export interface CelebCue {
  kind: 'spray' | 'whoosh' | 'land' | 'thud' | 'roar';
  x: number;
  z: number;
  /** Heading unit vector (a spray trails behind it). */
  ux: number;
  uz: number;
}

/** The AI picks one of these at random (the human's is chosen in the settings). */
export const AI_CELEBRATIONS: readonly CelebrationId[] = ['classic', 'knee', 'shush', 'plane'];

/** How long each celebration wants before the replay / kick-off (the classic keeps the session's defaults). */
const HOLD_S: Record<CelebrationId, number> = { classic: 0, knee: 3.4, shush: 3.1, plane: 3.3, robot: 3.3, backflip: 3.3, pile: 3.5 };

const SPRINT = 8.6;
const JOG = 5.2;
const TO_CAMERA = Math.PI / 2;
/** Backflip: two steps, a wind-up crouch, 0.7 s in the air (v0 6.3 m/s under 18 m/s^2: 1.1 m apex), the landing. */
const FLIP_RUN_S = 0.5;
const FLIP_JUMP_AT = 0.95;
const FLIP_AIR_S = 0.7;
const FLIP_V0 = 6.3;
const FLIP_G = 18;
const FLIP_LAND_S = 0.4;
/** Knee slide: the sprint's length before he drops, the slide's length. */
const SLIDE_AFTER_M = 4;
const SLIDE_S = 1.3;
/** Pile-on: the drop, each mate's leap onto the stack, a body's thickness in the stack. */
const PILE_DROP_AT = 0.55;
const PILE_DROP_S = 0.35;
const PILE_LEAP_S = 0.42;
const PILE_STEP = 0.31;

export class CelebrationRig {
  id: CelebrationId = 'classic';
  active = false;
  hero = -1;
  /** Seconds the replay (or the kick-off) waits for this celebration's moment (0: the session's defaults). */
  holdS = 0;
  /** The scorer's drawn velocity (the celebrate camera leads him by it). */
  heroVx = 0;
  heroVz = 0;
  onCue: ((c: CelebCue) => void) | null = null;
  /**
   * Which way the celebrate camera should treat as the scorer's "front" (CamFocus.groupFacing) while a move
   * wants a particular angle: the backflip is filmed in profile, from the main-stand side. Undefined: the
   * camera's own choice.
   */
  camFacing: number | undefined = undefined;
  private dancers: Dancer[] = [];
  private t = 0;
  /** The scorer's opening heading (towards the pitch from the goal he scored at) and its unit vector. */
  private dir = 0;
  private ux = 1;
  private uz = 0;
  /** Where he started, and the walk's end for the shush / the stack's centre for the pile. */
  private sx = 0;
  private sz = 0;
  private tx = 0;
  private tz = 0;
  private slideAt = -1;
  private landed = 0;
  private camX = 0;
  private camZ = 60;
  /** The robot row: its facing (towards the lens as the row formed), NaN until then. */
  private rowFace = NaN;
  /** The aeroplane's flight path (x, z, t) for the line behind him. */
  private trail: number[] = [];
  private cue: CelebCue = { kind: 'spray', x: 0, z: 0, ux: 1, uz: 0 };

  /**
   * Take over the scoring side's celebrating outfield players (the scorer first in `cast`, or `hero` names
   * him). `goalSign` is the end he scored at (sign of x). The sim positions are the starting ones.
   */
  begin(
    id: CelebrationId, hero: number,
    cast: { idx: number; x: number; z: number; facing: number; vx: number; vz: number; runPhase: number }[],
    goalSign: number,
  ): void {
    this.end();
    const h = cast.find((c) => c.idx === hero);
    if (!h || id === 'classic') return;
    this.id = id;
    this.hero = hero;
    this.active = true;
    this.holdS = HOLD_S[id];
    this.t = 0;
    this.landed = 0;
    this.slideAt = -1;
    this.rowFace = NaN;
    this.trail.length = 0;
    this.sx = h.x;
    this.sz = h.z;
    // Away from the goal he scored at, turned a third of the way towards the camera side so the moves read
    // three-quarter on; the aeroplane and the shush pick their own way.
    const sign = goalSign >= 0 ? 1 : -1;
    this.dir = sign > 0 ? Math.PI - 0.5 : 0.5;
    if (id === 'shush') {
      // The nearest stand: the byline behind the goal he scored at, unless a touchline is nearer.
      const dz = HALF_W - Math.abs(h.z);
      const dxEnd = HALF_L - Math.abs(h.x);
      // (He stops ~5 m short of the line: room for the lens to get in front of him inside the boards.)
      if (dxEnd <= dz) {
        this.tx = sign * (HALF_L - 5);
        this.tz = clamp(h.z, -HALF_W + 6, HALF_W - 6);
      } else {
        this.tx = clamp(h.x, -HALF_L + 8, HALF_L - 8);
        this.tz = Math.sign(h.z || 1) * (HALF_W - 5);
      }
      this.dir = Math.atan2(this.tz - h.z, this.tx - h.x);
    }
    if (id === 'backflip') this.dir = sign > 0 ? Math.PI : 0; // in profile to the camera
    this.ux = Math.cos(this.dir);
    this.uz = Math.sin(this.dir);
    const byDist = [...cast].filter((c) => c.idx !== hero).sort((a, b) => Math.hypot(a.x - h.x, a.z - h.z) - Math.hypot(b.x - h.x, b.z - h.z));
    const mk = (c: typeof h, role: number): Dancer => ({
      idx: c.idx, role, x: c.x, z: c.z, y: 0, vx: c.vx, vz: c.vz, facing: c.facing, runPhase: c.runPhase,
      speed: Math.hypot(c.vx, c.vz), style: CELEB.armsUp, t: 0, prog: 0, arrived: false, jumpT: -1, slot: -1,
    });
    this.dancers = [mk(h, 0), ...byDist.map((c, i) => mk(c, i < 4 ? i + 1 : -1))];
  }

  end(): void {
    this.active = false;
    this.hero = -1;
    this.holdS = 0;
    this.heroVx = this.heroVz = 0;
    this.camFacing = undefined;
    this.dancers = [];
  }

  /**
   * Step the choreography by `dt` and write the dancers into the frame about to be drawn. (camX, camZ): where
   * the lens was last frame, for the moves that line up square to it.
   */
  apply(f: Float32Array, dt: number, camX = 0, camZ = 60): void {
    if (!this.active) return;
    this.camX = camX;
    this.camZ = camZ;
    // The sim has moved on (kick-off, half time): nothing left to override.
    if (f[this.hero * PF + 4] !== PSTATE.celebrate) {
      this.end();
      return;
    }
    if (dt > 0) {
      this.t += dt;
      switch (this.id) {
        case 'knee': this.knee(dt); break;
        case 'shush': this.shush(dt); break;
        case 'plane': this.plane(dt); break;
        case 'robot': this.robot(dt); break;
        case 'backflip': this.backflip(dt); break;
        case 'pile': this.pile(dt); break;
        default: break;
      }
      this.separate();
    }
    const h = this.dancers[0];
    this.heroVx = h.vx;
    this.heroVz = h.vz;
    for (const d of this.dancers) {
      const o = d.idx * PF;
      f[o] = d.x;
      f[o + 1] = d.z;
      f[o + 2] = d.y;
      f[o + 3] = d.facing;
      f[o + 4] = PSTATE.celebrate;
      f[o + 5] = d.t;
      f[o + 6] = d.runPhase;
      f[o + 7] = d.speed;
      f[o + 8] = d.prog;
      f[o + 10] = 0;
      f[o + 12] = 0;
      f[o + 13] = d.style;
      f[o + 14] = 0;
    }
  }

  // ---------------------------------------------------------------- the moves

  /** Sprint SLIDE_AFTER_M, then a knee slide that dies over SLIDE_S with the arms going up; the mob piles round. */
  private knee(dt: number): void {
    const h = this.dancers[0];
    if (this.slideAt < 0) {
      this.run(h, h.x + this.ux * 40, h.z + this.uz * 40, SPRINT, dt);
      h.style = CELEB.armsUp;
      h.prog = 0;
      h.t = this.t;
      if (Math.hypot(h.x - this.sx, h.z - this.sz) >= SLIDE_AFTER_M || this.t > 1.1) {
        this.slideAt = this.t;
        h.facing = this.dir;
      }
    } else {
      const st = this.t - this.slideAt;
      const u = clamp(st / SLIDE_S, 0, 1);
      const v = 7.2 * (1 - u) * (1 - u);
      h.vx = this.ux * v;
      h.vz = this.uz * v;
      h.x += h.vx * dt;
      h.z += h.vz * dt;
      h.speed = v;
      h.facing = this.dir;
      h.style = CELEB.knee;
      h.t = st;
      h.prog = st / SLIDE_S; // past 1: the arms rise
      if (u < 0.85 && v > 0.8 && this.onCue) this.emit('spray', h.x, h.z);
    }
    const settled = this.slideAt >= 0 && this.t - this.slideAt > SLIDE_S * 0.7;
    for (const d of this.dancers) {
      if (d.role === 0) continue;
      if (d.role > 0) this.mob(d, h, settled, 1.3, dt);
      else this.hangBack(d, h, 5, CELEB.clap, dt);
    }
  }

  /** A jog, then a slow walk to the nearest stand with a finger to the lips; the others hang back and clap. */
  private shush(dt: number): void {
    const h = this.dancers[0];
    const far = Math.hypot(this.tx - h.x, this.tz - h.z);
    if (this.t < 0.6) {
      this.run(h, this.tx, this.tz, JOG, dt, 1.5);
      h.style = CELEB.armsUp;
      h.t = this.t;
    } else {
      this.run(h, this.tx, this.tz, 1.35, dt, 1.5, Math.atan2(this.tz - h.z, this.tx - h.x));
      h.style = CELEB.shush;
      h.t = this.t - 0.6;
    }
    h.prog = 0;
    void far;
    // The mob trails 7 m behind him, spread across his path (outside the celebrate camera's bunch radius: the
    // shot is the scorer alone, shushing the stand, his team-mates applauding in the background); the rest
    // further back still.
    for (const d of this.dancers) {
      if (d.role === 0) continue;
      const back = d.role > 0 ? 7 : 9.5;
      const across = d.role > 0 ? (d.role - 2.5) * 1.3 : (d.idx % 5 - 2) * 1.6;
      const tx = h.x - this.ux * back - this.uz * across;
      const tz = h.z - this.uz * back + this.ux * across;
      const there = this.run(d, tx, tz, d.role > 0 ? JOG : 4, dt, 0.5, Math.atan2(h.z - d.z, h.x - d.x));
      d.style = CELEB.clap;
      d.t = this.t;
      d.prog = 0;
      d.arrived = there;
    }
  }

  /** Arms out, a wide S of an arc banking one way then the other; the mob falls in behind him in a line. */
  private plane(dt: number): void {
    const h = this.dancers[0];
    const w0 = 0.9 * -(Math.sign(this.sx) || 1);
    const w = w0 * Math.cos(this.t * 0.9);
    let heading = h.facing + w * dt;
    // Never into the boards: steer back towards the middle.
    if (Math.abs(h.x) > HALF_L - 4 || Math.abs(h.z) > HALF_W - 4) heading += wrapAngle(Math.atan2(-h.z, -h.x) - heading) * Math.min(1, dt * 5);
    const v = Math.min(6.8, h.speed + 14 * dt);
    h.facing = wrapAngle(heading);
    h.vx = Math.cos(h.facing) * v;
    h.vz = Math.sin(h.facing) * v;
    h.x += h.vx * dt;
    h.z += h.vz * dt;
    h.speed = v;
    h.runPhase = (h.runPhase + (v * dt) / (STRIDE * 2)) % 1;
    h.style = CELEB.plane;
    h.t = this.t;
    // Bank into the turn (right positive), a wobble on top.
    h.prog = clamp((w / 0.9) * 0.8 + Math.sin(this.t * 3.1) * 0.12, -1, 1);
    this.trail.push(h.x, h.z, this.t);
    if (this.trail.length > 3 * 400) this.trail.splice(0, 3);
    for (const d of this.dancers) {
      if (d.role === 0) continue;
      if (d.role > 0) {
        // Follow the path he flew d.role * 0.5 s ago, once caught up.
        const want = this.t - d.role * 0.5;
        let tx = this.sx;
        let tz = this.sz;
        for (let k = this.trail.length - 3; k >= 0; k -= 3) {
          if (this.trail[k + 2] <= want) {
            tx = this.trail[k];
            tz = this.trail[k + 1];
            break;
          }
        }
        const near = Math.hypot(tx - d.x, tz - d.z) < 1.6;
        this.run(d, tx, tz, near ? 6.8 : SPRINT, dt, 0.15);
        if (near) d.arrived = true;
        d.style = d.arrived ? CELEB.plane : CELEB.armsUp;
        d.prog = d.arrived ? h.prog * 0.85 : 0;
        d.t = this.t;
      } else this.hangBack(d, h, 7, CELEB.clap, dt);
    }
  }

  /**
   * Two steps, a stop facing the lens, then the robot; the mob lines up beside him, square to the lens as it
   * was when the row formed, and copies a beat behind.
   */
  private robot(dt: number): void {
    const h = this.dancers[0];
    const hx = this.sx + this.ux * 2.5;
    const hz = this.sz + this.uz * 2.5;
    // The lens has cut to the celebration by 0.7 s: from then the row faces wherever it is.
    if (Number.isNaN(this.rowFace) && this.t > 0.75) this.rowFace = Math.atan2(this.camZ - hz, this.camX - hx);
    const face = Number.isNaN(this.rowFace) ? TO_CAMERA : this.rowFace;
    const there = this.run(h, hx, hz, JOG, dt, 0.4, face);
    const on = this.t > 0.8 && there;
    this.camFacing = on ? face : undefined;
    h.style = on ? CELEB.robot : CELEB.armsUp;
    h.t = on ? this.t - 0.8 : this.t;
    h.prog = 0;
    const ax = Math.cos(face + Math.PI / 2);
    const az = Math.sin(face + Math.PI / 2);
    for (const d of this.dancers) {
      if (d.role === 0) continue;
      if (d.role > 0) {
        const side = d.role % 2 ? -1 : 1;
        const gap = 1.45 * Math.ceil(d.role / 2) * side;
        // A row across the lens's view, the scorer in the middle.
        const at = this.run(d, hx + ax * gap, hz + az * gap, SPRINT, dt, 0.3, face);
        const go = at && this.t > 0.8;
        d.style = go ? CELEB.robot : CELEB.armsUp;
        d.t = go ? this.t - 0.8 - d.role * 0.25 : this.t;
        d.prog = 0;
      } else this.hangBack(d, h, 5.5, CELEB.clap, dt);
    }
  }

  /** Two steps, a wind-up crouch, the flip (whoosh), a stuck landing (dust), then arms up to the camera. */
  private backflip(dt: number): void {
    const h = this.dancers[0];
    const t = this.t;
    // In profile from the main-stand (+z) side, from the wind-up to the landing; then his own front again.
    const side = Math.sin(this.dir + Math.PI / 2) >= 0 ? this.dir + Math.PI / 2 : this.dir - Math.PI / 2;
    this.camFacing = t >= FLIP_RUN_S && t < FLIP_JUMP_AT + FLIP_AIR_S + FLIP_LAND_S ? side : undefined;
    if (t < FLIP_RUN_S) {
      this.run(h, h.x + this.ux * 30, h.z + this.uz * 30, 4.6, dt);
      h.style = CELEB.armsUp;
      h.t = t;
      h.prog = 0;
    } else if (t < FLIP_JUMP_AT) {
      // Braking into a crouch (the crouch pose reads prog 1 as standing, 0 as deep).
      this.run(h, h.x, h.z, 0, dt, 0, this.dir);
      const u = (t - FLIP_RUN_S) / (FLIP_JUMP_AT - FLIP_RUN_S);
      h.style = CELEB.crouch;
      h.prog = 1 - 0.8 * u * u;
      h.t = t - FLIP_RUN_S;
      h.y = 0;
    } else if (t < FLIP_JUMP_AT + FLIP_AIR_S) {
      const tau = t - FLIP_JUMP_AT;
      if (h.jumpT < 0) {
        h.jumpT = t;
        this.emit('whoosh', h.x, h.z);
      }
      h.y = Math.max(0, FLIP_V0 * tau - 0.5 * FLIP_G * tau * tau);
      // A backflip travels a little backwards.
      h.vx = -this.ux * 0.7;
      h.vz = -this.uz * 0.7;
      h.x += h.vx * dt;
      h.z += h.vz * dt;
      h.speed = 0;
      h.facing = this.dir;
      h.style = CELEB.flip;
      h.prog = tau / FLIP_AIR_S;
      h.t = tau;
    } else if (t < FLIP_JUMP_AT + FLIP_AIR_S + FLIP_LAND_S) {
      if (this.landed === 0) {
        this.landed = 1;
        this.emit('land', h.x, h.z);
      }
      h.y = 0;
      h.vx = h.vz = 0;
      h.speed = 0;
      h.style = CELEB.crouch;
      h.prog = (t - FLIP_JUMP_AT - FLIP_AIR_S) / FLIP_LAND_S;
      h.t = t - FLIP_JUMP_AT - FLIP_AIR_S;
    } else {
      this.run(h, h.x, h.z, 0, dt, 0, TO_CAMERA);
      h.y = 0;
      h.style = CELEB.armsUp;
      h.prog = 0;
      h.t = t;
    }
    const done = t > FLIP_JUMP_AT + FLIP_AIR_S + FLIP_LAND_S;
    for (const d of this.dancers) {
      if (d.role === 0) continue;
      // The mob keeps well clear (a line 3.8 m beyond him from the lens, cheering) until he has landed, then
      // piles round; the rest hang back on the far side too.
      if (d.role > 0) this.mob(d, h, done, 1.3, dt, 3.8, 0.75, side + Math.PI);
      else this.hangBack(d, h, 5.5, CELEB.clap, dt, done ? undefined : side);
    }
  }

  /** He drops flat; the mob runs in and leaps on, stacked and turned every which way, bouncing; the rest hop round. */
  private pile(dt: number): void {
    const h = this.dancers[0];
    const t = this.t;
    if (t < PILE_DROP_AT) {
      this.run(h, h.x + this.ux * 30, h.z + this.uz * 30, 5, dt);
      h.style = CELEB.armsUp;
      h.t = t;
      h.prog = 0;
      this.tx = h.x;
      this.tz = h.z;
    } else {
      h.vx = h.vz = 0;
      h.speed = 0;
      h.style = CELEB.flat;
      h.t = t - PILE_DROP_AT;
      h.prog = clamp(h.t / PILE_DROP_S, 0, 1);
      h.y = 0;
      if (h.prog >= 1 && this.landed === 0 && h.jumpT < 0) {
        h.jumpT = t;
        this.emit('thud', h.x, h.z);
      }
    }
    const open = t > PILE_DROP_AT + PILE_DROP_S * 0.6;
    for (const d of this.dancers) {
      if (d.role === 0) continue;
      if (d.role < 0) {
        this.hangBack(d, h, 2.6, CELEB.armsUp, dt);
        continue;
      }
      if (d.slot >= 0) {
        // On the stack: a small bounce that dies away.
        const age = t - d.jumpT - PILE_LEAP_S;
        d.y = PILE_STEP * (d.slot + 1) + Math.abs(Math.sin(age * 7 + d.slot)) * 0.06 * Math.max(0, 1 - age * 0.5);
        d.speed = 0;
        d.style = CELEB.dive;
        d.prog = 1;
        d.t = age;
        continue;
      }
      if (d.jumpT >= 0) {
        // Leaping on: an arc from the take-off point onto the stack.
        const u = clamp((t - d.jumpT) / PILE_LEAP_S, 0, 1);
        const slot = this.landed;
        const top = PILE_STEP * (slot + 1);
        const ang = d.facing;
        const lx = this.tx - Math.cos(ang) * 0.35;
        const lz = this.tz - Math.sin(ang) * 0.35;
        d.x = d.vx + (lx - d.vx) * u; // (vx / vz hold the take-off point while airborne)
        d.z = d.vz + (lz - d.vz) * u;
        d.y = top * u + Math.sin(Math.PI * u) * 0.55;
        d.speed = 0;
        d.style = CELEB.dive;
        d.prog = u;
        d.t = t - d.jumpT;
        if (u >= 1) {
          d.slot = slot;
          this.landed++;
          this.emit('thud', this.tx, this.tz);
          if (slot === 0) this.emit('roar', this.tx, this.tz);
        }
        continue;
      }
      // Running in (staggered: the nearer ones first).
      const there = this.run(d, this.tx, this.tz, SPRINT, dt, 1.7);
      d.style = CELEB.armsUp;
      d.t = t;
      d.prog = 0;
      if (there && open && t > 0.9 + d.role * 0.12) {
        d.facing = Math.atan2(this.tz - d.z, this.tx - d.x);
        d.jumpT = t;
        d.vx = d.x;
        d.vz = d.z;
      }
    }
  }

  // ---------------------------------------------------------------- helpers

  /**
   * Run towards (tx, tz) at up to `vmax`, braking into it; face the way he runs (or `face` once there).
   * Returns true within `stopR`.
   */
  private run(d: Dancer, tx: number, tz: number, vmax: number, dt: number, stopR = 0.4, face: number | null = null): boolean {
    const dx = tx - d.x;
    const dz = tz - d.z;
    const dist = Math.hypot(dx, dz);
    const there = dist <= stopR;
    let wx = 0;
    let wz = 0;
    if (!there && dist > 0) {
      const v = Math.min(vmax, (dist - stopR) * 4 + 0.6);
      wx = (dx / dist) * v;
      wz = (dz / dist) * v;
    }
    const k = Math.min(1, dt * 9);
    d.vx += (wx - d.vx) * k;
    d.vz += (wz - d.vz) * k;
    d.x += d.vx * dt;
    d.z += d.vz * dt;
    d.speed = Math.hypot(d.vx, d.vz);
    const want = d.speed > 0.9 ? Math.atan2(d.vz, d.vx) : face ?? d.facing;
    d.facing = wrapAngle(d.facing + wrapAngle(want - d.facing) * Math.min(1, dt * 8));
    d.runPhase = (d.runPhase + (d.speed * dt) / (STRIDE * 2)) % 1;
    return there;
  }

  /**
   * The mob: a loose arc 2.6 m behind the scorer's heading while his move is on (clear of the lens, which
   * films him from ahead), then a ring of `r` round him, hopping (the arms-up pose hops when still).
   */
  private mob(d: Dancer, h: Dancer, settled: boolean, r: number, dt: number, hold = 2.6, spread = 0.55, holdAt = this.dir + Math.PI): void {
    const a = settled ? Math.atan2(d.z - h.z, d.x - h.x) + Math.sin(this.t * 1.3 + d.role) * 0.15 : holdAt + (d.role - 2.5) * spread;
    const rr = settled ? r : hold;
    const tx = h.x + Math.cos(a) * rr;
    const tz = h.z + Math.sin(a) * rr;
    this.run(d, tx, tz, SPRINT, dt, 0.3, Math.atan2(h.z - d.z, h.x - d.x));
    d.style = CELEB.armsUp;
    d.t = this.t;
    d.prog = 0;
  }

  /**
   * The rest: a jog to `r` m off the scorer, keeping their own bearing (mirrored to the far side when it lies
   * towards `awayFrom`: nobody between the lens and the move), then `style` facing him.
   */
  private hangBack(d: Dancer, h: Dancer, r: number, style: number, dt: number, awayFrom?: number): void {
    let a = Math.atan2(d.z - h.z, d.x - h.x);
    if (awayFrom !== undefined && Math.cos(a - awayFrom) > 0.1) a = 2 * awayFrom + Math.PI - a;
    const tx = h.x + Math.cos(a) * r;
    const tz = h.z + Math.sin(a) * r;
    this.run(d, tx, tz, JOG, dt, 0.6, Math.atan2(h.z - d.z, h.x - d.x));
    d.style = style;
    d.t = this.t;
    d.prog = 0;
  }

  /** Nobody stands inside anybody else (the stack and anyone airborne excepted). */
  private separate(): void {
    const ds = this.dancers;
    for (let i = 0; i < ds.length; i++) {
      const a = ds[i];
      if (a.slot >= 0 || a.jumpT >= 0 || a.style === CELEB.flat) continue;
      for (let j = i + 1; j < ds.length; j++) {
        const b = ds[j];
        if (b.slot >= 0 || b.jumpT >= 0 || b.style === CELEB.flat) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        const min = 0.8;
        if (d >= min || d < 1e-4) continue;
        const push = (min - d) / 2;
        const nx = dx / d;
        const nz = dz / d;
        // The scorer holds his line: the others give way.
        const wa = a.role === 0 ? 0 : 1;
        const wb = b.role === 0 ? 0 : 1;
        const s = wa + wb || 1;
        a.x -= nx * push * (2 * wa) / s;
        a.z -= nz * push * (2 * wa) / s;
        b.x += nx * push * (2 * wb) / s;
        b.z += nz * push * (2 * wb) / s;
      }
    }
  }

  private emit(kind: CelebCue['kind'], x: number, z: number): void {
    if (!this.onCue) return;
    const c = this.cue;
    c.kind = kind;
    c.x = x;
    c.z = z;
    c.ux = this.ux;
    c.uz = this.uz;
    this.onCue(c);
  }
}
