import * as THREE from 'three';
import { clamp, lerp, smoothstep, wrapAngle } from '../core/math';
import { grassLike } from '../meta/data';
import type { Kit, Look, PlayerDef } from '../sim/types';
import { HAIR, SKIN, shade } from './palette';
import { meshVoxels, VoxelGrid } from './voxel';

export const VU = 0.075; // metres per character voxel

// Model space: forward = +x, up = +y, right = +z.
// Crossy Road proportions: a big cube head on a short, chunky body (legs 5 / torso 7 / head 9 voxels,
// so the head is ~43% of the height, ~45% with hair).
const LEG_H = 5;
const TORSO_H = 7;
const TORSO_W = 8;
const TORSO_D = 5;
const HEAD = 9;
const ARM_L = 5;
/** Shorts rows at the bottom of the torso (the top of each leg is shorts too). */
const SHORTS = 2;
const HIP_Y = LEG_H * VU;
/** Characters are drawn a little larger than their physics footprint so they read at broadcast distance. */
export const CHAR_SCALE = 1.15;
/** Standing height (boots to the top of the hair) at CHAR_SCALE, metres. */
export const CHAR_H = (LEG_H + TORSO_H + HEAD + 1) * VU * CHAR_SCALE;
/** Hand position in an arm's local space (the arm hangs down -y from the shoulder). */
export const HAND_Y = -ARM_L * VU;

/**
 * Extra scale for small (phone landscape) screens: the broadcast camera keeps a wide shot there, so the
 * players are drawn bigger instead (1.3 below 450 px tall, 1.22 below 560, desktop unchanged).
 */
export function screenCharK(): number {
  const h = typeof window !== 'undefined' ? window.innerHeight : 720;
  return h < 450 ? 1.3 / CHAR_SCALE : h < 560 ? 1.22 / CHAR_SCALE : 1;
}

// 3x5 pixel digits for shirt numbers, rows top to bottom.
const DIGITS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '011', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
};

/**
 * Fill light for the footballers (and the ball) only, linear RGB, already divided by pi like a light's
 * irradiance: a soft "headlight" from the camera (faces turned to the lens get it all, side faces a third),
 * so at night the players read against the floodlit lawn instead of going muddy. Off (black) by day.
 */
const charFill = { value: new THREE.Color(0, 0, 0) };
/**
 * Neutral hemisphere fill for the footballers only (a white sky over a mid-grey ground), same units as
 * charFill: tops of heads and shoulders get it all, sides 75%, undersides 50%. Sunset uses it so shirts and
 * faces keep their true colours under the orange key instead of going orange-brown. Off (black) otherwise.
 */
const charHemi = { value: new THREE.Color(0, 0, 0) };
/**
 * White balance on the light the footballers (and the ball) take from the key and the sky: (1, 1, 1) by day
 * and at night; at sunset it takes most of the orange out of it, so a white kit stays white (never peach
 * beside a gold one) while the lawn and the stands keep the golden light. See setCharacterWhiteBalance.
 */
const charWB = { value: new THREE.Color(1, 1, 1) };

