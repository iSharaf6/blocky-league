import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { clearOfLens, FK_LENS_CLEAR } from '../src/sim/ai';
import { DT, GOAL_W, HALF_L, HALF_W } from '../src/sim/constants';
import { AIM_TURN, EMPTY_PAD, isDigitalStick, Match, type Pad } from '../src/sim/match';
import type { Player } from '../src/sim/player';
import type { RestartKind, Side } from '../src/sim/types';

/*
 * Ports of the critic's in-browser benches (shb.js human shots, fkb.js free kicks, cob.js corners,
 * tk.js wing tackles) driving the sim directly with a human Pad. Everything is seeded, so the rates
 * are exact for this code; the bands are the design targets with a little room.
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
/** (Read through a function so the compiler doesn't narrow it from an earlier assignment.) */
const phase = (m: Match): string => m.phase;

/** Match.goOut is private: benches call it the way the browser console did. */
const goOut = (m: Match, kind: RestartKind, side: Side, x: number, z: number) =>
  (m as unknown as { goOut: (k: RestartKind, s: Side, x: number, z: number) => void }).goOut(kind, side, x, z);

interface ShotResult { res: string; parried: boolean }

/**
 * shb.js: the human striker `dist` m from the goal line at `z`, only the keeper (on his line) to beat;
 * SHOOT held `hold` frames with the stick at (fwd towards goal, lat across), then 200 frames to see
 * what came of it.
 */
function shotTrial(seed: number, dist: number, z: number, hold: number, fwd = 0, lat = 0): ShotResult {
  const m = newMatch(seed);
  m.phase = 'play';
  m.restart = null;
  m.clock = 20;
  m.drainEvents();
  m.players.forEach((p, i) => place(p, -40 + i * 3.6, -HALF_W + 1.5));
  const ad = m.attackDir(0);
  const p = m.players[9];
  place(p, ad * (HALF_L - dist), z);
  p.facing = Math.atan2(-z * 0.3, ad);
  place(m.keeperOf(1)!, ad * (HALF_L - 1.5), 0);
  const b = m.ball;
  b.reset(p.pos.x + ad * 0.5, p.pos.z);
  b.owner = p.idx;
  b.lastTouch = p.idx;
  b.lastTouchSide = 0;
  m.active = p.idx;
  m.updateBallPath();
  for (let i = 0; i < 4; i++) m.step(DT, EMPTY_PAD);
  const stick = pad(ad * fwd, lat);
  for (let i = 0; i < hold; i++) m.step(DT, { ...stick, shoot: true });
  for (let i = 0; i < 6; i++) m.step(DT, stick);
  const g0 = m.score[0];
  let parried = false;
  for (let i = 0; i < 200; i++) {
    m.step(DT, EMPTY_PAD);
    for (const e of m.drainEvents()) if (e.type === 'save' && !e.caught) parried = true;
    if (m.score[0] > g0) return { res: 'goal', parried };
    if (phase(m) === 'out') return { res: m.restart!.kind, parried };
    if (m.ball.owner >= 0 && m.players[m.ball.owner].side === 1) return { res: 'lost', parried };
  }
  return { res: 'none', parried };
}

/** Every input style a player might use (no stick, stick at goal, at a corner, across), soft to full power. */
function shotRates(dist: number, z: number, trials = 16): { goal: number; parriedToCorner: number } {
  const far = z > 0 ? -1 : 1;
  const sticks: [number, number][] = [[0, 0], [1, 0], [Math.SQRT1_2, far * Math.SQRT1_2], [0, z === 0 ? 1 : far]];
  let n = 0;
  let goals = 0;
  let pc = 0;
  for (const [fwd, lat] of sticks) {
    for (const hold of [20, 35, 50]) {
      for (let k = 0; k < trials; k++) {
        const r = shotTrial(1 + k * 7, dist, z, hold, fwd, lat);
        n++;
        if (r.res === 'goal') goals++;
        if (r.parried && r.res === 'corner') pc++;
      }
    }
  }
  return { goal: goals / n, parriedToCorner: pc / n };
}

type FkPlan = 'straight' | 'wallIn';

/**
 * fkb.js: a human free kick through the real restart. The behind-the-ball camera maps W along
 * ball-goal and D to its right; 'wallIn' turns the aim (keys, AIM_TURN) to the wall-side corner and
 * bends it back in from outside with the key held at the strike; 'straight' just strikes it.
 */
