import * as THREE from 'three';

/**
 * The set-piece ghost arc (game/ghostArc.ts predicts it): a dotted line of little voxel cubes along the ball's
 * path for the aim and power on right now, drawn over everything (a wall or a team-mate never hides it) and
 * sized by distance from the lens so the dots read the same on the over-the-shoulder shot and the wide one.
 * Once the ball is struck the last path stays where it was and fades out over FADE_S.
 */
const MAX_DOTS = 64;
/** Dot size: this share of its distance from the lens (m), within these bounds (m): ~8 px at 720p either way. */
const DOT_K = 0.0085;
const DOT_MIN = 0.14;
const DOT_MAX = 0.42;
const ALPHA = 0.9;
/** Each dot sits on a darker, bigger copy of itself (an outline): it reads on grass, the crowd and the sky alike. */
const EDGE_K = 1.45;
const EDGE_ALPHA = 0.6;
const FADE_S = 0.35;

export class GhostArc {
  readonly mesh: THREE.InstancedMesh;
  private readonly edge: THREE.InstancedMesh;
  private readonly mat: THREE.MeshBasicMaterial;
  private readonly edgeMat: THREE.MeshBasicMaterial;
  private readonly pts = new Float32Array(MAX_DOTS * 3);
  private n = 0;
  /** 1 while aiming; counting down to 0 once struck (or turned off). */
  private alpha = 0;
  private fading = false;
  private t = 0;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor() {
    this.mat = new THREE.MeshBasicMaterial({ color: 0xfbfbf4, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false });
    const geo = new THREE.BoxGeometry(1, 1, 1);
    this.mesh = new THREE.InstancedMesh(geo, this.mat, MAX_DOTS);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.visible = false;
    this.mesh.count = 0;
    // (The outline rides along as a child: add `mesh` and both are drawn.)
    this.edgeMat = new THREE.MeshBasicMaterial({ color: 0x1b2230, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false });
    this.edge = new THREE.InstancedMesh(geo, this.edgeMat, MAX_DOTS);
    this.edge.frustumCulled = false;
    this.edge.renderOrder = 7;
    this.edge.count = 0;
    this.mesh.add(this.edge);
  }

  /** The path to show (x, y, z per dot, `n` dots): the live preview, at full strength. */
  show(path: Float32Array, n: number): void {
    const k = Math.min(n, MAX_DOTS);
    for (let i = 0; i < k * 3; i++) this.pts[i] = path[i];
    this.n = k;
    this.fading = false;
    this.alpha = 1;
  }

  /** The ball has been struck (or the preview is no longer wanted): what is drawn fades out. */
  release(): void {
    if (this.alpha > 0) this.fading = true;
  }

  /** Gone at once (a cut away, a replay). */
  clear(): void {
    this.alpha = 0;
    this.fading = false;
    this.mesh.visible = false;
  }

  get visible(): boolean {
    return this.mesh.visible;
  }

  get dots(): number {
    return this.n;
  }

  update(dt: number, cam: THREE.Vector3): void {
    this.t += dt;
    if (this.fading) {
      this.alpha = Math.max(0, this.alpha - dt / FADE_S);
      if (this.alpha <= 0) this.fading = false;
    }
    const on = this.alpha > 0.001 && this.n > 1;
    this.mesh.visible = on;
    if (!on) return;
    // A gentle shimmer running along the line (from the ball out), so it reads as a preview, not scenery.
    const n = this.n;
    this.q.identity();
    for (let i = 0; i < n; i++) {
      const x = this.pts[i * 3];
      const y = this.pts[i * 3 + 1];
      const z = this.pts[i * 3 + 2];
      const d = Math.hypot(x - cam.x, y - cam.y, z - cam.z);
      const pulse = 0.85 + 0.15 * Math.sin(this.t * 9 - i * 0.7);
      // The first dot sits on the ball: skip it (and taper the far end a little).
      const taper = i === 0 ? 0 : 1 - 0.35 * (i / n);
      const sz = Math.min(DOT_MAX, Math.max(DOT_MIN, d * DOT_K)) * pulse * taper;
      this.m4.compose(this.v.set(x, y, z), this.q, this.s.set(sz, sz, sz));
      this.mesh.setMatrixAt(i, this.m4);
      const se = sz * EDGE_K;
      this.m4.compose(this.v, this.q, this.s.set(se, se, se));
      this.edge.setMatrixAt(i, this.m4);
    }
    this.mesh.count = n;
    this.edge.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.edge.instanceMatrix.needsUpdate = true;
    this.mat.opacity = ALPHA * this.alpha;
    this.edgeMat.opacity = EDGE_ALPHA * this.alpha;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.edgeMat.dispose();
    this.mesh.removeFromParent();
  }
}
