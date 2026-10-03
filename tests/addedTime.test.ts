import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT, HALF_L, HALF_W, PEN_SPOT } from '../src/sim/constants';
import { EMPTY_PAD, Match } from '../src/sim/match';
import type { Player } from '../src/sim/player';
import type { MatchEvent, RestartKind, Side } from '../src/sim/types';

/**
 * Added time (sim/match.ts ADDED_FRAC, addedTimeUp). The owner: "if theres an attack perhaps let it happen and stop the
 * game, if theres time wasting then stop the game". When the clock runs out the referee waits for a natural stoppage:
 * the ball dead, a goal, a foul, the keeper holding it, or the attack breaking down; a side keeping it in its own half
 * gets the whistle at once; and there is a cap.
 */

const HL = 60;

function newMatch(seed = 3, half = 1): Match {
  const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: HL, difficulty: 2, humanSide: -1, seed });
  m.phase = 'play';
  m.restart = null;
  m.phaseT = 5;
  m.half = half;
  m.drainEvents();
  park(m);
  return m;
}

function place(p: Player, x: number, z: number): void {
  p.pos.x = x;
  p.pos.z = z;
  p.vel.x = p.vel.z = 0;
  p.setState('move');
  p.order = null;
}

/** Everyone along the far touchline, out of the way. */
function park(m: Match): void {
  m.players.forEach((p, i) => place(p, -40 + i * 3.6, -HALF_W + 1.5));
}

function giveBall(m: Match, p: Player): void {
  const b = m.ball;
  b.reset(p.footX(), p.footZ());
  b.owner = p.idx;
  b.lastTouch = p.idx;
  b.lastTouchSide = p.side;
  m.possessionSide = p.side;
  m.updateBallPath();
}

/** `side`'s no. 9 on the ball `x` m up the pitch in his attacking direction (negative: his own half), the rest parked. */
function carry(m: Match, side: Side, x: number): Player {
  park(m);
  const p = m.teamPlayers(side)[9];
  place(p, x * m.attackDir(side), 0);
  giveBall(m, p);
  return p;
}

const ended = (m: Match) => m.phase === 'halftime' || m.phase === 'fulltime' || m.phase === 'shootout';

/** Steps until the half ends (or `limit` steps): the events on the way and the steps taken. */
function toWhistle(m: Match, limit = 60 * 40, each?: () => void): { events: MatchEvent[]; steps: number } {
  const events: MatchEvent[] = [];
  let steps = 0;
  while (!ended(m) && steps < limit) {
    each?.();
    m.step(DT, EMPTY_PAD);
    events.push(...m.drainEvents());
    steps++;
    // (A goal: the session moves on after the celebration.)
    if (m.phase === 'goal' && m.phaseT > 1) {
      m.resumeAfterGoal();
      events.push(...m.drainEvents());
    }
  }
  return { events, steps };
}

const goOut = (m: Match, kind: RestartKind, side: Side, x: number, z: number) =>
  (m as unknown as { goOut(k: RestartKind, s: Side, x: number, z: number): void }).goOut(kind, side, x, z);

