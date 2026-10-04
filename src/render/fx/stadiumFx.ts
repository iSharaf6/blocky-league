import { GOAL_H, GOAL_W, HALF_L, HALF_W } from '../../sim/constants';
import { DIE, EMIT, F, FX_FIRE, FxKit, rand as r, type Show, type ShowFn } from './kit';
import { SH } from './shapes';
import { SIGNATURE_PALETTES } from '../signatureStyle';

/**
 * STADIUM STYLE shows (render/stadiumStyle.ts plays them on the match's effects kit): the walkout at kick-off, the
 * show at the goal when you score, the one after a win, and the mascots' own bits (the bear's drum, the robot's
 * sparks, the dragon's fire).
 *
 * THE RULE: nothing here ever lands on the playing surface. A walkout goes off behind the ad boards along the far
 * touchline, behind the two goals and off the far stand's roof; a goal show behind the goal line and the boards behind
 * it; and each is short: the walkouts stop spawning inside 2.4 s (the fly-in), and everything is gone before play.
 * (The owner's playtest: flame blobs on the pitch among the players at kick-off "read as a glitch".)
 *
 * Frames. A walkout runs in a frame laid on the pitch (the centre spot, facing +x): u along the pitch, w across it
 * (+w towards the broadcast lens), y up. A goal show runs at the goal line's middle facing OUT of the goal: u < 0 is
 * behind the goal. `s.bw` carries the far stand's roof height for a walkout (0: no stand, the rockets go up from
 * behind the fence). Kid-safe: cartoon flames, bangs and confetti.
 */

const hit = (a: number, b: number, t: number): boolean => a < t && t <= b;
const pc = (s: Show, i: number): number => s.pal[((i % s.pal.length) + s.pal.length) % s.pal.length];

/** Behind the far touchline's ad boards (boards at HALF_W + 3.2, the stand's front at + 5.6). */
const FAR = -(HALF_W + 4.2);
/** Behind the ad boards behind a goal (boards at HALF_L + 4.6). */
const END = HALF_L + 5.6;
/** Where things stand along the far boards, and behind each goal (across the pitch). */
const LINE = [-40, -30, -20, -10, 0, 10, 20, 30, 40] as const;
const JETS = [-44, -36, -28, -20, -12, -4, 4, 12, 20, 28, 36, 44] as const;
const BEHIND = [-11, -5.5, 5.5, 11] as const;

/** A confetti flake: flat, fluttering, tumbling. */
function flake(K: FxKit, u: number, y: number, w: number, vu: number, vy: number, vw: number, col: number, life = 2.4): void {
  const p = K.add(SH.cube, u, y, w, vu, vy, vw, 0.34, life, col);
  p.sy = 0.12; p.sz = 0.7;
  p.g = 7; p.drag = 1.5; p.term = 2.4; p.f |= F.SWAY; p.sw = 3;
  FxKit.tumble(p, 9);
}

/** A puff of cannon smoke. */
function puff(K: FxKit, u: number, y: number, w: number, size: number, col = 0xd6dde6): void {
  const p = K.add(SH.blob, u, y, w, r(-0.4, 0.4), r(0.6, 1.4), r(-0.4, 0.4), size, r(0.6, 0.9), col);
  p.f |= F.PUFF;
  p.drag = 2;
}

/** A cannon at (u, w) firing `n` flakes up and away along (du, dw) (a unit direction AWAY from the pitch). */
function cannon(K: FxKit, s: Show, u: number, w: number, du: number, dw: number, n: number, seed: number): void {
  for (let i = 0; i < n; i++) {
    const out = r(1.5, 5.5);
    flake(K, u, 1, w, du * out + r(-2.2, 2.2), r(10, 16), dw * out + r(-2.2, 2.2), pc(s, i + seed));
  }
  puff(K, u, 1, w, 1.3);
}

/**
 * A firework rocket from (u, y0, w) climbing on a spark trail and leaning AWAY from the pitch along (du, dw), bursting
 * about `h` m above where it left.
 */
