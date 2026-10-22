import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { BASICS } from '../src/meta/moments';
import { DT, HALF_L } from '../src/sim/constants';
import { EMPTY_PAD, Match, type Pad } from '../src/sim/match';
import { applyScenario, judgeScenario, type ScenarioOutcome } from '../src/sim/scenario';
import type { MatchEvent } from '../src/sim/types';
import { Lesson, lessonFailText, type DrillFail } from '../src/ui/trainer';

/**
 * LEARN THE BASICS never leaves a drill running with nothing to say (CrazyGames' QA, 22 October: in the SHOOT drill a
 * post, a sprint and K pressed away from goal left him on the ball in midfield, no card, no AGAIN, still stuck after
 * 16 s). Each attempt ends, whatever the player does, within a few seconds: with the goal (NICE!), or AGAIN! and why.
 *
 * The harness plays an attempt as main.ts does: the session's hold on the first prompt (Lesson.hold), the drill's
 * buttons (Lesson.filterPad), the events to the lesson, the judge, and main.ts basicsWatch's endings in its order (the
 * lesson's verdict from Lesson.watch, then a dead ball, their keeper's hands, their ball too long).
 */
function attempt(step: number, seed = 1) {
  const m = new Match({
    home: makeTeam(PRESET_CLUBS[0]), away: makeTeam(PRESET_CLUBS[6]),
    halfLength: 600, difficulty: 0.6, humanSide: 0, seed, assist: 0.8,
  });
  const spec = BASICS[step].spec;
  applyScenario(m, spec);
  const lesson = new Lesson(BASICS[step].lesson);
  const events: MatchEvent[] = [];
  let outcome: ScenarioOutcome | null = null;
  let deadT = 0;
  let lostT = 0;
  let ended: 'won' | 'lost' | 'verdict' | 'dead' | 'caught' | 'theirs' | null = null;
  /** Seconds of live play so far (the held first prompt is not play). */
  let played = 0;
  /** One frame: false once the attempt has ended. */
  const tick = (raw: Pad): boolean => {
    if (ended) return false;
    if (lesson.hold(m, { sx: raw.mx, sy: raw.mz, pass: raw.pass, shoot: raw.shoot, through: raw.through, sprint: raw.sprint })) return true;
    m.step(DT, lesson.filterPad(raw, m));
    played += DT;
    const next = m.drainEvents();
    events.push(...next);
    for (const e of next) lesson.event(e, m);
    outcome = judgeScenario(m, spec);
    if (outcome) {
      ended = outcome.won ? 'won' : 'lost';
      return false;
    }
    lesson.watch(m);
    if (lesson.verdict && m.phase !== 'goal') {
      ended = 'verdict';
      return false;
    }
    const own = m.ball.owner;
    const theirs = m.phase === 'play' && own >= 0 && m.players[own].side !== 0 && !m.players[own].isKeeper;
    const caught = m.phase === 'play' && own >= 0 && m.players[own].side !== 0 && m.players[own].isKeeper && m.ball.held;
    const dead = m.phase === 'out' || m.phase === 'restart';
    lostT = theirs ? lostT + DT : 0;
    deadT = dead || caught ? deadT + DT : 0;
    if (lostT > 2.5 || deadT > 0.9 || (dead && (m.phase === 'restart' || deadT > 0.45))) {
      ended = lostT > 2.5 ? 'theirs' : caught ? 'caught' : 'dead';
      lesson.ended(lostT > 2.5 ? 'lost' : caught ? 'caught' : 'dead');
      return false;
    }
    return true;
  };
  /**
   * Plays `pad(t)` (t: s since this call, held frames included) until the attempt ends or `maxS` s of play go by: the
   * seconds of play it took in all. (A drill's first prompt holds the picture until he acts: Infinity if it never ends.)
   */
  const play = (pad: (t: number) => Partial<Pad>, maxS = 30): number => {
    for (let i = 0; i < (maxS + 10) / DT; i++) {
      if (played > maxS) return Infinity;
      if (!tick({ ...EMPTY_PAD, ...pad(i * DT) })) return played;
    }
    return Infinity;
  };
  /** The stick from his man to the ball (sprinting), or `away` from goal once he has it. */
  const toBall = (): Partial<Pad> => {
    const p = m.players[m.active];
    const dx = m.ball.pos.x - p.pos.x, dz = m.ball.pos.z - p.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    return { mx: dx / l, mz: dz / l, sprint: true };
  };
  return { m, lesson, events, tick, play, toBall, ended: () => ended, outcome: () => outcome, played: () => played };
}

