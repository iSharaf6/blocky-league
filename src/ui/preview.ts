import * as THREE from 'three';
import { Footballer, PSTATE, type PoseInput } from '../render/characters';
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
