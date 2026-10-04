import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT, HALF_L, HALF_W, PEN_SPOT } from '../src/sim/constants';
import { EMPTY_PAD, Match } from '../src/sim/match';
import type { Player } from '../src/sim/player';
import type { MatchEvent, RestartKind, Side } from '../src/sim/types';

/**
 * Added time by the Laws of the Game (sim/match.ts STOP_BASE_S, addedTimeUp). The owner: "look at the rules of the game
 * and perfect when to call half time or full time". The time lost is earned through the half and shown on the fourth
 * official's board at 45:00 / 90:00; that minimum is always played; then the referee ends it at the right moment
 * (never on a shot or a ball in the air in the box, a penalty always taken, a set piece given in time taken, an attack
 * on let finish but only so long), and the same rules hold for both sides.
 */

const HL = 60;
/** Real seconds per minute of the board at HL (the half is 45 minutes). */
const MIN_S = HL / 45;
/** ADDED_CEIL_S and ADDED_GRACE_S in sim/match.ts: how long a chance on at the end may run before the last word. */
const CEIL_S = 5;
const GRACE_S = 2;

function newMatch(seed = 3, half = 1, extra: Partial<ConstructorParameters<typeof Match>[0]> = {}): Match {
  const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: HL, difficulty: 2, humanSide: -1, seed, ...extra });
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
    if (m.phase === 'goal' && m.phaseT > 1) m.resumeAfterGoal();
  }
  return { events, steps };
}

/** Step until the clock reaches `t` (the half's own clock), holding the scene with `each` every step. */
function stepTo(m: Match, t: number, each?: () => void): MatchEvent[] {
  const events: MatchEvent[] = [];
  while (m.clock < t && !ended(m)) {
    each?.();
    m.step(DT, EMPTY_PAD);
    events.push(...m.drainEvents());
  }
  return events;
}

type Private = {
  goOut(k: RestartKind, s: Side, x: number, z: number): void;
  goal(s: Side): void;
  loseTime(gameS: number): void;
};
const priv = (m: Match) => m as unknown as Private;
/** A bench outfielder of `side`'s. */
const outfield = (m: Match, side: Side) => m.bench[side].findIndex((d) => d.role !== 'GK');