function rocket(K: FxKit, s: Show, u: number, y0: number, w: number, du: number, dw: number, die: number, h: number): void {
  const vy = r(15, 17);
  const g = 12;
  const t = Math.min(vy / g - 0.1, Math.max(0.45, (vy - Math.sqrt(Math.max(0, vy * vy - 2 * g * h))) / g));
  const lean = r(1.5, 4);
  const p = K.add(SH.rocket, u, y0 + 0.6, w, du * lean + r(-1.5, 1.5), vy, dw * lean + r(-1.5, 1.5), 1.2, t, 0xffffff);
  p.g = g; p.f |= F.AIM; p.emit = EMIT.sparks; p.er = 40; p.pal = s.pal; p.die = die;
  K.cue('whoosh');
}

/** A fountain of sparks at (u, w): a gerb, about 4 m tall. */
function fountain(K: FxKit, s: Show, u: number, w: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const p = K.add(i % 3 ? SH.cube : SH.sparkle, u, 0.6, w, r(-1.1, 1.1), r(7, 10.5), r(-1.1, 1.1), r(0.16, 0.28), r(0.6, 0.95), pc(s, i));
    p.g = 10; p.drag = 0.8; p.f |= F.TWINK;
    p.delay = r(0, 0.22);
  }
}

/** A jet of cartoon flame straight up from (u, w), about `h` m tall. */
function jet(K: FxKit, u: number, w: number, n: number, h = 6): void {
  const v = Math.sqrt(h) * 4.6;
  for (let i = 0; i < n; i++) {
    const p = K.add(SH.cube, u + r(-0.25, 0.25), 0.5, w + r(-0.25, 0.25), r(-0.7, 0.7), r(v * 0.8, v * 1.15), r(-0.7, 0.7), r(0.4, 0.7), r(0.4, 0.62), FX_FIRE[0]);
    p.f |= F.PUFF | F.AGE;
    p.pal = FX_FIRE;
    p.g = 5;
    p.drag = 1.3;
    p.delay = i * 0.012;
    FxKit.tumble(p, 5);
  }
  // (A small flash at its foot: the flame is the show, not the glow.)
  K.add(SH.glow, u, 1.4, w, 0, 0, 0, 1.7, 0.12, 0xffb23a);
}

/** A column of club-colour smoke rising from (u, w): one puff of it. */
function smoke(K: FxKit, s: Show, u: number, w: number, i: number): void {
  const p = K.add(SH.blob, u + r(-0.5, 0.5), 0.8, w + r(-0.5, 0.5), r(-0.5, 0.5), r(2.6, 4.2), r(-0.5, 0.5), r(1.2, 1.9), r(1.5, 2.2), pc(s, i));
  p.f |= F.PUFF | F.SWAY;
  p.sw = 1.2;
  p.drag = 0.5;
}

const ROCKET_DIES = [DIE.firework, DIE.ringwork, DIE.willow] as const;

// ------------------------------------------------------------------ walkouts (kick-off)

/**
 * CONFETTI WALKOUT: cannons behind the far boards and behind both goals fire two rounds of club confetti up and back
 * over the stands. It comes down among the fans, never on the grass.
 */
const kickConfetti: ShowFn = (K, s, a, b) => {
  // (The walkouts run at k 1.6, so they read from the fly-in's high shot: positions are divided back.)
  const k = s.k;
  for (let n = 0; n < 2; n++) {
    if (!hit(a, b, 0.05 + n * 0.55)) continue;
    for (let i = n; i < LINE.length; i += 2) cannon(K, s, LINE[i] / k, FAR / k, 0, -1, 16, i);
    for (const side of [-1, 1]) for (let i = n; i < BEHIND.length; i += 2) cannon(K, s, (side * END) / k, BEHIND[i] / k, side, 0, 16, i);
    K.cue('pop');
  }
};

/**
 * FIREWORKS WALKOUT: spark fountains along the far boards and behind the goals, and a volley of rockets off the far
 * stand's roof bursting in the sky over it, in club colours.
 */
