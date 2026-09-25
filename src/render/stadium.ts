import * as THREE from 'three';
import { Rng } from '../core/rng';
import {
  BOX_DEPTH, BOX_W, CENTER_R, GOAL_DEPTH, GOAL_H, GOAL_W, HALF_L, HALF_W, PEN_SPOT, SIX_DEPTH, SIX_W,
} from '../sim/constants';
import {
  CONCRETE, CONCRETE_DARK, GRASS_A, GRASS_B, GRASS_OUT_A, GRASS_OUT_B, HAIR, LEAF_A, LEAF_B, LEAF_C, LINE,
  ROAD, SAND, SKIN, STEEL, TRUNK, WATER, cssHex, mix, shade,
} from './palette';
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

const LINE_W = 0.14;
const BOARD_Z = HALF_W + 3.2;
const BOARD_X = HALF_L + 4.6;
const STAND_Z = HALF_W + 5.6;
const STAND_X = HALF_L + 6.2;
const STEP_D = 0.86;
const STEP_H = 0.56;

export class Stadium {
  readonly group = new THREE.Group();
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

  constructor(readonly opt: StadiumOptions) {
    this.rng = new Rng(opt.seed ?? 42);
    this.buildPitch();
    this.buildGoals();
    this.buildBoards();
    this.buildStands();
    this.buildCrowd();
    this.buildFloodlights();
    this.buildSurroundings();
    this.buildFlags();
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
    const b = new BoxBuilder();
    const ext = { x: HALF_L + 7, z: HALF_W + 6 };
    // Mowing stripes: 16 across the pitch, continuing into the run-off.
    const stripe = (HALF_L * 2) / 16;
    for (let x = -ext.x; x < ext.x; x += stripe) {
      const i = Math.floor((x + HALF_L) / stripe + 1e-3);
      const inPitch = x >= -HALF_L - 1e-3 && x < HALF_L;
      const w = Math.min(stripe, ext.x - x);
      const colIn = i % 2 === 0 ? GRASS_A : GRASS_B;
      const colOut = i % 2 === 0 ? GRASS_OUT_A : GRASS_OUT_B;
      // Pitch body
      if (inPitch) b.box(x + w / 2, -0.05, 0, w, 0.1, HALF_W * 2, colIn);
      else b.box(x + w / 2, -0.05, 0, w, 0.1, HALF_W * 2, colOut);
      // Run-off strips along the touchlines
      b.box(x + w / 2, -0.05, -(HALF_W + (ext.z - HALF_W) / 2), w, 0.1, ext.z - HALF_W, colOut);
      b.box(x + w / 2, -0.05, HALF_W + (ext.z - HALF_W) / 2, w, 0.1, ext.z - HALF_W, colOut);
    }
    const grass = new THREE.Mesh(b.build(), voxelMaterial);
    grass.receiveShadow = true;
    this.group.add(grass);

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
    const lines = new THREE.Mesh(L.build(), voxelMaterial);
    lines.receiveShadow = true;
    lines.position.y = 0.004;
    this.group.add(lines);
  }

  // ------------------------------------------------------------------ goals

