import { describe, expect, it } from 'vitest';
import { recoveredMatch } from '../src/game/matchRecovery';
import { encodeState, type StateGraph } from '../src/game/stateCodec';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { stateHash } from '../src/net/hash';
import { CURL_SPIN, CURLER_BEND, CURLER_MIN, CURLER_MIN_D, FINESSE_CURL, stickCurl } from '../src/sim/actions';
import { DT, GOAL_W, HALF_L, HALF_W } from '../src/sim/constants';
import { AFTERTOUCH_SPIN, AFTERTOUCH_T, EMPTY_PAD, Match, SHOOT_FULL_T, type MatchConfig, type Pad } from '../src/sim/match';
import type { Player } from '../src/sim/player';
import type { MatchEvent } from '../src/sim/types';

/*
 * CURVE (the owner: "knuckle ball curves allat make the game perfect! add new stuff u think players will love"):
 * the human's CURLER (sim/actions.ts CURLER_BEND: the stick sideways at the strike is a big, visible bend, re-aimed
 * onto the same point) and AFTERTOUCH (sim/match.ts aftertouchStep: a push of the stick across the flight just after
 * the strike bends the ball in the air). (How often they score: tests/knuckleRates.test.ts.)
 */

function newMatch(seed: number, cfg: Partial<MatchConfig> = {}): Match {
  return new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 120, difficulty: 1.8, humanSide: 0, seed, ...cfg });
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
const framesFor = (power: number) => Math.round((power * SHOOT_FULL_T) / DT);

interface Shot {
  /** Frames SHOOT is held, and the stick while it is (and until the boot meets the ball). */
  hold: number;
  stick?: Partial<Pad>;
  /** The stick from `afterFrom` s after the strike on (default: the same stick). */
  after?: Partial<Pad>;
  afterFrom?: number;
  /** THROUGH tapped during the charge: a chip. */
  chip?: boolean;
}

interface Result {
  m: Match;
  style: string | undefined;
  /** The ball's sidespin (rad/s about y) right after the strike. */
  spin0: number;
  /** Where it crossed the goal line (null: it never did). */
  z: number | null;
  /** How far (m) its path bowed off the straight line from the strike to where it crossed. */
  bow: number;
  events: MatchEvent[];
  /** The most sidespin the ball carried beyond what it was struck with (rad/s). */
  spinGain: number;
  aim: { z: number; errZ: number } | null;
}

/** The human's striker `dist` m from the middle of the goal with nobody near (no keeper either): one shot, followed over the line. */
function shoot(seed: number, dist: number, z: number, s: Shot, cfg: Partial<MatchConfig> = {}): Result {
  const m = newMatch(seed, cfg);
  m.phase = 'play';
  m.restart = null;
  m.clock = 20;
  m.players.forEach((q, i) => place(q, -40 + i * 3.6, -HALF_W + 1.5));
  const ad = m.attackDir(0);
  const gx = ad * HALF_L;
  const p = m.players[9];
  place(p, ad * (HALF_L - Math.sqrt(dist * dist - z * z) - 0.5), z);
  p.facing = Math.atan2(-z * 0.3, ad);
  const b = m.ball;
  b.reset(p.pos.x + ad * 0.5, p.pos.z);
  b.owner = p.idx;
  b.lastTouch = p.idx;
  b.lastTouchSide = 0;
  m.active = p.idx;
  m.updateBallPath();
  for (let i = 0; i < 4; i++) m.step(DT, EMPTY_PAD);
  m.drainEvents();
  const stick = s.stick ?? {};
  const r: Result = { m, style: undefined, spin0: 0, z: null, bow: 0, events: [], spinGain: 0, aim: null };
  const path: [number, number][] = [];
  let struck = -1;
  for (let i = 0; i < s.hold + 300; i++) {
    const held = i < s.hold;
    const px = b.pos.x;
    const pz = b.pos.z;
    const since = struck < 0 ? -1 : (i - struck) * DT;
    const now = struck >= 0 && s.after && since >= (s.afterFrom ?? 0) ? s.after : stick;
    m.step(DT, pad({ ...now, shoot: held, through: !!s.chip && i === s.hold - 2 }));
    for (const e of m.drainEvents()) {
      r.events.push(e);
      if (e.type === 'kick' && e.kind === 'shot' && struck < 0) {
        struck = i;
        r.style = e.style;
        r.spin0 = b.spin.y;
        const a = m.ctl[0].finish?.aim;
        r.aim = a ? { z: a.z, errZ: a.errZ } : null;
        path.push([px, pz]);
      }
    }
    if (struck < 0) continue;
    r.spinGain = Math.max(r.spinGain, Math.abs(b.spin.y) - Math.abs(r.spin0));
    if ((px - gx) * ad < 0 && (b.pos.x - gx) * ad >= 0) {
      r.z = pz + (b.pos.z - pz) * ((gx - px) / (b.pos.x - px || 1e-9));
      path.push([gx, r.z]);
      break;
    }
    path.push([b.pos.x, b.pos.z]);
    if (phase(m) !== 'play' || b.owner >= 0) break;
  }
  if (r.z !== null) {
    const [ax, az] = path[0];
    const [bx, bz] = path[path.length - 1];
    const l = Math.hypot(bx - ax, bz - az) || 1;
    for (const [x, zz] of path) r.bow = Math.max(r.bow, Math.abs((x - ax) * (bz - az) - (zz - az) * (bx - ax)) / l);
  }
  return r;
}