/** Runs until our side's first kick of `kind` (or `maxS` s), with `pad` as the input. */
function until(p: ReturnType<typeof attempt>, kind: string, pad: (t: number) => Partial<Pad>, maxS = 5): void {
  const goal = () => p.events.some((e) => e.type === 'kick' && e.kind === kind);
  for (let i = 0; i < maxS / DT && !goal() && p.tick({ ...EMPTY_PAD, ...pad(p.played()) }); i++);
  expect(goal()).toBe(true);
}

/** Seconds of play an attempt may take at most, whatever is done (the drill's action, its time after, a last strike). */
const MOST_S = 6 + 5 + 2.2 + 0.5;

/** Every reason an attempt can end with: upper case words, no dot or dash separators, on every device. */
function readable(why: DrillFail): void {
  for (const dev of ['keyboard', 'touch', 'gamepad'] as const) {
    const text = lessonFailText(why, dev);
    expect(text).toMatch(/^[A-Z ,.]+$/);
    expect(text).not.toMatch(/[·•—–-]/);
    expect(text).not.toBe(lessonFailText('again', dev));
  }
}

describe('LEARN THE BASICS SHOOT: no dead ends (CrazyGames QA, 22 October)', () => {
  it('the QA path: a shot off the post, the rebound into midfield, a sprint after it, K, on the ball in midfield: AGAIN, SHOT MISSED', () => {
    for (const k of ['far', 'none'] as const) {
      const p = attempt(1);
      until(p, 'shot', (t) => ({ shoot: t < 0.3 }));
      // Off the post: the ball comes back out hard, towards midfield.
      Object.assign(p.m.ball.pos, { x: HALF_L - 0.4, y: 0.4, z: 3.7 });
      Object.assign(p.m.ball.vel, { x: -15, y: 0, z: -1.5 });
      const shotAt = p.played();
      // Sprint after it, K pressed with the stick away from goal while still chasing it, then on with it into midfield.
      const took = p.play((t) => (p.m.ball.owner === p.m.active ? { mx: -1, sprint: true } : { ...p.toBall(), shoot: k === 'far' && t > 0.6 && t < 0.7 }));
      expect(took - shotAt).toBeLessThan(MOST_S);
      // (K on the way can still meet it first time and score: then that is the goal, NICE!)
      if (k === 'far' && p.ended() === 'won') continue;
      expect(p.ended()).toBe('verdict');
      expect(p.lesson.failReason()).toBe('shootMissed');
      expect(lessonFailText(p.lesson.failReason(), 'keyboard')).toBe('SHOT MISSED. AIM BETWEEN THE POSTS');
      // (Never further than the drill's patch: 12 m back from where he started.)
      expect(p.m.ball.pos.x).toBeGreaterThan(HALF_L - 12 - 12 - 3);
    }
  });

  it('the SPRINT prompt never freezes a strike in flight (a stuck game), only a ball slowed to a roll', () => {
    const p = attempt(1);
    p.m.ball.lastTouch = p.m.active;
    p.lesson.event({ type: 'kick', kind: 'shot', x: 0, y: 0, z: 0, power: 0.8 }, p.m);
    expect(p.lesson.current?.key).toBe('sprint');
    p.m.ball.owner = -1;
    const none = { sx: 0, sy: 0, pass: false, shoot: false, through: false };
    p.lesson.show(p.m, none);
    p.m.clock += 1.3;
    Object.assign(p.m.ball.vel, { x: 22, y: 1, z: 0 });
    expect(p.lesson.hold(p.m, none)).toBe(false);
    Object.assign(p.m.ball.vel, { x: 1.5, y: 0, z: 0 });
    expect(p.lesson.hold(p.m, none)).toBe(true);
  });

  it('dribbled the wrong way before shooting: AGAIN, WRONG WAY, inside three seconds', () => {
    const p = attempt(1);
    const took = p.play(() => ({ mx: -1, sprint: true }));
    expect(took).toBeLessThan(3);
    expect(p.ended()).toBe('verdict');
    expect(p.lesson.failReason()).toBe('wrongWay');
    expect(lessonFailText('wrongWay', 'keyboard')).toBe('WRONG WAY. HEAD FOR THE GOAL');
  });

  it('on the ball and never shooting: AGAIN, TOO SLOW', () => {
    const p = attempt(1);
    // (A step to let go of the held first prompt, then nothing.)
    const took = p.play((t) => ({ mz: t < 0.2 ? 0.5 : 0 }));
    expect(took).toBeGreaterThan(5);
    expect(took).toBeLessThan(7);
    expect(p.lesson.failReason()).toBe('shootSlow');
    expect(lessonFailText('shootSlow', 'keyboard')).toBe('TOO SLOW. HOLD K, THEN LET GO');
    expect(lessonFailText('shootSlow', 'touch')).toBe('TOO SLOW. HOLD SHOOT, THEN LET GO');
  });

  it('the ball stopped dead with nobody on it: AGAIN, THE BALL STOPPED (before the shot) or SHOT MISSED (after it)', () => {
    // (Out of his reach in the time: a loose ball near him, his man goes and collects by himself.)
    const before = attempt(1);
    before.m.ball.owner = -1;
    Object.assign(before.m.ball.pos, { x: HALF_L - 2, z: 14 });
    Object.assign(before.m.ball.vel, { x: 0, y: 0, z: 0 });
    const t0 = before.play(() => ({}));
    expect(t0).toBeLessThan(3);
    expect(before.lesson.failReason()).toBe('ballStopped');
    const after = attempt(1);
    until(after, 'shot', (t) => ({ shoot: t < 0.3 }));
    Object.assign(after.m.ball.pos, { x: HALF_L - 4, y: 0.22, z: 14 });
    Object.assign(after.m.ball.vel, { x: 0, y: 0, z: 0 });
    const shotAt = after.played();
    // (The SPRINT prompt holds the picture from 1.2 s, until he acts: a tap of the stick lets go of it; then nothing.)
    const t1 = after.play((t) => ({ mz: t > 1.1 && t < 1.5 ? 0.5 : 0 }));
    expect(t1 - shotAt).toBeLessThan(5.5);
    expect(after.lesson.failReason()).toBe('shootMissed');
  });

  it('the shot is in a keeper\'s hands: AGAIN, and why', () => {
    const p = attempt(1);
    const keeper = p.m.players.find((q) => q.side === 0 && q.isKeeper && !q.sentOff)!;
    p.play((t) => ({ mz: t < 0.2 ? 0.5 : 0 }), 0.3);
    p.m.ball.owner = keeper.idx;
    p.m.ball.held = true;
    const took = p.play(() => ({}));
    expect(took).toBeLessThan(1.5);
    expect(p.ended()).toBe('verdict');
    // (His own keeper: it went back the wrong way.)
    expect(p.lesson.failReason()).toBe('wrongWay');
  });
});

