import { DIE, EMIT, F, FX_DIRT, FX_FIRE, FX_SMOKE, FX_SNOW, FxKit, pick, rand as r, type Show, type ShowFn } from './kit';
import { SH } from './shapes';

/**
 * GOAL EXPLOSIONS: each one its own little show, not a palette. A script runs every frame of its show with the
 * seconds before (a) and after (b) the frame, spawning props through the kit (render/fx/kit.ts) in the goal's
 * frame: u out of the goal towards the pitch (the goal line at u = 0, the net behind it), w across the mouth
 * (posts at +-3.8), y up (the bar at 2.6), all in real metres (the shop's little goal runs them at k = 0.36).
 *
 * Big set pieces stand in the u-y plane, side on to the broadcast gantry, so they read on a phone in the
 * second or two the wide shot holds after a goal (game/matchSession.ts GOAL_FX_WIDE_S). That shot shows about
 * 6 m above the goal line on a landscape phone (the HUD has the top), so each show's big moment happens below
 * ~5.5 m, out over the box, a little towards the lens (Show.cw); only rockets, rain and meteors come from higher.
 * Kid-safe throughout: cartoon bangs, nothing scary.
 */

export interface GoalShowDef {
  /** Seconds the script runs (its particles may linger a little past it). */
  dur: number;
  /** A characteristic moment, for the shop tile's still. */
  still: number;
  /** The shop stage's scale for a show that spreads wide or high (default ui/shopStage.ts STAGE_K). */
  stageK?: number;
  run: ShowFn;
}

const hit = (a: number, b: number, t: number): boolean => a < t && t <= b;
const pc = (s: Show, i: number): number => s.pal[((i % s.pal.length) + s.pal.length) % s.pal.length];
const TAU = Math.PI * 2;
const GRASS = [0x8fcb4c, 0x7dbb3f, 0xa8dc62, 0x6fa838] as const;
const DUST = [0xe9dfc4, 0xd9cfb2, 0xf2ead6] as const;
const ICE = [0xd6f3ff, 0xa8e4ff, 0xeaf8ff] as const;
const GOLD = [0xffd23a, 0xfff0b0, 0xffb300, 0xffffff] as const;
const WATER = [0x2f7be8, 0x5cc8f5, 0xa8e4ff, 0xffffff] as const;
const AUTUMN = [0xe8661a, 0xc7970f, 0xd8241a, 0x8a5a36, 0xffb35c] as const;
const SPARK = [0xffffff, 0xfff0b0, 0xffd23a, 0xff9a1f] as const;
// (Beat tables: module constants, so a script never allocates an array in the frame loop.)
const SIDES = [-1, 1] as const;
const CANNON_AT = [0.14, 0.52, 0.9] as const;
const POPCORN_CUES = [0.1, 0.45, 0.8] as const;
const COIN_CUES = [0, 0.3, 0.6, 0.9] as const;
const WHACKS = [0.35, 0.65] as const;
const JETS = [-3.6, -1.8, 0, 1.8, 3.6] as const;
const JET_CUES = [0, 0.9, 1.5] as const;
const ROCKETS: readonly (readonly [number, number, number])[] = [
  [0, -2, DIE.firework], [0.22, 2.4, DIE.ringwork], [0.45, -0.4, DIE.firework], [0.75, 3.2, DIE.willow], [1.05, -3, DIE.ringwork], [1.3, 0.8, DIE.firework],
];

/** Confetti flakes: flat, fluttering, tumbling. */
function flake(K: FxKit, u: number, y: number, w: number, vu: number, vy: number, vw: number, col: number, life = 2.4): void {
  const p = K.add(SH.cube, u, y, w, vu, vy, vw, 0.3, life, col);
  p.sy = 0.12; p.sz = 0.7;
  p.g = 7; p.drag = 1.4; p.term = 2.2; p.f |= F.SWAY; p.sw = 4;
  FxKit.tumble(p, 9);
}

/** A soft puff (dust, smoke, foam). */
function puff(K: FxKit, u: number, y: number, w: number, vu: number, vy: number, vw: number, size: number, life: number, col: number): void {
  const p = K.add(SH.blob, u, y, w, vu, vy, vw, size, life, col);
  p.f |= F.PUFF;
  p.drag = 2.2;
}

/** A flash of light: brief, and smaller than it sounds (additive light on a night sky reads big). */
function flash(K: FxKit, u: number, y: number, w: number, size: number, col = 0xffffff, life = 0.14): void {
  K.add(SH.glow, u, y, w, 0, 0, 0, size * 0.6, Math.min(life, 0.16), col);
}

/** A ring of dust rolling out over the grass from (u, w). */
function dustRing(K: FxKit, u: number, w: number, n: number, speed: number): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    puff(K, u + Math.cos(a), 0.4, w + Math.sin(a), Math.cos(a) * speed * r(0.8, 1.2), r(0.3, 1.5), Math.sin(a) * speed * r(0.8, 1.2), r(0.6, 1), r(0.7, 1), DUST[i % 3]);
  }
}

/** Sparks out of a point in every direction. */
function sparkBall(K: FxKit, u: number, y: number, w: number, n: number, speed: number, cols: readonly number[]): void {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, e = r(-0.4, 1.3), v = speed * r(0.5, 1);
    const p = K.add(SH.cube, u, y, w, Math.cos(a) * Math.cos(e) * v, Math.sin(e) * v, Math.sin(a) * Math.cos(e) * v, r(0.1, 0.18), r(0.3, 0.6), cols[i % cols.length]);
    p.g = 8; p.drag = 1.5; p.f |= F.TWINK;
  }
}

/** A fire bit rising and going to smoke. */
function fireBit(K: FxKit, u: number, y: number, w: number, vu: number, vy: number, vw: number, size: number, life: number): void {
  const p = K.add(SH.cube, u, y, w, vu, vy, vw, size, life, FX_FIRE[0]);
  p.f |= F.PUFF | F.AGE;
  p.pal = FX_FIRE;
  p.g = 6;
  p.drag = 1.3;
  FxKit.tumble(p, 4);
}

/** A firework rocket from (u, w) behind the goal: it climbs on a spark trail and bursts `die` way at ~`h` m. */
function rocket(K: FxKit, s: Show, u: number, w: number, die: number, h = 10, pal: readonly number[] = s.pal): void {
  const vy = r(17, 19);
  const g = 12;
  // Burst a little before the top of the climb, where it is still rising.
  const t = Math.min(vy / g - 0.15, Math.max(0.5, (vy - Math.sqrt(Math.max(0, vy * vy - 2 * g * h))) / g));
  const p = K.add(SH.rocket, u, 0.6, w, r(6, 10), vy, r(-1.5, 1.5), 0.9, t, 0xffffff);
  p.g = g; p.f |= F.AIM; p.emit = EMIT.sparks; p.er = 45; p.pal = pal; p.die = die;
  puff(K, u, 0.3, w, 0, 0.5, 0, 0.7, 0.5, 0xd6dde6);
  K.cue('whoosh');
}

/** Snow drifting down over the box. */
function snowfall(K: FxKit, n: number, h = 9): void {
  for (let i = 0; i < n; i++) {
    const p = K.add(SH.flake, r(-2, 9), r(h - 1, h + 1), r(-7, 7), r(-0.5, 0.5), -r(0.5, 1), r(-0.5, 0.5), r(0.3, 0.45), r(1.8, 2.4), FX_SNOW[i % 3]);
    p.f |= F.FACE | F.SWAY; p.sw = 1.5; p.g = 1; p.term = 1.3; p.wz = r(-2, 2);
  }
}

