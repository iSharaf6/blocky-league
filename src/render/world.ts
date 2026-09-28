import * as THREE from 'three';
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
 * Dynamic resolution (World.adapt): trades pixels for frame rate, fast. A frame is slow when it took longer
 * than SLOW_DT (a 60 Hz frame and a third: a dropped frame at 60 Hz, never rAF jitter; a 120 / 144 Hz display
 * falling back to 60 is fine). A few slow frames within ~half a second (not one GC hiccup) drop the pixel
 * ratio by DROP_K at once, again after DROP_COOL s if still slow: 2 -> 1 in ~1.5 s under a sudden load (round 8
 * dropped only 15% per 1.5 s). Once RAISE_CALM s pass without a slow frame it climbs back RAISE_K every
 * RAISE_EVERY s (0.6 -> 2 in ~7 s; round 8 took ~19 s). A raise that brings the slow frames straight back
 * (within RAISE_PROBE s) goes straight back to the ratio before it, which becomes a ceiling for CEIL_S s,
 * doubling with each failed try (at most CEIL_MAX s), so it settles instead of sawing up and down.
 */
const SLOW_DT = 1.35 / 60;
const SLOW_BURST = 2.5;
const SLOW_WIN = 0.5;
const DROP_K = 0.8;
const DROP_COOL = 0.5;
const RAISE_K = 1.15;
const RAISE_EVERY = 0.75;
const RAISE_CALM = 1.5;
const CEIL_S = 8;
/** A slow frame whose own main-thread work took at least this share of SLOW_DT is CPU bound. */
const CPU_BOUND = 0.6;
const CEIL_MAX = 60;
const RAISE_PROBE = 2;
export const MIN_RATIO = 0.6;

export class ResolutionGovernor {
  ratio: number;
  private max: number;
  private t = 0;
  private burst = 0;
  private lastSlow = -99;
  private lastChange = -99;
  private lastRaise = -99;
  private ceiling = Infinity;
  private ceilT = 0;
  /** The ratio before the last raise, and how many raises in a row have failed. */
  private beforeRaise = 0;
  private fails = 0;
  private lastFail = -99;

  constructor(max: number) {
    this.max = max;
    this.ratio = max;
  }

  /** A new top ratio (the quality setting changed): start there again, all history forgotten. */
  reset(max: number): void {
    this.max = max;
    this.ratio = max;
    this.t = 0;
    this.burst = 0;
    this.lastSlow = this.lastChange = this.lastRaise = -99;
    this.ceiling = Infinity;
    this.ceilT = 0;
    this.beforeRaise = 0;
    this.fails = 0;
    this.lastFail = -99;
  }

  /**
   * One frame took `dt` s, `work` s of it our own main-thread work (sim + render calls; 0 = unknown): the new
   * pixel ratio if it should change now, else null. A slow frame that our own work already explains (CPU
   * bound: a busy machine, other tabs) is no reason to drop pixels (fewer pixels wouldn't make it faster),
   * though it still holds off a raise.
   */
  frame(dt: number, work = 0): number | null {
    // (A stall this long is a hidden tab or a breakpoint, not the renderer.)
    if (!(dt > 0) || dt > 0.25) return null;
    this.t += dt;
    const slow = dt > SLOW_DT;
    const gpu = slow && work < SLOW_DT * CPU_BOUND;
    this.burst = this.burst * Math.exp(-dt / SLOW_WIN) + (gpu ? 1 : 0);
    if (slow) this.lastSlow = this.t;
    if (this.ceilT > 0) {
      this.ceilT -= dt;
      if (this.ceilT <= 0) this.ceiling = Infinity;
    }
    // A raise that has held for a while was right: the next failure starts the back-off afresh.
    if (this.fails > 0 && this.lastRaise > this.lastFail && this.t - this.lastRaise > CEIL_S) this.fails = 0;
    if (this.burst >= SLOW_BURST && this.t - this.lastChange >= DROP_COOL && this.ratio > MIN_RATIO + 0.001) {
      if (this.t - this.lastRaise < RAISE_PROBE && this.beforeRaise > 0) {
        // That raise was one too many: back to where it was, and stay there a while.
        this.ratio = this.beforeRaise;
        this.ceiling = this.beforeRaise;
        this.ceilT = Math.min(CEIL_MAX, CEIL_S * 2 ** this.fails);
        this.fails++;
        this.lastFail = this.t;
      } else this.ratio = Math.max(MIN_RATIO, this.ratio * DROP_K);
      this.beforeRaise = 0;
      this.lastChange = this.t;
      this.burst = 0;
      return this.ratio;
    }
    if (this.t - this.lastSlow >= RAISE_CALM && this.t - this.lastChange >= RAISE_EVERY && this.ratio < this.max - 0.001) {
      const next = Math.min(this.max, this.ceiling, this.ratio * RAISE_K);
      if (next > this.ratio + 0.01) {
        this.beforeRaise = this.ratio;
        this.ratio = next;
        this.lastChange = this.lastRaise = this.t;
        return this.ratio;
      }
    }
    return null;
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

  setTimeOfDay(t: TimeOfDay, weather: 'clear' | 'rain' | 'snow' = 'clear'): void {
    this.time = t;
    const base = LOOKS[t];
    // Overcast skies for rain / snow: flatter light, greyer sky, closer fog.
    const grey = weather === 'rain' ? 0x8e99a6 : 0xdfe6ec;
    const k = weather === 'clear' ? 0 : weather === 'rain' ? 0.62 : 0.5;
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
    fog.near = weather === 'clear' ? 190 : 110;
    fog.far = weather === 'clear' ? 520 : 380;
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
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    this.maxRatio = q === 'high' ? Math.min(dpr, 2) : q === 'medium' ? Math.min(dpr, 1.5) : 1;
    this.ratio = this.maxRatio;
    this.governor.reset(this.maxRatio);
    this.renderer.setPixelRatio(this.ratio);
    // Crisp toy shadows need texels: 4096 on desktop-class GPUs, less on phones.
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

  /** Keep the shadow frustum centred on what the camera is looking at. */
  focusShadows(x: number, z: number): void {
    // Snap to texel-ish steps to avoid shimmering edges.
    const step = 0.5;
    const sx = Math.round(x / step) * step;
    const sz = Math.round(z / step) * step;
    this.sun.target.position.set(sx, 0, sz);
    this.sun.position.set(sx + this.sunOffset.x, this.sunOffset.y, sz + this.sunOffset.z);
    // Low from the far corner masts, opposite the key.
    this.fill.position.set(sx + 20, 22, sz - 34);
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
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
   */
  adapt(dt: number, work = 0): void {
    const next = this.governor.frame(dt, work);
    if (next !== null && Math.abs(next - this.ratio) > 0.005) {
      this.ratio = next;
      this.renderer.setPixelRatio(next);
      this.resize();
    }
  }
}
