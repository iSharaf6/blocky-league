import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { clearOfLens, CORNER_BOX, CORNER_ZONAL, CORNER_ZONAL_D, FK_LENS_CLEAR, FK_LENS_CONE_DEPTH } from '../src/sim/ai';
import { Ball, type BallHit } from '../src/sim/ball';
import { DT, GOAL_W, HALF_L, HALF_W } from '../src/sim/constants';
import { AIM_TURN, EMPTY_PAD, isDigitalStick, Match, SHOOT_FULL_T, type Pad } from '../src/sim/match';
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
/**
 * SHOOT frames for the charge these benches were written for (the bar used to fill in 0.85 s; round 8 made it
 * SHOOT_FULL_T): `f` old frames of charge is the same power now.
 */
const charge = (f: number) => Math.round((f * SHOOT_FULL_T) / 0.85);
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
  for (let i = 0; i < charge(hold); i++) m.step(DT, { ...stick, shoot: true });
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
  for (let i = 0; i < charge(hold); i++) m.step(DT, pad(0, 0, { shoot: true }));
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
    // (Round 7: ~3%, from 9%. Most of that 9% was the striker carried ~4 m nearer goal by the stick while he
    // charged the shot; he now stands and aims (SHOOT_CHARGE_MOVE), so a 25 m strike is from 25 m. A 25 m
    // shot against a set keeper going in about one time in thirty is about right.)
    expect(long.goal).toBeGreaterThanOrEqual(0.025);
    expect(long.goal).toBeLessThanOrEqual(0.16);
    expect(angled.goal).toBeGreaterThanOrEqual(0.12);
    // (Round 6 made aiming with the stick reliable: a corner picked from an angle is found more often.)
    expect(angled.goal).toBeLessThanOrEqual(0.45);
    expect(close.goal).toBeGreaterThan(angled.goal);
    expect(close.goal).toBeLessThanOrEqual(0.72);
    expect(mid.goal).toBeGreaterThan(long.goal);
    // Keepers hold or push out more of the long ones (it was 30-60% parried behind for corners).
    expect(long.parriedToCorner).toBeLessThanOrEqual(0.2);
    expect(mid.parriedToCorner).toBeLessThanOrEqual(0.25);
  }, 120_000);
});

/**
 * shd.js: the human striker `dist` m out in the middle, only the keeper (1.5 m off his line) near him
 * (everyone within 9 m moved 12 m aside); SHOOT held `hold` frames with the stick across at `lat`.
 * Where the struck ball was going at the line (no players), what came of it, and what came of a save.
 */
function shdTrial(seed: number, dist: number, hold: number, lat = 0): { goal: boolean; wide: boolean; save: boolean; saveTo: string } {
  const m = newMatch(seed);
  m.phase = 'play';
  m.restart = null;
  m.clock = 20;
  const ad = m.attackDir(0);
  const p = m.players[9];
  place(p, ad * (HALF_L - dist), 0);
  p.facing = ad > 0 ? 0 : Math.PI;
  for (const q of m.teamPlayers(1)) {
    if (!q.isKeeper && Math.hypot(q.pos.x - p.pos.x, q.pos.z - p.pos.z) < 9) q.pos.z += q.pos.z > p.pos.z ? 12 : -12;
  }
  place(m.keeperOf(1)!, ad * (HALF_L - 1.5), 0);
  const b = m.ball;
  b.reset(p.pos.x + ad * 0.5, 0);
  b.owner = p.idx;
  m.active = p.idx;
  for (let i = 0; i < 4; i++) m.step(DT, EMPTY_PAD);
  m.drainEvents();
  for (let i = 0; i < charge(hold); i++) m.step(DT, pad(0, lat, { shoot: true }));
  let line: { z: number; y: number } | null | undefined;
  const g0 = m.score[0];
  let save = false;
  let saveTo = '';
  for (let i = 0; i < 266; i++) {
    m.step(DT, i < 6 ? pad(0, lat) : EMPTY_PAD);
    const ev = m.drainEvents();
    if (line === undefined && ev.some((e) => e.type === 'kick')) line = lineCrossing(b, ad);
    if (ev.some((e) => e.type === 'save')) save = true;
    if (m.score[0] > g0) break;
    if (phase(m) !== 'play') {
      saveTo = (m.restart as { kind: string } | null)?.kind ?? phase(m);
      break;
    }
    if (m.ball.owner >= 0 && m.players[m.ball.owner].side === 1) {
      saveTo = 'held';
      break;
    }
    if (save && m.ball.owner >= 0) {
      saveTo = 'rebound';
      break;
    }
  }
  const wide = !!line && Math.abs(line.z) >= GOAL_W / 2;
  return { goal: m.score[0] > g0, wide: wide || line === null, save, saveTo: save ? saveTo || 'loose' : '' };
}

