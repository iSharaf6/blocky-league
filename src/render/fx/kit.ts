import * as THREE from 'three';
import { SHAPE_COUNT, SH, shapeCap, shapeFloor, shapeGeometry, shapeMat, type ShapeId, type ShapeMat } from './shapes';

/**
 * The cosmetic effects engine: goal explosions (render/fx/goals.ts) and trails (render/fx/trails.ts), drawn by
 * the match (game/matchSession.ts) and the shop's showcase (ui/shopStage.ts) alike, so the shop shows exactly
 * what a match draws.
 *
 * Every kind of prop (shapes.ts) is one instanced mesh, made the first time something spawns it. Particles are
 * plain objects allocated with their pool and reused for good: a spawn takes a free one and fills it in place, a
 * death swaps it out, so nothing allocates in the frame loop. Live particles are packed at the front of their
 * mesh each frame (`count` = live), so an idle kind costs nothing to draw.
 *
 * A goal explosion is a SHOW: a script run every frame with the seconds since it started (several can overlap).
 * Scripts and trails spawn in a local frame (setFrame): u along `forward` (out of the goal, or a runner's
 * heading), w across it, y up, all times `k` (the stage's goal is a third of a real one, so its shows run at
 * k = 0.36 and look the same, just smaller).
 */

/** Particle look and motion flags. */
export const F = {
  /** Faces the lens (a sprite: hearts, stars, notes). */
  FACE: 1,
  /** Pops in: scales up from nothing with an overshoot over its first 0.18 s. */
  POP: 2,
  /** Swells as it dies (smoke, dust, a puff). */
  PUFF: 4,
  /** Twinkles (its size pulses). */
  TWINK: 8,
  /** Wanders sideways as it goes (balloons, bubbles, leaves). */
  SWAY: 16,
  /** Holds its size to the end (props: a bucket, a trophy), shrinking only in the last 0.15 s. */
  KEEP: 32,
  /** Lies flat on the grass (prints, splats, scorch marks, a shockwave). */
  FLAT: 64,
  /** Orbits a centre (op 0: round the vertical, a tornado; op 1: in the lens's plane, a vortex). */
  ORBIT: 128,
  /** Points along its velocity (rockets, rain, spark streaks), stretched by `st` x speed. */
  AIM: 256,
  /** Swings about its facing axis (wob radians): a piñata, a balloon on its string. */
  WOB: 512,
  /** Flashes through its palette (disco tiles, glitch blocks). */
  FLICK: 1024,
  /** Colour by age through its palette (flames: yellow, orange, red, smoke). */
  AGE: 2048,
  /** Dies the moment it lands (its death event at the spot: mud splats, rain splashes). */
  LAND: 4096,
  /** Faces the lens round the vertical only (a flower standing in the grass). */
  FACEY: 8192,
  /** Keeps its length as it fades (a beam thins out rather than shortening). */
  LEN: 16384,
} as const;

/** What happens when a particle dies (its `die`). */
export const DIE = {
  none: 0, pop: 1, firework: 2, ringwork: 3, shatter: 4, candy: 5, gems: 6, splat: 7, splash: 8, stars: 9, sparkle: 10,
  snow: 11, impact: 12, willow: 13, bubble: 14,
} as const;

/** What a particle sheds while it lives (its `emit`, `er` a second). */
export const EMIT = { none: 0, sparks: 1, smoke: 2, fire: 3, rain: 4, glint: 5, embers: 6, snow: 7, steam: 8 } as const;

/** Sounds a show asks for (the match maps them to sfx; the shop stays quiet). */
export type FxCue = 'boom' | 'whoosh' | 'coin' | 'pop' | 'crack';

const WHITE: readonly number[] = [0xffffff];
const SMOKE = [0x6a6a72, 0x8a8a92, 0x55555c] as const;
const FIRE = [0xfff6a8, 0xffd23a, 0xff9a1f, 0xff4a1a, 0xd8241a, 0x6a5a5a] as const;
const SNOW = [0xffffff, 0xeaf6ff, 0xd6efff] as const;
const RAIN = [0x8fc8ff, 0xcfe8ff, 0x6fb0f0] as const;
const DIRT = [0x7a5236, 0x5a3a20, 0x8a6a4a] as const;
const DUST = [0xe9dfc4, 0xd9cfb2, 0xc9bf9f] as const;

export class P {
  x = 0; y = 0; z = 0; vx = 0; vy = 0; vz = 0;
  rx = 0; ry = 0; rz = 0; wx = 0; wy = 0; wz = 0;
  age = 0; life = 1; delay = 0;
  /** Size (m), its per-axis stretch, and linear growth (m/s: an expanding ring). */
  s = 1; sx = 1; sy = 1; sz = 1; gs = 0;
  /** Gravity (m/s², times k at run time; negative floats up), drag (/s), bounce (<0: passes through the grass), fall cap. */
  g = 0; drag = 0; b = -1; term = 0;
  col = 0xffffff; f = 0; seed = 0; sw = 0; wob = 0; st = 0;
  k = 1;
  ox = 0; oy = 0; oz = 0; oa = 0; or = 0; ow = 0; ovr = 0; ovy = 0; op = 0;
  die = 0; emit = 0; er = 0; ea = 0;
  pal: readonly number[] = WHITE;
}

