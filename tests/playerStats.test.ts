/**
 * The owner: "should also show stats of players in my team, like appearances goals assists and etc for gk all that yk
 * when im looking at my team". Appearances, starts, minutes, goals, assists, rating, cards and man of the match for
 * every player; clean sheets, saves, goals against and penalties saved for a keeper. Tallied in the match
 * (game/ratings.ts), built into a record at full time (ui/forever.ts matchFacts), added to the season and career
 * lines (meta/life.ts recordMatch), made up plausibly for a simulated match, and read from an older save as zeros.
 */
import { describe, expect, it } from 'vitest';
import { MatchTally } from '../src/game/ratings';
import type { MatchResult } from '../src/game/matchSession';
import { Rng } from '../src/core/rng';
import type { Match } from '../src/sim/match';
import { BOTTOM_DIVISION, createClub, migrateCareer, newSeason, type CareerState } from '../src/meta/career';
import { KIT_COLORS } from '../src/meta/data';
import type { LifePlayer } from '../src/meta/life';
import { afterMatch } from '../src/meta/career';
import { LINE_KEYS, avgRating, careerLine, emptyLine, readLine, ratingText, seasonLine, simStats, squadLeaders } from '../src/meta/stats';
import { openAll, simMatch } from '../src/meta/week';
import { matchFacts } from '../src/ui/forever';
import type { Kit, PlayerDef } from '../src/sim/types';

const KIT: Kit = { shirt: KIT_COLORS.blue, shirt2: KIT_COLORS.white, pattern: 'stripes', shorts: KIT_COLORS.white, socks: KIT_COLORS.blue, gk: 0 };

function career(seed = 7): CareerState {
  const st = migrateCareer(null, seed);
  st.club = createClub({ name: 'Test Town', short: 'TST', kit: KIT, formation: '4-4-2' }, seed);
  newSeason(st, BOTTOM_DIVISION, 1);
  return st;
}

/** A bare Match: the two elevens by slot (0 and 11 are the keepers), what the tally reads, and a settable clock. */
function fakeMatch(minute = 90): Match & { at: number } {
  const players = Array.from({ length: 22 }, (_, i) => ({
    idx: i, side: i < 11 ? 0 : 1, def: { name: `P${i}`, id: `p${i}` }, isKeeper: i % 11 === 0, role: i % 11 === 0 ? 'GK' : 'MF',
  }));
  const m = {
    at: minute, players, score: [0, 0], shootout: null, shotClock: 0.5,
    minute() { return this.at; },
    keeperOf(side: number) { return players[side * 11]; },
  };
  return m as unknown as Match & { at: number };
}

describe('the match tally keeps the record book numbers', () => {
  it('counts a keeper\'s goals against, a saved penalty, cards and the minutes of a change', () => {
    const t = new MatchTally();
    const m = fakeMatch(30);
    // A goal for the other side: our keeper (slot 0) lets it in.
    t.observe({ type: 'goal', side: 1, scorer: 15, own: false }, m);
    t.observe({ type: 'goal', side: 1, scorer: 15, own: true }, m);
    // A penalty for them, saved by our keeper; a save in open play after it is an ordinary save.
    t.observe({ type: 'restart', kind: 'penalty', side: 1 }, m);
    t.observe({ type: 'save', keeper: 0, caught: false }, m);
    t.observe({ type: 'save', keeper: 0, caught: true }, m);
    // A yellow for slot 5, and a red for slot 6 at 40.
    t.observe({ type: 'card', player: 5, color: 'yellow' }, m);
    m.at = 40;
    t.observe({ type: 'card', player: 6, color: 'red' }, m);
    // Slot 9 comes off at 60 for a sub (the sim has put the new man in the slot by the time the tally hears of it).
    m.at = 60;
    t.observe({ type: 'sub', side: 0, slot: 9, on: 'Sub', off: 'P9' }, m);
    (m.players[9] as unknown as { def: { name: string; id: string } }).def = { name: 'Sub', id: 'sub' };
    t.sub(9, 'P9', 0, false, false);
    m.at = 90;
    const rows = t.ratings(m);
    const by = (name: string) => rows.find((r) => r.name === name)!;
    expect(by('P0')).toMatchObject({ conceded: 2, pensSaved: 1, saves: 0, keeper: true, on: 0, off: 90 });
    expect(by('P5')).toMatchObject({ yellow: 1, red: 0 });
    expect(by('P6')).toMatchObject({ red: 1, on: 0, off: 40 });
    // The man who went off was on from 0 to 60; the sub from 60 to the end, from nothing.
    expect(by('P9')).toMatchObject({ on: 0, off: 60 });
    expect(by('Sub')).toMatchObject({ on: 60, off: 90, goals: 0, yellow: 0 });
  });

  it('reads a tally that never saw those events as zeros (a match recovered from before)', () => {
    const rows = new MatchTally().ratings(fakeMatch(90));
    for (const r of rows) expect(r).toMatchObject({ conceded: 0, pensSaved: 0, yellow: 0, red: 0, on: 0, off: 90 });
  });
});

