import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT } from '../src/sim/constants';
import { EMPTY_PAD, Match } from '../src/sim/match';
import { Commentator, clubCall, speak, speechAvailable, stopSpeech, surname, templateCount } from '../src/ui/commentary';

function newMatch(seed: number): Match {
  return new Match({
    home: makeTeam(PRESET_CLUBS[5]),
    away: makeTeam(PRESET_CLUBS[6]),
    halfLength: 120,
    difficulty: 2,
    humanSide: -1,
    seed,
  });
}

/** A whole AI v AI match, every event through the commentator. */
function commentate(seed: number) {
  const m = newMatch(seed);
  const c = new Commentator(() => 0.37);
  const lines: { type: string; text: string; priority: number; tag: string }[] = [];
  let steps = 0;
  while (m.phase !== 'fulltime' && steps < 60 * 60 * 10) {
    m.step(DT, EMPTY_PAD);
    steps++;
    for (const e of m.drainEvents()) {
      const l = c.line(e, m);
      if (l) lines.push({ type: e.type, text: l.text, priority: l.priority, tag: l.tag });
    }
    if (m.phase === 'halftime') m.continueSecondHalf();
    if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
  }
  return { m, lines };
}

describe('commentary', () => {
  it('has a broad template library', () => {
    expect(templateCount()).toBeGreaterThanOrEqual(60);
  });

  it('calls clubs by their short name', () => {
    expect(clubCall({ name: 'Lakemoor Sporting' })).toBe('Lakemoor');
    expect(clubCall({ name: 'Harbourne FC' })).toBe('Harbourne');
    expect(clubCall({ name: 'Cube City' })).toBe('Cube City');
    expect(clubCall({ name: 'Pixel Park FC' })).toBe('Pixel Park');
    expect(surname('I. Chunk')).toBe('Chunk');
  });

  it('commentates a whole match with filled-in lines', () => {
    for (const seed of [3, 11]) {
      const { m, lines } = commentate(seed);
      expect(m.phase).toBe('fulltime');
      const types = new Set(lines.map((l) => l.type));
      expect(types.has('kickoffReady')).toBe(true);
      expect(types.has('halftime')).toBe(true);
      expect(types.has('fulltime')).toBe(true);
      for (const l of lines) {
        expect(l.text.length).toBeGreaterThan(8);
        expect(l.text).not.toMatch(/[{}]|undefined|NaN/);
      }
      // Every goal gets a line naming its scorer, tagged with the goal's minute.
      const goals = lines.filter((l) => l.type === 'goal');
      expect(goals.length).toBe(m.goals.length);
      goals.forEach((l, i) => {
        const g = m.goals[i];
        expect(l.text).toContain(surname(g.name));
        expect(l.tag).toBe(`${g.minute}'`);
        expect(l.priority).toBe(5);
      });
    }
  });

  it('knows an own goal and an equaliser', () => {
    const m = newMatch(5);
    const c = new Commentator(() => 0);
    const def = m.teamPlayers(0)[3];
    m.score = [0, 1];
    m.goals.push({ side: 1, scorer: def.idx, name: def.def.name, minute: 30, own: true });
    const og = c.line({ type: 'goal', side: 1, scorer: def.idx, own: true }, m)!;
    expect(og.text.toLowerCase()).toContain('own');
    expect(og.text).toContain(surname(def.def.name));
    const fw = m.teamPlayers(0)[9];
    m.score = [1, 1];
    m.goals.push({ side: 0, scorer: fw.idx, name: fw.def.name, minute: 50, own: false });
    const eq = c.line({ type: 'goal', side: 0, scorer: fw.idx, own: false }, m)!;
    expect(eq.text).toMatch(/level|square|Game on/i);
  });

  it('speech is a no-op without a browser', () => {
    expect(speechAvailable()).toBe(false);
    expect(() => speak('GOAL! Chunk scores! 1-0', true)).not.toThrow();
    expect(() => stopSpeech()).not.toThrow();
  });
});
