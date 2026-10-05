import * as THREE from 'three';
import {
  BOX_CHAIR, BOX_DESK_Y, BOX_DESK_Z, BOX_HEADSET, BOX_PAPERS, BOX_SEAT_X, DUG_BENCH_Y, DUG_BENCH_Z, FAN_BACK_Y, FAN_BACK_Z, FAN_BUCKET, FAN_CORN,
  BALL_M, FAN_HIP_Y, FAN_ROW_Z, PEN_BALL_X, PEN_BALL_Z, PEN_GOAL_Z, PROP_F, PROP_MAX, PUPPET_MAX, newPose, sidePose, type PuppetPose, type SideCue, type SideKind,
  type SidePicture,
} from '../game/sideShow';
import type { Kit, PlayerDef } from '../sim/types';
import { SideFrame } from '../ui/sideFrame';
import { Footballer, VU, ballSkinOf, buildBallGeometry, charMaterial, type FootballerRig } from './characters';
import { BoxBuilder } from './voxel';
import type { TimeOfDay, World } from './world';

/**
 * The little stage the side shows are played on (game/sideShow.ts says what plays and where everyone is): its own
 * scene, lit on its own, drawn into a corner of the frame after the match (World.overlay) or over the whole of it for
 * a big goal's commentary cut. Four sets, built once and shown one at a time: the commentary box, a block of seats,
 * the dugout, and a patch of the pitch. The regulars (two commentators, five fans, a manager, a referee) are made
 * once; the real players a scene needs are made for it from the cached voxel parts and let go after, like a
 * substitution's (render/subScene.ts). Nothing is allocated per frame, and nothing here is ever seen by the sim.
 */

const INK = 0x1c1c22;
const SUIT = (shirt: number, socks = 0x20232c): Kit => ({ shirt, shirt2: shirt, pattern: 'plain', shorts: 0x20232c, socks, gk: shirt });
const STATS = { pace: 30, shooting: 1, passing: 1, dribbling: 1, defending: 1, keeping: 1, stamina: 90 };
const regular = (id: string, skin: number, hair: number, hairColor: number, beard: number, boots = INK): PlayerDef => ({
  id: `side-${id}`, name: id, number: 0, role: 'MF', stats: STATS, look: { skin, hair, hairColor, beard, boots },
});
const COMMENTATORS: [PlayerDef, Kit][] = [
  [regular('lead', 1, 2, 5, 1), SUIT(0x2b3a67)],
  [regular('summariser', 4, 1, 6, 0, 0xf4f1e4), SUIT(0x7a2b3c, 0xffd23a)],
];
const MANAGER: [PlayerDef, Kit] = [regular('manager', 0, 2, 5, 0), SUIT(0x343844)];
/** Tie colours: the two commentators', the manager's. */
const TIES = [0xec4a3e, 0xffd23a, 0x3a72ff];
const REFEREE: [PlayerDef, Kit] = [regular('referee', 2, 1, 0, 0), { shirt: 0x17171d, shirt2: 0xd8f13a, pattern: 'plain', shorts: 0x17171d, socks: 0x17171d, gk: 0x17171d }];
const FANS: PlayerDef[] = [regular('fan0', 1, 3, 2, 0, 0xf4f1e4), regular('fan1', 3, 1, 0, 1, 0xf4f1e4), regular('fan2', 0, 4, 4, 0, 0xf4f1e4), regular('fan3', 5, 2, 6, 0), regular('fan4', 2, 0, 1, 0)];
const DENIM = 0x34486b;

/** The lens for each kind: where it is, what it looks at, and its (vertical) field of view. */
const SHOTS: Record<SideKind, readonly [number, number, number, number, number, number, number]> = {
  box: [0, 1.85, 5.3, 0, 1.42, 0, 27],
  fans: [0, 1.95, 6.8, 0, 1.5, 0, 27],
  dugout: [0.05, 1.6, 6.3, 0.05, 1.1, 0, 27],
  redcard: [0.1, 1.6, 6.4, 0.1, 1.08, 0, 27],
  coin: [0, 1.6, 6.0, 0, 1.32, 0, 27],
  penalty: [1.9, 2.0, 6.6, 0, 0.95, -2.2, 31],
  matchball: [0, 1.7, 5.8, 0, 1.4, 0, 27],
};

/** The commentary box with the whole screen: a step back, with room over their heads for the leap. */
const FULL_SHOT = [0, 1.9, 6.3, 0, 1.52, 0, 27] as const;

