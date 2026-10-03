import * as THREE from 'three';
import { Footballer, PSTATE, type PoseInput } from '../render/characters';
import { STADIUM_PREVIEW_VIEW, buildStadiumPreview, stadiumPreviewLights, type Stadium } from '../render/stadium';
import { BoxBuilder, voxelMaterial } from '../render/voxel';
import type { Kit, PlayerDef } from '../sim/types';

interface Stage {
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  player: Footballer;
  /** Seconds into the turntable cycle when shown (side-by-side previews never turn in lockstep). */
  spin: number;
  /** Preview clock (s) when this player was put up: every new player starts facing the camera. */
  born: number;
}

/** Base camera spot for the kit previews (scaled back for tall canvases). */
const PV_CAM = { x: 2.6, y: 1.9, z: 3.4 };
/** Body yaw that points the face (model +x) straight at the preview camera. */
const FACE_CAMERA = Math.atan2(-PV_CAM.z, PV_CAM.x);
/** Turntable: sway gently facing the camera, then one smooth full turn, every TURN_CYCLE seconds. */
const TURN_CYCLE = 9;
const TURN_HOLD = 5;

/** Yaw offset from facing the camera at `u` seconds into the cycle (0 at the start: face first). */
export function turntableYaw(u: number): number {
  const t = ((u % TURN_CYCLE) + TURN_CYCLE) % TURN_CYCLE;
  if (t < TURN_HOLD) return 0.32 * Math.sin((t / TURN_HOLD) * Math.PI * 2);
  const k = (t - TURN_HOLD) / (TURN_CYCLE - TURN_HOLD);
  return Math.PI * 2 * k * k * (3 - 2 * k);
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
    this.camera.position.set(PV_CAM.x, PV_CAM.y, PV_CAM.z);
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
    const born = (performance.now() - this.t0) / 1000;
    this.stages[i] = { canvas, scene, player, spin: old?.spin ?? i * 2.2, born };
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
      this.camera.position.set(PV_CAM.x * back, PV_CAM.y + (back - 1) * 0.6, PV_CAM.z * back);
      this.camera.lookAt(0, 1.3, 0);
      this.camera.updateProjectionMatrix();
      // Face the camera first (a character-select card, not the back of a shirt), then show off the kit.
      s.player.group.rotation.y = FACE_CAMERA + turntableYaw(time - s.born + s.spin);
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
      // (2x like the kit previews: a small card, sharp on a phone's 3x screen.)
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
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

// ------------------------------------------------------------------ player faces

/**
 * Voxel head shots for the squad lists, transfers and Man of the Match: the real match model (same head,
 * hair, beard and skin as on the pitch) in a head-and-collar close-up, rendered once per player + look + kit
 * into a small PNG data URL and cached. Rendering is lazy (only faces some screen asks for, a few per frame)
 * on one tiny renderer that frees its WebGL context once the queue has been idle for a couple of seconds.
 */
const FACE_PX = 96;
const FACE_CACHE_MAX = 500;
const faceCache = new Map<string, string>();
const faceWant = new Map<string, { def: PlayerDef; kit: Kit }>();
let faceQueue: string[] = [];
let faceRaf = 0;
let faceIdle = 0;
let faceFailed = false;
let faceRig: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera } | null = null;

const IDLE_POSE: PoseInput = {
  state: PSTATE.move, stateT: 0, speed: 0, runPhase: 0, kickT: 0, kickLeg: 1, lean: 0, diveDir: 0, headerT: 0,
  celebrate: 0, y: 0, keeper: false, hasBall: false, look: 0, turn: 0,
};

/** Cache key: the player, his look and the shirt he wears (the collar shows under the chin). */
export function faceKey(def: PlayerDef, kit: Kit): string {
  const l = def.look;
  const shirt = def.role === 'GK' ? kit.gk : kit.shirt;
  return `${def.id}|${l.skin}.${l.hair}.${l.hairColor}.${l.beard}|${shirt}.${kit.shirt2}.${kit.pattern}`;
}

const attr = (s: string) => s.replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[c]!);

/**
 * A face tile (`<i class="face">`): the cached head shot, or an empty tile that hydrateFaces() fills in.
 * `cls` adds size variants (e.g. "lg").
 */
export function faceHtml(def: PlayerDef, kit: Kit, cls = ''): string {
  const key = faceKey(def, kit);
  const url = faceCache.get(key);
  if (!url) faceWant.set(key, { def, kit });
  return `<i class="face ${cls}" data-face="${attr(key)}" aria-hidden="true">${url ? `<img src="${url}" alt="" draggable="false">` : ''}</i>`;
}