const kickFireworks: ShowFn = (K, s, a, b) => {
  const k = s.k;
  const roof = s.bw / k;
  for (let i = 0; i < 7; i++) {
    if (hit(a, b, 0.1 + i * 0.3)) rocket(K, s, LINE[(i * 4 + 1) % LINE.length] / k, roof, (FAR - 7) / k, 0, -1, ROCKET_DIES[i % 3], 9);
  }
  for (let n = 0; n < 3; n++) {
    if (!hit(a, b, 0.02 + n * 0.75)) continue;
    for (let i = n % 2; i < LINE.length; i += 2) fountain(K, s, LINE[i] / k, FAR / k, 16);
    for (const side of [-1, 1]) fountain(K, s, (side * END) / k, (n % 2 ? 8 : -8) / k, 16);
  }
  if (hit(a, b, 0.05)) K.cue('boom');
};

/**
 * PYRO SHOW: flame jets race along behind the far boards, go up behind both goals, all fire together, then rockets off
 * the roof. Every jet stands behind an ad board.
 */
const kickPyro: ShowFn = (K, s, a, b) => {
  const k = s.k;
  for (let i = 0; i < JETS.length; i++) {
    if (hit(a, b, 0.05 + i * 0.06)) jet(K, JETS[i] / k, FAR / k, 12);
    if (hit(a, b, 1.15)) jet(K, JETS[i] / k, FAR / k, 15, 7.5);
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < BEHIND.length; i++) {
      if (hit(a, b, 0.35 + i * 0.1)) jet(K, (side * END) / k, BEHIND[i] / k, 12);
      if (hit(a, b, 1.15)) jet(K, (side * END) / k, BEHIND[i] / k, 15, 7.5);
    }
  }
  if (hit(a, b, 1.15)) K.cue('boom');
  for (let i = 0; i < 5; i++) {
    if (hit(a, b, 1.4 + i * 0.2)) rocket(K, s, LINE[(i * 2) % LINE.length] / k, s.bw / k, (FAR - 7) / k, 0, -1, ROCKET_DIES[i % 3], 10);
  }
};

// ------------------------------------------------------------------ goal shows (your goal, at the goal you scored in)

/** Confetti cannons behind the goal: two rounds up and back over the end. */
const goalConfetti: ShowFn = (K, s, a, b) => {
  const k = s.k;
  for (let n = 0; n < 2; n++) {
    if (!hit(a, b, 0.05 + n * 0.5)) continue;
    for (const w of BEHIND) cannon(K, s, -(END - HALF_L) / k, (w + (n ? 2.7 : 0)) / k, -1, 0, 22, n);
    K.cue('pop');
  }
};

/** Spark fountains along the boards behind the goal, and three rockets over the end. */
const goalFireworks: ShowFn = (K, s, a, b) => {
  const k = s.k;
  for (let n = 0; n < 3; n++) {
    if (!hit(a, b, 0.05 + n * 0.45)) continue;
    for (const w of BEHIND) fountain(K, s, -(END - HALF_L) / k, (w + (n % 2 ? 2.7 : 0)) / k, 22);
  }
  for (let i = 0; i < 3; i++) {
    if (hit(a, b, 0.2 + i * 0.35)) rocket(K, s, (-(END - HALF_L) - 2) / k, 0, [-7, 7, 0][i] / k, -1, 0, ROCKET_DIES[i], 8);
  }
  if (hit(a, b, 0.2)) K.cue('boom');
};

/**
 * FLAME RING: fire runs up both posts and along the bar (just behind the goal line, inside the goal), a ring of flame
 * round the goal mouth, with jets and club-colour smoke going up behind the boards.
 */
