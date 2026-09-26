import * as THREE from 'three';
import type { PowerUp, PowerUpKind } from '../sim/types';
import { VoxelGrid, meshVoxels, voxelMaterial } from './voxel';

/**
 * Blitz mode visuals (only ever built in a blitz match): the pickups lying on the pitch (a spinning, bobbing
 * voxel cube per kind with its glyph painted on, over a soft glow ring; popping in, shrinking out), the held
 * item floating over the controlled player's head, the shield bubble round a protected carrier and the faint
 * ground glow under a whole side on turbo / under ice. Particles (trails, sparks, frost, fire) are the
 * session's, through Effects; the ball's red-hot look is MatchView.setBallHot.
 */

export const POWER_COLOR: Record<PowerUpKind, number> = {
  turbo: 0xffd23a, mega: 0xff3b2f, freeze: 0x7fdcff, magnet: 0xb44dff, shield: 0x3aff9e,
};
/** A lighter accent per kind (sparks, trails, the glyph's highlight). */
export const POWER_LIGHT: Record<PowerUpKind, number> = {
  turbo: 0xfff3a8, mega: 0xffa040, freeze: 0xffffff, magnet: 0xe6b8ff, shield: 0xc8ffe6,
};
/** Ink for the glyph on each cube (dark on the bright cubes, white on the deep ones) and its accent. */
const GLYPH_INK: Record<PowerUpKind, [number, number]> = {
  turbo: [0x26262e, 0xffffff], mega: [0xfbfbf4, 0xffe45c], freeze: [0x1b3a5c, 0xffffff], magnet: [0xfbfbf4, 0xff5a5a], shield: [0x1a4d2e, 0xffffff],
};
/** 5x5 glyphs: '#' ink, '*' accent, '.' the cube's own colour. */
const GLYPH: Record<PowerUpKind, string[]> = {
  turbo: ['..###', '.###.', '####.', '..##.', '.##..'],
  mega: ['..*..', '.###.', '#####', '#####', '.###.'],
  freeze: ['#.#.#', '.###.', '##.##', '.###.', '#.#.#'],
  magnet: ['**.**', '##.##', '#...#', '#...#', '.###.'],
  shield: ['##*##', '##*##', '*****', '.###.', '..#..'],
};
export const KINDS: PowerUpKind[] = ['turbo', 'mega', 'freeze', 'magnet', 'shield'];

/** Pickup cube edge (m), its voxel grid and the glyph's inset on each face. */
const PICK_SIZE = 0.7;
const N = 9;
const INSET = 2;
/** Spawn pop / despawn shrink (s), the float height and bob, and the spin (rad/s). */
const POP_S = 0.35;
const SHRINK_S = 0.22;
const FLOAT_Y = 0.62;
const BOB = 0.09;
const SPIN = 1.5;
/** The held-item icon over the controlled player's head: its scale and lift over the head. */
const ICON_K = 0.42;
const ICON_UP = 0.62;

const geoCache = new Map<PowerUpKind, THREE.BufferGeometry>();

/** The cube for a kind: chamfered corners, the glyph painted on the top and all four sides. Cached. */
export function pickupGeometry(kind: PowerUpKind): THREE.BufferGeometry {
  let g = geoCache.get(kind);
  if (g) return g;
  const grid = new VoxelGrid(N, N, N);
  const base = POWER_COLOR[kind];
  grid.box(0, 0, 0, N, N, N, base);
  // Chamfer: the eight corner voxels off, so it reads as a toy block rather than a die.
  for (const x of [0, N - 1]) for (const y of [0, N - 1]) for (const z of [0, N - 1]) grid.set(x, y, z, null);
  const [ink, accent] = GLYPH_INK[kind];
  const rows = GLYPH[kind];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const ch = rows[r][c];
      if (ch === '.') continue;
      const col = ch === '*' ? accent : ink;
      const u = INSET + c;
      // Top face: rows run away from the viewer (-x .. +x), columns across (z).
      grid.set(INSET + r, N - 1, u, col);
      // Sides: rows run down from the top.
      const y = N - 1 - INSET - r;
      grid.set(N - 1, y, u, col);
      grid.set(0, y, N - 1 - u, col);
      grid.set(N - 1 - u, y, N - 1, col);
      grid.set(u, y, 0, col);
    }
  }
  g = meshVoxels(grid, { scale: PICK_SIZE / N, pivot: [N / 2, N / 2, N / 2] });
  geoCache.set(kind, g);
  return g;
}

interface Pickup {
  id: number;
  kind: PowerUpKind;
  group: THREE.Group;
  cube: THREE.Mesh;
  ring: THREE.Mesh;
  /** Seconds since it appeared, and seconds into its shrink (-1: alive). */
  t: number;
  dying: number;
  /** Instant removal (it was collected: the burst takes over from the shrink). */
  taken: boolean;
}

