import * as THREE from 'three';
import { FX, type Cell, cellHash } from './kitDesigns';
import { VoxelGrid, meshVoxels } from './voxel';

/**
 * PLAYER LOOKS (meta/shop.ts sells them; core/save.ts LOOK_IDS and LOOK_SLOT_OF): built voxel by voxel like the
 * players themselves, kid-safe and chunky enough to read from the broadcast camera.
 *
 * - Hair (the captain's) is painted into his head (render/characters.ts buildHead) in place of his own style.
 * - Headgear and shades are small meshes of their own in head space (headgearGeometry, shadesGeometry): the
 *   headgear sits on the captain and on whoever you control (render/matchView.ts moves it), the shades appear on
 *   your players while they celebrate.
 * - Boots, keeper gloves, the armband and wristbands are cells painted into the legs and arms.
 *
 * Head space (characters.ts buildHead): the skin cube is x 0..8 (the face at x 8), y 0..8, z 0..8 in character
 * voxels (VU); hair may reach x and z -2..10 and y up to 13.
 */

const H = 9;
const F = H - 1;
const M = (H - 1) / 2;

/** A head-grid setter: colour (null clears) and fx. */
export type HeadSet = (x: number, y: number, z: number, c: number | null, fx?: number) => void;

const C = (c: Cell): number => (typeof c === 'number' ? c : c[0]);
const X = (c: Cell): number => (typeof c === 'number' ? 0 : c[1]);

// ------------------------------------------------------------------ hair (the captain)

/**
 * Paint premium hair style `id` on a head (its own hair already left off): true when `id` is a hair look. `hair` is
 * the player's own hair colour (for the styles that keep it).
 */