class Pool {
  readonly mesh: THREE.InstancedMesh;
  readonly ps: P[] = [];
  n = 0;
  constructor(readonly shape: ShapeId, readonly cap: number, mat: THREE.Material) {
    this.mesh = new THREE.InstancedMesh(shapeGeometry(shape), mat, cap);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    for (let i = 0; i < cap; i++) this.ps.push(new P());
    // (Allocate the colour buffer now: the first setColorAt would otherwise allocate it mid-frame.)
    const c = new THREE.Color(1, 1, 1);
    for (let i = 0; i < cap; i++) this.mesh.setColorAt(i, c);
  }
}

/** One running goal explosion. */
export class Show {
  on = false;
  run: ShowFn | null = null;
  t = 0;
  dur = 0;
  x = 0; y = 0; z = 0; fx = 1; fz = 0; k = 1;
  /** Where the ball crossed, across the goal (local w, unscaled m). */
  bw = 0;
  /** Which way along local w the lens is (+1 / -1): set pieces lean that way, lower in the frame. */
  cw = 1;
  /** The lens looks down the pitch at the goal (the portrait end-on shot), not across it from the gantry. */
  endOn = false;
  pal: readonly number[] = WHITE;
  /** Rate accumulators the script may use (rate()). */
  readonly acc = new Float32Array(8);
  /** Script scratch (angles, picks), cleared at start. */
  readonly v = new Float32Array(8);
}

/** A show's script: `a` and `b` are its seconds before and after this frame (a < 0 on its first). */
export type ShowFn = (K: FxKit, s: Show, a: number, b: number, dt: number) => void;

/** A trail emitter's state (one per runner or ball): accumulators and how far it has come. */
export class TrailState {
  acc = 0;
  acc2 = 0;
  dist = 0;
  side = 1;
  t = 0;
  /** The last point (for ribbons that join up). */
  lx = NaN; ly = 0; lz = 0;
  reset(): void {
    this.acc = this.acc2 = this.dist = this.t = 0;
    this.lx = NaN;
  }
}

const rnd = Math.random;
const r2 = (a: number, b: number) => a + rnd() * (b - a);

export class FxKit {
  readonly group = new THREE.Group();
  private pools: (Pool | null)[] = new Array(SHAPE_COUNT).fill(null);
  private mats: { [k in ShapeMat]: THREE.Material | null } = { solid: null, glass: null, light: null };
  private shows: Show[] = [new Show(), new Show(), new Show()];
  /** Spawns when a pool is full write here (never drawn), so callers needn't check. */
  private readonly dummy = new P();
  /** Sound cues from the shows (null: silent). */
  onCue: ((c: FxCue) => void) | null = null;
  /** A dying particle, copied out of its slot before its death event (which may reuse the slot). */
  private readonly ev = new P();

  // The local frame (setFrame).
  private fo = new THREE.Vector3();
  private fux = 1; private fuz = 0; private fwx = 0; private fwz = 1; private fk = 1;

  // Per-frame scratch.
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private qz = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private c = new THREE.Color();
  private camQ = new THREE.Quaternion();
  private camR = new THREE.Vector3(1, 0, 0);
  private camU = new THREE.Vector3(0, 1, 0);
  private camP = new THREE.Vector3(0, 10, 30);
  private zAxis = new THREE.Vector3(0, 0, 1);

