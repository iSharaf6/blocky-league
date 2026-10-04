import * as THREE from 'three';
import type { DecorStyle } from '../meta/style';
import { CENTER_R, HALF_L, HALF_W } from '../sim/constants';
import { charMaterialFor, tickKitFx } from './characters';
import type { FxKit } from './fx/kit';
import { DRAGON_BREATH, KICKOFF_SHOWS } from './fx/stadiumFx';
import { FX, type Cell } from './kitDesigns';
import { GRASS_A, GRASS_B, cssHex, shade } from './palette';
import { BoxBuilder, VoxelGrid, meshVoxels, voxelMaterial } from './voxel';

/**
 * STADIUM STYLE (meta/shop.ts sells it, core/save.ts DECOR_IDS): decorative layers over your home ground, built on
 * top of whatever the career has built (render/stadium.ts owns the structure; this never touches it, only adds to its
 * groups or restyles its nets and corner flags through Stadium.decorAnchors()). Visible in every home match:
 *
 * - pitch: mowing patterns laid over the lawn (checks, diagonals, rings) or your crest painted in the centre circle;
 * - nets: club stripes, honeycomb, rainbow or neon;
 * - flags: taller corner flags (club, chequered, flickering flames);
 * - seats: your club's short name spelt out in the far stand (seat colours and the fans' shirts), or giant letters on
 *   the bank of a ground with no stand;
 * - tifo: home fans waving flags, or a giant crest banner over the far stand that unrolls at kick off;
 * - kickoff: confetti cannons, fireworks or a pyro show as the match kicks off (render/fx/stadiumFx.ts);
 * - lights: coloured beams sweeping from the floodlights (LED pylons on a ground without), wild after your goals;
 * - mascot: a voxel bear, robot or dragon on the far touchline that dances when you score.
 *
 * Performance: a handful of merged meshes and two instanced ones, shared materials, two small canvas textures at
 * most, nothing allocated per frame.
 */

/** What the stadium lends the decor (render/stadium.ts decorAnchors; the shop's diorama makes its own). */
export interface DecorAnchors {
  /** The stadium's root group and its pitch group (lifted by PITCH_Y). */
  group: THREE.Group;
  pitch: THREE.Group;
  level: number;
  /** The far (main) stand's rows, if built: tier 1 and 2 row counts and its half length; and the home (left) end's. */
  far: { t1: number; t2: number; span: number } | null;
  left?: { t1: number; t2: number; span: number } | null;
  standZ: number;
  /** The end stands' front, from the halfway line (m). */
  standX?: number;
  stepD: number;
  stepH: number;
  boardZ: number;
  /** The lawn's own material (night and snow apply to the mowing too). */
  lawn: THREE.Material;
  /** The default corner flag poles (hidden under the flags decor) and the two goal nets (restyled). */
  cornerFlags: THREE.Object3D[];
  nets: THREE.Mesh[];
  /** Floodlight heads (empty: the ground has none by day). */
  lamps: readonly { x: number; z: number; h: number }[];
  /** The crowd (the seats mosaic and flag wave read and recolour its fans), if any. */
  crowd: THREE.InstancedMesh | null;
  /** Far-stand fan banners hung (x of each): the giant tifo keeps clear of them. */
  bannerX: readonly number[];
}

const WHITE = 0xfbfbf4;
const GOLD = 0xffc23a;
const RAINBOW = [0xec4a3e, 0xff8a2a, 0xffd23a, 0x3cc15a, 0x2f7be8, 0x8a5cf6] as const;

/** 3 x 5 pixel letters for the seats mosaic (A to Z, 0 to 9; anything else a gap). */
const FONT: { readonly [c: string]: readonly string[] } = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'], B: ['##.', '#.#', '##.', '#.#', '##.'], C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'], E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'], H: ['#.#', '#.#', '###', '#.#', '#.#'], I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'], K: ['#.#', '#.#', '##.', '#.#', '#.#'], L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'], N: ['##.', '#.#', '#.#', '#.#', '#.#'], O: ['###', '#.#', '#.#', '#.#', '###'],
  P: ['##.', '#.#', '##.', '#..', '#..'], Q: ['###', '#.#', '#.#', '###', '..#'], R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'], T: ['###', '.#.', '.#.', '.#.', '.#.'], U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'], W: ['#.#', '#.#', '###', '###', '#.#'], X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'], Z: ['###', '..#', '.#.', '#..', '###'],
  0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#.', '##.', '.#.', '.#.', '###'], 2: ['##.', '..#', '.#.', '#..', '###'],
  3: ['##.', '..#', '.#.', '..#', '##.'], 4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '##.', '..#', '##.'],
  6: ['.##', '#..', '###', '#.#', '###'], 7: ['###', '..#', '.#.', '.#.', '.#.'], 8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '##.'],
};

/** The name as a pixel bitmap: rows (5) of booleans, 3 columns a letter and a gap between. */
export function nameBitmap(name: string): boolean[][] {
  const rows: boolean[][] = [[], [], [], [], []];
  [...name.toUpperCase()].forEach((ch, i) => {
    const g = FONT[ch];
    if (i > 0) for (const r of rows) r.push(false);
    for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) rows[y].push(g ? g[y][x] === '#' : false);
  });
  return rows;
}

/** The crest pixel art (the centre circle and the giant tifo): S shirt, T second colour, W white star, G gold rim. */
export const CREST = [
  '..GGGGGGG..',
  '.GSSSSSSSG.',
  'GSSSSWSSSSG',
  'GSSSWWWSSSG',
  'GSSSSWSSSSG',
  'GTTTTTTTTTG',
  'GSSSSSSSSSG',
  'GTTTTTTTTTG',
  '.GSSSSSSSG.',
  '.GSSSSSSSG.',
  '..GSSSSSG..',
  '...GSSSG...',
  '....GGG....',
];