/** A jagged lightning bolt from the sky to (u, 0, w), `big` 1 for the main strike. */
function bolt(K: FxKit, s: Show, u: number, w: number, big: number): void {
  const top = 14;
  let pu = u + r(-1.5, 1.5), py = top, pw = w + r(-0.6, 0.6);
  const n = 8;
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    const nu = i === n ? u : u + (pu - u) * 0.3 + r(-1.3, 1.3) * (1 - k);
    const ny = top * (1 - k);
    const nw = i === n ? w : w + r(-0.5, 0.5) * (1 - k);
    K.beamTo(pu, py, pw, nu, ny, nw, 0.4 * big + 0.12, 0.3, 0xffffff);
    K.beamTo(pu, py, pw, nu, ny, nw, 1.1 * big + 0.3, 0.22, pc(s, 0));
    // A fork or two off the upper half.
    if ((i === 2 || i === 4) && big > 0.6) {
      let bu = nu, by = ny, bww = nw;
      const side = Math.random() < 0.5 ? -1 : 1;
      for (let j = 0; j < 3; j++) {
        const cu = bu + side * r(0.8, 1.6), cy = by - r(1, 1.8), cw = bww + r(-0.4, 0.4);
        K.beamTo(bu, by, bww, cu, cy, cw, 0.18, 0.22, 0xffffff);
        bu = cu; by = cy; bww = cw;
      }
    }
    pu = nu; py = ny; pw = nw;
  }
  // The strike: a flash, a scorch mark, a ring of light, sparks, dust and smoke.
  flash(K, u, 1.2, w, 6 * big + 2, 0xffffff, 0.22);
  const scorch = K.add(SH.disc, u, 0, w, 0, 0, 0, 3.6 * big + 1, 2.2, 0x2a2a30);
  scorch.f |= F.FLAT | F.POP | F.KEEP; scorch.y = 0.03 * s.k;
  const ring = K.add(SH.ring, u, 0.05, w, 0, 0, 0, 1.5, 0.5, pc(s, 1));
  ring.f |= F.FLAT; ring.gs = 22 * big * s.k;
  sparkBall(K, u, 0.4, w, Math.round(36 * big), 10, [0xffffff, pc(s, 0), pc(s, 1)]);
  for (let i = 0; i < 4; i++) puff(K, u + r(-1, 1), 0.5, w + r(-1, 1), r(-2, 2), r(1, 3), r(-2, 2), r(0.6, 1), r(0.7, 1), FX_SMOKE[i % 3]);
  K.cue('crack');
}

// ------------------------------------------------------------------ the shows

