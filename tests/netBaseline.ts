import { stateHash } from '../src/net/hash';
import { DT, HALF_L, PEN_SPOT } from '../src/sim/constants';
import { EMPTY_PAD, Match, type MatchConfig, type Pad } from '../src/sim/match';
import type { Side } from '../src/sim/types';
import { HumanBot } from './humanBot';
import { FuzzPad, netConfig, runToEnd, stoppages, type RunResult } from './netHarness';

/**
 * The single-player bit-identity table (tests/net.test.ts): whole matches run by fixed drivers, summarised as
 * [end-state hash, a fold of the hash every 60 steps, steps, score home, score away, went to a shootout (1/0)].
 * Originally recorded before two-human support, the table still pins exact outcomes after reviewed physics
 * revisions. The 2026-10-02 incoming first-time-strike revision (network protocol v2) re-recorded only nine human
 * drivers that queue the new action; queue/contact counts are beside those rows in tests/net.test.ts. All AI rows,
 * three scripted-bot rows and ko1 remain bit-identical. No drivers or exact comparisons were relaxed. The 2026-10-02b
 * revision (NET_VERSION 3: the SKILL moves' telegraphed AI challenges, move assist's hysteresis, closing down a human
 * standing on the ball) re-recorded the human rows; the AI rows stay bit-identical (tests/net.test.ts says which).
 * Covers AI v AI (classic, blitz, contrasting team styles), a scripted human (the bot: side 0), a masher on either
 * side with non-default controls, dynamic difficulty and the Club Run perks, the first-match onboarding, blitz with
 * starting power-ups, and knockout ties through penalty shootouts.
 * The protocol-6 controls/skills revision (2026-10-04b) re-recorded the human rows only. The six AI-only rows keep
 * their exact previous hashes, ticks, scores and shootout flags; see the revision note beside tests/net.test.ts's table.
 * The protocol-7 stationary-possession revision (2026-10-04c) re-recorded only ten changed human rows. All six AI-only
 * rows and all three human knockout rows are bit-identical; the drivers and exact assertions are unchanged.
 * The protocol-9 idle-possession revision (2026-10-05b), including moving challenges on a ball exposed beyond its
 * carrier's body, re-recorded nine changed human rows. All six AI-only rows and
 * four human rows are still bit-identical; tests/net.test.ts identifies them. Drivers and exact assertions are unchanged.
 * The protocol-10 live-clock revision (2026-10-05c) re-recorded all nineteen rows: dead-ball preparations pause the
 * match clock and no longer inflate added time. Restart timers keep running. Drivers and exact assertions are unchanged.
 * The protocol-11 revision (2026-10-05d: the AI's play against a human, and the keeper's near post) re-recorded
 * eighteen rows; aiKo4 is bit-identical. Drivers and exact assertions are unchanged.
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

/** AI v AI knockout ties: the shootout with nobody at the controls. */
export const aiKoRun = (seed: number): Row =>
  aiRun(netConfig({ seed, halfLength: 25, difficulty: 2, knockout: true }, 3, 4));

/**
 * The human side's penalty aim over the kick (tests/penalty.test.ts's controls): the keys slide the reticle across
 * (`across`: +1 / -1) for 40 steps and up for 20, then SHOOT is held 20 steps and let go. `null`: nothing pressed
 * at all (his time runs out and it goes on its own at the reticle: humanPenaltyAim).
 */
export type PenScript = { across: 1 | -1; up: boolean } | null;
function penScriptPad(step: number, s: PenScript): Pad {
  if (!s) return EMPTY_PAD;
  const pad: Pad = { ...EMPTY_PAD, digital: true };
  if (step < 40) pad.mz = s.across;
  else if (step < 60) pad.mx = s.up ? 1 : 0;
  else if (step < 80) pad.shoot = true;
  return pad;
}

/**
 * A penalty given to `side` a few seconds in (as tests/penalty.test.ts sets one up), then the match played out to
 * full time: while the human side (cfg.humanSide) takes it the script plays its pad, otherwise a masher does (so
 * against an AI penalty the human's keeper is the masher's stick).
 */
function penaltyRun(cfg: MatchConfig, side: Side, script: PenScript, seed: number): Row {
  const m = new Match(cfg);
  const hs = cfg.humanSide;
  const humans = [hs === 0, hs === 1];
  const f = new FuzzPad(seed);
  for (let i = 0; i < 180; i++) {
    m.step(DT, f.pad());
    m.drainEvents();
  }
  Object.assign(m, { phase: 'play', restart: null });
  (m as unknown as { goOut: (k: string, s: number, x: number, z: number) => void }).goOut('penalty', side, m.attackDir(side) * (HALF_L - PEN_SPOT), 0);
  let pen = 0;
  const pads = (mm: Match): Pad => {
    const r = mm.restart;
    if (mm.phase === 'restart' && r?.kind === 'penalty' && r.side === side && side === hs) return penScriptPad(pen++, script);
    return f.pad();
  };
  return row(runToEnd(m, pads, humans));
}

export const PEN_SCENARIOS: Record<string, () => Row> = {
  // The human's own penalty, placed: right and up, then struck (the keeper's guess reads a reticle left by a post).
  penTaker0: () => penaltyRun(netConfig({ seed: 51, halfLength: 60, difficulty: 3, humanSide: 0 }), 0, { across: 1, up: true }, 51),
  penTaker1Low: () => penaltyRun(netConfig({ seed: 52, halfLength: 60, difficulty: 1.8, humanSide: 1 }), 1, { across: -1, up: false }, 52),
  // Nothing pressed: it goes on its own when his time is up.
  penTimeout1: () => penaltyRun(netConfig({ seed: 53, halfLength: 60, difficulty: 1.8, humanSide: 1 }), 1, null, 53),
  // The AI's penalty against the human's keeper.
  penKeeper1: () => penaltyRun(netConfig({ seed: 54, halfLength: 60, difficulty: 3, humanSide: 1 }), 0, null, 54),
};
