import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT, HALF_W } from '../src/sim/constants';
import { CLOSE_T, pressSteal, SLIDE_HOLD, standingFoulChance } from '../src/sim/dribble';
import { EMPTY_PAD, Match, type Pad } from '../src/sim/match';
import type { Player } from '../src/sim/player';
import type { MatchEvent } from '../src/sim/types';

/**
 * The human's TACKLE (SHOOT while the other side has the ball, src/sim/dribble.ts humanTackle): a tap near the
 * carrier is an assisted standing tackle (a lunge and a poke), from further off he closes in first; held, or
 * double-tapped, it's a slide; PRESS (THROUGH held) pokes away an exposed touch.
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

const pad = (mx: number, mz: number, extra: Partial<Pad> = {}): Pad => ({ ...EMPTY_PAD, mx, mz, ...extra });

/**
 * Their carrier at the centre spot running along `dir` (+1 / -1 along x) at `speed`, our man (the human's)
 * `gap` m away along x at `at` (-1: on the -x side of him, +1 on the +x side).
 */
function duel(seed: number, gap: number, at: number, dir: number, speed = 3): { m: Match; p: Player; c: Player } {
  const m = scenario(seed);
  const c = m.players[19];
  place(c, 0, 0);
  c.facing = dir > 0 ? 0 : Math.PI;
  c.vel.x = dir * speed;
  // (Carrying on with his dribble rather than picking a pass the moment the scenario starts.)
  c.aiT = 0.6;
  c.ballT = 2;
  c.aiMode = 'dribble';
  c.aiDirX = dir;
  c.aiDirZ = 0;
  const b = m.ball;
  b.reset(c.footX(), c.footZ());
  b.owner = c.idx;
  b.lastTouch = c.idx;
  b.lastTouchSide = c.side;
  m.possessionSide = 1;
  const p = m.players[6];
  place(p, at * gap, 0);
  p.facing = at > 0 ? Math.PI : 0;
  m.active = p.idx;
  m.updateBallPath();
  return { m, p, c };
}

/** Play `frames` of `input(frame)`; the challenges our man made, and when the first came. */
function play(m: Match, p: Player, frames: number, input: (i: number) => Pad) {
  const evs: MatchEvent[] = [];
  let first = -1;
  let slide = false;
  let maxSp = 0;
  let sprinted = false;
  for (let i = 0; i < frames; i++) {
    m.step(DT, input(i));
    maxSp = Math.max(maxSp, p.speed());
    if (p.sprint && m.assist.tackle) sprinted = true;
    if (p.state === 'slide') slide = true;
    for (const e of m.drainEvents()) {
      evs.push(e);
      if (e.type === 'tackle' && e.by === p.idx && first < 0) first = i;
    }
  }
  const stand = evs.filter((e) => e.type === 'tackle' && e.by === p.idx && !e.slide);
  return {
    evs,
    first,
    slide,
    maxSp,
    sprinted,
    tried: stand.length > 0,
    won: stand.some((e) => e.type === 'tackle' && e.won),
    foul: evs.some((e) => e.type === 'foul' && e.by === p.idx),
  };
}

const tap = (i: number) => pad(0, 0, { shoot: i < 4 });

