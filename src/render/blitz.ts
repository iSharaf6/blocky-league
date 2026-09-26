import * as THREE from 'three';
import { PICKUP_LIFE } from '../sim/blitz';
import type { PowerUp, PowerUpKind } from '../sim/types';
import { VoxelGrid, meshVoxels, voxelMaterial } from './voxel';

/**
 * Blitz mode visuals (only ever built in a blitz match): the pickups on the pitch (a fat 1.1 m voxel cube
 * per kind with its glyph painted on, bobbing and spinning under a kind-coloured light beam, over a ground
 * ring and a contact shadow; materialising in under the beam, blinking before it fades, shrinking out), the
 * held item floating over the controlled player's head, kind-coloured aura rings under players an effect
 * acts on (or who hold one), the shield bubble round a protected carrier and the faint ground glow under a
 * whole side on turbo / under ice. Particles (trails, sparks, frost, fire) are the session's, through
 * Effects; the ball's red-hot / gilded looks are MatchView's.
 */

export const POWER_COLOR: Record<PowerUpKind, number> = {
  turbo: 0xffd23a, mega: 0xff3b2f, freeze: 0x7fdcff, magnet: 0xb44dff, shield: 0x3aff9e, golden: 0xffb300,
};
/** A lighter accent per kind (sparks, trails, the glyph's highlight). */
export const POWER_LIGHT: Record<PowerUpKind, number> = {
  turbo: 0xfff3a8, mega: 0xffa040, freeze: 0xffffff, magnet: 0xe6b8ff, shield: 0xc8ffe6, golden: 0xfff0b0,
};
/** Ink for the glyph on each cube (dark on the bright cubes, white on the deep ones) and its accent. */
const GLYPH_INK: Record<PowerUpKind, [number, number]> = {
  turbo: [0x26262e, 0xffffff], mega: [0xfbfbf4, 0xffe45c], freeze: [0x1b3a5c, 0xffffff], magnet: [0xfbfbf4, 0xff5a5a], shield: [0x1a4d2e, 0xffffff], golden: [0x5a3a00, 0xffffff],
};
/** 5x5 glyphs: '#' ink, '*' accent, '.' the cube's own colour. */
const GLYPH: Record<PowerUpKind, string[]> = {
  turbo: ['..###', '.###.', '####.', '..##.', '.##..'],
  mega: ['..*..', '.###.', '#####', '#####', '.###.'],
  freeze: ['#.#.#', '.###.', '##.##', '.###.', '#.#.#'],
  magnet: ['**.**', '##.##', '#...#', '#...#', '.###.'],
  shield: ['##*##', '##*##', '*****', '.###.', '..#..'],
  golden: ['..#..', '.###.', '#####', '.###.', '#...#'],
};
export const KINDS: PowerUpKind[] = ['turbo', 'mega', 'freeze', 'magnet', 'shield', 'golden'];

/**
 * Pickup cube edge (m), its voxel grid (7: chunky 0.157 m voxels) and the glyph's inset on each face (the 5x5
 * glyph fills 5/7 of a face, so it reads from the gantry).
 */
export const PICK_SIZE = 1.1;
const N = 7;
const INSET = 1;
/**
 * A pickup materialises over MATERIALISE_S (the sim makes it collectable then: PowerUp.t counts up to it, or
 * up from below zero to it; see Pickup.matAt): the beam lands first, the cube grows in under it. It blinks for
 * the last BLINK_S of PICKUP_LIFE, and shrinks out over SHRINK_S once the sim drops it.
 */
export const MATERIALISE_S = 2;
const BLINK_S = 1.5;
const BLINK_HZ = 6;
const SHRINK_S = 0.22;
/** Cube centre height (m), the bob (m, each way) and the spin (rad/s). */
const FLOAT_Y = 0.9;
const BOB = 0.3;
const SPIN = 2.2;
/** The light beam: height, base radius (tapering to 0.6 at the top) and the bright core's radius. */
const BEAM_H = 4.2;
const BEAM_R = 0.5;
const CORE_R = 0.2;
/** The held-item icon over the controlled player's head: its edge (m) and lift over the head. */
const ICON_SIZE = 0.5;
const ICON_K = ICON_SIZE / PICK_SIZE;
const ICON_UP = 0.8;
/** Aura ring under a player (radii, m, before the draw scale). */
const AURA_IN = 0.5;
const AURA_OUT = 0.8;
const AURA_EDGE_IN = 0.84;
const AURA_EDGE_OUT = 0.94;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Ease out with a little overshoot (a toy block popping up). */
const easeBack = (u: number) => {
  const c = 1.7;
  const t = u - 1;
  return 1 + t * t * ((c + 1) * t + c);
};

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

