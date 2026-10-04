/**
 * Staged shots: the moments a player sees his own gear (and the other club's) big. Presentation only: the sim is
 * never touched, so nothing here can split an online match. The session (game/matchSession.ts) runs them:
 *
 * - THE LINE-UP, before the kick-off (LINEUP_S, a tap skips it): your XI shoulder to shoulder by the far touchline,
 *   the lens dollying along the row at chest height and ending on the captain (his armband, hair and headgear), with
 *   your mascot behind him at a home match. Then the usual fly-in, from part way in.
 * - A SUBSTITUTION, when play next stops (subBeatS each, a tap skips the lot): the lens on the near touchline by the
 *   dugouts, the man coming off jogs to the line and high-fives the man coming on, the fourth official's board up
 *   beside them (render/subScene.ts draws the two men, the official and the board).
 * - MAN OF THE MATCH, at full time (MOTM_S, a tap skips it): a close-up of him, arms up if his side didn't lose,
 *   applauding the fans if it did, the lens pushing in.
 *
 * This file is the choreography (where everyone stands and what the lens sees at a given moment), with no drawing
 * in it, so the tests can check it. Positions are written into the DRAWN frame (MatchView.frameHook), never the sim.
 */
import type { SceneShot } from '../render/cameraRig';
import { HALF_L, HALF_W } from '../sim/constants';
import type { Side } from '../sim/types';
import { PF, STATE_CODE } from './replay';

/** Pose styles (render/characters.ts CELEB): the arms-up hop, and applause. */
const STYLE_ARMS_UP = 4;
const STYLE_CLAP = 13;
const TO_CAMERA = Math.PI / 2;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number): number => {
  const k = clamp01((v - a) / (b - a));
  return k * k * (3 - 2 * k);
};
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

// ------------------------------------------------------------------ the line-up

/** Seconds on the line-up, and where in the fly-in (0..1) the picture picks up after one that was watched through. */
export const LINEUP_S = 3;
export const LINEUP_INTRO_FROM = 0.4;
/** The row: its z (5.5 m in from the far touchline, the far stand behind it), the first man's x and the gap. */
const ROW_Z = -(HALF_W - 5.5);
const ROW_X0 = 0.9;
const ROW_GAP = 1.35;
/**
 * The lens, in heights of a standing player (`tall`, the draw scale's head height: players are drawn bigger on a
 * phone): this far in front of the row, a low lens looking almost level, 30 degrees. Boots to hair fill about half
 * the frame's height, the boots clear of the caption along the bottom, an arms-up hop still inside the top; seven
 * men across an iPhone.
 */
const ROW_LENS = 3.9;
const ROW_LENS_Y = 0.5;
const ROW_AIM_Y = 0.42;
/** A standing player's height (m) when the session doesn't say (render/characters.ts CHAR_H). */
const TALL = 1.9;
/** The dolly runs for this share of the shot, then holds on the captain. */
const ROW_DOLLY = 0.82;

/** Where man `i` of `n` stands (the last one is the captain: the dolly ends on him, by the mascot's corner). */
export function lineupSpot(i: number, n: number, out: { x: number; z: number } = { x: 0, z: 0 }): { x: number; z: number } {
  void n;
  out.x = ROW_X0 - i * ROW_GAP;
  out.z = ROW_Z;
  return out;
}

/**
 * The line-up's order: the XI as it is (`idxs`, the side's player indices in slot order) with the captain (`captain`,
 * a player index, or -1) moved to the end of the row.
 */
export function lineupOrder(idxs: readonly number[], captain: number): number[] {
  const out = idxs.filter((i) => i !== captain);
  if (idxs.includes(captain)) out.push(captain);
  return out;
}

/** The dolly at `k` (0..1 through the shot): eased along the row, held on the last man. `tall`: a player's height (m). */
export function lineupShot(k: number, n: number, out: SceneShot, tall = TALL): SceneShot {
  const e = smooth(0, ROW_DOLLY, k);
  const x = lerp(ROW_X0 - 2, ROW_X0 - (n - 1) * ROW_GAP + 0.6, e);
  // (The lens leads its aim a little: the row recedes across the frame instead of standing flat to it.)
  out.px = x + 1.2;
  out.py = ROW_LENS_Y * tall;
  out.pz = ROW_Z + ROW_LENS * tall;
  out.tx = x - 0.6;
  out.ty = ROW_AIM_Y * tall;
  out.tz = ROW_Z;
  out.fov = 30;
  return out;
}

/**
 * Stand the XI in its row in the drawn frame `f`: facing the lens, still, and the man the lens is on (and the captain
 * through the hold) with his arms up. `order`: player indices along the row; `k`: 0..1 through the shot.
 */
