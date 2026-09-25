import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { angleDiff } from '../src/core/math';
import { DT, HALF_W } from '../src/sim/constants';
import { EMPTY_PAD, Match, type Pad, type Phase } from '../src/sim/match';
import { goalsOf, nextTurn, shootoutWinner } from '../src/sim/shootout';
import type { MatchEvent } from '../src/sim/types';

const T = true;
const F = false;

/** A match forced to the last seconds of the second half, level at 1-1. */
function lateLevel(seed: number, knockout: boolean, humanSide: 0 | 1 | -1 = -1): Match {
  const m = new Match({
    home: makeTeam(PRESET_CLUBS[5]),
    away: makeTeam(PRESET_CLUBS[6]),
    halfLength: 60,
    difficulty: 1.8,
    humanSide,
    seed,
    knockout,
  });
  m.phase = 'play';
  m.restart = null;
  m.half = 2;
  m.score = [1, 1];
  m.clock = m.cfg.halfLength + 8;
  return m;
}

/** Step until full time (or the frame cap); `pad` can steer the human side. */
function run(m: Match, pad: (m: Match) => Pad = () => EMPTY_PAD, cap = 60 * 240) {
  const events: MatchEvent[] = [];
  const phases = new Set<Phase>();
  let n = 0;
  while (m.phase !== 'fulltime' && n < cap) {
    m.step(DT, pad(m));
    phases.add(m.phase);
    events.push(...m.drainEvents());
    n++;
  }
  return { events, phases, frames: n };
}

describe('shootout rules', () => {
  it('stops early once a side cannot catch up', () => {
    expect(shootoutWinner([[T, T, T], [F, F]])).toBe(-1);
    // 3-0 with two kicks left for the trailing side: over.
    expect(shootoutWinner([[T, T, T], [F, F, F]])).toBe(0);
    expect(shootoutWinner([[F, F, F], [T, T, T]])).toBe(1);
    // 4-2 after four each: the side behind has one kick left, can only reach 3.
    expect(shootoutWinner([[T, T, T, T], [T, F, T, F]])).toBe(0);
    // Still alive: 3-2 after four each.
    expect(shootoutWinner([[T, T, F, T], [T, F, T, F]])).toBe(-1);
  });

  it('goes to sudden death when level after five each, settled on a completed pair', () => {
    const five: [boolean[], boolean[]] = [[T, T, F, T, T], [T, F, T, T, T]];
    expect(shootoutWinner(five)).toBe(-1);
    expect(shootoutWinner([[...five[0], T], five[1]])).toBe(-1);
    expect(shootoutWinner([[...five[0], T], [...five[1], F]])).toBe(0);
    expect(shootoutWinner([[...five[0], F], [...five[1], T]])).toBe(1);
    expect(shootoutWinner([[...five[0], T], [...five[1], T]])).toBe(-1);
  });

  it('alternates kicks with the first taker leading every pair', () => {
    expect(nextTurn([[], []], 1)).toBe(1);
    expect(nextTurn([[], [T]], 1)).toBe(0);
    expect(nextTurn([[F], [T]], 1)).toBe(1);
    expect(nextTurn([[T], []], 0)).toBe(1);
  });
});