/** Fill every empty face tile under `root` (cached ones at once, the rest over the next few frames). */
export function hydrateFaces(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('i.face[data-face]').forEach((el) => {
    if (el.firstElementChild) return;
    const key = el.dataset.face ?? '';
    const url = faceCache.get(key);
    if (url) el.innerHTML = `<img src="${url}" alt="" draggable="false">`;
    else if (faceWant.has(key) && !faceQueue.includes(key)) faceQueue.push(key);
  });
  if (faceQueue.length && !faceRaf && !faceFailed) faceRaf = requestAnimationFrame(faceTick);
}

function faceTick(): void {
  faceRaf = 0;
  const t0 = performance.now();
  // ~6 ms a frame: a 20-man squad fills in within a handful of frames without a hitch.
  while (faceQueue.length && performance.now() - t0 < 6) {
    const key = faceQueue.shift()!;
    const want = faceWant.get(key);
    if (!want || faceCache.has(key)) continue;
    const url = shootFace(want.def, want.kit);
    if (!url) {
      faceQueue = []; // no WebGL here: the plain tiles stay
      break;
    }
    faceWant.delete(key);
    faceCache.set(key, url);
    if (faceCache.size > FACE_CACHE_MAX) faceCache.delete(faceCache.keys().next().value!);
    const sel = `i.face[data-face="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(key) : key}"]`;
    document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
      if (!el.firstElementChild) el.innerHTML = `<img src="${url}" alt="" draggable="false">`;
    });
  }
  if (faceQueue.length) faceRaf = requestAnimationFrame(faceTick);
  else {
    // Let the context go once nothing has been asked for in a while.
    window.clearTimeout(faceIdle);
    faceIdle = window.setTimeout(disposeFaces, 2500);
  }
}

function faceRenderer(): typeof faceRig {
  if (faceRig || faceFailed) return faceRig;
  try {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(1);
    renderer.setSize(FACE_PX, FACE_PX, false);
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xe4f0ff, 0x8aa66a, 1.55));
    // Key light from the front, high and a little to his left: the face reads, the voxel sides shade.
    const key = new THREE.DirectionalLight(0xfff4e2, 2.2);
    key.position.set(4, 5, -1.6);
    scene.add(key);
    faceRig = { renderer, scene, camera: new THREE.PerspectiveCamera(24, 1, 0.1, 30) };
  } catch {
    faceFailed = true;
  }
  return faceRig;
}

const box = new THREE.Box3();
const hb = new THREE.Box3();
const v3 = new THREE.Vector3();
const sz3 = new THREE.Vector3();

function shootFace(def: PlayerDef, kit: Kit): string | null {
  const rig = faceRenderer();
  if (!rig) return null;
  const p = new Footballer(def, kit, def.role === 'GK');
  p.pose(IDLE_POSE, 0);
  rig.scene.add(p.group);
  p.group.updateMatrixWorld(true);
  // The head is the part whose bottom sits highest (arms hang from the shoulders, the torso from the hips).
  let found = false;
  p.group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    box.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld);
    if (!found || box.min.y > hb.min.y) {
      hb.copy(box);
      found = true;
    }
  });
  let url: string | null = null;
  if (found) {
    hb.getCenter(v3);
    hb.getSize(sz3);
    // Head plus a sliver of collar: aim a touch below the head's centre, fit ~1.3 heads of height.
    const cam = rig.camera;
    const span = Math.max(sz3.y, sz3.z) * 1.34;
    const dist = span / 2 / Math.tan(((cam.fov / 2) * Math.PI) / 180) + sz3.x / 2;
    const ty = v3.y - sz3.y * 0.1;
    const az = 0.42; // three-quarter view (the face is on the model's +x)
    const el = 0.14;
    cam.position.set(v3.x + Math.cos(el) * Math.cos(az) * dist, ty + Math.sin(el) * dist, v3.z + Math.cos(el) * Math.sin(az) * dist);
    cam.lookAt(v3.x, ty, v3.z);
    cam.updateProjectionMatrix();
    try {
      rig.renderer.render(rig.scene, cam);
      url = rig.renderer.domElement.toDataURL('image/png');
    } catch {
      url = null;
    }
  }
  rig.scene.remove(p.group);
  return url;
}

/** Free the face renderer's WebGL context (the cache of finished shots stays). */
export function disposeFaces(): void {
  window.clearTimeout(faceIdle);
  if (faceRaf) cancelAnimationFrame(faceRaf);
  faceRaf = 0;
  faceQueue = [];
  if (!faceRig) return;
  faceRig.renderer.dispose();
  faceRig.renderer.forceContextLoss();
  faceRig = null;
}