function fkTrial(seed: number, dist: number, z: number, plan: FkPlan, hold: number): { goal: boolean; wall: boolean } {
  const m = newMatch(seed);
  m.clock = 5;
  m.phase = 'play';
  m.ball.owner = -1;
  const ad = m.attackDir(0);
  goOut(m, 'freekick', 0, ad * (HALF_L - dist), z);
  for (let n = 0; phase(m) !== 'restart' && n < 400; n++) m.step(DT, EMPTY_PAD);
  const r = m.restart!;
  const gx = ad * HALF_L;
  const dl = Math.hypot(gx - r.x, -r.z);
  const u = { x: (gx - r.x) / dl, z: -r.z / dl };
  const key = (k: 'A' | 'D'): Pad => (k === 'D' ? pad(-u.z, u.x) : pad(u.z, -u.x));
  for (let i = 0; i < 40; i++) m.step(DT, EMPTY_PAD);
  let curlKey: 'A' | 'D' | null = null;
  if (plan === 'wallIn') {
    const near = Math.sign(r.z) || 1;
    const t = m.players[r.taker];
    const want = Math.atan2(near * (GOAL_W / 2 - 0.7) - r.z, gx - r.x);
    const dA = Math.atan2(Math.sin(want - t.facing), Math.cos(want - t.facing));
    const frames = Math.round((Math.abs(dA) / AIM_TURN) * 60);
    for (let i = 0; i < frames; i++) m.step(DT, key(dA > 0 ? 'D' : 'A'));
    m.step(DT, EMPTY_PAD);
    curlKey = -near * ad > 0 ? 'D' : 'A';
  }
  for (let i = 0; i < hold; i++) m.step(DT, pad(0, 0, { shoot: true }));
  m.step(DT, curlKey ? key(curlKey) : EMPTY_PAD);
  const g0 = m.score[0];
  let wall = false;
  for (let i = 0; i < 420; i++) {
    m.step(DT, curlKey && i < 20 ? key(curlKey) : EMPTY_PAD);
    for (const e of m.drainEvents()) if (e.type === 'block') wall = true;
    if (m.score[0] > g0) return { goal: true, wall };
    if (phase(m) === 'out' || (m.ball.owner >= 0 && i > 20)) break;
  }
  return { goal: false, wall };
}

function fkRates(plan: FkPlan, trials = 20): { goal: number; wall: number } {
  let n = 0;
  let goals = 0;
  let walls = 0;
  for (const [dist, z] of [[24, 0], [22, 5], [20, -3], [25, 2]] as const) {
    for (const hold of [30, 46]) {
      for (let k = 0; k < trials; k++) {
        const r = fkTrial(1 + k * 13, dist, z, plan, hold);
        n++;
        if (r.goal) goals++;
        if (r.wall) walls++;
      }
    }
  }
  return { goal: goals / n, wall: walls / n };
}

/** cob.js: a human corner, SHOOT held 20 frames (driven) or THROUGH held 40 (hung up). */
function cornerTrial(seed: number, mode: 'driven' | 'lofted'): { goal: boolean; directThrow: boolean } {
  const m = newMatch(seed);
  m.clock = 20;
  m.phase = 'play';
  m.ball.owner = -1;
  const ad = m.attackDir(0);
  goOut(m, 'corner', 0, ad * (HALF_L - 0.35), (seed % 2 ? 1 : -1) * (HALF_W - 0.35));
  for (let i = 0; phase(m) !== 'restart' && i < 400; i++) m.step(DT, EMPTY_PAD);
  for (let j = 0; j < 30; j++) m.step(DT, EMPTY_PAD);
  const btn = mode === 'driven' ? 'shoot' : 'through';
  for (let j = 0; j < (mode === 'driven' ? 20 : 40); j++) m.step(DT, pad(0, 0, { [btn]: true }));
  const g0 = m.score[0];
  let kick = -1;
  for (let j = 0; j < 300; j++) {
    m.step(DT, EMPTY_PAD);
    if (kick < 0 && m.drainEvents().some((e) => e.type === 'kick')) kick = m.kickId;
    if (m.score[0] > g0) return { goal: true, directThrow: false };
    if (phase(m) === 'out' && j > 10) return { goal: false, directThrow: m.restart!.kind === 'throwin' && m.kickId === kick };
    if (m.ball.owner >= 0 && j > 10) break;
  }
  return { goal: false, directThrow: false };
}

