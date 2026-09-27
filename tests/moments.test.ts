import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { firstOpenMoment, MOMENTS, momentStarTotals, momentUnlocked, nextMoment, starRules, type Moment } from '../src/meta/moments';
import { DT, HALF_L, HALF_W } from '../src/sim/constants';
import { EMPTY_PAD, Match, type Pad } from '../src/sim/match';
import { applyScenario, finishScenario, judgeScenario, scenarioSecondsLeft, type FullScenarioSpec, type ScenarioOutcome } from '../src/sim/scenario';
import type { ScenarioSpec } from '../src/sim/types';
import { HumanBot } from './humanBot';

/**
 * Football Moments: the catalogue applies and judges on the sim (src/sim/scenario.ts), the star rules by goal,
 * the restart / ten-men / Blitz set-ups, and a scripted-human playthrough of every moment over ten seeds
 * (the ladder should rise: the first moments complete most of the time, the last ones sometimes).
 */

/** ui/menus.ts DIFF_LEVEL (EASY 0.6 · NORMAL 1.8 · HARD 3 · LEGEND 4), kept out of the DOM module here. */
const LEVEL = [0.6, 1.8, 3, 4];

function matchFor(mo: Moment, seed: number, spec: ScenarioSpec = mo.spec): Match {
  const m = new Match({
    home: makeTeam(PRESET_CLUBS[mo.home ?? 5]),
    away: makeTeam(PRESET_CLUBS[mo.away ?? 6]),
    halfLength: 600,
    difficulty: LEVEL[mo.difficulty] ?? 1.8,
    humanSide: 0,
    seed,
    mode: spec.mode ?? 'classic',
  });
  applyScenario(m, spec);
  return m;
}

/** Steps with `pad` until the judge speaks (or `maxS` of sim time), handling goals the way the session does. */
function runIdle(m: Match, spec: ScenarioSpec, maxS: number, pad: Pad = EMPTY_PAD, onStep?: (m: Match) => void): ScenarioOutcome | null {
  for (let i = 0; i < maxS * 60; i++) {
    m.step(DT, pad);
    m.drainEvents();
    onStep?.(m);
    const o = judgeScenario(m, spec);
    if (o) return o;
    if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
  }
  return null;
}

/** The scripted human (tests/humanBot.ts) plays the moment; he also presses POWER once his side holds a cube. */
function playMoment(mo: Moment, seed: number): { outcome: ScenarioOutcome | null; steps: number; score: [number, number] } {
  const m = matchFor(mo, seed);
  const bot = new HumanBot(seed);
  let outcome: ScenarioOutcome | null = null;
  let steps = 0;
  let pressed = false;
  for (; steps < (mo.spec.seconds + 150) * 60; steps++) {
    const pad = bot.pad(m);
    if (m.heldPower[0]) {
      if (!pressed) pad.power = true;
      pressed = true;
    } else pressed = false;
    const before = m.ball.owner;
    m.step(DT, pad);
    bot.observe(m, m.drainEvents(), before);
    outcome = judgeScenario(m, mo.spec);
    if (outcome) break;
    if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
    if (m.phase === 'halftime' || m.phase === 'fulltime') break;
  }
  return { outcome, steps, score: [m.score[0], m.score[1]] };
}

const byId = (id: string): Moment => {
  const mo = MOMENTS.find((x) => x.id === id);
  if (!mo) throw new Error(`no moment ${id}`);
  return mo;
};