export function paintHair(id: string, S: HeadSet, hair: number): boolean {
  const B = (x: number, y: number, z: number, sx: number, sy: number, sz: number, c: number, fx = 0) => {
    for (let a = x; a < x + sx; a++) for (let b = y; b < y + sy; b++) for (let d = z; d < z + sz; d++) S(a, b, d, c, fx);
  };
  const cap = (c: number, fx = 0) => B(0, H, 0, H, 1, H, c, fx);
  const fringe = (c: number, fx = 0) => B(F, H - 1, 0, 1, 1, H, c, fx);
  const back = (y0: number, c: number, fx = 0) => B(0, y0, 0, 1, H - y0, H, c, fx);
  const sides = (y0: number, depth: number, c: number, fx = 0) => {
    B(0, y0, 0, depth, H - y0, 1, c, fx);
    B(0, y0, H - 1, depth, H - y0, 1, c, fx);
  };
  switch (id) {
    case 'bun': {
      cap(hair); fringe(hair); back(3, hair); sides(6, 5, hair);
      // The bun: a chunky knot on top, a shade darker underneath.
      B(2, H + 1, M - 1, 3, 2, 3, hair);
      B(2, H + 3, M, 3, 1, 1, hair);
      B(1, H + 1, M - 2, 5, 1, 5, shade(hair, 0.85));
      return true;
    }
    case 'tips': {
      cap(hair); fringe(hair); back(3, hair); sides(6, 4, hair);
      for (let x = 0; x < H; x += 2) {
        for (let z = (x / 2) % 2; z < H; z += 2) {
          S(x, H + 1, z, hair);
          S(x, H + 2, z, 0xbfefff);
        }
      }
      return true;
    }
    case 'mohawk': {
      // Shaved sides (a buzz shadow), then a tall red fin front to back, orange on top.
      B(0, H - 1, 0, H, 1, H, shade(hair, 0.8));
      for (let x = -1; x <= F; x++) {
        const h = x < 1 ? 2 : x > F - 2 ? 2 : 3;
        for (let y = 0; y < h; y++) {
          const c = y === h - 1 ? 0xff8a1a : 0xe8241a;
          S(x, H + y, M - 1, c); S(x, H + y, M, c); S(x, H + y, M + 1, c);
        }
        if (h === 3) S(x, H + 3, M, 0xffd23a);
      }
      return true;
    }
    case 'afro':
    case 'pass09': {
      // A big round afro (or the Club Pass's harvest curls: ginger and a touch smaller), clear of the face.
      const ginger = id === 'pass09';
      const base = ginger ? 0xd8641a : hair;
      const lite = ginger ? 0xf08a3a : shade(hair, 1.35);
      const rx = ginger ? 5.4 : 6.3, ry = ginger ? 4.6 : 5.4;
      for (let x = -2; x <= 10; x++) for (let y = 3; y <= 13; y++) for (let z = -2; z <= 10; z++) {
        const dx = (x - 3.6) / rx, dy = (y - 8.6) / ry, dz = (z - M) / rx;
        if (dx * dx + dy * dy + dz * dz > 1) continue;
        // Keep the face: nothing in front of the forehead line.
        if (x >= 6 && y < H - 0.5 && z >= 0 && z <= F) continue;
        if (x >= 0 && x <= F && y < H && z >= 0 && z <= F && !(x === 0 || z === 0 || z === F || y === H - 1)) continue;
        S(x, y, z, cellHash(x, y, z) < 0.18 ? lite : base);
      }
      return true;
    }
    case 'spikes': {
      // Golden super spikes: a gold cap and six big spikes sweeping up and back. They catch the light.
      const g = [0xffd23a, FX.metal] as const;
      const g2 = [0xe8a82a, FX.metal] as const;
      cap(g2[0], g2[1]); fringe(g[0], g[1]); back(3, g2[0], g2[1]); sides(6, 5, g2[0], g2[1]);
      const spikes: readonly [number, number, number][] = [[3, 1, 3], [3, 7, 3], [6, 2, 3], [6, 6, 3], [4, 4, 4], [1, 4, 3]];
      for (const [sx, sz, n] of spikes) {
        for (let k = 0; k < n; k++) {
          const w = n - k > 1 ? 1 : 0;
          const lean = Math.floor(k * 0.7);
          for (let a = -w; a <= w; a++) for (let b = -w; b <= w; b++) S(sx - lean + a, H + 1 + k, sz + b, C(k === n - 1 ? g : g2), FX.metal);
        }
      }
      return true;
    }
    case 'flamehair': {
      // Hair made of fire: an orange cap and flickering tongues, red at the root to yellow at the tips.
      cap(0xff8a1a, FX.flicker); fringe(0xff8a1a, FX.flicker); back(4, 0xe8241a, FX.flicker); sides(6, 5, 0xe8241a, FX.flicker);
      for (let x = 0; x < H; x++) {
        for (let z = 0; z < H; z++) {
          const h = 1 + Math.floor(cellHash(x, 3, z) * 3.4) + (x < 4 ? 1 : 0);
          for (let k = 0; k < h; k++) {
            const c = k >= h - 1 ? 0xffd23a : k >= h - 2 ? 0xff8a1a : 0xe8241a;
            S(x - (k > 1 ? 1 : 0), H + 1 + k, z, c, FX.flicker);
          }
        }
      }
      return true;
    }
    default:
      return false;
  }
}

/** Every look id painted as hair. */
export const HAIR_LOOKS: readonly string[] = ['bun', 'tips', 'mohawk', 'afro', 'spikes', 'flamehair', 'pass09'];

// ------------------------------------------------------------------ headgear and shades (meshes in head space)

type Vox = { x: number; y: number; z: number; c: number; f: number };

/** A small voxel mesh from cells given in head space (so it sits on the head when added to it). */
function headMesh(cells: Vox[], vu: number): THREE.BufferGeometry {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const v of cells) {
    x0 = Math.min(x0, v.x); y0 = Math.min(y0, v.y); z0 = Math.min(z0, v.z);
    x1 = Math.max(x1, v.x); y1 = Math.max(y1, v.y); z1 = Math.max(z1, v.z);
  }
  const g = new VoxelGrid(x1 - x0 + 1, y1 - y0 + 1, z1 - z0 + 1);
  for (const v of cells) g.set(v.x - x0, v.y - y0, v.z - z0, v.c, v.f);
  return meshVoxels(g, { scale: vu, pivot: [H / 2 - x0, -y0, H / 2 - z0] });
}

