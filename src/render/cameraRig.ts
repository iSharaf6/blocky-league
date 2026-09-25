import * as THREE from 'three';
import { clamp, damp, smoothstep } from '../core/math';
import { HALF_L, HALF_W } from '../sim/constants';

export type CamMode = 'broadcast' | 'replay' | 'celebrate' | 'menu' | 'intro';

export interface CamFocus {
  bx: number; by: number; bz: number;
  bvx: number; bvz: number;
  ax: number; az: number; // active / interesting player
  avx?: number; avz?: number;
  attack: number; // +1 / -1: the human's attacking direction (portrait framing)
  /** Attacking direction of the side in possession (0 = loose). */
  lean?: number;
  /** Set piece being taken: frame the taker and the target area together. */
  setPiece?: { x: number; z: number; tx: number; tz: number } | null;
}

const PITCH_DEG = 34;
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
    return a >= 1.6 ? 46 : a >= 1.25 ? 40 + (a - 1.25) * 17 : 38;
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
          // Low touchline tracking shot, a step behind the ball.
          px = f.bx - gs * 6;
          py = 4.5;
          pz = f.bz + 22;
          cam.fov = 30;
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
          let fx = f.bx * 0.82 + f.ax * 0.18 + this.lead.x;
          let fz = f.bz * 0.45 + this.lead.y * 0.5;
          const lean = f.lean ?? 0;
          if (lean !== 0) fx += lean * 5 * smoothstep(12, 34, lean * f.bx);
          if (f.setPiece) {
            fx = (f.setPiece.x + f.setPiece.tx) / 2;
            fz = (f.setPiece.z + f.setPiece.tz) / 2;
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
