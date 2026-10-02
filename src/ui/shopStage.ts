import * as THREE from 'three';
import { CELEB, Footballer, PSTATE, ballSkinOf, buildBallGeometry, charMaterial, type PoseInput } from '../render/characters';
import { goalFxColors, trailColors } from '../render/cosmetics';
import { Effects } from '../render/effects';
import { BoxBuilder, voxelMaterial } from '../render/voxel';
import type { Kit, PlayerDef } from '../sim/types';

/**
 * The SHOP's showcase (ui/shop.ts): the selected item, live, on a grass block, drawn by the match's own code.
 * A celebration is your star player in your kit doing the move (characters.ts poses, timed like the goal rig in
 * render/celebration.ts), a ball look the real voxel ball bouncing, a goal theme the match's Effects bursting
 * out of a goal mouth in that palette (render/cosmetics.ts), a trail your man sprinting with those speed lines.
 * One small renderer, copied into the canvas (like KitPreview); it also takes still shots for the item tiles.
 */
export type StageCat = 'celebration' | 'ball' | 'goalfx' | 'trail';

/** Base camera for a standing player (KitPreview's), and the yaw that points his face (model +x) at it. */
const CAM = new THREE.Vector3(2.6, 1.9, 3.4);
const FACE = Math.atan2(-CAM.z, CAM.x);
/** Side-on to the lens (the backflip, the sprint): the model's +z towards the camera. */
const PROFILE = Math.atan2(CAM.x, CAM.z);
/** Seconds each move's loop lasts on the stage. */
const LOOP: { readonly [k: string]: number } = { classic: 3, knee: 3.8, shush: 3.6, plane: 4, robot: 3, backflip: 3.4, pile: 4.4 };

