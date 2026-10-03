import * as THREE from 'three';
import { CELEB, Footballer, PSTATE, ballSkinOf, buildBallGeometry, charMaterial, type PoseInput } from '../render/characters';
import { goalFxColors, trailColors } from '../render/cosmetics';
import { Effects } from '../render/effects';
import { goalShow } from '../render/fx/goals';
import { FxKit, TrailState } from '../render/fx/kit';
import { emitTrail, trailDef } from '../render/fx/trails';
import { BoxBuilder, voxelMaterial } from '../render/voxel';
import type { Kit, PlayerDef } from '../sim/types';

/**
 * The SHOP's showcase (ui/shop.ts): the selected item, live, on a grass block, drawn by the match's own code.
 * A celebration is your star player in your kit doing the move (characters.ts poses, timed like the goal rig in
 * render/celebration.ts), a ball look the real voxel ball bouncing, a goal explosion the match's own show
 * (render/fx/goals.ts) going off in a little goal after the ball hits the net, a trail your man sprinting with
 * the match's own emitter (render/fx/trails.ts) behind him. One small renderer, copied into the canvas (like
 * KitPreview); it also takes still shots for the item tiles, the effects run up to their best moment.
 */
export type StageCat = 'celebration' | 'ball' | 'goalfx' | 'trail';

/** Base camera for a standing player (KitPreview's), and the yaw that points his face (model +x) at it. */
const CAM = new THREE.Vector3(2.6, 1.9, 3.4);
const FACE = Math.atan2(-CAM.z, CAM.x);
/** Side-on to the lens (the backflip, the sprint): the model's +z towards the camera. */
const PROFILE = Math.atan2(CAM.x, CAM.z);
/** The stage's goal is about a third the size of a real one: the shows run at this scale. */
const STAGE_K = 0.34;
/** The ground slides back under the sprinter at this speed (m/s): his trail streams away behind him. */
const TREADMILL = 3.4;

