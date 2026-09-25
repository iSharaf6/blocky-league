import * as THREE from 'three';
import { Footballer, PSTATE, type PoseInput } from '../render/characters';
import { STADIUM_PREVIEW_VIEW, buildStadiumPreview, stadiumPreviewLights, type Stadium } from '../render/stadium';
import { BoxBuilder, voxelMaterial } from '../render/voxel';
import type { Kit, PlayerDef } from '../sim/types';

interface Stage {
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  player: Footballer;
  spin: number;
}

/**
 * Character-select style 3D previews: each canvas shows a voxel player in the kit,
 * turning on a grass block. One tiny shared renderer draws them all.
 */
export class KitPreview {
  private renderer: THREE.WebGLRenderer | null = null;
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  private stages: Stage[] = [];
  private raf = 0;
  private t0 = performance.now();

  constructor() {
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.shadowMap.enabled = true;
    } catch {
      this.renderer = null; // No second context available: the pixel shirt stays.
    }
    this.camera.position.set(2.6, 1.9, 3.4);
    this.camera.lookAt(0, 0.95, 0);
  }

  get ok(): boolean {
    return this.renderer !== null;
  }

  set(i: number, canvas: HTMLCanvasElement, def: PlayerDef, kit: Kit): void {
    const old = this.stages[i];
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xd6e8ff, 0x7a9a5c, 1.4));
    const sun = new THREE.DirectionalLight(0xfff6e6, 2.6);
    sun.position.set(-3, 5, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(512, 512);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -2;
    sc.right = sc.top = 2;
    scene.add(sun);
    const b = new BoxBuilder();
    b.box(0, -0.2, 0, 1.9, 0.4, 1.9, 0x6f9e3a, { top: 0x9ed25a });
    b.box(0, -0.52, 0, 1.6, 0.24, 1.6, 0x8a5a36);
    const block = new THREE.Mesh(b.build(), voxelMaterial);
    block.receiveShadow = true;
    scene.add(block);
    const player = new Footballer(def, kit, false);
    scene.add(player.group);
    this.stages[i] = { canvas, scene, player, spin: old?.spin ?? i * 1.3 };
    if (!this.raf) this.loop();
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    const r = this.renderer;
    if (!r) return;
    const time = (performance.now() - this.t0) / 1000;
    for (const s of this.stages) {
      if (!s || !s.canvas.isConnected) continue;
      const w = s.canvas.clientWidth;
      const h = s.canvas.clientHeight;
      if (w === 0 || h === 0) continue;
      const dpr = r.getPixelRatio();
      if (s.canvas.width !== Math.round(w * dpr) || s.canvas.height !== Math.round(h * dpr)) {
        s.canvas.width = Math.round(w * dpr);
        s.canvas.height = Math.round(h * dpr);
      }
      r.setSize(w, h, false);
      this.camera.aspect = w / h;
      // Tall canvases: step back so the grass block isn't cropped at the sides. The extra distance and the
      // higher aim keep the head clear of the YOU / RIVAL tag even at the top of the celebration hop
      // (~2.35 m: the head peaks around 70% up the frame).
      const back = 1.32 / Math.min(1, this.camera.aspect);
      this.camera.position.set(2.6 * back, 1.9 + (back - 1) * 0.6, 3.4 * back);
      this.camera.lookAt(0, 1.3, 0);
      this.camera.updateProjectionMatrix();
      s.spin += 0.012;
      s.player.group.rotation.y = s.spin;
      // A little celebratory hop every few seconds, otherwise idle breathing.
      const cycle = (time + s.spin) % 4;
      const pose: PoseInput = {
        state: cycle > 3.2 ? PSTATE.celebrate : PSTATE.move,
        stateT: 0, speed: 0, runPhase: 0, kickT: 0, kickLeg: 1, lean: 0, diveDir: 0, headerT: 0,
        celebrate: 0, y: 0, keeper: false, hasBall: false, look: 0, turn: 0,
      };
      s.player.pose(pose, time);
      r.render(s.scene, this.camera);
      const g = s.canvas.getContext('2d');
      if (g) {
        g.clearRect(0, 0, s.canvas.width, s.canvas.height);
        g.drawImage(r.domElement, 0, 0, s.canvas.width, s.canvas.height);
      }
    }
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.stages = [];
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer = null;
  }
}

