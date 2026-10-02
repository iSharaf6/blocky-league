import { clamp, smoothstep } from '../core/math';

/**
 * Impact "juice", the numbers and the small state machines behind them (pure: tests/juice.test.ts runs them
 * headless). Every impact the owner listed has to read as impactful and obvious at broadcast distance on a phone:
 *
 * - hit-stop: the drawn picture holds a few 60 Hz frames on the impact (the session holds; the sim is never
 *   touched, its clock just waits),
 * - screen shake: a decaying pixel-space jolt of the whole picture, never more than SHAKE_MAX_PX, off under
 *   reduced motion,
 * - flashes: the ball (white, 1.25x) and the players (a white pulse) on the frame of contact,
 * - the ball's trail, which grows with its pace and changes look with what struck it.
 */

/** Hit-stop lengths, in 60 Hz frames (run as time, so a 120 Hz display holds just as long). */
export const HIT_STOP = {
  /** A firm first-time foot strike: a short pause on contact. */
  firstTime: 2,
  /** A shot off the post / bar (SLOW_POST m/s or less: a softer knock). */
  post: 3,
  postSlow: 2,
  /** A slide tackle that wins the ball. */
  slide: 3,
  /** A standing tackle that wins the ball. */
  tackle: 2,
  /** A real save (a shot on target stopped). */
  save: 2,
  goal: 3,
  /** A PERFECT skill move (timed into a defender's tell: sim/skills.ts): the parry lands on it. */
  skillPerfect: 5,
} as const;
/** A ball hitting the post at or under this pace (m/s) is a knock, not a thunderbolt: the shorter hold and a smaller shake. */
export const SLOW_POST = 16;

/** Screen shake (CSS px of peak displacement) per impact; never more than SHAKE_MAX_PX all together. */
export const SHAKE_PX = {
  firstTime: 2,
  goal: 8,
  post: 6,
  postSlow: 4,
  slide: 5,
  tackleHeavy: 4,
  mega: 6,
  skillPerfect: 3,
} as const;
/**
 * A PERFECT skill move's slow-motion beat after the hold: SKILL_SLOW_S real seconds of play at SKILL_SLOW_RATE x
 * speed (a match against the AI only: an online match keeps the other machine's pace).
 */
export const SKILL_SLOW_S = 0.32;
export const SKILL_SLOW_RATE = 0.45;
export const SHAKE_MAX_PX = 8;
/** Shake decay rate (1/s): ~8 px is down to ~1 px in ~0.25 s. */
const SHAKE_DECAY = 8.5;

/**
 * A decaying pixel-space shake. `add` sets the amplitude (the larger of what is there and the new jolt, never
 * over SHAKE_MAX_PX); `update` advances it and writes the offset (px) for this frame into `out`. The motion is
 * two incommensurate sines per axis, so it reads as a jolt, not a wobble, and it always ends at rest.
 */
export class Shake {
  amp = 0;
  /** Reduced motion: no shake at all. */
  enabled = true;
  private t = 0;
  readonly out = { x: 0, y: 0 };

  add(px: number): void {
    if (!this.enabled) return;
    this.amp = Math.min(SHAKE_MAX_PX, Math.max(this.amp, px));
  }

  update(dt: number): { x: number; y: number } {
    const o = this.out;
    if (!this.enabled || this.amp < 0.05) {
      this.amp = 0;
      o.x = o.y = 0;
      return o;
    }
    this.t += dt;
    const t = this.t;
    // |sin a + sin b| <= 2 per axis; the offset itself (its length) never exceeds amp.
    let x = this.amp * 0.5 * (Math.sin(t * 83) + Math.sin(t * 57 + 1.3));
    let y = this.amp * 0.5 * (Math.sin(t * 71 + 0.4) + Math.sin(t * 49 + 2.1));
    const l = Math.hypot(x, y);
    if (l > this.amp) {
      x *= this.amp / l;
      y *= this.amp / l;
    }
    o.x = x;
    o.y = y;
    this.amp *= Math.exp(-SHAKE_DECAY * dt);
    return o;
  }
}

