import * as THREE from 'three';
import type { WeatherKind } from '../sim/weather';
import { SKY_BOTTOM, SKY_TOP, cssHex } from './palette';

export type Quality = 'low' | 'medium' | 'high';
export type TimeOfDay = 'day' | 'sunset' | 'night';

interface Look {
  skyTop: number;
  skyMid: number;
  skyBottom: number;
  hemiSky: number;
  hemiGround: number;
  hemi: number;
  sun: number;
  sunI: number;
  offset: [number, number, number];
  fog: number;
  /** Shadowless fill from the opposite masts (night only), so faces turned from the key aren't black. */
  fillI?: number;
}

const LOOKS: Record<TimeOfDay, Look> = {
  day: {
    skyTop: SKY_TOP, skyMid: SKY_BOTTOM, skyBottom: SKY_BOTTOM, hemiSky: 0xd6e8ff, hemiGround: 0x7a9a5c, hemi: 1.3,
    sun: 0xfff6e6, sunI: 2.8, offset: [-44, 48, 30], fog: SKY_BOTTOM,
  },
  // Golden hour: a low, strong orange key (long shadows raking across the lawn; faces, shirts and the stands
  // glow) under a warm peach sky, so the whole frame reads as evening, not day: the lawn goes warm
  // (R/G ~0.8) but stays grass; Stadium.setTimeOfDay keeps its hue well clear of khaki. (The footballers
  // get a neutral sky fill on top, MatchView.setTimeOfDay, so kits don't go orange-brown.)
  sunset: {
    skyTop: 0x5b6fd6, skyMid: 0xff9a6b, skyBottom: 0xffd08a, hemiSky: 0xffc0a0, hemiGround: 0x5a7a2a, hemi: 1.8,
    sun: 0xffa860, sunI: 3.2, offset: [-70, 24, 30], fog: 0xffc08a,
  },
  // Floodlit: a cool, steep key from the camera side (the masts behind the gantry) and very little sky, so the
  // lawn stays bright while the stands and the world outside drop into the dark (see Stadium.setTimeOfDay).
  night: {
    skyTop: 0x0b1030, skyMid: 0x1c2a5c, skyBottom: 0x2f4478, hemiSky: 0x5a6fae, hemiGround: 0x1e2e24, hemi: 0.45,
    sun: 0xeef2ff, sunI: 2.0, offset: [-18, 62, 34], fog: 0x0b1030, fillI: 0.8,
  },
};

/**
 * Dynamic resolution (World.adapt): gives up pixels only when the GPU really can't keep up, rarely, and never
 * under a crisp floor (HIGH keeps 1.5x on a 2x / 3x screen; nothing goes under 1x).
 *
 * - The display's own pace is measured: the PACE_RANK-th shortest of the last PACE_N frames. A phone in Low
 *   Power Mode runs rAF at a steady 30 Hz, a ProMotion screen at 120: that is the pace, never a slow frame.
 *   (The old governor took every 30 Hz frame, and a few dropped frames a second, as GPU bound and sank to
 *   0.6x: a smear on a 3x phone, even on HIGH.) A frame is slow when it took over SLOW_K of the pace (a
 *   dropped vsync), and never under SLOW_DT (a 120 / 144 Hz display falling back to 60 is fine).
 * - A slow frame our own main-thread work explains (CPU bound: a busy machine, a GC pause) costs no pixels:
 *   fewer wouldn't make it faster.
 * - Pixels go only once GPU-slow frames fill DROP_FRAC of the time (averaged over SLOW_TAU s): a lone hitch or
 *   a few dropped frames a second, never. One step (DROP_K) at a time, at most every DROP_COOL s.
 * - Back up a step once the slow share has stayed under RAISE_FRAC for RAISE_CALM s. A raise that brings the
 *   slow frames straight back (PROBE_FRAC within RAISE_PROBE s) is undone at once, and that ratio becomes a
 *   ceiling for CEIL_S s (doubling with each failed try, CEIL_MAX at most), so it settles instead of sawing.
 * - A change waits for a quiet moment (`quiet`: a dead ball, a menu, a pause): resizing the canvas reallocates
 *   its buffers, a hitch, so never mid-move. A drop goes anyway after DEFER_MAX s of unbroken play.
 */
