import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { STALL_S } from '../src/sim/ai';
import { DT } from '../src/sim/constants';
import { EMPTY_PAD, Match } from '../src/sim/match';
import { applyScenario } from '../src/sim/scenario';
import type { ScenarioSpec } from '../src/sim/types';

/**
 * The time-wasting exploit (QA, 2 Oct): a low or mid-block side (park-bus, counter) only screened the human's carrier
 * in his own half, so standing still on the ball there ran the clock down untouched (all 22 men stationary for 67 s
 * in a soak). Now a human carrier who gains no ground for STALL_S is closed down: the presser goes in, the cover with
 * him; before that the block holds its screen, and it never swarms him.
 */

/** The human's centre-mid on the ball at his formation spot in his own half, everyone else in shape, against `away`. */
function standOff(away: number, seed: number): { m: Match; carrier: number } {
  const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[away]), halfLength: 300, difficulty: 1.8, humanSide: 0, seed });
  const spec: ScenarioSpec = {
    id: 'stall', title: 'STALL', brief: '', clock: 10, seconds: 200, score: [0, 0], humanSide: 0, goal: 'lead', owner: { side: 0, slot: 6 },
  } as ScenarioSpec;
  applyScenario(m, spec);
  return { m, carrier: m.ball.owner };
}

function nearestAI(m: Match, carrier: number): number {
  const c = m.players[carrier];
  let best = Infinity;
  for (const p of m.teamPlayers(1)) if (!p.sentOff) best = Math.min(best, Math.hypot(p.pos.x - c.pos.x, p.pos.z - c.pos.z));
  return best;
}

describe('a human carrier standing on the ball in his own half', () => {
  for (const [away, style] of [[0, 'park-bus'], [4, 'counter'], [8, 'park-bus']] as const) {
    it(`is closed down by a ${style} side (${PRESET_CLUBS[away].short}) once he gains no ground for ${STALL_S} s, without a swarm`, () => {
      const { m, carrier } = standOff(away, 7 + away);
      const c = m.players[carrier];
      expect(c.side).toBe(0);
      expect(c.pos.x * m.attackDir(0)).toBeLessThan(0);
      let early = Infinity;
      let late = Infinity;
      let challenged = false;
      let crowd = 0;
      for (let i = 0; i < 14 * 60 && !challenged; i++) {
        m.step(DT, EMPTY_PAD);
        for (const e of m.drainEvents()) if ((e.type === 'tackle' || e.type === 'foul') && m.players[e.by]?.side === 1) challenged = true;
        if (m.ball.owner !== carrier) challenged = true;
        const t = (i + 1) * DT;
        const d = nearestAI(m, carrier);
        if (t > 1 && t < STALL_S - 0.3) early = Math.min(early, d);
        if (t > STALL_S) late = Math.min(late, d);
        crowd = Math.max(crowd, m.teamPlayers(1).filter((p) => Math.hypot(p.pos.x - c.pos.x, p.pos.z - c.pos.z) < 5).length);
      }
      // The screen first: nobody right on him before the stall count is up.
      expect(early).toBeGreaterThan(4);
      // Then the presser goes in, and something comes of it (a challenge, or the ball won).
      expect(late).toBeLessThan(2.6);
      expect(challenged).toBe(true);
      // The presser and his cover; never half the team.
      expect(crowd).toBeLessThanOrEqual(3);
    });
  }

  it('a carrier who keeps gaining ground is not hunted down for it (the screen holds)', () => {
    const { m, carrier } = standOff(0, 3);
    const c = m.players[carrier];
    const ad = m.attackDir(0);
    let nearest = Infinity;
    // Walking forward steadily (about 1 m/s up the pitch: 2 m every 2 s) for 6 s, still in his own half.
    for (let i = 0; i < 6 * 60; i++) {
      m.step(DT, { ...EMPTY_PAD, mx: ad * 0.25, mz: 0 });
      m.drainEvents();
      if (m.ball.owner !== carrier) break;
      if (c.pos.x * ad > -2) break;
      if (i * DT > 1) nearest = Math.min(nearest, nearestAI(m, carrier));
    }
    expect(nearest).toBeGreaterThan(3);
  });
});
