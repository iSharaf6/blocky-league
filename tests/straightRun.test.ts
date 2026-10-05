import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT, HALF_W } from '../src/sim/constants';
import { LINE_FROM, LINE_FULL, straightRead } from '../src/sim/dribble';
import { EMPTY_PAD, Match, type Pad } from '../src/sim/match';
import type { Player } from '../src/sim/player';
import { startTell } from '../src/sim/skills';
import type { MatchEvent } from '../src/sim/types';
import { fmtStraight, straightSeries } from './humanBot';

/**
 * The straight run (the owner, 2026-10-04: "i been walking in a straight line t opposie goal and i always make it to
 * keeper and score"). A human who holds his stick at their goal and does nothing else is READ by the AI
 * (src/sim/dribble.ts straightRead): its challenge on him goes in for real, the block stops dropping off him and the
 * path assist stops steering him round the man in his way. A change of line, a SKILL move or a pass is all it takes to
 * be unread again.
 *
 * Measured with tests/humanBot.ts's straight bot (16 matches a level, 2 x 120 s), runs begun 30 m or more out with a
 * man in the way that ended in his shot: see the numbers beside the whole-match test below.
 */

function scenario(seed: number, difficulty = 1.8): Match {
  const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 150, difficulty, humanSide: 0, seed });
  m.phase = 'play';
  m.restart = null;
  m.phaseT = 0;
  m.drainEvents();
  m.players.forEach((p, i) => place(p, -40 + i * 3.6, -HALF_W + 1.5));
  return m;
}

function place(p: Player, x: number, z: number): void {
  p.pos.x = x;
  p.pos.z = z;
  p.vel.x = p.vel.z = 0;
  p.setState('move');
  p.order = null;
}

const pad = (mx: number, mz: number, extra: Partial<Pad> = {}): Pad => ({ ...EMPTY_PAD, mx, mz, autoSprint: true, ...extra });

function steps(m: Match, n: number, pd: Pad, evs: MatchEvent[] = []): MatchEvent[] {
  for (let i = 0; i < n; i++) {
    m.step(DT, pd);
    evs.push(...m.drainEvents());
  }
  return evs;
}

/** Our man running along +x with the ball from x0 for `frames` steps, the stick held dead ahead. */
function runUp(m: Match, x0: number, frames: number): Player {
  const p = m.players[9];
  place(p, x0, 0);
  p.facing = 0;
  m.ball.reset(p.footX(), p.footZ());
  m.ball.owner = p.idx;
  m.ball.lastTouch = p.idx;
  m.ball.lastTouchSide = p.side;
  m.active = p.idx;
  m.updateBallPath();
  steps(m, frames, pad(1, 0));
  p.ballT = 2;
  m.drainEvents();
  return p;
}

const TURN = (35 * Math.PI) / 180;

describe('the straight run: the read', () => {
  it('builds while the stick holds one line at a run, and a change of line starts it again', () => {
    const m = scenario(1);
    const p = runUp(m, -30, Math.round(LINE_FROM / DT) - 6);
    expect(straightRead(m, p)).toBe(0);
    steps(m, Math.round((LINE_FULL - LINE_FROM) / DT / 2) + 12, pad(1, 0));
    const half = straightRead(m, p);
    expect(half).toBeGreaterThan(0.3);
    expect(half).toBeLessThan(1);
    steps(m, Math.round(LINE_FULL / DT), pad(1, 0));
    expect(straightRead(m, p)).toBeCloseTo(1, 5);
    // A wobble inside the arc is still the same line...
    steps(m, 6, pad(Math.cos(0.15), Math.sin(0.15)));
    expect(straightRead(m, p)).toBeCloseTo(1, 5);
    // ... a turn is not: unread at once, and read again only after another LINE_FROM s of it.
    steps(m, 2, pad(Math.cos(TURN), Math.sin(TURN)));
    expect(straightRead(m, p)).toBe(0);
    steps(m, Math.round(LINE_FROM / DT) - 8, pad(Math.cos(TURN), Math.sin(TURN)));
    expect(straightRead(m, p)).toBe(0);
  });

  it('a SKILL move starts it again; so does losing the ball; an AI carrier is never read', () => {
    const m = scenario(2);
    const p = runUp(m, -30, Math.round((LINE_FULL + 0.3) / DT));
    expect(straightRead(m, p)).toBeCloseTo(1, 5);
    steps(m, 1, pad(1, 0, { skill: true }));
    expect(straightRead(m, p)).toBe(0);
    const m2 = scenario(3);
    const q = runUp(m2, -30, Math.round((LINE_FULL + 0.3) / DT));
    expect(straightRead(m2, q)).toBeCloseTo(1, 5);
    m2.ball.owner = -1;
    expect(straightRead(m2, q)).toBe(0);
    expect(straightRead(m2, m2.players[14])).toBe(0);
  });

  it('EASY reads less of it than NORMAL and HARD', () => {
    const read = (difficulty: number) => {
      const m = scenario(4, difficulty);
      return straightRead(m, runUp(m, -30, Math.round((LINE_FULL + 0.3) / DT)));
    };
    expect(read(0.6)).toBeCloseTo(0.6, 5);
    expect(read(0.6)).toBeLessThan(read(1.8));
    expect(read(1.8)).toBeCloseTo(1, 5);
    expect(read(3)).toBeCloseTo(1, 5);
  });
});