const SLOW_DT = 1.35 / 60;
const SLOW_K = 1.35;
const PACE_N = 24;
/** (0-based: the 4th shortest of PACE_N. A capped display delivers every frame at its pace.) */
const PACE_RANK = 3;
const SLOW_TAU = 3;
const DROP_FRAC = 0.25;
const PROBE_FRAC = 0.12;
const RAISE_FRAC = 0.06;
const DROP_K = 0.875;
/** A step that would land this close to the floor (or the top) goes all the way. */
const SNAP = 0.1;
const DROP_COOL = 3;
const RAISE_CALM = 10;
const RAISE_PROBE = 4;
const CEIL_S = 45;
const CEIL_MAX = 240;
const DEFER_MAX = 4;
/** A slow frame whose own main-thread work took at least this share of the slow mark is CPU bound. */
const CPU_BOUND = 0.6;
/** No setting renders under 1x (HIGH's own floor is higher: see World.setQuality). */
export const MIN_RATIO = 1;

export class ResolutionGovernor {
  /** The pixel ratio in use. */
  ratio: number;
  /** The display's own frame interval (s; 0 until PACE_N frames have been seen). */
  pace = 0;
  /** Slow frames seen, any cause (the app's perf log). */
  slowFrames = 0;
  private max: number;
  private floor: number;
  private t = 0;
  /** Share of the recent time spent in GPU-slow frames (an average over SLOW_TAU s). */
  private frac = 0;
  /** When that share last stood over RAISE_FRAC. */
  private busyAt = 0;
  /** A change waiting for a quiet moment (0: none), and since when. */
  private want = 0;
  private wantAt = 0;
  private lastChange = -99;
  private lastRaise = -99;
  private ceiling = Infinity;
  private ceilT = 0;
  /** The ratio before the last raise, and how many raises in a row have failed. */
  private beforeRaise = 0;
  private fails = 0;
  private lastFail = -99;
  private readonly dts = new Float64Array(PACE_N);
  private readonly sorted = new Float64Array(PACE_N);
  private n = 0;

  constructor(max: number, floor = Math.min(max, MIN_RATIO)) {
    this.max = max;
    this.floor = Math.min(max, floor);
    this.ratio = max;
  }

  /** A new top ratio and floor (the quality setting changed): start at the top again, all history forgotten. */
  reset(max: number, floor = Math.min(max, MIN_RATIO)): void {
    this.max = max;
    this.floor = Math.min(max, floor);
    this.ratio = max;
    this.pace = 0;
    this.t = this.frac = this.busyAt = this.want = this.wantAt = this.n = 0;
    this.lastChange = this.lastRaise = this.lastFail = -99;
    this.ceiling = Infinity;
    this.ceilT = 0;
    this.beforeRaise = 0;
    this.fails = 0;
  }