/** One set of effects: the match's particles, the cosmetics kit, a trail's state and the show's beat. */
interface Rig {
  fx: Effects;
  kit: FxKit;
  ts: TrailState;
  acc: number;
  burstAt: number;
}
const makeRig = (): Rig => ({ fx: new Effects(520), kit: new FxKit(), ts: new TrailState(), acc: 0, burstAt: -1 });

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
  /** The live show's effects, and a second set the tile stills run in (so a still never disturbs the live show). */
  private live = makeRig();
  private stillRig = makeRig();
  private rig = this.live;
  private canvas: HTMLCanvasElement | null = null;
  private show: StageShow = { cat: 'celebration', id: 'classic' };
  private raf = 0;
  private last = 0;
  /** Seconds into the current show (restarts on every set()). */
  private t = 0;

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
    for (const r of [this.live, this.stillRig]) s.add(r.fx.mesh, r.kit.group);
    this.showRig(this.stillRig, false);
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
    this.resetRig(this.live);
    this.apply(show);
  }

  private resetRig(r: Rig): void {
    r.fx.clear();
    r.kit.clear();
    r.kit.group.position.set(0, 0, 0);
    r.ts.reset();
    r.acc = 0;
    r.burstAt = -1;
  }

  private showRig(r: Rig, on: boolean): void {
    r.fx.mesh.visible = on;
    r.kit.group.visible = on;
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
      // The ball flies in, hits the net, and the goal mouth goes off: the match's own show, a third the size.
      const def = goalShow(id);
      const R = this.rig;
      const cycle = def ? Math.max(2.6, def.dur + 0.9) : 2.6;
      const u = t % cycle;
      const n = Math.floor(t / cycle);
      const k = clamp01(u / 0.45);
      this.ball.visible = u < 0.5;
      this.ball.position.set(1.4 - 2.7 * k, 0.3 + Math.sin(Math.PI * k) * 0.6 + k * 0.5, 0.5 - k * 0.6);
      this.ball.rotation.set(t * 8, 0, t * 5);
      if (dt > 0 && n !== R.burstAt && u >= 0.45) {
        R.burstAt = n;
        const cols = goalFxColors(id, [this.kit.shirt, this.kit.shirt2, 0xffd23a, 0xfbfbf4]);
        if (def) R.kit.play(def.run, def.dur, -1.1, 0, -0.05, 1, 0, def.stageK ?? STAGE_K, cols, 0);
        else {
          // Club Colours: the match's plain burst and confetti in your kit.
          R.fx.burst(-1.2, 0.9, -0.1, cols, 70, 6, 1.1);
          R.fx.burst(-1.0, 0.3, 0, cols, 30, 4, 0.9);
          for (let i = 0; i < 70; i++) {
            R.fx.spawn((Math.random() - 0.5) * 3, 3.2 + Math.random() * 1.6, (Math.random() - 0.5) * 2.6,
              (Math.random() - 0.5) * 0.6, -Math.random(), (Math.random() - 0.5) * 0.6, cols[i % cols.length], 0.07 + Math.random() * 0.05, 2 + Math.random(), 1.2, 1.6);
          }
        }
      }
    } else if (cat === 'trail') {
      // Sprinting side-on, the trail streaming off him. (f is the sim's facing: the body turns by -f, so -PROFILE
      // runs him across the lens.) He runs on the spot; the ground (the effects' group) slides back under him.
      const f = -PROFILE;
      const R = this.rig;
      this.hero.group.position.set(0, 0, 0);
      this.hero.group.rotation.y = -f;
      this.hero.pose({ ...BASE, state: PSTATE.move, speed: 8.5, runPhase: t * 1.75, dt }, t);
      if (dt > 0) {
        const cols = trailColors(id);
        const ux = Math.cos(f), uz = Math.sin(f);
        if (trailDef(id)) {
          const g = R.kit.group.position;
          g.x -= ux * TREADMILL * dt;
          g.z -= uz * TREADMILL * dt;
          emitTrail(R.kit, R.ts, id, cols, -g.x, 0, -g.z, ux, uz, TREADMILL, dt);
        } else {
          // Chalk: the match's plain speed lines.
          R.acc += dt * 34;
          while (R.acc >= 1) {
            R.acc -= 1;
            const sway = (Math.random() - 0.5) * 0.7;
            const col = cols[(Math.random() * cols.length) | 0];
            R.fx.streak(-ux * 0.45 - uz * sway, 0.15 + Math.random() * 0.75, -uz * 0.45 + ux * sway, f, 0.6 + Math.random() * 0.6,
              0.05, col, 0.32, -ux * TREADMILL, -uz * TREADMILL);
          }
        }
      }
    }
    if (dt > 0) this.rig.fx.update(dt);
    this.rig.kit.update(dt, this.camera);
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
    // (A trail: the lens looks a little behind the runner, where it streams.)
    let lx = 0, lz = 0;
    if (cat === 'trail') {
      back = 1.9 / Math.min(1, cam.aspect);
      look = 0.95;
      lx = -Math.cos(-PROFILE) * 0.8;
      lz = -Math.sin(-PROFILE) * 0.8;
    } else if (cat === 'ball') {
      back = 0.95 / Math.min(1, cam.aspect);
      look = 0.85;
    } else if (cat === 'goalfx') {
      // (Wide enough for a show's sky: fireworks, a rainbow, a meteor coming in.)
      back = 2.15 / Math.min(1, cam.aspect);
      look = 1.6;
    } else if (cat === 'celebration' && (id === 'pile' || id === 'knee' || id === 'backflip')) {
      back = 1.85 / Math.min(1, cam.aspect);
      look = id === 'backflip' ? 1.3 : 0.85;
    }
    if (tight) back *= cat === 'goalfx' || cat === 'trail' ? 0.92 : 0.84;
    cam.position.set(CAM.x * back + lx, CAM.y + (back - 1) * 0.9, CAM.z * back + lz);
    cam.lookAt(lx, look, lz);
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
   * A still of `show` at `t` s into its loop (by default: a goal explosion or trail at its best moment), `px`
   * square, as a PNG data URL (the item tiles); null without WebGL. An effect is run up to that moment in a set of
   * its own; the live show carries on afterwards where it was.
   */
  still(show: StageShow, t?: number, px = 160): string | null {
    const r = this.renderer;
    if (!r) return null;
    const keep = this.show;
    const keepT = this.t;
    this.show = show;
    this.apply(show);
    r.setSize(px, px, false);
    this.aim(px, px, true);
    const fx = show.cat === 'goalfx' || show.cat === 'trail';
    if (fx) {
      const at = t ?? (show.cat === 'goalfx' ? 0.45 + (goalShow(show.id)?.still ?? 0.4) : trailDef(show.id)?.still ?? 0.6);
      this.rig = this.stillRig;
      this.resetRig(this.stillRig);
      this.showRig(this.live, false);
      this.showRig(this.stillRig, true);
      const step = 1 / 30;
      for (let tt = step; tt < at + step / 2; tt += step) this.frame(tt, step);
    } else this.frame(t ?? 1, 0);
    let url: string | null = null;
    try {
      r.render(this.scene, this.camera);
      url = r.domElement.toDataURL('image/png');
    } catch {
      url = null;
    }
    if (fx) {
      this.resetRig(this.stillRig);
      this.showRig(this.stillRig, false);
      this.showRig(this.live, true);
      this.rig = this.live;
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
    for (const r of [this.live, this.stillRig]) {
      r.fx.clear();
      r.kit.dispose();
    }
    this.hero.dispose();
    for (const m of this.mates) m.dispose();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer = null;
  }
}

