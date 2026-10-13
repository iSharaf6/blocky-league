import { describe, expect, it } from 'vitest';
import { FunTracker, type FunCue } from '../src/game/funLayer';
import { recoveredMatch } from '../src/game/matchRecovery';
import { encodeState, type StateGraph } from '../src/game/stateCodec';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { stateHash } from '../src/net/hash';
import { kickTrailStyle, TRAIL_LOOK } from '../src/render/juice';
import {
  KNUCKLE_AMP, KNUCKLE_DIP, KNUCKLE_MAX_D, KNUCKLE_MIN_D, KNUCKLE_MIN_POWER, knuckleRange, knuckleSolve,
} from '../src/sim/actions';
import { Ball, knuckleDip, knuckleDrift, knuckleOffset, type BallHit, type Knuckle } from '../src/sim/ball';
import { BALL_R, DT, GOAL_H, GOAL_W, GRAVITY, HALF_L, HALF_W } from '../src/sim/constants';
import { devFillHype } from '../src/sim/hype';
import { KNUCKLE_SEEN, KNUCKLE_SEEN_FLIGHT, KNUCKLE_SEEN_MAX } from '../src/sim/keeper';
import { EMPTY_PAD, Match, SHOOT_FULL_T, type MatchConfig, type Pad } from '../src/sim/match';
import type { Player } from '../src/sim/player';
import { PEN_AIM_Z } from '../src/sim/shootout';
import type { MatchEvent, RestartKind, Side } from '../src/sim/types';
import { STRIKE_WORDS } from '../src/ui/actionPop';
import { Commentator } from '../src/ui/commentary';
import { HINT_SHOWS, learnCue, shotHintDue, shotHintLearned, Trainer, trainerCue } from '../src/ui/trainer';

/*
 * The KNUCKLEBALL (the owner: "knuckle ball curves allat make the game perfect! add new stuff u think players will
 * love"): sim/actions.ts knuckleOn / knuckleLaunch, the flight on sim/ball.ts Knuckle, the keeper's read of it in
 * sim/keeper.ts and the parry-only rule in Match.checkKeeperHands. What it is, what it is not, where it goes, and that
 * its state survives a hash, a save and a replay of the same inputs. (How often it scores: tests/knuckleRates.test.ts.)
 */

const NORMAL = 1.8;

function newMatch(seed: number, cfg: Partial<MatchConfig> = {}): Match {
  return new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 120, difficulty: NORMAL, humanSide: 0, seed, ...cfg });
}

function place(p: Player, x: number, z: number): void {
  p.pos.x = x;
  p.pos.z = z;
  p.vel.x = p.vel.z = 0;
  p.setState('move');
  p.order = null;
}

const phase = (m: Match): string => m.phase;
const pad = (extra: Partial<Pad> = {}): Pad => ({ ...EMPTY_PAD, ...extra });
/** SHOOT held long enough for a full bar, and for `power` of one. */
const FULL = Math.round((SHOOT_FULL_T + 0.1) / DT);
const framesFor = (power: number) => Math.round((power * SHOOT_FULL_T) / DT);

interface Stage { m: Match; p: Player; ad: number; gx: number }

/**
 * The human's striker with the ball at his feet `dist` m from the middle of the goal, `z` m off the pitch's axis,
 * everyone else parked on the far touchline. `keeper`: their keeper set 1.5 m off his line (true), or parked too.
 */
function stage(seed: number, dist: number, z = 0, keeper = true, cfg: Partial<MatchConfig> = {}): Stage {
  const m = newMatch(seed, cfg);
  m.phase = 'play';
  m.restart = null;
  m.clock = 20;
  m.players.forEach((q, i) => place(q, -40 + i * 3.6, -HALF_W + 1.5));
  const ad = m.attackDir(0);
  const p = m.players[9];
  place(p, ad * (HALF_L - Math.sqrt(dist * dist - z * z) - 0.5), z);
  p.facing = Math.atan2(-z * 0.3, ad);
  if (keeper) place(m.keeperOf(1)!, ad * (HALF_L - 1.5), 0);
  const b = m.ball;
  b.reset(p.pos.x + ad * 0.5, p.pos.z);
  b.owner = p.idx;
  b.lastTouch = p.idx;
  b.lastTouchSide = 0;
  m.active = p.idx;
  m.updateBallPath();
  for (let i = 0; i < 4; i++) m.step(DT, EMPTY_PAD);
  m.drainEvents();
  return { m, p, ad, gx: ad * HALF_L };
}

type Kick = Extract<MatchEvent, { type: 'kick' }>;

/** Hold SHOOT `hold` frames with `stick`, let it go, and step until the boot meets the ball: that kick (null: never struck). */
function strike(s: Stage, hold: number, stick: Partial<Pad> = {}, during?: (i: number) => Partial<Pad>): Kick | null {
  const { m } = s;
  for (let i = 0; i < hold; i++) m.step(DT, pad({ ...stick, shoot: true, ...(during ? during(i) : {}) }));
  for (let i = 0; i < 40; i++) {
    m.step(DT, pad(stick));
    for (const e of m.drainEvents()) if (e.type === 'kick' && e.kind === 'shot') return e;
  }
  return null;
}

interface Flight {
  /** Where it crossed the goal line (null: it never did, or something touched it first). */
  z: number | null;
  y: number | null;
  /** The wobble's offset each step it was a knuckleball, the ball's height each step, and its downward pull late on. */
  offs: number[];
  ys: number[];
  events: MatchEvent[];
  /** A keeper held it while it was still a knuckleball (no bounce first). */
  heldLive: boolean;
}

