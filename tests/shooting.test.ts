import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { resolveKick, WEAK_FOOT_ERR } from '../src/sim/actions';
import { Ball, BOARD_H, BOARD_X, BOARD_Z, type BallHit } from '../src/sim/ball';
import { DT, HALF_L, HALF_W } from '../src/sim/constants';
import { EMPTY_PAD, HUMAN_SHOT_WINDUP, Match, PLANT_SPEED, type Pad, type TimingGrade } from '../src/sim/match';
import type { KickOrder, Player } from '../src/sim/player';
import type { Side } from '../src/sim/types';

/*
 * Shooting (round 8): the power bar sets the height as well as the pace, the weak foot and an off-balance
 * strike cost accuracy, timed finishing's second tap, and the plant step out of a sprint.
 */

function newMatch(seed: number, humanSide: Side | -1 = 0): Match {
  return new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 120, difficulty: 2, humanSide, seed });
}

function place(p: Player, x: number, z: number): void {
  p.pos.x = x;
  p.pos.z = z;
  p.vel.x = p.vel.z = 0;
  p.setState('move');
  p.order = null;
}

const pad = (mx: number, mz: number, extra: Partial<Pad> = {}): Pad => ({ ...EMPTY_PAD, mx, mz, ...extra });

/** The human striker `dist` m out in the middle, only the keeper (on his line) to beat, the ball at his feet. */
function setUp(seed: number, dist: number, timed = true): { m: Match; p: Player; ad: number } {
  const m = newMatch(seed);
  m.timedFinish = timed;
  m.phase = 'play';
  m.restart = null;
  m.clock = 20;
  m.players.forEach((q, i) => place(q, -40 + i * 3.6, -HALF_W + 1.5));
  const ad = m.attackDir(0);
  const p = m.players[9];
  place(p, ad * (HALF_L - dist), 0);
  p.facing = ad > 0 ? 0 : Math.PI;
  place(m.keeperOf(1)!, ad * (HALF_L - 1.5), 0);
  const b = m.ball;
  b.reset(p.pos.x + ad * 0.5, 0);
  b.owner = p.idx;
  b.lastTouch = p.idx;
  b.lastTouchSide = 0;
  m.active = p.idx;
  m.updateBallPath();
  for (let i = 0; i < 4; i++) m.step(DT, EMPTY_PAD);
  m.drainEvents();
  return { m, p, ad };
}

interface Strike {
  /** Launch angle (degrees) and the highest the ball gets before the goal line (m). */
  angle: number;
  apex: number;
  /** Where it crosses the goal line with nobody in the way (NaN: it never gets there). */
  z: number;
  y: number;
  /** Frames from SHOOT's release to the strike. */
  frames: number;
  grades: TimingGrade[];
  vel: { x: number; y: number; z: number };
}

/** Where a ball struck as it is now crosses the goal line (no players), and how high it gets on the way. */
function flight(src: Ball, ad: number): { z: number; y: number; apex: number } {
  const s = new Ball();
  s.reset(src.pos.x, src.pos.z);
  s.pos.y = src.pos.y;
  Object.assign(s.vel, src.vel);
  Object.assign(s.spin, src.spin);
  const hits: BallHit[] = [];
  let apex = s.pos.y;
  for (let i = 0; i < 300; i++) {
    const px = s.pos.x;
    const pz = s.pos.z;
    const py = s.pos.y;
    s.step(DT, hits);
    if (s.pos.x * ad >= HALF_L) {
      const f = (HALF_L * ad - px) / (s.pos.x - px || 1e-6);
      return { z: pz + (s.pos.z - pz) * f, y: py + (s.pos.y - py) * f, apex };
    }
    apex = Math.max(apex, s.pos.y);
    if (s.hspeed() < 0.5) break;
  }
  return { z: NaN, y: NaN, apex };
}

/**
 * SHOOT held `hold` frames with the stick across at `lat`, let go; with `tap` >= 0 a second SHOOT tap that
 * many frames after the release. The ball as struck (read `after` frames later, so a late tap has had its say).
 */
