import * as THREE from 'three';

export type WeatherKind = 'clear' | 'rain' | 'snow';

/**
 * Weather around the camera focus: rain as falling streaks, snow as tumbling voxel cubes.
 * Particles live in a box that follows the focus point, so the cost is constant.
 */
export class Weather {
  readonly group = new THREE.Group();
  kind: WeatherKind = 'clear';
  private rain: THREE.LineSegments | null = null;
  private snow: THREE.InstancedMesh | null = null;
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

  set(kind: WeatherKind, quality: 'low' | 'medium' | 'high'): void {
    this.kind = kind;
    this.group.clear();
    this.rain = null;
    this.snow = null;
    if (kind === 'clear') return;
    const n = quality === 'high' ? 2600 : quality === 'medium' ? 1600 : 900;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.pos[i * 3] = (Math.random() - 0.5) * this.W;
      this.pos[i * 3 + 1] = Math.random() * this.H;
      this.pos[i * 3 + 2] = (Math.random() - 0.5) * this.D;
      this.vel[i] = kind === 'rain' ? 22 + Math.random() * 8 : 1.4 + Math.random() * 1.2;
    }
    if (kind === 'rain') {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
      const mat = new THREE.LineBasicMaterial({ color: 0xcfe3f2, transparent: true, opacity: 0.55, fog: true });
      this.rain = new THREE.LineSegments(geo, mat);
      this.rain.frustumCulled = false;
      this.group.add(this.rain);
    } else {
      const geo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
      const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x9aa6b8 });
      this.snow = new THREE.InstancedMesh(geo, mat, n);
      this.snow.frustumCulled = false;
      this.group.add(this.snow);
    }
  }

  update(dt: number, fx: number, fz: number, time: number): void {
    if (this.kind === 'clear') return;
    const n = this.vel.length;
    const p = this.pos;
    const hw = this.W / 2;
    const hd = this.D / 2;
    // Wrap particles into the box around the focus point.
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      p[o + 1] -= this.vel[i] * dt;
      if (this.kind === 'snow') {
        p[o] += Math.sin(time * 0.9 + i) * dt * 0.8 + dt * 0.6;
        p[o + 2] += Math.cos(time * 0.7 + i * 1.3) * dt * 0.5;
      } else {
        p[o] += dt * 2.5; // a little wind
      }
      if (p[o + 1] < 0) {
        p[o + 1] += this.H;
        p[o] = fx + (Math.random() - 0.5) * this.W;
        p[o + 2] = fz + (Math.random() - 0.5) * this.D;
      }
      if (p[o] < fx - hw) p[o] += this.W;
      else if (p[o] > fx + hw) p[o] -= this.W;
      if (p[o + 2] < fz - hd) p[o + 2] += this.D;
      else if (p[o + 2] > fz + hd) p[o + 2] -= this.D;
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
        arr[i * 6 + 4] = p[o + 1] + 0.9;
        arr[i * 6 + 5] = p[o + 2];
      }
      a.needsUpdate = true;
    } else if (this.snow) {
      for (let i = 0; i < n; i++) {
        const o = i * 3;
        this.q.setFromEuler(this.e.set(time * 1.3 + i, time * 0.9 + i * 0.5, 0));
        this.m4.compose(this.v.set(p[o], p[o + 1], p[o + 2]), this.q, this.s.set(1, 1, 1));
        this.snow.setMatrixAt(i, this.m4);
      }
      this.snow.instanceMatrix.needsUpdate = true;
    }
  }
}
