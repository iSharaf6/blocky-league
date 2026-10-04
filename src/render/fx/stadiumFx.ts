import { HALF_L, HALF_W } from '../../sim/constants';
import { DIE, EMIT, F, FX_FIRE, FxKit, rand as r, type Show, type ShowFn } from './kit';
import { SH } from './shapes';

/**
 * STADIUM STYLE shows (render/stadiumStyle.ts plays them on the match's effects kit): the walkout at kick-off and the
 * mascot's confetti breath. They run in a frame laid on the pitch (StadiumDecor plays them at the centre spot facing
 * +x), so u is along the pitch, w across it (+w towards the lens), y up, all in metres times the show's scale.
 * Kid-safe: cartoon bangs and confetti.
 */

const hit = (a: number, b: number, t: number): boolean => a < t && t <= b;
const pc = (s: Show, i: number): number => s.pal[((i % s.pal.length) + s.pal.length) % s.pal.length];
const TAU = Math.PI * 2;
const CANNONS = [-36, -12, 12, 36] as const;
const CANNON_AT = [0, 0.45, 0.9] as const;
const JETS = [-45, -36, -27, -18, -9, 0, 9, 18, 27, 36, 45] as const;
/** The far touchline's ad boards, and behind them the far stand's roof line (where the fireworks go up). */
const FAR = -(HALF_W + 2.6);
const ROCKETS: readonly (readonly [number, number, number])[] = [
  [0, -30, DIE.firework], [0.3, 24, DIE.ringwork], [0.6, -8, DIE.willow], [0.9, 10, DIE.firework], [1.2, -20, DIE.ringwork],
  [1.5, 32, DIE.firework], [1.8, 0, DIE.willow], [2.15, -36, DIE.firework], [2.45, 18, DIE.ringwork],
];

/** A confetti flake: flat, fluttering, tumbling. */
function flake(K: FxKit, u: number, y: number, w: number, vu: number, vy: number, vw: number, col: number, life = 3): void {
  const p = K.add(SH.cube, u, y, w, vu, vy, vw, 0.34, life, col);
  p.sy = 0.12; p.sz = 0.7;
  p.g = 6; p.drag = 1.3; p.term = 2; p.f |= F.SWAY; p.sw = 4;
  FxKit.tumble(p, 9);
}

/** A puff of cannon smoke. */
function puff(K: FxKit, u: number, y: number, w: number, size: number): void {
  const p = K.add(SH.blob, u, y, w, r(-0.4, 0.4), r(0.6, 1.4), r(-0.4, 0.4), size, r(0.8, 1.2), 0xd6dde6);
  p.f |= F.PUFF;
  p.drag = 2;
}

/**
 * A firework rocket from (u, w) climbing on a spark trail and leaning in over the pitch, bursting at about `h` m: low
 * enough that the broadcast shot (which shows only a few metres over the far touchline on a phone) sees the burst.
 */
function rocket(K: FxKit, s: Show, u: number, w: number, die: number, h: number): void {
  const vy = r(15, 17);
  const g = 12;
  const t = Math.min(vy / g - 0.1, Math.max(0.45, (vy - Math.sqrt(Math.max(0, vy * vy - 2 * g * h))) / g));
  const p = K.add(SH.rocket, u, 1, w, r(-2, 2), vy, r(5, 8), 1.2, t, 0xffffff);
  p.g = g; p.f |= F.AIM; p.emit = EMIT.sparks; p.er = 40; p.pal = s.pal; p.die = die;
  K.cue('whoosh');
}

/** A fountain of sparks from the grass at (u, w): a gerb, about 4 m tall (it reads from the broadcast camera). */
function fountain(K: FxKit, s: Show, u: number, w: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const p = K.add(i % 3 ? SH.cube : SH.sparkle, u, 0.3, w, r(-1.4, 1.4), r(7, 10), r(-1.4, 1.4), r(0.16, 0.28), r(0.7, 1.1), pc(s, i));
    p.g = 9; p.drag = 0.8; p.f |= F.TWINK;
    p.delay = r(0, 0.25);
  }
}

/** Confetti falling over the middle of the pitch (where the kick-off shot looks). */
function shower(K: FxKit, s: Show, n: number): void {
  for (let i = 0; i < n; i++) flake(K, r(-16, 16), r(9, 14), r(-12, 8), r(-1, 1), r(-1, 1), r(-1, 1), pc(s, i), r(2.6, 3.6));
}

/** Points round the centre circle (radius 10): the fountains and jets ring the kick-off. */
const RING = Array.from({ length: 8 }, (_, i) => [Math.cos((i / 8) * Math.PI * 2) * 10.5, Math.sin((i / 8) * Math.PI * 2) * 10.5] as const);

