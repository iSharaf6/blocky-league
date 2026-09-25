import { afterEach, describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { defaultSave, loadSave } from '../src/core/save';
import {
  CUP_SIZE, DIFF_MULT, ROUND_PRIZE, ROUND_TIES, TROPHY_PRIZE, champion, cupPrize, migrateCup, newCup, pickOpponents, recordUserTie,
  simulateShootout, simulateTie, userTie, type CupState,
} from '../src/meta/cup';
import { PRESET_CLUBS } from '../src/meta/data';
import { shootoutWinner } from '../src/sim/shootout';

const avgLevel = (clubs: number[]) => clubs.reduce((s, i) => s + PRESET_CLUBS[i].level, 0) / clubs.length;

/** Win (or lose) every tie the user plays until the cup is over. */
function playOut(st: CupState, win: (round: number) => boolean): number {
  let coins = 0;
  for (let guard = 0; guard < 5 && userTie(st); guard++) {
    const w = win(st.round);
    coins += recordUserTie(st, w ? 2 : 0, w ? 0 : 1, w)!.coins;
  }
  return coins;
}

describe('cup draw', () => {
  it('draws you and seven rivals into a seeded bracket', () => {
    const st = newCup(42, 5, 1);
    expect(st.clubs).toHaveLength(CUP_SIZE);
    expect(new Set(st.clubs).size).toBe(CUP_SIZE);
    expect(st.clubs[st.user]).toBe(5);
    expect(st.round).toBe(0);
    expect(st.status).toBe('active');
    const qf = ROUND_TIES[0].map((i) => st.ties[i]);
    expect(qf.flatMap((t) => [t.home, t.away]).sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(st.ties.slice(4).every((t) => t.home === -1 && t.away === -1 && t.winner === -1)).toBe(true);
    // Same seed, same draw; another seed shuffles it.
    expect(newCup(42, 5, 1)).toEqual(st);
    const others = [1, 2, 3, 4, 5].map((s) => newCup(s, 5, 1).clubs.join());
    expect(new Set(others).size).toBeGreaterThan(1);
  });

  it('picks rivals around the chosen difficulty', () => {
    const easy = avgLevel(pickOpponents(5, 0, new Rng(1)));
    const legend = avgLevel(pickOpponents(5, 3, new Rng(1)));
    expect(legend).toBeGreaterThan(easy + 10);
    expect(pickOpponents(5, 2, new Rng(9))).not.toContain(5);
  });
});

describe('cup advancement', () => {
  it('a win moves you on; three wins lift the trophy and pay out per round', () => {
    const st = newCup(7, 3, 2);
    const coins = playOut(st, () => true);
    expect(st.status).toBe('won');
    expect(st.round).toBe(3);
    expect(champion(st)).toBe(st.user);
    const mult = DIFF_MULT[2];
    const expected = ROUND_PRIZE.reduce((s, p) => s + Math.round(p * mult), 0) + Math.round(TROPHY_PRIZE * mult);
    expect(coins).toBe(expected);
    expect(st.earned).toBe(expected);
    // Every tie in the bracket was settled.
    expect(st.ties.every((t) => t.winner >= 0 && t.hg !== null && t.ag !== null)).toBe(true);
  });

  it('after the quarter-final your semi-final is against the winner of the neighbouring tie', () => {
    const st = newCup(11, 6, 1);
    const qfIdx = userTie(st)!.idx;
    recordUserTie(st, 3, 1, true);
    expect(st.round).toBe(1);
    const sf = userTie(st)!;
    const neighbour = qfIdx % 2 === 0 ? qfIdx + 1 : qfIdx - 1;
    expect([sf.tie.home, sf.tie.away]).toContain(st.user);
    expect([sf.tie.home, sf.tie.away]).toContain(st.ties[neighbour].winner);
    expect(ROUND_TIES[0].every((i) => st.ties[i].winner >= 0)).toBe(true);
  });

  it('a defeat knocks you out, pays nothing, and the rest of the cup still crowns a champion', () => {
    const st = newCup(3, 2, 1);
    const coins = playOut(st, (r) => r === 0);
    expect(st.status).toBe('out');
    expect(coins).toBe(cupPrize(0, true, 1));
    expect(userTie(st)).toBeNull();
    expect(st.round).toBe(3);
    expect(champion(st)).toBeGreaterThanOrEqual(0);
    expect(champion(st)).not.toBe(st.user);
    expect(recordUserTie(st, 5, 0, true)).toBeNull();
  });

  it('a level tie is decided by the shootout, and the pens are stored the right way round', () => {
    const st = newCup(19, 4, 1);
    const ut = userTie(st)!;
    const out = recordUserTie(st, 1, 1, true, [4, 2])!;
    expect(out.won).toBe(true);
    const t = st.ties[ut.idx];
    expect(t.winner).toBe(st.user);
    expect(t.hg).toBe(1);
    expect(t.ag).toBe(1);
    expect(t.pens).toEqual(ut.userHome ? [4, 2] : [2, 4]);
    // A shootout score that contradicts the result is replaced with a consistent one.
    const st2 = newCup(19, 4, 1);
    recordUserTie(st2, 0, 0, false, [5, 3]);
    const t2 = st2.ties[ut.idx];
    expect(t2.winner).not.toBe(st2.user);
    const [mine, theirs] = ut.userHome ? t2.pens! : [t2.pens![1], t2.pens![0]];
    expect(mine).toBeLessThan(theirs);
    expect(st2.status).toBe('out');
  });
});

describe('AI ties', () => {
  it('are deterministic per seed and draws always go to a decisive shootout', () => {
    expect(simulateTie(new Rng(5), 70, 66)).toEqual(simulateTie(new Rng(5), 70, 66));
    let draws = 0;
    for (let s = 0; s < 300; s++) {
      const r = simulateTie(new Rng(s), 68, 68);
      if (r.hg === r.ag) {
        draws++;
        expect(r.pens).not.toBeNull();
        expect(r.pens![0]).not.toBe(r.pens![1]);
      } else expect(r.pens).toBeNull();
    }
    expect(draws).toBeGreaterThan(20);
  });

  it('simulated shootouts follow the real rules', () => {
    for (let s = 0; s < 200; s++) {
      const [a, b] = simulateShootout(new Rng(s), 70, 70);
      expect(a).not.toBe(b);
      expect(Math.max(a, b)).toBeLessThanOrEqual(30);
    }
    // Checked against the shootout rules: a 3-0 after three each is already over.
    expect(shootoutWinner([[true, true, true], [false, false, false]])).toBe(0);
  });

  it('the stronger club goes through more often', () => {
    let strong = 0;
    for (let s = 0; s < 400; s++) {
      const r = simulateTie(new Rng(s), 88, 60);
      const homeWins = r.hg! > r.ag! || (r.hg === r.ag && r.pens![0] > r.pens![1]);
      if (homeWins) strong++;
    }
    expect(strong / 400).toBeGreaterThan(0.65);
  });

  it("the rest of a round is settled the same way whatever the user's result", () => {
    const a = newCup(77, 1, 1);
    const b = newCup(77, 1, 1);
    const mine = userTie(a)!.idx;
    recordUserTie(a, 2, 0, true);
    recordUserTie(b, 0, 2, false);
    for (const i of ROUND_TIES[0]) if (i !== mine) expect(a.ties[i]).toEqual(b.ties[i]);
  });
});

describe('cup save migration', () => {
  const g = globalThis as unknown as { localStorage?: unknown };
  const original = g.localStorage;
  afterEach(() => {
    g.localStorage = original;
  });

  function stubStorage(value: string | null): void {
    const store = new Map<string, string>();
    if (value !== null) store.set('blocky-league-save-v1', value);
    g.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  }

  it('saves from before the cup load with no cup', () => {
    const old = { ...defaultSave(), coins: 900 } as Record<string, unknown>;
    delete old.cup;
    stubStorage(JSON.stringify(old));
    const s = loadSave();
    expect(s.coins).toBe(900);
    expect(s.cup).toBeNull();
    stubStorage(JSON.stringify({ ...old, cup: 'garbage' }));
    expect(loadSave().cup).toBeNull();
    expect(defaultSave().cup).toBeNull();
  });

  it('a cup survives a save round trip, and anything malformed is dropped', () => {
    const st = newCup(1234, 8, 3);
    recordUserTie(st, 1, 1, true, [5, 4]);
    const back = migrateCup(JSON.parse(JSON.stringify(st)));
    expect(back).toEqual(st);

    stubStorage(JSON.stringify({ ...defaultSave(), cup: st }));
    expect(migrateCup(loadSave().cup)).toEqual(st);

    expect(migrateCup(null)).toBeNull();
    expect(migrateCup(undefined)).toBeNull();
    expect(migrateCup('cup')).toBeNull();
    expect(migrateCup({ ...st, version: 2 })).toBeNull();
    expect(migrateCup({ ...st, clubs: st.clubs.slice(0, 7) })).toBeNull();
    expect(migrateCup({ ...st, clubs: [0, 0, 1, 2, 3, 4, 5, 6] })).toBeNull();
    expect(migrateCup({ ...st, status: 'party' })).toBeNull();
    expect(migrateCup({ ...st, ties: st.ties.slice(1) })).toBeNull();
    expect(migrateCup({ ...st, ties: [{ ...st.ties[0], winner: 99 }, ...st.ties.slice(1)] })).toBeNull();
    // Soft fields fall back rather than failing the whole cup.
    expect(migrateCup({ ...st, earned: 'lots', celebrated: 'yes' })).toEqual({ ...st, earned: 0, celebrated: false });
  });
});
