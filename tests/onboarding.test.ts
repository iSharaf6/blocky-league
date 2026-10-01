import { describe, expect, it } from 'vitest';
import { DDA, ddaAssist, ddaRecord, defaultDda, normalizeDda, suggestEasy } from '../src/core/dda';
import {
  BASICS_STEPS, basicsDone, completeBasics, defaultOnboarding, featureOpen, heroOf, normalizeOnboarding, noteGoals, straightToBasics,
} from '../src/core/onboarding';
import { defaultSave, importSave } from '../src/core/save';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { BASICS, MOMENTS } from '../src/meta/moments';
import { Match } from '../src/sim/match';
import { applyScenario, judgeScenario } from '../src/sim/scenario';

/**
 * The first-visit campaign (LEARN THE BASICS → the first match → the first goal unlocks the modes), the
 * hidden ease (core/dda.ts), and staged drill setup. Actual taught-input completion is checked in
 * basicsPassing.test.ts and basicsFinishing.test.ts; a general match bot does not follow lesson cues.
 */

describe('onboarding state', () => {
  it('a fresh save starts the campaign with the modes locked', () => {
    const s = defaultSave();
    expect(s.onboarding).toEqual({ basics: 0, firstGoal: false, unlockSeen: false });
    expect(heroOf(s.onboarding!, 0)).toEqual({ kind: 'basics', step: 0 });
    for (const f of ['career', 'moments', 'run', 'blitz'] as const) expect(featureOpen(s.onboarding!, f)).toBe(false);
  });

  it('an old save (no onboarding blob) with a match played has everything open; one without matches starts the campaign', () => {
    expect(normalizeOnboarding(undefined, { played: 3, goalsFor: 0 })).toEqual({ basics: BASICS_STEPS, firstGoal: true, unlockSeen: true });
    expect(normalizeOnboarding(undefined, { played: 0, goalsFor: 0 })).toEqual(defaultOnboarding());
    const raw = JSON.stringify({ ...defaultSave(), onboarding: undefined, record: { played: 5, won: 2, drawn: 1, lost: 2, goalsFor: 7, goalsAgainst: 6 } });
    const back = importSave(raw)!;
    expect(back.onboarding!.firstGoal).toBe(true);
    // A new-build save keeps its own state, however many matches it has.
    expect(normalizeOnboarding({ basics: 3, firstGoal: false }, { played: 4 })).toEqual({ basics: 3, firstGoal: false, unlockSeen: false });
    // Damaged values are clamped.
    expect(normalizeOnboarding({ basics: 99, firstGoal: 'yes' }, null)).toEqual({ basics: 3, firstGoal: false, unlockSeen: false });
  });

  it('the hero tile walks basics 1..3, then the first match, then PLAY NOW', () => {
    const o = defaultOnboarding();
    expect(completeBasics(o, 0)).toBe(1);
    expect(heroOf(o, 0)).toEqual({ kind: 'basics', step: 1 });
    expect(completeBasics(o, 1)).toBe(2);
    expect(completeBasics(o, 2)).toBe(-1);
    expect(basicsDone(o)).toBe(true);
    expect(heroOf(o, 0)).toEqual({ kind: 'first' });
    // Replaying an earlier step never goes backwards.
    completeBasics(o, 0);
    expect(o.basics).toBe(3);
    expect(heroOf(o, 1)).toEqual({ kind: 'play' });
  });

  it('only a real goal unlocks: basics goals and goalless matches do not; it unlocks once', () => {
    const o = defaultOnboarding();
    expect(noteGoals(o, 'basics', 2)).toBe(false);
    expect(noteGoals(o, 'playnow', 0)).toBe(false);
    expect(o.firstGoal).toBe(false);
    expect(noteGoals(o, 'playnow', 1)).toBe(true);
    expect(featureOpen(o, 'career')).toBe(true);
    expect(noteGoals(o, 'quick', 3)).toBe(false);
  });

  it('portal builds go straight into step one on a first visit only', () => {
    const o = defaultOnboarding();
    expect(straightToBasics(o, 0, true)).toBe(true);
    expect(straightToBasics(o, 0, false)).toBe(false);
    expect(straightToBasics(o, 1, true)).toBe(false);
    completeBasics(o, 0);
    expect(straightToBasics(o, 0, true)).toBe(false);
  });
});

