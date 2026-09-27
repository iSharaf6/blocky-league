import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT } from '../src/sim/constants';
import { EMPTY_PAD, Match } from '../src/sim/match';
import type { MatchEvent } from '../src/sim/types';
import * as commentary from '../src/ui/commentary';
import { Commentator, clubCall, surname, templateCount } from '../src/ui/commentary';

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

  it('gives shared surnames an initial', () => {
    const pitch = ['L. Santos', 'T. Santos', 'A. Chunk'];
    expect(surname('L. Santos', pitch)).toBe('L. Santos');
    expect(surname('T. Santos', pitch)).toBe('T. Santos');
    expect(surname('A. Chunk', pitch)).toBe('Chunk');
    expect(surname('Luis Santos', ['Luis Santos', 'Tiago Santos'])).toBe('L. Santos');
    // A sub coming on (not in the list yet) still clashes with the Santos already out there.
    expect(surname('P. Santos', ['T. Santos'])).toBe('P. Santos');
    expect(surname('L. Santos')).toBe('Santos');
  });

  it('never leaves you guessing which Santos', () => {
    const m = newMatch(7);
    const a = m.teamPlayers(0)[9];
    const b = m.teamPlayers(1)[4];
    a.def = { ...a.def, name: 'L. Santos' };
    b.def = { ...b.def, name: 'T. Santos' };
    const c = new Commentator(() => 0);
    const foul = c.line({ type: 'foul', by: b.idx, on: a.idx, penalty: false }, m)!;
    expect(foul.text).toContain('T. Santos');
    expect(foul.text).toContain('L. Santos');
    const card = c.line({ type: 'card', player: b.idx, color: 'yellow' }, m)!;
    expect(card.text).toContain('T. Santos');
  });

  it('calls chips and finesse finishes', () => {
    const m = newMatch(9);
    const c = new Commentator(() => 0);
    const fw = m.teamPlayers(0)[9];
    m.ball.lastTouch = fw.idx;
    const kick = (style: string) => ({ type: 'kick', power: 0.5, x: 30, y: 0.2, z: 2, kind: 'shot', style }) as unknown as MatchEvent;
    const tryLine = c.line(kick('chip'), m)!;
    expect(tryLine.text).toMatch(/chip|dinks/i);
    m.score = [1, 0];
    m.goals.push({ side: 0, scorer: fw.idx, name: fw.def.name, minute: 20, own: false });
    const goal = c.line({ type: 'goal', side: 0, scorer: fw.idx, own: false }, m)!;
    expect(goal.text).toMatch(/chip|lifts|dinks/i);
    expect(goal.text).toContain(surname(fw.def.name));
    c.line(kick('finesse'), m);
    m.score = [2, 0];
    m.goals.push({ side: 0, scorer: fw.idx, name: fw.def.name, minute: 30, own: false });
    const curl = c.line({ type: 'goal', side: 0, scorer: fw.idx, own: false }, m)!;
    expect(curl.text).toMatch(/curl|bent|bends|wraps/i);
    // No style: the ordinary lines.
    const plain = c.line({ type: 'kick', power: 0.9, x: 30, y: 0.2, z: 2, kind: 'shot' }, m);
    expect(plain?.text ?? '').not.toMatch(/chip|curl/i);
  });

  it('is text only: the spoken voice is gone (the owner asked for the voice to go, the ticker to stay)', () => {
    expect('speak' in commentary).toBe(false);
    expect('stopSpeech' in commentary).toBe(false);
    expect('speechAvailable' in commentary).toBe(false);
  });
});
