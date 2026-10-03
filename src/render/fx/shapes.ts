import * as THREE from 'three';
import { buildBallGeometry } from '../characters';
import { VoxelGrid, meshVoxels } from '../voxel';

/**
 * The voxel props the cosmetic effects throw about (render/fx/kit.ts draws each kind as one instanced mesh):
 * popcorn, coins, hearts, balloons, rockets, a mirror ball, a trophy... Every shape is built once, lazily, at
 * one metre across its longest side (so a particle's `size` is its size in metres), and shared by every kit.
 *
 * Colours: a shape drawn in greys is TINTED by its particle's colour (the vertex colour multiplies the instance
 * colour), so one heart serves every palette; a shape drawn in real colours (popcorn, a cone, the trophy) is
 * spawned white and keeps them.
 */

/** Shape ids (indices into SHAPES). */
export const SH = {
  cube: 0, kernel: 1, heart: 2, star: 3, sparkle: 4, note: 5, coin: 6, balloon: 7, flake: 8, gem: 9,
  ring: 10, disc: 11, splat: 12, rocket: 13, leaf: 14, flower: 15, bubble: 16, blob: 17, cloud: 18, cone: 19,
  gift: 20, candy: 21, trophy: 22, sun: 23, mirror: 24, beam: 25, pinata: 26, lava: 27, rock: 28, shard: 29,
  print: 30, volcano: 31, pumpkin: 32, football: 33, beachball: 34, cannon: 35, bucket: 36, glow: 37,
} as const;
export type ShapeId = (typeof SH)[keyof typeof SH];

/** How a kind is drawn: solid (unlit, opaque), glass (see-through: bubbles) or light (additive: lasers, bolts). */
export type ShapeMat = 'solid' | 'glass' | 'light';

interface ShapeDef {
  build: () => THREE.BufferGeometry;
  /** Most of this kind alive at once in one kit (a full pool skips a spawn, never allocates). */
  cap: number;
  mat: ShapeMat;
}

// ------------------------------------------------------------------ builders

/** A pixel-art sprite extruded `depth` voxels: rows top to bottom, each char looked up in `pal` ('.' = empty). */
function sprite(rows: readonly string[], pal: { readonly [c: string]: number }, depth = 1, base = false): THREE.BufferGeometry {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const g = new VoxelGrid(w, h, depth);
  rows.forEach((r, j) => {
    for (let i = 0; i < r.length; i++) {
      const c = pal[r[i]];
      if (c !== undefined) for (let d = 0; d < depth; d++) g.set(i, h - 1 - j, d, c);
    }
  });
  const m = Math.max(w, h, depth);
  return meshVoxels(g, { scale: 1 / m, pivot: [w / 2, base ? 0 : h / 2, depth / 2], faceTint: true });
}

/** A solid from a function of the cell (null = empty), `n` cells across its longest side. */
function solid(nx: number, ny: number, nz: number, fn: (x: number, y: number, z: number) => number | null, base = false): THREE.BufferGeometry {
  const g = new VoxelGrid(nx, ny, nz);
  for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) {
    const c = fn(x, y, z);
    if (c !== null) g.set(x, y, z, c);
  }
  const m = Math.max(nx, ny, nz);
  return meshVoxels(g, { scale: 1 / m, pivot: [nx / 2, base ? 0 : ny / 2, nz / 2], faceTint: true });
}

/** A ball of radius `r` cells in an n-cube, coloured by `fn` (or null to carve). */
function ball(n: number, r: number, fn: (dx: number, dy: number, dz: number) => number | null): THREE.BufferGeometry {
  const c = (n - 1) / 2;
  return solid(n, n, n, (x, y, z) => {
    const dx = x - c, dy = y - c, dz = z - c;
    return Math.hypot(dx, dy, dz) <= r ? fn(dx, dy, dz) : null;
  });
}

/** The beam: a 1 x 1 cross-section running from its origin 1 m along +z (scaled along z to any length). */
function beam(): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
  const n = geo.getAttribute('position').count;
  const col = new Float32Array(n * 3).fill(1);
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