describe('a played match reaches the players\' lines', () => {
  function result(st: CareerState): MatchResult {
    const squad = st.club!.squad;
    const m = fakeMatch(90);
    // Our eleven are the squad's first eleven: slots 0..10 get their names and ids.
    for (let i = 0; i < 11; i++) {
      const p = m.players[i] as unknown as { def: PlayerDef };
      // (Number 4 was taken off at 70: the man on at the end is the bench player.)
      p.def = i === 4 ? squad[11] : squad[i];
    }
    const rating = (i: number, over: Record<string, unknown>) => ({
      idx: i, name: squad[i].name, side: 0, rating: 6.5, goals: 0, assists: 0, saves: 0, conceded: 0, pensSaved: 0, yellow: 0, red: 0, keeper: i === 0, on: 0, off: 90, ...over,
    });
    const rows = [
      rating(9, { rating: 8.9, goals: 2 }),
      rating(0, { rating: 7.4, saves: 5, conceded: 0, pensSaved: 1 }),
      rating(4, { rating: 5.8, yellow: 1, off: 70 }),
      ...[1, 2, 3, 5, 6, 7, 8, 10].map((i) => rating(i, {})),
      // The sub who came on for number 4 at 70 and set up a goal.
      { idx: 4, name: squad[11].name, side: 0, rating: 7.0, goals: 0, assists: 1, saves: 0, on: 70, off: 90, keeper: false },
      { idx: 15, name: 'Them', side: 1, rating: 6.0, goals: 0, assists: 0 },
    ];
    Object.assign(m, { score: [2, 0] });
    return { score: [2, 0], humanSide: 0, match: m, ratings: rows.sort((a, b) => b.rating - a.rating) } as unknown as MatchResult;
  }

  it('adds minutes, goals, assists, ratings, cards, MOTM and a keeper\'s clean sheet, once', () => {
    const st = career();
    const squad = st.club!.squad;
    const xi = squad.slice(0, 11).map((p) => ({ id: p.id, name: p.name }));
    const r = result(st);
    // Make the match's two goals the striker's own: the scorers come from the match's goal list.
    Object.assign(r.match, { goals: [{ side: 0, scorer: 9, name: squad[9].name, minute: 12, own: false }, { side: 0, scorer: 9, name: squad[9].name, minute: 77, own: false }] });
    afterMatch(st, matchFacts(r, 0, xi, squad, 'Rivals'));
    const star = squad[9];
    const sl = seasonLine(star, 1);
    expect(sl).toMatchObject({ apps: 1, starts: 1, mins: 90, goals: 2, assists: 0, motm: 1, rated: 1 });
    expect(avgRating(sl)).toBe(8.9);
    const gk = squad[0];
    expect(careerLine(gk)).toMatchObject({ apps: 1, clean: 1, saves: 5, conceded: 0, pens: 1, mins: 90 });
    const yel = squad[4];
    expect(seasonLine(yel, 1)).toMatchObject({ apps: 1, mins: 70, yellow: 1, motm: 0 });
    const sub = squad[11];
    expect(seasonLine(sub, 1)).toMatchObject({ apps: 1, starts: 0, mins: 20, assists: 1 });
    // Nobody who didn't play has anything.
    expect(seasonLine(squad[13], 1)).toEqual(emptyLine());
    // His totals still agree with the old counters.
    expect((star as LifePlayer).goals).toBe(2);
    expect((star as LifePlayer).apps).toBe(1);
    expect(careerLine(star).goals).toBe(2);
  });

  it('starts the season line again each season, and the career keeps adding', () => {
    const st = career();
    const squad = st.club!.squad;
    const xi = squad.slice(0, 11).map((p) => ({ id: p.id, name: p.name }));
    afterMatch(st, matchFacts(result(st), 0, xi, squad, 'A'));
    afterMatch(st, matchFacts(result(st), 0, xi, squad, 'B'));
    expect(seasonLine(squad[9], 1).apps).toBe(2);
    // A new season: before a match, his season reads zero; the career keeps the two.
    st.season!.number = 2;
    expect(seasonLine(squad[9], 2)).toEqual(emptyLine());
    expect(careerLine(squad[9]).apps).toBe(2);
    afterMatch(st, matchFacts(result(st), 0, xi, squad, 'C'));
    expect(seasonLine(squad[9], 2).apps).toBe(1);
    expect(careerLine(squad[9]).apps).toBe(3);
    expect(avgRating(careerLine(squad[9]))).toBe(8.9);
    expect(ratingText(seasonLine(squad[13], 2))).toBe('0.0');
  });

  it('counts an appearance with no rating when the result carries no ratings (an older caller)', () => {
    const st = career();
    const squad = st.club!.squad;
    afterMatch(st, { played: squad.slice(0, 11).map((p) => p.id), scorers: [squad[9].id], my: 1, their: 0, vs: 'X' });
    expect(seasonLine(squad[9], 1)).toMatchObject({ apps: 1, starts: 1, goals: 1, rated: 0 });
    expect(seasonLine(squad[9], 1).mins).toBe(90);
    expect(avgRating(seasonLine(squad[9], 1))).toBe(0);
  });
});

