import * as THREE from 'three';
import { LOOK_SLOT_OF, type LookId } from '../core/save';
import { bundleOf, equipItem, grantItem } from '../meta/shop';
import { CELEB, Footballer, PSTATE, ballSkinOf, buildBallGeometry, charMaterial, charMaterialFor, setKitGlow, tickKitFx, type PoseInput } from '../render/characters';
import { goalFxColors, trailColors } from '../render/cosmetics';
import { Effects } from '../render/effects';
import { goalShow } from '../render/fx/goals';
import { FxKit, TrailState } from '../render/fx/kit';
import { BEAR_DRUM, DRAGON_BREATH, ROBOT_SPARK, STAGE_SHOWS } from '../render/fx/stadiumFx';
import { BOOT_STEP_M, bootStep, emitTrail, trailDef } from '../render/fx/trails';
import { designKit, type LookSet, type StyledKit } from '../render/kitDesigns';
import { Mascot, cornerFlagGeometry, crestLawnGeometry, flagTexture, mascotKind, mowColor, nameBitmap, netAlpha, netColor, sheet, tifoTexture } from '../render/stadiumStyle';
import { crestFor, type CrestDesign } from '../core/crest';
import { BoxBuilder, voxelMaterial } from '../render/voxel';
import type { Kit, PlayerDef } from '../sim/types';
import { signatureMonth } from '../render/signatureStyle';

/**
 * The SHOP's showcase (ui/shop.ts): the selected item, live, on a grass block, drawn by the match's own code.
 * - A celebration is your star player doing the move (characters.ts poses, timed like render/celebration.ts), a ball
 *   look the real voxel ball bouncing, a goal explosion the match's own show (render/fx/goals.ts) in a little goal, a
 *   trail your man sprinting with the match's own emitter (render/fx/trails.ts).
 * - A PREMIUM KIT turns on a turntable on your captain, or (TEAM view) on your whole line-up; a PLAYER LOOK on your
 *   captain, framed on what it changes (his head, his arm, the boots, the keeper's gloves, shades on to celebrate).
 * - STADIUM STYLE is a little diorama built by the match's own builders (render/stadiumStyle.ts): the mown lawn,
 *   a goal in the new nets, the corner flag, a stand with your name in the seats, the tifo, the walkout, the
 *   floodlights' beams, the mascot dancing.
 * - A SET (bundle) and TRY IT ON are the full look: your team in the kit and looks, the ball, the lawn and nets, the
 *   goal explosion going off behind them.
 * Everyone on the stage wears what you have equipped (StageWear) except the item on show. One small renderer,
 * copied into the canvas (like KitPreview); it also takes stills for the item tiles.
 */
export type StageCat = 'celebration' | 'ball' | 'goalfx' | 'trail' | 'kit' | 'look' | 'decor' | 'bundle' | 'tryon';

/** Who is on the stage: the club's own kit (premium kits are drawn over it), its captain, team-mates and keeper. */
export interface StageClub {
  kit: Kit;
  short: string;
  /** The club's name (its crest comes from it: core/crest.ts crestFor). */
  name?: string;
  star: PlayerDef;
  mates: PlayerDef[];
  keeper: PlayerDef;
}

/** What the team wears around the item on show: the equipped looks (or TRY IT ON's mix). */
export interface StageWear {
  kit: string;
  looks: LookSet;
  ball: string;
  goalfx: string;
  decor: { [slot: string]: string };
}

/** Base camera for a standing player (KitPreview's), and the yaw that points his face (model +x) at it. */
const CAM = new THREE.Vector3(2.6, 1.9, 3.4);
const FACE = Math.atan2(-CAM.z, CAM.x);
/** Side-on to the lens (the backflip, the sprint): the model's +z towards the camera. */
const PROFILE = Math.atan2(CAM.x, CAM.z);
/** The stage's goal is about a third the size of a real one: the shows run at this scale. */
const STAGE_K = 0.34;
/** The ground slides back under the sprinter at this speed (m/s): his trail streams away behind him. */
const TREADMILL = 3.4;
/** The big block (line-ups and dioramas) and the small one, half sizes (m). */
const BIG = 2.4;
const SMALL = 1.6;
/** Where the line-up stands on the big block: the captain in front, two pairs behind (x towards the lens side). */
const LINEUP: readonly (readonly [number, number])[] = [[0.7, 0], [-0.1, -0.95], [-0.1, 0.95], [-0.9, -1.8], [-0.9, 1.8]];

/** One set of effects: the match's particles, the cosmetics kit, a trail's state and the show's beat. */
interface Rig {
  fx: Effects;
  kit: FxKit;
  ts: TrailState;
  acc: number;
  burstAt: number;
  ceremonyAt: number;
}
const makeRig = (): Rig => ({ fx: new Effects(520), kit: new FxKit(), ts: new TrailState(), acc: 0, burstAt: -1, ceremonyAt: -1 });

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

/** The pieces a stadium style diorama (or the full look) adds to the stage, rebuilt when it changes. */
interface Props {
  key: string;
  group: THREE.Group;
  /** Things to free with it (its own geometries, materials and textures; shared ones never go in here). */
  free: { dispose(): void }[];
  flags: THREE.Object3D[];
  beams: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; x: number; y: number; z: number; ph: number }[];
  /** The LED strip's three phases (a chase) and the lamps' lit heads. */
  leds: THREE.MeshBasicMaterial[];
  mascot: Mascot | null;
  /** Which loop of the mascot's act has started (it rests, then celebrates, again and again). */
  danceN: number;
  tifo: THREE.Mesh | null;
  /** The giant flag surfing over the stand: the cloth and how far each way it goes. */
  surfer: { mesh: THREE.Mesh; reach: number } | null;
  net: THREE.Mesh | null;
}

const WHITE = 0xfbfbf4;