describe('finishing (human 1v1 against the keeper)', () => {
  it('long and angled shots are alive, close ones are not a formality, and long saves are not all corners', () => {
    const close = shotRates(12, 0);
    const mid = shotRates(18, 0);
    const long = shotRates(25, 0);
    const angled = shotRates(10, 10);
    // eslint-disable-next-line no-console
    console.log(`human 1v1: 12 m ${(close.goal * 100).toFixed(0)}% | 18 m ${(mid.goal * 100).toFixed(0)}% | 25 m ${(long.goal * 100).toFixed(0)}% | 14 m angled ${(angled.goal * 100).toFixed(0)}% | parried out for corners: 18 m ${(mid.parriedToCorner * 100).toFixed(0)}%, 25 m ${(long.parriedToCorner * 100).toFixed(0)}%`);
    // 25 m used to be 0/32 in the browser (4% on this bench), 14 m wide 0/16; 12 m stays the best chance.
    expect(long.goal).toBeGreaterThanOrEqual(0.05);
    expect(long.goal).toBeLessThanOrEqual(0.16);
    expect(angled.goal).toBeGreaterThanOrEqual(0.12);
    expect(angled.goal).toBeLessThanOrEqual(0.34);
    expect(close.goal).toBeGreaterThan(angled.goal);
    expect(close.goal).toBeLessThanOrEqual(0.72);
    expect(mid.goal).toBeGreaterThan(long.goal);
    // Keepers hold or push out more of the long ones (it was 30-60% parried behind for corners).
    expect(long.parriedToCorner).toBeLessThanOrEqual(0.2);
    expect(mid.parriedToCorner).toBeLessThanOrEqual(0.25);
  }, 120_000);
});

describe('set-piece balance', () => {
  it('free kicks: a straight one mostly hits the wall or the keeper; a well-bent one over the wall is the skill', () => {
    const straight = fkRates('straight');
    const curled = fkRates('wallIn');
    // eslint-disable-next-line no-console
    console.log(`free kicks 20-25 m: straight ${(straight.goal * 100).toFixed(0)}% (wall ${(straight.wall * 100).toFixed(0)}%) | curled over the wall ${(curled.goal * 100).toFixed(0)}% (wall ${(curled.wall * 100).toFixed(0)}%)`);
    expect(straight.goal).toBeLessThanOrEqual(0.14);
    expect(straight.wall).toBeGreaterThanOrEqual(0.6);
    expect(curled.goal).toBeGreaterThanOrEqual(0.15);
    expect(curled.goal).toBeLessThanOrEqual(0.32);
    expect(curled.goal).toBeGreaterThan(straight.goal + 0.05);
    expect(curled.wall).toBeLessThan(straight.wall);
  }, 120_000);

  it('corners: a few percent go in, and a driven one is met rather than flying out for a throw', () => {
    let goals = 0;
    let thrown = 0;
    let n = 0;
    for (const mode of ['driven', 'lofted'] as const) {
      for (let k = 0; k < 60; k++) {
        const r = cornerTrial(1 + k, mode);
        n++;
        if (r.goal) goals++;
        if (mode === 'driven' && r.directThrow) thrown++;
      }
    }
    // eslint-disable-next-line no-console
    console.log(`human corners: ${goals}/${n} scored, driven straight into touch ${thrown}/60`);
    expect(goals / n).toBeGreaterThanOrEqual(0.03);
    expect(goals / n).toBeLessThanOrEqual(0.1);
    expect(thrown / 60).toBeLessThanOrEqual(0.05);
  }, 120_000);
});