export class BlitzFx {
  readonly group = new THREE.Group();
  private pickups = new Map<number, Pickup>();
  private ringGeo = new THREE.RingGeometry(0.42, 0.88, 28).rotateX(-Math.PI / 2);
  private ringMats = new Map<PowerUpKind, THREE.MeshBasicMaterial>();
  /** The held-item icon (one cube mesh, geometry swapped per kind). */
  private icon: THREE.Mesh;
  private iconKind: PowerUpKind | null = null;
  /** Shield bubbles by player index (made on first use, hidden when off). */
  private bubbles = new Map<number, THREE.Mesh>();
  private bubbleGeo = new THREE.IcosahedronGeometry(0.78, 1);
  private bubbleMat = new THREE.MeshBasicMaterial({ color: POWER_COLOR.shield, transparent: true, opacity: 0.3, depthWrite: false });
  private bubbleRim = new THREE.MeshBasicMaterial({ color: POWER_LIGHT.shield, transparent: true, opacity: 0.55, depthWrite: false, wireframe: true });
  private bubbleOn = new Set<number>();
  /** Faint glow rings under a whole side (turbo / frozen): one instanced set per side, coloured per kind. */
  private sideGlow: [THREE.InstancedMesh, THREE.InstancedMesh];
  private sideKind: [PowerUpKind | null, PowerUpKind | null] = [null, null];
  private sideGlowMat: THREE.MeshBasicMaterial;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v3 = new THREE.Vector3();
  private s3 = new THREE.Vector3();
  private c = new THREE.Color();

  constructor() {
    this.icon = new THREE.Mesh(pickupGeometry('turbo'), voxelMaterial);
    this.icon.castShadow = false;
    this.icon.visible = false;
    this.icon.scale.setScalar(ICON_K);
    this.group.add(this.icon);
    this.sideGlowMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    const glowGeo = new THREE.RingGeometry(0.3, 0.95, 24).rotateX(-Math.PI / 2);
    const glow = () => {
      const im = new THREE.InstancedMesh(glowGeo, this.sideGlowMat, 11);
      im.frustumCulled = false;
      im.visible = false;
      im.renderOrder = 2;
      for (let n = 0; n < 11; n++) im.setColorAt(n, this.c.setHex(0xffffff));
      this.group.add(im);
      return im;
    };
    this.sideGlow = [glow(), glow()];
  }

  private ringMat(kind: PowerUpKind): THREE.MeshBasicMaterial {
    let m = this.ringMats.get(kind);
    if (!m) {
      m = new THREE.MeshBasicMaterial({
        color: POWER_COLOR[kind], transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      });
      this.ringMats.set(kind, m);
    }
    return m;
  }

  /** Where pickup `id` is drawn right now (its spot on the pitch), or null once it is gone. */
  at(id: number): { x: number; z: number; kind: PowerUpKind } | null {
    const p = this.pickups.get(id);
    return p ? { x: p.group.position.x, z: p.group.position.z, kind: p.kind } : null;
  }

  /** Pickup `id` was collected: gone at once (the session bursts particles where it stood). */
  take(id: number): void {
    const p = this.pickups.get(id);
    if (p) p.taken = true;
  }

  /**
   * Reconcile with the sim's pickups every frame: new ids pop in, missing ones shrink out; the rest bob and
   * spin. `k`: the draw scale (phones draw everything a little bigger).
   */
  sync(list: readonly PowerUp[], dt: number, time: number, k = 1): void {
    for (const pu of list) {
      let p = this.pickups.get(pu.id);
      if (!p) {
        const group = new THREE.Group();
        const cube = new THREE.Mesh(pickupGeometry(pu.kind), voxelMaterial);
        cube.castShadow = true;
        const ring = new THREE.Mesh(this.ringGeo, this.ringMat(pu.kind));
        ring.position.y = 0.04;
        ring.renderOrder = 3;
        group.add(cube, ring);
        this.group.add(group);
        p = { id: pu.id, kind: pu.kind, group, cube, ring, t: 0, dying: -1, taken: false };
        this.pickups.set(pu.id, p);
      }
      p.group.position.set(pu.x, 0, pu.z);
      p.dying = -1;
    }
    for (const p of this.pickups.values()) {
      if (p.taken) {
        this.drop(p);
        continue;
      }
      const live = list.some((pu) => pu.id === p.id);
      if (!live && p.dying < 0) p.dying = 0;
      p.t += dt;
      let s = 1;
      if (p.dying >= 0) {
        p.dying += dt;
        if (p.dying >= SHRINK_S) {
          this.drop(p);
          continue;
        }
        s = 1 - p.dying / SHRINK_S;
      } else if (p.t < POP_S) {
        // Pop: overshoot to 1.25 then settle.
        const u = p.t / POP_S;
        s = u < 0.6 ? (u / 0.6) * 1.25 : 1.25 - 0.25 * ((u - 0.6) / 0.4);
      }
      const ph = time * 2.2 + p.id * 1.7;
      p.cube.position.y = (FLOAT_Y + Math.sin(ph) * BOB) * k;
      p.cube.rotation.y = time * SPIN + p.id;
      p.cube.rotation.x = Math.sin(ph * 0.5) * 0.12;
      p.cube.scale.setScalar(s * k);
      const pulse = 0.85 + 0.15 * Math.sin(ph * 1.5);
      p.ring.scale.setScalar(s * k * pulse);
      (p.ring.material as THREE.MeshBasicMaterial).opacity = 0.32 + 0.18 * Math.sin(ph * 1.5) * s;
    }
  }