describe('LEARN THE BASICS PASS: no dead ends', () => {
  it('dribbled off instead of passing: AGAIN, TOO FAR AWAY', () => {
    const p = attempt(0);
    const took = p.play(() => ({ mx: 1, mz: 1, sprint: true }));
    expect(took).toBeLessThan(4);
    expect(p.lesson.failReason()).toBe('passAway');
    expect(lessonFailText('passAway', 'keyboard')).toBe('TOO FAR AWAY. PRESS SPACE TO PASS');
  });

  it('never passing: AGAIN, TOO SLOW', () => {
    const p = attempt(0);
    const took = p.play((t) => ({ mx: t < 0.2 ? 0.5 : 0 }));
    expect(took).toBeLessThan(7);
    expect(p.lesson.failReason()).toBe('passSlow');
    expect(lessonFailText('passSlow', 'touch')).toBe('TOO SLOW. TAP THE PASS BUTTON');
  });

  it('the pass heading away from goal and out of the drill: AGAIN, THE PASS MISSED HIM, before it gets there', () => {
    const p = attempt(0);
    until(p, 'pass', (t) => ({ pass: t < 0.1 }));
    // Deflected back the way it came, hard.
    p.m.ball.vel.x = -16;
    p.m.ball.vel.z = 4;
    const at = p.played();
    const took = p.play(() => ({}));
    expect(took - at).toBeLessThan(1.5);
    expect(p.ended()).toBe('verdict');
    expect(p.lesson.failReason()).toBe('passMissed');
  });

  it('their keeper holding it, and their man on it at his feet: AGAIN, THE KEEPER TOOK IT, THEY WON THE BALL', () => {
    for (const hands of [true, false]) {
      const p = attempt(0);
      p.play((t) => ({ mz: t < 0.2 ? 0.5 : 0 }), 0.3);
      const keeper = p.m.players.find((q) => q.side === 1 && q.isKeeper && !q.sentOff)!;
      p.m.ball.owner = keeper.idx;
      p.m.ball.held = hands;
      Object.assign(p.m.ball.pos, { x: keeper.pos.x, y: 0.11, z: keeper.pos.z });
      const took = p.play(() => ({}));
      expect(took).toBeLessThan(2);
      expect(p.lesson.failReason()).toBe(hands ? 'passKeeper' : 'tackled');
    }
    // (main.ts's own watch: their man kept it 2.5 s; said as it is, never THE BALL WENT OUT.)
    const lost = attempt(0);
    lost.lesson.ended('lost');
    expect(lessonFailText(lost.lesson.failReason(), 'keyboard')).toBe('THEY WON THE BALL. TRY AGAIN');
  });
});

