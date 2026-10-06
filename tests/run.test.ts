import { describe, expect, it } from 'vitest';
import { defaultSave } from '../src/core/save';
import { PRESET_CLUBS } from '../src/meta/data';
import {
  PERK_INFO, RUN_MILESTONES, RUN_PERKS, RUN_ROUNDS, abandonRun, activePerks, bestText, currentOpponent, defaultRun,
  drawOffer, normalizeRun, pickPerk, presetOvr, recordRunResult, resolveStaleMatch, runLadder, runMatchConfig,
  runMatchCoins, runOutcome, runPower, runTileText, runXpBonus, settleRunMatch, startRun, weakerPending,
  type RunPerkId, type RunState,
} from '../src/meta/run';
import { KIND_WEIGHTS } from '../src/sim/blitz';

const NORMAL_SIM = 1.8;

function fresh(seed = 12345, club = 5, difficulty = 1): RunState {
  const st = defaultRun();
  expect(startRun(st, { seed, club, difficulty })).toBe(true);
  return st;
}

/** Play the coming match: kick-off then the result. */
function play(st: RunState, won: boolean, score: [number, number] = won ? [2, 0] : [0, 1], pens: [number, number] | null = null) {
  st.inMatch = true;
  return recordRunResult(st, { won, score, pens });
}

/** Win the coming match and take the first card on offer (or `perk` if it's there). */
function winAndPick(st: RunState, perk?: RunPerkId): RunPerkId | null {
  play(st, true);
  if (!st.active) return null;
  const pick = perk && st.offer.includes(perk) ? perk : st.offer[0];
  expect(pickPerk(st, pick)).toBe(true);
  return pick;
}

describe('Club Run ladder', () => {
  it('is seven distinct clubs, never yours, weakest first by squad rating', () => {
    for (const club of [0, 5, 10]) {
      for (let seed = 1; seed < 40; seed++) {
        const l = runLadder(seed * 7919, club);
        expect(l).toHaveLength(RUN_ROUNDS);
        expect(new Set(l).size).toBe(RUN_ROUNDS);
        expect(l).not.toContain(club);
        for (const i of l) expect(PRESET_CLUBS[i]).toBeDefined();
        for (let k = 1; k < l.length; k++) expect(presetOvr(l[k])).toBeGreaterThanOrEqual(presetOvr(l[k - 1]));
      }
    }
  });

  it('is fixed by the seed, and different seeds give different ladders', () => {
    expect(runLadder(99, 5)).toEqual(runLadder(99, 5));
    const seen = new Set<string>();
    for (let s = 1; s <= 30; s++) seen.add(runLadder(s, 5).join(','));
    expect(seen.size).toBeGreaterThan(5);
    const a = fresh(4242);
    const b = fresh(4242);
    expect(a.ladder).toEqual(b.ladder);
    expect(a.offer).toEqual(b.offer);
  });
});

describe('Club Run perks', () => {
  it('offers three distinct perks after a win, drawn from the seed', () => {
    const a = fresh(777);
    const b = fresh(777);
    play(a, true);
    play(b, true);
    expect(a.offer).toHaveLength(3);
    expect(new Set(a.offer).size).toBe(3);
    expect(a.offer).toEqual(b.offer);
    for (const p of a.offer) expect(RUN_PERKS).toContain(p);
  });

  it('never offers a perk you hold (SOFT DRAW, a one-match perk, can come back)', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const st = fresh(seed * 131);
      for (let r = 0; r < RUN_ROUNDS - 1; r++) {
        play(st, true);
        expect(st.offer.length).toBeGreaterThan(0);
        expect(new Set(st.offer).size).toBe(st.offer.length);
        for (const p of st.offer) if (!PERK_INFO[p].once) expect(st.perks).not.toContain(p);
        pickPerk(st, st.offer[st.offer.length - 1]);
      }
      const lasting = st.perks.filter((p) => p !== 'weakerNext');
      expect(new Set(lasting).size).toBe(lasting.length);
    }
  });

  it('draws the POWER START item from the seed, weighted like the pitch pickups', () => {
    const kinds = new Set(KIND_WEIGHTS.map(([k]) => k));
    const seen = new Map<string, number>();
    for (let s = 1; s <= 400; s++) {
      const k = runPower({ seed: s * 2654435761, round: s % 7 });
      expect(kinds.has(k)).toBe(true);
      seen.set(k, (seen.get(k) ?? 0) + 1);
      expect(runPower({ seed: s * 2654435761, round: s % 7 })).toBe(k);
    }
    expect(seen.size).toBe(kinds.size);
  });

  it('rejects a pick that is not on offer', () => {
    const st = fresh();
    expect(pickPerk(st, 'xpBoost')).toBe(false);
    play(st, true);
    const off = RUN_PERKS.find((p) => !st.offer.includes(p))!;
    expect(pickPerk(st, off)).toBe(false);
    expect(pickPerk(st, st.offer[0])).toBe(true);
    expect(st.offer).toEqual([]);
  });
});

