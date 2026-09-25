import * as THREE from 'three';
import { clamp, smoothstep } from '../core/math';
import { Rng } from '../core/rng';
import {
  BOX_DEPTH, BOX_W, CENTER_R, GOAL_DEPTH, GOAL_H, GOAL_W, HALF_L, HALF_W, PEN_SPOT, SIX_DEPTH, SIX_W,
} from '../sim/constants';
import {
  CONCRETE, CONCRETE_DARK, GRASS_A, GRASS_B, GRASS_OUT_A, GRASS_OUT_B, HAIR, LEAF_A, LEAF_B, LEAF_C, LINE,
  ROAD, SAND, SKIN, STEEL, TRUNK, WATER, cssHex, mix, shade,
} from './palette';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BoxBuilder, voxelMaterial } from './voxel';

export interface StadiumOptions {
  home: number;
  away: number;
  homeName: string;
  awayName: string;
  /** 0..1 — how full the stands are. */
  attendance: number;
  seed?: number;
}

const LINE_W = 0.18;
const BOARD_Z = HALF_W + 3.2;
const BOARD_X = HALF_L + 4.6;
const STAND_Z = HALF_W + 5.6;
const STAND_X = HALF_L + 6.2;
const STEP_D = 0.86;
const STEP_H = 0.56;
const BANNER_X = [-30, -4, 22, 42];
type Side4 = 'far' | 'near' | 'left' | 'right';
/** The playing surface is a raised lawn; players, ball and goals sit on top of it. */
export const PITCH_Y = 0.12;

/** Floodlight masts at the four corners: ground position and lamp-head height (also used for night shadows). */
export const FLOODLIGHT_TOWERS: readonly { x: number; z: number; h: number }[] = [-1, 1].flatMap((sx) =>
  [-1, 1].map((sz) => ({ x: sx * (HALF_L + 13), z: sz * (HALF_W + 16), h: 27.6 })),
);

/**
 * Vertex-coloured Lambert (like voxelMaterial) with a snow blend: `uSnow` 0..1 mixes every face toward
 * `snowCol`. The material colour multiplies the lot, which doubles as the night dimmer.
 */
function snowMaterial(snow: { value: number }, snowCol: number, key: string): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  const col = { value: new THREE.Color(snowCol) };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSnow = snow;
    sh.uniforms.uSnowCol = col;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSnow;\nuniform vec3 uSnowCol;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uSnowCol * diffuse, uSnow);');
  };
  m.customProgramCacheKey = () => `snow-${key}`;
  return m;
}

export class Stadium {
  readonly group = new THREE.Group();
  /** Pitch-level objects (lawn, lines, goals, flags), lifted by PITCH_Y. */
  readonly pitch = new THREE.Group();
  readonly crowdUniforms = { uTime: { value: 0 }, uHypeHome: { value: 0.1 }, uHypeAway: { value: 0.1 } };
  private nets: GoalNet[] = [];
  private flags: THREE.Object3D[] = [];
  private boardTex: THREE.CanvasTexture[] = [];
  private cars: { mesh: THREE.Object3D; speed: number; lane: number }[] = [];
  private logs: { mesh: THREE.Object3D; speed: number }[] = [];
  private clouds: THREE.Object3D[] = [];
  private scoreCanvas: HTMLCanvasElement;
  private scoreTex: THREE.CanvasTexture;
  private rng: Rng;
  private flashes!: THREE.InstancedMesh;
  private flashSpots: THREE.Vector3[] = [];
  private flashLife: Float32Array = new Float32Array(0);
  private seatSpots: THREE.Vector3[] = [];
  private hypeLevel = 0;
  private m4 = new THREE.Matrix4();
  private glows: THREE.Sprite[] = [];
  private stars: THREE.Points | null = null;
  private lampHeads: THREE.Vector3[] = [];
  /** Per lamp: halo sprite size (m) and how strongly its glare bleeds into the frame from above. */
  private lampGlow: { size: number; flare: number }[] = [];
  /** Snow cover on the lawn (0..0.6) and on the ground outside (0..0.75), grown while it snows. */
  private readonly snowPitch = { value: 0 };
  private readonly snowOuter = { value: 0 };
  private snowing = false;
  private snowT = 0;
  // Own materials (not the shared voxelMaterial) so night can dim the stands but keep the lawn floodlit,
  // and snow can settle on the grass without whitening the players.
  private readonly grassMat = snowMaterial(this.snowPitch, 0xeef4f8, 'grass');
  private readonly lineMat = snowMaterial(this.snowPitch, 0xb9d2e8, 'line');
  private readonly groundMat = snowMaterial(this.snowOuter, 0xf2f6fa, 'ground');
  private readonly standMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private readonly outerMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private crowdMats: THREE.MeshLambertMaterial[] = [];
  private bannerMats: THREE.MeshLambertMaterial[] = [];
  private flares: THREE.Sprite[] = [];
  private flareV = new THREE.Vector3();
  private flareW = new THREE.Vector3();
  private night = false;

  constructor(readonly opt: StadiumOptions) {
    this.rng = new Rng(opt.seed ?? 42);
    this.pitch.position.y = PITCH_Y;
    this.group.add(this.pitch);
    this.buildPitch();
    this.buildGoals();
    this.buildBoards();
    this.buildStands();
    this.buildCrowd();
    this.buildFloodlights();
    this.buildSurroundings();
    this.buildFlags();
    this.buildDugouts();
    this.buildPhotographers();
    this.buildBanners();
    this.buildFlashes();
    this.scoreCanvas = document.createElement('canvas');
    this.scoreCanvas.width = 512;
    this.scoreCanvas.height = 160;
    this.scoreTex = new THREE.CanvasTexture(this.scoreCanvas);
    this.scoreTex.colorSpace = THREE.SRGBColorSpace;
    this.buildScoreboard();
    this.setScore(0, 0, "0'");
  }

  // ------------------------------------------------------------------ pitch