/** The daylight on the outdoor sets: sky, ground bounce and key colours with their strengths, and the sky behind. */
const LIGHTS: Record<TimeOfDay | 'studio', readonly [number, number, number, number, number, number]> = {
  day: [0xeaf6ff, 0x9bc46a, 1.55, 0xfff4e0, 2.35, 0x8ecbf2],
  sunset: [0xffe2c8, 0x8a9a5a, 1.25, 0xffb070, 2.2, 0xf2a468],
  night: [0xbccaff, 0x4a6a48, 1.0, 0xf2f6ff, 1.9, 0x10182e],
  studio: [0xdfe8ff, 0x353c52, 1.45, 0xfff1dc, 2.0, 0x0f131d],
};

const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;

/** A row of spectators far enough back to be shapes: a body and a head each. */
function crowdRow(b: BoxBuilder, y: number, z: number, from: number, to: number, seed: number): void {
  const shirts = [0xec4a3e, 0x3a72ff, 0xffd23a, 0xf4f1e4, 0x46c36a, 0x8a5cf0, 0x26262e];
  const skins = [0xf0c49c, 0xdca577, 0xb97b4c, 0x8c5634, 0xf8dcc0];
  let i = seed;
  for (let x = from; x <= to; x += 0.78) {
    i = (i * 7 + 3) % 31;
    b.box(x, y + 0.3, z, 0.58, 0.6, 0.3, shirts[i % shirts.length]);
    b.box(x, y + 0.82, z, 0.48, 0.44, 0.36, skins[i % skins.length], { top: [0x2a1d16, 0x7a4a26, 0xe8c25a, 0x1c1c22][i % 4] });
  }
}

class Puppet {
  readonly rig: FootballerRig;

  constructor(readonly fb: Footballer) {
    this.rig = fb.rig;
    fb.group.visible = false;
  }

  apply(p: PuppetPose): void {
    const g = this.fb.group;
    g.visible = p.on;
    if (!p.on) return;
    const r = this.rig;
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = -Math.PI / 2 + p.yaw;
    r.body.rotation.set(p.roll, 0, p.lean);
    r.torso.rotation.set(0, p.twist, p.torso);
    r.head.rotation.set(p.headRoll, p.headYaw, p.head);
    r.armL.rotation.set(p.alx, p.aly, p.alz);
    r.armR.rotation.set(p.arx, p.ary, p.arz);
    r.legL.rotation.set(p.spread, 0, p.sit * 1.5 + p.legL);
    r.legR.rotation.set(-p.spread, 0, p.sit * 1.5 + p.legR);
  }
}

export interface SideStageOptions {
  timeOfDay: TimeOfDay;
  ballSkin?: string;
  /** The human side's kit: the fans wear its shirt. */
  fanKit: Kit;
}

