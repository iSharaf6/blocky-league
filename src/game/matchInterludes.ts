import type { SceneShot } from '../render/cameraRig';
import { HALF_W } from '../sim/constants';
import { PF, STATE_CODE } from './replay';

/** Short, local match stories. These place only the drawn frame; the football simulation waits untouched. */
export type MatchInterludeKind = 'halftime' | 'return' | 'sportsmanship';
export const INTERLUDE_SECONDS: Readonly<Record<MatchInterludeKind, number>> = {
  halftime: 3.2, return: 2.6, sportsmanship: 3,
};
export const INTERLUDE_SKIP_GRACE = 0.3;
/** The covered passage between the dugouts. Its mouth is in front of the stadium's advertising boards. */
export const TUNNEL_MOUTH_Z = HALF_W + 0.6;
export const TUNNEL_HIDE_Z = TUNNEL_MOUTH_Z + 0.8;
const WALK_START_Z = HALF_W - 4.4;
const ROW_GAP = 1.45;
const LANE_X = 1.3;
const TALL = 1.9;
const CLAP = 13;
const FIVE = 4;

const unit = (v: number): number => Math.max(0, Math.min(1, v));
const ease = (v: number): number => { const k = unit(v); return k * k * (3 - 2 * k); };

export class MatchInterlude {
  age = 0;
  done = false;
  private met = false;
  readonly cast: readonly [readonly number[], readonly number[]];

  constructor(readonly kind: MatchInterludeKind, home: readonly number[], away: readonly number[]) {
    // A lineup snapshot belongs to this scene. A later substitution cannot change the actors halfway through it.
    this.cast = [[...home], [...away]];
  }

  get fraction(): number { return unit(this.age / INTERLUDE_SECONDS[this.kind]); }
  get tunnel(): boolean { return this.kind !== 'sportsmanship'; }
  get actors(): number[] { return [...this.cast[0], ...this.cast[1]]; }

  /** `press` is a new edge, never a held gameplay action. The menu's opening tap cannot skip the return scene. */
  tick(dt: number, press: boolean): boolean {
    if (this.done) return true;
    this.age += Math.max(0, Math.min(dt, 0.1));
    this.done = this.age >= INTERLUDE_SECONDS[this.kind] || (this.age > INTERLUDE_SKIP_GRACE && press);
    return this.done;
  }

  /** A single palm-contact cue for the post-match greeting, even after a dropped rendering frame. */
  takeGreeting(): boolean {
    if (this.kind !== 'sportsmanship' || this.met || this.fraction < 0.45) return false;
    this.met = true;
    return true;
  }
}

/** Capture the captain first, keeping absent / sent-off actors out of the scene. */
export function interludeOrder(idxs: readonly number[], captain: number): number[] {
  return idxs.includes(captain) ? [captain, ...idxs.filter((i) => i !== captain)] : [...idxs];
}

/** Clear ball actions before giving an actor a presentation pose. Position and all action state stay local. */
function actor(f: Float32Array, idx: number, x: number, z: number, facing: number, speed: number, time: number, style = 0): void {
  const o = idx * PF;
  f[o] = x;
  f[o + 1] = z;
  f[o + 2] = 0;
  f[o + 3] = facing;
  f[o + 4] = style ? STATE_CODE.celebrate : STATE_CODE.move;
  f[o + 5] = time;
  f[o + 6] = (time * speed / 2.4 + idx * 0.37) % 1;
  f[o + 7] = style ? 0 : speed;
  f[o + 8] = 0;
  f[o + 10] = 0;
  f[o + 12] = 0;
  f[o + 13] = style;
  f[o + 14] = 0;
}

/** Two files walk into the passage at the break, then emerge and jog back onto the grass after the team talk. */
export function applyInterlude(f: Float32Array, scene: MatchInterlude, time: number): void {
  const k = scene.fraction;
  if (scene.tunnel) {
    const leaving = scene.kind === 'halftime';
    // Linear travelling speed means boots never freeze halfway through a stride. The camera alone eases.
    const lead = leaving
      ? WALK_START_Z + (TUNNEL_HIDE_Z + 0.4 - WALK_START_Z) * k
      : TUNNEL_MOUTH_Z + 0.2 - (TUNNEL_MOUTH_Z + 0.2 - WALK_START_Z) * k;
    const speed = (TUNNEL_HIDE_Z + 0.4 - WALK_START_Z) / INTERLUDE_SECONDS[scene.kind];
    for (const side of [0, 1] as const) {
      scene.cast[side].forEach((idx, row) => {
        const z = lead + (leaving ? -1 : 1) * row * ROW_GAP;
        // Once inside the roof, he is in the dressing-room passage, never rendered through its back wall / stands.
        actor(f, idx, side === 0 ? -LANE_X : LANE_X, z > TUNNEL_HIDE_Z ? HALF_W + 80 : z,
          leaving ? Math.PI / 2 : -Math.PI / 2, speed, time);
      });
    }
    return;
  }

  // The opposing captains meet first. Their teammates form parallel greeting lines behind them.
  const meet = ease(k / 0.42);
  const leave = ease((k - 0.58) / 0.42);
  for (const side of [0, 1] as const) {
    const sign = side === 0 ? -1 : 1;
    scene.cast[side].forEach((idx, row) => {
      const x = sign * (3.1 - 2.5 * meet) - sign * leave * 3.4;
      const z = HALF_W - 12 - row * 2.1 + sign * leave * 0.65;
      const hand = k >= 0.38 && k <= 0.59;
      const applause = k > 0.78;
      actor(f, idx, x, z, applause ? Math.PI / 2 : side === 0 ? 0 : Math.PI,
        k < 0.38 || (k > 0.59 && !applause) ? 2 : 0, time, hand ? FIVE : applause ? CLAP : 0);
    });
  }
}

/** Low sideline lenses, always in front of the advertising boards; no full-stadium pan back to the centre. */
export function interludeShot(scene: MatchInterlude, out: SceneShot, tall = TALL): SceneShot {
  const k = ease(scene.fraction);
  if (scene.tunnel) {
    const leaving = scene.kind === 'halftime';
    const follow = leaving ? k : 1 - k;
    out.px = -6.8 + 0.8 * k;
    out.py = tall * 0.76;
    out.pz = HALF_W - 9.4 + follow * 1.2;
    out.tx = 0;
    out.ty = tall * 0.67;
    out.tz = WALK_START_Z + follow * 2.9;
    out.fov = 38;
  } else {
    out.px = -3.2 + k * 0.65;
    out.py = tall * 0.65;
    out.pz = HALF_W - 5.9 - k * 0.2;
    out.tx = 0;
    out.ty = tall * 0.58;
    out.tz = HALF_W - 12.8;
    out.fov = 36;
  }
  return out;
}
