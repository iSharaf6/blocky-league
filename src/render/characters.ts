import * as THREE from 'three';
import { clamp, lerp } from '../core/math';
import type { Kit, Look, PlayerDef } from '../sim/types';
import { HAIR, SKIN, shade } from './palette';
import { meshVoxels, voxelMaterial, VoxelGrid } from './voxel';

export const VU = 0.075; // metres per character voxel

// Model space: forward = +x, up = +y, right = +z.
const LEG_H = 7;
const TORSO_H = 7;
const HIP_Y = LEG_H * VU;

// 3x5 pixel digits for shirt numbers, rows top to bottom.
const DIGITS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '011', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
};

const geoCache = new Map<string, THREE.BufferGeometry>();

function cached(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = build();
    geoCache.set(key, g);
  }
  return g;
}

function contrast(hex: number): number {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? 0x26262e : 0xfbfbf4;
}

interface Outfit {
  shirt: number;
  shirt2: number;
  pattern: Kit['pattern'];
  shorts: number;
  socks: number;
  gloves: number | null;
}

function outfitFor(kit: Kit, keeper: boolean): Outfit {
  if (keeper) {
    return { shirt: kit.gk, shirt2: shade(kit.gk, 0.8), pattern: 'plain', shorts: shade(kit.gk, 0.55), socks: kit.gk, gloves: 0xf6f4ec };
  }
  return { shirt: kit.shirt, shirt2: kit.shirt2, pattern: kit.pattern, shorts: kit.shorts, socks: kit.socks, gloves: null };
}

function buildTorso(o: Outfit, number: number): THREE.BufferGeometry {
  const g = new VoxelGrid(4, TORSO_H, 7);
  for (let y = 0; y < TORSO_H; y++) {
    for (let z = 0; z < 7; z++) {
      for (let x = 0; x < 4; x++) {
        let c = o.shirt;
        const sy = y - 2;
        if (y < 2) c = o.shorts;
        else if (o.pattern === 'stripes' && z % 2 === 1) c = o.shirt2;
        else if (o.pattern === 'hoops' && sy % 2 === 1) c = o.shirt2;
        else if (o.pattern === 'halves' && z < 3) c = o.shirt2;
        else if (o.pattern === 'sash' && Math.abs(z - (6 - sy * 1.2)) < 1.1) c = o.shirt2;
        // Collar
        if (y === TORSO_H - 1 && z >= 2 && z <= 4 && x >= 1 && x <= 2) c = shade(o.shirt2, 0.95);
        g.set(x, y, z, c);
      }
    }
  }
  // Waistband
  for (let z = 0; z < 7; z++) for (let x = 0; x < 4; x++) g.set(x, 1, z, shade(o.shorts, 0.86));
  // Shirt number on the back (x = 0), two digits fit exactly in 7 columns.
  const ink = o.pattern === 'plain' || o.pattern === 'sleeves' ? contrast(o.shirt) : 0xfbfbf4;
  const txt = String(number % 100);
  const startZ = txt.length === 1 ? 2 : 0;
  for (let d = 0; d < txt.length; d++) {
    const rows = DIGITS[txt[d]];
    for (let r = 0; r < 5; r++) {
      for (let cI = 0; cI < 3; cI++) {
        if (rows[r][cI] !== '1') continue;
        g.set(0, TORSO_H - 1 - r, startZ + d * 4 + cI, ink);
      }
    }
  }
  // Badge on the left chest, small number on the shorts.
  g.set(3, 5, 1, ink);
  return meshVoxels(g, { scale: VU, pivot: [2, 0, 3.5] });
}

function buildArm(o: Outfit, skin: number): THREE.BufferGeometry {
  const g = new VoxelGrid(2, 6, 2);
  const sleeve = o.pattern === 'sleeves' ? o.shirt2 : o.shirt;
  for (let y = 0; y < 6; y++) {
    let c = y >= 4 ? sleeve : skin;
    if (o.gloves !== null && y <= 1) c = o.gloves;
    g.box(0, y, 0, 2, 1, 2, c);
  }
  if (o.gloves !== null) g.box(0, 3, 0, 2, 3, 2, o.shirt);
  return meshVoxels(g, { scale: VU, pivot: [1, 6, 1] });
}

