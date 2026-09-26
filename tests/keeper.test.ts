import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { Ball, type BallHit } from '../src/sim/ball';
import { DT, GOAL_H, GOAL_W, HALF_L, HALF_W } from '../src/sim/constants';
import { flightCrossing } from '../src/sim/keeper';
import { EMPTY_PAD, Match } from '../src/sim/match';
import type { Player } from '../src/sim/player';

/**
 * The keeper against long shots (round 9, the owner: "keeper sometimes doesn't save the ball as intended when
 * the shot is very very far away from half way and he just doesn't save it"). src/sim/keeper.ts reads a shot
 * for its whole flight (SHOT_READ_T, flightCrossing over 4 s, not 1.6), gets across to where it will cross on
 * his feet, back-pedals under a dropper, and times his leap for a high one; match.ts checkKeeperHands counts a
 * standing keeper's jump and holds a floated long shot.
 */

function place(p: Player, x: number, z: number): void {
  p.pos.x = x;
  p.pos.z = z;
  p.vel.x = p.vel.z = 0;
  p.setState('move');
  p.order = null;
}

/** Vertical launch speed so a ball at horizontal speed vh from height y0 crosses `dx` m on at height `h` (with the ball's drag). */
function solveVy(dx: number, vh: number, y0: number, h: number): number {
  const at = (vy: number) => {
    const b = new Ball();
    b.reset(0, 0);
    b.pos.y = y0;
    b.vel.x = vh;
    b.vel.y = vy;
    const hits: BallHit[] = [];
    for (let i = 0; i < 600; i++) {
      const px = b.pos.x;
      const py = b.pos.y;
      b.step(DT, hits);
      if (b.pos.x >= dx) return py + (b.pos.y - py) * ((dx - px) / (b.pos.x - px || 1e-6));
      if (b.hspeed() < 0.5) return -1;
    }
    return -1;
  };
  let lo = -2;
  let hi = 14;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) < h) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

type Outcome = 'goal' | 'save' | 'other';

/**
 * A shot from `dist` m out, struck by the AI, its flight then set so it crosses the goal line at height `h` and
 * lateral `z` at `speed` m/s (straight, no spin); the keeper on his line. What came of it.
 */
function longShot(seed: number, dist: number, h: number, z: number, speed: number): Outcome {
  const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 120, difficulty: 2, humanSide: -1, seed });
  m.phase = 'play';
  m.restart = null;
  m.clock = 20;
  m.players.forEach((q, i) => place(q, -40 + i * 3.6, -HALF_W + 1.5));
  const ad = m.attackDir(0);
  const gx = ad * HALF_L;
  const p = m.players[9];
  place(p, gx - ad * dist, 0);
  p.facing = ad > 0 ? 0 : Math.PI;
  const k = m.keeperOf(1)!;
  place(k, gx - ad * 1.5, 0);
  k.facing = ad > 0 ? Math.PI : 0;
  const b = m.ball;
  b.reset(p.pos.x + ad * 0.5, 0);
  b.owner = p.idx;
  b.lastTouch = p.idx;
  b.lastTouchSide = 0;
  m.updateBallPath();
  for (let i = 0; i < 4; i++) m.step(DT, EMPTY_PAD);
  m.drainEvents();
  const kid = m.kickId;
  const o = m.order(p, 'shot', ad, 0, 0.9, -1, false)!;
  o.aimZ = z;
  let fired = false;
  for (let i = 0; i < 60 * 5 && m.phase === 'play'; i++) {
    m.step(DT, EMPTY_PAD);
    if (!fired && m.kickId !== kid) {
      fired = true;
      const dx = gx - b.pos.x;
      const dz = z - b.pos.z;
      const dl = Math.hypot(dx, dz);
      b.vel.x = (dx / dl) * speed;
      b.vel.z = (dz / dl) * speed;
      b.vel.y = solveVy(Math.abs(dx), (speed * Math.abs(dx)) / dl, b.pos.y, h);
      b.spin.x = b.spin.y = b.spin.z = 0;
      m.shotOnTarget = true;
      m.shotSpeed = Math.hypot(b.vel.x, b.vel.y, b.vel.z);
      m.shotCurl = 0;
      m.updateBallPath();
    }
    for (const e of m.drainEvents()) {
      if (e.type === 'goal') return 'goal';
      if (e.type === 'save') return 'save';
      if (e.type === 'restart') return 'other';
    }
  }
  return 'other';
}

