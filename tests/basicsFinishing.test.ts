import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { BASICS } from '../src/meta/moments';
import { DT } from '../src/sim/constants';
import { EMPTY_PAD, Match, type Pad } from '../src/sim/match';
import { applyScenario, judgeScenario, type ScenarioOutcome } from '../src/sim/scenario';
import type { MatchEvent } from '../src/sim/types';
import { Lesson } from '../src/ui/trainer';

const clubs = [0, 5, 10];
const seeds = [1, 2, 3, 5, 7, 11, 21, 37, 42, 79];
const cases = clubs.flatMap((club) => seeds.map((seed) => ({ club, seed })));

function practice(step: number, club: number, seed: number) {
  const m = new Match({
    home: makeTeam(PRESET_CLUBS[club]), away: makeTeam(PRESET_CLUBS[6]),
    halfLength: 600, difficulty: 0.6, humanSide: 0, seed, assist: 0.8,
  });
  const spec = BASICS[step].spec;
  applyScenario(m, spec);
  const lesson = new Lesson(BASICS[step].lesson);
  const events: MatchEvent[] = [];
  let outcome: ScenarioOutcome | null = judgeScenario(m, spec);
  let heldFrames = 0;
  const tick = (pad: Pad): boolean => {
    if (lesson.hold(m, { sx: pad.mx, sy: pad.mz, pass: pad.pass, shoot: pad.shoot, through: pad.through, sprint: pad.sprint })) {
      heldFrames++;
      return false;
    }
    m.step(DT, pad);
    const next = m.drainEvents();
    events.push(...next);
    for (const e of next) lesson.event(e, m);
    outcome = judgeScenario(m, spec);
    return true;
  };
  return { m, lesson, events, tick, outcome: () => outcome, heldFrames: () => heldFrames };
}

describe('the shooting lesson with a short ordinary hold', () => {
  it.each(cases.flatMap((c) => [0.25, 0.35].map((hold) => ({ ...c, hold }))))
  ('reaches a goal within three ordinary tries with a $hold-second hold, club $club, seed $seed', ({ club, seed, hold }) => {
    let winning: ReturnType<typeof practice> | null = null;
    const release = Math.ceil(hold / DT - 1e-6);
    // The live tutorial resets a miss for another free try. Shot dispersion can miss an open goal,
    // so prove eventual real completion rather than counting a fired shot as a successful lesson.
    for (let attempt = 0; attempt < 3 && !winning; attempt++) {
      const p = practice(1, club, seed + attempt);
      expect(p.tick(EMPTY_PAD)).toBe(false);
      expect(p.m.clock).toBe(0);
      for (let i = 0; i < 600 && !p.outcome(); i++) {
        const shoot = i < release;
        // A rebound's SPRINT cue may pause the picture; use its ordinary button if it appears.
        const sprint = p.lesson.show(p.m, null)?.key === 'sprint';
        p.tick({ ...EMPTY_PAD, shoot, sprint });
      }
      expect(p.events.some((e) => e.type === 'kick' && e.kind === 'shot')).toBe(true);
      expect(p.events.some((e) => e.type === 'offside')).toBe(false);
      if (p.outcome()?.won) winning = p;
      else {
        expect(p.events.some((e) => e.type === 'goal' && e.side === 0)).toBe(false);
        expect(p.outcome()).toBeNull();
      }
    }
    expect(winning).not.toBeNull();
    expect(winning!.events.some((e) => e.type === 'kick' && e.kind === 'shot')).toBe(true);
    expect(winning!.events.some((e) => e.type === 'goal' && e.side === 0)).toBe(true);
    expect(winning!.outcome()?.won).toBe(true);
    expect(winning!.m.score[0]).toBe(1);
  });
});

describe('the crossing lesson with the taught two-button sequence', () => {
  it.each(cases)('crosses, reads the incoming cue, then finishes, club $club, seed $seed', ({ club, seed }) => {
    const p = practice(2, club, seed);
    expect(p.tick(EMPTY_PAD)).toBe(false);
    let lobAt = -1;
    let heldClock = -1;
    for (let i = 0; i < 600 && !p.outcome(); i++) {
      const t = i * DT;
      const shoot = lobAt >= 0 && t >= lobAt + 0.3 && t < lobAt + 0.3 + 5 * DT;
      const stepped = p.tick({ ...EMPTY_PAD, through: t < 0.7, shoot });
      if (lobAt < 0 && p.events.some((e) => e.type === 'kick' && e.kind === 'lob')) {
        lobAt = t;
        heldClock = p.m.clock;
        expect(p.lesson.current?.done).toBe('shot');
        expect(p.outcome()).toBeNull();
      } else if (lobAt >= 0 && !stepped) {
        expect(p.lesson.current?.when).toBe('incoming');
        expect(p.m.clock).toBe(heldClock);
      }
    }
    expect(lobAt).toBeGreaterThanOrEqual(0);
    expect(p.heldFrames()).toBeGreaterThanOrEqual(15);
    expect(p.events.some((e) => e.type === 'kick' && (e.kind === 'header' || e.kind === 'shot'))).toBe(true);
    expect(p.events.some((e) => e.type === 'goal' && e.side === 0)).toBe(true);
    expect(p.outcome()?.won).toBe(true);
    expect(p.m.score[0]).toBe(1);
    expect(p.lesson.current).toBeNull();
    expect(p.events.some((e) => e.type === 'offside')).toBe(false);
  });

  it('cannot finish the cross lesson by dribbling in and scoring a direct shot', () => {
    const p = practice(2, 5, 1);
    // Ordinary movement takes the winger inside; the game must still require the taught cross.
    for (let i = 0; i < 240 && p.m.players[p.m.active].pos.z > 3; i++) {
      p.tick({ ...EMPTY_PAD, mz: -1 });
    }
    for (let i = 0; i < 300 && !p.outcome(); i++) {
      p.tick({ ...EMPTY_PAD, shoot: i * DT < 0.35 });
    }
    expect(p.events.some((e) => e.type === 'kick' && e.kind === 'lob')).toBe(false);
    expect(p.events.some((e) => e.type === 'kick' && e.kind === 'shot')).toBe(true);
    expect(p.events.some((e) => e.type === 'goal' && e.side === 0)).toBe(true);
    expect(p.outcome()?.won).toBe(false);
    expect(p.lesson.current?.done).toBe('cross');
  });

  it('keeps an early finish queued until a longer cross actually reaches the weaker runner', () => {
    const p = practice(2, 0, 7);
    let crossAt = -1;
    let queuedAfterOldLimit = false;
    for (let i = 0; i < 360 && !p.outcome(); i++) {
      const t = i * DT;
      const shoot = crossAt >= 0 && t <= crossAt + 5 * DT;
      p.tick({ ...EMPTY_PAD, through: t < 0.3, shoot });
      if (crossAt < 0 && p.events.some((e) => e.type === 'kick' && e.kind === 'lob')) crossAt = t;
      const runner = p.m.teamPlayers(0).find((player) => player.slot === 9)!;
      if (p.m.sinceKick > 1.4 && runner.order?.firstTime && runner.order.kind === 'shot') queuedAfterOldLimit = true;
    }
    expect(queuedAfterOldLimit).toBe(true);
    expect(p.events.some((e) => e.type === 'kick' && (e.kind === 'header' || e.kind === 'shot'))).toBe(true);
    expect(p.events.some((e) => e.type === 'goal' && e.side === 0)).toBe(true);
    expect(p.outcome()?.won).toBe(true);
  });
});