function buildLeg(o: Outfit, skin: number, boots: number): THREE.BufferGeometry {
  const g = new VoxelGrid(3, LEG_H, 2);
  for (let y = 0; y < LEG_H; y++) {
    let c: number;
    if (y === 0) c = boots;
    else if (y <= 3) c = o.socks;
    else if (y === 4) c = skin;
    else c = o.shorts;
    g.box(0, y, 0, 2, 1, 2, c);
  }
  g.box(2, 0, 0, 1, 1, 2, boots); // toe cap
  g.box(0, 3, 0, 2, 1, 2, shade(o.socks, 0.84)); // sock turn-over
  return meshVoxels(g, { scale: VU, pivot: [1, LEG_H, 1] });
}

function buildHead(look: Look): THREE.BufferGeometry {
  // Skin cube occupies [0..7] in head space; grid is offset so hair can overhang.
  const OX = 2, OZ = 2;
  const g = new VoxelGrid(12, 13, 12);
  const skin = SKIN[look.skin % SKIN.length];
  const hair = HAIR[look.hairColor % HAIR.length];
  const S = (x: number, y: number, z: number, c: number | null) => g.set(x + OX, y, z + OZ, c);
  const B = (x: number, y: number, z: number, sx: number, sy: number, sz: number, c: number) => {
    for (let a = x; a < x + sx; a++) for (let b = y; b < y + sy; b++) for (let d = z; d < z + sz; d++) S(a, b, d, c);
  };
  B(0, 0, 0, 8, 8, 8, skin);
  // Face on +x.
  const eye = 0x1d1d24;
  S(7, 4, 2, eye); S(7, 5, 2, eye);
  S(7, 4, 5, eye); S(7, 5, 5, eye);
  S(8, 3, 3, shade(skin, 0.9)); S(8, 3, 4, shade(skin, 0.9)); // nose
  S(7, 1, 3, shade(skin, 0.62)); S(7, 1, 4, shade(skin, 0.62)); // mouth
  S(7, 2, 1, shade(skin, 0.94)); S(7, 2, 6, shade(skin, 0.94)); // cheeks
  S(3, 3, -1, shade(skin, 0.92)); S(3, 4, -1, shade(skin, 0.92)); // ears
  S(3, 3, 8, shade(skin, 0.92)); S(3, 4, 8, shade(skin, 0.92));

  const cap = (h: number) => B(0, 8, 0, 8, h, 8, hair);
  const back = (y0: number) => B(0, y0, 0, 1, 8 - y0, 8, hair);
  const sides = (y0: number, depth: number) => {
    B(0, y0, 0, depth, 8 - y0, 1, hair);
    B(0, y0, 7, depth, 8 - y0, 1, hair);
  };
  switch (look.hair % 9) {
    case 0: // short
      cap(1); back(4); sides(6, 5);
      break;
    case 1: // buzz: paint over the skin
      B(0, 7, 0, 8, 1, 8, hair); B(0, 5, 0, 1, 3, 8, hair); sides(6, 4);
      break;
    case 2: // mohawk
      B(0, 7, 0, 8, 1, 8, shade(hair, 1.1)); B(-1, 8, 3, 9, 2, 2, hair); B(0, 10, 3, 6, 1, 2, hair);
      break;
    case 3: // afro
      B(-1, 5, -1, 8, 6, 10, hair); B(0, 11, 0, 7, 1, 8, hair); sides(5, 6);
      break;
    case 4: // long
      cap(1); back(1); B(-1, 1, 0, 1, 8, 8, hair); sides(2, 3);
      break;
    case 5: // bald
      break;
    case 6: // spiky
      cap(1); back(4); sides(6, 4);
      for (let x = 0; x < 8; x += 2) for (let z = x % 4 === 0 ? 0 : 1; z < 8; z += 2) S(x, 9, z, hair);
      break;
    case 7: // bun
      cap(1); back(3); sides(6, 4); B(-2, 7, 3, 2, 3, 2, hair);
      break;
    case 8: // headband
      cap(1); back(4); sides(6, 5);
      for (let x = 0; x < 8; x++) { S(x, 6, -0, 0xfbfbf4); S(x, 6, 7, 0xfbfbf4); }
      for (let z = 0; z < 8; z++) S(0, 6, z, 0xfbfbf4);
      for (let z = 0; z < 8; z++) S(8, 6, z, 0xe8443a);
      break;
  }
  if (look.beard === 1) {
    for (let z = 1; z < 7; z++) S(7, 0, z, shade(hair, 0.95));
    S(7, 1, 1, hair); S(7, 1, 6, hair);
  } else if (look.beard === 2) {
    B(7, 0, 0, 1, 2, 8, hair); B(4, 0, 0, 3, 3, 1, hair); B(4, 0, 7, 3, 3, 1, hair);
    S(7, 1, 3, shade(skin, 0.62)); S(7, 1, 4, shade(skin, 0.62));
  }
  return meshVoxels(g, { scale: VU, pivot: [4 + OX, 0, 4 + OZ] });
}