describe('the catalogue', () => {
  it('has eight moments, easy to hard, each pointing at the next, ids unique and matching their specs', () => {
    expect(MOMENTS.length).toBe(8);
    const ids = new Set(MOMENTS.map((m) => m.id));
    expect(ids.size).toBe(8);
    MOMENTS.forEach((mo, i) => {
      expect(mo.spec.id).toBe(mo.id);
      expect(mo.spec.seconds).toBeLessThanOrEqual(90);
      expect(mo.spec.seconds).toBeGreaterThan(0);
      expect(mo.next).toBe(i < MOMENTS.length - 1 ? MOMENTS[i + 1].id : null);
      expect(mo.title.length).toBeGreaterThan(0);
      expect(mo.brief.length).toBeGreaterThan(0);
      expect(mo.tip.length).toBeGreaterThan(0);
      expect(mo.icon.length).toBeGreaterThan(0);
      expect(mo.xpNote).toMatch(/XP/);
      expect(starRules(mo.spec).every((s) => s.length > 0)).toBe(true);
      if (mo.spec.stars) expect(mo.spec.stars[0] <= mo.spec.stars[1] && mo.spec.stars[1] <= mo.spec.stars[2]).toBe(true);
    });
    expect(nextMoment('first-touch')?.id).toBe('cross-finish');
    expect(nextMoment('blitz-mega')).toBeUndefined();
  });

  it('unlocks in order: the first is open, each next one needs a star on the previous', () => {
    expect(momentUnlocked('first-touch', {})).toBe(true);
    expect(momentUnlocked('cross-finish', {})).toBe(false);
    expect(momentUnlocked('cross-finish', { 'first-touch': 1 })).toBe(true);
    expect(momentUnlocked('one-on-one', { 'first-touch': 3 })).toBe(false);
    expect(momentUnlocked('nope', {})).toBe(false);
    expect(firstOpenMoment({}).id).toBe('first-touch');
    expect(firstOpenMoment({ 'first-touch': 3, 'cross-finish': 1 }).id).toBe('cross-finish');
    expect(momentStarTotals({ 'first-touch': 3, 'cross-finish': 2, junk: 9 })).toEqual({ got: 5, of: 24 });
  });

  it('every spec applies without throwing, keeps its score and clock, and is judged "still on" at the start', () => {
    for (const mo of MOMENTS) {
      const m = matchFor(mo, 3);
      expect(m.score).toEqual(mo.spec.score);
      expect(m.clock).toBe(mo.spec.clock);
      expect(['play', 'out', 'kickoff', 'restart']).toContain(m.phase);
      expect(judgeScenario(m, mo.spec)).toBeNull();
      expect(scenarioSecondsLeft(m, mo.spec)).toBe(mo.spec.seconds);
      // The sim's own half-time can't cut the moment short, whatever half length the request came with.
      const short = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 45, difficulty: 1.8, humanSide: 0, seed: 2, mode: mo.spec.mode ?? 'classic' });
      applyScenario(short, mo.spec);
      expect(short.cfg.halfLength).toBeGreaterThanOrEqual(mo.spec.clock + mo.spec.seconds * 2 + 30);
      // Everyone on the pitch is standing, no order pending, inside the lines.
      for (const p of m.players) {
        if (p.sentOff) continue;
        expect(Math.abs(p.pos.x)).toBeLessThanOrEqual(HALF_L + 0.5);
        expect(Math.abs(p.pos.z)).toBeLessThanOrEqual(HALF_W + 0.5);
        expect(p.order).toBeNull();
      }
      // A few steps run clean.
      for (let i = 0; i < 30; i++) m.step(DT, EMPTY_PAD);
    }
  });
});