describe('free-kick camera line', () => {
  it('teammates stand off the lens line and the taker never walks across it, however he aims', () => {
    for (const [seed, dist, z] of [[3, 22, 0], [9, 24, 6], [17, 20, -4]] as const) {
      for (const aim of [0, 1.1, -1.1]) {
        const m = newMatch(seed);
        m.clock = 5;
        m.phase = 'play';
        m.ball.owner = -1;
        const ad = m.attackDir(0);
        goOut(m, 'freekick', 0, ad * (HALF_L - dist), z);
        for (let n = 0; phase(m) !== 'restart' && n < 400; n++) m.step(DT, EMPTY_PAD);
        const r = m.restart!;
        const gx = ad * HALF_L;
        const dl = Math.hypot(gx - r.x, -r.z);
        const ux = (gx - r.x) / dl;
        const uz = -r.z / dl;
        const frame = (p: { x: number; z: number }) => ({
          along: (p.x - r.x) * ux + (p.z - r.z) * uz,
          lat: (p.x - r.x) * -uz + (p.z - r.z) * ux,
        });
        const t = m.players[r.taker];
        const side = Math.sign(frame(t.pos).lat);
        // Aim with an analog stick (straight at the goal, or well to either side) and hold it there.
        const a = m.restartAim + aim;
        for (let i = 0; i < 90; i++) {
          m.step(DT, aim === 0 ? EMPTY_PAD : pad(Math.cos(a) * 0.9, Math.sin(a) * 0.9));
          const f = frame(t.pos);
          expect(f.along).toBeLessThan(-0.3);
          expect(Math.sign(f.lat)).toBe(side);
          expect(Math.abs(f.lat)).toBeGreaterThan(aim === 0 ? 0.7 : 0.05);
        }
        for (const p of m.teamPlayers(0)) {
          if (p === t || p.isKeeper || p.sentOff) continue;
          const f = frame(p.pos);
          if (f.along < 0.5 && f.along > -12) expect(Math.abs(f.lat)).toBeGreaterThanOrEqual(FK_LENS_CLEAR - 0.1);
        }
      }
    }
    // The helper itself.
    const moved = clearOfLens({ x: 20, z: 0 }, 48, { x: 19.2, z: 0.4 }, 1);
    expect(Math.abs(moved.z)).toBeGreaterThanOrEqual(FK_LENS_CLEAR);
    expect(clearOfLens({ x: 20, z: 0 }, 48, { x: 30, z: 0.4 }, 1)).toEqual({ x: 30, z: 0.4 });
  });
});

describe('keyboard set-piece aim', () => {
  it('reads keys / d-pad from the vector: full length on the eight 45-degree lines', () => {
    expect(isDigitalStick(1, 0)).toBe(true);
    expect(isDigitalStick(Math.SQRT1_2, -Math.SQRT1_2)).toBe(true);
    expect(isDigitalStick(0.6, 0.3)).toBe(false);
    expect(isDigitalStick(Math.cos(0.4), Math.sin(0.4))).toBe(false);
    // Along a behind-the-ball camera's axes (here 14 degrees off the world's).
    const ref = 0.25;
    expect(isDigitalStick(Math.cos(ref + Math.PI / 2), Math.sin(ref + Math.PI / 2), ref)).toBe(true);
  });

  it('on a free kick A / D turn the aim ~60 deg/s from the default, W puts it back; an analog stick aims directly', () => {
    const m = newMatch(21);
    m.clock = 5;
    m.phase = 'play';
    m.ball.owner = -1;
    const ad = m.attackDir(0);
    goOut(m, 'freekick', 0, ad * (HALF_L - 23), 3);
    for (let n = 0; phase(m) !== 'restart' && n < 400; n++) m.step(DT, EMPTY_PAD);
    for (let i = 0; i < 30; i++) m.step(DT, EMPTY_PAD);
    const t = m.players[m.restart!.taker];
    const aim0 = m.restartAim;
    expect(t.facing).toBeCloseTo(aim0, 6);
    const u = { x: Math.cos(aim0), z: Math.sin(aim0) };
    const D = pad(-u.z, u.x, { digital: true });
    const A = pad(u.z, -u.x, { digital: true });
    const W = pad(u.x, u.z, { digital: true });
    const off = () => Math.atan2(Math.sin(t.facing - aim0), Math.cos(t.facing - aim0));
    // Half a second of D: ~30 degrees to the right, not a snap to 90.
    for (let i = 0; i < 30; i++) m.step(DT, D);
    expect(off()).toBeGreaterThan(0.4);
    expect(off()).toBeLessThan(0.62);
    m.step(DT, EMPTY_PAD);
    const held = off();
    expect(held).toBeCloseTo(off(), 6);
    for (let i = 0; i < 20; i++) m.step(DT, A);
    expect(off()).toBeLessThan(held - 0.25);
    m.step(DT, W);
    expect(off()).toBeCloseTo(0, 6);
    // The keys sent without the flag are read as keys too (their vector is exact).
    for (let i = 0; i < 12; i++) m.step(DT, pad(u.z, -u.x));
    expect(off()).toBeLessThan(-0.15);
    expect(off()).toBeGreaterThan(-0.3);
    // An analog stick sets the aim where it points.
    const a = aim0 + 0.3;
    m.step(DT, pad(Math.cos(a) * 0.8, Math.sin(a) * 0.8, { digital: false }));
    expect(off()).toBeCloseTo(0.3, 3);
  });

  it('the strike: aimed where the arrow points, and the key held at the strike bends it without swinging the aim', () => {
    const m = newMatch(33);
    m.clock = 5;
    m.phase = 'play';
    m.ball.owner = -1;
    const ad = m.attackDir(0);
    goOut(m, 'freekick', 0, ad * (HALF_L - 24), 0);
    for (let n = 0; phase(m) !== 'restart' && n < 400; n++) m.step(DT, EMPTY_PAD);
    for (let i = 0; i < 30; i++) m.step(DT, EMPTY_PAD);
    const t = m.players[m.restart!.taker];
    const aim0 = m.restartAim;
    const u = { x: Math.cos(aim0), z: Math.sin(aim0) };
    for (let i = 0; i < 8; i++) m.step(DT, pad(-u.z, u.x, { digital: true }));
    const aimed = t.facing;
    const aimZ = m.aimOnGoalLine(t)!;
    expect(Math.abs(aimZ)).toBeGreaterThan(2);
    expect(Math.abs(aimZ)).toBeLessThan(GOAL_W / 2);
    for (let i = 0; i < 36; i++) m.step(DT, pad(0, 0, { shoot: true }));
    // Release with A held: bend towards A's side.
    const Akey = pad(u.z, -u.x, { digital: true });
    m.step(DT, Akey);
    expect(t.facing).toBeCloseTo(aimed, 6);
    let spin = 0;
    for (let i = 0; i < 60 && phase(m) === 'restart'; i++) {
      m.step(DT, Akey);
      spin = m.ball.spin.y;
    }
    expect(m.phase).toBe('play');
    // A is to the world -z side when attacking +x (and +z attacking -x): the bend goes that way.
    const bendZ = -Math.sign(spin) * Math.sign(m.ball.vel.x);
    expect(bendZ).toBe(-ad);
    expect(m.shotCurl).toBeGreaterThan(0.8);
  });
});