/** A ring of cells round the head at row `y`, `out` voxels outside the skin cube. */
function ring(out: Vox[], y: number, r: number, cell: (x: number, z: number, i: number) => Cell | null): void {
  let i = 0;
  for (let x = -r; x <= F + r; x++) {
    for (let z = -r; z <= F + r; z++) {
      if (x !== -r && x !== F + r && z !== -r && z !== F + r) continue;
      const c = cell(x, z, i++);
      if (c !== null) out.push({ x, y, z, c: C(c), f: X(c) });
    }
  }
}

/** Points rising from a crown band (the corners and the middle of each side). */
function points(out: Vox[], y: number, r: number, h: number, c: Cell, tip: Cell): void {
  const spots: readonly [number, number][] = [[-r, -r], [-r, F + r], [F + r, -r], [F + r, F + r], [-r, M], [F + r, M], [M, -r], [M, F + r]];
  for (const [x, z] of spots) {
    for (let k = 1; k <= h; k++) out.push({ x, y: y + k, z, c: C(k === h ? tip : c), f: X(k === h ? tip : c) });
  }
}

const geoCache = new Map<string, THREE.BufferGeometry | null>();

/** The headgear look `id` as a mesh geometry in head space (null: not a headgear look). Cached. */
export function headgearGeometry(id: string, vu: number): THREE.BufferGeometry | null {
  const key = `head|${id}|${vu}`;
  if (geoCache.has(key)) return geoCache.get(key)!;
  const v: Vox[] = [];
  switch (id) {
    case 'headband': {
      ring(v, 6, 1, () => [0xff3c9e, FX.glow]);
      ring(v, 7, 1, (x) => (x === F + 1 ? [0xffffff, 0] : [0xff3c9e, FX.glow]));
      // Two tails at the back.
      for (const z of [M - 1, M + 1]) for (let k = 0; k < 3; k++) v.push({ x: -2 - k, y: 6 - (k >> 1), z, c: 0xff3c9e, f: FX.glow });
      break;
    }
    case 'sweatband':
      ring(v, 6, 1, (x, z) => [0xec4a3e, 0xfbfbf4, 0x2f7be8][(x + z + 30) % 3]);
      break;
    case 'halo': {
      for (let x = -2; x <= 10; x++) for (let z = -2; z <= 10; z++) {
        const d = Math.hypot(x - M, z - M);
        if (d >= 4.2 && d <= 5.6) v.push({ x, y: 13, z, c: 0xffe45c, f: FX.lit });
      }
      break;
    }
    case 'icecrown':
      ring(v, H, 0, (x, z) => [(x + z) % 2 ? 0xd6f3ff : 0x8fd8ff, FX.iri]);
      points(v, H, 0, 3, [0xd6f3ff, FX.iri], [0xffffff, FX.iri]);
      break;
    case 'crown': {
      ring(v, H, 0, () => [0xffc23a, FX.metal]);
      ring(v, H + 1, 0, (x, z) => ((x === M || z === M) && (x === 0 || x === F || z === 0 || z === F) ? [0xec4a3e, FX.lit] : [0xffd23a, FX.metal]));
      points(v, H + 1, 0, 2, [0xffd23a, FX.metal], [0xfff0b0, FX.metal]);
      // A blue gem on the front.
      v.push({ x: F + 1, y: H + 1, z: M, c: 0x2f7be8, f: FX.lit });
      break;
    }
    case 'pass01': {
      // Bobble hat: blue and white stripes, a big white pom pom.
      for (let y = 6; y <= H + 1; y++) {
        const r = y >= H + 1 ? -1 : 1;
        if (r < 0) {
          for (let x = 0; x <= F; x++) for (let z = 0; z <= F; z++) v.push({ x, y, z, c: 0x2f7be8, f: 0 });
        } else ring(v, y, y >= H ? 0 : 1, () => (y <= 7 ? 0xfbfbf4 : y % 2 ? 0x2f7be8 : 0x5cc8f5));
      }
      for (let x = 3; x <= 5; x++) for (let z = 3; z <= 5; z++) for (let y = H + 2; y <= H + 4; y++) v.push({ x, y, z, c: 0xffffff, f: 0 });
      break;
    }
    case 'pass03':
      ring(v, 8, 1, (x, z, i) => (i % 3 === 0 ? 0xff8ad0 : i % 3 === 1 ? 0xffd23a : (x + z) % 2 ? 0xfbfbf4 : 0x5ab84a));
      ring(v, 9, 1, (_x, _z, i) => (i % 4 === 0 ? 0xff8ad0 : null));
      break;
    case 'pass07': {
      ring(v, 6, 1, () => 0xe8241a);
      for (let x = F + 2; x <= F + 4; x++) for (let z = 0; z <= F; z++) v.push({ x, y: 6, z, c: x === F + 4 ? 0xfbfbf4 : 0xe8241a, f: 0 });
      break;
    }
    case 'pass12': {
      // A red festive hat with a white band, the tip flopped to one side with a white bobble.
      ring(v, 7, 1, () => 0xfbfbf4);
      for (let y = 8; y <= 12; y++) {
        const shrink = y - 8;
        const lean = Math.floor(shrink / 2);
        for (let x = shrink; x <= F - shrink; x++) for (let z = shrink + lean; z <= F - shrink + lean; z++) {
          if (x === shrink || x === F - shrink || z === shrink + lean || z === F - shrink + lean || y === 12) v.push({ x, y, z, c: 0xd8241a, f: 0 });
        }
      }
      for (let x = 3; x <= 5; x++) for (let z = 6; z <= 8; z++) v.push({ x, y: 13, z, c: 0xffffff, f: 0 });
      break;
    }
    default:
      geoCache.set(key, null);
      return null;
  }
  const geo = headMesh(v, vu);
  geoCache.set(key, geo);
  return geo;
}