describe('added time is earned and announced (Law 7.3)', () => {
  it('at 45:00 the board goes up: a quiet half gets the least, one minute', () => {
    const m = newMatch();
    carry(m, 0, -20);
    m.clock = HL - DT / 2;
    m.step(DT, EMPTY_PAD);
    expect(m.drainEvents()).toContainEqual({ type: 'addedTime', minutes: 1 });
    expect(m.addedBoard).toBe(1);
    expect(m.phase).toBe('play');
  });

  it('the time lost is added up: goals, substitutions, cards, a penalty, slow restarts', () => {
    const m = newMatch();
    // Two changes (25 s each), and time lost that the half's events told of (a goal 45, a card 20, a penalty 30, slow
    // restarts): 30 base + 50 + 175 = 255 s, the board says 4.
    expect(m.substitute(0, 3, outfield(m, 0))).toBe(true);
    expect(m.substitute(1, 4, outfield(m, 1))).toBe(true);
    priv(m).loseTime(45 + 20 + 30 + 80);
    carry(m, 0, -20);
    m.clock = HL - DT / 2;
    m.step(DT, EMPTY_PAD);
    expect(m.addedBoard).toBe(4);
  });

  it('a restart dawdled over is time-wasting, and it goes on the board', () => {
    const m = newMatch(3, 1, { humanSide: 0 });
    m.clock = HL - 15;
    // His own throw-in, held as long as he's let (HUMAN_RESTART_WINDOW): the time past a normal restart is put back.
    priv(m).goOut('throwin', 0, -10, HALF_W);
    stepTo(m, HL - 1);
    carry(m, 0, -20);
    m.clock = HL - DT / 2;
    m.step(DT, EMPTY_PAD);
    expect(m.addedBoard).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it('the board is a minimum: a side keeping it in its own half still plays it all, then the whistle at once', () => {
    const m = newMatch();
    carry(m, 0, -20);
    m.clock = HL - DT / 2;
    stepTo(m, HL + MIN_S - 0.05, () => carry(m, 0, -20));
    expect(m.phase).toBe('play');
    const { events, steps } = toWhistle(m, 60 * 5, () => carry(m, 0, -20));
    expect(m.phase).toBe('halftime');
    expect(steps).toBeLessThanOrEqual(5);
    expect(m.addedEnd).toBe('neutral');
    expect(events).toContainEqual({ type: 'whistle', kind: 'long' });
  });

  it('time lost inside the added time goes back on: a substitution in it is played on top', () => {
    const m = newMatch();
    carry(m, 0, -20);
    m.clock = HL - DT / 2;
    m.step(DT, EMPTY_PAD);
    expect(m.addedBoard).toBe(1);
    expect(m.substitute(1, 4, outfield(m, 1))).toBe(true);
    // 25 s of the match back on top of the board's minute.
    stepTo(m, HL + MIN_S + (25 * HL) / 2700 - 0.05, () => carry(m, 0, -20));
    expect(m.phase).toBe('play');
    toWhistle(m, 60 * 5, () => carry(m, 0, -20));
    expect(m.phase).toBe('halftime');
  });
});

describe('the right moment to end it', () => {
  /** A match with its board up (one minute) and the clock just short of its end. */
  function atEnd(seed = 3, half = 1): Match {
    const m = newMatch(seed, half);
    carry(m, 0, -20);
    m.clock = HL - DT / 2;
    m.step(DT, EMPTY_PAD);
    m.drainEvents();
    m.clock = HL + MIN_S - DT / 2;
    return m;
  }

  it('an attack on in the final third is let finish, and ends the moment the other side wins the ball', () => {
    const m = atEnd();
    for (let i = 0; i < 60; i++) {
      carry(m, 0, 30);
      m.step(DT, EMPTY_PAD);
    }
    expect(m.phase).toBe('play');
    park(m);
    const d = m.teamPlayers(1)[4];
    place(d, 30 * m.attackDir(0), 0);
    giveBall(m, d);
    m.step(DT, EMPTY_PAD);
    expect(m.phase).toBe('halftime');
    expect(m.addedEnd).toBe('attackOver');
    expect(m.addedEndSide).toBe(0);
  });

  it('the same for the other side, and the keeper gathering it or the ball going back ends it too', () => {
    const k = atEnd(4);
    carry(k, 1, 30);
    k.step(DT, EMPTY_PAD);
    expect(k.phase).toBe('play');
    park(k);
    const gk = k.teamPlayers(0)[0];
    place(gk, HALF_L * k.attackDir(1) - k.attackDir(1) * 2, 0);
    giveBall(k, gk);
    k.ball.held = true;
    k.step(DT, EMPTY_PAD);
    expect(k.phase).toBe('halftime');

    const m = atEnd(5);
    for (let i = 0; i < 20; i++) {
      carry(m, 1, 30);
      m.step(DT, EMPTY_PAD);
    }
    expect(m.phase).toBe('play');
    carry(m, 1, 12);
    m.step(DT, EMPTY_PAD);
    expect(m.phase).toBe('halftime');
    expect(m.addedEnd).toBe('attackOver');
  });

  it('a break (the other half, running at goal) counts as an attack; a ball in midfield does not', () => {
    const m = atEnd();
    const p = carry(m, 0, 6);
    p.vel.x = 6 * m.attackDir(0);
    m.step(DT, EMPTY_PAD);
    expect(m.phase).toBe('play');

    const n = atEnd(6);
    carry(n, 0, 6);
    n.step(DT, EMPTY_PAD);
    expect(n.phase).toBe('halftime');
    expect(n.addedEnd).toBe('neutral');
  });

  it(`never drags: a chance kept on in shooting range ends ${CEIL_S + GRACE_S} s after the time was up`, () => {
    const m = atEnd();
    const start = HL + MIN_S;
    toWhistle(m, 60 * 30, () => carry(m, 0, 32));
    expect(m.phase).toBe('halftime');
    expect(m.addedEnd).toBe('ceiling');
    expect(m.clock - start).toBeGreaterThan(CEIL_S + GRACE_S - 0.1);
    expect(m.clock - start).toBeLessThan(CEIL_S + GRACE_S + 0.1);
  });

  it('a move that stalls outside shooting range is over: the whistle at that calm moment, never at the ceiling', () => {
    const m = atEnd();
    for (let i = 0; i < 30; i++) {
      carry(m, 0, 30);
      m.step(DT, EMPTY_PAD);
    }
    expect(m.phase).toBe('play');
    // Turned back to 26 m out (outside the range, not running at goal): no chance on any more.
    carry(m, 0, 18);
    m.step(DT, EMPTY_PAD);
    expect(m.phase).toBe('halftime');
    expect(m.addedEnd).toBe('attackOver');
  });

  it('never on a shot in flight or a ball in the air in the box: the phase lands first', () => {
    const m = atEnd();
    // A ball up in the box, last played by the attackers, dropping.
    park(m);
    const gx = HALF_L * m.attackDir(0) - m.attackDir(0) * 8;
    m.ball.reset(gx, 2);
    m.ball.pos.y = 4;
    m.ball.vel.y = 2;
    m.ball.lastTouchSide = 0;
    m.ball.owner = -1;
    m.step(DT, EMPTY_PAD);
    expect(m.phase).toBe('play');
    toWhistle(m, 60 * 10);
    expect(ended(m)).toBe(true);
    // The whistle came only once the ball was down (or in the keeper's hands), a good while after the time was up.
    expect(m.ball.held || m.ball.pos.y <= 1).toBe(true);
    expect(m.clock - (HL + MIN_S)).toBeGreaterThan(0.5);
  });

  it('the ball going dead after the time is up ends it: no short whistle, no set piece, just the long one', () => {
    const m = atEnd();
    carry(m, 0, 25);
    m.step(DT, EMPTY_PAD);
    m.drainEvents();
    expect(m.phase).toBe('play');
    priv(m).goOut('throwin', 1, 20, HALF_W);
    const { events, steps } = toWhistle(m);
    expect(m.phase).toBe('halftime');
    expect(m.addedEnd).toBe('dead');
    expect(steps).toBeLessThanOrEqual(Math.ceil(0.45 / DT));
    expect(events.filter((e) => e.type === 'restart')).toEqual([]);
    expect(events.filter((e) => e.type === 'whistle')).toEqual([{ type: 'whistle', kind: 'long' }]);
  });

  it('a corner given before the time ran out is taken and played out; one given after it is not', () => {
    const m = atEnd();
    m.clock = HL + MIN_S - 0.2;
    const gx = HALF_L * m.attackDir(0);
    priv(m).goOut('corner', 0, gx - Math.sign(gx) * 0.35, HALF_W - 0.35);
    const { events } = toWhistle(m);
    expect(ended(m)).toBe(true);
    expect(events.some((e) => e.type === 'setpiece' && e.kind === 'corner')).toBe(true);
    expect(events.some((e) => e.type === 'kick')).toBe(true);

    const g = atEnd(7);
    g.clock = HL + MIN_S + 0.2;
    g.step(DT, EMPTY_PAD);
    if (!ended(g)) {
      priv(g).goOut('corner', 0, gx - Math.sign(gx) * 0.35, HALF_W - 0.35);
      const r = toWhistle(g);
      expect(r.events.some((e) => e.type === 'setpiece' || e.type === 'kick')).toBe(false);
    }
    expect(g.addedEnd === 'dead' || g.addedEnd === 'neutral').toBe(true);
  });

  it('a penalty is always taken (Law 14), even given at the last, and its shot lands', () => {
    const m = atEnd(5);
    carry(m, 0, 40);
    m.clock = HL + MIN_S + CEIL_S - 0.1;
    m.step(DT, EMPTY_PAD);
    priv(m).goOut('penalty', 0, m.attackDir(0) * (HALF_L - PEN_SPOT), 0);
    let last = { phase: m.phase as string, shotClock: 0 };
    const { events } = toWhistle(m, 60 * 40, () => {
      last = { phase: m.phase, shotClock: m.shotClock };
    });
    expect(ended(m)).toBe(true);
    expect(events.some((e) => e.type === 'kick')).toBe(true);
    expect(m.stats.shots[0]).toBe(1);
    expect(last.phase !== 'play' || last.shotClock >= 1.4).toBe(true);
  });

  it('a goal inside the board\'s time: kick-off and play on; a goal after it: line up and the whistle', () => {
    const early = atEnd(6);
    early.clock = HL + 0.2;
    priv(early).goal(0);
    early.resumeAfterGoal();
    early.step(DT, EMPTY_PAD);
    expect(early.phase).toBe('kickoff');

    for (const half of [1, 2]) {
      const m = atEnd(6, half);
      m.clock = HL + MIN_S + 1;
      priv(m).goal(0);
      m.drainEvents();
      m.resumeAfterGoal();
      m.step(DT, EMPTY_PAD);
      expect(m.phase).toBe(half === 1 ? 'halftime' : 'fulltime');
      expect(m.addedEnd).toBe('goal');
      expect(m.drainEvents().filter((e) => e.type === 'whistle')).toEqual([{ type: 'whistle', kind: half === 1 ? 'long' : 'end' }]);
    }
  });

  it('a level knockout tie still goes to its shootout', () => {
    const m = newMatch(8, 2, { knockout: true });
    carry(m, 0, -10);
    m.clock = HL - DT / 2;
    toWhistle(m, 60 * 10, () => carry(m, 0, -10));
    expect(m.phase).toBe('shootout');
  });

  it('after the whistle everyone eases to a stop and the ball rolls dead: never a frozen picture', () => {
    const m = atEnd();
    const p = carry(m, 0, -20);
    p.vel.x = 5;
    const b = m.ball;
    toWhistle(m, 60 * 5, () => {
      carry(m, 0, -20).vel.x = 5;
    });
    expect(m.phase).toBe('halftime');
    b.vel.x = 6;
    const x0 = b.pos.x;
    const px0 = p.pos.x;
    for (let i = 0; i < 90; i++) m.step(DT, EMPTY_PAD);
    // He ran on a little, slowing; the ball rolled and slowed.
    expect(p.pos.x).not.toBe(px0);
    expect(Math.hypot(p.vel.x, p.vel.z)).toBeLessThan(1.5);
    expect(b.pos.x).toBeGreaterThan(x0 + 0.5);
    expect(Math.abs(b.vel.x)).toBeLessThan(2);
    // ...and then the picture rests.
    for (let i = 0; i < 60; i++) m.step(DT, EMPTY_PAD);
    const rest = b.pos.x;
    m.step(DT, EMPTY_PAD);
    expect(b.pos.x).toBe(rest);
  });
});

describe('whole matches', () => {
  it('AI v AI: every half has its board, ends, and the same seed ends every half on the same step', () => {
    const run = (seed: number) => {
      const m = new Match({ home: makeTeam(PRESET_CLUBS[2]), away: makeTeam(PRESET_CLUBS[9]), halfLength: 30, difficulty: 2, humanSide: -1, seed });
      const log: number[] = [];
      let steps = 0;
      while (m.phase !== 'fulltime' && steps < 60 * 60 * 4) {
        m.step(DT, EMPTY_PAD);
        steps++;
        for (const e of m.drainEvents()) {
          if (e.type === 'addedTime') log.push(steps, e.minutes);
          if (e.type === 'halftime' || e.type === 'fulltime') log.push(steps, m.clock);
        }
        if (m.phase === 'halftime') m.continueSecondHalf();
        if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
      }
      return { m, log };
    };
    const a = run(12);
    const b = run(12);
    expect(a.m.phase).toBe('fulltime');
    expect(a.log).toEqual(b.log);
    // Two boards, two whistles.
    expect(a.log.length).toBe(8);
  }, 120_000);
});