describe('throw-ins', () => {
  it('a poke tackle by the touchline often knocks it into touch (tk.js); in the middle it stays in play', () => {
    const trial = (seed: number, z: number) => {
      const m = newMatch(seed);
      m.phase = 'play';
      m.restart = null;
      m.clock = 20;
      m.drainEvents();
      m.players.forEach((p, i) => place(p, -40 + i * 3.6, (z > 0 ? -1 : 1) * (HALF_W - 1.5)));
      const ad1 = m.attackDir(1);
      const c = m.players[20];
      const d = m.players[5];
      place(c, 0, z);
      c.facing = ad1 > 0 ? 0 : Math.PI;
      c.vel.x = ad1 * 5;
      place(d, ad1 * 4, z + 0.3);
      d.facing = ad1 > 0 ? Math.PI : 0;
      const b = m.ball;
      b.reset(c.pos.x + ad1 * 0.5, z);
      b.owner = c.idx;
      b.lastTouch = c.idx;
      b.lastTouchSide = 1;
      // He just runs at the defender with it (no second thoughts about putting it out himself).
      c.aiMode = 'dribble';
      c.aiDirX = ad1;
      c.aiDirZ = 0;
      c.aiT = 99;
      c.ballT = -9;
      m.active = d.idx;
      m.updateBallPath();
      let won = false;
      for (let i = 0; i < 100; i++) {
        // The human defender runs at the ball.
        const tx = b.pos.x - d.pos.x;
        const tz = b.pos.z - d.pos.z;
        const tl = Math.hypot(tx, tz) || 1;
        m.step(DT, pad(tx / tl, tz / tl));
        for (const e of m.drainEvents()) if (e.type === 'tackle' && e.by === d.idx && e.won && !e.slide) won = true;
        if (phase(m) === 'out') return { won, touch: won && m.restart!.kind === 'throwin' };
        if (won && b.owner >= 0) break;
      }
      return { won, touch: false };
    };
    const rate = (z: number) => {
      let w = 0;
      let t = 0;
      for (let s = 1; s <= 60; s++) {
        const r = trial(s * 3, z);
        if (r.won) w++;
        if (r.touch) t++;
      }
      return { w, t };
    };
    const wing = rate(HALF_W - 2.5);
    const middle = rate(2);
    // eslint-disable-next-line no-console
    console.log(`won pokes into touch: wing ${wing.t}/${wing.w}, middle ${middle.t}/${middle.w}`);
    expect(wing.w).toBeGreaterThanOrEqual(10);
    expect(wing.t / wing.w).toBeGreaterThanOrEqual(0.35);
    expect(middle.t).toBe(0);
  }, 60_000);
});