export class ShopStage {
  /** Scratch colour for the props' lights (nothing allocated per frame). */
  private readonly propColor = new THREE.Color();
  private renderer: THREE.WebGLRenderer | null = null;
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 80);
  private scene = new THREE.Scene();
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private fill: THREE.DirectionalLight;
  private block: THREE.Mesh;
  private big: THREE.Mesh;
  /** The lawn's pattern over the block (a mowing style, or the crest). */
  private top: THREE.Mesh | null = null;
  private topKey = '';
  private hero!: Footballer;
  private mates: Footballer[] = [];
  private keeper!: Footballer;
  private dressKey = '';
  private ball: THREE.Mesh;
  private goal: THREE.Group;
  private goalFrame: THREE.Mesh;
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
  private props: Props | null = null;
  private wear: StageWear = { kit: 'club', looks: {}, ball: 'classic', goalfx: 'club', decor: {} };
  private tryOn: StageWear | null = null;
  /** What the current show puts on (the item on show over the wear). */
  private cur: StageWear = this.wear;
  /** The lens for the current show: distance factor, aim height, lateral aim, and how much higher it sits. */
  private lens = { back: 1.6, look: 1, lx: 0, lz: 0, up: 0 };
  /** Kits: the captain alone on a turntable, or the whole line-up. */
  view: 'solo' | 'team' = 'solo';
  /** The floodlights on (glowing kit trim and neon nets light up; the light show needs the dark). */
  private nightOn = false;

  constructor(private readonly club: StageClub) {
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
    this.hemi = new THREE.HemisphereLight(0xd6e8ff, 0x7a9a5c, 1.4);
    s.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff6e6, 2.6);
    this.sun.position.set(-3, 6, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(512, 512);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -4;
    sc.right = sc.top = 4;
    s.add(this.sun);
    // A soft fill from the lens side: the showcase reads front-lit, like a store shot (the sun stays the key).
    this.fill = new THREE.DirectionalLight(0xffffff, 0.9);
    this.fill.position.set(4, 3, 5);
    s.add(this.fill);
    const blockOf = (h: number) => {
      const b = new BoxBuilder();
      b.box(0, -0.2, 0, h * 2, 0.4, h * 2, 0x6f9e3a, { top: 0x9ed25a });
      b.box(0, -0.52, 0, h * 2 - 0.3, 0.24, h * 2 - 0.3, 0x8a5a36);
      const m = new THREE.Mesh(b.build(), voxelMaterial);
      m.receiveShadow = true;
      s.add(m);
      return m;
    };
    this.block = blockOf(SMALL);
    this.big = blockOf(BIG);
    // A goal frame for the goal themes: posts, crossbar and a white net box behind (hidden otherwise).
    const g = new BoxBuilder();
    g.box(-1.1, 0.8, -1.25, 0.12, 1.6, 0.12, 0xfbfbf4);
    g.box(-1.1, 0.8, 1.25, 0.12, 1.6, 0.12, 0xfbfbf4);
    g.box(-1.1, 1.6, 0, 0.12, 0.12, 2.62, 0xfbfbf4);
    this.goalFrame = new THREE.Mesh(g.build(), voxelMaterial);
    this.goalFrame.castShadow = true;
    const n = new BoxBuilder();
    n.box(-1.5, 1.4, 0, 0.04, 0.04, 2.5, 0xe7e3d6);
    n.box(-1.5, 0.7, -1.25, 0.8, 1.4, 0.03, 0xe7e3d6);
    n.box(-1.5, 0.7, 1.25, 0.8, 1.4, 0.03, 0xe7e3d6);
    n.box(-1.88, 0.7, 0, 0.03, 1.4, 2.5, 0xe7e3d6);
    const plainNet = new THREE.Mesh(n.build(), voxelMaterial);
    plainNet.name = 'plainNet';
    this.goal = new THREE.Group();
    this.goal.add(this.goalFrame, plainNet);
    s.add(this.goal);
    this.ball = new THREE.Mesh(buildBallGeometry(0.42), charMaterial);
    this.ball.castShadow = true;
    s.add(this.ball);
    for (const r of [this.live, this.stillRig]) s.add(r.fx.mesh, r.kit.group);
    this.showRig(this.stillRig, false);
    this.dress(this.styled(this.wear.kit, this.wear.looks));
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

  /** What the team wears around the item on show (the shop passes the equipped looks). */
  setWear(w: StageWear): void {
    this.wear = { ...w, looks: { ...w.looks }, decor: { ...w.decor } };
    this.apply(this.show);
  }

  /** TRY IT ON's mix (the item on show over everything equipped): shown by the 'tryon' show. */
  setTryOn(w: StageWear | null): void {
    this.tryOn = w ? { ...w, looks: { ...w.looks }, decor: { ...w.decor } } : null;
    if (this.show.cat === 'tryon') this.apply(this.show);
  }

  /** Show an item (its loop starts over). */
  set(show: StageShow): void {
    this.show = { ...show };
    this.t = 0;
    this.resetRig(this.live);
    this.apply(show);
  }

  /** Kits: the captain alone or the whole line-up (its loop starts over). */
  setView(v: 'solo' | 'team'): void {
    if (v === this.view) return;
    this.view = v;
    this.t = 0;
    this.apply(this.show);
  }

  get night(): boolean {
    return this.nightOn;
  }

  /** Under the floodlights (the glowing trim and the neon lights show), or back in the daylight. */
  setNight(on: boolean): void {
    this.nightOn = on;
    this.lightFor(this.show);
  }

  private resetRig(r: Rig): void {
    r.fx.clear();
    r.kit.clear();
    r.kit.group.position.set(0, 0, 0);
    r.ts.reset();
    r.acc = 0;
    r.burstAt = -1;
    r.ceremonyAt = -1;
  }

  private showRig(r: Rig, on: boolean): void {
    r.fx.mesh.visible = on;
    r.kit.group.visible = on;
  }

  // ------------------------------------------------------------------ dressing the team

  /** A kit in premium kit `kitId` (the club's own kit under it), the captain in `looks`. */
  private styled(kitId: string, looks: LookSet): StyledKit {
    const k = designKit(kitId, this.club.kit);
    if (Object.keys(looks).length) {
      k.looks = { ...looks };
      k.captain = this.club.star.id;
    }
    return k;
  }

  /** (Re)build the captain, his team-mates and the keeper in `kit` (only when it changed). */
  private dress(kit: StyledKit): void {
    const key = JSON.stringify([kit.design, kit.looks, kit.shirt, kit.shirt2, kit.pattern]);
    if (key === this.dressKey) return;
    this.dressKey = key;
    const s = this.scene;
    const keep = this.hero ? { pos: this.hero.group.position.clone(), rot: this.hero.group.rotation.y } : null;
    for (const f of [this.hero, ...this.mates, this.keeper]) f?.dispose();
    const club = this.club;
    this.hero = new Footballer(club.star, kit, false);
    this.hero.group.traverse((o) => (o.castShadow = true));
    s.add(this.hero.group);
    if (keep) {
      this.hero.group.position.copy(keep.pos);
      this.hero.group.rotation.y = keep.rot;
    }
    this.mates = [];
    for (let k = 0; k < 4; k++) {
      const def = club.mates[k] ?? { ...club.star, id: `${club.star.id}-m${k}`, number: (club.star.number + 3 + k * 4) % 99, look: { ...club.star.look, hair: (club.star.look.hair + 3 + k * 2) % 9, skin: (club.star.look.skin + 2 + k) % 6 } };
      const m = new Footballer(def, kit, false);
      m.group.visible = false;
      s.add(m.group);
      this.mates.push(m);
    }
    this.keeper = new Footballer(club.keeper, kit, true);
    this.keeper.group.visible = false;
    s.add(this.keeper.group);
  }

  /** What `show` puts on the team and the ground: the item over the wear (or TRY IT ON's mix, or a set's parts). */
  private wearFor(show: StageShow): StageWear {
    const base = show.cat === 'tryon' && this.tryOn ? this.tryOn : this.wear;
    const w: StageWear = { ...base, looks: { ...base.looks }, decor: { ...base.decor } };
    switch (show.cat) {
      case 'kit': w.kit = show.id; break;
      case 'look': {
        const slot = LOOK_SLOT_OF[show.id as LookId] ?? 'head';
        w.looks[slot] = show.id;
        // (A hairstyle is shown bare-headed: a crown or a hat on top would hide the very thing on show.)
        if (slot === 'hair') delete w.looks.head;
        break;
      }
      case 'ball': w.ball = show.id; break;
      case 'goalfx': w.goalfx = show.id; break;
      case 'decor': {
        const slot = decorSlot(show.id);
        if (slot) w.decor = { [slot]: show.id };
        break;
      }
      case 'bundle': {
        const b = bundleOf(show.id);
        for (const p of b?.parts ?? []) {
          if (p.cat === 'kit') w.kit = p.id;
          else if (p.cat === 'ball') w.ball = p.id;
          else if (p.cat === 'goalfx') w.goalfx = p.id;
          else if (p.cat === 'look') w.looks[LOOK_SLOT_OF[p.id as LookId] ?? 'head'] = p.id;
          else if (p.cat === 'decor') {
            const slot = decorSlot(p.id);
            if (slot) w.decor[slot] = p.id;
          }
        }
        break;
      }
    }
    return w;
  }

  // ------------------------------------------------------------------ the scene for a show

  /** The kind of scene a show is. */
  private sceneOf(show: StageShow): 'solo' | 'lineup' | 'look' | 'decor' | 'classic' {
    if (show.cat === 'kit') return this.view === 'team' ? 'lineup' : 'solo';
    if (show.cat === 'look') return 'look';
    if (show.cat === 'decor') return 'decor';
    if (show.cat === 'bundle' || show.cat === 'tryon') return 'lineup';
    return 'classic';
  }

  /** What is in the scene for a show, and where the lens is. */
  private apply(show: StageShow): void {
    const { cat } = show;
    const w = (this.cur = this.wearFor(show));
    this.dress(this.styled(w.kit, w.looks));
    const kind = this.sceneOf(show);
    const slot = cat === 'decor' ? decorSlot(show.id) : cat === 'look' ? LOOK_SLOT_OF[show.id as LookId] : undefined;
    const lineup = kind === 'lineup' || (kind === 'decor' && (slot === 'pitch' || slot === 'kickoff' || slot === 'lights'));
    const bigBlock = lineup || (kind === 'decor' && (slot === 'seats' || slot === 'tifo'));
    this.block.visible = !bigBlock;
    this.big.visible = bigBlock;
    // The people.
    const keeperShow = slot === 'gloves';
    this.hero.group.visible = !keeperShow && (kind !== 'decor' || lineup || slot === 'flags' || slot === 'net') && cat !== 'ball' && cat !== 'goalfx';
    for (const [k, m] of this.mates.entries()) m.group.visible = lineup || (cat === 'celebration' && show.id === 'pile' && k < 2);
    this.keeper.group.visible = keeperShow;
    this.hero.group.position.set(0, 0, 0);
    this.hero.group.rotation.set(0, FACE, 0);
    if (lineup) {
      const all = [this.hero, ...this.mates];
      all.forEach((f, i) => {
        f.group.visible = true;
        f.group.position.set(LINEUP[i][0], 0, LINEUP[i][1]);
        f.group.rotation.set(0, FACE, 0);
      });
    }
    if (kind === 'decor' && (slot === 'flags' || slot === 'net')) {
      this.hero.group.position.set(0.9, 0, 0.7);
    }
    // The ball and the goal.
    const ballOn = cat === 'ball' || cat === 'goalfx' || lineup || (kind === 'decor' && (slot === 'net' || slot === 'flags'));
    this.ball.visible = ballOn;
    if (cat === 'ball') this.ball.geometry = buildBallGeometry(0.42, ballSkinOf(show.id));
    else if (cat === 'goalfx' || (kind === 'decor' && slot === 'net')) this.ball.geometry = buildBallGeometry(0.16, ballSkinOf(w.ball));
    else if (ballOn) this.ball.geometry = buildBallGeometry(0.13, ballSkinOf(w.ball));
    const goalOn = cat === 'goalfx' || (kind === 'decor' && slot === 'net') || (lineup && (cat === 'bundle' || cat === 'tryon') && (w.goalfx !== 'club' || !!w.decor.net));
    this.goal.visible = goalOn;
    this.goal.position.set(lineup ? -0.75 : 0, 0, 0);
    this.goal.scale.setScalar(lineup ? 1.25 : 1);
    // The ground's dressing.
    const decor = kind === 'decor' ? w.decor : lineup && cat !== 'kit' ? w.decor : {};
    this.buildTop(bigBlock ? BIG : SMALL, decor.pitch ?? '');
    this.buildProps(decor, kind === 'decor' ? slot ?? '' : 'lineup', bigBlock);
    const plain = this.goal.getObjectByName('plainNet');
    if (plain) plain.visible = !this.props?.net;
    this.lightFor(show);
    this.frameLens(show, kind, slot);
  }

  /** The lens for a show: how far back, where it looks, and how much higher than a standing player's lens. */
  private frameLens(show: StageShow, kind: string, slot: string | undefined): void {
    const L = this.lens;
    L.back = 1.6; L.look = 1; L.lx = 0; L.lz = 0; L.up = 0;
    const { cat, id } = show;
    if (cat === 'trail') {
      L.back = 1.9; L.look = 0.95;
      L.lx = -Math.cos(-PROFILE) * 0.8;
      L.lz = -Math.sin(-PROFILE) * 0.8;
    } else if (cat === 'ball') {
      L.back = 0.95; L.look = 0.85;
    } else if (cat === 'goalfx') {
      // (Wide enough for a show's sky: fireworks, a rainbow, a meteor coming in.)
      L.back = 2.15; L.look = 1.6;
    } else if (cat === 'celebration' && (id === 'pile' || id === 'knee' || id === 'backflip')) {
      L.back = 1.85; L.look = id === 'backflip' ? 1.3 : 0.85;
    } else if (kind === 'solo') {
      L.back = 1.5; L.look = 1.2;
    } else if (kind === 'lineup') {
      // (Wide enough for all five: the pair at the back stands 1.8 m either side.)
      L.back = 2.3; L.look = 0.95; L.lx = -0.3;
      if (cat === 'bundle' || cat === 'tryon') { L.back = 2.45; L.look = 1.15; }
    } else if (kind === 'look') {
      if (slot === 'hair' || slot === 'head' || slot === 'shades') { L.back = 0.85; L.look = slot === 'hair' || slot === 'head' ? 1.65 : 1.5; }
      else if (slot === 'arm') { L.back = 0.85; L.look = 1.25; }
      else if (slot === 'boots') { L.back = 1.05; L.look = 0.3; L.up = -0.2; L.lx = -Math.cos(-PROFILE) * 0.6; L.lz = -Math.sin(-PROFILE) * 0.6; }
      else { L.back = 1.05; L.look = 1.3; }
    } else if (kind === 'decor') {
      switch (slot) {
        case 'pitch': L.back = 2.3; L.look = 0.2; L.up = 2.4; break;
        case 'net': L.back = 1.7; L.look = 0.9; break;
        case 'flags': L.back = 1.6; L.look = 1.1; L.lx = -0.6; L.lz = -0.6; break;
        case 'seats': case 'tifo': L.back = 2.3; L.look = 1.3; L.lx = -1.2; break;
        case 'kickoff': L.back = 2.5; L.look = 1.4; break;
        case 'lights': L.back = 2.5; L.look = 1.3; break;
        case 'mascot': L.back = 1.5; L.look = 1.35; break;
      }
    }
  }

  /** Daylight, or the floodlights (a dark sky behind, the kit glow on): the light show and neon nets need the dark. */
  private lightFor(show: StageShow): void {
    const w = this.cur;
    const dark = this.nightOn || (show.cat === 'decor' && (decorSlot(show.id) === 'lights' || show.id === 'netglow' || show.id.startsWith('netpass'))) || ((show.cat === 'bundle' || show.cat === 'tryon') && !!w.decor.lights && this.nightOn);
    this.hemi.intensity = dark ? 0.55 : 1.4;
    this.sun.intensity = dark ? 1.1 : 2.6;
    this.fill.intensity = dark ? 1.3 : 0.9;
    this.renderer?.setClearColor(dark ? 0x10142a : 0x000000, dark ? 1 : 0);
    setKitGlow(dark ? 1 : 0);
  }

  /** The club's crest (yours as you designed it; any other club's from its name and colours). */
  private get crest(): CrestDesign {
    return crestFor(this.club.name ?? '', this.club.short, this.club.kit);
  }

  /** The block's lawn pattern (a mowing style or the crest), on a block of half size `h`. */
  private buildTop(h: number, id: string): void {
    const key = `${h}|${id}`;
    if (key === this.topKey) return;
    this.topKey = key;
    if (this.top) {
      this.top.geometry.dispose();
      this.top.removeFromParent();
      this.top = null;
    }
    if (!id) return;
    let geo: THREE.BufferGeometry;
    if (id === 'mowcrest') {
      // The match's own decal (the club's crest in grass tones on the centre circle's disc), a fifth of the size,
      // its top away from the lens.
      geo = crestLawnGeometry(this.crest, this.club.short, this.club.name ?? '', 0.2, 0.003, true);
    } else geo = sheet(-h, h, -h, h, 0.08, 0.003, (x, z) => (mowColor(id, x, z, 0.075) === 0xa2d65c ? 0xa8dc62 : 0x86bf47));
    this.top = new THREE.Mesh(geo, voxelMaterial);
    this.top.receiveShadow = true;
    this.scene.add(this.top);
  }

  /** The dioramas' and the full look's pieces (rebuilt only when they change). */
  private buildProps(decor: { [slot: string]: string }, focus: string, big: boolean): void {
    const key = `${focus}|${big}|${JSON.stringify(decor)}`;
    if (this.props?.key === key) return;
    this.freeProps();
    const P: Props = { key, group: new THREE.Group(), free: [], flags: [], beams: [], leds: [], mascot: null, danceN: -1, tifo: null, surfer: null, net: null };
    this.props = P;
    this.scene.add(P.group);
    const { shirt } = this.club.kit;
    const shirt2 = this.club.kit.shirt2 === shirt ? (shirt === WHITE ? 0x26262e : WHITE) : this.club.kit.shirt2;
    const edge = big ? BIG : SMALL;
    // Nets: the goal's net panels in the style (the match's own colours and strand tile).
    if (decor.net) {
      const alpha = netAlpha(decor.net === 'nethex', decor.net.startsWith('netpass'));
      alpha.repeat.set(5, 5);
      P.free.push(alpha);
      const geo = new THREE.BufferGeometry();
      const pos: number[] = [], uv: number[] = [], col: number[] = [];
      const c = new THREE.Color();
      const quad = (a: number[], b: number[], cc: number[], d: number[]) => {
        for (const p of [a, b, cc, a, cc, d]) {
          pos.push(p[0], p[1], p[2]);
          uv.push((p[2] + 1.25) / 2.5, (p[1] + (p[0] + 1.1) * -1) / 1.6);
          c.setHex(netColor(decor.net, shirt, shirt2, p[0], p[1] / 1.6 * 2.44, p[2] * (7.32 / 2.5)));
          col.push(c.r, c.g, c.b);
        }
      };
      const bx = -1.88, fx = -1.12, H = 1.55, W = 1.25;
      quad([bx, 0, -W], [bx, H, -W], [bx, H, W], [bx, 0, W]);
      quad([fx, H, -W], [bx, H, -W], [bx, H, W], [fx, H, W]);
      quad([fx, 0, -W], [bx, 0, -W], [bx, H, -W], [fx, H, -W]);
      quad([fx, 0, W], [bx, 0, W], [bx, H, W], [fx, H, W]);
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      const mat = new THREE.MeshBasicMaterial({
        vertexColors: true, alphaMap: alpha, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: decor.net === 'netglow' || signatureMonth(decor.net) >= 0 ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      P.free.push(geo, mat);
      P.net = new THREE.Mesh(geo, mat);
      this.goal.add(P.net);
    }
    // A corner flag at the block's far corner, its arc painted on the grass.
    if (decor.flags) {
      const fg = cornerFlagGeometry(decor.flags, shirt, shirt2);
      const pg = new BoxBuilder().box(0, 0.75, 0, 0.06, 1.5, 0.06, decor.flags === 'flagcheck' ? WHITE : shirt2).build();
      const arc = new BoxBuilder();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * (Math.PI / 2);
        arc.box(-edge + 0.25 + Math.cos(a) * 0.55, 0.006, -edge + 0.25 + Math.sin(a) * 0.55, 0.1, 0.012, 0.04, WHITE, { rotY: -a });
      }
      const ag = arc.build();
      P.free.push(fg, pg, ag);
      P.group.add(new THREE.Mesh(ag, voxelMaterial));
      const pole = new THREE.Mesh(pg, voxelMaterial);
      pole.position.set(-edge + 0.25, 0, -edge + 0.25);
      pole.castShadow = true;
      const flag = new THREE.Mesh(fg, charMaterialFor(fg));
      flag.position.y = 1.0;
      flag.scale.setScalar(0.75);
      flag.castShadow = true;
      pole.add(flag);
      P.flags.push(flag);
      P.group.add(pole);
    }
    // A stand behind the block: your name in the seats, the tifo or the flag wave.
    if (decor.seats || decor.tifo) {
      const rows = 7;
      const stepD = 0.3, stepH = 0.2, seat = 0.22;
      const b = new BoxBuilder();
      const x0 = -edge - 0.1;
      for (let i = 0; i < rows; i++) b.box(x0 - i * stepD - stepD / 2, (i + 1) * stepH / 2, 0, stepD, (i + 1) * stepH, edge * 2, i % 2 ? 0xbfc4cc : 0xcfd3d8);
      const bits = decor.seats ? nameBitmap(this.club.short) : null;
      const cols = bits ? bits[0].length : 0;
      const pw = bits ? Math.min(seat * 1.6, (edge * 2 - 0.3) / cols) : seat;
      for (let i = 1; i < rows; i++) {
        for (let z = -edge + seat / 2; z < edge; z += seat) {
          let c = i % 2 ? 0x2f6fe0 : 0x3a7bea;
          if (bits) {
            const r = rows - 1 - i;
            const cc = Math.floor((z + (cols * pw) / 2) / pw);
            if (r >= 0 && r < 5 && cc >= 0 && cc < cols) c = bits[r][cc] ? shirt2 : shirt;
            else c = shirt;
          }
          b.box(x0 - i * stepD - stepD * 0.75, (i + 1) * stepH + 0.07, -z, 0.06, 0.14, seat * 0.86, c);
        }
      }
      const sg = b.build();
      P.free.push(sg);
      const stand = new THREE.Mesh(sg, voxelMaterial);
      stand.receiveShadow = true;
      P.group.add(stand);
      if (decor.tifo === 'tifobig') {
        const tex = tifoTexture(shirt, shirt2, this.club.short, this.crest, this.club.name ?? '');
        const mat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
        const geo = new THREE.PlaneGeometry(edge * 1.9, 1.15, 12, 3);
        P.free.push(tex, mat, geo);
        const t = new THREE.Mesh(geo, mat);
        t.position.set(x0 - 1.1, 0.95, 0);
        t.rotation.set(-0.6, -Math.PI / 2, 0, 'YXZ');
        P.tifo = t;
        P.group.add(t);
      } else if (decor.tifo === 'tifoflags') {
        const fl = new BoxBuilder().box(0.16, 0.42, 0, 0.32, 0.22, 0.02, WHITE).box(0, 0.25, 0, 0.025, 0.5, 0.025, 0x8a5a36).build();
        P.free.push(fl);
        for (let i = 1; i < rows; i += 2) {
          for (let z = -edge + 0.4; z < edge; z += 0.55) {
            const m = new THREE.Mesh(fl, new THREE.MeshLambertMaterial({ color: (i + Math.round(z * 3)) % 3 ? shirt : shirt2 }));
            P.free.push(m.material as THREE.Material);
            m.position.set(x0 - i * stepD - stepD * 0.6, (i + 1) * stepH + 0.05, z);
            m.rotation.y = -Math.PI / 2;
            P.flags.push(m);
            P.group.add(m);
          }
        }
        // ...and the giant flag passed along over their heads (the match's own cloth, lying on the stand's rake).
        const ft = flagTexture(shirt, shirt2, this.club.short, this.crest, this.club.name ?? '');
        const fm = new THREE.MeshLambertMaterial({ map: ft, side: THREE.DoubleSide });
        const fg = new THREE.PlaneGeometry(1.9, 1.2, 8, 4);
        P.free.push(ft, fm, fg);
        const flag = new THREE.Mesh(fg, fm);
        flag.rotation.order = 'YXZ';
        flag.rotation.set(Math.atan2(stepH, stepD) - Math.PI / 2, Math.PI / 2, 0);
        flag.position.set(x0 - 3.2 * stepD, 3.2 * stepH + 0.75, 0);
        P.surfer = { mesh: flag, reach: edge - 1.1 };
        P.group.add(flag);
      }
    }
    // The floodlights: a lamp tower at each back corner with a searchlight into the sky, and the LED strip on a low
    // board along the block's two back edges (the match's own design: no light is thrown on the grass).
    if (decor.lights) {
      const tb = new BoxBuilder();
      const spots = [[-edge - 0.4, -edge - 0.4], [-edge - 0.4, edge + 0.4]] as const;
      for (const [x, z] of spots) {
        tb.box(x, 1.6, z, 0.14, 3.2, 0.14, 0x3a3f48);
        tb.box(x, 3.25, z, 0.5, 0.36, 0.5, 0x26262e);
      }
      tb.box(-edge + 0.06, 0.2, 0, 0.1, 0.4, edge * 2, 0x26262e);
      tb.box(0, 0.2, -edge + 0.06, edge * 2, 0.4, 0.1, 0x26262e);
      const tg = tb.build();
      P.free.push(tg);
      P.group.add(new THREE.Mesh(tg, voxelMaterial));
      const led = [0, 1, 2].map(() => new BoxBuilder());
      let k = 0;
      for (let v = -edge; v < edge - 1e-3; v += 0.4, k++) {
        led[k % 3].box(-edge + 0.06, 0.45, v + 0.2, 0.12, 0.1, 0.34, WHITE);
        led[(k + 1) % 3].box(v + 0.2, 0.45, -edge + 0.06, 0.34, 0.1, 0.12, WHITE);
      }
      for (const [x, z] of spots) led[k++ % 3].box(x, 3.25, z, 0.56, 0.16, 0.56, WHITE);
      for (const lb of led) {
        const lg = lb.build();
        const lm = new THREE.MeshBasicMaterial({ vertexColors: true });
        P.free.push(lg, lm);
        P.leds.push(lm);
        P.group.add(new THREE.Mesh(lg, lm));
      }
      const cone = new THREE.ConeGeometry(0.09, 1, 12, 1, true);
      cone.rotateX(-Math.PI / 2);
      cone.translate(0, 0, 0.5);
      const cp = cone.getAttribute('position');
      const ca = new Float32Array(cp.count * 4);
      for (let i = 0; i < cp.count; i++) {
        ca[i * 4] = ca[i * 4 + 1] = ca[i * 4 + 2] = 1;
        ca[i * 4 + 3] = Math.max(0, 1 - cp.getZ(i)) ** 1.6;
      }
      cone.setAttribute('color', new THREE.Float32BufferAttribute(ca, 4));
      P.free.push(cone);
      spots.forEach(([x, z], n) => {
        const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
        P.free.push(mat);
        const mesh = new THREE.Mesh(cone, mat);
        mesh.frustumCulled = false;
        P.beams.push({ mesh, mat, x, y: 3.3, z, ph: n * 2 });
        P.group.add(mesh);
      });
    }
    // The mascot, on its own block or beside the line-up.
    if (decor.mascot) {
      const m = new Mascot(mascotKind(decor.mascot), shirt, shirt2, focus === 'mascot' ? 0 : 0.6, focus === 'mascot' ? 0 : -edge + 0.7, FACE);
      // (A mascot is a head and shoulders over the players: brought down a little to fit the block.)
      const sc = focus === 'mascot' ? 0.74 : 0.6;
      m.group.scale.setScalar(sc);
      // Its drum beats, sparks and fire, in the stage's own effects (the match's shows, at the mascot's scale).
      m.onFx = (what, lx, ly, lz) => {
        const yaw = m.group.rotation.y;
        const fx = Math.cos(yaw), fz = -Math.sin(yaw);
        const def = what === 'fire' ? DRAGON_BREATH : what === 'drum' ? BEAR_DRUM : ROBOT_SPARK;
        const g = m.group.position;
        this.rig.kit.play(def.run, def.dur, g.x + (fx * lx - fz * lz) * sc, ly * sc, g.z + (fz * lx + fx * lz) * sc, fx, fz, def.k * sc, [shirt, shirt2, 0xffd23a, WHITE]);
      };
      P.mascot = m;
      P.group.add(m.group);
    }
  }

  private freeProps(): void {
    const P = this.props;
    if (!P) return;
    P.net?.removeFromParent();
    P.mascot?.dispose();
    P.group.removeFromParent();
    for (const f of P.free) f.dispose();
    this.props = null;
  }

  // ------------------------------------------------------------------ the frame

  /** Pose everything `t` s into the current show; `dt` drives the pose blends and the particles (0: a still). */
  private frame(t: number, dt: number): void {
    // (The kit materials' clock: flames flicker and gold glints on the props too, whoever wears what.)
    tickKitFx();
    const { cat, id } = this.show;
    const kind = this.sceneOf(this.show);
    const w = this.cur;
    if (cat === 'celebration') {
      const L = LOOP[id] ?? 3;
      const u = t % L;
      const b = heroBeat(id, u);
      this.placeDancer(this.hero, b, t, dt);
      if (id === 'pile') this.mates.slice(0, 2).forEach((m, k) => this.placeDancer(m, mateBeat(k, u), t, dt));
    } else if (cat === 'ball') {
      const k = Math.abs(Math.sin(t * 2.6));
      this.ball.position.set(0, 0.42 + k * 0.7, 0);
      this.ball.rotation.set(t * 1.7, t * 0.9, t * 0.4);
      this.ball.scale.set(1 + (1 - k) ** 6 * 0.12, 1 - (1 - k) ** 6 * 0.16, 1 + (1 - k) ** 6 * 0.12);
    } else if (cat === 'goalfx') {
      this.shoot(t, dt, id, 0);
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
    } else if (kind === 'solo') {
      // The kit on a turntable: he stands proud, a slow turn all the way round (front, side, the number on the back).
      this.hero.group.position.set(0, 0, 0);
      this.hero.group.rotation.y = FACE + 0.3 + t * 0.7;
      this.hero.pose({ ...BASE, state: PSTATE.move, speed: 0, runPhase: 0, look: Math.sin(t * 0.8) * 0.4, dt }, t);
    } else if (kind === 'look') {
      this.poseLook(t, dt, LOOK_SLOT_OF[id as LookId] ?? 'head');
    } else if (kind === 'lineup') {
      this.poseLineup(t, dt);
      if ((cat === 'bundle' || cat === 'tryon') && w.goalfx !== 'club') this.shoot(t, dt, w.goalfx, 1);
      if ((cat === 'bundle' || cat === 'tryon') && w.decor.kickoff) this.kickoffLoop(t, dt, w.decor.kickoff);
    } else if (kind === 'decor') {
      const slot = decorSlot(id);
      if (slot === 'pitch' || slot === 'kickoff' || slot === 'lights') this.poseLineup(t, dt);
      if (slot === 'kickoff') this.kickoffLoop(t, dt, id);
      if (slot === 'net') this.shoot(t, dt, '', 0);
      if (slot === 'flags') this.hero.pose({ ...BASE, state: PSTATE.move, speed: 0, look: -0.6, dt }, t);
      if (slot === 'flags') {
        this.hero.group.rotation.y = FACE + 0.6;
        this.ball.position.set(-SMALL + 0.62, 0.13, -SMALL + 0.62);
      }
    }
    this.updateProps(t, dt);
    if (dt > 0) this.rig.fx.update(dt);
    this.rig.kit.update(dt, this.camera);
  }

  /** The ball flies into the goal and the goal explosion `fxId` goes off (none: just the net taking it). */
  private shoot(t: number, dt: number, fxId: string, lineup: number): void {
    const def = fxId ? goalShow(fxId) : null;
    const R = this.rig;
    const cycle = def ? Math.max(2.6, def.dur + 0.9) : 2.6;
    const u = t % cycle;
    const n = Math.floor(t / cycle);
    const k = clamp01(u / 0.45);
    const gx = this.goal.position.x;
    const gs = this.goal.scale.x;
    if (!lineup) {
      this.ball.visible = u < 0.5;
      this.ball.position.set(1.4 - 2.7 * k, 0.3 + Math.sin(Math.PI * k) * 0.6 + k * 0.5, 0.5 - k * 0.6);
      this.ball.rotation.set(t * 8, 0, t * 5);
    }
    // The net takes the ball: a bulge when it hits.
    const net = this.props?.net;
    if (net) {
      const hitK = u >= 0.45 && u < 0.95 ? Math.sin(((u - 0.45) / 0.5) * Math.PI) * Math.exp(-(u - 0.45) * 4) : 0;
      net.scale.set(1 + hitK * 0.25, 1, 1);
      net.position.x = -1.5 * hitK * 0.25;
    }
    if (dt > 0 && n !== R.burstAt && u >= (lineup ? 0.2 : 0.45) && fxId) {
      R.burstAt = n;
      const cols = goalFxColors(fxId, [this.club.kit.shirt, this.club.kit.shirt2, 0xffd23a, 0xfbfbf4]);
      const ox = gx + -1.1 * gs;
      if (def) R.kit.play(def.run, def.dur, ox, 0, -0.05, 1, 0, def.stageK ?? STAGE_K * gs, cols, 0);
      else {
        // Club Colours: the match's plain burst and confetti in your kit.
        R.fx.burst(ox - 0.1, 0.9, -0.1, cols, 70, 6, 1.1);
        R.fx.burst(ox + 0.1, 0.3, 0, cols, 30, 4, 0.9);
        for (let i = 0; i < 70; i++) {
          R.fx.spawn((Math.random() - 0.5) * 3, 3.2 + Math.random() * 1.6, (Math.random() - 0.5) * 2.6,
            (Math.random() - 0.5) * 0.6, -Math.random(), (Math.random() - 0.5) * 0.6, cols[i % cols.length], 0.07 + Math.random() * 0.05, 2 + Math.random(), 1.2, 1.6);
        }
      }
    }
  }

  /** The walkout `id` over the block, again every few seconds. */
  private kickoffLoop(t: number, dt: number, id: string): void {
    // (The stage's own layout of the show: along the back edge of the block, behind the line-up.)
    const show = STAGE_SHOWS[id];
    const R = this.rig;
    if (!show) return;
    const cycle = show.dur + 1.6;
    const n = Math.floor(t / cycle);
    if (dt > 0 && n !== R.ceremonyAt && t % cycle >= 0.3) {
      R.ceremonyAt = n;
      R.kit.play(show.run, show.dur, 0, 0, 0, 1, 0, show.k, [this.club.kit.shirt, this.club.kit.shirt2, 0xffd23a, WHITE]);
    }
  }

  /** The team lined up facing the lens, the captain in front with the ball at his feet, the odd fist pump. */
  private poseLineup(t: number, dt: number): void {
    const all = [this.hero, ...this.mates];
    for (let i = 0; i < all.length; i++) {
      const f = all[i];
      if (!f.group.visible) continue;
      f.group.position.set(LINEUP[i][0], 0, LINEUP[i][1]);
      const cheer = i === 0 && t % 4 > 2.6;
      f.group.rotation.y = FACE + Math.sin(t * 0.6 + i) * 0.12;
      f.pose(cheer ? { ...BASE, celebrate: CELEB.armsUp, stateT: t, dt } : { ...BASE, state: PSTATE.move, speed: 0, look: Math.sin(t * 0.7 + i * 1.7) * 0.5, dt }, t + i * 0.37);
    }
    if (this.ball.visible && this.show.cat !== 'goalfx') {
      const hop = Math.abs(Math.sin(t * 3.2)) * 0.18;
      this.ball.position.set(LINEUP[0][0] + 0.42, 0.13 + hop, LINEUP[0][1] + 0.38);
      this.ball.rotation.set(t * 2, t * 1.4, 0);
      this.ball.scale.setScalar(1);
    }
  }

  /** A player look on show: framed on what it changes. */
  private poseLook(t: number, dt: number, slot: string): void {
    if (slot === 'gloves') {
      // The keeper, arms up to claim it, turning slowly.
      const k = this.keeper;
      k.group.position.set(0, 0, 0);
      k.group.rotation.y = FACE + Math.sin(t * 0.6) * 0.7;
      k.pose({ ...BASE, celebrate: CELEB.armsUp, stateT: t, keeper: true, dt }, t);
      return;
    }
    const h = this.hero;
    h.group.position.set(0, 0, 0);
    if (slot === 'boots') {
      // At a jog across the lens, the ground sliding back under him (the trail's treadmill): light up boots leave their
      // glowing prints behind him as they do in a match.
      const f = -PROFILE;
      h.group.rotation.y = -f;
      h.pose({ ...BASE, state: PSTATE.move, speed: 5.5, runPhase: t * 1.4, dt }, t);
      const R = this.rig;
      if (dt > 0 && this.cur.looks.boots === 'bootlight') {
        const ux = Math.cos(f), uz = Math.sin(f);
        const g = R.kit.group.position;
        g.x -= ux * TREADMILL * 0.7 * dt;
        g.z -= uz * TREADMILL * 0.7 * dt;
        R.ts.dist += TREADMILL * 0.7 * dt;
        if (R.ts.dist >= BOOT_STEP_M * 0.6) {
          R.ts.dist = 0;
          R.ts.side = -R.ts.side;
          bootStep(R.kit, -g.x, -g.z, ux, uz, R.ts.side, 0.75);
        }
      }
      return;
    }
    if (slot === 'shades') {
      // Shades go on to celebrate: arms up and a little hop.
      h.group.rotation.y = FACE + Math.sin(t * 0.7) * 0.5;
      h.pose({ ...BASE, celebrate: CELEB.armsUp, stateT: t, dt }, t);
      return;
    }
    // Hair, headgear, the armband: a slow turn so it reads from every side.
    h.group.rotation.y = FACE + Math.sin(t * 0.6) * 1.2 + (slot === 'arm' ? 0.9 : 0);
    h.pose({ ...BASE, state: PSTATE.move, speed: 0, look: Math.sin(t * 0.9) * 0.5, dt }, t);
  }

  /** The props' life: flags flapping, the tifo waving, beams sweeping, the mascot dancing. */
  private updateProps(t: number, dt: number): void {
    const P = this.props;
    if (!P) return;
    for (let i = 0; i < P.flags.length; i++) P.flags[i].rotation.y = (P.flags[i].userData.y0 ?? (P.flags[i].userData.y0 = P.flags[i].rotation.y)) + Math.sin(t * 3 + i * 1.3) * 0.4;
    if (P.tifo) {
      const pos = P.tifo.geometry.getAttribute('position') as THREE.BufferAttribute;
      const base = (P.tifo.userData.base ??= Float32Array.from(pos.array as Float32Array)) as Float32Array;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < arr.length; i += 3) arr[i + 2] = base[i + 2] + Math.sin(t * 3 + base[i] * 2 + base[i + 1] * 3) * 0.04;
      pos.needsUpdate = true;
    }
    if (P.surfer) {
      // Along the stand and back, rippling.
      const sf = P.surfer.mesh;
      sf.position.z = Math.sin(t * 0.7) * P.surfer.reach;
      const pos = sf.geometry.getAttribute('position') as THREE.BufferAttribute;
      const base = (sf.userData.base ??= Float32Array.from(pos.array as Float32Array)) as Float32Array;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < arr.length; i += 3) arr[i + 2] = base[i + 2] + Math.sin(t * 4 + base[i] * 5 + base[i + 1] * 4) * 0.05;
      pos.needsUpdate = true;
    }
    if (P.leds.length) {
      const show = this.cur.decor.lights === 'lightshow';
      const two = this.club.kit.shirt2 === this.club.kit.shirt ? WHITE : this.club.kit.shirt2;
      const c = this.propColor;
      const tint = (i: number) => (show ? c.setHSL((t * 0.12 + i * 0.17) % 1, 0.95, 0.58) : c.setHex(i % 2 ? two : this.club.kit.shirt));
      // The LED strip chases; the searchlights sway about a line up and out from the block.
      for (let i = 0; i < P.leds.length; i++) {
        const pulse = 0.55 + 0.45 * Math.sin(t * (show ? 3.2 : 1.6) - (i * Math.PI * 2) / 3);
        P.leds[i].color.copy(tint(i)).multiplyScalar(0.35 + 0.65 * pulse);
      }
      for (let i = 0; i < P.beams.length; i++) {
        const b = P.beams[i];
        const out = Math.atan2(b.z, b.x);
        const ph = b.ph + t * (show ? 1.1 : 0.5);
        const az = out + Math.sin(ph) * 0.7;
        const el = 1 + Math.sin(ph * 0.7 + 1) * 0.28;
        b.mesh.position.set(b.x, b.y, b.z);
        b.mesh.lookAt(b.x + Math.cos(az) * Math.cos(el) * 9, b.y + Math.sin(el) * 9, b.z + Math.sin(az) * Math.cos(el) * 9);
        b.mesh.scale.set(8, 8, 7);
        b.mat.color.copy(tint(i));
        b.mat.opacity = 0.5;
      }
    }
    if (P.mascot) {
      // Its act at rest for a moment, then the goal celebration, on a loop.
      const n = Math.floor((t - 2) / 9);
      if (dt > 0 && t >= 2 && n !== P.danceN) {
        P.danceN = n;
        P.mascot.dance(6.5);
      }
      P.mascot.update(dt, t);
    }
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
    const L = this.lens;
    let back = L.back / Math.min(1, cam.aspect);
    if (tight) back *= this.show.cat === 'goalfx' || this.show.cat === 'trail' ? 0.92 : 0.84;
    cam.position.set(CAM.x * back + L.lx, CAM.y + (back - 1) * 0.9 + L.up, CAM.z * back + L.lz);
    cam.lookAt(L.lx, L.look, L.lz);
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
    const keepView = this.view;
    // (Tiles are always daylight shots, whatever the live stage is showing.)
    const keepNight = this.nightOn;
    this.nightOn = false;
    this.show = show;
    // (A kit's tile is the captain alone; a set's, the line-up.)
    if (show.cat === 'kit') this.view = 'solo';
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
    this.view = keepView;
    this.nightOn = keepNight;
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
    this.freeProps();
    this.top?.geometry.dispose();
    for (const f of [this.hero, ...this.mates, this.keeper]) f.dispose();
    setKitGlow(0);
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer = null;
  }
}