interface StadiumStage {
  canvas: HTMLCanvasElement;
  level: number;
  scene: THREE.Scene;
  stadium: Stadium;
  /** Orbit phase offset, so two previews side by side don't turn in lockstep. */
  phase: number;
}

export interface StadiumLook {
  home?: number;
  away?: number;
  homeName?: string;
}

/**
 * Upgrade-screen stadium previews: the ground at a level, slowly orbiting, in a small canvas. Like
 * KitPreview, one small renderer draws every canvas (copied across with drawImage), at ~30 fps.
 * Always dispose() when the screen closes; it also stops by itself once its canvases leave the page.
 */
export class StadiumPreview {
  private renderer: THREE.WebGLRenderer | null = null;
  private camera = new THREE.PerspectiveCamera(STADIUM_PREVIEW_VIEW.fov, 16 / 10, 1, 1200);
  private stages: (StadiumStage | undefined)[] = [];
  private raf = 0;
  private t0 = performance.now();
  private last = 0;
  private idle = 0;
  private readonly target = new THREE.Vector3(...STADIUM_PREVIEW_VIEW.target);
  private readonly radius: number;
  private readonly height: number;
  private readonly angle0: number;

  constructor(private readonly look: StadiumLook = {}) {
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    } catch {
      this.renderer = null; // No second WebGL context: the caller keeps its flat drawing.
    }
    const [px, py, pz] = STADIUM_PREVIEW_VIEW.position;
    const dx = px - this.target.x;
    const dz = pz - this.target.z;
    this.radius = Math.hypot(dx, dz);
    this.height = py - this.target.y;
    this.angle0 = Math.atan2(dz, dx);
  }

  get ok(): boolean {
    return this.renderer !== null;
  }

  /** Show the ground at `level` in `canvas` (slot `i`); rebuilds only when the level changes. */
  set(i: number, canvas: HTMLCanvasElement, level: number): void {
    if (!this.renderer) return;
    // After an upgrade the old NEXT ground is the new NOW one: move it across instead of rebuilding.
    const j = this.stages.findIndex((st, k) => k !== i && st?.level === level);
    if (j >= 0 && this.stages[i]?.level !== level) [this.stages[i], this.stages[j]] = [this.stages[j], this.stages[i]];
    const old = this.stages[i];
    if (old && old.level === level) {
      old.canvas = canvas;
    } else {
      if (old) old.stadium.dispose();
      const scene = new THREE.Scene();
      for (const l of stadiumPreviewLights()) scene.add(l);
      const stadium = buildStadiumPreview(level, {
        home: this.look.home,
        away: this.look.away,
        homeName: this.look.homeName,
        seed: 11 + level,
      });
      scene.add(stadium.group);
      this.stages[i] = { canvas, level, scene, stadium, phase: i * 0.9 };
    }
    this.idle = 0;
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.loop);
    }
  }

  /** Drop slot `i` (e.g. the NEXT view once the ground is fully upgraded). */
  clear(i: number): void {
    const st = this.stages[i];
    if (!st) return;
    st.stadium.dispose();
    this.stages[i] = undefined;
  }

  private loop = (now: number): void => {
    this.raf = requestAnimationFrame(this.loop);
    const r = this.renderer;
    if (!r) return;
    if (now - this.last < 32) return; // ~30 fps is plenty for a slow orbit
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const time = (now - this.t0) / 1000;
    let drawn = 0;
    for (const s of this.stages) {
      if (!s || !s.canvas.isConnected) continue;
      const w = s.canvas.clientWidth;
      const h = s.canvas.clientHeight;
      if (w === 0 || h === 0) continue;
      drawn++;
      const dpr = r.getPixelRatio();
      const bw = Math.round(w * dpr);
      const bh = Math.round(h * dpr);
      if (s.canvas.width !== bw || s.canvas.height !== bh) {
        s.canvas.width = bw;
        s.canvas.height = bh;
      }
      r.setSize(w, h, false);
      const cam = this.camera;
      cam.aspect = w / h;
      // Narrow canvases step back so the whole ground stays in shot as it turns.
      const back = Math.max(1, 1.6 / cam.aspect);
      const a = this.angle0 + Math.sin(time * 0.12 + s.phase) * 0.55 + time * 0.05;
      cam.position.set(
        this.target.x + Math.cos(a) * this.radius * back,
        this.target.y + this.height * back,
        this.target.z + Math.sin(a) * this.radius * back,
      );
      cam.lookAt(this.target);
      cam.updateProjectionMatrix();
      s.stadium.update(dt, time);
      r.render(s.scene, cam);
      const g = s.canvas.getContext('2d');
      if (g) {
        g.clearRect(0, 0, bw, bh);
        g.drawImage(r.domElement, 0, 0, bw, bh);
      }
    }
    // Screen gone (closed some other way): let go after a second.
    this.idle = drawn ? 0 : this.idle + dt;
    if (this.idle > 1) this.dispose();
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const s of this.stages) s?.stadium.dispose();
    this.stages = [];
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer = null;
  }
}