/** Where a ball as struck crosses the goal line at the end `ad` attacks (no players; posts and bar as they are). */
function lineCrossing(src: Ball, ad: number): { z: number; y: number } | null {
  const s = new Ball();
  s.reset(src.pos.x, src.pos.z);
  s.pos.y = src.pos.y;
  Object.assign(s.vel, src.vel);
  Object.assign(s.spin, src.spin);
  const hits: BallHit[] = [];
  for (let i = 0; i < 300; i++) {
    const px = s.pos.x;
    const pz = s.pos.z;
    const py = s.pos.y;
    s.step(DT, hits);
    if (s.pos.x * ad >= HALF_L) {
      const f = (HALF_L * ad - px) / (s.pos.x - px || 1e-6);
      return { z: pz + (s.pos.z - pz) * f, y: py + (s.pos.y - py) * f };
    }
    if (s.hspeed() < 0.5) return null;
  }
  return null;
}

describe('edge-of-the-box finishing (shd.js)', () => {
  it('a placed tap from 16 m sometimes beats the keeper, a full strike more often, stick-aimed ones find the frame', () => {
    const rate = (dist: number, hold: number, lat = 0, n = 40) => {
      let goals = 0;
      let wide = 0;
      let saves = 0;
      let corners = 0;
      for (let k = 0; k < n; k++) {
        const r = shdTrial(1000 + k * 17 + dist * 3 + hold, dist, hold, lat === 2 ? (k % 2 ? 1 : -1) : lat);
        if (r.goal) goals++;
        if (r.wide) wide++;
        if (r.save) saves++;
        if (r.saveTo === 'corner') corners++;
      }
      return { goal: goals / n, wide: wide / n, saves, corners };
    };
    const tap16 = rate(16, 20);
    const full16 = rate(16, 51);
    const stick16 = rate(16, 51, 2);
    const tap12 = rate(12, 20);
    const full12 = rate(12, 51);
    const long25 = rate(25, 51);
    // eslint-disable-next-line no-console
    console.log(`16 m: 0.33 s tap ${(tap16.goal * 100).toFixed(0)}% | full ${(full16.goal * 100).toFixed(0)}% | stick-aimed ${(stick16.goal * 100).toFixed(0)}% (${(stick16.wide * 100).toFixed(0)}% wide) | 12 m tap ${(tap12.goal * 100).toFixed(0)}%, full ${(full12.goal * 100).toFixed(0)}% | 25 m ${(long25.goal * 100).toFixed(0)}%`);
    // It used to be 0/15 for the tap and 5/15 at full power; about half the stick-aimed ones went wide.
    expect(tap16.goal).toBeGreaterThanOrEqual(0.12);
    expect(tap16.goal).toBeLessThanOrEqual(0.4);
    expect(full16.goal).toBeGreaterThanOrEqual(0.25);
    expect(stick16.goal).toBeGreaterThanOrEqual(0.25);
    expect(stick16.wide).toBeLessThanOrEqual(0.25);
    // Close in stays the better chance, without being a formality.
    for (const r of [tap12, full12]) {
      expect(r.goal).toBeGreaterThanOrEqual(0.4);
      expect(r.goal).toBeLessThanOrEqual(0.75);
    }
    expect(long25.goal).toBeLessThan(tap16.goal);
    // Parries go back into play (or into the box) far more often than behind for corners.
    const saves = [tap16, full16, stick16, tap12, full12, long25].reduce((a, r) => a + r.saves, 0);
    const corners = [tap16, full16, stick16, tap12, full12, long25].reduce((a, r) => a + r.corners, 0);
    // eslint-disable-next-line no-console
    console.log(`saves ending in a corner: ${corners}/${saves}`);
    expect(saves).toBeGreaterThan(60);
    expect(corners / saves).toBeLessThanOrEqual(0.3);
  }, 120_000);
});

