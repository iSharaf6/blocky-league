import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_KEYS, DEFAULT_PAD, setBindings } from '../src/core/input';
import { flyGhost, GHOST_MAX_PTS, penaltyGhost, type GhostLaunch } from '../src/game/ghostArc';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { Ball, type BallHit } from '../src/sim/ball';
import { BALL_R, DT, GOAL_H, GRAVITY, HALF_L, PEN_SPOT } from '../src/sim/constants';
import { EMPTY_PAD, Match, type Pad } from '../src/sim/match';
import { Rng } from '../src/core/rng';
import {
  keeperGuess, newPenAim, PEN_AIM_H0, PEN_AIM_H_MAX, PEN_AIM_H_MIN, PEN_AIM_SPEED_Z, PEN_AIM_Z, PEN_TELL_FROM, PEN_TELL_MAX, PEN_TELL_SPAN,
  penaltySpeed, penaltyTell, solveStrike, steerPenAim,
} from '../src/sim/shootout';
import { penaltyCue } from '../src/ui/coach';

/**
 * Penalty aiming (the owner: "penalty taken is spazzed out like the throw in balls where it goes straight left
 * or straight right or direct"). The keys used to give the stick one of eight directions and the kick one of
 * three spots; now they slide an aim point on the goal line, and the strike is solved to go there.
 */

const KEYS = { digital: true } as const;

function newMatch(seed: number, humanSide: 0 | 1 | -1 = 0, knockout = false, halfLength = 120): Match {
  return new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength, difficulty: 1.8, humanSide, seed, knockout });
}

/** A penalty given to `side`, stepped on to the moment the taker can take it. */
function penaltyFor(seed: number, side: 0 | 1 = 0, humanSide: 0 | 1 | -1 = 0): Match {
  const m = newMatch(seed, humanSide);
  Object.assign(m, { phase: 'play', restart: null, clock: 30 });
  (m as unknown as { goOut: (k: string, s: number, x: number, z: number) => void }).goOut('penalty', side, m.attackDir(side) * (HALF_L - PEN_SPOT), 0);
  for (let n = 0; m.phase !== 'restart' && n < 600; n++) m.step(DT, EMPTY_PAD);
  expect(m.phase).toBe('restart');
  expect(m.restart?.kind).toBe('penalty');
  return m;
}

/** A level knockout tie, stepped on to the human's first shootout kick. */
function shootoutTurn(seed: number): Match {
  const m = newMatch(seed, 0, true, 60);
  Object.assign(m, { phase: 'play', restart: null, half: 2, score: [1, 1], clock: m.cfg.halfLength + 8 });
  for (let i = 0; i < 20 && m.phase !== 'shootout'; i++) m.step(DT, EMPTY_PAD);
  const so = m.shootout!;
  for (let g = 0; !(so.turn === 0 && so.stage === 'aim') && g < 60 * 40; g++) m.step(DT, EMPTY_PAD);
  expect(so.turn).toBe(0);
  expect(so.stage).toBe('aim');
  return m;
}

function hold(m: Match, pad: Partial<Pad>, frames: number): number[] {
  const zs: number[] = [];
  for (let i = 0; i < frames; i++) {
    m.step(DT, { ...EMPTY_PAD, ...KEYS, ...pad });
    zs.push(m.penAim ? m.penAim.z : NaN);
  }
  return zs;
}

/** Hold SHOOT `charge` frames, let go, and step to the strike: the ball as it leaves his boot. */
function strike(m: Match, charge: number): Ball {
  for (let i = 0; i < charge; i++) m.step(DT, { ...EMPTY_PAD, ...KEYS, shoot: true });
  m.drainEvents();
  m.step(DT, { ...EMPTY_PAD, ...KEYS });
  for (let i = 0; i < 90; i++) {
    if (m.drainEvents().some((e) => e.type === 'kick' && e.kind === 'shot')) {
      const b = new Ball();
      b.reset(m.ball.pos.x, m.ball.pos.z);
      b.pos.y = m.ball.pos.y;
      b.vel = { ...m.ball.vel };
      b.spin = { ...m.ball.spin };
      return b;
    }
    m.step(DT, { ...EMPTY_PAD, ...KEYS });
  }
  throw new Error('the penalty was never struck');
}