describe('TACKLE: tap', () => {
  it('within 3 m, from the front: a standing tackle there and then that wins it most of the time and rarely fouls', () => {
    let tried = 0;
    let won = 0;
    let fouls = 0;
    let quick = 0;
    const N = 40;
    for (let s = 0; s < N; s++) {
      // He runs at us; we're 2 m in front of him.
      const { m, p } = duel(1000 + s, 2, -1, -1);
      const r = play(m, p, 45, tap);
      if (r.tried) tried++;
      if (r.won) won++;
      if (r.foul) fouls++;
      if (r.first >= 0 && r.first <= 18) quick++;
    }
    // eslint-disable-next-line no-console
    console.log(`TACKLE tap from the front at 2 m: tried ${tried}/${N} (${quick} within 0.3 s), won ${won}, fouls ${fouls}`);
    expect(tried).toBeGreaterThanOrEqual(N * 0.8);
    expect(quick).toBeGreaterThanOrEqual(N * 0.75);
    expect(won / Math.max(1, tried)).toBeGreaterThanOrEqual(0.55);
    expect(fouls).toBeLessThanOrEqual(N * 0.05);
  });

  it('from behind: it comes off less often, and fouls are likelier', () => {
    const run = (at: number) => {
      let tried = 0;
      let won = 0;
      let fouls = 0;
      for (let s = 0; s < 60; s++) {
        // He runs along +x; we're 1.8 m behind him (at -x) or in front of him (at +x).
        const { m, p } = duel(2000 + s, 1.8, at, 1, 2.5);
        const r = play(m, p, 45, tap);
        if (r.tried) tried++;
        if (r.won) won++;
        if (r.foul) fouls++;
      }
      return { tried, won, fouls, rate: won / Math.max(1, tried) };
    };
    const behind = run(-1);
    const front = run(1);
    // eslint-disable-next-line no-console
    console.log(`TACKLE tap: from behind won ${behind.won}/${behind.tried}, fouls ${behind.fouls}; from the front won ${front.won}/${front.tried}, fouls ${front.fouls}`);
    expect(behind.rate).toBeLessThan(front.rate);
    expect(behind.fouls).toBeGreaterThanOrEqual(front.fouls);
    // The model itself: a miss through the back of him is ~20x likelier to be a foul than one from the front.
    expect(standingFoulChance(1, 0)).toBeGreaterThan(standingFoulChance(0, 0) * 10);
  });

  it('from 2.5-6 m: he closes at a sprint and tackles on arrival, inside ~0.8 s', () => {
    let arrived = 0;
    let sprinted = 0;
    const N = 30;
    for (let s = 0; s < N; s++) {
      const { m, p } = duel(3000 + s, 4.5, -1, -1, 1);
      const r = play(m, p, Math.round((CLOSE_T + 0.1) / DT), tap);
      if (r.first >= 0 && r.first * DT <= CLOSE_T + 0.05) arrived++;
      if (r.sprinted) sprinted++;
    }
    // eslint-disable-next-line no-console
    console.log(`TACKLE tap from 4.5 m: tackled on arrival ${arrived}/${N}, sprinted ${sprinted}/${N}`);
    expect(arrived).toBeGreaterThanOrEqual(N * 0.7);
    expect(sprinted).toBeGreaterThanOrEqual(N * 0.9);
  });

  it('pulling the stick hard away calls a closing tap off', () => {
    for (let s = 0; s < 10; s++) {
      const { m, p } = duel(4000 + s, 4.5, -1, -1, 0.5);
      // Tap, then the stick pulled back the other way (away from him).
      const r = play(m, p, 60, (i) => pad(i < 6 ? 0 : -1, 0, { shoot: i < 4 }));
      expect(r.tried).toBe(false);
      expect(m.assist.tackle).toBeNull();
    }
  });

  it('beyond 6 m it does nothing', () => {
    const { m, p } = duel(5000, 8, -1, -1, 0);
    const r = play(m, p, 30, tap);
    expect(r.tried || r.slide).toBe(false);
  });
});

describe('TACKLE: tap to contact', () => {
  it('no wind-up: in reach it goes in on the press; from 3 m the lunge gets there within ~0.1 s', () => {
    const lat = (gap: number) => {
      const fr: number[] = [];
      for (let s = 0; s < 20; s++) {
        const { m, p } = duel(9800 + s, gap, -1, -1, 2);
        const r = play(m, p, 30, tap);
        if (r.first >= 0) fr.push(r.first);
      }
      return { n: fr.length, max: Math.max(...fr), avg: fr.reduce((a, f) => a + f, 0) / Math.max(1, fr.length) };
    };
    const near = lat(2);
    const far = lat(3);
    // eslint-disable-next-line no-console
    console.log(`TACKLE tap to contact: from 2 m ${near.avg.toFixed(1)} frames (max ${near.max}), from 3 m ${far.avg.toFixed(1)} (max ${far.max}), of 20 each: ${near.n}, ${far.n}`);
    expect(near.n).toBeGreaterThanOrEqual(18);
    expect(near.max).toBe(0);
    expect(far.n).toBeGreaterThanOrEqual(16);
    expect(far.max * DT).toBeLessThanOrEqual(0.12);
  });
});