const W = 0xffffff;
const L = 0xe4e4e4;
const M = 0xc4c4c4;
const D = 0x9a9a9a;
const tint = { X: L, W, x: M, o: D };

// ------------------------------------------------------------------ the shapes

const SHAPES: readonly ShapeDef[] = [
  // cube
  { cap: 1100, mat: 'solid', build: () => solid(1, 1, 1, () => W) },
  // kernel: a popped kernel, cream puffs round a golden husk.
  {
    cap: 180, mat: 'solid', build: () => solid(4, 4, 4, (x, y, z) => {
      const d = Math.hypot(x - 1.5, y - 1.5, z - 1.5);
      if (d > 2.1 || (x + y * 3 + z * 7) % 5 === 0 && d > 1.6) return null;
      return y === 0 && x === 1 && z === 2 ? 0xe8b04a : (x + y + z) % 3 === 0 ? 0xfff4d6 : (x * y + z) % 4 === 0 ? 0xf6e2b0 : 0xfffaf0;
    }),
  },
  // heart
  { cap: 90, mat: 'solid', build: () => sprite(['.XX.XX.', 'XWXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'], tint, 2) },
  // star
  { cap: 260, mat: 'solid', build: () => sprite(['...X...', '..XWX..', 'XXXWXXX', '.XXXXX.', '..XXX..', '.XX.XX.', 'XX...XX'], tint, 2) },
  // sparkle: a four-point twinkle.
  { cap: 160, mat: 'solid', build: () => sprite(['...X...', '...X...', '..XWX..', 'XXWWWXX', '..XWX..', '...X...', '...X...'], tint, 1) },
  // note: a quaver.
  { cap: 50, mat: 'solid', build: () => sprite(['..XX..', '..X.X.', '..X..X', '..X...', '..X...', 'XXX...', 'XXX...', '.X....'], tint, 2) },
  // coin: a thick disc with a rim and a struck mark.
  {
    cap: 160, mat: 'solid', build: () => solid(7, 7, 2, (x, y) => {
      const d = Math.hypot(x - 3, y - 3);
      if (d > 3.3) return null;
      if (d > 2.4) return 0xc7970f;
      return x === 3 && y >= 2 && y <= 4 ? 0xe0b23a : x === 2 && y === 4 ? 0xfff3b0 : 0xffd23a;
    }),
  },
  // balloon: an egg with a highlight, the knot and a bit of string (pivot at the middle of the egg).
  {
    cap: 50, mat: 'solid', build: () => solid(5, 9, 5, (x, y, z) => {
      if (y <= 1) return x === 2 && z === 2 ? (y === 0 ? M : D) : null;
      if (y === 2) return x === 2 && z === 2 ? M : null;
      const e = ((x - 2) / 2.5) ** 2 + ((y - 5.6) / 3.3) ** 2 + ((z - 2) / 2.5) ** 2;
      if (e > 1) return null;
      return x === 1 && y === 7 && z <= 2 ? W : L;
    }),
  },
  // flake
  { cap: 240, mat: 'solid', build: () => sprite(['X..X..X', '.X.X.X.', '..XWX..', 'XXWWWXX', '..XWX..', '.X.X.X.', 'X..X..X'], tint, 1) },
  // gem: a cut diamond, table up.
  {
    cap: 100, mat: 'solid', build: () => solid(7, 6, 7, (x, y, z) => {
      const r = [0.6, 1.4, 2.3, 3.2, 3.2, 2.2][y];
      const d = Math.abs(x - 3) + Math.abs(z - 3) * 0.9;
      if (d > r * 1.15) return null;
      if (y >= 4) return (x + z) % 2 ? W : 0xdff6ff;
      return (x + z + y) % 2 ? 0xb8ecff : 0xd6f5ff;
    }),
  },
  // ring: a hoop in the sprite plane (flat on the ground or facing the lens).
  {
    cap: 56, mat: 'solid', build: () => solid(24, 24, 1, (x, y) => {
      // (A thin band: a shockwave many metres across mustn't become a wall.)
      const d = Math.hypot(x - 11.5, y - 11.5);
      return d >= 10.4 && d <= 11.9 ? W : null;
    }),
  },
  // disc: a scorch mark, a puddle, a dance floor tile.
  { cap: 30, mat: 'solid', build: () => solid(10, 10, 1, (x, y) => (Math.hypot(x - 4.5, y - 4.5) <= 4.9 ? ((x * 7 + y * 3) % 5 ? L : M) : null)) },
  // splat
  { cap: 70, mat: 'solid', build: () => sprite(['...X.....', '.XXXX..X.', 'XXXXXX...', '.XXXWXXX.', 'XXXWXXXX.', '.XXXXXX..', '..XXXXXX.', 'X..XX....', '.....X...'], tint, 1) },
  // rocket: along +z (it flies nose first), stick at the back.
  {
    cap: 16, mat: 'solid', build: () => solid(3, 3, 10, (x, y, z) => {
      const c = x === 1 && y === 1;
      if (z <= 1) return c ? 0x8a5a36 : null;
      if (z === 2) return c ? 0x6a6a72 : null;
      if (z >= 9) return c ? W : null;
      if (z === 8) return x === 1 || y === 1 ? W : null;
      return z === 5 ? W : L;
    }),
  },
  // leaf
  { cap: 240, mat: 'solid', build: () => sprite(['....XX', '..XXXo', '.XXXoX', 'XXXoX.', 'XXoX..', 'o.....'], tint, 1) },
  // flower: petals, a heart and a stem (pivot at the stem's foot).
  { cap: 90, mat: 'solid', build: () => sprite(['.X.X.', 'XXXXX', '.XYX.', 'XXXXX', '.X.X.', '..G..', '.GG..', '..G..'], { X: W, Y: 0xffd23a, G: 0x6fcf4a }, 1, true) },
  // bubble (drawn see-through)
  { cap: 80, mat: 'glass', build: () => ball(6, 2.9, (dx, dy, dz) => (dx < -0.5 && dy > 0.5 && dz > 0 ? W : M)) },
  // blob: a round lump (puffs, snowballs, slime, water).
  { cap: 320, mat: 'solid', build: () => ball(5, 2.4, (dx, dy) => (dy > 0.8 && dx < 0 ? W : L)) },
  // cloud
  {
    cap: 30, mat: 'solid', build: () => solid(12, 6, 6, (x, y, z) => {
      const a = Math.hypot(x - 3, y - 2, z - 2.5) <= 2.4;
      const b = Math.hypot(x - 6, y - 3, z - 2.5) <= 3;
      const c = Math.hypot(x - 9, y - 2, z - 2.5) <= 2.3;
      return a || b || c ? (y <= 1 ? 0xd6dde6 : W) : null;
    }),
  },
  // cone: a training cone (pivot at its base).
  {
    cap: 36, mat: 'solid', build: () => solid(5, 6, 5, (x, y, z) => {
      if (y === 0) return 0xd86a1a;
      const r = [0, 2, 1.6, 1.2, 0.9, 0.5][y];
      if (Math.max(Math.abs(x - 2), Math.abs(z - 2)) > r) return null;
      return y === 3 ? W : 0xff8a2b;
    }, true),
  },
  // gift: a box with a ribbon cross and a bow.
  {
    cap: 50, mat: 'solid', build: () => solid(5, 7, 5, (x, y, z) => {
      if (y >= 5) return y === 5 ? ((x === 1 || x === 3) && z === 2 ? W : null) : (x === 0 || x === 4) && z === 2 ? W : null;
      return x === 2 || z === 2 ? W : 0xb4b4b4;
    }),
  },
  // candy: a wrapped sweet.
  { cap: 100, mat: 'solid', build: () => sprite(['X.XXX.X', 'XXXWXXX', 'X.XXX.X'], tint, 2) },
  // trophy: a gold cup with handles on a plinth (pivot at its base).
  {
    cap: 3, mat: 'solid', build: () => solid(9, 11, 9, (x, y, z) => {
      const dx = x - 4, dz = z - 4;
      const r = Math.hypot(dx, dz);
      if (y <= 1) return Math.max(Math.abs(dx), Math.abs(dz)) <= 3 ? (y === 0 ? 0x5a3a20 : 0x7a5236) : null;
      if (y <= 4) return r <= (y === 2 ? 1.6 : 0.8) ? 0xe0b23a : null;
      if (y <= 10) {
        const cup = r <= [0, 0, 0, 0, 0, 2, 2.6, 3, 3.3, 3.5, 3.6][y];
        const hollow = y === 10 && r < 2.6;
        const handle = Math.abs(dz) < 0.6 && Math.abs(dx) === 4 && y >= 6 && y <= 9 && y !== 6;
        if ((cup && !hollow) || handle) return x <= 3 && y >= 7 && z <= 4 ? 0xfff0b0 : 0xffc23a;
        if (y === 10 && hollow) return null;
      }
      return null;
    }, true),
  },
  // sun: a happy voxel sun (the rays are separate particles).
  {
    cap: 6, mat: 'solid', build: () => solid(11, 11, 2, (x, y, z) => {
      const d = Math.hypot(x - 5, y - 5);
      if (d > 5.3) return null;
      if (z === 1 && ((x === 3 || x === 7) && y === 6)) return 0x26262e;
      if (z === 1 && ((y === 3 && x >= 4 && x <= 6) || (y === 4 && (x === 3 || x === 7)))) return 0x8a3a10;
      if (z === 1 && y === 4 && (x === 2 || x === 8)) return 0xff8a8a;
      return d > 4.3 ? 0xff9a1f : 0xffd23a;
    }),
  },
  // mirror: the disco ball's tiles.
  { cap: 3, mat: 'solid', build: () => ball(8, 3.9, (dx, dy, dz) => [W, 0xc9d1dc, 0x9aa3b2, 0xe8eef6][(Math.round(dx + 9) + Math.round(dy + 9) * 2 + Math.round(dz + 9)) % 4]) },
  // beam (additive light)
  { cap: 110, mat: 'light', build: beam },
  // pinata: a striped paper star.
  {
    cap: 3, mat: 'solid', build: () => {
      const rows = ['....X....', '....X....', '...XXX...', 'XXXXXXXXX', '.XXXXXXX.', '..XXXXX..', '..XXXXX..', '.XXX.XXX.', 'XX.....XX'];
      const stripes = [0xff5c9e, 0xffd23a, 0x3cf7ff, 0x7ae05a, 0xff8a2b, 0xb08cff, 0xff5c9e, 0xffd23a, 0x3cf7ff];
      const pal: { [c: string]: number } = {};
      return sprite(rows.map((r, j) => r.replace(/X/g, String.fromCharCode(65 + j))), (() => {
        stripes.forEach((c, j) => (pal[String.fromCharCode(65 + j)] = c));
        return pal;
      })(), 3);
    },
  },
  // lava: a glowing lump with a dark crust.
  {
    cap: 100, mat: 'solid', build: () => solid(4, 4, 4, (x, y, z) => {
      const d = Math.hypot(x - 1.5, y - 1.5, z - 1.5);
      if (d > 2.1) return null;
      return d < 1.2 ? 0xffe45c : (x + y * 2 + z) % 3 === 0 ? 0x4a2a1e : 0xff7a1a;
    }),
  },
  // rock
  {
    cap: 80, mat: 'solid', build: () => solid(5, 5, 5, (x, y, z) => {
      const d = Math.hypot(x - 2, (y - 2) * 1.15, z - 2);
      if (d > 2.4 || (x + z * 3 + y * 5) % 7 === 0 && d > 1.8) return null;
      return (x + y + z) % 3 === 0 ? 0x5a4a44 : (x * z) % 3 === 0 ? 0x7a6a62 : 0x6a5a52;
    }),
  },
  // shard: a sliver of ice.
  { cap: 200, mat: 'solid', build: () => solid(2, 5, 1, (x, y) => (y === 4 && x === 1 ? null : y >= 3 ? W : x === 0 ? L : M)) },
  // print: a boot print (flat on the grass).
  { cap: 50, mat: 'solid', build: () => sprite(['.XX', 'XXX', 'XXX', 'XX.', '...', 'XX.', 'XX.'], tint, 1) },
  // volcano: a cone with lava in the crater and down one side (pivot at its base).
  {
    cap: 2, mat: 'solid', build: () => solid(11, 7, 11, (x, y, z) => {
      const r = 5.3 - y * 0.62;
      const dx = x - 5, dz = z - 5;
      const d = Math.hypot(dx, dz);
      if (d > r) return null;
      if (y >= 5 && d < 1.3) return 0xffd23a;
      if (y === 6 && d < 2.2) return 0xff7a1a;
      if (dx > 0 && Math.abs(dz) < 0.7 && d > r - 1.2) return 0xff9a1f;
      return (x + y + z) % 3 === 0 ? 0x5a3a20 : 0x7a5236;
    }, true),
  },
  // pumpkin
  {
    cap: 16, mat: 'solid', build: () => solid(7, 6, 7, (x, y, z) => {
      if (y === 5) return x === 3 && z === 3 ? 0x3c8a2a : null;
      const e = ((x - 3) / 3.4) ** 2 + ((y - 2.3) / 2.6) ** 2 + ((z - 3) / 3.4) ** 2;
      if (e > 1) return null;
      return (Math.round(Math.atan2(z - 3, x - 3) * 2.5) & 1) === 0 ? 0xff8a2b : 0xe8661a;
    }),
  },
  // football: the match ball's own look.
  { cap: 60, mat: 'solid', build: () => buildBallGeometry(0.5, 'classic') },
  // beachball
  { cap: 16, mat: 'solid', build: () => buildBallGeometry(0.5, 'beach') },
  // cannon: a confetti cannon, muzzle along +z.
  {
    cap: 4, mat: 'solid', build: () => solid(4, 4, 7, (x, y, z) => {
      const r = Math.hypot(x - 1.5, y - 1.5);
      if (r > 2) return null;
      if (z === 6 && r < 1.1) return 0x26262e;
      return z === 2 || z === 5 ? 0xec4a3e : z === 0 ? 0x9a9a9a : W;
    }),
  },
  // bucket: a striped popcorn bucket heaped with kernels (pivot at its base).
  {
    cap: 2, mat: 'solid', build: () => solid(9, 11, 9, (x, y, z) => {
      const dx = x - 4, dz = z - 4;
      const r = Math.hypot(dx, dz);
      if (y <= 7) {
        if (r > 2.6 + y * 0.22) return null;
        return (Math.round(Math.atan2(dz, dx) * 2.2) & 1) === 0 ? 0xec4a3e : 0xfbfbf4;
      }
      const top = 4.2 - (y - 7) * 1.25;
      if (r > top) return null;
      return (x + y + z) % 3 === 0 ? 0xf6e2b0 : 0xfffaf0;
    }, true),
  },
  // glow: a soft round light (additive: flashes, the star's core). Smooth, not voxel: light has no edges.
  {
    cap: 40, mat: 'light', build: () => {
      const g = new THREE.IcosahedronGeometry(0.5, 2);
      g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 3).fill(1), 3));
      return g;
    },
  },
];

export const SHAPE_COUNT = SHAPES.length;

const geoCache: (THREE.BufferGeometry | null)[] = new Array(SHAPE_COUNT).fill(null);
/** Lowest point of each shape at size 1 (how far above the grass its origin sits when it rests there). */
const floorOf = new Float32Array(SHAPE_COUNT).fill(NaN);

export function shapeGeometry(id: ShapeId): THREE.BufferGeometry {
  let g = geoCache[id];
  if (!g) {
    g = SHAPES[id].build();
    g.computeBoundingBox();
    floorOf[id] = -(g.boundingBox?.min.y ?? -0.5);
    geoCache[id] = g;
  }
  return g;
}

/** Metres from a size-1 shape's origin down to its lowest point. */
export function shapeFloor(id: ShapeId): number {
  if (Number.isNaN(floorOf[id])) shapeGeometry(id);
  return floorOf[id];
}

export function shapeCap(id: ShapeId): number {
  return SHAPES[id].cap;
}

export function shapeMat(id: ShapeId): ShapeMat {
  return SHAPES[id].mat;
}