export interface PoseInput {
  state: number; // PSTATE code
  stateT: number;
  speed: number;
  runPhase: number;
  kickT: number;
  kickLeg: number;
  lean: number;
  diveDir: number;
  headerT: number;
  celebrate: number;
  y: number;
  keeper: boolean;
  hasBall: boolean;
}

export const PSTATE = {
  move: 0, kick: 1, slide: 2, fallen: 3, stand: 4, dive: 5, hold: 6, throw: 7, celebrate: 8, dejected: 9,
} as const;

export class Footballer {
  readonly group = new THREE.Group();
  private readonly body = new THREE.Group(); // hip pivot
  private readonly torso: THREE.Mesh;
  private readonly head: THREE.Mesh;
  private readonly armL: THREE.Mesh;
  private readonly armR: THREE.Mesh;
  private readonly legL: THREE.Mesh;
  private readonly legR: THREE.Mesh;

  constructor(def: PlayerDef, kit: Kit, keeper: boolean) {
    const o = outfitFor(kit, keeper);
    const skin = SKIN[def.look.skin % SKIN.length];
    const kitKey = `${o.shirt}-${o.shirt2}-${o.pattern}-${o.shorts}-${o.socks}-${o.gloves}`;
    const torsoG = cached(`t-${kitKey}-${def.number}`, () => buildTorso(o, def.number));
    const armG = cached(`a-${kitKey}-${skin}`, () => buildArm(o, skin));
    const legG = cached(`l-${kitKey}-${skin}-${def.look.boots}`, () => buildLeg(o, skin, def.look.boots));
    const headG = cached(`h-${JSON.stringify(def.look)}`, () => buildHead(def.look));

    const mk = (g: THREE.BufferGeometry) => {
      const m = new THREE.Mesh(g, voxelMaterial);
      m.castShadow = true;
      m.receiveShadow = false;
      return m;
    };
    this.torso = mk(torsoG);
    this.head = mk(headG);
    this.armL = mk(armG);
    this.armR = mk(armG);
    this.legL = mk(legG);
    this.legR = mk(legG);

    this.group.add(this.body);
    this.body.position.y = HIP_Y;
    this.body.add(this.torso, this.legL, this.legR);
    this.torso.add(this.head, this.armL, this.armR);
    this.head.position.set(0, TORSO_H * VU, 0);
    this.armL.position.set(0, (TORSO_H - 0.6) * VU, -4.5 * VU);
    this.armR.position.set(0, (TORSO_H - 0.6) * VU, 4.5 * VU);
    this.legL.position.set(0, 0, -1.5 * VU);
    this.legR.position.set(0, 0, 1.5 * VU);
  }