function strike(seed: number, dist: number, hold: number, lat: number, tap = -1, timed = true, after = 12): Strike {
  const { m, p, ad } = setUp(seed, dist, timed);
  const kid = m.kickId;
  for (let i = 0; i < hold; i++) m.step(DT, pad(0, lat, { shoot: true }));
  const grades: TimingGrade[] = [];
  let frames = -1;
  let angle = NaN;
  for (let i = 1; i <= 40; i++) {
    const tapping = tap >= 0 && (i === tap || i === tap + 1);
    m.step(DT, pad(0, lat, { shoot: tapping }));
    for (const e of m.drainEvents()) if (e.type === 'timing') grades.push(e.grade);
    if (frames < 0 && m.kickId !== kid && m.ball.lastTouch === p.idx) {
      frames = i;
      angle = (Math.atan2(m.ball.vel.y, m.ball.hspeed()) * 180) / Math.PI;
    }
    if (frames >= 0 && i >= frames + after) break;
  }
  const f = flight(m.ball, ad);
  return { angle, apex: f.apex, z: f.z, y: f.y, frames, grades, vel: { ...m.ball.vel } };
}

const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
const sd = (a: number[]) => {
  const mu = mean(a);
  return Math.sqrt(mean(a.map((v) => (v - mu) ** 2)));
};

describe('the power bar: pace and height', () => {
  it('from 18 m a tap is a low drive and a full bar rises: lower launch, lower apex', () => {
    const tap = [];
    const full = [];
    for (let s = 0; s < 16; s++) {
      tap.push(strike(1 + s * 7, 18, 1, s % 2 ? 1 : -1));
      full.push(strike(1 + s * 7, 18, 40, s % 2 ? 1 : -1));
    }
    const ta = mean(tap.map((r) => r.angle));
    const fa = mean(full.map((r) => r.angle));
    const tapx = mean(tap.map((r) => r.apex));
    const fapx = mean(full.map((r) => r.apex));
    // eslint-disable-next-line no-console
    console.log(`18 m: tap launch ${ta.toFixed(1)} deg, apex ${tapx.toFixed(2)} m | full bar ${fa.toFixed(1)} deg, apex ${fapx.toFixed(2)} m`);
    expect(ta).toBeLessThan(fa);
    expect(tapx).toBeLessThan(fapx - 0.4);
    // A tap stays under a metre or so on its way; a full bar gets up towards the bar.
    expect(tapx).toBeLessThan(1.2);
    expect(fapx).toBeGreaterThan(1.6);
  });

  it('close in a full bar stays under the bar: a thunderbolt from 8 m, not a sky-rocket', () => {
    let over = 0;
    const n = 20;
    for (let s = 0; s < n; s++) {
      const r = strike(3 + s * 11, 8, 40, s % 2 ? 1 : -1);
      if (r.y > 2.4) over++;
    }
    // eslint-disable-next-line no-console
    console.log(`8 m, full bar: ${over}/${n} over the bar`);
    expect(over / n).toBeLessThanOrEqual(0.15);
  });
});