  private drop(p: Pickup): void {
    this.group.remove(p.group);
    this.pickups.delete(p.id);
  }

  /** The held item (or none) floating over the controlled player's head at (x, y, z); `y` is the head top. */
  setHeld(kind: PowerUpKind | null, x: number, y: number, z: number, time: number, k = 1): void {
    if (!kind) {
      this.icon.visible = false;
      this.iconKind = null;
      return;
    }
    if (kind !== this.iconKind) {
      this.iconKind = kind;
      this.icon.geometry = pickupGeometry(kind);
    }
    this.icon.visible = true;
    this.icon.position.set(x, y + (ICON_UP + Math.sin(time * 3) * 0.05) * k, z);
    this.icon.rotation.y = time * 2.2;
    this.icon.scale.setScalar(ICON_K * k);
  }

  /** Start a frame of shield bubbles: every bubble is off unless placed by `bubble` before `endBubbles`. */
  beginBubbles(): void {
    this.bubbleOn.clear();
  }

  /** A shield bubble round player `i` centred at (x, y, z). */
  bubble(i: number, x: number, y: number, z: number, time: number, k = 1): void {
    let b = this.bubbles.get(i);
    if (!b) {
      b = new THREE.Mesh(this.bubbleGeo, this.bubbleMat);
      b.renderOrder = 4;
      const rim = new THREE.Mesh(this.bubbleGeo, this.bubbleRim);
      rim.scale.setScalar(1.02);
      b.add(rim);
      this.group.add(b);
      this.bubbles.set(i, b);
    }
    b.visible = true;
    b.position.set(x, y, z);
    b.scale.setScalar(k * (1 + Math.sin(time * 6 + i) * 0.04));
    b.rotation.y = time * 0.8;
    this.bubbleOn.add(i);
  }

  endBubbles(): void {
    for (const [i, b] of this.bubbles) if (!this.bubbleOn.has(i)) b.visible = false;
  }

  /** Faint glow under every player of `side` in the kind's colour (null: off). */
  setSideGlow(side: 0 | 1, kind: PowerUpKind | null): void {
    this.sideKind[side] = kind;
    this.sideGlow[side].visible = kind !== null;
  }

  get sideGlows(): readonly [PowerUpKind | null, PowerUpKind | null] {
    return this.sideKind;
  }

  /** Place the side glows under their players from the drawn frame (x at o, z at o + 1, jump at o + 2). */
  updateSideGlow(frame: Float32Array, pf: number, k: number, time: number): void {
    this.q.identity();
    for (let side = 0; side < 2; side++) {
      const kind = this.sideKind[side];
      const im = this.sideGlow[side];
      if (!kind) continue;
      let dirty = false;
      for (let n = 0; n < 11; n++) {
        const o = (side * 11 + n) * pf;
        const pulse = 0.9 + 0.1 * Math.sin(time * 5 + n);
        const s = k * pulse * Math.max(0.4, 1 - frame[o + 2] * 0.5);
        this.m4.compose(this.v3.set(frame[o], 0.035, frame[o + 1]), this.q, this.s3.set(s, 1, s));
        im.setMatrixAt(n, this.m4);
        im.getColorAt(n, this.c);
        if (this.c.getHex() !== POWER_COLOR[kind]) {
          im.setColorAt(n, this.c.setHex(POWER_COLOR[kind]));
          dirty = true;
        }
      }
      im.instanceMatrix.needsUpdate = true;
      if (dirty && im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  /** Live pickups (for tests / probes). */
  get count(): number {
    return this.pickups.size;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.ringGeo.dispose();
    this.bubbleGeo.dispose();
    this.bubbleMat.dispose();
    this.bubbleRim.dispose();
    this.sideGlowMat.dispose();
    for (const m of this.ringMats.values()) m.dispose();
  }
}