/** A jet of flame straight up from the grass at (u, w). */
function jet(K: FxKit, u: number, w: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const p = K.add(SH.cube, u + r(-0.3, 0.3), 0.3, w + r(-0.3, 0.3), r(-0.8, 0.8), r(10, 15), r(-0.8, 0.8), r(0.45, 0.75), r(0.45, 0.75), FX_FIRE[0]);
    p.f |= F.PUFF | F.AGE;
    p.pal = FX_FIRE;
    p.g = 4;
    p.drag = 1.2;
    p.delay = i * 0.012;
    FxKit.tumble(p, 5);
  }
  K.add(SH.glow, u, 2, w, 0, 0, 0, 3.4, 0.16, 0xffd23a);
}

/** CONFETTI WALKOUT: cannons along both touchlines fire three rounds of club confetti over the pitch, and it rains down. */
const kickConfetti: ShowFn = (K, s, a, b) => {
  if (hit(a, b, 0.2)) shower(K, s, 180);
  for (let k = 0; k < CANNON_AT.length; k++) {
    if (!hit(a, b, CANNON_AT[k])) continue;
    for (const side of [-1, 1]) {
      for (const u of CANNONS) {
        const w = side * (HALF_W + 1);
        for (let i = 0; i < 26; i++) flake(K, u + k * 3, 0.8, w, r(-3, 3), r(9, 15), -side * r(4, 9), pc(s, i + k));
        puff(K, u + k * 3, 0.8, w, 1.4);
      }
    }
    K.cue('pop');
  }
};

/**
 * FIREWORKS WALKOUT: spark fountains ring the centre circle, and a volley of rockets from the far touchline bursts over the
 * ground in club colours (the fly-in's high shot sees the bursts; the kick-off shot the fountains).
 */
const kickFireworks: ShowFn = (K, s, a, b) => {
  // (This show runs at k 1.6: positions in its units, so the bursts are big.)
  for (const [t, u, die] of ROCKETS) if (hit(a, b, t)) rocket(K, s, u / 1.6, FAR / 1.6, die, 8);
  for (const at of [0, 0.9, 1.8]) {
    if (!hit(a, b, at)) continue;
    for (const [u, w] of RING) fountain(K, s, u / 1.6, w / 1.6, 26);
  }
  if (hit(a, b, 0.05)) K.cue('boom');
};

/** PYRO SHOW: flame jets race down the far touchline and round the centre circle, all go up together, then the fireworks. */
const kickPyro: ShowFn = (K, s, a, b) => {
  for (let i = 0; i < JETS.length; i++) {
    if (hit(a, b, i * 0.07)) jet(K, JETS[i], FAR, 18);
    if (hit(a, b, 1.05)) jet(K, JETS[i], FAR, 26);
  }
  for (let i = 0; i < RING.length; i++) {
    if (hit(a, b, 0.3 + i * 0.08)) jet(K, RING[i][0], RING[i][1], 14);
    if (hit(a, b, 1.05)) jet(K, RING[i][0], RING[i][1], 20);
  }
  if (hit(a, b, 1.05)) K.cue('boom');
  for (const [t, u, die] of ROCKETS) if (hit(a, b, t + 1.25)) rocket(K, s, u, FAR, die, 13);
};

/** The dragon mascot's breath after a goal: a cone of confetti and sparkles out of its mouth (s.fx is its facing). */
const dragonBreath: ShowFn = (K, s, a, b, dt) => {
  if (b > 1.6) return;
  const n = K.rate(s, 0, 160, dt);
  for (let i = 0; i < n; i++) {
    const sp = r(5, 9);
    const p = K.add(i % 3 ? SH.cube : SH.sparkle, 0.4, 0, 0, sp, r(1, 4), r(-2.2, 2.2), r(0.16, 0.28), r(0.9, 1.4), pc(s, i));
    p.g = 4; p.drag = 1.1; p.f |= F.TWINK;
    if (i % 3) { p.sy = 0.2; FxKit.tumble(p, 8); }
  }
  if (hit(a, b, 0)) K.cue('whoosh');
};

export interface StadiumShowDef {
  dur: number;
  run: ShowFn;
  /** The show's scale (the fireworks go off big over the stand). */
  k: number;
}

/** The kick-off walkout shows by STADIUM STYLE id (core/save.ts DECOR_IDS, slot 'kickoff'). */
export const KICKOFF_SHOWS: { readonly [id: string]: StadiumShowDef } = {
  kickconfetti: { dur: 1.4, run: kickConfetti, k: 1 },
  kickfire: { dur: 2.8, run: kickFireworks, k: 1.6 },
  kickpyro: { dur: 4.2, run: kickPyro, k: 1 },
};

export const DRAGON_BREATH: StadiumShowDef = { dur: 1.8, run: dragonBreath, k: 1 };

/** The far end of the pitch (for anyone placing things relative to the shows). */
export const SHOW_SPAN = HALF_L;

void TAU;