const goalRing: ShowFn = (K, s, a, b, dt) => {
  if (b < 1.5) {
    // The ring: up the posts for the first 0.35 s, then the whole frame alight.
    const reach = Math.min(1, b / 0.35);
    const n = K.rate(s, 0, 190, dt);
    const hw = GOAL_W / 2;
    const run = 2 * GOAL_H + GOAL_W;
    for (let i = 0; i < n; i++) {
      // A point along the frame, measured up one post, across the bar and down the other.
      const d = r(0, 1) < 0.5 ? r(0, GOAL_H * reach) : reach < 1 ? r(0, GOAL_H * reach) : r(GOAL_H, run - GOAL_H);
      const side = r(0, 1) < 0.5 ? -1 : 1;
      const onPost = d <= GOAL_H;
      const y = onPost ? d : GOAL_H;
      const w = onPost ? side * hw : -hw + (d - GOAL_H);
      const p = K.add(SH.cube, -0.35 + r(-0.15, 0.15), y + r(-0.1, 0.1), w + r(-0.12, 0.12), r(-0.3, 0.3), r(1.8, 3.6), r(-0.3, 0.3), r(0.22, 0.4), r(0.3, 0.5), FX_FIRE[0]);
      p.f |= F.PUFF | F.AGE;
      p.pal = FX_FIRE;
      FxKit.tumble(p, 4);
    }
  }
  for (let i = 0; i < BEHIND.length; i++) {
    if (hit(a, b, 0.15 + i * 0.08)) jet(K, -(END - HALF_L), BEHIND[i], 12, 5.5);
    if (hit(a, b, 0.9)) jet(K, -(END - HALF_L), BEHIND[i], 13, 6.5);
  }
  if (b > 0.5 && b < 2.1) {
    const n = K.rate(s, 1, 22, dt);
    for (let i = 0; i < n; i++) smoke(K, s, -(END - HALF_L) - 0.8, [-8.2, 8.2, -2.7, 2.7][Math.floor(r(0, 4)) % 4], i);
  }
  if (hit(a, b, 0.05)) K.cue('whoosh');
  if (hit(a, b, 0.9)) K.cue('boom');
};

// ------------------------------------------------------------------ after a win (full time)

/** Club-colour smoke goes up behind both goals: the whole ground turns your colours. */
const winSmoke: ShowFn = (K, s, a, b, dt) => {
  if (b > 2.4) return;
  const k = s.k;
  const n = K.rate(s, 0, 46, dt);
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? -1 : 1;
    smoke(K, s, (side * END) / k, (BEHIND[Math.floor(r(0, 4)) % 4] + r(-1, 1)) / k, i + (side > 0 ? 1 : 0));
  }
  if (hit(a, b, 0.05)) K.cue('whoosh');
};

/** Rockets off the far roof and fountains along the far boards: a short full-time volley. */
const winFireworks: ShowFn = (K, s, a, b) => {
  const k = s.k;
  for (let i = 0; i < 6; i++) {
    if (hit(a, b, 0.1 + i * 0.28)) rocket(K, s, LINE[(i * 3 + 2) % LINE.length] / k, s.bw / k, (FAR - 7) / k, 0, -1, ROCKET_DIES[i % 3], 10);
  }
  if (hit(a, b, 0.05)) for (let i = 0; i < LINE.length; i += 2) fountain(K, s, LINE[i] / k, FAR / k, 16);
  if (hit(a, b, 0.1)) K.cue('boom');
};

/** Both at once (the pyro show's full time). */
const winPyro: ShowFn = (K, s, a, b, dt) => {
  winSmoke(K, s, a, b, dt);
  winFireworks(K, s, a, b, dt);
};

// ------------------------------------------------------------------ the mascots' own bits

/**
 * The dragon's breath: a puff of voxel fire out of its mouth and UP into the air (the frame's u is its facing), gone
 * in a second: it rises over the dragon's own head on the touchline, never out over the grass.
 */
const dragonBreath: ShowFn = (K, s, a, b, dt) => {
  if (b > 0.7) return;
  const n = K.rate(s, 0, 150, dt);
  for (let i = 0; i < n; i++) {
    const sp = r(4.5, 8);
    // (Nearly straight up: it celebrates facing the pitch, and the fire stays over its own head.)
    const p = K.add(SH.cube, 0.2, 0, 0, sp * 0.16 + r(-0.6, 0.6), sp * 0.98 + r(-0.6, 0.6), r(-1.1, 1.1), r(0.3, 0.52), r(0.4, 0.7), FX_FIRE[0]);
    p.f |= F.PUFF | F.AGE;
    p.pal = FX_FIRE;
    p.g = -1.5;
    p.drag = 1.6;
    FxKit.tumble(p, 6);
  }
  if (hit(a, b, 0)) {
    K.add(SH.glow, 0.3, 1, 0, 0, 0, 0, 2.6, 0.2, 0xffb23a);
    K.cue('whoosh');
  }
};