const BASE: PoseInput = {
  state: PSTATE.celebrate, stateT: 0, speed: 0, runPhase: 0, kickT: 0, kickLeg: 1, lean: 0, diveDir: 0, headerT: 0,
  celebrate: 0, y: 0, keeper: false, hasBall: false, look: 0, turn: 0, dt: 0,
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeOut = (k: number) => 1 - (1 - k) * (1 - k);

/** Where one dancer is and what he is doing `t` s into a move's loop. */
interface Beat {
  pose: PoseInput;
  x: number;
  z: number;
  yaw: number;
}

function beat(pose: Partial<PoseInput>, x = 0, z = 0, yaw = FACE): Beat {
  return { pose: { ...BASE, ...pose }, x, z, yaw };
}

/** Forward along a yaw (the model faces +x; rotation.y = yaw turns that to (cos, 0, -sin)). */
const fwd = (yaw: number, d: number): [number, number] => [Math.cos(yaw) * d, -Math.sin(yaw) * d];

/** The scorer's beat `t` s into celebration `id`'s loop (the moves' timings follow render/celebration.ts). */
function heroBeat(id: string, t: number): Beat {
  switch (id) {
    case 'knee': {
      // A short sprint at the lens, then down on one knee and sliding on; the arms rise as the slide dies.
      if (t < 0.6) {
        const [x, z] = fwd(FACE, -1.3 + t * 1.6);
        return beat({ state: PSTATE.move, speed: 7.5, runPhase: t * 1.9 }, x, z);
      }
      const s = t - 0.6;
      const [x, z] = fwd(FACE, -0.34 + 1.1 * easeOut(clamp01(s / 1.3)));
      return beat({ celebrate: CELEB.knee, stateT: s, kickT: s / 1.3 }, x, z);
    }
    case 'shush': {
      if (t < 0.5) {
        const [x, z] = fwd(FACE, -0.5 + t);
        return beat({ state: PSTATE.move, speed: 4, runPhase: t * 1.3 }, x, z);
      }
      const s = t - 0.5;
      return beat({ celebrate: CELEB.shush, stateT: s, kickT: clamp01(s / 0.4) * (0.86 + 0.14 * Math.sin(s * 2.4)) });
    }
    case 'plane': {
      // Banking left and right as he wheels about (the yaw follows the bank).
      const bank = Math.sin(t * 1.6) * 0.8;
      return beat({ celebrate: CELEB.plane, speed: 6, runPhase: t * 1.6, kickT: bank }, 0, 0, FACE + bank * 0.7);
    }
    case 'robot':
      return beat({ celebrate: CELEB.robot, stateT: t });
    case 'backflip': {
      // Wind up, a full turn backwards in the air (side-on to the lens), stick the landing, arms up.
      if (t < 0.45) return beat({ celebrate: CELEB.armsUp }, 0, 0, PROFILE);
      if (t < 1) return beat({ celebrate: CELEB.crouch, kickT: 1 - 0.8 * clamp01((t - 0.45) / 0.5) ** 2 }, 0, 0, PROFILE);
      if (t < 1.7) {
        const a = t - 1;
        return beat({ celebrate: CELEB.flip, kickT: a / 0.7, y: Math.max(0, 6.3 * a - 9 * a * a) }, 0, 0, PROFILE);
      }
      if (t < 2.1) return beat({ celebrate: CELEB.crouch, kickT: (t - 1.7) / 0.4 }, 0, 0, PROFILE);
      return beat({ celebrate: CELEB.armsUp, stateT: t }, 0, 0, FACE);
    }
    case 'pile': {
      if (t < 0.55) return beat({ celebrate: CELEB.armsUp });
      return beat({ celebrate: CELEB.flat, kickT: (t - 0.55) / 0.35 }, 0, 0, FACE + 0.5);
    }
    default:
      // The classic: arms up and hopping.
      return beat({ celebrate: 0, stateT: t, runPhase: 0.2 }, 0, 0, FACE + Math.sin(t * 1.4) * 0.3);
  }
}

/** The pile-on's two team-mates: a run in, a dive onto the stack, then lying on it. */
function mateBeat(k: number, t: number): Beat {
  const leap = 1.15 + k * 0.5;
  const side = k === 0 ? 1 : -1;
  const from: [number, number] = [-1.9 + 0.3 * k, side * 1.2];
  const to: [number, number] = [0.05 * side, 0.1 * side];
  const yaw = Math.atan2(-(to[1] - from[1]), to[0] - from[0]);
  if (t < leap - 0.5) return beat({ state: PSTATE.move, speed: 0 }, from[0], from[1], yaw);
  if (t < leap) {
    const u = (t - (leap - 0.5)) / 0.5;
    const x = from[0] + (to[0] - from[0]) * u * 0.55;
    const z = from[1] + (to[1] - from[1]) * u * 0.55;
    return beat({ state: PSTATE.move, speed: 7, runPhase: t * 1.8 }, x, z, yaw);
  }
  const u = clamp01((t - leap) / 0.4);
  const x = from[0] + (to[0] - from[0]) * (0.55 + 0.45 * u);
  const z = from[1] + (to[1] - from[1]) * (0.55 + 0.45 * u);
  const rest = 0.24 + 0.26 * k;
  const y = rest + Math.sin(Math.PI * u) * 0.5 * (1 - u * 0.3);
  return beat({ celebrate: CELEB.dive, kickT: u, y }, x, z, yaw);
}

export interface StageShow {
  cat: StageCat;
  id: string;
}

export class ShopStage {
  private renderer: THREE.WebGLRenderer | null = null;
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 80);
  private scene = new THREE.Scene();
  private hero: Footballer;
  private mates: Footballer[] = [];
  private ball: THREE.Mesh;
  private goal: THREE.Mesh;
  private fx = new Effects(520);
  private canvas: HTMLCanvasElement | null = null;
  private show: StageShow = { cat: 'celebration', id: 'classic' };
  private raf = 0;
  private last = 0;
  /** Seconds into the current show (restarts on every set()). */
  private t = 0;
  private fxAcc = 0;
  private burstAt = -1;

  constructor(def: PlayerDef, private readonly kit: Kit) {
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.shadowMap.enabled = true;
    } catch {
      this.renderer = null; // No second WebGL context: the shop keeps its flat tiles.
    }
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0xd6e8ff, 0x7a9a5c, 1.4));
    const sun = new THREE.DirectionalLight(0xfff6e6, 2.6);
    sun.position.set(-3, 6, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(512, 512);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -3;
    sc.right = sc.top = 3;
    s.add(sun);
    // A soft fill from the lens side: the showcase reads front-lit, like a store shot (the sun stays the key).
    const fill = new THREE.DirectionalLight(0xffffff, 0.9);
    fill.position.set(4, 3, 5);
    s.add(fill);
    const b = new BoxBuilder();
    b.box(0, -0.2, 0, 3.2, 0.4, 3.2, 0x6f9e3a, { top: 0x9ed25a });
    b.box(0, -0.52, 0, 2.9, 0.24, 2.9, 0x8a5a36);
    const block = new THREE.Mesh(b.build(), voxelMaterial);
    block.receiveShadow = true;
    s.add(block);
    // A goal frame for the goal themes: posts, crossbar and a white net box behind (hidden otherwise).
    const g = new BoxBuilder();
    g.box(-1.1, 0.8, -1.25, 0.12, 1.6, 0.12, 0xfbfbf4);
    g.box(-1.1, 0.8, 1.25, 0.12, 1.6, 0.12, 0xfbfbf4);
    g.box(-1.1, 1.6, 0, 0.12, 0.12, 2.62, 0xfbfbf4);
    g.box(-1.5, 1.4, 0, 0.04, 0.04, 2.5, 0xe7e3d6);
    g.box(-1.5, 0.7, -1.25, 0.8, 1.4, 0.03, 0xe7e3d6);
    g.box(-1.5, 0.7, 1.25, 0.8, 1.4, 0.03, 0xe7e3d6);
    g.box(-1.88, 0.7, 0, 0.03, 1.4, 2.5, 0xe7e3d6);
    this.goal = new THREE.Mesh(g.build(), voxelMaterial);
    this.goal.castShadow = true;
    s.add(this.goal);
    this.hero = new Footballer(def, kit, false);
    this.hero.group.traverse((o) => (o.castShadow = true));
    s.add(this.hero.group);
    for (let k = 0; k < 2; k++) {
      const m = new Footballer({ ...def, id: `${def.id}-m${k}`, look: { ...def.look, hair: (def.look.hair + 3 + k * 2) % 9, skin: (def.look.skin + 2 + k) % 6 } }, kit, false);
      m.group.visible = false;
      s.add(m.group);
      this.mates.push(m);
    }
    this.ball = new THREE.Mesh(buildBallGeometry(0.42), charMaterial);
    this.ball.castShadow = true;
    s.add(this.ball);
    s.add(this.fx.mesh);
    this.apply(this.show);
  }

  get ok(): boolean {
    return this.renderer !== null;
  }

  /** Draw into `canvas` from now on (the shop re-renders its panel: the new canvas takes over). */
  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    if (this.renderer && !this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.loop);
    }
  }

  /** Show an item (its loop starts over). */
  set(show: StageShow): void {
    this.show = { ...show };
    this.t = 0;
    this.burstAt = -1;
    this.fx.clear();
    this.apply(show);
  }

  /** What is in the scene for a show, and where the lens is. */
  private apply(show: StageShow): void {
    const { cat } = show;
    this.hero.group.visible = cat === 'celebration' || cat === 'trail';
    for (const m of this.mates) m.group.visible = cat === 'celebration' && show.id === 'pile';
    this.ball.visible = cat === 'ball' || cat === 'goalfx';
    this.goal.visible = cat === 'goalfx';
    if (cat === 'ball') this.ball.geometry = buildBallGeometry(0.42, ballSkinOf(show.id));
    else if (cat === 'goalfx') this.ball.geometry = buildBallGeometry(0.16);
    this.hero.group.position.set(0, 0, 0);
    this.hero.group.rotation.set(0, FACE, 0);
  }

  /** Pose everything `t` s into the current show; `dt` drives the pose blends and the particles (0: a still). */
  private frame(t: number, dt: number): void {
    const { cat, id } = this.show;
    if (cat === 'celebration') {
      const L = LOOP[id] ?? 3;
      const u = t % L;
      const b = heroBeat(id, u);
      this.placeDancer(this.hero, b, t, dt);
      if (id === 'pile') this.mates.forEach((m, k) => this.placeDancer(m, mateBeat(k, u), t, dt));
    } else if (cat === 'ball') {
      const k = Math.abs(Math.sin(t * 2.6));
      this.ball.position.set(0, 0.42 + k * 0.7, 0);
      this.ball.rotation.set(t * 1.7, t * 0.9, t * 0.4);
      this.ball.scale.set(1 + (1 - k) ** 6 * 0.12, 1 - (1 - k) ** 6 * 0.16, 1 + (1 - k) ** 6 * 0.12);
    } else if (cat === 'goalfx') {
      // The ball flies in, hits the net, and the goal mouth explodes in the theme's colours.
      const cycle = 2.6;
      const u = t % cycle;
      const n = Math.floor(t / cycle);
      const k = clamp01(u / 0.45);
      this.ball.visible = u < 0.5;
      this.ball.position.set(1.4 - 2.7 * k, 0.3 + Math.sin(Math.PI * k) * 0.6 + k * 0.5, 0.5 - k * 0.6);
      this.ball.rotation.set(t * 8, 0, t * 5);
      if (dt > 0 && n !== this.burstAt && u >= 0.45) {
        this.burstAt = n;
        const cols = goalFxColors(id, [this.kit.shirt, this.kit.shirt2, 0xffd23a, 0xfbfbf4]);
        this.fx.burst(-1.2, 0.9, -0.1, cols, 70, 6, 1.1);
        this.fx.burst(-1.0, 0.3, 0, cols, 30, 4, 0.9);
        for (let i = 0; i < 70; i++) {
          this.fx.spawn((Math.random() - 0.5) * 3, 3.2 + Math.random() * 1.6, (Math.random() - 0.5) * 2.6,
            (Math.random() - 0.5) * 0.6, -Math.random(), (Math.random() - 0.5) * 0.6, cols[i % cols.length], 0.07 + Math.random() * 0.05, 2 + Math.random(), 1.2, 1.6);
        }
      }
    } else if (cat === 'trail') {
      // Sprinting side-on, the speed lines streaming off his heels in the trail's colours. (f is the sim's facing:
      // the body turns by -f, so -PROFILE runs him across the lens.)
      const f = -PROFILE;
      this.hero.group.position.set(0, 0, 0);
      this.hero.group.rotation.y = -f;
      this.hero.pose({ ...BASE, state: PSTATE.move, speed: 8.5, runPhase: t * 1.75, dt }, t);
      if (dt > 0) {
        const cols = trailColors(id);
        const bold = cols.length > 1 || cols[0] !== 0xf4f4ea;
        const ux = Math.cos(f), uz = Math.sin(f);
        this.fxAcc += dt * 34;
        while (this.fxAcc >= 1) {
          this.fxAcc -= 1;
          const sway = (Math.random() - 0.5) * 0.7;
          const col = cols[(Math.random() * cols.length) | 0];
          this.fx.streak(-ux * 0.45 - uz * sway, 0.15 + Math.random() * 0.75, -uz * 0.45 + ux * sway, f, 0.6 + Math.random() * 0.6,
            bold ? 0.07 : 0.05, col, 0.32, -ux * 4.5, -uz * 4.5);
        }
      }
    }
    if (dt > 0) this.fx.update(dt);
  }

  private placeDancer(p: Footballer, b: Beat, t: number, dt: number): void {
    p.group.position.set(b.x, 0, b.z);
    p.group.rotation.set(0, b.yaw, 0);
    p.pose({ ...b.pose, dt }, t);
  }

  /** Frame the lens for the show in a w x h canvas (`tight`: a tile's still, closer in). */
  private aim(w: number, h: number, tight = false): void {
    const cam = this.camera;
    cam.aspect = w / h;
    const { cat, id } = this.show;
    let back = 1.6 / Math.min(1, cam.aspect);
    let look = 1.0;
    if (cat === 'ball') {
      back = 0.95 / Math.min(1, cam.aspect);
      look = 0.85;
    } else if (cat === 'goalfx') {
      back = 1.75 / Math.min(1, cam.aspect);
      look = 1.15;
    } else if (cat === 'celebration' && (id === 'pile' || id === 'knee' || id === 'backflip')) {
      back = 1.85 / Math.min(1, cam.aspect);
      look = id === 'backflip' ? 1.3 : 0.85;
    }
    if (tight) back *= 0.84;
    cam.position.set(CAM.x * back, CAM.y + (back - 1) * 0.9, CAM.z * back);
    cam.lookAt(0, look, 0);
    cam.updateProjectionMatrix();
  }

  private loop = (now: number): void => {
    this.raf = requestAnimationFrame(this.loop);
    const r = this.renderer;
    const c = this.canvas;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!r || !c || !c.isConnected) {
      // No canvas showing (the PLAYERS tab, or the screen went): rest until attach() hands over a new one. The
      // shop's close (onMetaClose) frees the renderer.
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      return;
    }
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w || !h) return;
    this.t += dt;
    this.frame(this.t, dt);
    const dpr = r.getPixelRatio();
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (c.width !== bw || c.height !== bh) {
      c.width = bw;
      c.height = bh;
    }
    r.setSize(w, h, false);
    this.aim(w, h);
    r.render(this.scene, this.camera);
    const g = c.getContext('2d');
    if (g) {
      g.clearRect(0, 0, bw, bh);
      g.drawImage(r.domElement, 0, 0, bw, bh);
    }
  };

  /**
   * A still of `show` at `t` s into its loop, `px` square, as a PNG data URL (the item tiles); null without
   * WebGL. The live show carries on afterwards where it was.
   */
  still(show: StageShow, t: number, px = 160): string | null {
    const r = this.renderer;
    if (!r) return null;
    const keep = this.show;
    const keepT = this.t;
    this.show = show;
    this.apply(show);
    this.frame(t, 0);
    r.setSize(px, px, false);
    this.aim(px, px, true);
    let url: string | null = null;
    try {
      r.render(this.scene, this.camera);
      url = r.domElement.toDataURL('image/png');
    } catch {
      url = null;
    }
    this.show = keep;
    this.t = keepT;
    this.apply(keep);
    return url;
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.canvas = null;
    this.fx.clear();
    this.hero.dispose();
    for (const m of this.mates) m.dispose();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer = null;
  }
}