/** The shades look `id` as a mesh geometry in head space (null: not a shades look). Cached. */
export function shadesGeometry(id: string, vu: number): THREE.BufferGeometry | null {
  const key = `shades|${id}|${vu}`;
  if (geoCache.has(key)) return geoCache.get(key)!;
  // Lenses over the eyes (rows 4 and 5, each eye 3 wide round z 2 and 6), the bar along the brow (row 6).
  const looks: { [k: string]: { frame: Cell; lens: (z: number, y: number) => Cell | null } } = {
    shades: { frame: 0x16161c, lens: (z, y) => (y === 5 && (z === 1 || z === 5) ? 0xffffff : 0x26262e) },
    // A five-point star over each eye.
    shadestar: {
      frame: [0xff5cb0, FX.lit],
      lens: (z, y) => {
        const dz = Math.abs(z - (z <= 3 ? 2 : 6));
        return y === 4 || (y === 5 && dz === 0) || (y === 3 && dz === 1) ? [0xff5cb0, FX.lit] : null;
      },
    },
    shadegold: { frame: [0xffc23a, FX.metal], lens: (z, y) => [y === 5 && (z === 1 || z === 5) ? 0xfff0b0 : 0xffd23a, FX.metal] },
    pass04: { frame: 0xfbfbf4, lens: (z) => [0xec4a3e, 0xff8a2a, 0xffd23a, 0xffd23a, 0x3cc15a, 0x2f7be8, 0x8a5cf6][z - 1] ?? 0x2f7be8 },
    pass06: { frame: 0xfbfbf4, lens: (z, y) => [y === 5 && (z === 1 || z === 5) ? 0xffd2a8 : 0xff8a2b, FX.metal] },
  };
  const L = looks[id];
  if (!L) {
    geoCache.set(key, null);
    return null;
  }
  const v: Vox[] = [];
  const x = F + 1;
  for (let z = 0; z <= F; z++) v.push({ x, y: 6, z, c: C(L.frame), f: X(L.frame) });
  v.push({ x, y: 5, z: M, c: C(L.frame), f: X(L.frame) });
  for (const zc of [2, 6]) {
    for (let z = zc - 1; z <= zc + 1; z++) {
      for (const y of id === 'shadestar' ? [3, 4, 5] : [4, 5]) {
        const c = L.lens(z, y);
        if (c !== null) v.push({ x, y, z, c: C(c), f: X(c) });
      }
    }
  }
  // The arms back over the ears.
  for (let ax = 4; ax <= F; ax++) {
    v.push({ x: ax, y: 6, z: -1, c: C(L.frame), f: X(L.frame) });
    v.push({ x: ax, y: 6, z: H, c: C(L.frame), f: X(L.frame) });
  }
  const geo = headMesh(v, vu);
  geoCache.set(key, geo);
  return geo;
}