describe('TACKLE: hold or double-tap to slide', () => {
  it("the human's slide is long, fast and forgiving: from 4 m it takes a carrier crossing its path, and rarely fouls", () => {
    let won = 0;
    let fouls = 0;
    const N = 30;
    let far = 0;
    for (let s = 0; s < N; s++) {
      // He carries it across our path 4 m ahead of us; we go to ground (double tap), aimed a beat ahead of it.
      const { m, p, c } = duel(9900 + s, 4, -1, 1, 1);
      c.pos.z = 1.5;
      c.facing = -Math.PI / 2;
      c.vel.x = 0;
      c.vel.z = -3;
      c.aiDirX = 0;
      c.aiDirZ = -1;
      m.ball.pos.x = c.footX();
      m.ball.pos.z = c.footZ();
      const x0 = p.pos.x;
      const r = play(m, p, 60, (i) => pad(0, 0, { shoot: i < 2 || (i >= 5 && i < 7) }));
      if (r.evs.some((e) => e.type === 'tackle' && e.by === p.idx && e.slide && e.won)) won++;
      if (r.foul) fouls++;
      far = Math.max(far, p.pos.x - x0);
    }
    // eslint-disable-next-line no-console
    console.log(`human slide from 4 m at a carrier crossing: won ${won}/${N}, fouls ${fouls}, travelled up to ${far.toFixed(1)} m`);
    expect(won).toBeGreaterThanOrEqual(N * 0.7);
    expect(fouls).toBeLessThanOrEqual(N * 0.1);
    expect(far).toBeGreaterThan(3.5);
  });

  it(`held ${SLIDE_HOLD} s (the ball not yet in reach when pressed): a slide, aimed at the ball`, () => {
    for (let s = 0; s < 6; s++) {
      const { m, p } = duel(6000 + s, 3.6, -1, -1, 2);
      const r = play(m, p, 30, (i) => pad(0, 0, { shoot: i < 24 }));
      expect(r.slide).toBe(true);
      expect(r.evs.some((e) => e.type === 'tackle' && e.by === p.idx && e.slide)).toBe(true);
    }
  });

  it('a second tap within 0.3 s: a slide at once', () => {
    for (let s = 0; s < 6; s++) {
      const { m, p } = duel(7000 + s, 3.6, -1, -1, 1);
      let slideAt = -1;
      for (let i = 0; i < 20; i++) {
        m.step(DT, pad(0, 0, { shoot: i < 3 || (i >= 7 && i < 10) }));
        m.drainEvents();
        if (p.state === 'slide' && slideAt < 0) slideAt = i;
      }
      expect(slideAt).toBeGreaterThanOrEqual(7);
      expect(slideAt).toBeLessThanOrEqual(8);
    }
  });

  it('a quick tap is never a slide', () => {
    for (let s = 0; s < 10; s++) {
      const { m, p } = duel(8000 + s, 2, -1, -1);
      expect(play(m, p, 40, tap).slide).toBe(false);
    }
  });
});

describe('PRESS: the jockey', () => {
  it('holding PRESS, our man mirrors the carrier: he stays goal-side and close however the carrier runs', () => {
    let worst = 0;
    let sum = 0;
    let n = 0;
    let goalSide = 0;
    for (let s = 0; s < 10; s++) {
      // He runs at our goal (-x) and veers; we start 4 m off him, goal-side.
      const { m, p, c } = duel(9700 + s, 4, -1, -1, 5);
      c.aiDirZ = s % 2 ? 0.6 : -0.6;
      for (let i = 0; i < 90; i++) {
        m.step(DT, pad(0, 0, { through: true }));
        m.drainEvents();
        if (m.ball.owner !== c.idx || p.state !== 'move') break;
        if (i < 30) continue;
        const d = Math.hypot(p.pos.x - c.pos.x, p.pos.z - c.pos.z);
        worst = Math.max(worst, d);
        sum += d;
        n++;
        if (p.pos.x < c.pos.x) goalSide++;
      }
    }
    // eslint-disable-next-line no-console
    console.log(`PRESS: gap to the carrier averages ${(sum / Math.max(1, n)).toFixed(2)} m, worst ${worst.toFixed(2)} m, goal-side ${((goalSide / Math.max(1, n)) * 100).toFixed(0)}% of the time`);
    expect(sum / Math.max(1, n)).toBeLessThan(2.2);
    expect(worst).toBeLessThan(3.2);
    expect(goalSide / Math.max(1, n)).toBeGreaterThan(0.85);
  });
});

describe('PRESS: the auto-steal', () => {
  it("a touch that leaves the ball exposed, with our man nearer it, is poked away", () => {
    let won = 0;
    let tried = 0;
    const N = 40;
    for (let s = 0; s < N; s++) {
      const { m, p, c } = duel(9000 + s, 2.2, 1, 1, 6);
      // His touch has run 1.3 m ahead of him, and our man stands over it.
      m.ball.pos.x = c.pos.x + 1.3;
      m.ball.pos.z = 0;
      place(p, c.pos.x + 1.9, 0.25);
      p.facing = Math.PI;
      pressSteal(m, p, c);
      const evs = m.drainEvents();
      if (evs.some((e) => e.type === 'tackle' && e.by === p.idx)) tried++;
      if (evs.some((e) => e.type === 'tackle' && e.by === p.idx && e.won)) won++;
    }
    // eslint-disable-next-line no-console
    console.log(`PRESS auto-steal on an exposed touch: tried ${tried}/${N}, won ${won}`);
    expect(tried).toBe(N);
    expect(won).toBeGreaterThanOrEqual(N * 0.6);
  });

  it('no steal while the ball is on his foot', () => {
    const { m, p, c } = duel(9500, 1.5, 1, 1, 3);
    m.ball.pos.x = c.footX();
    m.ball.pos.z = c.footZ();
    pressSteal(m, p, c);
    expect(m.drainEvents().some((e) => e.type === 'tackle')).toBe(false);
  });
});
