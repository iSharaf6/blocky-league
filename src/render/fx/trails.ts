import { DIE, F, FX_FIRE, FX_SNOW, FxKit, pick, rand as r, type TrailState } from './kit';
import { SH } from './shapes';

/**
 * TRAILS: what the player you control leaves behind on a sprint, and what your side's hard shots leave behind
 * the ball (game/matchSession.ts). Each trail is its own little emitter, not a colour: popcorn popping off the
 * heels, hearts floating up, frozen footprints, a rainbow ribbon, crackling lightning...
 *
 * An emitter is called every frame with where the runner's boots are (or the ball's centre: `air`), his heading
 * (fx, fz) and speed; it spawns in that frame (u ahead, w across, y up, times `k`: the characters are drawn
 * bigger on a phone, render/characters.ts screenCharK). Footprint trails count strides off the distance run.
 * Readable, never in the way: small, short-lived, behind and below the head.
 */

export type TrailFn = (K: FxKit, st: TrailState, pal: readonly number[], speed: number, dt: number, air: boolean) => void;

export interface TrailDef {
  run: TrailFn;
  /** Seconds into the shop's sprint loop for the tile's still. */
  still: number;
}

const TAU = Math.PI * 2;
const SPARK = [0xffffff, 0xfff0b0, 0xffd23a, 0xff9a1f] as const;
const GOLD = [0xffd23a, 0xfff0b0, 0xffb300, 0xffffff] as const;
const AUTUMN = [0xe8661a, 0xc7970f, 0xd8241a, 0x8a5a36, 0xffb35c] as const;
const MUD = [0x7a5236, 0x5a3a20, 0x8a6a4a] as const;
const WATER = [0x5cc8f5, 0xa8e4ff, 0xffffff] as const;

/** How many to spawn this frame at `perSec` (the ball sheds more: it covers far more ground). */
function many(st: TrailState, perSec: number, dt: number, air: boolean, second = false): number {
  const add = perSec * dt * (air ? 1.7 : 1);
  if (second) {
    st.acc2 += add;
    const n = Math.floor(st.acc2);
    st.acc2 -= n;
    return n;
  }
  st.acc += add;
  const n = Math.floor(st.acc);
  st.acc -= n;
  return n;
}

/** A height on the runner (lo..hi m) or round the ball's centre. */
const hy = (air: boolean, lo: number, hi: number): number => (air ? r(-0.25, 0.25) : r(lo, hi));
const pc = (pal: readonly number[], i: number): number => pal[((i % pal.length) + pal.length) % pal.length];

/** Strides: true once per `len` m run (st.side flips each time: left boot, right boot). */
function stride(st: TrailState, speed: number, dt: number, len: number): boolean {
  st.dist += speed * dt;
  if (st.dist < len) return false;
  st.dist -= len;
  if (st.dist > len) st.dist = 0;
  st.side = -st.side;
  return true;
}

/** A boot print flat on the grass under the runner (yawed to his heading). */
function print(K: FxKit, st: TrailState, col: number, life: number, size = 0.42): void {
  const p = K.add(SH.print, 0, 0, st.side * 0.14, 0, 0, 0, size, life, col);
  p.f |= F.FLAT | F.KEEP | F.POP;
  p.ry = K.yawU + Math.PI;
  p.y = 0.02;
}

/** A sparkle that twinkles where it is left. */
function twinkle(K: FxKit, air: boolean, col: number, size = 0.22): void {
  const p = K.add(SH.sparkle, r(-0.5, -0.1), hy(air, 0.3, 1.5), r(-0.35, 0.35), 0, r(0.1, 0.5), 0, size, r(0.35, 0.6), col);
  p.f |= F.FACE | F.TWINK;
}