/**
 * Where a struck ball crosses the goal line at x = gx: its own flight (so the keeper can't get in the way), up
 * to just short of the frame (a post or the bar would knock it about), then on the last few centimetres of its line.
 */
function crossing(b: Ball, gx: number): { z: number; y: number } {
  const hits: BallHit[] = [];
  const ad = Math.sign(gx);
  const short = gx - ad * 0.45;
  for (let i = 0; i < 240; i++) {
    if ((b.pos.x + b.vel.x * DT - short) * ad >= 0) {
      const t = (gx - b.pos.x) / b.vel.x;
      return { z: b.pos.z + b.vel.z * t, y: b.pos.y + b.vel.y * t - 0.5 * GRAVITY * t * t };
    }
    hits.length = 0;
    b.step(DT, hits);
  }
  throw new Error('the ball never reached the goal line');
}

/** The spread (1 sd across the goal, m) of `m`'s human taker's penalty at `power` (shootout.penaltyLaunch). */
function spreadOf(m: Match, taker: number, power: number): number {
  const acc = m.players[taker].stat.shooting / 100;
  // (A blast, over 0.82 power, strays up to half as far again: shootout.placedMiss.)
  const blast = Math.min(1, Math.max(0, (power - 0.82) / 0.18));
  return (0.1 + (1 - acc) * 0.75) * (0.65 + power * 0.5) * (1.3 - 3 * 0.125) * (1 + blast * 0.5);
}

