import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { stateHash } from '../src/net/hash';
import { STYLES } from '../src/sim/ai';
import {
  COACH_ALLOUT_ONE, COACH_ALLOUT_TWO, COACH_CHASE_FROM, COACH_FLOW_SHOTS, COACH_HOLD_ONE, COACH_HOLD_TWO, coachStyle, planFor,
} from '../src/sim/coach';
import { DT, HALF_L, HALF_W } from '../src/sim/constants';
import { EMPTY_PAD, Match, type MatchConfig } from '../src/sim/match';
import type { MatchEvent } from '../src/sim/types';

/**
 * The AI coach (src/sim/coach.ts; the owner, 2026-10-04: "The computer opponent adapts mid-game. If the player is
 * winning 2-0, the AI switches formations and presses higher, forcing the user to constantly think and adjust"). It
 * changes tactics only (formation, mentality, the style its team brain reads), draws nothing from the match's random
 * generator, and says every change on the ticker.
 */

function match(over: Partial<MatchConfig> = {}): Match {
  return new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 120, difficulty: 1.8, humanSide: 0, seed: 5, coach: true, ...over });
}

type Tactics = Extract<MatchEvent, { type: 'tactics' }>;

function steps(m: Match, n: number, evs: MatchEvent[] = []): MatchEvent[] {
  for (let i = 0; i < n; i++) {
    m.step(DT, EMPTY_PAD);
    evs.push(...m.drainEvents());
    if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
  }
  return evs;
}

const tactics = (evs: MatchEvent[]) => evs.filter((e): e is Tactics => e.type === 'tactics');

/** The ball out for a throw (a dead ball the coach can change his plan at). */
function deadBall(m: Match): void {
  Object.assign(m, { phase: 'play', restart: null });
  (m as unknown as { goOut: (k: string, s: number, x: number, z: number) => void }).goOut('throwin', 0, 0, HALF_W);
}

describe('the AI coach: the plan for the scoreline', () => {
  it('chases two down at any time, one down late; all out at the death; holds a lead late; its own way otherwise', () => {
    expect(planFor(0, 0.1)).toBe('base');
    expect(planFor(0, 0.9)).toBe('base');
    // Two down: at once.
    expect(planFor(-2, 0.05)).toBe('chase');
    expect(planFor(-3, COACH_ALLOUT_TWO + 0.01)).toBe('allout');
    // One down: its own way until the last part of the match.
    expect(planFor(-1, COACH_CHASE_FROM - 0.05)).toBe('base');
    expect(planFor(-1, COACH_CHASE_FROM + 0.01)).toBe('chase');
    expect(planFor(-1, COACH_ALLOUT_ONE + 0.01)).toBe('allout');
    // A lead: held late (a two-goal one sooner).
    expect(planFor(1, COACH_HOLD_ONE - 0.05)).toBe('base');
    expect(planFor(1, COACH_HOLD_ONE + 0.01)).toBe('hold');
    expect(planFor(2, COACH_HOLD_TWO - 0.05)).toBe('base');
    expect(planFor(2, COACH_HOLD_TWO + 0.01)).toBe('hold');
    // The human being eased (dynamic difficulty) is never shut out.
    expect(planFor(1, 0.9, 0, 9, true)).toBe('base');
    // Level but pinned back (no shot of its own, the human four up on shots): it pushes up.
    expect(planFor(0, 0.5, -COACH_FLOW_SHOTS, 0)).toBe('chase');
    expect(planFor(0, 0.5, -COACH_FLOW_SHOTS, 3)).toBe('base');
    expect(planFor(0, 0.1, -COACH_FLOW_SHOTS, 0)).toBe('base');
  });

  it('a plan is tactics only: the line, the press, the runs; never a stat', () => {
    const base = STYLES.balanced;
    const chase = coachStyle(base, 'chase', null);
    expect(chase.line).toBeGreaterThan(base.line);
    expect(chase.pressHigh).toBeGreaterThan(base.pressHigh);
    expect(chase.trap).toBe(true);
    expect(chase.runs).toBeGreaterThan(base.runs);
    const hold = coachStyle(base, 'hold', null);
    expect(hold.line).toBeLessThan(base.line);
    expect(hold.lineMax).toBeLessThan(base.lineMax);
    expect(hold.pressFrom).toBeLessThan(base.pressFrom);
    expect(hold.hold).toBeGreaterThan(base.hold);
    expect(hold.counter).toBeGreaterThan(base.counter);
    // The cover: the block slides to the wing, the line drops, the midfield sits on the edge of the box.
    expect(coachStyle(base, 'base', 'wingR').flank).toBeGreaterThan(0);
    expect(coachStyle(base, 'base', 'wingL').flank).toBeLessThan(0);
    expect(coachStyle(base, 'base', 'behind').lineMax).toBeLessThan(base.lineMax);
    expect(coachStyle(base, 'base', 'range').midMax).toBeLessThan(base.midMax);
    // Its own way is the club's style untouched, and the table itself is never written to.
    expect(coachStyle(base, 'base', null)).toEqual(base);
    expect(STYLES.balanced.flank).toBeUndefined();
    expect(Object.keys(chase).sort()).toEqual([...Object.keys(base)].sort());
  });
});

