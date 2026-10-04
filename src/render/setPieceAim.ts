import * as THREE from 'three';

/**
 * The set-piece aim on the pitch (sim/setPiece.ts), drawn the way the penalty reticle is:
 * - the landing ring of a corner or a wide free kick: the reticle's pixel target laid on the grass where the ball
 *   will come down, pulsing while he places it;
 * - the runs: an arrow on the grass from each box runner to the zone he attacks, the man the ring is for in yellow;
 * - the power ring of a shooting free kick: round the reticle on the goal, filling as SHOOT is held, its last
 *   stretch red (a blast: less sure).
 * All of it is drawn over everything (a wall or a team-mate never hides it), as the reticle is.
 */

/** The reticle's pixel art (render/matchView.ts RETICLE_ART): `#` the ring and crosshair, `o` the centre. */
const ART = [
  '....#####....',
  '..##.....##..',
  '.#....#....#.',
  '.#....#....#.',
  '#...........#',
  '#...........#',
  '#.##..o..##.#',
  '#...........#',
  '#...........#',
  '.#....#....#.',
  '.#....#....#.',
  '..##.....##..',
  '....#####....',
];
/** A pixel of the landing ring (m): about three metres across on the grass. */
const ZONE_PX = 0.235;
const FILL = 0xffd23a;
const CORE = 0xfbfbf4;
const EDGE = 0x1b2230;
const PULSE_HZ = 2.2;
const PULSE = 0.07;
/** A run arrow: the shaft's width (m), the head's length and width, how far short of the zone it stops. */
const RUN_W = 0.2;
const HEAD_L = 0.75;
const HEAD_W = 0.7;
const RUN_SHORT = 0.5;
const RUN_MIN = 1.4;
const MAX_RUNS = 6;
/** The power ring: its segments, radii (m), and the share of it that is a placed strike (the rest: a blast, red). */
const SEGS = 32;
const RING_IN = 0.62;
const RING_OUT = 0.8;
const BLAST_FROM = 0.82;

export interface RunArrow {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** The runner the delivery is for. */
  hot: boolean;
}

const mat = (opacity = 1) =>
  new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide });

/** Pixel art as one flat mesh in the x/y plane (a dark outline round the pixels), `px` m a pixel. */
function pixelMesh(art: readonly string[], px: number): THREE.Mesh {
  const n = art.length;
  const half = (n - 1) / 2;
  const on = (i: number, j: number) => i >= 0 && j >= 0 && i < n && j < n && art[j][i] !== '.';
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  const quad = (i: number, j: number, hex: number) => {
    const x = (i - half) * px;
    const y = (half - j) * px;
    const s = (px * 1.02) / 2;
    pos.push(x - s, y - s, 0, x + s, y - s, 0, x + s, y + s, 0, x - s, y - s, 0, x + s, y + s, 0, x - s, y + s, 0);
    c.setHex(hex);
    for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
  };
  for (let j = -1; j <= n; j++) {
    for (let i = -1; i <= n; i++) {
      if (on(i, j)) continue;
      let near = false;
      for (let dj = -1; dj <= 1 && !near; dj++) for (let di = -1; di <= 1 && !near; di++) near = on(i + di, j + dj);
      if (near) quad(i, j, EDGE);
    }
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (on(i, j)) quad(i, j, art[j][i] === 'o' ? CORE : FILL);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, mat());
  m.frustumCulled = false;
  return m;
}