  private buildGoals(): void {
    for (const s of [-1, 1]) {
      const b = new BoxBuilder();
      const gx = s * HALF_L;
      const t = 0.16;
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
      this.group.add(frame);
      const net = new GoalNet(s);
      this.nets.push(net);
      this.group.add(net.lines);
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

  private standRows(side: 'far' | 'near' | 'left' | 'right'): number {
    return side === 'far' ? 17 : side === 'near' ? 7 : 11;
  }

  private buildStands(): void {
    const b = new BoxBuilder();
    const { home, away } = this.opt;
    const standSpan = (side: 'far' | 'near' | 'left' | 'right') => (side === 'far' || side === 'near' ? HALF_L + 5 : HALF_W + 4);
    const sides: ('far' | 'near' | 'left' | 'right')[] = ['far', 'near', 'left', 'right'];
    for (const side of sides) {
      const rows = this.standRows(side);
      const span = standSpan(side);
      const seatCol = side === 'right' ? away : home;
      for (let i = 0; i < rows; i++) {
        const top = 0.9 + i * STEP_H;
        const d = STAND_Z + i * STEP_D + STEP_D / 2;
        const band = i % 5 === 4 ? shade(seatCol, 0.8) : i % 2 ? CONCRETE : CONCRETE_DARK;
        const riser = mix(seatCol, 0xffffff, 0.15);
        if (side === 'far' || side === 'near') {
          const z = side === 'far' ? -d : d;
          b.box(0, top / 2, z, span * 2, top, STEP_D, riser, { top: band, skipBottom: true });
        } else {
          const x = side === 'left' ? -(STAND_X + i * STEP_D + STEP_D / 2) : STAND_X + i * STEP_D + STEP_D / 2;
          b.box(x, top / 2, 0, STEP_D, top, span * 2, riser, { top: band, skipBottom: true });
        }
      }
      // Front wall with a painted band.
      if (side === 'far' || side === 'near') {
        const z = (side === 'far' ? -1 : 1) * (STAND_Z - 0.2);
        b.box(0, 0.6, z, span * 2, 1.2, 0.4, shade(home, 0.9), { top: 0xfbfbf4 });
      } else {
        const x = (side === 'left' ? -1 : 1) * (STAND_X - 0.2);
        b.box(x, 0.6, 0, 0.4, 1.2, span * 2, shade(side === 'right' ? away : home, 0.9), { top: 0xfbfbf4 });
      }
    }
    // Corners: low blocks so there are no holes.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (let i = 0; i < 8; i++) {
          const top = 0.9 + i * STEP_H;
          const x = sx * (HALF_L + 5 + 3.5);
          const z = sz * (STAND_Z + i * STEP_D + STEP_D / 2);
          b.box(x, top / 2, z, 7, top, STEP_D, i % 2 ? CONCRETE : CONCRETE_DARK, { skipBottom: true });
        }
      }
    }
    // Far stand roof: canopy on stilts, with a stadium sign.
    const farRows = this.standRows('far');
    const backZ = -(STAND_Z + farRows * STEP_D);
    const roofY = 0.9 + farRows * STEP_H + 4.2;
    b.box(0, roofY, backZ + 6.5, HALF_L * 2 + 12, 0.35, 15, 0xeeeae0, { top: 0xf6f4ec });
    b.box(0, roofY - 0.55, backZ + 13.8, HALF_L * 2 + 12, 1.1, 0.5, shade(home, 0.8));
    for (let x = -HALF_L; x <= HALF_L; x += 16) {
      b.box(x, roofY / 2, backZ + 0.4, 0.6, roofY, 0.6, STEEL);
      b.box(x, roofY - 0.9, backZ + 6.5, 0.4, 0.4, 13, STEEL);
    }
    // Back wall of the far stand.
    b.box(0, (roofY - 0.2) / 2, backZ - 0.3, HALF_L * 2 + 12, roofY - 0.2, 0.6, shade(CONCRETE, 0.92));
    const m = new THREE.Mesh(b.build(), voxelMaterial);
    m.receiveShadow = true;
    m.castShadow = true;
    this.group.add(m);

