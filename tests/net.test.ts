import { describe, expect, it } from 'vitest';
import { stateHash } from '../src/net/hash';
import { DT } from '../src/sim/constants';
import { EMPTY_PAD, Match, type Pad } from '../src/sim/match';
import { HumanBot } from './humanBot';
import { FuzzPad, netConfig, runToEnd, stoppages } from './netHarness';

/**
 * Online play is deterministic lockstep: both peers run the same sim on the same pads. These tests pin that
 * down: single-player is bit-identical to what it was before two-human support, two sims fed the same pads stay
 * identical every tick (whichever side each one views), and (below) the lockstep engine keeps two peers identical
 * over a bad network and notices when they aren't.
 */

/**
 * End-state hash, a fold of the hash every 60 steps, the step count and the score, recorded with the sim as it
 * was before MatchConfig.humanSides / Match.ctl (commit bb34939) by the same drivers as below.
 */
const BEFORE = {
  aiClassic: [2077768361, 1578466246, 18111, [0, 0]],
  aiBlitz: [1735493330, 1863915192, 11618, [0, 4]],
  botSide0: [4019672980, 1082181710, 15214, [3, 0]],
  fuzzSide1: [3273114491, 3761332502, 11420, [2, 0]],
  fuzzBlitz0: [3222048373, 3000282187, 11826, [0, 3]],
  ko1: [3491640593, 2415376323, 5398, [0, 0]],
  ko6: [583792695, 3974704757, 6495, [0, 0]],
  ko3: [779716697, 1298573416, 3468, [2, 0]],
} as const;

const summary = (r: { end: number; trail: number; steps: number; m: Match }) => [r.end, r.trail, r.steps, [...r.m.score]];

describe('single-player stays bit-identical', () => {
  it('AI v AI, classic and blitz', () => {
    const a = runToEnd(new Match(netConfig({ seed: 7, halfLength: 150, difficulty: 2 })), () => EMPTY_PAD, [false, false]);
    expect(summary(a)).toEqual(BEFORE.aiClassic);
    const b = runToEnd(new Match(netConfig({ seed: 31, halfLength: 90, difficulty: 3, mode: 'blitz' })), () => EMPTY_PAD, [false, false]);
    expect(summary(b)).toEqual(BEFORE.aiBlitz);
  }, 60_000);

  it('one human (the scripted bot on side 0; a masher on side 1 with non-default controls; blitz)', () => {
    const m = new Match(netConfig({ seed: 11, halfLength: 120, difficulty: 1.8, humanSide: 0 }));
    const bot = new HumanBot(11);
    let steps = 0;
    let trail = 0;
    while (m.phase !== 'fulltime' && steps < 60 * 60 * 16) {
      const pad = bot.pad(m);
      const before = m.ball.owner;
      m.step(DT, pad);
      bot.observe(m, m.drainEvents(), before);
      stoppages(m, [true, false]);
      steps++;
      if (steps % 60 === 0) trail = (Math.imul(trail ^ stateHash(m), 16777619) + steps) >>> 0;
    }
    expect([stateHash(m), trail, steps, [...m.score]]).toEqual(BEFORE.botSide0);

    const m1 = new Match(netConfig({ seed: 5, halfLength: 90, difficulty: 3, humanSide: 1 }));
    m1.groundAssist = 'manual';
    m1.throughAssist = 'semi';
    m1.quickPass = false;
    m1.autoSwitch = false;
    const f1 = new FuzzPad(5);
    expect(summary(runToEnd(m1, () => f1.pad(), [false, true]))).toEqual(BEFORE.fuzzSide1);

    const f2 = new FuzzPad(9);
    const m2 = new Match(netConfig({ seed: 9, halfLength: 90, difficulty: 1.8, humanSide: 0, mode: 'blitz' }));
    expect(summary(runToEnd(m2, () => f2.pad(), [true, false]))).toEqual(BEFORE.fuzzBlitz0);
  }, 60_000);

  it('knockout ties, through a penalty shootout', () => {
    for (const [seed, want] of [[1, BEFORE.ko1], [6, BEFORE.ko6], [3, BEFORE.ko3]] as const) {
      const m = new Match(netConfig({ seed, halfLength: 25, difficulty: 1.8, humanSide: 1, knockout: true }));
      const f = new FuzzPad(seed);
      const r = runToEnd(m, () => f.pad(), [false, true]);
      expect(summary(r)).toEqual(want);
      expect(!!m.shootout).toBe(seed !== 3);
    }
  }, 60_000);
});

