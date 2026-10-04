import { afterEach, describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { defaultSave, loadSave } from '../src/core/save';
import {
  BOTTOM_DIVISION, MATCHDAYS, YOU, createClub, cupClubs, cupDue, cupTieReward, matchCoins, migrateCareer, newSeason, nextMatch, resolveCupTie,
  resolveMatchday, seasonPrizeLines, startNextSeason, trophyCount, userFixture, type CareerState,
} from '../src/meta/career';
import {
  CUP_AFTER, CUP_DIV_SCALE, CUP_JOIN_BY, CUP_SIZE, ROUND_PRIZE, ROUND_TIES, TROPHY_PRIZE, champion, cupFinish, cupPrize, cupPrizeTotal, drawCup,
  migrateCup, retiredCupNote, simulateShootout, simulateTie, userTie, type CupTie,
} from '../src/meta/cup';
import { KIT_COLORS } from '../src/meta/data';
import { shootoutWinner } from '../src/sim/shootout';
import type { Kit } from '../src/sim/types';

const KIT: Kit = { shirt: KIT_COLORS.blue, shirt2: KIT_COLORS.white, pattern: 'stripes', shorts: KIT_COLORS.white, socks: KIT_COLORS.blue, gk: 0 };

function career(seed = 7, division = BOTTOM_DIVISION): CareerState {
  const st = migrateCareer(null, seed);
  st.club = createClub({ name: 'Test Town', short: 'TST', kit: KIT, formation: '4-4-2' }, seed);
  newSeason(st, division, 1);
  return st;
}

/** Play the league matchday with the given goals for and against. */
function league(st: CareerState, wallet: { coins: number }, my = 1, their = 0): boolean {
  const s = st.season!;
  const f = userFixture(s, s.matchday);
  const home = f ? f.home === YOU : true;
  return resolveMatchday(st, wallet, s.matchday, home ? my : their, home ? their : my);
}

/** Play league matchdays until a cup tie is due (or the season is over): the round due, or -1. */
function toCupTie(st: CareerState, wallet: { coins: number }): number {
  for (let guard = 0; guard < MATCHDAYS && cupDue(st) < 0 && !st.summary; guard++) league(st, wallet);
  return cupDue(st);
}

/** The rest of the season: cup ties won (or lost) as they come, league matchdays won. */
function playOut(st: CareerState, wallet: { coins: number }, winCup: boolean): void {
  for (let guard = 0; guard < 20 && !st.summary; guard++) {
    if (cupDue(st) >= 0) resolveCupTie(st, winCup ? 2 : 0, winCup ? 0 : 1, winCup);
    else league(st, wallet);
  }
}

describe('the draw', () => {
  it('every season has a cup: you, two league rivals and five guests from the divisions round yours', () => {
    for (const div of [1, 3, 6]) {
      const st = career(21, div);
      const cup = st.season!.cup!;
      expect(cup.slots).toHaveLength(CUP_SIZE);
      expect(new Set(cup.slots).size).toBe(CUP_SIZE);
      expect(cup.slots[cup.user]).toBe(YOU);
      const rivals = new Set(st.season!.rivals.map((r) => r.id));
      expect(cup.slots.filter((id) => rivals.has(id))).toHaveLength(2);
      expect(cup.guests).toHaveLength(5);
      for (const g of cup.guests) {
        expect(cup.slots).toContain(g.id);
        expect(Math.abs(g.division - div)).toBeLessThanOrEqual(2);
        expect(g.division).toBeGreaterThanOrEqual(1);
        expect(g.division).toBeLessThanOrEqual(6);
        expect(g.rating).toBeGreaterThan(20);
      }
      // Names stay unique across the league, the guests and your club.
      const clubs = [...cupClubs(st).values()];
      expect(new Set(clubs.map((c) => c.short)).size).toBe(clubs.length);
      expect(cup.ties.slice(0, 4).flatMap((t) => [t.home, t.away]).sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      expect(cup).toMatchObject({ round: 0, status: 'active', earned: 0, celebrated: false });
    }
    // In the middle of the ladder some guests come from above (the giants) and some from below.
    const mid = career(5, 3).season!.cup!.guests.map((g) => g.division);
    expect(mid.some((d) => d < 3)).toBe(true);
    expect(mid.some((d) => d > 3)).toBe(true);
  });

  it('is seeded by the season, and leaves the league draw as it was', () => {
    const a = career(9);
    const b = career(9);
    expect(a.season!.cup).toEqual(b.season!.cup);
    const s = a.season!;
    expect(drawCup(s.seed, s.division, s.rivals, a.club)).toEqual(s.cup);
    expect(career(10).season!.cup!.slots).not.toEqual(s.cup!.slots);
  });

  it('keeps the favourite out of your half: you can only meet the strongest club in the final', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const st = career(seed, 1 + (seed % 6));
      const cup = st.season!.cup!;
      const clubs = cupClubs(st);
      const rating = (slot: number) => clubs.get(cup.slots[slot])!.rating;
      const others = [0, 1, 2, 3, 4, 5, 6, 7].filter((s) => s !== cup.user);
      const best = Math.max(...others.map(rating));
      // (Level on rating, any one of the favourites will do.)
      expect(others.some((s) => s >> 2 !== cup.user >> 2 && rating(s) === best), `seed ${seed}`).toBe(true);
    }
  });
});