describe('penalty aim: the keys slide it, a stick puts it there', () => {
  it('held right on the keys, the aim moves steadily right (many aim points, not three) to just inside the post', () => {
    for (const seed of [5, 13]) {
      const m = penaltyFor(seed);
      const ad = m.attackDir(0);
      const zs = hold(m, { mz: 1 }, 90);
      expect(m.penAim).not.toBeNull();
      expect(m.penAim!.gx).toBe(ad * HALF_L);
      // Starts in the middle of the goal and slides a little further every frame until the post.
      expect(zs[0]).toBeGreaterThan(0);
      expect(zs[0]).toBeLessThan(0.05);
      let distinct = 0;
      for (let i = 1; i < zs.length; i++) {
        const d = zs[i] - zs[i - 1];
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(PEN_AIM_SPEED_Z * DT + 1e-9);
        if (d > 1e-6) distinct++;
      }
      expect(distinct).toBeGreaterThan(40);
      // From the middle to the post in under a second, and never past it.
      const at = zs.findIndex((z) => z >= PEN_AIM_Z - 1e-9);
      expect(at).toBeGreaterThan(30);
      expect(at).toBeLessThan(60);
      expect(zs[zs.length - 1]).toBeCloseTo(PEN_AIM_Z, 9);
      // Sliding across the goal doesn't touch the height.
      expect(m.penAim!.h).toBeCloseTo(PEN_AIM_H0, 9);
    }
  });

  it('a tap nudges it; W / S raise and lower it inside the bar; A brings it back across', () => {
    const m = penaltyFor(7);
    const ad = m.attackDir(0);
    hold(m, { mz: 1 }, 5);
    const tap = m.penAim!.z;
    expect(tap).toBeGreaterThan(0.05);
    expect(tap).toBeLessThan(0.3);
    hold(m, EMPTY_PAD, 10);
    expect(m.penAim!.z).toBe(tap);
    // (W is the way to goal on the behind-the-ball lens.)
    hold(m, { mx: ad }, 20);
    expect(m.penAim!.h).toBeGreaterThan(PEN_AIM_H0 + 0.4);
    hold(m, { mx: ad }, 60);
    expect(m.penAim!.h).toBeCloseTo(PEN_AIM_H_MAX, 9);
    expect(PEN_AIM_H_MAX).toBeLessThan(GOAL_H - BALL_R);
    hold(m, { mx: -ad }, 120);
    expect(m.penAim!.h).toBeCloseTo(PEN_AIM_H_MIN, 9);
    hold(m, { mz: -1 }, 120);
    expect(m.penAim!.z).toBeCloseTo(-PEN_AIM_Z, 9);
  });

  it('the keys read on the goal axes: a lens a few degrees off the line does not creep the height', () => {
    const m = penaltyFor(9);
    const a = 0.14; // 8 degrees
    hold(m, { mz: Math.cos(a), mx: Math.sin(a) }, 30);
    expect(m.penAim!.z).toBeGreaterThan(1.5);
    expect(m.penAim!.h).toBeCloseTo(PEN_AIM_H0, 9);
  });

  it('keys are recognised as keys when the input layer does not say (they slide, they do not jump)', () => {
    const m = penaltyFor(9);
    for (let i = 0; i < 5; i++) m.step(DT, { ...EMPTY_PAD, mz: 1 });
    expect(m.penAim!.z).toBeGreaterThan(0.05);
    expect(m.penAim!.z).toBeLessThan(0.3);
  });

  it('an analog stick puts the aim where it points (eased), and it stays when the stick is let go', () => {
    const a = newPenAim();
    for (let i = 0; i < 30; i++) steerPenAim(a, 0.45, 0, false, DT);
    expect(a.z).toBeCloseTo(0.5 * PEN_AIM_Z, 2);
    for (let i = 0; i < 30; i++) steerPenAim(a, -0.95, 0.95, false, DT);
    expect(a.z).toBeCloseTo(-PEN_AIM_Z, 2);
    expect(a.h).toBeCloseTo(PEN_AIM_H_MAX, 2);
    const kept = { ...a };
    for (let i = 0; i < 30; i++) steerPenAim(a, 0, 0, false, DT);
    expect(a.z).toBe(kept.z);
    expect(a.h).toBe(kept.h);
    // Light smoothing: one frame of a full push doesn't jump all the way.
    const b = newPenAim();
    steerPenAim(b, 1, 0, false, DT);
    expect(b.z).toBeGreaterThan(0.2 * PEN_AIM_Z);
    expect(b.z).toBeLessThan(0.3 * PEN_AIM_Z);
  });

  it('the reticle data: on while he aims, locked once SHOOT is let go, gone at the strike; never for the AI or open play', () => {
    const m = penaltyFor(11);
    hold(m, { mz: -1 }, 20);
    expect(m.penAim).not.toBeNull();
    expect(m.penAim!.locked).toBe(false);
    for (let i = 0; i < 10; i++) m.step(DT, { ...EMPTY_PAD, ...KEYS, shoot: true });
    m.step(DT, { ...EMPTY_PAD, ...KEYS });
    m.step(DT, { ...EMPTY_PAD, ...KEYS, mz: 1 });
    expect(m.penAim?.locked).toBe(true);
    const lockedZ = m.penAim!.z;
    // Stepping in: the keys no longer move it.
    m.step(DT, { ...EMPTY_PAD, ...KEYS, mz: 1 });
    if (m.penAim) expect(m.penAim.z).toBe(lockedZ);
    for (let i = 0; i < 60 && m.phase === 'restart'; i++) m.step(DT, EMPTY_PAD);
    expect(m.phase).toBe('play');
    expect(m.penAim).toBeNull();
    // Their penalty: nothing to aim.
    const t = penaltyFor(11, 1);
    hold(t, { mz: 1 }, 20);
    expect(t.penAim).toBeNull();
  });
});

