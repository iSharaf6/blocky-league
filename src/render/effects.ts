import * as THREE from 'three';

interface Bit {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  rx: number; ry: number; spin: number;
  life: number; max: number; size: number;
  gravity: number;
  drag: number;
  /** A streak: stretched this many times its size along `dir` (radians on the ground), no tumble (0: none). */
  stretch: number;
  dir: number;
  /** Grows (rather than shrinks) as it dies: a puff of dust or smoke. */
  grow: boolean;
}

/** Palettes (module constants: an emitter never allocates one per call). */
const DUST = [0xe9dfc4, 0xd9cfb2, 0xf2ead6, 0xc9bf9f];
const FIRE = [0xffe45c, 0xff9a1f, 0xff4a1a, 0xff2e12];
const FROST = [0xe6f7ff, 0xa8e4ff, 0xffffff, 0x7fdcff];
const GRASS = [0x8fcb4c, 0x7dbb3f, 0xa8dc62, 0x6fa838];
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** A cube with its face shading baked into vertex colours (top 1, sides 0.86-0.92, bottom 0.7): reads as a block unlit. */
function shadedCube(): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  const nor = geo.getAttribute('normal');
  const col = new Float32Array(nor.count * 3);
  for (let i = 0; i < nor.count; i++) {
    const ny = nor.getY(i);
    const k = ny > 0.5 ? 1 : ny < -0.5 ? 0.7 : Math.abs(nor.getX(i)) > 0.5 ? 0.92 : 0.86;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

/**
 * One pool of particles in one instanced mesh. Every slot owns its Bit for good (allocated once): a spawn fills
 * a free slot's Bit in place, so particles never allocate in the frame loop.
 */
class Pool {
  readonly mesh: THREE.InstancedMesh;
  /** Every slot's particle; `live[i]` says whether it is in flight. */
  readonly bits: Bit[];
  readonly live: Uint8Array;
  readonly free: number[] = [];
  private c = new THREE.Color();

  constructor(readonly capacity: number, mat: THREE.Material, geo: THREE.BufferGeometry) {
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.bits = [];
    this.live = new Uint8Array(capacity);
    for (let i = 0; i < capacity; i++) {
      this.bits.push({
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, spin: 0, life: 0, max: 1, size: 0, gravity: 0, drag: 0, stretch: 0, dir: 0, grow: false,
      });
    }
    for (let i = capacity - 1; i >= 0; i--) this.free.push(i);
    for (let i = 0; i < capacity; i++) {
      this.mesh.setMatrixAt(i, ZERO);
      this.mesh.setColorAt(i, this.c.setHex(0xffffff));
    }
  }

  /** A free slot's Bit, reset and marked live with `color` (null when the pool is full). */
  take(color: number): Bit | null {
    const i = this.free.pop();
    if (i === undefined) return null;
    this.live[i] = 1;
    const b = this.bits[i];
    b.stretch = 0;
    b.dir = 0;
    b.grow = false;
    this.mesh.setColorAt(i, this.c.setHex(color));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    return b;
  }
}

/**
 * Pooled voxel particles: grass flecks, confetti, sparks, rain splashes — all little cubes. Grass flecks are
 * lit like the lawn they come from; confetti, bursts and splashes are unlit (paper and water catch the
 * floodlights: under rain or night lighting a lit confetti cube goes grey).
 */
export class Effects {
  /** Both pools; add this to the scene. */
  readonly mesh = new THREE.Group();
  private lit: Pool;
  private glow: Pool;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(readonly capacity = 900) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    this.lit = new Pool(Math.round(capacity * 0.3), new THREE.MeshLambertMaterial({ color: 0xffffff }), geo);
    this.glow = new Pool(capacity - this.lit.capacity, new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true }), shadedCube());
    this.mesh.add(this.lit.mesh, this.glow.mesh);
  }

  /** Live particles in each pool (lit grass flecks, unlit confetti / sparks / splashes). */
  get live(): { lit: number; unlit: number } {
    return { lit: this.lit.capacity - this.lit.free.length, unlit: this.glow.capacity - this.glow.free.length };
  }

  /** Fill a particle's motion (the pools' one writer). */
  private static set(
    b: Bit, x: number, y: number, z: number, vx: number, vy: number, vz: number, rx: number, ry: number, spin: number,
    life: number, max: number, size: number, gravity: number, drag: number,
  ): Bit {
    b.x = x; b.y = y; b.z = z;
    b.vx = vx; b.vy = vy; b.vz = vz;
    b.rx = rx; b.ry = ry; b.spin = spin;
    b.life = life; b.max = max; b.size = size;
    b.gravity = gravity; b.drag = drag;
    return b;
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: number, size: number, life: number, gravity = 14, drag = 0.4, unlit = true): void {
    const b = (unlit ? this.glow : this.lit).take(color);
    if (b) Effects.set(b, x, y, z, vx, vy, vz, Math.random() * 6, Math.random() * 6, (Math.random() - 0.5) * 14, life, life, size, gravity, drag);
  }

  /** A flat streak along the ground (speed lines): `len` m long, `size` thick, drifting with (vx, vz). */
  streak(x: number, y: number, z: number, dir: number, len: number, size: number, color: number, life: number, vx = 0, vz = 0): void {
    const b = this.glow.take(color);
    if (!b) return;
    Effects.set(b, x, y, z, vx, 0, vz, 0, 0, 0, life, life, size, 0, 0);
    b.stretch = len / size;
    b.dir = dir;
  }

  /**
   * Chunky impact bits (a ball off the woodwork, off a man, a keeper's gloves): `n` voxel chunks of `colors`
   * from (x, y, z), flying out at up to `speed` m/s biased along (nx, ny, nz) (the way the ball came off; 0s:
   * all round), `size` x a normal bit. Seen from the gantry: fat, fast, short-lived.
   */
  chunks(x: number, y: number, z: number, colors: readonly number[], n: number, speed: number, size = 1.6, nx = 0, ny = 0.6, nz = 0): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * 1.3 - 0.2;
      const sp = speed * (0.45 + Math.random() * 0.55);
      const b = this.glow.take(colors[i % colors.length]);
      if (!b) return;
      Effects.set(b, x, y, z,
        Math.cos(a) * Math.cos(e) * sp + nx * speed * 0.6, Math.sin(e) * sp + ny * speed * 0.6 + 1.2, Math.sin(a) * Math.cos(e) * sp + nz * speed * 0.6,
        Math.random() * 6, Math.random() * 6, (Math.random() - 0.5) * 18,
        0.32 + Math.random() * 0.3, 0.62, (0.1 + Math.random() * 0.07) * size, 16, 1.2);
    }
  }

  /**
   * One bit of the ball's trail at (x, y, z): `size` m, `life` s, drifting with (vx, vy, vz); no gravity or tumble,
   * it just shrinks away where the ball was.
   */
  trailBit(x: number, y: number, z: number, color: number, size: number, life: number, vx = 0, vy = 0, vz = 0): void {
    const b = this.glow.take(color);
    if (b) Effects.set(b, x, y, z, vx, vy, vz, Math.random() * 6, Math.random() * 6, 0, life, life, size, 0, 0);
  }

  /**
   * Dust kicked up at (x, z): pale earthy puffs that drift with (vx, vz), rise a little and swell as they fade
   * (a boot planting hard, a slide, a keeper hitting the deck). `n` puffs, `power` 0..1 for spread and lift.
   */
  dust(x: number, z: number, n: number, power: number, vx = 0, vz = 0, y = 0.06): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.6 + Math.random() * 2) * (0.4 + power);
      // Low and wide: it spreads along the grass, lifting a little, and settles back (never up round the head).
      const b = this.glow.take(DUST[i % 4]);
      if (!b) return;
      Effects.set(b, x + (Math.random() - 0.5) * 0.35, y + Math.random() * 0.08, z + (Math.random() - 0.5) * 0.35,
        Math.cos(a) * sp + vx, 0.25 + Math.random() * 0.8 * power, Math.sin(a) * sp + vz,
        Math.random() * 6, Math.random() * 6, (Math.random() - 0.5) * 3,
        0.35 + Math.random() * 0.3, 0.6, 0.12 + Math.random() * 0.1 * (0.5 + power), 1.6, 2.4);
      b.grow = true;
    }
  }

  /** Sparks: fast, tiny, bright bits that fly out and die quickly (a magnet's crackle, a mega ball). */
  sparks(x: number, y: number, z: number, colors: readonly number[], n: number, speed: number, life = 0.25, gravity = 6): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = (Math.random() - 0.3) * 1.4;
      const sp = speed * (0.5 + Math.random() * 0.5);
      this.spawn(x, y, z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp, Math.sin(a) * Math.cos(e) * sp,
        colors[i % colors.length], 0.05 + Math.random() * 0.05, life * (0.6 + Math.random() * 0.8), gravity, 0.5);
    }
  }

  /** Fire: hot bits that rise and swell into smoke as they fade (the mega ball's tail). */
  fire(x: number, y: number, z: number, n: number, vx = 0, vy = 0, vz = 0): void {
    for (let i = 0; i < n; i++) {
      const b = this.glow.take(FIRE[i % 4]);
      if (!b) return;
      Effects.set(b, x + (Math.random() - 0.5) * 0.16, y + (Math.random() - 0.5) * 0.16, z + (Math.random() - 0.5) * 0.16,
        vx + (Math.random() - 0.5) * 1.2, vy + 1 + Math.random() * 1.5, vz + (Math.random() - 0.5) * 1.2,
        Math.random() * 6, Math.random() * 6, (Math.random() - 0.5) * 8,
        0.22 + Math.random() * 0.2, 0.4, 0.12 + Math.random() * 0.1, -3, 1.5);
      b.grow = true;
    }
  }

  /** Frost: slow, pale-blue flakes that drift down round a frozen player. */
  frost(x: number, y: number, z: number, n: number): void {
    const cols = FROST;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.25 + Math.random() * 0.45;
      this.spawn(x + Math.cos(a) * r, y + Math.random() * 0.6, z + Math.sin(a) * r, (Math.random() - 0.5) * 0.3, 0.2 + Math.random() * 0.3, (Math.random() - 0.5) * 0.3,
        cols[i % 4], 0.05 + Math.random() * 0.04, 0.6 + Math.random() * 0.5, 0.6, 0.2);
    }
  }

  grass(x: number, z: number, n: number, power: number): void {
    const cols = GRASS;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 2.5 * power;
      this.spawn(x, 0.08, z, Math.cos(a) * sp, 1.5 + Math.random() * 3 * power, Math.sin(a) * sp, cols[i % 4], 0.07 + Math.random() * 0.06, 0.5 + Math.random() * 0.4, 14, 0.4, false);
    }
  }

  confetti(cx: number, cz: number, colors: readonly number[], n: number, spread: number): void {
    for (let i = 0; i < n; i++) {
      const x = cx + (Math.random() - 0.5) * spread;
      const z = cz + (Math.random() - 0.5) * spread * 0.5;
      this.spawn(x, 14 + Math.random() * 8, z, (Math.random() - 0.5) * 2, -Math.random() * 2, (Math.random() - 0.5) * 2,
        colors[i % colors.length], 0.16 + Math.random() * 0.1, 3.5 + Math.random() * 2, 2.2, 1.6);
    }
  }

  /** A burst of chunky bits from (x, y, z); `size` scales the bits (2+ for something seen from the gantry). */
  burst(x: number, y: number, z: number, colors: readonly number[], n: number, speed: number, size = 1): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * 1.2;
      const sp = speed * (0.4 + Math.random() * 0.6);
      this.spawn(x, y, z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + 2, Math.sin(a) * Math.cos(e) * sp,
        colors[i % colors.length], (0.12 + Math.random() * 0.1) * size, 0.8 + Math.random() * 0.8, 9, 0.8);
    }
  }

  private splashAcc = 0;

  /**
   * Rain hitting the lawn: tiny pale droplets kicked up around the camera focus (~90 a second over a
   * 44 x 30 m patch), each a two-bit crown that lives a quarter of a second.
   */
  rain(dt: number, cx: number, cz: number, rx = 22, rz = 15, rate = 90, lens?: THREE.Vector3): void {
    this.splashAcc += dt * rate;
    while (this.splashAcc >= 1) {
      this.splashAcc -= 1;
      const x = cx + (Math.random() * 2 - 1) * rx;
      const z = cz + (Math.random() * 2 - 1) * rz;
      // Not right under a low lens (replays, set pieces): up close a splash reads as a floating cube.
      if (lens && lens.y < 12 && Math.hypot(x - lens.x, z - lens.z) < 9) continue;
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
    for (const p of [this.lit, this.glow]) {
      for (let i = 0; i < p.capacity; i++) {
        if (p.live[i]) {
          p.live[i] = 0;
          p.free.push(i);
          p.mesh.setMatrixAt(i, ZERO);
        }
      }
      p.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  update(dt: number): void {
    this.updatePool(this.lit, dt);
    this.updatePool(this.glow, dt);
  }

  private updatePool(p: Pool, dt: number): void {
    let dirty = false;
    for (let i = 0; i < p.capacity; i++) {
      if (!p.live[i]) continue;
      const b = p.bits[i];
      dirty = true;
      b.life -= dt;
      if (b.life <= 0) {
        p.live[i] = 0;
        p.free.push(i);
        p.mesh.setMatrixAt(i, ZERO);
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
      // Dust swells as it thins out (drawn as a shrinking cube it would read as a pebble).
      const sz = b.grow ? b.size * (1 + (1 - b.life / b.max) * 1.2) * Math.min(1, fade * 2) : b.size * fade;
      if (b.stretch) {
        this.q.setFromAxisAngle(this.up, -b.dir);
        this.m4.compose(this.v.set(b.x, b.y, b.z), this.q, this.s.set(sz * b.stretch * fade, sz * 0.5, sz));
      } else {
        this.q.setFromEuler(this.e.set(b.rx, b.ry, 0));
        this.m4.compose(this.v.set(b.x, b.y, b.z), this.q, this.s.set(sz, sz, sz));
      }
      p.mesh.setMatrixAt(i, this.m4);
    }
    if (dirty) p.mesh.instanceMatrix.needsUpdate = true;
  }
}