describe('the season calendar', () => {
  it('the QF comes after matchday 4, the SF after 8, the final after 12; the league waits for each tie', () => {
    const st = career(13);
    const wallet = { coins: 0 };
    expect(nextMatch(st)).toMatchObject({ competition: 'league', label: 'MATCHDAY 1', tag: 'MD 1', cupRound: -1, neutral: false });
    expect(toCupTie(st, wallet)).toBe(0);
    expect(st.season!.matchday).toBe(CUP_AFTER[0]);
    const qf = nextMatch(st)!;
    expect(CUP_AFTER).toEqual([4, 8, 12]);
    expect(qf).toMatchObject({ competition: 'cup', label: 'BLOCKY CUP QUARTER FINAL', tag: 'CUP QF', cupRound: 0, md: CUP_AFTER[0] });
    expect(qf.rival.id).toBe(st.season!.cup!.slots[userTie(st.season!.cup!)!.rival]);
    // Not before the tie is played.
    expect(league(st, wallet)).toBe(false);
    expect(st.season!.matchday).toBe(CUP_AFTER[0]);
    expect(resolveCupTie(st, 2, 1, true)).toMatchObject({ round: 0, won: true, trophy: false });
    expect(cupDue(st)).toBe(-1);
    expect(nextMatch(st)).toMatchObject({ competition: 'league', label: `MATCHDAY ${CUP_AFTER[0] + 1}` });
    expect(toCupTie(st, wallet)).toBe(1);
    expect(st.season!.matchday).toBe(CUP_AFTER[1]);
    expect(nextMatch(st)).toMatchObject({ label: 'BLOCKY CUP SEMI FINAL', tag: 'CUP SF' });
    resolveCupTie(st, 1, 0, true);
    expect(toCupTie(st, wallet)).toBe(2);
    expect(st.season!.matchday).toBe(CUP_AFTER[2]);
    // The final: a neutral ground, you in your own kit.
    const fin = nextMatch(st)!;
    expect(fin).toMatchObject({ label: 'BLOCKY CUP FINAL', tag: 'CUP FINAL', neutral: true, userHome: true });
    expect(fin.kits[0]).toEqual(st.club!.kit);
    expect(resolveCupTie(st, 3, 0, true)).toMatchObject({ round: 2, won: true, trophy: true });
    expect(st.season!.cup!.status).toBe('won');
    expect(champion(st.season!.cup!)).toBe(st.season!.cup!.user);
    // Then the league's last two matchdays decide the table.
    expect(nextMatch(st)).toMatchObject({ competition: 'league', label: `MATCHDAY ${CUP_AFTER[2] + 1}` });
    expect(league(st, wallet)).toBe(true);
    expect(st.summary).toBeNull();
    expect(nextMatch(st)).toMatchObject({ competition: 'league', label: `MATCHDAY ${MATCHDAYS}` });
    expect(league(st, wallet)).toBe(true);
    expect(st.summary!.cup).toBe(3);
    expect(st.history.at(-1)!.cup).toBe(3);
    expect(trophyCount(st).cups).toBe(1);
  });

  it("a cup tie's opponent can come from another division, and plays as that club", () => {
    let seen = false;
    for (let seed = 1; seed <= 12 && !seen; seed++) {
      const st = career(seed);
      toCupTie(st, { coins: 0 });
      const nm = nextMatch(st)!;
      const them = nm.userHome ? nm.away : nm.home;
      expect(them.name).toBe(nm.rival.name);
      expect(them.players).toHaveLength(11);
      if (nm.rivalDivision !== st.season!.division) seen = true;
    }
    expect(seen).toBe(true);
  });

  it('next season brings a fresh draw', () => {
    const st = career(31);
    playOut(st, { coins: 0 }, false);
    const old = st.season!.cup!;
    startNextSeason(st);
    const cup = st.season!.cup!;
    expect(cup).toMatchObject({ round: 0, status: 'active', earned: 0 });
    expect(cup.seed).not.toBe(old.seed);
  });
});

