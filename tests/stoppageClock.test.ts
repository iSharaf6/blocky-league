import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT, HALF_L, HALF_W, PEN_SPOT } from '../src/sim/constants';
import { EMPTY_PAD, HUMAN_RESTART_WINDOW, Match } from '../src/sim/match';
import type { Player } from '../src/sim/player';
import type { RestartKind, Side } from '../src/sim/types';

type Rules = {
  goOut(kind: RestartKind, side: Side, x: number, z: number, indirect?: boolean): void;
  foul(by: Player, on: Player): void;
  whistleBack(): void;
};
const rules = (m: Match) => m as unknown as Rules;

function match(extra: Partial<ConstructorParameters<typeof Match>[0]> = {}): Match {
  const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]),
    halfLength: 60, difficulty: 2, seed: 13, humanSide: 0, humanSides: [true, true], ...extra });
  m.phase = 'play';
  m.restart = null;
  m.clock = 12;
  m.drainEvents();
  m.players.forEach((p, i) => {
    p.pos.x = -40 + i * 3.6;
    p.pos.z = -HALF_W + 1.5;
    p.vel.x = p.vel.z = 0;
    p.setState('move');
    p.order = null;
  });
  return m;
}

const restarts: [string, RestartKind, number, number, boolean?][] = [
  ['throw-in', 'throwin', -10, HALF_W],
  ['corner', 'corner', HALF_L - 0.35, HALF_W - 0.35],
  ['goal kick', 'goalkick', -HALF_L + 6, 3],
  ['foul', 'freekick', -14, 3],
  ['offside', 'freekick', -14, 3, true],
  ['penalty', 'penalty', HALF_L - PEN_SPOT, 0],
];

describe('only live play uses match time', () => {
  it.each(restarts)('%s preparations and animations progress while both clocks pause', (_label, kind, x, z, indirect) => {
    const m = match();
    rules(m).goOut(kind, 0, x, z, indirect);
    const possession = [...m.stats.possession];
    for (let i = 0; i < 60 * 4; i++) {
      m.step(DT, [EMPTY_PAD, EMPTY_PAD]);
      expect(m.clock).toBe(12);
      expect(m.stats.possession).toEqual(possession);
    }
    expect(m.phase).toBe('restart');
    expect(m.restart?.kind).toBe(kind);
    expect(m.phaseT).toBeGreaterThan(2);
    expect(m.ball.owner).toBe(m.restart!.taker);
    expect(m.restart?.indirect ?? false).toBe(indirect ?? false);
  });

  it.each(restarts)('%s resumes time on the actual restart strike, not its preparation', (_label, kind, x, z, indirect) => {
    const m = match();
    rules(m).goOut(kind, 0, x, z, indirect);
    let kicked = false;
    for (let i = 0; i < 60 * (HUMAN_RESTART_WINDOW + 3); i++) {
      m.step(DT, [EMPTY_PAD, EMPTY_PAD]);
      const kick = m.drainEvents().some(e => e.type === 'kick');
      if (!kick) expect(m.clock).toBe(12);
      else {
        kicked = true;
        expect(m.phase).toBe('play');
        expect(m.clock).toBeCloseTo(12 + DT, 10);
        break;
      }
    }
    expect(kicked).toBe(true);
    m.step(DT, [EMPTY_PAD, EMPTY_PAD]);
    expect(m.clock).toBeCloseTo(12 + 2 * DT, 10);
  });

  it('the out-of-play whistle stops time immediately on the boundary frame', () => {
    const m = match();
    m.ball.reset(0, HALF_W - 0.02);
    m.ball.owner = -1;
    m.ball.lastTouchSide = 0;
    m.ball.vel.z = 12;
    m.updateBallPath();
    m.step(DT, [EMPTY_PAD, EMPTY_PAD]);
    expect(m.phase).toBe('out');
    expect(m.drainEvents()).toContainEqual({ type: 'restart', kind: 'throwin', side: 1 });
    expect(m.clock).toBe(12);
  });

  it('live advantage still ticks; the recalled foul then pauses it', () => {
    const m = match();
    const on = m.teamPlayers(0)[9];
    const by = m.teamPlayers(1)[5];
    on.pos.x = 15;
    on.pos.z = 0;
    m.ball.reset(on.footX(), on.footZ());
    m.ball.owner = on.idx;
    m.ball.lastTouch = on.idx;
    m.ball.lastTouchSide = 0;
    m.possessionSide = 0;
    m.ctl[0].active = on.idx;
    m.updateBallPath();
    rules(m).foul(by, on);
    expect(m.phase).toBe('play');
    for (let i = 0; i < 10; i++) m.step(DT, [EMPTY_PAD, EMPTY_PAD]);
    expect(m.clock).toBeCloseTo(12 + 10 * DT, 10);
    expect(m.stats.possession[0]).toBeCloseTo(10 * DT, 10);
    rules(m).whistleBack();
    expect(m.phase).toBe('out');
    const atWhistle = m.clock;
    for (let i = 0; i < 30; i++) m.step(DT, [EMPTY_PAD, EMPTY_PAD]);
    expect(m.clock).toBe(atWhistle);
  });

  it('kick-off waits freeze match time, then the kicked ball starts it', () => {
    const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]),
      halfLength: 60, difficulty: 2, seed: 13, humanSide: -1 });
    let kicked = false;
    for (let i = 0; i < 120; i++) {
      m.step(DT, EMPTY_PAD);
      if (m.drainEvents().some(e => e.type === 'kick')) {
        kicked = true;
        expect(m.clock).toBe(DT);
        break;
      }
      expect(m.clock).toBe(0);
    }
    expect(kicked).toBe(true);
  });

  it('a first-match AI penalty can finish its preparation on a paused clock', () => {
    const m = match({ humanSides: [true, false], firstMatch: true });
    m.clock = 5;
    rules(m).goOut('penalty', 1, m.attackDir(1) * (HALF_L - PEN_SPOT), 0);
    let kicked = false;
    for (let i = 0; i < 60 * 9; i++) {
      m.step(DT, EMPTY_PAD);
      if (m.drainEvents().some(e => e.type === 'kick' && e.kind === 'shot')) {
        kicked = true;
        expect(m.clock).toBeCloseTo(5 + DT, 10);
        expect(m.stats.shots[1]).toBe(1);
        break;
      }
      expect(m.clock).toBe(5);
    }
    expect(kicked).toBe(true);
  });
});