/** Soft vertical fade for the beams (bright at the base, gone at the top), made once. */
let beamTex: THREE.CanvasTexture | null = null;
function beamGradient(): THREE.CanvasTexture {
  if (beamTex) return beamTex;
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 64;
  const g = c.getContext('2d')!;
  // (Cylinder UVs run v = 0 at the base; flipY off so row 0 is the base.)
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.22)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, 64);
  beamTex = new THREE.CanvasTexture(c);
  beamTex.flipY = false;
  return beamTex;
}

interface Pickup {
  id: number;
  kind: PowerUpKind;
  group: THREE.Group;
  cube: THREE.Mesh;
  ring: THREE.Mesh;
  shadow: THREE.Mesh;
  beam: THREE.Mesh;
  core: THREE.Mesh;
  /** The sim's clock on it (PowerUp.t) and the value of it at which it is collectable (see MATERIALISE_S). */
  t: number;
  matAt: number;
  /** Seconds into its shrink (-1: alive). */
  dying: number;
  /** Instant removal (it was collected: the burst takes over from the shrink). */
  taken: boolean;
}

interface Aura {
  group: THREE.Group;
  fill: THREE.Mesh;
  edge: THREE.Mesh;
  kind: PowerUpKind | null;
}

export class BlitzFx {
  readonly group = new THREE.Group();
  private pickups = new Map<number, Pickup>();
  private ringGeo = new THREE.RingGeometry(0.62, 1.05, 32).rotateX(-Math.PI / 2);
  private shadowGeo = new THREE.CircleGeometry(0.6, 20).rotateX(-Math.PI / 2);
  private shadowMat = new THREE.MeshBasicMaterial({ color: 0x1e3312, transparent: true, opacity: 0.28, depthWrite: false });
  private beamGeo = new THREE.CylinderGeometry(BEAM_R * 0.6, BEAM_R, BEAM_H, 14, 1, true).translate(0, BEAM_H / 2, 0);
  private coreGeo = new THREE.CylinderGeometry(CORE_R * 0.5, CORE_R, BEAM_H * 0.8, 10, 1, true).translate(0, BEAM_H * 0.4, 0);
  /** The held-item icon (one cube mesh, geometry swapped per kind). */
  private icon: THREE.Mesh;
  private iconKind: PowerUpKind | null = null;
  /** Aura rings by player index (made on first use, hidden when off). */
  private auras = new Map<number, Aura>();
  private auraOn = new Set<number>();
  private auraGeo = new THREE.RingGeometry(AURA_IN, AURA_OUT, 32).rotateX(-Math.PI / 2);
  private auraEdgeGeo = new THREE.RingGeometry(AURA_EDGE_IN, AURA_EDGE_OUT, 32).rotateX(-Math.PI / 2);
  private auraMats = new Map<PowerUpKind, [THREE.MeshBasicMaterial, THREE.MeshBasicMaterial]>();
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

