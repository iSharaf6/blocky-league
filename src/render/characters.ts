import * as THREE from 'three';
import { clamp, lerp, smoothstep, wrapAngle } from '../core/math';
import { grassLike } from '../meta/data';
import type { Kit, Look, PlayerDef } from '../sim/types';
import { designOf, paintArm, paintLeg, paintTorso, type KitDesign, type StyledKit } from './kitDesigns';
import { armbandCell, bootCell, gloveCell, headgearGeometry, isHeadgear, paintHair, shadesGeometry, wristCell } from './looks';
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

/**
 * The premium kit materials' clock (s) and night glow (0 by day .. 1 under the floodlights): shared by every player's
 * kit material (render/kitDesigns.ts FX), so no per-player material or texture is ever made for a kit.
 */
const kfxTime = { value: 0 };
const kfxGlow = { value: 0 };

/**
 * The per-voxel kit materials (render/voxel.ts `fx`, render/kitDesigns.ts FX), on top of the character shading: 1 gold
 * foil (a bright sweep runs over it and its edges catch the light), 2 glows at night, 3 iridescent (the colour shifts
 * with the angle), 4 always lit (light up boots, a halo), 5 twinkling stars, 6 flickering flames.
 */
const KFX_GLSL = `
  int kfx = int(vKfx + 0.5);
  if (kfx > 0) {
    vec3 kV = normalize(vViewPosition);
    float kNdv = abs(dot(normal, kV));
    if (kfx == 1) {
      float kBand = smoothstep(0.78, 1.0, 0.5 + 0.5 * sin(vKfxW.x * 2.4 + vKfxW.y * 3.6 + vKfxW.z * 2.0 - uKfxTime * 3.4));
      float kRim = pow(1.0 - kNdv, 2.0);
      diffuseColor.rgb *= 0.8;
      totalEmissiveRadiance += diffuseColor.rgb * (0.32 + 1.5 * kBand + 0.7 * kRim) + vec3(1.0, 0.95, 0.82) * kBand * 0.3;
    } else if (kfx == 2) {
      totalEmissiveRadiance += diffuseColor.rgb * uKfxGlow * (1.5 + 0.3 * sin(uKfxTime * 4.0));
    } else if (kfx == 3) {
      float kH = (1.0 - kNdv) * 1.4 + uKfxTime * 0.22 + (vKfxW.y + vKfxW.x * 0.5) * 0.7;
      vec3 kRb = 0.5 + 0.5 * cos(6.2832 * (kH + vec3(0.0, 0.33, 0.67)));
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * (0.5 + kRb * 0.95), 0.8);
      totalEmissiveRadiance += kRb * diffuseColor.rgb * (0.2 + 0.5 * uKfxGlow);
    } else if (kfx == 4) {
      totalEmissiveRadiance += diffuseColor.rgb * (0.75 + 0.45 * sin(uKfxTime * 7.0 + vKfxW.x * 2.0 + vKfxW.z * 2.0)) * (1.0 + uKfxGlow);
    } else if (kfx == 5) {
      float kTw = sin(uKfxTime * 5.0 + dot(vKfxW, vec3(37.1, 17.3, 23.9)));
      totalEmissiveRadiance += diffuseColor.rgb * (max(0.0, kTw) * 1.3 + uKfxGlow * 1.1);
    } else if (kfx == 6) {
      float kFl = 0.5 + 0.5 * sin(uKfxTime * 11.0 + vKfxW.y * 9.0 + vKfxW.x * 5.0 + vKfxW.z * 3.0);
      totalEmissiveRadiance += diffuseColor.rgb * (0.3 + 0.65 * kFl) * (0.6 + uKfxGlow);
    }
  }
`;