describe('a simulated match gets plausible numbers', () => {
  it('is deterministic and adds up, over many fixtures', () => {
    const st = career(11);
    const squad = st.club!.squad;
    const xiIds = squad.slice(0, 11).map((p) => p.id);
    for (let seed = 1; seed <= 150; seed++) {
      const my = seed % 5;
      const their = (seed * 3) % 4;
      const scorers = Array.from({ length: my }, (_, i) => xiIds[7 + ((seed + i) % 4)]);
      const a = simStats(squad, scorers, my, their, new Rng(seed));
      const b = simStats(squad, scorers, my, their, new Rng(seed));
      expect(a).toEqual(b);
      // The eleven played, with at most two changes.
      for (const id of xiIds) expect(a.played).toContain(id);
      expect(a.played.length).toBeGreaterThanOrEqual(11);
      expect(a.played.length).toBeLessThanOrEqual(13);
      expect(a.stats.reduce((s, x) => s + x.goals, 0)).toBe(my);
      expect(a.stats.filter((x) => x.motm).length).toBeLessThanOrEqual(1);
      if (my > their) expect(a.stats.some((x) => x.motm)).toBe(true);
      if (my < their) expect(a.stats.some((x) => x.motm)).toBe(false);
      const keeper = a.stats.find((x) => x.id === squad[0].id)!;
      expect(keeper.conceded).toBe(their);
      expect(keeper.clean).toBe(their === 0);
      expect(keeper.saves).toBeGreaterThanOrEqual(1);
      expect(a.assists.length).toBeLessThanOrEqual(my);
      for (const x of a.stats) {
        expect(x.rating).toBeGreaterThanOrEqual(4.5);
        expect(x.rating).toBeLessThanOrEqual(9.9);
        expect(x.mins).toBeGreaterThanOrEqual(1);
        expect(x.mins).toBeLessThanOrEqual(90);
        expect(x.yellow + x.red).toBeLessThanOrEqual(1);
        // Only the keeper keeps goal.
        if (x.id !== squad[0].id) expect([x.saves, x.conceded, x.pens]).toEqual([0, 0, 0]);
      }
      // The ones who made way and the ones who came on share the ninety.
      const changed = a.stats.filter((x) => !x.started);
      for (const s of changed) expect(s.mins).toBeLessThan(40);
    }
  });

  it('SIM THIS MATCH records the whole squad\'s season lines', () => {
    const st = career(21);
    const club = st.club!;
    const wallet = { coins: 0 };
    // (Everything open, as a manager a few matches in.)
    openAll(st);
    let sims = 0;
    for (let i = 0; i < 12; i++) {
      const r = simMatch(st, wallet);
      if (r) sims++;
      else break;
    }
    expect(sims).toBeGreaterThan(0);
    const all = club.squad.reduce((s, p) => s + seasonLine(p, 1).apps, 0);
    expect(all).toBeGreaterThanOrEqual(sims * 11);
    const goals = club.squad.reduce((s, p) => s + seasonLine(p, 1).goals, 0);
    expect(goals).toBe(club.squad.reduce((s, p) => s + ((p as LifePlayer).goals ?? 0), 0));
    expect(club.squad.some((p) => avgRating(seasonLine(p, 1)) > 0)).toBe(true);
  });
});

