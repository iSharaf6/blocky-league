import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT, HALF_W } from '../src/sim/constants';
import { EMPTY_PAD, Match } from '../src/sim/match';

// Playtest (LEARN THE BASICS, the SHOOT drill): the keeper saved, the ball went out for a throw-in, and nobody
// took it; the drill had to be quit. The drill's AI side is only its keeper, and the taker used to fall back to a
// sent-off player (off the pitch, driven by nothing), so the restart waited for ever.
describe('a side down to its keeper still takes its restarts', () => {
  for (const side of [0, 1] as const) {
    it(`throw-in for side ${side} with every outfield man sent off`, () => {
      const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 150, difficulty: 1.8, humanSide: 0, seed: 7 });
      for (const p of m.teamPlayers(side)) if (!p.isKeeper) m.sendOff(p);
      Object.assign(m, { phase: 'play', restart: null });
      m.ball.reset(5, HALF_W + 0.4);
      m.ball.lastTouchSide = side === 0 ? 1 : 0;
      m.ball.lastTouch = side === 0 ? 12 : 1;
      let taker = -1;
      let backInPlay = false;
      for (let i = 0; i < 60 * 12 && !backInPlay; i++) {
        m.step(DT, EMPTY_PAD);
        if (m.phase === 'restart' && m.restart) taker = m.restart.taker;
        if (taker >= 0 && m.phase === 'play') backInPlay = true;
      }
      expect(taker).toBeGreaterThanOrEqual(0);
      expect(m.players[taker].sentOff).toBe(false);
      expect(m.players[taker].isKeeper).toBe(true);
      // The human's side takes it on its own after its window; the AI's at once. Either way, play goes on.
      expect(backInPlay).toBe(true);
    });
  }
});