/**
 * A human 1v1 from anywhere: the striker at (dist from the line, z) with only the keeper (set on his angle for
 * `settle` frames; everyone else parked at the far end), SHOOT held `hold` frames with the stick at (fwd
 * towards goal, lat across) all the way through. What came of it, how far the charge carried him, and where
 * the ball as struck was going at the line.
 */
function setShot(seed: number, dist: number, z: number, hold: number, fwd: number, lat: number, settle: number, half2 = false) {
  const m = newMatch(seed);
  if (half2) {
    m.phase = 'halftime';
    m.continueSecondHalf();
  }
  m.phase = 'play';
  m.restart = null;
  m.clock = 20;
  const ad = m.attackDir(0);
  m.players.forEach((p, i) => place(p, -ad * 40, -HALF_W + 2 + i * 2.6));
  const p = m.players[9];
  place(p, ad * (HALF_L - dist), z);
  p.facing = Math.atan2(-z * 0.3, ad);
  place(m.keeperOf(1)!, ad * (HALF_L - 1.5), z * 0.1);
  const b = m.ball;
  b.reset(p.pos.x + ad * 0.5, p.pos.z);
  b.owner = p.idx;
  b.lastTouch = p.idx;
  b.lastTouchSide = 0;
  m.active = p.idx;
  m.updateBallPath();
  for (let i = 0; i < settle; i++) m.step(DT, EMPTY_PAD);
  m.drainEvents();
  const stick = pad(ad * fwd, lat);
  const x0 = p.pos.x;
  const z0 = p.pos.z;
  let style: string | undefined;
  let drift = -1;
  let line: { z: number; y: number } | null | undefined;
  const watch = () => {
    for (const e of m.drainEvents()) {
      if (e.type === 'kick' && drift < 0) {
        style = e.style;
        drift = Math.hypot(p.pos.x - x0, p.pos.z - z0);
        line = lineCrossing(b, ad);
      }
    }
  };
  for (let i = 0; i < charge(hold); i++) {
    m.step(DT, { ...stick, shoot: true });
    watch();
  }
  const g0 = m.score[0];
  for (let i = 0; i < 260; i++) {
    m.step(DT, i < 6 ? stick : EMPTY_PAD);
    watch();
    if (m.score[0] > g0) return { goal: true, style, drift, wide: false };
    if (phase(m) !== 'play' || (m.ball.owner >= 0 && m.players[m.ball.owner].side === 1)) break;
  }
  const wide = line === null || (!!line && Math.abs(line.z) >= GOAL_W / 2);
  return { goal: false, style, drift, wide };
}