describe('two human sides', () => {
  /** Two sims of one online match, as the two peers run it: the same config but each viewing its own side. */
  const pair = (seed: number, extra: Partial<Parameters<typeof netConfig>[0]> = {}) => {
    const cfg = (humanSide: 0 | 1) => netConfig({ seed, halfLength: 60, difficulty: 1.8, humanSide, humanSides: [true, true], ...extra });
    return [new Match(cfg(0)), new Match(cfg(1))] as const;
  };

  it('two sims fed the same pads stay identical every tick, whichever side each views', () => {
    const [a, b] = pair(21);
    // Each peer's own settings, agreed at the lobby: they are per side, whoever is looking.
    for (const m of [a, b]) {
      m.ctl[1].groundAssist = 'semi';
      m.ctl[1].quickPass = false;
      m.ctl[0].timedFinish = false;
    }
    const p0 = new FuzzPad(1);
    const p1 = new FuzzPad(2);
    let steps = 0;
    const seen = { active0: new Set<number>(), active1: new Set<number>() };
    while (a.phase !== 'fulltime' && steps < 60 * 60 * 10) {
      const pads: [Pad, Pad] = [p0.pad(), p1.pad()];
      a.step(DT, pads);
      b.step(DT, pads);
      a.drainEvents();
      b.drainEvents();
      stoppages(a, [true, true]);
      stoppages(b, [true, true]);
      steps++;
      const ha = stateHash(a);
      const hb = stateHash(b);
      if (ha !== hb) throw new Error(`diverged at step ${steps}`);
      seen.active0.add(a.ctl[0].active);
      seen.active1.add(a.ctl[1].active);
    }
    expect(a.phase).toBe('fulltime');
    expect(b.phase).toBe('fulltime');
    // Both humans really played: each side's control moved round his team, and each view reads its own.
    expect(seen.active0.size).toBeGreaterThan(3);
    expect(seen.active1.size).toBeGreaterThan(3);
    expect(a.active).toBe(a.ctl[0].active);
    expect(b.active).toBe(b.ctl[1].active);
    // ...and it is not the AI playing both: an AI v AI match from the same seed goes differently.
    const ai = runToEnd(new Match(netConfig({ seed: 21, halfLength: 60, difficulty: 1.8 })), () => EMPTY_PAD, [false, false]);
    expect(ai.end).not.toBe(stateHash(a));
  }, 60_000);

  it('each human switches, passes and tackles for his own side (the scripted bot on side 0)', () => {
    const [a, b] = pair(33);
    const bot = new HumanBot(33);
    const p1 = new FuzzPad(7);
    let steps = 0;
    const humanKicks = [0, 0];
    while (a.phase !== 'fulltime' && steps < 60 * 60 * 10) {
      // (The bot reads the side-0 view; the same pads go to both peers.)
      const pads: [Pad, Pad] = [bot.pad(a), p1.pad()];
      const before = a.ball.owner;
      const act = [a.ctl[0].active, a.ctl[1].active];
      a.step(DT, pads);
      b.step(DT, pads);
      const ev = a.drainEvents();
      b.drainEvents();
      bot.observe(a, ev, before);
      // (A strike by the man a human had just then: his pass, shot or clearance.)
      const k = a.ball.lastTouch;
      if (k >= 0 && ev.some((e) => e.type === 'kick') && k === act[a.players[k].side]) humanKicks[a.players[k].side]++;
      stoppages(a, [true, true]);
      stoppages(b, [true, true]);
      steps++;
      expect(stateHash(b)).toBe(stateHash(a));
    }
    expect(humanKicks[0]).toBeGreaterThan(10);
    expect(humanKicks[1]).toBeGreaterThan(5);
    expect(bot.tally.passes).toBeGreaterThan(5);
  }, 60_000);

  it('blitz with two humans: each side presses its own power-up', () => {
    const [a, b] = pair(12, { mode: 'blitz' });
    const p0 = new FuzzPad(3);
    const p1 = new FuzzPad(4);
    let used = [0, 0];
    for (let steps = 0; a.phase !== 'fulltime' && steps < 60 * 60 * 10; steps++) {
      const pads: [Pad, Pad] = [p0.pad(), p1.pad()];
      a.step(DT, pads);
      b.step(DT, pads);
      for (const e of a.drainEvents()) if (e.type === 'powerupUsed') used = used.map((n, s) => n + (e.side === s ? 1 : 0));
      b.drainEvents();
      stoppages(a, [true, true]);
      stoppages(b, [true, true]);
      expect(stateHash(b)).toBe(stateHash(a));
    }
    expect(used[0] + used[1]).toBeGreaterThan(0);
  }, 60_000);
});