describe('added time: the whistle at a natural stoppage', () => {
  it('a side keeping the ball in its own half when the time runs out: the whistle goes at once', () => {
    const m = newMatch();
    carry(m, 0, -20);
    m.clock = HL - DT / 2;
    const { events, steps } = toWhistle(m);
    expect(m.phase).toBe('halftime');
    expect(steps).toBe(1);
    expect(events).toContainEqual({ type: 'whistle', kind: 'long' });
  });

  it('an attack on is let finish, and the whistle goes the moment the other side wins the ball', () => {
    const m = newMatch();
    carry(m, 0, 25);
    m.clock = HL - DT / 2;
    // A second of the attack (held where it is): play goes on into added time.
    for (let i = 0; i < 60; i++) {
      carry(m, 0, 25);
      m.step(DT, EMPTY_PAD);
    }
    expect(m.phase).toBe('play');
    expect(m.clock).toBeGreaterThan(HL + 0.9);
    // The defending side wins it: over.
    park(m);
    const d = m.teamPlayers(1)[4];
    place(d, 25 * m.attackDir(0), 0);
    giveBall(m, d);
    m.step(DT, EMPTY_PAD);
    expect(m.phase).toBe('halftime');
  });

  it('the attack going back into the attackers\' own half ends it too (and the keeper holding it does)', () => {
    const m = newMatch();
    carry(m, 1, 20);
    m.clock = HL - DT / 2;
    for (let i = 0; i < 30; i++) {
      carry(m, 1, 20);
      m.step(DT, EMPTY_PAD);
    }
    expect(m.phase).toBe('play');
    carry(m, 1, -6);
    m.step(DT, EMPTY_PAD);
    expect(m.phase).toBe('halftime');

    const k = newMatch(4);
    carry(k, 0, 30);
    k.clock = HL - DT / 2;
    k.step(DT, EMPTY_PAD);
    expect(k.phase).toBe('play');
    // Their keeper gathers it on his line.
    park(k);
    const gk = k.teamPlayers(1)[0];
    place(gk, HALF_L * k.attackDir(0) - k.attackDir(0) * 2, 0);
    giveBall(k, gk);
    k.ball.held = true;
    k.step(DT, EMPTY_PAD);
    expect(k.phase).toBe('halftime');
  });

  it(`never longer than the allowance: a side that keeps it in the other half is blown up at the cap`, () => {
    const m = newMatch();
    const cap = m.addedCap();
    expect(cap).toBeGreaterThanOrEqual(5);
    expect(cap).toBeLessThanOrEqual(12);
    carry(m, 0, 18);
    m.clock = HL - DT / 2;
    toWhistle(m, 60 * 30, () => carry(m, 0, 18));
    expect(m.phase).toBe('halftime');
    expect(m.clock - HL).toBeGreaterThan(cap - 0.05);
    expect(m.clock - HL).toBeLessThan(cap + 0.05);
  });

  it('the ball going out in added time ends the half: no short whistle, no set piece, just the long one', () => {
    const m = newMatch();
    carry(m, 0, 25);
    m.clock = HL + 1;
    m.step(DT, EMPTY_PAD);
    m.drainEvents();
    expect(m.phase).toBe('play');
    goOut(m, 'throwin', 1, 20, HALF_W);
    const { events, steps } = toWhistle(m);
    expect(m.phase).toBe('halftime');
    expect(steps).toBeLessThanOrEqual(Math.ceil(0.45 / DT));
    expect(events.filter((e) => e.type === 'restart')).toEqual([]);
    expect(events.filter((e) => e.type === 'whistle')).toEqual([{ type: 'whistle', kind: 'long' }]);
    expect(m.stats.corners).toEqual([0, 0]);
  });

  it('a corner given as the time runs out is taken; a goal kick or a throw-in is not', () => {
    const m = newMatch();
    m.clock = HL - 0.2;
    const gx = HALF_L * m.attackDir(0);
    goOut(m, 'corner', 0, gx - Math.sign(gx) * 0.35, HALF_W - 0.35);
    const { events } = toWhistle(m);
    expect(ended(m)).toBe(true);
    // The corner was set and struck before the whistle.
    expect(events.some((e) => e.type === 'setpiece' && e.kind === 'corner')).toBe(true);
    expect(events.some((e) => e.type === 'kick')).toBe(true);

    const g = newMatch();
    g.clock = HL - 0.2;
    goOut(g, 'goalkick', 1, gx - Math.sign(gx) * 5, 3);
    const r = toWhistle(g);
    expect(r.events.some((e) => e.type === 'setpiece' || e.type === 'kick')).toBe(false);
  });

  it('a penalty given in added time is always taken', () => {
    const m = newMatch(5);
    carry(m, 0, 40);
    m.step(DT, EMPTY_PAD);
    // Given a moment before the allowance's last word (which holds for nothing else): set, struck, and the shot
    // let finish (the ball is never frozen in flight).
    m.clock = HL + m.addedCap() + 4.9;
    goOut(m, 'penalty', 0, m.attackDir(0) * (HALF_L - PEN_SPOT), 0);
    let last = { phase: m.phase as string, shotClock: 0 };
    const { events } = toWhistle(m, 60 * 40, () => {
      last = { phase: m.phase, shotClock: m.shotClock };
    });
    expect(ended(m)).toBe(true);
    expect(events.some((e) => e.type === 'kick')).toBe(true);
    expect(m.stats.shots[0]).toBe(1);
    // The whistle didn't come with the shot still on its way.
    expect(last.phase !== 'play' || last.shotClock >= 1.4).toBe(true);
  });

  it('a goal in added time: the teams line up and the referee blows, no kick-off (full time in the second half)', () => {
    for (const half of [1, 2]) {
      const m = newMatch(6, half);
      m.clock = HL + 2;
      (m as unknown as { goal(s: Side): void }).goal(0);
      expect(m.phase).toBe('goal');
      m.drainEvents();
      m.resumeAfterGoal();
      m.step(DT, EMPTY_PAD);
      expect(m.phase).toBe(half === 1 ? 'halftime' : 'fulltime');
      expect(m.drainEvents().filter((e) => e.type === 'whistle')).toEqual([{ type: 'whistle', kind: half === 1 ? 'long' : 'end' }]);
    }
  });

  it('a level knockout tie still goes to its shootout from added time', () => {
    const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: HL, difficulty: 2, humanSide: -1, seed: 8, knockout: true });
    m.phase = 'play';
    m.restart = null;
    m.half = 2;
    park(m);
    carry(m, 0, -10);
    m.clock = HL - DT / 2;
    m.step(DT, EMPTY_PAD);
    expect(m.phase).toBe('shootout');
  });

  it('AI v AI: whole matches end, and the same seed ends every half on the same step', () => {
    const run = (seed: number) => {
      const m = new Match({ home: makeTeam(PRESET_CLUBS[2]), away: makeTeam(PRESET_CLUBS[9]), halfLength: 30, difficulty: 2, humanSide: -1, seed });
      const ends: number[] = [];
      let steps = 0;
      while (m.phase !== 'fulltime' && steps < 60 * 60 * 4) {
        m.step(DT, EMPTY_PAD);
        steps++;
        for (const e of m.drainEvents()) if (e.type === 'halftime' || e.type === 'fulltime') ends.push(steps, m.clock);
        if (m.phase === 'halftime') m.continueSecondHalf();
        if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
      }
      return { m, ends };
    };
    for (const seed of [12]) {
      const a = run(seed);
      const b = run(seed);
      expect(a.m.phase).toBe('fulltime');
      expect(a.ends).toEqual(b.ends);
      // Neither half ran past the allowance's last word.
      for (let i = 1; i < a.ends.length; i += 2) expect(a.ends[i]).toBeLessThan(30 + a.m.addedCap() + 5 + 0.1);
    }
  }, 120_000);
});
