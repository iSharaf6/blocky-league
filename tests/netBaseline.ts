import { stateHash } from '../src/net/hash';
import { DT } from '../src/sim/constants';
import { EMPTY_PAD, Match, type MatchConfig } from '../src/sim/match';
import { HumanBot } from './humanBot';
import { FuzzPad, netConfig, runToEnd, stoppages, type RunResult } from './netHarness';

/**
 * The single-player bit-identity table (tests/net.test.ts): whole matches run by fixed drivers, summarised as
 * [end-state hash, a fold of the hash every 60 steps, steps, score home, score away, went to a shootout (1/0)].
 * The same table was recorded on the sim before two-human support; after it, every row must come out the same.
 * Covers AI v AI (classic, blitz, contrasting team styles), a scripted human (the bot: side 0), a masher on either
 * side with non-default controls, dynamic difficulty and the Club Run perks, the first-match onboarding, blitz with
 * starting power-ups, and knockout ties through penalty shootouts.
 */
export type Row = [number, number, number, number, number, number];

const row = (r: RunResult): Row => [r.end, r.trail, r.steps, r.m.score[0], r.m.score[1], r.m.shootout ? 1 : 0];

/** A match with the scripted bot on side 0 (it reads the view: humanSide 0). */
function botRun(cfg: MatchConfig, seed: number): Row {
  const m = new Match(cfg);
  const bot = new HumanBot(seed);
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
  return row({ m, steps, end: stateHash(m), trail });
}

function fuzzRun(cfg: MatchConfig, seed: number, setup?: (m: Match) => void): Row {
  const m = new Match(cfg);
  setup?.(m);
  const f = new FuzzPad(seed);
  const hs = cfg.humanSide;
  return row(runToEnd(m, () => f.pad(), [hs === 0, hs === 1]));
}

const aiRun = (cfg: MatchConfig): Row => row(runToEnd(new Match(cfg), () => EMPTY_PAD, [false, false]));

export const SCENARIOS: Record<string, () => Row> = {
  aiClassic: () => aiRun(netConfig({ seed: 7, halfLength: 150, difficulty: 2 })),
  aiBlitz: () => aiRun(netConfig({ seed: 31, halfLength: 90, difficulty: 3, mode: 'blitz' })),
  // (High press against a low block.)
  aiStyles: () => aiRun(netConfig({ seed: 13, halfLength: 90, difficulty: 3 }, 2, 8)),
  botSide0: () => botRun(netConfig({ seed: 11, halfLength: 120, difficulty: 1.8, humanSide: 0 }), 11),
  botPerks: () => botRun(netConfig({
    seed: 21, halfLength: 90, difficulty: 3, humanSide: 0, assist: 0.6, startScore: [0, 1], keeperBoost: [1, 0.5], goldenFirst: 0,
  }, 7, 1), 21),
  botFirstMatch: () => botRun(netConfig({ seed: 3, halfLength: 90, difficulty: 0.6, humanSide: 0, firstMatch: true }), 3),
  fuzzSide1: () => fuzzRun(netConfig({ seed: 5, halfLength: 90, difficulty: 3, humanSide: 1 }), 5, (m) => {
    m.groundAssist = 'manual';
    m.throughAssist = 'semi';
    m.quickPass = false;
    m.autoSwitch = false;
  }),
  fuzzBlitz0: () => fuzzRun(netConfig({ seed: 9, halfLength: 90, difficulty: 1.8, humanSide: 0, mode: 'blitz' }), 9),
  fuzzBlitzPerks1: () => fuzzRun(netConfig({
    seed: 41, halfLength: 90, difficulty: 1.8, humanSide: 1, mode: 'blitz', startPower: ['mega', 'turbo'], assist: 0.3,
  }, 4, 9), 41, (m) => {
    m.moveAssist = false;
    m.timedFinish = false;
  }),
};

/** Knockout ties (short halves, often level at full time): side 1 human, a masher. */
export const KO_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
export const koRun = (seed: number): Row =>
  fuzzRun(netConfig({ seed, halfLength: 25, difficulty: 1.8, humanSide: 1, knockout: true }), seed);