describe('weak foot and balance', () => {
  /** Mean lateral error (m at the goal line) of `n` strikes by `p` as he stands, with the foot given. */
  function meanErr(m: Match, p: Player, leg: 1 | -1, n: number): number {
    const errs: number[] = [];
    for (let i = 0; i < n; i++) {
      p.kickLeg = leg;
      const o: KickOrder = { kind: 'shot', dirX: 0, dirZ: 1, power: 0.7, target: -1, expires: 1, firstTime: false };
      const L = resolveKick(m, p, o);
      errs.push(Math.abs(L.aim!.errZ));
    }
    return mean(errs);
  }

  it('off his weaker foot the same strike is less accurate (and a two-footed player barely notices)', () => {
    const { m, p } = setUp(5, 16);
    const def = p.def as { weakFoot?: number };
    def.weakFoot = 2;
    const strong = meanErr(m, p, p.foot, 400);
    const weak = meanErr(m, p, (-p.foot) as 1 | -1, 400);
    // eslint-disable-next-line no-console
    console.log(`16 m, weak-foot rating ${p.weakFoot}: mean |error| strong foot ${strong.toFixed(2)} m, weak foot ${weak.toFixed(2)} m`);
    expect(weak).toBeGreaterThan(strong * 1.2);
    expect(weak).toBeLessThan(strong * (1 + WEAK_FOOT_ERR) * 1.2);
    // (A rated-5 weak foot: no difference at all.)
    def.weakFoot = 5;
    const two = meanErr(m, p, (-p.foot) as 1 | -1, 400);
    def.weakFoot = undefined;
    expect(two).toBeLessThan(strong * 1.1);
  });

  it('turned away from goal, or reeling from a challenge, a strike is rougher', () => {
    const { m, p, ad } = setUp(9, 16);
    const clean = meanErr(m, p, p.foot, 300);
    p.facing = ad > 0 ? Math.PI * 0.8 : Math.PI * 0.2; // back more or less to goal
    const turned = meanErr(m, p, p.foot, 300);
    p.facing = ad > 0 ? 0 : Math.PI;
    p.stumbleT = 0.4;
    const reeling = meanErr(m, p, p.foot, 300);
    // eslint-disable-next-line no-console
    console.log(`16 m: square ${clean.toFixed(2)} m, turned away ${turned.toFixed(2)} m, stumbling ${reeling.toFixed(2)} m`);
    expect(turned).toBeGreaterThan(clean * 1.3);
    expect(reeling).toBeGreaterThan(clean * 1.25);
  });

  it('a player shapes up with his good foot to a ball in front of him', () => {
    for (let s = 0; s < 6; s++) {
      const { m, p } = setUp(20 + s, 16);
      for (let i = 0; i < 12; i++) m.step(DT, pad(0, 0, { shoot: true }));
      m.step(DT, EMPTY_PAD);
      expect(p.state).toBe('kick');
      expect(p.kickLeg).toBe(p.foot);
    }
  });
});

describe('timed finishing', () => {
  // (The boot meets the ball HUMAN_SHOT_WINDUP s after the release, on frame `a.frames` of a strike with no
  // tap: a tap on that frame is perfect; frame 2 is the first a new press can come on.)
  it('the boot meets it HUMAN_SHOT_WINDUP s after the release', () => {
    const a = strike(11, 18, 18, 1);
    expect((a.frames - 1) / 60).toBeCloseTo(HUMAN_SHOT_WINDUP, 5);
  });

  it('a perfect second tap narrows the spread, a mistimed one widens it; no tap is no change', () => {
    const none: number[] = [];
    const perfect: number[] = [];
    const early: number[] = [];
    const late: number[] = [];
    const grades: Record<string, number> = {};
    const n = 30;
    for (let s = 0; s < n; s++) {
      const seed = 100 + s * 13;
      const lat = s % 2 ? 1 : -1;
      const a = strike(seed, 18, 18, lat);
      const b = strike(seed, 18, 18, lat, a.frames);
      const c = strike(seed, 18, 18, lat, 2);
      const d = strike(seed, 18, 18, lat, a.frames + 7);
      expect(a.grades).toEqual([]);
      for (const g of [...b.grades, ...c.grades, ...d.grades]) grades[g] = (grades[g] ?? 0) + 1;
      none.push(a.z);
      perfect.push(b.z);
      early.push(c.z);
      late.push(d.z);
    }
    // The spread about the corner each one was aimed at (the same stick, the same corner, the same seed).
    const dev = (zs: number[]) => sd(zs.map((z, i) => (Number.isFinite(z) ? z : 0) * (i % 2 ? 1 : -1)));
    // eslint-disable-next-line no-console
    console.log(`18 m, stick at a corner: spread (sd, m) no tap ${dev(none).toFixed(2)}, perfect ${dev(perfect).toFixed(2)}, early ${dev(early).toFixed(2)}, late ${dev(late).toFixed(2)} | grades ${JSON.stringify(grades)}`);
    expect(grades.perfect).toBe(n);
    expect(grades.early).toBe(n);
    expect(grades.late).toBe(n);
    expect(dev(perfect)).toBeLessThan(dev(none) * 0.75);
    expect(dev(early)).toBeGreaterThan(dev(none) * 1.3);
    expect(dev(late)).toBeGreaterThan(dev(none) * 1.2);
  });

  it('a tap just after the boot meets it still counts (good)', () => {
    const a = strike(77, 16, 18, 1);
    const r = strike(77, 16, 18, 1, a.frames + 4);
    expect(r.grades).toEqual(['good']);
  });

  it('with timed finishing off, a second tap does nothing at all', () => {
    for (let s = 0; s < 8; s++) {
      const seed = 300 + s * 5;
      const a = strike(seed, 18, 18, 1, -1, false);
      const b = strike(seed, 18, 18, 1, a.frames, false);
      const c = strike(seed, 18, 18, 1, -1, true);
      expect(b.grades).toEqual([]);
      expect(b.vel).toEqual(a.vel);
      expect(b.z).toBe(a.z);
      // (And with it on but no tap, the shot is exactly what it is with it off.)
      expect(c.vel).toEqual(a.vel);
    }
  });
});

