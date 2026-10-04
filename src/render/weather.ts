import * as THREE from 'three';
import { smoothstep } from '../core/math';
import { snowyWeather, wetPatches, type WeatherKind } from '../sim/weather';
export type { WeatherKind } from '../sim/weather';

/**
 * Snow near the lens: a flake shrinks away inside SNOW_NEAR_FULL m of the camera (gone by SNOW_NEAR_GONE),
 * so the bright flakes stay visible across the pitch without growing into near-camera blocks.
 */
const SNOW_NEAR_GONE = 2.5;
const SNOW_NEAR_FULL = 6;


/**
 * Weather around the camera focus: rain as falling streaks, snow as tumbling voxel cubes.
 * Particles live in a box that follows the focus point, so the cost is constant.
 */
export class Weather {
  readonly group = new THREE.Group();
  kind: WeatherKind = 'clear';
  private rain: THREE.LineSegments | null = null;
  private snow: THREE.InstancedMesh | null = null;
  private key = '';
  private pos = new Float32Array(0);
  private vel = new Float32Array(0);
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private readonly W = 90;
  private readonly D = 70;
  private readonly H = 36;

  set(kind: WeatherKind, quality: 'low' | 'medium' | 'high', seed = 12345): void {
    const key = `${kind}/${quality}/${seed}`;
    if (key === this.key) return;
    this.clear();
    this.key = key;
    this.kind = kind;
    for (const patch of wetPatches(kind, seed)) {
      const geo = new THREE.CircleGeometry(1, 24);
      geo.rotateX(-Math.PI / 2);
      geo.scale(patch.rx, 1, patch.rz);
      const puddle = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x436d72, transparent: true, opacity: 0.34, depthWrite: false }));
      puddle.position.set(patch.x, 0.135, patch.z);
      puddle.renderOrder = 1;
      puddle.name = 'wet-patch';
      this.group.add(puddle);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.83, 0.87, 20), new THREE.MeshBasicMaterial({ color: 0xd3eef2, transparent: true, opacity: 0.18, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.scale.set(patch.rx, patch.rz, 1);
      ring.position.set(patch.x, 0.138, patch.z);
      this.group.add(ring);
    }
    if (kind === 'clear' || kind === 'overcast') return;
    const snow = snowyWeather(kind);
    const budget = quality === 'high' ? 2600 : quality === 'medium' ? 1600 : 900;
    const n = snow ? Math.round(budget * (kind === 'blizzard' ? 0.7 : 0.45)) : kind === 'drizzle' ? Math.round(budget * 0.42) : budget;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.pos[i * 3] = (Math.random() - 0.5) * this.W;
      this.pos[i * 3 + 1] = Math.random() * this.H;
      this.pos[i * 3 + 2] = (Math.random() - 0.5) * this.D;
      this.vel[i] = snow ? 1.2 + Math.random() * 1.2 : kind === 'drizzle' ? 17 + Math.random() * 5 : 22 + Math.random() * 8;
    }
    if (!snow) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3).setUsage(THREE.DynamicDrawUsage));
      const mat = new THREE.LineBasicMaterial({ color: 0xcfe3f2, transparent: true, opacity: kind === 'drizzle' ? 0.4 : 0.6, fog: true });
      this.rain = new THREE.LineSegments(geo, mat);
      this.rain.frustumCulled = false;
      this.group.add(this.rain);
    } else {
      // Bright enough to read from the gantry at night, without thousands of giant near-lens cubes.
      const geo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
      const mat = new THREE.MeshBasicMaterial({ color: 0xf7fcff, transparent: true, opacity: 0.9, depthWrite: false, fog: false });
      this.snow = new THREE.InstancedMesh(geo, mat, n);
      this.snow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.snow.frustumCulled = false;
      this.group.add(this.snow);
    }
    this.update(0, 0, 0, 0);
  }

  private clear(): void {
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      // Instance attributes belong to the mesh, separately from its shared vertex geometry.
      if (o instanceof THREE.InstancedMesh) o.dispose();
      mesh.geometry?.dispose();
      const materials = mesh.material;
      for (const material of Array.isArray(materials) ? materials : materials ? [materials] : []) material.dispose();
    });
    this.group.clear();
    this.rain = null;
    this.snow = null;
    this.pos = new Float32Array(0);
    this.vel = new Float32Array(0);
  }

  dispose(): void { this.clear(); this.key = ''; this.kind = 'clear'; this.group.removeFromParent(); }

  update(dt: number, fx: number, fz: number, time: number, cam?: THREE.Vector3): void {
    if (this.kind === 'clear' || this.kind === 'overcast') return;
    const n = this.vel.length;
    const p = this.pos;
    const hw = this.W / 2;
    const hd = this.D / 2;
    // Wrap particles into the box around the focus point.
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      p[o + 1] -= this.vel[i] * dt;
      if (snowyWeather(this.kind)) {
        const wind = this.kind === 'blizzard' ? 4 : 0.6;
        p[o] += Math.sin(time * 0.9 + i) * dt * 0.8 + dt * wind;
        p[o + 2] += Math.cos(time * 0.7 + i * 1.3) * dt * 0.5;
      } else {
        p[o] += dt * (this.kind === 'drizzle' ? 1.2 : 2.5); // a little wind
      }
      if (p[o + 1] < 0) {
        p[o + 1] += this.H;
        p[o] = fx + (Math.random() - 0.5) * this.W;
        p[o + 2] = fz + (Math.random() - 0.5) * this.D;
      }
      p[o] = fx - hw + ((p[o] - fx + hw) % this.W + this.W) % this.W;
      p[o + 2] = fz - hd + ((p[o + 2] - fz + hd) % this.D + this.D) % this.D;
      // Keep flakes out of the lens: low cameras (penalties, replays) would see giant cubes.
      if (cam) {
        const dx = p[o] - cam.x, dy = p[o + 1] - cam.y, dz = p[o + 2] - cam.z;
        if (dx * dx + dy * dy + dz * dz < 36) p[o + 1] = this.H - Math.random() * 2;
      }
    }
    if (this.rain) {
      const a = this.rain.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = a.array as Float32Array;
      for (let i = 0; i < n; i++) {
        const o = i * 3;
        arr[i * 6] = p[o];
        arr[i * 6 + 1] = p[o + 1];
        arr[i * 6 + 2] = p[o + 2];
        arr[i * 6 + 3] = p[o] - 0.12;
        arr[i * 6 + 4] = p[o + 1] + (this.kind === 'drizzle' ? 0.55 : 0.9);
        arr[i * 6 + 5] = p[o + 2];
      }
      a.needsUpdate = true;
    } else if (this.snow) {
      for (let i = 0; i < n; i++) {
        const o = i * 3;
        this.q.setFromEuler(this.e.set(time * 1.3 + i, time * 0.9 + i * 0.5, 0));
        const k = cam ? smoothstep(SNOW_NEAR_GONE, SNOW_NEAR_FULL, Math.hypot(p[o] - cam.x, p[o + 1] - cam.y, p[o + 2] - cam.z)) : 1;
        this.m4.compose(this.v.set(p[o], p[o + 1], p[o + 2]), this.q, this.s.setScalar(k * (0.65 + (i % 7) * 0.09)));
        this.snow.setMatrixAt(i, this.m4);
      }
      this.snow.instanceMatrix.needsUpdate = true;
    }
  }
}