    // Stadium name on the roof fascia.
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = cssHex(shade(home, 0.8));
    g.fillRect(0, 0, 1024, 64);
    g.fillStyle = '#fbfbf4';
    g.font = '900 44px "Lilita One", "Arial Black", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(`${this.opt.homeName.toUpperCase()}  ·  BLOCKY LEAGUE  ·  ${this.opt.homeName.toUpperCase()}`, 512, 36);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(80, 1), new THREE.MeshBasicMaterial({ map: tex }));
    sign.position.set(0, roofY - 0.55, backZ + 14.07);
    this.group.add(sign);
  }

  private buildCrowd(): void {
    const rng = this.rng;
    const att = this.opt.attendance;
    type Seat = { x: number; y: number; z: number; rot: number; team: number };
    const seats: Seat[] = [];
    const sides: ('far' | 'near' | 'left' | 'right')[] = ['far', 'near', 'left', 'right'];
    for (const side of sides) {
      const rows = this.standRows(side);
      const span = side === 'far' || side === 'near' ? HALF_L + 4.5 : HALF_W + 3.5;
      for (let i = 0; i < rows; i++) {
        const y = 0.9 + i * STEP_H;
        const d = STAND_Z + i * STEP_D + STEP_D * 0.45;
        for (let t = -span; t <= span; t += 0.78) {
          if (!rng.chance(att * (0.92 - (i / rows) * 0.25))) continue;
          const jitter = (rng.next() - 0.5) * 0.12;
          let x: number, z: number, rot: number;
          if (side === 'far') { x = t + jitter; z = -d; rot = 0; }
          else if (side === 'near') { x = t + jitter; z = d; rot = Math.PI; }
          else if (side === 'left') { x = -(STAND_X + i * STEP_D + STEP_D * 0.45); z = t + jitter; rot = -Math.PI / 2; }
          else { x = STAND_X + i * STEP_D + STEP_D * 0.45; z = t + jitter; rot = Math.PI / 2; }
          // Away fans cluster in the right-hand end.
          const team = side === 'right' ? (rng.chance(0.85) ? 1 : 0) : rng.chance(0.9) ? 0 : 2;
          seats.push({ x, y, z, rot, team });
        }
      }
    }
    const n = seats.length;
    const bodyGeo = new THREE.BoxGeometry(0.46, 0.52, 0.32);
    bodyGeo.translate(0, 0.26, 0);
    const headGeo = new THREE.BoxGeometry(0.34, 0.34, 0.34);
    headGeo.translate(0, 0.52 + 0.17, 0);
    const hairGeo = new THREE.BoxGeometry(0.36, 0.1, 0.36);
    hairGeo.translate(0, 0.52 + 0.34 + 0.02, 0);
    const mat = this.crowdMaterial();
    const bodies = new THREE.InstancedMesh(bodyGeo, mat, n);
    const heads = new THREE.InstancedMesh(headGeo, mat, n);
    const hair = new THREE.InstancedMesh(hairGeo, mat, n);
    const phase = new Float32Array(n);
    const team = new Float32Array(n);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    const { home, away } = this.opt;
    const neutral = [0xe8443a, 0x2f6fe0, 0xffd23a, 0x2fae5a, 0xf6f4ec, 0x2a2a30, 0xff79b0, 0x8a55d8];
    seats.forEach((s, i) => {
      q.setFromAxisAngle(up, s.rot + (rng.next() - 0.5) * 0.3);
      const sc = 0.9 + rng.next() * 0.22;
      m4.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(sc, sc, sc));
      bodies.setMatrixAt(i, m4);
      heads.setMatrixAt(i, m4);
      hair.setMatrixAt(i, m4);
      const kitCol = s.team === 0 ? home : s.team === 1 ? away : rng.pick(neutral);
      const shirt = rng.chance(0.78) ? kitCol : rng.chance(0.5) ? 0xf6f4ec : rng.pick(neutral);
      bodies.setColorAt(i, col.setHex(shade(shirt, 0.88 + rng.next() * 0.2)));
      heads.setColorAt(i, col.setHex(rng.pick(SKIN)));
      hair.setColorAt(i, col.setHex(rng.chance(0.2) ? kitCol : rng.pick(HAIR)));
      phase[i] = rng.next();
      team[i] = s.team;
    });
    for (const im of [bodies, heads, hair]) {
      im.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
      im.geometry.setAttribute('aTeam', new THREE.InstancedBufferAttribute(team, 1));
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.frustumCulled = false;
      this.group.add(im);
    }
  }

  private crowdMaterial(): THREE.Material {
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
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
          transformed.y += hop * hop * mix(0.02, 0.42, hype) * joins + idle;`,
        );
    };
    return mat;
  }

  // ------------------------------------------------------------------ floodlights

  private buildFloodlights(): void {
    const b = new BoxBuilder();
    const lamps = new BoxBuilder();
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = sx * (HALF_L + 13);
        const z = sz * (HALF_W + 16);
        const h = 26;
        b.box(x, h / 2, z, 0.9, h, 0.9, STEEL);
        b.box(x, h / 2, z, 1.4, 0.4, 1.4, shade(STEEL, 1.2));
        const rot = Math.atan2(-x, -z) + Math.PI;
        b.box(x, h + 1.6, z, 6, 3.4, 0.6, 0x3a3f48, { rotY: rot });
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
    const m = new THREE.Mesh(b.build(), voxelMaterial);
    m.castShadow = true;
    this.group.add(m);
    const l = new THREE.Mesh(lamps.build(), new THREE.MeshBasicMaterial({ vertexColors: true }));
    this.group.add(l);
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
    const roadZ = [-(STAND_Z + 26), STAND_Z + 22];
    for (const rz of roadZ) {
      g.box(0, -0.08, rz, R * 2, 0.06, 7, ROAD);
      for (let x = -R; x < R; x += 4) g.box(x, -0.04, rz, 1.8, 0.02, 0.22, 0xf6f4ec);
      g.box(0, -0.06, rz - 3.9, R * 2, 0.1, 0.8, shade(CONCRETE, 1.05));
      g.box(0, -0.06, rz + 3.9, R * 2, 0.1, 0.8, shade(CONCRETE, 1.05));
    }
    // A river beyond the far road with sandy banks.
    const riverZ = -(STAND_Z + 44);
    g.box(0, -0.2, riverZ, R * 2, 0.2, 10, WATER);
    g.box(0, -0.12, riverZ - 5.6, R * 2, 0.12, 1.4, SAND);
    g.box(0, -0.12, riverZ + 5.6, R * 2, 0.12, 1.4, SAND);
    // Car park strip behind the end stands.
    for (const sx of [-1, 1]) {
      const px = sx * (STAND_X + 18);
      g.box(px, -0.07, 0, 12, 0.06, 70, shade(ROAD, 1.15));
      for (let z = -32; z <= 32; z += 3.2) g.box(px, -0.03, z, 11, 0.02, 0.14, 0xf6f4ec);
    }
    const ground = new THREE.Mesh(g.build(), voxelMaterial);
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
      (Math.abs(x) < STAND_X + 30 && Math.abs(z) < STAND_Z + 20) ||
      roadZ.some((rz) => Math.abs(z - rz) < 5) ||
      Math.abs(z - riverZ) < 7.5 ||
      (Math.abs(Math.abs(x) - (STAND_X + 18)) < 8 && Math.abs(z) < 38);
    for (let i = 0; i < 520; i++) {
      const x = (rng.next() - 0.5) * R * 2;
      const z = (rng.next() - 0.5) * R * 2;
      if (avoid(x, z)) continue;
      tree(Math.round(x / 2) * 2, Math.round(z / 2) * 2);
    }
    // Dense tree line hugging the stadium so the stands sit in a park.
    for (let x = -STAND_X - 26; x <= STAND_X + 26; x += 3.2 + rng.next() * 2) {
      if (rng.chance(0.8)) tree(x, -(STAND_Z + 19 + rng.next() * 2));
      if (rng.chance(0.8)) tree(x, STAND_Z + 15 + rng.next() * 2);
    }
    const trees = new THREE.Mesh(t.build(), voxelMaterial);
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
        const car = new THREE.Mesh(cb.build(), voxelMaterial);
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
      const log = new THREE.Mesh(lb.build(), voxelMaterial);
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
        this.group.add(pm);
      }
    }
  }

  private buildScoreboard(): void {
    const b = new BoxBuilder();
    const x = STAND_X + 11 * STEP_D + 2;
    const y = 0.9 + 11 * STEP_H + 4.5;
    b.box(x, y, 0, 1.2, 6.4, 16.6, 0x2a2a30);
    b.box(x, y / 2 - 1, -6, 0.8, y, 0.8, STEEL);
    b.box(x, y / 2 - 1, 6, 0.8, y, 0.8, STEEL);
    const m = new THREE.Mesh(b.build(), voxelMaterial);
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

  update(dt: number, time: number): void {
    this.crowdUniforms.uTime.value = time;
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

  setHype(home: number, away: number, dt: number): void {
    const u = this.crowdUniforms;
    u.uHypeHome.value += (home - u.uHypeHome.value) * Math.min(1, dt * 2.5);
    u.uHypeAway.value += (away - u.uHypeAway.value) * Math.min(1, dt * 2.5);
  }
}

/** Box-shaped net drawn as a line lattice that bulges when the ball hits it. */
class GoalNet {
  readonly lines: THREE.LineSegments;
  private base: Float32Array;
  private normal: Float32Array;
  private pos: THREE.BufferAttribute;
  private impacts: { y: number; z: number; amp: number; t: number }[] = [];

  constructor(readonly sign: number) {
    const verts: number[] = [];
    const norms: number[] = [];
    const idx: number[] = [];
    const gx = sign * HALF_L;
    const bx = gx + sign * GOAL_DEPTH;
    const step = 0.26;
    const grid = (
      w: number, h: number,
      at: (u: number, v: number) => [number, number, number],
      n: [number, number, number],
    ) => {
      const nu = Math.round(w / step);
      const nv = Math.round(h / step);
      const start = verts.length / 3;
      for (let j = 0; j <= nv; j++) {
        for (let i = 0; i <= nu; i++) {
          const p = at(i / nu, j / nv);
          verts.push(p[0], p[1], p[2]);
          norms.push(n[0], n[1], n[2]);
        }
      }
      for (let j = 0; j <= nv; j++) {
        for (let i = 0; i <= nu; i++) {
          const a = start + j * (nu + 1) + i;
          if (i < nu) idx.push(a, a + 1);
          if (j < nv) idx.push(a, a + nu + 1);
        }
      }
    };
    // back
    grid(GOAL_W, GOAL_H, (u, v) => [bx, v * GOAL_H, -GOAL_W / 2 + u * GOAL_W], [sign, 0, 0]);
    // roof
    grid(GOAL_DEPTH, GOAL_W, (u, v) => [gx + sign * u * GOAL_DEPTH, GOAL_H, -GOAL_W / 2 + v * GOAL_W], [0, 1, 0]);
    // sides
    for (const zs of [-1, 1]) {
      grid(GOAL_DEPTH, GOAL_H, (u, v) => [gx + sign * u * GOAL_DEPTH, v * GOAL_H, (zs * GOAL_W) / 2], [0, 0, zs]);
    }
    const geo = new THREE.BufferGeometry();
    this.base = new Float32Array(verts);
    this.normal = new Float32Array(norms);
    this.pos = new THREE.BufferAttribute(new Float32Array(verts), 3);
    geo.setAttribute('position', this.pos);
    geo.setIndex(idx);
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xf2f2ea, transparent: true, opacity: 0.75 }));
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