describe('the strike goes to the aim point', () => {
  const aims: [string, Partial<Pad>, number][] = [
    ['left', { mz: -1 }, 60],
    ['centre', {}, 15],
    ['right', { mz: 1 }, 60],
    ['top corner', { mz: 1, mx: 1 }, 60],
    ['bottom corner', { mz: -1, mx: -1 }, 60],
  ];

  it.each(aims)('%s: with the miss taken out it crosses the line on the point', (_, pad, frames) => {
    const m = penaltyFor(21);
    const ad = m.attackDir(0);
    hold(m, pad.mx ? { ...pad, mx: pad.mx * ad } : pad, frames);
    const aim = { ...m.penAim! };
    // (No miss: every normal draw is 0.)
    m.rng.gauss = () => 0;
    const c = crossing(strike(m, 12), ad * HALF_L);
    expect(Math.abs(c.z - aim.z)).toBeLessThan(0.04);
    expect(Math.abs(c.y - Math.max(aim.h, BALL_R))).toBeLessThan(0.05);
  });

  it.each(aims)('%s: the real kick lands within the error band (it still misses by the taker and the power)', (_, pad, frames) => {
    let sum = 0;
    const N = 24;
    for (let seed = 1; seed <= N; seed++) {
      const m = penaltyFor(seed);
      const ad = m.attackDir(0);
      hold(m, pad.mx ? { ...pad, mx: pad.mx * ad } : pad, frames);
      const aim = { ...m.penAim! };
      const taker = m.restart!.taker;
      const charge = 8 + (seed % 3) * 10;
      const power = Math.max(0.45, Math.min(1, (charge / 30)));
      const c = crossing(strike(m, charge), ad * HALF_L);
      const sp = spreadOf(m, taker, power);
      const dz = Math.abs(c.z - aim.z);
      expect(dz).toBeLessThan(4.5 * sp + 0.05);
      sum += dz / sp;
    }
    // The miss is there (not every kick exactly on the point), but it's the taker's spread, not a lottery.
    expect(sum / N).toBeGreaterThan(0.2);
    expect(sum / N).toBeLessThan(1.6);
  });

  it('the top corner at full power can clear the bar; at three quarters it stays under', () => {
    // Of 40 kicks at the top corner: how many clear the bar (the ball's centre over it) and how many at least clip it.
    const count = (charge: number) => {
      let over = 0;
      let clip = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const m = penaltyFor(seed);
        const ad = m.attackDir(0);
        hold(m, { mz: 1, mx: ad }, 60);
        const c = crossing(strike(m, charge), ad * HALF_L);
        if (c.y > GOAL_H) over++;
        if (c.y > GOAL_H - BALL_R) clip++;
      }
      return { over, clip };
    };
    const full = count(40);
    expect(full.over).toBeGreaterThan(4);
    expect(full.over).toBeLessThan(20);
    const firm = count(22);
    expect(firm.over).toBe(0);
    expect(firm.clip).toBeLessThan(8);
  });

  it('keys held for longer or shorter strike it at many different spots (the old keys gave three)', () => {
    const spots = new Set<string>();
    for (let frames = 0; frames <= 44; frames += 4) {
      const m = penaltyFor(3);
      hold(m, { mz: 1 }, frames + 1);
      m.rng.gauss = () => 0;
      spots.add(crossing(strike(m, 12), m.attackDir(0) * HALF_L).z.toFixed(2));
    }
    expect(spots.size).toBeGreaterThan(9);
  });
});

describe('shootout kicks use the same aim', () => {
  it('the keys slide the shootout aim the same way, and the kick goes there', () => {
    const m = shootoutTurn(12);
    const so = m.shootout!;
    const zs = hold(m, { mz: 1 }, 40);
    expect(new Set(zs.map((z) => z.toFixed(3))).size).toBeGreaterThan(30);
    expect(so.aimZ).toBe(m.penAim!.z);
    expect(so.aimZ).toBeGreaterThan(2);
    hold(m, { mx: so.goal }, 12);
    expect(so.aimH).toBe(m.penAim!.h);
    expect(so.aimH).toBeGreaterThan(PEN_AIM_H0 + 0.3);
    const aim = { z: so.aimZ, h: so.aimH };
    m.rng.gauss = () => 0;
    const c = crossing(strike(m, 12), so.goal * HALF_L);
    expect(so.pen?.placed).toBe(true);
    expect(so.pen?.z).toBe(aim.z);
    expect(Math.abs(c.z - aim.z)).toBeLessThan(0.04);
    expect(Math.abs(c.y - aim.h)).toBeLessThan(0.05);
  });

  it('a new kick starts the aim back in the middle', () => {
    const m = shootoutTurn(12);
    const so = m.shootout!;
    hold(m, { mz: -1 }, 30);
    expect(so.aimZ).toBeLessThan(-1.5);
    strike(m, 10);
    for (let g = 0; so.turn === 0 && g < 60 * 10; g++) m.step(DT, EMPTY_PAD);
    for (let g = 0; !(so.turn === 0 && so.stage === 'aim') && so.winner < 0 && g < 60 * 30; g++) m.step(DT, EMPTY_PAD);
    if (so.winner >= 0) return;
    hold(m, EMPTY_PAD, 2);
    expect(so.aimZ).toBe(0);
    expect(so.aimH).toBe(PEN_AIM_H0);
  });
});

