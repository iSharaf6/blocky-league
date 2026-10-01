import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { BASICS } from '../src/meta/moments';
import { DT } from '../src/sim/constants';
import { EMPTY_PAD, Match } from '../src/sim/match';
import { applyScenario, judgeScenario } from '../src/sim/scenario';
import { Lesson } from '../src/ui/trainer';

const controls = { sx: 0, sy: 0, pass: false, shoot: false, through: false };
function setup(step: number) {
  const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]),
    halfLength: 600, difficulty: 0.6, humanSide: 0, seed: 1, assist: 0.8 });
  applyScenario(m, BASICS[step].spec);
  return { m, lesson: new Lesson(BASICS[step].lesson) };
}

describe('beginner lesson progression', () => {
  it('shows the first cue at a held setup and releases the same action into play', () => {
    const { m, lesson } = setup(0);
    expect(lesson.show(m, controls)?.key).toBe('pass');
    expect(lesson.hold(m, controls)).toBe(true);
    expect(lesson.hold(m, { ...controls, pass: true })).toBe(false);
    m.step(DT, { ...EMPTY_PAD, pass: true });
    expect(m.players[9].order?.kind).toBe('pass');
    expect(lesson.hold(m, controls)).toBe(false);
  });

  it('a shot does not skip the pass lesson', () => {
    const { m, lesson } = setup(0);
    m.ball.lastTouch = 9;
    lesson.event({ type: 'kick', kind: 'shot', x: 0, y: 0, z: 0, power: 0.5 }, m);
    expect(lesson.current?.key).toBe('pass');
  });

  it('waits for actual teammate control rather than acknowledging the pass launch', () => {
    const { m, lesson } = setup(0);
    let kicked = false, received = false;
    for (let i = 0; i < 180; i++) {
      m.step(DT, { ...EMPTY_PAD, pass: i < 5 });
      for (const e of m.drainEvents()) {
        lesson.event(e, m);
        if (e.type === 'kick' && e.kind === 'pass') {
          kicked = true;
          expect(lesson.current?.key).toBe('pass');
          expect(lesson.show(m, controls)).toBeNull();
        }
        if (e.type === 'control' && e.player === 10) received = true;
      }
      if (received) break;
    }
    expect(kicked).toBe(true);
    expect(received).toBe(true);
    expect(lesson.current).toBeNull();
  });

  it('a through-ball tap and a direct shot do not skip the cross lesson', () => {
    const { m, lesson } = setup(2);
    m.ball.lastTouch = 8;
    lesson.event({ type: 'kick', kind: 'through', x: 0, y: 0, z: 0, power: 0.5 }, m);
    lesson.event({ type: 'kick', kind: 'shot', x: 0, y: 0, z: 0, power: 0.5 }, m);
    expect(lesson.current?.key).toBe('through');
    lesson.event({ type: 'kick', kind: 'lob', x: 0, y: 0, z: 0, power: 0.5 }, m);
    expect(lesson.current?.key).toBe('shoot');
  });

  it('untimed drills neither fail at 30 seconds nor run into half-time', () => {
    const { m } = setup(1);
    // Advance the clock beyond both the old hidden timeout and the original half length.
    m.clock = 601;
    m.step(DT, EMPTY_PAD);
    expect(m.phase).toBe('play');
    expect(judgeScenario(m, BASICS[1].spec)).toBeNull();
  });

  it('sprint alone releases the recovery cue and can complete it', () => {
    const { m, lesson } = setup(1);
    lesson.event({ type: 'kick', kind: 'shot', x: 0, y: 0, z: 0, power: 0.5 }, m);
    m.ball.owner = -1;
    lesson.show(m, controls);
    m.clock = 1.3;
    expect(lesson.hold(m, controls)).toBe(true);
    expect(lesson.hold(m, { ...controls, sprint: true })).toBe(false);
    for (let i = 0; i < 30; i++) {
      m.clock += DT;
      lesson.show(m, { ...controls, sprint: true });
    }
    expect(lesson.current).toBeNull();
  });

  it('a direct goal cannot stand in for receiving the taught pass', () => {
    const { m } = setup(0);
    m.score[0]++;
    expect(judgeScenario(m, BASICS[0].spec)?.won).toBe(false);
  });

  it('losing possession and recovering it is not a completed pass', () => {
    const { m } = setup(0);
    for (let i = 0; i < 30 && m.kickId === 0; i++) m.step(DT, { ...EMPTY_PAD, pass: i < 5 });
    expect(m.passTarget).toBe(10);
    expect(judgeScenario(m, BASICS[0].spec)).toBeNull();
    m.ball.lastTouchSide = 1;
    m.ball.owner = 11;
    expect(judgeScenario(m, BASICS[0].spec)).toBeNull();
    m.ball.lastTouchSide = 0;
    m.ball.owner = 10;
    expect(judgeScenario(m, BASICS[0].spec)).toBeNull();
  });

  it('retrying the setup clears the prior pass attempt', () => {
    const { m } = setup(0);
    for (let i = 0; i < 30 && m.kickId === 0; i++) m.step(DT, { ...EMPTY_PAD, pass: i < 5 });
    expect(m.passTarget).toBe(10);
    expect(judgeScenario(m, BASICS[0].spec)).toBeNull();
    applyScenario(m, BASICS[0].spec);
    m.ball.owner = 10;
    expect(judgeScenario(m, BASICS[0].spec)).toBeNull();
  });
});
