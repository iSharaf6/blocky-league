import * as THREE from 'three';
import { clamp } from '../core/math';
import { GOAL_DEPTH, GOAL_H, GOAL_W, HALF_L } from '../sim/constants';

type Panel = 'back' | 'roof' | 'left' | 'right';
export interface NetShape { goalX: number; width: number; height: number; depth: number }
/** A small, anchored fabric mesh. Impacts deform their actual panel, never detach strands from the goal frame. */
export class GoalNet {
  readonly mesh: THREE.Mesh;
  private readonly base: Float32Array;
  private readonly normal: Float32Array;
  private readonly anchors: Float32Array;
  private readonly panels: Panel[] = [];
  private readonly pos: THREE.BufferAttribute;
  private impacts: { x: number; y: number; z: number; panel: Panel; amp: number; t: number }[] = [];

  constructor(readonly sign: number, texture: THREE.Texture | null = null, cell = 0.135,
    private readonly shape: NetShape = { goalX: sign * HALF_L, width: GOAL_W, height: GOAL_H, depth: GOAL_DEPTH }) {
    const verts: number[] = [], norms: number[] = [], uvs: number[] = [], idx: number[] = [], anchors: number[] = [];
    const { goalX: gx, width: W, height: H, depth: D } = shape;
    const bx = gx + sign * D;
    const sizeK = H / GOAL_H;
    const panel = (kind: Panel, w: number, h: number, nu: number, nv: number,
      at: (u: number, v: number) => [number, number, number], n: [number, number, number]) => {
      const start = verts.length / 3;
      for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
        const u = i / nu, v = j / nv;
        verts.push(...at(u, v)); norms.push(...n);
        uvs.push(u * w / (cell * 4), v * h / (cell * 4));
        // Exactly zero at seams and posts, so neighbouring panel edges cannot tear apart.
        anchors.push(i === 0 || i === nu || j === 0 || j === nv ? 0 : Math.sin(Math.PI * u) * Math.sin(Math.PI * v));
        this.panels.push(kind);
      }
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
        const a = start + j * (nu + 1) + i;
        idx.push(a, a + 1, a + nu + 2, a, a + nu + 2, a + nu + 1);
      }
    };
    const belly = (u: number, v: number) => 0.09 * sizeK * Math.sin(Math.PI * u) * Math.sin(Math.PI * Math.min(1, v * 1.15));
    const sag = (u: number, v: number) => 0.14 * sizeK * Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
    panel('back', W, H, 16, 8, (u, v) => [bx + sign * belly(u, v), v * H, -W / 2 + u * W], [sign, 0, 0]);
    panel('roof', D, W, 6, 16, (u, v) => [gx + sign * u * D, H - sag(u, v), -W / 2 + v * W], [0, 1, 0]);
    for (const zs of [-1, 1]) panel(zs < 0 ? 'left' : 'right', D, H, 6, 8,
      (u, v) => [gx + sign * u * D, v * H, zs * W / 2], [0, 0, zs]);
    this.base = Float32Array.from(verts);
    this.normal = Float32Array.from(norms);
    this.anchors = Float32Array.from(anchors);
    this.pos = new THREE.BufferAttribute(Float32Array.from(verts), 3).setUsage(THREE.DynamicDrawUsage);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', this.pos);
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    if (geo.boundingSphere) geo.boundingSphere.radius += 0.6;
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0xf6f6ee, alphaMap: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
  }

  punch(x: number, y: number, z: number, amp: number): void {
    if (![x, y, z, amp].every(Number.isFinite) || amp <= 0) return;
    const { goalX, depth, width, height } = this.shape;
    const back = Math.abs(x - goalX - this.sign * depth), roof = Math.abs(y - height), side = Math.abs(Math.abs(z) - width / 2);
    const panel: Panel = back <= roof && back <= side ? 'back' : roof <= side ? 'roof' : z < 0 ? 'left' : 'right';
    this.impacts.push({ x, y: clamp(y, 0, height), z: clamp(z, -width / 2, width / 2), panel, amp: clamp(amp, 0, 1.4), t: 0 });
    if (this.impacts.length > 3) this.impacts.shift();
  }

  update(dt: number): void {
    if (!this.impacts.length) return;
    const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    for (const im of this.impacts) im.t += step;
    this.impacts = this.impacts.filter((im) => im.t < 1.6);
    const p = this.pos.array as Float32Array;
    const sizeK = this.shape.height / GOAL_H;
    for (let i = 0; i < this.base.length; i += 3) {
      let off = 0;
      for (const im of this.impacts) {
        if (this.panels[i / 3] !== im.panel) continue;
        const dx = this.base[i] - im.x, dy = this.base[i + 1] - im.y, dz = this.base[i + 2] - im.z;
        const fall = Math.exp(-(dx * dx + dy * dy + dz * dz) / (1.7 * sizeK * sizeK));
        off += im.amp * 0.4 * sizeK * fall * Math.exp(-im.t * 3.2) * Math.cos(im.t * 14);
      }
      off = clamp(off, -0.18 * sizeK, 0.55 * sizeK) * this.anchors[i / 3];
      p[i] = this.base[i] + this.normal[i] * off;
      p[i + 1] = this.base[i + 1] + this.normal[i + 1] * off;
      p[i + 2] = this.base[i + 2] + this.normal[i + 2] * off;
    }
    this.pos.needsUpdate = true;
  }

  /** The shop can sample a new still without borrowing the live preview's previous impacts. */
  reset(): void {
    this.impacts.length = 0;
    (this.pos.array as Float32Array).set(this.base);
    this.pos.needsUpdate = true;
  }
}