/** Step the struck ball on until it is over the line, out, in somebody's hands or 4 s have gone. */
function fly(s: Stage, steps = 240): Flight {
  const { m, ad, gx } = s;
  const b = m.ball;
  const f: Flight = { z: null, y: null, offs: [], ys: [], events: [], heldLive: false };
  let bounced = false;
  let touched = false;
  for (let i = 0; i < steps; i++) {
    const px = b.pos.x;
    const py = b.pos.y;
    const pz = b.pos.z;
    const live = !!b.knuckle;
    if (b.knuckle) f.offs.push(b.knuckle.off);
    f.ys.push(b.pos.y);
    m.step(DT, EMPTY_PAD);
    for (const e of m.drainEvents()) {
      f.events.push(e);
      if (e.type === 'bounce' || e.type === 'post') bounced = true;
      if (e.type === 'save' || e.type === 'block') touched = true;
      if (e.type === 'save' && e.caught && live && !bounced) f.heldLive = true;
    }
    if (f.z === null && !touched && (px - gx) * ad < 0 && (b.pos.x - gx) * ad >= 0) {
      const u = (gx - px) / (b.pos.x - px || 1e-9);
      f.z = pz + (b.pos.z - pz) * u;
      f.y = py + (b.pos.y - py) * u;
    }
    if (phase(m) !== 'play' || b.held || (b.owner >= 0 && i > 5)) break;
  }
  return f;
}

/** The strike's aim and the error on it, as timed finishing keeps them (Launch.aim). */
const aimOf = (m: Match) => m.ctl[0].finish?.aim ?? null;

describe('knuckleball: what is one', () => {
  it('a full bar from range with the stick left alone (or at goal) is struck as a knuckleball: tagged, no spin, its flight on the ball', () => {
    for (const stick of [{}, { mx: 1 }] as Partial<Pad>[]) {
      const s = stage(3, 24);
      const k = strike(s, FULL, { ...stick, mx: (stick.mx ?? 0) * s.ad });
      expect(k?.style).toBe('knuckle');
      expect(k?.player).toBe(s.p.idx);
      expect(s.m.shotStyle).toBe('knuckle');
      const b = s.m.ball;
      expect(b.knuckle).not.toBeNull();
      expect([b.spin.x, b.spin.y, b.spin.z]).toEqual([0, 0, 0]);
      // (Fast and flat: over 30 m/s along the ground, and no more lift than it needs.)
      expect(b.hspeed()).toBeGreaterThan(30);
      expect(b.vel.y).toBeLessThan(10);
      // No aftertouch on a knuckleball.
      expect(b.aftertouch).toBeNull();
    }
  });

  it('the range is KNUCKLE_MIN_D to KNUCKLE_MAX_D m: never from inside 18 m, never from the edge of the box', () => {
    expect(KNUCKLE_MIN_D).toBeGreaterThanOrEqual(18);
    expect(knuckleRange(KNUCKLE_MIN_D - 0.01)).toBe(false);
    expect(knuckleRange(KNUCKLE_MAX_D + 0.01)).toBe(false);
    for (const d of [12, 16, 17.5, KNUCKLE_MIN_D - 0.6, KNUCKLE_MAX_D + 1.5]) {
      const s = stage(5, d);
      const k = strike(s, FULL);
      expect(k, `${d} m`).not.toBeNull();
      expect(k!.style, `${d} m`).toBeUndefined();
      expect(s.m.ball.knuckle, `${d} m`).toBeNull();
    }
    for (const d of [KNUCKLE_MIN_D + 0.6, 26, 31, KNUCKLE_MAX_D - 1.5]) {
      const s = stage(5, d);
      expect(strike(s, FULL)?.style, `${d} m`).toBe('knuckle');
    }
  });

  it('it needs the bar (nearly) full: KNUCKLE_MIN_POWER of it', () => {
    expect(KNUCKLE_MIN_POWER).toBeGreaterThanOrEqual(0.85);
    const soft = stage(7, 25);
    expect(strike(soft, framesFor(0.8))!.style).toBeUndefined();
    expect(soft.m.ball.knuckle).toBeNull();
    const hard = stage(7, 25);
    expect(strike(hard, framesFor(0.95))!.style).toBe('knuckle');
  });

  it('a curled strike, a chip and a finesse shot are not knuckleballs, whatever the power and the range', () => {
    // The stick sideways at the strike: a curler.
    const curl = stage(9, 25);
    const kc = strike(curl, FULL, { mz: 1 });
    expect(kc!.style).toBe('curler');
    expect(curl.m.ball.knuckle).toBeNull();
    expect(Math.abs(curl.m.ball.spin.y)).toBeGreaterThan(5);
    // THROUGH tapped while SHOOT is charging: a chip.
    const chip = stage(9, 25);
    let chipKick: Kick | null = null;
    for (let i = 0; i < FULL && !chipKick; i++) {
      chip.m.step(DT, pad({ shoot: true, through: i === FULL - 2 }));
      for (const e of chip.m.drainEvents()) if (e.type === 'kick' && e.kind === 'shot') chipKick = e;
    }
    for (let i = 0; i < 40 && !chipKick; i++) {
      chip.m.step(DT, EMPTY_PAD);
      for (const e of chip.m.drainEvents()) if (e.type === 'kick' && e.kind === 'shot') chipKick = e;
    }
    expect(chipKick?.style).toBe('chip');
    expect(chip.m.ball.knuckle).toBeNull();
    // The stick diagonally at a corner on a placed shot: finesse.
    const fin = stage(9, 22);
    const kf = strike(fin, framesFor(0.5), { mx: fin.ad * Math.SQRT1_2, mz: Math.SQRT1_2 });
    expect(kf!.style).toBe('finesse');
    expect(fin.m.ball.knuckle).toBeNull();
  });

  it('a first-time strike or a volley is not one: only a ball at his feet, on the grass', () => {
    for (const y of [BALL_R, 0.9]) {
      const s = stage(11, 25);
      const b = s.m.ball;
      // (The ball loose just in front of him, and a full-power first-time shot ordered at it.)
      b.owner = -1;
      b.pos.y = y;
      const o = s.m.order(s.p, 'shot', 0, 0, 1, -1, true);
      expect(o).not.toBeNull();
      let k: Kick | null = null;
      for (let i = 0; i < 40 && !k; i++) {
        s.m.step(DT, EMPTY_PAD);
        for (const e of s.m.drainEvents()) if (e.type === 'kick') k = e;
      }
      expect(k, `y ${y}`).not.toBeNull();
      expect(k!.style, `y ${y}`).toBeUndefined();
      expect(b.knuckle, `y ${y}`).toBeNull();
    }
  });

  it('a SUPER SHOT is its own thing: a full meter and a full bar from range is the super shot, not a knuckleball', () => {
    const s = stage(13, 25, 0, true, { hype: true });
    devFillHype(s.m, 0);
    s.m.drainEvents();
    const { m } = s;
    let superShot = false;
    let k: Kick | null = null;
    for (let i = 0; i < FULL; i++) m.step(DT, pad({ shoot: true }));
    for (let i = 0; i < 40 && !k; i++) {
      m.step(DT, EMPTY_PAD);
      for (const e of m.drainEvents()) {
        if (e.type === 'superShot') superShot = true;
        if (e.type === 'kick' && e.kind === 'shot') k = e;
      }
    }
    expect(superShot).toBe(true);
    expect(k!.style).toBeUndefined();
    expect(m.ball.knuckle).toBeNull();
    expect(m.ball.aftertouch).toBeNull();
  });
});