describe('the hidden ease (DDA)', () => {
  it('the first two real matches get the first-match ease; moments and basics never do', () => {
    const d = defaultDda();
    expect(ddaAssist(d, 0, 'playnow', 1)).toBe(DDA.first);
    expect(ddaAssist(d, 1, 'career', 1)).toBe(DDA.first);
    expect(ddaAssist(d, 2, 'career', 1)).toBe(0);
    expect(ddaAssist(d, 0, 'moment', 1)).toBe(0);
    expect(ddaAssist(d, 0, 'basics', 0)).toBe(0);
  });

  it('career: three defeats in a row ease the next matches until a win; a draw keeps it on, but breaks a shorter run', () => {
    const d = defaultDda();
    ddaRecord(d, 'career', 1, 'loss');
    ddaRecord(d, 'career', 1, 'loss');
    ddaRecord(d, 'career', 1, 'draw');
    expect(d.careerLosses).toBe(0);
    for (let i = 0; i < 3; i++) ddaRecord(d, 'career', 1, 'loss');
    expect(ddaAssist(d, 10, 'career', 1)).toBe(DDA.career);
    // Not in quick matches: that streak is the career's.
    expect(ddaAssist(d, 10, 'quick', 1)).toBe(0);
    ddaRecord(d, 'career', 1, 'draw');
    expect(ddaAssist(d, 10, 'career', 1)).toBe(DDA.career);
    ddaRecord(d, 'career', 1, 'win');
    expect(ddaAssist(d, 10, 'career', 1)).toBe(0);
  });

  it('quick match: three defeats in a row at one difficulty ease that difficulty, and suggest EASY', () => {
    const d = defaultDda();
    for (let i = 0; i < 2; i++) ddaRecord(d, 'quick', 2, 'loss');
    expect(suggestEasy(d, 'quick', 2, 'loss')).toBe(false);
    ddaRecord(d, 'playnow', 2, 'loss');
    expect(suggestEasy(d, 'playnow', 2, 'loss')).toBe(true);
    expect(ddaAssist(d, 10, 'quick', 2)).toBe(DDA.quick);
    expect(ddaAssist(d, 10, 'quick', 1)).toBe(0);
    // Easy already: the ease still helps, but there's nothing easier to suggest.
    for (let i = 0; i < 3; i++) ddaRecord(d, 'quick', 0, 'loss');
    expect(ddaAssist(d, 10, 'quick', 0)).toBe(DDA.quick);
    expect(suggestEasy(d, 'quick', 0, 'loss')).toBe(false);
    ddaRecord(d, 'quick', 2, 'win');
    expect(ddaAssist(d, 10, 'quick', 2)).toBe(0);
  });

  it('a damaged blob loads as no streaks', () => {
    expect(normalizeDda({ careerLosses: -3, quickLosses: 'x' })).toEqual(defaultDda());
    expect(normalizeDda({ careerLosses: 4.7, quickLosses: [1, 2] })).toEqual({ careerLosses: 4, quickLosses: [1, 2, 0, 0] });
  });
});

describe('LEARN THE BASICS drills', () => {
  it('three steps, not in the MOMENTS list, each with a prompt per step', () => {
    expect(BASICS.length).toBe(BASICS_STEPS);
    const ids = new Set(MOMENTS.map((m) => m.id));
    for (const b of BASICS) {
      expect(ids.has(b.id)).toBe(false);
      expect(b.spec.id).toBe(b.id);
      expect(b.lesson.length).toBeGreaterThan(0);
      expect(b.spec.untimed).toBe(true);
      expect(b.spec.offside).toBe(false);
    }
    expect(BASICS.map((b) => b.lesson[0].key)).toEqual(['pass', 'shoot', 'through']);
    expect(BASICS.map((b) => b.spec.goal)).toEqual(['complete-pass', 'score', 'score']);
  });

  it('the drills set up clean: only the players they need on the pitch, our man on the ball', () => {
    for (const b of BASICS) {
      const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 600, difficulty: 0.6, humanSide: 0, seed: 3 });
      applyScenario(m, b.spec);
      expect(m.players[m.ball.owner]?.side).toBe(0);
      expect(m.active).toBe(m.ball.owner);
      expect(m.onPitch(1).length).toBeLessThanOrEqual(2);
      expect(judgeScenario(m, b.spec)).toBeNull();
    }
  });

});