describe('keeper against long shots', () => {
  it('from 42 m and 50 m at three heights, within his reach: saved 90%+, and a floated one straight at him is held', () => {
    let n = 0;
    let saved = 0;
    let goals = 0;
    const lines: string[] = [];
    for (const dist of [42, 50]) {
      for (const h of [0.5, 1.4, 2.1]) {
        let dn = 0;
        let ds = 0;
        let dg = 0;
        for (const z of [0, 1.5, -2.2]) {
          for (const speed of [26, 29, 32]) {
            for (let seed = 1; seed <= 3; seed++) {
              const r = longShot(seed * 131 + dist + Math.round(h * 10), dist, h, z, speed);
              // (A skidder from 50 m that dies before the line isn't his to save.)
              if (r === 'other') continue;
              dn++;
              n++;
              if (r === 'save') {
                ds++;
                saved++;
              } else {
                dg++;
                goals++;
              }
            }
          }
        }
        lines.push(`${dist} m at ${h} m: ${ds}/${dn} saved, ${dg} in`);
      }
    }
    // eslint-disable-next-line no-console
    console.log(`long shots: ${lines.join(' | ')}`);
    expect(n).toBeGreaterThan(80);
    expect(saved / n).toBeGreaterThanOrEqual(0.9);
    expect(goals / n).toBeLessThanOrEqual(0.1);
  }, 120_000);

  it('a floated long shot straight at him is caught, not parried, ~95% of the time', () => {
    let caught = 0;
    let n = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 120, difficulty: 2, humanSide: -1, seed: 500 + seed });
      m.phase = 'play';
      m.restart = null;
      m.clock = 20;
      m.players.forEach((q, i) => place(q, -40 + i * 3.6, -HALF_W + 1.5));
      const ad = m.attackDir(0);
      const gx = ad * HALF_L;
      const p = m.players[9];
      place(p, gx - ad * 40, 0);
      const k = m.keeperOf(1)!;
      place(k, gx - ad * 1.5, 0);
      const b = m.ball;
      b.reset(p.pos.x + ad * 0.5, 0);
      b.owner = p.idx;
      b.lastTouch = p.idx;
      m.updateBallPath();
      for (let i = 0; i < 4; i++) m.step(DT, EMPTY_PAD);
      m.drainEvents();
      const kid = m.kickId;
      const o = m.order(p, 'shot', ad, 0, 0.9, -1, false)!;
      o.aimZ = 0.3;
      let fired = false;
      let done = false;
      for (let i = 0; i < 60 * 5 && m.phase === 'play' && !done; i++) {
        m.step(DT, EMPTY_PAD);
        if (!fired && m.kickId !== kid) {
          fired = true;
          const dx = gx - b.pos.x;
          b.vel.x = Math.sign(dx) * 27;
          b.vel.z = 0;
          b.vel.y = solveVy(Math.abs(dx), 27, b.pos.y, 1.5);
          b.spin.x = b.spin.y = b.spin.z = 0;
          m.shotOnTarget = true;
          m.shotSpeed = Math.hypot(b.vel.x, b.vel.y);
          m.shotCurl = 0;
          m.updateBallPath();
        }
        for (const e of m.drainEvents()) {
          if (e.type === 'save' || e.type === 'goal' || e.type === 'restart') {
            n++;
            if (e.type === 'save' && e.caught) caught++;
            done = true;
          }
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`floated 40 m shot straight at him: caught ${caught}/${n}`);
    expect(n).toBeGreaterThanOrEqual(28);
    expect(caught / n).toBeGreaterThanOrEqual(0.9);
  }, 60_000);

  it('a genuinely unreachable strike (fast, into the top corner from 25 m) can still go in', () => {
    let goals = 0;
    let n = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const r = longShot(700 + seed, 25, GOAL_H - 0.25, (seed % 2 ? 1 : -1) * (GOAL_W / 2 - 0.3), 34);
      if (r === 'other') continue;
      n++;
      if (r === 'goal') goals++;
    }
    // eslint-disable-next-line no-console
    console.log(`34 m/s top-corner strikes from 25 m: ${goals}/${n} in`);
    expect(n).toBeGreaterThanOrEqual(8);
    expect(goals).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it('flightCrossing reads the whole flight of a shot from near halfway (not just 1.6 s of it)', () => {
    const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 120, difficulty: 2, humanSide: -1, seed: 1 });
    const ad = m.attackDir(0);
    const b = m.ball;
    b.reset(-ad * 2, 0);
    b.pos.y = 0.5;
    b.vel.x = ad * 27;
    b.vel.y = 8;
    b.vel.z = 0.5;
    // (The keeper's own attack direction: the ball heads towards his goal at -ad. It drops ~35 m on and bounces
    // the rest of the way: a read of the bounces too.)
    const c = flightCrossing(m, ad * (HALF_L - 1.5), m.attackDir(1));
    expect(c).not.toBeNull();
    expect(c!.t).toBeGreaterThan(1.7);
    expect(c!.t).toBeLessThan(4);
    expect(Math.abs(c!.z)).toBeLessThan(2);
  });
});