describe('the plant step', () => {
  it('a shot ordered at a sprint brakes into the strike a few frames later', () => {
    const frames = (speed: number) => {
      const { m, p, ad } = setUp(41, 22);
      (m.cfg as { humanSide: number }).humanSide = -1;
      p.vel.x = ad * speed;
      m.ball.vel.x = ad * speed;
      const kid = m.kickId;
      m.order(p, 'shot', 0, 0, 0.8, -1, false);
      const plant = p.plant;
      for (let i = 1; i <= 30; i++) {
        m.step(DT, EMPTY_PAD);
        if (m.kickId !== kid) return { n: i, plant };
      }
      return { n: -1, plant };
    };
    const jog = frames(3);
    const sprint = frames(PLANT_SPEED + 1.3);
    // eslint-disable-next-line no-console
    console.log(`strike after ${jog.n} frames from a jog, ${sprint.n} from a sprint (plant ${sprint.plant.toFixed(2)})`);
    expect(jog.plant).toBe(0);
    expect(sprint.plant).toBeGreaterThan(0.5);
    expect(sprint.n - jog.n).toBeGreaterThanOrEqual(3);
    expect(sprint.n - jog.n).toBeLessThanOrEqual(5);
  });
});

describe('round 8: the keeper in his goal, the ball and the boards', () => {
  it('a keeper holding the ball stays in front of his line, and the ball never rolls through the boards', () => {
    let held = 0;
    for (const seed of [11, 25, 39, 53]) {
      const m = newMatch(seed, -1);
      for (let steps = 0; m.phase !== 'fulltime' && steps < 60 * 60 * 8; steps++) {
        m.step(DT, EMPTY_PAD);
        m.drainEvents();
        const b = m.ball;
        if (b.held && b.owner >= 0 && m.players[b.owner].isKeeper && m.phase === 'play') {
          held++;
          expect(Math.abs(m.players[b.owner].pos.x)).toBeLessThanOrEqual(HALF_L - 0.3 + 1e-6);
          expect(Math.abs(b.pos.x)).toBeLessThan(HALF_L);
        }
        if (b.pos.y < BOARD_H) {
          expect(Math.abs(b.pos.x)).toBeLessThanOrEqual(BOARD_X);
          expect(Math.abs(b.pos.z)).toBeLessThanOrEqual(BOARD_Z);
        }
        if (m.phase === 'halftime') m.continueSecondHalf();
        if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
      }
    }
    expect(held).toBeGreaterThan(100);
  }, 60_000);

  it('a ball rolled at the boards stops against them', () => {
    // Behind the goal line, wide of the goal (and along a touchline).
    const b = new Ball();
    b.reset(HALF_L + 1, 10);
    b.vel.x = 14;
    const hits: BallHit[] = [];
    let reached = 0;
    for (let i = 0; i < 240; i++) {
      b.step(DT, hits);
      reached = Math.max(reached, b.pos.x);
    }
    expect(reached).toBeLessThanOrEqual(BOARD_X);
    expect(reached).toBeGreaterThan(BOARD_X - 0.5);
    expect(b.pos.x).toBeLessThan(BOARD_X);
    const c = new Ball();
    c.reset(10, HALF_W + 0.5);
    c.vel.z = 14;
    for (let i = 0; i < 240; i++) c.step(DT, hits);
    expect(c.pos.z).toBeLessThanOrEqual(BOARD_Z);
  });
});
