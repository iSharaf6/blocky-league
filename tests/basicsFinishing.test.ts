import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { BASICS } from '../src/meta/moments';
import { DT } from '../src/sim/constants';
import { EMPTY_PAD, Match, type Pad } from '../src/sim/match';
import { applyScenario, judgeScenario, type ScenarioOutcome } from '../src/sim/scenario';
import type { MatchEvent } from '../src/sim/types';
import { Lesson, lessonFailText } from '../src/ui/trainer';

const clubs = [0, 5, 10];
const seeds = [1, 2, 3, 5, 7, 11, 21, 37, 42, 79];
const cases = clubs.flatMap((club) => seeds.map((seed) => ({ club, seed })));

/** `drillInput` false: the pad goes to the sim as given (a test of the sim's own assists, not of the drill's input). */
function practice(step: number, club: number, seed: number, drillInput = true) {
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
  const tick = (raw: Pad): boolean => {
    if (lesson.hold(m, { sx: raw.mx, sy: raw.mz, pass: raw.pass, shoot: raw.shoot, through: raw.through, sprint: raw.sprint })) {
      heldFrames++;
      return false;
    }
    // (The drill's buttons, as the session hands them to the sim: game/matchSession.ts buildPad.)
    const pad = drillInput ? lesson.filterPad(raw, m) : raw;
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
    let heldAfterCross = 0;
    for (let i = 0; i < 600 && !p.outcome(); i++) {
      const t = i * DT;
      const shoot = lobAt >= 0 && t >= lobAt + 0.3 && t < lobAt + 0.3 + 5 * DT;
      const stepped = p.tick({ ...EMPTY_PAD, through: t < 0.7, shoot });
      if (lobAt < 0 && p.events.some((e) => e.type === 'kick' && e.kind === 'lob')) {
        lobAt = t;
        expect(p.lesson.current?.done).toBe('shot');
        expect(p.lesson.progress()).toEqual({ n: 2, of: 2, name: 'FINISH' });
        expect(p.outcome()).toBeNull();
      } else if (lobAt >= 0 && !stepped) heldAfterCross++;
    }
    expect(lobAt).toBeGreaterThanOrEqual(0);
    // The cross is never frozen in the air (CrazyGames' review read that as a stuck game): it flies on, slowed instead.
    expect(heldAfterCross).toBe(0);
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
    // (main.ts ends the attempt at the strike itself, and the AGAIN! line says why.)
    expect(p.lesson.verdict).toBe('crossFirst');
    expect(lessonFailText(p.lesson.failReason(), 'keyboard')).toBe('CROSS FIRST. HOLD L, THEN LET GO');
  });

  it('keeps an early finish queued until a longer cross actually reaches the weaker runner', () => {
    // (The sim's queue: the 0.3 s tap as the sim gets it, not held on to a stronger cross by the drill's input.)
    const p = practice(2, 0, 7, false);
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

describe('the crossing drill, played the way the prompts say and every wrong way (CrazyGames review, 21 October)', () => {
  /** The drill's input as a player gives it: `pad(t, p)` each frame (t: s since the start), until it settles. */
  function play(seed: number, pad: (t: number, p: ReturnType<typeof practice>) => Partial<Pad>, frames = 600) {
    const p = practice(2, 0, seed);
    const winger = p.m.active;
    let calls: string[] = [];
    let slowest = 1;
    for (let i = 0; i < frames && !p.outcome() && !p.lesson.verdict; i++) {
      p.tick({ ...EMPTY_PAD, ...pad(i * DT, p) });
      const f = p.lesson.finishCall(p.m);
      if (f && calls[calls.length - 1] !== f.phase) calls = [...calls, f.phase];
      slowest = Math.min(slowest, p.lesson.pace(p.m));
      // A dead ball ends the attempt (main.ts basicsWatch): the reason is read then.
      if (p.m.phase === 'out' || p.m.phase === 'restart') {
        p.lesson.ended('dead');
        break;
      }
    }
    return { ...p, winger, calls, slowest };
  }

  it('passes when K is pressed at PRESS K NOW: STEP 1 OF 2 CROSS, NOW FINISH WITH the runner, PRESS K NOW, slowed', () => {
    for (const seed of [1, 2, 3, 5, 7]) {
      let pressAt = -1;
      const p = play(seed, (t, q) => {
        if (pressAt < 0 && q.lesson.finishCall(q.m)?.phase === 'now') pressAt = t;
        return { through: t < 0.7, shoot: pressAt >= 0 && t < pressAt + 5 * DT };
      });
      expect(p.outcome()?.won).toBe(true);
      expect(p.lesson.verdict).toBeNull();
      expect(p.calls).toEqual(['switch', 'now']);
      expect(p.slowest).toBeLessThan(0.5);
      expect(p.lesson.current).toBeNull();
    }
  });

  it('keeps control on the crosser: SWITCH (and PASS) does nothing until the cross is away', () => {
    const p = practice(2, 0, 1);
    const winger = p.m.active;
    for (let i = 0; i < 90; i++) {
      p.tick({ ...EMPTY_PAD, pass: i % 6 < 3 });
      expect(p.m.active).toBe(winger);
      expect(p.m.ball.owner).toBe(winger);
    }
    expect(p.events.some((e) => e.type === 'kick')).toBe(false);
    expect(p.lesson.current?.step).toBe('CROSS');
    // The card's title says where he is in the drill.
    expect(p.lesson.progress()).toEqual({ n: 1, of: 2, name: 'CROSS' });
  });

  it('a quick THROUGH tap in the CROSS step is a cross, not a through ball, and control then moves to the runner', () => {
    const p = practice(2, 0, 1);
    const winger = p.m.active;
    for (let i = 0; i < 120 && !p.events.some((e) => e.type === 'kick'); i++) p.tick({ ...EMPTY_PAD, through: i < 6 });
    const kick = p.events.find((e) => e.type === 'kick');
    expect(kick?.type === 'kick' && kick.kind).toBe('lob');
    expect(p.m.active).not.toBe(winger);
    expect(p.lesson.current?.step).toBe('FINISH');
    expect(p.lesson.finishCall(p.m)).toEqual({ phase: 'switch', runner: p.m.active });
  });

  it('dribbled over the byline: THE BALL WENT OUT. CROSS BEFORE THE BYLINE', () => {
    const p = play(1, () => ({ mx: 1, mz: 0.15, sprint: true }), 900);
    expect(p.m.phase === 'out' || p.m.phase === 'restart').toBe(true);
    expect(p.lesson.failReason()).toBe('crossOut');
    expect(lessonFailText(p.lesson.failReason(), 'keyboard')).toBe('THE BALL WENT OUT. CROSS BEFORE THE BYLINE');
  });

  it('a shot from the wing before the cross ends it at the strike: CROSS FIRST. HOLD L, THEN LET GO', () => {
    const p = play(1, (t) => ({ shoot: t < 0.3 }));
    expect(p.lesson.verdict).toBe('crossFirst');
    expect(lessonFailText(p.lesson.failReason(), 'keyboard')).toBe('CROSS FIRST. HOLD L, THEN LET GO');
    expect(lessonFailText(p.lesson.failReason(), 'touch')).toBe('CROSS FIRST. HOLD THROUGH, THEN LET GO');
    expect(lessonFailText(p.lesson.failReason(), 'gamepad')).toBe('CROSS FIRST. HOLD X, THEN LET GO');
  });

  it('K pressed while L is still held (a chip from the wing): LET GO OF L TO CROSS, THEN PRESS K', () => {
    const p = play(1, (t) => ({ through: t < 0.6, shoot: t > 0.2 && t < 0.3 }));
    expect(p.lesson.verdict).toBe('crossLetGo');
    expect(lessonFailText(p.lesson.failReason(), 'keyboard')).toBe('LET GO OF L TO CROSS, THEN PRESS K');
    expect(lessonFailText(p.lesson.failReason(), 'touch')).toBe('LET GO OF THROUGH TO CROSS, THEN TAP SHOOT');
  });

  it('crossed and K never pressed: the runner takes it down, PRESS K AS THE BALL ARRIVES', () => {
    for (const seed of [1, 2, 3]) {
      const p = play(seed, (t) => ({ through: t < 0.7 }));
      expect(p.outcome()?.won ?? false).toBe(false);
      expect(p.lesson.failReason()).toBe('finishLate');
      expect(lessonFailText(p.lesson.failReason(), 'keyboard')).toBe('PRESS K AS THE BALL ARRIVES');
      expect(lessonFailText(p.lesson.failReason(), 'touch')).toBe('TAP SHOOT AS THE BALL ARRIVES');
    }
  });

  it('a cross that never reaches the runner, and a finish that misses, each say so', () => {
    const missed = practice(2, 0, 1);
    missed.m.ball.lastTouch = missed.m.active;
    missed.lesson.event({ type: 'kick', kind: 'lob', x: 0, y: 0, z: 0, power: 0.5 }, missed.m);
    missed.lesson.ended('dead');
    expect(lessonFailText(missed.lesson.failReason(), 'keyboard')).toBe('THE CROSS MISSED YOUR RUNNER');
    const wide = practice(2, 0, 1);
    wide.m.ball.lastTouch = wide.m.active;
    wide.lesson.event({ type: 'kick', kind: 'lob', x: 0, y: 0, z: 0, power: 0.5 }, wide.m);
    wide.lesson.event({ type: 'kick', kind: 'header', x: 0, y: 0, z: 0, power: 0.5 }, wide.m);
    wide.lesson.ended('dead');
    expect(lessonFailText(wide.lesson.failReason(), 'keyboard')).toBe('SHOT MISSED. TRY AGAIN');
  });

  it('every retry starts the same: the winger on the ball, step 1, nothing carried over', () => {
    const a = practice(2, 0, 1);
    for (let i = 0; i < 60; i++) a.tick({ ...EMPTY_PAD, through: i < 30 });
    const b = practice(2, 0, 1);
    const c = practice(2, 0, 1);
    for (const q of [b, c]) {
      expect(q.m.active).toBe(q.m.ball.owner);
      expect(q.m.players[q.m.active].slot).toBe(8);
      expect(q.lesson.progress()).toEqual({ n: 1, of: 2, name: 'CROSS' });
      expect(q.lesson.verdict).toBeNull();
    }
    expect([b.m.ball.pos.x, b.m.ball.pos.z]).toEqual([c.m.ball.pos.x, c.m.ball.pos.z]);
  });
});

describe('the PASS and SHOOT drills say why too', () => {
  it('PASS: a shot ends it (NO SHOOTING HERE), THROUGH does nothing, a lost pass says it missed', () => {
    const shot = practice(0, 0, 1);
    for (let i = 0; i < 60 && !shot.lesson.verdict; i++) shot.tick({ ...EMPTY_PAD, shoot: i < 10 });
    expect(shot.lesson.verdict).toBe('passShot');
    expect(lessonFailText(shot.lesson.failReason(), 'keyboard')).toBe('NO SHOOTING HERE. PRESS SPACE TO PASS');
    const through = practice(0, 0, 1);
    for (let i = 0; i < 60; i++) through.tick({ ...EMPTY_PAD, through: i < 30 });
    expect(through.events.some((e) => e.type === 'kick')).toBe(false);
    const out = practice(0, 0, 1);
    out.lesson.ended('dead');
    expect(lessonFailText(out.lesson.failReason(), 'keyboard')).toBe('THE BALL WENT OUT. PRESS SPACE TO PASS');
    const caught = practice(0, 0, 1);
    caught.lesson.ended('caught');
    expect(lessonFailText(caught.lesson.failReason(), 'touch')).toBe('THE KEEPER TOOK IT. TAP THE PASS BUTTON');
    const lost = practice(0, 0, 1);
    for (let i = 0; i < 30 && lost.m.kickId === 0; i++) lost.tick({ ...EMPTY_PAD, pass: i < 5 });
    lost.lesson.ended('dead');
    expect(lessonFailText(lost.lesson.failReason(), 'keyboard')).toBe('THE PASS MISSED HIM. AIM AT YOUR TEAMMATE');
  });

  it('SHOOT: dribbled out, or the shot missed', () => {
    const out = practice(1, 0, 1);
    out.lesson.ended('dead');
    expect(lessonFailText(out.lesson.failReason(), 'keyboard')).toBe('THE BALL WENT OUT. HOLD K, THEN LET GO');
    const wide = practice(1, 0, 1);
    wide.m.ball.lastTouch = wide.m.active;
    wide.lesson.event({ type: 'kick', kind: 'shot', x: 0, y: 0, z: 0, power: 0.5 }, wide.m);
    wide.lesson.ended('dead');
    expect(lessonFailText(wide.lesson.failReason(), 'keyboard')).toBe('SHOT MISSED. AIM BETWEEN THE POSTS');
  });

  it('his own net: THAT WAS YOUR OWN GOAL', () => {
    const p = practice(1, 0, 1);
    p.lesson.event({ type: 'goal', side: 1 } as MatchEvent, p.m);
    expect(lessonFailText(p.lesson.failReason(), 'keyboard')).toBe('THAT WAS YOUR OWN GOAL. ATTACK THE OTHER ONE');
  });

  it('every reason is upper case words, with no dot or dash separators', () => {
    const all = ['crossOut', 'crossFirst', 'crossLetGo', 'crossMissed', 'finishLate', 'shotMissed', 'passOut', 'passShot',
      'passMissed', 'passKeeper', 'shootOut', 'shootMissed', 'ownGoal', 'again'] as const;
    for (const why of all) for (const dev of ['keyboard', 'touch', 'gamepad'] as const) {
      const text = lessonFailText(why, dev);
      expect(text).toMatch(/^[A-Z ,.]+$/);
      expect(text).not.toMatch(/[·•\u2014\u2013-]/);
    }
  });
});
