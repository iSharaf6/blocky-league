import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT } from '../src/sim/constants';
import { shapeTarget } from '../src/sim/ai';
import { FORMATIONS } from '../src/sim/formations';
import { EMPTY_PAD, Match } from '../src/sim/match';
import type { FormationId, MatchEvent, Side } from '../src/sim/types';

function match(seed = 3, humanSide: Side | -1 = -1) {
  return new Match({
    home: makeTeam(PRESET_CLUBS[4]),
    away: makeTeam(PRESET_CLUBS[5]),
    halfLength: 120,
    difficulty: 2,
    humanSide,
    seed,
  });
}

/**
 * Play a whole match (the session's half-time changes for AI sides included) and report every
 * substitution with the minute, the phase it was drained in and the outgoing player's stamina.
 */
function playSubs(m: Match): { e: MatchEvent & { type: 'sub' }; minute: number; phase: string; late: boolean; stamina: number }[] {
  const out: { e: MatchEvent & { type: 'sub' }; minute: number; phase: string; late: boolean; stamina: number }[] = [];
  let last = new Map<number, number>();
  let lastMinute = 0;
  for (let i = 0; i < 60 * 60 * 10 && m.phase !== 'fulltime'; i++) {
    m.step(DT, EMPTY_PAD);
    for (const e of m.drainEvents()) {
      if (e.type !== 'sub') continue;
      const p = m.teamPlayers(e.side)[e.slot];
      out.push({ e, minute: lastMinute, phase: m.phase, late: m.half === 2 && m.clock > 1, stamina: last.get(p.idx) ?? 1 });
    }
    last = new Map(m.players.map((p) => [p.idx, p.stamina]));
    lastMinute = m.minute();
    if (m.phase === 'halftime') {
      for (const side of [0, 1] as Side[]) if (m.cfg.humanSide !== side) m.aiSubs(side, 2);
      m.continueSecondHalf();
    }
    if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
  }
  expect(m.phase).toBe('fulltime');
  return out;
}