  private material(kind: ShapeMat): THREE.Material {
    let m = this.mats[kind];
    if (!m) {
      m = kind === 'solid' ? new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true })
        : kind === 'glass' ? new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false })
          : new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
      this.mats[kind] = m;
    }
    return m;
  }

  private pool(id: ShapeId): Pool {
    let p = this.pools[id];
    if (!p) {
      p = new Pool(id, shapeCap(id), this.material(shapeMat(id)));
      // (Light draws after the solids, so it glows over them.)
      p.mesh.renderOrder = shapeMat(id) === 'light' ? 3 : shapeMat(id) === 'glass' ? 2 : 1;
      this.pools[id] = p;
      this.group.add(p.mesh);
    }
    return p;
  }

  /** Live particles, all kinds. */
  get live(): number {
    let n = 0;
    for (const p of this.pools) if (p) n += p.n;
    return n;
  }

  /** Shows still running. */
  get running(): number {
    let n = 0;
    for (const s of this.shows) if (s.on) n++;
    return n;
  }

  // ------------------------------------------------------------------ spawning

  /** The frame `add` spawns in: origin (world), forward along the ground (normalised here), scale. */
  setFrame(x: number, y: number, z: number, fx: number, fz: number, k = 1): void {
    const l = Math.hypot(fx, fz) || 1;
    this.fo.set(x, y, z);
    this.fux = fx / l;
    this.fuz = fz / l;
    this.fwx = -this.fuz;
    this.fwz = this.fux;
    this.fk = k;
  }

  /**
   * A particle of `shape` at local (u, y, w) moving (vu, vy, vw), `size` m, `life` s, colour `col` (all in the
   * frame's units: times k). Defaults: no gravity, no drag, passes through the grass, shrinks over its last 30%.
   * Returns it to set the rest; when its pool is full, a dummy that is never drawn.
   */
  add(shape: ShapeId, u: number, y: number, w: number, vu: number, vy: number, vw: number, size: number, life: number, col: number): P {
    const pool = this.pool(shape);
    if (pool.n >= pool.cap) return this.dummy;
    const p = pool.ps[pool.n++];
    const k = this.fk;
    p.x = this.fo.x + (this.fux * u + this.fwx * w) * k;
    p.y = this.fo.y + y * k;
    p.z = this.fo.z + (this.fuz * u + this.fwz * w) * k;
    p.vx = (this.fux * vu + this.fwx * vw) * k;
    p.vy = vy * k;
    p.vz = (this.fuz * vu + this.fwz * vw) * k;
    p.rx = p.ry = p.rz = p.wx = p.wy = p.wz = 0;
    p.age = 0; p.life = Math.max(0.01, life); p.delay = 0;
    p.s = size * k; p.sx = p.sy = p.sz = 1; p.gs = 0;
    p.g = 0; p.drag = 0; p.b = -1; p.term = 0;
    p.col = col; p.f = 0; p.seed = rnd() * 100; p.sw = 0; p.wob = 0; p.st = 0;
    p.k = k;
    p.op = 0; p.or = 0; p.ow = 0; p.ovr = 0; p.ovy = 0;
    p.die = 0; p.emit = 0; p.er = 0; p.ea = 0;
    p.pal = WHITE;
    return p;
  }

  /** The runner (or ball) a trail is emitting from this frame (render/fx/trails.ts): where, which way, what scale. */
  lastX = 0; lastY = 0; lastZ = 0; lastFx = 1; lastFz = 0; lastK = 1;

  trailAt(x: number, y: number, z: number, fx: number, fz: number, k: number): void {
    this.lastX = x; this.lastY = y; this.lastZ = z; this.lastFx = fx; this.lastFz = fz; this.lastK = k;
    this.setFrame(x, y, z, fx, fz, k);
  }

  /** The frame's yaw (radians about +y) for a rotation that lines a +z prop up with local `u`. */
  get yawU(): number {
    return Math.atan2(this.fux, this.fuz);
  }

  /** Point p's +z along local direction (du, dy, dw) (a cannon's muzzle, a searchlight). */
  aim(p: P, du: number, dy: number, dw: number): P {
    const dx = this.fux * du + this.fwx * dw;
    const dz = this.fuz * du + this.fwz * dw;
    const len = Math.hypot(dx, dy, dz) || 1;
    p.ry = Math.atan2(dx, dz);
    p.rx = -Math.asin(Math.max(-1, Math.min(1, dy / len)));
    return p;
  }

  /** World position of local point (u, y, w) in the current frame, into `out`. */
  toWorld(u: number, y: number, w: number, out: THREE.Vector3): THREE.Vector3 {
    const k = this.fk;
    return out.set(this.fo.x + (this.fux * u + this.fwx * w) * k, this.fo.y + y * k, this.fo.z + (this.fuz * u + this.fwz * w) * k);
  }

  /** Make p orbit the point it was spawned at: `r` m out (local units) at `w` rad/s, closing at `vr` m/s, rising at `vy`. */
  orbit(p: P, plane: 0 | 1, r: number, w: number, vr = 0, vy = 0, a = Math.random() * 6.283): P {
    p.f |= F.ORBIT;
    p.op = plane;
    p.ox = p.x; p.oy = p.y; p.oz = p.z;
    p.or = r * p.k; p.ow = w; p.ovr = vr * p.k; p.ovy = vy * p.k; p.oa = a;
    return p;
  }

  /** A random tumble: spin rates up to `w` rad/s about each axis and a random start. */
  static tumble(p: P, w: number): P {
    p.rx = rnd() * 6.3; p.ry = rnd() * 6.3; p.rz = rnd() * 6.3;
    p.wx = (rnd() - 0.5) * 2 * w; p.wy = (rnd() - 0.5) * 2 * w; p.wz = (rnd() - 0.5) * 2 * w;
    return p;
  }

  /**
   * A beam (additive light) from local point A to local point B, `thick` m across, `life` s: lightning
   * segments, a laser, a searchlight.
   */
  beamTo(au: number, ay: number, aw: number, bu: number, by: number, bw: number, thick: number, life: number, col: number): P {
    const p = this.add(SH.beam, au, ay, aw, 0, 0, 0, thick, life, col);
    const k = this.fk;
    const dx = (this.fux * (bu - au) + this.fwx * (bw - aw)) * k;
    const dy = (by - ay) * k;
    const dz = (this.fuz * (bu - au) + this.fwz * (bw - aw)) * k;
    const len = Math.hypot(dx, dy, dz) || 1e-3;
    p.ry = Math.atan2(dx, dz);
    p.rx = -Math.asin(Math.max(-1, Math.min(1, dy / len)));
    p.sz = len / Math.max(1e-3, p.s);
    p.f |= F.KEEP | F.LEN;
    return p;
  }

  /** How many to spawn this frame at `perSec` (slot `i` of the show's accumulators). */
  rate(s: Show, i: number, perSec: number, dt: number): number {
    s.acc[i] += Math.max(0, perSec) * dt;
    const n = Math.floor(s.acc[i]);
    s.acc[i] -= n;
    return n;
  }

  cue(c: FxCue): void {
    this.onCue?.(c);
  }

  // ------------------------------------------------------------------ shows

  /**
   * Start a show: its script `run` for `dur` s at world (x, y, z) facing (fx, fz) (out of the goal), scale `k`,
   * palette `pal`, `bw` = where the ball crossed (local m across the mouth). The oldest show gives way when three
   * are running.
   */
  play(run: ShowFn, dur: number, x: number, y: number, z: number, fx: number, fz: number, k: number, pal: readonly number[], bw = 0): Show {
    let s = this.shows.find((q) => !q.on);
    if (!s) s = this.shows.reduce((a, q) => (q.t > a.t ? q : a));
    s.on = true;
    s.run = run;
    s.t = 0;
    s.dur = dur;
    s.x = x; s.y = y; s.z = z;
    const l = Math.hypot(fx, fz) || 1;
    s.fx = fx / l; s.fz = fz / l;
    s.k = k;
    s.pal = pal.length ? pal : WHITE;
    s.bw = bw;
    // (The lens as of the last frame drawn: across the mouth, w = (-fz, 0, fx).)
    const across = (this.camP.x - x) * -s.fz + (this.camP.z - z) * s.fx;
    const along = (this.camP.x - x) * s.fx + (this.camP.z - z) * s.fz;
    s.cw = across >= 0 ? 1 : -1;
    s.endOn = Math.abs(along) > Math.abs(across);
    s.acc.fill(0);
    s.v.fill(0);
    // The first frame runs the script's t = 0 beats at once (a = -1 µs).
    this.step(s, 0);
    return s;
  }

  private step(s: Show, dt: number): void {
    const a = s.t === 0 ? -1e-6 : s.t;
    s.t += dt;
    this.setFrame(s.x, s.y, s.z, s.fx, s.fz, s.k);
    s.run?.(this, s, a, s.t, dt);
    if (s.t >= s.dur) s.on = false;
  }

  /** Stop everything (a cut to the replay, the shop showing another item). */
  clear(): void {
    for (const s of this.shows) s.on = false;
    for (const p of this.pools) {
      if (!p) continue;
      p.n = 0;
      p.mesh.count = 0;
      p.mesh.visible = false;
    }
  }

  dispose(): void {
    this.clear();
    this.group.removeFromParent();
    for (const p of this.pools) p?.mesh.dispose();
    for (const k of ['solid', 'glass', 'light'] as const) this.mats[k]?.dispose();
    this.pools.fill(null);
    this.mats = { solid: null, glass: null, light: null };
  }

  // ------------------------------------------------------------------ the frame

  /** Advance the shows and every particle by `dt` (0: hold still) and draw them for `camera`. */
  update(dt: number, camera: THREE.Camera): void {
    camera.getWorldQuaternion(this.camQ);
    camera.getWorldPosition(this.camP);
    // (Billboards and vortices work in the group's space: it is only ever translated.)
    this.camP.sub(this.group.position);
    this.camR.set(1, 0, 0).applyQuaternion(this.camQ);
    this.camU.set(0, 1, 0).applyQuaternion(this.camQ);
    if (dt > 0) for (let i = 0; i < this.shows.length; i++) if (this.shows[i].on) this.step(this.shows[i], dt);
    for (let i = 0; i < this.pools.length; i++) {
      const pool = this.pools[i];
      if (pool && (pool.n > 0 || pool.mesh.count > 0)) this.updatePool(pool, dt);
    }
  }

  private updatePool(pool: Pool, dt: number): void {
    const floor = shapeFloor(pool.shape);
    let i = 0;
    let drawn = 0;
    const mesh = pool.mesh;
    while (i < pool.n) {
      const p = pool.ps[i];
      if (dt > 0) {
        if (p.delay > 0) {
          p.delay -= dt;
          i++;
          continue;
        }
        p.age += dt;
        if (p.age >= p.life) {
          this.kill(pool, i, p);
          continue;
        }
        if (!this.move(p, dt, floor)) {
          this.kill(pool, i, p);
          continue;
        }
      } else if (p.delay > 0) {
        i++;
        continue;
      }
      this.draw(p, mesh, drawn++);
      i++;
    }
    mesh.count = drawn;
    mesh.visible = drawn > 0;
    if (drawn > 0) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  /** Swap a dead particle out of the live run and fire its death event. */
  private kill(pool: Pool, i: number, p: P): void {
    const last = pool.n - 1;
    pool.ps[i] = pool.ps[last];
    pool.ps[last] = p;
    pool.n = last;
    if (p.die) this.event(Object.assign(this.ev, p));
  }

  /** One step of motion; false when it should die now (landed with LAND, an orbit run down). */
  private move(p: P, dt: number, floor: number): boolean {
    if (p.f & F.ORBIT) {
      p.or += p.ovr * dt;
      if (p.or <= 0.05 * p.k) return false;
      // Faster as it falls in (a whirlpool), slower out.
      const w = p.ow * Math.max(0.5, Math.min(4, (3 * p.k) / p.or));
      p.oa += w * dt;
      p.oy += p.ovy * dt;
      const c = Math.cos(p.oa) * p.or, s = Math.sin(p.oa) * p.or;
      if (p.op === 1) {
        p.x = p.ox + this.camR.x * c + this.camU.x * s;
        p.y = p.oy + this.camR.y * c + this.camU.y * s;
        p.z = p.oz + this.camR.z * c + this.camU.z * s;
      } else {
        p.x = p.ox + c;
        p.y = p.oy;
        p.z = p.oz + s;
      }
    } else {
      p.vy -= p.g * p.k * dt;
      if (p.drag) {
        const k = Math.exp(-p.drag * dt);
        p.vx *= k;
        p.vz *= k;
        if (p.term === 0) p.vy *= k;
      }
      if (p.term > 0 && p.vy < -p.term * p.k) p.vy = -p.term * p.k;
      if (p.f & F.SWAY) {
        p.vx += Math.cos(p.age * 2.7 + p.seed) * p.sw * p.k * dt;
        p.vz += Math.sin(p.age * 2.3 + p.seed * 1.3) * p.sw * p.k * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.b >= 0) {
        const rest = (p.f & F.FLAT ? 0.01 : floor * p.s * p.sy) + 0.005;
        if (p.y < rest) {
          if (p.f & F.LAND) return false;
          p.y = rest;
          if (p.vy < 0) p.vy = -p.vy * p.b;
          if (p.vy < 0.6 * p.k) p.vy = 0;
          p.vx *= 0.7;
          p.vz *= 0.7;
          p.wx *= 0.6;
          p.wz *= 0.6;
        }
      }
    }
    p.rx += p.wx * dt;
    p.ry += p.wy * dt;
    p.rz += p.wz * dt;
    if (p.gs) p.s += p.gs * dt;
    if (p.emit) {
      p.ea += p.er * dt;
      while (p.ea >= 1) {
        p.ea -= 1;
        this.shed(p);
      }
    }
    return true;
  }

  private draw(p: P, mesh: THREE.InstancedMesh, slot: number): void {
    const u = p.age / p.life;
    let sz = p.s;
    const f = p.f;
    if (f & F.POP) {
      const k = Math.min(1, p.age / 0.18);
      // easeOutBack: up past full size and settle.
      sz *= k >= 1 ? 1 : 1 + 2.7 * (k - 1) ** 3 + 1.7 * (k - 1) ** 2;
    }
    if (f & F.PUFF) sz *= 1 + u * 1.4;
    if (f & F.TWINK) sz *= 0.55 + 0.45 * Math.abs(Math.sin(p.age * 11 + p.seed));
    const left = p.life - p.age;
    // (A growing ring just goes when its time is up: shrinking it would read as it closing back in.)
    if (p.gs <= 0) sz *= f & F.KEEP ? Math.min(1, left / 0.15) : Math.min(1, left / (p.life * 0.3));
    if (sz < 1e-4) sz = 1e-4;
    // Rotation.
    if (f & F.FACE) {
      // (An orbiting sprite turns with its orbit: a sun's rays stay pointing out.)
      this.qz.setFromAxisAngle(this.zAxis, p.rz + (f & F.ORBIT && p.op === 1 ? p.oa : 0) + (f & F.WOB ? Math.sin(p.age * 6 + p.seed) * p.wob : 0));
      this.q.copy(this.camQ).multiply(this.qz);
    } else if (f & F.FACEY) {
      this.e.set(0, Math.atan2(this.camP.x - p.x, this.camP.z - p.z), f & F.WOB ? Math.sin(p.age * 3 + p.seed) * p.wob : 0);
      this.q.setFromEuler(this.e);
    } else if (f & F.FLAT) {
      this.e.set(-Math.PI / 2, p.ry, 0);
      this.q.setFromEuler(this.e);
    } else if (f & F.AIM) {
      const sp = Math.hypot(p.vx, p.vy, p.vz);
      if (sp > 1e-3) {
        p.ry = Math.atan2(p.vx, p.vz);
        p.rx = -Math.asin(Math.max(-1, Math.min(1, p.vy / sp)));
      }
      this.e.set(p.rx, p.ry, p.rz);
      this.q.setFromEuler(this.e);
    } else {
      this.e.set(p.rx, p.ry, p.rz + (f & F.WOB ? Math.sin(p.age * 5 + p.seed) * p.wob : 0));
      this.q.setFromEuler(this.e);
    }
    let lz = p.sz;
    if (p.st) lz *= 1 + Math.hypot(p.vx, p.vy, p.vz) * p.st;
    this.m4.compose(this.v.set(p.x, p.y, p.z), this.q, this.sc.set(sz * p.sx, sz * p.sy, f & F.LEN ? p.s * lz : sz * lz));
    mesh.setMatrixAt(slot, this.m4);
    let col = p.col;
    const pal = p.pal;
    if (f & F.FLICK && pal.length) col = pal[(Math.floor(p.age * 8 + p.seed) % pal.length + pal.length) % pal.length];
    else if (f & F.AGE && pal.length) col = pal[Math.min(pal.length - 1, Math.floor(u * pal.length))];
    mesh.setColorAt(slot, this.c.setHex(col));
  }

  // ------------------------------------------------------------------ what particles shed and leave

  /** Spawn in world space round particle p (its own scale). */
  private at(p: P): void {
    this.setFrame(p.x, p.y, p.z, 1, 0, p.k);
  }

  private shed(p: P): void {
    this.at(p);
    const vx = p.vx / p.k, vz = p.vz / p.k;
    switch (p.emit) {
      case EMIT.sparks: {
        const q = this.add(SH.cube, r2(-0.1, 0.1), r2(-0.1, 0.1), r2(-0.1, 0.1), -vx * 0.1 + r2(-1, 1), r2(-1, 0.5), -vz * 0.1 + r2(-1, 1), r2(0.07, 0.12), r2(0.25, 0.45), p.pal[(rnd() * p.pal.length) | 0]);
        q.g = 4;
        q.f |= F.TWINK;
        break;
      }
      case EMIT.smoke: {
        const q = this.add(SH.blob, r2(-0.2, 0.2), 0, r2(-0.2, 0.2), r2(-0.4, 0.4), r2(0.5, 1.2), r2(-0.4, 0.4), r2(0.35, 0.6), r2(0.7, 1.1), SMOKE[(rnd() * 3) | 0]);
        q.f |= F.PUFF;
        q.drag = 1;
        break;
      }
      case EMIT.fire: {
        const q = this.add(SH.cube, r2(-0.3, 0.3), r2(-0.3, 0.3), r2(-0.3, 0.3), -vx * 0.15 + r2(-1, 1), r2(0.5, 2), -vz * 0.15 + r2(-1, 1), r2(0.35, 0.6), r2(0.3, 0.55), FIRE[0]);
        q.f |= F.PUFF | F.AGE;
        q.pal = FIRE;
        q.g = -2;
        q.drag = 1.5;
        FxKit.tumble(q, 4);
        break;
      }
      case EMIT.rain: {
        const q = this.add(SH.cube, r2(-1.6, 1.6), -0.4, r2(-0.6, 0.6), 0, -9, 0, 0.07, 1.4, RAIN[(rnd() * 3) | 0]);
        q.f |= F.AIM | F.LAND;
        q.st = 0.5;
        q.g = 6;
        q.b = 0;
        q.die = DIE.splash;
        break;
      }
      case EMIT.glint: {
        const a = rnd() * 6.3, r = r2(0.4, 0.9) * (p.s / p.k);
        const q = this.add(SH.sparkle, Math.cos(a) * r, Math.sin(a) * r, r2(-0.3, 0.3), 0, 0.3, 0, r2(0.25, 0.45), r2(0.3, 0.5), p.pal[(rnd() * p.pal.length) | 0]);
        q.f |= F.FACE | F.TWINK;
        break;
      }
      case EMIT.embers: {
        const q = this.add(SH.cube, r2(-0.4, 0.4), 0.2, r2(-0.4, 0.4), r2(-0.6, 0.6), r2(1, 2.5), r2(-0.6, 0.6), r2(0.06, 0.12), r2(0.6, 1), FIRE[(rnd() * 3) | 0]);
        q.g = -0.5;
        q.f |= F.TWINK | F.SWAY;
        q.sw = 2;
        break;
      }
      case EMIT.snow: {
        const q = this.add(SH.flake, r2(-0.5, 0.5), 0, r2(-0.5, 0.5), r2(-0.5, 0.5), r2(-0.5, 0.3), r2(-0.5, 0.5), r2(0.18, 0.3), r2(0.8, 1.3), SNOW[(rnd() * 3) | 0]);
        q.f |= F.FACE | F.SWAY;
        q.sw = 1.5;
        q.wz = r2(-2, 2);
        break;
      }
      case EMIT.steam: {
        const q = this.add(SH.blob, r2(-0.3, 0.3), 0.1, r2(-0.3, 0.3), 0, r2(0.6, 1.2), 0, r2(0.25, 0.4), r2(0.5, 0.8), 0xdfe6ee);
        q.f |= F.PUFF;
        break;
      }
    }
  }

  private event(p: P): void {
    this.at(p);
    const pal = p.pal;
    const pk = (i: number) => pal[i % pal.length];
    switch (p.die) {
      case DIE.pop: {
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * 6.3;
          const q = this.add(SH.cube, 0, 0, 0, Math.cos(a) * 3, r2(-1, 2.5), Math.sin(a) * 3, (p.s / p.k) * 0.18, r2(0.25, 0.4), i % 2 ? p.col : 0xffffff);
          q.drag = 3;
          q.g = 4;
        }
        break;
      }
      case DIE.bubble: {
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * 6.3;
          const q = this.add(SH.cube, 0, 0, 0, Math.cos(a) * 1.5, Math.sin(a) * 1.5, r2(-0.5, 0.5), (p.s / p.k) * 0.16, 0.2, p.col);
          q.drag = 4;
        }
        break;
      }
      case DIE.firework:
      case DIE.ringwork:
      case DIE.willow: {
        const ring = p.die === DIE.ringwork;
        const willow = p.die === DIE.willow;
        const n = ring ? 46 : willow ? 56 : 64;
        const sp = willow ? 6.5 : 10;
        for (let i = 0; i < n; i++) {
          let dx: number, dy: number, dz: number;
          if (ring) {
            const a = (i / n) * Math.PI * 2;
            // A ring facing the lens.
            dx = this.camR.x * Math.cos(a) + this.camU.x * Math.sin(a);
            dy = this.camR.y * Math.cos(a) + this.camU.y * Math.sin(a);
            dz = this.camR.z * Math.cos(a) + this.camU.z * Math.sin(a);
          } else {
            // Even directions on a sphere (the golden spiral).
            const y = 1 - (2 * (i + 0.5)) / n;
            const r = Math.sqrt(1 - y * y);
            const a = i * 2.39996;
            dx = Math.cos(a) * r; dy = y; dz = Math.sin(a) * r;
          }
          const v = sp * r2(0.85, 1.1);
          const q = this.add(SH.cube, 0, 0, 0, dx * v, dy * v, dz * v, willow ? 0.22 : r2(0.26, 0.36), willow ? r2(1.4, 1.9) : r2(0.9, 1.3), willow ? (i % 3 ? 0xffd23a : 0xfff0b0) : pk(i));
          q.drag = willow ? 1.2 : 2.4;
          q.g = willow ? 3.5 : 2.5;
          q.f |= F.TWINK;
          q.pal = pal;
          if (willow) {
            q.f |= F.AIM;
            q.st = 0.25;
          }
        }
        this.add(SH.glow, 0, 0, 0, 0, 0, 0, 1.4, 0.12, 0xfff6d0);
        this.cue('boom');
        break;
      }
      case DIE.shatter: {
        for (let i = 0; i < 4; i++) {
          const q = this.add(SH.shard, 0, 0, 0, r2(2, 7), r2(2, 7), r2(-4, 4), (p.s / p.k) * r2(0.45, 0.7), r2(1.1, 1.7), i % 2 ? 0xd6f3ff : 0xa8e4ff);
          q.g = 14; q.b = 0.3;
          FxKit.tumble(q, 10);
        }
        const s = this.add(SH.blob, 0, 0, 0, r2(0, 1), 0.5, 0, (p.s / p.k) * 0.7, 0.5, 0xeaf6ff);
        s.f |= F.PUFF;
        break;
      }
      case DIE.candy: {
        for (let i = 0; i < 36; i++) {
          const a = rnd() * 6.3, e = r2(-0.2, 1.2), v = r2(5, 10);
          const q = this.add(i % 4 === 3 ? SH.star : SH.candy, 0, 0, 0, Math.cos(a) * Math.cos(e) * v, Math.sin(e) * v + 3, Math.sin(a) * Math.cos(e) * v, i % 4 === 3 ? 0.4 : 0.55, r2(2, 2.6), pk(i));
          q.g = 14; q.b = 0.4;
          FxKit.tumble(q, 8);
        }
        for (let i = 0; i < 40; i++) {
          const a = rnd() * 6.3, v = r2(3, 8);
          const q = this.add(SH.cube, 0, 0, 0, Math.cos(a) * v, r2(2, 8), Math.sin(a) * v, 0.2, r2(1.8, 2.6), pk(i + 1));
          q.sy = 0.15; q.g = 6; q.drag = 1.6; q.term = 2; q.f |= F.SWAY; q.sw = 3;
          FxKit.tumble(q, 8);
        }
        this.cue('pop');
        break;
      }
      case DIE.gems: {
        for (let i = 0; i < 26; i++) {
          const a = rnd() * 6.3, e = r2(-0.3, 1), v = r2(5, 11);
          const q = this.add(SH.gem, 0, 0, 0, Math.cos(a) * Math.cos(e) * v, Math.sin(e) * v + 2, Math.sin(a) * Math.cos(e) * v, r2(0.45, 0.75), r2(1.8, 2.4), pk(i));
          q.g = 14; q.b = 0.45; q.die = DIE.sparkle; q.pal = pal;
          FxKit.tumble(q, 7);
        }
        for (let i = 0; i < 60; i++) {
          const a = rnd() * 6.3, e = r2(-1, 1.2), v = r2(6, 14);
          const q = this.add(SH.sparkle, 0, 0, 0, Math.cos(a) * Math.cos(e) * v, Math.sin(e) * v, Math.sin(a) * Math.cos(e) * v, r2(0.3, 0.5), r2(0.5, 0.9), 0xffffff);
          q.drag = 2.5; q.f |= F.FACE | F.TWINK;
        }
        this.add(SH.glow, 0, 0, 0, 0, 0, 0, 3, 0.14, 0xd6f5ff);
        this.cue('crack');
        break;
      }
      case DIE.splat: {
        const q = this.add(SH.splat, 0, 0, 0, 0, 0, 0, (p.s / p.k) * r2(1.6, 2.4), r2(1.6, 2.2), p.col);
        q.f |= F.FLAT | F.POP | F.KEEP;
        q.ry = rnd() * 6.3;
        q.y = 0.02;
        for (let i = 0; i < 4; i++) {
          const a = rnd() * 6.3;
          const d = this.add(SH.cube, 0, 0.1, 0, Math.cos(a) * 3, r2(1, 3), Math.sin(a) * 3, (p.s / p.k) * 0.25, 0.5, p.col);
          d.g = 14; d.b = 0;
        }
        break;
      }
      case DIE.splash: {
        const r = this.add(SH.ring, 0, 0, 0, 0, 0, 0, (p.s / p.k) * 2, 0.3, 0xcfe8ff);
        r.f |= F.FLAT; r.gs = 3 * p.k; r.y = 0.02;
        for (let i = 0; i < 3; i++) {
          const a = rnd() * 6.3;
          const d = this.add(SH.cube, 0, 0.05, 0, Math.cos(a) * 1.2, r2(1.5, 2.5), Math.sin(a) * 1.2, (p.s / p.k) * 0.9, 0.25, p.col);
          d.g = 12;
        }
        break;
      }
      case DIE.stars: {
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * 6.3;
          const q = this.add(SH.star, 0, 0.3, 0, Math.cos(a) * 3, r2(3, 6), Math.sin(a) * 3, r2(0.3, 0.45), r2(0.7, 1), pk(i));
          q.g = 6; q.drag = 1.5; q.f |= F.FACE | F.TWINK;
        }
        this.add(SH.glow, 0, 0.3, 0, 0, 0, 0, 1.2, 0.12, 0xffffff);
        this.cue('pop');
        break;
      }
      case DIE.sparkle: {
        const q = this.add(SH.sparkle, 0, 0.2, 0, 0, 0.4, 0, r2(0.4, 0.6), 0.4, 0xffffff);
        q.f |= F.FACE | F.POP;
        break;
      }
      case DIE.snow: {
        for (let i = 0; i < 6; i++) {
          const a = rnd() * 6.3;
          const q = this.add(SH.blob, 0, 0, 0, Math.cos(a) * 2.5, r2(0.5, 2.5), Math.sin(a) * 2.5, (p.s / p.k) * 0.35, r2(0.4, 0.6), 0xffffff);
          q.g = 8; q.drag = 2;
        }
        break;
      }
      case DIE.impact: {
        this.impact(pal);
        break;
      }
    }
  }

  /** A meteor's landing (DIE.impact): the flash, a crater, a shockwave, rocks, fire and a dust wall. */
  private impact(pal: readonly number[]): void {
    this.add(SH.glow, 0, 1, 0, 0, 0, 0, 6, 0.16, 0xfff6d0);
    const crater = this.add(SH.disc, 0, 0, 0, 0, 0, 0, 6, 2.8, 0x3a2a26);
    crater.f |= F.FLAT | F.POP | F.KEEP;
    crater.y = 0.03;
    const ring = this.add(SH.ring, 0, 0, 0, 0, 0, 0, 2, 0.8, pal[0]);
    ring.f |= F.FLAT; ring.gs = 34; ring.y = 0.05;
    for (let i = 0; i < 26; i++) {
      const a = rnd() * 6.3, e = r2(0.3, 1.2), v = r2(7, 14);
      const q = this.add(SH.rock, 0, 0.5, 0, Math.cos(a) * Math.cos(e) * v, Math.sin(e) * v, Math.sin(a) * Math.cos(e) * v, r2(0.4, 0.9), r2(1.6, 2.4), 0xffffff);
      q.g = 16; q.b = 0.3; q.emit = EMIT.fire; q.er = 10;
      FxKit.tumble(q, 8);
    }
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * 6.3;
      const q = this.add(SH.blob, Math.cos(a) * 1.5, 0.4, Math.sin(a) * 1.5, Math.cos(a) * r2(10, 15), r2(0.5, 2), Math.sin(a) * r2(10, 15), r2(0.8, 1.3), r2(0.9, 1.3), DUST[i % 3]);
      q.drag = 2.6; q.f |= F.PUFF;
    }
    for (let i = 0; i < 40; i++) {
      const a = rnd() * 6.3, v = r2(3, 10);
      const q = this.add(SH.cube, 0, 0.5, 0, Math.cos(a) * v, r2(4, 12), Math.sin(a) * v, r2(0.35, 0.6), r2(0.5, 0.9), FIRE[0]);
      q.f |= F.PUFF | F.AGE; q.pal = FIRE; q.g = 4; q.drag = 1.5;
      FxKit.tumble(q, 5);
    }
    this.cue('boom');
  }
}

/** Shared random helpers for the scripts. */
export const rand = r2;
export function pick<T>(a: readonly T[]): T {
  return a[(rnd() * a.length) | 0];
}
export const FX_FIRE = FIRE;
export const FX_SMOKE = SMOKE;
export const FX_SNOW = SNOW;
export const FX_RAIN = RAIN;
export const FX_DIRT = DIRT;