/** Flat top-facing quads in vertex colours, run-length merged along x: a mowing pattern or a painted decal. */
export function sheet(x0: number, x1: number, z0: number, z1: number, cell: number, y: number, at: (x: number, z: number) => number | null): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const nor: number[] = [];
  const c = new THREE.Color();
  const quad = (ax: number, bx: number, az: number, bz: number, hex: number) => {
    c.setHex(hex);
    for (const [x, z] of [[ax, az], [ax, bz], [bx, bz], [ax, az], [bx, bz], [bx, az]] as const) {
      pos.push(x, y, z);
      col.push(c.r, c.g, c.b);
      nor.push(0, 1, 0);
    }
  };
  for (let z = z0; z < z1 - 1e-6; z += cell) {
    const zb = Math.min(z1, z + cell);
    let run = -1;
    let runC: number | null = null;
    for (let x = x0; x <= x1 + 1e-6; x += cell) {
      const cc = x < x1 - 1e-6 ? at(x + cell / 2, (z + zb) / 2) : null;
      if (cc !== runC) {
        if (runC !== null) quad(run, x, z, zb, runC);
        run = x;
        runC = cc;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/**
 * A mowing pattern's grass colour at (x, z) on a pitch `k` times the real size (the shop's diorama: k < 1): checks,
 * diagonal stripes (crossing into diamonds) or rings out from the centre spot.
 */
export function mowColor(id: string, x: number, z: number, k = 1): number {
  const tx = ((2 * HALF_L) / 14) * k, tz = ((2 * HALF_W) / 9) * k;
  let n = 0;
  if (id === 'mowchecks') n = Math.floor(x / tx + 7) + Math.floor(z / tz + 4.5);
  else if (id === 'mowdiag') n = Math.floor((x + z) / (6.5 * k)) + Math.floor((x - z) / (6.5 * k));
  else n = Math.floor(Math.hypot(x, z) / (4.6 * k));
  return ((n % 2) + 2) % 2 ? GRASS_A : GRASS_B;
}

/** A net's strand colour at (x, y, z) (local to the goal: z across the mouth, y up) for nets style `id`. */
export function netColor(id: string, shirt: number, shirt2: number, _x: number, y: number, z: number, w = 7.32): number {
  if (id === 'netclub') return Math.floor((z + w) / (w / 8)) % 2 ? shirt : shirt2;
  if (id === 'netrainbow') return RAINBOW[Math.max(0, Math.min(5, Math.floor(((z + w / 2) / w) * 6)))];
  if (id === 'netglow') return y > w * 0.18 ? 0xff3cf0 : 0x3cf7ff;
  return WHITE;
}

/** A corner flag (12 x 8 cells of 0.1 m, hoisted at x 0) for flags style `id`: club colours, chequered or a flame. */
export function cornerFlagGeometry(id: string, shirt: number, shirt2: number): THREE.BufferGeometry {
  const g = new VoxelGrid(12, 8, 1);
  for (let x = 0; x < 12; x++) for (let y = 0; y < 8; y++) {
    if (id === 'flagfire') {
      // A flame silhouette: tongues licking out from the pole.
      const reach = 12 - Math.abs(y - 3.5) * 1.6 - ((y * 7 + 3) % 3);
      if (x > reach) continue;
      const c = x > reach - 2 ? 0xffd23a : x > reach - 5 ? 0xff8a1a : 0xe8241a;
      g.set(x, y, 0, c, FX.flicker);
    } else if (id === 'flagcheck') g.set(x, y, 0, ((x >> 1) + (y >> 1)) % 2 ? 0x16161c : WHITE);
    else g.set(x, y, 0, y >= 3 && y <= 4 ? shirt2 : shirt);
  }
  return meshVoxels(g, { scale: 0.1, pivot: [0, 0, 0.5] });
}

/** The giant tifo's cloth: diagonal club stripes, the crest in the middle, the short name either side. */
export function tifoTexture(shirt: number, shirt2: number, short: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 160;
  const g = c.getContext('2d')!;
  for (let i = -4; i < 20; i++) {
    g.fillStyle = cssHex(i % 2 ? shirt : shirt2);
    g.beginPath();
    g.moveTo(i * 40, 0);
    g.lineTo(i * 40 + 40, 0);
    g.lineTo(i * 40 - 40, 160);
    g.lineTo(i * 40 - 80, 160);
    g.fill();
  }
  g.fillStyle = cssHex(shirt);
  g.fillRect(0, 44, 512, 72);
  const cell = 11;
  const cw = CREST[0].length * cell;
  const pal: { [k: string]: string } = { S: cssHex(shirt), T: cssHex(shirt2), W: '#fbfbf4', G: '#ffc23a' };
  CREST.forEach((row, ry) => [...row].forEach((ch, rx) => {
    if (ch === '.') return;
    g.fillStyle = pal[ch];
    g.fillRect(256 - cw / 2 + rx * cell, 8 + ry * cell, cell, cell);
  }));
  g.fillStyle = cssHex(shirt2);
  g.font = '700 54px "Silkscreen", "Lilita One", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(short, 110, 82);
  g.fillText(short, 402, 82);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** A canvas net strand tile (alpha): squares (thicker strands than the stock net, so colours read) or honeycomb. */
export function netAlpha(hex: boolean): THREE.CanvasTexture {
  // A honeycomb tile is 3r across and sqrt(3) r tall (flat-topped hexagons repeat on that period).
  const w = 64;
  const r = w / 3;
  const h = hex ? Math.round(Math.sqrt(3) * r) : 64;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#fff';
  g.fillStyle = '#fff';
  g.lineWidth = 3;
  if (hex) {
    for (let col = -1; col <= 3; col++) {
      for (let row = -1; row <= 2; row++) {
        const cx = col * 1.5 * r;
        const cy = row * Math.sqrt(3) * r + (col % 2 ? (Math.sqrt(3) / 2) * r : 0);
        g.beginPath();
        for (let k = 0; k <= 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          const px = cx + Math.cos(a) * r;
          const py = cy + Math.sin(a) * r;
          if (k) g.lineTo(px, py);
          else g.moveTo(px, py);
        }
        g.stroke();
      }
    }
  } else {
    for (let i = 0; i < w; i += w / 4) {
      g.fillRect(i, 0, 3, h);
      g.fillRect(0, i, w, 3);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** A voxel part (a mascot's body, head, an arm) from a cell painter, `pivot` in cells. */
function part(nx: number, ny: number, nz: number, vu: number, pivot: [number, number, number], fn: (x: number, y: number, z: number) => Cell | null): THREE.Mesh {
  const g = new VoxelGrid(nx, ny, nz);
  for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) {
    const c = fn(x, y, z);
    if (c === null) continue;
    if (typeof c === 'number') g.set(x, y, z, c);
    else g.set(x, y, z, c[0], c[1]);
  }
  const geo = meshVoxels(g, { scale: vu, pivot });
  const m = new THREE.Mesh(geo, charMaterialFor(geo));
  m.castShadow = true;
  return m;
}

export type MascotKind = 'bear' | 'robot' | 'dragon';

/** The mascot a STADIUM STYLE id brings. */
export function mascotKind(id: string): MascotKind {
  return id === 'mascotrobot' ? 'robot' : id === 'mascotdragon' ? 'dragon' : 'bear';
}

/** A touchline mascot: body, head and two arms (and a dragon's wings), posed every frame. */
export class Mascot {
  readonly group = new THREE.Group();
  readonly body: THREE.Mesh;
  readonly head: THREE.Mesh;
  readonly armL: THREE.Mesh;
  readonly armR: THREE.Mesh;
  readonly wings: THREE.Mesh[] = [];
  private danceT = -1;
  private readonly baseYaw: number;

  constructor(readonly kind: MascotKind, shirt: number, shirt2: number, x: number, z: number, yaw: number) {
    const V = 0.13;
    this.baseYaw = yaw;
    // Model space as the players: forward +x, up +y, right +z.
    const fur = kind === 'bear' ? 0x8a5a36 : kind === 'robot' ? 0xc9d1dc : 0xd8341a;
    const pale = kind === 'bear' ? 0xe6c89a : kind === 'robot' ? 0x8a93a3 : 0xffd23a;
    const metal = kind === 'robot';
    const furC: Cell = metal ? [fur, FX.metal] : fur;
    // Body: legs (y 0..3), a club shirt on top (the bear and the dragon) or a club-coloured chest panel (the robot).
    this.body = part(7, 12, 10, V, [3.5, 0, 5], (bx, y, bz) => {
      if (y < 4) return bz >= 1 && bz <= 3 || bz >= 6 && bz <= 8 ? (y === 0 ? (metal ? 0x5a6270 : shade(fur, 0.7)) : furC) : null;
      if (kind === 'robot') {
        if (bx === 6 && y >= 6 && y <= 9 && bz >= 3 && bz <= 6) return y === 8 ? [shirt2, FX.lit] : shirt;
        return y === 11 && bz >= 3 && bz <= 6 ? 0x5a6270 : furC;
      }
      const hoop = y === 8;
      if (kind === 'dragon' && bx === 6 && bz >= 3 && bz <= 6) return y % 2 ? pale : shade(pale, 0.86);
      return hoop ? shirt2 : shirt;
    });
    // A dragon's tail curls out of its back.
    if (kind === 'dragon') {
      const tail = part(6, 4, 2, V, [6, 0, 1], (tx, ty) => (ty <= Math.max(0, 3 - (tx >> 1)) ? (tx === 0 && ty === 3 ? 0xffd23a : fur) : null));
      tail.position.set(-3.2 * V, 3 * V, 0);
      this.body.add(tail);
    }
    this.group.add(this.body);
    // Head.
    this.head = part(10, 10, 10, V, [5, 0, 5], (hx, hy, hz) => {
      if (kind === 'bear') {
        if (hy === 9 && (hz <= 1 || hz >= 8) && hx >= 3 && hx <= 5) return hx === 4 ? pale : fur;
        if (hy === 9) return null;
        if (hx === 9 && hy >= 1 && hy <= 3 && hz >= 3 && hz <= 6) return hy === 3 && (hz === 4 || hz === 5) ? 0x16161c : pale;
        if (hx === 9 && hy === 5 && (hz === 2 || hz === 7)) return 0x16161c;
        if (hx === 9 && hy === 6 && (hz === 2 || hz === 7)) return 0xffffff;
        return hy < 9 ? fur : null;
      }
      if (kind === 'robot') {
        if (hy === 9) return hx >= 4 && hx <= 5 && hz >= 4 && hz <= 5 ? 0x5a6270 : null;
        if (hx === 9 && hy >= 4 && hy <= 6 && hz >= 1 && hz <= 8) return hy === 5 ? [0x3cf7ff, FX.lit] : 0x26262e;
        if (hx === 9 && hy === 2 && hz >= 3 && hz <= 6) return hz % 2 ? 0x26262e : 0x8a93a3;
        return [fur, FX.metal];
      }
      // Dragon: a snout, two horns, yellow eyes.
      if (hy === 9) return (hz === 2 || hz === 7) && hx <= 3 ? 0xfff0b0 : null;
      if (hy >= 8 && hx >= 7) return null;
      if (hx === 9 && hy <= 2 && hz >= 2 && hz <= 7) return hy === 2 && (hz === 3 || hz === 6) ? 0x16161c : fur;
      if (hx === 9 && hy > 2) return null;
      if (hx === 8 && hy === 5 && (hz === 2 || hz === 7)) return [0xffd23a, FX.lit];
      return fur;
    });
    this.head.position.y = 12 * V;
    this.body.add(this.head);
    if (kind === 'robot') {
      // The antenna and its blinking light.
      const ant = part(1, 4, 1, V, [0.5, 0, 0.5], (_x, y) => (y === 3 ? [0xec4a3e, FX.lit] : 0x8a93a3));
      ant.position.y = 10 * V;
      this.head.add(ant);
    }
    const arm = (): THREE.Mesh => part(3, 7, 3, V, [1.5, 7, 1.5], (_x, y) => (y <= 1 ? (metal ? 0x5a6270 : pale) : y >= 5 && kind !== 'robot' ? shirt : furC));
    this.armL = arm();
    this.armR = arm();
    this.armL.position.set(0, 11 * V, -6.5 * V);
    this.armR.position.set(0, 11 * V, 6.5 * V);
    this.body.add(this.armL, this.armR);
    if (kind === 'dragon') {
      for (const s of [-1, 1]) {
        const w = part(2, 7, 8, V, [1, 0, s < 0 ? 8 : 0], (_x, y, z) => {
          const zz = s < 0 ? 7 - z : z;
          return y <= 6 - (zz >> 1) ? (y === 6 - (zz >> 1) ? fur : 0x8a55d8) : null;
        });
        w.position.set(-3 * V, 8 * V, s * 3 * V);
        this.body.add(w);
        this.wings.push(w);
      }
    }
    this.group.position.set(x, 0, z);
    this.group.rotation.y = yaw;
  }

  /** Start the goal dance. */
  dance(): void {
    this.danceT = 0;
  }

  /** Free its geometry (each mascot builds its own). */
  dispose(): void {
    this.group.removeFromParent();
    this.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }

  get dancing(): boolean {
    return this.danceT >= 0;
  }

  update(dt: number, time: number): void {
    const b = this.body;
    const aL = this.armL, aR = this.armR, h = this.head;
    this.group.rotation.y = this.baseYaw;
    b.position.y = 0;
    b.rotation.set(0, 0, 0);
    h.rotation.set(0, 0, 0);
    for (const w of this.wings) w.rotation.set(0, 0, 0);
    if (this.danceT >= 0) {
      const t = (this.danceT += dt);
      if (t > 7) this.danceT = -1;
      if (this.kind === 'robot') {
        // The robot: a new right-angle pose every 0.35 s.
        const beat = Math.floor(t / 0.35) % 4;
        aL.rotation.set([-1.55, -2.6, 0, -1.55][beat], 0, [0, 0, 1.5, 0][beat]);
        aR.rotation.set([1.55, 0, 2.6, 0][beat], 0, [0, 1.5, 0, 0][beat]);
        b.rotation.y = [0, 0.5, -0.5, 0][beat];
        h.rotation.z = [0.3, -0.3, 0, 0.3][beat];
      } else {
        // Jump about, arms pumping, a full spin every couple of seconds.
        b.position.y = Math.abs(Math.sin(t * 6)) * 0.45;
        aL.rotation.x = -2.5 - Math.sin(t * 12) * 0.4;
        aR.rotation.x = 2.5 + Math.sin(t * 12 + 1.5) * 0.4;
        const spin = (t % 2.2) / 2.2;
        if (spin > 0.7) this.group.rotation.y = this.baseYaw + ((spin - 0.7) / 0.3) * Math.PI * 2;
        for (const w of this.wings) w.rotation.x = Math.sin(t * 16) * 0.7 * Math.sign(w.position.z);
      }
      return;
    }
    // Idle: a bob, a lazy wave, looking about.
    b.position.y = Math.abs(Math.sin(time * 2.4)) * 0.06;
    aR.rotation.x = 0.4 + Math.sin(time * 2) * 0.5;
    aL.rotation.x = -0.15;
    h.rotation.y = Math.sin(time * 0.7) * 0.4;
    for (const w of this.wings) w.rotation.x = Math.sin(time * 3) * 0.25 * Math.sign(w.position.z);
  }
}

/** One light beam (an additive cone from a lamp head) and where it sweeps. */
interface Beam {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  hx: number;
  hy: number;
  hz: number;
  phase: number;
}

export class StadiumDecor {
  /** Everything added to the stadium's own groups, so it goes with them (and their dispose). */
  private readonly own: THREE.Object3D[] = [];
  private readonly mats: THREE.Material[] = [];
  private readonly texs: THREE.Texture[] = [];
  private night = false;
  /** Seconds left of the post-goal / kick-off party (the lights sweep fast, the tifo waves hard). */
  private partyT = 0;
  private kickDue = -1;
  private mascot: Mascot | null = null;
  private beams: Beam[] = [];
  private halos: THREE.Sprite[] = [];
  private flags: THREE.Mesh[] = [];
  private fireFlags = false;
  private tifo: { mesh: THREE.Mesh; base: Float32Array; unroll: number } | null = null;
  private wave: { mesh: THREE.InstancedMesh; spots: Float32Array; n: number } | null = null;
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);
  private readonly c = new THREE.Color();
  private readonly target = new THREE.Vector3();
  private readonly kitFx: boolean;

  /**
   * Dress the ground. `fx` (the match's effects kit) plays the kick-off and the mascot's shows; `kickDelay` (s) is when
   * the walkout goes off by itself (negative: only when kickoff() is called, after the intro).
   */
  constructor(readonly a: DecorAnchors, readonly style: DecorStyle, private readonly fx: FxKit | null) {
    const sl = style.slots;
    if (sl.pitch) this.buildPitch(sl.pitch);
    if (sl.net) this.buildNets(sl.net);
    if (sl.flags) this.buildFlags(sl.flags);
    if (sl.seats) this.buildSeats();
    if (sl.tifo === 'tifobig') this.buildTifo();
    else if (sl.tifo === 'tifoflags') this.buildFlagWave();
    if (sl.lights) this.buildLights();
    if (sl.mascot) {
      const kind = mascotKind(sl.mascot);
      // On the far touchline in the home half, facing the broadcast camera.
      this.mascot = new Mascot(kind, style.shirt, style.shirt2, -11, -(HALF_W + 1.9), -Math.PI / 2);
      this.add(this.a.pitch, this.mascot.group);
    }
    this.kitFx = !!(sl.flags === 'flagfire' || sl.mascot);
  }

  private add(parent: THREE.Object3D, o: THREE.Object3D): void {
    parent.add(o);
    this.own.push(o);
  }

  // ------------------------------------------------------------------ pitch

  private buildPitch(id: string): void {
    if (id === 'mowcrest') {
      // Your crest painted in the centre circle (its top towards the far side, so it stands upright on screen).
      const cell = 0.62;
      const w = CREST[0].length * cell, h = CREST.length * cell;
      const pal: { [c: string]: number } = { S: this.style.shirt, T: this.style.shirt2, W: WHITE, G: GOLD };
      const geo = sheet(-w / 2, w / 2, -h / 2, h / 2, cell, 0.011, (x, z) => {
        const col = Math.floor((x + w / 2) / cell);
        const row = Math.floor((z + h / 2) / cell);
        const ch = CREST[row]?.[col];
        return ch && ch !== '.' ? pal[ch] : null;
      });
      // A darker mown ring round it, out to the centre circle.
      const ring = sheet(-CENTER_R, CENTER_R, -CENTER_R, CENTER_R, 0.5, 0.008, (x, z) => (Math.hypot(x, z) < CENTER_R - 0.3 ? GRASS_B : null));
      this.add(this.a.pitch, new THREE.Mesh(ring, this.a.lawn));
      const m = new THREE.Mesh(geo, this.a.lawn);
      m.receiveShadow = true;
      this.add(this.a.pitch, m);
      return;
    }
    const geo = sheet(-(HALF_L + 2), HALF_L + 2, -(HALF_W + 2), HALF_W + 2, id === 'mowchecks' ? 0.75 : 0.5, 0.008, (x, z) => mowColor(id, x, z));
    const m = new THREE.Mesh(geo, this.a.lawn);
    m.receiveShadow = true;
    this.add(this.a.pitch, m);
  }

  // ------------------------------------------------------------------ nets

  private buildNets(id: string): void {
    const glow = id === 'netglow';
    const alpha = netAlpha(id === 'nethex');
    this.texs.push(alpha);
    alpha.repeat.set(1, 1);
    const { shirt, shirt2 } = this.style;
    for (const net of this.a.nets) {
      const geo = net.geometry;
      const pos = geo.getAttribute('position');
      const cols = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        this.c.setHex(netColor(id, shirt, shirt2, x, y, z));
        cols[i * 3] = this.c.r; cols[i * 3 + 1] = this.c.g; cols[i * 3 + 2] = this.c.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      const mat = new THREE.MeshBasicMaterial({
        vertexColors: true, alphaMap: alpha, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      this.mats.push(mat);
      net.material = mat;
    }
  }

  // ------------------------------------------------------------------ corner flags

  private buildFlags(id: string): void {
    for (const f of this.a.cornerFlags) f.visible = false;
    const { shirt, shirt2 } = this.style;
    this.fireFlags = id === 'flagfire';
    // A tall pole and a big flag: club colours, chequered, or a flickering flame.
    const flagGeo = cornerFlagGeometry(id, shirt, shirt2);
    const poleGeo = new BoxBuilder().box(0, 1.25, 0, 0.09, 2.5, 0.09, id === 'flagcheck' ? WHITE : shirt2).build();
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const pole = new THREE.Mesh(poleGeo, voxelMaterial);
        pole.position.set(sx * HALF_L, 0, sz * HALF_W);
        pole.castShadow = true;
        const flag = new THREE.Mesh(flagGeo, charMaterialFor(flagGeo));
        flag.position.set(0, 1.7, 0);
        flag.castShadow = true;
        pole.add(flag);
        this.flags.push(flag);
        this.add(this.a.pitch, pole);
      }
    }
  }

  // ------------------------------------------------------------------ seats: the name in the far stand

  private buildSeats(): void {
    const bits = nameBitmap(this.style.short);
    const cols = bits[0].length;
    const { shirt } = this.style;
    const far = this.a.far;
    if (!far) {
      // No stand: giant voxel letters on the far bank behind the fence (0.9 m blocks), outlined in club colours.
      const b = new BoxBuilder();
      const px = 0.95;
      const x0 = -(cols * px) / 2;
      for (let r = 0; r < 5; r++) for (let c = 0; c < cols; c++) {
        if (!bits[r][c]) continue;
        b.box(x0 + c * px + px / 2, (4 - r) * px + px / 2 + 0.2, -(this.a.boardZ + 4.5), px * 0.96, px * 0.96, px, shirt, { top: shade(shirt, 1.15) });
      }
      const m = new THREE.Mesh(b.build(), voxelMaterial);
      m.castShadow = true;
      this.add(this.a.group, m);
      return;
    }
    // The far stand's five front rows (what the broadcast shot sees over the boards), between the fan banners hung
    // there; and the home end's five front rows too, where the ground has one.
    const { stepD, stepH } = this.a;
    const rows = [0, 1, 2, 3, 4].map((i) => ({ d: i * stepD, h: 0.9 + i * stepH }));
    const seat = 0.86;
    // Where it fits, nearest the halfway line: two seats a pixel if there is room, else one and a half, else one.
    const free: [number, number][] = [];
    let from = -far.span + 1;
    for (const bx of [...this.a.bannerX].sort((a, b) => a - b)) {
      if (bx - 5.4 > from) free.push([from, bx - 5.4]);
      from = Math.max(from, bx + 5.4);
    }
    if (far.span - 1 > from) free.push([from, far.span - 1]);
    // (Just right of the halfway line, where the kick-off shot looks: the giant tifo takes the home half.)
    const want = 6;
    let place: { x0: number; pw: number } | null = null;
    for (const near of [true, false]) {
      for (const pw of [seat * 2, seat * 1.5, seat]) {
        const w = cols * pw;
        let best: number | null = null;
        for (const [a, b] of free) {
          if (b - a < w) continue;
          const cx = Math.max(a + w / 2, Math.min(b - w / 2, want));
          if (best === null || Math.abs(cx - want) < Math.abs(best - want)) best = cx;
        }
        if (best !== null && (!near || Math.abs(best - want) < 16)) {
          place = { x0: best - w / 2, pw };
          break;
        }
      }
      if (place) break;
    }
    if (place) this.mosaic('far', rows, place.x0, place.pw, bits);
    const left = this.a.left;
    if (left && this.a.standX) this.mosaic('left', rows, -(cols * seat * 2) / 2, seat * 2, bits);
  }

  /**
   * The name spelt in one stand's seats, the way the big grounds do it: a block of seats kept clear of fans, their seat
   * backs in the club colours spelling the short name (a fan's head in front of every pixel would break the letters
   * up). Pixels `pw` metres along the stand from `a0`.
   */
  private mosaic(side: 'far' | 'left', rows: readonly { d: number; h: number }[], a0: number, pw: number, bits: boolean[][]): void {
    const { shirt, shirt2 } = this.style;
    const cols = bits[0].length;
    const top = rows.length - 1;
    const pixel = (t: number, ri: number): boolean | null => {
      const c = Math.floor((t - a0) / pw);
      if (c < 0 || c >= cols) return null;
      return bits[top - ri][c];
    };
    const front = side === 'far' ? this.a.standZ : this.a.standX ?? 58.7;
    // (Along the stand: x on the far side; on the home end the letters run from the far corner towards the lens.)
    const at = (t: number, d: number): [number, number] => (side === 'far' ? [t, -(front + d)] : [-(front + d), -t]);
    const b = new BoxBuilder();
    const seat = 0.86;
    rows.forEach((r, ri) => {
      for (let t = a0 + seat / 2; t < a0 + cols * pw; t += seat) {
        const on = pixel(t, ri);
        if (on === null) continue;
        const [x, z] = at(t, r.d + this.a.stepD * 0.78);
        // A seat back and its pan, both in the pixel's colour: the letters read solid from the gantry.
        const c = on ? shirt2 : shirt;
        if (side === 'far') {
          b.box(x, r.h + 0.32, z, seat * 0.9, 0.6, 0.16, c);
          b.box(x, r.h + 0.06, z + 0.3, seat * 0.9, 0.1, 0.5, shade(c, 0.9));
        } else {
          b.box(x, r.h + 0.32, z, 0.16, 0.6, seat * 0.9, c);
          b.box(x + 0.3, r.h + 0.06, z, 0.5, 0.1, seat * 0.9, shade(c, 0.9));
        }
      }
    });
    this.add(this.a.group, new THREE.Mesh(b.build(), voxelMaterial));
    const crowd = this.a.crowd;
    if (!crowd || !crowd.instanceColor) return;
    for (let i = 0; i < crowd.count; i++) {
      crowd.getMatrixAt(i, this.m4);
      this.v.setFromMatrixPosition(this.m4);
      if (side === 'far' ? this.v.z > -front + 0.2 : this.v.x > -front + 0.2 || Math.abs(this.v.z) > 40) continue;
      const ri = rows.findIndex((r) => Math.abs(r.h - this.v.y) < 0.2);
      if (ri < 0) continue;
      const on = pixel(side === 'far' ? this.v.x : -this.v.z, ri);
      if (on === null) continue;
      // (The fans who sat here stand elsewhere: their seat goes empty.)
      crowd.setMatrixAt(i, this.m4.makeScale(0, 0, 0));
    }
    crowd.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------------ tifo

  /** The giant crest banner over the far stand (or held along the far fence), unrolled at kick off. */
  private buildTifo(): void {
    const tex = tifoTexture(this.style.shirt, this.style.shirt2, this.style.short);
    this.texs.push(tex);
    const mat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
    this.mats.push(mat);
    const far = this.a.far;
    const rowTop = far ? Math.min(far.t1 - 1, 10) : 0;
    // (On a small stand it reaches down to the front row, never past it.)
    const W = far ? 24 : 15, H = far ? Math.min(7.5, ((rowTop + 1) * this.a.stepH) / 0.85 + 0.4) : 2.6;
    const geo = new THREE.PlaneGeometry(W, H, 16, 4);
    // (Hung from its top edge, so unrolling grows it downwards.)
    geo.translate(0, -H / 2, 0);
    const mesh = new THREE.Mesh(geo, mat);
    if (far) {
      // Over the far stand's lower rows in the home half, clear of the banners, at the stand's rake.
      let x = -16;
      for (const bx of this.a.bannerX) if (Math.abs(bx - x) < W / 2 + 5) x = bx > x ? bx - W / 2 - 5.5 : bx + W / 2 + 5.5;
      x = Math.max(-far.span + W / 2, Math.min(far.span - W / 2, x));
      // Held up over the fans' heads (a fan is about 1.1 m sat down): lifted off the rake along its normal.
      mesh.position.set(x, 0.9 + rowTop * this.a.stepH + 0.9 + 0.75, -(this.a.standZ + rowTop * this.a.stepD) + 0.3 + 1.2);
      mesh.rotation.x = -0.56;
    } else {
      mesh.position.set(-12, 3.1, -(this.a.boardZ + 1.4));
    }
    this.tifo = { mesh, base: Float32Array.from(geo.getAttribute('position').array as Float32Array), unroll: 1 };
    this.add(this.a.group, mesh);
  }

  /** Home fans wave flags in club colours (a pole and a flag at every few home seats). */
  private buildFlagWave(): void {
    const crowd = this.a.crowd;
    const spots: number[] = [];
    if (crowd) {
      const team = crowd.geometry.getAttribute('aTeam') as THREE.InstancedBufferAttribute | undefined;
      for (let i = 0; i < crowd.count && spots.length < 160 * 4; i += 5) {
        if (team && team.getX(i) !== 0) continue;
        crowd.getMatrixAt(i, this.m4);
        this.v.setFromMatrixPosition(this.m4);
        this.e.setFromRotationMatrix(this.m4);
        spots.push(this.v.x, this.v.y, this.v.z, this.e.y);
      }
    }
    if (spots.length === 0) {
      // A ground with hardly anyone in: a row of flag bearers along the far fence.
      for (let x = -40; x <= 40; x += 4) spots.push(x, 0, -(this.a.boardZ + 1.2), 0);
    }
    const n = spots.length / 4;
    const geo = new BoxBuilder().box(0.6, 2.05, 0, 1.2, 0.8, 0.04, WHITE).box(0, 1.35, 0, 0.06, 1.7, 0.06, 0x8a5a36).build();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.mats.push(mat);
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    for (let i = 0; i < n; i++) mesh.setColorAt(i, this.c.setHex(i % 3 === 2 ? this.style.shirt2 : this.style.shirt));
    mesh.frustumCulled = false;
    this.wave = { mesh, spots: Float32Array.from(spots), n };
    this.add(this.a.group, mesh);
    this.updateWave(0);
  }

  private updateWave(time: number): void {
    const w = this.wave;
    if (!w) return;
    const amp = this.partyT > 0 ? 1.1 : 0.55;
    const sp = w.spots;
    for (let i = 0; i < w.n; i++) {
      const k = i * 4;
      this.e.set(0, sp[k + 3] + Math.sin(time * 3.2 + i * 1.7) * amp, Math.sin(time * 2.1 + i) * 0.18);
      this.q.setFromEuler(this.e);
      this.m4.compose(this.v.set(sp[k], sp[k + 1], sp[k + 2]), this.q, this.s);
      w.mesh.setMatrixAt(i, this.m4);
    }
    w.mesh.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------------ lights

  private buildLights(): void {
    let heads = this.a.lamps;
    if (!heads.length) {
      // No floodlights by day on a small ground: four slim LED pylons at the corners carry the light show.
      const pylons = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ x: sx * (HALF_L + 7), z: sz * (HALF_W + 6), h: 10 })));
      const b = new BoxBuilder();
      for (const p of pylons) {
        b.box(p.x, p.h / 2, p.z, 0.4, p.h, 0.4, 0x3a3f48);
        b.box(p.x, p.h, p.z, 1.6, 0.5, 1.6, 0x26262e);
      }
      const m = new THREE.Mesh(b.build(), voxelMaterial);
      m.castShadow = true;
      this.add(this.a.group, m);
      heads = pylons.map((p) => ({ ...p, h: p.h + 0.4 }));
    }
    // The beam: a cone 1 m long from its apex along +z (scaled to reach the pitch), bright at the lamp and fading out.
    const geo = new THREE.ConeGeometry(0.12, 1, 14, 1, true);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, 0.5);
    const pos = geo.getAttribute('position');
    const col = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getZ(i);
      col[i * 4] = col[i * 4 + 1] = col[i * 4 + 2] = 1;
      col[i * 4 + 3] = 0.12 + 0.88 * Math.max(0, 1 - t) ** 1.4;
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    let k = 0;
    for (const h of heads) {
      for (let j = 0; j < 2; j++) {
        const mat = new THREE.MeshBasicMaterial({
          vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
        });
        this.mats.push(mat);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.frustumCulled = false;
        mesh.renderOrder = 4;
        this.beams.push({ mesh, mat, hx: h.x, hy: h.h, hz: h.z, phase: k++ * 1.3 });
        this.add(this.a.group, mesh);
      }
      // A coloured halo round the lamp (it shows at night).
      const halo = new THREE.Sprite(this.haloMat());
      halo.position.set(h.x, h.h, h.z);
      halo.scale.set(16, 16, 1);
      halo.visible = false;
      this.halos.push(halo);
      this.add(this.a.group, halo);
    }
  }

  private haloTex: THREE.CanvasTexture | null = null;
  private haloMat(): THREE.SpriteMaterial {
    if (!this.haloTex) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d')!;
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.3, 'rgba(255,255,255,0.5)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      this.haloTex = new THREE.CanvasTexture(c);
      this.texs.push(this.haloTex);
    }
    const m = new THREE.SpriteMaterial({ map: this.haloTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
    this.mats.push(m);
    return m;
  }

  /** A beam's colour now: club colours, or the light show's rainbow (strobing in a party). */
  private beamColor(i: number, time: number): number {
    if (this.style.slots.lights === 'lightshow') {
      this.c.setHSL((time * 0.12 + i * 0.13) % 1, 0.95, 0.6);
      return this.c.getHex();
    }
    return i % 2 ? this.style.shirt2 : this.style.shirt;
  }

  // ------------------------------------------------------------------ the frame

  setTimeOfDay(t: 'day' | 'sunset' | 'night'): void {
    this.night = t === 'night';
    for (const h of this.halos) h.visible = this.night;
  }

  /** The walkout: the kick-off show and a burst of the light show (once a match). */
  kickoff(): void {
    if (this.kickDue === -2) return;
    this.kickDue = -2;
    this.partyT = Math.max(this.partyT, 5);
    if (this.tifo) this.tifo.unroll = 0;
    const show = KICKOFF_SHOWS[this.style.slots.kickoff ?? ''];
    if (show && this.fx) this.fx.play(show.run, show.dur, 0, 0, 0, 1, 0, show.k, [this.style.shirt, this.style.shirt2, 0xffd23a, WHITE]);
  }

  /** Kick off by itself `s` seconds from now (no intro to wait for). */
  kickoffIn(s: number): void {
    if (this.kickDue !== -2) this.kickDue = s;
  }

  /** Your goal: the mascot dances (the dragon breathes confetti), the lights go wild, the flags and tifo wave. */
  goal(): void {
    this.partyT = 7;
    if (this.mascot) {
      this.mascot.dance();
      if (this.mascot.kind === 'dragon' && this.fx) {
        const g = this.mascot.group.position;
        this.fx.play(DRAGON_BREATH.run, DRAGON_BREATH.dur, g.x + 0.4, 2.1, g.z + 0.6, 0.25, 1, 1, [this.style.shirt, this.style.shirt2, 0xffd23a, WHITE, 0xff5cb0]);
      }
    }
  }

  update(dt: number, time: number): void {
    if (this.kickDue >= 0) {
      this.kickDue -= dt;
      if (this.kickDue < 0) this.kickoff();
    }
    if (this.partyT > 0) this.partyT = Math.max(0, this.partyT - dt);
    if (this.kitFx) tickKitFx();
    this.mascot?.update(dt, time);
    for (let i = 0; i < this.flags.length; i++) {
      const f = this.flags[i];
      f.rotation.y = Math.sin(time * 3 + i * 1.3) * 0.4;
      if (this.fireFlags) f.scale.y = 1 + Math.sin(time * 13 + i) * 0.08;
    }
    this.updateWave(time);
    const t = this.tifo;
    if (t) {
      if (t.unroll < 1) t.unroll = Math.min(1, t.unroll + dt / 1.4);
      t.mesh.scale.y = 0.04 + 0.96 * (1 - (1 - t.unroll) ** 3);
      const pos = t.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      const amp = this.partyT > 0 ? 0.55 : 0.18;
      for (let i = 0; i < arr.length; i += 3) arr[i + 2] = t.base[i + 2] + Math.sin(time * 3 + t.base[i] * 0.5 + t.base[i + 1] * 0.8) * amp;
      pos.needsUpdate = true;
    }
    if (this.beams.length) {
      const party = this.partyT > 0;
      // (By day only a hint, a little more in a party: the beams must never wash the pitch out under the play.)
      const base = this.night ? 0.26 : 0.045;
      const op = party ? (this.night ? 0.5 : 0.11) : base;
      const strobe = party && this.style.slots.lights === 'lightshow' ? 0.65 + 0.35 * Math.sign(Math.sin(time * 18)) : 1;
      const speed = party ? 1.9 : 0.45;
      for (let i = 0; i < this.beams.length; i++) {
        const b = this.beams[i];
        const ph = b.phase + time * speed;
        this.target.set(Math.sin(ph) * HALF_L * 0.7, 0, Math.cos(ph * 0.8) * HALF_W * 0.55);
        b.mesh.position.set(b.hx, b.hy, b.hz);
        b.mesh.lookAt(this.target);
        const d = this.v.set(b.hx, b.hy, b.hz).distanceTo(this.target);
        const spread = 15 * (party ? 1.15 : 1);
        b.mesh.scale.set(spread, spread, d * 1.05);
        b.mat.color.setHex(this.beamColor(i, time));
        b.mat.opacity = op * strobe;
      }
      for (let i = 0; i < this.halos.length; i++) {
        const m = this.halos[i].material as THREE.SpriteMaterial;
        m.color.setHex(this.beamColor(i * 2, time));
        m.opacity = party ? 1 : 0.8;
      }
    }
  }

  dispose(): void {
    for (const o of this.own) o.removeFromParent();
    for (const m of this.mats) m.dispose();
    for (const t of this.texs) t.dispose();
    this.wave?.mesh.dispose();
  }
}
