import { describe, expect, it } from 'vitest';
import { BOTTOM_DIVISION, matchDifficulty } from '../src/meta/career';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT, GOAL_W, HALF_L, HALF_W } from '../src/sim/constants';
import { dwellRead, vsHuman } from '../src/sim/dribble';
import { EMPTY_PAD, Match, SHOOT_FULL_T, type Pad } from '../src/sim/match';
import type { Player } from '../src/sim/player';
import { fmtOwner, ownerSeries } from './ownerBots';

/**
 * The owner, 2026-10-05, four matches into a career in the bottom division: "when the skill timing thing pops up, they
 * don't tackle the player", "when he's to the side close he doesn't take it at all", "i can keep spinning around ina
 * circle with a joy stick and no one will ever get the ball from me", "i keep scoring on him 15+ goals, but he never
 * scored one on me", "im also in very tough angles and im able to easily get a shot".
 *
 * Whole matches with tests/ownerBots.ts's bots at the settings he plays (short series: the 16-match tables are in the
 * round's report), and two scripted scenes. Everything is seeded.
 */

const log = (bot: string, setting: string, s: ReturnType<typeof ownerSeries>) => {
  // eslint-disable-next-line no-console
  console.log(fmtOwner(bot, setting, s));
};

function scene(seed: number, difficulty = 1.8): Match {
  const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 120, difficulty, humanSide: 0, seed });
  m.phase = 'play';
  m.restart = null;
  m.clock = 20;
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

function give(m: Match, p: Player): void {
  const b = m.ball;
  b.reset(p.pos.x + Math.cos(p.facing) * 0.5, p.pos.z + Math.sin(p.facing) * 0.5);
  b.owner = p.idx;
  b.lastTouch = p.idx;
  b.lastTouchSide = p.side;
  m.active = p.idx;
  m.updateBallPath();
}

describe('a tell is a promise', () => {
  it('the table: an ignored tell costs the ball at every level, most of the time from NORMAL up', () => {
    const told = [0.6, 1.8, 3, 4].map((d) => vsHuman(d).told);
    expect(told[0]).toBeGreaterThanOrEqual(0.5);
    expect(told[1]).toBeGreaterThanOrEqual(0.8);
    for (let i = 1; i < told.length; i++) expect(told[i]).toBeGreaterThanOrEqual(told[i - 1]);
  });

  it('NORMAL: a man who dribbles on through the tell is challenged nearly every time and loses it at least 70% of the time, from the side as well', () => {
    const s = ownerSeries('ignore', 'normal', 8);
    log('ignore', 'normal', s);
    expect(s.ignored).toBeGreaterThan(10);
    expect(s.ignoredTried).toBeGreaterThanOrEqual(0.85);
    expect(s.ignoredLost).toBeGreaterThanOrEqual(0.7);
    // Tackles from anywhere in reach: in front of him and beside him both come, and both win more often than not.
    expect(s.tries.front).toBeGreaterThan(10);
    expect(s.wins.front / s.tries.front).toBeGreaterThanOrEqual(0.5);
    expect(s.tries.side).toBeGreaterThan(3);
    expect(s.wins.side / s.tries.side).toBeGreaterThanOrEqual(0.4);
    // From clearly behind they are rarer and riskier: never the surest way to win it.
    expect(s.wins.behind / Math.max(1, s.tries.behind)).toBeLessThan(s.wins.front / s.tries.front);
  }, 300_000);

  it('EASY and the first match are more forgiving, never near zero', () => {
    const easy = ownerSeries('ignore', 'easy', 6);
    const first = ownerSeries('ignore', 'first', 6);
    log('ignore', 'easy', easy);
    log('ignore', 'first', first);
    expect(easy.ignoredLost).toBeGreaterThanOrEqual(0.3);
    expect(easy.ignoredLost).toBeLessThan(0.8);
    expect(first.ignoredLost).toBeGreaterThanOrEqual(0.15);
    expect(first.ignoredLost).toBeLessThanOrEqual(easy.ignoredLost + 0.1);
  }, 300_000);
});