describe('substitutions and mentality', () => {
  it('brings a bench player on with fresh legs, at most three times', () => {
    const m = match();
    const p = m.teamPlayers(0)[7];
    p.stamina = 0.3;
    const benchBefore = m.bench[0].length;
    const outfieldIdx = m.bench[0].findIndex((d) => d.role !== 'GK');
    expect(m.substitute(0, 7, outfieldIdx)).toBe(true);
    expect(p.stamina).toBe(1);
    expect(m.bench[0].length).toBe(benchBefore - 1);
    expect(m.subsUsed[0]).toBe(1);
    // Keepers only swap with keepers.
    const gk = m.bench[0].findIndex((d) => d.role === 'GK');
    expect(m.substitute(0, 3, gk)).toBe(false);
    expect(m.substitute(0, 2, m.bench[0].findIndex((d) => d.role !== 'GK'))).toBe(true);
    expect(m.substitute(0, 4, m.bench[0].findIndex((d) => d.role !== 'GK'))).toBe(true);
    expect(m.substitute(0, 5, m.bench[0].findIndex((d) => d.role !== 'GK'))).toBe(false);
  });

  it("AI benches make late changes at a dead ball after 60' / 75' for tired legs, three subs at most", () => {
    let late = 0;
    for (const seed of [3, 7, 11, 19, 23]) {
      const m = match(seed);
      const subs = playSubs(m);
      for (const s of subs.filter((x) => x.late)) {
        late++;
        expect(s.minute).toBeGreaterThanOrEqual(60);
        // Only ever at a stoppage (the ball was out, or it's the kick-off after a goal).
        expect(['out', 'kickoff'].includes(s.phase)).toBe(true);
        expect(s.stamina).toBeLessThan(0.45);
        const p = m.teamPlayers(s.e.side)[s.e.slot];
        expect(p.isKeeper).toBe(false);
      }
      expect(m.subsUsed[0]).toBeLessThanOrEqual(3);
      expect(m.subsUsed[1]).toBeLessThanOrEqual(3);
      expect(subs.filter((x) => x.e.side === 0).length).toBe(m.subsUsed[0]);
    }
    expect(late).toBeGreaterThan(0);
  }, 60_000);

  it("never makes the human manager's changes", () => {
    for (const seed of [5, 9]) {
      const m = match(seed, 0);
      const subs = playSubs(m);
      expect(subs.some((x) => x.e.side === 0)).toBe(false);
    }
  }, 60_000);

  it('setFormation re-slots the XI on the pitch (roles follow the slots); the bench and the other side are untouched', () => {
    const m = match(4);
    const bench = m.bench[0].map((d) => d.id);
    const other = m.slots[1];
    const to: FormationId = m.formation[0] === '3-5-2' ? '4-3-3' : '3-5-2';
    expect(m.setFormation(0, to)).toBe(true);
    expect(m.formation[0]).toBe(to);
    expect(m.slots[0]).toBe(FORMATIONS[to]);
    for (const p of m.teamPlayers(0)) expect(p.role).toBe(FORMATIONS[to][p.slot].role);
    expect(m.teamPlayers(0)[0].role).toBe('GK');
    expect(m.bench[0].map((d) => d.id)).toEqual(bench);
    expect(m.slots[1]).toBe(other);
    expect(m.setFormation(0, 'W-M' as FormationId)).toBe(false);
    expect(m.formation[0]).toBe(to);
    // It plays on in the new shape (and a later substitution takes the new slot's role).
    for (let i = 0; i < 60 * 20; i++) {
      m.step(DT, EMPTY_PAD);
      m.drainEvents();
      if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
    }
    for (const p of m.players) expect(Number.isFinite(p.pos.x) && Number.isFinite(p.pos.z)).toBe(true);
    const slot = 5;
    expect(m.substitute(0, slot, m.bench[0].findIndex((d) => d.role !== 'GK'))).toBe(true);
    expect(m.teamPlayers(0)[slot].role).toBe(FORMATIONS[to][slot].role);
  });

  it('attacking mentality raises the shape, defensive drops it', () => {
    const m = match();
    const df = m.teamPlayers(0)[2];
    const mf = m.teamPlayers(0)[6];
    const at = (ment: number, p: typeof df, attacking: boolean) => {
      m.mentality[0] = ment;
      return shapeTarget(m, p, attacking, 0, 0).x * m.attackDir(0);
    };
    expect(at(1, df, true)).toBeGreaterThan(at(-1, df, true));
    expect(at(1, mf, false)).toBeGreaterThanOrEqual(at(-1, mf, false));
  });

  it('mentality changes how often a side creates chances', () => {
    let shots = [0, 0];
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      for (const [k, ment] of [[0, -1], [1, 1]] as const) {
        const m = match(seed);
        m.mentality[0] = ment;
        for (let i = 0; i < 60 * 150; i++) {
          m.step(DT, EMPTY_PAD);
          m.drainEvents();
          if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
          if (m.phase === 'halftime') break;
        }
        shots[k] += m.stats.shots[0];
      }
    }
    // eslint-disable-next-line no-console
    console.log('shots defensive vs attacking', shots);
    expect(shots[1]).toBeGreaterThanOrEqual(shots[0]);
  });

  it('double-tapping sprint knocks the ball ahead with a burst', () => {
    const m = new Match({
      home: makeTeam(PRESET_CLUBS[4]), away: makeTeam(PRESET_CLUBS[5]),
      halfLength: 120, difficulty: 2, humanSide: 0, seed: 9,
    });
    const pad = { ...EMPTY_PAD };
    // Kick off and get the ball to the controlled player.
    for (let i = 0; i < 200; i++) m.step(DT, pad);
    const p = m.players[m.active];
    m.phase = 'play';
    m.restart = null;
    // Open grass on the far touchline, nobody near.
    p.pos.x = -30 * m.attackDir(0);
    p.pos.z = 27;
    for (const o of m.teamPlayers(1)) if (Math.hypot(o.pos.x - p.pos.x, o.pos.z - p.pos.z) < 12) o.pos.z -= 20;
    m.ball.owner = p.idx;
    m.ball.held = false;
    m.ball.pos.x = p.footX();
    m.ball.pos.z = p.footZ();
    const run = { ...EMPTY_PAD, mx: m.attackDir(0) };
    for (let i = 0; i < 8; i++) m.step(DT, run);
    m.step(DT, { ...run, sprint: true });
    m.step(DT, run);
    m.step(DT, { ...run, sprint: true });
    expect(m.ball.owner).toBe(-1);
    expect(m.ball.hspeed()).toBeGreaterThan(p.speed() + 3);
    expect(p.burstT).toBeGreaterThan(0.5);
  });
});