/**
 * The AI's penalties (in a match and in a shootout) never touch the human's aim model: their end states are
 * the ones HEAD (fd7d748) produced, recorded from a clean `git archive` of it with this same code.
 */
function fnv(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16).padStart(8, '0');
}
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

function aiShootoutEnd(seed: number): string {
  const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 60, difficulty: 1.8, humanSide: -1, seed, knockout: true });
  Object.assign(m, { phase: 'play', restart: null, half: 2, score: [1, 1], clock: m.cfg.halfLength + 8 });
  const kicks: string[] = [];
  for (let n = 0; m.phase !== 'fulltime' && n < 60 * 240; n++) {
    m.step(DT, EMPTY_PAD);
    for (const e of m.drainEvents()) if (e.type === 'shootoutKick') kicks.push(`${e.side}${e.taker}${e.scored ? 'g' : 'x'}${r4(m.ball.pos.z)}`);
  }
  const so = m.shootout!;
  return fnv(JSON.stringify({ kicks, tally: so.kicks, winner: so.winner, ball: [r4(m.ball.pos.x), r4(m.ball.pos.y), r4(m.ball.pos.z)] }));
}

function aiPenalty(seed: number, side: 0 | 1): string {
  const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 120, difficulty: 1.8, humanSide: -1, seed });
  Object.assign(m, { phase: 'play', restart: null, clock: 30 });
  (m as unknown as { goOut: (k: string, s: number, x: number, z: number) => void }).goOut('penalty', side, m.attackDir(side) * (HALF_L - PEN_SPOT), 0);
  for (let n = 0; m.phase !== 'play' && n < 60 * 20; n++) m.step(DT, EMPTY_PAD);
  const v = m.ball.vel;
  const launch = [r4(v.x), r4(v.y), r4(v.z)];
  for (let i = 0; i < 60; i++) m.step(DT, EMPTY_PAD);
  return fnv(JSON.stringify({ launch, score: m.score, ball: [r4(m.ball.pos.x), r4(m.ball.pos.y), r4(m.ball.pos.z)] }));
}