describe('penalty shootout in the match', () => {
  it('a level knockout match goes to penalties and produces a winner', () => {
    for (const seed of [3, 11, 29]) {
      const m = lateLevel(seed, true);
      const shotsBefore = [...m.stats.shots];
      const { events, phases } = run(m);
      expect(phases.has('shootout')).toBe(true);
      expect(m.phase).toBe('fulltime');
      const so = m.shootout!;
      expect(so.winner === 0 || so.winner === 1).toBe(true);
      expect(shootoutWinner(so.kicks)).toBe(so.winner);
      // The score after 90 is untouched; the shootout decides.
      expect(m.score).toEqual([1, 1]);
      expect(m.stats.shots).toEqual(shotsBefore);
      const kicks = events.filter((e) => e.type === 'shootoutKick');
      expect(kicks.length).toBe(so.kicks[0].length + so.kicks[1].length);
      const end = events.filter((e) => e.type === 'shootoutEnd');
      expect(end).toEqual([{ type: 'shootoutEnd', winner: so.winner }]);
      expect(Math.abs(so.kicks[0].length - so.kicks[1].length)).toBeLessThanOrEqual(1);
      // It stopped the moment it was decided: without the last kick it was still live.
      const lastSide = kicks[kicks.length - 1].type === 'shootoutKick' ? (kicks[kicks.length - 1] as { side: 0 | 1 }).side : 0;
      const before: [boolean[], boolean[]] = [so.kicks[0].slice(), so.kicks[1].slice()];
      before[lastSide].pop();
      expect(shootoutWinner(before)).toBe(-1);
      expect(Number.isFinite(m.minute())).toBe(true);
    }
  });

  it('best shooters go first and takers rotate through the outfield', () => {
    const m = lateLevel(5, true);
    const takers: number[][] = [[], []];
    run(m).events.forEach((e) => {
      if (e.type === 'shootoutKick') takers[e.side].push(e.taker);
    });
    for (const side of [0, 1] as const) {
      const shooting = takers[side].map((i) => m.players[i].stat.shooting);
      for (let i = 1; i < Math.min(shooting.length, 10); i++) expect(shooting[i]).toBeLessThanOrEqual(shooting[i - 1]);
      expect(takers[side].every((i) => !m.players[i].isKeeper && m.players[i].side === side)).toBe(true);
      expect(new Set(takers[side].slice(0, 10)).size).toBe(Math.min(10, takers[side].length));
    }
  });

  it('often finishes early and sometimes needs sudden death', () => {
    let early = 0;
    let sudden = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const m = lateLevel(seed, true);
      run(m);
      const [a, b] = m.shootout!.kicks;
      if (a.length + b.length < 10) early++;
      if (a.length > 5) {
        sudden++;
        // Sudden death is only ever settled on a completed pair.
        expect(a.length).toBe(b.length);
        expect(goalsOf(a)).not.toBe(goalsOf(b));
      }
    }
    expect(early).toBeGreaterThan(3);
    expect(sudden).toBeGreaterThan(0);
  }, 30_000);

  it('continues into sudden death from a level five-each tally', () => {
    const m = lateLevel(8, true);
    for (let i = 0; i < 20 && m.phase !== 'shootout'; i++) m.step(DT, EMPTY_PAD);
    const so = m.shootout!;
    so.kicks = [[T, T, F, T, T], [T, F, T, T, T]];
    so.stage = 'result';
    so.t = 99;
    run(m);
    expect(so.kicks[0].length).toBeGreaterThan(5);
    expect(so.kicks[0].length).toBe(so.kicks[1].length);
    expect(so.winner).toBe(shootoutWinner(so.kicks));
    expect(so.winner).not.toBe(-1);
  });

  it('is deterministic for a seed', () => {
    const a = lateLevel(17, true);
    const b = lateLevel(17, true);
    run(a);
    run(b);
    expect(a.shootout!.kicks).toEqual(b.shootout!.kicks);
    expect(a.shootout!.winner).toBe(b.shootout!.winner);
  });

  it('leaves non-knockout matches (and knockout wins in normal time) alone', () => {
    const m = lateLevel(4, false);
    const { events, phases } = run(m);
    expect(phases.has('shootout')).toBe(false);
    expect(m.phase).toBe('fulltime');
    expect(m.shootout).toBeNull();
    expect(events.some((e) => e.type === 'shootoutKick' || e.type === 'shootoutEnd')).toBe(false);
    expect(m.score).toEqual([1, 1]);

    const k = lateLevel(4, true);
    k.score = [2, 1];
    const r = run(k);
    expect(r.phases.has('shootout')).toBe(false);
    expect(k.shootout).toBeNull();
    expect(k.phase).toBe('fulltime');

    // Identical sims when the flag is off or absent.
    const x = lateLevel(9, false);
    const y = new Match({ ...x.cfg, knockout: undefined });
    y.phase = 'play';
    y.restart = null;
    y.half = 2;
    y.score = [1, 1];
    y.clock = y.cfg.halfLength + 8;
    run(x);
    run(y);
    expect(x.ball.pos).toEqual(y.ball.pos);
    expect(x.stats).toEqual(y.stats);
  });

  it('at the end the winners pile up on the hub facing the camera, the losers trudge off to the far side, backs turned', () => {
    for (const seed of [3, 11, 29]) {
      const m = lateLevel(seed, true);
      run(m);
      const w = m.shootout!.winner as 0 | 1;
      // Watch the scene the full-time screen comes up over.
      for (let i = 0; i < 60 * 6; i++) m.step(DT, EMPTY_PAD);
      const hub = { x: 0, z: HALF_W * 0.3 };
      const winners = m.teamPlayers(w).filter((p) => !p.sentOff);
      const losers = m.teamPlayers(w === 0 ? 1 : 0).filter((p) => !p.sentOff);
      for (const p of winners) {
        expect(p.state).toBe('celebrate');
        expect(Math.hypot(p.pos.x - hub.x, p.pos.z - hub.z)).toBeLessThan(3.6);
      }
      for (const p of losers) {
        expect(p.state).toBe('dejected');
        expect(p.pos.z).toBeLessThan(-7);
        expect(Math.abs(p.pos.x)).toBeLessThanOrEqual(11);
        expect(Math.abs(angleDiff(p.facing, -Math.PI / 2))).toBeLessThan(0.6);
      }
      let gap = Infinity;
      for (const a of winners) for (const b of losers) gap = Math.min(gap, Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z));
      expect(gap).toBeGreaterThan(8);
    }
  });

  it('the human aims with the stick and shoots on release', () => {
    const m = lateLevel(12, true, 0);
    for (let i = 0; i < 20 && m.phase !== 'shootout'; i++) m.step(DT, EMPTY_PAD);
    const so = m.shootout!;
    // Skip to the human's first kick.
    let guard = 0;
    while (!(so.turn === 0 && so.stage === 'aim') && guard++ < 60 * 30) m.step(DT, EMPTY_PAD);
    expect(so.turn).toBe(0);
    const taker = so.taker;
    expect(m.active).toBe(taker);
    // Hold SHOOT with the stick pushed to world +z, then let go.
    for (let i = 0; i < 40; i++) m.step(DT, { ...EMPTY_PAD, mz: 1, shoot: true });
    expect(so.stage).toBe('aim');
    m.step(DT, { ...EMPTY_PAD, mz: 1 });
    // He steps in from his run-up (~0.2 s) and strikes it.
    for (let i = 0; i < 40 && so.stage === 'aim'; i++) m.step(DT, EMPTY_PAD);
    expect(so.stage === 'flight' || so.stage === 'result').toBe(true);
    expect(so.pen!.z).toBeGreaterThan(2.5);
    expect(m.ball.vel.z).toBeGreaterThan(0);
  });

  it("the human keeper dives where the stick points as it's struck", () => {
    for (const dir of [1, -1]) {
      const m = lateLevel(21, true, 1);
      for (let i = 0; i < 20 && m.phase !== 'shootout'; i++) m.step(DT, EMPTY_PAD);
      const so = m.shootout!;
      let guard = 0;
      while (!(so.turn === 0 && so.stage === 'aim') && guard++ < 60 * 30) m.step(DT, EMPTY_PAD);
      const k = m.players[so.keeper];
      expect(k.side).toBe(1);
      guard = 0;
      while (so.stage !== 'result' && guard++ < 60 * 10) {
        m.step(DT, { ...EMPTY_PAD, mz: dir });
        if (k.state === 'dive') break;
      }
      expect(k.state).toBe('dive');
      expect(Math.sign(k.vel.z)).toBe(dir);
    }
  });
});