describe('the AI plays the person-like bot like a team that wants to win', () => {
  it('NORMAL: a PERFECT still beats the man, the AI scores in a good share of the matches, and he still wins more than he loses', () => {
    const s = ownerSeries('casual', 'normal', 12);
    log('casual', 'normal', s);
    expect(s.perfect).toBeGreaterThan(40);
    expect(s.perfectKept).toBeGreaterThanOrEqual(0.95);
    // It was 12-0-0 and 0.7 against with the AI on 3.9 shots, a third of them from beyond 24 m.
    expect(s.ga).toBeGreaterThanOrEqual(0.5);
    expect(s.aiScored).toBeGreaterThanOrEqual(0.4);
    expect(s.onAgainst).toBeGreaterThanOrEqual(1.5);
    expect(s.gf).toBeGreaterThanOrEqual(1.5);
    expect(s.gf).toBeLessThanOrEqual(4.5);
    expect(s.w).toBeGreaterThan(s.l);
    // The man it has just robbed doesn't take it straight back: under one AI spell in five ends inside a second to his tackle.
    expect(s.aiEnd.mineQuick).toBeLessThan(0.2);
  }, 300_000);

  it("his career's bottom division is NORMAL, and the AI scores there too", () => {
    expect(matchDifficulty(BOTTOM_DIVISION)).toBe(1);
    const s = ownerSeries('casual', 'career', 10);
    log('casual', 'career', s);
    // It was EASY: 12-0-0, 4.0 goals to none, the AI on 1.6 shots.
    expect(s.ga).toBeGreaterThanOrEqual(0.3);
    expect(s.gf).toBeGreaterThanOrEqual(0.8);
    expect(s.gf).toBeLessThanOrEqual(4);
    expect(s.w).toBeGreaterThan(s.l);
  }, 300_000);
});

describe('going nowhere loses the ball', () => {
  it('NORMAL: a man who spins the stick is robbed within 3 s of a defender arriving four times in five', () => {
    const s = ownerSeries('circle', 'normal', 8);
    log('circle', 'normal', s);
    expect(s.lostIn3).toBeGreaterThanOrEqual(0.8);
    expect(s.keptOver3).toBeLessThan(0.12);
    expect(s.carryS).toBeLessThan(2.6);
  }, 300_000);

  it('a spin is not a skill: no beat, no protection window, however fast the stick goes round', () => {
    const m = scene(7);
    const p = m.players[9];
    place(p, -10, 0);
    p.facing = 0;
    give(m, p);
    const o = m.players[14];
    place(o, -8, 0.4);
    let beats = 0;
    let protectedT = 0;
    let read = 0;
    // The stick round once every 0.4 s (far over the cut's swing), a man beside him the whole time who is kept from
    // tackling so the spin can be watched for 3 s.
    for (let i = 0; i < 180; i++) {
      for (const d of m.teamPlayers(1)) d.tackleCooldown = 9;
      const a = ((i * DT) / 0.4) * Math.PI * 2;
      m.step(DT, { ...EMPTY_PAD, mx: Math.cos(a), mz: Math.sin(a), autoSprint: true });
      for (const e of m.drainEvents()) if (e.type === 'beat' && e.by === p.idx) beats++;
      // (The first flick may be a cut that beats him, with its PROTECT_T s: nothing after it renews the window.)
      if (i * DT > 1 && p.protectT > 0) protectedT += DT;
      read = Math.max(read, dwellRead(m, p));
      expect(m.ball.owner).toBe(p.idx);
    }
    expect(beats).toBeLessThanOrEqual(1);
    expect(protectedT).toBeLessThan(0.05);
    // ... and he is READ for it, as a man running one straight line is.
    expect(read).toBeGreaterThan(0.9);
  });

  it('a man taking it somewhere is not read as going nowhere', () => {
    const m = scene(8);
    const p = m.players[9];
    place(p, -30, 0);
    p.facing = 0;
    give(m, p);
    for (let i = 0; i < 150; i++) {
      for (const d of m.teamPlayers(1)) d.tackleCooldown = 9;
      // (A weave: 25 degrees either side of his run, so he isn't a straight line either.)
      const a = Math.sin(i * DT * 3) * 0.45;
      m.step(DT, { ...EMPTY_PAD, mx: Math.cos(a), mz: Math.sin(a), autoSprint: true });
      m.drainEvents();
      if (i > 60) expect(dwellRead(m, p)).toBe(0);
    }
  });
});