describe('the straight run: the challenge', () => {
  /**
   * A man of theirs squares up `ahead` m in front of our runner and winds up the duel's told challenge. The runner
   * either holds his line into it (`turn` false) or turns away as the tell goes up. Did the tackle win the ball?
   */
  const duel = (seed: number, turn: boolean, difficulty = 1.8): boolean => {
    const m = scenario(seed, difficulty);
    const p = runUp(m, -30, Math.round((LINE_FULL + 0.2) / DT));
    const o = m.players[14];
    place(o, p.pos.x + 3.4, p.pos.z + 0.15);
    o.facing = Math.PI;
    startTell(m, o, p, false, true);
    const a = turn ? TURN + 0.45 : 0;
    const evs = steps(m, 70, pad(Math.cos(a), Math.sin(a)));
    return evs.some((e) => e.type === 'tackle' && e.by === o.idx && e.won);
  };

  it('run straight on into a told challenge and it wins the ball; drifting off his line does not get him out of it', () => {
    const N = 60;
    let straight = 0;
    let turned = 0;
    for (let s = 0; s < N; s++) {
      if (duel(100 + s, false)) straight++;
      if (duel(100 + s, true)) turned++;
    }
    // eslint-disable-next-line no-console
    console.log(`NORMAL, a duel's told challenge on a read runner: won the ball ${straight}/${N} run straight into, ${turned}/${N} turned away from`);
    // (2026-10-05, the owner: "when the skill timing thing pops up, they don't tackle the player". A tell is a promise:
    // it was 40%+ run straight into and under 15% for a man who simply leant 60 degrees off his line, which made the
    // duel a bark. The read man loses it nearly every time; steering away without a cut or SKILL loses it most times.)
    expect(straight).toBeGreaterThan(N * 0.8);
    expect(turned).toBeGreaterThan(N * 0.5);
    expect(straight).toBeGreaterThanOrEqual(turned);
  }, 240_000);

  it('HARD wins it nearly every time; EASY stays lenient', () => {
    const N = 40;
    let hard = 0;
    let easy = 0;
    for (let s = 0; s < N; s++) {
      if (duel(300 + s, false, 3)) hard++;
      if (duel(300 + s, false, 0.6)) easy++;
    }
    // eslint-disable-next-line no-console
    console.log(`a duel's told challenge on a read runner: won the ball HARD ${hard}/${N}, EASY ${easy}/${N}`);
    // (EASY was under 40%: lenient, and close to nothing against a man who is not read. It is more forgiving than
    // HARD still, but a man running one straight line into a told challenge loses it more often than not.)
    expect(hard).toBeGreaterThan(N * 0.8);
    expect(easy).toBeGreaterThan(N * 0.45);
    expect(easy).toBeLessThan(N * 0.85);
    expect(easy).toBeLessThan(hard);
  }, 240_000);
});

describe('the straight run: whole matches', () => {
  it('holding the stick at their goal no longer walks through NORMAL', () => {
    // (A short series; the full measurement, 16 matches a level at 2 x 120 s, is in the round's report.)
    const s = straightSeries(4, 1.8, { halfLength: 60, coach: true });
    // eslint-disable-next-line no-console
    console.log(fmtStraight(s));
    expect(s.farRuns).toBeGreaterThan(2);
    expect(s.farShotPct).toBeLessThan(22);
    expect(s.gf).toBeLessThan(3);
  }, 600_000);
});