// ------------------------------------------------------------------ dev: look at every cosmetic without buying it

if (import.meta.env.DEV && typeof window !== 'undefined') {
  /**
   * window.__blfx (dev builds only):
   *  - sheet(cat, ids?, times?): a contact sheet of stage stills over the page, `times` s into each effect
   *    (goal explosions: after the ball hits the net). Click it to close. E.g. __blfx.sheet('goalfx', ['popcorn']).
   *  - goal(id): in a match (window.__bl.session), set that goal explosion off at the nearest goal now.
   *  - trail(id): in a match, wear that trail (sprint with the player you control, or hit a hard shot).
   *  - ids: every id by category.
   */
  const sheet = async (cat: StageCat, ids?: readonly string[], times: readonly number[] = [0.3, 0.9, 1.6], px = 200): Promise<number> => {
    const [{ PRESET_CLUBS, makeTeam }, save] = await Promise.all([import('../meta/data'), import('../core/save')]);
    const all: { readonly [k in StageCat]: readonly string[] } = {
      celebration: save.CELEBRATION_IDS, ball: save.BALL_SKIN_IDS, goalfx: save.GOAL_FX_IDS, trail: save.TRAIL_IDS,
    };
    const team = makeTeam(PRESET_CLUBS[0]);
    const st = new ShopStage(team.players[9], team.kit);
    const box = document.createElement('div');
    box.id = 'blfx-sheet';
    box.style.cssText = `position:fixed;inset:0;z-index:99999;background:#1c1f2a;overflow:auto;display:grid;gap:2px;grid-template-columns:repeat(${times.length},1fr);cursor:pointer`;
    for (const id of ids ?? all[cat]) {
      for (const t of times) {
        const url = st.still({ cat, id }, (cat === 'goalfx' ? 0.45 : 0) + t, px);
        if (!url) continue;
        const img = document.createElement('img');
        img.src = url;
        img.title = `${id} ${t}s`;
        img.style.width = '100%';
        box.appendChild(img);
      }
    }
    st.dispose();
    document.getElementById('blfx-sheet')?.remove();
    box.onclick = () => box.remove();
    document.body.appendChild(box);
    return box.children.length;
  };
  type V3 = { x: number; y: number; z: number };
  type DevMatch = {
    phase: string; cfg: { humanSide: number }; attackDir: (side: number) => number;
    ball: { pos: V3; vel: V3; owner: number; held: boolean; lastTouch: number };
    players: { idx: number; side: number; isKeeper: boolean; pos?: V3 }[];
  };
  type Session = { previewGoalFx?: (id: string) => boolean; previewTrail?: (id: string) => void; opt?: { goalFx?: string }; match?: DevMatch } | null | undefined;
  const session = (): Session => (window as unknown as { __bl?: { session?: Session } }).__bl?.session;
  (window as unknown as { __blfx: unknown }).__blfx = {
    sheet,
    goal: (id: string) => session()?.previewGoalFx?.(id) ?? false,
    trail: (id: string) => session()?.previewTrail?.(id),
    /**
     * In a match, in play: your side scores at once with goal explosion `id` (the ball is put into the corner
     * from 1.5 m out, away from the keeper), so the whole goal plays out: the wide shot, the show, the
     * celebration. (Let the camera get near that goal first for the true broadcast framing.) A hidden pane needs
     * __bl.step(n) to run it.
     */
    score: (id?: string): boolean => {
      const s = session();
      const m = s?.match;
      if (!s || !m || m.phase !== 'play' || m.cfg.humanSide < 0) return false;
      if (id !== undefined && s.opt) s.opt.goalFx = id;
      const side = m.cfg.humanSide;
      const dir = m.attackDir(side);
      const kicker = m.players.find((p) => p.side === side && !p.isKeeper);
      // (Into the corner away from their keeper.)
      const keeper = m.players.find((p) => p.side !== side && p.isKeeper) as { pos?: V3 } | undefined;
      const aim = -(Math.sign(keeper?.pos?.z ?? 1) || 1) * 3;
      const b = m.ball;
      b.owner = -1;
      b.held = false;
      b.pos.x = dir * 51;
      b.pos.y = 0.8;
      b.pos.z = aim * 0.85;
      b.vel.x = dir * 16;
      b.vel.y = 0.5;
      b.vel.z = aim * 0.5;
      if (kicker) b.lastTouch = kicker.idx;
      return true;
    },
    get ids() {
      return import('../core/save').then((s) => ({ goalfx: s.GOAL_FX_IDS, trail: s.TRAIL_IDS, ball: s.BALL_SKIN_IDS }));
    },
  };
}