/** One ribbon segment per band from the last point to here (st.lx..: the path so far, in the kit's space). */
function ribbon(K: FxKit, st: TrailState, x: number, y: number, z: number, bands: readonly number[], nb: number, gap: number, life: number, k: number, air: boolean, light = false): void {
  if (Number.isNaN(st.lx)) {
    st.lx = x; st.ly = y; st.lz = z;
    return;
  }
  const dx = x - st.lx, dz = z - st.lz;
  const len = Math.hypot(dx, dz);
  // (Segments of 0.22 m behind a runner; longer behind a ball, which covers three times the ground.)
  if (len < (air ? 0.6 : 0.22) * k) return;
  if (len > 3 * k) {
    // A jump (a cut, a respawn): start again here.
    st.lx = x; st.ly = y; st.lz = z;
    return;
  }
  K.setFrame((x + st.lx) / 2, 0, (z + st.lz) / 2, dx, dz, k);
  const n = Math.min(nb, bands.length);
  const base = air ? (y + st.ly) / 2 / k - (n - 1) * gap * 0.5 : light ? 0.9 : 0.35;
  for (let i = 0; i < n; i++) {
    const p = K.add(light ? SH.beam : SH.cube, light ? -len / k / 2 : 0, base + i * gap, 0, 0, 0, 0, gap * (light ? 1.4 : 1.05), life, bands[i]);
    p.ry = K.yawU;
    p.sz = (len / k + (light ? 0 : 0.06)) / (gap * (light ? 1.4 : 1.05));
    if (light) p.f |= F.LEN;
  }
  st.lx = x; st.ly = y; st.lz = z;
}

/** A jagged bolt (additive) from local a to local b in a few zigzags. */
function zap(K: FxKit, au: number, ay: number, aw: number, bu: number, by: number, bw: number, n: number, col: number, thick: number, life: number): void {
  let pu = au, py = ay, pw = aw;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const nu = i === n ? bu : au + (bu - au) * t + r(-0.15, 0.15);
    const ny = i === n ? by : ay + (by - ay) * t + r(-0.25, 0.25);
    const nw = i === n ? bw : aw + (bw - aw) * t + r(-0.2, 0.2);
    K.beamTo(pu, py, pw, nu, ny, nw, thick, life, col);
    pu = nu; py = ny; pw = nw;
  }
}

// ------------------------------------------------------------------ the trails

