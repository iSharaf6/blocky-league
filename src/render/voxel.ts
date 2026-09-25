import * as THREE from 'three';

/**
 * A small voxel grid with a face-culling mesher and per-vertex ambient occlusion —
 * the soft corner darkening that gives toy voxel art its depth.
 */
export class VoxelGrid {
  readonly data: Uint32Array; // 0 = empty, otherwise 0xRRGGBB + 1<<24

  constructor(readonly nx: number, readonly ny: number, readonly nz: number) {
    this.data = new Uint32Array(nx * ny * nz);
  }

  private i(x: number, y: number, z: number): number {
    return x + this.nx * (y + this.ny * z);
  }

  inside(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.nx && y < this.ny && z < this.nz;
  }

  set(x: number, y: number, z: number, color: number | null): void {
    if (!this.inside(x, y, z)) return;
    this.data[this.i(x, y, z)] = color === null ? 0 : (color & 0xffffff) | 0x1000000;
  }

  get(x: number, y: number, z: number): number {
    if (!this.inside(x, y, z)) return 0;
    return this.data[this.i(x, y, z)];
  }

  filled(x: number, y: number, z: number): boolean {
    return this.get(x, y, z) !== 0;
  }

  box(x0: number, y0: number, z0: number, sx: number, sy: number, sz: number, color: number): void {
    for (let x = x0; x < x0 + sx; x++)
      for (let y = y0; y < y0 + sy; y++)
        for (let z = z0; z < z0 + sz; z++) this.set(x, y, z, color);
  }
}

const FACES = [
  // normal, then the 4 corners (as offsets 0/1 in each axis), counter-clockwise from outside
  { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], u: [0, 1, 0], v: [0, 0, 1] },
  { n: [-1, 0, 0], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], u: [0, 1, 0], v: [0, 0, 1] },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], c: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], u: [1, 0, 0], v: [0, 1, 0] },
] as const;

const AO_CURVE = [0.64, 0.78, 0.9, 1.0];
const tmpColor = new THREE.Color();

export interface MeshOptions {
  /** Size of one voxel in metres. */
  scale: number;
  /** Grid-space point that becomes the mesh origin (a joint pivot). */
  pivot: [number, number, number];
  /** Slight per-face brightness so flat colours read as solid blocks. */
  faceTint?: boolean;
}

/** Face-culled mesh with baked AO + vertex colours. */
export function meshVoxels(g: VoxelGrid, opt: MeshOptions): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const s = opt.scale;
  const [px, py, pz] = opt.pivot;
  const tint = opt.faceTint ?? true;

  for (let z = 0; z < g.nz; z++) {
    for (let y = 0; y < g.ny; y++) {
      for (let x = 0; x < g.nx; x++) {
        const v = g.get(x, y, z);
        if (!v) continue;
        tmpColor.setHex(v & 0xffffff);
        const r0 = tmpColor.r, g0 = tmpColor.g, b0 = tmpColor.b;
        for (let f = 0; f < 6; f++) {
          const F = FACES[f];
          const nx = x + F.n[0], ny = y + F.n[1], nz = z + F.n[2];
          if (g.filled(nx, ny, nz)) continue;
          const base = pos.length / 3;
          const ao: number[] = [];
          for (let c = 0; c < 4; c++) {
            const cr = F.c[c];
            pos.push((x + cr[0] - px) * s, (y + cr[1] - py) * s, (z + cr[2] - pz) * s);
            nor.push(F.n[0], F.n[1], F.n[2]);
            // Neighbours in the layer in front of the face, around this corner.
            const du = [0, 0, 0];
            const dv = [0, 0, 0];
            for (let k = 0; k < 3; k++) {
              du[k] = F.u[k] * (cr[k] === 1 ? 1 : -1);
              dv[k] = F.v[k] * (cr[k] === 1 ? 1 : -1);
            }
            const s1 = g.filled(nx + du[0], ny + du[1], nz + du[2]) ? 1 : 0;
            const s2 = g.filled(nx + dv[0], ny + dv[1], nz + dv[2]) ? 1 : 0;
            const cc = g.filled(nx + du[0] + dv[0], ny + du[1] + dv[1], nz + du[2] + dv[2]) ? 1 : 0;
            const a = s1 && s2 ? 0 : 3 - (s1 + s2 + cc);
            ao.push(a);
            let k = AO_CURVE[a];
            if (tint) k *= f === 2 ? 1.0 : f === 3 ? 0.7 : 0.9;
            col.push(r0 * k, g0 * k, b0 * k);
          }
          // Flip the quad diagonal to follow the AO gradient.
          if (ao[0] + ao[2] > ao[1] + ao[3]) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
          else idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
        }
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Accumulates coloured boxes into one geometry — for big static scenery
 * (stands, trees, boards) where a voxel grid would be wasteful.
 */
export class BoxBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];

  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: number, opts?: { top?: number; skipBottom?: boolean; rotY?: number }): this {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    tmpColor.setHex(color);
    const r = tmpColor.r, g = tmpColor.g, b = tmpColor.b;
    let tr = r, tg = g, tb = b;
    if (opts?.top !== undefined) {
      tmpColor.setHex(opts.top);
      tr = tmpColor.r; tg = tmpColor.g; tb = tmpColor.b;
    }
    const cos = Math.cos(opts?.rotY ?? 0);
    const sin = Math.sin(opts?.rotY ?? 0);
    for (let f = 0; f < 6; f++) {
      if (f === 3 && opts?.skipBottom) continue;
      const F = FACES[f];
      const base = this.pos.length / 3;
      const k = f === 2 ? 1 : f === 3 ? 0.78 : f <= 1 ? 0.94 : 0.9;
      for (let c = 0; c < 4; c++) {
        const cr = F.c[c];
        const lx = (cr[0] ? hx : -hx);
        const lz = (cr[2] ? hz : -hz);
        this.pos.push(cx + lx * cos + lz * sin, cy + (cr[1] ? hy : -hy), cz - lx * sin + lz * cos);
        const nx = F.n[0] * cos + F.n[2] * sin;
        const nz = -F.n[0] * sin + F.n[2] * cos;
        this.nor.push(nx, F.n[1], nz);
        if (f === 2) this.col.push(tr * k, tg * k, tb * k);
        else this.col.push(r * k, g * k, b * k);
      }
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return this;
  }

  get empty(): boolean {
    return this.pos.length === 0;
  }

  build(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.setIndex(this.idx);
    geo.computeBoundingSphere();
    return geo;
  }
}

export const voxelMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
