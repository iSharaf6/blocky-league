import * as THREE from 'three';

interface Bit {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  rx: number; ry: number; spin: number;
  life: number; max: number; size: number;
  gravity: number;
  drag: number;
}

/** Pooled voxel particles: grass flecks, confetti, sparks — all little cubes. */
export class Effects {
  readonly mesh: THREE.InstancedMesh;
  private bits: (Bit | null)[];
  private free: number[] = [];
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();

  constructor(readonly capacity = 900) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.bits = new Array(capacity).fill(null);
    for (let i = capacity - 1; i >= 0; i--) this.free.push(i);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i++) {
      this.mesh.setMatrixAt(i, zero);
      this.mesh.setColorAt(i, this.c.setHex(0xffffff));
    }
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: number, size: number, life: number, gravity = 14, drag = 0.4): void {
    const i = this.free.pop();
    if (i === undefined) return;
    this.bits[i] = {
      x, y, z, vx, vy, vz, rx: Math.random() * 6, ry: Math.random() * 6, spin: (Math.random() - 0.5) * 14,
      life, max: life, size, gravity, drag,
    };
    this.mesh.setColorAt(i, this.c.setHex(color));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  grass(x: number, z: number, n: number, power: number): void {
    const cols = [0x8fcb4c, 0x7dbb3f, 0xa8dc62, 0x6fa838];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 2.5 * power;
      this.spawn(x, 0.08, z, Math.cos(a) * sp, 1.5 + Math.random() * 3 * power, Math.sin(a) * sp, cols[i % 4], 0.07 + Math.random() * 0.06, 0.5 + Math.random() * 0.4);
    }
  }

  confetti(cx: number, cz: number, colors: number[], n: number, spread: number): void {
    for (let i = 0; i < n; i++) {
      const x = cx + (Math.random() - 0.5) * spread;
      const z = cz + (Math.random() - 0.5) * spread * 0.5;
      this.spawn(x, 14 + Math.random() * 8, z, (Math.random() - 0.5) * 2, -Math.random() * 2, (Math.random() - 0.5) * 2,
        colors[i % colors.length], 0.16 + Math.random() * 0.1, 3.5 + Math.random() * 2, 2.2, 1.6);
    }
  }

  burst(x: number, y: number, z: number, colors: number[], n: number, speed: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * 1.2;
      const sp = speed * (0.4 + Math.random() * 0.6);
      this.spawn(x, y, z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + 2, Math.sin(a) * Math.cos(e) * sp,
        colors[i % colors.length], 0.12 + Math.random() * 0.1, 0.8 + Math.random() * 0.8, 9, 0.8);
    }
  }

  private splashAcc = 0;

  /**
   * Rain hitting the lawn: tiny pale droplets kicked up around the camera focus (~90 a second over a
   * 44 x 30 m patch), each a two-bit crown that lives a quarter of a second.
   */
  rain(dt: number, cx: number, cz: number, rx = 22, rz = 15, rate = 90): void {
    this.splashAcc += dt * rate;
    while (this.splashAcc >= 1) {
      this.splashAcc -= 1;
      const x = cx + (Math.random() * 2 - 1) * rx;
      const z = cz + (Math.random() * 2 - 1) * rz;
      for (let k = 0; k < 2; k++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 0.7 + Math.random() * 0.9;
        this.spawn(x, 0.04, z, Math.cos(a) * sp, 1.4 + Math.random() * 1.2, Math.sin(a) * sp,
          k ? 0xcfe3f2 : 0xeaf4fb, 0.09 + Math.random() * 0.05, 0.22 + Math.random() * 0.12, 12, 0);
      }
    }
  }

  trail(x: number, y: number, z: number): void {
    this.spawn(x, y, z, 0, 0.2, 0, 0xffffff, 0.14, 0.28, 0, 0);
  }

  clear(): void {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.capacity; i++) {
      if (this.bits[i]) {
        this.bits[i] = null;
        this.free.push(i);
        this.mesh.setMatrixAt(i, zero);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt: number): void {
    let dirty = false;
    for (let i = 0; i < this.capacity; i++) {
      const b = this.bits[i];
      if (!b) continue;
      dirty = true;
      b.life -= dt;
      if (b.life <= 0) {
        this.bits[i] = null;
        this.free.push(i);
        this.mesh.setMatrixAt(i, this.m4.makeScale(0, 0, 0));
        continue;
      }
      b.vy -= b.gravity * dt;
      const k = Math.exp(-b.drag * dt);
      b.vx *= k;
      b.vz *= k;
      if (b.drag > 1) {
        // Confetti flutter.
        b.vx += Math.sin(b.life * 7 + i) * dt * 2;
        b.vy = Math.max(b.vy, -2.4);
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      if (b.y < b.size / 2) {
        b.y = b.size / 2;
        b.vy *= -0.3;
        b.vx *= 0.6;
        b.vz *= 0.6;
        b.spin *= 0.5;
      }
      b.rx += b.spin * dt;
      b.ry += b.spin * 0.7 * dt;
      const fade = Math.min(1, b.life / (b.max * 0.3));
      const sz = b.size * fade;
      this.q.setFromEuler(this.e.set(b.rx, b.ry, 0));
      this.m4.compose(this.v.set(b.x, b.y, b.z), this.q, this.s.set(sz, sz, sz));
      this.mesh.setMatrixAt(i, this.m4);
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
