import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { lerp, wrapAngle } from '../core/math';
import { BALL_OFS, FRAME_LEN, PF, SENT_OFF_CODE } from '../game/replay';
import { BALL_R } from '../sim/constants';
import type { Kit, PlayerDef, TeamDef } from '../sim/types';
import { CelebrationRig } from './celebration';
import {
  CHAR_H, Footballer, PSTATE, VU, ballSkinOf, buildBallGeometry, charMaterial, charMaterialFor, screenCharK, setCharacterFill, setCharacterHemiFill, setKitGlow,
  type PoseInput,
} from './characters';
import type { StyledKit } from './kitDesigns';
import { IncidentMarks } from './incidentMarks';
import { headgearGeometry, isHeadgear } from './looks';
import { BALL_FLASH_S, ballFlashScale } from './juice';
import { FLOODLIGHT_TOWERS } from './stadium';
import { BoxBuilder } from './voxel';

/**
 * 'full': ring + bobbing arrow + name tag; 'ring': just the ground ring (low set-piece / shootout cameras);
 * 'off': nothing (the card close-up).
 */
export type MarkerMode = 'full' | 'ring' | 'off';

/** Referee signals: arm raised (foul / offside), advantage (both arms forward), a card held high, pointing to the penalty spot. */
export type RefSignal = 'arm' | 'advantage' | 'card' | 'spot';

export const CARD_YELLOW = 0xffd43b;
export const CARD_RED = 0xe03131;
/** The man in the middle (the studio's founder takes the whistle): the HUD / commentary name him by this. */
export const REFEREE_NAME = 'I. Sharaf';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Outfield players (every index but the two keepers, 0 and 11): the ones that get a team ring. */
const RING_IDX = Array.from({ length: 22 }, (_, i) => i).filter((i) => i !== 0 && i !== 11);

/** Night: camera-side fill light on the footballers (light units; see characters.setCharacterFill). */
const NIGHT_CHAR_FILL = 0.6;
/** Sunset: neutral sky fill on the footballers, so kits and skin stay true under the orange key. */
const SUNSET_CHAR_HEMI = 0.35;
/** Team ring under every outfield player (AI v AI): radii (m, before the draw scale) and opacity. */
const TEAM_RING_IN = 0.4;
const TEAM_RING_OUT = 0.56;
const TEAM_RING_ALPHA = 0.45;
/**
 * With a human side, "us" and "them" read at a glance whatever the kits: his team-mates stand on a vivid
 * azure ring inside a white edge (and wear chevron pips in the same blue), the opponents on a vivid red ring
 * just as thick, rimmed thin and dark inside and out so it holds on both grass stripes. Both sit under the
 * yellow control marker and the teal pass rings (the blue is kept well clear of that teal).
 */
const US_BLUE = 0x2b80ff;
const US_EDGE = 0xffffff;
const THEM_RED = 0xff2e2e;
const THEM_EDGE = 0x2a0c0e;
const OUR_RING_IN = 0.42;
const OUR_RING_OUT = 0.64;
const OUR_EDGE_OUT = 0.76;
const OUR_RING_ALPHA = 0.95;
const OUR_EDGE_ALPHA = 0.9;
const THEIR_RING_IN = 0.42;
const THEIR_RING_OUT = 0.64;
const THEIR_EDGE_IN = 0.37;
const THEIR_EDGE_OUT = 0.7;
const THEIR_RING_ALPHA = 0.9;
const THEIR_EDGE_ALPHA = 0.75;
/** Render order of the square markers (ours, the rival's, the receiver's): after every team ring (2, 3). */
const MARKER_ORDER = 6;
/** Team pip over each of the human's team-mates: this far (m) over the head, drawn over everything. */
const PIP_UP = 0.36;
/** The referee's card (the chunky 1.4x mesh), scaled down so the close-up reads as a card, not a sign. */
const CARD_SCALE = 0.35;
/** Pass charging: the pass colour (teal, whitening towards full power) for the bar, recipient ring and arrow. */
const PASS_TEAL = 0x2fe6d2;
/** The landing ring's inner colour while his man is locked onto the ball in the air (the HUD's gold). */
const LANDING_LOCKED = 0xffd23e;
const PASS_LIGHT = 0x9ff7ee;
const PASS_WHITE = 0xfbfbf4;
/** The pass arrow: starts this far (m) out from the passer, stops this far short of the recipient, at most this long. */
const PASS_ARROW_FROM = 0.9;
const PASS_ARROW_SHORT = 1.1;
const PASS_ARROW_MAX = 5.5;
/** ...and turned this far (rad, about the raised arm) from facing the offender towards the lens side. */
const CARD_TURN = -1.3;
/**
 * The penalty aim reticle (setPenAim): pixel art, `#` the ring and crosshair, `o` the centre pixel, each pixel
 * RETICLE_PX m (about a metre across, a ball and a half), pulsing RETICLE_PULSE of its size RETICLE_HZ times a
 * second while he aims, RETICLE_LOCKED of it once he has let SHOOT go.
 */
const RETICLE_ART = [
  '....#####....',
  '..##.....##..',
  '.#....#....#.',
  '.#....#....#.',
  '#...........#',
  '#...........#',
  '#.##..o..##.#',
  '#...........#',
  '#...........#',
  '.#....#....#.',
  '.#....#....#.',
  '..##.....##..',
  '....#####....',
];
const RETICLE_PX = 0.078;
const RETICLE_FILL = 0xffd23a;
const RETICLE_CORE = 0xfbfbf4;
const RETICLE_EDGE = 0x1b2230;
const RETICLE_HZ = 2.2;
const RETICLE_PULSE = 0.08;
const RETICLE_LOCKED = 0.86;
/**
 * Pass-target preview (the human on the ball, not charging): who a PASS pressed now goes to stands on a calm
 * white ring (teal inside; no pulse: the charge ring is the one that pulses) and his pip turns white and
 * PREVIEW_PIP_K bigger; who a THROUGH ball goes to gets a fainter dashed ring out in the space ahead of him.
 * A change of target cross-fades over PREVIEW_FADE_S (the old one out, the new one in: never a flicker).
 */
const PREVIEW_FADE_S = 0.1;
const PREVIEW_PIP_K = 0.4;
const PREVIEW_RING_IN = 0.42;
const PREVIEW_RING_OUT = 0.6;
const PREVIEW_EDGE_IN = 0.66;
const PREVIEW_EDGE_OUT = 0.9;
const THROUGH_R = 0.72;
const THROUGH_DASHES = 10;
const THROUGH_ALPHA = 0.75;
/**
 * Colour-blind aid (SessionOptions.colorblind): no information by colour alone. The opponents' rings are
 * dashed (CB_DASHES short arcs), ours stay solid (with the chevron pips over our heads), the pass-preview ring
 * is notched (CB_NOTCHES gaps in its white edge) and the controlled player's square marker gets corner brackets.
 */
const CB_DASHES = 12;
const CB_NOTCHES = 4;
/**
 * Shadow budget (the medium / low settings: setShadowBudget): only the players nearest the ball cast a dynamic
 * shadow; the rest stand on a soft blob. A player already casting keeps it until he is BUDGET_STICKY m further
 * out than the one replacing him (no flicker at the edge of the budget).
 */
const BUDGET_STICKY = 3;
const BLOB_R = 0.42;
const BLOB_ALPHA = 0.26;

/**
 * A flat ring of `n` arcs (inner / outer radius, m) lying on the ground, each `fill` of its share of the circle
 * (the rest a gap), the first centred on `start` radians.
 */
function arcRing(inner: number, outer: number, n: number, fill: number, start = 0): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const share = (Math.PI * 2) / n;
  const len = share * fill;
  for (let i = 0; i < n; i++) {
    const a = start + i * share - len / 2;
    parts.push(new THREE.RingGeometry(inner, outer, Math.max(2, Math.round(24 * fill / n * 4)), 1, a, len).rotateX(-Math.PI / 2));
  }
  const g = mergeGeometries(parts)!;
  for (const q of parts) q.dispose();
  return g;
}

/** AI v AI ring colour for a side: its shirt colour, lifted to at least mid lightness. */
function midRingColor(k: Kit): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  const mid = new THREE.Color(k.shirt);
  mid.getHSL(hsl);
  if (hsl.l < 0.5) mid.setHSL(hsl.h, hsl.s, 0.5);
  return mid;
}

