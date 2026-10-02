import { describe, expect, it } from 'vitest';
import { Trainer, learnCue } from '../src/ui/trainer';

/** The owner: the trainer "takes a big chunk of the screen". It fades as he learns (ui/trainer.ts learnCue). */
describe('the trainer gets quieter as he learns', () => {
  const onBall = { title: 'ON THE BALL', actions: [['SPACE', 'Pass'], ['K', 'Shoot']] as [string, string][], detail: 'Hold L to cross' };
  const beat = { title: 'BEAT HIM', actions: [['Q', 'Skill now']] as [string, string][] };

  it('a routine card: in full (no detail line) at first, then the keys alone, then nothing', () => {
    Trainer.resetLearned();
    const first = learnCue(onBall, true);
    expect(first).toEqual({ title: 'ON THE BALL', actions: onBall.actions });
    // Redrawing the same appearance doesn't count again.
    for (let i = 0; i < 50; i++) learnCue(onBall, false);
    expect(learnCue(onBall, false)?.actions[0][1]).toBe('Pass');
    for (let i = 1; i < 20; i++) learnCue(onBall, true);
    expect(learnCue(onBall, true)).toEqual({ title: 'ON THE BALL', actions: [['SPACE', ''], ['K', '']] });
    for (let i = 21; i < 80; i++) learnCue(onBall, true);
    expect(learnCue(onBall, true)).toBeNull();
  });

  it('a moment-to-moment card (BEAT HIM) goes to the keys but never away', () => {
    Trainer.resetLearned();
    for (let i = 0; i < 200; i++) learnCue(beat, true);
    expect(learnCue(beat, true)).toEqual({ title: 'BEAT HIM', actions: [['Q', '']] });
  });

  it('switching the trainer back on brings every card back in full', () => {
    for (let i = 0; i < 100; i++) learnCue(onBall, true);
    expect(learnCue(onBall, false)).toBeNull();
    Trainer.resetLearned();
    expect(learnCue(onBall, true)?.actions[0][1]).toBe('Pass');
  });
});
