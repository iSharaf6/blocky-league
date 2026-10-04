import { describe, expect, it } from 'vitest';
import { recordShowtime, showtimeBest, showtimeMode } from '../src/core/save';
import {
  BOUNTIES, FunTracker, GRADE_BONUS, MAX_OFFERS, gradeBetter, gradeOf, type FunCue,
} from '../src/game/funLayer';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT } from '../src/sim/constants';
import { Match } from '../src/sim/match';
import type { Side } from '../src/sim/types';
import { HumanBot } from './humanBot';

const mk = (seed = 3, cfg: { hype?: boolean } = {}) =>
  new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 120, difficulty: 1.8, humanSide: 0, seed, ...cfg });

const tracker = (m: Match, bounties = true) => new FunTracker(m, { humanSide: 0, bounties, showtime: true, seed: 9 });

describe('the fun layer (game/funLayer.ts)', () => {
  it('bounties: one at a time, only offered in open play, at most MAX_OFFERS, and the bank is what was done', () => {
    const m = mk(21, { hype: true });
    const bot = new HumanBot(21, { casual: true });
    const fun = tracker(m);
    let live = 0;
    let offeredOutOfPlay = 0;
    for (let i = 0; m.phase !== 'fulltime' && i < 60 * 60 * 16; i++) {
      const before = m.ball.owner;
      m.step(DT, bot.pad(m));
      const evs = m.drainEvents();
      bot.observe(m, evs, before);
      fun.after(evs, DT);
      for (const c of fun.cues.splice(0)) {
        if (c.type !== 'bounty') continue;
        if (c.state === 'offer') {
          live++;
          // (A super shot's bounty comes with the meter filling, which is always open play too.)
          if (m.phase !== 'play') offeredOutOfPlay++;
          expect(live).toBe(1);
        } else if (c.state === 'done' || c.state === 'fail') live--;
      }
      if (m.phase === 'halftime') m.continueSecondHalf();
      if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
    }
    const sum = fun.summary();
    expect(sum.offered).toBeGreaterThan(0);
    expect(sum.offered).toBeLessThanOrEqual(MAX_OFFERS);
    expect(sum.done).toBeLessThanOrEqual(sum.offered);
    expect(offeredOutOfPlay).toBe(0);
    expect(sum.coins).toBe(sum.kinds.reduce((n, k) => n + BOUNTIES[k].coins, 0));
    expect(sum.xp).toBe(sum.kinds.reduce((n, k) => n + BOUNTIES[k].xp, 0));
  }, 90_000);

  it('a bounty is done by the thing it asks for, and pays into the bank', () => {
    const m = mk();
    const fun = tracker(m);
    fun.offer('skill');
    const me = m.players.find((p) => p.side === 0 && p.def.role === 'MF')!;
    const them = m.players.find((p) => p.side === 1)!;
    fun.event({ type: 'beat', by: me.idx, on: them.idx });
    expect(fun.bounty).toBeNull();
    expect(fun.bank.coins).toBe(BOUNTIES.skill.coins);
    expect(fun.cues.some((c) => c.type === 'bounty' && c.state === 'done')).toBe(true);
    // A goal against fails the one up.
    fun.offer('score');
    m.score[1] = 1;
    fun.event({ type: 'goal', side: 1, scorer: them.idx, own: false });
    expect(fun.bounty).toBeNull();
    expect(fun.bank.coins).toBe(BOUNTIES.skill.coins);
  });

  it('calls what made the goal: a brace, a hat trick, an equaliser', () => {
    const m = mk();
    const fun = tracker(m, false);
    const me = m.players.find((p) => p.side === 0 && p.def.role === 'FW')!;
    const them = m.players.find((p) => p.side === 1 && p.def.role === 'FW')!;
    const goal = (side: Side, scorer: number, score: [number, number]) => {
      m.score[0] = score[0];
      m.score[1] = score[1];
      fun.event({ type: 'goal', side, scorer, own: false });
      const c = fun.cues.filter((x): x is Extract<FunCue, { type: 'goalCall' }> => x.type === 'goalCall').pop()!;
      return c.tags.map((t) => t.text);
    };
    expect(goal(1, them.idx, [0, 1])).toEqual([]);
    expect(goal(0, me.idx, [1, 1])).toContain('EQUALISER');
    expect(goal(0, me.idx, [2, 1])).toContain('BRACE');
    expect(goal(0, me.idx, [3, 1])[0]).toBe('HAT TRICK');
    // Never more than three, the headline first; Silkscreen-safe words (no hyphens).
    for (const c of fun.cues) if (c.type === 'goalCall') {
      expect(c.tags.length).toBeLessThanOrEqual(3);
      for (const t of c.tags) expect(t.text).toMatch(/^[A-Z0-9 ]+$/);
    }
  });

  it('daily challenges move on live (a cue when one goes up), never twice for the same count', () => {
    const m = mk();
    const fun = tracker(m);
    const list = (have: number) => [{ text: 'Win 5 tackles', have, goal: 5, coins: 100, claimed: false }];
    fun.setDaily(list(2));
    fun.setDaily(list(2));
    expect(fun.cues.length).toBe(0);
    fun.setDaily(list(3));
    fun.setDaily(list(5));
    const d = fun.cues.filter((c) => c.type === 'daily') as Extract<FunCue, { type: 'daily' }>[];
    expect(d.map((c) => [c.have, c.done])).toEqual([[3, false], [5, true]]);
  });

  it('SHOWTIME grades: higher points, higher grade; a harder AI counts for more; S and A add coins', () => {
    const order = ['C', 'B', 'A', 'S'];
    let last = 0;
    for (let pts = 0; pts <= 4000; pts += 100) {
      const g = order.indexOf(gradeOf(pts, 120));
      expect(g).toBeGreaterThanOrEqual(last);
      last = g;
    }
    expect(gradeOf(4000, 120)).toBe('S');
    expect(gradeOf(0, 120)).toBe('C');
    expect(order.indexOf(gradeOf(2000, 120, 3))).toBeGreaterThanOrEqual(order.indexOf(gradeOf(2000, 120, 1.8)));
    // The same pace over longer halves grades the same.
    expect(gradeOf(2400, 120)).toBe(gradeOf(4800, 240));
    expect(GRADE_BONUS.S).toBe(0.1);
    expect(GRADE_BONUS.A).toBe(0.05);
    expect(GRADE_BONUS.B + GRADE_BONUS.C).toBe(0);
    expect(gradeBetter('A', 'B')).toBe(true);
    expect(gradeBetter('B', 'A')).toBe(false);
  });

  it('keeps the best grade per mode in the save', () => {
    const save: { showtime?: { [k: string]: { grade: 'S' | 'A' | 'B' | 'C'; score: number } } } = {};
    expect(showtimeMode('playnow', false)).toBe('quick');
    expect(showtimeMode('cup', false)).toBe('career');
    expect(showtimeMode(undefined, true)).toBe('blitz');
    expect(recordShowtime(save, 'quick', 'B', 1500).newBest).toBe(true);
    expect(recordShowtime(save, 'quick', 'C', 900).newBest).toBe(false);
    expect(showtimeBest(save, 'quick')).toEqual({ grade: 'B', score: 1500 });
    expect(recordShowtime(save, 'quick', 'B', 1600).newBest).toBe(true);
    expect(recordShowtime(save, 'quick', 'A', 2300)).toMatchObject({ newBest: true, before: { grade: 'B', score: 1600 } });
    expect(showtimeBest(save, 'career')).toBeNull();
    // A damaged entry reads as none.
    (save.showtime as Record<string, unknown>).run = { grade: 'Z', score: 'x' };
    expect(showtimeBest(save, 'run')).toBeNull();
  });

  it('bounty titles are short pixel-font captions (no hyphens, no dots)', () => {
    for (const b of Object.values(BOUNTIES)) {
      expect(b.title).toMatch(/^[A-Z0-9 +]+$/);
      expect(b.title.length).toBeLessThanOrEqual(15);
    }
  });
});