describe('Club Run match set-up (perks to MatchConfig)', () => {
  it('round 1: a 1-minute knockout, classic, no perk fields', () => {
    const st = fresh(1, 5, 2);
    const c = runMatchConfig(st, 3)!;
    expect(c).toMatchObject({ round: 1, opponent: st.ladder[0], club: 5, difficulty: 2, halfMinutes: 1, humanSide: 0, knockout: true, mode: 'classic' });
    expect(c.startScore).toBeUndefined();
    expect(c.keeperBoost).toBeUndefined();
    expect(c.goldenFirst).toBeUndefined();
    expect(c.startPower).toBeUndefined();
    expect(c.sideDifficulty).toBeUndefined();
  });

  it('maps each perk to its field', () => {
    const st = fresh();
    st.round = 5;
    st.perks = ['powerStart', 'headStart', 'goldenFirst', 'keeperBoost', 'xpBoost'];
    const c = runMatchConfig(st, NORMAL_SIM)!;
    expect(c.mode).toBe('blitz');
    expect(c.startPower?.[1]).toBeNull();
    expect(KIND_WEIGHTS.map(([k]) => k)).toContain(c.startPower?.[0]);
    expect(c.startPower?.[0]).toBe(runPower(st));
    expect(c.startScore).toEqual([1, 0]);
    expect(c.goldenFirst).toBe(0);
    expect(c.keeperBoost).toEqual([0.3, 0]);
    expect(c.sideDifficulty).toBeUndefined();
    expect(c.opponent).toBe(st.ladder[5]);
  });

  it('SOFT DRAW makes only the next opponent one level easier', () => {
    const st = fresh(55);
    play(st, true);
    const soft = st.offer.includes('weakerNext');
    // Force the pick for the test when the seed didn't deal it.
    st.offer = soft ? st.offer : ['weakerNext', ...st.offer.slice(0, 2)];
    pickPerk(st, 'weakerNext');
    expect(weakerPending(st)).toBe(true);
    expect(activePerks(st)).toContain('weakerNext');
    expect(runMatchConfig(st, NORMAL_SIM)!.sideDifficulty).toEqual([NORMAL_SIM, NORMAL_SIM - 1]);
    expect(runMatchConfig(st, 0.6)!.sideDifficulty).toEqual([0.6, 0]);
    play(st, true);
    pickPerk(st, st.offer.find((p) => p !== 'weakerNext') ?? st.offer[0]);
    if (st.perks[st.round - 1] !== 'weakerNext') {
      expect(weakerPending(st)).toBe(false);
      expect(runMatchConfig(st, NORMAL_SIM)!.sideDifficulty).toBeUndefined();
      expect(activePerks(st)).not.toContain('weakerNext');
    }
  });

  it('is null with a perk still to pick or no run', () => {
    const st = fresh();
    play(st, true);
    expect(runMatchConfig(st, NORMAL_SIM)).toBeNull();
    expect(runMatchConfig(defaultRun(), NORMAL_SIM)).toBeNull();
  });
});