/** Everything that draws a match: 22 voxel footballers, the ball, and the control marker. */
export class MatchView {
  readonly group = new THREE.Group();
  /** Iconic goal celebrations: overrides the scoring side's drawn frame while the goal phase lasts. */
  readonly celeb = new CelebrationRig();
  /** Where the lens was last frame (faceCamera): the choreography lines its rows up square to it. */
  private camPos = new THREE.Vector3(0, 30, 60);
  readonly players: Footballer[] = [];
  readonly ball: THREE.Mesh;
  private ballShadow: THREE.Mesh;
  private marker: THREE.Group;
  /** Online: a ring under the man the other player controls (setRival), made on first use; -1: none. */
  private rivalRing: THREE.Mesh | null = null;
  private rivalIdx = -1;
  private markerRing: THREE.Mesh;
  private arrow: THREE.Mesh;
  private powerBar: THREE.Group;
  private nameTag: THREE.Sprite;
  private nameCanvas: HTMLCanvasElement;
  private nameTex: THREE.CanvasTexture;
  private nameFor = -1;
  private targetRing: THREE.Mesh;
  private aim: THREE.Mesh;
  private names: string[] = [];
  private referee: Footballer;
  private ref = { x: -8, z: -10, vx: 0, vz: 0, facing: 0, phase: 0, signal: 0, kind: 'arm' as RefSignal, hold: 0, faceX: 0, faceZ: 0 };
  /** The card in the referee's raised hand (yellow / red), shown only while he books someone. */
  private cards: { yellow: THREE.Mesh; red: THREE.Mesh };
  /** Draw scale on top of CHAR_SCALE (bigger on phones); refreshed every frame. */
  private charK = 1;
  private powerFill: THREE.Mesh;
  private markerMode: MarkerMode = 'full';
  private charging = false;
  /** Night: four faint floodlight shadows per player, one away from each tower. */
  private floodShadows: THREE.InstancedMesh | null = null;
  /**
   * Ground rings under the outfield players: one set per style (AI v AI: one for everybody; with a human
   * side: his team's fill and white edge, and the opponents' thin ring). `idx`: the players, by instance.
   */
  private ringSets: { mesh: THREE.InstancedMesh; idx: number[] }[] = [];
  private ringsOn = true;
  /** Team pips over the human's team-mates (fill and white outline), their players and where they stand. */
  private pipFill: THREE.InstancedMesh | null = null;
  private pipEdge: THREE.InstancedMesh | null = null;
  private pipIdx: number[] = [];
  private pipsOn = false;
  private pipColor = new THREE.Color();
  /** The team-mate a charging pass is locked onto (his pip lights up white), -1 when none. */
  private passAimIdx = -1;
  /**
   * Pass-target preview (see PREVIEW_FADE_S): per player, how much of the PASS / THROUGH highlight he wears
   * (0..1, eased), his rings (made the first time he is picked), and where the through ring stands ahead.
   */
  private previewW = new Float32Array(22);
  private throughW = new Float32Array(22);
  private previewRings: (THREE.Group | null)[] = new Array(22).fill(null);
  private throughRings: (THREE.Mesh | null)[] = new Array(22).fill(null);
  private throughAt = new Float32Array(44);
  /** The human's team colours (ring / pip fill and its edge), for the HUD's off-screen arrows. */
  readonly teamColor = { fill: 0xffffff, edge: 0x26262e };
  /** Power bar at the shooter's feet (over-the-shoulder set-piece lens) rather than over his head. */
  private powerLow = false;
  private powerAt = new THREE.Vector3();
  /**
   * Pass charging (PASS held): a small teal power bar at the passer's feet, a pulsing ring under the
   * teammate the pass is locked onto and a short arrow from the passer towards him, all drawn over the players.
   */
  private passBar: THREE.Group;
  private passFill: THREE.Mesh;
  private passAt = new THREE.Vector3();
  private passRing: THREE.Group;
  private passArrow: THREE.Group;
  private passShaft: THREE.Mesh;
  private passHead: THREE.Mesh;
  private passing = false;
  /** How far (m) the drawn ball still trails the sim's after a touch that snapped it somewhere (MatchSession.glideBall). */
  readonly ballGlide = { x: 0, y: 0, z: 0 };
  /** Time of the last apply() (the pass ring pulses on it). */
  private clock = 0;
  private towers: readonly { x: number; z: number; h: number }[] = FLOODLIGHT_TOWERS;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v3 = new THREE.Vector3();
  private s3 = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private ballQuat = new THREE.Quaternion();
  private tmpC = new THREE.Color();
  private white = new THREE.Color(PASS_WHITE);
  private tmpQ = new THREE.Quaternion();
  private axis = new THREE.Vector3();
  private pose: PoseInput = {
    state: 0, stateT: 0, speed: 0, runPhase: 0, kickT: 0, kickLeg: 1, lean: 0, diveDir: 0, headerT: 0,
    celebrate: 0, y: 0, keeper: false, hasBall: false, look: 0, turn: 0,
  };
  private lastFacing = new Float32Array(22);
  /**
   * Players held on a mark for a close-up (the booked player facing the referee, the man he brought down
   * standing off to one side), render only.
   */
  private pinned: { i: number; x: number; z: number; facing: number }[] = [];
  /** The ball kept out of a low close-up it would sit right in front of (the card shot). */
  private ballHidden = false;
  /** Blitz mega ball (see setBallHot) and its material, made on first use. */
  private ballHot = false;
  private hotMat: THREE.MeshBasicMaterial | null = null;
  /** Players faded out of a latched close-up (see fadeNearLens). */
  private fadeLatch = new Set<number>();
  private turnRate = new Float32Array(22);
  /** Colour-blind shape cues (see CB_DASHES). */
  readonly colorblind: boolean;
  /** Hit flashes: rendered frames each player has left drawn white, and the ball's flash clock (s; < 0: none). */
  private flashLeft = new Uint8Array(22);
  private ballFlashT = -1;
  private ballFlashMat: THREE.MeshBasicMaterial | null = null;
  /** Shadow budget (null: everyone casts), the blob shadows it puts under the rest, and scratch for the pick. */
  private shadowBudget: number | null = null;
  private blobs: THREE.InstancedMesh | null = null;
  private budgetD = new Float32Array(23);
  private refState_ = { x: 0, z: 0, faceX: 0, faceZ: 0, booking: false };
  /** Interpolated frame the renderer last drew (read by camera, HUD). */
  readonly frame: Float32Array;
  /**
   * A staged shot's hand on the frame about to be drawn (after the pins and the celebration rig, before anyone is
   * posed): the session sets it for the line-up, a substitution and the man of the match, and clears it after.
   */
  frameHook: ((f: Float32Array, dt: number) => void) | null = null;
  private readonly humanSide_: number;
  /** The human side's headgear look on the man he controls, and who wears it now (-1: nobody). */
  private roamHead: THREE.Mesh | null = null;
  private roamFor = -1;