describe('the judge', () => {
  /** A bare spec: everyone parked along the touchlines, the ball at the centre spot. */
  const parked = (over: Partial<FullScenarioSpec>): FullScenarioSpec => ({
    id: 'parked', title: 'PARKED', brief: '', clock: 0, seconds: 10, score: [0, 0], humanSide: 0, goal: 'score', stars: [0, 4, 7],
    players: Array.from({ length: 22 }, (_, i) => ({ side: (i < 11 ? 0 : 1) as 0 | 1, slot: i % 11, x: -44 + (i % 11) * 8, z: i < 11 ? -HALF_W + 1 : HALF_W - 1 })),
    ball: { x: 0, z: 0 },
    owner: null,
    ...over,
  });
  const idle = (spec: ScenarioSpec, seed = 1): Match => matchFor(byId('first-touch'), seed, spec);

  /**
   * `s` seconds of live play as the judge sees them: the clock ticks in the 'play' phase (the sim itself
   * isn't stepped, so the AI can't wander into a goal and muddy the rule under test).
   */
  const play = (m: Match, spec: ScenarioSpec, s: number): ScenarioOutcome | null => {
    let o: ScenarioOutcome | null = null;
    m.phase = 'play';
    for (let i = 0; i < Math.round(s * 60) && !o; i++) {
      m.clock += DT;
      o = judgeScenario(m, spec);
    }
    return o;
  };

  it("'score': stars by the seconds left (3 / 2 / 1), lost at time-up, lost at once on a goal against", () => {
    for (const [after, stars] of [[2, 3], [4, 2], [7, 1]] as const) {
      const spec = parked({});
      const m = idle(spec);
      expect(play(m, spec, after)).toBeNull();
      m.score[0]++;
      const o = judgeScenario(m, spec)!;
      expect(o.won).toBe(true);
      expect(o.stars).toBe(stars);
      expect(o.secondsLeft).toBeCloseTo(10 - after, 0);
      // The verdict sticks.
      m.clock += DT;
      expect(judgeScenario(m, spec)).toBe(o);
    }
    const spec = parked({});
    const m = idle(spec);
    const o = play(m, spec, 12)!;
    expect(o).toEqual({ won: false, stars: 0, secondsLeft: 0 });
    const m2 = idle(spec);
    play(m2, spec, 1);
    m2.score[1]++;
    expect(judgeScenario(m2, spec)).toEqual({ won: false, stars: 0, secondsLeft: 9 });
  });

  it("'score': the moment never ends on a shot in flight — it gets up to 1.5 s to land, and a goal then counts", () => {
    const spec = parked({});
    const m = idle(spec);
    play(m, spec, 9.9);
    // A rocket struck just now, still climbing at time-up.
    m.shotClock = 0.1;
    m.ball.pos.y = 3;
    m.ball.vel.y = 0;
    expect(play(m, spec, 0.6)).toBeNull();
    m.score[0]++;
    const o = judgeScenario(m, spec)!;
    expect(o.won).toBe(true);
    expect(o.stars).toBe(1);
    // ...and with nothing coming of it, the whistle goes once the grace is up.
    const spec2 = parked({});
    const m2 = idle(spec2);
    play(m2, spec2, 9.9);
    m2.shotClock = 0.1;
    m2.ball.pos.y = 3;
    let o2: ScenarioOutcome | null = null;
    let waited = 0;
    for (let i = 0; i < 240 && !o2; i++) {
      m2.clock += DT;
      o2 = judgeScenario(m2, spec2);
      waited++;
    }
    expect(o2?.won).toBe(false);
    expect(waited * DT).toBeGreaterThan(1.4);
    expect(waited * DT).toBeLessThan(1.8);
  });

  it("'lead': judged at time-up by the margin, a clean sheet counting one extra", () => {
    for (const [score, won, stars] of [[[0, 0], false, 0], [[1, 1], false, 0], [[2, 1], true, 1], [[1, 0], true, 2], [[3, 1], true, 2], [[2, 0], true, 3]] as const) {
      const spec = parked({ goal: 'lead', stars: [1, 2, 3], seconds: 3 });
      const m = idle(spec);
      expect(play(m, spec, 2)).toBeNull();
      m.score[0] = score[0];
      m.score[1] = score[1];
      const o = play(m, spec, 2)!;
      expect(o.won).toBe(won);
      expect(o.stars).toBe(stars);
      expect(o.secondsLeft).toBe(0);
    }
  });

  it("'draw-or-better' (from 0–2): a draw one star, a win two, by two three; still behind, lost", () => {
    for (const [score, won, stars] of [[[1, 2], false, 0], [[2, 2], true, 1], [[3, 2], true, 2], [[4, 2], true, 3]] as const) {
      const spec = parked({ goal: 'draw-or-better', score: [0, 2], stars: [0, 1, 2], seconds: 3 });
      const m = idle(spec);
      expect(m.score).toEqual([0, 2]);
      play(m, spec, 2);
      m.score[0] = score[0];
      m.score[1] = score[1];
      const o = play(m, spec, 2)!;
      expect(o.won).toBe(won);
      expect(o.stars).toBe(stars);
    }
  });

  it("'no-concede': lost at once on a goal against; at time-up, stars by the share of the ball (a goal for = three)", () => {
    const spec = parked({ goal: 'no-concede', score: [1, 0], stars: [0, 30, 50], seconds: 3 });
    const m = idle(spec);
    play(m, spec, 1);
    m.score[1]++;
    expect(judgeScenario(m, spec)).toEqual({ won: false, stars: 0, secondsLeft: 2 });
    // Nobody touched it: one star for the hold-out.
    const m2 = idle(spec);
    const o2 = play(m2, spec, 4)!;
    expect(o2).toEqual({ won: true, stars: 1, secondsLeft: 0 });
    // Our man had it the whole time: three (100% of the ball); theirs had it 60/40: two.
    const spec3 = parked({ goal: 'no-concede', score: [1, 0], stars: [0, 30, 50], seconds: 3, owner: { side: 0, slot: 9 } });
    const m3 = idle(spec3);
    const o3 = play(m3, spec3, 4)!;
    expect(o3.won).toBe(true);
    expect(o3.stars).toBe(3);
    const m5 = idle(spec3);
    play(m5, spec3, 1.2);
    m5.ball.owner = m5.teamPlayers(1)[9].idx;
    const o5 = play(m5, spec3, 3)!;
    expect(o5.won).toBe(true);
    expect(o5.stars).toBe(2);
    // ...and a goal at the other end is three whatever the share.
    const m4 = idle(spec);
    play(m4, spec, 1);
    m4.score[0]++;
    expect(play(m4, spec, 3)).toEqual({ won: true, stars: 3, secondsLeft: 0 });
  });

  it("'win-shootout': the sim's shootout decides it (AI vs AI on both sides here), stars by the kicks margin", () => {
    const spec = parked({ goal: 'win-shootout', seconds: 1 });
    const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 600, difficulty: 1.8, humanSide: -1, seed: 11 });
    applyScenario(m, spec);
    expect(m.phase).toBe('shootout');
    expect(judgeScenario(m, spec)).toBeNull();
    const o = runIdle(m, spec, 240)!;
    expect(o).not.toBeNull();
    const so = m.shootout!;
    expect(so.winner).toBeGreaterThanOrEqual(0);
    expect(o.won).toBe(so.winner === 0);
    if (o.won) {
      const g = (k: boolean[]) => k.filter(Boolean).length;
      const margin = g(so.kicks[0]) - g(so.kicks[1]);
      expect(o.stars).toBe(Math.max(1, Math.min(3, 1 + (margin >= 1 ? 1 : 0) + (margin >= 2 ? 1 : 0))));
    } else expect(o.stars).toBe(0);
  });

  it('finishScenario blows the final whistle from open play and is idempotent', () => {
    const spec = parked({});
    const m = idle(spec);
    for (let i = 0; i < 60; i++) m.step(DT, EMPTY_PAD);
    m.drainEvents();
    finishScenario(m);
    expect(m.phase).toBe('fulltime');
    expect(m.events.map((e) => e.type)).toEqual(['whistle', 'fulltime']);
    finishScenario(m);
    expect(m.events.length).toBe(2);
    // Stepping a finished match is a no-op.
    m.step(DT, EMPTY_PAD);
    expect(m.phase).toBe('fulltime');
  });
});