  /**
   * One frame took `dt` s, `work` s of it our own main-thread work (sim + render calls; 0 = unknown). `quiet`:
   * a resize hitch would go unseen now (no live play). The new pixel ratio if it changes now, else null.
   */
  frame(dt: number, work = 0, quiet = true): number | null {
    // (A stall this long is a hidden tab or a breakpoint, not the renderer.)
    if (!(dt > 0) || dt > 0.25) return null;
    this.t += dt;
    this.dts[this.n++ % PACE_N] = dt;
    if (this.n < PACE_N) return null;
    this.sorted.set(this.dts);
    this.sorted.sort();
    this.pace = this.sorted[PACE_RANK];
    const slowAt = Math.max(SLOW_DT, this.pace * SLOW_K);
    const slow = dt > slowAt;
    if (slow) this.slowFrames++;
    const gpu = slow && work < slowAt * CPU_BOUND;
    this.frac += ((gpu ? 1 : 0) - this.frac) * (1 - Math.exp(-dt / SLOW_TAU));
    if (this.frac > RAISE_FRAC) this.busyAt = this.t;
    if (this.ceilT > 0) {
      this.ceilT -= dt;
      if (this.ceilT <= 0) this.ceiling = Infinity;
    }
    // A raise that has held for a while was right: the next failure starts the back-off afresh.
    if (this.fails > 0 && this.lastRaise > this.lastFail && this.t - this.lastRaise > CEIL_S) this.fails = 0;
    if (this.beforeRaise > 0 && this.t - this.lastRaise < RAISE_PROBE && this.frac >= PROBE_FRAC) {
      // That raise was one too many: straight back (it caused this), and stay there a while.
      const back = this.beforeRaise;
      this.ceiling = back;
      this.ceilT = Math.min(CEIL_MAX, CEIL_S * 2 ** this.fails);
      this.fails++;
      this.lastFail = this.t;
      return this.apply(back);
    }
    if (this.want > 0) {
      // Waiting for a quiet moment: called off if the frames no longer argue for it.
      if (this.want > this.ratio ? this.t - this.busyAt < RAISE_CALM : this.frac < RAISE_FRAC) {
        this.want = 0;
        return null;
      }
      if (quiet || (this.want < this.ratio && this.t - this.wantAt >= DEFER_MAX)) return this.apply(this.want);
      return null;
    }
    if (this.frac >= DROP_FRAC && this.t - this.lastChange >= DROP_COOL && this.ratio > this.floor + 0.001) {
      let next = this.ratio * DROP_K;
      if (next < this.floor + SNAP) next = this.floor;
      return this.propose(next, quiet);
    }
    if (this.t - this.busyAt >= RAISE_CALM && this.t - this.lastChange >= RAISE_CALM && this.ratio < this.max - 0.001) {
      let next = this.ratio / DROP_K;
      if (next > this.max - SNAP) next = this.max;
      next = Math.min(next, this.ceiling);
      if (next > this.ratio + 0.01) return this.propose(next, quiet);
    }
    return null;
  }

  private propose(next: number, quiet: boolean): number | null {
    this.want = next;
    this.wantAt = this.t;
    return quiet ? this.apply(next) : null;
  }

  private apply(next: number): number {
    if (next > this.ratio) {
      this.beforeRaise = this.ratio;
      this.lastRaise = this.t;
    } else this.beforeRaise = 0;
    this.ratio = next;
    this.want = 0;
    this.lastChange = this.t;
    // Judged afresh at the new size.
    this.frac = 0;
    return next;
  }
}