export const TRAILS: { readonly [id: string]: TrailDef } = {
  /** TOON DASH: cartoon dust puffs off the heels and inky speed lines. */
  toon: {
    still: 0.55, run(K, st, pal, _speed, dt, air) {
      const n = many(st, 16, dt, air);
      for (let i = 0; i < n; i++) {
        const p = K.add(SH.blob, r(-0.5, -0.3), air ? r(-0.2, 0.2) : r(0.12, 0.3), r(-0.2, 0.2), -1, r(0.3, 0.8), r(-0.5, 0.5), r(0.35, 0.55), 0.38, 0xffffff);
        p.f |= F.PUFF; p.drag = 3;
      }
      const m = many(st, 14, dt, air, true);
      for (let i = 0; i < m; i++) {
        const p = K.add(SH.cube, r(-1.4, -0.8), hy(air, 0.35, 1.6), r(-0.45, 0.45), -2, 0, 0, 0.05, 0.2, i % 3 ? 0x26262e : pc(pal, i));
        p.sz = r(12, 22); p.ry = K.yawU;
      }
      if (Math.random() < dt * 2.5) {
        const p = K.add(SH.star, -0.4, hy(air, 1.2, 1.7), r(-0.3, 0.3), 0, 1, 0, 0.3, 0.45, 0xffd23a);
        p.f |= F.FACE | F.POP; p.wz = 6;
      }
    },
  },

  /** HEARTS: little hearts pop off you and float up, swaying. */
  hearts: {
    still: 0.7, run(K, st, pal, _speed, dt, air) {
      const n = many(st, 16, dt, air);
      for (let i = 0; i < n; i++) {
        const p = K.add(SH.heart, r(-0.6, -0.25), hy(air, 0.4, 1.4), r(-0.3, 0.3), -0.4, r(0.8, 1.5), r(-0.4, 0.4), r(0.28, 0.42), r(0.9, 1.3), pick(pal));
        p.f |= F.FACE | F.POP | F.SWAY | F.WOB; p.sw = 1.2; p.wob = 0.35;
      }
    },
  },

  /** BUBBLEGUM: bubbles drift up behind you, wobble and pop. */
  pink: {
    still: 0.7, run(K, st, pal, _speed, dt, air) {
      const n = many(st, 13, dt, air);
      for (let i = 0; i < n; i++) {
        const big = Math.random() < 0.15;
        const p = K.add(SH.bubble, r(-0.6, -0.2), hy(air, 0.3, 1.3), r(-0.35, 0.35), -0.3, r(0.5, 1.1), r(-0.3, 0.3), big ? r(0.55, 0.7) : r(0.25, 0.45), r(0.8, 1.4), pick(pal));
        p.f |= F.POP | F.SWAY; p.sw = 1.5; p.die = DIE.bubble;
      }
    },
  },

  /** POPCORN: kernels pop off your heels and bounce along the grass. */
  popcorn: {
    still: 0.8, run(K, st, _pal, _speed, dt, air) {
      const n = many(st, 18, dt, air);
      for (let i = 0; i < n; i++) {
        const p = K.add(SH.kernel, r(-0.4, -0.2), air ? 0 : 0.3, r(-0.2, 0.2), r(-2, 0), r(3, 5.5), r(-1.2, 1.2), r(0.2, 0.28), r(1, 1.4), 0xffffff);
        p.g = 14; p.b = 0.4; p.f |= F.POP;
        FxKit.tumble(p, 9);
        if (Math.random() < 0.4) {
          const q = K.add(SH.blob, r(-0.4, -0.2), air ? 0 : 0.3, 0, 0, 0.5, 0, 0.22, 0.2, 0xffffff);
          q.f |= F.PUFF;
        }
      }
    },
  },

  /** MUSIC NOTES: notes bob up behind you in a wavy line. */
  notes: {
    still: 0.75, run(K, st, pal, _speed, dt, air) {
      const n = many(st, 10, dt, air);
      for (let i = 0; i < n; i++) {
        const p = K.add(SH.note, r(-0.6, -0.3), hy(air, 0.6, 1.5), r(-0.3, 0.3), -0.3, r(1, 1.5), 0, r(0.35, 0.5), 1.2, pick(pal));
        p.f |= F.FACE | F.POP | F.SWAY | F.WOB; p.sw = 2; p.wob = 0.4;
      }
      if (many(st, 6, dt, air, true)) twinkle(K, air, pick(pal), 0.16);
    },
  },

  /** SLIME: goo drips off your boots and splats on the grass. */
  lime: {
    still: 0.8, run(K, st, pal, _speed, dt, air) {
      const n = many(st, 12, dt, air);
      for (let i = 0; i < n; i++) {
        const p = K.add(SH.blob, r(-0.35, -0.15), air ? 0 : 0.3, r(-0.2, 0.2), r(-0.6, 0), r(0.5, 2), r(-0.4, 0.4), r(0.18, 0.3), 1.6, pick(pal));
        p.g = 14; p.b = 0; p.f |= F.LAND; p.die = DIE.splat;
      }
      if (many(st, 3, dt, air, true)) {
        const p = K.add(SH.bubble, -0.4, hy(air, 0.3, 0.8), r(-0.2, 0.2), 0, 0.6, 0, r(0.2, 0.3), 0.7, pc(pal, 0));
        p.die = DIE.bubble; p.f |= F.POP;
      }
    },
  },

  /** ICE TRAIL: frozen boot prints behind you, snowflakes drifting down and frost sparkling. */
  ice: {
    still: 0.9, run(K, st, pal, speed, dt, air) {
      if (!air && stride(st, speed, dt, 0.85)) print(K, st, 0xd6f3ff, 1.6);
      const n = many(st, air ? 10 : 6, dt, air);
      for (let i = 0; i < n; i++) {
        const p = K.add(SH.flake, r(-0.6, -0.2), hy(air, 0.5, 1.5), r(-0.4, 0.4), -0.3, -r(0.2, 0.5), r(-0.3, 0.3), r(0.2, 0.3), r(0.8, 1.2), pick(FX_SNOW));
        p.f |= F.FACE; p.wz = r(-3, 3);
      }
      if (many(st, 6, dt, air, true)) twinkle(K, air, pick(pal), 0.2);
    },
  },

  /** AFTERBURNER: pixel flames licking up off your heels and turning to smoke. */
  fire: {
    still: 0.6, run(K, st, _pal, _speed, dt, air) {
      const n = many(st, 40, dt, air);
      for (let i = 0; i < n; i++) {
        const p = K.add(SH.cube, r(-0.4, -0.1), air ? r(-0.15, 0.15) : r(0.1, 0.5), r(-0.2, 0.2), -1, r(1.5, 3), r(-0.4, 0.4), r(0.16, 0.26), r(0.35, 0.55), FX_FIRE[0]);
        p.f |= F.PUFF | F.AGE; p.pal = FX_FIRE; p.g = -1.5; p.drag = 1.5;
        FxKit.tumble(p, 4);
      }
    },
  },

  /** GOLDEN BOOTS: gold coins spill off your heels, spinning and bouncing, with a glint. */
  gold: {
    still: 0.8, run(K, st, _pal, _speed, dt, air) {
      const n = many(st, 12, dt, air);
      for (let i = 0; i < n; i++) {
        const p = K.add(SH.coin, r(-0.4, -0.2), air ? 0 : 0.35, r(-0.2, 0.2), r(-1.5, 0), r(3, 5), r(-1, 1), r(0.24, 0.3), r(1, 1.3), 0xffffff);
        p.g = 14; p.b = 0.35; p.wy = r(10, 14); p.rx = r(0, TAU);
      }
      if (many(st, 6, dt, air, true)) twinkle(K, air, pick(GOLD));
    },
  },

  /** GLITCH: you break up into flickering RGB pixels as you go. */
  glitch: {
    still: 0.5, run(K, st, pal, _speed, dt, air) {
      const n = many(st, 60, dt, air);
      for (let i = 0; i < n; i++) {
        const p = K.add(SH.cube, r(-0.9, -0.2), hy(air, 0.15, 1.8), r(-0.25, 0.25), r(-0.5, 0), 0, 0, r(0.12, 0.22), r(0.12, 0.28), pick(pal));
        p.sx = Math.random() < 0.3 ? r(2, 5) : 1; p.sz = 0.3;
        p.f |= F.FACE | F.FLICK | F.KEEP; p.pal = pal;
      }
    },
  },

  /** RAINBOW DASH: a striped rainbow ribbon streams out behind you. */
  rainbow: {
    still: 0.9, run(K, st, pal, _speed, dt, air) {
      const x = K.lastX, y = K.lastY, z = K.lastZ, k = K.lastK;
      ribbon(K, st, x, y, z, pal, 6, 0.1, 0.8, k, air);
      K.setFrame(x, y, z, K.lastFx, K.lastFz, k);
      if (many(st, 5, dt, air, true)) twinkle(K, air, 0xffffff, 0.2);
    },
  },

  /** LIGHTNING: bolts crackle off your heels and arc round you, sparks flying. */
  lightning: {
    still: 0.45, run(K, st, pal, _speed, dt, air) {
      if (many(st, 22, dt, air)) {
        const y0 = air ? 0 : 0.5;
        const eu = -r(1.5, 2.6), ey = air ? r(-0.5, 0.5) : r(0.1, 1.3), ew = r(-0.6, 0.6);
        zap(K, -0.1, y0, 0, eu, ey, ew, 4, 0xffffff, 0.09, 0.11);
        zap(K, -0.1, y0, 0, eu, ey, ew, 3, pick(pal), 0.24, 0.08);
      }
      const m = many(st, 18, dt, air, true);
      for (let i = 0; i < m; i++) {
        if (i === 0 && Math.random() < 0.4) {
          const a = Math.random() * TAU;
          zap(K, Math.cos(a) * 0.35, hy(air, 0.3, 1.5), Math.sin(a) * 0.35, Math.cos(a + 1) * 0.45, hy(air, 0.3, 1.5), Math.sin(a + 1) * 0.45, 2, pc(pal, 1), 0.06, 0.07);
        }
        const p = K.add(SH.cube, r(-0.3, 0), hy(air, 0.2, 1), r(-0.3, 0.3), r(-3, 1), r(0, 3), r(-2, 2), r(0.05, 0.09), r(0.15, 0.3), pick(pal));
        p.g = 8; p.f |= F.TWINK;
      }
    },
  },

  /** COMET TAIL: a blazing tail of stardust and twinkling stars, a glowing core at its head. */
  comet: {
    still: 0.7, run(K, st, pal, _speed, dt, air) {
      const n = many(st, 75, dt, air);
      for (let i = 0; i < n; i++) {
        const p = K.add(SH.cube, r(-0.4, 0), hy(air, 0.3, 1.4), r(-0.3, 0.3), r(-3, -1), r(-0.3, 0.6), r(-0.6, 0.6), r(0.08, 0.16), r(0.6, 1), pick(pal));
        p.drag = 1.2; p.f |= F.TWINK;
      }
      const m = many(st, 22, dt, air, true);
      for (let i = 0; i < m; i++) {
        if (i % 2) {
          const p = K.add(SH.star, r(-0.8, -0.2), hy(air, 0.4, 1.5), r(-0.4, 0.4), r(-1, 0), r(0, 0.5), 0, r(0.25, 0.4), r(0.6, 0.9), pick(pal));
          p.f |= F.FACE | F.TWINK; p.wz = r(-3, 3);
        } else {
          K.add(SH.glow, -0.2, hy(air, 0.6, 1.1), 0, 0, 0, 0, 0.32, 0.14, 0xffffff);
        }
      }
    },
  },

  // ---------------------------------------------------------------- Club Pass, one a month (January first)

  /** FROST CUP: a flurry of snowflakes whirls off you and powder puffs off your boots. */
  pass01: {
    still: 0.7, run(K, st, pal, _speed, dt, air) {
      const n = many(st, 18, dt, air);
      for (let i = 0; i < n; i++) {
        const p = K.add(SH.flake, r(-0.6, -0.2), hy(air, 0.3, 1.5), r(-0.4, 0.4), r(-0.8, 0), r(0.3, 1), r(-0.6, 0.6), r(0.2, 0.32), r(0.8, 1.2), pick(pal));
        p.f |= F.FACE | F.SWAY; p.sw = 2; p.wz = r(-5, 5); p.g = 1; p.term = 0.8;
      }
      if (!air && many(st, 10, dt, air, true)) {
        const p = K.add(SH.blob, -0.35, 0.15, r(-0.2, 0.2), -0.6, 0.4, 0, r(0.25, 0.35), 0.35, 0xffffff);
        p.f |= F.PUFF;
      }
    },
  },

  /** MUD AND GLORY: muddy boot prints and mud flicked up off your heels. */
  pass02: {
    still: 0.8, run(K, st, _pal, speed, dt, air) {
      if (!air && stride(st, speed, dt, 0.85)) print(K, st, 0x5a3a20, 1.8, 0.46);
      const n = many(st, 12, dt, air);
      for (let i = 0; i < n; i++) {
        const p = K.add(SH.cube, r(-0.35, -0.15), air ? 0 : 0.25, r(-0.2, 0.2), r(-2, -0.5), r(2, 4), r(-0.6, 0.6), r(0.1, 0.16), 1.2, pick(MUD));
        p.g = 14; p.b = 0; FxKit.tumble(p, 8);
        if (air) { p.f |= F.LAND; p.die = DIE.splat; }
      }
    },
  },

  /** SPRING DERBY: flowers spring up in your footsteps, petals on the breeze. */
  pass03: {
    still: 0.9, run(K, st, pal, speed, dt, air) {
      if (!air && stride(st, speed, dt, 0.9)) {
        const p = K.add(SH.flower, 0, 0, st.side * 0.18, 0, 0, 0, r(0.45, 0.6), 1.2, pick(pal));
        p.f |= F.FACEY | F.POP | F.KEEP;
      }
      const n = many(st, 8, dt, air);
      for (let i = 0; i < n; i++) {
        const p = K.add(SH.leaf, r(-0.5, -0.2), hy(air, 0.3, 1.2), r(-0.3, 0.3), r(-0.5, 0), r(0.4, 1), r(0.5, 1.5), r(0.16, 0.22), r(0.9, 1.3), pick(pal));
        p.f |= F.SWAY; p.sw = 2; p.g = 0.5; FxKit.tumble(p, 5);
      }
    },
  },

  /** APRIL SHOWERS: your own little rain cloud follows you about, raining. */
  pass04: {
    still: 0.9, run(K, st, _pal, _speed, dt, air) {
      const top = air ? 0.9 : 2.5;
      const n = many(st, 24, dt, air);
      for (let i = 0; i < n; i++) {
        const p = K.add(SH.blob, r(-0.5, 0.15), top + r(-0.12, 0.12), r(-0.35, 0.35), 0, 0, 0, r(0.38, 0.52), 0.42, i % 3 ? 0xeef2f6 : 0xc9d1dc);
        p.f |= F.PUFF;
      }
      const m = many(st, 24, dt, air, true);
      for (let i = 0; i < m; i++) {
        const p = K.add(SH.cube, r(-0.5, 0.1), top - 0.2, r(-0.3, 0.3), 0, -5, 0, 0.05, 1.2, pick(WATER));
        p.g = 9; p.b = 0; p.f |= F.AIM | F.LAND; p.st = 0.4; p.die = DIE.splash;
      }
    },
  },

  /** TITLE RACE: gold stars and ticker tape in your wake. */
  pass05: {
    still: 0.75, run(K, st, pal, _speed, dt, air) {
      const n = many(st, 14, dt, air);
      for (let i = 0; i < n; i++) {
        const p = K.add(SH.cube, r(-0.6, -0.2), hy(air, 0.6, 1.8), r(-0.35, 0.35), r(-0.5, 0), r(0.5, 1.5), r(-0.4, 0.4), 0.16, r(1, 1.4), i % 3 ? pick(GOLD) : pick(pal));
        p.sy = 0.15; p.sz = 0.6; p.g = 4; p.drag = 1.5; p.term = 1.2; p.f |= F.SWAY; p.sw = 3;
        FxKit.tumble(p, 8);
      }
      const m = many(st, 8, dt, air, true);
      for (let i = 0; i < m; i++) {
        const p = K.add(SH.star, r(-0.6, -0.2), hy(air, 0.5, 1.6), r(-0.3, 0.3), 0, 0.5, 0, r(0.22, 0.32), 0.7, 0xffd23a);
        p.f |= F.FACE | F.TWINK | F.POP;
      }
    },
  },

  /** SUMMER SEVENS: every step splashes, droplets sparkling behind you. */
  pass06: {
    still: 0.85, run(K, st, _pal, speed, dt, air) {
      if (!air && stride(st, speed, dt, 0.85)) {
        const ring = K.add(SH.ring, 0, 0, st.side * 0.14, 0, 0, 0, 0.3, 0.35, 0xcfe8ff);
        ring.f |= F.FLAT; ring.gs = 1.6 * K.lastK; ring.y = 0.03;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU;
          const p = K.add(SH.blob, 0, 0.1, st.side * 0.14, Math.cos(a) * 1.2 - 0.5, r(2, 3.2), Math.sin(a) * 1.2, r(0.1, 0.14), 0.4, pick(WATER));
          p.g = 12;
        }
      }
      const n = many(st, air ? 16 : 6, dt, air);
      for (let i = 0; i < n; i++) {
        const p = K.add(SH.blob, r(-0.5, -0.2), hy(air, 0.2, 0.9), r(-0.3, 0.3), r(-1, 0), r(0.5, 2), r(-0.5, 0.5), r(0.08, 0.13), 0.5, pick(WATER));
        p.g = 10;
      }
    },
  },

  /** HEATWAVE CUP: little smiling suns spin up off you in a heat shimmer. */
  pass07: {
    still: 0.8, run(K, st, pal, _speed, dt, air) {
      const n = many(st, 5, dt, air);
      for (let i = 0; i < n; i++) {
        const p = K.add(SH.sun, r(-0.6, -0.3), hy(air, 0.6, 1.5), r(-0.3, 0.3), -0.3, r(0.8, 1.3), 0, r(0.32, 0.42), 1.1, 0xffffff);
        p.f |= F.FACE | F.POP | F.WOB; p.wob = 0.5;
      }
      if (many(st, 12, dt, air, true)) twinkle(K, air, pick(pal), 0.2);
    },
  },

  /** TRAINING CAMP: training cones pop up behind you in a slalom, chalk dashes on the grass. */
  pass08: {
    still: 0.9, run(K, st, _pal, speed, dt, air) {
      if (air) {
        if (many(st, 5, dt, air)) {
          const p = K.add(SH.football, -0.3, 0, 0, r(-1, 0), r(1, 3), r(-1, 1), 0.26, 1.2, 0xffffff);
          p.g = 12; p.b = 0.6; FxKit.tumble(p, 8);
        }
        return;
      }
      if (stride(st, speed, dt, 1.5)) {
        const c = K.add(SH.cone, -0.3, 0, st.side * 0.5, 0, 0, 0, 0.45, 1.5, 0xffffff);
        c.f |= F.POP | F.KEEP;
        const d = K.add(SH.cube, -0.9, 0.02, 0, 0, 0, 0, 0.08, 1.3, 0xf4f4ea);
        d.sy = 0.3; d.sz = 6; d.ry = K.yawU; d.f |= F.KEEP;
      }
    },
  },

  /** HARVEST CUP: autumn leaves kicked up and tumbling behind you. */
  pass09: {
    still: 0.8, run(K, st, _pal, _speed, dt, air) {
      const n = many(st, 16, dt, air);
      for (let i = 0; i < n; i++) {
        const p = K.add(SH.leaf, r(-0.5, -0.2), air ? 0 : r(0.1, 0.5), r(-0.3, 0.3), r(-1.5, 0), r(1, 2.5), r(-0.8, 0.8), r(0.22, 0.32), r(1, 1.4), pick(AUTUMN));
        p.g = 3; p.term = 1; p.drag = 0.8; p.f |= F.SWAY; p.sw = 3;
        FxKit.tumble(p, 9);
      }
    },
  },

  /** FLOODLIGHTS: a neon light line painted behind you, camera flashes popping. */
  pass10: {
    still: 0.9, run(K, st, pal, _speed, dt, air) {
      const x = K.lastX, y = K.lastY, z = K.lastZ, k = K.lastK;
      ribbon(K, st, x, y, z, pal, 2, 0.12, 0.6, k, air, true);
      K.setFrame(x, y, z, K.lastFx, K.lastFz, k);
      if (many(st, 7, dt, air, true)) {
        const p = K.add(SH.sparkle, r(-1, 0.3), hy(air, 0.4, 1.9), r(-0.6, 0.6), 0, 0, 0, r(0.3, 0.45), 0.1, 0xffffff);
        p.f |= F.FACE | F.POP;
      }
    },
  },

  /** BONFIRE DERBY: a sparkler fizzing off you, sparks spraying every way. */
  pass11: {
    still: 0.55, run(K, st, pal, _speed, dt, air) {
      const n = many(st, 60, dt, air);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, e = r(-0.5, 1.2), v = r(2, 4.5);
        const p = K.add(SH.cube, -0.2, air ? 0 : 1, 0, Math.cos(a) * Math.cos(e) * v - 1, Math.sin(e) * v, Math.sin(a) * Math.cos(e) * v, r(0.05, 0.08), r(0.25, 0.45), i % 5 ? pick(SPARK) : pick(pal));
        p.g = 8; p.f |= F.AIM | F.TWINK; p.st = 0.08;
      }
    },
  },

  /** WINTER CLASSIC: tiny presents and sweets bounce out behind you, snow falling. */
  pass12: {
    still: 0.8, run(K, st, pal, _speed, dt, air) {
      const n = many(st, 9, dt, air);
      for (let i = 0; i < n; i++) {
        const gift = i % 2 === 0;
        const p = K.add(gift ? SH.gift : SH.candy, r(-0.4, -0.2), air ? 0 : 0.4, r(-0.2, 0.2), r(-1.2, 0), r(2.5, 4), r(-0.8, 0.8), gift ? 0.3 : 0.28, r(1, 1.3), pick(pal));
        p.g = 14; p.b = 0.4; p.f |= F.POP;
        if (gift) FxKit.tumble(p, 6);
        else { p.f |= F.FACE; p.wz = r(-5, 5); }
      }
      const m = many(st, 7, dt, air, true);
      for (let i = 0; i < m; i++) {
        const p = K.add(SH.flake, r(-0.6, -0.2), hy(air, 0.8, 1.8), r(-0.4, 0.4), 0, -0.4, 0, 0.2, 1, 0xffffff);
        p.f |= F.FACE; p.wz = r(-3, 3);
      }
    },
  },
};