describe('Club Run results', () => {
  it('a loss ends the run', () => {
    const st = fresh();
    winAndPick(st);
    const step = play(st, false, [1, 2])!;
    expect(step.ended).toBe(true);
    expect(step.won).toBe(false);
    expect(st.active).toBe(false);
    expect(st.offer).toEqual([]);
    expect(st.last).toMatchObject({ round: 2, won: false, score: [1, 2], how: 'played' });
    expect(runMatchConfig(st, NORMAL_SIM)).toBeNull();
  });

  it('a level score goes to penalties: the shootout winner decides', () => {
    const w = runOutcome([1, 1], 0, [4, 3]);
    expect(w).toEqual({ won: true, score: [1, 1], pens: [4, 3], how: 'played' });
    const l = runOutcome([2, 2], 1, [2, 4]);
    expect(l.won).toBe(false);
    expect(l.pens).toEqual([2, 4]);
    // A level score with no winner at all (no shootout happened) doesn't let the run go on.
    expect(runOutcome([0, 0], undefined).won).toBe(false);
    // Decided in normal time: the score decides, and a stray pens pair is dropped.
    expect(runOutcome([3, 1], 0, [5, 4])).toEqual({ won: true, score: [3, 1], pens: null, how: 'played' });
    expect(runOutcome([3, 1], undefined).won).toBe(true);

    const st = fresh();
    st.inMatch = true;
    const step = recordRunResult(st, runOutcome([1, 1], 0, [5, 4]))!;
    expect(step.won).toBe(true);
    expect(step.pens).toEqual([5, 4]);
    expect(st.active).toBe(true);
    expect(st.round).toBe(1);
    expect(st.offer.length).toBe(3);
    st.offer = [];
    st.perks.push('xpBoost');
    st.inMatch = true;
    const out = recordRunResult(st, runOutcome([0, 0], 1, [3, 4]))!;
    expect(out.ended).toBe(true);
    expect(st.last?.pens).toEqual([3, 4]);
  });

  it('applies a result only once, and only for a launched match', () => {
    const st = fresh();
    expect(recordRunResult(st, { won: true, score: [1, 0] })).toBeNull();
    st.inMatch = true;
    expect(recordRunResult(st, { won: true, score: [1, 0] })).not.toBeNull();
    expect(recordRunResult(st, { won: true, score: [1, 0] })).toBeNull();
    expect(st.round).toBe(1);
  });

  it('seven wins clear the run', () => {
    const st = fresh(31337);
    for (let r = 0; r < RUN_ROUNDS - 1; r++) winAndPick(st);
    expect(st.round).toBe(RUN_ROUNDS - 1);
    const step = play(st, true)!;
    expect(step.cleared).toBe(true);
    expect(step.ended).toBe(true);
    expect(st.active).toBe(false);
    expect(st.cleared).toBe(1);
    expect(st.best).toBe(RUN_ROUNDS);
    expect(bestText(st)).toBe('BEST: ALL 7 WON');
    expect(st.offer).toEqual([]);
  });

  it('pays match coins by round and difficulty, nothing for a walk-off', () => {
    expect(runMatchCoins(1, 1, true, 2)).toBe(100);
    expect(runMatchCoins(7, 1, true, 0)).toBe(200);
    expect(runMatchCoins(3, 3, true, 1)).toBeGreaterThan(runMatchCoins(3, 1, true, 1));
    expect(runMatchCoins(3, 1, false, 1)).toBe(30);
    const st = fresh();
    st.inMatch = true;
    expect(recordRunResult(st, { won: false, score: [0, 0], how: 'quit' })!.coins).toBe(0);
  });

  it('caps the goal bonus at three in wins and losses without changing round or difficulty rewards', () => {
    for (const won of [true, false]) for (const round of [1, 7]) for (const difficulty of [0, 1, 2, 3]) {
      expect(runMatchCoins(round, difficulty, won, 15)).toBe(runMatchCoins(round, difficulty, won, 3));
      expect(runMatchCoins(round, difficulty, won, 3)).toBeGreaterThan(runMatchCoins(round, difficulty, won, 1));
    }
  });
});

describe('Club Run milestones', () => {
  it('pay coins, XP and a title once ever, for winning rounds 3, 5 and 7', () => {
    const save = defaultSave();
    save.run = defaultRun();
    const coins0 = save.coins;
    const xp0 = save.progress.xp;
    const paid: number[] = [];
    const winRound = () => {
      save.run!.inMatch = true;
      const step = settleRunMatch(save, { won: true, score: [1, 0] })!;
      if (step.milestone) paid.push(step.milestone.round);
      if (save.run!.offer.length) pickPerk(save.run!, save.run!.offer[0]);
      return step;
    };
    startRun(save.run, { seed: 5, club: 5, difficulty: 1 });
    for (let r = 0; r < RUN_ROUNDS; r++) winRound();
    expect(paid).toEqual([3, 5, 7]);
    const total = RUN_MILESTONES.reduce((n, m) => n + m.coins, 0);
    const totalXp = RUN_MILESTONES.reduce((n, m) => n + m.xp, 0);
    expect(save.coins - coins0).toBe(total);
    expect(save.progress.xp - xp0).toBe(totalXp);
    expect(save.season!.xp).toBe(totalXp);
    expect(save.run.milestones.sort()).toEqual([3, 5, 7]);
    // A second clear pays no milestone again.
    paid.length = 0;
    startRun(save.run, { seed: 6, club: 5, difficulty: 1 });
    for (let r = 0; r < RUN_ROUNDS; r++) winRound();
    expect(paid).toEqual([]);
    expect(save.coins - coins0).toBe(total);
    expect(save.run.cleared).toBe(2);
  });
});

