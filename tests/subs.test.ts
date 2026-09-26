import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT } from '../src/sim/constants';
import { shapeTarget } from '../src/sim/ai';
import { FORMATIONS } from '../src/sim/formations';
import { EMPTY_PAD, FORCED_SUB_MINUTE, formationRemap, Match } from '../src/sim/match';
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
  it('brings a bench player on with fresh legs, at most five times', () => {
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
    expect(m.maxSubs).toBe(5);
    expect(m.substitute(0, 2, m.bench[0].findIndex((d) => d.role !== 'GK'))).toBe(true);
    expect(m.substitute(0, 4, m.bench[0].findIndex((d) => d.role !== 'GK'))).toBe(true);
    expect(m.substitute(0, 5, m.bench[0].findIndex((d) => d.role !== 'GK'))).toBe(true);
    // The fifth: the keeper for the bench keeper.
    expect(m.substitute(0, 0, m.bench[0].findIndex((d) => d.role === 'GK'))).toBe(true);
    expect(m.subsUsed[0]).toBe(5);
    // A sixth isn't allowed, even with someone left on the bench.
    m.bench[0].push({ ...m.bench[1].find((d) => d.role !== 'GK')!, id: 'extra' });
    expect(m.substitute(0, 6, m.bench[0].length - 1)).toBe(false);
  });

  it("AI benches make late changes at a dead ball after 60' (under 0.55 fit) / 75' (under 0.45), five subs at most", () => {
    let late = 0;
    let forced = 0;
    for (const seed of [3, 7, 11, 19, 23]) {
      const m = match(seed);
      const subs = playSubs(m);
      for (const s of subs.filter((x) => x.late)) {
        late++;
        expect(s.minute).toBeGreaterThanOrEqual(60);
        // Only ever at a stoppage (the ball was out, or it's the kick-off after a goal).
        expect(['out', 'kickoff'].includes(s.phase)).toBe(true);
        // The 60' look takes off anyone under 0.55; from 75' the bar is 0.45. Past FORCED_SUB_MINUTE (66') a
        // side that hasn't made a change yet makes one whatever the legs look like (its first sub of the match).
        const first = subs.filter((x) => x.e.side === s.e.side).indexOf(s) === 0;
        if (s.stamina >= (s.minute >= 75 ? 0.45 : 0.55)) {
          expect(first).toBe(true);
          expect(s.minute).toBeGreaterThanOrEqual(FORCED_SUB_MINUTE);
          forced++;
        }
        const p = m.teamPlayers(s.e.side)[s.e.slot];
        expect(p.isKeeper).toBe(false);
      }
      expect(m.subsUsed[0]).toBeLessThanOrEqual(5);
      expect(m.subsUsed[1]).toBeLessThanOrEqual(5);
      // Every AI bench gets used.
      expect(m.subsUsed[0]).toBeGreaterThan(0);
      expect(m.subsUsed[1]).toBeGreaterThan(0);
      expect(subs.filter((x) => x.e.side === 0).length).toBe(m.subsUsed[0]);
    }
    expect(late).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`late AI subs over 5 matches: ${late} (${forced} forced from ${FORCED_SUB_MINUTE}')`);
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

  it('a formation change moves each player to the nearest new slot (a right-back stays on the right)', () => {
    const cases: [FormationId, FormationId][] = [['4-4-2', '3-5-2'], ['4-3-3', '5-3-2'], ['3-5-2', '4-2-3-1'], ['5-3-2', '4-4-2'], ['4-2-3-1', '4-3-3']];
    for (const [from, to] of cases) {
      const map = formationRemap(FORMATIONS[from], FORMATIONS[to]);
      expect(map[0]).toBe(0);
      expect([...map].sort((a, b) => a - b)).toEqual(map.map((_, i) => i));
      let cost = 0;
      let byIndex = 0;
      for (let i = 1; i < map.length; i++) {
        const a = FORMATIONS[from][i];
        const b = FORMATIONS[to][map[i]];
        const c = FORMATIONS[to][i];
        cost += Math.hypot((a.x - b.x) * 48, (a.z - b.z) * 30);
        byIndex += Math.hypot((a.x - c.x) * 48, (a.z - c.z) * 30);
        // Nobody swaps flanks.
        if (Math.abs(a.z) > 0.3) expect(Math.sign(b.z)).not.toBe(-Math.sign(a.z));
      }
      expect(cost).toBeLessThanOrEqual(byIndex + 1e-9);
    }

    const m = match(6);
    m.setFormation(0, '4-4-2');
    const rb = m.teamPlayers(0)[4];
    expect(m.slots[0][4].label).toBe('RB');
    const lb = m.teamPlayers(0)[1];
    expect(m.setFormation(0, '3-5-2')).toBe(true);
    // The old right-back is still on the right (it used to become the left wing-back), the left-back
    // on the left.
    expect(m.slots[0][rb.slot].z).toBeGreaterThan(0.15);
    expect(m.slots[0][rb.slot].label).not.toBe('LWB');
    expect(m.slots[0][lb.slot].z).toBeLessThan(-0.15);
    expect(rb.role).toBe(m.slots[0][rb.slot].role);
    // teamPlayers stays in slot order, the team sheet with it, and the keeper stays in goal.
    m.teamPlayers(0).forEach((p, s) => {
      expect(p.slot).toBe(s);
      expect(m.teams[0].players[s]).toBe(p.def);
    });
    expect(m.teamPlayers(0)[0].isKeeper).toBe(true);
    // Back again: everyone returns to where they started.
    const before = m.teamPlayers(0).map((p) => p.idx);
    m.setFormation(0, '4-4-2');
    m.setFormation(0, '3-5-2');
    expect(m.teamPlayers(0).map((p) => p.idx)).toEqual(before);
  });

  it('aiSubs is safe to call twice at the same stoppage, and never takes off a man who came on', () => {
    const m = match(8);
    for (const p of m.teamPlayers(1)) if (!p.isKeeper) p.stamina = 0.3;
    m.phase = 'halftime';
    expect(m.aiSubs(1, 2)).toBe(2);
    expect(m.aiSubs(1, 2)).toBe(0);
    expect(m.subsUsed[1]).toBe(2);
    m.continueSecondHalf();
    for (const p of m.teamPlayers(1)) if (!p.isKeeper) p.stamina = 0.2;
    // Later, another stoppage: only the one change left, and not one of the two who came on.
    const fresh = m.teamPlayers(1).filter((p) => p.def.id.includes('-b')).map((p) => p.idx);
    expect(fresh.length).toBe(2);
    m.clock = 50;
    // Only two outfielders left on the bench (a keeper never replaces an outfielder).
    expect(m.aiSubs(1, 4)).toBe(2);
    expect(m.subsUsed[1]).toBe(4);
    const off = m.drainEvents().filter((e) => e.type === 'sub');
    expect(off.length).toBe(4);
    for (const e of off.slice(2)) if (e.type === 'sub') expect(fresh).not.toContain(m.teamPlayers(1)[e.slot].idx);
    // One more on the bench: the fifth and last change, then nothing more however tired they are.
    m.bench[1].push({ ...m.bench[0].find((d) => d.role === 'MF')!, id: 'extra' });
    m.clock = 60;
    expect(m.aiSubs(1, 2, 0.9)).toBe(1);
    expect(m.subsUsed[1]).toBe(5);
    m.bench[1].push({ ...m.bench[0].find((d) => d.role === 'FW')!, id: 'extra2' });
    m.clock = 70;
    expect(m.aiSubs(1, 2, 0.9)).toBe(0);
  });

  it("the 60' look takes off anyone under 0.55; by 75' the bar is 0.45; from 66' every AI bench gets used", () => {
    const at = (minute: number, stamina: number, used = 1) => {
      const m = match(12);
      m.phase = 'halftime';
      m.continueSecondHalf();
      m.phase = 'play';
      m.clock = ((minute - 45 + 0.5) / 45) * m.cfg.halfLength;
      expect(m.minute()).toBe(minute);
      for (const p of m.teamPlayers(0)) if (!p.isKeeper) p.stamina = 0.9;
      m.teamPlayers(0)[6].stamina = stamina;
      // (`used`: changes the side has already made, e.g. at half time.)
      m.subsUsed[0] = used;
      m.drainEvents();
      (m as unknown as { goOut: (k: string, s: number, x: number, z: number) => void }).goOut('throwin', 1, 0, 30);
      const subs = m.drainEvents().filter((e) => e.type === 'sub' && e.side === 0);
      return { n: subs.length, slot: subs[0]?.type === 'sub' ? subs[0].slot : -1 };
    };
    expect(at(62, 0.5).n).toBe(1);
    expect(at(62, 0.6).n).toBe(0);
    expect(at(77, 0.5).n).toBe(0);
    expect(at(77, 0.4).n).toBe(1);
    // No change made yet: from 66' (round 7: was 70', and it landed at 72-77') one comes on regardless,
    // for the most tired outfielder.
    expect(FORCED_SUB_MINUTE).toBe(66);
    expect(at(65, 0.8, 0).n).toBe(0);
    expect(at(66, 0.8, 0).n).toBe(1);
    const forced = at(72, 0.8, 0);
    expect(forced.n).toBe(1);
    expect(forced.slot).toBe(6);
    expect(at(72, 0.8, 1).n).toBe(0);
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
