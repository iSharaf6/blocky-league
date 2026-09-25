import * as THREE from 'three';
import { clamp, damp } from '../core/math';
import { HALF_L, HALF_W } from '../sim/constants';

export type CamMode = 'broadcast' | 'replay' | 'celebrate' | 'menu';

export interface CamFocus {
  bx: number; by: number; bz: number;
  bvx: number; bvz: number;
  ax: number; az: number; // active / interesting player
  attack: number; // +1 / -1: the human's attacking direction (portrait framing)
}

export class CameraRig {
  mode: CamMode = 'menu';
  /** Ground-plane yaw of the camera: 0 means looking towards -z (broadcast). */
  yaw = 0;
  replayAngle = 0;
  private target = new THREE.Vector3();
  private pos = new THREE.Vector3(0, 60, 90);
  private lead = new THREE.Vector2();
  private orbit = 0;
  private shake = 0;
  private snap = true;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  setMode(m: CamMode): void {
    if (m !== this.mode) {
      this.mode = m;
      this.snap = m === 'replay' || m === 'broadcast';
    }
  }

  kick(amount: number): void {
    this.shake = Math.max(this.shake, amount);
  }

  get portrait(): boolean {
    return this.camera.aspect < 0.85;
  }

  update(dt: number, f: CamFocus, time: number): void {
    const cam = this.camera;
    let tx: number, ty: number, tz: number;
    let px: number, py: number, pz: number;
    let rate = 4;
    switch (this.mode) {
      case 'menu': {
        this.orbit += dt * 0.05;
        const r = 78;
        tx = 0; ty = 0; tz = 0;
        px = Math.sin(this.orbit) * r;
        pz = Math.cos(this.orbit) * r;
        py = 38;
        cam.fov = 40;
        rate = 1.5;
        break;
      }
      case 'celebrate': {
        this.orbit += dt * 0.35;
        tx = f.ax; ty = 1.2; tz = f.az;
        px = f.ax + Math.sin(this.orbit) * 9;
        pz = f.az + Math.abs(Math.cos(this.orbit)) * 9 + 2;
        py = 3.4;
        cam.fov = 34;
        rate = 2.5;
        break;
      }
      case 'replay': {
        const a = this.replayAngle % 3;
        tx = f.bx; ty = Math.min(f.by, 2) * 0.5 + 0.6; tz = f.bz;
        if (a === 0) {
          // Low touchline tracking shot.
          px = f.bx - f.bvx * 0.12;
          py = 3.2;
          pz = f.bz + 17;
          cam.fov = 30;
        } else if (a === 1) {
          // Behind the goal the ball is heading to.
          const gx = Math.sign(f.bvx || f.bx || 1) * (HALF_L + 12);
          px = gx;
          py = 4.5;
          pz = f.bz * 0.4;
          cam.fov = 26;
        } else {
          // High reverse angle.
          px = f.bx;
          py = 14;
          pz = f.bz - 26;
          cam.fov = 30;
        }
        rate = 6;
        break;
      }
      default: {
        // Broadcast: side-on, elevated, leading the play a touch.
        const sp = Math.hypot(f.bvx, f.bvz);
        this.lead.x = damp(this.lead.x, f.bvx * 0.4, 1.4, dt);
        this.lead.y = damp(this.lead.y, f.bvz * 0.25, 1.4, dt);
        if (this.portrait) {
          const ad = f.attack;
          tx = clamp(f.bx * 0.85 + f.ax * 0.15 + this.lead.x + ad * 5, -HALF_L + 6, HALF_L - 6);
          tz = clamp(f.bz * 0.8 + this.lead.y, -HALF_W + 9, HALF_W - 9);
          ty = 0;
          this.yaw = ad > 0 ? Math.PI / 2 : -Math.PI / 2;
          const d = 40;
          px = tx - ad * d;
          pz = tz;
          py = 31;
          cam.fov = 40;
        } else {
          this.yaw = 0;
          tx = clamp(f.bx * 0.82 + f.ax * 0.18 + this.lead.x, -HALF_L + 15, HALF_L - 15);
          tz = clamp(f.bz * 0.5 + this.lead.y, -HALF_W * 0.42, HALF_W * 0.45);
          ty = 0;
          const zoom = 1 + clamp(f.by * 0.02 + sp * 0.004, 0, 0.12);
          // Wider screens see more pitch; keep ~40 m of width visible on 4:3.
          const wide = clamp(1.25 / Math.max(cam.aspect, 0.9), 0.85, 1.25);
          px = tx;
          py = 20.5 * zoom * wide;
          pz = tz + 41 * zoom * wide;
          cam.fov = 29;
        }
        rate = 3.2 + Math.min(sp, 25) * 0.08;
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
    const fx = Math.sin(this.yaw) * 1;
    const fz = -Math.cos(this.yaw);
    // yaw 0: forward (0,-1), right (1,0)
    const rx = -fz;
    const rz = fx;
    return { x: sx * rx + sy * fx, z: sx * rz + sy * fz };
  }
}
