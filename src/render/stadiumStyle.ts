import * as THREE from 'three';
import { CREST_H, CREST_W, FONT_3X5, ROLE, crestFor, crestPixels, crestRoles, type CrestDesign } from '../core/crest';
import type { DecorStyle } from '../meta/style';
import { CENTER_R, HALF_L, HALF_W } from '../sim/constants';
import { charMaterialFor, tickKitFx } from './characters';
import { Show, type FxKit } from './fx/kit';
import { BEAR_DRUM, DRAGON_BREATH, GOAL_SHOWS, KICKOFF_SHOWS, ROBOT_SPARK, WIN_SHOWS, type StadiumShowDef } from './fx/stadiumFx';
import { FX, type Cell } from './kitDesigns';
import { GRASS_A, GRASS_B, cssHex, shade } from './palette';
import { BoxBuilder, VoxelGrid, meshVoxels, voxelMaterial } from './voxel';

/**
 * STADIUM STYLE (meta/shop.ts sells it, core/save.ts DECOR_IDS): decorative layers over your home ground, built on
 * top of whatever the career has built (render/stadium.ts owns the structure; this never touches it, only adds to its
 * groups or restyles its nets and corner flags through Stadium.decorAnchors()). Visible in every home match.
 *
 * THE RULE (October 2026, after the owner's playtest: "stadium and shit looks broken"): the pitch stays clean. Nothing
 * here puts light, flame, smoke or confetti on the playing surface, and nothing translucent ever lies over the grass.
 *
 * - pitch: mowing patterns in the lawn's own two greens (checks, diagonals, rings), or your club's own crest mown into
 *   the centre circle in light and dark grass tones;
 * - nets: club stripes, honeycomb, rainbow or neon;
 * - flags: taller corner flags (club, chequered, flickering flames);
 * - seats: your club's short name spelt out in the far stand's seats (giant letters on the bank of a ground with none);
 * - tifo: home fans waving flags and a giant flag surfing over the home end, or a giant banner of your crest that
 *   unrolls over the far stand at kick off under a card mosaic in the upper tier;
 * - kickoff: confetti, fireworks or pyro behind the boards and off the roof as the match kicks off, again behind the
 *   goal when you score (the pyro show rings the goal in flame) and at full time when you win (render/fx/stadiumFx.ts);
 * - lights: an LED strip round the pitch, coloured lamps and searchlights in the sky; the light show adds spotlights
 *   sweeping the stands and lit seat blocks;
 * - mascot: a voxel bear, robot or dragon on the touchline by the home dugout, each with its own act (the bear drums,
 *   the robot does the robot, the dragon breathes fire into the air), a wave at kick off, a big celebration when you
 *   score with a one second camera cutaway, and a half time show.
 *
 * Performance: a handful of merged meshes and three instanced ones, shared materials, three small canvas textures at
 * most, nothing allocated per frame.
 */

interface StandRows { t1: number; t2: number; span: number }

/** What the stadium lends the decor (render/stadium.ts decorAnchors; the shop's diorama makes its own). */
export interface DecorAnchors {
  /** The stadium's root group and its pitch group (lifted by PITCH_Y). */
  group: THREE.Group;
  pitch: THREE.Group;
  level: number;
  /** The far (main) stand's rows, if built: tier 1 and 2 row counts and its half length; and the other three sides'. */
  far: StandRows | null;
  left?: StandRows | null;
  right?: StandRows | null;
  near?: StandRows | null;
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
  /** The big screen's face (its centre, width and height; it looks down the pitch towards -x), if the ground has one. */
  screen?: { x: number; y: number; z: number; w: number; h: number } | null;
}

const WHITE = 0xfbfbf4;
const INK = 0x26262e;
const GOLD = 0xffc23a;
const RAINBOW = [0xec4a3e, 0xff8a2a, 0xffd23a, 0x3cc15a, 0x2f7be8, 0x8a5cf6] as const;

/** The name as a pixel bitmap: rows (5) of booleans, 3 columns a letter and a gap between. */
export function nameBitmap(name: string): boolean[][] {
  const rows: boolean[][] = [[], [], [], [], []];
  [...name.toUpperCase()].forEach((ch, i) => {
    const g = FONT_3X5[ch];
    if (i > 0) for (const r of rows) r.push(false);
    for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) rows[y].push(g ? g[y][x] === '#' : false);
  });
  return rows;
}

// ------------------------------------------------------------------ the crest on the lawn

/** Grass tones for the crest mown into the centre circle: dark to pale, all greens of the lawn's own family. */
const LAWN_DEEP = 0x5c9831;
const LAWN_DARK = 0x79b53d;
const LAWN_MID = 0x95cc51;
const LAWN_LIGHT = 0xb2e06c;
const LAWN_PALE = 0xd2f29a;

const lumOf = (hex: number): number => (((hex >> 16) & 255) * 0.299 + ((hex >> 8) & 255) * 0.587 + (hex & 255) * 0.114) / 255;

/**
 * The crest as a mowing pattern: each of its colours becomes a grass tone, the darker colour the darker green (the
 * outline and the emblem's details the deepest, the emblem the palest, so it reads from the gantry by day and under
 * the floodlights). Returns a painter from a ROLE (core/crest.ts) to a tone.
 */
export function crestLawnTone(d: CrestDesign): (role: number) => number {
  const twoTone = d.c1 !== d.c2;
  const c1Dark = lumOf(d.c1) <= lumOf(d.c2);
  const f1 = twoTone ? (c1Dark ? LAWN_DARK : LAWN_LIGHT) : LAWN_DARK;
  const f2 = twoTone ? (c1Dark ? LAWN_LIGHT : LAWN_DARK) : LAWN_DARK;
  return (role) => {
    switch (role) {
      case ROLE.ink: case ROLE.detail: case ROLE.text: return LAWN_DEEP;
      case ROLE.c1: return f1;
      case ROLE.c2: return f2;
      case ROLE.light: return 0xe6f8c0;
      default: return LAWN_PALE;
    }
  };
}

