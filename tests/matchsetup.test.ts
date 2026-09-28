import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DDA_FINISH, DDA_TACKLE, DT, HALF_L, HALF_W, KEEPER_BOOST } from '../src/sim/constants';
import { EMPTY_PAD, Match, type MatchConfig } from '../src/sim/match';
import type { Player } from '../src/sim/player';
import { playBotMatch, type BotMatch } from './humanBot';

/**
 * Round 13: what a match can be set up with. Dynamic difficulty (MatchConfig.assist, the owner: "If a player loses 3
 * matches in a row in Career mode, consider subtly lowering the AI aggression") and the Club Run perks (startScore,
 * keeperBoost, goldenFirst, startPower).
 */

function place(p: Player, x: number, z: number): void {
  p.pos.x = x;
  p.pos.z = z;
  p.vel.x = p.vel.z = 0;
  p.setState('move');
  p.order = null;
}

function match(extra: Partial<MatchConfig> = {}, seed = 1): Match {
  return new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 120, difficulty: 1.8, humanSide: 0, seed, ...extra });
}

/** Open play with everyone parked along the far touchline out of the way. */
function openPlay(m: Match): void {
  m.phase = 'play';
  m.restart = null;
  m.phaseT = 0;
  m.clock = 20;
  m.drainEvents();
  m.players.forEach((q, i) => place(q, -40 + i * 3.6, -HALF_W + 1.5));
}

describe('dynamic difficulty (MatchConfig.assist)', () => {
  it('eases only the AI side playing the human, clamped to 0..1', () => {
    expect(match({ assist: 0.5 }).assistEase(1)).toBe(0.5);
    expect(match({ assist: 0.5 }).assistEase(0)).toBe(0);
    expect(match({ assist: 0.5, humanSide: -1 }).assistEase(1)).toBe(0);
    expect(match({ assist: 3 }).assistEase(1)).toBe(1);
    expect(match({ assist: Number.NaN }).assistEase(1)).toBe(0);
    expect(match().assistEase(1)).toBe(0);
  });

  it('the AI\'s standing tackles on the human\'s carrier are that much less sure', () => {
    const rate = (assist: number) => {
      let won = 0;
      const n = 400;
      const m = match({ assist }, 7);
      openPlay(m);
      const ad = m.attackDir(0);
      const c = m.players[7];
      const t = m.players[17];
      for (let i = 0; i < n; i++) {
        place(c, 0, 0);
        c.facing = ad > 0 ? 0 : Math.PI;
        place(t, ad * 1.2, 0.2);
        t.facing = ad > 0 ? Math.PI : 0;
        t.tackleCooldown = 0;
        c.protectT = 0;
        c.shieldT = 0;
        c.ballT = 2;
        m.ball.reset(c.footX(), c.footZ());
        m.ball.owner = c.idx;
        m.active = c.idx;
        m.tryTackle(t, c, 0.8);
        if (m.ball.owner !== c.idx) won++;
        m.drainEvents();
      }
      return won / n;
    };
    const r0 = rate(0);
    const r1 = rate(0.5);
    // eslint-disable-next-line no-console
    console.log(`AI tackles won on the human's carrier: assist 0 ${(r0 * 100).toFixed(1)}%, 0.5 ${(r1 * 100).toFixed(1)}% (x${(1 - DDA_TACKLE * 0.5).toFixed(3)} expected)`);
    expect(r0).toBeGreaterThan(0.1);
    expect(r1).toBeLessThan(r0 * (1 - DDA_TACKLE * 0.5) + 0.06);
    expect(r1).toBeLessThan(r0);
  });

  it('the AI\'s finishing at the human\'s goal is that much wilder', () => {
    const spread = (assist: number) => {
      const zs: number[] = [];
      for (let seed = 1; seed <= 60; seed++) {
        const m = match({ assist }, seed * 11);
        openPlay(m);
        const ad = m.attackDir(1);
        const gx = ad * HALF_L;
        const p = m.players[20];
        place(p, gx - ad * 16, 0);
        p.facing = ad > 0 ? 0 : Math.PI;
        m.ball.reset(p.pos.x + ad * 0.5, 0);
        m.ball.owner = p.idx;
        m.ball.lastTouch = p.idx;
        m.ball.lastTouchSide = 1;
        m.updateBallPath();
        const kid = m.kickId;
        const o = m.order(p, 'shot', ad, 0, 0.8, -1, false)!;
        o.aimZ = 0;
        for (let i = 0; i < 40 && m.kickId === kid; i++) m.step(DT, EMPTY_PAD);
        const b = m.ball;
        // Where its line meets the goal line.
        const t = (gx - b.pos.x) / b.vel.x;
        zs.push(b.pos.z + b.vel.z * t);
      }
      const mean = zs.reduce((a, z) => a + z, 0) / zs.length;
      return Math.sqrt(zs.reduce((a, z) => a + (z - mean) ** 2, 0) / zs.length);
    };
    const s0 = spread(0);
    const s1 = spread(1);
    // eslint-disable-next-line no-console
    console.log(`AI strike's spread on the goal line (aimed at the middle, 16 m): assist 0 ${s0.toFixed(2)} m, 1 ${s1.toFixed(2)} m (x${(1 + DDA_FINISH).toFixed(2)})`);
    expect(s1).toBeGreaterThan(s0 * 1.3);
  });

  it('over whole matches against the scripted human, 0.5 is a notch easier: fewer balls lost to tackles, no more goals against', () => {
    const run = (assist: number): BotMatch[] => Array.from({ length: 10 }, (_, i) => {
      const k = 2 + (Math.floor(i / 2) % 8);
      const [home, away] = i % 2 === 0 ? [k, k + 1] : [k + 1, k];
      return playBotMatch({ seed: 2000 + i * 97, difficulty: 1.8, home, away, assist });
    });
    const a0 = run(0);
    const a1 = run(0.5);
    const sum = (l: BotMatch[], f: (r: BotMatch) => number) => l.reduce((a, r) => a + f(r), 0);
    const lost0 = sum(a0, (r) => r.tally.dispossessed);
    const lost1 = sum(a1, (r) => r.tally.dispossessed);
    const ga0 = sum(a0, (r) => r.ga);
    const ga1 = sum(a1, (r) => r.ga);
    const gf0 = sum(a0, (r) => r.gf);
    const gf1 = sum(a1, (r) => r.gf);
    // eslint-disable-next-line no-console
    console.log(`bot at NORMAL over 10: assist 0 lost ${lost0} to tackles, goals ${gf0}-${ga0} | assist 0.5 lost ${lost1}, goals ${gf1}-${ga1}`);
    expect(lost1).toBeLessThan(lost0);
    expect(ga1).toBeLessThanOrEqual(ga0);
  }, 240_000);
});