export const GOAL_SHOWS: { readonly [id: string]: GoalShowDef } = {
  /** SHOCKWAVE: a ring of force rolls out over the grass, dust and turf thrown up behind it. */
  shockwave: {
    dur: 1.6, still: 0.32, run(K, s, a, b) {
      const w = s.bw * 0.5;
      const wave = (big: number) => {
        for (let i = 0; i < 2; i++) {
          const p = K.add(SH.ring, 1, 0.05, w, 0, 0, 0, 2, 0.75 + i * 0.15, i ? pc(s, 0) : 0xffffff);
          p.f |= F.FLAT; p.gs = (34 - i * 10) * big * s.k; p.delay = i * 0.1;
        }
        const v = K.add(SH.ring, 1, 2, w, 0, 0, 0, 1.5, 0.45, pc(s, 1));
        v.f |= F.FACE; v.gs = 30 * big * s.k;
        dustRing(K, 1, w, Math.round(34 * big), 16 * big);
        for (let i = 0; i < 30 * big; i++) {
          const ang = Math.random() * TAU, sp = r(3, 8);
          const p = K.add(SH.cube, 1 + Math.cos(ang) * 2, 0.2, w + Math.sin(ang) * 2, Math.cos(ang) * sp, r(5, 10), Math.sin(ang) * sp, r(0.18, 0.3), r(0.9, 1.3), GRASS[i % 4]);
          p.g = 14; p.b = 0.3;
          FxKit.tumble(p, 10);
        }
        flash(K, 1, 1, w, 4 * big, pc(s, 0));
        K.cue('boom');
      };
      if (hit(a, b, 0)) wave(1);
      if (hit(a, b, 0.42)) wave(0.6);
    },
  },

  /** BALLOON PARTY: a bunch of voxel balloons let go from the goal mouth; a few pop on the way up. */
  balloons: {
    dur: 3.2, still: 1.1, run(K, s, a, b) {
      if (!hit(a, b, 0)) return;
      for (let i = 0; i < 22; i++) {
        const big = i < 3;
        const p = K.add(SH.balloon, r(-0.5, 1.5), big ? 1.6 : r(0.5, 2.2), big ? (i - 1) * 1.6 : r(-3.4, 3.4), r(0.3, 1.6), r(1, 2.5), r(-0.6, 0.6),
          big ? 2.2 : r(1, 1.3), big ? 3.2 : r(1.3, 3.2), pc(s, i));
        p.g = -1.7; p.drag = 0.6; p.f |= F.POP | F.SWAY | F.WOB; p.sw = 1.5; p.wob = 0.25; p.die = DIE.pop;
        p.delay = i * 0.025; p.ry = r(0, TAU); p.wy = r(-0.8, 0.8);
      }
      for (let i = 0; i < 40; i++) flake(K, r(-0.5, 1), r(0.5, 2.4), r(-3.6, 3.6), r(2, 6), r(4, 9), r(-3, 3), pc(s, i + 1));
      K.cue('pop');
    },
  },

  /** CONFETTI CANNONS: two cannons pop up by the posts and blast three rounds of confetti and streamers. */
  confetti: {
    dur: 2.8, still: 0.62, run(K, s, a, b) {
      if (hit(a, b, 0)) {
        for (const sd of SIDES) {
          const c = K.add(SH.cannon, 0.9, 0.7, sd * 4.6, 0, 0, 0, 1.6, 2.6, 0xffffff);
          c.f |= F.POP | F.KEEP;
          K.aim(c, 0.55, 0.8, -sd * 0.28);
        }
      }
      for (const t of CANNON_AT) {
        if (!hit(a, b, t)) continue;
        for (const sd of SIDES) {
          const du = 0.55, dy = 0.8, dw = -sd * 0.28;
          const mu = 0.9 + du * 1.1, my = 0.7 + dy * 1.1, mw = sd * 4.6 + dw * 1.1;
          for (let i = 0; i < 46; i++) {
            const v = r(11, 19);
            flake(K, mu, my, mw, du * v + r(-2.5, 2.5), dy * v + r(-2.5, 2.5), dw * v + r(-2.5, 2.5), pc(s, i), r(2, 2.8));
          }
          for (let i = 0; i < 5; i++) {
            const v = r(10, 15);
            const p = K.add(SH.cube, mu, my, mw, du * v + r(-2, 2), dy * v, dw * v + r(-2, 2), 0.5, r(2, 2.6), pc(s, i + 2));
            p.sx = 0.16; p.sy = 0.05; p.sz = 2.6;
            p.g = 6; p.drag = 1.2; p.term = 2.6; p.f |= F.SWAY; p.sw = 3;
            p.wx = r(4, 8); p.wy = r(-3, 3);
          }
          for (let i = 0; i < 4; i++) puff(K, mu, my, mw, du * 3 + r(-1, 1), dy * 3, dw * 3 + r(-1, 1), r(0.6, 0.9), 0.5, 0xf4f4ea);
        }
        K.cue('pop');
      }
    },
  },

  /** POPCORN: a striped bucket pops up in the goal mouth and the kernels go off, bouncing all over the box. */
  popcorn: {
    dur: 2.9, still: 0.95, run(K, s, a, b, dt) {
      if (hit(a, b, 0)) {
        const bucket = K.add(SH.bucket, 0.9, 0, s.bw * 0.3, 0, 0, 0, 2.6, 2.8, 0xffffff);
        bucket.f |= F.POP | F.KEEP | F.WOB; bucket.wob = 0.07;
      }
      for (const t of POPCORN_CUES) if (hit(a, b, t)) K.cue('pop');
      const rate = b < 1.6 ? 120 * Math.sin((b / 1.6) * Math.PI) : 0;
      const n = K.rate(s, 0, rate, dt);
      for (let i = 0; i < n; i++) {
        const top = Math.random() < 0.55;
        const u = top ? 0.9 + r(-0.5, 0.5) : r(-1.6, 0);
        const y = top ? 2.5 : r(0.4, 2.4);
        const w = top ? s.bw * 0.3 + r(-0.6, 0.6) : r(-3.6, 3.6);
        const p = K.add(SH.kernel, u, y, w, r(1, 6), r(6, 11), r(-3.5, 3.5), r(0.42, 0.6), r(2, 2.8), 0xffffff);
        p.g = 14; p.b = 0.45; p.f |= F.POP;
        FxKit.tumble(p, 9);
        if (Math.random() < 0.5) puff(K, u, y, w, 0, 0.6, 0, 0.4, 0.25, 0xffffff);
      }
    },
  },

  /** GOLD RUSH: a geyser of spinning gold coins out of the net, raining down and clinking over the box. */
  gold: {
    dur: 2.6, still: 0.75, run(K, s, a, b, dt) {
      if (hit(a, b, 0)) {
        flash(K, 0.5, 1.2, 0, 5, 0xffd23a, 0.25);
        for (let i = 0; i < 30; i++) {
          const ang = Math.random() * TAU, v = r(4, 9);
          const p = K.add(SH.sparkle, 0.5, 1.2, 0, Math.cos(ang) * v, r(2, 8), Math.sin(ang) * v, r(0.35, 0.55), r(0.5, 0.9), 0xfff0b0);
          p.f |= F.FACE | F.TWINK; p.drag = 2;
        }
      }
      for (const t of COIN_CUES) if (hit(a, b, t)) K.cue('coin');
      const n = K.rate(s, 0, b < 1.1 ? 85 : 0, dt);
      for (let i = 0; i < n; i++) {
        const p = K.add(SH.coin, r(-0.5, 0.8), r(0.3, 1.2), r(-3, 3), r(1, 6), r(9, 15), r(-4, 4), r(0.5, 0.65), r(2.2, 2.9), 0xffffff);
        p.g = 14; p.b = 0.35; p.wy = r(8, 14) * (Math.random() < 0.5 ? -1 : 1); p.wx = r(-2, 2); p.rx = r(0, TAU);
        if (Math.random() < 0.12) { p.emit = EMIT.glint; p.er = 4; p.pal = GOLD; }
      }
    },
  },

  /** FROSTBITE: the goal mouth freezes into a wall of ice, icicles on the bar, then it all shatters. */
  ice: {
    dur: 2.6, still: 0.7, run(K, s, a, b, dt) {
      if (hit(a, b, 0)) {
        for (let c = 0; c < 9; c++) for (let row = 0; row < 3; row++) {
          const d = c * 0.03 + row * 0.04;
          const p = K.add(SH.cube, 0.25, 0.43 + row * 0.86, -3.44 + c * 0.86, 0, 0, 0, 0.84, 1.05 - d, ICE[(c + row) % 3]);
          p.f |= F.POP | F.KEEP; p.delay = d; p.die = DIE.shatter;
          p.ry = r(-0.08, 0.08);
        }
        for (let c = 0; c < 9; c++) {
          const p = K.add(SH.shard, 0.25, 2.2, -3.44 + c * 0.86, 0, 0, 0, r(0.8, 1.2), 1.05, 0xeaf8ff);
          p.rx = Math.PI; p.f |= F.POP | F.KEEP; p.delay = 0.3 + c * 0.02; p.die = DIE.shatter;
        }
        for (let i = 0; i < 18; i++) puff(K, r(-0.5, 1.5), 0.3, r(-4, 4), r(0, 2), r(0.2, 0.8), r(-1, 1), r(0.8, 1.2), r(0.9, 1.2), 0xeaf6ff);
        K.cue('whoosh');
      }
      if (hit(a, b, 1.06)) {
        flash(K, 0.6, 1.3, 0, 6, 0xeaf8ff, 0.2);
        for (let i = 0; i < 40; i++) {
          const p = K.add(SH.flake, r(0, 1), r(0.5, 2.5), r(-3.8, 3.8), r(1, 6), r(1, 5), r(-3, 3), r(0.3, 0.45), r(1.4, 2), FX_SNOW[i % 3]);
          p.f |= F.FACE | F.SWAY; p.sw = 2; p.g = 3; p.drag = 1.5; p.term = 1.4; p.wz = r(-3, 3);
        }
        K.cue('crack');
      }
      if (b > 1.1) snowfall(K, K.rate(s, 0, 30, dt), 8);
    },
  },

  /** PINATA: a paper star swings over the goal, takes two whacks and bursts into sweets. */
  pinata: {
    dur: 2.6, still: 0.5, run(K, s, a, b, dt) {
      const u = 3, y = 4.3, w0 = s.cw * 1.5;
      if (hit(a, b, 0)) {
        const p = K.add(SH.pinata, u, y, w0, 0, 0, 0, 2.6, 0.95, 0xffffff);
        p.f |= F.FACE | F.POP | F.KEEP | F.WOB; p.wob = 0.35; p.die = DIE.candy; p.pal = s.pal;
        const str = K.add(SH.cube, u, y + 4.6, w0, 0, 0, 0, 0.07, 0.95, 0xf4f4ea);
        str.sy = 100; str.f |= F.KEEP;
      }
      for (const t of WHACKS) {
        if (!hit(a, b, t)) continue;
        for (let i = 0; i < 7; i++) {
          const ang = (i / 7) * TAU;
          const p = K.add(SH.star, u, y, w0, Math.cos(ang) * 5, Math.sin(ang) * 5, 0, 0.45, 0.35, 0xffffff);
          p.f |= F.FACE; p.drag = 3;
        }
        K.cue('pop');
      }
      if (hit(a, b, 0.95)) flash(K, u, y, w0, 4, pc(s, 0));
      if (b > 1 && b < 2) {
        const n = K.rate(s, 0, 24, dt);
        for (let i = 0; i < n; i++) {
          const p = K.add(SH.candy, r(-1, 5), r(10, 12), r(-5, 5), 0, -2, 0, 0.5, 2, pc(s, i + (b * 10 | 0)));
          p.g = 10; p.b = 0.4;
          FxKit.tumble(p, 6);
        }
      }
    },
  },

  /** INFERNO: stage pyro, flame jets along the goal line going off in waves. */
  fire: {
    dur: 2.4, still: 0.42, run(K, s, a, b, dt) {
      const jets = JETS;
      if (hit(a, b, 0)) {
        for (const w of jets) {
          const n = K.add(SH.cube, 0.6, 0.15, w, 0, 0, 0, 0.6, 2.3, 0x3a3a42);
          n.sy = 0.5; n.f |= F.POP | F.KEEP;
        }
      }
      for (const t of JET_CUES) if (hit(a, b, t)) K.cue('whoosh');
      for (let j = 0; j < jets.length; j++) {
        const lag = Math.abs(j - 2) * 0.12;
        const on = (b > lag && b < lag + 0.4) || (b > 0.9 && b < 1.35) || (b > 1.5 && b < 1.8);
        const n = K.rate(s, j, on ? 95 : 0, dt);
        for (let i = 0; i < n; i++) {
          const p = K.add(SH.cube, 0.6 + r(-0.12, 0.12), 0.3, jets[j] + r(-0.12, 0.12), r(-0.5, 0.5), r(16, 21), r(-0.5, 0.5), r(0.3, 0.48), r(0.45, 0.62), FX_FIRE[0]);
          p.f |= F.AGE; p.pal = FX_FIRE; p.g = 12; p.drag = 0.8;
          FxKit.tumble(p, 5);
        }
      }
      if (b > 0.3) {
        const n = K.rate(s, 6, b < 2.2 ? 22 : 0, dt);
        for (let i = 0; i < n; i++) {
          const p = K.add(SH.cube, r(0, 2), r(0.5, 4), r(-4, 4), r(-0.5, 0.5), r(1, 3), r(-0.5, 0.5), r(0.08, 0.14), r(0.8, 1.3), pick(FX_FIRE));
          p.g = -0.6; p.f |= F.TWINK | F.SWAY; p.sw = 2;
        }
      }
      if (hit(a, b, 1.9)) for (let i = 0; i < 10; i++) puff(K, r(0, 1.5), r(4, 7), r(-4, 4), 0, r(0.5, 1.2), 0, r(1.4, 2), 1.2, FX_SMOKE[i % 3]);
    },
  },

  /** RAINBOW: a voxel rainbow arches out of the goal over the box, cloud to cloud, then dissolves into sparkles. */
  rainbow: {
    dur: 3, still: 1.15, stageK: 0.24, run(K, s, a, b) {
      if (!hit(a, b, 0)) return;
      // Side on to the lens: out of the goal over the box from the gantry; across the mouth seen end on.
      const cu = s.endOn ? 1.5 : 6, R = 5.6, cw = s.endOn ? 0 : s.cw * 1.5;
      const at = (along: number, y: number, off: number, out: [number, number, number]): [number, number, number] => {
        out[0] = s.endOn ? cu + off : cu + along;
        out[1] = y;
        out[2] = s.endOn ? cw + along : cw + off;
        return out;
      };
      const q: [number, number, number] = [0, 0, 0];
      for (let band = 0; band < 6; band++) {
        const rr = R - band * 0.5;
        const n = Math.ceil((Math.PI * rr) / 0.46);
        for (let i = 0; i <= n; i++) {
          const th = Math.PI * (1 - i / n);
          const from = i / n;
          const delay = from * 0.6 + band * 0.02;
          const die = 1.9 + from * 0.5;
          at(Math.cos(th) * rr, Math.sin(th) * rr + 0.3, 0, q);
          const p = K.add(SH.cube, q[0], q[1], q[2], 0, 0, 0, 0.56, die - delay, pc(s, band));
          p.f |= F.POP; p.delay = delay;
          if (i % 4 === 0) p.die = DIE.sparkle;
        }
      }
      for (const e of [-1, 1]) {
        at(e * (R - 1.2), 1, 0, q);
        const c = K.add(SH.cloud, q[0], q[1], q[2], 0, 0, 0, 3.4, 2.5, 0xffffff);
        c.f |= F.POP | F.KEEP; c.delay = e > 0 ? 0.55 : 0;
        if (s.endOn) c.ry = Math.PI / 2;
      }
      for (let i = 0; i < 24; i++) {
        const th = Math.random() * Math.PI, rr = r(3.2, 6.2);
        at(Math.cos(th) * rr, Math.sin(th) * rr + 0.3, r(-0.5, 0.5), q);
        const p = K.add(SH.sparkle, q[0], q[1], q[2], 0, 0.3, 0, r(0.35, 0.55), r(1, 1.8), 0xffffff);
        p.f |= F.FACE | F.TWINK; p.delay = r(0.2, 1);
      }
      K.cue('whoosh');
    },
  },

  /** DISCO: a mirror ball drops over the box, lasers sweep and the grass lights up as a dance floor. */
  neon: {
    dur: 3, still: 1.25, stageK: 0.3, run(K, s, a, b) {
      const u = 4, y = 5.2, w = s.cw * 1.5;
      if (hit(a, b, 0)) {
        const m = K.add(SH.mirror, u, y, w, 0, 0, 0, 1.7, 2.9, 0xffffff);
        m.f |= F.POP | F.KEEP; m.wy = 2.4; m.emit = EMIT.glint; m.er = 14; m.pal = s.pal;
        const str = K.add(SH.cube, u, y + 4.5, w, 0, 0, 0, 0.06, 2.9, 0xc9d1dc);
        str.sy = 125; str.f |= F.KEEP;
        // The dance floor: tiles flashing through the palette.
        for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) {
          const t = K.add(SH.cube, 1 + i * 1.55, 0.03, w - 2.4 + j * 1.6, 0, 0, 0, 1.45, 2.7 - (i + j) * 0.03, pc(s, i + j));
          t.sy = 0.04; t.f |= F.POP | F.KEEP | F.FLICK; t.pal = s.pal; t.delay = (i + j) * 0.03; t.seed = i * 3 + j * 5;
        }
        K.cue('whoosh');
      }
      if (hit(a, b, 0.22)) {
        for (let i = 0; i < 8; i++) {
          const p = K.add(SH.beam, u, y, w, 0, 0, 0, 0.14, 2.6, pc(s, i));
          p.sz = 16 / 0.14; p.rx = r(0.35, 0.95); p.ry = (i / 8) * TAU; p.wy = i % 2 ? 1.5 : -1.2;
          p.f |= F.KEEP | F.LEN | F.POP;
        }
      }
      for (let k = 0; k < 6; k++) if (hit(a, b, 0.25 + k * 0.42)) flash(K, u, y, w, 2, pc(s, k), 0.14);
    },
  },

  /** FIREWORKS: rockets launch from behind the goal, trailing sparks, and burst in the sky: spheres, rings and a golden willow. */
  fireworks: {
    dur: 3, still: 1.4, stageK: 0.28, run(K, s, a, b, dt) {
      for (const [t, w, die] of ROCKETS) if (hit(a, b, t)) rocket(K, s, r(-1.2, 0.3), w + s.cw * 1.5 + r(-0.5, 0.5), die, r(4.8, 6.5));
      // Gold fountains at the posts.
      for (const sd of SIDES) {
        const n = K.rate(s, sd > 0 ? 0 : 1, b < 1.5 ? 45 : 0, dt);
        for (let i = 0; i < n; i++) {
          const p = K.add(SH.cube, 0.2, 0.3, sd * 3.8, r(-1, 2), r(8, 12), r(-1.2, 1.2), r(0.1, 0.16), r(0.6, 0.9), pick(SPARK));
          p.g = 12; p.f |= F.AIM | F.TWINK; p.st = 0.05;
        }
      }
    },
  },

  /** VOLCANO: a volcano bursts up out of the box and erupts, lava raining down and smoking where it lands. */
  volcano: {
    dur: 3, still: 1.05, run(K, s, a, b, dt) {
      const u = 3.6, w = s.cw * 1.5, top = 2.7;
      if (hit(a, b, 0)) {
        const v = K.add(SH.volcano, u, 0, w, 0, 0, 0, 4.4, 2.9, 0xffffff);
        v.f |= F.POP | F.KEEP;
        dustRing(K, u, w, 18, 6);
      }
      if (hit(a, b, 0.25)) {
        flash(K, u, top + 1, w, 4, 0xff9a1f, 0.25);
        K.cue('boom');
      }
      if (b > 0.25 && b < 1.6) {
        const n = K.rate(s, 0, 42, dt);
        for (let i = 0; i < n; i++) {
          const p = K.add(SH.lava, u + r(-0.4, 0.4), top, w + r(-0.4, 0.4), r(-4.5, 4.5), r(10, 16), r(-4.5, 4.5), r(0.6, 0.95), r(2, 2.6), 0xffffff);
          p.g = 14; p.b = 0; p.emit = EMIT.smoke; p.er = 5;
          FxKit.tumble(p, 5);
        }
        const f = K.rate(s, 1, 70, dt);
        for (let i = 0; i < f; i++) fireBit(K, u + r(-0.4, 0.4), top, w + r(-0.4, 0.4), r(-1.5, 1.5), r(6, 11), r(-1.5, 1.5), r(0.5, 0.8), r(0.5, 0.75));
      }
      if (b > 0.3 && b < 2.5) {
        const n = K.rate(s, 2, 8, dt);
        for (let i = 0; i < n; i++) {
          const p = K.add(SH.blob, u + r(-0.5, 0.5), top + 0.5, w + r(-0.5, 0.5), r(-0.6, 0.6), r(2, 3.5), r(-0.6, 0.6), r(0.9, 1.4), r(1.2, 1.6), FX_SMOKE[i % 3]);
          p.f |= F.PUFF; p.drag = 0.6;
        }
      }
    },
  },

  /** THUNDERSTRUCK: storm clouds roll over, lightning strikes the goal mouth three times, the bar crackles. */
  lightning: {
    dur: 2.6, still: 0.3, run(K, s, a, b, dt) {
      const w = s.bw;
      if (hit(a, b, 0)) {
        for (let i = 0; i < 4; i++) {
          const c = K.add(SH.cloud, r(-1, 5), r(13.5, 15), w + r(-3, 3), r(-0.3, 0.3), 0, 0, r(4.5, 6), 2.4, 0x8a93a3);
          c.f |= F.POP | F.KEEP;
        }
      }
      if (hit(a, b, 0.18)) bolt(K, s, 0.7, w, 1);
      if (hit(a, b, 0.7)) bolt(K, s, 4.2, w + 2.4, 0.6);
      if (hit(a, b, 1.15)) bolt(K, s, 2.2, w - 2.6, 0.6);
      if (b > 0.2 && b < 1.5) {
        const n = K.rate(s, 0, 20, dt);
        for (let i = 0; i < n; i++) {
          const cw = r(-3.6, 3.6);
          K.beamTo(0, 2.6, cw, r(-0.3, 0.3), 2.6 + r(-0.5, 0.5), cw + r(-0.9, 0.9), 0.12, 0.08, i % 2 ? 0xffffff : pc(s, 0));
        }
      }
    },
  },

  /** BLACK HOLE: a vortex opens over the box and swallows stars and turf, collapses, then bursts out. */
  galaxy: {
    dur: 3, still: 1.0, run(K, s, a, b, dt) {
      const u = 4, y = 3.6, w = s.cw * 1.5;
      if (hit(a, b, 0)) {
        const core = K.add(SH.blob, u, y, w, 0, 0, 0, 0.6, 1.45, 0x0c0818);
        core.gs = 1.4 * s.k; core.f |= F.POP | F.KEEP;
        const rim = K.add(SH.ring, u, y, w, 0, 0, 0, 1, 1.45, pc(s, 0));
        rim.gs = 1.8 * s.k; rim.f |= F.FACE | F.TWINK; rim.wz = 3;
        // (A second rim, turning the other way: the core stays black, nothing glows over it.)
        const rim2 = K.add(SH.ring, u, y, w, 0, 0, 0, 1.4, 1.45, pc(s, 2));
        rim2.gs = 2.2 * s.k; rim2.f |= F.FACE; rim2.wz = -2;
        K.cue('whoosh');
      }
      if (b < 0.95) {
        const n = K.rate(s, 0, 120, dt);
        for (let i = 0; i < n; i++) {
          const star = Math.random() < 0.4;
          const p = K.add(star ? SH.star : SH.cube, u, y, w, 0, 0, 0, star ? r(0.35, 0.5) : r(0.2, 0.35), 3, pc(s, i));
          const rr = r(4.5, 7.5);
          K.orbit(p, 1, rr, r(1.6, 2.6), -rr / Math.max(0.35, 1.42 - b));
          if (star) p.f |= F.FACE | F.TWINK;
          else FxKit.tumble(p, 6);
        }
        // Turf and dust pulled up off the grass.
        const g = K.rate(s, 1, 28, dt);
        for (let i = 0; i < g; i++) {
          const gu = u + r(-5, 5), gw = w + r(-3, 3);
          const p = K.add(SH.cube, gu, 0.1, gw, (u - gu) * 1.5, (y - 0.1) * 1.5, (w - gw) * 1.5, r(0.15, 0.25), 0.62, GRASS[i % 4]);
          FxKit.tumble(p, 10);
        }
      }
      if (hit(a, b, 1.48)) {
        flash(K, u, y, w, 11, 0xffffff, 0.28);
        const rings: readonly [number, number, number][] = [[32, 0.6, 0xffffff], [24, 0.7, pc(s, 0)], [16, 0.85, pc(s, 2)]];
        for (const [gs, life, col] of rings) {
          const p = K.add(SH.ring, u, y, w, 0, 0, 0, 1.5, life, col);
          p.f |= F.FACE; p.gs = gs * s.k;
        }
        for (let i = 0; i < 120; i++) {
          const star = i % 3 === 0;
          const ang = Math.random() * TAU, e = r(-1.2, 1.2), v = r(9, 18);
          const p = K.add(star ? SH.star : SH.cube, u, y, w, Math.cos(ang) * Math.cos(e) * v, Math.sin(e) * v, Math.sin(ang) * Math.cos(e) * v, star ? r(0.4, 0.6) : r(0.2, 0.35), r(1.1, 1.6), pc(s, i));
          p.drag = 1.6; p.g = 1; p.f |= F.TWINK;
          if (star) p.f |= F.FACE;
        }
        K.cue('boom');
      }
    },
  },

  /** METEOR STRIKE: a flaming rock streaks down out of the sky and craters the goal mouth. */
  meteor: {
    dur: 3, still: 0.5, run(K, s, a, b, dt) {
      const T = 0.55;
      const su = 17, sy = 24, sw = s.bw + 4, tu = 1.2, ty = 0.8, tw = s.bw;
      if (hit(a, b, 0)) {
        const mark = K.add(SH.ring, tu, 0, tw, 0, 0, 0, 3, T, pc(s, 0));
        mark.f |= F.FLAT | F.TWINK; mark.y = 0.04 * s.k;
        const rock = K.add(SH.rock, su, sy, sw, (tu - su) / T, (ty - sy) / T, (tw - sw) / T, 2.8, T, 0xffffff);
        rock.die = DIE.impact; rock.pal = s.pal;
        FxKit.tumble(rock, 6);
        K.cue('whoosh');
      }
      if (b < T) {
        const k = b / T;
        const mu = su + (tu - su) * k, my = sy + (ty - sy) * k, mw = sw + (tw - sw) * k;
        const n = K.rate(s, 0, 150, dt);
        for (let i = 0; i < n; i++) fireBit(K, mu + r(-0.8, 0.8), my + r(-0.8, 0.8), mw + r(-0.8, 0.8), r(-2, 2), r(-1, 2), r(-2, 2), r(1, 1.7), r(0.35, 0.6));
        const m = K.rate(s, 1, 30, dt);
        for (let i = 0; i < m; i++) puff(K, mu, my, mw, 0, 0.5, 0, r(1.2, 1.8), r(0.8, 1.1), FX_SMOKE[i % 3]);
      }
      if (b > T + 0.05 && b < 2.7) {
        const n = K.rate(s, 2, 10, dt);
        for (let i = 0; i < n; i++) {
          const p = K.add(SH.blob, tu + r(-1, 1), 1, tw + r(-1, 1), r(-0.5, 0.5), r(2, 3.2), r(-0.5, 0.5), r(1.5, 2.2), r(1.3, 1.7), FX_SMOKE[i % 3]);
          p.f |= F.PUFF; p.drag = 0.6;
        }
        const e = K.rate(s, 3, 26, dt);
        for (let i = 0; i < e; i++) {
          const p = K.add(SH.cube, tu + r(-2, 2), 0.3, tw + r(-2, 2), r(-0.6, 0.6), r(1.5, 3), r(-0.6, 0.6), r(0.08, 0.14), r(0.7, 1.1), pick(FX_FIRE));
          p.g = -0.5; p.f |= F.TWINK | F.SWAY; p.sw = 2;
        }
      }
      if (hit(a, b, T + 0.02)) {
        for (let i = 0; i < 8; i++) {
          const ang = Math.random() * TAU, v = r(5, 9);
          const p = K.add(SH.lava, tu, 1, tw, Math.cos(ang) * v, r(6, 10), Math.sin(ang) * v, r(0.5, 0.8), r(1.8, 2.3), 0xffffff);
          p.g = 14; p.b = 0; p.emit = EMIT.smoke; p.er = 4;
          FxKit.tumble(p, 6);
        }
      }
    },
  },

  /** DIAMOND RAIN: a giant spinning diamond throws out light, shatters into gems, and it rains diamonds. */
  diamond: {
    dur: 2.8, still: 0.7, run(K, s, a, b, dt) {
      const u = 3, y = 4.4, w = s.cw * 1.5;
      if (hit(a, b, 0)) {
        const g = K.add(SH.gem, u, y, w, 0, 0, 0, 3.2, 0.85, 0xffffff);
        g.f |= F.POP | F.KEEP; g.wy = 5; g.die = DIE.gems; g.pal = s.pal; g.emit = EMIT.glint; g.er = 22;
        for (let i = 0; i < 8; i++) {
          const p = K.add(SH.beam, u, y, w, 0, 0, 0, 0.3, 0.85, i % 2 ? 0xd6f5ff : 0xffffff);
          p.sz = 9 / 0.3; p.rx = r(-0.9, 0.9); p.ry = (i / 8) * TAU; p.wy = 2; p.f |= F.KEEP | F.LEN | F.POP;
        }
        flash(K, u, y, w, 4, 0xeaf8ff, 0.2);
      }
      if (b > 0.9 && b < 2.2) {
        const n = K.rate(s, 0, 34, dt);
        for (let i = 0; i < n; i++) {
          const p = K.add(SH.gem, r(-1, 9), r(12, 16), r(-6, 6), 0, -4, 0, r(0.45, 0.7), r(1.6, 2.2), pc(s, i));
          p.g = 14; p.b = 0.4; p.die = DIE.sparkle;
          FxKit.tumble(p, 6);
        }
      }
    },
  },

  /** SUPERNOVA: a star gathers light over the box, then goes off: rings of light, a sky of stars, a glowing nebula. */
  supernova: {
    dur: 3.2, still: 1.02, run(K, s, a, b, dt) {
      const u = 4, y = 3.9, w = s.cw * 1.5;
      const T = 0.95;
      if (hit(a, b, 0)) {
        const core = K.add(SH.glow, u, y, w, 0, 0, 0, 0.8, T, 0xfff6a8);
        core.gs = 1.7 * s.k; core.f |= F.KEEP | F.TWINK;
        const heart = K.add(SH.blob, u, y, w, 0, 0, 0, 0.5, T, 0xffffff);
        heart.gs = 1 * s.k; heart.f |= F.KEEP | F.POP;
        for (let i = 0; i < 10; i++) {
          const p = K.add(SH.beam, u, y, w, 0, 0, 0, 0.05, T, i % 2 ? 0xfff6a8 : pc(s, i));
          p.sz = 40; p.gs = 0.25 * s.k; p.rx = r(-1.3, 1.3); p.ry = r(0, TAU); p.wy = 0.8; p.f |= F.KEEP | F.LEN;
        }
        K.cue('whoosh');
      }
      if (b < T - 0.1) {
        const n = K.rate(s, 0, 120, dt);
        for (let i = 0; i < n; i++) {
          const p = K.add(SH.cube, u, y, w, 0, 0, 0, r(0.18, 0.28), 2, i % 3 ? 0xffffff : pc(s, i));
          const rr = r(4, 7);
          K.orbit(p, 1, rr, r(2, 3), -rr / Math.max(0.3, T - b));
        }
      }
      if (hit(a, b, T)) {
        flash(K, u, y, w, 9, 0xffffff);
        const rings: readonly [number, number, number][] = [[42, 0.65, 0xffffff], [32, 0.75, 0xfff6a8], [22, 0.9, pc(s, 3)]];
        for (const [gs, life, col] of rings) {
          const p = K.add(SH.ring, u, y, w, 0, 0, 0, 2, life, col);
          p.f |= F.FACE; p.gs = gs * s.k;
        }
        const g = K.add(SH.ring, u, 0.05, w, 0, 0, 0, 2, 0.8, pc(s, 0));
        g.f |= F.FLAT; g.gs = 30 * s.k;
        dustRing(K, u, w, 24, 14);
        for (let i = 0; i < 150; i++) {
          const star = i % 5 < 2;
          const ang = Math.random() * TAU, e = r(-1.3, 1.3), v = r(12, 22);
          const p = K.add(star ? SH.star : SH.cube, u, y, w, Math.cos(ang) * Math.cos(e) * v, Math.sin(e) * v, Math.sin(ang) * Math.cos(e) * v, star ? r(0.4, 0.65) : r(0.2, 0.32), r(1.4, 2), pc(s, i));
          p.drag = 1.4; p.g = 1; p.f |= F.TWINK;
          if (star) p.f |= F.FACE;
        }
        for (let i = 0; i < 36; i++) {
          const ang = Math.random() * TAU, e = r(-1, 1), v = r(2, 5);
          const p = K.add(SH.sparkle, u, y, w, Math.cos(ang) * Math.cos(e) * v, Math.sin(e) * v, Math.sin(ang) * Math.cos(e) * v, r(0.4, 0.6), r(1.6, 2.2), 0xffffff);
          p.drag = 0.8; p.f |= F.FACE | F.TWINK;
        }
        K.cue('boom');
      }
      if (b > T && b < 2.3) {
        const n = K.rate(s, 1, 10, dt);
        for (let i = 0; i < n; i++) {
          const ang = Math.random() * TAU;
          const p = K.add(SH.blob, u + Math.cos(ang) * r(2, 5), y + Math.sin(ang) * r(1.5, 3.5), w + r(-1, 1), Math.cos(ang) * 1.2, Math.sin(ang) * 1.2, 0, r(0.9, 1.4), r(1.1, 1.5), pc(s, 4 + i));
          p.f |= F.PUFF;
        }
      }
    },
  },

  // ---------------------------------------------------------------- Club Pass, one a month (January first)

  /** FROST CUP: a snow tornado spins up out of the goal, flinging snowballs, then the snow comes down. */
  pass01: {
    dur: 3, still: 1.0, run(K, s, a, b, dt) {
      const u = 3, w = s.cw * 1.5;
      if (hit(a, b, 0)) K.cue('whoosh');
      if (b < 1.5) {
        const n = K.rate(s, 0, 130, dt);
        for (let i = 0; i < n; i++) {
          const blob = Math.random() < 0.3;
          const p = K.add(blob ? SH.blob : SH.flake, u, 0.2, w, 0, 0, 0, blob ? r(0.4, 0.6) : r(0.3, 0.5), r(1.2, 1.8), blob ? 0xffffff : pc(s, i));
          K.orbit(p, 0, r(0.5, 1.3), r(5, 7.5), r(0.8, 1.5), r(4, 6));
          p.f |= blob ? F.PUFF : F.FACE; p.wz = r(-4, 4);
        }
      }
      if (hit(a, b, 0.35)) {
        for (let i = 0; i < 7; i++) {
          const p = K.add(SH.blob, u, 3, w, r(4, 9) * (Math.random() < 0.3 ? -0.5 : 1), r(6, 10), r(-4, 4), r(0.7, 0.9), 2.5, 0xffffff);
          p.g = 14; p.b = 0; p.f |= F.LAND; p.die = DIE.snow;
        }
      }
      if (b > 1.3) snowfall(K, K.rate(s, 1, 55, dt), 9);
    },
  },

  /** MUD AND GLORY: a huge ball of mud flies up and splats the whole box. */
  pass02: {
    dur: 2.8, still: 0.85, run(K, s, a, b) {
      const T = 0.72;
      if (hit(a, b, 0)) {
        const m = K.add(SH.blob, 0.5, 1, 0, 2, 13, 0, 2.4, T, 0x7a5236);
        m.g = 14; m.die = DIE.pop; FxKit.tumble(m, 4);
        const sp = K.add(SH.splat, 0.8, 0, 0, 0, 0, 0, 4, 2.4, 0x6a4a2e);
        sp.f |= F.FLAT | F.POP | F.KEEP; sp.y = 0.02 * s.k; sp.ry = r(0, TAU);
        for (let i = 0; i < 12; i++) puff(K, r(0, 1.5), 0.4, r(-3, 3), r(-1, 2), r(0.5, 2), r(-2, 2), r(0.8, 1.2), 0.9, FX_DIRT[i % 3]);
      }
      if (hit(a, b, T)) {
        const mu = 0.5 + 2 * T, my = 1 + 13 * T - 7 * T * T;
        for (let i = 0; i < 30; i++) {
          const ang = Math.random() * TAU, v = r(4, 10);
          const p = K.add(SH.blob, mu, my, 0, Math.cos(ang) * v, r(-2, 6), Math.sin(ang) * v, r(0.5, 0.9), 3, FX_DIRT[i % 3]);
          p.g = 14; p.b = 0; p.f |= F.LAND; p.die = DIE.splat;
          FxKit.tumble(p, 6);
        }
        K.cue('pop');
      }
    },
  },

  /** SPRING DERBY: flowers sprout across the box in a wave and their petals blow away on the breeze. */
  pass03: {
    dur: 3, still: 1.0, run(K, s, a, b, dt) {
      if (hit(a, b, 0)) {
        for (let i = 0; i < 36; i++) {
          const u = r(0.3, 9), w = r(-6, 6);
          const d = Math.hypot(u, w - s.bw * 0.3) * 0.06;
          const p = K.add(SH.flower, u, 0, w, 0, 0, 0, r(1, 1.5), 2.7 - d, pc(s, i));
          p.f |= F.FACEY | F.POP | F.KEEP | F.WOB; p.wob = 0.12; p.delay = d;
        }
        for (let i = 0; i < 20; i++) {
          const p = K.add(SH.leaf, r(0, 1), r(0.5, 2), r(-3, 3), r(2, 6), r(4, 8), r(-3, 3), r(0.3, 0.45), r(1.4, 2), 0x6fcf4a);
          p.g = 5; p.drag = 1; p.term = 1.6; p.f |= F.SWAY; p.sw = 3; FxKit.tumble(p, 7);
        }
        K.cue('pop');
      }
      if (b > 0.6 && b < 2.5) {
        const n = K.rate(s, 0, 55, dt);
        for (let i = 0; i < n; i++) {
          const p = K.add(SH.leaf, r(0.5, 8), r(0.8, 1.6), r(-6, 6), r(-1, 1), r(2, 4), r(2, 4), r(0.22, 0.32), r(1.6, 2.2), pc(s, i));
          p.g = 1.5; p.term = 1.2; p.f |= F.SWAY; p.sw = 3;
          FxKit.tumble(p, 5);
        }
      }
    },
  },

  /** APRIL SHOWERS: rain clouds roll in over the goal and it pours, splashing into puddles. */
  pass04: {
    dur: 3, still: 1.2, run(K, s, a, b) {
      const w = s.cw * 1.5;
      if (hit(a, b, 0)) {
        const plan: readonly [number, number][] = [[1.5, 4], [4.2, 5], [7, 4]];
        plan.forEach(([u, size], i) => {
          const c = K.add(SH.cloud, u, 5.4 + i * 0.3, w + (i - 1) * 0.8, 0, 0, 0, size, 2.8, 0xb8c2d0);
          c.f |= F.POP | F.KEEP; c.emit = EMIT.rain; c.er = 40; c.delay = i * 0.1;
          const pd = K.add(SH.disc, u, 0, w + (i - 1) * 0.8, 0, 0, 0, 1, 2.4, 0x8fc8ff);
          pd.f |= F.FLAT | F.KEEP; pd.gs = 0.9 * s.k; pd.y = 0.03 * s.k; pd.delay = 0.5;
        });
        K.cue('whoosh');
      }
    },
  },

  /** TITLE RACE: a giant trophy rises out of the goal on beams of gold, fountains and ticker tape. */
  pass05: {
    dur: 3, still: 1.25, run(K, s, a, b, dt) {
      const u = 3, w = s.cw * 1.5;
      if (hit(a, b, 0)) {
        const t = K.add(SH.trophy, u, 0, w, 0, 2.6, 0, 4.2, 2.9, 0xffffff);
        t.drag = 1.3; t.f |= F.POP | F.KEEP; t.wy = 1.6; t.emit = EMIT.glint; t.er = 10; t.pal = GOLD;
        for (let i = 0; i < 6; i++) {
          const p = K.add(SH.beam, u - 0.8, 0.5, w, 0, 0, 0, 0.26, 2.7, i % 2 ? 0xffd23a : 0xfff0b0);
          p.sz = 11 / 0.26; p.f |= F.KEEP | F.LEN | F.POP;
          K.aim(p, Math.cos((i / 5) * Math.PI) * 0.6, 1, Math.sin((i / 5) * Math.PI - Math.PI / 2) * 0.25);
          p.delay = 0.1 + i * 0.04;
        }
        flash(K, u, 2, w, 5, 0xffd23a);
        K.cue('boom');
      }
      for (const sd of SIDES) {
        const n = K.rate(s, sd > 0 ? 0 : 1, b < 1.8 ? 45 : 0, dt);
        for (let i = 0; i < n; i++) {
          const p = K.add(SH.cube, 0.3, 0.3, sd * 3.8, r(0, 2), r(9, 13), r(-1, 1), r(0.12, 0.2), r(0.8, 1.1), pick(GOLD));
          p.g = 12; p.f |= F.TWINK;
        }
      }
      if (b > 0.3 && b < 2.6) {
        const n = K.rate(s, 2, 45, dt);
        for (let i = 0; i < n; i++) flake(K, r(-1, 9), r(10, 13), r(-6, 6), 0, -1, 0, i % 3 ? pick(GOLD) : pc(s, i), r(2, 2.6));
      }
    },
  },

  /** SUMMER SEVENS: a big wave crashes out of the goal, splashing the box, beach balls bobbing out on it. */
  pass06: {
    dur: 2.8, still: 0.72, run(K, s, a, b, dt) {
      if (hit(a, b, 0)) {
        for (let i = 0; i < 3; i++) {
          const p = K.add(SH.beachball, 0.5, 1.2, (i - 1) * 2.4, r(5, 8), r(7, 10), r(-1.5, 1.5), 1.2, 2.7, 0xffffff);
          p.g = 12; p.b = 0.65; FxKit.tumble(p, 5);
        }
        for (let i = 0; i < 20; i++) puff(K, r(-0.3, 0.8), 0.3, r(-3.8, 3.8), r(1, 3), r(0.5, 2), r(-1, 1), r(0.8, 1.2), 1, 0xffffff);
        K.cue('whoosh');
      }
      if (b < 0.6) {
        const n = K.rate(s, 0, 260, dt);
        for (let i = 0; i < n; i++) {
          const vy = r(7, 12);
          const p = K.add(SH.blob, r(-0.5, 0.5), r(0.2, 1.5), r(-3.6, 3.6), r(4, 8) + (vy - 7) * 0.7, vy, r(-1.5, 1.5), r(0.35, 0.75), 2.5, pick(WATER));
          p.g = 14; p.b = 0; p.f |= F.LAND; p.die = DIE.splash;
        }
      }
    },
  },

  /** HEATWAVE CUP: a grinning voxel sun rises over the goal, its rays wheeling, heat sparkling off the grass. */
  pass07: {
    dur: 3, still: 1.2, run(K, s, a, b, dt) {
      const u = 4, y = 4.4, w = s.cw * 1.5;
      if (hit(a, b, 0)) {
        const sun = K.add(SH.sun, u, y, w, 0, 0.25, 0, 4.4, 2.8, 0xffffff);
        sun.f |= F.FACE | F.POP | F.KEEP;
        for (let i = 0; i < 12; i++) {
          const p = K.add(SH.cube, u, y, w, 0, 0.25, 0, 0.56, 2.7, i % 2 ? 0xffd23a : 0xff9a1f);
          K.orbit(p, 1, 3.4, 1, 0, 0.25, (i / 12) * TAU);
          p.sx = 2.4; p.sy = 0.6; p.sz = 0.4; p.f |= F.FACE | F.POP | F.KEEP; p.delay = i * 0.04;
        }
        flash(K, u, y, w, 7, 0xfff0b0, 0.25);
        K.cue('whoosh');
      }
      const n = K.rate(s, 0, b < 2.5 ? 34 : 0, dt);
      for (let i = 0; i < n; i++) {
        const p = K.add(SH.sparkle, r(-1, 9), r(0.2, 1), r(-6, 6), 0, r(1.5, 3), 0, r(0.3, 0.5), r(0.9, 1.3), pick(SPARK));
        p.f |= F.FACE | F.TWINK | F.SWAY; p.sw = 1.5;
      }
    },
  },

  /** TRAINING CAMP: the ball machine goes haywire, footballs pour out of the net, cones pop up in a slalom. */
  pass08: {
    dur: 3, still: 0.95, run(K, s, a, b, dt) {
      if (hit(a, b, 0)) {
        for (let i = 0; i < 8; i++) {
          const c = K.add(SH.cone, 2 + i * 1.3, 0, s.bw * 0.3 + (i % 2 ? 1.2 : -1.2), 0, 0, 0, 0.9, 2.7 - i * 0.08, 0xffffff);
          c.f |= F.POP | F.KEEP; c.delay = 0.08 * i;
        }
        K.cue('pop');
      }
      const n = K.rate(s, 0, b < 1.2 ? 36 : 0, dt);
      for (let i = 0; i < n; i++) {
        const p = K.add(SH.football, r(-1.2, 0), r(0.6, 2.2), r(-3.4, 3.4), r(5, 10), r(5, 9), r(-3, 3), r(0.7, 0.85), r(2.2, 2.8), 0xffffff);
        p.g = 14; p.b = 0.62; FxKit.tumble(p, 9);
        if (Math.random() < 0.3) puff(K, 0, 1.2, r(-3, 3), 1, 0.5, 0, 0.5, 0.3, 0xffffff);
      }
    },
  },

  /** HARVEST CUP: an autumn gust sweeps a storm of leaves out of the goal; pumpkins tumble out after it. */
  pass09: {
    dur: 3, still: 0.85, run(K, s, a, b, dt) {
      if (hit(a, b, 0.15)) {
        for (let i = 0; i < 4; i++) {
          const p = K.add(SH.pumpkin, 0.4, 0.8, (i - 1.5) * 2, r(5, 8), r(7, 10), r(-1.5, 1.5), 1.1, 2.6, 0xffffff);
          p.g = 14; p.b = 0.45; FxKit.tumble(p, 3);
        }
        K.cue('whoosh');
      }
      if (b < 1.3) {
        const n = K.rate(s, 0, 140, dt);
        for (let i = 0; i < n; i++) {
          const p = K.add(SH.leaf, r(-2.5, 0), r(0.5, 3), r(-4, 4), r(9, 15), r(1, 4), r(-2, 2), r(0.35, 0.55), r(1.8, 2.6), pick(AUTUMN));
          p.drag = 0.9; p.g = 2; p.term = 1.5; p.f |= F.SWAY; p.sw = 5;
          FxKit.tumble(p, 9);
        }
      }
      if (b > 0.2 && b < 1) {
        const n = K.rate(s, 1, 50, dt);
        for (let i = 0; i < n; i++) {
          const p = K.add(SH.leaf, 4.5, 0.3, s.bw * 0.3, 0, 0, 0, r(0.35, 0.5), r(1.2, 1.6), pick(AUTUMN));
          K.orbit(p, 0, r(0.6, 1.4), r(6, 8), 1.2, r(3, 5));
          FxKit.tumble(p, 9);
        }
      }
    },
  },

  /** FLOODLIGHTS: searchlights sweep the night sky from behind the goal while the camera flashes go off. */
  pass10: {
    dur: 3, still: 1.1, run(K, s, a, b, dt) {
      if (hit(a, b, 0)) {
        const ws = [-5.2, -1.8, 1.8, 5.2];
        ws.forEach((w, i) => {
          const lamp = K.add(SH.cube, -2.2, 0.6, w, 0, 0, 0, 1.2, 2.9, 0x3a3a42);
          lamp.f |= F.POP | F.KEEP;
          const p = K.add(SH.beam, -2.2, 1, w, 0, 0, 0, 0.75, 2.8, i % 2 ? pc(s, i) : 0xf4f0ff);
          p.sz = 28 / 0.75; p.f |= F.KEEP | F.LEN | F.POP;
          K.aim(p, r(0.2, 0.6), 1.8, w > 0 ? 0.5 : -0.5);
          p.wy = i % 2 ? 0.7 : -0.7;
          flash(K, -2.2, 1, w, 2.2, 0xffffff, 0.3);
        });
        K.cue('whoosh');
      }
      const n = K.rate(s, 0, b < 2.6 ? 40 : 0, dt);
      for (let i = 0; i < n; i++) {
        const p = K.add(SH.sparkle, r(-14, -4), r(2, 12), r(-20, 20), 0, 0, 0, r(0.6, 1), 0.14, 0xffffff);
        p.f |= F.FACE | F.POP;
      }
    },
  },

  /** BONFIRE DERBY: Catherine wheels spin on the posts, a fountain roars in the middle, two rockets go up. */
  pass11: {
    dur: 3, still: 0.85, run(K, s, a, b, dt) {
      if (hit(a, b, 0)) {
        for (const sd of SIDES) {
          const hub = K.add(SH.glow, 0.4, 2.6, sd * 3.8, 0, 0, 0, 0.9, 1.9, 0xfff0b0);
          hub.f |= F.KEEP | F.TWINK;
        }
        K.cue('whoosh');
      }
      if (b < 1.9) {
        for (const sd of SIDES) {
          const n = K.rate(s, sd > 0 ? 0 : 1, 200, dt);
          for (let i = 0; i < n; i++) {
            const th = b * 14 * sd + (i % 3) * (TAU / 3);
            const c = Math.cos(th), sn = Math.sin(th), v = r(6, 9);
            const p = K.add(SH.cube, 0.4 + c * 0.5, 2.6 + sn * 0.5, sd * 3.8, -sn * v * sd, c * v * sd, r(-1, 1), r(0.13, 0.2), r(0.4, 0.7), i % 4 ? pick(SPARK) : pc(s, i));
            p.g = 6; p.drag = 1.2; p.f |= F.TWINK | F.AIM; p.st = 0.04;
          }
        }
        const g = K.rate(s, 2, b > 0.2 ? 90 : 0, dt);
        for (let i = 0; i < g; i++) {
          const p = K.add(SH.cube, 0.6, 0.2, s.bw * 0.3, r(-2, 2), r(10, 14), r(-2, 2), r(0.1, 0.15), r(0.6, 1), pick(SPARK));
          p.g = 10; p.f |= F.AIM | F.TWINK; p.st = 0.05;
        }
      }
      if (hit(a, b, 1)) rocket(K, s, -1.5, -2, DIE.ringwork, 10);
      if (hit(a, b, 1.4)) rocket(K, s, -1.5, 2, DIE.firework, 11);
    },
  },

  /** WINTER CLASSIC: a big present in the goal mouth shakes, bursts open, and gifts tumble out in the snow. */
  pass12: {
    dur: 3, still: 0.95, run(K, s, a, b, dt) {
      const u = 1.6, w = s.cw * 1;
      if (hit(a, b, 0)) {
        const g = K.add(SH.gift, u, 1.3, w, 0, 0, 0, 2.6, 0.8, pc(s, 0));
        g.f |= F.POP | F.KEEP | F.WOB; g.wob = 0.18; g.die = DIE.stars; g.pal = s.pal;
      }
      if (hit(a, b, 0.8)) {
        for (let i = 0; i < 18; i++) {
          const ang = Math.random() * TAU, v = r(3, 7);
          const p = K.add(SH.gift, u, 1.6, w, Math.cos(ang) * v + 2, r(6, 11), Math.sin(ang) * v, r(0.7, 1), r(1.6, 2.2), pc(s, i + 1));
          p.g = 14; p.b = 0.4; p.die = DIE.stars; p.pal = s.pal;
          FxKit.tumble(p, 6);
        }
        for (let i = 0; i < 6; i++) {
          const p = K.add(SH.cube, u, 2, w, r(-4, 4), r(6, 10), r(-4, 4), 0.5, r(1.8, 2.2), pc(s, i));
          p.sx = 0.16; p.sy = 0.05; p.sz = 2.4; p.g = 6; p.drag = 1.2; p.term = 2.4; p.wx = r(4, 8);
        }
        flash(K, u, 1.5, w, 4, 0xffffff);
      }
      if (b > 0.5) snowfall(K, K.rate(s, 0, 40, dt), 9);
    },
  },
};

/** The show for a goal explosion id, or null ('club' and anything unknown: the match's own burst in kit colours). */
export function goalShow(id: string | undefined): GoalShowDef | null {
  return (id && Object.prototype.hasOwnProperty.call(GOAL_SHOWS, id) ? GOAL_SHOWS[id] : null);
}