describe('set-ups', () => {
  it('the come-back starts 0–2 in open play with our playmaker on the ball; a goal brings their kick-off, which is free time', () => {
    const mo = byId('two-down');
    const m = matchFor(mo, 5);
    expect(m.score).toEqual([0, 2]);
    expect(m.phase).toBe('play');
    const c = m.players[m.ball.owner];
    expect(c.side).toBe(0);
    expect(c.slot).toBe(8);
    expect(m.active).toBe(c.idx);
    expect(c.pos.x * m.attackDir(0)).toBeCloseTo(HALF_L - 30, 5);
    for (let i = 0; i < 60; i++) {
      m.step(DT, EMPTY_PAD);
      expect(judgeScenario(m, mo.spec)).toBeNull();
    }
    expect(scenarioSecondsLeft(m, mo.spec)).toBeCloseTo(59, 0);
    // We score: the celebration and their kick-off don't count; the moment goes on (judged at time-up).
    m['goal'](0);
    expect(m.phase).toBe('goal');
    expect(m.score).toEqual([1, 2]);
    const leftAtGoal = scenarioSecondsLeft(m, mo.spec);
    const until = (phase: string, maxS: number): void => {
      for (let i = 0; i < maxS * 60 && m.phase !== phase; i++) {
        m.step(DT, EMPTY_PAD);
        expect(judgeScenario(m, mo.spec)).toBeNull();
        if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
      }
      expect(m.phase).toBe(phase);
    };
    until('kickoff', 6);
    expect(m.restart?.side).toBe(1);
    expect(scenarioSecondsLeft(m, mo.spec)).toBe(leftAtGoal);
    // Their kick-off is taken by the AI; only once the ball is live does the count go on.
    until('play', 6);
    expect(scenarioSecondsLeft(m, mo.spec)).toBeCloseTo(leftAtGoal, 0);
    for (let i = 0; i < 60; i++) m.step(DT, EMPTY_PAD);
    judgeScenario(m, mo.spec);
    expect(scenarioSecondsLeft(m, mo.spec)).toBeLessThan(leftAtGoal - 0.5);
  });

  it('the corner starts from a real corner restart, taken from the flag, and the wait for it is free', () => {
    const mo = byId('corner-kick');
    const m = matchFor(mo, 9);
    expect(m.phase).toBe('out');
    expect(m.restart?.kind).toBe('corner');
    expect(m.restart?.side).toBe(0);
    const evs = m.drainEvents();
    expect(evs.some((e) => e.type === 'restart' && e.kind === 'corner' && e.side === 0)).toBe(true);
    // The 'out' beat, then the restart phase: everyone in the set-piece shape, the taker over the ball at the flag.
    let steps = 0;
    while (m.phase !== 'restart' && steps < 600) {
      m.step(DT, EMPTY_PAD);
      judgeScenario(m, mo.spec);
      steps++;
    }
    expect(m.phase).toBe('restart');
    expect(m.restart?.kind).toBe('corner');
    expect(m.drainEvents().some((e) => e.type === 'setpiece' && e.kind === 'corner')).toBe(true);
    expect(Math.abs(m.ball.pos.x)).toBeCloseTo(HALF_L - 0.35, 1);
    expect(Math.abs(m.ball.pos.z)).toBeCloseTo(HALF_W - 0.35, 1);
    const taker = m.players[m.restart!.taker];
    expect(taker.side).toBe(0);
    expect(m.active).toBe(taker.idx);
    expect(Math.hypot(taker.pos.x - m.ball.pos.x, taker.pos.z - m.ball.pos.z)).toBeLessThan(1.2);
    // Attackers loaded the box.
    const inBox = m.teamPlayers(0).filter((p) => !p.isKeeper && Math.abs(p.pos.x) > HALF_L - 16 && Math.abs(p.pos.z) < 19).length;
    expect(inBox).toBeGreaterThanOrEqual(3);
    // The human hasn't taken it: the sim's clock ran (out + restart), the moment's didn't.
    for (let i = 0; i < 120; i++) {
      m.step(DT, EMPTY_PAD);
      judgeScenario(m, mo.spec);
    }
    expect(m.phase).toBe('restart');
    expect(m.clock).toBeGreaterThan(2);
    expect(scenarioSecondsLeft(m, mo.spec)).toBe(30);
    // Left alone, the sim takes it and play goes live; then the moment's clock runs.
    let o: ScenarioOutcome | null = null;
    for (let i = 0; i < 60 * 8 && m.phase !== 'play'; i++) {
      m.step(DT, EMPTY_PAD);
      o = judgeScenario(m, mo.spec);
    }
    expect(o).toBeNull();
    expect(m.phase).toBe('play');
    for (let i = 0; i < 60; i++) {
      m.step(DT, EMPTY_PAD);
      judgeScenario(m, mo.spec);
    }
    expect(scenarioSecondsLeft(m, mo.spec)).toBeLessThan(30);
  });

  it('the ten-men moment has ten on the pitch, one up, the AI on the ball in our half', () => {
    const mo = byId('hold-the-fort');
    const m = matchFor(mo, 2);
    expect(m.onPitch(0).length).toBe(10);
    expect(m.onPitch(1).length).toBe(11);
    expect(m.score).toEqual([1, 0]);
    const c = m.players[m.ball.owner];
    expect(c.side).toBe(1);
    expect(c.pos.x * m.attackDir(0)).toBeLessThan(0);
    const off = m.teamPlayers(0).find((p) => p.sentOff)!;
    expect(off.slot).toBe(7);
    // Parked by the dugout, and he stays there.
    for (let i = 0; i < 60; i++) m.step(DT, EMPTY_PAD);
    expect(Math.abs(off.pos.z)).toBeGreaterThan(HALF_W + 1);
    expect(m.active).toBeGreaterThanOrEqual(0);
    expect(m.players[m.active].side).toBe(0);
  });

  it('the first-touch pass is rolling to our striker, who is the controlled man and the pass target', () => {
    const mo = byId('first-touch');
    const m = matchFor(mo, 4);
    const st = m.teamPlayers(0)[9];
    expect(m.ball.owner).toBe(-1);
    expect(m.ball.hspeed()).toBeGreaterThan(5);
    expect(m.passTarget).toBe(st.idx);
    expect(m.active).toBe(st.idx);
    expect(m.kickSide).toBe(0);
    // It reaches him (the receive assist brings it under control) within 3 s.
    let got = false;
    for (let i = 0; i < 180 && !got; i++) {
      m.step(DT, EMPTY_PAD);
      got = m.ball.owner === st.idx;
    }
    expect(got).toBe(true);
  });

  it('the Blitz moment runs in blitz mode with the mega cube lying ready, and running over it takes it', () => {
    const mo = byId('blitz-mega');
    const m = matchFor(mo, 6);
    expect(m.cfg.mode).toBe('blitz');
    expect(m.powerups.length).toBe(1);
    const cube = m.powerups[0];
    expect(cube.kind).toBe('mega');
    expect(cube.t).toBeGreaterThanOrEqual(0);
    expect(m.drainEvents().some((e) => e.type === 'powerupSpawn' && e.kind === 'mega')).toBe(true);
    const c = m.players[m.ball.owner];
    expect(c.side).toBe(0);
    expect(m.active).toBe(c.idx);
    // Push the stick at the cube.
    let taken = false;
    for (let i = 0; i < 240 && !taken; i++) {
      const dx = cube.x - c.pos.x;
      const dz = cube.z - c.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      m.step(DT, { ...EMPTY_PAD, mx: dx / d, mz: dz / d });
      taken = m.heldPower[0] === 'mega';
    }
    expect(taken).toBe(true);
    // Arm it: the man glows mega.
    m.step(DT, { ...EMPTY_PAD, power: true });
    expect(m.heldPower[0]).toBeNull();
    expect(c.boost).toBe('mega');
  });

  it('applies the same in the second half (mirrored frame): the striker stands ten metres from the goal he attacks', () => {
    const mo = byId('first-touch');
    const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 600, difficulty: 0.6, humanSide: 0, seed: 1 });
    m.half = 2;
    applyScenario(m, mo.spec);
    const ad = m.attackDir(0);
    expect(ad).toBe(-1);
    const st = m.teamPlayers(0)[9];
    expect(st.pos.x * ad).toBeCloseTo(HALF_L - 11, 5);
    expect(Math.cos(st.facing) * ad).toBeGreaterThan(0.99);
    const k = m.keeperOf(1)!;
    expect(k.pos.x * ad).toBeCloseTo(HALF_L - 1.2, 5);
    expect(m.ball.vel.x * ad).toBeGreaterThan(0);
  });
});