/** The design a decor style draws (the club's own, or one from its colours and short name). */
function crestOfStyle(style: DecorStyle): CrestDesign {
  return style.crest ?? crestFor(style.name ?? '', style.short.slice(0, 3), { shirt: style.shirt, shirt2: style.shirt2 });
}

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
 * The centre circle with the crest mown into it, on a pitch `k` times the real size (the shop's diorama: k < 1): a
 * plain mid-green disc inside the circle, the crest in grass tones on it, its top towards the far side (so it stands
 * upright from the gantry). `turn` lays its top towards -x instead (the diorama's lens looks along x).
 */
export function crestLawnGeometry(d: CrestDesign, short: string, name: string, k = 1, y = 0.008, turn = false): THREE.BufferGeometry {
  const roles = crestRoles(d, short, name);
  const tone = crestLawnTone(d);
  const cell = 0.38 * k;
  const w = CREST_W * cell, h = CREST_H * cell;
  const R = (CENTER_R - 0.35) * k;
  return sheet(-R, R, -R, R, cell / 2, y, (x, z) => {
    const u = turn ? z : x;
    const v = turn ? -x : z;
    const col = Math.floor((u + w / 2) / cell);
    const row = Math.floor((v + h / 2) / cell);
    if (col >= 0 && col < CREST_W && row >= 0 && row < CREST_H) {
      const r = roles[row * CREST_W + col];
      if (r !== ROLE.none) return tone(r);
    }
    return Math.hypot(x, z) < R ? LAWN_MID : null;
  });
}

/**
 * A mowing pattern's grass colour at (x, z) on a pitch `k` times the real size (the shop's diorama: k < 1): checks,
 * diagonal stripes (crossing into diamonds) or rings out from the centre spot. The lawn's own two greens, no others.
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

/** The crest drawn on a canvas, `cell` px a cell, its top-left at (x, y). */
function drawCrest(g: CanvasRenderingContext2D, d: CrestDesign, short: string, name: string, x: number, y: number, cell: number): void {
  const p = crestPixels(d, short, name);
  for (let r = 0; r < CREST_H; r++) for (let c = 0; c < CREST_W; c++) {
    const v = p[r * CREST_W + c];
    if (v < 0) continue;
    g.fillStyle = cssHex(v);
    g.fillRect(x + c * cell, y + r * cell, cell, cell);
  }
}

/** The giant tifo's cloth: diagonal club stripes, the club's crest in the middle, the short name either side. */
export function tifoTexture(shirt: number, shirt2: number, short: string, crest?: CrestDesign, name = ''): THREE.CanvasTexture {
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
  const d = crest ?? crestFor(name, short.slice(0, 3), { shirt, shirt2 });
  // (A cream plate behind the crest: whatever its colours, it stands off the cloth.)
  g.fillStyle = '#fbfbf4';
  g.fillRect(256 - 76, 0, 152, 160);
  drawCrest(g, d, short.slice(0, 3), name, 256 - (CREST_W * 5) / 2, 5, 5);
  g.fillStyle = cssHex(shirt2);
  g.font = '700 54px "Silkscreen", "Lilita One", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(short, 92, 82);
  g.fillText(short, 420, 82);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** The surfer flag's cloth: the club's two colours in halves, the crest on a cream disc in the middle. */
export function flagTexture(shirt: number, shirt2: number, short: string, crest?: CrestDesign, name = ''): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const g = c.getContext('2d')!;
  g.fillStyle = cssHex(shirt);
  g.fillRect(0, 0, 256, 160);
  g.fillStyle = cssHex(shirt2);
  g.fillRect(0, 0, 256, 20);
  g.fillRect(0, 140, 256, 20);
  g.fillRect(0, 0, 14, 160);
  g.fillRect(242, 0, 14, 160);
  g.fillStyle = '#fbfbf4';
  g.fillRect(128 - 44, 22, 88, 116);
  drawCrest(g, crest ?? crestFor(name, short.slice(0, 3), { shirt, shirt2 }), short.slice(0, 3), name, 128 - (CREST_W * 3) / 2, 35, 3);
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

// ------------------------------------------------------------------ mascots

/** A voxel part from a cell painter, `pivot` in cells. */
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

/** What a mascot is doing: its idle act, a wave (kick off), its goal celebration, or its half time show. */
type Act = 'idle' | 'wave' | 'dance';
/** A mascot's own effect, where it happens in the mascot's space (x forward, y up, z right; metres at scale 1). */
export type MascotFx = (kind: 'drum' | 'spark' | 'fire', x: number, y: number, z: number) => void;

/** Voxel size (m): a mascot stands about 3.3 m tall, a head and shoulders over the players. */
const MV = 0.15;
const TAU = Math.PI * 2;
/** The robot's dance: a pose every beat (arm raise L, R forward; arm out L, R sideways; twist; head tilt; slide). */
const ROBOT_POSES: readonly (readonly [number, number, number, number, number, number, number])[] = [
  [1.57, 0, 0, 0, 0.5, 0.25, 0.3],
  [1.57, 1.57, 0, 0, 0, -0.25, 0],
  [0, 1.57, 1.57, 0, -0.5, 0, -0.3],
  [3.0, 0, 0, 1.57, 0, 0.25, 0],
  [0, 3.0, 1.57, 1.57, 0.5, -0.25, 0.3],
  [1.57, 1.57, 1.57, 1.57, -0.5, 0, -0.3],
];

/**
 * A touchline mascot with an act of its own: the BEAR drums on the big drum it wears, the ROBOT does the robot (a new
 * right-angle pose every beat, its hands sparking), the DRAGON flaps its wings and breathes fire into the air. Posed
 * every frame from its clock, nothing allocated. `onFx` gets its drum beats, sparks and fire (StadiumDecor and the
 * shop's stage play the effects).
 */
export class Mascot {
  readonly group = new THREE.Group();
  /** Everything above the ground: bounces, leans and spins. */
  private readonly rig = new THREE.Group();
  private readonly torso: THREE.Mesh;
  private readonly head: THREE.Mesh;
  private readonly armL: THREE.Mesh;
  private readonly armR: THREE.Mesh;
  private readonly legL: THREE.Mesh;
  private readonly legR: THREE.Mesh;
  private readonly wings: THREE.Mesh[] = [];
  private tail: THREE.Mesh | null = null;
  private act: Act = 'idle';
  private actT = 0;
  private actDur = 0;
  private beat = -1;
  /** When the dragon's first breath of a celebration goes off (s into it): the cutaway is timed to it. */
  private fireAt = 0.35;
  private readonly baseYaw: number;
  /** How far it has turned from its resting yaw to its celebration's (0..1). */
  private turn = 0;
  /** Is the clock running this frame? (A paused match and the shop's stills pose it without setting effects off.) */
  private live = true;
  onFx: MascotFx | null = null;

  /**
   * `yaw` is the way it faces at rest; `danceYaw` the way it turns to celebrate (in a match: at rest it faces the main
   * stand and the broadcast lens, and it turns to the pitch, where the cutaway films it against the home fans).
   */
  constructor(readonly kind: MascotKind, shirt: number, shirt2: number, x: number, z: number, yaw: number, private readonly danceYaw = yaw) {
    const V = MV;
    this.baseYaw = yaw;
    // Model space as the players: forward +x, up +y, right +z.
    const metal = kind === 'robot';
    const fur = kind === 'bear' ? 0x9a6436 : kind === 'robot' ? 0xd3dbe6 : 0xe03a1e;
    const pale = kind === 'bear' ? 0xf0d2a0 : kind === 'robot' ? 0x4a5262 : 0xffd23a;
    const dark = kind === 'bear' ? 0x6e4424 : kind === 'robot' ? 0x4a5262 : 0xa8241a;
    const furC: Cell = metal ? [fur, FX.metal] : fur;
    // A club shirt colour that never matches the fur.
    const trim = shirt2 === shirt ? WHITE : shirt2;

    // ---- legs (pivot at the hip)
    const leg = (): THREE.Mesh => part(4, 4, 4, V, [2, 4, 2], (lx, y) => {
      if (y === 0) return kind === 'dragon' ? (lx === 3 ? pale : dark) : dark;
      if (metal) return y === 2 ? dark : furC;
      return fur;
    });
    this.legL = leg();
    this.legR = leg();
    this.legL.position.set(0, 4 * V, -2.7 * V);
    this.legR.position.set(0, 4 * V, 2.7 * V);

    // ---- torso (x 0 the back .. 7 the chest; the dragon's back row carries its spikes)
    this.torso = part(8, 9, 11, V, [4, 0, 5.5], (bx, y, bz) => {
      const front = bx === 7;
      if (kind === 'robot') {
        // A chest screen with club-colour bars lit, club shoulders, a dark belt.
        if (front && y >= 3 && y <= 6 && bz >= 3 && bz <= 7) return y === 3 || y === 6 ? 0x1c1c24 : [bz % 2 ? shirt : trim, FX.lit];
        if (y === 8) return shirt;
        if (y === 0) return dark;
        if ((bz === 0 || bz === 10) && y >= 3 && y <= 5 && bx >= 3 && bx <= 4) return dark;
        return furC;
      }
      if (kind === 'dragon') {
        // Scales, a yellow belly, a club scarf round the neck with its end hanging down the chest.
        if (bx === 0) return bz === 5 && y % 2 === 0 && y >= 2 ? pale : null;
        if (y === 8) return (bz + bx) % 2 ? shirt : trim;
        if (front && bz >= 8 && bz <= 9 && y >= 5) return y % 2 ? shirt : trim;
        if (front && bz >= 2 && bz <= 7 && y <= 6) return y % 2 ? pale : shade(pale, 0.86);
        return (bx * 3 + y * 5 + bz * 7) % 11 === 0 ? dark : fur;
      }
      // The bear: a club shirt with a hoop and a white collar.
      if (y === 8) return WHITE;
      if (y === 0) return fur;
      return y === 4 || y === 5 ? trim : shirt;
    });
    this.torso.position.y = 4 * V;

    // The bear's big drum, worn on its tummy: a gold rim, a cream skin with the club's hoop across it.
    if (kind === 'bear') {
      const drum = part(3, 7, 7, V, [0, 3.5, 3.5], (dx, y, dz) => {
        const rr = Math.hypot(y - 3, dz - 3);
        if (rr > 3.6) return null;
        if (dx < 2) return rr > 2.7 ? [GOLD, FX.metal] : shirt;
        if (rr > 2.7) return [GOLD, FX.metal];
        return y === 3 ? trim : 0xfff4dc;
      });
      drum.position.set(4 * V, 4.2 * V, 0);
      this.torso.add(drum);
    }
    // The dragon's tail curls out of its back; its tip is an arrow head.
    if (kind === 'dragon') {
      const tail = part(8, 3, 3, V, [8, 1.5, 1.5], (tx, ty, tz) => {
        if (tx <= 1) return ty === 1 || tz === 1 ? pale : null;
        return ty === 1 && tz === 1 ? fur : tx > 3 ? fur : null;
      });
      tail.position.set(-3.6 * V, 1.5 * V, 0);
      this.torso.add(tail);
      this.tail = tail;
    }

    // ---- head
    if (kind === 'bear') {
      // Round ears on top, a pale muzzle that sticks out, a black nose, eyes with a glint.
      this.head = part(10, 9, 11, V, [4.5, 0, 5.5], (hx, hy, hz) => {
        if (hy === 8) {
          const ear = (hz <= 2 || hz >= 8) && hx >= 3 && hx <= 5;
          return ear ? (hx === 4 && (hz === 1 || hz === 9) ? pale : fur) : null;
        }
        if (hx === 9) {
          if (hy >= 1 && hy <= 3 && hz >= 4 && hz <= 6) return hy === 3 && hz === 5 ? 0x16161c : pale;
          return null;
        }
        if (hx === 8) {
          if (hy === 5 && (hz === 3 || hz === 7)) return 0x16161c;
          if (hy === 6 && (hz === 3 || hz === 7)) return WHITE;
          if (hy >= 1 && hy <= 3 && hz >= 3 && hz <= 7) return pale;
        }
        return fur;
      });
    } else if (kind === 'robot') {
      // A box with a dark visor and two lit eyes, a grille, bolts for ears.
      this.head = part(10, 8, 11, V, [5, 0, 5.5], (hx, hy, hz) => {
        if (hx === 9) {
          if (hy >= 4 && hy <= 6 && hz >= 1 && hz <= 9) return hy === 5 && (hz === 2 || hz === 3 || hz === 7 || hz === 8) ? [0x3cf7ff, FX.lit] : 0x1c1c24;
          if (hy === 2 && hz >= 3 && hz <= 7) return hz % 2 ? 0x1c1c24 : dark;
        }
        if ((hz === 0 || hz === 10) && hy >= 3 && hy <= 5 && hx >= 4 && hx <= 6) return shirt;
        if (hy === 0) return dark;
        return furC;
      });
      // The antenna and its blinking light.
      const ant = part(1, 4, 1, V, [0.5, 0, 0.5], (_x, y) => (y === 3 ? [0xec4a3e, FX.lit] : dark));
      ant.position.y = 8 * V;
      this.head.add(ant);
    } else {
      // The dragon: big lit yellow eyes under a dark brow, a snout with nostrils and a row of teeth, a yellow jaw,
      // two cream horns and a purple frill each side.
      this.head = part(12, 10, 11, V, [4.5, 0, 5.5], (hx, hy, hz) => {
        if (hy >= 8) return (hz === 2 || hz === 8) && hx >= 2 && hx <= 3 && !(hy === 9 && hx === 3) ? 0xfff0c8 : null;
        if (hx >= 9) {
          if (hy > 3 || hz < 3 || hz > 7) return null;
          if (hx === 11 && hy === 3 && (hz === 4 || hz === 6)) return 0x16161c;
          if (hy === 1 && hx === 11) return hz % 2 ? WHITE : 0x16161c;
          if (hy === 0) return pale;
          return hy === 3 ? shade(fur, 1.12) : fur;
        }
        if ((hz === 0 || hz === 10) && hx <= 3) return hy >= 3 && hy <= 6 && (hx + hy) % 2 === 0 ? 0x9a5ce8 : hx <= 1 && hy >= 2 && hy <= 6 ? 0x7a44c8 : fur;
        if (hx === 8) {
          if (hy === 7 && (hz <= 3 || hz >= 7)) return dark;
          if ((hy === 5 || hy === 6) && (hz >= 1 && hz <= 3 || hz >= 7 && hz <= 9)) return hz === 3 || hz === 7 ? 0x16161c : [0xffe23a, FX.lit];
        }
        return (hx * 5 + hy * 3 + hz * 7) % 17 === 0 ? dark : fur;
      });
    }
    this.head.position.y = 9 * V;
    this.torso.add(this.head);

    // ---- arms (pivot at the shoulder); the bear holds a drumstick in each paw
    const arm = (): THREE.Mesh => part(3, 8, 3, V, [1.5, 7.5, 1.5], (_x, y) => {
      if (metal) return y <= 1 ? dark : y === 4 ? dark : furC;
      if (y <= 1) return pale;
      return kind === 'bear' && y >= 6 ? shirt : fur;
    });
    this.armL = arm();
    this.armR = arm();
    this.armL.position.set(0.5 * V, 8 * V, -7.2 * V);
    this.armR.position.set(0.5 * V, 8 * V, 7.2 * V);
    if (kind === 'bear') {
      for (const a of [this.armL, this.armR]) {
        const stick = part(6, 1, 1, V, [0, 0.5, 0.5], (sx) => (sx >= 4 ? 0xec4a3e : 0xfff4dc));
        stick.position.set(1 * V, -7 * V, 0);
        a.add(stick);
      }
    }
    this.torso.add(this.armL, this.armR);

    // ---- the dragon's wings (pivot at the root, on the back)
    if (kind === 'dragon') {
      for (const s of [-1, 1]) {
        const w = part(2, 9, 10, V, [1, 0, s < 0 ? 10 : 0], (_x, y, z) => {
          const zz = s < 0 ? 9 - z : z;
          const top = 8 - (zz >> 1);
          if (y > top) return null;
          // A bone along the top edge and three ribs; the membrane scalloped along the bottom.
          if (y === top || zz === 0) return fur;
          if (y < (zz % 3 === 1 ? 2 : 1)) return null;
          return zz % 3 === 0 ? dark : 0x9a5ce8;
        });
        w.position.set(-2.4 * V, 4 * V, s * 2.5 * V);
        this.torso.add(w);
        this.wings.push(w);
      }
    }

    this.rig.add(this.legL, this.legR, this.torso);
    // A low plinth in club colours, so it reads as part of the ground (and stands clear of the touchline's paint).
    const plinth = new THREE.Mesh(new BoxBuilder().box(0, 0.11, 0, 2.3, 0.22, 2.3, shirt, { top: shade(shirt, 1.12) }).box(0, 0.25, 0, 1.9, 0.08, 1.9, trim).build(), voxelMaterial);
    plinth.receiveShadow = true;
    this.rig.position.y = 0.29;
    this.group.add(plinth, this.rig);
    this.group.position.set(x, 0, z);
    this.group.rotation.y = yaw;
  }

  /**
   * Start the goal celebration (7 s; the half time show is the same act, held a little longer). `fireAt`: when the
   * dragon's first breath goes off, in seconds from now (the cutaway is cut to land on it).
   */
  dance(dur = 7, fireAt = 0.35): void {
    this.act = 'dance';
    this.actT = 0;
    this.actDur = dur;
    this.beat = -1;
    this.fireAt = Math.max(0.35, fireAt);
  }

  /** A wave to the crowd (kick off). */
  wave(dur = 3.2): void {
    if (this.act === 'dance') return;
    this.act = 'wave';
    this.actT = 0;
    this.actDur = dur;
  }

  /** Free its geometry (each mascot builds its own). */
  dispose(): void {
    this.group.removeFromParent();
    this.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }

  get dancing(): boolean {
    return this.act === 'dance';
  }

  /** Where its head is (the cutaway looks here), in the mascot's own space at scale 1. */
  get headHeight(): number {
    return 0.29 + 13 * MV + 0.6;
  }

  update(dt: number, time: number): void {
    const { rig, torso, head: h, armL: aL, armR: aR, legL: lL, legR: lR } = this;
    this.live = dt > 0;
    if (this.act !== 'idle') {
      this.actT += dt;
      if (this.actT >= this.actDur) {
        this.act = 'idle';
        this.beat = -1;
      }
    }
    // It turns to the pitch to celebrate and back again after, in a third of a second.
    const want = this.act === 'dance' ? 1 : 0;
    this.turn = want > this.turn ? Math.min(1, this.turn + dt / 0.35) : Math.max(0, this.turn - dt / 0.35);
    const yaw = this.baseYaw + (this.danceYaw - this.baseYaw) * (this.turn * this.turn * (3 - 2 * this.turn));
    // The neutral pose (every act sets only what it moves).
    this.group.rotation.y = yaw;
    rig.position.set(0, 0.29, 0);
    rig.rotation.set(0, 0, 0);
    torso.rotation.set(0, 0, 0);
    h.rotation.set(0, 0, 0);
    aL.rotation.set(0.12, 0, 0);
    aR.rotation.set(-0.12, 0, 0);
    lL.rotation.set(0, 0, 0);
    lR.rotation.set(0, 0, 0);
    for (const w of this.wings) w.rotation.set(Math.sign(w.position.z) * 0.35, 0, 0);
    if (this.tail) this.tail.rotation.set(0, Math.sin(time * 1.8) * 0.45, -0.35);
    const t = this.act === 'idle' ? time : this.actT;
    const dance = this.act === 'dance';
    if (this.kind === 'bear') this.poseBear(t, dance);
    else if (this.kind === 'robot') this.poseRobot(t, dance);
    else this.poseDragon(t, dance);
    if (this.act === 'wave') {
      // One arm up and waving, a little hop, whoever it is (the robot waves in steps).
      const k = Math.min(1, this.actT / 0.25) * Math.min(1, (this.actDur - this.actT) / 0.3);
      const sw = Math.sin(this.actT * 9);
      aR.rotation.set(-(2.5 + (this.kind === 'robot' ? Math.sign(sw) * 0.3 : sw * 0.35)) * k, 0, 0.2 * k);
      rig.position.y += Math.abs(Math.sin(this.actT * 5)) * 0.14 * k;
      h.rotation.x += -0.12 * k;
    }
  }

  /** The bear: drums on its tummy drum (slow at rest, a roll when it celebrates), swaying, stomping, spinning. */
  private poseBear(t: number, dance: boolean): void {
    const { rig, torso, head: h, armL: aL, armR: aR, legL: lL, legR: lR } = this;
    const bps = dance ? 5.2 : 1.7;
    const ph = t * bps;
    const b = Math.floor(ph);
    const f = ph - b;
    // A stick comes down on the beat: raised between hits, snapped onto the skin as the beat lands.
    const hitArm = b % 2 ? aL : aR;
    const restArm = b % 2 ? aR : aL;
    const up = dance ? 1.45 : 1.2;
    const down = 0.62;
    hitArm.rotation.z = f < 0.22 ? down + (up - down) * (f / 0.22) : up - (up - down) * Math.max(0, (f - 0.62) / 0.38) ** 2;
    restArm.rotation.z = up - (up - down) * 0.25;
    if (this.live && this.act !== 'wave' && b !== this.beat) {
      this.beat = b;
      // (At rest, a note on every other beat only: the touchline stays calm.)
      if (dance || b % 2 === 0) this.onFx?.('drum', 0.95, 4 * MV + 4.2 * MV + 0.29, 0);
    }
    const sway = Math.sin(t * bps * Math.PI);
    rig.rotation.x = sway * (dance ? 0.1 : 0.05);
    h.rotation.x = -sway * 0.12;
    h.rotation.z = Math.abs(sway) * (dance ? 0.16 : 0.06);
    lL.rotation.z = Math.max(0, sway) * (dance ? 0.7 : 0.18);
    lR.rotation.z = Math.max(0, -sway) * (dance ? 0.7 : 0.18);
    rig.position.y += Math.abs(sway) * (dance ? 0.34 : 0.05);
    if (dance) {
      torso.rotation.z = 0.1;
      // A full spin every 2.4 s.
      const spin = (t % 2.4) / 2.4;
      if (spin > 0.72) this.group.rotation.y += ((spin - 0.72) / 0.28) * TAU;
    }
  }

  /** The robot: stiff, everything in steps. At rest its head scans and an arm ticks; when it celebrates, the robot. */
  private poseRobot(t: number, dance: boolean): void {
    const { rig, torso, head: h, armL: aL, armR: aR, legL: lL, legR: lR } = this;
    if (!dance) {
      const step = Math.floor(t / 0.9) % 4;
      h.rotation.y = [0.55, 0, -0.55, 0][step];
      const tick = Math.floor(t / 0.45) % 8;
      aR.rotation.z = tick < 2 ? 0.8 : tick < 4 ? 1.57 : 0;
      aL.rotation.z = tick >= 4 && tick < 6 ? 0.8 : 0;
      rig.position.y += tick % 2 ? 0.03 : 0;
      return;
    }
    const b = Math.floor(t / 0.34);
    const f = t / 0.34 - b;
    const p = ROBOT_POSES[b % ROBOT_POSES.length];
    const q = ROBOT_POSES[(b + ROBOT_POSES.length - 1) % ROBOT_POSES.length];
    // Each pose snaps in over the first fifth of the beat, then holds dead still.
    const k = Math.min(1, f / 0.2);
    const mix = (i: number) => q[i] + (p[i] - q[i]) * k;
    aL.rotation.set(mix(2), 0, mix(0));
    aR.rotation.set(-mix(3), 0, mix(1));
    torso.rotation.y = mix(4);
    h.rotation.x = mix(5);
    h.rotation.y = -mix(4) * 0.8;
    rig.position.z = mix(6);
    lL.rotation.z = b % 2 ? 0.45 * (1 - k) : 0.45 * k;
    lR.rotation.z = b % 2 ? 0.45 * k : 0.45 * (1 - k);
    rig.position.y += k < 1 ? 0.08 * (1 - k) : 0;
    if (this.live && b !== this.beat) {
      this.beat = b;
      if (b % 2 === 0) {
        this.onFx?.('spark', 0.6, 0.29 + 12 * MV - 5 * MV, -7.2 * MV);
        this.onFx?.('spark', 0.6, 0.29 + 12 * MV - 5 * MV, 7.2 * MV);
      }
    }
  }

  /** The dragon: wings and tail always moving. Celebrating, it rears up and breathes fire into the air, three times. */
  private poseDragon(t: number, dance: boolean): void {
    const { rig, torso, head: h, armL: aL, armR: aR, legL: lL, legR: lR } = this;
    const flap = dance ? Math.sin(t * 13) : Math.sin(t * 2.6);
    for (const w of this.wings) w.rotation.x = Math.sign(w.position.z) * (dance ? 0.95 + flap * 0.45 : 0.4 + flap * 0.22);
    if (this.tail) this.tail.rotation.y = Math.sin(t * (dance ? 7 : 1.8)) * (dance ? 0.8 : 0.45);
    if (!dance) {
      h.rotation.y = Math.sin(t * 0.8) * 0.45;
      h.rotation.z = Math.sin(t * 1.6) * 0.07;
      rig.position.y += Math.abs(Math.sin(t * 1.6)) * 0.05;
      const shift = Math.sin(t * 1.6);
      lL.rotation.z = Math.max(0, shift) * 0.14;
      lR.rotation.z = Math.max(0, -shift) * 0.14;
      aL.rotation.z = 0.25 + shift * 0.1;
      aR.rotation.z = 0.25 - shift * 0.1;
      return;
    }
    // A breath every 2.2 s: 0.35 s of rearing back, 0.7 s of fire, then hops in between (the first at fireAt).
    const tt = t - (this.fireAt - 0.35);
    const c = tt < 0 ? 2 : tt % 2.2;
    const b = tt < 0 ? -1 : Math.floor(tt / 2.2);
    const rear = c < 0.35 ? c / 0.35 : c < 1.15 ? 1 : Math.max(0, 1 - (c - 1.15) / 0.3);
    torso.rotation.z = 0.32 * rear;
    h.rotation.z = 0.85 * rear;
    aL.rotation.set(1.1 * rear + 0.3, 0, 0.6);
    aR.rotation.set(-1.1 * rear - 0.3, 0, 0.6);
    if (rear < 1) {
      const hop = Math.abs(Math.sin(t * 7));
      rig.position.y += hop * 0.4 * (1 - rear);
      lL.rotation.z = Math.max(0, Math.sin(t * 7)) * 0.6 * (1 - rear);
      lR.rotation.z = Math.max(0, -Math.sin(t * 7)) * 0.6 * (1 - rear);
    }
    if (this.live && c >= 0.35 && b !== this.beat) {
      this.beat = b;
      // Out of the snout, with the head thrown back.
      this.onFx?.('fire', 0.75, 0.29 + 13 * MV + 1.35, 0);
    }
  }
}

// ------------------------------------------------------------------ the decor

/** One searchlight (an additive cone from a lamp head) pointing up into the sky, and where it sways. */
interface Beam {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  hx: number;
  hy: number;
  hz: number;
  phase: number;
}

/**
 * The mascot's place: on the near touchline beside the home dugout. At rest it faces the main stand and the broadcast
 * lens; to celebrate it turns to the pitch, and the cutaway films it from the pitch with the home fans behind it.
 */
const MASCOT_X = -15.2;
const MASCOT_Z = HALF_W + 1.9;
/**
 * The cutaway: how long it holds (under a second: the scorer's close-up has the lens before it and gets it back after,
 * or the replay takes over as it ends), and how far back on the pitch the lens stands.
 */
const CUT_S = 0.9;
const CUT_BACK = 13;

export class StadiumDecor {
  /** Everything added to the stadium's own groups, so it goes with them (and their dispose). */
  private readonly own: THREE.Object3D[] = [];
  private readonly mats: THREE.Material[] = [];
  private readonly texs: THREE.Texture[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  private night = false;
  /** Seconds left of the post-goal / kick-off party (the lights run fast, the tifo waves hard, the cards go up). */
  private partyT = 0;
  private kickDue = -1;
  private mascot: Mascot | null = null;
  private beams: Beam[] = [];
  private halos: THREE.Sprite[] = [];
  /** The LED strip's three phases (a chase), the lit seat blocks and the spots on the stand (the light show). */
  private leds: THREE.MeshBasicMaterial[] = [];
  private blocks: THREE.Mesh[] = [];
  private spots: THREE.Mesh[] = [];
  private flags: THREE.Mesh[] = [];
  private glowNets: THREE.MeshBasicMaterial[] = [];
  private fireFlags = false;
  private tifo: { mesh: THREE.Mesh; base: Float32Array; unroll: number } | null = null;
  private surfer: { mesh: THREE.Mesh; base: Float32Array; side: 'far' | 'left'; reach: number; d: number; h: number } | null = null;
  private wave: { mesh: THREE.InstancedMesh; spots: Float32Array; n: number } | null = null;
  /** The card mosaic: each card's place (x, y, z) and the delay of its wave (s), how far up they are (0..1). */
  private cards: { mesh: THREE.InstancedMesh; at: Float32Array; n: number; up: number; shown: number } | null = null;
  /** The big screen's GOAL graphic: two frames it flashes between, and how long it has left. */
  private screen: { mesh: THREE.Mesh; tex: THREE.CanvasTexture; t: number } | null = null;
  /** The mascot cutaway: seconds until it starts (negative: none due), and seconds of it left. */
  private cutDue = -1;
  private cutLeft = 0;
  /** Our own shows (never the kit's three slots: a SHOP goal explosion is not cut short by the stadium's). */
  private readonly shows: Show[] = [new Show(), new Show(), new Show(), new Show()];
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);
  private readonly c = new THREE.Color();
  private readonly target = new THREE.Vector3();
  private readonly kitFx: boolean;
  private readonly pal: number[];
  private readonly crest: CrestDesign;
  /** The far stand's roof (m): the rockets leave from it. 0 on a ground with no stand. */
  private readonly roofY: number;
  /** Cut to the mascot by itself a moment after your goal (set false to trigger mascotCutaway yourself). */
  autoCutaway = true;

  /**
   * Dress the ground. `fx` (the match's effects kit) draws the shows; `camera` is the match's lens (the mascot
   * cutaway takes it for a second: leave it out and there is no cutaway).
   */
  constructor(readonly a: DecorAnchors, readonly style: DecorStyle, private readonly fx: FxKit | null, private readonly camera: THREE.PerspectiveCamera | null = null) {
    const sl = style.slots;
    this.crest = crestOfStyle(style);
    this.pal = [style.shirt, style.shirt2, 0xffd23a, WHITE];
    const far = a.far;
    this.roofY = far ? this.standTop(far) + 4 + (a.level >= 5 ? 2.9 : 0) : 0;
    if (sl.pitch) this.buildPitch(sl.pitch);
    if (sl.net) this.buildNets(sl.net);
    if (sl.flags) this.buildFlags(sl.flags);
    if (sl.seats) this.buildSeats();
    if (sl.tifo === 'tifobig') {
      this.buildTifo();
      this.buildCards();
    } else if (sl.tifo === 'tifoflags') {
      this.buildFlagWave();
      this.buildSurfer();
    }
    if (sl.lights) this.buildLights(sl.lights === 'lightshow');
    if (sl.lights === 'lightshow') this.buildScreen();
    if (sl.mascot) {
      const kind = mascotKind(sl.mascot);
      this.mascot = new Mascot(kind, style.shirt, style.shirt2, MASCOT_X, MASCOT_Z, -Math.PI / 2, Math.PI / 2);
      this.mascot.onFx = (what, x, y, z) => this.mascotFx(what, x, y, z);
      this.add(this.a.pitch, this.mascot.group);
    }
    this.kitFx = !!(sl.flags === 'flagfire' || sl.mascot);
  }

  private add(parent: THREE.Object3D, o: THREE.Object3D): void {
    parent.add(o);
    this.own.push(o);
  }

  /** The top row's height of a stand. */
  private standTop(s: StandRows): number {
    const { stepH } = this.a;
    return s.t2 > 0 ? 0.9 + s.t1 * stepH + 2.4 + (s.t2 - 1) * stepH * 1.25 : 0.9 + (s.t1 - 1) * stepH;
  }

  // ------------------------------------------------------------------ pitch

  private buildPitch(id: string): void {
    let geo: THREE.BufferGeometry;
    if (id === 'mowcrest') geo = crestLawnGeometry(this.crest, this.style.short.slice(0, 3), this.style.name ?? '');
    else geo = sheet(-(HALF_L + 2), HALF_L + 2, -(HALF_W + 2), HALF_W + 2, id === 'mowchecks' ? 0.75 : 0.5, 0.008, (x, z) => mowColor(id, x, z));
    this.geos.push(geo);
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
      // (Neon nets glow at night: additive in the dark, their own bright colours by day, when adding light to a
      // sunlit stand only washes them out.)
      const mat = new THREE.MeshBasicMaterial({ vertexColors: true, alphaMap: alpha, transparent: true, depthWrite: false, side: THREE.DoubleSide });
      this.mats.push(mat);
      if (glow) this.glowNets.push(mat);
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
    this.geos.push(flagGeo, poleGeo);
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
    const { shirt, shirt2 } = this.style;
    const far = this.a.far;
    if (!far) {
      // No stand: giant voxel letters on the far bank behind the fence (0.95 m blocks) on a low plinth in the second
      // colour, so they read as a sign and not as blocks left on the grass.
      const b = new BoxBuilder();
      const px = 0.95;
      const x0 = -(cols * px) / 2;
      const z = -(this.a.boardZ + 4.5);
      b.box(0, 0.12, z, cols * px + 1.2, 0.24, px + 0.8, shirt2, { top: shade(shirt2, 1.1) });
      for (let r = 0; r < 5; r++) for (let c = 0; c < cols; c++) {
        if (!bits[r][c]) continue;
        b.box(x0 + c * px + px / 2, (4 - r) * px + px / 2 + 0.24, z, px * 0.96, px * 0.96, px, shirt, { top: shade(shirt, 1.15) });
      }
      const m = new THREE.Mesh(b.build(), voxelMaterial);
      m.castShadow = true;
      this.geos.push(m.geometry);
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
    const mesh = new THREE.Mesh(b.build(), voxelMaterial);
    this.geos.push(mesh.geometry);
    this.add(this.a.group, mesh);
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
    const tex = tifoTexture(this.style.shirt, this.style.shirt2, this.style.short, this.crest, this.style.name ?? '');
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
    this.geos.push(geo);
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

  /**
   * The card mosaic: every fan in the far stand's upper tier holds a card up at kick off and after your goals, the
   * whole tier turning to diagonal club stripes with the short name across the middle. A ground with no upper tier
   * has only the banner.
   */
  private buildCards(): void {
    const far = this.a.far;
    if (!far || far.t2 < 6) return;
    const { stepD, stepH } = this.a;
    const { shirt, shirt2 } = this.style;
    const seat = 0.86;
    const d0 = far.t1 * stepD + 1.7;
    const h0 = 0.9 + far.t1 * stepH + 2.4;
    const rows = Math.min(far.t2, 10);
    const perRow = Math.floor(((far.span - 3) * 2) / seat);
    const n = rows * perRow;
    const bits = nameBitmap(this.style.short.slice(0, 3));
    // (The name two seats a pixel, on the top ten rows' middle: 5 rows of letters, each two rows of cards tall.)
    const bw = bits[0].length * 2;
    const bx0 = Math.floor((perRow - bw) / 2);
    const geo = new THREE.PlaneGeometry(seat * 0.92, 0.62);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    this.geos.push(geo);
    this.mats.push(mat);
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.frustumCulled = false;
    const at = new Float32Array(n * 4);
    let i = 0;
    for (let j = 0; j < rows; j++) {
      for (let c = 0; c < perRow; c++, i++) {
        const x = -(perRow * seat) / 2 + (c + 0.5) * seat;
        at[i * 4] = x;
        at[i * 4 + 1] = h0 + j * stepH * 1.25 + 1.75;
        at[i * 4 + 2] = -(this.a.standZ + d0 + j * stepD * 1.05 + stepD * 0.5);
        // The wave runs out from the halfway line.
        at[i * 4 + 3] = Math.abs(x) / 55 + j * 0.03;
        const lr = rows >= 10 ? Math.floor((rows - 1 - j) / 2) : -1;
        const lc = Math.floor((c - bx0) / 2);
        const inName = lr >= 0 && lr < 5 && c >= bx0 - 2 && c < bx0 + bw + 2;
        const letter = inName && lc >= 0 && lc < bits[0].length && bits[lr][lc];
        const stripe = Math.floor((c + j * 2) / 6) % 2;
        mesh.setColorAt(i, this.c.setHex(letter ? WHITE : inName ? shirt : stripe ? shirt2 : shirt));
        mesh.setMatrixAt(i, this.m4.makeScale(0, 0, 0));
      }
    }
    this.cards = { mesh, at, n, up: 0, shown: -1 };
    this.add(this.a.group, mesh);
  }

  /** The cards up to `up` (0 all down .. 1 all up, a wave out from the middle), bobbing a little while they are held. */
  private updateCards(dt: number, time: number): void {
    const cd = this.cards;
    if (!cd) return;
    const want = this.partyT > 0 ? 1 : 0;
    if (cd.up !== want) cd.up = want > cd.up ? Math.min(1, cd.up + dt / 1.8) : Math.max(0, cd.up - dt / 1.2);
    // (All down and already hidden: nothing to write.)
    if (cd.up === 0 && cd.shown === 0) return;
    cd.shown = cd.up;
    this.e.set(-0.5, 0, 0);
    this.q.setFromEuler(this.e);
    for (let i = 0; i < cd.n; i++) {
      const k = i * 4;
      // Each card comes up 0.25 s after the wave reaches it.
      const rise = Math.max(0, Math.min(1, (cd.up * 1.8 - cd.at[k + 3]) / 0.25));
      const sc = rise * rise * (3 - 2 * rise);
      this.s.set(sc, sc, sc);
      this.m4.compose(this.v.set(cd.at[k], cd.at[k + 1] - (1 - sc) * 0.7 + Math.sin(time * 2.2 + cd.at[k] * 0.35) * 0.05 * sc, cd.at[k + 2]), this.q, this.s);
      cd.mesh.setMatrixAt(i, this.m4);
    }
    this.s.set(1, 1, 1);
    cd.mesh.instanceMatrix.needsUpdate = true;
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
    this.geos.push(geo);
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

  /**
   * The flag surfer: one giant club flag passed over the fans' heads, along the home end where the ground has one,
   * else along the main stand. A ground with no stand has none (the flag wavers line the fence).
   */
  private buildSurfer(): void {
    const left = this.a.left;
    const far = this.a.far;
    const stand = left && this.a.standX ? left : far;
    if (!stand) return;
    const side: 'far' | 'left' = stand === left ? 'left' : 'far';
    const { stepD, stepH } = this.a;
    const rows = Math.min(stand.t1, 9);
    // As deep as the rows it lies on (a small stand gets a smaller flag).
    const H = Math.min(8.2, Math.hypot(rows * stepD, rows * stepH) - 0.6);
    const W = H * 1.6;
    const tex = flagTexture(this.style.shirt, this.style.shirt2, this.style.short, this.crest, this.style.name ?? '');
    const mat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
    const geo = new THREE.PlaneGeometry(W, H, 12, 6);
    this.texs.push(tex);
    this.mats.push(mat);
    this.geos.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    // Lying on the rake, lifted over the fans' heads; on the home end the cloth is turned to run along z.
    const rake = Math.atan2(stepH, stepD);
    mesh.rotation.order = 'YXZ';
    mesh.rotation.set(rake - Math.PI / 2, side === 'left' ? Math.PI / 2 : 0, 0);
    const mid = (rows - 1) / 2;
    this.surfer = { mesh, base: Float32Array.from(geo.getAttribute('position').array as Float32Array), side, reach: Math.max(0, stand.span - W / 2 - 3), d: mid * stepD + 0.4, h: 0.9 + mid * stepH + 1.9 };
    this.add(this.a.group, mesh);
  }

  // ------------------------------------------------------------------ lights

  /**
   * CLUB FLOODLIGHTS: an LED strip round the pitch on top of the ad boards, the lamps haloed in club colours at night
   * and a searchlight from each into the sky. The LIGHT SHOW runs every colour, chases the strip, sweeps spotlights
   * along the far stand and lights its seats in blocks. No light is ever thrown on the grass.
   */
  private buildLights(show: boolean): void {
    let heads = this.a.lamps;
    if (!heads.length) {
      // No floodlights by day on a small ground: four slim LED pylons at the corners carry the searchlights.
      const pylons = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ x: sx * (HALF_L + 7), z: sz * (HALF_W + 6), h: 10 })));
      const b = new BoxBuilder();
      for (const p of pylons) {
        b.box(p.x, p.h / 2, p.z, 0.4, p.h, 0.4, 0x3a3f48);
        b.box(p.x, p.h, p.z, 1.6, 0.5, 1.6, INK);
      }
      const m = new THREE.Mesh(b.build(), voxelMaterial);
      m.castShadow = true;
      this.geos.push(m.geometry);
      this.add(this.a.group, m);
      heads = pylons.map((p) => ({ ...p, h: p.h + 0.4 }));
    }
    // The LED strip: three phases of segments (a chase), on the far boards and behind both goals.
    const bz = this.a.boardZ;
    const bx = HALF_L + 4.6;
    const led = [0, 1, 2].map(() => new BoxBuilder());
    const seg = 3;
    let k = 0;
    for (let x = -(HALF_L + 2); x < HALF_L + 2 - 1e-3; x += seg, k++) led[k % 3].box(x + seg / 2, 1.2, -bz, seg - 0.2, 0.28, 0.24, WHITE);
    for (const sx of [-1, 1]) for (let z = -(HALF_W + 2); z < HALF_W + 2 - 1e-3; z += seg, k++) led[k % 3].box(sx * bx, 1.2, z + seg / 2, 0.24, 0.28, seg - 0.2, WHITE);
    for (const b of led) {
      const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
      const mesh = new THREE.Mesh(b.build(), mat);
      this.mats.push(mat);
      this.geos.push(mesh.geometry);
      this.leds.push(mat);
      this.add(this.a.group, mesh);
    }
    // The searchlight: a cone 1 m long from its apex along +z, bright at the lamp and fading out into the sky.
    const cone = new THREE.ConeGeometry(0.085, 1, 12, 1, true);
    cone.rotateX(-Math.PI / 2);
    cone.translate(0, 0, 0.5);
    const pos = cone.getAttribute('position');
    const col = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getZ(i);
      col[i * 4] = col[i * 4 + 1] = col[i * 4 + 2] = 1;
      col[i * 4 + 3] = Math.max(0, 1 - t) ** 1.6;
    }
    cone.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    this.geos.push(cone);
    let n = 0;
    for (const h of heads) {
      const mat = new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      });
      this.mats.push(mat);
      const mesh = new THREE.Mesh(cone, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 4;
      this.beams.push({ mesh, mat, hx: h.x, hy: h.h, hz: h.z, phase: n++ * 1.7 });
      this.add(this.a.group, mesh);
      // A coloured halo round the lamp (it shows at night).
      const halo = new THREE.Sprite(this.haloMat());
      halo.position.set(h.x, h.h, h.z);
      halo.scale.set(14, 14, 1);
      halo.visible = false;
      this.halos.push(halo);
      this.add(this.a.group, halo);
    }
    const far = this.a.far;
    if (!show || !far) return;
    // The light show on the far stand's lower tier: lit seat blocks and four spots sweeping along it, all lying on
    // the stand's rake a little over the fans' heads.
    const { stepD, stepH } = this.a;
    const rows = Math.min(far.t1, 10);
    const rake = Math.atan2(stepH, stepD);
    const depth = Math.hypot(rows * stepD, rows * stepH);
    const midD = ((rows - 1) / 2) * stepD;
    const midH = 0.9 + ((rows - 1) / 2) * stepH + 1.35;
    const blockW = (far.span * 2 - 4) / Math.max(4, Math.round((far.span * 2 - 4) / 12));
    const blockGeo = new THREE.PlaneGeometry(blockW - 0.8, depth);
    this.geos.push(blockGeo);
    for (let x = -far.span + 2 + blockW / 2; x < far.span - 2; x += blockW) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0 });
      this.mats.push(mat);
      const m = new THREE.Mesh(blockGeo, mat);
      m.position.set(x, midH, -(this.a.standZ + midD));
      m.rotation.x = rake - Math.PI / 2;
      m.renderOrder = 3;
      this.blocks.push(m);
      this.add(this.a.group, m);
    }
    const spotGeo = new THREE.CircleGeometry(1, 24);
    this.geos.push(spotGeo);
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.MeshBasicMaterial({ map: this.softTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      this.mats.push(mat);
      const m = new THREE.Mesh(spotGeo, mat);
      m.position.set(0, midH + 0.15, -(this.a.standZ + midD));
      m.rotation.x = rake - Math.PI / 2;
      m.scale.set(depth * 0.62, depth * 0.5, 1);
      m.renderOrder = 4;
      this.spots.push(m);
      this.add(this.a.group, m);
    }
  }

  private haloTex: THREE.CanvasTexture | null = null;
  /** A soft round light (the lamp halos and the spots on the stand). */
  private softTex(): THREE.CanvasTexture {
    if (!this.haloTex) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d')!;
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      this.haloTex = new THREE.CanvasTexture(c);
      this.texs.push(this.haloTex);
    }
    return this.haloTex;
  }

  private haloMat(): THREE.SpriteMaterial {
    const m = new THREE.SpriteMaterial({ map: this.softTex(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
    this.mats.push(m);
    return m;
  }

  private readonly hsl = { h: 0, s: 0, l: 0 };
  /** A light's colour now: club colours (lifted so a navy or black club's lights still shine), or the show's rainbow. */
  private lightColor(i: number, time: number): THREE.Color {
    if (this.style.slots.lights === 'lightshow') return this.c.setHSL((time * 0.1 + i * 0.17) % 1, 0.95, 0.58);
    this.c.setHex(i % 2 ? this.style.shirt2 : this.style.shirt).getHSL(this.hsl);
    return this.hsl.l < 0.5 ? this.c.setHSL(this.hsl.h, Math.max(this.hsl.s, 0.75), 0.55) : this.c;
  }

  private updateLights(time: number): void {
    const party = this.partyT > 0;
    const show = this.style.slots.lights === 'lightshow';
    // The LED strip: a chase (the show's runs every colour; a goal makes it race).
    const speed = party ? 7 : show ? 2.2 : 0.9;
    for (let i = 0; i < this.leds.length; i++) {
      const pulse = 0.55 + 0.45 * Math.sin(time * speed - (i * TAU) / 3);
      this.lightColor(i, time);
      this.leds[i].color.copy(this.c).multiplyScalar(0.5 + 0.5 * pulse);
    }
    // Searchlights: each sways about a line up and out from the pitch, so no beam ever crosses the grass.
    const op = this.night ? (party ? 0.42 : 0.24) : party ? 0.1 : 0.05;
    const sway = party ? 1.5 : show ? 0.55 : 0.3;
    for (let i = 0; i < this.beams.length; i++) {
      const b = this.beams[i];
      const out = Math.atan2(b.hz, b.hx);
      const ph = b.phase + time * sway;
      const az = out + Math.sin(ph) * 0.75;
      const el = 0.95 + Math.sin(ph * 0.7 + 1) * 0.3;
      this.target.set(b.hx + Math.cos(az) * Math.cos(el) * 60, b.hy + Math.sin(el) * 60, b.hz + Math.sin(az) * Math.cos(el) * 60);
      b.mesh.position.set(b.hx, b.hy, b.hz);
      b.mesh.lookAt(this.target);
      b.mesh.scale.set(70, 70, 64);
      b.mat.color.copy(this.lightColor(i, time));
      b.mat.opacity = op;
    }
    for (let i = 0; i < this.halos.length; i++) {
      const m = this.halos[i].material as THREE.SpriteMaterial;
      m.color.copy(this.lightColor(i, time));
      m.opacity = party ? 1 : 0.8;
    }
    // The light show: seat blocks lit in a chase, spots sweeping the stand.
    const blockOp = this.night ? (party ? 0.5 : 0.3) : party ? 0.2 : 0.11;
    for (let i = 0; i < this.blocks.length; i++) {
      const m = this.blocks[i].material as THREE.MeshBasicMaterial;
      const on = 0.5 + 0.5 * Math.sin(time * (party ? 6 : 1.6) - i * 0.9);
      m.color.copy(this.lightColor(i, time));
      m.opacity = blockOp * on * on;
    }
    const far = this.a.far;
    const reach = far ? far.span - 7 : 0;
    for (let i = 0; i < this.spots.length; i++) {
      const sp = this.spots[i];
      sp.position.x = Math.sin(time * (party ? 1.7 : 0.5) + i * 1.9) * reach;
      const m = sp.material as THREE.MeshBasicMaterial;
      m.color.copy(this.lightColor(i + 2, time));
      m.opacity = this.night ? (party ? 0.85 : 0.6) : party ? 0.4 : 0.26;
    }
  }

  // ------------------------------------------------------------------ the big screen's GOAL graphic (the light show)

  /** A second face just in front of the big screen: your crest and GOAL!, flashed when you score. Needs a screen. */
  private buildScreen(): void {
    const sc = this.a.screen;
    if (!sc) return;
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 320;
    const g = c.getContext('2d')!;
    const { shirt, shirt2, short } = this.style;
    // Two frames stacked: the club colours one way, then the other, the crest and GOAL! on both.
    for (let f = 0; f < 2; f++) {
      const y0 = f * 160;
      g.fillStyle = cssHex(f ? shirt2 : shirt);
      g.fillRect(0, y0, 512, 160);
      g.fillStyle = cssHex(f ? shirt : shirt2);
      for (let i = -2; i < 14; i++) {
        g.beginPath();
        g.moveTo(i * 48 + (f ? 24 : 0), y0);
        g.lineTo(i * 48 + 20 + (f ? 24 : 0), y0);
        g.lineTo(i * 48 - 28 + (f ? 24 : 0), y0 + 160);
        g.lineTo(i * 48 - 48 + (f ? 24 : 0), y0 + 160);
        g.fill();
      }
      g.fillStyle = '#15151b';
      g.fillRect(150, y0 + 22, 344, 116);
      g.fillStyle = '#fbfbf4';
      g.fillRect(18, y0 + 4, 120, 152);
      drawCrest(g, this.crest, short.slice(0, 3), this.style.name ?? '', 78 - (CREST_W * 5) / 2, y0 + 5, 5);
      g.fillStyle = f ? '#ffd23a' : '#fbfbf4';
      g.font = '700 82px "Silkscreen", "Lilita One", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('GOAL!', 322, y0 + 84);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.repeat.set(1, 0.5);
    const mat = new THREE.MeshBasicMaterial({ map: tex, fog: false });
    const geo = new THREE.PlaneGeometry(sc.w, sc.h);
    this.texs.push(tex);
    this.mats.push(mat);
    this.geos.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(sc.x - 0.06, sc.y, sc.z);
    mesh.rotation.y = -Math.PI / 2;
    mesh.visible = false;
    this.screen = { mesh, tex, t: 0 };
    this.add(this.a.group, mesh);
  }

  // ------------------------------------------------------------------ shows and the mascot's effects

  /** Run one of our shows at (x, y, z) facing (fx, fz) (see render/fx/stadiumFx.ts for the frames). */
  private play(def: StadiumShowDef | undefined, x: number, y: number, z: number, fx: number, fz: number, pal: readonly number[], bw = 0): void {
    if (!def || !this.fx) return;
    let s = this.shows.find((q) => !q.on);
    if (!s) s = this.shows.reduce((a, q) => (q.t > a.t ? q : a));
    s.on = true;
    s.run = def.run;
    s.t = 0;
    s.dur = def.dur;
    s.x = x; s.y = y; s.z = z;
    s.fx = fx; s.fz = fz;
    s.k = def.k;
    s.pal = pal;
    s.bw = bw;
    s.acc.fill(0);
    s.v.fill(0);
  }

  private stepShows(dt: number): void {
    const K = this.fx;
    if (!K) return;
    for (const s of this.shows) {
      if (!s.on) continue;
      const a = s.t === 0 ? -1e-6 : s.t;
      // (Its t = 0 beats fire on its first frame even when the game is held for a moment.)
      if (s.t > 0 && dt <= 0) continue;
      s.t += Math.max(dt, 1e-4);
      K.setFrame(s.x, s.y, s.z, s.fx, s.fz, s.k);
      s.run?.(K, s, a, s.t, dt);
      if (s.t >= s.dur) s.on = false;
    }
  }

  /** The mascot's drum beat, sparks or fire, at a point in its own space (it stands on the pitch group). */
  private mascotFx(what: 'drum' | 'spark' | 'fire', x: number, y: number, z: number): void {
    const m = this.mascot;
    if (!m) return;
    const yaw = m.group.rotation.y;
    const fx = Math.cos(yaw), fz = -Math.sin(yaw);
    const g = m.group.position;
    const wx = g.x + fx * x - fz * z;
    const wz = g.z + fz * x + fx * z;
    const wy = this.a.pitch.position.y + y;
    this.play(what === 'fire' ? DRAGON_BREATH : what === 'drum' ? BEAR_DRUM : ROBOT_SPARK, wx, wy, wz, fx, fz, this.pal);
  }

  // ------------------------------------------------------------------ the frame

  setTimeOfDay(t: 'day' | 'sunset' | 'night'): void {
    this.night = t === 'night';
    for (const h of this.halos) h.visible = this.night;
    for (const m of this.glowNets) {
      m.blending = this.night ? THREE.AdditiveBlending : THREE.NormalBlending;
      m.needsUpdate = true;
    }
  }

  /** The walkout: the kick-off show, the tifo unrolling, the cards going up, the mascot's wave (once a match). */
  kickoff(): void {
    if (this.kickDue === -2) return;
    this.kickDue = -2;
    this.partyT = Math.max(this.partyT, 6);
    if (this.tifo) this.tifo.unroll = 0;
    this.mascot?.wave();
    this.play(KICKOFF_SHOWS[this.style.slots.kickoff ?? ''], 0, 0, 0, 1, 0, this.pal, this.roofY);
  }

  /** Kick off by itself `s` seconds from now (no intro to wait for). */
  kickoffIn(s: number): void {
    if (this.kickDue !== -2) this.kickDue = s;
  }

  /**
   * Your goal, in the goal at x `gx` (leave it out and only the party starts): the show behind that goal, the lights
   * racing, the flags, tifo and cards up, the big screen's GOAL graphic, the mascot's celebration and, `cutAt` s from
   * now, the short cutaway to it (negative: no cutaway; see mascotCutaway). The match passes a second into the scorer's
   * close-up: the scorer has the lens first, the mascot for CUT_S, then the scorer again or the replay.
   */
  goal(gx?: number, cutAt = 1.7): void {
    this.partyT = 7;
    if (gx !== undefined && gx !== 0) this.play(GOAL_SHOWS[this.style.slots.kickoff ?? ''], Math.sign(gx) * HALF_L, 0, 0, -Math.sign(gx), 0, this.pal, this.roofY);
    if (this.screen) this.screen.t = 6;
    if (this.mascot) {
      const cut = this.autoCutaway && cutAt >= 0;
      // (The dragon's first breath lands a moment into the cutaway.)
      this.mascot.dance(7, cut ? cutAt + 0.2 : 0.35);
      if (cut) this.mascotCutaway(cutAt);
    }
  }

  /** Half time: the mascot's show for the crowd (the same act as its celebration, a little longer). */
  halfTime(): void {
    this.mascot?.dance(8);
    this.partyT = Math.max(this.partyT, 4);
  }

  /** Full time: when you have won, the fireworks and club-colour smoke go up and the mascot celebrates. */
  fullTime(won: boolean): void {
    if (!won) return;
    this.partyT = 8;
    this.play(WIN_SHOWS[this.style.slots.kickoff ?? ''], 0, 0, 0, 1, 0, this.pal, this.roofY);
    this.mascot?.dance(8);
  }

  /**
   * Cut to the mascot for `dur` s (a second at most), `delay` s from now. It needs a mascot worn and on show, and the
   * lens given to the constructor; false when there is none (nothing is cut to). The cut holds only while update() is
   * told it may (`cutOk`: the scorer's celebration, never a replay, a scripted celebration or play itself), and the
   * match's own camera carries on underneath it, so the hand-back is a plain cut to wherever that camera is.
   */
  mascotCutaway(delay = 0, dur = CUT_S): boolean {
    if (!this.canCut()) return false;
    this.cutDue = Math.max(0, delay);
    this.cutLeft = Math.min(1, dur);
    return true;
  }

  /**
   * Is there a mascot to cut to, in plain view of the cutaway's lens? The lens stands on the pitch, CUT_BACK m in
   * front of the mascot (which turns to face it), looking out at the touchline: the mascot, the dugout and the home
   * fans. It is never put behind an ad board or inside a stand, and never used without a mascot on show.
   */
  private canCut(): boolean {
    const m = this.mascot;
    if (!m || !this.camera || !m.group.visible || !m.group.parent) return false;
    const g = m.group.position;
    // (On the grass, inside the touchlines: clear of the boards, the dugouts and the stands.)
    return Math.abs(g.x + 1.2) < HALF_L && g.z - CUT_BACK > -HALF_W && g.z - CUT_BACK < HALF_W;
  }

  /** Is the lens on the mascot this frame? (The session can hold its own cuts while it is.) */
  get cutting(): boolean {
    return this.cutDue === 0 && this.cutLeft > 0;
  }

  /**
   * One frame. `cutOk`: the mascot cutaway may take the lens now (the goal celebration, not a replay); when it is not,
   * a cutaway that is due or running is dropped.
   */
  update(dt: number, time: number, cutOk = true): void {
    if (this.kickDue >= 0) {
      this.kickDue -= dt;
      if (this.kickDue < 0) this.kickoff();
    }
    if (this.partyT > 0) this.partyT = Math.max(0, this.partyT - dt);
    if (this.kitFx) tickKitFx();
    this.mascot?.update(dt, time);
    this.stepShows(dt);
    for (let i = 0; i < this.flags.length; i++) {
      const f = this.flags[i];
      f.rotation.y = Math.sin(time * 3 + i * 1.3) * 0.4;
      if (this.fireFlags) f.scale.y = 1 + Math.sin(time * 13 + i) * 0.08;
    }
    this.updateWave(time);
    this.updateCards(dt, time);
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
    const sf = this.surfer;
    if (sf) {
      // Passed along the stand and back, rippling as the hands under it push it on.
      const along = Math.sin(time * (this.partyT > 0 ? 0.55 : 0.3)) * sf.reach;
      if (sf.side === 'left') sf.mesh.position.set(-((this.a.standX ?? 58.7) + sf.d), sf.h, along);
      else sf.mesh.position.set(along, sf.h, -(this.a.standZ + sf.d));
      const pos = sf.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      const amp = this.partyT > 0 ? 0.5 : 0.3;
      for (let i = 0; i < arr.length; i += 3) arr[i + 2] = sf.base[i + 2] + Math.sin(time * 4 + sf.base[i] * 0.9 + sf.base[i + 1] * 0.6) * amp;
      pos.needsUpdate = true;
    }
    if (this.leds.length) this.updateLights(time);
    const sc = this.screen;
    if (sc) {
      if (sc.t > 0) sc.t = Math.max(0, sc.t - dt);
      sc.mesh.visible = sc.t > 0;
      if (sc.t > 0) sc.tex.offset.y = Math.floor(time * 4) % 2 ? 0.5 : 0;
    }
    this.updateCut(dt, cutOk);
  }

  /** The mascot cutaway: a low shot from the pitch, pushing in a little, the dugout and the home fans behind it. */
  private updateCut(dt: number, cutOk: boolean): void {
    if (this.cutDue < 0) return;
    const cam = this.camera;
    const m = this.mascot;
    if (!cutOk || !cam || !m || !this.canCut()) {
      this.cutDue = -1;
      this.cutLeft = 0;
      return;
    }
    if (this.cutDue > 0) {
      this.cutDue = Math.max(0, this.cutDue - dt);
      if (this.cutDue > 0) return;
    }
    this.cutLeft -= dt;
    if (this.cutLeft <= 0) {
      this.cutDue = -1;
      return;
    }
    const g = m.group.position;
    const y0 = this.a.pitch.position.y;
    const push = 1 - Math.max(0, Math.min(1, this.cutLeft / CUT_S));
    // (The narrower the frame, the further back: the mascot and its fire fit a portrait phone too.)
    const wide = cam.aspect >= 1;
    // (A portrait screen stands further back, but never off the far side of the pitch.)
    const back = Math.min((CUT_BACK - push * 1.5) * (wide ? 1 : 1.5), g.z + HALF_W - 2);
    // (On a wide screen it stands in the left third, clear of the GOAL banner; its fire has the top of the frame.)
    cam.position.set(g.x + 1.2, y0 + 1.7, g.z - back);
    cam.fov = 32;
    cam.updateProjectionMatrix();
    cam.lookAt(g.x - (wide ? 3 : 0), y0 + m.headHeight * 0.95, g.z);
    cam.updateMatrixWorld();
  }

  dispose(): void {
    for (const o of this.own) o.removeFromParent();
    this.mascot?.dispose();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    for (const t of this.texs) t.dispose();
    this.wave?.mesh.dispose();
    this.cards?.mesh.dispose();
  }
}