const has = (r: Result, type: MatchEvent['type']) => r.events.filter((e) => e.type === type).length;

describe('the curler', () => {
  it('the stick sideways at the strike from range is a CURLER: tagged, with CURLER_BEND times a bent strike\'s spin, bending the way the stick was pushed', () => {
    expect(CURLER_BEND).toBeGreaterThan(1.3);
    for (const side of [1, -1]) {
      const r = shoot(3, 20, 0, { hold: framesFor(0.7), stick: { mz: side } });
      expect(r.style).toBe('curler');
      expect(r.m.shotStyle).toBe('curler');
      // (One step of flight has taken a hair of the spin off.)
      expect(Math.abs(r.spin0)).toBeGreaterThan(CURL_SPIN * CURLER_BEND * 0.97);
      expect(Math.abs(r.spin0)).toBeLessThanOrEqual(CURL_SPIN * CURLER_BEND);
      // It bends towards the stick's side: it is struck inside its target and swings out to it.
      expect(r.z).not.toBeNull();
      expect(Math.sign(r.z!)).toBe(side);
    }
  });

  it('a gentle push, a strike from close in and a finesse shot bend as they always did (no tag, the old spin)', () => {
    // Half a push: under CURLER_MIN of a full bend.
    expect(Math.abs(stickCurl(0.5))).toBeLessThan(CURLER_MIN);
    const gentle = shoot(3, 20, 0, { hold: framesFor(0.7), stick: { mz: 0.5 } });
    expect(gentle.style).toBeUndefined();
    expect(Math.abs(gentle.spin0)).toBeLessThan(CURL_SPIN * 0.6);
    expect(Math.abs(gentle.spin0)).toBeGreaterThan(CURL_SPIN * 0.3);
    // The stick diagonally at a corner on a hard strike picks the corner and bends it as it always did: the curler is
    // the stick pushed further round than that, SIDEWAYS.
    const m1 = newMatch(1);
    expect(Math.abs(stickCurl(Math.SQRT1_2))).toBeLessThan(CURLER_MIN);
    expect(Math.abs(stickCurl(0.8))).toBeGreaterThanOrEqual(CURLER_MIN);
    const diag = shoot(3, 20, 0, { hold: framesFor(0.8), stick: { mx: m1.attackDir(0) * Math.SQRT1_2, mz: Math.SQRT1_2 } });
    expect(diag.style).toBeUndefined();
    expect(Math.abs(diag.spin0)).toBeLessThanOrEqual(CURL_SPIN);
    // Inside CURLER_MIN_D m: the full bend of old.
    const close = shoot(3, CURLER_MIN_D - 2, 0, { hold: framesFor(0.7), stick: { mz: 1 } });
    expect(close.style).toBeUndefined();
    expect(Math.abs(close.spin0)).toBeGreaterThan(CURL_SPIN * 0.97);
    expect(Math.abs(close.spin0)).toBeLessThanOrEqual(CURL_SPIN);
    // The stick diagonally at a corner on a placed shot is still the finesse shot, with its own curl.
    const m0 = newMatch(1);
    const fin = shoot(3, 20, 0, { hold: framesFor(0.5), stick: { mx: m0.attackDir(0) * Math.SQRT1_2, mz: Math.SQRT1_2 } });
    expect(fin.style).toBe('finesse');
    expect(Math.abs(fin.spin0)).toBeGreaterThan(CURL_SPIN * FINESSE_CURL * 0.97);
    expect(Math.abs(fin.spin0)).toBeLessThanOrEqual(CURL_SPIN * FINESSE_CURL);
  });

  it('the bend is one anybody can see (its path bows over half a metre off the straight line), and far bigger than a plain bent strike\'s', () => {
    const bows: number[] = [];
    const plain: number[] = [];
    for (let k = 0; k < 16; k++) {
      const c = shoot(10 + k, [18, 20, 24][k % 3], [0, 4, -4][k % 3], { hold: framesFor(0.7), stick: { mz: k % 2 ? 1 : -1 } });
      expect(c.style).toBe('curler');
      if (c.z !== null) bows.push(c.bow);
      // (The same strike with the stick just short of a curler's: 0.57 of a full bend, the old spin.)
      const g = shoot(10 + k, [18, 20, 24][k % 3], [0, 4, -4][k % 3], { hold: framesFor(0.7), stick: { mz: k % 2 ? 0.56 : -0.56 } });
      expect(g.style).toBeUndefined();
      if (g.z !== null) plain.push(g.bow);
    }
    const mean = (v: number[]) => v.reduce((a, c) => a + c, 0) / v.length;
    expect(bows.length).toBeGreaterThan(12);
    // (How far the path leaves the straight line between the boot and where it ends up: a quarter of how far outside
    // its target it was struck. From 18 m over half a metre, from 24 m ~0.9 m.)
    bows.sort((a, c) => a - c);
    expect(bows[0]).toBeGreaterThan(0.45);
    expect(mean(bows)).toBeGreaterThan(0.6);
    expect(mean(bows)).toBeGreaterThan(mean(plain) * 2.5);
    // And it is a bend, not a boomerang (the middle one of them: a ball off a post is no measure).
    expect(bows[bows.length >> 1]).toBeLessThan(1.2);
  });

  it('is re-aimed: it still crosses the line where the aim model put it, as near as a plain strike does', () => {
    let n = 0;
    for (let k = 0; k < 30; k++) {
      const r = shoot(40 + k, [16, 20, 25][k % 3], [0, 5, -5][k % 3], { hold: framesFor(0.7), stick: { mz: k % 2 ? 1 : -1 } });
      expect(r.style).toBe('curler');
      const tz = r.aim!.z + r.aim!.errZ;
      // (The net holds a ball that squeezes in by a post, and one struck at the post is the frame's.)
      if (r.z === null || has(r, 'post') > 0 || Math.abs(Math.abs(tz) - GOAL_W / 2) < 0.35) continue;
      n++;
      expect(Math.abs(r.z - tz), `seed ${40 + k}`).toBeLessThan(0.12);
      // The aim is the corner the stick picked, inside the post.
      expect(Math.sign(r.aim!.z)).toBe(k % 2 ? 1 : -1);
      expect(Math.abs(r.aim!.z)).toBeLessThan(GOAL_W / 2);
    }
    expect(n).toBeGreaterThan(20);
  });
});