/**
 * The bear's drum: a small boom ring off the skin and a note bouncing up beside it (the frame's u is the way the drum
 * faces). Small on purpose: the bear's face stays in view through a whole drum roll.
 */
const bearDrum: ShowFn = (K, s, a, b) => {
  if (!hit(a, b, 0)) return;
  const ring = K.add(SH.ring, 0.35, 0, 0, 0.8, 0, 0, 0.9, 0.22, 0xfff4dc);
  ring.f |= F.FACE;
  ring.gs = 2.6;
  const side = r(0, 1) < 0.5 ? -1 : 1;
  const p = K.add(SH.note, 0.1, 0.5, side * r(0.9, 1.3), r(0.2, 0.9), r(3, 4.4), side * r(0.3, 1), r(0.38, 0.5), r(0.6, 0.85), pc(s, Math.floor(r(0, 4))));
  p.f |= F.FACE | F.POP | F.SWAY;
  p.sw = 2;
  p.g = 3;
};

/** The robot's hands spark as each pose locks in. */
const robotSpark: ShowFn = (K, s, a, b) => {
  if (!hit(a, b, 0)) return;
  for (let i = 0; i < 7; i++) {
    const p = K.add(i % 2 ? SH.sparkle : SH.cube, 0, 0, 0, r(-2.4, 2.4), r(0.5, 3.4), r(-2.4, 2.4), r(0.14, 0.26), r(0.3, 0.5), i % 3 ? 0x3cf7ff : pc(s, i));
    p.f |= F.TWINK | (i % 2 ? F.FACE : 0);
    p.g = 6;
  }
};

// ------------------------------------------------------------------ the shop's stage (a 4.8 m block; shows at k 0.3)

/** The block's back edge in show units (k 0.3: 2.3 m behind the line-up). */
const EDGE = -7.6;
const STAGE_W = [-6, -2, 2, 6] as const;

const stageConfetti: ShowFn = (K, s, a, b) => {
  for (let k = 0; k < 2; k++) {
    if (!hit(a, b, 0.05 + k * 0.55)) continue;
    for (const w of STAGE_W) cannon(K, s, EDGE, w + (k ? 1.4 : -1.4), -1, 0, 12, k);
    K.cue('pop');
  }
};

const stageFireworks: ShowFn = (K, s, a, b) => {
  for (let n = 0; n < 2; n++) if (hit(a, b, 0.02 + n * 0.8)) for (const w of STAGE_W) fountain(K, s, EDGE, w, 14);
  for (let i = 0; i < 4; i++) if (hit(a, b, 0.2 + i * 0.4)) rocket(K, s, EDGE, 0, [-5, 4, -1, 6][i], -1, 0, ROCKET_DIES[i % 3], 10);
};

const stagePyro: ShowFn = (K, s, a, b) => {
  for (let i = 0; i < 8; i++) {
    if (hit(a, b, 0.05 + i * 0.08)) jet(K, EDGE, -7 + i * 2, 10, 5);
    if (hit(a, b, 1.1)) jet(K, EDGE, -7 + i * 2, 12, 6.5);
  }
  for (let i = 0; i < 2; i++) if (hit(a, b, 1.4 + i * 0.3)) rocket(K, s, EDGE, 0, i ? 4 : -4, -1, 0, ROCKET_DIES[i], 11);
};

export interface StadiumShowDef {
  dur: number;
  run: ShowFn;
  /** The show's scale (the fireworks go off big over the stand). */
  k: number;
}