export class SideStage implements SidePicture {
  private readonly scene = new THREE.Scene();
  private readonly cam = new THREE.PerspectiveCamera(27, 16 / 9, 0.3, 60);
  private readonly hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1.5);
  private readonly key = new THREE.DirectionalLight(0xffffff, 2);
  private readonly bg = new THREE.Color();
  /** Everything built here shares these (the footballers keep the game's own character material). */
  private readonly mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private readonly trimMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  private readonly lampMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
  private readonly screenMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private readonly geos: THREE.BufferGeometry[] = [];
  private screenTex: THREE.CanvasTexture | null = null;
  private screenCtx: CanvasRenderingContext2D | null = null;

  private readonly sets: Record<'studio' | 'stand' | 'dugout' | 'grass', THREE.Group>;
  private readonly spotLines: THREE.Object3D;
  private readonly centreLines: THREE.Object3D;
  private readonly backdrop: THREE.Mesh;
  private readonly props: Record<SideKind, THREE.Object3D[]>;
  private readonly headsets: THREE.Mesh[] = [];
  private readonly regulars: { box: Puppet[]; fans: Puppet[]; manager: Puppet; referee: Puppet };
  private readonly cast: Puppet[] = [];
  private active: (Puppet | null)[] = [];
  private readonly poses: PuppetPose[] = [];
  private readonly propV = new Float32Array(PROP_MAX * PROP_F);
  private readonly frameEl: SideFrame | null;
  private readonly size = new THREE.Vector2();
  private cue: SideCue | null = null;
  private box = { x: 0, y: 0, w: 0, h: 0, ok: false };
  private measureIn = 0;

  constructor(private readonly world: World, hudRoot: HTMLElement | null, private readonly opt: SideStageOptions) {
    for (let i = 0; i < PUPPET_MAX; i++) this.poses.push(newPose());
    this.key.position.set(-2.4, 5, 4.2);
    this.scene.add(this.hemi, this.key, this.key.target);
    this.scene.background = this.bg;

    this.backdrop = this.mesh(this.buildBackdrop());
    this.scene.add(this.backdrop);
    this.spotLines = this.mesh(this.buildSpot());
    this.centreLines = this.mesh(this.buildCentre());
    this.sets = { studio: this.buildStudio(), stand: this.buildStand(), dugout: this.buildDugout(), grass: this.buildGrass() };
    this.sets.grass.add(this.spotLines, this.centreLines);
    for (const g of Object.values(this.sets)) {
      g.visible = false;
      this.scene.add(g);
    }

    const person = (def: PlayerDef, kit: Kit): Puppet => {
      const p = new Puppet(new Footballer(def, kit, false));
      this.scene.add(p.fb.group);
      return p;
    };
    const fanKit: Kit = { ...opt.fanKit, shorts: DENIM, socks: DENIM };
    this.regulars = {
      box: COMMENTATORS.map(([d, k]) => person(d, k)),
      fans: FANS.map((d, i) => person(d, i === 3 ? { ...fanKit, shorts: 0x2c2f38, socks: 0x2c2f38 } : fanKit)),
      manager: person(MANAGER[0], MANAGER[1]),
      referee: person(REFEREE[0], REFEREE[1]),
    };
    const headset = this.geo(this.buildHeadset().build());
    for (const c of this.regulars.box) {
      const h = new THREE.Mesh(headset, this.mat);
      c.rig.head.add(h);
      this.headsets.push(h);
    }
    // A shirt front and a tie on the three in jackets (on the chest, in the torso's own space).
    [...this.regulars.box, this.regulars.manager].forEach((p, i) => p.rig.torso.add(new THREE.Mesh(this.geo(this.buildTie(TIES[i]).build()), this.mat)));
    this.props = this.buildProps();
    this.frameEl = hudRoot && typeof document !== 'undefined' ? new SideFrame(hudRoot) : null;
    this.makeScreen();
    world.overlay = this;
    // Its materials under its own lights, now, with everything shown once: nothing links a program mid-match.
    try {
      for (const g of Object.values(this.sets)) g.visible = true;
      for (const p of [...this.regulars.box, ...this.regulars.fans, this.regulars.manager, this.regulars.referee]) p.fb.group.visible = true;
      world.renderer.compile(this.scene, this.cam);
    } catch {
      // (No WebGL context in a test, or a lost one: the first draw compiles instead.)
    }
    for (const g of Object.values(this.sets)) g.visible = false;
    this.hideAll();
  }

  // ---------------------------------------------------------------- building

  private geo(g: THREE.BufferGeometry): THREE.BufferGeometry {
    this.geos.push(g);
    return g;
  }

  private mesh(b: BoxBuilder, mat: THREE.Material = this.mat): THREE.Mesh {
    return new THREE.Mesh(this.geo(b.build()), mat);
  }

  private group(...meshes: THREE.Object3D[]): THREE.Group {
    const g = new THREE.Group();
    g.add(...meshes);
    return g;
  }

  /** The stand behind the outdoor sets: a dark terrace with three rows of spectators. */
  private buildBackdrop(): BoxBuilder {
    const b = new BoxBuilder();
    b.box(0, 2.4, -0.4, 16, 5.2, 0.4, 0x39404f);
    b.box(0, 0.45, 0, 16, 0.9, 0.5, 0xe9e4d4, { top: 0xf4f1e4 });
    for (let r = 0; r < 3; r++) crowdRow(b, 1.05 + r * 1.1, -0.1 - r * 0.02, -7.4, 7.4, 5 + r * 4);
    return b;
  }

  private buildStudio(): THREE.Group {
    const b = new BoxBuilder();
    b.box(0, -0.05, 0, 11, 0.1, 6, 0x151a28);
    b.box(0, 1.8, -1.35, 11, 3.9, 0.1, 0x1d2742);
    for (const x of [-4.3, -3.25, -2.2, 2.2, 3.25, 4.3]) b.box(x, 1.8, -1.28, 0.74, 3.2, 0.05, 0x27345c);
    b.box(0, 3.15, -1.28, 9.6, 0.08, 0.05, 0x4fd2ff);
    b.box(0, 0.28, -1.28, 9.6, 0.08, 0.05, 0x4fd2ff);
    // The wall screen's bezel, the desk with its cream top, a microphone and a mug each, and the first chair.
    b.box(0, 1.78, -1.27, 1.72, 1.02, 0.08, 0x0b0d13);
    b.box(0, BOX_DESK_Y / 2, BOX_DESK_Z, 4.1, BOX_DESK_Y, 0.7, 0x2a2e3b, { top: 0xe8e2d0 });
    b.box(0, 0.06, BOX_DESK_Z + 0.36, 4.1, 0.12, 0.03, 0x14161d);
    for (const s of [-1, 1]) {
      b.box(s * BOX_SEAT_X, BOX_DESK_Y + 0.02, BOX_DESK_Z + 0.2, 0.2, 0.04, 0.16, 0x14161d);
      b.box(s * BOX_SEAT_X, BOX_DESK_Y + 0.1, BOX_DESK_Z + 0.2, 0.04, 0.16, 0.04, 0x8f939c);
      b.box(s * BOX_SEAT_X, BOX_DESK_Y + 0.21, BOX_DESK_Z + 0.17, 0.1, 0.1, 0.14, 0x14161d);
    }
    b.box(-1.72, BOX_DESK_Y + 0.08, BOX_DESK_Z + 0.02, 0.13, 0.16, 0.13, 0xf4f1e4);
    b.box(1.75, BOX_DESK_Y + 0.08, BOX_DESK_Z - 0.04, 0.13, 0.16, 0.13, 0xffd23a);
    b.box(-BOX_SEAT_X, 0.95, -0.34, 0.78, 1.0, 0.1, 0x3b4152);
    b.box(-BOX_SEAT_X, 0.5, -0.04, 0.7, 0.08, 0.6, 0x3b4152);
    b.box(-BOX_SEAT_X, 0.25, -0.04, 0.1, 0.5, 0.1, 0x22252e);
    const room = this.mesh(b);
    // In the club's colour: a stripe along the desk front and a pennant on the wall.
    const t = new BoxBuilder();
    t.box(0, 0.5, BOX_DESK_Z + 0.36, 4.1, 0.18, 0.03, 0xffffff);
    t.box(3.25, 2.1, -1.24, 0.5, 0.74, 0.04, 0xffffff);
    const trim = this.mesh(t, this.trimMat);
    const l = new BoxBuilder();
    l.box(-3.25, 2.55, -1.24, 0.6, 0.26, 0.06, 0xffffff);
    const lamp = this.mesh(l, this.lampMat);
    const screen = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(1.56, 0.88)), this.screenMat);
    screen.position.set(0, 1.78, -1.22);
    return this.group(room, trim, lamp, screen);
  }

  private buildStand(): THREE.Group {
    const b = new BoxBuilder();
    b.box(0, -0.05, 0.9, 9, 0.1, 2.6, 0x767b87);
    b.box(0, 0.25, -1.0, 9, 0.5, 1.4, 0x6b707c);
    b.box(0, 2.2, -1.9, 9, 4.6, 0.3, 0x4a4f5b);
    crowdRow(b, 1.45, -1.55, -4.2, 4.2, 9);
    crowdRow(b, 2.5, -1.6, -3.9, 4.2, 17);
    b.box(0, 0.5, 1.55, 9, 0.08, 0.08, 0xd9dde4);
    for (const x of [-2.9, 0, 2.9]) b.box(x, 0.25, 1.55, 0.08, 0.5, 0.08, 0xd9dde4);
    const steps = this.mesh(b);
    const s = new BoxBuilder();
    const seat = (x: number, hipY: number, z: number): void => {
      s.box(x, hipY - 0.07, z, 0.82, 0.1, 0.52, 0xffffff);
      s.box(x, hipY + 0.28, z - 0.3, 0.82, 0.78, 0.1, 0xffffff);
    };
    for (const x of [-2.85, -1.9, -0.95, 0, 0.95, 1.9, 2.85]) seat(x, FAN_HIP_Y, FAN_ROW_Z);
    for (const x of [-3.33, -2.38, -1.43, -0.48, 0.48, 1.43, 2.38, 3.33]) seat(x, FAN_BACK_Y, FAN_BACK_Z);
    return this.group(steps, this.mesh(s, this.trimMat));
  }

  private grassInto(b: BoxBuilder, depth: number, z: number): void {
    b.box(0, -0.05, z, 16, 0.1, depth, 0x88c247);
    for (let i = 0; i * 2.4 < depth; i += 2) b.box(0, 0.003, z - depth / 2 + i * 1.2 + 0.6, 16, 0.006, 1.2, 0xa2d65c);
  }

  private buildDugout(): THREE.Group {
    const b = new BoxBuilder();
    this.grassInto(b, 9, 0);
    b.box(0, 0.008, 1.55, 16, 0.016, 0.13, 0xf4f4ee);
    // The shelter: clear back and sides, the bench in it.
    const cx = 1.05;
    b.box(cx, 1.2, DUG_BENCH_Z - 0.5, 3.3, 2.4, 0.07, 0xbfd8ea);
    for (const s of [-1, 1]) b.box(cx + s * 1.65, 1.2, DUG_BENCH_Z - 0.05, 0.07, 2.4, 0.95, 0xa9c6da);
    b.box(cx, DUG_BENCH_Y - 0.07, DUG_BENCH_Z, 3.1, 0.1, 0.5, 0x2f3340);
    for (const s of [-1.4, 0, 1.4]) b.box(cx + s, (DUG_BENCH_Y - 0.12) / 2, DUG_BENCH_Z, 0.09, DUG_BENCH_Y - 0.12, 0.4, 0x22252e);
    const t = new BoxBuilder();
    t.box(cx, 2.46, DUG_BENCH_Z - 0.02, 3.5, 0.12, 1.2, 0xffffff);
    return this.group(this.mesh(b), this.mesh(t, this.trimMat));
  }

  private buildGrass(): THREE.Group {
    const b = new BoxBuilder();
    this.grassInto(b, 12, -1.5);
    return this.group(this.mesh(b));
  }

  /** The penalty's patch: the spot, the goal line, and a goal with its net. */
  private buildSpot(): BoxBuilder {
    const b = new BoxBuilder();
    const z = PEN_GOAL_Z;
    b.box(PEN_BALL_X, 0.008, PEN_BALL_Z, 0.3, 0.016, 0.3, 0xf4f4ee);
    b.box(0, 0.008, z, 16, 0.016, 0.13, 0xf4f4ee);
    for (const s of [-1, 1]) b.box(s * 2.45, 1.14, z, 0.13, 2.28, 0.13, 0xfbfbf4);
    b.box(0, 2.3, z, 5.03, 0.13, 0.13, 0xfbfbf4);
    for (let x = -2.3; x <= 2.31; x += 0.46) b.box(x, 1.12, z - 1.1, 0.035, 2.24, 0.035, 0xd5dbe2);
    for (let y = 0.3; y < 2.3; y += 0.46) b.box(0, y, z - 1.1, 4.66, 0.035, 0.035, 0xd5dbe2);
    for (const s of [-1, 1]) b.box(s * 2.45, 2.26, z - 0.55, 0.05, 0.05, 1.1, 0xd5dbe2);
    return b;
  }

  /** The halfway line and the centre spot, for the toss and the match ball. */
  private buildCentre(): BoxBuilder {
    const b = new BoxBuilder();
    b.box(0, 0.008, -0.9, 16, 0.016, 0.13, 0xf4f4ee);
    b.box(0, 0.008, -0.9, 0.3, 0.018, 0.3, 0xf4f4ee);
    return b;
  }

  /** In the head's own space (voxels): a band over the hair, a cup on each ear, the microphone round to his mouth. */
  private buildHeadset(): BoxBuilder {
    const b = new BoxBuilder();
    const u = VU;
    b.box(0, 10.5 * u, 0, 1.7 * u, 0.9 * u, 11.6 * u, INK);
    for (const s of [-1, 1]) {
      b.box(0, 7.6 * u, s * 5.75 * u, 1.1 * u, 5.4 * u, 0.7 * u, INK);
      b.box(0, 4.4 * u, s * 5.7 * u, 3.2 * u, 3.8 * u, 1.5 * u, 0x2c2f38);
      b.box(0, 4.4 * u, s * 6.5 * u, 1.6 * u, 1.6 * u, 0.25 * u, 0xec4a3e);
    }
    b.box(3.2 * u, 2.5 * u, -5.9 * u, 6.2 * u, 0.6 * u, 0.6 * u, INK);
    b.box(6.2 * u, 2.5 * u, -4.9 * u, 1.3 * u, 1.3 * u, 2.2 * u, 0x4a4f5b);
    return b;
  }

  /** In the torso's own space (voxels; the chest faces +x): a cream shirt front under the chin, the tie down it. */
  private buildTie(color: number): BoxBuilder {
    const b = new BoxBuilder();
    const u = VU;
    b.box(2.56 * u, 5.4 * u, 0, 0.14 * u, 3.2 * u, 2.6 * u, 0xf4f1e4);
    b.box(2.66 * u, 6.5 * u, 0, 0.16 * u, 1.0 * u, 1.3 * u, color);
    b.box(2.66 * u, 4.6 * u, 0, 0.16 * u, 3.4 * u, 0.9 * u, color);
    return b;
  }

  private buildProps(): Record<SideKind, THREE.Object3D[]> {
    const add = (g: THREE.BufferGeometry, mat: THREE.Material = this.mat): THREE.Mesh => {
      const m = new THREE.Mesh(g, mat);
      m.visible = false;
      this.scene.add(m);
      return m;
    };
    const paper = this.geo(new BoxBuilder().box(0, 0, 0, 0.21, 0.012, 0.3, 0xf7f7f2).build());
    const papers: THREE.Object3D[] = [];
    for (let i = 0; i < BOX_PAPERS; i++) papers.push(add(paper));
    const chair = add(this.geo(new BoxBuilder().box(0, 0.95, 0, 0.78, 1.0, 0.1, 0x3b4152).box(0, 0.5, 0.3, 0.7, 0.08, 0.6, 0x3b4152).box(0, 0.25, 0.3, 0.1, 0.5, 0.1, 0x22252e).build()));
    const box: THREE.Object3D[] = [...papers];
    box[BOX_HEADSET] = this.headsets[0];
    box[BOX_CHAIR] = chair;

    const bk = new BoxBuilder();
    bk.box(0, 0, 0, 0.42, 0.44, 0.42, 0xec4a3e);
    for (const s of [-1, 1]) {
      bk.box(s * 0.11, 0, 0.212, 0.07, 0.44, 0.01, 0xfbfbf4);
      bk.box(s * 0.11, 0, -0.212, 0.07, 0.44, 0.01, 0xfbfbf4);
      bk.box(0.212, 0, s * 0.11, 0.01, 0.44, 0.07, 0xfbfbf4);
      bk.box(-0.212, 0, s * 0.11, 0.01, 0.44, 0.07, 0xfbfbf4);
    }
    bk.box(0, 0.25, 0, 0.36, 0.08, 0.36, 0xfff1b0);
    bk.box(-0.08, 0.31, 0.05, 0.12, 0.08, 0.12, 0xfffbe0);
    bk.box(0.1, 0.3, -0.06, 0.1, 0.07, 0.1, 0xffe58a);
    const fans: THREE.Object3D[] = [];
    fans[FAN_BUCKET] = add(this.geo(bk.build()));
    const corn = this.geo(new BoxBuilder().box(0, 0, 0, 0.085, 0.085, 0.085, 0xfff4c2, { top: 0xffe58a }).build());
    for (let i = 0; i < FAN_CORN; i++) fans.push(add(corn));

    const bottle = add(this.geo(new BoxBuilder().box(0, 0, 0, 0.12, 0.28, 0.12, 0x3aa0ff).box(0, 0.17, 0, 0.08, 0.07, 0.08, 0xfbfbf4).build()));
    const coin = add(this.geo(new BoxBuilder().box(0, 0, 0, 0.26, 0.26, 0.04, 0xffd23a, { top: 0xfff1b5 }).build()));
    const ball = add(this.geo(buildBallGeometry(BALL_M, ballSkinOf(this.opt.ballSkin))), charMaterial);
    return { box, fans, dugout: [bottle], redcard: [bottle], coin: [coin], penalty: [ball], matchball: [ball] };
  }

  /** The studio's wall screen: a small canvas, painted once a goal. */
  private makeScreen(): void {
    if (typeof document === 'undefined') return;
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 144;
    this.screenCtx = cv.getContext('2d');
    if (!this.screenCtx) return;
    this.screenTex = new THREE.CanvasTexture(cv);
    this.screenTex.colorSpace = THREE.SRGBColorSpace;
    this.screenTex.magFilter = THREE.NearestFilter;
    this.screenMat.map = this.screenTex;
    this.screenMat.needsUpdate = true;
  }

  private paintScreen(c: SideCue): void {
    const g = this.screenCtx;
    if (!g || !this.screenTex) return;
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#3f9a3a' : '#4aab45';
      g.fillRect(i * 32, 0, 32, 144);
    }
    const s = c.screen;
    const font = (px: number): string => `700 ${px}px Silkscreen, 'Lilita One', sans-serif`;
    g.textBaseline = 'middle';
    g.fillStyle = '#1c1c22';
    g.fillRect(0, 0, 256, 32);
    g.fillStyle = '#ec4a3e';
    g.fillRect(6, 6, 76, 20);
    g.fillStyle = '#ffffff';
    g.font = font(15);
    g.textAlign = 'center';
    g.fillText('REPLAY', 44, 17);
    if (s) {
      g.fillStyle = '#fbfbf4';
      g.fillText(`${s.home} ${s.score[0]} : ${s.score[1]} ${s.away}`, 170, 17);
    }
    g.font = font(46);
    g.fillStyle = '#1c1c22';
    g.fillText('GOAL', 131, 76);
    g.fillStyle = '#ffd23a';
    g.fillText('GOAL', 128, 72);
    if (s?.scorer) {
      g.fillStyle = css(c.kits[c.mood === 'joy' ? c.side : c.side === 0 ? 1 : 0].shirt);
      g.fillRect(0, 108, 256, 36);
      g.fillStyle = '#1c1c22';
      g.fillRect(0, 108, 256, 4);
      g.font = font(18);
      g.lineWidth = 4;
      g.strokeStyle = '#1c1c22';
      const name = s.scorer.toUpperCase().slice(0, 14);
      g.strokeText(name, 128, 128);
      g.fillStyle = '#fbfbf4';
      g.fillText(name, 128, 128);
    }
    this.screenTex.needsUpdate = true;
  }

  // ---------------------------------------------------------------- the picture

  begin(c: SideCue): void {
    this.end();
    this.cue = c;
    const set = c.kind === 'box' ? 'studio' : c.kind === 'fans' ? 'stand' : c.kind === 'dugout' || c.kind === 'redcard' ? 'dugout' : 'grass';
    for (const [name, g] of Object.entries(this.sets)) g.visible = name === set;
    this.spotLines.visible = c.kind === 'penalty';
    this.centreLines.visible = c.kind === 'coin' || c.kind === 'matchball';
    this.backdrop.visible = set === 'dugout' || set === 'grass';
    this.backdrop.position.z = set === 'dugout' ? -2.4 : c.kind === 'penalty' ? PEN_GOAL_Z - 2.6 : -5.2;
    const L = LIGHTS[set === 'studio' ? 'studio' : this.opt.timeOfDay];
    this.hemi.color.setHex(L[0]);
    this.hemi.groundColor.setHex(L[1]);
    this.hemi.intensity = L[2];
    this.key.color.setHex(L[3]);
    this.key.intensity = L[4];
    this.bg.setHex(L[5]);
    this.trimMat.color.setHex(c.kits[c.side].shirt);
    const s = c.full && c.kind === 'box' ? FULL_SHOT : SHOTS[c.kind];
    this.cam.position.set(s[0], s[1], s[2]);
    this.cam.lookAt(s[3], s[4], s[5]);
    this.cam.fov = s[6];
    this.cam.updateProjectionMatrix();
    // The real players this one needs, in their real kits.
    for (const m of c.cast) {
      const p = new Puppet(new Footballer(m.def, c.kits[m.side], m.keeper));
      this.scene.add(p.fb.group);
      this.cast.push(p);
    }
    const r = this.regulars;
    const cast = this.cast;
    this.active = c.kind === 'box' ? r.box : c.kind === 'fans' ? r.fans
      : c.kind === 'dugout' ? [r.manager, cast[0] ?? null, cast[1] ?? null, cast[2] ?? null]
      : c.kind === 'redcard' ? [r.manager, cast[0] ?? null, cast[1] ?? null, cast[2] ?? null, cast[3] ?? null]
      : c.kind === 'coin' ? [cast[0] ?? null, cast[1] ?? null, r.referee] : [cast[0] ?? null, cast[1] ?? null, cast[2] ?? null];
    if (c.kind === 'box') this.paintScreen(c);
    this.frameEl?.show(c.label, c.line, c.full, css(c.kits[c.side].shirt));
    this.measureIn = 0;
    this.frame(c, 0);
  }

  frame(c: SideCue, _dt: number): void {
    if (c !== this.cue) return;
    const ps = this.poses;
    const v = this.propV;
    sidePose(c.kind, c.mood, c.variant, c.t, c.h, ps, v);
    for (let i = 0; i < this.active.length; i++) this.active[i]?.apply(ps[i]);
    const props = this.props[c.kind];
    for (let i = 0; i < props.length; i++) {
      const o = props[i];
      if (!o) continue;
      const k = i * PROP_F;
      o.visible = v[k + 6] > 0.5;
      o.position.set(v[k], v[k + 1], v[k + 2]);
      o.rotation.set(v[k + 3], v[k + 4], v[k + 5]);
    }
    if (c.kind === 'box') {
      this.lampMat.color.setHex(Math.sin(c.t * 5) > -0.3 ? 0xff3b30 : 0x5c1814);
      // The screen flares as the ball goes in.
      this.screenMat.color.setScalar(c.h < 0 ? 0.86 : 0.86 + 0.14 * Math.abs(Math.sin(c.h * 9)) * Math.exp(-c.h * 1.2) + 0.14 * (1 - Math.exp(-c.h * 3)));
    }
  }

  end(): void {
    if (!this.cue) return;
    this.cue = null;
    for (const p of this.cast) {
      p.fb.dispose();
    }
    this.cast.length = 0;
    this.active = [];
    this.hideAll();
    this.frameEl?.hide();
  }

  private hideAll(): void {
    for (const g of Object.values(this.sets)) g.visible = false;
    const r = this.regulars;
    for (const p of r.box) p.fb.group.visible = false;
    for (const p of r.fans) p.fb.group.visible = false;
    r.manager.fb.group.visible = false;
    r.referee.fb.group.visible = false;
    for (const list of Object.values(this.props)) for (const o of list) if (o && !this.headsets.includes(o as THREE.Mesh)) o.visible = false;
    for (const h of this.headsets) {
      h.visible = true;
      h.position.set(0, 0, 0);
      h.rotation.set(0, 0, 0);
    }
  }

  // ---------------------------------------------------------------- World.overlay

  /** The whole frame is this picture (a big goal's cut): the match is not drawn under it. */
  get full(): boolean {
    return !!this.cue?.full;
  }

  /** Where the corner box is on the canvas (CSS px, measured now and then: the layout moves it, not the frame). */
  private measure(r: THREE.WebGLRenderer): void {
    const b = this.box;
    const el = this.frameEl;
    b.ok = false;
    if (!el || el.hidden) return;
    const rect = el.rect();
    const cv = r.domElement.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8 || cv.width < 8) return;
    const k = this.size.x / cv.width;
    b.w = rect.width * k;
    b.h = rect.height * k;
    b.x = (rect.left - cv.left) * k;
    b.y = (cv.bottom - rect.bottom) * k;
    b.ok = true;
  }

  draw(r: THREE.WebGLRenderer): void {
    const c = this.cue;
    if (!c) return;
    r.getSize(this.size);
    const W = this.size.x;
    const H = this.size.y;
    let x = 0, y = 0, w = W, h = H;
    if (!c.full) {
      if (--this.measureIn <= 0) {
        this.measureIn = 12;
        this.measure(r);
      }
      const b = this.box;
      if (!b.ok) return;
      x = b.x; y = b.y; w = b.w; h = b.h;
    }
    const aspect = w / h;
    if (Math.abs(this.cam.aspect - aspect) > 1e-3) {
      this.cam.aspect = aspect;
      this.cam.updateProjectionMatrix();
    }
    r.setViewport(x, y, w, h);
    r.setScissor(x, y, w, h);
    r.setScissorTest(true);
    r.render(this.scene, this.cam);
    r.setScissorTest(false);
    r.setViewport(0, 0, W, H);
  }

  dispose(): void {
    this.end();
    if (this.world.overlay === this) this.world.overlay = null;
    const r = this.regulars;
    for (const p of [...r.box, ...r.fans, r.manager, r.referee]) p.fb.dispose();
    for (const g of this.geos) g.dispose();
    this.geos.length = 0;
    this.mat.dispose();
    this.trimMat.dispose();
    this.lampMat.dispose();
    this.screenMat.dispose();
    this.screenTex?.dispose();
    this.screenTex = null;
    this.scene.clear();
    this.frameEl?.dispose();
  }
}