  /** A flat additive overlay material (rings, beams): drawn over the lawn with no z-fighting. */
  private overlay(color: number, opacity: number, extra?: Partial<THREE.MeshBasicMaterialParameters>): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, ...extra,
    });
  }

  private auraMat(kind: PowerUpKind): [THREE.MeshBasicMaterial, THREE.MeshBasicMaterial] {
    let m = this.auraMats.get(kind);
    if (!m) {
      m = [this.overlay(POWER_COLOR[kind], 0.85), this.overlay(POWER_LIGHT[kind], 0.7)];
      this.auraMats.set(kind, m);
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

  /** Every live pickup's spot, kind and how far it has materialised (0..1), for the session's particles. */
  each(fn: (x: number, z: number, kind: PowerUpKind, u: number) => void): void {
    for (const p of this.pickups.values()) {
      if (p.taken || p.dying >= 0) continue;
      fn(p.group.position.x, p.group.position.z, p.kind, clamp01(1 - (p.matAt - p.t) / MATERIALISE_S));
    }
  }

  /**
   * Reconcile with the sim's pickups every frame: new ids land as a beam and grow in, missing ones shrink
   * out; the rest bob and spin, and blink before they fade. `k`: the draw scale (phones draw everything a
   * little bigger).
   */
  sync(list: readonly PowerUp[], dt: number, time: number, k = 1): void {
    for (const pu of list) {
      let p = this.pickups.get(pu.id);
      if (!p) {
        const group = new THREE.Group();
        const cube = new THREE.Mesh(pickupGeometry(pu.kind), voxelMaterial);
        cube.castShadow = true;
        const ring = new THREE.Mesh(this.ringGeo, this.overlay(POWER_COLOR[pu.kind], 0.6));
        ring.position.y = 0.04;
        ring.renderOrder = 3;
        const shadow = new THREE.Mesh(this.shadowGeo, this.shadowMat);
        shadow.position.y = 0.03;
        shadow.renderOrder = 1;
        const beam = new THREE.Mesh(this.beamGeo, this.overlay(POWER_COLOR[pu.kind], 0.55, { alphaMap: beamGradient(), side: THREE.DoubleSide }));
        beam.renderOrder = 5;
        beam.frustumCulled = false;
        const core = new THREE.Mesh(this.coreGeo, this.overlay(POWER_LIGHT[pu.kind], 0.7, { alphaMap: beamGradient(), side: THREE.DoubleSide }));
        core.renderOrder = 6;
        core.frustumCulled = false;
        group.add(shadow, ring, beam, core, cube);
        this.group.add(group);
        // (A sim that counts up from below zero is collectable at 0; one that counts up from 0, at MATERIALISE_S.)
        p = { id: pu.id, kind: pu.kind, group, cube, ring, shadow, beam, core, t: pu.t, matAt: pu.t < -1e-6 ? 0 : MATERIALISE_S, dying: -1, taken: false };
        this.pickups.set(pu.id, p);
      }
      p.group.position.set(pu.x, 0, pu.z);
      p.t = pu.t;
      p.dying = -1;
    }
    for (const p of this.pickups.values()) {
      if (p.taken) {
        this.drop(p);
        continue;
      }
      const live = list.some((pu) => pu.id === p.id);
      if (!live && p.dying < 0) p.dying = 0;
      // Materialising: 0 as the beam lands, 1 once it can be taken.
      const u = clamp01(1 - (p.matAt - p.t) / MATERIALISE_S);
      let s = u < 1 ? easeBack(u) * u : 1;
      let beamK = u < 1 ? 1.35 : 1;
      if (p.dying >= 0) {
        p.dying += dt;
        if (p.dying >= SHRINK_S) {
          this.drop(p);
          continue;
        }
        s = 1 - p.dying / SHRINK_S;
        beamK = s;
      }
      // Blink for the last BLINK_S before the sim drops it (the eye reads "going, going").
      const left = PICKUP_LIFE - p.t;
      const blink = p.dying < 0 && left < BLINK_S && left > 0 ? (Math.sin(time * BLINK_HZ * Math.PI * 2) > 0 ? 1 : 0.2) : 1;
      const ph = time * 2.4 + p.id * 1.7;
      const bob = u < 1 ? 0.12 : BOB;
      p.cube.position.y = (FLOAT_Y - (1 - u) * 0.35 + Math.sin(ph) * bob) * k;
      // A clear spin (faster as it materialises: it spins down into place), with a slow tilt.
      p.cube.rotation.y = time * SPIN + p.id + (1 - u) * 6;
      p.cube.rotation.x = Math.sin(ph * 0.5) * 0.14;
      p.cube.rotation.z = Math.cos(ph * 0.37) * 0.08;
      p.cube.scale.setScalar(Math.max(0.001, s * k * blink));
      p.cube.visible = s > 0.02 && blink > 0.5;
      const pulse = 0.9 + 0.1 * Math.sin(ph * 1.5);
      const ringS = Math.max(0.001, k * pulse * (p.dying >= 0 ? s : 0.4 + 0.6 * u));
      p.ring.scale.setScalar(ringS);
      (p.ring.material as THREE.MeshBasicMaterial).opacity = (0.5 + 0.2 * Math.sin(ph * 1.5)) * blink;
      // Contact shadow: shrinks a touch as the cube bobs up.
      const sh = Math.max(0.001, k * s * (0.85 - Math.sin(ph) * 0.1));
      p.shadow.scale.setScalar(sh);
      p.shadow.visible = s > 0.02;
      // The beam: brighter while the cube materialises, breathing after.
      const bm = p.beam.material as THREE.MeshBasicMaterial;
      const cm = p.core.material as THREE.MeshBasicMaterial;
      bm.opacity = (0.42 + 0.12 * Math.sin(time * 3 + p.id)) * beamK * blink;
      cm.opacity = (0.55 + 0.15 * Math.sin(time * 5 + p.id)) * beamK * blink;
      p.beam.scale.set(k * (0.9 + 0.1 * Math.sin(time * 2.6 + p.id)), 1, k * (0.9 + 0.1 * Math.cos(time * 2.6 + p.id)));
      p.core.scale.set(k, 1, k);
      p.beam.rotation.y = time * 0.7;
    }
  }

  private drop(p: Pickup): void {
    this.group.remove(p.group);
    (p.ring.material as THREE.Material).dispose();
    (p.beam.material as THREE.Material).dispose();
    (p.core.material as THREE.Material).dispose();
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
    this.icon.position.set(x, y + (ICON_UP + Math.sin(time * 3.2) * 0.12) * k, z);
    this.icon.rotation.y = time * 2.4;
    this.icon.rotation.x = Math.sin(time * 1.6) * 0.12;
    this.icon.scale.setScalar(ICON_K * k);
  }

  /** Start a frame of aura rings: every ring is off unless placed by `aura` before `endAuras`. */
  beginAuras(): void {
    this.auraOn.clear();
  }

  /**
   * A kind-coloured ring under player `i` at (x, z): a held item's colour under the man who can use it, the
   * magnet's purple under its carrier, the mega's red under the man armed with it. A later call for the same
   * man wins (an effect over a held item).
   */
  aura(i: number, kind: PowerUpKind, x: number, z: number, time: number, k = 1): void {
    let a = this.auras.get(i);
    if (!a) {
      const [fm, em] = this.auraMat(kind);
      const group = new THREE.Group();
      const fill = new THREE.Mesh(this.auraGeo, fm);
      const edge = new THREE.Mesh(this.auraEdgeGeo, em);
      fill.renderOrder = 4;
      edge.renderOrder = 4;
      group.add(fill, edge);
      group.position.y = 0.045;
      this.group.add(group);
      a = { group, fill, edge, kind };
      this.auras.set(i, a);
    }
    if (a.kind !== kind) {
      const [fm, em] = this.auraMat(kind);
      a.fill.material = fm;
      a.edge.material = em;
      a.kind = kind;
    }
    a.group.visible = true;
    a.group.position.x = x;
    a.group.position.z = z;
    const pulse = 1 + 0.07 * Math.sin(time * 6 + i);
    a.group.scale.set(k * pulse, 1, k * pulse);
    a.group.rotation.y = time * 1.5;
    this.auraOn.add(i);
  }

  endAuras(): void {
    for (const [i, a] of this.auras) if (!this.auraOn.has(i)) a.group.visible = false;
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
    for (const p of [...this.pickups.values()]) this.drop(p);
    this.ringGeo.dispose();
    this.shadowGeo.dispose();
    this.shadowMat.dispose();
    this.beamGeo.dispose();
    this.coreGeo.dispose();
    this.auraGeo.dispose();
    this.auraEdgeGeo.dispose();
    for (const [a, b] of this.auraMats.values()) {
      a.dispose();
      b.dispose();
    }
    this.bubbleGeo.dispose();
    this.bubbleMat.dispose();
    this.bubbleRim.dispose();
    this.sideGlowMat.dispose();
  }
}
