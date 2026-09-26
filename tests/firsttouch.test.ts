import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { groundPassSpeed } from '../src/sim/ball';
import { DT, HALF_W } from '../src/sim/constants';
import { EMPTY_PAD, Match, TOUCH_SPILL } from '../src/sim/match';
import type { Player } from '../src/sim/player';
import type { AssistLevel } from '../src/sim/types';

/*
 * First touch: a moving ball isn't glued to the receiver's foot. It comes off him a distance set by its pace
 * (relative to him), his dribbling, the pressure and his body shape: a good player on a firm pass pushes it
 * into his stride; a poor one on a hard ball with a man on him can spill it.
 */

function place(p: Player, x: number, z: number): void {
  p.pos.x = x;
  p.pos.z = z;
  p.vel.x = p.vel.z = 0;
  p.setState('move');
  p.order = null;
}

interface Touch {
  /** How far the touch came off him (Match.lastTouchD), and whether he had it after it. */
  dist: number;
  kept: boolean;
  /** The furthest (m) the ball got from his foot over the 0.6 s after the touch (once met), while he had it. */
  maxOff: number;
}

/**
 * The human's man (dribbling `drib`) standing at midfield facing the ball; a ball rolled at him from 12 m so
 * it arrives at `speed` m/s; with `press`, an opponent standing `press` m to his side (a step behind).
 */
function receive(seed: number, drib: number, speed: number, press = 0, assist: AssistLevel = 'manual', human = true): Touch {
  const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 120, difficulty: 2, humanSide: human ? 0 : -1, seed });
  m.groundAssist = assist;
  m.phase = 'play';
  m.restart = null;
  m.clock = 20;
  m.players.forEach((q, i) => place(q, -40 + i * 3.6, -HALF_W + 1.5));
  const p = m.players[7];
  p.def = { ...p.def, stats: { ...p.def.stats, dribbling: drib } };
  place(p, 0, 0);
  p.facing = 0; // facing the ball, which comes from +x
  // (The man on him stands a step behind his shoulder: at him, not in the ball's way.)
  if (press > 0) place(m.players[18], -0.6, press);
  const b = m.ball;
  b.reset(12, 0);
  b.vel.x = -groundPassSpeed(12 - 0.7, speed);
  b.lastTouch = m.players[8].idx;
  b.lastTouchSide = 0;
  m.kickId++;
  m.kickX = 30;
  m.kickZ = 0;
  m.active = p.idx;
  m.updateBallPath();
  const touchD0 = m.lastTouchD;
  let dist = -1;
  let kept = false;
  let maxOff = 0;
  let after = -1;
  for (let i = 0; i < 120; i++) {
    m.step(DT, EMPTY_PAD);
    m.drainEvents();
    if (dist < 0 && m.lastTouchD !== touchD0) {
      dist = m.lastTouchD;
      after = 0;
    }
    if (after >= 0) {
      after++;
      // (From a few frames on: it's met at the edge of his reach.)
      if (after > 4 && m.ball.owner === p.idx) maxOff = Math.max(maxOff, Math.hypot(p.footX() - m.ball.pos.x, p.footZ() - m.ball.pos.z));
      if (after === 36) {
        kept = m.ball.owner === p.idx;
        break;
      }
    }
  }
  return { dist, kept, maxOff };
}

const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);

describe('first touch', () => {
  it('a good player on a firm (15 m/s) pass takes it into his stride and keeps it within 0.8 m', () => {
    const rs = Array.from({ length: 20 }, (_, s) => receive(1 + s * 7, 85, 15));
    const d = mean(rs.map((r) => r.dist));
    // eslint-disable-next-line no-console
    console.log(`good touch, 15 m/s: off his foot ${d.toFixed(2)} m on average (${rs.map((r) => r.dist.toFixed(2)).join(' ')}), kept ${rs.filter((r) => r.kept).length}/20, furthest ${Math.max(...rs.map((r) => r.maxOff)).toFixed(2)} m`);
    for (const r of rs) {
      expect(r.dist).toBeGreaterThan(0.2);
      expect(r.dist).toBeLessThan(0.8);
      expect(r.kept).toBe(true);
      expect(r.maxOff).toBeLessThan(0.8);
    }
    expect(d).toBeGreaterThan(0.3);
    expect(d).toBeLessThan(0.6);
  });

  it('a poor player on a 25 m/s ball with a man on him spills it more often, and further', () => {
    const good = Array.from({ length: 30 }, (_, s) => receive(2 + s * 5, 85, 15));
    const bad = Array.from({ length: 30 }, (_, s) => receive(2 + s * 5, 35, 25, 1.3));
    const spilt = bad.filter((r) => r.dist > TOUCH_SPILL);
    // eslint-disable-next-line no-console
    console.log(`poor touch, 25 m/s under pressure: ${spilt.length}/30 spilt, mean ${mean(bad.map((r) => r.dist)).toFixed(2)} m (spills ${mean(spilt.map((r) => r.dist)).toFixed(2)} m); good touch ${mean(good.map((r) => r.dist)).toFixed(2)} m`);
    expect(good.filter((r) => r.dist > TOUCH_SPILL).length).toBe(0);
    expect(spilt.length).toBeGreaterThanOrEqual(15);
    expect(mean(bad.map((r) => r.dist))).toBeGreaterThan(mean(good.map((r) => r.dist)) * 2.5);
    // A spill goes 1.5-3 m off him, not across the pitch.
    expect(mean(spilt.map((r) => r.dist))).toBeGreaterThan(1.4);
    expect(Math.max(...spilt.map((r) => r.dist))).toBeLessThanOrEqual(3.2);
  });

  it("the human's man gets cleaner touches with more pass assistance", () => {
    const rate = (assist: AssistLevel) => {
      const rs = Array.from({ length: 30 }, (_, s) => receive(3 + s * 11, 55, 21, 1.6, assist));
      return { d: mean(rs.map((r) => r.dist)), spills: rs.filter((r) => r.dist > TOUCH_SPILL).length };
    };
    const assisted = rate('assisted');
    const manual = rate('manual');
    // eslint-disable-next-line no-console
    console.log(`an average player on a 21 m/s ball, a man near: assisted ${assisted.d.toFixed(2)} m (${assisted.spills} spills) | manual ${manual.d.toFixed(2)} m (${manual.spills} spills)`);
    expect(assisted.d).toBeLessThan(manual.d * 0.8);
    expect(assisted.spills).toBeLessThan(manual.spills);
  });
});