describe('tight angles', () => {
  const charge = (f: number) => Math.round((f * SHOOT_FULL_T) / 0.85);
  /** His striker `dist` m off their goal line at `z`, their keeper given a second to set himself; SHOOT with the stick left alone or at goal. */
  const shot = (seed: number, dist: number, z: number, hold: number, atGoal: boolean): { goal: boolean; keeperZ: number; keeperOut: number } => {
    const m = scene(seed);
    const ad = m.attackDir(0);
    const p = m.players[9];
    place(p, ad * (HALF_L - dist), z);
    p.facing = Math.atan2(-z, ad * dist);
    const k = m.keeperOf(1)!;
    place(k, ad * (HALF_L - 1.5), 0);
    give(m, p);
    for (let i = 0; i < 60; i++) m.step(DT, EMPTY_PAD);
    const keeperZ = k.pos.z;
    const keeperOut = HALF_L - ad * k.pos.x;
    const gl = Math.hypot(ad * HALF_L - p.pos.x, p.pos.z) || 1;
    const stick: Pad = atGoal ? { ...EMPTY_PAD, mx: (ad * HALF_L - p.pos.x) / gl, mz: -p.pos.z / gl } : EMPTY_PAD;
    for (let i = 0; i < charge(hold); i++) m.step(DT, { ...stick, shoot: true });
    for (let i = 0; i < 6; i++) m.step(DT, stick);
    const g0 = m.score[0];
    for (let i = 0; i < 200 && (m.phase as string) === 'play'; i++) m.step(DT, EMPTY_PAD);
    return { goal: m.score[0] > g0, keeperZ, keeperOut };
  };
  const rate = (dist: number, z: number): number => {
    let goals = 0;
    let n = 0;
    for (const atGoal of [false, true]) for (const hold of [20, 35, 50]) for (let s = 0; s < 10; s++) {
      if (shot(1 + s * 7, dist, z, hold, atGoal).goal) goals++;
      n++;
    }
    return goals / n;
  };

  it('the keeper holds his near post against a man by the byline, and never runs out past it at him', () => {
    for (const [dist, z] of [[2, 7], [3, 8], [2, -7]]) {
      const r = shot(3, dist, z, 20, false);
      expect(Math.abs(r.keeperZ)).toBeLessThan(GOAL_W / 2);
      expect(Math.sign(r.keeperZ)).toBe(Math.sign(z));
      expect(r.keeperOut).toBeLessThan(2);
    }
  });

  it('the shot assist no longer threads it from the byline; a good angle still scores', () => {
    const byline = rate(2, 7);
    const acute = rate(3, 8);
    const centre = rate(12, 0);
    const angled = rate(10, 10);
    // eslint-disable-next-line no-console
    console.log(`assisted shots against a set keeper: byline (2 m off it) ${Math.round(byline * 100)}% | acute (3 m) ${Math.round(acute * 100)}% | 12 m centre ${Math.round(centre * 100)}% | 10 m out, 10 m wide ${Math.round(angled * 100)}%`);
    // They were 80% and 48%: the keeper ran out past his post at the man, and the assist picked the far corner for him.
    expect(byline).toBeLessThanOrEqual(0.12);
    expect(acute).toBeLessThanOrEqual(0.25);
    expect(centre).toBeGreaterThanOrEqual(0.6);
    expect(angled).toBeGreaterThanOrEqual(0.4);
    expect(centre).toBeGreaterThan(acute * 2.5);
  }, 300_000);
});
