import { describe, expect, it } from 'vitest';
import { Ball, groundPassSpeed, rollDistance, solveLob, type BallHit } from '../src/sim/ball';
import { BALL_R, DT, GOAL_H, HALF_L } from '../src/sim/constants';

function roll(v0: number): number {
  const b = new Ball();
  b.vel.x = v0;
  const hits: BallHit[] = [];
  for (let i = 0; i < 60 * 20; i++) b.step(DT, hits);
  return b.pos.x;
}

describe('ball physics', () => {
  it('ground pass solver lands the ball where asked', () => {
    for (const d of [8, 15, 25, 35]) {
      const v0 = groundPassSpeed(d, 0.01);
      expect(Math.abs(roll(v0) - d)).toBeLessThan(d * 0.04 + 0.3);
    }
  });

  it('closed-form roll distance matches the integrator', () => {
    const v0 = 18;
    expect(Math.abs(rollDistance(v0, 0) - roll(v0))).toBeLessThan(0.6);
  });

  it('lob solver carries the requested distance with drag', () => {
    const { vh, vy } = solveLob(30, 1.6, BALL_R);
    const b = new Ball();
    b.vel.x = vh;
    b.vel.y = vy;
    b.pos.y = BALL_R + 0.01;
    const hits: BallHit[] = [];
    let landed = 0;
    for (let i = 0; i < 600; i++) {
      b.step(DT, hits);
      if (hits.some((h) => h.kind === 'bounce') && !landed) landed = b.pos.x;
    }
    expect(Math.abs(landed - 30)).toBeLessThan(1.2);
  });

  it('bounces off the crossbar instead of passing through it', () => {
    const b = new Ball();
    b.pos.x = HALF_L - 3;
    b.pos.y = GOAL_H;
    b.pos.z = 0;
    b.vel.x = 20;
    const hits: BallHit[] = [];
    for (let i = 0; i < 30; i++) b.step(DT, hits);
    expect(hits.some((h) => h.kind === 'post')).toBe(true);
    expect(b.vel.x).toBeLessThan(0);
  });

  it('a ball that goes in stays in the net', () => {
    const b = new Ball();
    b.pos.x = HALF_L - 2;
    b.pos.y = 1;
    b.vel.x = 25;
    const hits: BallHit[] = [];
    for (let i = 0; i < 240; i++) b.step(DT, hits);
    expect(b.inGoal).toBe(1);
    expect(b.pos.x).toBeGreaterThan(HALF_L);
  });
});