describe('a decent player (the scripted bot) over ten seeds', () => {
  it('completes every moment at least sometimes, the ladder rising', () => {
    const N = 10;
    const rows: string[] = [];
    const rate: Record<string, number> = {};
    for (const mo of MOMENTS) {
      let won = 0;
      let stars = 0;
      let unfinished = 0;
      const detail: string[] = [];
      for (let seed = 1; seed <= N; seed++) {
        const r = playMoment(mo, seed * 101 + 7);
        if (!r.outcome) unfinished++;
        else if (r.outcome.won) {
          won++;
          stars += r.outcome.stars;
        }
        detail.push(r.outcome ? (r.outcome.won ? `${r.outcome.stars}★` : `${r.score[0]}-${r.score[1]}`) : '??');
        expect(r.outcome).not.toBeNull();
      }
      rate[mo.id] = won / N;
      rows.push(`${mo.id.padEnd(14)} ${String(won).padStart(2)}/${N} won  avg ${(won ? stars / won : 0).toFixed(1)}★  [${detail.join(' ')}]${unfinished ? `  UNFINISHED ${unfinished}` : ''}`);
    }
    // eslint-disable-next-line no-console
    console.log(`Football Moments, scripted bot, ${N} seeds each:\n${rows.join('\n')}`);
    for (const mo of MOMENTS) expect(rate[mo.id], mo.id).toBeGreaterThan(0);
    // The teaching moments are the easy ones; the last four are the hard ones.
    const easy = (rate['first-touch'] + rate['cross-finish'] + rate['one-on-one'] + rate['corner-kick']) / 4;
    const hard = (rate['two-down'] + rate['hold-the-fort'] + rate['giant-killing'] + rate['blitz-mega']) / 4;
    expect(easy).toBeGreaterThan(hard);
    expect(rate['first-touch']).toBeGreaterThanOrEqual(0.5);
  }, 300_000);
});