describe('LEARN THE BASICS CROSS: no dead ends', () => {
  it('dribbled back away from goal: AGAIN, WRONG WAY', () => {
    const p = attempt(2);
    const took = p.play(() => ({ mx: -1, sprint: true }));
    expect(took).toBeLessThan(3);
    expect(p.lesson.failReason()).toBe('wrongWay');
  });

  it('never crossing: AGAIN, TOO SLOW', () => {
    const p = attempt(2);
    const took = p.play((t) => ({ mz: t < 0.2 ? -0.5 : 0 }));
    expect(took).toBeLessThan(7);
    expect(p.lesson.failReason()).toBe('crossSlow');
    expect(lessonFailText('crossSlow', 'keyboard')).toBe('TOO SLOW. HOLD L, THEN LET GO');
  });

  it('the cross stopped short of everyone: AGAIN, THE CROSS MISSED YOUR RUNNER', () => {
    const p = attempt(2);
    until(p, 'lob', (t) => ({ through: t < 0.7 }));
    Object.assign(p.m.ball.pos, { x: HALF_L - 20, y: 0.11, z: 18 });
    Object.assign(p.m.ball.vel, { x: 0, y: 0, z: 0 });
    const at = p.played();
    const took = p.play(() => ({}));
    expect(took - at).toBeLessThan(3);
    expect(p.lesson.failReason()).toBe('crossMissed');
  });
});

describe('LEARN THE BASICS: whatever is pressed, every attempt ends with the goal or a reason', () => {
  /** A beginner mashing: the stick and the buttons change at random every few tenths of a second. */
  function mash(seed: number) {
    let s = seed * 9301 + 49297;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    let pad: Partial<Pad> = {};
    let next = 0;
    return (t: number): Partial<Pad> => {
      if (t >= next) {
        next = t + 0.2 + rnd() * 0.6;
        const a = rnd() * Math.PI * 2;
        const still = rnd() < 0.2;
        pad = {
          mx: still ? 0 : Math.cos(a), mz: still ? 0 : Math.sin(a), sprint: rnd() < 0.5,
          pass: rnd() < 0.15, shoot: rnd() < 0.2, through: rnd() < 0.2,
        };
      }
      return pad;
    };
  }

  it.each([0, 1, 2])('drill %i: 40 random players, each attempt over inside the most time, never ONE MORE GO', (step) => {
    const reasons = new Set<DrillFail>();
    for (let seed = 1; seed <= 40; seed++) {
      const p = attempt(step, seed);
      const took = p.play(mash(seed * 7 + step), 40);
      expect(took, `seed ${seed}`).toBeLessThan(MOST_S);
      if (p.ended() !== 'won') {
        const why = p.lesson.failReason();
        expect(why, `seed ${seed} ended ${p.ended()}`).not.toBe('again');
        reasons.add(why);
      }
    }
    for (const why of reasons) readable(why);
  });

  it('PASS: NO SHOOTING HERE says it naturally on each device (touch names the button as a button)', () => {
    expect(lessonFailText('passShot', 'touch')).toBe('NO SHOOTING HERE. TAP THE PASS BUTTON');
    expect(lessonFailText('passShot', 'keyboard')).toBe('NO SHOOTING HERE. PRESS SPACE TO PASS');
    expect(lessonFailText('passShot', 'gamepad')).toBe('NO SHOOTING HERE. PRESS A TO PASS');
    // (Every PASS reason: never "TAP PASS TO PASS".)
    for (const why of ['passOut', 'passShot', 'passKeeper', 'passAway', 'passSlow'] as const) {
      expect(lessonFailText(why, 'touch')).not.toMatch(/TAP PASS TO PASS/);
      expect(lessonFailText(why, 'touch', 'default')).toMatch(/TAP THE PASS BUTTON$/);
    }
  });

  it('every new reason reads as upper case words with no dot or dash separators', () => {
    for (const why of ['wrongWay', 'passAway', 'passSlow', 'shootSlow', 'crossSlow', 'ballStopped', 'saved', 'tackled'] as const) readable(why);
  });
});