describe('the AI coach: in a match', () => {
  it('two down, it changes shape, pushes up and presses high at the next dead ball, and says so', () => {
    const m = match();
    const evs = steps(m, 120);
    expect(m.coach[1]).not.toBeNull();
    expect(m.coach[0]).toBeNull();
    const shape0 = m.formation[1];
    const line0 = m.coach[1]!.style.line;
    m.score = [2, 0];
    deadBall(m);
    steps(m, 30, evs);
    const said = tactics(evs);
    expect(said.length).toBe(1);
    expect(said[0]).toMatchObject({ side: 1, plan: 'chase', shape: true, cover: null });
    expect(m.formation[1]).not.toBe(shape0);
    expect(said[0].formation).toBe(m.formation[1]);
    expect(m.mentality[1]).toBe(1);
    expect(m.mentality[0]).toBe(0);
    expect(m.coach[1]!.style.line).toBeGreaterThan(line0);
    expect(m.coach[1]!.style.trap).toBe(true);
    // Level again: back to its own shape and its own way.
    m.score = [2, 2];
    deadBall(m);
    steps(m, 30, evs);
    expect(m.formation[1]).toBe(shape0);
    expect(m.mentality[1]).toBe(0);
    expect(tactics(evs).length).toBe(2);
    expect(tactics(evs)[1]).toMatchObject({ plan: 'base', shape: true });
  });

  it('ahead late it drops deep and plays on the break; not against a human the game is easing', () => {
    const late = (over: Partial<MatchConfig>) => {
      const m = match(over);
      const evs = steps(m, 60);
      m.half = 2;
      m.clock = m.cfg.halfLength * 0.6;
      m.score = [0, 1];
      deadBall(m);
      steps(m, 30, evs);
      return { m, said: tactics(evs) };
    };
    const a = late({});
    expect(a.said.length).toBe(1);
    expect(a.said[0]).toMatchObject({ plan: 'hold' });
    expect(a.m.mentality[1]).toBe(-1);
    expect(a.m.coach[1]!.style.pressFrom).toBeLessThan(0.5);
    const eased = late({ assist: 0.6 });
    expect(eased.said.length).toBe(0);
    expect(eased.m.mentality[1]).toBe(0);
  });

  it('a change waits for a dead ball (a few seconds of open play at most), and is not said over a goal', () => {
    const m = match();
    const evs = steps(m, 120);
    // In open play, two down: nothing yet.
    Object.assign(m, { phase: 'play', restart: null });
    m.score = [2, 0];
    steps(m, 60, evs);
    const early = tactics(evs).length;
    // ... but never more than a few seconds later, or at the first dead ball.
    for (let i = 0; i < 60 * 12 && !tactics(evs).length; i++) steps(m, 1, evs);
    expect(early).toBe(0);
    expect(tactics(evs).length).toBe(1);
  });

  it("the human's goals keep coming the same way: it moves to cover that way", () => {
    const m = match();
    const evs = steps(m, 120);
    const c = m.coach[1]!;
    const ad = m.attackDir(0);
    // Two goals, each from a ball played in from the near (+z) wing in the last third.
    for (let g = 1; g <= 2; g++) {
      c.pass = { kind: 'pass', x: ad * (HALF_L - 12), z: HALF_W - 6, t: 0 };
      (c as { seenKick: number }).seenKick = m.kickId;
      c.pass.t = (m.half - 1) * m.cfg.halfLength + m.clock;
      Object.assign(m, { kickKind: 'shot', shotDist: 9 });
      m.goals.push({ side: 0, scorer: 9, name: 'x', minute: 5, own: false });
      m.score = [g, g];
      steps(m, 2, evs);
    }
    const cover = tactics(evs).filter((e) => e.cover !== null);
    expect(cover.length).toBe(1);
    expect(cover[0]).toMatchObject({ side: 1, cover: 'wingR' });
    expect(c.style.flank).toBeGreaterThan(0);
    expect(c.style.defWidth).toBeGreaterThan(STYLES[m.teams[1].style ?? 'balanced'].defWidth);
  });

  it('off by default, never for a side a human plays, never AI v AI, never in his first match', () => {
    const none = (over: Partial<MatchConfig>) => {
      const m = match(over);
      const evs = steps(m, 60);
      m.score = [3, 0];
      deadBall(m);
      steps(m, 60, evs);
      return { said: tactics(evs).length, coach: m.coach, ment: m.mentality };
    };
    expect(none({ coach: undefined })).toMatchObject({ said: 0, coach: [null, null], ment: [0, 0] });
    expect(none({ humanSide: -1 })).toMatchObject({ said: 0, coach: [null, null] });
    expect(none({ firstMatch: true })).toMatchObject({ said: 0 });
    expect(none({ humanSides: [true, true] })).toMatchObject({ said: 0, coach: [null, null] });
    // The human on the other side: the coach is side 0's.
    const m = match({ humanSide: 1 });
    const evs = steps(m, 60);
    m.score = [0, 2];
    deadBall(m);
    steps(m, 30, evs);
    expect(tactics(evs)[0]).toMatchObject({ side: 0, plan: 'chase' });
  });

  it('is deterministic: the same pads give the same match, coach and all', () => {
    const run = () => {
      const m = match({ halfLength: 30 });
      const trace: number[] = [];
      const said: string[] = [];
      for (let i = 0; i < 60 * 70 && m.phase !== 'fulltime'; i++) {
        if (i === 300) m.score = [2, 0];
        m.step(DT, EMPTY_PAD);
        for (const e of m.drainEvents()) if (e.type === 'tactics') said.push(`${i}:${e.plan}:${e.formation}`);
        if (m.phase === 'halftime') m.continueSecondHalf();
        if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
        if (i % 120 === 0) trace.push(stateHash(m));
      }
      return { trace, said };
    };
    const a = run();
    const b = run();
    expect(a.said.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  }, 120_000);
});