export function applyLineup(f: Float32Array, order: readonly number[], k: number, time: number): void {
  const n = order.length;
  const e = smooth(0, ROW_DOLLY, k);
  const at = e * (n - 1);
  for (let i = 0; i < n; i++) {
    const o = order[i] * PF;
    f[o] = ROW_X0 - i * ROW_GAP;
    f[o + 1] = ROW_Z;
    f[o + 2] = 0;
    f[o + 3] = TO_CAMERA;
    f[o + 6] = (time * 0.6 + i * 0.37) % 1;
    f[o + 7] = 0;
    f[o + 8] = 0;
    f[o + 10] = 0;
    f[o + 12] = 0;
    f[o + 14] = 0;
    // The man in the middle of the frame greets the lens; the captain keeps it up through the hold.
    const lit = Math.abs(i - at) < 0.75 || (i === n - 1 && k > ROW_DOLLY - 0.08);
    // (Idle is the 'move' state at no speed: 'stand' is a man getting up off the grass.)
    f[o + 4] = lit ? STATE_CODE.celebrate : STATE_CODE.move;
    f[o + 5] = time;
    f[o + 13] = lit ? STYLE_ARMS_UP : 0;
  }
}

// ------------------------------------------------------------------ a substitution

/** One change is this long on screen; several share SUB_TOTAL_S between them, never under SUB_MIN_S each. */
export const SUB_S = 2.5;
export const SUB_TOTAL_S = 6;
export const SUB_MIN_S = 1;
/** The most changes shown in one stoppage (the rest get the event flag only). */
export const SUB_MAX_SHOWN = 6;

/** Seconds each of `n` changes gets when they play back to back. */
export function subBeatS(n: number): number {
  const k = Math.max(1, Math.min(SUB_MAX_SHOWN, Math.floor(n)));
  return Math.max(SUB_MIN_S, Math.min(SUB_S, SUB_TOTAL_S / k));
}

/** The near touchline by a side's dugout (home's is on the -x side: render/stadium.ts): where the change is made. */
export function subSpotX(side: Side): number {
  return side === 0 ? -3.2 : 3.2;
}

/** Where one man is in the change, and what he is doing. */
export interface SubMan {
  x: number;
  z: number;
  facing: number;
  /** Drawn speed (m/s): 0 standing, a jog otherwise. */
  speed: number;
  /** His right arm up for the high five. */
  arm: boolean;
}

export interface SubStage {
  off: SubMan;
  on: SubMan;
  /** The fourth official (his board is held up beside him, facing the lens) and the board's centre. */
  official: { x: number; z: number; facing: number };
  board: { x: number; y: number; z: number };
  /** The high five has just landed (true from its moment on). */
  met: boolean;
  shot: SceneShot;
}

export function newSubStage(): SubStage {
  const man = (): SubMan => ({ x: 0, z: 0, facing: 0, speed: 0, arm: false });
  return {
    off: man(), on: man(), official: { x: 0, z: 0, facing: 0 }, board: { x: 0, y: 0, z: 0 }, met: false,
    shot: { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0, fov: 30 },
  };
}

/** The high five lands this far (0..1) through a change; arms go up from SUB_ARM_FROM to SUB_ARM_TO. */
export const SUB_MEET = 0.5;
const SUB_ARM_FROM = 0.38;
const SUB_ARM_TO = 0.66;
const LINE_Z = HALF_W + 0.15;

/**
 * A change at `k` (0..1): the man coming off jogs out to the line, the two meet palms (their right hands, so they
 * pass right shoulder to right shoulder), then the new man runs on, at the lens, and the old one walks to the bench.
 * The lens sits on the pitch looking out at the touchline, the dugout and the stand behind: you see the number on
 * the back of the man going off and the face and kit of the man coming on. `tall`: a standing player's height (m) at
 * the draw scale (the gaps, the board and the lens all go by it).
 */