/** Vertex-coloured Lambert (like voxelMaterial) plus the camera-side and sky character fills. */
function makeCharMaterial(): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uCharFill = charFill;
    sh.uniforms.uCharHemi = charHemi;
    sh.uniforms.uCharWB = charWB;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uCharFill;\nuniform vec3 uCharHemi;\nuniform vec3 uCharWB;')
      .replace(
        '#include <aomap_fragment>',
        `reflectedLight.directDiffuse *= uCharWB;
        reflectedLight.indirectDiffuse *= uCharWB;
        #include <aomap_fragment>`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * uCharFill * (0.35 + 0.65 * max(normal.z, 0.0));
        vec3 charUpV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
        totalEmissiveRadiance += diffuseColor.rgb * uCharHemi * (0.75 + 0.25 * dot(normal, charUpV));`,
      );
  };
  m.customProgramCacheKey = () => 'char-fill-hemi-wb';
  return m;
}

/** The footballers' (and referee's, and ball's) shared opaque material. */
export const charMaterial = makeCharMaterial();

/** Character fill light intensity (light units, e.g. 0.5; 0 = off), slightly cool like the floodlights. */
export function setCharacterFill(intensity: number): void {
  const k = Math.max(0, intensity) / Math.PI;
  charFill.value.setRGB(k * 0.96, k * 0.98, k * 1.06);
}

/**
 * Character white balance for a coloured key + sky (linear colours and intensities, as on the scene's lights):
 * the light a white shirt gets (key at ~60 degrees, the sky dome) keeps only `keep` of its tint, at the same
 * brightness. No arguments: neutral (day, night, menus).
 */
export function setCharacterWhiteBalance(sun?: THREE.Color, sunI = 0, sky?: THREE.Color, skyI = 0, keep = 0.08): void {
  if (!sun || !sky) {
    charWB.value.setRGB(1, 1, 1);
    return;
  }
  const r = sun.r * sunI * 0.5 + sky.r * skyI * 0.75;
  const g = sun.g * sunI * 0.5 + sky.g * skyI * 0.75;
  const b = sun.b * sunI * 0.5 + sky.b * skyI * 0.75;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const want = (c: number) => (c > 1e-4 ? (lum + (c - lum) * keep) / c : 1);
  charWB.value.setRGB(want(r), want(g), want(b));
}

/** Neutral sky fill on the footballers (light units like a HemisphereLight's intensity; 0 = off). */
export function setCharacterHemiFill(intensity: number): void {
  const k = Math.max(0, intensity) / Math.PI;
  charHemi.value.setRGB(k, k, k);
}

const geoCache = new Map<string, THREE.BufferGeometry>();

function cached(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = build();
    geoCache.set(key, g);
  }
  return g;
}

function contrast(hex: number): number {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? 0x26262e : 0xfbfbf4;
}

interface Outfit {
  shirt: number;
  shirt2: number;
  pattern: Kit['pattern'];
  shorts: number;
  socks: number;
  gloves: number | null;
}

function hexDist(a: number, b: number): number {
  return Math.hypot(((a >> 16) & 255) - ((b >> 16) & 255), ((a >> 8) & 255) - ((b >> 8) & 255), (a & 255) - (b & 255));
}

/** Keeper colour that reads on grass: a green keeper kit becomes orange (or pink / yellow if the team plays in it). */
function grassSafeKeeper(kit: Kit): number {
  if (!grassLike(kit.gk)) return kit.gk;
  for (const c of [0xff8a2b, 0xff79b0, 0xffd23a, 0x2a2a30]) {
    if (hexDist(c, kit.shirt) > 90 && hexDist(c, kit.shirt2) > 60) return c;
  }
  return 0xff8a2b;
}

function outfitFor(kit: Kit, keeper: boolean): Outfit {
  if (keeper) {
    const gk = grassSafeKeeper(kit);
    return { shirt: gk, shirt2: shade(gk, 0.8), pattern: 'plain', shorts: shade(gk, 0.55), socks: gk, gloves: 0xf6f4ec };
  }
  return { shirt: kit.shirt, shirt2: kit.shirt2, pattern: kit.pattern, shorts: kit.shorts, socks: kit.socks, gloves: null };
}

function buildTorso(o: Outfit, number: number): THREE.BufferGeometry {
  const g = new VoxelGrid(TORSO_D, TORSO_H, TORSO_W);
  for (let y = 0; y < TORSO_H; y++) {
    for (let z = 0; z < TORSO_W; z++) {
      for (let x = 0; x < TORSO_D; x++) {
        let c = o.shirt;
        const sy = y - SHORTS;
        if (y < SHORTS) c = o.shorts;
        else if (o.pattern === 'stripes' && z % 2 === 1) c = o.shirt2;
        else if (o.pattern === 'hoops' && sy % 2 === 1) c = o.shirt2;
        else if (o.pattern === 'halves' && z < TORSO_W / 2) c = o.shirt2;
        else if (o.pattern === 'sash' && Math.abs(z - (TORSO_W - 1 - sy * 1.5)) < 1.2) c = o.shirt2;
        // Collar ring on the shoulders.
        if (y === TORSO_H - 1 && z >= 3 && z <= 4 && x >= 1 && x <= 3) c = shade(o.shirt2, 0.9);
        g.set(x, y, z, c);
      }
    }
  }
  // Waistband.
  for (let z = 0; z < TORSO_W; z++) for (let x = 0; x < TORSO_D; x++) g.set(x, SHORTS - 1, z, shade(o.shorts, 0.84));
  // Shirt number on the back (x = 0): two 3x5 digits fill the 5 shirt rows.
  const ink = o.pattern === 'plain' || o.pattern === 'sleeves' || o.pattern === 'halves' ? contrast(o.shirt) : 0xfbfbf4;
  const txt = number < 0 ? '' : String(number % 100);
  const startZ = txt.length === 1 ? 2 : 0;
  for (let d = 0; d < txt.length; d++) {
    const rows = DIGITS[txt[d]];
    for (let r = 0; r < 5; r++) {
      for (let cI = 0; cI < 3; cI++) {
        if (rows[r][cI] !== '1') continue;
        g.set(0, TORSO_H - 1 - r, startZ + d * 4 + cI + (txt.length === 2 ? 0.5 : 0) | 0, ink);
      }
    }
  }
  // Front: club badge on the left chest and a sponsor block across the middle.
  const front = TORSO_D - 1;
  g.set(front, TORSO_H - 2, 2, 0xffd23a);
  g.set(front, TORSO_H - 2, 1, shade(o.shirt2, 1));
  if (o.pattern === 'plain' || o.pattern === 'sleeves') {
    for (let z = 2; z <= 5; z++) g.set(front, SHORTS + 1, z, ink);
  }
  // Number on the shorts.
  g.set(front, 0, 6, ink);
  return meshVoxels(g, { scale: VU, pivot: [TORSO_D / 2, 0, TORSO_W / 2] });
}

function buildArm(o: Outfit, skin: number): THREE.BufferGeometry {
  // 3 deep x 5 long x 2 wide: two-row sleeve + cuff, two-row hand.
  const g = new VoxelGrid(3, ARM_L, 2);
  const sleeve = o.pattern === 'sleeves' ? o.shirt2 : o.shirt;
  for (let y = 0; y < ARM_L; y++) {
    let c = y >= 2 ? sleeve : skin;
    if (o.gloves !== null) c = y <= 1 ? o.gloves : o.shirt;
    g.box(0, y, 0, 3, 1, 2, c);
  }
  if (o.gloves === null) g.box(0, 2, 0, 3, 1, 2, shade(sleeve, 0.86)); // cuff
  return meshVoxels(g, { scale: VU, pivot: [1.5, ARM_L, 1] });
}

function buildLeg(o: Outfit, skin: number, boots: number): THREE.BufferGeometry {
  // 2 deep (+1 toe) x 5 tall x 3 wide: boot, sock (+ turn-over), knee, shorts.
  const g = new VoxelGrid(3, LEG_H, 3);
  for (let y = 0; y < LEG_H; y++) {
    let c: number;
    if (y === 0) c = boots;
    else if (y <= 2) c = o.socks;
    else if (y === 3) c = skin;
    else c = o.shorts;
    g.box(0, y, 0, 2, 1, 3, c);
  }
  g.box(2, 0, 0, 1, 1, 3, boots); // toe cap
  g.box(0, 2, 0, 2, 1, 3, shade(o.socks, 0.84)); // sock turn-over
  return meshVoxels(g, { scale: VU, pivot: [1, LEG_H, 1.5] });
}

function buildHead(look: Look): THREE.BufferGeometry {
  // Skin cube occupies [0..HEAD) in head space; the grid is offset so hair can overhang.
  const OX = 2, OZ = 2;
  const g = new VoxelGrid(HEAD + 4, HEAD + 5, HEAD + 4);
  const skin = SKIN[look.skin % SKIN.length];
  const hair = HAIR[look.hairColor % HAIR.length];
  const S = (x: number, y: number, z: number, c: number | null) => g.set(x + OX, y, z + OZ, c);
  const B = (x: number, y: number, z: number, sx: number, sy: number, sz: number, c: number) => {
    for (let a = x; a < x + sx; a++) for (let b = y; b < y + sy; b++) for (let d = z; d < z + sz; d++) S(a, b, d, c);
  };
  const H = HEAD;
  const F = H - 1; // front face x
  const M = (H - 1) / 2; // middle column (z = 4)
  B(0, 0, 0, H, H, H, skin);
  // Face on +x, Crossy style: two wide-set 2x2 eyes with a glint, a nub nose, a small mouth, ears.
  const eye = 0x16161c;
  for (const ez of [M - 2, M + 1]) {
    S(F, 4, ez, eye); S(F, 4, ez + 1, eye); S(F, 5, ez, 0xffffff); S(F, 5, ez + 1, eye);
  }
  S(H, 3, M, shade(skin, 0.88)); // nose
  S(F, 2, M, shade(skin, 0.66)); // mouth
  S(F, 2, M + 1, shade(skin, 0.74));
  for (const ez of [-1, H]) {
    S(4, 3, ez, shade(skin, 0.9)); S(4, 4, ez, shade(skin, 0.9)); // ears
  }

  const cap = () => B(0, H, 0, H, 1, H, hair);
  const fringe = (rows = 1) => B(F, H - rows, 0, 1, rows, H, hair);
  const back = (y0: number) => B(0, y0, 0, 1, H - y0, H, hair);
  const sides = (y0: number, depth: number) => {
    B(0, y0, 0, depth, H - y0, 1, hair);
    B(0, y0, H - 1, depth, H - y0, 1, hair);
  };
  switch (look.hair % 9) {
    case 0: // short
      cap(); fringe(); back(3); sides(6, 5);
      break;
    case 1: // buzz: paint over the skin
      B(0, H - 1, 0, H, 1, H, hair); B(0, 5, 0, 1, 4, H, hair); sides(6, 4);
      break;
    case 2: // mohawk
      B(0, H - 1, 0, H, 1, H, shade(hair, 1.1)); B(-1, H, M - 1, H + 1, 1, 3, hair); B(0, H + 1, M, H - 2, 1, 1, hair);
      break;
    case 3: // afro
      B(-1, 6, -1, H, 4, H + 2, hair); B(0, H + 1, 0, H - 1, 1, H, hair); sides(5, 5); fringe();
      break;
    case 4: // long
      cap(); fringe(); back(0); B(-1, 0, 0, 1, H, H, hair); sides(1, 4);
      break;
    case 5: // bald
      break;
    case 6: // spiky
      cap(); fringe(); back(3); sides(6, 4);
      for (let x = 0; x < H; x += 2) for (let z = x % 4 === 0 ? 0 : 1; z < H; z += 2) S(x, H + 1, z, hair);
      break;
    case 7: // bun
      cap(); back(2); sides(6, 4); B(-2, H - 1, M - 1, 2, 2, 3, hair);
      break;
    case 8: // headband
      cap(); back(3); sides(6, 5);
      for (let x = 0; x < H; x++) { S(x, 7, 0, 0xfbfbf4); S(x, 7, H - 1, 0xfbfbf4); }
      for (let z = 0; z < H; z++) { S(0, 7, z, 0xfbfbf4); S(F, 7, z, 0xe8443a); }
      fringe();
      break;
  }
  if (look.beard === 1) {
    for (let z = 1; z < H - 1; z++) S(F, 0, z, shade(hair, 0.95));
    for (const z of [0, H - 1]) { S(F, 0, z, shade(hair, 0.95)); S(F - 1, 0, z, shade(hair, 0.95)); }
  } else if (look.beard === 2) {
    B(F, 0, 0, 1, 2, H, hair); B(4, 0, 0, 4, 3, 1, hair); B(4, 0, H - 1, 4, 3, 1, hair);
  }
  return meshVoxels(g, { scale: VU, pivot: [H / 2 + OX, 0, H / 2 + OZ] });
}

export interface PoseInput {
  state: number; // PSTATE code
  stateT: number;
  speed: number;
  runPhase: number;
  kickT: number;
  /** +1 right / -1 left foot; +-2 = the same foot in a quick tackle poke (see replay.ts writeFrame). */
  kickLeg: number;
  lean: number;
  diveDir: number;
  headerT: number;
  celebrate: number;
  y: number;
  keeper: boolean;
  hasBall: boolean;
  /** Ball bearing relative to the body, radians (+ = to the player's left). */
  look: number;
  /** Smoothed turn rate, rad/s (+ = turning left). */
  turn: number;
  /** Referee signal: right arm raised. */
  signal?: boolean;
  /** Which signal: 0 arm raised (free kick / offside), 1 advantage (both arms forward), 2 card held high. */
  signalKind?: number;
  /**
   * Seconds since the last pose (drives the cross-fades; 0 = a cut: the new pose is shown as it is). When
   * absent it is taken from `time`.
   */
  dt?: number;
}

/**
 * Pose codes (replay.ts STATE_CODE). 11 / 12 are reserved for the sim's stumble and plant-before-a-strike
 * states, if and when it has them; until then a strike at a sprint gets its plant step inside 'kick'.
 */
export const PSTATE = {
  move: 0, kick: 1, slide: 2, fallen: 3, stand: 4, dive: 5, hold: 6, throw: 7, celebrate: 8, dejected: 9, stumble: 11, plant: 12,
} as const;

/**
 * Standing tackle: the sim's poke enters the 0.34 s 'kick' state at kickT 0.28 (replay.ts LUNGE_KICK_T0), so
 * the lunge runs over the last 0.72 of kickT (~0.25 s): a deep step at the ball, the leading leg out low,
 * torso forward and arms flung out, there on the very frame of the press (BLEND_POKE_S is the only ease-in),
 * held for POKE_HOLD of it, then back into the stride.
 */
const POKE_T0 = 0.28;
const POKE_HOLD = 0.5;
/**
 * Pose cross-fades (s): a change of state (or of move within one: a header, a celebration style) blends
 * the limbs from the last drawn pose instead of snapping, a touch longer getting up off the grass. The
 * actions (a strike, a poke, a header, a slide, a dive) must read as immediate: a short ease-OUT, so the very
 * first frame after the sim starts one already shows ~half the new pose (round 8's 0.08 s smoothstep showed
 * 11% of it, 38% by the second frame: the kick looked like it started late) and it is all there by the third.
 * Only the low-importance changes (getting up, celebrating, standing about) keep the gentle smoothstep.
 */
const BLEND_S = 0.12;
const BLEND_KICK_S = 0.06;
/** A standing tackle must read the frame it is pressed: the lunge pose is all but snapped to (~80% on frame 1). */
const BLEND_POKE_S = 0.03;
const BLEND_FAST_S = 0.06;
const BLEND_GETUP_S = 0.15;
/** Entry speed (m/s) from which a strike gets a plant step (full plant at the top value). */
const PLANT_FROM = 3.2;
const PLANT_FULL = 6.5;
/** Pose channels cross-faded: hip offset x / y, hip, torso and head rotations, torso breath, four limbs. */
const POSE_N = 24;
/** Channels that are positions or scales (the rest are angles, blended the short way round). */
const LINEAR_CH = new Set([0, 1, 8]);

function blendTime(from: number, to: number): number {
  if (to === PSTATE.kick) return BLEND_KICK_S;
  if (to === PSTATE.slide || to === PSTATE.dive) return BLEND_FAST_S;
  if (to === PSTATE.stand && (from === PSTATE.slide || from === PSTATE.fallen || from === PSTATE.dive)) return BLEND_GETUP_S;
  return BLEND_S;
}

/** An action (see BLEND_KICK_S): blended in with an ease-out, never the slow-starting smoothstep. */
function isAction(key: number): boolean {
  const state = key >> 4;
  // (A header while running is the move state's sub-pose 1.)
  return state === PSTATE.kick || state === PSTATE.slide || state === PSTATE.dive || ((state === PSTATE.move || state === PSTATE.stand) && (key & 15) === 1);
}

export class Footballer {
  readonly group = new THREE.Group();
  private readonly body = new THREE.Group(); // hip pivot
  private readonly torso: THREE.Mesh;
  private readonly head: THREE.Mesh;
  private readonly armL: THREE.Mesh;
  private readonly armR: THREE.Mesh;
  private readonly legL: THREE.Mesh;
  private readonly legR: THREE.Mesh;
  /** Extra draw scale on top of CHAR_SCALE (phones: see screenCharK). */
  scaleK = 1;
  /** Own see-through copy of the voxel material, made the first time this player is faded. */
  private fadeMat: THREE.MeshLambertMaterial | null = null;
  private alpha = 1;
  /** Blitz tint (see setTint), its glow, and this player's own tinted copy of the material, made on first use. */
  private tint: number | null = null;
  private tintGlow = 0;
  private tintMat: THREE.MeshLambertMaterial | null = null;
  /** Cross-fade: the pose key last drawn, the pose drawn then, the pose the fade starts from, its clock / length. */
  private poseKey = -1;
  private poseState = -1;
  private readonly lastPose = new Float32Array(POSE_N);
  private readonly fromPose = new Float32Array(POSE_N);
  private readonly curPose = new Float32Array(POSE_N);
  private blendT = 0;
  private blendS = 0;
  /** The fade under way is into an action (ease-out: see BLEND_KICK_S). */
  private blendAction = false;
  private lastTime = NaN;
  /** Speed going into the current strike (a sprint gets the plant step). */
  private kickEntry = 0;
  /** Eased head turn towards the ball (never snaps when he gets the ball, or it passes behind him). */
  private headYaw = 0;
  /** Eased idle -> stride weight (a sprint start takes ~0.1 s to swing the limbs out, never one frame). */
  private moveW = 0;

  constructor(readonly def: PlayerDef, kit: Kit, keeper: boolean) {
    const o = outfitFor(kit, keeper);
    const skin = SKIN[def.look.skin % SKIN.length];
    const kitKey = `${o.shirt}-${o.shirt2}-${o.pattern}-${o.shorts}-${o.socks}-${o.gloves}`;
    const torsoG = cached(`t-${kitKey}-${def.number}`, () => buildTorso(o, def.number));
    const armG = cached(`a-${kitKey}-${skin}`, () => buildArm(o, skin));
    const legG = cached(`l-${kitKey}-${skin}-${def.look.boots}`, () => buildLeg(o, skin, def.look.boots));
    const headG = cached(`h-${JSON.stringify(def.look)}`, () => buildHead(def.look));

    const mk = (g: THREE.BufferGeometry) => {
      const m = new THREE.Mesh(g, charMaterial);
      m.castShadow = true;
      m.receiveShadow = false;
      return m;
    };
    this.torso = mk(torsoG);
    this.head = mk(headG);
    this.armL = mk(armG);
    this.armR = mk(armG);
    this.legL = mk(legG);
    this.legR = mk(legG);

    this.group.add(this.body);
    this.group.scale.setScalar(CHAR_SCALE);
    this.body.position.y = HIP_Y;
    this.body.add(this.torso, this.legL, this.legR);
    this.torso.add(this.head, this.armL, this.armR);
    this.head.position.set(0, TORSO_H * VU, 0);
    this.armL.position.set(0, (TORSO_H - 0.5) * VU, -(TORSO_W / 2 + 1) * VU);
    this.armR.position.set(0, (TORSO_H - 0.5) * VU, (TORSO_W / 2 + 1) * VU);
    this.legL.position.set(0, 0, -2 * VU);
    this.legR.position.set(0, 0, 2 * VU);
  }

  get opacity(): number {
    return this.alpha;
  }

  /**
   * See-through (low cameras fade whoever stands by the lens): below 1 the body parts swap to this player's
   * own transparent copy of the character material; back at 1 they share the opaque one again. Fully faded
   * (0) he is not drawn at all, so no shadow is left standing on the grass without him.
   */
  setOpacity(a: number): void {
    a = clamp(a, 0, 1);
    if (Math.abs(a - this.alpha) < 0.004 && (a < 1 || this.alpha === 1) && (a > 0 || this.alpha === 0)) return;
    this.alpha = a >= 0.995 ? 1 : a <= 0.01 ? 0 : a;
    this.group.visible = this.alpha > 0;
    const faded = this.alpha < 1;
    if (faded && !this.fadeMat) {
      this.fadeMat = makeCharMaterial();
      this.fadeMat.transparent = true;
    }
    if (this.fadeMat) this.fadeMat.opacity = this.alpha;
    this.applyMaterial();
  }

  /**
   * Colour cast over the whole figure (blitz: an ice-blue tint on a frozen side), null for none. Below 1
   * opacity the tint is dropped (the fade material takes over); back to solid the tint comes back.
   */
  setTint(color: number | null, glow = 0): void {
    if (color === this.tint && glow === this.tintGlow) return;
    this.tint = color;
    this.tintGlow = glow;
    this.applyMaterial();
  }

  private applyMaterial(): void {
    const faded = this.alpha < 1;
    let mat: THREE.MeshLambertMaterial = charMaterial;
    if (faded) mat = this.fadeMat!;
    else if (this.tint !== null) {
      if (!this.tintMat) this.tintMat = makeCharMaterial();
      this.tintMat.color.setHex(this.tint);
      // (A cold glow with the ice tint: a frozen man reads blue whatever his kit, even in his own shadow.)
      this.tintMat.emissive.setHex(this.tintGlow);
      mat = this.tintMat;
    }
    for (const m of [this.torso, this.head, this.armL, this.armR, this.legL, this.legR]) m.material = mat;
  }

  /** Hang a prop (the referee's card) in a hand: `obj` is placed in that arm's space at the hand. */
  holdInHand(obj: THREE.Object3D, right = true): void {
    obj.position.y += HAND_Y;
    (right ? this.armR : this.armL).add(obj);
  }

  /** The cross-faded channels, in POSE_N order. */
  private readPose(out: Float32Array): void {
    const b = this.body, t = this.torso, h = this.head;
    out[0] = b.position.x; out[1] = b.position.y;
    out[2] = b.rotation.x; out[3] = b.rotation.y; out[4] = b.rotation.z;
    out[5] = t.rotation.x; out[6] = t.rotation.y; out[7] = t.rotation.z; out[8] = t.scale.y;
    out[9] = h.rotation.x; out[10] = h.rotation.y; out[11] = h.rotation.z;
    let k = 12;
    for (const m of [this.armL, this.armR, this.legL, this.legR]) {
      out[k++] = m.rotation.x;
      out[k++] = m.rotation.y;
      out[k++] = m.rotation.z;
    }
  }

  private writePose(v: Float32Array): void {
    const b = this.body, t = this.torso, h = this.head;
    b.position.x = v[0]; b.position.y = v[1];
    b.rotation.set(v[2], v[3], v[4]);
    t.rotation.set(v[5], v[6], v[7]);
    t.scale.y = v[8];
    h.rotation.set(v[9], v[10], v[11]);
    let k = 12;
    for (const m of [this.armL, this.armR, this.legL, this.legR]) {
      m.rotation.set(v[k], v[k + 1], v[k + 2]);
      k += 3;
    }
  }

  /**
   * Which pose "move" is being drawn: the state, plus the variant within it that changes the limbs
   * outright (a header, a poke, a celebration style, a referee signal). A change of key starts a cross-fade.
   */
  private static keyOf(p: PoseInput): number {
    let sub = 0;
    if (p.state === PSTATE.move || p.state === PSTATE.stand) sub = p.headerT > 0 ? 1 : 0;
    else if (p.state === PSTATE.kick) sub = Math.abs(p.kickLeg) > 1.5 && p.headerT <= 0 ? 1 : p.headerT > 0 ? 2 : 0;
    else if (p.state === PSTATE.celebrate) sub = p.speed < 1.2 ? 1 + Math.min(4, Math.max(0, Math.round(p.celebrate))) : 0;
    if (p.signal) sub = 8 + (p.signalKind ?? 0);
    return p.state * 16 + sub;
  }

  /**
   * Procedural pose from the recorded sim state, identical live and in replays. A change of state is never a
   * snap: the limbs cross-fade from the last drawn pose over ~0.1 s (BLEND_S), a strike taken at a sprint
   * plants first, and the head turns towards the ball at a human rate.
   */
  pose(p: PoseInput, time: number): void {
    const dtIn = p.dt ?? (Number.isFinite(this.lastTime) ? time - this.lastTime : 0);
    const dt = Math.max(0, Math.min(0.1, dtIn));
    this.lastTime = time;
    const key = Footballer.keyOf(p);
    if (key !== this.poseKey) {
      if (this.poseKey >= 0 && dt > 0) {
        this.fromPose.set(this.lastPose);
        this.blendT = 0;
        this.blendAction = isAction(key);
        const poke = p.state === PSTATE.kick && (key & 15) === 1;
        this.blendS = poke ? BLEND_POKE_S : this.blendAction && p.state !== PSTATE.slide && p.state !== PSTATE.dive ? BLEND_KICK_S : blendTime(this.poseState, p.state);
      } else this.blendS = 0;
      if (p.state === PSTATE.kick && this.poseState !== PSTATE.kick) this.kickEntry = p.speed;
      this.poseKey = key;
      this.poseState = p.state;
    }
    if (dt <= 0 && dtIn <= 0 && p.dt !== undefined) this.blendS = 0;
    this.poseRaw(p, time, dt);
    if (this.blendS > 0) {
      this.blendT += dt;
      const u = clamp(this.blendT / this.blendS, 0, 1);
      const w = this.blendAction ? 1 - (1 - u) * (1 - u) : smoothstep(0, this.blendS, this.blendT);
      if (w >= 1) this.blendS = 0;
      else {
        const c = this.curPose;
        const f0 = this.fromPose;
        this.readPose(c);
        for (let i = 0; i < POSE_N; i++) {
          c[i] = LINEAR_CH.has(i) ? f0[i] + (c[i] - f0[i]) * w : f0[i] + wrapAngle(c[i] - f0[i]) * w;
        }
        this.writePose(c);
      }
    }
    this.readPose(this.lastPose);
  }

  private poseRaw(p: PoseInput, time: number, dt: number): void {
    const body = this.body;
    const torso = this.torso;
    const head = this.head;
    const aL = this.armL, aR = this.armR, lL = this.legL, lR = this.legR;
    // Reset.
    this.group.scale.setScalar(CHAR_SCALE * this.scaleK);
    body.position.set(0, HIP_Y, 0);
    body.rotation.set(0, 0, 0);
    torso.rotation.set(0, 0, 0);
    torso.scale.set(1, 1, 1);
    head.rotation.set(0, 0, 0);
    aL.rotation.set(0, 0, 0);
    aR.rotation.set(0, 0, 0);
    lL.rotation.set(0, 0, 0);
    lR.rotation.set(0, 0, 0);
    this.group.position.y = p.y;

    const ph = p.runPhase * Math.PI * 2;
    const run = clamp(p.speed / 7.5, 0, 1);
    const swing = Math.sin(ph);

    const locomotion = () => {
      // Idle and running blend continuously with speed (no snap from the stand to the stride at a threshold),
      // eased over time too: the sim gets a man from a standstill to a run in a few frames.
      const mvWant = smoothstep(0.08, 0.7, p.speed);
      this.moveW = dt > 0 ? this.moveW + (mvWant - this.moveW) * Math.min(1, dt * 14) : mvWant;
      const mv = this.moveW;
      const iw = 1 - mv;
      const amp = (0.25 + run * 0.75) * mv;
      lL.rotation.z = swing * amp;
      lR.rotation.z = -swing * amp;
      aL.rotation.z = -swing * amp * 0.85;
      aR.rotation.z = swing * amp * 0.85;
      // Toy hop on every step.
      body.position.y = HIP_Y + Math.abs(Math.cos(ph)) * 0.06 * (0.4 + run) * mv;
      torso.rotation.z = (-p.lean - run * 0.1) * mv;
      head.rotation.z = run * 0.08;
      const br = Math.sin(time * 2.4 + p.runPhase * 9);
      torso.scale.y = 1 + br * 0.012 * iw;
      aL.rotation.x = lerp(-0.12, -0.08 - br * 0.02, iw);
      aR.rotation.x = lerp(0.12, 0.08 + br * 0.02, iw);
      if (p.keeper && iw > 0) {
        // Set position: knees bent, gloves ready.
        body.position.y -= 0.045 * iw;
        torso.rotation.z += -0.18 * iw;
        aL.rotation.x = lerp(aL.rotation.x, -0.5, iw);
        aL.rotation.z = lerp(aL.rotation.z, 0.9, iw);
        aR.rotation.x = lerp(aR.rotation.x, 0.5, iw);
        aR.rotation.z = lerp(aR.rotation.z, 0.9, iw);
        lL.rotation.x = 0.14 * iw;
        lL.rotation.z = lerp(lL.rotation.z, 0.12, iw);
        lR.rotation.x = -0.14 * iw;
        lR.rotation.z = lerp(lR.rotation.z, 0.12, iw);
      }
    };

    /**
     * A braking plant step (0..1): the standing leg reaching ahead, hips sinking, torso back, arms out;
     * `kickLeg` (the sim's own plant state only) also trails the kicking leg, ready to swing.
     */
    const plantStep = (w: number, plant: THREE.Mesh, kickLeg: THREE.Mesh | null) => {
      if (w <= 0) return;
      plant.rotation.z = lerp(plant.rotation.z, 0.42, w);
      if (kickLeg) kickLeg.rotation.z = lerp(kickLeg.rotation.z, -0.45, w * 0.7);
      body.position.y -= 0.04 * w;
      torso.rotation.z += 0.16 * w;
      head.rotation.z -= 0.1 * w;
      aL.rotation.x -= 0.35 * w;
      aR.rotation.x += 0.35 * w;
    };

    switch (p.state) {
      case PSTATE.move:
      case PSTATE.stand: {
        locomotion();
        if (p.state === PSTATE.stand) {
          const k = 1 - clamp(p.stateT / 0.38, 0, 1);
          body.rotation.z = k * 0.9;
          body.position.y = HIP_Y - k * (HIP_Y - 0.12);
        }
        if (p.headerT > 0) {
          const h = Math.sin((1 - p.headerT) * Math.PI);
          torso.rotation.z = -0.25 + h * -0.35;
          head.rotation.z = -h * 0.4;
          aL.rotation.x = -0.9;
          aR.rotation.x = 0.9;
        }
        break;
      }
      case PSTATE.kick: {
        const t = p.kickT;
        const right = p.kickLeg > 0;
        const kickLeg = right ? lR : lL;
        const plant = right ? lL : lR;
        if (Math.abs(p.kickLeg) > 1.5 && p.headerT <= 0) {
          // Standing tackle: straight out of the stride into a deep lunge at the ball, the leading leg
          // stretched out low, the standing leg bent back under him, hips dropped, torso pitched forward and
          // both arms flung wide for balance; held, then back into the run (see POKE_HIT / POKE_HOLD).
          locomotion();
          const u = clamp((t - POKE_T0) / (1 - POKE_T0), 0, 1);
          const e = u < POKE_HOLD ? 1 : 1 - smoothstep(POKE_HOLD, 1, u);
          kickLeg.rotation.z = lerp(kickLeg.rotation.z, 1.4, e);
          kickLeg.rotation.x = lerp(kickLeg.rotation.x, -Math.sign(p.kickLeg) * 0.2, e);
          plant.rotation.z = lerp(plant.rotation.z, -1.0, e);
          torso.rotation.z = lerp(torso.rotation.z, -0.8, e);
          torso.rotation.y = -Math.sign(p.kickLeg) * 0.3 * e;
          head.rotation.z = 0.5 * e;
          (right ? aL : aR).rotation.z = lerp((right ? aL : aR).rotation.z, 1.2, e);
          (right ? aR : aL).rotation.z = lerp((right ? aR : aL).rotation.z, -1.0, e);
          aL.rotation.x = lerp(aL.rotation.x, -1.3, e);
          aR.rotation.x = lerp(aR.rotation.x, 1.3, e);
          // The step itself: the whole body driven half a metre at the ball, hips dropped to a crouch.
          body.position.x = 0.5 * e;
          body.position.y = lerp(body.position.y, HIP_Y - 0.2, e);
          break;
        }
        // Taken at speed: a bigger back-swing over a planted standing leg, then the strike.
        const fast = smoothstep(PLANT_FROM, PLANT_FULL, this.kickEntry);
        const back = -1.05 * (1 + 0.2 * fast);
        const kick = t < 0.22 ? lerp(0, back, t / 0.22) : t < 0.45 ? lerp(back, 1.45, (t - 0.22) / 0.23) : lerp(1.45, 0, (t - 0.45) / 0.55);
        kickLeg.rotation.z = kick;
        plant.rotation.z = -0.15;
        const open = Math.sin(clamp(t, 0, 1) * Math.PI);
        aL.rotation.x = -0.4 - open * 0.9;
        aR.rotation.x = 0.4 + open * 0.9;
        torso.rotation.z = 0.12 * open;
        torso.rotation.y = -Math.sign(p.kickLeg) * 0.25 * (kick / 1.45);
        body.position.y = HIP_Y - open * 0.03;
        if (p.headerT > 0) {
          const h = Math.sin((1 - p.headerT) * Math.PI);
          head.rotation.z = -h * 0.5;
          torso.rotation.z = -0.3 * h;
          kickLeg.rotation.z = 0.2;
        } else plantStep(fast * (1 - smoothstep(0.18, 0.42, t)), plant, null);
        break;
      }
      case PSTATE.plant: {
        // (Sim plant state, when it has one: braking into the strike that follows.)
        locomotion();
        const right = p.kickLeg >= 0;
        plantStep(smoothstep(0, 0.12, p.stateT), right ? lL : lR, right ? lR : lL);
        break;
      }
      case PSTATE.stumble: {
        // (Sim stumble state, when it has one: pitched forward, arms thrown out, feet scrambling.)
        locomotion();
        const k = Math.sin(clamp(p.stateT / 0.6, 0, 1) * Math.PI);
        torso.rotation.z -= 0.45 * k;
        head.rotation.z += 0.3 * k;
        aL.rotation.set(-0.9 * k, 0, 1.2 * k + Math.sin(time * 17) * 0.25 * k);
        aR.rotation.set(0.9 * k, 0, 1.2 * k + Math.sin(time * 17 + 1.7) * 0.25 * k);
        lL.rotation.z += Math.sin(p.stateT * 16) * 0.35 * k;
        lR.rotation.z -= Math.sin(p.stateT * 16) * 0.35 * k;
        body.position.y -= 0.05 * k;
        break;
      }
      case PSTATE.throw: {
        const t = clamp(p.stateT / 0.34, 0, 1);
        const arm = t < 0.6 ? lerp(2.6, 3.4, t / 0.6) : lerp(3.4, 1.6, (t - 0.6) / 0.4);
        aL.rotation.z = arm;
        aR.rotation.z = arm;
        torso.rotation.z = t < 0.6 ? 0.2 : -0.25;
        lL.rotation.z = 0.2;
        lR.rotation.z = -0.1;
        break;
      }
      case PSTATE.slide: {
        // Down fast (0.14 s), laid right back on one hip, the leading leg straight out along the grass at the
        // ball, the other tucked under, the top arm thrown up and the ground arm braced: a real slide.
        const t = clamp(p.stateT / 0.14, 0, 1);
        body.rotation.z = 1.2 * t;
        body.position.y = HIP_Y - (HIP_Y - 0.15) * t;
        lR.rotation.z = lerp(0.2, 1.05, t);
        lR.rotation.x = 0.12 * t;
        lL.rotation.z = lerp(-0.2, -0.95, t);
        lL.rotation.x = -0.35 * t;
        aL.rotation.x = -1.35 * t;
        aL.rotation.z = 1.9 * t;
        aR.rotation.z = -1.2 * t;
        aR.rotation.x = 0.3 * t;
        torso.rotation.y = -0.2 * t;
        head.rotation.z = 0.35 * t;
        break;
      }
      case PSTATE.fallen: {
        const t = clamp(p.stateT / 0.25, 0, 1);
        body.rotation.z = 1.5 * t;
        body.position.y = HIP_Y - (HIP_Y - 0.1) * t;
        lL.rotation.z = 0.5 + Math.sin(time * 9) * 0.1 * (1 - t);
        lR.rotation.z = 0.2;
        aL.rotation.x = -1.4;
        aR.rotation.x = 1.4;
        break;
      }
      case PSTATE.dive: {
        const t = clamp(p.stateT / 0.22, 0, 1);
        // Land, then roll back up to a crouch before the stand-up state takes over.
        const up = clamp((p.stateT - 0.85) / 0.35, 0, 1);
        const lay = t * (1 - up * up * (3 - 2 * up));
        // Full stretch: laid right over into the dive, both arms reaching past the head, the legs scissored
        // (the trailing leg kicked up behind), the body stretched a touch longer: a keeper at full length.
        body.rotation.x = p.diveDir * 1.5 * lay;
        body.position.y = HIP_Y - 0.05 * t - lay * 0.1 - up * 0.09;
        aL.rotation.z = 3.05 * lay + up * 0.9;
        aR.rotation.z = 3.05 * lay + up * 0.9;
        aL.rotation.x = -0.12 - 0.2 * lay;
        aR.rotation.x = 0.12 + 0.2 * lay;
        lL.rotation.x = -0.45 * p.diveDir * lay;
        lR.rotation.x = 0.45 * p.diveDir * lay;
        lL.rotation.z = up * 0.9 - 0.35 * lay;
        lR.rotation.z = -up * 0.3 + 0.55 * lay;
        torso.scale.y = 1 + 0.06 * lay;
        head.rotation.z = -0.2 * lay;
        break;
      }
      case PSTATE.hold: {
        locomotion();
        aL.rotation.set(-0.25, 0, 1.25);
        aR.rotation.set(0.25, 0, 1.25);
        break;
      }
      case PSTATE.celebrate: {
        locomotion();
        const style = p.celebrate;
        const hop = Math.abs(Math.sin(time * 7 + p.runPhase * 3));
        if (p.speed < 1.2) {
          if (style === 0 || style >= 4) {
            this.group.position.y = p.y + hop * 0.45;
            aL.rotation.set(-0.3, 0, 2.9);
            aR.rotation.set(0.3, 0, 2.9);
            lL.rotation.z = 0.3 * hop;
            lR.rotation.z = -0.3 * hop;
          } else if (style === 1) {
            aL.rotation.x = -1.55;
            aR.rotation.x = 1.55;
            body.rotation.x = Math.sin(time * 3) * 0.3;
          } else if (style === 2) {
            body.position.y = HIP_Y - 0.15;
            lL.rotation.z = -1.5;
            lR.rotation.z = -1.5;
            torso.rotation.z = 0.35;
            aL.rotation.set(-0.4, 0, 2.7);
            aR.rotation.set(0.4, 0, 2.7);
          } else {
            body.rotation.y = time * 9;
            aL.rotation.x = -1.4;
            aR.rotation.x = 1.4;
          }
        } else if (style === 1) {
          aL.rotation.set(-1.55, 0, 0);
          aR.rotation.set(1.55, 0, 0);
          body.rotation.x = Math.sin(time * 4) * 0.25;
        } else {
          aL.rotation.z = 2.8;
          aR.rotation.z = 2.8;
        }
        break;
      }
      case PSTATE.dejected: {
        locomotion();
        // Hands on head.
        head.rotation.z = -0.25;
        torso.rotation.z = -0.08;
        aL.rotation.set(-0.95, 0, 2.55);
        aR.rotation.set(0.95, 0, 2.55);
        break;
      }
      default:
        // A state this build doesn't know yet (a newer sim): at least keep him running, never frozen stiff.
        locomotion();
        break;
    }
    if (p.signal) {
      const kind = p.signalKind ?? 0;
      if (kind === 1) {
        // Advantage: both arms swept forward, palms up.
        aL.rotation.set(-0.3, 0, 1.45);
        aR.rotation.set(0.3, 0, 1.45);
        head.rotation.z = 0.05;
      } else if (kind === 2) {
        // Card: held up and out to his side (clear of the big head: the card is life-size-ish, so it no
        // longer pokes up above it), the other arm pointing at him.
        aR.rotation.set(0.62, 0, 3.0);
        aL.rotation.set(-0.15, 0, 1.2);
        torso.rotation.z = 0.06;
        head.rotation.z = 0.12;
      } else {
        aR.rotation.set(0.2, 0, 3.0);
        head.rotation.z = 0.1;
      }
    }
    // Heads follow the ball (eased: no snap when he gets the ball or it passes behind him); bodies bank
    // into turns (faded in with speed, never switched on).
    const upright = p.state === PSTATE.move || p.state === PSTATE.hold || p.state === PSTATE.stand;
    const want = upright ? clamp(p.look, -1.2, 1.2) * (p.hasBall ? 0.35 : 0.85) : 0;
    this.headYaw = dt > 0 ? this.headYaw + (want - this.headYaw) * Math.min(1, dt * 12) : want;
    head.rotation.y = this.headYaw;
    if (upright) {
      torso.rotation.y += clamp(p.look, -1, 1) * 0.12;
      body.rotation.x = clamp(-p.turn * 0.045 * run, -0.3, 0.3) * smoothstep(1, 2, p.speed);
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    this.fadeMat?.dispose();
    this.tintMat?.dispose();
  }
}

/**
 * Ball skins (progression unlocks; SessionOptions.ballSkin): the base colour, the patch colour and how big
 * the patches are (the dot-product threshold: lower = bigger). 'classic' is the white ball with dark pentagons.
 */
export const BALL_SKINS = ['classic', 'retro', 'blaze', 'ice', 'neon', 'gold'] as const;
export type BallSkin = (typeof BALL_SKINS)[number];
const BALL_LOOK: Record<BallSkin, { base: number; patch: number; size: number }> = {
  classic: { base: 0xfbfbf6, patch: 0x26262e, size: 0.9 },
  // Telstar: bigger black hexes on white.
  retro: { base: 0xffffff, patch: 0x111114, size: 0.8 },
  blaze: { base: 0xff7a1a, patch: 0xd8241a, size: 0.86 },
  ice: { base: 0xf2fbff, patch: 0x3aa0ff, size: 0.88 },
  neon: { base: 0x4bff6a, patch: 0x17301c, size: 0.86 },
  gold: { base: 0xffc23a, patch: 0x8a5a00, size: 0.88 },
};
/** A known skin id (anything else, undefined included, is the classic ball). */
export function ballSkinOf(id: string | undefined): BallSkin {
  return (BALL_SKINS as readonly string[]).includes(id ?? '') ? (id as BallSkin) : 'classic';
}
const ballGeoCache = new Map<string, THREE.BufferGeometry>();

/** Voxel ball: an 8³ sphere with patches (a skin's colours; cached per radius and skin). */
export function buildBallGeometry(radius: number, skin: BallSkin = 'classic'): THREE.BufferGeometry {
  const key = `${radius}:${skin}`;
  const cached = ballGeoCache.get(key);
  if (cached) return cached;
  const look = BALL_LOOK[skin];
  const n = 8;
  const g = new VoxelGrid(n, n, n);
  const c = (n - 1) / 2;
  const phi = (1 + Math.sqrt(5)) / 2;
  const ico = [
    [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
    [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
    [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
  ].map(([x, y, z]) => {
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l];
  });
  const r = n / 2;
  for (let x = 0; x < n; x++)
    for (let y = 0; y < n; y++)
      for (let z = 0; z < n; z++) {
        const dx = x - c, dy = y - c, dz = z - c;
        const d = Math.hypot(dx, dy, dz);
        if (d > r - 0.05) continue;
        let col = look.base;
        const l = d || 1;
        for (const v of ico) {
          if ((dx * v[0] + dy * v[1] + dz * v[2]) / l > look.size) col = look.patch;
        }
        g.set(x, y, z, col);
      }
  const s = (radius * 2) / n;
  const geo = meshVoxels(g, { scale: s, pivot: [n / 2, n / 2, n / 2], faceTint: true });
  ballGeoCache.set(key, geo);
  return geo;
}