/**
 * Flat isometric drawing of a ground at `level` (SVG), for when no WebGL preview is available: the pitch,
 * then the stands that level adds (main stand, a second side, two tiers, the ends, the bowl roof).
 */
export function stadiumIsoSvg(level: number): string {
  const L = Math.max(0, Math.min(5, Math.round(level)));
  const P = (x: number, y: number, z: number): [number, number] => [(x - y) * 0.87, (x + y) * 0.5 - z];
  type Box = { x: number; y: number; w: number; d: number; h: number; c: [string, string, string] };
  const boxes: Box[] = [];
  const stand: [string, string, string] = ['#e8e4d8', '#bdb8aa', '#9d988b'];
  const seat: [string, string, string] = ['#e8443a', '#bf3029', '#9b241f'];
  const add = (x: number, y: number, w: number, d: number, h: number, c = stand) => boxes.push({ x, y, w, d, h, c });
  // Pitch 48 x 30 (half size units), stands around it.
  if (L === 0) {
    add(-26, -18, 52, 1, 1.2, ['#a7753f', '#8a5a36', '#6f4629']); // a fence on the far side
  }
  if (L >= 1) add(-20, -24, 40, 6, L >= 3 ? 11 : 6, seat); // main stand (far side), two tiers from level 3
  if (L >= 2) add(-20, 17, 40, 4, 3.5); // low near stand
  if (L >= 4) {
    add(-31, -16, 5, 32, L >= 5 ? 10 : 6, seat); // ends
    add(26, -16, 5, 32, L >= 5 ? 10 : 6, seat);
  }
  if (L >= 5) {
    add(-31, -24, 11, 8, 11, seat); // corners of the bowl
    add(20, -24, 11, 8, 11, seat);
  }
  const poly = (pts: [number, number][], fill: string) =>
    `<polygon points="${pts.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' ')}" fill="${fill}"/>`;
  let out = '';
  // Pitch slab with stripes.
  out += poly([P(-26, -18, 0), P(26, -18, 0), P(26, 18, 0), P(-26, 18, 0)], '#86c653');
  for (let i = 0; i < 6; i += 2) out += poly([P(-26 + i * 8.67, -18, 0), P(-26 + (i + 1) * 8.67, -18, 0), P(-26 + (i + 1) * 8.67, 18, 0), P(-26 + i * 8.67, 18, 0)], '#7cbb4a');
  out += poly([P(-26, 18, 0), P(26, 18, 0), P(26, 18, -2), P(-26, 18, -2)], '#8a5a36');
  out += poly([P(26, -18, 0), P(26, 18, 0), P(26, 18, -2), P(26, -18, -2)], '#6f4629');
  // Far to near (painter's order).
  boxes.sort((a, b) => a.x + a.y - (b.x + b.y));
  for (const b of boxes) {
    const { x, y, w, d, h, c } = b;
    out += poly([P(x, y, h), P(x + w, y, h), P(x + w, y + d, h), P(x, y + d, h)], c[0]);
    out += poly([P(x, y + d, h), P(x + w, y + d, h), P(x + w, y + d, 0), P(x, y + d, 0)], c[1]);
    out += poly([P(x + w, y, h), P(x + w, y + d, h), P(x + w, y + d, 0), P(x + w, y, 0)], c[2]);
  }
  return `<svg class="mc-stadiso" viewBox="-52 -38 104 66" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${out}</svg>`;
}
