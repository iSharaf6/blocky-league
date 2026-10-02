import { describe, expect, it } from 'vitest';
import { wrapAngle } from '../src/core/math';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT } from '../src/sim/constants';
import { EMPTY_PAD, Match } from '../src/sim/match';
import { HumanBot } from './humanBot';

/**
 * The owner's "it spazzes out while I play": players shook. A body flicked one way and back every step or two
 * wherever a rule faced the ball only inside some range (ai.moveIntent's 2.5 m) or move assist took the run
 * on one step and dropped it the next. A real turn sweeps one way; a shake reverses again and again. Count
 * reversals of a fast body turn (both steps over SHAKE_RATE rad/s, opposite signs).
 *
 * What is measured is the body as drawn (Player.drawnFacing: the sim's own facing, which every kick and stat
 * plays with, is untouched by the fix). Before the fix: ~9 a minute on the man the human controls (bot matches),
 * ~176 a minute over all 22 in AI v AI.
 */
const SHAKE_RATE = 10;

function newMatch(seed: number, human: boolean): Match {
  return new Match({
    home: makeTeam(PRESET_CLUBS[5]),
    away: makeTeam(PRESET_CLUBS[6]),
    halfLength: 120,
    difficulty: 1.8,
    humanSide: human ? 0 : -1,
    seed,
  });
}

function settle(m: Match): void {
  if (m.phase === 'halftime') m.continueSecondHalf();
  if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
}

/** Reversals a minute on the man the bot controls. */
function humanShakes(seed: number): { reversals: number; minutes: number } {
  const m = newMatch(seed, true);
  const bot = new HumanBot(seed);
  let reversals = 0;
  let last = -1;
  let f0 = 0;
  let w0 = 0;
  let played = 0;
  for (let steps = 0; m.phase !== 'fulltime' && steps < 60 * 60 * 10; steps++) {
    const pad = bot.pad(m);
    const before = m.ball.owner;
    m.step(DT, pad);
    bot.observe(m, m.drainEvents(), before);
    settle(m);
    const a = m.activeOf(0);
    if (m.phase !== 'play' || a < 0) {
      last = -1;
      continue;
    }
    played++;
    const p = m.players[a];
    if (a !== last) {
      last = a;
      f0 = p.drawnFacing();
      w0 = 0;
      continue;
    }
    const w = wrapAngle(p.drawnFacing() - f0) / DT;
    if (Math.abs(w) > SHAKE_RATE && Math.abs(w0) > SHAKE_RATE && Math.sign(w) !== Math.sign(w0)) reversals++;
    f0 = p.drawnFacing();
    w0 = w;
  }
  return { reversals, minutes: (played * DT) / 60 };
}

/** Reversals a minute over all 22 in AI v AI. */
function aiShakes(seed: number): { reversals: number; minutes: number } {
  const m = newMatch(seed, false);
  const f0 = m.players.map((p) => p.drawnFacing());
  const w0 = m.players.map(() => 0);
  let reversals = 0;
  let played = 0;
  for (let steps = 0; m.phase !== 'fulltime' && steps < 60 * 60 * 10; steps++) {
    m.step(DT, EMPTY_PAD);
    m.drainEvents();
    settle(m);
    if (m.phase !== 'play') {
      for (const p of m.players) {
        f0[p.idx] = p.drawnFacing();
        w0[p.idx] = 0;
      }
      continue;
    }
    played++;
    for (const p of m.players) {
      const w = wrapAngle(p.drawnFacing() - f0[p.idx]) / DT;
      if (Math.abs(w) > SHAKE_RATE && Math.abs(w0[p.idx]) > SHAKE_RATE && Math.sign(w) !== Math.sign(w0[p.idx])) reversals++;
      f0[p.idx] = p.drawnFacing();
      w0[p.idx] = w;
    }
  }
  return { reversals, minutes: (played * DT) / 60 };
}

describe('players do not shake', () => {
  it('the man the human controls: fast body-turn reversals stay rare in whole matches', () => {
    let reversals = 0;
    let minutes = 0;
    for (const seed of [11, 23, 37]) {
      const r = humanShakes(seed);
      reversals += r.reversals;
      minutes += r.minutes;
    }
    expect(reversals / minutes).toBeLessThan(5);
  }, 300_000);

  it('everyone in AI v AI: a few reversals a minute over the whole pitch, not one every second', () => {
    let reversals = 0;
    let minutes = 0;
    for (const seed of [3, 9]) {
      const r = aiShakes(seed);
      reversals += r.reversals;
      minutes += r.minutes;
    }
    expect(reversals / minutes).toBeLessThan(45);
  }, 300_000);
});