  private buildPitch(): void {
    // Run-off lawn: a darker, lower band out to the boards.
    const r = new BoxBuilder();
    const ext = { x: HALF_L + 7.5, z: HALF_W + 6.5 };
    const band = 3;
    for (let x = -ext.x; x < ext.x - 1e-3; x += band) {
      const i = Math.round((x + ext.x) / band);
      const w = Math.min(band, ext.x - x);
      r.box(x + w / 2, -0.1, 0, w, 0.2, ext.z * 2, i % 2 ? GRASS_OUT_A : GRASS_OUT_B, { skipBottom: true });
    }
    const runoff = new THREE.Mesh(r.build(), this.grassMat);
    runoff.receiveShadow = true;
    this.group.add(runoff);

    // The playing surface: a raised lawn slab with mowing stripes and a darker skirt.
    const b = new BoxBuilder();
    const slab = { x: HALF_L + 2, z: HALF_W + 2 };
    const stripe = (HALF_L * 2) / 16;
    const depth = 0.3;
    for (let x = -slab.x; x < slab.x - 1e-3; ) {
      const i = Math.floor((x + HALF_L) / stripe + 1e-3);
      const next = Math.min(slab.x, -HALF_L + (i + 1) * stripe);
      const w = next - x;
      const col = ((i % 2) + 2) % 2 === 0 ? GRASS_A : GRASS_B;
      b.box(x + w / 2, -depth / 2, 0, w, depth, slab.z * 2, shade(col, 0.62), { top: col, skipBottom: true });
      x = next;
    }
    const grass = new THREE.Mesh(b.build(), this.grassMat);
    grass.receiveShadow = true;
    this.pitch.add(grass);

    // Painted lines as very flat boxes.
    const L = new BoxBuilder();
    const y = 0.006;
    const h = 0.012;
    const seg = (x1: number, z1: number, x2: number, z2: number) => {
      const len = Math.hypot(x2 - x1, z2 - z1);
      const a = Math.atan2(-(z2 - z1), x2 - x1);
      L.box((x1 + x2) / 2, y, (z1 + z2) / 2, len + LINE_W, h, LINE_W, LINE, { rotY: a, skipBottom: true });
    };
    const arc = (cx: number, cz: number, r: number, a0: number, a1: number, n = 48) => {
      for (let i = 0; i < n; i++) {
        const t0 = a0 + ((a1 - a0) * i) / n;
        const t1 = a0 + ((a1 - a0) * (i + 1)) / n;
        seg(cx + Math.cos(t0) * r, cz + Math.sin(t0) * r, cx + Math.cos(t1) * r, cz + Math.sin(t1) * r);
      }
    };
    seg(-HALF_L, -HALF_W, HALF_L, -HALF_W);
    seg(-HALF_L, HALF_W, HALF_L, HALF_W);
    seg(-HALF_L, -HALF_W, -HALF_L, HALF_W);
    seg(HALF_L, -HALF_W, HALF_L, HALF_W);
    seg(0, -HALF_W, 0, HALF_W);
    arc(0, 0, CENTER_R, 0, Math.PI * 2, 64);
    L.box(0, y, 0, 0.4, h, 0.4, LINE, { skipBottom: true });
    for (const s of [-1, 1]) {
      const gx = s * HALF_L;
      const bx = gx - s * BOX_DEPTH;
      seg(gx, -BOX_W / 2, bx, -BOX_W / 2);
      seg(gx, BOX_W / 2, bx, BOX_W / 2);
      seg(bx, -BOX_W / 2, bx, BOX_W / 2);
      const sx = gx - s * SIX_DEPTH;
      seg(gx, -SIX_W / 2, sx, -SIX_W / 2);
      seg(gx, SIX_W / 2, sx, SIX_W / 2);
      seg(sx, -SIX_W / 2, sx, SIX_W / 2);
      const px = gx - s * PEN_SPOT;
      L.box(px, y, 0, 0.32, h, 0.32, LINE, { skipBottom: true });
      // D: the part of the penalty arc outside the box
      const r = 8.4;
      const cut = Math.acos((BOX_DEPTH - PEN_SPOT) / r);
      if (s > 0) arc(px, 0, r, Math.PI - cut, Math.PI + cut, 24);
      else arc(px, 0, r, -cut, cut, 24);
      // Corner arcs
      for (const zs of [-1, 1]) {
        const a0 = s > 0 ? (zs > 0 ? Math.PI : Math.PI / 2) : zs > 0 ? -Math.PI / 2 : 0;
        arc(gx, zs * HALF_W, 1, a0, a0 + Math.PI / 2, 8);
      }
    }
    const lines = new THREE.Mesh(L.build(), this.lineMat);
    lines.receiveShadow = true;
    lines.position.y = 0.004;
    this.pitch.add(lines);
  }

  // ------------------------------------------------------------------ goals

  private buildGoals(): void {
    for (const s of [-1, 1]) {
      const b = new BoxBuilder();
      const gx = s * HALF_L;
      const t = 0.2;
      const white = 0xfbfbf6;
      b.box(gx + s * t * 0.5, GOAL_H / 2, -GOAL_W / 2 - t / 2, t, GOAL_H + t, t, white);
      b.box(gx + s * t * 0.5, GOAL_H / 2, GOAL_W / 2 + t / 2, t, GOAL_H + t, t, white);
      b.box(gx + s * t * 0.5, GOAL_H + t / 2, 0, t, t, GOAL_W + t * 2, white);
      // Back frame (thin, grey)
      const bx = gx + s * GOAL_DEPTH;
      const f = 0.07;
      const grey = 0xcfd3d8;
      b.box(bx, GOAL_H / 2, -GOAL_W / 2, f, GOAL_H, f, grey);
      b.box(bx, GOAL_H / 2, GOAL_W / 2, f, GOAL_H, f, grey);
      b.box(bx, GOAL_H, 0, f, f, GOAL_W, grey);
      b.box(gx + s * GOAL_DEPTH / 2, GOAL_H, -GOAL_W / 2, GOAL_DEPTH, f, f, grey);
      b.box(gx + s * GOAL_DEPTH / 2, GOAL_H, GOAL_W / 2, GOAL_DEPTH, f, f, grey);
      b.box(gx + s * GOAL_DEPTH / 2, 0.03, -GOAL_W / 2, GOAL_DEPTH, 0.05, f, grey);
      b.box(gx + s * GOAL_DEPTH / 2, 0.03, GOAL_W / 2, GOAL_DEPTH, 0.05, f, grey);
      b.box(bx, 0.03, 0, f, 0.05, GOAL_W, grey);
      const frame = new THREE.Mesh(b.build(), voxelMaterial);
      frame.castShadow = true;
      frame.receiveShadow = true;
      this.pitch.add(frame);
      const net = new GoalNet(s);
      this.nets.push(net);
      this.pitch.add(net.mesh);
    }
  }

  punchNet(x: number, y: number, z: number, speed: number): void {
    const net = this.nets[x > 0 ? 1 : 0];
    net.punch(y, z, Math.min(speed / 20, 1.4));
  }

  // ------------------------------------------------------------------ ad boards