/** A flat shape in the x/z plane from triangles (x, z pairs), one colour. */
function flatMesh(tris: number[], hex: number): THREE.Mesh {
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color(hex);
  for (let i = 0; i < tris.length; i += 2) {
    pos.push(tris[i], 0, tris[i + 1]);
    col.push(c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, mat(0.92));
  m.frustumCulled = false;
  return m;
}

const rect = (x0: number, z0: number, x1: number, z1: number) => [x0, z0, x1, z0, x1, z1, x0, z0, x1, z1, x0, z1];

class Arrow {
  readonly group = new THREE.Group();
  private shaft: THREE.Mesh[];
  private head: THREE.Mesh[];

  constructor() {
    // (Each part twice: a dark, slightly bigger copy under it is its outline.)
    const mk = (tris: number[], grow: number) => [flatMesh(tris.map((v) => v * 1), EDGE), flatMesh(tris, CORE)].map((m, i) => {
      m.renderOrder = 9 + i;
      if (i === 0) m.scale.set(1, 1, grow);
      return m;
    });
    this.shaft = mk(rect(0, -RUN_W / 2, 1, RUN_W / 2), 1.9);
    this.head = mk([0, -HEAD_W / 2, HEAD_L, 0, 0, HEAD_W / 2], 1.35);
    for (const m of [...this.shaft, ...this.head]) this.group.add(m);
    this.group.visible = false;
  }

  set(r: RunArrow): void {
    const dx = r.x1 - r.x0;
    const dz = r.z1 - r.z0;
    const len = Math.hypot(dx, dz) - RUN_SHORT;
    if (len < RUN_MIN) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    this.group.position.set(r.x0, 0.07, r.z0);
    this.group.rotation.y = -Math.atan2(dz, dx);
    const body = len - HEAD_L;
    for (const m of this.shaft) m.scale.x = body;
    this.shaft[0].position.x = -0.06;
    this.shaft[0].scale.x = body + 0.12;
    for (const m of this.head) m.position.x = body;
    this.head[0].position.x = body - 0.08;
    this.head[0].scale.x = 1.22;
    const hex = r.hot ? FILL : CORE;
    for (const m of [this.shaft[1], this.head[1]]) {
      const col = m.geometry.getAttribute('color') as THREE.BufferAttribute;
      const c = new THREE.Color(hex);
      if (col.getX(0) !== c.r || col.getY(0) !== c.g || col.getZ(0) !== c.b) {
        for (let i = 0; i < col.count; i++) col.setXYZ(i, c.r, c.g, c.b);
        col.needsUpdate = true;
      }
    }
  }

  dispose(): void {
    for (const m of [...this.shaft, ...this.head]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }
}

export class SetPieceAimView {
  readonly group = new THREE.Group();
  private zone: THREE.Mesh;
  private arrows: Arrow[] = [];
  private track: THREE.Mesh;
  private fill: THREE.Mesh;
  private ring = new THREE.Group();
  private clock = 0;
  private zoneLocked = false;

  constructor() {
    this.zone = pixelMesh(ART, ZONE_PX);
    this.zone.rotation.x = -Math.PI / 2;
    this.zone.position.y = 0.08;
    this.zone.renderOrder = 11;
    this.zone.visible = false;
    this.group.add(this.zone);
    for (let i = 0; i < MAX_RUNS; i++) {
      const a = new Arrow();
      this.arrows.push(a);
      this.group.add(a.group);
    }
    // The power ring: a dark track, and over it the lit segments (drawn from the top round, clockwise).
    const build = (hexAt: (k: number) => number, rin: number, rout: number) => {
      const pos: number[] = [];
      const col: number[] = [];
      const c = new THREE.Color();
      for (let i = 0; i < SEGS; i++) {
        const a0 = Math.PI / 2 - (i / SEGS) * Math.PI * 2;
        const a1 = Math.PI / 2 - ((i + 0.82) / SEGS) * Math.PI * 2;
        const p = (r: number, a: number) => [Math.cos(a) * r, Math.sin(a) * r, 0];
        const q = [p(rin, a0), p(rout, a0), p(rout, a1), p(rin, a0), p(rout, a1), p(rin, a1)];
        for (const v of q) pos.push(...v);
        c.setHex(hexAt((i + 0.5) / SEGS));
        for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      const m = new THREE.Mesh(g, mat());
      m.frustumCulled = false;
      return m;
    };
    this.track = build(() => EDGE, RING_IN - 0.05, RING_OUT + 0.05);
    (this.track.material as THREE.MeshBasicMaterial).opacity = 0.7;
    this.track.renderOrder = 12;
    this.fill = build((k) => (k > BLAST_FROM ? 0xff5a4a : FILL), RING_IN, RING_OUT);
    this.fill.renderOrder = 13;
    this.ring.add(this.track, this.fill);
    this.ring.visible = false;
    this.group.add(this.ring);
  }

  /** The landing ring at (x, z) on the grass (null: none). `locked`: struck, it holds still until the ball is away. */
  setZone(aim: { x: number; z: number; locked: boolean } | null): void {
    this.zone.visible = !!aim;
    if (!aim) return;
    this.zone.position.x = aim.x;
    this.zone.position.z = aim.z;
    this.zoneLocked = aim.locked;
  }

  /** The runs to draw (null or empty: none). */
  setRuns(runs: readonly RunArrow[] | null): void {
    for (let i = 0; i < this.arrows.length; i++) {
      const r = runs && i < runs.length ? runs[i] : null;
      if (r) this.arrows[i].set(r);
      else this.arrows[i].group.visible = false;
    }
  }

  /**
   * The power ring round the reticle on the goal plane at x = `gx` (`z` across, `h` up), filled to `k` (0..1; null:
   * off).
   */
  setPower(k: number | null, at: { gx: number; z: number; h: number } | null): void {
    const on = k !== null && !!at;
    this.ring.visible = on;
    if (!on || !at) return;
    this.ring.position.set(at.gx, at.h, at.z);
    this.ring.rotation.y = at.gx > 0 ? -Math.PI / 2 : Math.PI / 2;
    const n = Math.max(1, Math.min(SEGS, Math.round((k ?? 0) * SEGS)));
    this.fill.geometry.setDrawRange(0, n * 6);
  }

  update(dt: number): void {
    this.clock += dt;
    if (!this.zone.visible) return;
    const beat = Math.sin(this.clock * Math.PI * 2 * PULSE_HZ);
    this.zone.scale.setScalar(this.zoneLocked ? 0.88 : 1 + PULSE * beat);
    (this.zone.material as THREE.MeshBasicMaterial).opacity = this.zoneLocked ? 1 : 0.86 + 0.14 * beat;
  }

  /** Everything off at once (a replay, a cut away). */
  clear(): void {
    this.zone.visible = false;
    this.ring.visible = false;
    for (const a of this.arrows) a.group.visible = false;
  }

  dispose(): void {
    this.zone.geometry.dispose();
    (this.zone.material as THREE.Material).dispose();
    for (const a of this.arrows) a.dispose();
    for (const m of [this.track, this.fill]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.group.removeFromParent();
  }
}