describe('aftertouch', () => {
  const PLACED = framesFor(0.5);

  it('a push of the stick across the flight after the strike bends the ball that way: one event, the ball moved at the line', () => {
    for (const side of [1, -1] as const) {
      const still = shoot(5, 22, 0, { hold: PLACED });
      const pushed = shoot(5, 22, 0, { hold: PLACED, after: { mz: side } });
      expect(has(still, 'aftertouch')).toBe(0);
      expect(has(pushed, 'aftertouch')).toBe(1);
      const e = pushed.events.find((x) => x.type === 'aftertouch') as Extract<MatchEvent, { type: 'aftertouch' }>;
      expect(e.player).toBe(pushed.m.players[9].idx);
      expect(e.dir).toBe(side);
      expect(still.z).not.toBeNull();
      expect(pushed.z).not.toBeNull();
      const shift = (pushed.z! - still.z!) * side;
      expect(shift).toBeGreaterThan(0.3);
      expect(shift).toBeLessThan(1.3);
      // Sidespin, and no more of it than the cap.
      // (Most of the cap is still on it at the line: spin dies away a little in the air.)
      expect(pushed.spinGain).toBeGreaterThan(AFTERTOUCH_SPIN * 0.6);
      expect(pushed.spinGain).toBeLessThanOrEqual(AFTERTOUCH_SPIN + 1e-9);
      expect(still.spinGain).toBeLessThanOrEqual(1e-9);
    }
  });

  it('only a push counts: the stick left where it was, eased off or let go does nothing at all', () => {
    const m0 = newMatch(1);
    const ad = m0.attackDir(0);
    // The stick at goal through the strike, then: held there, or let go. The same ball either way.
    const held = shoot(7, 22, 0, { hold: PLACED, stick: { mx: ad } });
    const letGo = shoot(7, 22, 0, { hold: PLACED, stick: { mx: ad }, after: {} });
    expect(has(held, 'aftertouch')).toBe(0);
    expect(has(letGo, 'aftertouch')).toBe(0);
    expect(letGo.z).toBe(held.z);
    expect(held.spinGain).toBeLessThanOrEqual(1e-9);
    // A curler's stick (sideways at the strike): held, eased off half way, or let go, the curler is the same curler.
    const curl = shoot(7, 20, 0, { hold: framesFor(0.7), stick: { mz: 1 } });
    const eased = shoot(7, 20, 0, { hold: framesFor(0.7), stick: { mz: 1 }, after: { mz: 0.4 } });
    const dropped = shoot(7, 20, 0, { hold: framesFor(0.7), stick: { mz: 1 }, after: {} });
    for (const r of [curl, eased, dropped]) {
      expect(r.style).toBe('curler');
      expect(has(r, 'aftertouch')).toBe(0);
      expect(r.z).toBe(curl.z);
    }
    // ... but pushed right across to the other side, it is an aftertouch against its bend.
    const across = shoot(7, 20, 0, { hold: framesFor(0.7), stick: { mz: 1 }, after: { mz: -1 } });
    expect(has(across, 'aftertouch')).toBe(1);
    expect(across.z!).toBeLessThan(curl.z! - 0.2);
    // A small move of the thumb (under the dead zone) is no push.
    const nudge = shoot(7, 22, 0, { hold: PLACED, after: { mz: 0.25 } });
    const none = shoot(7, 22, 0, { hold: PLACED });
    expect(has(nudge, 'aftertouch')).toBe(0);
    expect(nudge.z).toBe(none.z);
  });

  it('is capped: from 20 m a full push moves the ball under 1.1 m at the line, whatever the power; further out a little more', () => {
    const shifts: number[] = [];
    for (let k = 0; k < 24; k++) {
      const hold = framesFor([0.2, 0.5, 0.85][k % 3]);
      const side = k % 2 ? 1 : -1;
      const still = shoot(60 + k, 20, 0, { hold });
      const pushed = shoot(60 + k, 20, 0, { hold, after: { mz: side } });
      // (A shot that met the post, or bounced in front of the line, is not a measure of the bend.)
      if (still.z === null || pushed.z === null || has(still, 'post') + has(pushed, 'post') + has(still, 'bounce') + has(pushed, 'bounce') > 0) continue;
      shifts.push((pushed.z - still.z) * side);
    }
    expect(shifts.length).toBeGreaterThan(10);
    expect(Math.max(...shifts)).toBeLessThan(1.1);
    expect(Math.min(...shifts)).toBeGreaterThan(0.25);
  });

  it('only in its window: a push that comes later than AFTERTOUCH_T after the strike does nothing', () => {
    const still = shoot(9, 30, 0, { hold: PLACED });
    // (Pushed towards the middle of the goal: this one was struck for the far corner.)
    const side = -Math.sign(still.z!);
    const late = shoot(9, 30, 0, { hold: PLACED, after: { mz: side }, afterFrom: AFTERTOUCH_T + 0.05 });
    const early = shoot(9, 30, 0, { hold: PLACED, after: { mz: side }, afterFrom: 0.1 });
    expect(has(late, 'aftertouch')).toBe(0);
    expect(late.z).toBe(still.z);
    expect(has(early, 'aftertouch')).toBe(1);
    expect((early.z! - still.z!) * side).toBeGreaterThan(0.3);
    // (And the window closes: the ball's aftertouch state is gone once it has.)
    expect(early.m.ball.aftertouch).toBeNull();
  });

  it('not on a chip, and not on a knuckleball: the stick does nothing to either', () => {
    const chip = shoot(11, 20, 0, { hold: framesFor(0.5), chip: true });
    const chipPushed = shoot(11, 20, 0, { hold: framesFor(0.5), chip: true, after: { mz: 1 } });
    expect(chip.style).toBe('chip');
    expect(has(chipPushed, 'aftertouch')).toBe(0);
    expect(chipPushed.spinGain).toBeLessThanOrEqual(1e-9);
    const full = framesFor(1) + 6;
    const kn = shoot(11, 26, 0, { hold: full });
    const knPushed = shoot(11, 26, 0, { hold: full, after: { mz: 1 } });
    expect(kn.style).toBe('knuckle');
    expect(has(knPushed, 'aftertouch')).toBe(0);
    expect(knPushed.z).toBe(kn.z);
    expect(knPushed.spinGain).toBeLessThanOrEqual(1e-9);
  });

  it('its window survives a save and a reload, and the hash sees it', () => {
    const run = (): Match => {
      const r = shoot(13, 28, 0, { hold: PLACED, after: { mz: 1 }, afterFrom: 0.05 });
      return r.m;
    };
    expect(stateHash(run())).toBe(stateHash(run()));
    // Stop in the middle of the window, with the push on.
    const m = newMatch(13);
    m.phase = 'play';
    m.restart = null;
    m.clock = 20;
    m.players.forEach((q, i) => place(q, -40 + i * 3.6, -HALF_W + 1.5));
    const ad = m.attackDir(0);
    const p = m.players[9];
    place(p, ad * (HALF_L - 28.5), 0);
    p.facing = ad > 0 ? 0 : Math.PI;
    m.ball.reset(p.pos.x + ad * 0.5, 0);
    m.ball.owner = p.idx;
    m.ball.lastTouch = p.idx;
    m.active = p.idx;
    for (let i = 0; i < 4; i++) m.step(DT, EMPTY_PAD);
    for (let i = 0; i < PLACED; i++) m.step(DT, pad({ shoot: true }));
    let struck = false;
    for (let i = 0; i < 40 && !struck; i++) {
      m.step(DT, EMPTY_PAD);
      struck = m.drainEvents().some((e) => e.type === 'kick' && e.kind === 'shot');
    }
    expect(struck).toBe(true);
    for (let i = 0; i < 8; i++) m.step(DT, pad({ mz: 1 }));
    const at = m.ball.aftertouch!;
    expect(at).not.toBeNull();
    expect(at.shown).toBe(true);
    expect(Math.abs(at.spin)).toBeGreaterThan(1);
    const copy = recoveredMatch(JSON.parse(JSON.stringify(encodeState({ match: m }))) as StateGraph);
    expect(copy.ball.aftertouch).toEqual(at);
    expect(stateHash(copy)).toBe(stateHash(m));
    const h0 = stateHash(m);
    at.spin += 0.01;
    expect(stateHash(m)).not.toBe(h0);
    at.spin -= 0.01;
    for (let i = 0; i < 90; i++) {
      const q = pad({ mz: i < 10 ? 1 : 0 });
      m.step(DT, q);
      copy.step(DT, q);
      expect(stateHash(copy), `step ${i}`).toBe(stateHash(m));
    }
  });
});