export function subStage(k: number, side: Side, out: SubStage, tall = TALL): SubStage {
  const u = tall / TALL;
  const ex = subSpotX(side);
  // Towards the dugout (away from the halfway line).
  const out_ = side === 0 ? -1 : 1;
  const arrive = smooth(0, SUB_MEET - 0.04, k);
  const leave = smooth(SUB_MEET + 0.1, 1, k);
  const off = out.off;
  // He jogs out from the pitch, meets his mate a stride inside the line, then walks on to the bench.
  off.x = ex + 0.32 * u + out_ * 1.5 * leave;
  off.z = lerp(LINE_Z - 4.4, LINE_Z - 0.5 * u, arrive) + 2.3 * leave;
  off.facing = leave > 0.05 ? Math.atan2(2.3, out_ * 1.5) : TO_CAMERA;
  off.speed = k < SUB_MEET - 0.04 ? 3.6 : leave > 0.02 && leave < 0.98 ? 2 : 0;
  off.arm = k > SUB_ARM_FROM && k < SUB_ARM_TO;
  const on = out.on;
  // He waits on the line facing the pitch, then runs on (towards the lens: the last frames are his).
  on.x = ex - 0.32 * u;
  on.z = lerp(LINE_Z + 0.45 * u, LINE_Z - 2.8, leave);
  on.facing = -TO_CAMERA;
  on.speed = leave > 0.02 && leave < 0.98 ? 4.4 : 0;
  on.arm = k > SUB_ARM_FROM && k < SUB_ARM_TO;
  out.met = k >= SUB_MEET;
  // The fourth official stands on the halfway side of them, square to the pitch, the board up beside his head.
  const fx = ex - out_ * 3 * u;
  out.official.x = fx;
  out.official.z = LINE_Z + 0.8;
  out.official.facing = -TO_CAMERA;
  // (Beside his raised right hand, which is on his +x side as he faces the pitch.)
  out.board.x = fx + 0.35 * u;
  out.board.y = tall * 1.22;
  out.board.z = LINE_Z + 0.65;
  // The lens: on the pitch, on the dugout side of them and looking across towards the official, drifting in. (From
  // the halfway side the man coming off would walk straight up the sight line to his mate and hide him.) Boots clear
  // of the caption along the bottom, the board inside the top.
  const s = out.shot;
  const drift = smooth(0, 1, k);
  s.px = ex + out_ * (1.7 - 0.3 * drift);
  s.py = tall * 0.56;
  s.pz = LINE_Z - tall * (3.7 - 0.25 * drift);
  s.tx = ex - out_ * 1.15 * u;
  s.ty = tall * 0.5;
  s.tz = LINE_Z + 0.2;
  s.fov = 32;
  return out;
}

/** The caption under a change: "OFF 9 CINDER, ON 14 TUFFET" (the HUD draws the two halves red and green). */
export function subCaption(off: { number: number; name: string }, on: { number: number; name: string }): { off: string; on: string; text: string } {
  const sur = (n: string): string => (n.trim().split(/\s+/).pop() ?? n).toUpperCase();
  const a = `OFF ${off.number} ${sur(off.name)}`;
  const b = `ON ${on.number} ${sur(on.name)}`;
  return { off: a, on: b, text: `${a}, ${b}` };
}

// ------------------------------------------------------------------ the man of the match

/** Seconds on the man of the match before the result screen (a tap skips it). */
export const MOTM_S = 2.6;

/**
 * Where the man of the match stands for his close-up: where he is, pulled in from the near touchline and the goal
 * lines so the lens (on the main-stand side of him) is always over grass.
 */
export function motmSpot(x: number, z: number, out: { x: number; z: number } = { x: 0, z: 0 }): { x: number; z: number } {
  out.x = Math.max(-(HALF_L - 4), Math.min(HALF_L - 4, x));
  out.z = Math.max(-(HALF_W - 3), Math.min(HALF_W - 9, z));
  return out;
}

/**
 * The close-up at `k` (0..1): from the front and a little to one side, pushing in; boots to hair in the frame, and
 * he stands in the right-hand half of it (his caption has the bottom left).
 */
export function motmShot(k: number, x: number, z: number, tall: number, out: SceneShot): SceneShot {
  const e = smooth(0, 1, k);
  const d = lerp(3.1, 2.7, e) * tall;
  out.px = x - 0.2;
  out.py = tall * 0.6;
  out.pz = z + d;
  out.tx = x - 0.24 * d;
  out.ty = tall * 0.5;
  out.tz = z;
  out.fov = 30;
  return out;
}

/** Pose him in the drawn frame: square to the lens, arms up (or applauding the fans after a defeat). */
export function applyMotm(f: Float32Array, idx: number, x: number, z: number, lost: boolean, time: number): void {
  const o = idx * PF;
  f[o] = x;
  f[o + 1] = z;
  f[o + 2] = 0;
  // (Square to the lens, which stands in front of him and a step to his right.)
  f[o + 3] = Math.atan2(5, -0.2);
  f[o + 4] = STATE_CODE.celebrate;
  f[o + 5] = time;
  f[o + 6] = (time * 0.5) % 1;
  f[o + 7] = 0;
  f[o + 8] = 0;
  f[o + 10] = 0;
  f[o + 12] = 0;
  f[o + 13] = lost ? STYLE_CLAP : STYLE_ARMS_UP;
  f[o + 14] = 0;
}
