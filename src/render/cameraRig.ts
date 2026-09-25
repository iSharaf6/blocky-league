import * as THREE from 'three';
import { clamp, damp, smoothstep } from '../core/math';
import { HALF_L, HALF_W } from '../sim/constants';

export type CamMode = 'broadcast' | 'replay' | 'celebrate' | 'menu' | 'intro' | 'penalty';

export interface CamFocus {
  bx: number; by: number; bz: number;
  bvx: number; bvz: number;
  ax: number; az: number; // active / interesting player
  avx?: number; avz?: number;
  attack: number; // +1 / -1: the human's attacking direction (portrait framing)
  /** Attacking direction of the side in possession (0 = loose). */
  lean?: number;
  /** Set piece being taken: frame the taker and the target area together. */
  setPiece?: { x: number; z: number; tx: number; tz: number; behind?: boolean } | null;
}

const PITCH_DEG = 27;
const FOV = 24;

export class CameraRig {
  mode: CamMode = 'menu';
  /** Ground-plane yaw of the camera: 0 means looking towards -z (broadcast). */
  yaw = 0;
  /** Replay shot: 'build' = the move, 'goal' = behind-the-goal slow-mo. */
  replayShot: 'build' | 'goal' = 'build';
  replayAngle = 0;
  /** Which goal (+1 / -1) the replayed goal went into. */
  replayGoalSign = 1;
  /** Shootout: which goal (+1 / -1) every kick is taken at. */
  penaltyGoal = 1;
  private target = new THREE.Vector3();
  private pos = new THREE.Vector3(0, 60, 90);
  private lead = new THREE.Vector2();
  private orbit = 0;
  private shake = 0;
  private snap = true;
  /** 0..1 progress of the pre-match fly-in. */
  introT = 0;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  setMode(m: CamMode): void {
    if (m !== this.mode) {
      const prev = this.mode;
      this.mode = m;
      // Cut (don't glide) into and out of replays, like TV.
      this.snap = m === 'replay' || m === 'intro' || (m === 'broadcast' && prev === 'replay');
    }
  }

  cut(): void {
    this.snap = true;
  }

  kick(amount: number): void {
    this.shake = Math.max(this.shake, amount);
  }

  get portrait(): boolean {
    return this.camera.aspect < 0.85;
  }

  /** Metres of pitch the broadcast shot shows across the screen. */
  private broadcastWidth(): number {
    const a = this.camera.aspect;
    const w = a >= 1.6 ? 41 : a >= 1.25 ? 36 + (a - 1.25) * 14 : 35;
    // Small phone screens get a tighter shot so the players stay readable.
    const h = typeof window !== 'undefined' ? window.innerHeight : 720;
    return w * (h < 420 ? 0.78 : h < 560 ? 0.88 : 1);
  }