describe("the keeper against the human's penalty: a guess, as in a shootout", () => {
  /** A penalty struck at the aim `pad` sets (held `frames`), at `charge` frames of SHOOT: did it go in, and how the keeper went. */
  function take(seed: number, pad: Partial<Pad>, frames: number, charge: number, wait = 0) {
    const m = penaltyFor(seed);
    const ad = m.attackDir(0);
    const k = m.keeperOf(1)!;
    const s0 = m.score[0];
    hold(m, pad.mx ? { ...pad, mx: pad.mx * ad } : pad, frames);
    hold(m, EMPTY_PAD, wait);
    for (let i = 0; i < charge; i++) m.step(DT, { ...EMPTY_PAD, ...KEYS, shoot: true });
    m.drainEvents();
    let kickAt = -1;
    let diveAt = -1;
    let diveZ = 0;
    for (let i = 0; i < 200; i++) {
      m.step(DT, { ...EMPTY_PAD, ...KEYS });
      if (kickAt < 0 && m.drainEvents().some((e) => e.type === 'kick' && e.kind === 'shot')) kickAt = i;
      if (kickAt >= 0 && diveAt < 0 && k.state === 'dive') {
        diveAt = i - kickAt;
        diveZ = Math.sign(k.vel.z);
      }
    }
    return { goal: m.score[0] > s0, diveAt, diveZ };
  }

  it('he picks his side as it is struck (before the flight can tell him), both ways, and sometimes stays up', () => {
    let right = 0;
    let wrong = 0;
    let stay = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = take(seed, { mz: 1 }, 60, 20);
      if (r.diveAt < 0 || r.diveAt > 9) stay++;
      else {
        // (His reaction, 0.06-0.13 s: sooner than the open-play keeper reads a shot.)
        expect(r.diveAt).toBeLessThanOrEqual(9);
        if (r.diveZ > 0) right++;
        else wrong++;
      }
    }
    expect(right).toBeGreaterThan(8);
    expect(wrong).toBeGreaterThan(8);
    expect(stay).toBeGreaterThan(0);
  });

  it('scores like a penalty: a placed corner mostly, the middle less, a full-power top corner is a gamble', () => {
    const rate = (pad: Partial<Pad>, frames: number, charge: number) => {
      let g = 0;
      for (let seed = 1; seed <= 60; seed++) if (take(seed, pad, frames, charge).goal) g++;
      return g / 60;
    };
    const corner = rate({ mz: 1 }, 60, 20);
    expect(corner).toBeGreaterThan(0.68);
    expect(corner).toBeLessThan(0.9);
    const middle = rate({}, 20, 20);
    expect(middle).toBeGreaterThan(0.5);
    expect(middle).toBeLessThan(corner);
    const top = rate({ mz: 1, mx: 1 }, 60, 40);
    expect(top).toBeLessThan(0.6);
  }, 90_000); // 180 simulated penalties: retain every seed and probability check under concurrent CI/laptop load

  it('an aim left sitting by a post tells him more (a read), picked late it does not', () => {
    const a = newPenAim();
    for (let i = 0; i < 60; i++) steerPenAim(a, 1, 0, true, DT);
    for (let i = 0; i < 180; i++) steerPenAim(a, 0, 0, true, DT);
    expect(a.dwell).toBeGreaterThan(PEN_TELL_FROM + PEN_TELL_SPAN - 0.1);
    expect(penaltyTell(a.dwell)).toBeCloseTo(PEN_TELL_MAX, 6);
    for (let i = 0; i < 40; i++) steerPenAim(a, -1, 0, true, DT);
    expect(a.dwell).toBe(0);
    expect(penaltyTell(0.5)).toBe(0);
    const reads = (tell: number) => {
      const rng = new Rng(77);
      let n = 0;
      for (let i = 0; i < 4000; i++) if (keeperGuess(rng, 0.7, 0, 3.3, tell).read) n++;
      return n / 4000;
    };
    const more = reads(PEN_TELL_MAX) - reads(0);
    expect(more).toBeGreaterThan(PEN_TELL_MAX - 0.03);
    expect(more).toBeLessThan(PEN_TELL_MAX + 0.03);
  });
});

describe('out of time, his penalty goes where he aimed it', () => {
  it('in a match: at the reticle, at a firm mid power (or the charge he has on)', () => {
    for (const held of [false, true]) {
      const m = penaltyFor(17);
      const ad = m.attackDir(0);
      hold(m, { mz: -1 }, 40);
      const aim = { ...m.penAim! };
      m.rng.gauss = () => 0;
      let ball: Ball | null = null;
      for (let i = 0; i < 60 * 8 && !ball; i++) {
        // (SHOOT held for the last few frames: 12 frames of charge, the tap's 0.45.)
        const late = held && m.phaseT > 6 - 12 * DT;
        m.step(DT, { ...EMPTY_PAD, ...KEYS, shoot: late });
        if (m.drainEvents().some((e) => e.type === 'kick' && e.kind === 'shot')) {
          ball = new Ball();
          ball.reset(m.ball.pos.x, m.ball.pos.z);
          ball.pos.y = m.ball.pos.y;
          ball.vel = { ...m.ball.vel };
          ball.spin = { ...m.ball.spin };
        }
      }
      expect(ball).not.toBeNull();
      const acc = m.players[m.restart ? m.restart.taker : m.shooter].stat.shooting / 100;
      const speed = Math.hypot(ball!.vel.x, ball!.vel.z);
      // (One frame of drag after the strike.)
      expect(speed).toBeGreaterThan(penaltySpeed(held ? 0.45 : 0.65, acc) * 0.97);
      expect(speed).toBeLessThan(penaltySpeed(held ? 0.45 : 0.65, acc) * 1.01);
      const c = crossing(ball!, ad * HALF_L);
      expect(Math.abs(c.z - aim.z)).toBeLessThan(0.04);
      expect(Math.abs(c.y - aim.h)).toBeLessThan(0.05);
    }
  });

  it('in a shootout: at the reticle, not the AI taker\'s spot', () => {
    const m = shootoutTurn(12);
    const so = m.shootout!;
    hold(m, { mz: -1, mx: so.goal }, 30);
    const aim = { z: so.aimZ, h: so.aimH };
    for (let i = 0; i < 60 * 12 && so.stage === 'aim' && !so.pen; i++) m.step(DT, { ...EMPTY_PAD, ...KEYS });
    expect(so.pen).not.toBeNull();
    expect(so.pen!.placed).toBe(true);
    expect(so.pen!.z).toBe(aim.z);
    expect(so.pen!.h).toBe(aim.h);
    expect(so.pen!.power).toBeCloseTo(0.65, 9);
  });
});