describe('results and prizes', () => {
  it('a level tie is decided by the shootout, and the pens are stored the right way round', () => {
    const st = career(19);
    toCupTie(st, { coins: 0 });
    const cup = st.season!.cup!;
    const ut = userTie(cup)!;
    expect(resolveCupTie(st, 1, 1, true, [4, 2])!.won).toBe(true);
    const t = cup.ties[ut.idx];
    expect(t.winner).toBe(cup.user);
    expect([t.hg, t.ag]).toEqual([1, 1]);
    expect(t.pens).toEqual(ut.userHome ? [4, 2] : [2, 4]);
    // A shootout score that contradicts the result is replaced with a consistent one.
    const st2 = career(19);
    toCupTie(st2, { coins: 0 });
    resolveCupTie(st2, 0, 0, false, [5, 3]);
    const t2 = st2.season!.cup!.ties[ut.idx];
    expect(t2.winner).not.toBe(cup.user);
    const [mine, theirs] = ut.userHome ? t2.pens! : [t2.pens![1], t2.pens![0]];
    expect(mine).toBeLessThan(theirs);
    expect(st2.season!.cup!.status).toBe('out');
  });

  it('prizes scale with the division: a bonus on the season, never a second economy', () => {
    expect(cupPrize(0, true, 6)).toBe(Math.round(ROUND_PRIZE[0] * CUP_DIV_SCALE[6]));
    expect(cupPrize(2, true, 6)).toBe(Math.round(ROUND_PRIZE[2] * 0.4) + Math.round(TROPHY_PRIZE * 0.4));
    expect(cupPrize(1, false, 1)).toBe(0);
    expect(cupPrizeTotal(6)).toBe(680);
    expect(cupPrizeTotal(1)).toBe(1530);
    for (let d = 1; d <= 6; d++) {
      // Winning the whole cup pays less than winning the league in the same division...
      const title = seasonPrizeLines(1, d).reduce((s, l) => s + l.coins, 0);
      expect(cupPrizeTotal(d)).toBeLessThan(title);
      // ...and higher divisions pay more.
      if (d > 1) expect(cupPrizeTotal(d)).toBeLessThan(cupPrizeTotal(d - 1));
    }
  });

  it('a tie pays the usual match fee, plus the prize when you go through', () => {
    const won = { round: 0, won: true, trophy: false, coins: cupPrize(0, true, 6) };
    expect(cupTieReward(6, 2, 2, 1, won)).toEqual({ coins: matchCoins(6, 2, 2, 1) + won.coins, label: 'QF WIN BONUS' });
    expect(cupTieReward(6, 0, 1, 1, { ...won, round: 2, trophy: true, coins: cupPrize(2, true, 6) }).label).toBe('CUP WINNERS!');
    const out = { round: 1, won: false, trophy: false, coins: 0 };
    expect(cupTieReward(4, 0, 0, 2, out)).toEqual({ coins: matchCoins(4, 0, 0, 2), label: 'KNOCKED OUT' });
    // A stale tie: the match fee only.
    expect(cupTieReward(6, 0, 1, 0, null)).toEqual({ coins: matchCoins(6, 0, 1, 0), label: 'CUP TIE' });
  });

  it('a winning run banks every round prize in the cup, and the trophy', () => {
    const st = career(7, 4);
    playOut(st, { coins: 0 }, true);
    const cup = st.season!.cup!;
    expect(cup.status).toBe('won');
    expect(cup.earned).toBe(cupPrizeTotal(4));
    expect(cupFinish(cup)).toBe(3);
    expect(cup.ties.every((t) => t.winner >= 0 && t.hg !== null && t.ag !== null)).toBe(true);
  });

  it('knocked out: the league goes on, and the cup keeps the calendar to crown a champion', () => {
    const st = career(3);
    const wallet = { coins: 0 };
    toCupTie(st, wallet);
    expect(resolveCupTie(st, 0, 2, false)).toMatchObject({ round: 0, won: false, coins: 0 });
    const cup = st.season!.cup!;
    expect(cup.status).toBe('out');
    expect(cupDue(st)).toBe(-1);
    expect(resolveCupTie(st, 5, 0, true)).toBeNull();
    // The other QFs are settled now; the SF waits for its point of the season.
    expect(ROUND_TIES[0].every((i) => cup.ties[i].winner >= 0)).toBe(true);
    expect(cup.round).toBe(1);
    expect(cup.ties[4].winner).toBe(-1);
    expect(nextMatch(st)).toMatchObject({ competition: 'league', label: `MATCHDAY ${CUP_AFTER[0] + 1}` });
    while (st.season!.matchday < CUP_AFTER[1] - 1) league(st, wallet);
    expect(cup.ties[4].winner).toBe(-1);
    league(st, wallet);
    expect(st.season!.matchday).toBe(CUP_AFTER[1]);
    expect(cup.ties[4].winner).toBeGreaterThanOrEqual(0);
    expect(champion(cup)).toBe(-1);
    while (st.season!.matchday < CUP_AFTER[2]) league(st, wallet);
    expect(champion(cup)).toBeGreaterThanOrEqual(0);
    expect(champion(cup)).not.toBe(cup.user);
    while (!st.summary) league(st, wallet);
    expect(st.summary).toMatchObject({ cup: 0 });
    expect(st.history.at(-1)!.cup).toBe(0);
    expect(trophyCount(st).cups).toBe(0);
  });

  it('a stale or repeated cup result changes nothing', () => {
    const st = career(8);
    expect(resolveCupTie(st, 3, 0, true)).toBeNull();
    toCupTie(st, { coins: 0 });
    const before = JSON.stringify(st.season!.cup);
    expect(resolveCupTie(st, 1, 0, true)).not.toBeNull();
    expect(JSON.stringify(st.season!.cup)).not.toBe(before);
    const after = JSON.stringify(st.season!.cup);
    expect(resolveCupTie(st, 0, 4, false)).toBeNull();
    expect(JSON.stringify(st.season!.cup)).toBe(after);
  });

  it("the rest of a round is settled the same way whatever the user's result", () => {
    const a = career(77);
    const b = career(77);
    toCupTie(a, { coins: 0 });
    toCupTie(b, { coins: 0 });
    const mine = userTie(a.season!.cup!)!.idx;
    resolveCupTie(a, 2, 0, true);
    resolveCupTie(b, 0, 2, false);
    for (const i of ROUND_TIES[0]) if (i !== mine) expect(a.season!.cup!.ties[i]).toEqual(b.season!.cup!.ties[i]);
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

  it('the stronger club goes through more often (giant killings happen, just not every time)', () => {
    let strong = 0;
    for (let s = 0; s < 400; s++) {
      const r = simulateTie(new Rng(s), 88, 60);
      const homeWins = r.hg! > r.ag! || (r.hg === r.ag && r.pens![0] > r.pens![1]);
      if (homeWins) strong++;
    }
    expect(strong / 400).toBeGreaterThan(0.65);
    expect(strong / 400).toBeLessThan(1);
  });
});

describe('cup save migration', () => {
  it('a career mid-cup round-trips through JSON unchanged', () => {
    const st = career(77);
    toCupTie(st, { coins: 0 });
    resolveCupTie(st, 1, 1, true, [5, 4]);
    league(st, { coins: 0 });
    const back = migrateCareer(JSON.parse(JSON.stringify(st)), 1);
    expect(back).toEqual(st);
  });

  it('a career from before the cup gets this season\'s draw on load, joining at the right point', () => {
    // Fresh season, no cup in the save: the same draw a new season would make.
    const st = career(41);
    const raw = JSON.parse(JSON.stringify(st));
    delete raw.season.cup;
    const back = migrateCareer(raw, 1);
    expect(back.season!.cup).toEqual(st.season!.cup);
    expect(cupDue(back)).toBe(-1);

    // A matchday past the QF's slot: the QF is due straight away, then the season carries on.
    const late = career(42);
    late.season!.cup = null;
    for (let i = 0; i < CUP_AFTER[0] + 1; i++) expect(league(late, { coins: 0 })).toBe(true);
    const raw3 = JSON.parse(JSON.stringify(late));
    delete raw3.season.cup;
    const b3 = migrateCareer(raw3, 1);
    expect(b3.season!.matchday).toBe(CUP_AFTER[0] + 1);
    expect(b3.season!.cup).not.toBeNull();
    expect(cupDue(b3)).toBe(0);
    expect(nextMatch(b3)).toMatchObject({ competition: 'cup', cupRound: 0 });
    // Nothing else of the season changed.
    expect({ ...b3.season!, cup: null }).toEqual({ ...late.season!, cup: null });

    // Too late for a whole cup (past CUP_JOIN_BY): none this season, the league plays on, next season has one.
    const later = career(43);
    later.season!.cup = null;
    for (let i = 0; i <= CUP_JOIN_BY; i++) league(later, { coins: 0 });
    const raw5 = JSON.parse(JSON.stringify(later));
    delete raw5.season.cup;
    const b5 = migrateCareer(raw5, 1);
    expect(b5.season!.matchday).toBe(CUP_JOIN_BY + 1);
    expect(b5.season!.cup).toBeNull();
    expect(nextMatch(b5)).toMatchObject({ competition: 'league' });
    playOut(b5, { coins: 0 }, true);
    expect(b5.summary).not.toBeNull();
    expect(b5.summary!.cup).toBeUndefined();
    expect(b5.history.at(-1)!.cup).toBeUndefined();
    startNextSeason(b5);
    expect(b5.season!.cup).not.toBeNull();
    // A cup saved as null stays null (it doesn't come back on the next load).
    expect(migrateCareer(JSON.parse(JSON.stringify(raw5)), 1).season!.cup).toBeNull();
    expect(migrateCareer(JSON.parse(JSON.stringify({ ...later, season: { ...later.season, cup: null } })), 1).season!.cup).toBeNull();
  });

  it('a damaged cup is redrawn while there is room for it, and never breaks the season', () => {
    const st = career(55);
    const raw = JSON.parse(JSON.stringify(st));
    const bad = (cup: unknown) => migrateCareer({ ...raw, season: { ...raw.season, cup } }, 1);
    const fresh = st.season!.cup;
    expect(bad('cup').season!.cup).toEqual(fresh);
    expect(bad({ ...raw.season.cup, slots: raw.season.cup.slots.slice(1) }).season!.cup).toEqual(fresh);
    expect(bad({ ...raw.season.cup, slots: raw.season.cup.slots.map((s: string) => (s === YOU ? 'zz' : s)) }).season!.cup).toEqual(fresh);
    expect(bad({ ...raw.season.cup, status: 'party' }).season!.cup).toEqual(fresh);
    expect(bad({ ...raw.season.cup, ties: raw.season.cup.ties.slice(1) }).season!.cup).toEqual(fresh);
    const t0: CupTie = raw.season.cup.ties[0];
    expect(bad({ ...raw.season.cup, ties: [{ ...t0, winner: 7 === t0.home || 7 === t0.away ? 6 : 7 }, ...raw.season.cup.ties.slice(1)] }).season!.cup).toEqual(fresh);
    // Soft fields fall back rather than dropping the cup.
    expect(bad({ ...raw.season.cup, earned: 'lots', celebrated: 'yes' }).season!.cup).toEqual({ ...fresh, earned: 0, celebrated: false });
    // The season itself always survives.
    expect(bad('cup').season!.fixtures).toEqual(st.season!.fixtures);
  });

  it('old history and summaries (no cup) still load; a cup run is kept when there is one', () => {
    const st = career(60);
    playOut(st, { coins: 0 }, true);
    const raw = JSON.parse(JSON.stringify(st));
    const back = migrateCareer(raw, 1);
    expect(back.summary!.cup).toBe(3);
    expect(back.history.at(-1)!.cup).toBe(3);
    delete raw.summary.cup;
    raw.history = [{ season: 1, division: 6, position: 2, outcome: 'promoted' }, { season: 2, division: 5, position: 4, outcome: 'stayed', cup: 'x' }];
    const old = migrateCareer(raw, 1);
    expect(old.summary!.cup).toBeUndefined();
    expect(old.history).toEqual([
      { season: 1, division: 6, position: 2, outcome: 'promoted' },
      { season: 2, division: 5, position: 4, outcome: 'stayed' },
    ]);
  });
});

describe('the retired standalone cup', () => {
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

  const tie = (home: number, away: number, winner = -1): CupTie => ({
    home, away, hg: winner < 0 ? null : 2, ag: winner < 0 ? null : 0, pens: null, winner,
  });
  /** An old save's cup, mid-run: through the QF (300 coins banked), the SF to play. */
  const oldCup = () => ({
    version: 1, seed: 99, difficulty: 1, clubs: [0, 1, 2, 3, 4, 5, 6, 7], user: 0,
    ties: [tie(0, 1, 0), tie(2, 3, 2), tie(4, 5, 4), tie(6, 7, 6), tie(0, 2), tie(4, 6), tie(-1, -1)],
    round: 1, status: 'active', earned: 300, celebrated: false,
  });

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

  it('an old cup still reads (so it can be retired), and anything malformed is dropped', () => {
    const st = oldCup();
    expect(migrateCup(JSON.parse(JSON.stringify(st)))).toEqual(st);
    stubStorage(JSON.stringify({ ...defaultSave(), cup: st }));
    expect(migrateCup(loadSave().cup)).toEqual(st);
    expect(migrateCup(null)).toBeNull();
    expect(migrateCup({ ...st, version: 2 })).toBeNull();
    expect(migrateCup({ ...st, clubs: [0, 0, 1, 2, 3, 4, 5, 6] })).toBeNull();
    expect(migrateCup({ ...st, ties: st.ties.slice(1) })).toBeNull();
  });

  it('retiring it says what happened and keeps the coins it won (they were banked tie by tie)', () => {
    const note = retiredCupNote(oldCup())!;
    expect(note).toMatch(/part of Road to Glory now/);
    expect(note).toMatch(/300 coins it won are yours to keep/);
    expect(note.length).toBeLessThanOrEqual(200);
    expect(note).not.toMatch(/[·●—–]/);
    expect(retiredCupNote({ ...oldCup(), status: 'won', earned: 1700 })).toMatch(/won the old Blocky Cup!/);
    expect(retiredCupNote({ ...oldCup(), status: 'out', earned: 0 })).not.toMatch(/coins/);
    expect(retiredCupNote(null)).toBeNull();
    expect(retiredCupNote('garbage')).toBeNull();
  });
});