describe('an older save reads as zeros', () => {
  it('keeps apps and goals, zeros the rest, and clamps a damaged line', () => {
    const st = career(5);
    const raw = JSON.parse(JSON.stringify(st)) as { club: { squad: Record<string, unknown>[] } };
    // The squad as it was saved before the lines: apps and goals only.
    raw.club.squad[9].apps = 40;
    raw.club.squad[9].goals = 12;
    delete raw.club.squad[9].tot;
    delete raw.club.squad[9].ssn;
    // A damaged one: strings, negatives, huge numbers and a season line with no season.
    raw.club.squad[8].tot = { apps: 'x', goals: -4, mins: 1e12, rate: 5, rated: 99, bogus: 1 };
    raw.club.squad[8].ssn = { apps: 3 };
    const back = migrateCareer(raw, 5);
    const old = back.club!.squad[9];
    expect(careerLine(old)).toEqual({ ...emptyLine(), apps: 40, goals: 12 });
    expect(seasonLine(old, 1)).toEqual(emptyLine());
    expect(avgRating(careerLine(old))).toBe(0);
    const bad = careerLine(back.club!.squad[8]);
    for (const k of LINE_KEYS) expect(Number.isFinite(bad[k])).toBe(true);
    expect(bad.goals).toBe(0);
    expect(bad.apps).toBe(0);
    expect(bad.mins).toBeLessThanOrEqual(1e7);
    expect(bad.rated).toBeLessThanOrEqual(bad.apps);
    expect(readLine('nope')).toBeUndefined();
    // Saved lines come back as they were.
    const st2 = career(6);
    const sq = st2.club!.squad;
    afterMatch(st2, { played: sq.slice(0, 11).map((p) => p.id), scorers: [sq[9].id], my: 1, their: 0, vs: 'X', stats: [{ id: sq[9].id, started: true, mins: 90, goals: 1, assists: 0, rating: 7.8, yellow: 0, red: 0, motm: true, saves: 0, conceded: 0, pens: 0, clean: false }] });
    const again = migrateCareer(JSON.parse(JSON.stringify(st2)), 6);
    expect(careerLine(again.club!.squad[9])).toEqual(careerLine(sq[9]));
    expect(seasonLine(again.club!.squad[9], 1)).toEqual(seasonLine(sq[9], 1));
    expect(avgRating(seasonLine(again.club!.squad[9], 1))).toBe(7.8);
  });
});

describe('the squad\'s leaders', () => {
  it('names the top scorer, assist maker, appearances and best average, by scope', () => {
    const st = career(9);
    const squad = st.club!.squad;
    expect(squadLeaders(squad, 1, 'season')).toEqual([]);
    const stat = (id: string, goals: number, assists: number, rating: number) => ({ id, started: true, mins: 90, goals, assists, rating, yellow: 0, red: 0, motm: false, saves: 0, conceded: 0, pens: 0, clean: false });
    const played = squad.slice(0, 11).map((p) => p.id);
    for (let i = 0; i < 4; i++) {
      afterMatch(st, { played, scorers: i < 3 ? [squad[9].id] : [squad[8].id, squad[8].id], my: 1, their: 0, vs: 'X', stats: [stat(squad[9].id, 0, 0, 8.5), stat(squad[7].id, 0, 1, 6.5), stat(squad[3].id, 0, 0, 7)] });
    }
    const lead = squadLeaders(squad, 1, 'season');
    const by = (k: string) => lead.find((l) => l.kind === k)!;
    expect(by('goals')).toMatchObject({ id: squad[9].id, n: 3 });
    expect(by('assists')).toMatchObject({ id: squad[7].id, n: 4 });
    expect(by('apps').n).toBe(4);
    expect(by('rating')).toMatchObject({ id: squad[9].id, n: 85 });
    // A new season: nothing on the season board, the career board stays.
    expect(squadLeaders(squad, 2, 'season')).toEqual([]);
    expect(squadLeaders(squad, 2, 'career').length).toBeGreaterThan(0);
  });
});
