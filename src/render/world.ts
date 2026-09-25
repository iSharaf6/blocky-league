import * as THREE from 'three';
import { SKY_BOTTOM, SKY_TOP, cssHex } from './palette';

export type Quality = 'low' | 'medium' | 'high';

/** Renderer, scene, sun + sky light. Colours stay flat and saturated (no tone mapping). */
export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(28, 1, 0.5, 900);
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private shadowSize = 42;
  quality: Quality = 'high';
  private sunOffset = new THREE.Vector3(-38, 62, 44);

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const sky = document.createElement('canvas');
    sky.width = 2;
    sky.height = 256;
    const g = sky.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, cssHex(SKY_TOP));
    grad.addColorStop(0.75, cssHex(SKY_BOTTOM));
    grad.addColorStop(1, cssHex(SKY_BOTTOM));
    g.fillStyle = grad;
    g.fillRect(0, 0, 2, 256);
    const skyTex = new THREE.CanvasTexture(sky);
    skyTex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = skyTex;
    this.scene.fog = new THREE.Fog(SKY_BOTTOM, 190, 520);

    this.hemi = new THREE.HemisphereLight(0xeaf6ff, 0x9bc46a, 1.55);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff4e0, 2.35);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    this.setShadowSize(this.shadowSize);
    this.scene.add(this.sun, this.sun.target);
    this.resize();
  }

  setQuality(q: Quality): void {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === 'high' ? Math.min(dpr, 2) : q === 'medium' ? Math.min(dpr, 1.5) : 1);
    const size = q === 'high' ? 2048 : q === 'medium' ? 1536 : 1024;
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
}