/** The stadium style slot of a decor id (core/save.ts DECOR_SLOT_OF), without importing the whole table here. */
function decorSlot(id: string): string | undefined {
  if (id.startsWith('mow')) return 'pitch';
  if (id.startsWith('net')) return 'net';
  if (id.startsWith('flag')) return 'flags';
  if (id === 'seatname') return 'seats';
  if (id.startsWith('tifo')) return 'tifo';
  if (id.startsWith('kick')) return 'kickoff';
  if (id.startsWith('light')) return 'lights';
  if (id.startsWith('mascot')) return 'mascot';
  return undefined;
}


// ------------------------------------------------------------------ dev: look at every cosmetic without buying it

if (import.meta.env.DEV && typeof window !== 'undefined') {
  /**
   * window.__blfx (dev builds only):
   *  - sheet(cat, ids?, times?): a contact sheet of stage stills over the page, `times` s into each effect
   *    (goal explosions: after the ball hits the net). Click it to close. E.g. __blfx.sheet('kit'), __blfx.sheet('look').
   *  - goal(id): in a match (window.__bl.session), set that goal explosion off at the nearest goal now.
   *  - trail(id): in a match, wear that trail (sprint with the player you control, or hit a hard shot).
   *  - wear(cat, id): own and equip any kit, player look or stadium style in this (throwaway) save, for the next match.
   *  - shop(tab, id?): open the shop on a tab with an item picked (ui/shop.ts adds it).
   *  - ids: every id by category.
   */
  const sheet = async (cat: StageCat, ids?: readonly string[], times: readonly number[] = [0.3, 0.9, 1.6], px = 200): Promise<number> => {
    const [{ PRESET_CLUBS, makeTeam }, save] = await Promise.all([import('../meta/data'), import('../core/save')]);
    const all: { readonly [k in StageCat]: readonly string[] } = {
      celebration: save.CELEBRATION_IDS, ball: save.BALL_SKIN_IDS, goalfx: save.GOAL_FX_IDS, trail: save.TRAIL_IDS, kit: save.KIT_IDS,
      look: save.LOOK_IDS, decor: save.DECOR_IDS, bundle: ['retro', 'inferno', 'iceking', 'neon', 'galaxy', 'champion'], tryon: ['tryon'],
    };
    const team = makeTeam(PRESET_CLUBS[0]);
    const st = new ShopStage({ kit: team.kit, short: team.short, star: team.players[9], mates: team.players.slice(5, 9), keeper: team.players[0] });
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
  type Dev = { session?: Session; save?: unknown; app?: unknown };
  const dev = (): Dev | undefined => (window as unknown as { __bl?: Dev }).__bl;
  const session = (): Session => dev()?.session;
  (window as unknown as { __blfx: unknown }).__blfx = {
    sheet,
    goal: (id: string) => session()?.previewGoalFx?.(id) ?? false,
    trail: (id: string) => session()?.previewTrail?.(id),
    /** Own and equip `id` in category `cat` (kit, look, decor or any other) in this save; the next match wears it. */
    wear: (cat: string, id: string): boolean => {
      const s = dev()?.save as Parameters<typeof grantItem>[0] & Parameters<typeof equipItem>[0];
      if (!s) return false;
      grantItem(s, cat as never, id);
      const ok = equipItem(s, cat as never, id);
      (dev()?.app as { persist?: () => void } | undefined)?.persist?.();
      return ok;
    },
    // (shop(tab, id): ui/shop.ts adds it, so this file never imports the shop screen.)
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
      return import('../core/save').then((s) => ({
        goalfx: s.GOAL_FX_IDS, trail: s.TRAIL_IDS, ball: s.BALL_SKIN_IDS, kit: s.KIT_IDS, look: s.LOOK_IDS, decor: s.DECOR_IDS,
      }));
    },
  };
}