/** The emitter for a trail id, or null ('white', the chalk lines, and anything unknown). */
export function trailDef(id: string | undefined): TrailDef | null {
  return id && Object.prototype.hasOwnProperty.call(TRAILS, id) ? TRAILS[id] : null;
}

/**
 * Run trail `id` for one frame on kit K: the runner's boots (or the ball, `air`) at (x, y, z) in the kit's space,
 * heading (fx, fz), `speed` m/s, scale `k`. False when there is no such trail.
 */
export function emitTrail(K: FxKit, st: TrailState, id: string | undefined, pal: readonly number[], x: number, y: number, z: number, fx: number, fz: number, speed: number, dt: number, k = 1, air = false): boolean {
  const def = trailDef(id);
  if (!def || dt <= 0) return false;
  K.trailAt(x, y, z, fx, fz, k);
  def.run(K, st, pal, speed, dt, air);
  st.t += dt;
  return true;
}

/**
 * LIGHT UP BOOTS (a player look, render/looks.ts): every footstep of a player wearing them leaves a glowing print on
 * the grass, alternating cyan and pink, with a flash of light at the boot. The boots themselves are a voxel or two at
 * broadcast distance; the prints are what reads from the gantry. Pooled props, nothing allocated: one call a step.
 * (x, z): the runner; (ux, uz): his heading; `side` the foot (+1 / -1); `k` the draw scale (players are drawn bigger
 * on phones).
 */
export const BOOT_STEP_M = 0.85;
export function bootStep(K: FxKit, x: number, z: number, ux: number, uz: number, side: number, k = 1): void {
  K.setFrame(x, 0, z, ux, uz, k);
  const col = side > 0 ? 0x3cf7ff : 0xff3cf0;
  const p = K.add(SH.print, -0.08, 0, side * 0.18, 0, 0, 0, 0.85, 1.6, col);
  p.f |= F.FLAT | F.KEEP | F.POP;
  p.ry = K.yawU + Math.PI;
  p.y = 0.03;
  const g = K.add(SH.glow, -0.05, 0.12, side * 0.18, 0, 0, 0, 1.8, 0.2, col);
  g.f |= F.FACE;
}