/** Renderer, scene, sun + sky light. Colours stay flat and saturated (no tone mapping). */
function mixHex(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(28, 1, 0.5, 900);
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly fill: THREE.DirectionalLight;
  private shadowSize = 36;
  quality: Quality = 'high';
  private sunOffset = new THREE.Vector3(-38, 62, 44);
  private skyCanvas: HTMLCanvasElement;
  private skyTex: THREE.CanvasTexture;
  time: TimeOfDay = 'day';
  private maxRatio = 2;
  private ratio = 2;
  /** The quality and devicePixelRatio last set up (setQuality is a no-op until one changes). */
  private qualityKey = '';
  /** Dynamic resolution (see ResolutionGovernor). */
  readonly governor = new ResolutionGovernor(2);

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.skyCanvas = document.createElement('canvas');
    this.skyCanvas.width = 2;
    this.skyCanvas.height = 256;
    this.skyTex = new THREE.CanvasTexture(this.skyCanvas);
    this.skyTex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = this.skyTex;
    this.scene.fog = new THREE.Fog(SKY_BOTTOM, 190, 520);

    this.hemi = new THREE.HemisphereLight(0xeaf6ff, 0x9bc46a, 1.55);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff4e0, 2.35);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    // Crossy-crisp edges: r186's PCF spreads 5 taps over `radius` texels (plus the hardware bilinear); 0.4 keeps
    // just enough of it to hide texel steps in the close-ups without the soft blur on the broadcast shot.
    this.sun.shadow.radius = 0.4;
    this.setShadowSize(this.shadowSize);
    this.scene.add(this.sun, this.sun.target);
    this.fill = new THREE.DirectionalLight(0xdfe8ff, 0);
    this.fill.target = this.sun.target;
    this.scene.add(this.fill);
    this.setTimeOfDay('day');
    this.resize();
  }

  setTimeOfDay(t: TimeOfDay, weather: WeatherKind = 'clear'): void {
    this.time = t;
    const base = LOOKS[t];
    // Overcast skies for rain / snow: flatter light, greyer sky, closer fog.
    const grey = weather === 'rain' || weather === 'drizzle' ? 0x8e99a6 : 0xdfe6ec;
    const k = { clear: 0, overcast: 0.38, drizzle: 0.52, rain: 0.62, snow: 0.5, blizzard: 0.72 }[weather];
    const L: Look = {
      ...base,
      skyTop: mixHex(base.skyTop, grey, k),
      skyMid: mixHex(base.skyMid, grey, k),
      skyBottom: mixHex(base.skyBottom, grey, k),
      fog: mixHex(base.fog, grey, k),
      sunI: base.sunI * (1 - k * 0.6),
      hemi: base.hemi * (1 + k * 0.25),
    };
    const fog = this.scene.fog as THREE.Fog;
    fog.near = weather === 'clear' || weather === 'overcast' ? 190 : weather === 'blizzard' ? 80 : 110;
    fog.far = weather === 'clear' || weather === 'overcast' ? 520 : weather === 'blizzard' ? 280 : 380;
    const g = this.skyCanvas.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, cssHex(L.skyTop));
    grad.addColorStop(0.62, cssHex(L.skyMid));
    grad.addColorStop(1, cssHex(L.skyBottom));
    g.fillStyle = grad;
    g.fillRect(0, 0, 2, 256);
    this.skyTex.needsUpdate = true;
    this.hemi.color.setHex(L.hemiSky);
    this.hemi.groundColor.setHex(L.hemiGround);
    this.hemi.intensity = L.hemi;
    this.sun.color.setHex(L.sun);
    this.sun.intensity = L.sunI;
    this.sunOffset.set(...L.offset);
    // Always in the scene (0 by day) so switching time of day never changes the light count / recompiles.
    this.fill.intensity = (L.fillI ?? 0) * (1 - k * 0.5);
    (this.scene.fog as THREE.Fog).color.setHex(L.fog);
  }

  setQuality(q: Quality): void {
    const dpr = window.devicePixelRatio || 1;
    // (Settings re-applies everything on any change, a sound switch too: only a new quality or screen resets the
    // resolution, never a canvas reallocation for nothing.)
    const key = `${q} ${dpr}`;
    if (key === this.qualityKey) return;
    this.qualityKey = key;
    this.quality = q;
    // HIGH: 2x (a 3x phone too: with MSAA that is sharp at arm's length, for 2.25x fewer pixels than native), and
    // the governor never takes it under 1.5x on a 2x / 3x screen. MEDIUM: up to 1.5x. LOW: 1x. Nothing under 1x.
    this.maxRatio = q === 'high' ? Math.min(dpr, 2) : q === 'medium' ? Math.min(dpr, 1.5) : Math.min(dpr, 1);
    const floor = q === 'high' && dpr >= 2 ? 1.5 : MIN_RATIO;
    this.ratio = this.maxRatio;
    this.governor.reset(this.maxRatio, Math.min(this.maxRatio, floor));
    // (The drawing buffer follows in resize, below: one reallocation.)
    // Crisp toy shadows need texels: 4096 on desktop-class GPUs. A phone gets 2048 on HIGH too: three's PCF map
    // is a colour target plus a depth texture, 128 MB at 4096 (32 MB at 2048), and an iOS web view that runs out
    // of memory reloads the page. 2048 over the 72 m frustum is ~1 texel per pixel at 2x there (side by side at
    // 2x the two sizes look the same).
    const coarse = matchMedia('(pointer: coarse)').matches;
    const size = q === 'high' ? (coarse ? 2048 : 4096) : q === 'medium' ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    const shadows = q !== 'low';
    if (this.renderer.shadowMap.enabled !== shadows || this.sun.castShadow !== shadows) {
      // Switching shadows on or off mid-match: the sun stops (or starts) casting too, and every material is
      // rebuilt for it. (Flipping shadowMap.enabled alone left the lit materials sampling a shadow map that is
      // no longer drawn: switching to LOW in a match blanked the lawn and the players.)
      this.renderer.shadowMap.enabled = shadows;
      this.sun.castShadow = shadows;
      this.scene.traverse((o) => {
        const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (!mat) return;
        if (Array.isArray(mat)) for (const x of mat) x.needsUpdate = true;
        else mat.needsUpdate = true;
      });
    }
    this.resize();
  }

  setShadowSize(s: number): void {
    this.shadowSize = s;
    const c = this.sun.shadow.camera;
    c.left = -s;
    c.right = s;
    c.top = s * 0.75;
    c.bottom = -s * 0.75;
    c.near = 1;
    c.far = 220;
    c.updateProjectionMatrix();
  }

  /**
   * Keep the shadow frustum centred on what the camera is looking at, moved in whole shadow-map texels measured in
   * the sun's own view: the texel grid then stays put on the ground as it follows, so shadow edges don't crawl or
   * flicker while the camera pans. (Steps of 0.5 m along the pitch's axes slid the map by a fraction of a texel
   * and re-cut every edge on the pitch several times a second.)
   */
  focusShadows(x: number, z: number): void {
    const c = this.sun.shadow.camera;
    const size = this.sun.shadow.mapSize.x;
    const tx = (c.right - c.left) / size;
    const ty = (c.top - c.bottom) / size;
    // The shadow camera's axes (it looks from the sun at its target, +y up, as Object3D.lookAt builds them).
    const back = this.shadowBack.copy(this.sunOffset).normalize();
    const right = this.shadowRight.set(0, 1, 0).cross(back).normalize();
    const up = this.shadowUp.copy(back).cross(right);
    const a = Math.round((x * right.x + z * right.z) / tx) * tx;
    const b = Math.round((x * up.x + z * up.z) / ty) * ty;
    const p = this.shadowFocus.set(0, 0, 0).addScaledVector(right, a).addScaledVector(up, b).addScaledVector(back, x * back.x + z * back.z);
    this.sun.target.position.copy(p);
    this.sun.position.copy(p).add(this.sunOffset);
    // Low from the far corner masts, opposite the key.
    this.fill.position.set(p.x + 20, 22, p.z - 34);
  }
  private readonly shadowBack = new THREE.Vector3();
  private readonly shadowRight = new THREE.Vector3();
  private readonly shadowUp = new THREE.Vector3();
  private readonly shadowFocus = new THREE.Vector3();

  /**
   * Fit the drawing buffer to the window at the current pixel ratio. Only a real change of size touches it:
   * setting a canvas's width, even to the same value, reallocates its buffers (a hitch), and iOS sends resize
   * events that change nothing.
   */
  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const c = this.renderer.domElement;
    const r = this.ratio;
    if (c.width !== Math.floor(w * r) || c.height !== Math.floor(h * r) || this.renderer.getPixelRatio() !== r) {
      this.renderer.setDrawingBufferSize(w, h, r);
    }
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** The pixel ratio drawn at right now (the app's perf log). */
  get pixelRatio(): number {
    return this.ratio;
  }

  /**
   * Compile every material in the scene now, the hidden ones too (the pass ring, the effects, the set-piece
   * markers...), so none compiles mid-play on its first appearance: linking a WebGL program stalls the frame,
   * on iOS for tens of ms each. Called once for each new match (and the menu's): the cost lands on the kick-off
   * fly-in instead. (Measured: a quick match compiled 9 programs at 5 moments of its first minute; after this,
   * only materials made later on the fly.)
   */
  warmShaders(): void {
    try {
      this.renderer.compile(this.scene, this.camera);
    } catch {
      // (A lost context: the next render reports it.)
    }
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
    const f = this.afterRender;
    if (f) {
      this.afterRender = null;
      f();
    }
  }

  private afterRender: (() => void) | null = null;

  /**
   * Run `fn` straight after the next frame is drawn, in the same task: the WebGL canvas can still be read then
   * (a goal's poster frame), with no extra render.
   */
  onNextRender(fn: () => void): void {
    this.afterRender = fn;
  }

  /**
   * Dynamic resolution: trade pixels for frame rate on slow devices (ResolutionGovernor), every frame. `work`:
   * seconds of this frame's own main-thread work (sim + render calls), so a CPU-bound hitch costs no pixels.
   * `quiet`: no live play on screen, so the resize hitch goes unseen (changes wait for one).
   */
  adapt(dt: number, work = 0, quiet = true): void {
    const next = this.governor.frame(dt, work, quiet);
    if (next !== null && Math.abs(next - this.ratio) > 0.005) {
      this.ratio = next;
      this.resize();
    }
  }
}
