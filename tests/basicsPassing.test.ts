import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { BASICS, MOMENTS } from '../src/meta/moments';
import { DT } from '../src/sim/constants';
import { EMPTY_PAD, Match, type Pad } from '../src/sim/match';
import { applyScenario, judgeScenario } from '../src/sim/scenario';
import { Lesson } from '../src/ui/trainer';

function practice(club: number, seed: number): Match {
  const m = new Match({
    home: makeTeam(PRESET_CLUBS[club]), away: makeTeam(PRESET_CLUBS[6]),
    halfLength: 600, difficulty: 0.6, humanSide: 0, seed, assist: 0.8,
  });
  applyScenario(m, BASICS[0].spec);
  return m;
}

const cases = [0, 5, 10].flatMap((club) => [0, 0.5, 3, 10].flatMap((wait) =>
  [false, true].flatMap((aimed) => [1, 7, 42].map((seed) => ({ club, wait, aimed, seed })))));

describe('the first passing lesson with ordinary controls', () => {
  it.each(cases)('club $club, seed $seed, wait $wait seconds, aimed $aimed', ({ club, seed, wait, aimed }) => {
    const m = practice(club, seed);
    const lesson = new Lesson(BASICS[0].lesson);
    const carrier = m.ball.owner;
    const receiver = m.teamPlayers(0).find((p) => p.slot === 10)!;
    const initial = m.players.map((p) => ({ x: p.pos.x, z: p.pos.z }));
    const controls = (pad: Pad) => ({ sx: pad.mx, sy: pad.mz, pass: pad.pass, shoot: pad.shoot, through: pad.through });

    // MatchSession uses this same hold before stepping. Real time spent reading must not let the
    // free teammate run behind the passer and disappear from the neutral assisted pass selection.
    for (let i = 0; i < Math.round(wait / DT); i++) {
      expect(lesson.hold(m, controls(EMPTY_PAD))).toBe(true);
    }
    expect(m.clock).toBe(0);
    expect(m.players.map((p) => ({ x: p.pos.x, z: p.pos.z }))).toEqual(initial);
    expect(judgeScenario(m, BASICS[0].spec)).toBeNull();

    const dx = receiver.pos.x - m.players[carrier].pos.x;
    const dz = receiver.pos.z - m.players[carrier].pos.z;
    const distance = Math.hypot(dx, dz);
    let kickSeen = false;
    let controlSeen = false;
    let completed = false;
    const events: string[] = [];
    for (let i = 0; i < 180 && !completed; i++) {
      const pass = i < 5; // An ordinary 83 ms key or touch tap, then leave the movement alone.
      const pad = { ...EMPTY_PAD, pass, mx: aimed && pass ? dx / distance : 0, mz: aimed && pass ? dz / distance : 0 };
      expect(lesson.hold(m, controls(pad))).toBe(false);
      m.step(DT, pad);
      for (const e of m.drainEvents()) {
        events.push(e.type);
        lesson.event(e, m);
        if (e.type === 'kick' && e.kind === 'pass') {
          kickSeen = true;
          expect(m.passTarget).toBe(receiver.idx);
          expect(m.ball.owner).toBe(-1);
          expect(lesson.current?.done).toBe('pass');
        }
        if (e.type === 'control' && e.player === receiver.idx) controlSeen = true;
      }
      const outcome = judgeScenario(m, BASICS[0].spec);
      if (!controlSeen) expect(outcome).toBeNull();
      if (outcome) {
        expect(outcome.won).toBe(true);
        expect(controlSeen).toBe(true);
        completed = true;
      }
    }
    expect(events).not.toContain('offside');
    expect(kickSeen).toBe(true);
    expect(controlSeen).toBe(true);
    expect(completed).toBe(true);
    expect(m.ball.owner).toBe(receiver.idx);
    expect(lesson.current).toBeNull();
  });

  it('limits the offside exception to the staged drills', () => {
    const m = practice(5, 1);
    expect(m.offside).toBe(false);
    applyScenario(m, MOMENTS[0].spec);
    expect(m.offside).toBe(true);
    const ordinary = new Match({
      home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]),
      halfLength: 600, difficulty: 0.6, humanSide: 0,
    });
    expect(ordinary.offside).toBe(true);
  });

  it.each([0, 5, 10].flatMap((club) => [0, 0.5].flatMap((wait) =>
    [1, 7, 42].map((seed) => ({ club, wait, seed })))))
  ('receives a neutral pass after $wait live seconds, club $club, seed $seed', ({ club, wait, seed }) => {
    const m = practice(club, seed);
    const receiver = m.teamPlayers(0).find((p) => p.slot === 10)!;
    let controlled = false;
    let complete = false;
    judgeScenario(m, BASICS[0].spec);
    for (let i = 0; i < Math.round((wait + 4) / DT) && !complete; i++) {
      const t = i * DT;
      m.step(DT, { ...EMPTY_PAD, pass: t >= wait && t < wait + 0.08 });
      for (const e of m.drainEvents()) {
        expect(e.type).not.toBe('offside');
        if (e.type === 'control' && e.player === receiver.idx) controlled = true;
      }
      const outcome = judgeScenario(m, BASICS[0].spec);
      if (outcome) {
        expect(controlled).toBe(true);
        expect(outcome.won).toBe(true);
        complete = true;
      }
    }
    expect(controlled).toBe(true);
    expect(complete).toBe(true);
  });
});