describe('Club Run perks', () => {
  it('startScore: the match starts at that score (and a goal adds to it)', () => {
    const m = match({ startScore: [1, 0], humanSide: -1 });
    expect(m.score).toEqual([1, 0]);
    expect(m.goals).toEqual([]);
    expect(match({ startScore: [-2, 1.4], humanSide: -1 }).score).toEqual([0, 1]);
    expect(match({ humanSide: -1 }).score).toEqual([0, 0]);
  });

  /** Roll the ball over `side`'s attacking goal line (a goal for `side`) and let the match see it. */
  function score(m: Match, side: 0 | 1): void {
    if (m.phase === 'goal') m.resumeAfterGoal();
    m.phase = 'play';
    m.restart = null;
    const ad = m.attackDir(side);
    const p = m.teamPlayers(side)[9];
    const b = m.ball;
    b.reset(ad * (HALF_L + 0.1), 0);
    b.vel.x = ad * 6;
    b.lastTouch = p.idx;
    b.lastTouchSide = side;
    for (let i = 0; i < 3 && m.phase === 'play'; i++) m.step(DT, EMPTY_PAD);
    expect(m.phase).toBe('goal');
  }

  it('goldenFirst: that side\'s first goal counts double, the rest single, the other side\'s as usual', () => {
    const m = match({ goldenFirst: 0, humanSide: -1 });
    expect(m.goldenFirstPending).toBe(0);
    score(m, 1);
    expect(m.score).toEqual([0, 1]);
    score(m, 0);
    expect(m.score).toEqual([2, 1]);
    expect(m.goldenFirstPending).toBe(-1);
    score(m, 0);
    expect(m.score).toEqual([3, 1]);
    // One 'goal' each, as ever.
    expect(m.goals.length).toBe(3);
  });

  it('keeperBoost: that keeper is sharper (reach and reactions) and saves more', () => {
    const m0 = match({ humanSide: -1, difficulty: 2 });
    const m1 = match({ humanSide: -1, difficulty: 2, keeperBoost: [0, 1] });
    expect(m1.keeperBonus(1) - m0.keeperBonus(1)).toBeCloseTo(KEEPER_BOOST, 6);
    expect(m1.keeperBonus(0)).toBeCloseTo(m0.keeperBonus(0), 6);
    const conceded = (boost: number) => {
      let goals = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const m = match({ humanSide: -1, difficulty: 2, keeperBoost: [0, boost] }, seed * 13);
        openPlay(m);
        const ad = m.attackDir(0);
        const gx = ad * HALF_L;
        const p = m.players[9];
        place(p, gx - ad * (12 + (seed % 5)), ((seed % 7) - 3) * 1.5);
        p.facing = ad > 0 ? 0 : Math.PI;
        const k = m.keeperOf(1)!;
        place(k, gx - ad * 1.5, 0);
        k.facing = ad > 0 ? Math.PI : 0;
        m.ball.reset(p.pos.x + ad * 0.5, p.pos.z);
        m.ball.owner = p.idx;
        m.ball.lastTouch = p.idx;
        m.ball.lastTouchSide = 0;
        m.updateBallPath();
        m.order(p, 'shot', ad, 0, 0.85, -1, false);
        for (let i = 0; i < 60 * 4 && m.phase === 'play'; i++) {
          m.step(DT, EMPTY_PAD);
          if (m.drainEvents().some((e) => e.type === 'goal')) goals++;
        }
      }
      return goals;
    };
    const g0 = conceded(0);
    const g1 = conceded(1);
    // eslint-disable-next-line no-console
    console.log(`60 shots from 12-16 m: ${g0} goals against the usual keeper, ${g1} against the boosted one`);
    expect(g1).toBeLessThan(g0);
  }, 60_000);

  it('startPower: in Blitz that side holds the item at kick-off (classic ignores it)', () => {
    const b = match({ mode: 'blitz', startPower: ['mega', null], humanSide: -1 });
    expect(b.heldPower).toEqual(['mega', null]);
    const c = match({ startPower: ['mega', 'turbo'], humanSide: -1 });
    expect(c.heldPower).toEqual([null, null]);
    // The AI side uses what it holds once the ball's in play.
    const m = match({ mode: 'blitz', startPower: [null, 'turbo'], humanSide: -1 }, 3);
    let used = false;
    for (let i = 0; i < 60 * 40 && !used; i++) {
      m.step(DT, EMPTY_PAD);
      used = m.drainEvents().some((e) => e.type === 'powerupUsed' && e.side === 1 && e.kind === 'turbo');
    }
    expect(used).toBe(true);
  }, 60_000);
});
