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
}

const LOOKS: Record<TimeOfDay, Look> = {
  day: {
    skyTop: SKY_TOP, skyMid: SKY_BOTTOM, skyBottom: SKY_BOTTOM, hemiSky: 0xd6e8ff, hemiGround: 0x7a9a5c, hemi: 1.3,
    sun: 0xfff6e6, sunI: 2.8, offset: [-44, 48, 30], fog: SKY_BOTTOM,
  },
  sunset: {
    skyTop: 0x5b6fd6, skyMid: 0xff9a6b, skyBottom: 0xffd08a, hemiSky: 0xffd9c2, hemiGround: 0x8fa85a, hemi: 1.25,
    sun: 0xffb070, sunI: 2.6, offset: [-70, 30, 22], fog: 0xffc08a,
  },
  night: {
    skyTop: 0x0b1030, skyMid: 0x1c2a5c, skyBottom: 0x2f4478, hemiSky: 0xbfd4ff, hemiGround: 0x3a5a3a, hemi: 1.05,
    sun: 0xf2f6ff, sunI: 2.5, offset: [-14, 70, 22], fog: 0x1c2a5c,
  },
};

/** Renderer, scene, sun + sky light. Colours stay flat and saturated (no tone mapping). */
export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(28, 1, 0.5, 900);
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
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
    this.setTimeOfDay('day');
    this.resize();
  }

  setTimeOfDay(t: TimeOfDay): void {
    this.time = t;
    const L = LOOKS[t];
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