  constructor(teams: [TeamDef, TeamDef], kits: [Kit, Kit], humanSide: number, colorblind = false) {
    this.colorblind = colorblind;
    this.humanSide_ = humanSide;
    // The human side's headgear look (SHOP: render/looks.ts) follows the man he controls; the captain has his own.
    const head = humanSide === 0 || humanSide === 1 ? (kits[humanSide] as StyledKit).looks?.head : undefined;
    const hg = head && isHeadgear(head) ? headgearGeometry(head, VU) : null;
    if (hg) {
      this.roamHead = new THREE.Mesh(hg, charMaterialFor(hg));
      this.roamHead.castShadow = true;
    }
    for (let s = 0; s < 2; s++) {
      teams[s].players.forEach((def, i) => {
        const f = new Footballer(def, kits[s], i === 0);
        this.players.push(f);
        this.group.add(f.group);
      });
    }
    this.frame = new Float32Array(FRAME_LEN);
    const refKit: Kit = { shirt: 0x2a2a30, shirt2: 0xffd23a, pattern: 'plain', shorts: 0x2a2a30, socks: 0x2a2a30, gk: 0x2a2a30 };
    // Bald, full beard, tanned: unmistakable from the gantry (the one look nobody in the squads gets).
    const refDef: PlayerDef = {
      id: 'ref', name: REFEREE_NAME, number: -1, role: 'MF',
      stats: { pace: 70, shooting: 1, passing: 1, dribbling: 1, defending: 1, keeping: 1, stamina: 90 },
      look: { skin: 3, hair: 5, hairColor: 0, beard: 2, boots: 0x2a2a30 },
    };
    this.referee = new Footballer(refDef, refKit, false);
    this.group.add(this.referee.group);
    const card = (color: number) => {
      const b = new BoxBuilder();
      // A chunky card held up past the fingertips (the arms are short), face on to the offender (model +x),
      // thick enough to read from the side too; 1.4x life size so it reads in the close-up.
      b.box(0.03, -0.42, 0, 0.14, 0.84, 0.56, color);
      // Unlit: held up in the referee's own shadow it would otherwise read olive / maroon, not yellow / red.
      const m = new THREE.Mesh(b.build(), new THREE.MeshBasicMaterial({ vertexColors: true }));
      m.castShadow = true;
      m.visible = false;
      m.scale.setScalar(CARD_SCALE);
      // Turned part way from the offender towards the close-up lens (which films from the card-hand side),
      // so the card reads as a card, not a coloured sliver seen edge-on.
      m.rotation.y = CARD_TURN;
      this.referee.holdInHand(m, true);
      return m;
    };
    this.cards = { yellow: card(CARD_YELLOW), red: card(CARD_RED) };
    // The ball shares the footballers' material: it gets their night fill too.
    this.ball = new THREE.Mesh(buildBallGeometry(BALL_R * 1.25), charMaterial);
    this.ball.castShadow = true;
    this.group.add(this.ball);
    // The strike flash's material, made now on a hidden stand-in: World.warmShaders compiles it with the rest
    // instead of the first hard shot stalling on it.
    const flashWarm = new THREE.Mesh(this.ball.geometry, this.flashMatBall());
    flashWarm.visible = false;
    this.group.add(flashWarm);
    // A soft blob keeps the ball readable when high in the air.
    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(0.3, 16).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x1e3312, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    blob.position.y = 0.02;
    this.ballShadow = blob;
    this.group.add(blob);

    // Team rings: flat, see-through rings on the lawn (instanced; lifted off the grass and polygon-offset, so
    // no z-fighting). AI v AI: one ring style in each side's colour. With a human side his team stands out.
    // (`dash`: 0 a solid ring, else CB_DASHES arcs each filling that share of its slot.)
    const ringSet = (inner: number, outer: number, idx: number[], color: (i: number) => THREE.Color, opacity: number, order: number, dash = 0) => {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
      });
      const geo = dash > 0 ? arcRing(inner, outer, CB_DASHES, dash) : new THREE.RingGeometry(inner, outer, 24).rotateX(-Math.PI / 2);
      const mesh = new THREE.InstancedMesh(geo, mat, idx.length);
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      idx.forEach((i, k) => mesh.setColorAt(k, color(i)));
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.group.add(mesh);
      this.ringSets.push({ mesh, idx });
    };
    if (humanSide === 0 || humanSide === 1) {
      const ours = RING_IDX.filter((i) => (i < 11 ? 0 : 1) === humanSide);
      const theirs = RING_IDX.filter((i) => (i < 11 ? 0 : 1) !== humanSide);
      const blue = new THREE.Color(US_BLUE);
      const white = new THREE.Color(US_EDGE);
      const red = new THREE.Color(THEM_RED);
      const dark = new THREE.Color(THEM_EDGE);
      // Each side's edge first (under), then its fill on top. Colour-blind: theirs dashed (the dark rim a
      // slightly longer dash, so each red dash is outlined), ours solid.
      ringSet(THEIR_EDGE_IN, THEIR_EDGE_OUT, theirs, () => dark, THEIR_EDGE_ALPHA, 2, colorblind ? 0.62 : 0);
      ringSet(THEIR_RING_IN, THEIR_RING_OUT, theirs, () => red, THEIR_RING_ALPHA, 3, colorblind ? 0.55 : 0);
      ringSet(OUR_RING_OUT - 0.02, OUR_EDGE_OUT, ours, () => white, OUR_EDGE_ALPHA, 2);
      ringSet(OUR_RING_IN, OUR_RING_OUT, ours, () => blue, OUR_RING_ALPHA, 3);
      // Pips over his team-mates (keeper too): a little voxel chevron in the team colour with a white rim.
      this.pipIdx = Array.from({ length: 11 }, (_, k) => k + (humanSide === 0 ? 0 : 11));
      const chevron = (w: number, color: number) => {
        const pb = new BoxBuilder();
        pb.box(0, 0.09 * w, 0, 0.36 * w, 0.09 * w, 0.01, color);
        pb.box(0, 0, 0, 0.24 * w, 0.09 * w, 0.01, color);
        pb.box(0, -0.09 * w, 0, 0.12 * w, 0.09 * w, 0.01, color);
        return pb.build();
      };
      const pipMat = (order: number) => {
        const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, depthTest: false, depthWrite: false, fog: false });
        return { m, order };
      };
      const e = pipMat(10);
      const fl = pipMat(11);
      this.pipEdge = new THREE.InstancedMesh(chevron(1.45, 0xffffff), e.m, 11);
      this.pipFill = new THREE.InstancedMesh(chevron(1, 0xffffff), fl.m, 11);
      this.pipEdge.renderOrder = e.order;
      this.pipFill.renderOrder = fl.order;
      for (const im of [this.pipEdge, this.pipFill]) {
        im.frustumCulled = false;
        im.visible = false;
        this.group.add(im);
      }
      this.pipColor.copy(blue);
      this.teamColor.fill = US_BLUE;
      this.teamColor.edge = US_EDGE;
      for (let k = 0; k < 11; k++) {
        this.pipFill.setColorAt(k, blue);
        this.pipEdge.setColorAt(k, white);
      }
      this.pipFill.instanceColor!.needsUpdate = true;
      this.pipEdge.instanceColor!.needsUpdate = true;
    } else {
      const mid = [midRingColor(kits[0]), midRingColor(kits[1])];
      ringSet(TEAM_RING_IN, TEAM_RING_OUT, RING_IDX, (i) => mid[i < 11 ? 0 : 1], TEAM_RING_ALPHA, 2);
    }

    // Control marker: a chunky square ring + bobbing arrow in the human's colour.
    const markColor = humanSide >= 0 ? 0xffd23a : 0xffffff;
    this.marker = new THREE.Group();
    const rb = new BoxBuilder();
    const r = 0.62, t = 0.12;
    rb.box(0, 0, -r, r * 2 + t, 0.03, t, markColor);
    rb.box(0, 0, r, r * 2 + t, 0.03, t, markColor);
    rb.box(-r, 0, 0, t, 0.03, r * 2, markColor);
    rb.box(r, 0, 0, t, 0.03, r * 2, markColor);
    rb.box(r + 0.28, 0, 0, 0.3, 0.03, 0.26, markColor);
    if (colorblind) {
      // Colour-blind: corner brackets outside the square (a reticle), a shape no ring has.
      const c = r + 0.3;
      const L = 0.34;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          rb.box(sx * (c - L / 2 + t / 2), 0, sz * c, L, 0.03, t, markColor);
          rb.box(sx * c, 0, sz * (c - L / 2 + t / 2), t, 0.03, L, markColor);
        }
      }
    }
    // (Drawn after the team rings, still depth-tested so his boots stand in front of it: always on top of them.)
    this.markerRing = new THREE.Mesh(rb.build(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true }));
    this.markerRing.renderOrder = MARKER_ORDER;
    this.markerRing.position.y = 0.04;
    this.marker.add(this.markerRing);
    const ab = new BoxBuilder();
    ab.box(0, 0.36, 0, 0.44, 0.12, 0.44, markColor);
    ab.box(0, 0.24, 0, 0.3, 0.12, 0.3, markColor);
    ab.box(0, 0.12, 0, 0.16, 0.12, 0.16, markColor);
    this.arrow = new THREE.Mesh(ab.build(), new THREE.MeshBasicMaterial({ vertexColors: true }));
    this.marker.add(this.arrow);
    // Surname tag floating over the controlled player, broadcast style.
    this.nameCanvas = document.createElement('canvas');
    this.nameCanvas.width = 384;
    this.nameCanvas.height = 72;
    this.nameTex = new THREE.CanvasTexture(this.nameCanvas);
    this.nameTex.colorSpace = THREE.SRGBColorSpace;
    this.nameTag = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.nameTex, depthTest: false, transparent: true }));
    this.nameTag.scale.set(2.76, 0.52, 1);
    this.nameTag.renderOrder = 10;
    this.marker.add(this.nameTag);
    for (let s = 0; s < 2; s++) for (const p of teams[s].players) this.names.push(p.name.split('. ').pop()!.toUpperCase());
    this.group.add(this.marker);
    this.marker.visible = humanSide >= 0;

    // Ring on the intended receiver of a pass.
    const tb = new BoxBuilder();
    const tr = 0.55, tt = 0.08;
    tb.box(0, 0, -tr, tr * 2 + tt, 0.02, tt, 0xffffff);
    tb.box(0, 0, tr, tr * 2 + tt, 0.02, tt, 0xffffff);
    tb.box(-tr, 0, 0, tt, 0.02, tr * 2, 0xffffff);
    tb.box(tr, 0, 0, tt, 0.02, tr * 2, 0xffffff);
    this.targetRing = new THREE.Mesh(tb.build(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 }));
    this.targetRing.renderOrder = MARKER_ORDER;
    this.targetRing.position.y = 0.05;
    this.targetRing.visible = false;
    this.group.add(this.targetRing);

    // Set-piece aim: a dashed chunky arrow along the taker's facing.
    const ab2 = new BoxBuilder();
    for (let i = 0; i < 6; i++) ab2.box(1.0 + i * 0.9, 0, 0, 0.55, 0.02, 0.22, 0xffd23a);
    ab2.box(6.6, 0, 0, 0.3, 0.02, 0.9, 0xffd23a);
    ab2.box(6.9, 0, 0, 0.3, 0.02, 0.55, 0xffd23a);
    ab2.box(7.2, 0, 0, 0.3, 0.02, 0.22, 0xffd23a);
    // Drawn over everything (depthTest off, late render order): a wall or a team-mate standing on the line
    // never hides where the kick is going.
    this.aim = new THREE.Mesh(
      ab2.build(),
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, fog: false }),
    );
    this.aim.renderOrder = 9;
    this.aim.position.y = 0.06;
    this.aim.visible = false;
    this.group.add(this.aim);

    // Shot power: a chunky billboard bar over the shooter (outline, track, fill, 60% / 85% ticks).
    this.powerBar = new THREE.Group();
    const flat = (w: number, h: number, color: number, order: number) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, fog: false }),
      );
      m.renderOrder = order;
      return m;
    };
    const BAR_W = 2.2;
    const BAR_H = 0.28;
    const edge = flat(BAR_W + 0.1, BAR_H + 0.1, 0xfbfbf4, 11);
    const track = flat(BAR_W, BAR_H, 0x26262e, 12);
    this.powerFill = flat(BAR_W - 0.08, BAR_H - 0.08, 0x3aff9e, 13);
    this.powerFill.geometry.translate((BAR_W - 0.08) / 2, 0, 0);
    this.powerFill.position.x = -(BAR_W - 0.08) / 2;
    this.powerBar.add(edge, track, this.powerFill);
    for (const k of [0.6, 0.85]) {
      const tick = flat(0.04, BAR_H - 0.02, 0xfbfbf4, 14);
      tick.position.x = -(BAR_W - 0.08) / 2 + (BAR_W - 0.08) * k;
      this.powerBar.add(tick);
    }
    this.powerBar.visible = false;
    this.group.add(this.powerBar);

    // Pass power: the same chunky bar, smaller and teal, at the passer's feet (no sweet-spot ticks).
    this.passBar = new THREE.Group();
    const PB_W = 1.5;
    const PB_H = 0.22;
    this.passFill = flat(PB_W - 0.08, PB_H - 0.08, PASS_TEAL, 13);
    this.passFill.geometry.translate((PB_W - 0.08) / 2, 0, 0);
    this.passFill.position.x = -(PB_W - 0.08) / 2;
    this.passBar.add(flat(PB_W + 0.1, PB_H + 0.1, PASS_WHITE, 11), flat(PB_W, PB_H, 0x1f2a30, 12), this.passFill);
    this.passBar.visible = false;
    this.group.add(this.passBar);
    // The teammate the pass is locked onto: a bright teal ring with a white inner ring, flat on the lawn and
    // drawn over everything (never hidden by the players around him).
    const overlay = (color: number, opacity: number) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, fog: false });
    const ring = new THREE.Group();
    const outer = new THREE.Mesh(new THREE.RingGeometry(0.64, 0.86, 28).rotateX(-Math.PI / 2), overlay(PASS_TEAL, 0.95));
    const inner = new THREE.Mesh(new THREE.RingGeometry(0.46, 0.54, 28).rotateX(-Math.PI / 2), overlay(PASS_WHITE, 0.9));
    outer.renderOrder = 9;
    inner.renderOrder = 9;
    ring.add(outer, inner);
    ring.position.y = 0.05;
    ring.visible = false;
    this.passRing = ring;
    this.group.add(ring);
    // ...and a short arrow from the passer towards him: a flat shaft (scaled to length) and a chunky head.
    this.passArrow = new THREE.Group();
    this.passShaft = new THREE.Mesh(new THREE.BoxGeometry(1, 0.02, 0.2).translate(0.5, 0, 0), overlay(PASS_TEAL, 0.92));
    const hb = new BoxBuilder();
    hb.box(0.15, 0, 0, 0.3, 0.02, 0.8, PASS_TEAL);
    hb.box(0.45, 0, 0, 0.3, 0.02, 0.5, PASS_TEAL);
    hb.box(0.75, 0, 0, 0.3, 0.02, 0.2, PASS_WHITE);
    this.passHead = new THREE.Mesh(
      hb.build(),
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, fog: false }),
    );
    this.passShaft.renderOrder = 9;
    this.passHead.renderOrder = 9;
    this.passArrow.add(this.passShaft, this.passHead);
    this.passArrow.position.y = 0.06;
    this.passArrow.visible = false;
    this.group.add(this.passArrow);
  }

  /** Blend frames a→b and pose everything. */
  apply(a: Float32Array, b: Float32Array, alpha: number, time: number, dt: number): void {
    const f = this.frame;
    this.clock = time;
    for (let i = 0; i < a.length; i++) f[i] = a[i];
    for (let i = 0; i < 22; i++) {
      const o = i * PF;
      // Only blend continuous channels; discrete ones take the newer frame.
      f[o] = lerp(a[o], b[o], alpha);
      f[o + 1] = lerp(a[o + 1], b[o + 1], alpha);
      f[o + 2] = lerp(a[o + 2], b[o + 2], alpha);
      f[o + 3] = a[o + 3] + wrapAngle(b[o + 3] - a[o + 3]) * alpha;
      // (Discrete channels: state, kick foot, dive direction, celebration style, has the ball.)
      f[o + 4] = b[o + 4];
      f[o + 9] = b[o + 9];
      f[o + 11] = b[o + 11];
      f[o + 13] = b[o + 13];
      f[o + 14] = b[o + 14];
      f[o + 5] = b[o + 4] === a[o + 4] ? lerp(a[o + 5], b[o + 5], alpha) : b[o + 5];
      const dp = b[o + 6] - a[o + 6];
      f[o + 6] = a[o + 6] + (dp < -0.5 ? dp + 1 : dp) * alpha;
      f[o + 7] = lerp(a[o + 7], b[o + 7], alpha);
      f[o + 8] = lerp(a[o + 8], b[o + 8], alpha);
      f[o + 10] = lerp(a[o + 10], b[o + 10], alpha);
      f[o + 12] = lerp(a[o + 12], b[o + 12], alpha);
    }
    for (let k = 0; k < 6; k++) f[BALL_OFS + k] = lerp(a[BALL_OFS + k], b[BALL_OFS + k], alpha);
    for (let k = 6; k < 11; k++) f[BALL_OFS + k] = b[BALL_OFS + k];
    // Still gliding to where a touch put it (MatchSession.glideBall): drawn short of it, never through the turf.
    const g = this.ballGlide;
    if (g.x !== 0 || g.y !== 0 || g.z !== 0) {
      f[BALL_OFS] += g.x;
      f[BALL_OFS + 1] = Math.max(BALL_R, f[BALL_OFS + 1] + g.y);
      f[BALL_OFS + 2] += g.z;
    }
    for (const pin of this.pinned) {
      // Stood still on his mark, facing the referee (the sim is already walking him to the free kick).
      const o = pin.i * PF;
      f[o] = pin.x;
      f[o + 1] = pin.z;
      f[o + 2] = 0;
      f[o + 3] = pin.facing;
      f[o + 7] = 0;
      if (f[o + 4] !== SENT_OFF_CODE && f[o + 4] !== PSTATE.dejected) f[o + 4] = PSTATE.move;
    }

    // The choreographed celebration takes over the scoring side's positions and poses (nothing in a replay).
    this.celeb.apply(f, dt, this.camPos.x, this.camPos.z);
    // A staged shot (the line-up, a substitution, the man of the match: game/showcase.ts) places and poses its cast
    // in the DRAWN frame only: the sim, its frames and the replays never see it.
    this.frameHook?.(f, dt);

    const pose = this.pose;
    this.charK = screenCharK();
    for (let i = 0; i < 22; i++) {
      const o = i * PF;
      const fb = this.players[i];
      fb.scaleK = this.charK;
      fb.group.position.set(f[o], 0, f[o + 1]);
      fb.group.rotation.y = -f[o + 3];
      pose.y = f[o + 2];
      // Sent off: the sim parks him beside his dugout; he just stands there, hands on head.
      pose.state = f[o + 4] === SENT_OFF_CODE ? PSTATE.dejected : f[o + 4];
      pose.sentOff = f[o + 4] === SENT_OFF_CODE;
      pose.stateT = f[o + 5];
      pose.runPhase = f[o + 6];
      pose.speed = f[o + 7];
      pose.kickT = f[o + 8];
      pose.kickLeg = f[o + 9];
      pose.lean = f[o + 10];
      pose.diveDir = f[o + 11];
      pose.headerT = f[o + 12];
      pose.celebrate = f[o + 13];
      pose.hasBall = f[o + 14] > 0.5;
      pose.keeper = i === 0 || i === 11;
      const bearing = Math.atan2(f[BALL_OFS + 2] - f[o + 1], f[BALL_OFS] - f[o]);
      // Model left is -z; our facing angle grows towards +z, so negate for "left positive". Someone held on a
      // mark for a close-up looks where he faces (at the referee), not at the ball.
      pose.look = this.isPinned(i) ? 0 : -wrapAngle(bearing - f[o + 3]);
      if (dt > 0) {
        const dF = wrapAngle(f[o + 3] - this.lastFacing[i]) / dt;
        this.turnRate[i] += (Math.max(-12, Math.min(12, -dF)) - this.turnRate[i]) * Math.min(1, dt * 8);
      }
      this.lastFacing[i] = f[o + 3];
      pose.turn = this.turnRate[i];
      // (dt 0: a cut, a replay starting, players reset: the new poses are shown as they are, no cross-fade.)
      pose.dt = dt;
      fb.pose(pose, time + i * 0.37);
    }
    if (this.ringsOn) this.updateTeamRings();
    if (this.shadowBudget !== null) this.updateShadowBudget();

    // Ball: position plus rolling rotation integrated from its velocity.
    const bx = f[BALL_OFS], by = f[BALL_OFS + 1], bz = f[BALL_OFS + 2];
    const vx = f[BALL_OFS + 3], vy = f[BALL_OFS + 4], vz = f[BALL_OFS + 5];
    this.ball.position.set(bx, by, bz);
    const sp = Math.hypot(vx, vz);
    if (sp > 0.05 && f[BALL_OFS + 6] < 0.5) {
      this.axis.set(vz, 0, -vx).normalize();
      this.tmpQ.setFromAxisAngle(this.axis, (sp / (BALL_R * 1.25)) * dt);
      this.ballQuat.premultiply(this.tmpQ);
      this.ball.quaternion.copy(this.ballQuat);
    }
    void vy;
    // Struck hard / off the woodwork: white and 1.25x for a moment (see flashBall).
    const flash = this.ballFlashT >= 0 && this.ballFlashT < BALL_FLASH_S;
    this.ball.scale.setScalar(flash ? ballFlashScale(this.ballFlashT) : 1);
    const want = flash ? this.flashMatBall() : this.ballHot ? this.hotMat! : charMaterial;
    if (this.ball.material !== want) this.ball.material = want;
    this.ball.visible = !this.ballHidden;
    this.ballShadow.position.set(bx, 0.02, bz);
    // Contact shadow straight under the ball: shrinks and fades with height so you can read it.
    const hs = Math.max(0.4, 1 - by * 0.1);
    this.ballShadow.scale.set(hs, hs, hs);
    (this.ballShadow.material as THREE.MeshBasicMaterial).opacity = 0.3 * Math.max(0.35, 1 - by * 0.08);
    this.ballShadow.visible = f[BALL_OFS + 6] < 0.5 && !this.ballHidden;

    // Marker on the human-controlled player.
    const active = f[BALL_OFS + 8];
    if (this.marker.visible !== false && active >= 0) {
      const o = active * PF;
      this.marker.position.set(f[o], 0, f[o + 1]);
      this.markerRing.rotation.y = -f[o + 3];
      const top = this.headTop;
      this.arrow.position.y = top + 0.5 + f[o + 2] + Math.abs(Math.sin(time * 5)) * 0.18;
      this.nameTag.position.y = top + 1.3 + f[o + 2];
      if (active !== this.nameFor) this.drawName(active);
    }
    if (this.roamHead) this.wearRoamHead(active);
    if (this.rivalRing) {
      const ri = this.rivalIdx;
      const on = ri >= 0 && this.marker.visible && this.markerMode !== 'off';
      this.rivalRing.visible = on;
      if (on) {
        const o = ri * PF;
        this.rivalRing.position.x = f[o];
        this.rivalRing.position.z = f[o + 1];
        this.rivalRing.rotation.y = -f[o + 3];
      }
    }
    const full = this.markerMode === 'full';
    this.arrow.visible = full && !this.charging;
    this.nameTag.visible = full;
    this.markerRing.visible = this.markerMode !== 'off';
    if (this.floodShadows?.visible) this.updateFloodShadows();
    const pt = f[BALL_OFS + 10];
    const human = active >= 0 ? (active < 11 ? 0 : 1) : -1;
    // (While a pass is being charged its own lock-on ring marks the man: never two rings.)
    if (this.marker.visible && !this.passing && pt >= 0 && pt !== active && (pt < 11 ? 0 : 1) === human) {
      this.targetRing.visible = true;
      this.targetRing.position.x = f[pt * PF];
      this.targetRing.position.z = f[pt * PF + 1];
      const pulse = 1 + Math.sin(time * 10) * 0.08;
      this.targetRing.scale.set(pulse, 1, pulse);
    } else {
      this.targetRing.visible = false;
    }
  }

  /** The roaming headgear on the controlled man of the human side (never doubled on the captain, who wears his own). */
  private wearRoamHead(active: number): void {
    const hs = this.humanSide_;
    const want = active >= 0 && (active < 11 ? 0 : 1) === hs && !this.players[active].hasHeadgear ? active : -1;
    if (want === this.roamFor) return;
    this.roamFor = want;
    const m = this.roamHead!;
    if (want >= 0) this.players[want].headAnchor.add(m);
    else m.removeFromParent();
  }

  /** Is player `i` held on a mark for a close-up (see pinPlayer)? */
  private isPinned(i: number): boolean {
    const pins = this.pinned;
    for (let k = 0; k < pins.length; k++) if (pins[k].i === i) return true;
    return false;
  }

  private flashMatBall(): THREE.MeshBasicMaterial {
    return (this.ballFlashMat ??= new THREE.MeshBasicMaterial({ color: 0xffffff }));
  }

  /** The ball struck hard (or off the woodwork): white and 1.25x for BALL_FLASH_S (render/juice.ts). */
  flashBall(): void {
    this.ballFlashT = 0;
  }

  /** Player `i` drawn white for the next `frames` rendered frames (a tackle, a foul, a save). */
  flashPlayer(i: number, frames: number): void {
    const fb = this.players[i];
    if (!fb || !(frames > 0)) return;
    this.flashLeft[i] = Math.max(this.flashLeft[i], Math.min(255, Math.round(frames)));
    fb.setFlash(true);
  }

  /**
   * Advance the hit flashes by one rendered frame (`dt` s): call once per frame BEFORE this frame's events, so a
   * flash set now is drawn white on exactly `frames` frames. (Runs through a hit-stop: the frozen picture is the
   * one that flashes.)
   */
  tickFlashes(dt: number): void {
    for (let i = 0; i < 22; i++) {
      const n = this.flashLeft[i];
      if (n === 0) continue;
      this.flashLeft[i] = n - 1;
      if (n - 1 === 0) this.players[i]?.setFlash(false);
    }
    if (this.ballFlashT >= 0) {
      this.ballFlashT += dt;
      if (this.ballFlashT >= BALL_FLASH_S) {
        this.ballFlashT = -1;
        this.ball.scale.setScalar(1);
        this.ball.material = this.ballHot ? this.hotMat! : charMaterial;
      }
    }
  }

  /** Frames of white left on player `i` (tests). */
  flashFrames(i: number): number {
    return this.flashLeft[i] ?? 0;
  }

  /**
   * Shadow budget (the medium / low settings): only the `n` players nearest the ball (and the ball, and on
   * medium the referee) cast a dynamic shadow; everyone else stands on a soft blob. null: everyone casts (high).
   */
  setShadowBudget(n: number | null): void {
    if (n === this.shadowBudget) return;
    this.shadowBudget = n;
    if (n === null) {
      for (const fb of this.players) fb.setCastShadow(true);
      this.referee.setCastShadow(true);
      if (this.blobs) this.blobs.visible = false;
      return;
    }
    if (!this.blobs) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x1e3312, transparent: true, opacity: BLOB_ALPHA, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      this.blobs = new THREE.InstancedMesh(new THREE.CircleGeometry(BLOB_R, 16).rotateX(-Math.PI / 2), mat, 23);
      this.blobs.frustumCulled = false;
      this.blobs.renderOrder = 1;
      this.m4.makeScale(0, 0, 0);
      for (let i = 0; i < 23; i++) this.blobs.setMatrixAt(i, this.m4);
      this.group.add(this.blobs);
    }
    this.blobs.visible = true;
    // (No shadow map at all on low: the referee gets a blob too.)
    this.referee.setCastShadow(n > 0);
    this.updateShadowBudget();
  }

  get shadowCasters(): number {
    let n = 0;
    for (const fb of this.players) if (fb.castsShadow) n++;
    return n;
  }

  private updateShadowBudget(): void {
    const n = this.shadowBudget;
    const blobs = this.blobs;
    if (n === null || !blobs) return;
    const f = this.frame;
    const bx = f[BALL_OFS];
    const bz = f[BALL_OFS + 2];
    const d = this.budgetD;
    for (let i = 0; i < 22; i++) {
      const o = i * PF;
      const fb = this.players[i];
      d[i] = f[o + 4] === SENT_OFF_CODE || fb.opacity < 0.5
        ? Infinity
        : Math.hypot(f[o] - bx, f[o + 1] - bz) - (fb.castsShadow ? BUDGET_STICKY : 0);
    }
    // The n nearest (selection: n passes over 22; marked by setting their distance to -1).
    for (let k = 0; k < n; k++) {
      let best = -1;
      let bd = Infinity;
      for (let i = 0; i < 22; i++) {
        if (d[i] >= 0 && d[i] < bd) {
          bd = d[i];
          best = i;
        }
      }
      if (best < 0) break;
      d[best] = -1;
    }
    const k = this.charK;
    this.q.identity();
    for (let i = 0; i < 22; i++) {
      const fb = this.players[i];
      const cast = d[i] === -1;
      fb.setCastShadow(cast);
      const o = i * PF;
      const s = cast || fb.opacity < 0.5 || !fb.group.visible ? 0 : k * Math.max(0.45, 1 - f[o + 2] * 0.35);
      this.m4.compose(this.v3.set(f[o], 0.025, f[o + 1]), this.q, this.s3.set(s, 1, s));
      blobs.setMatrixAt(i, this.m4);
    }
    blobs.instanceMatrix.needsUpdate = true;
  }

  /** The referee jogs a diagonal about 10 m from the ball and signals fouls. */
  updateReferee(dt: number, time: number, visible: boolean): void {
    const g = this.referee.group;
    g.visible = visible;
    if (!visible && this.blobs && this.shadowBudget === 0) {
      this.m4.makeScale(0, 0, 0);
      this.blobs.setMatrixAt(22, this.m4);
      this.blobs.instanceMatrix.needsUpdate = true;
    }
    if (!visible || dt <= 0) return;
    const f = this.frame;
    const bx = f[BALL_OFS];
    const bz = f[BALL_OFS + 2];
    const r = this.ref;
    r.hold = Math.max(0, r.hold - dt);
    const tx = Math.max(-44, Math.min(44, bx - 7));
    const tz = Math.max(-26, Math.min(26, bz > 0 ? bz - 11 : bz + 11));
    const dx = tx - r.x;
    const dz = tz - r.z;
    const d = Math.hypot(dx, dz);
    // Booking someone: he stands his ground, facing the offender, until the card goes away.
    const want = r.hold > 0 || d < 1.2 ? 0 : Math.min(7, d * 1.2);
    const k = Math.min(1, dt * 3);
    r.vx += ((d > 0 ? (dx / d) * want : 0) - r.vx) * k;
    r.vz += ((d > 0 ? (dz / d) * want : 0) - r.vz) * k;
    r.x += r.vx * dt;
    r.z += r.vz * dt;
    const sp = Math.hypot(r.vx, r.vz);
    const faceTo = r.hold > 0 ? Math.atan2(r.faceZ - r.z, r.faceX - r.x) : sp > 1.2 ? Math.atan2(r.vz, r.vx) : Math.atan2(bz - r.z, bx - r.x);
    r.facing += wrapAngle(faceTo - r.facing) * Math.min(1, dt * 6);
    r.phase = (r.phase + (sp * dt) / 2.1) % 1;
    r.signal = Math.max(0, r.signal - dt);
    g.position.set(r.x, 0, r.z);
    g.rotation.y = -r.facing;
    this.referee.scaleK = this.charK;
    if (this.blobs && this.shadowBudget === 0) {
      // (Low: no shadow map at all, so the referee stands on a blob like everyone else.)
      this.q.identity();
      this.m4.compose(this.v3.set(r.x, 0.025, r.z), this.q, this.s3.set(this.charK, 1, this.charK));
      this.blobs.setMatrixAt(22, this.m4);
      this.blobs.instanceMatrix.needsUpdate = true;
    }
    const booking = r.signal > 0 && r.kind === 'card';
    this.cards.yellow.visible = booking && this.cardColor === 'yellow';
    this.cards.red.visible = booking && this.cardColor === 'red';
    const pose = this.pose;
    pose.state = 0; pose.stateT = 0; pose.speed = sp; pose.runPhase = r.phase; pose.kickT = 0; pose.kickLeg = 1;
    pose.lean = Math.min(0.3, sp * 0.03); pose.diveDir = 0; pose.headerT = 0; pose.celebrate = 0; pose.y = 0;
    pose.keeper = false; pose.hasBall = false; pose.turn = 0; pose.dt = dt;
    pose.look = -wrapAngle(Math.atan2(bz - r.z, bx - r.x) - r.facing);
    pose.signal = r.signal > 0;
    pose.signalKind = r.kind === 'advantage' ? 1 : r.kind === 'card' ? 2 : r.kind === 'spot' ? 3 : 0;
    this.referee.pose(pose, time);
    pose.signal = false;
    pose.signalKind = 0;
  }

  private cardColor: 'yellow' | 'red' = 'yellow';

  /** Arm signal for a foul / offside (or advantage: both arms forward) for `seconds`. */
  refSignal(seconds: number, kind: RefSignal = 'arm'): void {
    // A card being shown outranks a quick arm signal.
    if (this.ref.kind === 'card' && this.ref.signal > 0 && kind !== 'card') return;
    this.ref.signal = seconds;
    this.ref.kind = kind;
  }

  /** A penalty: he stops, turns to the spot (x, z) and points at it for `seconds` (a card still outranks it). */
  refPoint(seconds: number, x: number, z: number): void {
    const r = this.ref;
    if (r.kind === 'card' && r.signal > 0) return;
    this.refSignal(seconds, 'spot');
    r.hold = seconds;
    r.faceX = x;
    r.faceZ = z;
  }

  /**
   * Book a player: the referee stands ~2.4 m from the offence (x, z), faces it and holds the card up for
   * `seconds`. He is moved there directly: this is only called as the camera cuts to the close-up.
   */
  showCard(color: 'yellow' | 'red', x: number, z: number, seconds: number, jump = true): void {
    const r = this.ref;
    this.cardColor = color;
    this.refSignal(seconds, 'card');
    r.hold = seconds;
    r.faceX = x;
    r.faceZ = z;
    if (jump) {
      let dx = r.x - x;
      let dz = r.z - z;
      const d = Math.hypot(dx, dz) || 1;
      dx /= d;
      dz /= d;
      r.x = Math.max(-51, Math.min(51, x + dx * 2.4));
      r.z = Math.max(-33, Math.min(33, z + dz * 2.4));
      r.vx = r.vz = 0;
      r.facing = Math.atan2(z - r.z, x - r.x);
    }
  }

  /**
   * Hold player `i` on (x, z) facing the referee for a close-up (render only: the camera cuts away before he
   * is let go, so the jump to where the sim has walked him is never seen). null lets him go.
   */
  pinPlayer(i: number | null, x = 0, z = 0): void {
    if (i === null || i < 0) {
      this.pinned = [];
      return;
    }
    const r = this.ref;
    this.pinned = this.pinned.filter((p) => p.i !== i);
    this.pinned.push({ i, x, z, facing: Math.atan2(r.z - z, r.x - x) });
  }

  /** Blitz mega ball: red-hot (its own unlit red-orange material) or back to the normal ball. */
  setBallHot(on: boolean): void {
    if (on === this.ballHot) return;
    this.ballHot = on;
    if (on && !this.hotMat) this.hotMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xff4a1a });
    if (this.ballFlashT < 0) this.ball.material = on ? this.hotMat! : charMaterial;
  }

  /** Blitz: a colour cast over player `i` (an ice-blue tint on a frozen side), null for none. */
  tintPlayer(i: number, color: number | null): void {
    this.players[i]?.setTint(color);
  }

  /** Keep the ball out of shot (a low close-up it would sit right in front of), or show it again. */
  setBallHidden(hidden: boolean): void {
    this.ballHidden = hidden;
    this.ball.visible = !hidden;
    if (hidden) this.ballShadow.visible = false;
  }

  /** Where the referee stands and whom he faces (card close-ups). */
  /** (The same object every call: read it at once.) */
  get refState(): { x: number; z: number; faceX: number; faceZ: number; booking: boolean } {
    const r = this.ref;
    const o = this.refState_;
    o.x = r.x;
    o.z = r.z;
    o.faceX = r.faceX;
    o.faceZ = r.faceZ;
    o.booking = r.kind === 'card' && r.signal > 0;
    return o;
  }

  /**
   * Low lenses: players within `radius` (ground metres) of the lens at (cx, cz), or standing within `sightW`
   * of the sight line from it to any of `sight`, fade to `alpha` (back to solid over the next metre / half
   * metre); `keep` (the taker, the offender) never fade. `latch` (a short, static close-up): anyone who
   * starts to fade goes all the way and stays gone until clearFades(), so no ghost lingers at the edge.
   * Fading right out (`alpha` 0) is all or nothing, eased over ~0.15 s of `dt` (at once when `snap`: the
   * camera has just cut), so nobody stands about half see-through at the edge of the zone.
   */
  fadeNearLens(
    cx: number, cz: number, radius: number, alpha: number, keep: number[], sight: { x: number; z: number }[], sightW = 0.85, latch = false,
    dt = 0, snap = true,
  ): void {
    const f = this.frame;
    const set = (fb: Footballer, a: number) => {
      if (alpha > 0 || snap) fb.setOpacity(a);
      else if (dt > 0) fb.setOpacity(fb.opacity + (a - fb.opacity) * Math.min(1, dt * 7));
    };
    for (let i = 0; i < 22; i++) {
      const fb = this.players[i];
      if (keep.includes(i)) {
        set(fb, 1);
        continue;
      }
      if (latch && this.fadeLatch.has(i)) {
        set(fb, alpha);
        continue;
      }
      const x = f[i * PF];
      const z = f[i * PF + 1];
      const dc = Math.hypot(x - cx, z - cz);
      // Full fade inside the radius, back to solid over the next metre; right at the lens nearly gone.
      let k = dc <= radius ? 0 : Math.min(1, (dc - radius) / 1);
      if (dc < radius * 0.5) {
        if (latch) this.fadeLatch.add(i);
        // (`alpha` is the floor: a replay's goal-line lens never takes anyone below it.)
        set(fb, alpha);
        continue;
      }
      for (const t of sight) {
        const lx = t.x - cx;
        const lz = t.z - cz;
        const l2 = lx * lx + lz * lz || 1;
        const u = ((x - cx) * lx + (z - cz) * lz) / l2;
        if (u < 0.02 || u > 0.97) continue;
        const d = Math.hypot(x - (cx + lx * u), z - (cz + lz * u));
        k = Math.min(k, clamp01((d - sightW) / 0.5));
      }
      if (latch && k < 0.999) {
        this.fadeLatch.add(i);
        k = 0;
      }
      set(fb, alpha > 0 ? alpha + (1 - alpha) * k : k < 0.5 ? 0 : 1);
    }
  }

  /**
   * A replay's close look at two men in a crowd: everyone but `keep` standing within `radius` of (cx, cz) is
   * dimmed to `alpha`, back to solid over the next 2 m, so the contact is not lost among the bodies round it.
   * Anyone standing between the lens (lx, lz) and the pair, or right in front of the lens, is taken out of the
   * picture altogether: a see-through body filling the foreground hides the contact as well as a solid one.
   */
  dimAround(cx: number, cz: number, radius: number, alpha: number, keep: readonly number[], lx = cx, lz = cz): void {
    const f = this.frame;
    const sx = cx - lx;
    const sz = cz - lz;
    const sl = Math.hypot(sx, sz);
    for (let i = 0; i < 22; i++) {
      const fb = this.players[i];
      if (keep.includes(i)) {
        if (fb.opacity < 1) fb.setOpacity(1);
        continue;
      }
      const x = f[i * PF];
      const z = f[i * PF + 1];
      if (sl > 1) {
        const along = ((x - lx) * sx + (z - lz) * sz) / sl;
        const off = Math.abs((x - lx) * sz - (z - lz) * sx) / sl;
        if (along > -1 && along < sl - 0.6 && off < 0.9 + (1 - along / sl) * 1.6) {
          fb.setOpacity(0);
          continue;
        }
      }
      const d = Math.hypot(x - cx, z - cz);
      fb.setOpacity(d <= radius ? alpha : Math.min(1, alpha + ((1 - alpha) * (d - radius)) / 2));
    }
  }

  private marks: IncidentMarks | null = null;

  /** What an incident replay draws on the lawn (rings under the two men, the offside line); made on first use. */
  get incidentMarks(): IncidentMarks {
    return this.marks ??= new IncidentMarks(this.group);
  }

  /** Everyone solid again (the low camera has cut away). */
  clearFades(): void {
    this.fadeLatch.clear();
    for (const fb of this.players) if (fb.opacity < 1) fb.setOpacity(1);
  }

  /** Top of a standing player's head (m) at the current draw scale. */
  get headTop(): number {
    return CHAR_H * this.charK;
  }

  /** Swap the model for a substitute coming on (a no-op if that player is already drawn). */
  replacePlayer(i: number, def: PlayerDef, kit: Kit): void {
    const old = this.players[i];
    if (!old || old.def === def) return;
    const f = new Footballer(def, kit, i === 0 || i === 11);
    if (this.roamFor === i) {
      this.roamHead?.removeFromParent();
      this.roamFor = -1;
    }
    f.group.position.copy(old.group.position);
    f.group.rotation.copy(old.group.rotation);
    old.dispose();
    this.players[i] = f;
    this.group.add(f.group);
    this.names[i] = def.name.split('. ').pop()!.toUpperCase();
    if (this.nameFor === i) this.nameFor = -1;
  }

  /**
   * The penalty aim reticle: a pixel ring and crosshair standing on the goal plane at x = `gx`, `h` up and `z`
   * across (Match.penAim), drawn over everything and pulsing while he aims; once `locked` (SHOOT let go) it
   * holds still, a touch smaller, until the ball is struck. Null hides it.
   */
  setPenAim(aim: { gx: number; z: number; h: number; locked: boolean } | null): void {
    if (!aim) {
      if (this.reticle) this.reticle.visible = false;
      return;
    }
    const r = (this.reticle ??= this.makeReticle());
    r.visible = true;
    r.position.set(aim.gx, aim.h, aim.z);
    // (Its face turned out of the goal, towards the spot.)
    r.rotation.y = aim.gx > 0 ? -Math.PI / 2 : Math.PI / 2;
    const beat = Math.sin(this.clock * Math.PI * 2 * RETICLE_HZ);
    r.scale.setScalar(aim.locked ? RETICLE_LOCKED : 1 + RETICLE_PULSE * beat);
    (r.material as THREE.MeshBasicMaterial).opacity = aim.locked ? 1 : 0.86 + 0.14 * beat;
  }

  private reticle: THREE.Mesh | null = null;

  /** The reticle's pixels (RETICLE_ART, a dark outline round the yellow, the centre pixel white) as one flat mesh. */
  private makeReticle(): THREE.Mesh {
    const n = RETICLE_ART.length;
    const half = (n - 1) / 2;
    const on = (i: number, j: number) => i >= 0 && j >= 0 && i < n && j < n && RETICLE_ART[j][i] !== '.';
    const pos: number[] = [];
    const col: number[] = [];
    const c = new THREE.Color();
    const quad = (i: number, j: number, hex: number, grow: number) => {
      const x = (i - half) * RETICLE_PX;
      const y = (half - j) * RETICLE_PX;
      const s = (RETICLE_PX * grow) / 2;
      pos.push(x - s, y - s, 0, x + s, y - s, 0, x + s, y + s, 0, x - s, y - s, 0, x + s, y + s, 0, x - s, y + s, 0);
      c.setHex(hex);
      for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
    };
    // The outline first (drawn under), then the pixels.
    for (let j = -1; j <= n; j++) {
      for (let i = -1; i <= n; i++) {
        if (on(i, j)) continue;
        let near = false;
        for (let dj = -1; dj <= 1 && !near; dj++) for (let di = -1; di <= 1 && !near; di++) near = on(i + di, j + dj);
        if (near) quad(i, j, RETICLE_EDGE, 1.02);
      }
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) if (on(i, j)) quad(i, j, RETICLE_ART[j][i] === 'o' ? RETICLE_CORE : RETICLE_FILL, 1.02);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const m = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide }),
    );
    m.renderOrder = 12;
    m.frustumCulled = false;
    m.visible = false;
    this.group.add(m);
    return m;
  }

  /** Show the set-piece aim arrow from (x, z) along `angle` (radians, world facing). */
  setAim(on: boolean, x = 0, z = 0, angle = 0, length = 1): void {
    this.aim.visible = on;
    if (!on) return;
    this.aim.position.x = x;
    this.aim.position.z = z;
    this.aim.rotation.y = -angle;
    this.aim.scale.x = length;
  }

  setMarkerVisible(v: boolean): void {
    this.marker.visible = v;
    if (!v) this.targetRing.visible = false;
  }

  /**
   * Online: mark the man the other player controls (-1: nobody) with a square ring like ours in a light red, no
   * arrow or name: you can see who you're up against without mistaking him for yours. Drawn with the marker
   * (hidden with it, and under the low lenses when ours is ring-only).
   */
  setRival(idx: number): void {
    if (idx >= 0 && !this.rivalRing) {
      const b = new BoxBuilder();
      const r = 0.58, t = 0.08, c = 0xff6b5e;
      b.box(0, 0, -r, r * 2 + t, 0.03, t, c);
      b.box(0, 0, r, r * 2 + t, 0.03, t, c);
      b.box(-r, 0, 0, t, 0.03, r * 2, c);
      b.box(r, 0, 0, t, 0.03, r * 2, c);
      this.rivalRing = new THREE.Mesh(b.build(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true }));
      this.rivalRing.renderOrder = MARKER_ORDER;
      this.rivalRing.position.y = 0.035;
      this.group.add(this.rivalRing);
    }
    this.rivalIdx = idx;
  }

  /**
   * Low cameras (behind-the-ball set pieces, shootout) keep only the ground ring: no tag or arrow over the
   * goal; the card close-up shows no marker at all.
   */
  setMarkerMode(mode: MarkerMode): void {
    this.markerMode = mode;
    this.arrow.visible = mode === 'full' && !this.charging;
    this.nameTag.visible = mode === 'full';
    this.markerRing.visible = mode !== 'off';
  }

  /** Team rings under the outfield players: on for the broadcast shot, off for close-ups and replays. */

  /** The ball's look (a progression unlock; an unknown id is the classic ball). Geometries are cached per skin. */
  setBallSkin(id: string | undefined): void {
    this.ball.geometry = buildBallGeometry(BALL_R * 1.25, ballSkinOf(id));
  }

  setTeamRings(on: boolean): void {
    if (on === this.ringsOn) return;
    this.ringsOn = on;
    for (const r of this.ringSets) r.mesh.visible = on;
    if (on) this.updateTeamRings();
  }

  /** Team pips over the human's team-mates: the broadcast shot only (never over a close or low lens). */
  setTeamPips(on: boolean): void {
    this.pipsOn = on && !!this.pipFill;
    if (this.pipFill) this.pipFill.visible = this.pipsOn;
    if (this.pipEdge) this.pipEdge.visible = this.pipsOn;
  }

  private updateTeamRings(): void {
    const f = this.frame;
    const k = this.charK;
    // (No team ring under the man the human controls: his yellow marker is the one ring there.)
    const active = this.marker.visible ? f[BALL_OFS + 8] : -1;
    this.q.identity();
    for (let r = 0; r < this.ringSets.length; r++) {
      const { mesh, idx } = this.ringSets[r];
      for (let n = 0; n < idx.length; n++) {
        const i = idx[n];
        const o = i * PF;
        // Shrinks away under a jump; gone for a player sent off (parked by his dugout) or faded out of a lens.
        const gone = i === active || f[o + 4] === SENT_OFF_CODE || this.players[i].opacity < 0.5;
        // (The pass-preview ring takes over from his team ring as it fades in: one ring under him, never two.)
        const s = gone ? 0 : k * Math.max(0.5, 1 - f[o + 2] * 0.5) * (1 - this.previewW[i]);
        this.m4.compose(this.v3.set(f[o], 0.03, f[o + 1]), this.q, this.s3.set(s, 1, s));
        mesh.setMatrixAt(n, this.m4);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Pips over the human's team-mates, facing the lens: not over the man he controls (he has the marker), a
   * player sent off or faded out of shot. The team-mate a charging pass is locked onto gets a white one.
   */
  private updateTeamPips(cam: THREE.Camera): void {
    const fill = this.pipFill;
    const edge = this.pipEdge;
    if (!fill || !edge || !this.pipsOn) return;
    const f = this.frame;
    const active = f[BALL_OFS + 8];
    const k = this.charK;
    const top = this.headTop + PIP_UP * k;
    let dirty = false;
    for (let n = 0; n < this.pipIdx.length; n++) {
      const i = this.pipIdx[n];
      const o = i * PF;
      const hide = i === active || f[o + 4] === SENT_OFF_CODE || this.players[i].opacity < 0.5;
      const aimed = i === this.passAimIdx && this.passing;
      // Lit white (and bigger) for the charging pass's lock-on, or as much as the pass preview has faded in.
      const w = aimed ? 1 : this.previewW[i];
      const s = hide ? 0 : k * (aimed ? 1.3 : 1 + PREVIEW_PIP_K * w);
      this.m4.compose(this.v3.set(f[o], top + f[o + 2] + (aimed ? 0 : 0.12 * w * k), f[o + 1]), cam.quaternion, this.s3.set(s, s, s));
      fill.setMatrixAt(n, this.m4);
      edge.setMatrixAt(n, this.m4);
      fill.getColorAt(n, this.tmpC);
      const cur = this.tmpC.getHex();
      const next = w <= 0 ? this.pipColor.getHex() : w >= 1 ? PASS_WHITE : this.tmpC.copy(this.pipColor).lerp(this.white, w).getHex();
      if (cur !== next) {
        fill.setColorAt(n, this.tmpC.setHex(next));
        dirty = true;
      }
    }
    fill.instanceMatrix.needsUpdate = true;
    edge.instanceMatrix.needsUpdate = true;
    if (dirty) fill.instanceColor!.needsUpdate = true;
  }

  /**
   * Night adds faint floodlight shadows (one per light tower: the corner masts, or a small ground's portable
   * lamps; all of them together darken the grass under a player by ~25% at most) and a camera-side fill on
   * the players, so they read as lit figures on the bright floodlit lawn rather than dark silhouettes.
   */
  setTimeOfDay(t: 'day' | 'sunset' | 'night', towers: readonly { x: number; z: number; h: number }[] = FLOODLIGHT_TOWERS): void {
    const night = t === 'night';
    this.towers = towers;
    setCharacterFill(night ? NIGHT_CHAR_FILL : 0);
    setCharacterHemiFill(t === 'sunset' ? SUNSET_CHAR_HEMI : 0);
    // Premium kits' glowing trim lights up under the floodlights (render/kitDesigns.ts FX.glow).
    setKitGlow(night ? 1 : t === 'sunset' ? 0.35 : 0);
    if (night && !this.floodShadows) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d')!;
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.55, 'rgba(255,255,255,0.55)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      const tex = new THREE.CanvasTexture(c);
      const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x0c1428, alphaMap: tex, transparent: true, opacity: 0.25 / Math.max(1, towers.length), depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      this.floodShadows = new THREE.InstancedMesh(geo, mat, 22 * towers.length);
      this.floodShadows.frustumCulled = false;
      this.floodShadows.renderOrder = 1;
      this.group.add(this.floodShadows);
    }
    if (this.floodShadows) this.floodShadows.visible = night;
  }

  private updateFloodShadows(): void {
    const im = this.floodShadows!;
    const f = this.frame;
    let n = 0;
    for (let i = 0; i < 22; i++) {
      const o = i * PF;
      const x = f[o];
      const z = f[o + 1];
      const lift = Math.max(0, 1 - f[o + 2] * 0.6);
      for (const t of this.towers) {
        const dx = x - t.x;
        const dz = z - t.z;
        const d = Math.hypot(dx, dz) || 1;
        // A 2 m player under a ~28 m mast: long, soft, faint shadows pointing away from each tower.
        const len = Math.min(2.8, Math.max(1.2, (1.6 * d) / t.h));
        const ux = dx / d;
        const uz = dz / d;
        this.q.setFromAxisAngle(this.up, Math.atan2(-uz, ux));
        const s = lift;
        this.m4.compose(
          this.v3.set(x + ux * len * 0.45, 0.03, z + uz * len * 0.45),
          this.q,
          this.s3.set(len * s, 1, 0.62 * s),
        );
        im.setMatrixAt(n++, this.m4);
      }
    }
    im.instanceMatrix.needsUpdate = true;
  }

  private drawName(idx: number): void {
    this.nameFor = idx;
    const c = this.nameCanvas;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    const name = this.names[idx] ?? '';
    g.font = '400 45px "Lilita One", "Arial Rounded MT Bold", sans-serif';
    const w = Math.min(c.width - 12, g.measureText(name).width + 33);
    const x = (c.width - w) / 2;
    g.fillStyle = 'rgba(38,38,46,0.82)';
    g.fillRect(x, 9, w, 54);
    g.fillStyle = '#ffd23a';
    g.fillRect(x, 57, w, 6);
    g.fillStyle = '#fbfbf4';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(name, c.width / 2, 37.5, c.width - 24);
    this.nameTex.needsUpdate = true;
  }

  /**
   * Shot power bar for the shooter at (x, z) (height y), or hidden (null). Normally just over his head,
   * where the (hidden) arrow bobs; `low` (the over-the-shoulder set-piece lens, where over his head is the
   * goal mouth) puts it at his feet instead, a little smaller and on the lens side of his boots.
   */
  setPower(p: number | null, x: number, z: number, y = 0, low = false): void {
    if (p === null || p <= 0) {
      this.powerBar.visible = false;
      this.charging = false;
      return;
    }
    this.charging = true;
    this.powerBar.visible = true;
    this.powerLow = low;
    this.powerAt.set(x, low ? 0.12 : this.headTop + 0.5 + y, z);
    this.powerBar.position.copy(this.powerAt);
    this.powerBar.scale.setScalar(low ? 0.7 : 1);
    this.powerFill.scale.x = Math.max(0.02, p);
    const m = this.powerFill.material as THREE.MeshBasicMaterial;
    m.color.setHex(p < 0.6 ? 0x3aff9e : p < 0.85 ? 0xffd23a : 0xff4a3a);
  }

  /**
   * Pass charging: `p` 0..1 (null: not charging, and everything goes at once) for the passer at (x, z); the
   * recipient he is locked onto at (rx, rz) gets the ring and the arrow (rx null: nobody locked on yet, just
   * the bar). `low`: the over-the-shoulder set-piece lens (the bar sits a little smaller there).
   */
  setPassCharge(p: number | null, x = 0, z = 0, rx: number | null = null, rz = 0, low = false, aimIdx = -1): void {
    this.passAimIdx = p === null || !(p >= 0) ? -1 : aimIdx;
    if (p === null || !(p >= 0)) {
      if (this.passing) {
        this.passing = false;
        this.passBar.visible = false;
        this.passRing.visible = false;
        this.passArrow.visible = false;
      }
      return;
    }
    this.passing = true;
    this.targetRing.visible = false;
    const k = Math.min(1, p);
    this.passBar.visible = true;
    this.passAt.set(x, 0.12, z);
    this.passBar.scale.setScalar((low ? 0.7 : 0.9) * this.charK);
    this.passFill.scale.x = Math.max(0.02, k);
    (this.passFill.material as THREE.MeshBasicMaterial).color.setHex(k < 0.6 ? PASS_TEAL : k < 0.85 ? PASS_LIGHT : PASS_WHITE);
    const on = rx !== null;
    this.passRing.visible = on;
    this.passArrow.visible = on;
    if (!on) return;
    // A quick, bright pulse (scale and opacity) so the eye finds him at once.
    const pulse = 0.5 + 0.5 * Math.sin(this.clock * 11);
    this.passRing.position.set(rx, 0.05, rz);
    this.passRing.scale.setScalar(this.charK * (1 + pulse * 0.14));
    for (const m of this.passRing.children) {
      const mat = (m as THREE.Mesh).material as THREE.MeshBasicMaterial;
      mat.opacity = 0.72 + pulse * 0.26;
    }
    const dx = rx - x;
    const dz = rz - z;
    const dist = Math.hypot(dx, dz);
    const len = Math.max(0, Math.min(PASS_ARROW_MAX, dist - PASS_ARROW_FROM - PASS_ARROW_SHORT));
    if (len < 0.5) {
      this.passArrow.visible = false;
      return;
    }
    const ux = dx / dist;
    const uz = dz / dist;
    this.passArrow.position.set(x + ux * PASS_ARROW_FROM, 0.06, z + uz * PASS_ARROW_FROM);
    this.passArrow.rotation.y = -Math.atan2(dz, dx);
    // Shaft up to the head (1.05 m long), the head at its tip.
    const shaft = Math.max(0.05, len - 1.05);
    this.passShaft.scale.set(shaft, 1, 1);
    this.passHead.position.x = shaft;
  }

  /**
   * Pass-target preview, every frame while it may show (see PREVIEW_FADE_S): `pass` / `through` are who a
   * PASS / THROUGH pressed now would go to (-1: nobody; the highlight fades off), `ax, az` where the through
   * ball's dashed ring stands (the space ahead of that runner). `snap`: gone at once (the charge visuals take
   * over, or the shot has cut away).
   */
  setPassPreview(pass: number, through: number, ax: number, az: number, dt: number, snap = false): void {
    const f = this.frame;
    const rate = dt / PREVIEW_FADE_S;
    const k = this.charK;
    for (const i of this.pipIdx) {
      const o = i * PF;
      const gone = f[o + 4] === SENT_OFF_CODE;
      // Pass: the calm ring at his feet.
      const wp = snap || gone ? 0 : clamp01(this.previewW[i] + clamp01(i === pass ? 1 : 0) * rate * 2 - rate);
      this.previewW[i] = wp;
      let ring = this.previewRings[i];
      if (wp > 0.004 && !ring) ring = this.previewRings[i] = this.makePreviewRing();
      if (ring) {
        ring.visible = wp > 0.004;
        if (ring.visible) {
          ring.position.set(f[o], 0.05, f[o + 1]);
          // (Grows in a touch as it fades in: the eye catches the new target.)
          ring.scale.setScalar(k * (0.86 + 0.14 * wp));
          const [edge, fill] = ring.children as THREE.Mesh[];
          (edge.material as THREE.MeshBasicMaterial).opacity = 0.95 * wp;
          (fill.material as THREE.MeshBasicMaterial).opacity = 0.9 * wp;
        }
      }
      // Through: the dashed ring out ahead of him (eased after the runner; placed at once as it appears).
      const wt = snap || gone ? 0 : clamp01(this.throughW[i] + (i === through ? 1 : 0) * rate * 2 - rate);
      if (i === through && this.throughW[i] <= 0.004) {
        this.throughAt[i * 2] = ax;
        this.throughAt[i * 2 + 1] = az;
      } else if (i === through && dt > 0) {
        const e = Math.min(1, dt * 12);
        this.throughAt[i * 2] += (ax - this.throughAt[i * 2]) * e;
        this.throughAt[i * 2 + 1] += (az - this.throughAt[i * 2 + 1]) * e;
      }
      this.throughW[i] = wt;
      let tr = this.throughRings[i];
      if (wt > 0.004 && !tr) tr = this.throughRings[i] = this.makeThroughRing();
      if (tr) {
        tr.visible = wt > 0.004;
        if (tr.visible) {
          tr.position.set(this.throughAt[i * 2], 0.05, this.throughAt[i * 2 + 1]);
          tr.scale.setScalar(k * (0.8 + 0.2 * wt));
          (tr.material as THREE.MeshBasicMaterial).opacity = THROUGH_ALPHA * wt;
        }
      }
    }
  }

  /** How much of the PASS preview highlight player `i` wears right now (0..1; the HUD's edge arrows match it). */
  previewWeight(i: number): number {
    return i >= 0 && i < 22 ? this.previewW[i] : 0;
  }

  /** ...and of the THROUGH preview. */
  throughWeight(i: number): number {
    return i >= 0 && i < 22 ? this.throughW[i] : 0;
  }


  private landingRing: THREE.Group | null = null;
  /**
   * Where an airborne ball will come down (the human side's lobs, crosses and clearances): a ring on the spot,
   * so the receiver can see where to be. Off when `on` is false. `pulse` is a clock for the gentle throb.
   */
  setLanding(on: boolean, x = 0, z = 0, pulse = 0, locked = false): void {
    if (!on) {
      if (this.landingRing) this.landingRing.visible = false;
      return;
    }
    if (!this.landingRing) {
      const mat = (color: number, opacity: number) =>
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, fog: false });
      const g = new THREE.Group();
      const edge = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.15, 32).rotateX(-Math.PI / 2), mat(PASS_WHITE, 0.85));
      const fill = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.8, 32).rotateX(-Math.PI / 2), mat(PASS_TEAL, 0.7));
      edge.renderOrder = 8;
      fill.renderOrder = 8;
      g.add(edge, fill);
      this.group.add(g);
      this.landingRing = g;
    }
    this.landingRing.visible = true;
    this.landingRing.position.set(x, 0.03, z);
    // (`locked`: his man is locked onto this ball in the air, the sim's aerial lock: the spot he meets it at, its inner
    // ring gold, bigger and beating faster.)
    const k = locked ? 1.25 + 0.16 * Math.sin(pulse * 16) : 1 + 0.1 * Math.sin(pulse * 9);
    this.landingRing.scale.set(k, 1, k);
    const fill = this.landingRing.children[1] as THREE.Mesh | undefined;
    const fm = fill?.material as THREE.MeshBasicMaterial | undefined;
    if (fm && this.landingLocked !== locked) {
      this.landingLocked = locked;
      fm.color.setHex(locked ? LANDING_LOCKED : PASS_TEAL);
      fm.opacity = locked ? 0.95 : 0.7;
    }
  }

  private landingLocked = false;

  private makePreviewRing(): THREE.Group {
    const mat = (color: number) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false });
    const g = new THREE.Group();
    // (Colour-blind: the white edge notched at the four compass points, so it reads apart from any team ring.)
    const edgeGeo = this.colorblind
      ? arcRing(PREVIEW_EDGE_IN, PREVIEW_EDGE_OUT + 0.04, CB_NOTCHES, 0.78, Math.PI / 4)
      : new THREE.RingGeometry(PREVIEW_EDGE_IN, PREVIEW_EDGE_OUT, 32).rotateX(-Math.PI / 2);
    const edge = new THREE.Mesh(edgeGeo, mat(PASS_WHITE));
    const fill = new THREE.Mesh(new THREE.RingGeometry(PREVIEW_RING_IN, PREVIEW_RING_OUT, 32).rotateX(-Math.PI / 2), mat(PASS_TEAL));
    edge.renderOrder = 8;
    fill.renderOrder = 8;
    g.add(edge, fill);
    g.visible = false;
    this.group.add(g);
    return g;
  }

  private makeThroughRing(): THREE.Mesh {
    // THROUGH_DASHES short arcs round a circle: a "space here" marker, lighter than the pass ring.
    const b = new BoxBuilder();
    const len = ((Math.PI * 2 * THROUGH_R) / THROUGH_DASHES) * 0.55;
    for (let d = 0; d < THROUGH_DASHES; d++) {
      const a = (d / THROUGH_DASHES) * Math.PI * 2;
      // (Each dash along the circle's tangent there.)
      b.box(Math.cos(a) * THROUGH_R, 0, Math.sin(a) * THROUGH_R, len, 0.02, 0.12, PASS_LIGHT, { rotY: -(a + Math.PI / 2) });
    }
    const m = new THREE.Mesh(
      b.build(),
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false }),
    );
    m.renderOrder = 8;
    m.visible = false;
    this.group.add(m);
    return m;
  }

  faceCamera(cam: THREE.Camera): void {
    this.camPos.copy(cam.position);
    this.powerBar.quaternion.copy(cam.quaternion);
    this.updateTeamPips(cam);
    if (this.passBar.visible) {
      // At his feet, stepped towards the lens along the ground so it sits just under his boots on screen.
      this.passBar.quaternion.copy(cam.quaternion);
      const dx = cam.position.x - this.passAt.x;
      const dz = cam.position.z - this.passAt.z;
      const d = Math.hypot(dx, dz) || 1;
      const step = 0.95 * this.charK;
      this.passBar.position.set(this.passAt.x + (dx / d) * step, this.passAt.y, this.passAt.z + (dz / d) * step);
    }
    if (this.powerLow && this.powerBar.visible) {
      // At his feet: stepped 0.9 m towards the lens along the ground, so it sits just under his boots on
      // screen rather than across them.
      const dx = cam.position.x - this.powerAt.x;
      const dz = cam.position.z - this.powerAt.z;
      const d = Math.hypot(dx, dz) || 1;
      this.powerBar.position.set(this.powerAt.x + (dx / d) * 0.9, this.powerAt.y, this.powerAt.z + (dz / d) * 0.9);
    }
  }

  dispose(): void {
    this.marks?.dispose();
    this.marks = null;
    this.group.removeFromParent();
  }
}
