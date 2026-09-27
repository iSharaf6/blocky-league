import * as THREE from 'three';

/**
 * A flash cut (into and out of a replay): the picture cuts at once and a full-screen wash over it clears in
 * well under a quarter of a second, so the change of shot lands like a TV "whoosh" cut instead of a blink.
 * A screen-space quad (drawn last, no depth): add `mesh` to the scene, `play()` on the cut, `update(dt)` each frame.
 */
/** Longest a flash may run (s): transitions stay short and punchy. */
export const FLASH_MAX_S = 0.25;

export class CutFlash {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  private t = 0;
  private dur = 0;
  private peak = 0;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uAlpha: { value: 0 } },
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform vec3 uColor; uniform float uAlpha; void main() { gl_FragColor = vec4(uColor, uAlpha); }',
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1000;
    this.mesh.visible = false;
  }

  /** Flash `color` at `peak` opacity, clearing over `dur` s (at most FLASH_MAX_S). */
  play(color = 0xfbfbf4, peak = 0.8, dur = 0.2): void {
    (this.mat.uniforms.uColor.value as THREE.Color).setHex(color);
    this.peak = peak;
    this.dur = Math.min(FLASH_MAX_S, Math.max(0.02, dur));
    this.t = 0;
    this.apply();
  }

  /** Seconds of flash left (0: none). */
  get left(): number {
    return Math.max(0, this.dur - this.t);
  }

  get alpha(): number {
    return this.mat.uniforms.uAlpha.value as number;
  }

  update(dt: number): void {
    if (this.dur <= 0) return;
    this.t += dt;
    this.apply();
  }

  private apply(): void {
    const u = this.dur > 0 ? Math.min(1, this.t / this.dur) : 1;
    // Fast out: most of the wash is gone in the first half.
    const a = this.peak * (1 - u) * (1 - u);
    this.mat.uniforms.uAlpha.value = a;
    this.mesh.visible = a > 0.004;
    if (u >= 1) this.dur = 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.mesh.removeFromParent();
  }
}