describe('AI penalties are unchanged', () => {
  it('an AI v AI shootout ends exactly as at HEAD', () => {
    const head: Record<number, string> = { 3: '88dd507e', 11: '1ae82d52', 29: '9bc6a8f5', 8: '422db154' };
    for (const [seed, h] of Object.entries(head)) expect(aiShootoutEnd(Number(seed))).toBe(h);
  });

  it('an AI in-match penalty is struck exactly as at HEAD', () => {
    const head: Record<string, string> = { '2_0': 'a02fb635', '2_1': '6c3cdd13', '4_0': 'd829eb52', '4_1': '5a015d24' };
    for (const [k, h] of Object.entries(head)) {
      const [seed, side] = k.split('_').map(Number);
      expect(aiPenalty(seed, side as 0 | 1)).toBe(h);
    }
  });
});

describe('the ghost arc follows the reticle', () => {
  it('a placed penalty preview crosses the goal line at the aim point', () => {
    const L: GhostLaunch = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
    const path = new Float32Array(GHOST_MAX_PTS * 3);
    for (const [z, h] of [[-PEN_AIM_Z, PEN_AIM_H_MAX], [0, PEN_AIM_H0], [2, 0.6]]) {
      for (const p of [0.45, 0.8, 1]) {
        penaltyGhost(HALF_L - PEN_SPOT, BALL_R, 0, HALF_L, z, p, 0.8, L, h);
        const n = flyGhost(L, path);
        // (The dots are every few steps: the exact crossing comes from the same launch flown on a ball.)
        expect(n).toBeGreaterThan(2);
        const b = new Ball();
        b.reset(L.x, L.z);
        b.pos.y = L.y;
        b.vel = { x: L.vx, y: L.vy, z: L.vz };
        const c = crossing(b, HALF_L);
        expect(Math.abs(c.z - z)).toBeLessThan(0.03);
        expect(Math.abs(c.y - h)).toBeLessThan(0.04);
      }
    }
  });

  it('solveStrike puts a curled strike through the point too', () => {
    const v = { vx: 0, vy: 0, vz: 0 };
    solveStrike(-(HALF_L - PEN_SPOT), BALL_R, 0, -HALF_L, 1.5, 1.8, 27, 1.1, v);
    const b = new Ball();
    b.reset(-(HALF_L - PEN_SPOT), 0);
    b.vel = { x: v.vx, y: v.vy, z: v.vz };
    b.spin.y = 1.1;
    const c = crossing(b, -HALF_L);
    expect(Math.abs(c.z - 1.5)).toBeLessThan(0.02);
    expect(Math.abs(c.y - 1.8)).toBeLessThan(0.02);
  });
});

describe('the penalty hint', () => {
  afterEach(() => setBindings());

  it('names the keys in force on a coach card: aim, then hold SHOOT (no separator glyph anywhere)', () => {
    expect(penaltyCue('keyboard')).toEqual({ title: 'PENALTY', actions: [['WASD', 'Aim'], ['K', 'Hold to shoot']] });
    setBindings({ ...DEFAULT_KEYS, left: ['KeyJ'], right: ['KeyL'], up: ['KeyI'], down: ['KeyK'], shoot: ['Space'], pass: ['KeyZ'] }, DEFAULT_PAD);
    expect(penaltyCue('keyboard').actions).toEqual([['IJKL', 'Aim'], ['SPACE', 'Hold to shoot']]);
    expect(penaltyCue('touch').actions).toEqual([['', 'Drag to aim'], ['SHOOT', 'Hold to shoot']]);
    expect(penaltyCue('gamepad').actions).toEqual([['STICK', 'Aim'], ['B', 'Hold to shoot']]);
    expect(JSON.stringify(penaltyCue('keyboard'))).not.toMatch(/[·•●—–|]/);
  });
});