describe('finesse and stick-aimed finishing (round 7)', () => {
  it('a finesse curler at the far post from ~18 m out wide of the post beats a set keeper 30-40% of the time', () => {
    let n = 0;
    let goals = 0;
    let wide = 0;
    for (const [dist, zAbs] of [[16.5, 7], [15, 10], [13.5, 12], [17.2, 5]] as const) {
      for (const sgn of [1, -1]) {
        for (const hold of [20, 28]) {
          for (let k = 0; k < 12; k++) {
            // The stick diagonally at the far post, a placed (under 60%) strike: the finesse shot.
            const r = setShot(100 + k * 31 + hold, dist, zAbs * sgn, hold, Math.SQRT1_2, -sgn * Math.SQRT1_2, 40);
            expect(r.style).toBe('finesse');
            n++;
            if (r.goal) goals++;
            if (r.wide) wide++;
          }
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`finesse, far post, from ~18 m wide of the post: ${goals}/${n} (${((goals / n) * 100).toFixed(0)}%), ${wide} wide`);
    // It was 0/48 in the browser (every one saved: too slow, too far inside the post, read at once).
    expect(goals / n).toBeGreaterThanOrEqual(0.3);
    expect(goals / n).toBeLessThanOrEqual(0.42);
  }, 60_000);

  it('a shot aimed with the stick from the edge of the box: under 20% wide on either side, and the charge no longer drags him', () => {
    let n = 0;
    let wide = 0;
    let drift = 0;
    const bySide = { left: [0, 0], right: [0, 0] };
    for (const half2 of [false, true]) {
      for (const lat of [1, -1]) {
        for (let k = 0; k < 50; k++) {
          const r = setShot(1000 + k * 17 + (lat > 0 ? 0 : 5000) + (half2 ? 9000 : 0), 16, 0, 51, 0, lat, 4, half2);
          n++;
          drift += r.drift;
          if (r.wide) wide++;
          // (Attacking +x, +z is the shooter's right.)
          const side = lat * (half2 ? -1 : 1) > 0 ? bySide.right : bySide.left;
          side[0]++;
          if (r.wide) side[1]++;
        }
      }
    }
    const l = bySide.left[1] / bySide.left[0];
    const rr = bySide.right[1] / bySide.right[0];
    // eslint-disable-next-line no-console
    console.log(`stick-aimed from 16 m: ${((wide / n) * 100).toFixed(0)}% wide (left ${(l * 100).toFixed(0)}%, right ${(rr * 100).toFixed(0)}%), charge drift ${(drift / n).toFixed(2)} m`);
    // It was 25-50% wide in the browser, and a stick held across carried him ~4 m while he charged.
    expect(wide / n).toBeLessThan(0.2);
    expect(l).toBeLessThan(0.23);
    expect(rr).toBeLessThan(0.23);
    expect(Math.abs(l - rr)).toBeLessThan(0.08);
    expect(drift / n).toBeLessThan(1.6);
  }, 60_000);
});

describe('set-piece balance', () => {
  it('free kicks: a straight one mostly hits the wall or the keeper; a well-bent one over the wall is the skill', () => {
    const straight = fkRates('straight');
    const curled = fkRates('wallIn');
    // eslint-disable-next-line no-console
    console.log(`free kicks 20-25 m: straight ${(straight.goal * 100).toFixed(0)}% (wall ${(straight.wall * 100).toFixed(0)}%) | curled over the wall ${(curled.goal * 100).toFixed(0)}% (wall ${(curled.wall * 100).toFixed(0)}%)`);
    expect(straight.goal).toBeLessThanOrEqual(0.14);
    expect(straight.wall).toBeGreaterThanOrEqual(0.6);
    // (Round 13: 16% -> 14% with the team shape's second-ball defending, a shot or two in the 160: the floor was 0.15.)
    expect(curled.goal).toBeGreaterThanOrEqual(0.13);
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
    // (Round 13: 10/120 -> 15/120 with the team shape, the scramble after the delivery defended by the zonal block
    // rather than men who were all drawn to the ball; the ceiling was 0.1.)
    expect(goals / n).toBeLessThanOrEqual(0.13);
    expect(thrown / 60).toBeLessThanOrEqual(0.05);
  }, 120_000);

  it('corners: runners start in and around the six-yard box, three zonal men hold the 5.5 m line, and a driven one is met', () => {
    // The shape, as the restart snaps everyone into it.
    for (const seed of [1, 2, 3, 4]) {
      const m = newMatch(seed);
      m.clock = 20;
      m.phase = 'play';
      m.ball.owner = -1;
      const ad = m.attackDir(0);
      const s0 = seed % 2 ? 1 : -1;
      goOut(m, 'corner', 0, ad * (HALF_L - 0.35), s0 * (HALF_W - 0.35));
      for (let i = 0; phase(m) !== 'restart' && i < 400; i++) m.step(DT, EMPTY_PAD);
      const gx = ad * HALF_L;
      const out = (p: Player) => (gx - p.pos.x) * ad;
      const atk = m.teamPlayers(0).filter((p) => !p.isKeeper && p.idx !== m.restart!.taker);
      for (const [d, z] of CORNER_BOX) {
        // Someone is standing on each runner's mark (m out, across the goal towards the corner's side).
        expect(Math.min(...atk.map((p) => Math.hypot(out(p) - d, p.pos.z - z * s0)))).toBeLessThan(0.8);
      }
      expect(atk.filter((p) => out(p) < 12 && Math.abs(p.pos.z) < 8).length).toBeGreaterThanOrEqual(5);
      const defs = m.teamPlayers(1).filter((p) => !p.isKeeper);
      for (const z of CORNER_ZONAL) {
        expect(Math.min(...defs.map((p) => Math.hypot(out(p) - CORNER_ZONAL_D, p.pos.z - z * s0)))).toBeLessThan(0.8);
      }
      // Not just the keeper and one defender in and around the six-yard box any more.
      const six = (p: Player) => out(p) < 6.5 && Math.abs(p.pos.z) < 9;
      expect(defs.filter(six).length).toBeGreaterThanOrEqual(3);
    }
    // cob.js, driven (SHOOT 20 frames): met by someone, hardly ever straight out for a throw.
    let touched = 0;
    let intoTouch = 0;
    const n = 60;
    for (let k = 0; k < n; k++) {
      const m = newMatch(5000 + k * 31);
      m.clock = 20;
      m.phase = 'play';
      m.ball.owner = -1;
      const ad = m.attackDir(0);
      goOut(m, 'corner', 0, ad * (HALF_L - 0.35), (k % 2 ? 1 : -1) * (HALF_W - 0.35));
      for (let i = 0; phase(m) !== 'restart' && i < 400; i++) m.step(DT, EMPTY_PAD);
      for (let j = 0; j < 30; j++) m.step(DT, EMPTY_PAD);
      const taker = m.restart!.taker;
      for (let j = 0; j < 20; j++) m.step(DT, pad(0, 0, { shoot: true }));
      for (let w = 0; phase(m) === 'restart' && w < 300; w++) m.step(DT, EMPTY_PAD);
      let tch = false;
      for (let j = 0; j < 300; j++) {
        m.step(DT, EMPTY_PAD);
        if (m.ball.lastTouch !== taker) tch = true;
        if (phase(m) === 'out' || phase(m) === 'goal' || (m.ball.owner >= 0 && j > 10)) {
          if (!tch && phase(m) === 'out' && m.restart?.kind === 'throwin') intoTouch++;
          break;
        }
      }
      if (tch) touched++;
    }
    // eslint-disable-next-line no-console
    console.log(`driven corners: ${touched}/${n} met, ${intoTouch} straight into touch`);
    expect(touched / n).toBeGreaterThanOrEqual(0.8);
    expect(intoTouch / n).toBeLessThanOrEqual(0.1);
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
        for (const p of m.players) {
          if (p === t || p.isKeeper || p.sentOff) continue;
          const f = frame(p.pos);
          if (f.along < 0.5 && f.along > -12) expect(Math.abs(f.lat)).toBeGreaterThanOrEqual(FK_LENS_CLEAR - 0.1);
          // Nobody in the +-30 degree cone behind the ball the camera (~7 m back) looks through.
          if (f.along < 0 && f.along > -FK_LENS_CONE_DEPTH) expect(Math.abs(Math.atan2(f.lat, -f.along))).toBeGreaterThan(Math.PI / 6);
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
    for (let i = 0; i < charge(36); i++) m.step(DT, pad(0, 0, { shoot: true }));
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