  /** Procedural pose from the recorded sim state — identical live and in replays. */
  pose(p: PoseInput, time: number): void {
    const body = this.body;
    const torso = this.torso;
    const head = this.head;
    const aL = this.armL, aR = this.armR, lL = this.legL, lR = this.legR;
    // Reset.
    body.position.set(0, HIP_Y, 0);
    body.rotation.set(0, 0, 0);
    torso.rotation.set(0, 0, 0);
    torso.scale.set(1, 1, 1);
    head.rotation.set(0, 0, 0);
    aL.rotation.set(0, 0, 0);
    aR.rotation.set(0, 0, 0);
    lL.rotation.set(0, 0, 0);
    lR.rotation.set(0, 0, 0);
    this.group.position.y = p.y;

    const ph = p.runPhase * Math.PI * 2;
    const run = clamp(p.speed / 7.5, 0, 1);
    const swing = Math.sin(ph);

    const locomotion = () => {
      const amp = 0.25 + run * 0.75;
      if (p.speed > 0.25) {
        lL.rotation.z = swing * amp;
        lR.rotation.z = -swing * amp;
        aL.rotation.z = -swing * amp * 0.85;
        aR.rotation.z = swing * amp * 0.85;
        aL.rotation.x = -0.12;
        aR.rotation.x = 0.12;
        // Toy hop on every step.
        body.position.y = HIP_Y + Math.abs(Math.cos(ph)) * 0.075 * (0.4 + run);
        torso.rotation.z = -p.lean - run * 0.1;
        head.rotation.z = run * 0.08;
      } else {
        const br = Math.sin(time * 2.4 + p.runPhase * 9);
        torso.scale.y = 1 + br * 0.012;
        aL.rotation.x = -0.08 - br * 0.02;
        aR.rotation.x = 0.08 + br * 0.02;
        if (p.keeper) {
          // Set position: knees bent, gloves ready.
          body.position.y = HIP_Y - 0.06;
          torso.rotation.z = -0.18;
          aL.rotation.set(-0.5, 0, 0.9);
          aR.rotation.set(0.5, 0, 0.9);
          lL.rotation.set(0.14, 0, 0.12);
          lR.rotation.set(-0.14, 0, 0.12);
        }
      }
    };

    switch (p.state) {
      case PSTATE.move:
      case PSTATE.stand: {
        locomotion();
        if (p.state === PSTATE.stand) {
          const k = 1 - clamp(p.stateT / 0.38, 0, 1);
          body.rotation.z = k * 0.9;
          body.position.y = HIP_Y - k * 0.3;
        }
        if (p.headerT > 0) {
          const h = Math.sin((1 - p.headerT) * Math.PI);
          torso.rotation.z = -0.25 + h * -0.35;
          head.rotation.z = -h * 0.4;
          aL.rotation.x = -0.9;
          aR.rotation.x = 0.9;
        }
        break;
      }
      case PSTATE.kick: {
        const t = p.kickT;
        const kick = t < 0.22 ? lerp(0, -1.05, t / 0.22) : t < 0.45 ? lerp(-1.05, 1.45, (t - 0.22) / 0.23) : lerp(1.45, 0, (t - 0.45) / 0.55);
        const kickLeg = p.kickLeg > 0 ? lR : lL;
        const plant = p.kickLeg > 0 ? lL : lR;
        kickLeg.rotation.z = kick;
        plant.rotation.z = -0.15;
        const open = Math.sin(clamp(t, 0, 1) * Math.PI);
        aL.rotation.x = -0.4 - open * 0.9;
        aR.rotation.x = 0.4 + open * 0.9;
        torso.rotation.z = 0.12 * open;
        torso.rotation.y = -p.kickLeg * 0.25 * (kick / 1.45);
        body.position.y = HIP_Y - open * 0.04;
        if (p.headerT > 0) {
          const h = Math.sin((1 - p.headerT) * Math.PI);
          head.rotation.z = -h * 0.5;
          torso.rotation.z = -0.3 * h;
          kickLeg.rotation.z = 0.2;
        }
        break;
      }
      case PSTATE.throw: {
        const t = clamp(p.stateT / 0.34, 0, 1);
        const arm = t < 0.6 ? lerp(2.6, 3.4, t / 0.6) : lerp(3.4, 1.6, (t - 0.6) / 0.4);
        aL.rotation.z = arm;
        aR.rotation.z = arm;
        torso.rotation.z = t < 0.6 ? 0.2 : -0.25;
        lL.rotation.z = 0.2;
        lR.rotation.z = -0.1;
        break;
      }
      case PSTATE.slide: {
        const t = clamp(p.stateT / 0.2, 0, 1);
        body.rotation.z = 1.05 * t;
        body.position.y = HIP_Y - 0.36 * t;
        lR.rotation.z = 0.35;
        lL.rotation.z = -0.75;
        aL.rotation.x = -1.2;
        aR.rotation.z = -1.1;
        break;
      }
      case PSTATE.fallen: {
        const t = clamp(p.stateT / 0.25, 0, 1);
        body.rotation.z = 1.5 * t;
        body.position.y = HIP_Y - 0.44 * t;
        lL.rotation.z = 0.5 + Math.sin(time * 9) * 0.1 * (1 - t);
        lR.rotation.z = 0.2;
        aL.rotation.x = -1.4;
        aR.rotation.x = 1.4;
        break;
      }
      case PSTATE.dive: {
        const t = clamp(p.stateT / 0.22, 0, 1);
        const land = clamp((p.stateT - 0.55) / 0.3, 0, 1);
        body.rotation.x = p.diveDir * 1.35 * t;
        body.position.y = HIP_Y - 0.1 * t - land * 0.25;
        aL.rotation.z = 2.9 * t;
        aR.rotation.z = 2.9 * t;
        aL.rotation.x = -0.25;
        aR.rotation.x = 0.25;
        lL.rotation.x = -0.2 * p.diveDir;
        lR.rotation.x = 0.2 * p.diveDir;
        break;
      }
      case PSTATE.hold: {
        aL.rotation.set(-0.25, 0, 1.25);
        aR.rotation.set(0.25, 0, 1.25);
        torso.rotation.z = -0.05;
        locomotion();
        aL.rotation.set(-0.25, 0, 1.25);
        aR.rotation.set(0.25, 0, 1.25);
        break;
      }
      case PSTATE.celebrate: {
        locomotion();
        const style = p.celebrate;
        const hop = Math.abs(Math.sin(time * 7 + p.runPhase * 3));
        if (p.speed < 1.2) {
          if (style === 0 || style >= 4) {
            this.group.position.y = p.y + hop * 0.45;
            aL.rotation.set(-0.3, 0, 2.9);
            aR.rotation.set(0.3, 0, 2.9);
            lL.rotation.z = 0.3 * hop;
            lR.rotation.z = -0.3 * hop;
          } else if (style === 1) {
            aL.rotation.x = -1.55;
            aR.rotation.x = 1.55;
            body.rotation.x = Math.sin(time * 3) * 0.3;
          } else if (style === 2) {
            body.position.y = HIP_Y - 0.3;
            lL.rotation.z = -1.5;
            lR.rotation.z = -1.5;
            torso.rotation.z = 0.35;
            aL.rotation.set(-0.4, 0, 2.7);
            aR.rotation.set(0.4, 0, 2.7);
          } else {
            body.rotation.y = time * 9;
            aL.rotation.x = -1.4;
            aR.rotation.x = 1.4;
          }
        } else if (style === 1) {
          aL.rotation.set(-1.55, 0, 0);
          aR.rotation.set(1.55, 0, 0);
          body.rotation.x = Math.sin(time * 4) * 0.25;
        } else {
          aL.rotation.z = 2.8;
          aR.rotation.z = 2.8;
        }
        break;
      }
      case PSTATE.dejected: {
        locomotion();
        head.rotation.z = -0.4;
        torso.rotation.z = -0.15;
        aL.rotation.set(-0.05, 0, 0.05);
        aR.rotation.set(0.05, 0, 0.05);
        break;
      }
    }
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}

/** Voxel ball: a 7³ sphere with dark pentagon patches. */
export function buildBallGeometry(radius: number): THREE.BufferGeometry {
  const n = 8;
  const g = new VoxelGrid(n, n, n);
  const c = (n - 1) / 2;
  const phi = (1 + Math.sqrt(5)) / 2;
  const ico = [
    [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
    [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
    [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
  ].map(([x, y, z]) => {
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l];
  });
  const r = n / 2;
  for (let x = 0; x < n; x++)
    for (let y = 0; y < n; y++)
      for (let z = 0; z < n; z++) {
        const dx = x - c, dy = y - c, dz = z - c;
        const d = Math.hypot(dx, dy, dz);
        if (d > r - 0.05) continue;
        let col = 0xfbfbf6;
        const l = d || 1;
        for (const v of ico) {
          if ((dx * v[0] + dy * v[1] + dz * v[2]) / l > 0.9) col = 0x26262e;
        }
        g.set(x, y, z, col);
      }
  const s = (radius * 2) / n;
  return meshVoxels(g, { scale: s, pivot: [n / 2, n / 2, n / 2], faceTint: true });
}