/** Signature ceremonies build a suspended arch one star at a time, then shed drifting jewels over the stand. */
function signatureCeremony(month: number, stage = false, goal = false): ShowFn {
  const pal = SIGNATURE_PALETTES[month];
  return (K, s, a, b) => {
    for (let i = 0; i < 13; i++) {
      if (!hit(a, b, 0.04 + i * 0.075)) continue;
      const at = i / 12 * Math.PI;
      const span = stage ? 6 : goal ? 11 / s.k : 22 / s.k;
      const u = stage ? EDGE : goal ? -(END - HALF_L) / s.k : Math.cos(at) * span;
      const w = stage || goal ? Math.cos(at) * span : (FAR - 5) / s.k;
      const y = stage ? 3.4 + Math.sin(at) * 4 : ((goal ? 4 : s.bw + 5) + Math.sin(at) * 6) / s.k;
      const star = K.add(SH.star, u, y, w, 0, 0.3, stage ? 0 : -0.15, stage ? 0.65 : 0.8, 1.85, pal[i % pal.length]);
      star.f |= F.FACE | F.POP | F.TWINK | F.KEEP;
      for (let n = 0; n < 4; n++) {
        const jewel = K.add(SH.gem, u, y, w, r(-0.5, 0.5), r(-0.6, -0.2), goal || stage ? 0 : -0.3,
          stage ? 0.2 : 0.3, 1.25, pal[(i + n) % pal.length]);
        jewel.delay = 0.65 + n * 0.07;
        jewel.f |= F.FACE | F.TWINK;
      }
    }
    if (hit(a, b, 0.05)) K.cue('whoosh');
    if (hit(a, b, 0.94)) K.cue('pop');
  };
}
function signatureShows(stage = false, goal = false): { [id: string]: StadiumShowDef } {
  return Object.fromEntries(SIGNATURE_PALETTES.map((_, month) => [`kickpass${String(month + 1).padStart(2, '0')}`,
    { dur: 2.4, run: signatureCeremony(month, stage, goal), k: stage ? 0.3 : 1 }]));
}

/** The kick-off walkout shows by STADIUM STYLE id (core/save.ts DECOR_IDS, slot 'kickoff'). */
export const KICKOFF_SHOWS: { readonly [id: string]: StadiumShowDef } = {
  kickconfetti: { dur: 1.2, run: kickConfetti, k: 1.6 },
  kickfire: { dur: 2.4, run: kickFireworks, k: 1.6 },
  kickpyro: { dur: 2.4, run: kickPyro, k: 1.6 },
  ...signatureShows(),
};

/** What the same item does at the goal when you score (played at the goal line, facing out of the goal). */
export const GOAL_SHOWS: { readonly [id: string]: StadiumShowDef } = {
  kickconfetti: { dur: 1.1, run: goalConfetti, k: 1.5 },
  kickfire: { dur: 1.6, run: goalFireworks, k: 1.5 },
  kickpyro: { dur: 2.2, run: goalRing, k: 1 },
  ...signatureShows(false, true),
};

/** ...and at full time when you have won (a walkout's frame again). */
export const WIN_SHOWS: { readonly [id: string]: StadiumShowDef } = {
  kickfire: { dur: 2, run: winFireworks, k: 1.6 },
  kickpyro: { dur: 2.6, run: winPyro, k: 1.6 },
  ...signatureShows(),
};

/** The walkouts as the shop's stage plays them: along the back edge of its block, behind the line-up. */
export const STAGE_SHOWS: { readonly [id: string]: StadiumShowDef } = {
  kickconfetti: { dur: 1.2, run: stageConfetti, k: 0.3 },
  kickfire: { dur: 2, run: stageFireworks, k: 0.3 },
  kickpyro: { dur: 2.2, run: stagePyro, k: 0.3 },
  ...signatureShows(true),
};

export const DRAGON_BREATH: StadiumShowDef = { dur: 0.8, run: dragonBreath, k: 1 };
export const BEAR_DRUM: StadiumShowDef = { dur: 0.2, run: bearDrum, k: 1 };
export const ROBOT_SPARK: StadiumShowDef = { dur: 0.2, run: robotSpark, k: 1 };

/** Every stadium show (the tests run each one to its end). */
export const ALL_STADIUM_SHOWS: readonly StadiumShowDef[] = [
  ...Object.values(KICKOFF_SHOWS), ...Object.values(GOAL_SHOWS), ...Object.values(WIN_SHOWS), ...Object.values(STAGE_SHOWS),
  DRAGON_BREATH, BEAR_DRUM, ROBOT_SPARK,
];

/** The far end of the pitch (for anyone placing things relative to the shows). */
export const SHOW_SPAN = HALF_L;
