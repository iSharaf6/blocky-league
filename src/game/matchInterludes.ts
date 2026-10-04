import type { SceneShot } from '../render/cameraRig';
import { HALF_W } from '../sim/constants';
import { PF, STATE_CODE } from './replay';
import { SCENE_STYLE } from './scenePoses';

/** Short, local match stories. These place only the drawn frame; the football simulation waits untouched. */
export type MatchInterludeKind = 'halftime' | 'return' | 'victory' | 'debrief' | 'sportsmanship';
export const INTERLUDE_SECONDS: Readonly<Record<MatchInterludeKind, number>> = {
  halftime: 4, return: 3, victory: 4.2, debrief: 4.6, sportsmanship: 3,
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
  readonly actors: readonly number[];

  constructor(readonly kind: MatchInterludeKind, home: readonly number[], away: readonly number[],
    readonly context: { humanSide?: 0 | 1; leadSide?: 0 | 1 | null } = {}) {
    // A lineup snapshot belongs to this scene. A later substitution cannot change the actors halfway through it.
    this.cast = [[...home], [...away]];
    this.actors = kind === 'victory' || kind === 'debrief' ? this.cast[this.focusSide].slice(0, 5) : [...this.cast[0], ...this.cast[1]];
  }

  get fraction(): number { return unit(this.age / INTERLUDE_SECONDS[this.kind]); }
  get tunnel(): boolean { return this.kind === 'halftime' || this.kind === 'return'; }
  get focusSide(): 0 | 1 { return this.kind === 'debrief' ? this.context.humanSide ?? 0 : this.context.leadSide ?? 0; }

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
function actor(f: Float32Array, idx: number, x: number, z: number, facing: number, speed: number, time: number, style = 0, progress = 0): void {
  const o = idx * PF;
  f[o] = x;
  f[o + 1] = z;
  f[o + 2] = 0;
  f[o + 3] = facing;
  f[o + 4] = style ? STATE_CODE.celebrate : STATE_CODE.move;
  f[o + 5] = time;
  f[o + 6] = (time * speed / 2.4 + idx * 0.37) % 1;
  f[o + 7] = style && style !== SCENE_STYLE.walkTalk ? 0 : speed;
  f[o + 8] = progress;
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
        const buoyant = scene.context.leadSide === null || scene.context.leadSide === undefined || scene.context.leadSide === side;
        const chat = leaving && buoyant && row < 5 && k < 0.84;
        actor(f, idx, (side === 0 ? -LANE_X : LANE_X) + (row % 2 ? 0.28 : -0.28), z > TUNNEL_HIDE_Z ? HALF_W + 80 : z,
          leaving ? Math.PI / 2 : -Math.PI / 2, speed, scene.age + row * 0.3,
          chat ? SCENE_STYLE.walkTalk : 0, chat ? row % 2 ? 0.3 : 0.8 : 0);
      });
    }
    return;
  }

  if (scene.kind === 'victory') {
    scene.actors.forEach((idx, row) => {
      const arrive = ease(k / 0.3);
      const x = row === 0 ? 0 : (row % 2 ? -1 : 1) * (1.4 + Math.floor((row - 1) / 2) * 1.3);
      const z = HALF_W - 11 - (row ? 0.7 : 0) - (1 - arrive) * (row ? 2.4 : 0.4);
      actor(f, idx, x, z, Math.PI / 2 + (row ? Math.sign(x) * 0.18 : 0), k < 0.3 ? 2.2 : 0,
        scene.age + row * 0.2, k < 0.3 ? SCENE_STYLE.walkTalk : row === 0 && k < 0.82 ? FIVE : CLAP, 0.75);
    });
    return;
  }

  if (scene.kind === 'debrief') {
    const settle = ease((k - 0.52) / 0.25);
    scene.actors.forEach((idx, row) => {
      if (row === 1 || row === 2) {
        const sign = row === 1 ? -1 : 1;
        actor(f, idx, sign * (1.25 + settle * 0.8), HALF_W - 11, row === 1 ? 0 : Math.PI,
          0, scene.age + (row === 1 ? 0 : 0.7), settle < 0.9 ? SCENE_STYLE.argue : SCENE_STYLE.walkTalk, 1 - settle);
      } else if (row === 0) {
        // The captain steps between the gesturing pair, palms down: the exchange ends with the team together.
        const in_ = ease((k - 0.28) / 0.42);
        actor(f, idx, 0, HALF_W - 13.7 + in_ * 2.5, Math.PI / 2, in_ > 0 && in_ < 1 ? 1.7 : 0,
          scene.age, SCENE_STYLE.walkTalk, -in_);
      } else {
        actor(f, idx, row === 3 ? -3.1 : 3.1, HALF_W - 12.6, Math.PI / 2, 0, scene.age + row * 0.2);
        f[idx * PF + 4] = STATE_CODE.dejected;
      }
    });
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
  } else if (scene.kind === 'victory' || scene.kind === 'debrief') {
    out.px = -1.4 + k * 0.8;
    out.py = tall * 0.7;
    out.pz = HALF_W - 4.2 - k * 0.35;
    out.tx = 0;
    out.ty = tall * 0.56;
    out.tz = HALF_W - 11.3;
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