describe('Club Run best run, abandon and leaving mid-match', () => {
  it('tracks the furthest round reached and the club met there', () => {
    const st = fresh(8);
    expect(st.best).toBe(1);
    winAndPick(st);
    winAndPick(st);
    expect(st.best).toBe(3);
    expect(st.bestVs).toBe(st.ladder[2]);
    const vs = st.ladder[2];
    const step = play(st, false)!;
    expect(step.newBest).toBe(true);
    const word = PRESET_CLUBS[vs].name.split(' ')[0].toUpperCase();
    expect(bestText(st)).toBe(`BEST: ROUND 3 v ${word}`);
    // A shorter run later leaves the best alone.
    startRun(st, { seed: 9, club: 5, difficulty: 1 });
    const again = play(st, false)!;
    expect(again.newBest).toBe(false);
    expect(st.best).toBe(3);
    expect(st.bestVs).toBe(vs);
    expect(st.runs).toBe(2);
  });

  it('ABANDON ends the run between matches and keeps best and milestones', () => {
    const st = fresh();
    winAndPick(st);
    st.milestones = [3];
    expect(abandonRun(st)).toBe(true);
    expect(st.active).toBe(false);
    expect(st.last?.how).toBe('abandoned');
    expect(st.best).toBe(2);
    expect(st.milestones).toEqual([3]);
    expect(abandonRun(st)).toBe(false);
    // A new run can start straight away.
    expect(startRun(st, { seed: 2, club: 5, difficulty: 1 })).toBe(true);
    expect(startRun(st, { seed: 3, club: 5, difficulty: 1 })).toBe(false);
  });

  it('walking off (onQuit) and a match that never reported both count as a loss', () => {
    const save = defaultSave();
    save.run = fresh();
    save.run.inMatch = true;
    const q = settleRunMatch(save, { won: false, score: [0, 0], how: 'quit' })!;
    expect(q.ended).toBe(true);
    expect(save.run.last?.how).toBe('quit');

    const st = fresh();
    st.inMatch = true; // the game closed mid-match
    const reloaded = normalizeRun(JSON.parse(JSON.stringify(st)));
    expect(reloaded.active).toBe(true);
    expect(runTileText({ run: reloaded })).toMatch(/^BEST: ROUND 1 v /);
    expect(reloaded.active).toBe(false);
    expect(reloaded.last?.how).toBe('left');
    expect(resolveStaleMatch(reloaded)).toBeNull();
  });
});

describe('Club Run XP BOOST and the save round trip', () => {
  it('adds 20% of the match XP only while XP BOOST is held', () => {
    const save = defaultSave();
    save.run = fresh();
    expect(runXpBonus(save, 200)).toBe(0);
    save.run.perks.push('xpBoost');
    const xp0 = save.progress.xp;
    expect(runXpBonus(save, 200)).toBe(40);
    expect(save.progress.xp - xp0).toBe(40);
    expect(save.season!.xp).toBe(40);
    expect(save.run.xp).toBe(40);
  });

  it('survives JSON and normalizes damaged blobs', () => {
    const st = fresh(424242);
    winAndPick(st);
    play(st, true);
    const back = normalizeRun(JSON.parse(JSON.stringify(st)));
    expect(back).toEqual(st);
    expect(currentOpponent(back)).toBe(st.ladder[2]);
    const bad = normalizeRun({ active: true, round: 2, ladder: [1, 2], perks: ['nope', 'headStart'], offer: ['x'], best: -3, milestones: [3, 4, 3] });
    expect(bad.active).toBe(false);
    expect(bad.perks).toEqual(['headStart']);
    expect(bad.offer).toEqual([]);
    expect(bad.best).toBe(0);
    expect(bad.milestones).toEqual([3]);
    expect(normalizeRun(null)).toEqual(defaultRun());
    expect(normalizeRun('junk')).toEqual(defaultRun());
  });

  it('the menu tile line follows the run', () => {
    const st = defaultRun();
    expect(runTileText({ run: st })).toBe('7 WINS, ONE LIFE');
    startRun(st, { seed: 1, club: 5, difficulty: 1 });
    expect(runTileText({ run: st })).toMatch(/^ROUND 1 OF 7 v [A-Z]+$/);
    play(st, true);
    expect(runTileText({ run: st })).toBe('PICK A PERK');
  });

  it('draws are deterministic for the same state', () => {
    const st = fresh(1001);
    play(st, true);
    expect(drawOffer(st)).toEqual(st.offer);
  });
});
