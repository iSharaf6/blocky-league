import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT } from '../src/sim/constants';
import { EMPTY_PAD, Match } from '../src/sim/match';
import { Commentator } from '../src/ui/commentary';

declare const process: { getBuiltinModule(id: 'node:fs'): { readFileSync(path: string, enc: 'utf8'): string } };
const { readFileSync } = process.getBuiltinModule('node:fs');

// CrazyGames' QA, 22 October: at the first match's start THIS IS YOU sat on the man it introduced (every teammate with
// a blue ring, the card saying "the BLUE ring"), Space cleared it, then a second PRESS SPACE TO KICK OFF came up; and
// the commentary said "And we're under way!" while that prompt was still waiting.

function firstMatch(seed = 1): Match {
  return new Match({
    home: makeTeam(PRESET_CLUBS[0]), away: makeTeam(PRESET_CLUBS[6]),
    halfLength: 600, difficulty: 0.6, humanSide: 0, seed, assist: 0.8, firstMatch: true,
  });
}

describe('the first kick-off', () => {
  it('the commentary waits for the kick: nothing while PRESS SPACE TO KICK OFF waits, the kick-off line as the ball is played', () => {
    for (const seed of [1, 2, 3]) {
      const m = firstMatch(seed);
      const c = new Commentator(() => 0.37);
      const said: { text: string; phase: string; frame: number }[] = [];
      let kicked = -1;
      for (let i = 0; i < 60 * 8; i++) {
        // Five seconds waiting on him (the first match's kick-off waits for his button, however long), then SPACE.
        const press = i >= 300 && i < 303;
        m.step(DT, { ...EMPTY_PAD, pass: press });
        for (const e of m.drainEvents()) {
          if (e.type === 'kick' && kicked < 0) kicked = i;
          const l = c.line(e, m);
          if (l) said.push({ text: l.text, phase: m.phase, frame: i });
        }
        // (The set-up's own kickoffReady comes out with the first step's events.)
      }
      expect(kicked).toBeGreaterThanOrEqual(300);
      const first = said[0];
      expect(first, `seed ${seed}`).toBeDefined();
      // Nothing at all said before the kick; the kick-off line comes with it.
      expect(first.frame).toBeGreaterThanOrEqual(kicked);
      expect(first.frame).toBeLessThan(kicked + 30);
      expect(first.phase).toBe('play');
      expect(first.text).toMatch(/under way|get us started|kick off|We're off/);
    }
  });

  it('the set-up event itself says nothing (it is held for the kick)', () => {
    const m = firstMatch();
    const c = new Commentator(() => 0.37);
    expect(m.phase).toBe('kickoff');
    expect(c.line({ type: 'kickoffReady', side: 0 }, m)).toBeNull();
    // Still waiting on him: whatever else happens, no kick-off line.
    expect(c.line({ type: 'whistle', kind: 'start' } as never, m)).toBeNull();
  });

  it('the kick-off prompt is solid from its first frame and carries THIS IS YOU with a pointer to the taker', () => {
    const css = readFileSync('src/ui/coach.css', 'utf8');
    const rule = (sel: string) => {
      const i = css.indexOf(`${sel} {`);
      expect(i, sel).toBeGreaterThanOrEqual(0);
      return css.slice(i, css.indexOf('}', i));
    };
    // (No fade in: opacity 1 the frame it is on, never see-through.)
    const on = rule('.hud .hud-kick.on');
    expect(on).toMatch(/opacity: 1;/);
    expect(on).toMatch(/transition: none;/);
    expect(rule('.hud .hud-kick')).toMatch(/background: var\(--coach-bg\);/);
    expect(css).toMatch(/--coach-bg: rgb\(38, 38, 46\);/);
    expect(rule('.hud .hud-kick.you .kk-ptr')).toMatch(/border-top: 14px solid var\(--coach-gold\);/);
    const hud = readFileSync('src/ui/hud.ts', 'utf8');
    expect(hud).toMatch(/const KICK_PTR = 14;/);
    expect(hud).toMatch(/<b class="kk-you" hidden><\/b>/);
    // The old card over the man is gone, and nothing names a ring colour any more.
    const session = readFileSync('src/game/matchSession.ts', 'utf8');
    expect(session).not.toMatch(/hud\.show\('THIS IS YOU'/);
    expect(session).not.toMatch(/ring\. Move with/);
    expect(session).toMatch(/you: this\.firstYou \? 'THIS IS YOU' : null/);
  });
});