describe('knuckleball: never the AI', () => {
  it('an AI team-mate ordered to strike a full-power shot from range strikes an ordinary one', () => {
    const s = stage(15, 25);
    const { m } = s;
    // (Hand the ball to a man the human is not controlling.)
    const q = m.players[8];
    place(q, s.p.pos.x, 6);
    q.facing = Math.atan2(-6 * 0.3, s.ad);
    m.ball.reset(q.pos.x + s.ad * 0.5, 6);
    m.ball.owner = q.idx;
    m.ball.lastTouch = q.idx;
    expect(m.isHumanControlled(q)).toBe(false);
    expect(m.order(q, 'shot', 0, 0, 1, -1, false)).not.toBeNull();
    let k: Kick | null = null;
    for (let i = 0; i < 40 && !k; i++) {
      m.step(DT, EMPTY_PAD);
      for (const e of m.drainEvents()) if (e.type === 'kick' && e.kind === 'shot') k = e;
    }
    expect(k).not.toBeNull();
    expect(k!.style).toBeUndefined();
    expect(m.ball.knuckle).toBeNull();
    expect(m.ball.aftertouch).toBeNull();
  });

  it('whole AI v AI matches: no knuckleball, no curler, no aftertouch, and the ball never carries either state', () => {
    let shots = 0;
    for (const seed of [21, 22]) {
      const m = newMatch(seed, { humanSide: -1, halfLength: 60 });
      for (let i = 0; i < 60 * 60 * 6 && phase(m) !== 'fulltime'; i++) {
        m.step(DT, EMPTY_PAD);
        expect(m.ball.knuckle).toBeNull();
        expect(m.ball.aftertouch).toBeNull();
        for (const e of m.drainEvents()) {
          if (e.type === 'kick' && e.kind === 'shot') {
            shots++;
            expect(e.style === 'knuckle' || e.style === 'curler').toBe(false);
          }
          expect(e.type).not.toBe('aftertouch');
        }
        if (phase(m) === 'halftime') m.continueSecondHalf();
        if (phase(m) === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
      }
    }
    expect(shots).toBeGreaterThan(8);
  }, 120_000);
});

describe('knuckleball: its flight', () => {
  it('the wobble is there, late, smooth and never wider than KNUCKLE_AMP: two to three swerves of a few tenths of a metre', () => {
    let widest = 0;
    for (let k = 0; k < 24; k++) {
      const s = stage(30 + k, [22, 26, 31][k % 3], [0, 4, -5][k % 3], false);
      expect(strike(s, FULL)?.style).toBe('knuckle');
      const kn = { ...s.m.ball.knuckle! };
      expect(kn.amp).toBeGreaterThanOrEqual(KNUCKLE_AMP[0]);
      expect(kn.amp).toBeLessThanOrEqual(KNUCKLE_AMP[1]);
      expect(kn.n).toBeGreaterThanOrEqual(2);
      expect(kn.n).toBeLessThanOrEqual(3);
      const f = fly(s);
      const offs = f.offs;
      expect(offs.length).toBeGreaterThan(25);
      const peak = Math.max(...offs.map(Math.abs));
      widest = Math.max(widest, peak);
      // Bounded by its amplitude, and plainly there (at least 0.12 m off its line at some point).
      expect(peak).toBeLessThanOrEqual(kn.amp + 1e-9);
      expect(peak).toBeGreaterThan(0.12);
      // Late: under a quarter of its widest over the first third of the flight.
      const early = Math.max(...offs.slice(0, Math.floor(offs.length / 3)).map(Math.abs));
      expect(early).toBeLessThan(peak * 0.45);
      // Smooth: no step moves it sideways more than 0.12 m (7 m/s), and it turns round 1 to 4 times.
      let turns = 0;
      for (let i = 2; i < offs.length; i++) {
        const d0 = offs[i - 1] - offs[i - 2];
        const d1 = offs[i] - offs[i - 1];
        expect(Math.abs(d1)).toBeLessThan(0.12);
        if (d0 * d1 < 0) turns++;
      }
      expect(turns).toBeGreaterThanOrEqual(1);
      expect(turns).toBeLessThanOrEqual(4);
    }
    expect(widest).toBeGreaterThan(0.3);
    expect(widest).toBeLessThanOrEqual(0.4 + 1e-9);
  });

  it('the wobble moves the ball itself: its path leaves the straight line by what Knuckle.off says, and ends when anything touches it', () => {
    const s = stage(41, 26, 0, false);
    strike(s, FULL);
    const b = s.m.ball;
    const kn = b.knuckle!;
    // The flight underneath (no wobble): the same ball from here on a second one with the wobble's amplitude at nothing.
    const base = new Ball();
    base.reset(b.pos.x, b.pos.z);
    base.pos.y = b.pos.y;
    base.vel.x = b.vel.x;
    base.vel.y = b.vel.y;
    base.vel.z = b.vel.z;
    base.knuckle = { ...kn, amp: 0, off: 0 };
    const off0 = kn.off;
    const hits: BallHit[] = [];
    let widest = 0;
    for (let i = 0; i < 30; i++) {
      s.m.step(DT, EMPTY_PAD);
      base.step(DT, hits);
      const lat = (b.pos.x - base.pos.x) * kn.nx + (b.pos.z - base.pos.z) * kn.nz;
      expect(lat).toBeCloseTo(b.knuckle!.off - off0, 6);
      // (Across its line only: nothing along it, nothing up or down.)
      expect((b.pos.x - base.pos.x) * kn.nz - (b.pos.z - base.pos.z) * kn.nx).toBeCloseTo(0, 6);
      expect(b.pos.y).toBeCloseTo(base.pos.y, 9);
      // The velocity is the straight flight's: the wobble is in where the ball is, not in how it is moving.
      expect(b.vel.z).toBeCloseTo(base.vel.z, 9);
      widest = Math.max(widest, Math.abs(lat));
    }
    expect(widest).toBeGreaterThan(0.05);
    // Touched by anybody else (a block, a parry: the last touch is no longer the striker's): over.
    expect(b.knuckle).not.toBeNull();
    b.lastTouch = s.m.players[14].idx;
    s.m.step(DT, EMPTY_PAD);
    expect(b.knuckle).toBeNull();
  });

  it('the dip: it rises, then comes down harder than gravity, and a full bar from range crosses under the bar', () => {
    let under = 0;
    let n = 0;
    for (let k = 0; k < 60; k++) {
      const s = stage(60 + k, [22, 26, 30][k % 3], [0, 5, -4][k % 3], false);
      strike(s, FULL);
      const b = s.m.ball;
      const kn = { ...b.knuckle! };
      // (The pull at the end of the flight is gravity and the whole dip.)
      expect(knuckleDip(kn, kn.T)).toBeCloseTo(KNUCKLE_DIP, 9);
      expect(knuckleDip(kn, kn.T * 0.3)).toBe(0);
      const f = fly(s);
      if (f.y === null) continue;
      n++;
      if (f.y < GOAL_H - BALL_R) under++;
      // It went up before it came down: its top is well above where it crossed.
      expect(Math.max(...f.ys)).toBeGreaterThan(f.y + 0.25);
      // Flat: never a balloon.
      expect(Math.max(...f.ys)).toBeLessThan(4);
    }
    expect(n).toBeGreaterThan(50);
    // The old full bar from here went over the bar four times in ten; this one is under it nearly every time.
    expect(under / n).toBeGreaterThanOrEqual(0.92);
  });

  it('it crosses the line where the aim model put it: the same lateral error as any strike, and the height it was solved for', () => {
    let n = 0;
    for (let k = 0; k < 45; k++) {
      const dist = [21, 24, 28, 33][k % 4];
      const s = stage(100 + k, dist, [0, 6, -5][k % 3], false);
      expect(strike(s, FULL)?.style).toBe('knuckle');
      const aim = aimOf(s.m)!;
      expect(aim).not.toBeNull();
      const f = fly(s);
      // (One struck at a post or the bar is the frame's from there; and the net holds a ball that squeezes in right
      // by a post, so where it "crossed" cannot be read off it.)
      const tz = aim.z + aim.errZ;
      const th = aim.h + aim.errH;
      if (f.z === null || f.events.some((e) => e.type === 'post')) continue;
      if (Math.abs(Math.abs(tz) - GOAL_W / 2) < 0.35 || Math.abs(th - GOAL_H) < 0.35) continue;
      n++;
      expect(Math.abs(f.z - (aim.z + aim.errZ)), `seed ${100 + k} z`).toBeLessThan(0.08);
      expect(Math.abs(f.y! - (aim.h + aim.errH)), `seed ${100 + k} y`).toBeLessThan(0.08);
      // The lateral aim is the strike's own (inside the posts), and its miss the usual size: metres, not tens of them.
      expect(Math.abs(aim.z)).toBeLessThanOrEqual(GOAL_W / 2);
      expect(Math.abs(aim.errZ)).toBeLessThan(4.5);
    }
    expect(n).toBeGreaterThan(30);
  });

  it('knuckleSolve lands a ball with any wobble on any point of the goal, from anywhere in range (pure: no match needed)', () => {
    const out = { vx: 0, vy: 0, vz: 0 };
    const ball = new Ball();
    const hits: BallHit[] = [];
    let i = 0;
    for (const d of [20, 26, 32, 36]) {
      for (const tz of [-3.3, 0, 2.9]) {
        for (const h of [0.5, 1.3, 2.2]) {
          i++;
          const bx = HALF_L - d;
          const bz = (i % 5) - 2;
          const dl = Math.hypot(d, tz - bz);
          const kn: Knuckle = { t: 0, T: 1, nx: -(tz - bz) / dl, nz: d / dl, amp: 0.25 + (i % 4) * 0.05, n: 2 + (i % 3) * 0.5, ph: i * 0.7, off: 0, dip: KNUCKLE_DIP };
          const v = knuckleSolve(bx, BALL_R, bz, HALF_L, tz, h, 33, kn, out);
          expect(Math.hypot(v.vx, v.vz)).toBeCloseTo(33, 6);
          ball.reset(bx, bz);
          ball.pos.y = BALL_R + 0.02;
          ball.vel.x = v.vx;
          ball.vel.y = v.vy;
          ball.vel.z = v.vz;
          ball.knuckle = { ...kn, t: 0, off: 0 };
          let z = NaN;
          let y = NaN;
          for (let s = 0; s < 200; s++) {
            const px = ball.pos.x;
            const py = ball.pos.y;
            const pz = ball.pos.z;
            ball.step(DT, hits);
            if (px < HALF_L && ball.pos.x >= HALF_L) {
              const u = (HALF_L - px) / (ball.pos.x - px);
              z = pz + (ball.pos.z - pz) * u;
              y = py + (ball.pos.y - py) * u;
              break;
            }
          }
          expect(Math.abs(z - tz), `${d} m to (${tz}, ${h}) z`).toBeLessThan(0.06);
          expect(Math.abs(y - h), `${d} m to (${tz}, ${h}) y`).toBeLessThan(0.06);
          // The flight time it reports is the one it took.
          expect(kn.T).toBeGreaterThan(d / 36);
          expect(kn.T).toBeLessThan(d / 24);
        }
      }
    }
  });

  it('the offset, its drift and the dip are smooth functions of the flight: nothing at the boot, the offset held once it is over', () => {
    const kn: Knuckle = { t: 0, T: 0.9, nx: 0, nz: 1, amp: 0.35, n: 2.6, ph: 1.1, off: 0, dip: KNUCKLE_DIP };
    expect(knuckleOffset(kn, 0)).toBe(0);
    expect(knuckleDrift(kn, 0)).toBe(0);
    expect(knuckleOffset(kn, 2)).toBe(knuckleOffset(kn, 0.9));
    for (let t = 0.01; t < 0.89; t += 0.01) {
      // (The drift is the offset's slope.)
      const slope = (knuckleOffset(kn, t + 1e-5) - knuckleOffset(kn, t - 1e-5)) / 2e-5;
      expect(knuckleDrift(kn, t)).toBeCloseTo(slope, 3);
      expect(Math.abs(knuckleOffset(kn, t))).toBeLessThanOrEqual(kn.amp);
      expect(knuckleDip(kn, t)).toBeGreaterThanOrEqual(0);
      expect(knuckleDip(kn, t)).toBeLessThanOrEqual(KNUCKLE_DIP);
    }
    expect(GRAVITY + KNUCKLE_DIP).toBeLessThan(GRAVITY * 2.2);
  });
});

describe('knuckleball: the keeper', () => {
  it('never holds one: every save of a live knuckleball is a parry', () => {
    let saves = 0;
    let parries = 0;
    let goals = 0;
    for (let k = 0; k < 150; k++) {
      const s = stage(300 + k * 3, [21, 24, 27, 30, 34][k % 5], [0, 5, -5][k % 3]);
      expect(strike(s, FULL)?.style).toBe('knuckle');
      const g0 = s.m.score[0];
      const f = fly(s);
      expect(f.heldLive, `seed ${300 + k * 3}`).toBe(false);
      for (const e of f.events) {
        if (e.type === 'save') {
          saves++;
          if (!e.caught) parries++;
        }
      }
      if (s.m.score[0] > g0) goals++;
    }
    expect(saves).toBeGreaterThan(40);
    // (A few were held after they had bounced: a ball on the grass is a knuckleball no longer.)
    expect(parries / saves).toBeGreaterThan(0.9);
    expect(goals).toBeGreaterThan(10);
  }, 60_000);

  it('cannot read it until late: he stands set until it is KNUCKLE_SEEN (plus a share of its flight) from him, from 22 m or from 32', () => {
    for (const dist of [22, 27, 32]) {
      for (let k = 0; k < 6; k++) {
        const s = stage(500 + k * 5 + dist, dist, [3, -3][k % 2]);
        strike(s, FULL);
        const { m } = s;
        const kn = { ...m.ball.knuckle! };
        const seen = Math.min(KNUCKLE_SEEN_MAX, KNUCKLE_SEEN + KNUCKLE_SEEN_FLIGHT * kn.T);
        const keeper = m.keeperOf(1)!;
        let wentAt = -1;
        for (let i = 0; i < 90 && wentAt < 0; i++) {
          m.step(DT, EMPTY_PAD);
          if (keeper.state === 'dive') wentAt = m.shotClock;
          if (!m.ball.knuckle) break;
        }
        if (wentAt < 0) continue;
        // (His line is ~1.5 m nearer than the goal line the flight was timed to: a few hundredths of a second.)
        expect(wentAt, `${dist} m`).toBeGreaterThan(Math.min(kn.T - seen - 0.09, 0.3));
        expect(wentAt, `${dist} m`).toBeGreaterThan(0.15);
      }
    }
  });
});

const goOut = (m: Match, kind: RestartKind, side: Side, x: number, z: number) =>
  (m as unknown as { goOut: (k: RestartKind, s: Side, x: number, z: number) => void }).goOut(kind, side, x, z);

/** The human's direct free kick `dist` m out, struck after `hold` frames of SHOOT; `bend`: the stick across while it is held. */
function freeKick(seed: number, dist: number, hold: number, bend = 0): { kick: Kick | null; m: Match } {
  const m = newMatch(seed);
  m.clock = 5;
  m.phase = 'play';
  m.ball.owner = -1;
  const ad = m.attackDir(0);
  goOut(m, 'freekick', 0, ad * (HALF_L - dist), 0);
  for (let n = 0; phase(m) !== 'restart' && n < 400; n++) m.step(DT, EMPTY_PAD);
  for (let i = 0; i < 40; i++) m.step(DT, EMPTY_PAD);
  m.drainEvents();
  for (let i = 0; i < hold; i++) m.step(DT, pad({ shoot: true, mz: bend, digital: false }));
  let kick: Kick | null = null;
  for (let i = 0; i < 90 && !kick; i++) {
    m.step(DT, EMPTY_PAD);
    for (const e of m.drainEvents()) if (e.type === 'kick' && e.kind === 'shot') kick = e;
  }
  return { kick, m };
}

describe('knuckleball: the free kick', () => {
  it('a direct free kick at a full bar with no bend is a knuckleball; bent, or struck softer, it is not', () => {
    const full = freeKick(3, 25, FULL);
    expect(full.kick?.style).toBe('knuckle');
    expect(full.m.ball.knuckle).not.toBeNull();
    expect(full.m.ball.spin.y).toBe(0);
    // (Its wobble, and no dip: he aimed its height himself, and the preview's line is still its line.)
    expect(full.m.ball.knuckle!.amp).toBeGreaterThanOrEqual(KNUCKLE_AMP[0]);
    expect(full.m.ball.knuckle!.dip).toBe(0);
    // (No aftertouch on it either.)
    expect(full.m.ball.aftertouch).toBeNull();
    const soft = freeKick(3, 25, framesFor(0.7));
    expect(soft.kick).not.toBeNull();
    expect(soft.kick!.style).toBeUndefined();
    expect(soft.m.ball.knuckle).toBeNull();
    const bent = freeKick(3, 25, FULL, 1);
    expect(bent.kick?.style).toBe('curler');
    expect(bent.m.ball.knuckle).toBeNull();
    expect(Math.abs(bent.m.ball.spin.y)).toBeGreaterThan(5);
    // From inside the knuckleball's range it is a free kick like any other.
    const close = freeKick(3, KNUCKLE_MIN_D - 2, FULL);
    expect(close.kick).not.toBeNull();
    expect(close.kick!.style).toBeUndefined();
    expect(PEN_AIM_Z).toBeGreaterThan(0);
  });
});

describe('knuckleball: state, hash and replay', () => {
  const roundTrip = (m: Match): Match => recoveredMatch(JSON.parse(JSON.stringify(encodeState({ match: m }))) as StateGraph);

  it('a knuckleball in flight survives a save and a reload: the same ball state, the same hash, the same match from there', () => {
    const s = stage(77, 27);
    strike(s, FULL);
    for (let i = 0; i < 12; i++) s.m.step(DT, EMPTY_PAD);
    const { m } = s;
    expect(m.ball.knuckle).not.toBeNull();
    expect(m.ball.knuckle!.t).toBeGreaterThan(0.15);
    const copy = roundTrip(m);
    expect(copy.ball.knuckle).toEqual(m.ball.knuckle);
    expect(copy.ball.knuckle).not.toBe(m.ball.knuckle);
    expect(stateHash(copy)).toBe(stateHash(m));
    for (let i = 0; i < 150; i++) {
      m.step(DT, EMPTY_PAD);
      copy.step(DT, EMPTY_PAD);
      expect(stateHash(copy), `step ${i}`).toBe(stateHash(m));
    }
    expect(copy.score).toEqual(m.score);
  });

  it('the hash sees the knuckleball: a different wobble or a different clock on it is a different state', () => {
    const s = stage(78, 27);
    strike(s, FULL);
    for (let i = 0; i < 6; i++) s.m.step(DT, EMPTY_PAD);
    const kn = s.m.ball.knuckle!;
    const h0 = stateHash(s.m);
    for (const key of ['t', 'T', 'nx', 'nz', 'amp', 'n', 'ph', 'off', 'dip'] as const) {
      const was = kn[key];
      kn[key] = was + 0.01;
      expect(stateHash(s.m), key).not.toBe(h0);
      kn[key] = was;
    }
    expect(stateHash(s.m)).toBe(h0);
    s.m.ball.knuckle = null;
    expect(stateHash(s.m)).not.toBe(h0);
  });

  it('the same seed and the same pad replay the same knuckleball, step for step', () => {
    const run = (): number[] => {
      const s = stage(79, 29, 4);
      const hashes: number[] = [];
      for (let i = 0; i < FULL; i++) {
        s.m.step(DT, pad({ shoot: true }));
        hashes.push(stateHash(s.m));
      }
      for (let i = 0; i < 160; i++) {
        s.m.step(DT, EMPTY_PAD);
        hashes.push(stateHash(s.m));
      }
      expect(s.m.shotStyle).toBe('knuckle');
      return hashes;
    };
    expect(run()).toEqual(run());
  });
});

describe('knuckleball, curler, aftertouch: what the player sees and hears of them', () => {
  it('each has its own ball trail: amber puffs for the knuckleball, a long gold ribbon for a bent strike', () => {
    expect(kickTrailStyle('shot', 1, 0.24, false, 'knuckle')).toBe('knuckle');
    expect(kickTrailStyle('shot', 0.7, 0.24, false, 'curler')).toBe('curl');
    expect(kickTrailStyle('shot', 0.5, 0.24, false, 'finesse')).toBe('curl');
    // A plain strike, a chip and a volley are what they were.
    expect(kickTrailStyle('shot', 1, 0.24, false)).toBe('strike');
    expect(kickTrailStyle('shot', 0.5, 0.24, false, 'chip')).toBe('strike');
    expect(kickTrailStyle('shot', 0.8, 0.9, false)).toBe('glow');
    // (Only a shot has a style: a pass tagged by mistake is still a pass.)
    expect(kickTrailStyle('pass', 0.4, 0.24, false, 'knuckle')).toBe('strike');
    const k = TRAIL_LOOK.knuckle;
    const c = TRAIL_LOOK.curl;
    expect(k.scatter).toBeGreaterThan(0);
    expect(c.scatter).toBe(0);
    // The ribbon hangs long enough to show the whole bend; neither is another trail's colours.
    expect(c.life).toBeGreaterThan(TRAIL_LOOK.strike.life * 2);
    for (const other of ['strike', 'long', 'glow'] as const) {
      expect(k.colors[0]).not.toBe(TRAIL_LOOK[other].colors[0]);
      expect(c.colors[0]).not.toBe(TRAIL_LOOK[other].colors[0]);
    }
    expect(k.colors[0]).not.toBe(c.colors[0]);
  });

  it('the word over the striker is one plain word: no hyphen, no dot, no dash', () => {
    expect(STRIKE_WORDS).toEqual({ knuckle: 'KNUCKLEBALL', curler: 'CURLER', aftertouch: 'AFTERTOUCH' });
    for (const w of Object.values(STRIKE_WORDS)) expect(w).toMatch(/^[A-Z]+$/);
  });

  it('a goal from one is called: KNUCKLEBALL, CURLER (and worth what any tag is)', () => {
    const tags = (style: 'knuckle' | 'curler' | undefined, dist: number): { tags: string[]; style: number } => {
      const m = newMatch(5);
      const fun = new FunTracker(m, { humanSide: 0, bounties: false, showtime: true, seed: 9 });
      const me = m.players.find((p) => p.side === 0 && p.def.role === 'FW')!;
      m.shotDist = dist;
      fun.event({ type: 'kick', power: 1, x: 20, y: 0.24, z: 0, kind: 'shot', player: me.idx, ...(style ? { style } : {}) });
      m.score[0] = 2;
      m.score[1] = 0;
      fun.event({ type: 'goal', side: 0, scorer: me.idx, own: false });
      const c = fun.cues.filter((x): x is Extract<FunCue, { type: 'goalCall' }> => x.type === 'goalCall').pop()!;
      for (const t of c.tags) expect(t.text).toMatch(/^[A-Z0-9 ]+$/);
      return { tags: c.tags.map((t) => t.text), style: fun.summary().style };
    };
    const kn = tags('knuckle', 26);
    expect(kn.tags).toContain('KNUCKLEBALL');
    expect(kn.tags).toContain('SCREAMER');
    const cu = tags('curler', 17);
    expect(cu.tags).toEqual(['CURLER']);
    const plain = tags(undefined, 17);
    expect(plain.tags).toEqual([]);
    // (A tagged goal is worth more style than a plain one from the same spot.)
    expect(cu.style).toBeGreaterThan(plain.style);
  });

  it('the commentary has lines for both: as it is struck, when it goes in, when it is parried, when it misses', () => {
    const m = newMatch(9);
    const c = new Commentator(() => 0);
    const fw = m.teamPlayers(0)[9];
    const keeper = m.keeperOf(1)!;
    m.ball.lastTouch = fw.idx;
    m.kickKind = 'shot';
    const kick = (style: string) => ({ type: 'kick', power: 1, x: 22, y: 0.24, z: 2, kind: 'shot', style, player: fw.idx }) as unknown as MatchEvent;
    const lines: string[] = [];
    const tryLine = c.line(kick('knuckle'), m)!;
    expect(tryLine.text).toMatch(/knuckleball|no spin|moving in the air/i);
    lines.push(tryLine.text);
    m.shooter = fw.idx;
    m.shotClock = 0.8;
    const saved = c.line({ type: 'save', keeper: keeper.idx, caught: false }, m)!;
    expect(saved.text).toMatch(/knuckleball|wobbled/i);
    lines.push(saved.text);
    c.line(kick('knuckle'), m);
    m.score = [1, 0];
    m.goals.push({ side: 0, scorer: fw.idx, name: fw.def.name, minute: 20, own: false });
    const goal = c.line({ type: 'goal', side: 0, scorer: fw.idx, own: false }, m)!;
    expect(goal.text).toMatch(/knuckleball|dipped|moved everywhere/i);
    lines.push(goal.text);
    const curlTry = c.line(kick('curler'), m)!;
    expect(curlTry.text).toMatch(/wraps|bending|whips/i);
    lines.push(curlTry.text);
    m.score = [2, 0];
    m.goals.push({ side: 0, scorer: fw.idx, name: fw.def.name, minute: 30, own: false });
    const curlGoal = c.line({ type: 'goal', side: 0, scorer: fw.idx, own: false }, m)!;
    expect(curlGoal.text).toMatch(/curler|bends|bending|curls/i);
    lines.push(curlGoal.text);
    // (Sentences on the ticker: no separator characters in any of them.)
    for (const l of lines) expect(l).not.toMatch(/[·•●—–]/);
  });

  it('the trainer teaches each once: its hint comes up at its moment until he has done it, or HINT_SHOWS times, then never', () => {
    Trainer.resetLearned();
    const m = newMatch(11);
    m.phase = 'play';
    m.restart = null;
    const ad = m.attackDir(0);
    const p = m.players[9];
    const put = (dist: number) => {
      place(p, ad * (HALF_L - dist - 0.5), 0);
      m.ball.reset(p.pos.x + ad * 0.5, 0);
      m.ball.owner = p.idx;
      m.ball.lastTouch = p.idx;
      m.active = p.idx;
    };
    const check = (cue: { title: string; actions: [string, string][] }) => {
      // The coach card's rules (tests/uiCopy.test.ts): a short title in capitals, short labels, no separators.
      expect(cue.title).toMatch(/^[A-Z' ]+$/);
      expect(cue.actions.length).toBeLessThanOrEqual(3);
      for (const [, label] of cue.actions) {
        expect(label.split(/\s+/).length).toBeLessThanOrEqual(7);
        expect(label).not.toMatch(/[·•●—–|-]/);
      }
    };
    for (const device of ['keyboard', 'gamepad', 'touch'] as const) {
      Trainer.resetLearned();
      // On the ball in knuckleball range, and while SHOOT is charging there: KNUCKLEBALL.
      put(25);
      let cue = trainerCue(m, device);
      expect(cue.title).toBe('KNUCKLEBALL');
      expect(cue.actions.map((a) => a[1])).toEqual(['Hold to full from range', 'Pass']);
      check(cue);
      m.shootCharge = 0.3;
      cue = trainerCue(m, device);
      expect(cue.title).toBe('KNUCKLEBALL');
      expect(cue.actions.length).toBe(1);
      // Inside its range, charging a shot from outside the box: CURLER. Not charging: the usual card.
      put(17);
      cue = trainerCue(m, device);
      expect(cue.title).toBe('CURLER');
      expect(cue.actions[0][1]).toBe('Push sideways as you shoot');
      check(cue);
      m.shootCharge = 0;
      expect(trainerCue(m, device).title).toBe('ON THE BALL');
      // Close in there is nothing to teach.
      put(10);
      m.shootCharge = 0.3;
      expect(trainerCue(m, device).title).toBe('PICK YOUR CORNER');
      m.shootCharge = 0;
      // His plain strike on its way: AFTERTOUCH (never on a chip or a knuckleball).
      put(22);
      m.ball.owner = -1;
      m.shotByHuman = true;
      m.shotKick = m.kickId;
      m.shooter = p.idx;
      m.kickKind = 'shot';
      m.shotClock = 0.2;
      m.shotStyle = null;
      cue = trainerCue(m, device);
      expect(cue.title).toBe('AFTERTOUCH');
      expect(cue.actions[0][1]).toBe('Move it now to bend the shot');
      check(cue);
      m.shotStyle = 'knuckle';
      expect(trainerCue(m, device).title).not.toBe('AFTERTOUCH');
      m.shotStyle = 'chip';
      expect(trainerCue(m, device).title).not.toBe('AFTERTOUCH');
      m.shotStyle = null;
      m.shotClock = 1.5;
      expect(trainerCue(m, device).title).not.toBe('AFTERTOUCH');
      m.shotClock = 99;
    }
    // Done once, it is learned: the usual cards have those moments back.
    Trainer.resetLearned();
    put(25);
    expect(shotHintDue('KNUCKLEBALL')).toBe(true);
    shotHintLearned('KNUCKLEBALL');
    expect(shotHintDue('KNUCKLEBALL')).toBe(false);
    expect(trainerCue(m, 'keyboard').title).toBe('ON THE BALL');
    m.shootCharge = 0.3;
    expect(trainerCue(m, 'keyboard').title).toBe('CURLER');
    shotHintLearned('CURLER');
    expect(trainerCue(m, 'keyboard').title).toBe('PICK YOUR CORNER');
    m.shootCharge = 0;
    // Never done, it still goes quiet after HINT_SHOWS appearances (the trainer's own count: learnCue).
    Trainer.resetLearned();
    for (let i = 0; i < HINT_SHOWS; i++) {
      const cue = trainerCue(m, 'keyboard');
      expect(cue.title).toBe('KNUCKLEBALL');
      expect(learnCue(cue, true)).not.toBeNull();
    }
    expect(shotHintDue('KNUCKLEBALL')).toBe(false);
    expect(trainerCue(m, 'keyboard').title).toBe('ON THE BALL');
    // PITCH TRAINER switched back on starts them over.
    Trainer.resetLearned();
    expect(trainerCue(m, 'keyboard').title).toBe('KNUCKLEBALL');
    Trainer.resetLearned();
  });
});