// ------------------------------------------------------------------ cells painted into the legs and arms

/** A boot cell (leg row 0: x 0..1 the boot, x 2 the toe cap) for boots look `id`, or null (his own boots). */
export function bootCell(id: string | undefined, x: number, z: number): Cell | null {
  switch (id) {
    case 'bootneon': return x === 2 ? [0x3cf7ff, FX.glow] : z === 1 ? [0x3cf7ff, FX.glow] : [0xff3c9e, FX.glow];
    case 'bootgold': return [x === 2 ? 0xfff0b0 : 0xffc23a, FX.metal];
    case 'bootlight': return x === 2 ? [0xff3cf0, FX.lit] : z === 1 ? [0x3cf7ff, FX.lit] : [0xeaf8ff, FX.glow];
    case 'pass02': return x === 2 ? [0xffd23a, FX.metal] : 0x7a5236;
    case 'pass10': return x === 2 ? [0x3cf7ff, FX.glow] : [0x8a55d8, FX.glow];
    default: return null;
  }
}

/** A keeper glove cell (arm rows 0..1, the hands) for gloves look `id`, or null (the kit's own gloves). */
export function gloveCell(id: string | undefined, x: number, y: number, z: number): Cell | null {
  switch (id) {
    case 'glovepro': return y === 1 ? 0x26262e : x === 0 ? 0xffd23a : 0xf6f4ec;
    case 'glovefire': return y === 0 ? [(x + z) % 2 ? 0xffd23a : 0xff8a1a, FX.flicker] : [0xe8241a, FX.flicker];
    case 'glovegold': return [y === 1 ? 0xe8a82a : 0xffd23a, FX.metal];
    case 'pass08': return y === 1 ? 0xfbfbf4 : 0x1fb3a6;
    case 'pass11': return [y === 0 ? 0xffd23a : 0xff9a1f, FX.lit];
    default: return null;
  }
}

/** An armband cell (the captain's left sleeve, one row) for armband look `id`, or null. */
export function armbandCell(id: string | undefined, x: number, z: number): Cell | null {
  switch (id) {
    case 'armband': return x === 1 && z === 0 ? 0x26262e : 0xffd23a;
    case 'armrainbow': return [0xec4a3e, 0xff8a2a, 0xffd23a, 0x3cc15a, 0x2f7be8, 0x8a5cf6][(x * 2 + z) % 6];
    case 'armgold': return [x === 1 ? 0xfff0b0 : 0xffc23a, FX.metal];
    case 'pass05': return x === 1 && z === 0 ? 0xfbfbf4 : [0xffc23a, FX.metal];
    default: return null;
  }
}

/** A wristband cell (the captain's cuffs) for headgear look `id` (only the sweatband set has them), or null. */
export function wristCell(id: string | undefined, x: number, z: number): Cell | null {
  return id === 'sweatband' ? [0xec4a3e, 0xfbfbf4, 0x2f7be8][(x + z) % 3] : null;
}

/** Which slot a look id fills, as far as building goes (hair is painted, headgear and shades are meshes). */
export function isHeadgear(id: string | undefined): boolean {
  return !!id && ['headband', 'sweatband', 'halo', 'icecrown', 'crown', 'pass01', 'pass03', 'pass07', 'pass12'].includes(id);
}

function shade(c: number, k: number): number {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * k));
  const b = Math.min(255, Math.round((c & 255) * k));
  return (r << 16) | (g << 8) | b;
}