  update(dt: number, f: CamFocus, time: number): void {
    const cam = this.camera;
    let tx: number, ty: number, tz: number;
    let px: number, py: number, pz: number;
    let rate = 4;
    switch (this.mode) {
      case 'menu': {
        this.orbit += dt * 0.045;
        const r = 70;
        tx = 0; ty = 0; tz = 0;
        px = Math.sin(this.orbit) * r;
        pz = Math.cos(this.orbit) * r;
        py = 52;
        cam.fov = 36;
        rate = 1.5;
        break;
      }
      case 'intro': {
        // Sweep in from high over the halfway line to the broadcast gantry.
        const k = this.introT;
        const e = k * k * (3 - 2 * k);
        const a = -1.1 + e * 1.1;
        const r = 72 - e * 16;
        tx = 0; ty = 0; tz = 0;
        px = Math.sin(a) * r;
        pz = Math.cos(a) * r;
        py = 40 - e * 6;
        cam.fov = 34 - e * 10;
        rate = 6;
        break;
      }
      case 'celebrate': {
        this.orbit += dt * 0.3;
        const vx = f.avx ?? 0;
        const vz = f.avz ?? 0;
        tx = f.ax + vx * 0.4; ty = 1.3; tz = f.az + vz * 0.4;
        const side = Math.sin(this.orbit) * 0.8;
        px = tx + side * 7;
        pz = tz + 7;
        py = 2.4;
        cam.fov = 38;
        rate = 6;
        break;
      }
      case 'replay': {
        tx = f.bx; ty = Math.min(f.by, 2.2) * 0.5 + 0.6; tz = f.bz;
        const gs = this.replayGoalSign;
        if (this.replayShot === 'goal') {
          // Behind the net, between the goal and the boards, at player height.
          px = gs * (HALF_L + 3.2);
          py = 2.2;
          pz = clamp(f.bz * 0.25, -4, 4);
          cam.fov = 34;
          rate = 8;
        } else if (this.replayAngle % 2 === 0) {
          // Touchline tracking shot, a step behind the ball, kept out of the stand.
          px = f.bx - gs * 6;
          py = 6.2;
          pz = Math.min(f.bz + 20, HALF_W + 2.6);
          cam.fov = 32;
          rate = 5;
        } else {
          // High reverse angle from the far side.
          px = f.bx - gs * 4;
          py = 16;
          pz = f.bz - 30;
          cam.fov = 30;
          rate = 5;
        }
        break;
      }
      case 'penalty': {
        // Shootout: low behind the taker's shoulder, the whole goal mouth framed, easing after the ball.
        const g = this.penaltyGoal;
        this.yaw = g > 0 ? Math.PI / 2 : -Math.PI / 2;
        const spot = g * (HALF_L - 10);
        // High enough that the taker's head sits below the goal line, so the keeper is never hidden.
        tx = g * HALF_L; ty = 0.5; tz = clamp(f.bz * 0.3, -2, 2);
        px = spot - g * 9; py = 4; pz = g * 1.8 + clamp(f.bz * 0.15, -1, 1);
        // Keep ~13 m of goal line in shot whatever the screen shape (portrait phones need a wider lens).
        const half = Math.atan(6.5 / (19 * Math.max(0.3, cam.aspect)));
        cam.fov = clamp(THREE.MathUtils.radToDeg(half * 2), 34, 74);
        rate = 5;
        break;
      }
      default: {
        const sp = Math.hypot(f.bvx, f.bvz);
        this.lead.x = damp(this.lead.x, f.bvx * 0.35, 1.4, dt);
        this.lead.y = damp(this.lead.y, f.bvz * 0.2, 1.4, dt);
        if (this.portrait) {
          const ad = f.attack;
          tx = clamp(f.bx * 0.85 + f.ax * 0.15 + this.lead.x + ad * 5, -HALF_L + 8, HALF_L - 8);
          tz = clamp(f.bz * 0.8 + this.lead.y, -HALF_W + 9, HALF_W - 9);
          ty = 0;
          this.yaw = ad > 0 ? Math.PI / 2 : -Math.PI / 2;
          px = tx - ad * 44;
          pz = tz;
          py = 34;
          cam.fov = 38;
        } else {
          this.yaw = 0;
          const W = this.broadcastWidth();
          const small = typeof window !== 'undefined' && window.innerHeight < 420;
          let fx = f.bx * 0.82 + f.ax * 0.18 + this.lead.x;
          // Aim a little beyond the ball so the far boards and a few stand rows frame the top.
          let fz = small ? f.bz * 0.9 : f.bz * 0.6 - 5 + this.lead.y * 0.5;
          const lean = f.lean ?? 0;
          if (lean !== 0) fx += lean * 5 * smoothstep(12, 34, lean * f.bx);
          const piece = f.setPiece;
          if (piece) {
            // Taker and target together, but never let the taker leave the frame.
            fx = clamp((piece.x + piece.tx) / 2, piece.x - 0.3 * W, piece.x + 0.3 * W);
            fz = clamp((piece.z + piece.tz) / 2, piece.z - 0.22 * W, piece.z + 0.22 * W);
          }
          if (piece?.behind) {
            // Our own dead ball near goal: look over the taker's shoulder at the target.
            const dx = piece.tx - piece.x;
            const dz = piece.tz - piece.z;
            const dl = Math.hypot(dx, dz) || 1;
            tx = piece.tx; ty = 1; tz = piece.tz;
            px = piece.x - (dx / dl) * 9;
            pz = piece.z - (dz / dl) * 9;
            py = 3.6;
            cam.fov = 40;
            rate = 3;
            break;
          }
          const edge = HALF_L - 0.3 * W;
          tx = clamp(fx, -edge, edge);
          tz = clamp(fz, -(HALF_W - 12), HALF_W - 10);
          ty = 0;
          // Distance so W metres span the screen with a long, near-orthographic lens.
          const zoom = 1 + clamp(f.by * 0.015 + sp * 0.003, 0, 0.1);
          const d = (W / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * cam.aspect)) * zoom;
          const a = THREE.MathUtils.degToRad(PITCH_DEG);
          px = tx;
          py = d * Math.sin(a);
          pz = tz + d * Math.cos(a);
          cam.fov = FOV;
        }
        rate = 3.2 + Math.min(sp, 25) * 0.08;
        if (f.setPiece) rate = 2.4;
      }
    }
    if (this.snap) {
      this.target.set(tx, ty, tz);
      this.pos.set(px, py, pz);
      this.snap = false;
    } else {
      this.target.x = damp(this.target.x, tx, rate, dt);
      this.target.y = damp(this.target.y, ty, rate, dt);
      this.target.z = damp(this.target.z, tz, rate, dt);
      this.pos.x = damp(this.pos.x, px, rate, dt);
      this.pos.y = damp(this.pos.y, py, rate, dt);
      this.pos.z = damp(this.pos.z, pz, rate, dt);
    }
    cam.position.copy(this.pos);
    if (this.shake > 0.001) {
      cam.position.x += Math.sin(time * 61) * this.shake;
      cam.position.y += Math.sin(time * 47 + 1) * this.shake;
      this.shake = damp(this.shake, 0, 7, dt);
    }
    cam.lookAt(this.target);
    cam.updateProjectionMatrix();
  }

  get focusX(): number {
    return this.target.x;
  }

  get focusZ(): number {
    return this.target.z;
  }

  /** Screen-stick to world-ground mapping for the current camera. */
  screenToWorld(sx: number, sy: number): { x: number; z: number } {
    const fx = Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    // yaw 0: forward (0,-1), right (1,0)
    const rx = -fz;
    const rz = fx;
    return { x: sx * rx + sy * fx, z: sx * rz + sy * fz };
  }
}
