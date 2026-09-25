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
  // Golden hour: a warm key (faces, shirts and the stands glow) balanced by a cool sky fill, so the lawn stays
  // green (hue ~85 degrees, not khaki); Stadium.setTimeOfDay nudges the lawn itself the last few degrees.
  sunset: {
    skyTop: 0x5b6fd6, skyMid: 0xff9a6b, skyBottom: 0xffd08a, hemiSky: 0xc8d4ff, hemiGround: 0x5a7a2a, hemi: 1.8,
    sun: 0xffd2a0, sunI: 2.8, offset: [-56, 40, 26], fog: 0xffc08a,
  },
  // Floodlit: a cool, steep key from the camera side (the masts behind the gantry) and very little sky, so the
  // lawn stays bright while the stands and the world outside drop into the dark (see Stadium.setTimeOfDay).
  night: {
    skyTop: 0x0b1030, skyMid: 0x1c2a5c, skyBottom: 0x2f4478, hemiSky: 0x5a6fae, hemiGround: 0x1e2e24, hemi: 0.45,
    sun: 0xeef2ff, sunI: 2.0, offset: [-18, 62, 34], fog: 0x0b1030, fillI: 0.8,
  },
};

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
  private frameEma = 1 / 60;
  private adaptT = 0;

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
    this.sun.shadow.radius = 1;
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
    this.renderer.setPixelRatio(this.ratio);
    // Crisp toy shadows need texels: 4096 on desktop-class GPUs, less on phones.
    const coarse = matchMedia('(pointer: coarse)').matches;
    const size = q === 'high' ? (coarse ? 2048 : 4096) : q === 'medium' ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.renderer.shadowMap.enabled = q !== 'low';
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
  }

  /** Dynamic resolution: trade pixels for frame rate on slow devices. */
  adapt(dt: number): void {
    if (dt <= 0 || dt > 0.1) return;
    this.frameEma += (dt - this.frameEma) * 0.05;
    this.adaptT += dt;
    if (this.adaptT < 1.5) return;
    this.adaptT = 0;
    let next = this.ratio;
    if (this.frameEma > 1 / 48) next = Math.max(0.6, this.ratio * 0.85);
    else if (this.frameEma < 1 / 58 && this.ratio < this.maxRatio) next = Math.min(this.maxRatio, this.ratio * 1.1);
    if (Math.abs(next - this.ratio) > 0.02) {
      this.ratio = next;
      this.renderer.setPixelRatio(next);
      this.resize();
    }
  }
}
