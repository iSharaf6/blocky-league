import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT, HALF_L, HALF_W } from '../src/sim/constants';
import { EMPTY_PAD, Match, type Pad } from '../src/sim/match';
import type { Player } from '../src/sim/player';

function place(p: Player, x: number, z: number): void {
  p.pos.x = x; p.pos.z = z; p.vel.x = p.vel.z = 0;
  p.setState('move'); p.order = null;
}

function setup(sign = 1, x = 0): Match {
  const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 150, difficulty: 1.8, humanSide: 0, seed: 71 });
  Object.assign(m, { phase: 'play', restart: null });
  for (const p of m.players) place(p, -40 + p.idx * 3.5, -sign * (HALF_W - 2));
  m.ball.reset(x, sign * (HALF_W + 0.4)); m.ball.lastTouchSide = 1; m.ball.lastTouch = 14;
  for (let i = 0; i < 180 && m.phase !== 'restart'; i++) m.step(DT, EMPTY_PAD);
  expect(m.restart?.kind).toBe('throwin');
  expect(m.phase).toBe('restart');
  m.phaseT = 0.5;
  const taker = m.restart!.taker;
  const mates = m.teamPlayers(0).filter(p => !p.isKeeper && p.idx !== taker);
  for (const p of m.players) if (p.idx !== taker) place(p, -40 + p.idx * 3.5, -sign * (HALF_W - 2));
  place(mates[0], x + 12, sign * (HALF_W - 4));
  place(mates[1], x - 12, sign * (HALF_W - 4));
  place(mates[2], x, sign * (HALF_W - 12));
  m.drainEvents();
  return m;
}

function throwBall(m: Match, input: Partial<Pad>): { x: number; z: number; target: number } {
  m.step(DT, { ...EMPTY_PAD, ...input, pass: true });
  for (let i = 0; i < 30; i++) {
    const kick = m.drainEvents().find(e => e.type === 'kick' && e.kind === 'throw');
    if (kick?.type === 'kick') return { x: kick.x, z: kick.z, target: m.passTarget };
    m.step(DT, EMPTY_PAD);
  }
  throw new Error('The throw-in button did not release the ball');
}

describe('throw-in aiming and touchline entry', () => {
  it.each([-1, 1])('lets the player choose either side and keeps the throw in play from touchline %s', sign => {
    for (const mx of [-1, 1]) {
      const m = setup(sign);
      m.step(DT, { ...EMPTY_PAD, mx });
      const target = m.passPreview;
      expect(target).toBeGreaterThanOrEqual(0);
      expect(m.players[target].pos.x * mx).toBeGreaterThan(8);
      // Releasing the direction keeps the selection until PASS is pressed.
      m.step(DT, EMPTY_PAD);
      expect(m.passPreview).toBe(target);
      const kick = throwBall(m, {});
      expect(kick.target).toBe(target);
      expect(Math.abs(kick.z)).toBeLessThan(HALF_W);
      for (let i = 0; i < 35; i++) {
        expect(m.phase).toBe('play');
        expect(Math.abs(m.ball.pos.z)).toBeLessThanOrEqual(HALF_W);
        m.step(DT, EMPTY_PAD);
      }
    }
  });

  it('locks the highlighted recipient when pressed, even if movement changes during the throw', () => {
    const m = setup();
    m.step(DT, { ...EMPTY_PAD, mx: 1 });
    const target = m.passPreview;
    m.step(DT, { ...EMPTY_PAD, mx: 1, pass: true });
    for (let i = 0; i < 25 && m.phase === 'restart'; i++) m.step(DT, { ...EMPTY_PAD, mx: -1 });
    expect(m.phase).toBe('play');
    expect(m.passTarget).toBe(target);
    expect(m.ball.vel.x).toBeGreaterThan(0);
  });

  it('selects a reachable outfielder instead of a distant teammate or the keeper', () => {
    const m = setup();
    const taker = m.restart!.taker;
    const mates = m.teamPlayers(0).filter(p => p.idx !== taker && !p.isKeeper);
    for (const p of mates) place(p, -35 + p.idx, -HALF_W + 2);
    place(mates[0], 32, HALF_W - 3);
    place(mates[1], 12, HALF_W - 6);
    place(m.players[0], 6, HALF_W - 2);
    m.step(DT, { ...EMPTY_PAD, mx: 1 });
    expect(m.passPreview).toBe(mates[1].idx);
    expect(throwBall(m, { mx: 1 }).target).toBe(mates[1].idx);
  });

  it.each([-1, 1])('keeps a manual sideways or outward throw in bounds on touchline %s', sign => {
    for (const mx of [-1, 0, 1]) {
      const m = setup(sign);
      m.groundAssist = 'manual';
      const kick = throwBall(m, { mx, mz: sign });
      expect(kick.target).toBe(-1);
      expect(m.ball.vel.z * sign).toBeLessThan(0);
      for (let i = 0; i < 90 && m.ball.owner < 0; i++) {
        expect(m.phase).toBe('play');
        m.step(DT, EMPTY_PAD);
      }
      expect(Math.abs(m.ball.pos.z)).toBeLessThan(HALF_W);
    }
  });

  it('accepts a throw immediately when the taker is ready instead of losing an early press', () => {
    const m = setup();
    m.phaseT = 0;
    const kick = throwBall(m, { mz: -1 });
    expect(Math.abs(kick.z)).toBeLessThan(HALF_W);
  });

  it.each([-1, 1])('keeps an untargeted throw away from the nearby goal line %s', end => {
    const m = setup(1, end * (HALF_L - 1));
    m.groundAssist = 'manual';
    throwBall(m, { mx: end });
    for (let i = 0; i < 70 && m.ball.owner < 0; i++) {
      expect(m.phase).toBe('play');
      expect(Math.abs(m.ball.pos.x)).toBeLessThan(HALF_L);
      m.step(DT, EMPTY_PAD);
    }
  });
});