/** Vertex-coloured Lambert (like voxelMaterial) plus the camera-side and sky character fills (`kfx`: and the kit materials). */
function makeCharMaterial(kfx = false): THREE.MeshLambertMaterial {
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
    if (kfx) {
      sh.uniforms.uKfxTime = kfxTime;
      sh.uniforms.uKfxGlow = kfxGlow;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aFx;\nvarying float vKfx;\nvarying vec3 vKfxW;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvKfx = aFx;\nvKfxW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uKfxTime;\nuniform float uKfxGlow;\nvarying float vKfx;\nvarying vec3 vKfxW;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${KFX_GLSL}`);
    }
  };
  m.customProgramCacheKey = () => (kfx ? 'char-fill-hemi-wb-kfx' : 'char-fill-hemi-wb');
  return m;
}

/** The footballers' (and referee's, and ball's) shared opaque material. */
export const charMaterial = makeCharMaterial();

/**
 * The one material every premium kit, player look and boot shares (geometry with an `aFx` attribute: see
 * render/voxel.ts): one shader, one draw state, however many players wear premium kits.
 */
export const kitFxMaterial = makeCharMaterial(true);

/** The right shared material for a character geometry: the kit material when it carries per-voxel fx. */
export function charMaterialFor(geo: THREE.BufferGeometry): THREE.MeshLambertMaterial {
  return geo.getAttribute('aFx') ? kitFxMaterial : charMaterial;
}

/** How strongly the glowing kit parts light up (0 by day, about 0.35 at sunset, 1 in a night match). */
export function setKitGlow(k: number): void {
  kfxGlow.value = Math.max(0, Math.min(1.5, k));
}

/**
 * The kit materials' clock: moved on by every footballer that wears one as it is posed (no per-frame hook needed),
 * and by the stadium style's kit-material props (render/stadiumStyle.ts).
 */
export function tickKitFx(): void {
  kfxTime.value = (performance.now() % 3.6e6) / 1000;
}

/**
 * Hit flash (a tackled man, a keeper making a save): the whole figure white for a frame or two, still faintly
 * shaded so it reads as the player lit up, not a cut-out. Shared by everyone who flashes.
 */
let flashMaterial: THREE.MeshLambertMaterial | null = null;
function charFlashMaterial(): THREE.MeshLambertMaterial {
  if (!flashMaterial) {
    flashMaterial = makeCharMaterial();
    flashMaterial.color.setHex(0xffffff);
    flashMaterial.emissive.setRGB(0.82, 0.82, 0.8);
  }
  return flashMaterial;
}

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
  /** A premium kit design (render/kitDesigns.ts) drawn instead of the classic pattern; never on a keeper. */
  design: KitDesign | null;
  /** Player looks worn by everyone on the side: boots, and (keepers) gloves (render/looks.ts). */
  bootLook?: string;
  gloveLook?: string;
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
  const looks = (kit as StyledKit).looks;
  const bootLook = looks?.boots;
  if (keeper) {
    const gk = grassSafeKeeper(kit);
    return { shirt: gk, shirt2: shade(gk, 0.8), pattern: 'plain', shorts: shade(gk, 0.55), socks: gk, gloves: 0xf6f4ec, design: null, bootLook, gloveLook: looks?.gloves };
  }
  return { shirt: kit.shirt, shirt2: kit.shirt2, pattern: kit.pattern, shorts: kit.shorts, socks: kit.socks, gloves: null, design: designOf(kit), bootLook };
}

function buildTorso(o: Outfit, number: number): THREE.BufferGeometry {
  const g = new VoxelGrid(TORSO_D, TORSO_H, TORSO_W);
  if (o.design) {
    // A premium kit: its own painted pattern, collar, shorts and stripe; the number in its own ink.
    paintTorso(g, o.design, SHORTS);
    paintNumber(g, number, o.design.ink);
    return meshVoxels(g, { scale: VU, pivot: [TORSO_D / 2, 0, TORSO_W / 2] });
  }
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
  paintNumber(g, number, ink);
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

/** The shirt number on the back (x = 0): two 3x5 digits fill the 5 shirt rows. */
function paintNumber(g: VoxelGrid, number: number, ink: number): void {
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
}

/** A cell from a look (render/looks.ts): a colour, or a colour and its kit material. */
function setCell(g: VoxelGrid, x: number, y: number, z: number, c: number | readonly [number, number]): void {
  if (typeof c === 'number') g.set(x, y, z, c);
  else g.set(x, y, z, c[0], c[1]);
}

/**
 * An arm: the kit's sleeve and cuff, or a keeper's gloves. `band` (the captain's left arm: an armband look) and
 * `wrist` (his sweatbands) paint over the sleeve and cuff.
 */
function buildArm(o: Outfit, skin: number, band?: string, wrist?: string): THREE.BufferGeometry {
  // 3 deep x 5 long x 2 wide: two-row sleeve + cuff, two-row hand.
  const g = new VoxelGrid(3, ARM_L, 2);
  const sleeve = o.pattern === 'sleeves' ? o.shirt2 : o.shirt;
  if (o.design && o.gloves === null) paintArm(g, o.design, skin, 2);
  else {
    for (let y = 0; y < ARM_L; y++) {
      let c = y >= 2 ? sleeve : skin;
      if (o.gloves !== null) c = y <= 1 ? o.gloves : o.shirt;
      g.box(0, y, 0, 3, 1, 2, c);
    }
    if (o.gloves === null) g.box(0, 2, 0, 3, 1, 2, shade(sleeve, 0.86)); // cuff
  }
  for (let x = 0; x < 3; x++) {
    for (let z = 0; z < 2; z++) {
      if (o.gloves !== null && o.gloveLook) {
        for (let y = 0; y < 2; y++) {
          const c = gloveCell(o.gloveLook, x, y, z);
          if (c !== null) setCell(g, x, y, z, c);
        }
      }
      const b = armbandCell(band, x, z);
      if (b !== null) setCell(g, x, 3, z, b);
      const w = wristCell(wrist, x, z);
      if (w !== null && o.gloves === null) setCell(g, x, 2, z, w);
    }
  }
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
  // A premium kit's shorts, stripe and socks; the side's boots look over his own boots.
  if (o.design) paintLeg(g, o.design, skin);
  if (o.bootLook) {
    for (let x = 0; x < 3; x++) {
      for (let z = 0; z < 3; z++) {
        const c = bootCell(o.bootLook, x, z);
        if (c !== null) setCell(g, x, 0, z, c);
      }
    }
  }
  return meshVoxels(g, { scale: VU, pivot: [1, LEG_H, 1.5] });
}

function buildHead(look: Look, hairLook?: string): THREE.BufferGeometry {
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
  // The captain's premium hair (render/looks.ts) in place of his own style.
  const premium = !!hairLook && paintHair(hairLook, (x, y, z, c, fx) => g.set(x + OX, y, z + OZ, c, fx ?? 0), hair);
  if (!premium) switch (look.hair % 9) {
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
 * states, if and when it has them; until then a strike at a sprint gets its plant step inside 'kick'. 13 / 14 are
 * the SKILL poses (sim/skills.ts): a skill move (diveDir: which, SKILL_MOVE; kickT its 0..1 progress; kickLeg the
 * roulette's side) and a defender winding up his challenge, the tell (kickT its 0..1 progress).
 */
export const PSTATE = {
  move: 0, kick: 1, slide: 2, fallen: 3, stand: 4, dive: 5, hold: 6, throw: 7, celebrate: 8, dejected: 9, stumble: 11, plant: 12,
  skill: 13, load: 14,
} as const;

/** The skill moves by their frame code (sim/skills.ts SKILL_CODE). */
const SKILL_MOVE = { roulette: 1, rainbow: 2, stepover: 3, dragback: 4, elastico: 5, croqueta: 6, nutmeg: 7, heelchop: 8, ballroll: 9 } as const;

/**
 * Celebration styles (frame channel 13, PoseInput.celebrate). 0-3 are the sim's scorer styles (arms-up hop,
 * cradle, sit-down, spin) and 4-5 the mob's arms-up hop; from `knee` up they are the choreographed iconic
 * moves (render/celebration.ts writes them), which read the move's clock in stateT and its 0..1 progress (the
 * slide, the flip's turn, the drop, the leap) or bank (the aeroplane, right positive) in kickT.
 */
export const CELEB = { armsUp: 4, knee: 5, shush: 6, plane: 7, robot: 8, flip: 9, crouch: 10, flat: 11, dive: 12, clap: 13 } as const;

/**
 * The robot, a pose a beat (all right angles, read from the front): arm L (x, z), arm R (x, z), body yaw,
 * head tilt (roll), leg L out, leg R out, torso pitch, torso roll. Arms: x +-1.55 straight out to the side; "up" is a
 * diagonal (z 2.6 with the raised arm swung outward), since an arm straight up hides behind the big head.
 */
const ROBOT: readonly (readonly number[])[] = [
  [-0.7, 2.6, -1.55, 0, 0, 0.45, 0, 0, 0, 0.22],
  [1.55, 0, 0.7, 2.6, 0, -0.45, 0, 0, 0, -0.22],
  [1.55, 0, -1.55, 0, 0.55, 0, 0.45, 0, 0, 0],
  [-0.7, 2.6, 0.7, 2.6, 0, 0, 0, 0, -0.35, 0],
  [1.55, 0, -1.55, 0, -0.55, 0, 0, -0.45, 0, 0],
  [-0.7, 2.6, 0, 0.1, 0, 0.45, 0, 0, 0.12, -0.22],
];

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
  if (to === PSTATE.load) return BLEND_FAST_S;
  if (to === PSTATE.slide || to === PSTATE.dive) return BLEND_FAST_S;
  if (to === PSTATE.stand && (from === PSTATE.slide || from === PSTATE.fallen || from === PSTATE.dive)) return BLEND_GETUP_S;
  return BLEND_S;
}

/** An action (see BLEND_KICK_S): blended in with an ease-out, never the slow-starting smoothstep. */
function isAction(key: number): boolean {
  const state = key >> 4;
  // (A header while running is the move state's sub-pose 1; a skill move reads from its first frame too.)
  return state === PSTATE.kick || state === PSTATE.slide || state === PSTATE.dive || state === PSTATE.skill ||
    ((state === PSTATE.move || state === PSTATE.stand) && (key & 15) === 1);
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
  /** The four limbs and all six parts, in POSE order (made once: no array per pose), then any look meshes. */
  private readonly limbs: THREE.Mesh[];
  private readonly parts: THREE.Mesh[];
  /** Each part's own material (the shared character or kit material) for when no flash, fade or tint is on. */
  private readonly baseMats: THREE.MeshLambertMaterial[];
  /** Wears a premium kit material somewhere (its clock is moved on as he is posed). */
  private readonly kitFx: boolean;
  /** Wears the side's captain looks (meta/style.ts names him). */
  readonly isCaptain: boolean;
  /** His own headgear look and his celebration shades (render/looks.ts), if the side wears them. */
  private headgear: THREE.Mesh | null = null;
  private shades: THREE.Mesh | null = null;
  /** Hit flash: drawn white while set (see setFlash). */
  private flashing = false;
  /** Casts a dynamic shadow (see setCastShadow: the shadow budget on the lower settings). */
  private casting = true;
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
    // The captain wears the side's hair, headgear and armband looks (meta/style.ts names him); everyone wears its
    // boots, the keepers its gloves, and anyone celebrating its shades.
    const style = kit as StyledKit;
    const looks = style.looks;
    this.isCaptain = !!looks && style.captain === def.id;
    const hairLook = this.isCaptain ? looks!.hair : undefined;
    const band = this.isCaptain && !keeper ? looks!.arm : undefined;
    const wrist = this.isCaptain && !keeper ? looks!.head : undefined;
    const kitKey = `${o.shirt}-${o.shirt2}-${o.pattern}-${o.shorts}-${o.socks}-${o.gloves}${o.design ? `-${o.design.id}` : ''}${o.bootLook ? `-b${o.bootLook}` : ''}${o.gloveLook ? `-g${o.gloveLook}` : ''}`;
    const torsoG = cached(`t-${kitKey}-${def.number}`, () => buildTorso(o, def.number));
    const armG = cached(`a-${kitKey}-${skin}${wrist && wristCell(wrist, 0, 0) ? `-w${wrist}` : ''}`, () => buildArm(o, skin, undefined, wrist));
    const armLG = band ? cached(`a-${kitKey}-${skin}-c${band}-w${wrist ?? ''}`, () => buildArm(o, skin, band, wrist)) : armG;
    const legG = cached(`l-${kitKey}-${skin}-${def.look.boots}`, () => buildLeg(o, skin, def.look.boots));
    const headG = cached(`h-${JSON.stringify(def.look)}${hairLook ? `-${hairLook}` : ''}`, () => buildHead(def.look, hairLook));

    const mk = (g: THREE.BufferGeometry) => {
      const m = new THREE.Mesh(g, charMaterialFor(g));
      m.castShadow = true;
      m.receiveShadow = false;
      return m;
    };
    this.torso = mk(torsoG);
    this.head = mk(headG);
    this.armL = mk(armLG);
    this.armR = mk(armG);
    this.legL = mk(legG);
    this.legR = mk(legG);
    this.limbs = [this.armL, this.armR, this.legL, this.legR];
    this.parts = [this.torso, this.head, this.armL, this.armR, this.legL, this.legR];
    // The captain's headgear and everyone's celebration shades: small meshes on the head (render/looks.ts).
    const hg = this.isCaptain && looks?.head && isHeadgear(looks.head) ? headgearGeometry(looks.head, VU) : null;
    if (hg) {
      this.headgear = mk(hg);
      this.head.add(this.headgear);
      this.parts.push(this.headgear);
    }
    const sg = looks?.shades ? shadesGeometry(looks.shades, VU) : null;
    if (sg) {
      this.shades = mk(sg);
      this.shades.castShadow = false;
      this.shades.visible = false;
      this.head.add(this.shades);
      this.parts.push(this.shades);
    }
    this.baseMats = this.parts.map((m) => m.material as THREE.MeshLambertMaterial);
    this.kitFx = this.baseMats.includes(kitFxMaterial);

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

  /** Hit flash: the figure drawn white (on) or back to its own look (off). Never while faded out of a lens. */
  setFlash(on: boolean): void {
    if (on === this.flashing) return;
    this.flashing = on;
    this.applyMaterial();
  }

  /** Whether this player casts a dynamic shadow (the lower settings cast only the few nearest the ball). */
  setCastShadow(on: boolean): void {
    if (on === this.casting) return;
    this.casting = on;
    for (const m of this.parts) m.castShadow = on && m !== this.shades;
  }

  get castsShadow(): boolean {
    return this.casting;
  }

  private applyMaterial(): void {
    const faded = this.alpha < 1;
    let mat: THREE.MeshLambertMaterial | null = null;
    if (faded) mat = this.fadeMat!;
    else if (this.flashing) mat = charFlashMaterial();
    else if (this.tint !== null) {
      if (!this.tintMat) this.tintMat = makeCharMaterial();
      this.tintMat.color.setHex(this.tint);
      // (A cold glow with the ice tint: a frozen man reads blue whatever his kit, even in his own shadow.)
      this.tintMat.emissive.setHex(this.tintGlow);
      mat = this.tintMat;
    }
    // (Nothing over him: each part goes back to its own shared material, the kit material where it has one.)
    const parts = this.parts;
    for (let i = 0; i < parts.length; i++) parts[i].material = mat ?? this.baseMats[i];
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
    for (const m of this.limbs) {
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
    for (const m of this.limbs) {
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
    else if (p.state === PSTATE.skill) sub = clamp(Math.round(p.diveDir), 0, 15);
    else if (p.state === PSTATE.kick) sub = Math.abs(p.kickLeg) > 1.5 && p.headerT <= 0 ? 1 : p.headerT > 0 ? 2 : 0;
    else if (p.state === PSTATE.celebrate) {
      const st = Math.round(p.celebrate);
      // The iconic styles (CELEB.knee and up) own their locomotion: one key whatever the speed.
      sub = st >= CELEB.knee ? Math.min(15, 1 + st) : p.speed < 1.2 ? 1 + Math.max(0, st) : 0;
    }
    if (p.signal) sub = 8 + (p.signalKind ?? 0);
    return p.state * 16 + sub;
  }

  /**
   * Procedural pose from the recorded sim state, identical live and in replays. A change of state is never a
   * snap: the limbs cross-fade from the last drawn pose over ~0.1 s (BLEND_S), a strike taken at a sprint
   * plants first, and the head turns towards the ball at a human rate.
   */
  pose(p: PoseInput, time: number): void {
    if (this.kitFx) tickKitFx();
    // Shades on while he celebrates (the side's shades look).
    if (this.shades) this.shades.visible = p.state === PSTATE.celebrate;
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

    switch (p.state) {
      case PSTATE.move:
      case PSTATE.stand: {
        this.locomotion(p, time, dt, ph, run, swing);
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
          this.locomotion(p, time, dt, ph, run, swing);
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
        } else this.plantStep(fast * (1 - smoothstep(0.18, 0.42, t)), plant, null);
        break;
      }
      case PSTATE.plant: {
        // (Sim plant state, when it has one: braking into the strike that follows.)
        this.locomotion(p, time, dt, ph, run, swing);
        const right = p.kickLeg >= 0;
        this.plantStep(smoothstep(0, 0.12, p.stateT), right ? lL : lR, right ? lR : lL);
        break;
      }
      case PSTATE.stumble: {
        // (Sim stumble state, when it has one: pitched forward, arms thrown out, feet scrambling.)
        this.locomotion(p, time, dt, ph, run, swing);
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
        this.locomotion(p, time, dt, ph, run, swing);
        aL.rotation.set(-0.25, 0, 1.25);
        aR.rotation.set(0.25, 0, 1.25);
        break;
      }
      case PSTATE.celebrate: {
        const st = Math.round(p.celebrate);
        if (st >= CELEB.knee) {
          this.iconic(st, p, time, dt, ph, run, swing);
          break;
        }
        this.locomotion(p, time, dt, ph, run, swing);
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
      case PSTATE.skill:
        this.skillMove(p, time, dt, ph, run, swing);
        break;
      case PSTATE.load: {
        // A defender winding up his challenge (the tell): sunk into a crouch, weight forward over the ball, arms
        // out low and wide, a quiver through him as he coils, then he goes.
        this.locomotion(p, time, dt, ph, run, swing);
        const k = smoothstep(0, 0.3, p.kickT);
        body.position.y -= 0.13 * k;
        body.position.x = Math.sin(time * 46) * 0.025 * k;
        torso.rotation.z -= 0.42 * k;
        head.rotation.z += 0.3 * k;
        lL.rotation.x = 0.22 * k;
        lR.rotation.x = -0.22 * k;
        lL.rotation.z = lerp(lL.rotation.z, 0.25, k);
        lR.rotation.z = lerp(lR.rotation.z, -0.3, k);
        aL.rotation.set(lerp(aL.rotation.x, 0.85, k), 0, lerp(aL.rotation.z, 0.55, k));
        aR.rotation.set(lerp(aR.rotation.x, -0.85, k), 0, lerp(aR.rotation.z, 0.55, k));
        break;
      }
      case PSTATE.dejected: {
        this.locomotion(p, time, dt, ph, run, swing);
        // Hands on head.
        head.rotation.z = -0.25;
        torso.rotation.z = -0.08;
        aL.rotation.set(-0.95, 0, 2.55);
        aR.rotation.set(0.95, 0, 2.55);
        break;
      }
      default:
        // A state this build doesn't know yet (a newer sim): at least keep him running, never frozen stiff.
        this.locomotion(p, time, dt, ph, run, swing);
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

  /**
   * The iconic celebrations (CELEB.knee and up; see render/celebration.ts for who does what when). Model
   * axes: +x forward, +y up, the left arm at -z. Euler order is Z (lift forward / up), then Y, then X (swing
   * sideways): a hanging arm swings outward with +x on the left and -x on the right; a raised one the other way.
   */
  /**
   * Idle and running blend continuously with speed (no snap from the stand to the stride at a threshold),
   * eased over time too: the sim gets a man from a standstill to a run in a few frames. (A method, not a
   * closure made per pose: nothing allocated per player per frame.)
   */
  private locomotion(p: PoseInput, time: number, dt: number, ph: number, run: number, swing: number): void {
    const body = this.body, torso = this.torso, head = this.head;
    const aL = this.armL, aR = this.armR, lL = this.legL, lR = this.legR;
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
  }

  /**
   * A braking plant step (0..1): the standing leg reaching ahead, hips sinking, torso back, arms out;
   * `kickLeg` (the sim's own plant state only) also trails the kicking leg, ready to swing.
   */
  /**
   * The SKILL moves (sim/skills.ts), over their 0..1 progress (kickT): the ROULETTE's full turn with a sole on the
   * ball each half, the RAINBOW FLICK's heel kicked up behind, the STEPOVER's two legs circling the ball with the
   * hips swaying after them, the DRAG BACK's sole rolling it back under him, the ELASTICO's boot out and snapped back
   * in, LA CROQUETA's quick foot to foot hop, the NUTMEG's toe poke low through the legs, the HEEL CHOP's boot whipped
   * behind the standing leg as he turns away, the BALL ROLL's sole dragging it across him. The side (the stick's,
   * kickLeg) mirrors the side moves.
   */
  private skillMove(p: PoseInput, time: number, dt: number, ph: number, run: number, swing: number): void {
    const body = this.body, torso = this.torso, head = this.head;
    const aL = this.armL, aR = this.armR, lL = this.legL, lR = this.legR;
    const u = clamp(p.kickT, 0, 1);
    const kind = Math.round(p.diveDir);
    this.locomotion(p, time, dt, ph, run * 0.3, swing * 0.3);
    if (kind === SKILL_MOVE.roulette) {
      // A whole turn (the way he slips: kickLeg), low over the ball, arms out for balance.
      const e = smoothstep(0.04, 0.96, u);
      body.rotation.y = -(p.kickLeg >= 0 ? 1 : -1) * Math.PI * 2 * e;
      const a = Math.sin(clamp(u / 0.5, 0, 1) * Math.PI);
      const b = Math.sin(clamp((u - 0.5) / 0.5, 0, 1) * Math.PI);
      lR.rotation.z = 0.6 * a - 0.25 * b;
      lL.rotation.z = 0.6 * b - 0.25 * a;
      body.position.y = HIP_Y - 0.07 * Math.sin(u * Math.PI);
      torso.rotation.z = -0.18;
      aL.rotation.set(1.05, 0, 0.35);
      aR.rotation.set(-1.05, 0, 0.35);
      head.rotation.z = 0.2;
    } else if (kind === SKILL_MOVE.rainbow) {
      // Rolled up the back of the standing leg, then the heel kicks it up and over: a hop as it goes. (The heel is at the top
      // of its kick as the ball leaves it: sim/skills.ts FLICK_AT, ~0.3 of the move.)
      const roll = smoothstep(0, 0.2, u);
      const kick = Math.sin(clamp((u - 0.08) / 0.45, 0, 1) * Math.PI);
      lR.rotation.z = lerp(0.35 * roll, -2.1, kick);
      lL.rotation.z = -0.15 + 0.2 * kick;
      torso.rotation.z = -0.25 - 0.3 * kick;
      head.rotation.z = -0.35 * kick;
      body.position.y = HIP_Y + 0.12 * kick;
      aL.rotation.set(0.7 + 0.4 * kick, 0, 0.8 + 0.9 * kick);
      aR.rotation.set(-0.7 - 0.4 * kick, 0, 0.8 + 0.9 * kick);
    } else if (kind === SKILL_MOVE.stepover) {
      // Two stepovers, right then left: the leg lifts and circles out round the ball, the hips sway after it.
      const first = u < 0.5;
      const k = first ? u / 0.5 : (u - 0.5) / 0.5;
      const s = first ? 1 : -1;
      const leg = first ? lR : lL;
      const lift = Math.sin(k * Math.PI);
      leg.rotation.z = 0.75 * lift;
      leg.rotation.x = -s * 0.75 * Math.sin(k * Math.PI * 2) - s * 0.2 * lift;
      body.rotation.x = s * 0.28 * lift;
      torso.rotation.y = s * 0.35 * lift;
      body.position.y = HIP_Y - 0.06;
      aL.rotation.set(0.5 + 0.4 * lift * (first ? 0 : 1), 0, 0.25);
      aR.rotation.set(-0.5 - 0.4 * lift * (first ? 1 : 0), 0, 0.25);
    } else if (kind === SKILL_MOVE.elastico) {
      // Out with the outside of the boot, then snapped back in across the body: the hips follow it, arms flung wide.
      const s = p.kickLeg >= 0 ? 1 : -1;
      const leg = s > 0 ? lL : lR;
      const out = Math.sin(clamp(u / 0.4, 0, 1) * Math.PI * 0.5);
      const snap = smoothstep(0.35, 0.8, u);
      const sweep = lerp(-0.55 * out, 0.6, snap) * s;
      leg.rotation.z = 0.45 + 0.2 * Math.sin(u * Math.PI);
      leg.rotation.x = sweep;
      body.rotation.x = -0.6 * sweep * 0.45;
      torso.rotation.y = 0.35 * sweep;
      body.position.y = HIP_Y - 0.05;
      aL.rotation.set(0.9, 0, 0.6);
      aR.rotation.set(-0.9, 0, 0.6);
      head.rotation.z = 0.12;
    } else if (kind === SKILL_MOVE.croqueta) {
      // Foot to foot: a quick hop across, the ball tapped from one boot to the other.
      const s = p.kickLeg >= 0 ? 1 : -1;
      const a = Math.sin(clamp(u / 0.5, 0, 1) * Math.PI);
      const b = Math.sin(clamp((u - 0.45) / 0.55, 0, 1) * Math.PI);
      lR.rotation.x = s * (0.45 * a - 0.15 * b);
      lL.rotation.x = s * (0.45 * b - 0.15 * a);
      lR.rotation.z = 0.25 * a;
      lL.rotation.z = 0.25 * b;
      body.rotation.x = -s * 0.22 * Math.sin(u * Math.PI);
      body.position.y = HIP_Y + 0.06 * Math.sin(u * Math.PI);
      torso.rotation.z = -0.12;
      aL.rotation.set(1.1, 0, 0.4);
      aR.rotation.set(-1.1, 0, 0.4);
    } else if (kind === SKILL_MOVE.nutmeg) {
      // A low toe poke straight through: the boot out along the grass, the body bent over it, then off round him.
      const poke = Math.sin(clamp(u / 0.75, 0, 1) * Math.PI);
      lR.rotation.z = 1.05 * poke - 0.1;
      lL.rotation.z = -0.2 * poke;
      torso.rotation.z = -0.3 * poke;
      head.rotation.z = -0.25 * poke;
      body.position.y = HIP_Y - 0.08 * poke;
      aL.rotation.set(0.4 + 0.5 * poke, 0, -0.5 * poke);
      aR.rotation.set(-0.4 - 0.5 * poke, 0, -0.5 * poke);
    } else if (kind === SKILL_MOVE.heelchop) {
      // Planted, the boot whipped behind the standing leg, and the body swung round the other way after it.
      const s = p.kickLeg >= 0 ? 1 : -1;
      const leg = s > 0 ? lR : lL;
      const chop = Math.sin(clamp(u / 0.6, 0, 1) * Math.PI);
      leg.rotation.z = -0.85 * chop;
      leg.rotation.x = -s * 0.55 * chop;
      body.rotation.y = s * 0.9 * smoothstep(0.2, 0.95, u);
      body.position.y = HIP_Y - 0.06 * chop;
      torso.rotation.z = 0.15 * chop;
      aL.rotation.set(0.8, 0, 0.5 + 0.3 * chop);
      aR.rotation.set(-0.8, 0, 0.5 + 0.3 * chop);
    } else if (kind === SKILL_MOVE.ballroll) {
      // The sole on top of it, rolled across in front of him as he side-steps after it.
      const s = p.kickLeg >= 0 ? 1 : -1;
      const leg = s > 0 ? lL : lR;
      const roll = smoothstep(0.05, 0.85, u);
      leg.rotation.z = 0.55 * Math.sin(Math.min(1, u * 1.2) * Math.PI);
      leg.rotation.x = s * lerp(-0.25, 0.5, roll);
      body.rotation.x = -s * 0.18 * Math.sin(u * Math.PI);
      body.position.y = HIP_Y - 0.04;
      aL.rotation.set(0.7, 0, 0.45);
      aR.rotation.set(-0.7, 0, 0.45);
    } else {
      // DRAG BACK: the sole on top of it, drawn back under him as he leans back off it.
      const pull = smoothstep(0.08, 0.72, u);
      lR.rotation.z = lerp(0.7, -0.4, pull);
      lL.rotation.z = -0.12;
      body.rotation.z = 0.16 * Math.sin(u * Math.PI);
      torso.rotation.z = 0.1;
      aL.rotation.set(0.6, 0, 0.5);
      aR.rotation.set(-0.6, 0, 0.5);
    }
  }

  private plantStep(w: number, plant: THREE.Mesh, kickLeg: THREE.Mesh | null): void {
    if (w <= 0) return;
    plant.rotation.z = lerp(plant.rotation.z, 0.42, w);
    if (kickLeg) kickLeg.rotation.z = lerp(kickLeg.rotation.z, -0.45, w * 0.7);
    this.body.position.y -= 0.04 * w;
    this.torso.rotation.z += 0.16 * w;
    this.head.rotation.z -= 0.1 * w;
    this.armL.rotation.x -= 0.35 * w;
    this.armR.rotation.x += 0.35 * w;
  }

  private iconic(st: number, p: PoseInput, time: number, dt: number, ph: number, run: number, swing: number): void {
    const body = this.body, torso = this.torso, head = this.head;
    const aL = this.armL, aR = this.armR, lL = this.legL, lR = this.legR;
    const t = p.stateT;
    const x = p.kickT;
    switch (st) {
      case CELEB.knee: {
        // Onto one knee over the first third of the slide, pitched back, the leading leg out along the grass,
        // arms flung wide; as the slide dies (progress past 1) the arms sweep up.
        const s = clamp(x * 3.5, 0, 1);
        const up = clamp((x - 1) * 2.5, 0, 1);
        body.position.y = HIP_Y - 0.2 * s;
        body.rotation.z = 0.5 * s;
        lR.rotation.z = 1.2 * s;
        lL.rotation.z = -1.35 * s;
        lL.rotation.x = 0.3 * s;
        aL.rotation.set(lerp(1.5, -0.4, up) * s, 0, lerp(0.6, 2.75, up) * s);
        aR.rotation.set(lerp(-1.5, 0.4, up) * s, 0, lerp(0.6, 2.75, up) * s);
        head.rotation.z = 0.3 * s;
        torso.rotation.z = 0.12 * s;
        break;
      }
      case CELEB.shush: {
        // The shush, big enough to read from the gantry: planted, the finger to the lips, the other arm thrown
        // straight up at the crowd (a diagonal: straight up hides behind the head) with a slow wave, the whole
        // body leaning into the lens (kickT 0..1 is the lean), the head cocked.
        this.locomotion(p, time, dt, ph, run, swing);
        const l = clamp(x, 0, 1);
        aR.rotation.set(-0.95, 0, lerp(0.6, 2.35, l));
        aL.rotation.set(lerp(1.3, -0.75 + 0.18 * Math.sin(t * 3.2), l), 0, lerp(0.5, 2.7, l));
        body.rotation.z = -0.14 * l;
        torso.rotation.z = -0.3 * l;
        head.rotation.z = -0.16 * l;
        head.rotation.x = 0.22 * l;
        break;
      }
      case CELEB.plane: {
        // Aeroplane: running with the arms out, banked into the turn (kickT -1..1, right positive).
        this.locomotion(p, time, dt, ph, run, swing);
        aL.rotation.set(1.5, 0, 0.35);
        aR.rotation.set(-1.5, 0, 0.35);
        torso.rotation.x = x * 0.6;
        torso.rotation.z = -0.25;
        head.rotation.x = -x * 0.3;
        break;
      }
      case CELEB.robot: {
        // Stiff poses snapped every 0.25 s: no cross-fade within the key, which is the point.
        const beat = Math.floor(t / 0.25);
        const R = ROBOT[((beat % ROBOT.length) + ROBOT.length) % ROBOT.length];
        aL.rotation.set(R[0], 0, R[1]);
        aR.rotation.set(R[2], 0, R[3]);
        body.rotation.y = R[4];
        head.rotation.x = R[5];
        lL.rotation.x = R[6];
        lR.rotation.x = R[7];
        torso.rotation.z = R[8];
        torso.rotation.x = R[9];
        break;
      }
      case CELEB.flip: {
        // Backflip: a full turn backwards about the hips over the jump (kickT 0..1), eased so the tuck at the
        // top is the fast part; the arms swing up on take-off and hug the knees in the tuck.
        const u = clamp(x, 0, 1);
        const tuck = Math.sin(Math.PI * u);
        body.rotation.z = Math.PI * 2 * (0.5 - 0.5 * Math.cos(Math.PI * u));
        lL.rotation.z = lR.rotation.z = 1.6 * tuck;
        torso.rotation.z = -0.55 * tuck;
        head.rotation.z = -0.3 * tuck;
        const armZ = lerp(2.7, 1.3, tuck);
        aL.rotation.set(-0.2 * (1 - tuck), 0, armZ);
        aR.rotation.set(0.2 * (1 - tuck), 0, armZ);
        break;
      }
      case CELEB.crouch: {
        // A deep crouch (kickT 0 deep .. 1 standing): the wind-up before the flip and the stuck landing.
        const c = 1 - clamp(x, 0, 1);
        body.position.y = HIP_Y - 0.2 * c;
        lL.rotation.set(0.3 * c, 0, 0.4 * c);
        lR.rotation.set(-0.3 * c, 0, -0.3 * c);
        torso.rotation.z = -0.5 * c;
        head.rotation.z = 0.35 * c;
        aL.rotation.set(0.9 * c, 0, -0.9 * c);
        aR.rotation.set(-0.9 * c, 0, -0.9 * c);
        break;
      }
      case CELEB.flat: {
        // Flat on his back (kickT 0..1 is the drop), arms spread past his head, waiting for the pile.
        const d = clamp(x, 0, 1);
        body.rotation.z = 1.55 * d;
        body.position.y = HIP_Y - (HIP_Y - 0.16) * d;
        aL.rotation.set(-0.7 * d, 0, 2.5 * d);
        aR.rotation.set(0.7 * d, 0, 2.5 * d);
        lL.rotation.set(0.25 * d, 0, 0.15 * d);
        lR.rotation.set(-0.25 * d, 0, 0);
        head.rotation.z = -0.2 * d;
        break;
      }
      case CELEB.dive: {
        // Superman onto the pile: laid out face down (kickT 0..1 is the leap), arms reaching, head up.
        const d = clamp(x, 0, 1);
        body.rotation.z = lerp(-0.6, -1.5, d);
        body.position.y = lerp(HIP_Y - 0.05, 0.2, d);
        aL.rotation.set(-0.15, 0, lerp(2.6, 1.7, d));
        aR.rotation.set(0.15, 0, lerp(2.6, 1.7, d));
        lL.rotation.z = -0.25 * d + Math.sin(time * 6) * 0.1 * d;
        lR.rotation.z = -0.1 * d;
        head.rotation.z = 0.4 * d;
        torso.rotation.z = 0.1 * d;
        break;
      }
      case CELEB.clap:
      default: {
        // Applause from the ones hanging back: hands meeting in front (a yaw brings them together), a bob.
        this.locomotion(p, time, dt, ph, run, swing);
        const c = 0.5 + 0.5 * Math.sin(t * 16 + p.runPhase * 5);
        aL.rotation.set(0, -0.25 - 0.5 * c, 1.4);
        aR.rotation.set(0, 0.25 + 0.5 * c, 1.4);
        body.position.y -= 0.02 * c;
        head.rotation.z = 0.06;
        break;
      }
    }
  }

  /**
   * Where headgear sits (his head: add a mesh made by render/looks.ts headgearGeometry to it). render/matchView.ts
   * moves the side's roaming headgear on to whoever is controlled.
   */
  get headAnchor(): THREE.Object3D {
    return this.head;
  }

  /** He wears his own headgear look (the captain): a roaming copy would only double it. */
  get hasHeadgear(): boolean {
    return this.headgear !== null;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.fadeMat?.dispose();
    this.tintMat?.dispose();
  }
}

/**
 * Ball skins (progression unlocks and SHOP looks; SessionOptions.ballSkin). Each is painted cell by cell on a
 * voxel sphere, so a look can be a pattern (the classic pentagons, beach ball gores, an eight ball's number) or
 * a shape (ice spikes, a cut gem, a planet's ring, a melon's stalk). 'classic' is the white ball with dark
 * pentagons. Ids are saved and owned: add new ones at the end, never rename or remove one (core/save.ts
 * BALL_SKIN_IDS lists the same ids).
 */
export const BALL_SKINS = ['classic', 'retro', 'blaze', 'ice', 'neon', 'gold', 'diamond', 'beach', 'melon', 'hoops', 'eight', 'moon', 'disco', 'planet'] as const;
export type BallSkin = (typeof BALL_SKINS)[number];

/** The 12 pentagon centres of a football (icosahedron vertices, unit length). */
const ICO: readonly (readonly [number, number, number])[] = (() => {
  const phi = (1 + Math.sqrt(5)) / 2;
  return [
    [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
    [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
    [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
  ].map(([x, y, z]) => {
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l] as const;
  });
})();

/** The closest and second-closest pentagon centres' dot products with unit direction (ux, uy, uz). */
function icoDots(ux: number, uy: number, uz: number): [number, number] {
  let a = -2, b = -2;
  for (const v of ICO) {
    const d = ux * v[0] + uy * v[1] + uz * v[2];
    if (d > a) {
      b = a;
      a = d;
    } else if (d > b) b = d;
  }
  return [a, b];
}

/** A cheap, fixed hash of a cell (0..1): speckle, tiles, sparkle. */
const cellHash = (x: number, y: number, z: number): number => {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
};

interface BallLook {
  /** Cells across the ball itself (8: the chunky classic). */
  n: number;
  /** Extra cells of grid all round (for spikes, a stalk, a ring). */
  pad: number;
  /**
   * The colour of cell (x, y, z) (integers from the grid centre), at unit direction (ux, uy, uz) and `d` cells
   * out, on a ball `r` cells in radius: null leaves it empty. Cells past the ball's surface are asked too.
   */
  paint: (ux: number, uy: number, uz: number, d: number, r: number, x: number, y: number, z: number) => number | null;
}

/** Only the ball itself (nothing outside its surface). */
const sphere = (fn: BallLook['paint']): BallLook['paint'] => (ux, uy, uz, d, r, x, y, z) => (d > r - 0.05 ? null : fn(ux, uy, uz, d, r, x, y, z));

/** The football: `base` with pentagon patches of `patch` (dot threshold `size`: lower = bigger patches). */
const panels = (base: number, patch: number, size: number): BallLook['paint'] =>
  sphere((ux, uy, uz) => (icoDots(ux, uy, uz)[0] > size ? patch : base));

export const BALL_LOOK: { readonly [k in BallSkin]: BallLook } = {
  classic: { n: 8, pad: 0, paint: panels(0xfbfbf6, 0x26262e, 0.9) },
  // Retro: an old brown leather ball, panels stitched in threes, and its laces.
  retro: {
    n: 10, pad: 0, paint: sphere((ux, uy, uz, _d, _r, x, y, z) => {
      const ax = Math.abs(ux), ay = Math.abs(uy), az = Math.abs(uz);
      const m = Math.max(ax, ay, az);
      // The face this cell is on, and the two coordinates across it (turned face to face, like the real thing).
      const p = m === ax ? uy : m === ay ? uz : ux;
      const q = m === ax ? uz : m === ay ? ux : uy;
      if (m === ay && uy > 0 && Math.abs(ux) < 0.12 && Math.abs(uz) < 0.42) return (Math.round(z) & 1) === 0 ? 0xf4e1c6 : 0x4a2a16;
      const edge = m - Math.max(Math.abs(p), Math.abs(q)) < 0.1;
      const seam = Math.abs(Math.abs(p) / m - 0.36) < 0.1;
      if (edge || seam) return 0x4a2a16;
      return cellHash(x, y, z) < 0.25 ? 0x9a6234 : 0xb87a44;
    }),
  },
  // Magma: dark cooled rock, lava glowing through the cracks between the plates.
  blaze: {
    n: 10, pad: 0, paint: sphere((ux, uy, uz, _d, _r, x, y, z) => {
      const [a, b] = icoDots(ux, uy, uz);
      const gap = a - b;
      if (gap < 0.035) return 0xffd23a;
      if (gap < 0.09) return 0xff7a1a;
      return cellHash(x, y, z) < 0.3 ? 0x4a3430 : 0x2e2220;
    }),
  },
  // Frozen: frosted ice with icicle spikes standing out of it.
  ice: {
    n: 8, pad: 1, paint: (ux, uy, uz, d, r, x, y, z) => {
      if (d <= r - 0.05) {
        const frost = Math.sin(uy * 7 + ux * 3) > 0.55;
        return frost ? 0xa8e4ff : cellHash(x, y, z) < 0.25 ? 0xffffff : 0xdff4ff;
      }
      if (d > r + 1.3) return null;
      return icoDots(ux, uy, uz)[0] > 0.965 ? 0xeaf8ff : null;
    },
  },
  // Neon: a black ball with glowing green grid lines, like a light cycle.
  neon: {
    n: 10, pad: 0, paint: sphere((ux, uy, uz) => {
      const lon = Math.atan2(uz, ux);
      const seg = (lon / (Math.PI / 3)) % 1;
      const onLon = Math.abs(seg) < 0.12 || Math.abs(seg) > 0.88;
      const onLat = Math.abs(uy) < 0.11 || Math.abs(Math.abs(uy) - 0.62) < 0.1;
      return onLon || onLat ? 0x4bff6a : 0x15181e;
    }),
  },
  // Gold: polished, a bright highlight and engraved panels.
  gold: {
    n: 8, pad: 0, paint: sphere((ux, uy, uz) => {
      const lit = (-ux + uy + uz) / Math.sqrt(3);
      if (lit > 0.8) return 0xfff0b0;
      if (icoDots(ux, uy, uz)[0] > 0.92) return 0xd99a1e;
      return lit < -0.45 ? 0xe0a82a : 0xffc23a;
    }),
  },
  // Diamond: a cut gem, facets in white and ice blue (the ball's corners cut flat).
  diamond: {
    n: 8, pad: 0, paint: (ux, uy, uz, d, r, x, y, z) => {
      if (d > r - 0.05) return null;
      const cut = (Math.abs(x) + Math.abs(y) + Math.abs(z)) / r;
      if (cut > 1.32) return null;
      if (cellHash(x, y, z) < 0.12) return 0xffffff;
      return [0xeafcff, 0xb8ecff, 0x7fdcff][((ux > 0 ? 1 : 0) + (uy > 0 ? 1 : 0) + (uz > 0 ? 1 : 0)) % 3];
    },
  },
  // Beach ball: six gores pole to pole, white caps.
  beach: {
    n: 10, pad: 0, paint: sphere((ux, uy, uz) => {
      if (Math.abs(uy) > 0.86) return Math.abs(uy) > 0.97 ? 0xec4a3e : 0xfbfbf4;
      const seg = Math.floor(((Math.atan2(uz, ux) + Math.PI) / (Math.PI * 2)) * 6) % 6;
      return [0xec4a3e, 0xfbfbf4, 0x2f7be8, 0xfbfbf4, 0xffd23a, 0xfbfbf4][seg];
    }),
  },
  // Watermelon: wavy dark stripes on pale green, and a stalk.
  melon: {
    n: 10, pad: 1, paint: (ux, uy, uz, d, r, x, y, z) => {
      if (d > r - 0.05) return d <= r + 1.2 && uy > 0.9 && Math.abs(x) < 1 && Math.abs(z) < 1 ? 0x6a4a2e : null;
      const lon = Math.atan2(uz, ux);
      if (Math.sin(lon * 8 + Math.sin(uy * 6) * 0.9) > 0.3) return 0x1f6b2a;
      return cellHash(x, y, z) < 0.2 ? 0x8fdb6a : 0x6fcf4a;
    },
  },
  // Hoops: a basketball, pebbled orange with black seams.
  hoops: {
    n: 10, pad: 0, paint: sphere((ux, uy, uz, _d, _r, x, y, z) => {
      if (Math.abs(uy) < 0.09 || Math.abs(uz) < 0.09 || Math.abs(Math.abs(ux) - 0.72) < 0.07) return 0x26262e;
      return cellHash(x, y, z) < 0.3 ? 0xd8641a : 0xe8742a;
    }),
  },
  // Eight ball: black and glossy, a white spot with the 8 on it.
  eight: {
    n: 12, pad: 0, paint: sphere((ux, uy, uz) => {
      if (ux > 0.7) {
        const gx = Math.round(uz / 0.14) + 1;
        const gy = 2 - Math.round(uy / 0.12);
        const glyph = ['###', '#.#', '###', '#.#', '###'];
        if (gx >= 0 && gx <= 2 && gy >= 0 && gy <= 4 && glyph[gy][gx] === '#') return 0x15151a;
        return 0xfbfbf4;
      }
      return (-ux + uy + uz) / Math.sqrt(3) > 0.82 ? 0x5a5a66 : 0x15151a;
    }),
  },
  // Moon: grey with dark seas and craters dented into it.
  moon: {
    n: 10, pad: 0, paint: (ux, uy, uz, d, r) => {
      if (d > r - 0.05) return null;
      const craters: readonly (readonly [number, number, number])[] = [[0.6, 0.6, 0.53], [-0.7, 0.2, 0.68], [0.1, -0.8, 0.59], [-0.2, 0.5, -0.84], [0.8, -0.3, -0.5]];
      for (const [cx, cy, cz] of craters) {
        const dot = ux * cx + uy * cy + uz * cz;
        if (dot > 0.95 && d > r - 1.1) return null;
        if (dot > 0.95) return 0x8a8e96;
        if (dot > 0.9) return 0xdfe3e8;
      }
      return Math.sin(ux * 5) * Math.sin(uz * 4 + uy * 2) > 0.35 ? 0x9a9ea6 : 0xc2c6cc;
    },
  },
  // Disco: mirror tiles catching the floodlights, the odd pink or cyan glint.
  disco: {
    n: 10, pad: 0, paint: sphere((_ux, _uy, _uz, _d, _r, x, y, z) => {
      const h = cellHash(x, y, z);
      if (h < 0.05) return 0xff7ad9;
      if (h < 0.1) return 0x5cc8f5;
      return [0xffffff, 0xd8dee8, 0xaab3c2, 0x8a93a3][Math.floor(h * 40) % 4];
    }),
  },
  // Planet: oceans, continents and ice caps, with a tilted ring round it.
  planet: {
    n: 8, pad: 3, paint: (ux, uy, uz, d, r, x, y, z) => {
      if (d <= r - 0.05) {
        if (Math.abs(uy) > 0.8) return 0xfbfbf4;
        const land = Math.sin(ux * 4.2 + uy * 2) + Math.sin(uz * 3.6 - ux * 1.7) > 0.6;
        return land ? (cellHash(x, y, z) < 0.3 ? 0x7ae05a : 0x3cc15a) : 0x2f7be8;
      }
      // The ring: a band of cells round a tilted plane, clear of the ball.
      const nx = 0.32, ny = 0.93, nz = 0.18;
      const off = x * nx + y * ny + z * nz;
      if (d < r + 0.9 || d > r + 2.8 || Math.abs(off) > 0.5) return null;
      return d < r + 1.8 ? 0xe8c890 : 0xc9a46a;
    },
  },
};

/** A known skin id (anything else, undefined included, is the classic ball). */
export function ballSkinOf(id: string | undefined): BallSkin {
  return (BALL_SKINS as readonly string[]).includes(id ?? '') ? (id as BallSkin) : 'classic';
}
const ballGeoCache = new Map<string, THREE.BufferGeometry>();

/** Voxel ball (`radius` m: the ball itself, whatever sticks out of it) in a skin's look; cached per radius and skin. */
export function buildBallGeometry(radius: number, skin: BallSkin = 'classic'): THREE.BufferGeometry {
  const key = `${radius}:${skin}`;
  const cached = ballGeoCache.get(key);
  if (cached) return cached;
  const look = BALL_LOOK[skin] ?? BALL_LOOK.classic;
  const n = look.n;
  const N = n + look.pad * 2;
  const g = new VoxelGrid(N, N, N);
  const c = (N - 1) / 2;
  const r = n / 2;
  for (let x = 0; x < N; x++)
    for (let y = 0; y < N; y++)
      for (let z = 0; z < N; z++) {
        const dx = x - c, dy = y - c, dz = z - c;
        const d = Math.hypot(dx, dy, dz);
        const l = d || 1;
        const col = look.paint(dx / l, dy / l, dz / l, d, r, dx, dy, dz);
        if (col !== null) g.set(x, y, z, col);
      }
  const s = (radius * 2) / n;
  const geo = meshVoxels(g, { scale: s, pivot: [N / 2, N / 2, N / 2], faceTint: true });
  ballGeoCache.set(key, geo);
  return geo;
}