/** Ball trail: nothing under TRAIL_FROM m/s, full strength from TRAIL_FULL. */
export const TRAIL_FROM = 12;
export const TRAIL_FULL = 30;

/** 0..1 strength of the ball's trail at `speed` m/s. */
export function trailStrength(speed: number): number {
  return smoothstep(TRAIL_FROM, TRAIL_FULL, speed);
}

/**
 * What the trail looks like: 'strike' (white, the default for anything struck), 'long' (a long pass, a lofted
 * ball, a clearance: lighter and longer) and 'glow' (a header, a volley, a first-time strike: a cyan glow).
 */
export type TrailStyle = 'strike' | 'long' | 'glow';

/**
 * The trail style for a kick. `kind`: the sim's KickKind; `y`: the ball's height at contact (a volley is struck
 * off the ground); `firstTime`: struck without the striker having had the ball under control first.
 */
export function kickTrailStyle(kind: string, power: number, y: number, firstTime: boolean): TrailStyle {
  if (kind === 'header') return 'glow';
  if (kind === 'shot') return y > 0.5 || firstTime ? 'glow' : 'strike';
  if (kind === 'lob' || kind === 'clear' || kind === 'keeper' || kind === 'through' || (kind === 'pass' && power >= 0.7)) return 'long';
  return 'strike';
}

/** Trail looks: colours, bit size (m) and life (s) at full strength, and bits per second. */
export const TRAIL_LOOK: Record<TrailStyle, { colors: readonly number[]; size: number; life: number; rate: number }> = {
  strike: { colors: [0xffffff, 0xf4f4ea], size: 0.17, life: 0.19, rate: 85 },
  long: { colors: [0xeef6ff, 0xffffff], size: 0.12, life: 0.4, rate: 56 },
  glow: { colors: [0x5ff6ff, 0xb8fbff, 0xffffff], size: 0.21, life: 0.25, rate: 105 },
};

/** A hard strike: the ball flashes white and pops to BALL_FLASH_SCALE for BALL_FLASH_S. */
export const HARD_STRIKE = 0.7;
export const BALL_FLASH_S = 0.08;
export const BALL_FLASH_SCALE = 1.25;

/** Scale of the ball `t` seconds after a flash started (1.25 at once, back to 1 by BALL_FLASH_S). */
export function ballFlashScale(t: number): number {
  if (!(t >= 0) || t >= BALL_FLASH_S) return 1;
  const u = t / BALL_FLASH_S;
  return 1 + (BALL_FLASH_SCALE - 1) * (1 - u * u);
}

/** Frames a flashed player stays white (a tackled man, a fouled man, a keeper making a save). */
export const PLAYER_FLASH_FRAMES = 2;
export const KEEPER_FLASH_FRAMES = 3;

/** Impact bits (chunky voxel particles) for a hit at `speed` m/s: how many, and how fast they fly. */
export function impactBits(speed: number, base: number, perMs: number, max: number): { n: number; v: number } {
  const n = Math.round(clamp(base + speed * perMs, 0, max));
  return { n, v: clamp(1.5 + speed * 0.22, 1.5, 8) };
}

/**
 * Camera push-in on a big chance (a shot on in and around the box): at most PUSH_IN of the camera distance, and
 * a lean of up to PUSH_LEAN_M towards the goal, eased in fast and out gently (CameraRig).
 */
export const PUSH_IN = 0.08;
export const PUSH_LEAN_M = 3;

/**
 * Crowd heat behind one goal (0 calm .. 1 roaring), from how close the ball is to it (m) and whether the side
 * attacking that goal has it (a carrier bearing down gets them up; a loose ball in the box too).
 */
export function endHeat(ballToGoal: number, attackersHaveIt: boolean, loose: boolean): number {
  const near = 1 - smoothstep(12, 42, ballToGoal);
  const k = attackersHaveIt ? 1 : loose ? 0.75 : 0.35;
  return clamp(near * k, 0, 1);
}