  private makeBoardTexture(words: string[], bgs: number[]): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 2048;
    c.height = 64;
    const g = c.getContext('2d')!;
    const segW = c.width / words.length;
    words.forEach((w, i) => {
      const bg = bgs[i % bgs.length];
      g.fillStyle = cssHex(bg);
      g.fillRect(i * segW, 0, segW, 64);
      // Chunky pixel stripe at the edges like LED panels.
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(i * segW, 56, segW, 8);
      const light = ((bg >> 16) & 255) * 0.3 + ((bg >> 8) & 255) * 0.59 + (bg & 255) * 0.11 > 170;
      g.fillStyle = light ? '#26262e' : '#fbfbf4';
      let size = 42;
      g.font = `700 ${size}px "Silkscreen", "Courier New", monospace`;
      const wMax = segW * 0.86;
      const tw = g.measureText(w).width;
      if (tw > wMax) {
        size = Math.floor(size * (wMax / tw));
        g.font = `700 ${size}px "Silkscreen", "Courier New", monospace`;
      }
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(w, i * segW + segW / 2, 32);
    });
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    this.boardTex.push(tex);
    return tex;
  }

  private buildBoards(): void {
    const words = ['BLOCKY LEAGUE', 'CUBE COLA', 'HOP HOP', 'VOXEL BANK', 'CHUNKY BOOTS', 'PIXEL AIR'];
    const bgs = [0x2f6fe0, 0xe8443a, 0xffd23a, 0x2fae5a, 0xff8a2b, 0x8a55d8];
    const frame = new BoxBuilder();
    const h = 0.95;
    const add = (cx: number, cz: number, len: number, rot: number) => {
      frame.box(cx, h / 2, cz, len, h, 0.22, 0x2a2a30, { rotY: rot });
      const tex = this.makeBoardTexture(words, bgs);
      tex.repeat.x = len / 60;
      const mat = new THREE.MeshBasicMaterial({ map: tex });
      const face = new THREE.Mesh(new THREE.PlaneGeometry(len, h * 0.86), mat);
      face.position.set(cx, h / 2, cz);
      face.rotation.y = rot;
      // Offset slightly towards the pitch.
      const nx = Math.sin(rot);
      const nz = Math.cos(rot);
      face.position.x += nx * 0.12;
      face.position.z += nz * 0.12;
      this.group.add(face);
    };
    add(0, -BOARD_Z, HALF_L * 2 + 6, 0); // far side, faces +z
    add(0, BOARD_Z, HALF_L * 2 + 6, Math.PI);
    add(-BOARD_X, 0, HALF_W * 2 + 2, Math.PI / 2);
    add(BOARD_X, 0, HALF_W * 2 + 2, -Math.PI / 2);
    const m = new THREE.Mesh(frame.build(), voxelMaterial);
    m.castShadow = true;
    m.receiveShadow = true;
    this.group.add(m);
  }

  // ------------------------------------------------------------------ stands

  /** Row profile of a stand: distance from its front edge and the seat height, two tiers. */
  private profile(side: Side4): { d: number; h: number; tier: number }[] {
    const [t1, t2] = side === 'far' ? [14, 10] : side === 'near' ? [4, 0] : [11, 6];
    const rows: { d: number; h: number; tier: number }[] = [];
    for (let i = 0; i < t1; i++) rows.push({ d: i * STEP_D, h: 0.9 + i * STEP_H, tier: 1 });
    const d0 = t1 * STEP_D + 1.7;
    const h0 = 0.9 + t1 * STEP_H + 2.4;
    for (let j = 0; j < t2; j++) rows.push({ d: d0 + j * STEP_D * 1.05, h: h0 + j * STEP_H * 1.25, tier: 2 });
    return rows;
  }

  private span(side: Side4): number {
    return side === 'far' || side === 'near' ? HALF_L + 5 : HALF_W + 4;
  }

  /** Front edge distance from the pitch centre line for a side. */
  private front(side: Side4): number {
    return side === 'far' || side === 'near' ? STAND_Z : STAND_X;
  }

  /** Place a local (along, depth, height) point of a stand in world space. */
  private place(side: Side4, along: number, d: number): { x: number; z: number; rot: number } {
    const f = this.front(side) + d;
    switch (side) {
      case 'far': return { x: along, z: -f, rot: 0 };
      case 'near': return { x: along, z: f, rot: Math.PI };
      case 'left': return { x: -f, z: along, rot: -Math.PI / 2 };
      default: return { x: f, z: along, rot: Math.PI / 2 };
    }
  }

  /** Axis-aligned box in stand-local coordinates. */
  private standBox(b: BoxBuilder, side: Side4, along: number, d: number, y: number, len: number, depth: number, h: number, color: number, top?: number): void {
    const p = this.place(side, along, d);
    const alongX = side === 'far' || side === 'near';
    b.box(p.x, y, p.z, alongX ? len : depth, h, alongX ? depth : len, color, { top, skipBottom: y - h / 2 <= 0.01 });
  }

  private buildStands(): void {
    const b = new BoxBuilder();
    const { home, away } = this.opt;
    const sides: Side4[] = ['far', 'near', 'left', 'right'];
    for (const side of sides) {
      const rows = this.profile(side);
      const span = this.span(side);
      const seatCol = side === 'right' ? away : home;
      const riser = mix(seatCol, 0xffffff, 0.15);
      rows.forEach((r, i) => {
        const band = i % 5 === 4 ? shade(seatCol, 0.8) : i % 2 ? CONCRETE : CONCRETE_DARK;
        const depth = r.tier === 2 ? STEP_D * 1.05 : STEP_D;
        this.standBox(b, side, 0, r.d + depth / 2, r.h / 2, span * 2, depth, r.h, riser, band);
      });
      const t1 = rows.filter((r) => r.tier === 1);
      const t2 = rows.filter((r) => r.tier === 2);
      // Front wall with a painted band.
      this.standBox(b, side, 0, -0.2, 0.6, span * 2, 0.4, 1.2, shade(side === 'right' ? away : home, 0.9), 0xfbfbf4);
      const last = rows[rows.length - 1];
      const backD = last.d + STEP_D * 1.05;
      if (t2.length) {
        // Concourse wall between the tiers and the upper-tier fascia.
        const cd = t1[t1.length - 1].d + STEP_D;
        const ch = t2[0].h - 0.5;
        this.standBox(b, side, 0, cd + 0.85, ch / 2, span * 2, 1.7, ch, shade(CONCRETE, 0.78), shade(CONCRETE, 0.9));
        this.standBox(b, side, 0, cd + 1.55, t2[0].h - 0.9, span * 2, 0.3, 0.8, shade(seatCol, 0.7));
      }
      // The near stand is kept low and open so the broadcast camera looks over it.
      if (side === 'near') {
        this.standBox(b, side, 0, backD + 0.3, last.h / 2 + 0.4, span * 2, 0.6, last.h + 0.8, shade(CONCRETE, 0.92), shade(seatCol, 0.8));
        continue;
      }
      // Back wall and roof on stilts.
      const roofY = last.h + 4;
      this.standBox(b, side, 0, backD + 0.3, (roofY - 0.2) / 2, span * 2, 0.6, roofY - 0.2, shade(CONCRETE, 0.92));
      const roofDepth = backD + 1.6;
      this.standBox(b, side, 0, roofDepth / 2 - 0.6, roofY, span * 2 + 1, roofDepth, 0.35, 0xdedad0, 0xf2f0e8);
      // Fascia in the club colour and ribs under the roof.
      this.standBox(b, side, 0, -0.9, roofY - 0.5, span * 2 + 1, 0.5, 1.0, shade(seatCol, 0.8));
      for (let a = -span; a <= span + 0.01; a += 6) {
        this.standBox(b, side, a, roofDepth / 2 - 0.6, roofY - 0.35, 0.3, roofDepth, 0.35, shade(0xdedad0, 0.8));
      }
      for (let a = -span + 2; a <= span; a += 12) {
        this.standBox(b, side, a, backD + 0.1, roofY / 2, 0.6, 0.6, roofY, STEEL);
      }
    }
    // Corners: low stepped blocks so there are no holes.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (let i = 0; i < 9; i++) {
          const top = 0.9 + i * STEP_H;
          const x = sx * (HALF_L + 5 + 3.6);
          const z = sz * (STAND_Z + i * STEP_D + STEP_D / 2);
          b.box(x, top / 2, z, 7.2, top, STEP_D, i % 2 ? CONCRETE : CONCRETE_DARK, { skipBottom: true });
        }
      }
    }
    const m = new THREE.Mesh(b.build(), this.standMat);
    m.receiveShadow = true;
    // Stands don't cast: their shadow would be clipped by the moving shadow frustum into wedges on the pitch.
    m.castShadow = false;
    this.group.add(m);

    // Stadium name on the far roof fascia + an LED ribbon on the upper-tier front.
    const farRows = this.profile('far');
    const roofY = farRows[farRows.length - 1].h + 4;
    const c = document.createElement('canvas');
    c.width = 2048;
    c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = cssHex(shade(home, 0.8));
    g.fillRect(0, 0, 2048, 64);
    g.fillStyle = '#fbfbf4';
    g.font = '700 40px "Silkscreen", "Courier New", monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const name = this.opt.homeName.toUpperCase();
    g.fillText(`${name}   ·   BLOCKY LEAGUE   ·   ${name}   ·   BLOCKY LEAGUE`, 1024, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(HALF_L * 2 + 11, 0.95), new THREE.MeshBasicMaterial({ map: tex }));
    sign.position.set(0, roofY - 0.5, -(STAND_Z - 0.9) + 0.27);
    this.group.add(sign);
    const t2 = farRows.filter((r) => r.tier === 2)[0];
    const words = ['BLOCKY LEAGUE', 'CUBE COLA', 'HOP HOP', 'VOXEL BANK', 'CHUNKY BOOTS', 'PIXEL AIR'];
    const ribbon = this.makeBoardTexture(words, [0x26262e, 0x2f6fe0, 0x26262e, 0xe8443a, 0x26262e, 0x2fae5a]);
    ribbon.repeat.x = (HALF_L * 2 + 10) / 60;
    const rib = new THREE.Mesh(new THREE.PlaneGeometry(HALF_L * 2 + 10, 0.7), new THREE.MeshBasicMaterial({ map: ribbon }));
    const cd = farRows.filter((r) => r.tier === 1).length * STEP_D;
    rib.position.set(0, t2.h - 0.9, -(STAND_Z + cd + 1.55) + 0.17);
    this.group.add(rib);

    // A floodlight gantry along the far roof edge (the lamps whose glare tops the broadcast frame at night).
    const gantry = new BoxBuilder();
    const faces = new BoxBuilder();
    const fz = -(STAND_Z - 0.9);
    for (let x = -42; x <= 42.01; x += 12) {
      gantry.box(x, roofY + 0.55, fz - 0.1, 2.2, 0.9, 0.7, 0x3a3f48);
      faces.box(x, roofY + 0.5, fz + 0.28, 1.9, 0.6, 0.08, 0xfffbe0);
      this.lampHeads.push(new THREE.Vector3(x, roofY + 0.5, fz + 0.5));
      this.lampGlow.push({ size: 7, flare: 0.8 });
    }
    this.group.add(new THREE.Mesh(gantry.build(), this.standMat));
    this.group.add(new THREE.Mesh(faces.build(), new THREE.MeshBasicMaterial({ vertexColors: true })));
  }

  private buildCrowd(): void {
    const rng = this.rng;
    const att = this.opt.attendance;
    type Seat = { x: number; y: number; z: number; rot: number; team: number };
    const seats: Seat[] = [];
    const sides: Side4[] = ['far', 'near', 'left', 'right'];
    for (const side of sides) {
      const rows = this.profile(side);
      const span = this.span(side) - 0.5;
      rows.forEach((r, i) => {
        const fill = att * (0.95 - (i / rows.length) * 0.2);
        for (let t = -span; t <= span; t += 0.86) {
          if (!rng.chance(fill)) continue;
          // Leave the rows under the fan banners empty.
          if (side === 'far' && i <= 3 && BANNER_X.some((bx) => Math.abs(t - bx) < 5.3)) continue;
          const depth = r.tier === 2 ? STEP_D * 1.05 : STEP_D;
          const p = this.place(side, t + (rng.next() - 0.5) * 0.1, r.d + depth * 0.45);
          // Away fans are packed into one end, in blocks.
          let team = 0;
          if (side === 'right') team = rng.chance(0.88) ? 1 : 0;
          else if (rng.chance(0.08)) team = 2;
          seats.push({ x: p.x, y: r.h, z: p.z, rot: p.rot, team });
          if (rng.chance(0.08)) this.seatSpots.push(new THREE.Vector3(p.x, r.h + 1.2, p.z));
        }
      });
    }
    // One mesh per fan: body + head + hair top, coloured per part in the shader.
    const body = new THREE.BoxGeometry(0.52, 0.56, 0.34).translate(0, 0.28, 0);
    const head = new THREE.BoxGeometry(0.42, 0.42, 0.42).translate(0, 0.56 + 0.21, 0);
    const hairTop = new THREE.BoxGeometry(0.44, 0.1, 0.44).translate(0, 0.56 + 0.42 + 0.03, 0);
    const parts = [body, head, hairTop].map((gq, k) => {
      const ng = gq.toNonIndexed();
      const n = ng.getAttribute('position').count;
      ng.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(n).fill(k), 1));
      // Bake face shading into vertex colour so blocks read even when fully lit.
      const nor = ng.getAttribute('normal');
      const colArr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const ny = nor.getY(i);
        const k2 = ny > 0.5 ? 1 : ny < -0.5 ? 0.6 : 0.88;
        colArr[i * 3] = colArr[i * 3 + 1] = colArr[i * 3 + 2] = k2;
      }
      ng.setAttribute('color', new THREE.Float32BufferAttribute(colArr, 3));
      return ng;
    });
    const fanGeo = mergeGeometries(parts);
    const n = seats.length;
    const mat = this.crowdMaterial(false, true);
    const fans = new THREE.InstancedMesh(fanGeo, mat, n);
    const phase = new Float32Array(n);
    const team = new Float32Array(n);
    const skin = new Float32Array(n * 3);
    const hairC = new Float32Array(n * 3);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    const { home, away } = this.opt;
    const neutral = [0xe8443a, 0x2f6fe0, 0xffd23a, 0x2fae5a, 0xf6f4ec, 0x2a2a30, 0xff79b0, 0x8a55d8];
    seats.forEach((s, i) => {
      q.setFromAxisAngle(up, s.rot + (rng.next() - 0.5) * 0.3);
      const sc = 0.92 + rng.next() * 0.18;
      m4.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(sc, sc, sc));
      fans.setMatrixAt(i, m4);
      const kitCol = s.team === 0 ? home : s.team === 1 ? away : rng.pick(neutral);
      const shirt = rng.chance(0.74) ? kitCol : rng.chance(0.55) ? 0xf6f4ec : rng.pick(neutral);
      fans.setColorAt(i, col.setHex(shade(shirt, 0.9 + rng.next() * 0.16)));
      col.setHex(rng.pick(SKIN));
      skin[i * 3] = col.r; skin[i * 3 + 1] = col.g; skin[i * 3 + 2] = col.b;
      col.setHex(rng.chance(0.18) ? kitCol : rng.pick(HAIR));
      hairC[i * 3] = col.r; hairC[i * 3 + 1] = col.g; hairC[i * 3 + 2] = col.b;
      phase[i] = rng.next();
      team[i] = s.team;
    });
    fanGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    fanGeo.setAttribute('aTeam', new THREE.InstancedBufferAttribute(team, 1));
    fanGeo.setAttribute('aSkin', new THREE.InstancedBufferAttribute(skin, 3));
    fanGeo.setAttribute('aHairC', new THREE.InstancedBufferAttribute(hairC, 3));
    fans.instanceMatrix.needsUpdate = true;
    if (fans.instanceColor) fans.instanceColor.needsUpdate = true;
    fans.frustumCulled = false;
    fans.receiveShadow = true;
    this.group.add(fans);

    // Some fans wave flags on sticks.
    const flagSeats = seats.map((s, i) => ({ s, i })).filter(() => rng.chance(0.035));
    const fg = new THREE.BoxGeometry(0.95, 0.6, 0.04);
    fg.translate(0.5, 1.6, 0);
    const pole = new THREE.BoxGeometry(0.05, 1.35, 0.05);
    pole.translate(0, 1.25, 0);
    const flagMat = this.crowdMaterial(true);
    const flags = new THREE.InstancedMesh(fg, flagMat, flagSeats.length);
    const poles = new THREE.InstancedMesh(pole, flagMat, flagSeats.length);
    const fPhase = new Float32Array(flagSeats.length);
    const fTeam = new Float32Array(flagSeats.length);
    flagSeats.forEach(({ s, i }, k) => {
      q.setFromAxisAngle(up, s.rot);
      m4.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(1, 1, 1));
      flags.setMatrixAt(k, m4);
      poles.setMatrixAt(k, m4);
      const kitCol = s.team === 1 ? away : home;
      flags.setColorAt(k, col.setHex(rng.chance(0.3) ? 0xfbfbf4 : kitCol));
      poles.setColorAt(k, col.setHex(0x8a5a36));
      fPhase[k] = phase[i];
      fTeam[k] = team[i];
    });
    for (const im of [flags, poles]) {
      im.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(fPhase, 1));
      im.geometry.setAttribute('aTeam', new THREE.InstancedBufferAttribute(fTeam, 1));
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.frustumCulled = false;
      this.group.add(im);
    }
  }

  private crowdMaterial(sway = false, parts = false): THREE.Material {
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: parts });
    this.crowdMats.push(mat);
    const u = this.crowdUniforms;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = u.uTime;
      sh.uniforms.uHypeHome = u.uHypeHome;
      sh.uniforms.uHypeAway = u.uHypeAway;
      sh.vertexShader = sh.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute float aPhase;
          attribute float aTeam;
          ${parts ? 'attribute float aPart; attribute vec3 aSkin; attribute vec3 aHairC;' : ''}
          uniform float uTime;
          uniform float uHypeHome;
          uniform float uHypeAway;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float hype = aTeam < 0.5 ? uHypeHome : aTeam < 1.5 ? uHypeAway : (uHypeHome + uHypeAway) * 0.5;
          float rate = 5.0 + fract(aPhase * 7.31) * 3.0;
          float hop = max(0.0, sin(uTime * rate + aPhase * 6.2831));
          float joins = step(fract(aPhase * 3.77), 0.25 + hype * 0.75);
          float idle = sin(uTime * 1.3 + aPhase * 20.0) * 0.015;
          transformed.y += hop * hop * mix(0.02, 0.42, hype) * joins + idle;
          ${sway ? 'transformed.z += sin(uTime * (3.0 + hype * 4.0) + aPhase * 6.2831) * max(0.0, position.x) * (0.25 + hype * 0.5);' : ''}`,
        );
      if (parts) {
        sh.vertexShader = sh.vertexShader.replace(
          '#include <color_vertex>',
          `vColor = vec4(1.0);
          #ifdef USE_COLOR
            vColor.rgb *= color.rgb;
          #endif
          #ifdef USE_INSTANCING_COLOR
            vec3 shirtC = instanceColor.rgb;
          #else
            vec3 shirtC = vec3(1.0);
          #endif
          vColor.rgb *= aPart < 0.5 ? shirtC : (aPart < 1.5 ? aSkin : aHairC);`,
        );
      }
    };
    mat.customProgramCacheKey = () => (sway ? 'crowd-sway' : parts ? 'crowd-parts' : 'crowd');
    return mat;
  }

  // ------------------------------------------------------------------ floodlights

  private buildFloodlights(): void {
    const b = new BoxBuilder();
    const lamps = new BoxBuilder();
    for (const t of FLOODLIGHT_TOWERS) {
      {
        // (one mast per corner)
        const x = t.x;
        const z = t.z;
        const h = t.h - 1.6;
        b.box(x, h / 2, z, 0.9, h, 0.9, STEEL);
        b.box(x, h / 2, z, 1.4, 0.4, 1.4, shade(STEEL, 1.2));
        const rot = Math.atan2(-x, -z) + Math.PI;
        b.box(x, h + 1.6, z, 6, 3.4, 0.6, 0x3a3f48, { rotY: rot });
        this.lampHeads.push(new THREE.Vector3(x - Math.sign(x) * 0.8, h + 1.6, z - Math.sign(z) * 0.8));
        this.lampGlow.push({ size: 18, flare: 0.8 });
        for (let i = 0; i < 4; i++) {
          for (let j = 0; j < 2; j++) {
            const ox = (i - 1.5) * 1.35;
            const oy = h + 0.9 + j * 1.4;
            const cx = x + ox * Math.cos(rot) + 0.35 * Math.sin(rot);
            const cz = z - ox * Math.sin(rot) + 0.35 * Math.cos(rot);
            lamps.box(cx, oy, cz, 1.1, 1.1, 0.25, 0xfffbe0, { rotY: rot });
          }
        }
      }
    }
    const m = new THREE.Mesh(b.build(), this.standMat);
    m.castShadow = false;
    this.group.add(m);
    const l = new THREE.Mesh(lamps.build(), new THREE.MeshBasicMaterial({ vertexColors: true }));
    this.group.add(l);
  }

  /** Night: glowing floodlight halos and a starry sky. */
  setTimeOfDay(t: 'day' | 'sunset' | 'night'): void {
    const night = t === 'night';
    if (night && this.glows.length === 0) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d')!;
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255,255,240,1)');
      grad.addColorStop(0.25, 'rgba(255,250,220,0.55)');
      grad.addColorStop(1, 'rgba(255,250,220,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      const tex = new THREE.CanvasTexture(c);
      const mat = new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
      for (let i = 0; i < this.lampHeads.length; i++) {
        const sp = new THREE.Sprite(mat);
        sp.position.copy(this.lampHeads[i]);
        const size = this.lampGlow[i].size;
        sp.scale.set(size, size, 1);
        this.group.add(sp);
        this.glows.push(sp);
      }
      const n = 600;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const e = 0.12 + Math.random() * 1.2;
        const r = 600;
        pos[i * 3] = Math.cos(a) * Math.cos(e) * r;
        pos[i * 3 + 1] = Math.sin(e) * r;
        pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.stars = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, fog: false }));
      this.group.add(this.stars);
    }
    for (const g of this.glows) g.visible = night;
    if (this.stars) this.stars.visible = night;
    // Floodlit night: the lawn keeps its light, everything the lamps aren't aimed at falls away.
    const stand = night ? [0.4, 0.42, 0.52] : [1, 1, 1];
    const outer = night ? [0.2, 0.22, 0.3] : [1, 1, 1];
    this.standMat.color.setRGB(stand[0], stand[1], stand[2]);
    for (const m of this.crowdMats) m.color.setRGB(stand[0] * 1.1, stand[1] * 1.1, stand[2] * 1.05);
    for (const m of this.bannerMats) m.color.setRGB(stand[0] * 1.2, stand[1] * 1.2, stand[2] * 1.1);
    this.outerMat.color.setRGB(outer[0], outer[1], outer[2]);
    this.groundMat.color.setRGB(outer[0], outer[1], outer[2]);
    this.night = night;
    for (const f of this.flares) f.visible = false;
    for (const c of this.clouds) {
      const m = (c as THREE.Mesh).material as THREE.MeshBasicMaterial;
      m.color.setHex(night ? 0x3a4a78 : t === 'sunset' ? 0xffd2b0 : 0xffffff);
    }
  }

  // ------------------------------------------------------------------ outside world (a wink at hop-across-the-road games)

  private buildSurroundings(): void {
    const rng = this.rng;
    const g = new BoxBuilder();
    // Ground tiles in alternating lanes.
    const R = 230;
    for (let z = -R; z < R; z += 6) {
      const lane = Math.floor(z / 6);
      g.box(0, -0.35, z + 3, R * 2, 0.5, 6, lane % 2 ? GRASS_OUT_A : shade(GRASS_OUT_B, 0.98));
    }
    // Roads encircling the ground.
    const roadZ = [-(STAND_Z + 33), STAND_Z + 19];
    for (const rz of roadZ) {
      g.box(0, -0.08, rz, R * 2, 0.06, 7, ROAD);
      for (let x = -R; x < R; x += 4) g.box(x, -0.04, rz, 1.8, 0.02, 0.22, 0xf6f4ec);
      g.box(0, -0.06, rz - 3.9, R * 2, 0.1, 0.8, shade(CONCRETE, 1.05));
      g.box(0, -0.06, rz + 3.9, R * 2, 0.1, 0.8, shade(CONCRETE, 1.05));
    }
    // A river beyond the far road with sandy banks.
    const riverZ = -(STAND_Z + 52);
    g.box(0, -0.2, riverZ, R * 2, 0.2, 10, WATER);
    g.box(0, -0.12, riverZ - 5.6, R * 2, 0.12, 1.4, SAND);
    g.box(0, -0.12, riverZ + 5.6, R * 2, 0.12, 1.4, SAND);
    // Car park strip behind the end stands.
    for (const sx of [-1, 1]) {
      const px = sx * (STAND_X + 24);
      g.box(px, -0.07, 0, 12, 0.06, 70, shade(ROAD, 1.15));
      for (let z = -32; z <= 32; z += 3.2) g.box(px, -0.03, z, 11, 0.02, 0.14, 0xf6f4ec);
    }
    const ground = new THREE.Mesh(g.build(), this.groundMat);
    ground.receiveShadow = true;
    this.group.add(ground);

    // Trees: trunk + stacked cubes.
    const t = new BoxBuilder();
    const tree = (x: number, z: number) => {
      const h = 0.9 + rng.next() * 1.2;
      const w = 1.8 + rng.next() * 1.4;
      t.box(x, h / 2, z, 0.55, h, 0.55, TRUNK);
      const leaf = rng.pick([LEAF_A, LEAF_B, LEAF_C]);
      const tiers = 1 + rng.int(3);
      let y = h;
      for (let i = 0; i < tiers; i++) {
        const s = w * (1 - i * 0.22);
        const th = 1.1 + rng.next() * 0.9;
        t.box(x, y + th / 2, z, s, th, s, shade(leaf, 1 - i * 0.04), { top: shade(leaf, 1.08) });
        y += th;
      }
    };
    const avoid = (x: number, z: number) =>
      (Math.abs(x) < STAND_X + 34 && Math.abs(z) < STAND_Z + 26) ||
      roadZ.some((rz) => Math.abs(z - rz) < 5) ||
      Math.abs(z - riverZ) < 7.5 ||
      (Math.abs(Math.abs(x) - (STAND_X + 24)) < 8 && Math.abs(z) < 38);
    for (let i = 0; i < 520; i++) {
      const x = (rng.next() - 0.5) * R * 2;
      const z = (rng.next() - 0.5) * R * 2;
      if (avoid(x, z)) continue;
      tree(Math.round(x / 2) * 2, Math.round(z / 2) * 2);
    }
    // Dense tree line hugging the stadium so the stands sit in a park.
    for (let x = -STAND_X - 26; x <= STAND_X + 26; x += 3.2 + rng.next() * 2) {
      if (rng.chance(0.8)) tree(x, -(STAND_Z + 26 + rng.next() * 1.5));
      if (rng.chance(0.8)) tree(x, STAND_Z + 13.5 + rng.next() * 1.5);
    }
    const trees = new THREE.Mesh(t.build(), this.outerMat);
    trees.castShadow = true;
    trees.receiveShadow = true;
    this.group.add(trees);

    // Traffic.
    const carCols = [0xe8443a, 0x2f6fe0, 0xffd23a, 0xf6f4ec, 0x2fae5a, 0xff8a2b, 0x8a55d8];
    roadZ.forEach((rz, ri) => {
      for (let i = 0; i < 7; i++) {
        const cb = new BoxBuilder();
        const c = rng.pick(carCols);
        const truck = rng.chance(0.25);
        const len = truck ? 5.2 : 3.2;
        cb.box(0, 0.55, 0, len, 0.8, 1.7, c, { top: shade(c, 1.1) });
        cb.box(truck ? len / 2 - 0.9 : -0.2, 1.25, 0, truck ? 1.6 : 1.8, 0.7, 1.55, truck ? c : 0xcfeaf7, { top: truck ? shade(c, 1.1) : 0xf6f4ec });
        for (const wx of [-len / 2 + 0.7, len / 2 - 0.7]) for (const wz of [-0.85, 0.85]) cb.box(wx, 0.28, wz, 0.6, 0.56, 0.24, 0x2a2a30);
        const car = new THREE.Mesh(cb.build(), this.outerMat);
        car.castShadow = true;
        const dir = ri === 0 ? (i % 2 ? 1 : -1) : i % 2 ? -1 : 1;
        car.position.set((rng.next() - 0.5) * R * 1.6, 0, rz + dir * 1.6);
        car.rotation.y = dir > 0 ? 0 : Math.PI;
        this.group.add(car);
        this.cars.push({ mesh: car, speed: dir * (7 + rng.next() * 6), lane: rz });
      }
    });
    // Logs drifting on the river.
    for (let i = 0; i < 8; i++) {
      const lb = new BoxBuilder();
      const len = 3 + rng.next() * 3;
      lb.box(0, 0, 0, len, 0.5, 1.1, TRUNK, { top: shade(TRUNK, 1.15) });
      const log = new THREE.Mesh(lb.build(), this.outerMat);
      log.position.set((rng.next() - 0.5) * R * 1.6, -0.05, riverZ + (i % 2 ? 2.2 : -2.2));
      this.group.add(log);
      this.logs.push({ mesh: log, speed: (i % 2 ? 1 : -1) * (1.4 + rng.next()) });
    }
    // Chunky clouds.
    for (let i = 0; i < 14; i++) {
      const cb = new BoxBuilder();
      const n = 2 + rng.int(3);
      for (let k = 0; k < n; k++) {
        cb.box(k * 3.5 - n * 1.5, rng.next() * 1.2, (rng.next() - 0.5) * 3, 5 + rng.next() * 3, 1.8 + rng.next(), 4 + rng.next() * 2, 0xffffff);
      }
      const cloud = new THREE.Mesh(cb.build(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.92 }));
      cloud.position.set((rng.next() - 0.5) * 400, 38 + rng.next() * 22, -120 - rng.next() * 140);
      this.group.add(cloud);
      this.clouds.push(cloud);
    }
  }

  private buildFlags(): void {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const pole = new BoxBuilder();
        pole.box(0, 0.8, 0, 0.07, 1.6, 0.07, 0xffd23a);
        const pm = new THREE.Mesh(pole.build(), voxelMaterial);
        pm.position.set(sx * HALF_L, 0, sz * HALF_W);
        pm.castShadow = true;
        const fb = new BoxBuilder();
        fb.box(0.25, 0, 0, 0.5, 0.36, 0.03, 0xe8443a);
        const flag = new THREE.Mesh(fb.build(), voxelMaterial);
        flag.position.set(0, 1.42, 0);
        pm.add(flag);
        this.flags.push(flag);
        this.pitch.add(pm);
      }
    }
  }

  private buildDugouts(): void {
    const b = new BoxBuilder();
    const rng = this.rng;
    const z0 = HALF_W + 1.9;
    for (const [sx, col] of [[-1, this.opt.home], [1, this.opt.away]] as const) {
      const cx = sx * 9;
      // Shelter: back wall, side walls, perspex roof, bench.
      b.box(cx, 0.9, z0 + 1.15, 7.2, 1.8, 0.2, shade(col, 0.75));
      b.box(cx - 3.5, 0.9, z0 + 0.6, 0.2, 1.8, 1.3, shade(col, 0.75));
      b.box(cx + 3.5, 0.9, z0 + 0.6, 0.2, 1.8, 1.3, shade(col, 0.75));
      b.box(cx, 1.85, z0 + 0.55, 7.4, 0.1, 1.5, 0xbfe6f5, { top: 0xd6f0fa });
      b.box(cx, 0.25, z0 + 0.8, 6.6, 0.5, 0.5, 0xf6f4ec);
      // Substitutes on the bench (seen from behind).
      for (let i = 0; i < 6; i++) {
        const x = cx - 2.8 + i * 1.1;
        b.box(x, 0.78, z0 + 0.85, 0.5, 0.56, 0.34, i % 3 === 0 ? 0x2a2a30 : col);
        b.box(x, 1.25, z0 + 0.85, 0.36, 0.36, 0.36, rng.pick(SKIN), { top: rng.pick(HAIR) });
      }
      // Manager standing in the technical area.
      const mx = cx + sx * -1.2;
      const mz = z0 - 0.9;
      b.box(mx - 0.13, 0.35, mz, 0.18, 0.7, 0.2, 0x2a2a30);
      b.box(mx + 0.13, 0.35, mz, 0.18, 0.7, 0.2, 0x2a2a30);
      b.box(mx, 0.98, mz, 0.56, 0.6, 0.34, sx < 0 ? 0x3a3f58 : 0x5a3a2a);
      b.box(mx, 1.5, mz, 0.42, 0.42, 0.42, rng.pick(SKIN), { top: rng.pick(HAIR) });
      b.box(mx, 0.76 + 0.3, mz - 0.18, 0.12, 0.3, 0.05, col);
    }
    // Fourth official's board.
    b.box(0, 0.5, HALF_W + 2.2, 0.8, 1, 0.8, 0x2a2a30, { top: 0xffd23a });
    const m = new THREE.Mesh(b.build(), voxelMaterial);
    m.castShadow = true;
    m.receiveShadow = true;
    this.group.add(m);
  }

  private buildPhotographers(): void {
    const b = new BoxBuilder();
    const rng = this.rng;
    for (const sx of [-1, 1]) {
      const x = sx * (HALF_L + 2.4);
      for (const zs of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
          const z = zs * (GOAL_W / 2 + 2.2 + i * 1.5 + rng.next() * 0.4);
          const face = -sx;
          const bib = i % 2 ? 0xff8a2b : 0x39a0ff;
          // Crouched: short body, head, camera with a lens pointing at the pitch.
          b.box(x, 0.3, z, 0.5, 0.6, 0.5, 0x2a2a30);
          b.box(x, 0.8, z, 0.52, 0.5, 0.42, bib);
          b.box(x, 1.25, z, 0.38, 0.38, 0.38, rng.pick(SKIN), { top: rng.pick(HAIR) });
          b.box(x + face * 0.32, 1.2, z, 0.2, 0.26, 0.3, 0x1c1c22);
          b.box(x + face * 0.5, 1.2, z, 0.2, 0.14, 0.14, 0x3a3a46);
        }
        this.flashSpots.push(new THREE.Vector3(x - sx * 0.62, 1.2, zs * (GOAL_W / 2 + 3)));
        this.flashSpots.push(new THREE.Vector3(x - sx * 0.62, 1.2, zs * (GOAL_W / 2 + 6)));
      }
    }
    const m = new THREE.Mesh(b.build(), voxelMaterial);
    m.castShadow = true;
    this.group.add(m);
  }

  private buildBanners(): void {
    const { home, homeName, away, awayName } = this.opt;
    const short = homeName.split(' ')[0].toUpperCase();
    const texts: [string, number, number][] = [
      [`${short} ${short} ${short}!`, home, 0xfbfbf4],
      ['BLOCK PARTY', 0xfbfbf4, home],
      ['ONE CLUB · ONE DREAM', shade(home, 0.75), 0xffd23a],
      [`${awayName.split(' ')[0].toUpperCase()} AWAY DAY`, away, 0xfbfbf4],
    ];
    const places: [number, number][] = BANNER_X.map((x, i) => [x, i]);
    for (const [x, ti] of places) {
      const [text, bg, fg] = texts[ti];
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 96;
      const g = c.getContext('2d')!;
      g.fillStyle = cssHex(bg);
      g.fillRect(0, 0, 512, 96);
      g.fillStyle = cssHex(fg);
      g.fillRect(0, 0, 512, 8);
      g.fillRect(0, 88, 512, 8);
      let size = 52;
      g.font = `700 ${size}px "Silkscreen", "Courier New", monospace`;
      const w = g.measureText(text).width;
      if (w > 470) {
        size = Math.floor(size * (470 / w));
        g.font = `700 ${size}px "Silkscreen", "Courier New", monospace`;
      }
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, 256, 50);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const bm = new THREE.MeshLambertMaterial({ map: tex });
      this.bannerMats.push(bm);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.9), bm);
      // Draped over the front of the far stand, a couple of rows up.
      mesh.position.set(x, 0.9 + 2 * STEP_H + 0.5, -(STAND_Z + 1.9 * STEP_D) + 0.02);
      mesh.rotation.x = -0.52;
      this.group.add(mesh);
    }
  }

  private buildFlashes(): void {
    for (const p of this.seatSpots) this.flashSpots.push(p);
    const n = this.flashSpots.length;
    const geo = new THREE.BoxGeometry(0.26, 0.26, 0.26);
    this.flashes = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }), n);
    this.flashes.frustumCulled = false;
    this.flashLife = new Float32Array(n);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < n; i++) this.flashes.setMatrixAt(i, zero);
    this.group.add(this.flashes);
  }

  /** Camera flashes pop around the ground when the crowd is up. */
  private updateFlashes(dt: number): void {
    const n = this.flashSpots.length;
    if (!n) return;
    const rate = this.hypeLevel > 0.7 ? 60 : this.hypeLevel > 0.4 ? 4 : 0.6;
    let dirty = false;
    let spawn = rate * dt;
    while (spawn > 0) {
      if (Math.random() < spawn) {
        const i = Math.floor(Math.random() * n);
        this.flashLife[i] = 0.07;
      }
      spawn -= 1;
    }
    for (let i = 0; i < n; i++) {
      const l = this.flashLife[i];
      if (l <= 0 && l > -1) {
        continue;
      }
      dirty = true;
      this.flashLife[i] = l - dt;
      if (this.flashLife[i] <= 0) {
        this.flashLife[i] = 0;
        this.flashes.setMatrixAt(i, this.m4.makeScale(0, 0, 0));
      } else {
        const p = this.flashSpots[i];
        const s = 0.6 + (this.flashLife[i] / 0.07) * 0.8;
        this.m4.makeScale(s, s, s).setPosition(p);
        this.flashes.setMatrixAt(i, this.m4);
      }
    }
    if (dirty) this.flashes.instanceMatrix.needsUpdate = true;
  }

  private buildScoreboard(): void {
    const b = new BoxBuilder();
    const right = this.profile('right');
    const x = STAND_X + 8;
    const y = right[right.length - 1].h + 4 + 3.6;
    b.box(x, y, 0, 1.2, 6.4, 16.6, 0x2a2a30);
    b.box(x, y / 2 - 1, -6, 0.8, y, 0.8, STEEL);
    b.box(x, y / 2 - 1, 6, 0.8, y, 0.8, STEEL);
    const m = new THREE.Mesh(b.build(), this.standMat);
    m.castShadow = true;
    this.group.add(m);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(15.6, 5.4), new THREE.MeshBasicMaterial({ map: this.scoreTex }));
    screen.position.set(x - 0.62, y, 0);
    screen.rotation.y = -Math.PI / 2;
    this.group.add(screen);
  }

  setScore(h: number, a: number, clock: string): void {
    const c = this.scoreCanvas;
    const g = c.getContext('2d')!;
    g.fillStyle = '#15151b';
    g.fillRect(0, 0, c.width, c.height);
    const cell = (x: number, w: number, color: number) => {
      g.fillStyle = cssHex(color);
      g.fillRect(x, 20, w, 80);
    };
    cell(16, 150, this.opt.home);
    cell(c.width - 166, 150, this.opt.away);
    g.fillStyle = '#fbfbf4';
    g.font = '900 56px "Lilita One", "Arial Black", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(this.opt.homeName.slice(0, 3).toUpperCase(), 91, 62);
    g.fillText(this.opt.awayName.slice(0, 3).toUpperCase(), c.width - 91, 62);
    g.font = '900 84px "Lilita One", "Arial Black", sans-serif';
    g.fillText(`${h}-${a}`, c.width / 2, 66);
    g.font = '700 30px "Lilita One", "Arial Black", sans-serif';
    g.fillStyle = '#ffd23a';
    g.fillText(clock, c.width / 2, 134);
    this.scoreTex.needsUpdate = true;
  }

  /** Snow settles on the lawn over ~30 s (and stays); rain / clear leave it green. */
  setWeather(kind: 'clear' | 'rain' | 'snow'): void {
    this.snowing = kind === 'snow';
    if (!this.snowing) {
      this.snowT = 0;
      this.snowPitch.value = 0;
      this.snowOuter.value = 0;
    }
  }

  /**
   * Night: the lamps sit above the broadcast frame, so their glare bleeds down from the top edge (a soft
   * glow hanging under each lamp), fading as the lens swings away. Lamps actually in shot use their halo.
   */
  updateGlare(cam: THREE.PerspectiveCamera): void {
    if (!this.night) return;
    if (this.flares.length === 0) this.buildFlares();
    cam.updateMatrixWorld();
    const v = this.flareV;
    const halfH = Math.tan(((cam.fov / 2) * Math.PI) / 180);
    const halfW = halfH * cam.aspect;
    const D = 12;
    for (let i = 0; i < this.lampHeads.length; i++) {
      const sp = this.flares[i];
      v.copy(this.lampHeads[i]).project(cam);
      const w = this.flareW.copy(this.lampHeads[i]).applyMatrix4(cam.matrixWorldInverse).z;
      const k = w > 0 || v.y < 0.95 ? 0 : (1 - smoothstep(0.95, 1.5, Math.abs(v.x))) * (1 - smoothstep(1.1, 4.5, v.y));
      if (k <= 0.01) {
        sp.visible = false;
        continue;
      }
      sp.visible = true;
      // Hang it from the top edge, 12 m in front of the lens: 18% of the width, 20% of the height.
      v.set(clamp(v.x, -1, 1), 0.8, 0.5).unproject(cam);
      sp.position.copy(cam.position).addScaledVector(v.sub(cam.position).normalize(), D);
      sp.scale.set(D * halfW * 2 * 0.18, D * halfH * 2 * 0.2, 1);
      (sp.material as THREE.SpriteMaterial).opacity = this.lampGlow[i].flare * k;
    }
  }

  private buildFlares(): void {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 0, 0, 64, 0, 64);
    grad.addColorStop(0, 'rgba(255,252,235,1)');
    grad.addColorStop(0.22, 'rgba(255,248,215,0.55)');
    grad.addColorStop(0.55, 'rgba(255,244,205,0.14)');
    grad.addColorStop(1, 'rgba(255,244,205,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    for (let i = 0; i < this.lampHeads.length; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true, fog: false,
      });
      const sp = new THREE.Sprite(mat);
      sp.renderOrder = 5;
      sp.visible = false;
      this.group.add(sp);
      this.flares.push(sp);
    }
  }

  update(dt: number, time: number): void {
    this.crowdUniforms.uTime.value = time;
    if (this.snowing && this.snowT < 40) {
      this.snowT += dt;
      const k = smoothstep(0, 30, this.snowT);
      this.snowPitch.value = 0.6 * k;
      this.snowOuter.value = 0.75 * k;
    }
    this.updateFlashes(dt);
    for (const n of this.nets) n.update(dt);
    for (const f of this.flags) f.rotation.y = Math.sin(time * 3 + f.id) * 0.35;
    for (const t of this.boardTex) t.offset.x = (t.offset.x + dt * 0.04) % 1;
    for (const c of this.cars) {
      c.mesh.position.x += c.speed * dt;
      if (c.mesh.position.x > 230) c.mesh.position.x = -230;
      if (c.mesh.position.x < -230) c.mesh.position.x = 230;
    }
    for (const l of this.logs) {
      l.mesh.position.x += l.speed * dt;
      if (l.mesh.position.x > 230) l.mesh.position.x = -230;
      if (l.mesh.position.x < -230) l.mesh.position.x = 230;
      l.mesh.position.y = -0.05 + Math.sin(time * 1.5 + l.mesh.id) * 0.04;
    }
    for (const c of this.clouds) {
      c.position.x += dt * 1.2;
      if (c.position.x > 260) c.position.x = -260;
    }
  }

  /** Free the GPU side of everything this stadium owns (not the shared voxel material or net texture). */
  dispose(): void {
    const seen = new Set<THREE.Material | THREE.Texture>();
    this.group.traverse((o) => {
      const mats = (o as THREE.Mesh).material;
      if (!mats) return;
      for (const m of Array.isArray(mats) ? mats : [mats]) {
        if (m === voxelMaterial || seen.has(m)) continue;
        seen.add(m);
        const map = (m as THREE.MeshBasicMaterial).map;
        if (map && map !== netTexture && !seen.has(map)) {
          seen.add(map);
          map.dispose();
        }
        m.dispose();
      }
    });
  }

  setHype(home: number, away: number, dt: number): void {
    const u = this.crowdUniforms;
    u.uHypeHome.value += (home - u.uHypeHome.value) * Math.min(1, dt * 2.5);
    u.uHypeAway.value += (away - u.uHypeAway.value) * Math.min(1, dt * 2.5);
    this.hypeLevel = Math.max(u.uHypeHome.value, u.uHypeAway.value);
  }
}

let netTexture: THREE.CanvasTexture | null = null;

/** Chunky net strands in a tiling alpha-tested texture. */
function getNetTexture(): THREE.CanvasTexture {
  if (netTexture) return netTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 64, 64);
  g.fillStyle = '#ffffff';
  for (let i = 0; i < 64; i += 16) {
    g.fillRect(i, 0, 2, 64);
    g.fillRect(0, i, 64, 2);
  }
  netTexture = new THREE.CanvasTexture(c);
  netTexture.wrapS = netTexture.wrapT = THREE.RepeatWrapping;
  netTexture.magFilter = THREE.NearestFilter;
  netTexture.anisotropy = 4;
  return netTexture;
}

/** Box-shaped net: textured panels whose vertices bulge when the ball hits them. */
class GoalNet {
  readonly mesh: THREE.Mesh;
  private base: Float32Array;
  private normal: Float32Array;
  private pos: THREE.BufferAttribute;
  private impacts: { y: number; z: number; amp: number; t: number }[] = [];

  constructor(readonly sign: number) {
    const verts: number[] = [];
    const norms: number[] = [];
    const uvs: number[] = [];
    const idx: number[] = [];
    const gx = sign * HALF_L;
    const bx = gx + sign * GOAL_DEPTH;
    const cell = 1 / 3; // metres per texture tile of 4 strands
    const panel = (
      w: number, h: number, nu: number, nv: number,
      at: (u: number, v: number) => [number, number, number],
      n: [number, number, number],
    ) => {
      const start = verts.length / 3;
      for (let j = 0; j <= nv; j++) {
        for (let i = 0; i <= nu; i++) {
          const p = at(i / nu, j / nv);
          verts.push(p[0], p[1], p[2]);
          norms.push(n[0], n[1], n[2]);
          uvs.push(((i / nu) * w) / (cell * 4), ((j / nv) * h) / (cell * 4));
        }
      }
      for (let j = 0; j < nv; j++) {
        for (let i = 0; i < nu; i++) {
          const a = start + j * (nu + 1) + i;
          idx.push(a, a + 1, a + nu + 2, a, a + nu + 2, a + nu + 1);
        }
      }
    };
    panel(GOAL_W, GOAL_H, 16, 8, (u, v) => [bx, v * GOAL_H, -GOAL_W / 2 + u * GOAL_W], [sign, 0, 0]);
    panel(GOAL_DEPTH, GOAL_W, 6, 16, (u, v) => [gx + sign * u * GOAL_DEPTH, GOAL_H, -GOAL_W / 2 + v * GOAL_W], [0, 1, 0]);
    for (const zs of [-1, 1]) {
      panel(GOAL_DEPTH, GOAL_H, 6, 8, (u, v) => [gx + sign * u * GOAL_DEPTH, v * GOAL_H, (zs * GOAL_W) / 2], [0, 0, zs]);
    }
    const geo = new THREE.BufferGeometry();
    this.base = new Float32Array(verts);
    this.normal = new Float32Array(norms);
    this.pos = new THREE.BufferAttribute(new Float32Array(verts), 3);
    geo.setAttribute('position', this.pos);
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    // Unlit so the strands read as bright string, not grey bars.
    const mat = new THREE.MeshBasicMaterial({
      color: 0xf6f6ee, map: getNetTexture(), alphaTest: 0.5, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat);
  }

  punch(y: number, z: number, amp: number): void {
    this.impacts.push({ y, z, amp, t: 0 });
    if (this.impacts.length > 3) this.impacts.shift();
  }

  update(dt: number): void {
    if (this.impacts.length === 0) return;
    for (const im of this.impacts) im.t += dt;
    this.impacts = this.impacts.filter((im) => im.t < 1.6);
    const p = this.pos.array as Float32Array;
    const b = this.base;
    const n = this.normal;
    for (let i = 0; i < b.length; i += 3) {
      let off = 0;
      for (const im of this.impacts) {
        const dy = b[i + 1] - im.y;
        const dz = b[i + 2] - im.z;
        const fall = Math.exp(-(dy * dy + dz * dz) / 0.9);
        off += im.amp * 0.55 * fall * Math.exp(-im.t * 3.2) * Math.cos(im.t * 16);
      }
      p[i] = b[i] + n[i] * off;
      p[i + 1] = b[i + 1] + n[i + 1] * off * 0.4;
      p[i + 2] = b[i + 2] + n[i + 2] * off;
    }
    this.pos.needsUpdate = true;
  }
}
