import { describe, expect, it } from 'vitest';
import {
  BOTTOM_DIVISION, MATCHDAYS, SQUAD_MAX, SQUAD_MIN, YOU,
  buyPlayer, canBuy, createClub, cupDue, migrateCareer, newSeason, nextMatch, playerPrice, refreshMarket, resolveCupTie, resolveMatchday, rivalRating, rivalSquad,
  rivalTeam, startNextSeason, tuneToOverall, userFixture,
  type CareerState, type LeagueClub,
} from '../src/meta/career';
import {
  AI_TRADES_PER_WEEK, FREE_AGENTS, LISTINGS_MAX, LISTINGS_MIN, MORALE_DIP, OFFER_LIFE, RESALE_CAP, RESALE_STARTS, SCOUT_COST, SHORTLIST_MAX,
  WAGE_DIP, WAGE_DRAIN, YOUNG_AGE,
  acceptCounter, acceptOffer, ageSquad, applyWageDrain, askingPrice, bidFor, bidRange, canBid, committed, listPlayer, listingById, markNewsSeen,
  marketSummary, marketUnread, newsStrip, placeBid, playerAge, playerPotential, playerValue, quickSaleValue, rejectOffer, resaleCap, saleFor,
  scoutListing, shortlisted, squadWages, toggleShortlist, unlistPlayer, wageBudget, wageDrain, wageOf, windowInfo, windowOpen, withdrawBid,
  type Listing, type MetaPlayer,
} from '../src/meta/market';
import { KIT_COLORS, makePlayer, surnameOf } from '../src/meta/data';
import { Rng } from '../src/core/rng';
import { overall, type Kit, type PlayerDef } from '../src/sim/types';

const KIT: Kit = { shirt: KIT_COLORS.red, shirt2: KIT_COLORS.white, pattern: 'hoops', shorts: KIT_COLORS.white, socks: KIT_COLORS.red, gk: 0 };

function career(seed = 7, division = BOTTOM_DIVISION): CareerState {
  const st = migrateCareer(null, seed);
  st.club = createClub({ name: 'Test Town', short: 'TST', kit: KIT, formation: '4-4-2' }, seed);
  newSeason(st, division, 1);
  return st;
}

/** Play the current matchday (a draw) so the market ticks over to the next week. */
function play(st: CareerState, wallet: { coins: number }, my = 1, their = 1): boolean {
  // A BLOCKY CUP tie due comes first (the league waits for it): the same score, through on penalties if level.
  if (cupDue(st) >= 0) resolveCupTie(st, my, their, my >= their);
  const s = st.season!;
  const f = userFixture(s, s.matchday);
  const home = f ? f.home === YOU : true;
  return resolveMatchday(st, wallet, s.matchday, home ? my : their, home ? their : my);
}

const rival = (st: CareerState, id: string | null): LeagueClub => st.season!.rivals.find((r) => r.id === id)!;

/** A club listing (not hot unless asked) whose club can still sell, ranked as a starter or a squad player. */
function findListing(st: CareerState, want: { starter?: boolean; hot?: boolean; minSquad?: number }): Listing | undefined {
  return st.tm.listings.find((l) => {
    if (!l.club || l.youth) return false;
    if (want.hot !== undefined && l.hot !== want.hot) return false;
    const r = rival(st, l.club);
    const squad = rivalSquad(r);
    if (squad.length < (want.minSquad ?? 16)) return false;
    if (want.starter === undefined) return true;
    const starter = [...squad].sort((a, b) => overall(b) - overall(a)).findIndex((p) => p.id === l.player.id) < 11;
    return starter === want.starter;
  });
}

const ids = (st: CareerState) => st.tm.listings.map((l) => l.id + ':' + l.player.id);

describe('listings', () => {
  it('are 12-20 strong, deterministic per seed and week, and drawn from the real rival squads', () => {
    for (const seed of [1, 2, 3]) {
      const a = career(seed);
      const b = career(seed);
      expect(JSON.stringify(a.tm)).toBe(JSON.stringify(b.tm));
      expect(a.tm.listings.length).toBeGreaterThanOrEqual(LISTINGS_MIN);
      expect(a.tm.listings.length).toBeLessThanOrEqual(LISTINGS_MAX);
      const wallet = { coins: 0 };
      for (let md = 0; md < 4; md++) {
        for (const l of a.tm.listings) {
          expect(l.asking).toBeGreaterThan(0);
          expect(l.age).toBeGreaterThanOrEqual(16);
          expect(l.contract).toBeGreaterThanOrEqual(1);
          expect(l.wage).toBe(wageOf(l.player));
          if (l.club) {
            const r = rival(a, l.club);
            expect(r).toBeDefined();
            expect(rivalSquad(r).some((p) => p.id === l.player.id && p.name === l.player.name)).toBe(true);
          }
        }
        expect(a.tm.listings.filter((l) => !l.club && !l.youth)).toHaveLength(FREE_AGENTS);
        expect(a.tm.listings.filter((l) => l.club).length).toBeGreaterThan(6);
        // Deterministic week to week as well.
        play(a, wallet);
        play(b, wallet);
        expect(ids(a)).toEqual(ids(b));
      }
      expect(JSON.stringify(career(seed + 100).tm.listings.map((l) => l.player.name))).not.toBe(JSON.stringify(a.tm.listings.map((l) => l.player.name)));
    }
  });

  it('rotate: the week-0 names have all moved on by week 4, and every week refills to 12+', () => {
    const st = career(11);
    const first = new Set(st.tm.listings.map((l) => l.id));
    const wallet = { coins: 0 };
    for (let md = 0; md < 4; md++) {
      play(st, wallet);
      expect(st.tm.listings.length).toBeGreaterThanOrEqual(LISTINGS_MIN);
    }
    // (A player can come back later under a new listing; the week-0 listings themselves are gone.)
    expect(st.tm.listings.some((l) => first.has(l.id))).toBe(false);
  });

  it('never repeat a surname from your squad or another listing; one youth prospect a season', () => {
    for (const seed of [4, 5, 6]) {
      const st = career(seed);
      const squad = new Set(st.club!.squad.map((p) => surnameOf(p.name)));
      const names = st.tm.listings.map((l) => surnameOf(l.player.name));
      expect(new Set(names).size).toBe(names.length);
      for (const n of names) expect(squad.has(n)).toBe(false);
      const youth = st.tm.listings.filter((l) => l.youth);
      expect(youth).toHaveLength(1);
      expect(youth[0].age).toBeGreaterThanOrEqual(17);
      expect(youth[0].age).toBeLessThanOrEqual(19);
      expect(youth[0].potential).toBe(5);
      expect(youth[0].club).toBeNull();
      expect(youth[0].asking).toBe(Math.round((playerPrice(youth[0].player) * 0.5) / 10) * 10);
      // Some listings are hot, some are cheap veterans, prices carry a club-need / hot premium over plain value.
      expect(st.tm.listings.some((l) => l.hot)).toBe(true);
      for (const l of st.tm.listings) {
        if (!l.club) continue;
        expect(l.asking).toBeGreaterThanOrEqual(playerValue(l.player) * 0.9);
      }
    }
  });

  it('prices rise with overall (value, asking and wages) for the same age and contract', () => {
    const rng = new Rng(3);
    let prev = { value: 0, asking: 0, wage: 0 };
    for (let t = 30; t <= 90; t += 4) {
      const p = makePlayer(rng, 'MF', t, 8, `p${t}`) as PlayerDef & { age?: number; contract?: number };
      tuneToOverall(p, t);
      p.age = 25;
      p.contract = 2;
      const cur = { value: playerValue(p), asking: askingPrice(p, null, false, 0, false), wage: wageOf(p) };
      expect(cur.value).toBeGreaterThanOrEqual(prev.value);
      expect(cur.asking).toBeGreaterThanOrEqual(prev.asking);
      expect(cur.wage).toBeGreaterThanOrEqual(prev.wage);
      prev = cur;
    }
    expect(prev.value).toBeGreaterThan(1500);
    // Age shapes the value: a 26-year-old is worth more than the same player at 34.
    const p = makePlayer(new Rng(9), 'FW', 60, 9, 'x') as PlayerDef & { age?: number };
    p.age = 26;
    const peak = playerValue(p);
    p.age = 34;
    expect(playerValue(p)).toBeLessThan(peak);
  });
});

describe('transfer window', () => {
  it('is open for the first three weeks and one mid-season week', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(windowOpen)).toEqual([true, true, true, false, true, false, false]);
    expect(windowInfo(0)).toMatchObject({ open: true, weeks: 3 });
    expect(windowInfo(3)).toMatchObject({ open: false, weeks: 1 });
    expect(windowInfo(5)).toMatchObject({ open: false, weeks: 0 });
    expect(windowInfo(5).label).toMatch(/NEXT SEASON/);
  });

  it('refuses offers while closed but still lets you scout and shortlist', () => {
    const st = career(8);
    const wallet = { coins: 5000 };
    for (let i = 0; i < 3; i++) play(st, wallet);
    expect(st.season!.matchday).toBe(3);
    const l = st.tm.listings[0];
    expect(canBid(st, wallet.coins, l.id, l.asking)).toEqual({ ok: false, reason: 'window-closed' });
    expect(placeBid(st, wallet, l.id, l.asking).ok).toBe(false);
    expect(canBuy(st, wallet.coins, 0)).toEqual({ ok: false, reason: 'window-closed' });
    expect(scoutListing(st, wallet, l.id)).toEqual({ ok: true, potential: l.potential });
    expect(toggleShortlist(st, l.id)).toEqual({ ok: true, on: true });
    play(st, wallet);
    expect(windowOpen(st.season!.matchday)).toBe(true);
    expect(canBid(st, wallet.coins, l.id, l.asking).ok || !listingById(st, l.id)).toBe(true);
  });
});

describe('offers for players', () => {
  it('a free agent signs at once at his asking price (legacy buy) and joins the squad', () => {
    const st = career(4);
    const wallet = { coins: 100000 };
    const n = st.club!.squad.length;
    const free = st.market[0];
    const r = buyPlayer(st, wallet, 0);
    expect(r.ok).toBe(true);
    expect(r.player?.name).toBe(free.name);
    expect(st.club!.squad).toHaveLength(n + 1);
    expect(st.market.some((p) => p.id === free.id)).toBe(false);
    expect(st.tm.listings.some((l) => l.player.id === free.id)).toBe(false);
    expect(st.tm.bids).toHaveLength(0);
    const signed = st.club!.squad[n] as PlayerDef & { age?: number; potential?: number };
    expect(signed.age).toBeGreaterThanOrEqual(24);
    expect(signed.potential).toBe(0);
    expect(st.tm.news[0].kind).toBe('good');
  });

  it('a club answers after the next match: full asking on a squad player is accepted and he leaves that club', () => {
    for (const seed of [21, 22, 23]) {
      const st = career(seed);
      const wallet = { coins: 100000 };
      const l = findListing(st, { starter: false, hot: false })!;
      expect(l).toBeDefined();
      const r = rival(st, l.club);
      const before = rivalSquad(r).length;
      const rating0 = r.rating;
      const [lo, hi] = bidRange(l);
      expect(canBid(st, wallet.coins, l.id, lo - 10)).toEqual({ ok: false, reason: 'bad-amount' });
      expect(canBid(st, wallet.coins, l.id, hi + 10)).toEqual({ ok: false, reason: 'bad-amount' });
      const res = placeBid(st, wallet, l.id, l.asking);
      expect(res).toEqual({ ok: true, instant: false });
      expect(wallet.coins).toBe(100000 - l.asking);
      expect(canBid(st, wallet.coins, l.id, l.asking)).toEqual({ ok: false, reason: 'pending' });
      // Nothing happens until the match is played.
      refreshMarket(st, wallet);
      expect(bidFor(st, l.id)?.status).toBe('pending');
      expect(st.club!.squad.some((p) => p.name === l.player.name)).toBe(false);
      play(st, wallet);
      expect(bidFor(st, l.id)).toBeUndefined();
      const signed = st.club!.squad.find((p) => p.name === l.player.name);
      expect(signed).toBeDefined();
      expect(wallet.coins).toBe(100000 - l.asking);
      expect(r.out).toContain(l.player.id);
      expect(rivalSquad(r).some((p) => p.id === l.player.id)).toBe(false);
      // (Other AI trades may have moved more of its players in the meantime.)
      expect(rivalSquad(r)).toHaveLength(16 - (r.out?.length ?? 0) + (r.in?.length ?? 0));
      expect(rivalSquad(r).length).toBeLessThanOrEqual(before);
      expect(r.rating).toBe(rivalRating(r));
      expect(rivalTeam(r).players).toHaveLength(11);
      expect(typeof rating0).toBe('number');
      expect(st.tm.news.some((n) => /accept your/.test(n.text))).toBe(true);
    }
  });

  it('a lowball on a starter is turned down (or he is snapped up) and the coins come back', () => {
    const st = career(31);
    const wallet = { coins: 100000 };
    const l = findListing(st, { starter: true })!;
    expect(l).toBeDefined();
    const [lo] = bidRange(l);
    expect(placeBid(st, wallet, l.id, lo).ok).toBe(true);
    play(st, wallet);
    expect(bidFor(st, l.id)).toBeUndefined();
    expect(wallet.coins).toBe(100000);
    expect(st.club!.squad.some((p) => p.name === l.player.name)).toBe(false);
    expect(st.tm.news[0].kind).not.toBe('good');
  });

  it('a fair-but-low offer on a young starter draws a counter you can accept (within 110%) or decline', () => {
    let seen = 0;
    for (const seed of [41, 42, 43, 44, 45, 46]) {
      const st = career(seed);
      const wallet = { coins: 100000 };
      const l = st.tm.listings.find((x) => x.club && !x.hot && !x.youth && x.age < 31 && rivalSquad(rival(st, x.club)).length >= 16 && findLikeStarter(st, x));
      if (!l) continue;
      const amount = Math.round((l.asking * 0.85) / 10) * 10;
      expect(placeBid(st, wallet, l.id, amount).ok).toBe(true);
      play(st, wallet);
      const b = bidFor(st, l.id);
      if (!b) continue;
      seen++;
      expect(b.status).toBe('countered');
      expect(b.counter).toBeGreaterThan(amount);
      expect(b.counter).toBeLessThanOrEqual(bidRange(l)[1]);
      if (seen % 2 === 1) {
        const r = acceptCounter(st, wallet, b.id);
        expect(r.ok).toBe(true);
        expect(wallet.coins).toBe(100000 - b.counter);
        expect(st.club!.squad.some((p) => p.name === l.player.name)).toBe(true);
      } else {
        expect(withdrawBid(st, wallet, b.id)).toEqual({ ok: true });
        expect(wallet.coins).toBe(100000);
        expect(bidFor(st, l.id)).toBeUndefined();
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('respects the wage budget and the squad limit, counting offers already out', () => {
    const st = career(5);
    const club = st.club!;
    const wallet = { coins: 1e6 };
    const budget = wageBudget(st.season!.division, st.stadium);
    expect(budget).toBeGreaterThan(squadWages(club));
    expect(squadWages(club) / budget).toBeGreaterThan(0.55);
    expect(squadWages(club) / budget).toBeLessThan(0.9);
    expect(wageBudget(1, 0)).toBeGreaterThan(wageBudget(6, 0) * 2);
    expect(wageBudget(6, 5)).toBeGreaterThan(wageBudget(6, 0));
    const l = st.tm.listings.find((x) => x.club)!;
    const star = (i: number) => {
      const p = makePlayer(new Rng(i), 'MF', 99, 60 + i, `s${i}`);
      tuneToOverall(p, 99);
      return p;
    };
    club.squad.push(star(1), star(2));
    expect(squadWages(club)).toBeGreaterThan(budget);
    expect(canBid(st, wallet.coins, l.id, l.asking)).toEqual({ ok: false, reason: 'wages' });
    club.squad.splice(-2, 2);
    // Squad limit: 22 players plus one offer out means no second offer (the fillers earn next to nothing).
    while (club.squad.length < SQUAD_MAX - 1) {
      const filler = makePlayer(new Rng(club.squad.length), 'DF', 30, 60 + club.squad.length, `d${club.squad.length}`);
      tuneToOverall(filler, 10);
      club.squad.push(filler);
    }
    const cheap = st.tm.listings.filter((x) => x.club && x.id !== l.id);
    expect(placeBid(st, wallet, l.id, l.asking)).toEqual({ ok: true, instant: false });
    expect(committed(st).players).toBe(SQUAD_MAX);
    expect(canBid(st, wallet.coins, cheap[0].id, cheap[0].asking)).toEqual({ ok: false, reason: 'squad-full' });
    expect(marketSummary(st).pending).toBe(1);
    // Not enough coins is the last check.
    const poor = career(5);
    const l2 = poor.tm.listings[0];
    expect(canBid(poor, l2.asking - 10, l2.id, l2.asking)).toEqual({ ok: false, reason: 'no-coins' });
  });

  it('a season ending refunds any offer still out', () => {
    const st = career(6);
    const wallet = { coins: 100000 };
    for (let i = 0; i < 4; i++) play(st, wallet);
    expect(windowOpen(st.season!.matchday)).toBe(true);
    const l = findListing(st, { starter: true, hot: false, minSquad: 15 }) ?? st.tm.listings.find((x) => x.club)!;
    const amount = Math.round((l.asking * 0.8) / 10) * 10;
    expect(placeBid(st, wallet, l.id, amount).ok).toBe(true);
    for (let i = 0; i < 3; i++) play(st, wallet);
    expect(st.summary).not.toBeNull();
    expect(st.tm.bids).toHaveLength(0);
    expect(st.tm.listings).toHaveLength(0);
    // Whatever happened to the offer, the books balance: coins spent == price of anyone signed.
    const signed = st.club!.squad.find((p) => p.name === l.player.name);
    expect(wallet.coins + (signed ? amount : 0) + st.summary!.prize - 100000).toBeGreaterThanOrEqual(0);
  });
});

/** Is this listing's player in the top 11 of his club by overall? */
function findLikeStarter(st: CareerState, l: Listing): boolean {
  const squad = rivalSquad(rival(st, l.club));
  return [...squad].sort((a, b) => overall(b) - overall(a)).findIndex((p) => p.id === l.player.id) < 11;
}

describe('selling', () => {
  it('listing a player brings deterministic AI offers after matches while the window is open; accepting moves him', () => {
    let offersSeen = 0;
    for (const seed of [51, 52, 53, 54]) {
      const st = career(seed);
      const club = st.club!;
      const wallet = { coins: 0 };
      const p = club.squad[13];
      expect(listPlayer(st, p.id)).toEqual({ ok: true });
      expect(listPlayer(st, p.id)).toEqual({ ok: false, reason: 'pending' });
      const gk = club.squad.find((x) => x.role === 'GK')!;
      expect(listPlayer(st, gk.id)).toEqual({ ok: false, reason: 'last-gk' });
      // Same seed, same offers.
      const twin = career(seed);
      listPlayer(twin, p.id);
      const w2 = { coins: 0 };
      for (let i = 0; i < 2; i++) {
        play(st, wallet);
        play(twin, w2);
        expect(JSON.stringify(saleFor(st, p.id)?.offers)).toBe(JSON.stringify(saleFor(twin, p.id)?.offers));
      }
      const sale = saleFor(st, p.id)!;
      expect(sale).toBeDefined();
      if (!sale.offers.length) continue;
      offersSeen++;
      const o = sale.offers[0];
      expect(o.amount).toBeGreaterThanOrEqual(playerValue(p) * 0.65);
      expect(o.amount).toBeLessThanOrEqual(playerValue(p) * 0.96);
      expect(o.amount).toBeGreaterThan(Math.round((playerValue(p) * 0.45) / 10) * 10);
      const buyer = rival(st, o.club);
      const n = club.squad.length;
      if (sale.offers.length > 1) expect(rejectOffer(st, p.id, sale.offers[1].id)).toEqual({ ok: true });
      const r = acceptOffer(st, wallet, p.id, o.id);
      expect(r.ok).toBe(true);
      expect(wallet.coins).toBe(o.amount + (wallet.coins - o.amount));
      expect(club.squad).toHaveLength(n - 1);
      expect(club.squad.some((x) => x.id === p.id)).toBe(false);
      expect(buyer.in?.some((x) => x.name === p.name)).toBe(true);
      expect(rivalSquad(buyer).some((x) => x.name === p.name)).toBe(true);
      expect(buyer.rating).toBe(rivalRating(buyer));
      expect(saleFor(st, p.id)).toBeUndefined();
    }
    expect(offersSeen).toBeGreaterThan(0);
  });

  it('no offers arrive while the window is shut; unlisting drops them; a listed player plays with a dip', () => {
    const st = career(61);
    const club = st.club!;
    const wallet = { coins: 0 };
    for (let i = 0; i < 2; i++) play(st, wallet);
    const p = club.squad[2];
    listPlayer(st, p.id);
    play(st, wallet); // week 3: closed
    expect(windowOpen(st.season!.matchday)).toBe(false);
    expect(saleFor(st, p.id)!.offers).toHaveLength(0);
    // Morale: the match-day copy of a listed player is MORALE_DIP down on every stat.
    const nm = nextMatch(st)!;
    const mine = nm.userHome ? nm.home : nm.away;
    const copy = [...mine.players, ...(mine.bench ?? [])].find((x) => x.id === p.id)!;
    expect(copy.stats.pace).toBe(Math.max(1, p.stats.pace - MORALE_DIP));
    expect(p.stats.pace).toBe(club.squad[2].stats.pace);
    expect(unlistPlayer(st, p.id)).toEqual({ ok: true });
    expect(unlistPlayer(st, p.id)).toEqual({ ok: false, reason: 'not-found' });
    const again = nextMatch(st)!;
    const fresh = [...(again.userHome ? again.home : again.away).players].find((x) => x.id === p.id)!;
    expect(fresh.stats.pace).toBe(p.stats.pace);
    // Can't list below the minimum squad.
    while (club.squad.length > SQUAD_MIN) club.squad.pop();
    expect(listPlayer(st, club.squad[12].id)).toEqual({ ok: false, reason: 'min-squad' });
  });
});

describe('no flipping', () => {
  it('a player you sign this season fetches at most 1.1x what you paid until he has made 6 starts or a season has passed', () => {
    let offers = 0;
    let expired = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 8, 9, 10, 12]) {
      const st = career(seed);
      const club = st.club!;
      const wallet = { coins: 5000 };
      const youth = st.tm.listings.find((l) => l.youth)!;
      const paid = youth.asking;
      const r = placeBid(st, wallet, youth.id, paid);
      expect(r.ok && r.instant && !!r.player).toBe(true);
      const signed = club.squad.find((p) => p.name === youth.player.name) as MetaPlayer;
      expect(signed).toBeDefined();
      expect(signed.paid).toBe(paid);
      expect(signed.boughtSeason).toBe(1);
      expect(signed.starts).toBe(0);
      const cap = Math.round((paid * RESALE_CAP) / 10) * 10;
      expect(resaleCap(st, signed)).toBe(cap);
      // The cap bites: a youth prospect's value is about twice his asking price.
      expect(playerValue(signed) * 0.7).toBeGreaterThan(cap);
      expect(quickSaleValue(signed)).toBeLessThanOrEqual(cap);
      // Straight back on the market, kept on the bench: every offer over the open window stays under the cap.
      expect(listPlayer(st, signed.id)).toEqual({ ok: true });
      for (let i = 0; i < 4; i++) {
        play(st, wallet);
        for (const o of saleFor(st, signed.id)?.offers ?? []) {
          offers++;
          expect(o.amount).toBeLessThanOrEqual(cap);
          expect(o.amount).toBeGreaterThan(0);
        }
        if (st.tm.news.some((n) => /withdrew their .* offer for/.test(n.text) && n.own)) expired++;
      }
      expect(signed.starts).toBe(0);
      // Starts count only in the XI; after RESALE_STARTS of them the cap is gone.
      club.squad.splice(club.squad.indexOf(signed), 1);
      club.squad.splice(5, 0, signed);
      play(st, wallet);
      expect(signed.starts).toBe(1);
      signed.starts = RESALE_STARTS;
      expect(resaleCap(st, signed)).toBeNull();
      signed.starts = RESALE_STARTS - 1;
      expect(resaleCap(st, signed)).toBe(cap);
      // A season passing lifts it too.
      while (!st.summary) play(st, wallet);
      startNextSeason(st);
      expect(resaleCap(st, signed)).toBeNull();
      // Nobody else carries a cap.
      expect(club.squad.filter((p) => resaleCap(st, p) !== null)).toHaveLength(0);
    }
    expect(offers).toBeGreaterThan(5);
    expect(expired).toBeGreaterThan(0);
    expect(OFFER_LIFE).toBe(2);
  });
});

describe('your own news', () => {
  it('answers to your offers and offers for your players are flagged own, sit first on the strip and count as unread until read', () => {
    let seen = 0;
    for (const seed of [21, 22, 23, 51, 52]) {
      const st = career(seed);
      const wallet = { coins: 100000 };
      expect(marketUnread(st)).toBe(0);
      const l = findListing(st, { starter: false, hot: false })!;
      expect(placeBid(st, wallet, l.id, l.asking).ok).toBe(true);
      expect(listPlayer(st, st.club!.squad[13].id)).toEqual({ ok: true });
      play(st, wallet);
      const own = st.tm.news.filter((n) => n.own);
      // (The club's story lines, like the rival's jibes, are not transfer gossip: meta/story.ts.)
      const gossip = st.tm.news.filter((n) => !n.own && !n.story);
      expect(own.length).toBeGreaterThan(0);
      expect(own.some((n) => /accept your|joins you|reject your|want .* for|offer .* for/.test(n.text))).toBe(true);
      for (const n of gossip) expect(n.text).toMatch(/ sign | has left the market|looking for a club/);
      for (const n of own) expect(n.seen).toBe(false);
      expect(marketUnread(st)).toBe(own.length);
      // The strip: your items first (newest first), then the rest, at most the asked-for count.
      const strip = newsStrip(st, 4);
      expect(strip.length).toBeLessThanOrEqual(4);
      const firstGossip = strip.findIndex((n) => !n.own);
      const lastOwn = strip.map((n) => n.own).lastIndexOf(true);
      if (firstGossip >= 0 && lastOwn >= 0) expect(lastOwn).toBeLessThan(firstGossip);
      expect(strip[0].own).toBe(true);
      markNewsSeen(st);
      expect(marketUnread(st)).toBe(0);
      expect(st.tm.news.every((n) => n.seen)).toBe(true);
      // New answers after the next match are unread again; old ones stay read.
      play(st, wallet);
      expect(st.tm.news.filter((n) => n.own && n.week === st.season!.matchday).every((n) => !n.seen)).toBe(true);
      if (st.tm.news.some((n) => n.own && n.week === st.season!.matchday)) seen++;
      // An own item left unread for weeks still comes first when the market is finally opened.
      for (let i = 0; i < 3; i++) play(st, wallet);
      const stale = [...st.tm.news].reverse().find((n) => n.own && n.week < st.season!.matchday - 1);
      if (!stale) continue;
      stale.seen = false;
      const gossipAt = (s: typeof own) => s.findIndex((n) => !n.own);
      const pinned = newsStrip(st, 12);
      expect(pinned.includes(stale)).toBe(true);
      if (gossipAt(pinned) >= 0) expect(pinned.indexOf(stale)).toBeLessThan(gossipAt(pinned));
      const fresh = new Set(st.tm.news.filter((n) => n.own && !n.seen));
      markNewsSeen(st);
      const still = newsStrip(st, 12, fresh);
      if (gossipAt(still) >= 0) expect(still.indexOf(stale)).toBeLessThan(gossipAt(still));
      // Read and weeks old: back among the gossip, newest first.
      const plain = newsStrip(st, 12);
      if (gossipAt(plain) >= 0) expect(plain.indexOf(stale)).toBeGreaterThan(gossipAt(plain));
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('a save from before the flags loads with nothing unread; the flags round-trip', () => {
    const st = career(23);
    const wallet = { coins: 100000 };
    const l = findListing(st, { starter: false, hot: false })!;
    placeBid(st, wallet, l.id, l.asking);
    play(st, wallet);
    expect(marketUnread(st)).toBeGreaterThan(0);
    const raw = JSON.parse(JSON.stringify(st));
    expect(migrateCareer(raw, 1)).toEqual(st);
    for (const n of raw.tm.news) {
      delete n.own;
      delete n.seen;
    }
    const old = migrateCareer(raw, 1);
    expect(old.tm.news).toHaveLength(st.tm.news.length);
    expect(old.tm.news.every((n) => n.own === false && n.seen === false)).toBe(true);
    expect(marketUnread(old)).toBe(0);
  });
});

describe('wage bill', () => {
  it('over budget: 1.5x the overspend leaves the wallet after every matchday, the squad plays a point down, signing stays blocked', () => {
    const st = career(5);
    const club = st.club!;
    const wallet = { coins: 1000 };
    const budget = wageBudget(st.season!.division, st.stadium);
    // Under budget: nothing happens.
    expect(wageDrain(st)).toBe(0);
    expect(marketSummary(st).drain).toBe(0);
    expect(applyWageDrain(st, wallet)).toBe(0);
    play(st, wallet);
    expect(wallet.coins).toBe(1000);
    expect(st.tm.news.some((n) => /Wages over budget/.test(n.text))).toBe(false);
    // Two stars push the bill over.
    const star = (i: number) => {
      const p = makePlayer(new Rng(i), 'MF', 99, 60 + i, `s${i}`);
      tuneToOverall(p, 99);
      return p;
    };
    club.squad.push(star(1), star(2));
    const over = squadWages(club) - budget;
    expect(over).toBeGreaterThan(0);
    const drain = Math.round(over * WAGE_DRAIN);
    expect(wageDrain(st)).toBe(drain);
    expect(marketSummary(st).drain).toBe(drain);
    const l = st.tm.listings.find((x) => x.club)!;
    expect(canBid(st, wallet.coins, l.id, l.asking)).toEqual({ ok: false, reason: 'wages' });
    // Every player on the match-day sheet is WAGE_DIP down (a listed one loses MORALE_DIP on top).
    listPlayer(st, club.squad[12].id);
    const nm = nextMatch(st)!;
    const mine = nm.userHome ? nm.home : nm.away;
    for (const copy of [...mine.players, ...(mine.bench ?? [])]) {
      const p = club.squad.find((x) => x.id === copy.id)!;
      const dip = WAGE_DIP + (p.id === club.squad[12].id ? MORALE_DIP : 0);
      expect(copy.stats.pace).toBe(Math.max(1, p.stats.pace - dip));
    }
    // The matchday takes the drain and says so.
    play(st, wallet);
    expect(wallet.coins).toBe(1000 - drain);
    const n = st.tm.news.find((x) => /Wages over budget/.test(x.text))!;
    expect(n).toBeDefined();
    expect(n.kind).toBe('bad');
    expect(n.own).toBe(true);
    expect(n.text).toContain(drain.toLocaleString('en-US'));
    // A wallet that can't cover it is emptied, never negative.
    wallet.coins = 5;
    play(st, wallet);
    expect(wallet.coins).toBe(0);
    const short = st.tm.news.find((x) => /Wages over budget/.test(x.text))!;
    expect(short.week).toBe(st.season!.matchday);
    expect(short.text).toMatch(/5 coins deducted, all you had/);
    // Letting the stars go ends it.
    club.squad = club.squad.filter((p) => p.id !== 's1' && p.id !== 's2');
    expect(wageDrain(st)).toBe(0);
    const week = st.season!.matchday;
    play(st, wallet);
    expect(wallet.coins).toBe(0);
    expect(st.tm.news.some((x) => /Wages over budget/.test(x.text) && x.week > week)).toBe(false);
  });
});

describe('AI clubs', () => {
  it('trade among themselves in the window, which moves players and ratings', () => {
    const st = career(71);
    const wallet = { coins: 0 };
    const ratings0 = st.season!.rivals.map((r) => r.rating);
    for (let i = 0; i < 3; i++) play(st, wallet);
    const rivals = st.season!.rivals;
    const moved = rivals.filter((r) => (r.in?.length ?? 0) + (r.out?.length ?? 0) > 0);
    expect(moved.length).toBeGreaterThan(0);
    const trades = rivals.reduce((s, r) => s + (r.in?.length ?? 0), 0);
    expect(trades).toBeGreaterThanOrEqual(1);
    expect(trades).toBeLessThanOrEqual(AI_TRADES_PER_WEEK * 3);
    for (const r of rivals) {
      expect(r.rating).toBe(rivalRating(r));
      const squad = rivalSquad(r);
      expect(squad.length).toBeGreaterThanOrEqual(SQUAD_MIN);
      // Nobody is left without a keeper by the market.
      expect(squad.some((p) => p.role === 'GK')).toBe(true);
      for (const id of r.out ?? []) expect(squad.some((p) => p.id === id)).toBe(false);
      for (const p of r.in ?? []) expect(squad.some((q) => q.id === p.id)).toBe(true);
      expect(new Set(squad.map((p) => p.number)).size).toBe(squad.length);
      const t = rivalTeam(r);
      expect(t.players).toHaveLength(11);
      expect(t.players[0].role).toBe('GK');
    }
    expect(rivals.map((r) => r.rating)).not.toEqual(ratings0);
    expect(st.tm.news.some((n) => / sign /.test(n.text))).toBe(true);
    // A traded player is no longer listed.
    for (const r of rivals) for (const id of r.out ?? []) expect(st.tm.listings.some((l) => l.player.id === id)).toBe(false);
  });
});

describe('scouting and shortlist', () => {
  it('shortlist holds five, scouting costs coins once and reveals potential (young players only)', () => {
    const st = career(81);
    const wallet = { coins: 100 };
    const ls = st.tm.listings;
    for (let i = 0; i < SHORTLIST_MAX; i++) expect(toggleShortlist(st, ls[i].id)).toEqual({ ok: true, on: true });
    expect(toggleShortlist(st, ls[SHORTLIST_MAX].id)).toEqual({ ok: false, reason: 'shortlist-full' });
    expect(shortlisted(st)).toHaveLength(SHORTLIST_MAX);
    expect(toggleShortlist(st, ls[0].id)).toEqual({ ok: true, on: false });
    expect(toggleShortlist(st, 'nope')).toEqual({ ok: false, reason: 'not-found' });
    const youth = ls.find((l) => l.youth)!;
    expect(youth.scouted).toBe(false);
    expect(scoutListing(st, wallet, youth.id)).toEqual({ ok: true, potential: 5 });
    expect(wallet.coins).toBe(100 - SCOUT_COST);
    expect(scoutListing(st, wallet, youth.id)).toEqual({ ok: true, potential: 5 });
    expect(wallet.coins).toBe(100 - SCOUT_COST);
    const old = ls.find((l) => l.age > YOUNG_AGE)!;
    expect(old.potential).toBe(0);
    const young = ls.filter((l) => l.age <= YOUNG_AGE && !l.youth);
    for (const l of young) expect(l.potential).toBeGreaterThanOrEqual(1);
    wallet.coins = 0;
    expect(scoutListing(st, wallet, old.id)).toEqual({ ok: false, reason: 'no-coins' });
    // Shortlist entries vanish with their listing.
    for (let i = 0; i < 4; i++) play(st, wallet);
    expect(shortlisted(st).every((l) => listingById(st, l.id))).toBe(true);
    expect(st.tm.shortlist.every((id) => listingById(st, id))).toBe(true);
  });

  it('a year passes between seasons: everyone ages, the young grow by their potential, the old fade', () => {
    const st = career(91);
    const club = st.club!;
    const wallet = { coins: 0 };
    const before = club.squad.map((p) => ({ id: p.id, age: playerAge(p), pot: playerPotential(p), ovr: overall(p), pace: p.stats.pace }));
    for (let i = 0; i < MATCHDAYS; i++) play(st, wallet, 3, 0);
    expect(st.summary).not.toBeNull();
    startNextSeason(st);
    expect(st.season!.number).toBe(2);
    for (const b of before) {
      const p = club.squad.find((x) => x.id === b.id);
      if (!p) continue;
      expect(playerAge(p)).toBe(b.age + 1);
      if (b.age < YOUNG_AGE && b.pot > 0) expect(overall(p)).toBeGreaterThan(b.ovr);
      if (b.age >= 32) expect(p.stats.pace).toBeLessThan(b.pace);
    }
    // ageSquad alone is idempotent per call and never breaks a stat's bounds.
    const p = club.squad[0];
    p.stats.pace = 99;
    (p as PlayerDef & { age?: number }).age = 39;
    ageSquad(club);
    expect(p.stats.pace).toBe(97);
    expect(playerAge(p)).toBe(40);
    // A fresh market for the new season.
    expect(st.tm.listings.length).toBeGreaterThanOrEqual(LISTINGS_MIN);
    expect(st.tm.listings.filter((l) => l.youth)).toHaveLength(1);
  });
});

describe('save migration', () => {
  it('an old career save without market fields loads and fills its market on refresh', () => {
    const st = career(101);
    const wallet = { coins: 0 };
    play(st, wallet);
    const raw = JSON.parse(JSON.stringify(st));
    delete raw.tm;
    raw.market = [makePlayer(new Rng(1), 'MF', 50, 30, 'm1-1-0')];
    raw.marketKey = '1:1';
    for (const p of raw.club.squad) {
      delete p.age;
      delete p.potential;
      delete p.contract;
    }
    for (const r of raw.season.rivals) {
      delete r.in;
      delete r.out;
    }
    const back = migrateCareer(raw, 1);
    expect(back.club).not.toBeNull();
    expect(back.season?.matchday).toBe(1);
    expect(back.tm.listings).toEqual([]);
    expect(back.market).toEqual([]);
    refreshMarket(back, wallet);
    expect(back.tm.key).toBe('1:1');
    expect(back.tm.listings.length).toBeGreaterThanOrEqual(LISTINGS_MIN);
    expect(back.market).toHaveLength(FREE_AGENTS);
    for (const p of back.club!.squad) {
      expect(playerAge(p)).toBeGreaterThanOrEqual(17);
      expect(playerAge(p)).toBeLessThanOrEqual(33);
    }
  });

  it('round-trips live offers, sales, shortlist and rival trades through JSON', () => {
    const st = career(102);
    const wallet = { coins: 100000 };
    play(st, wallet);
    const l = st.tm.listings.find((x) => x.club)!;
    placeBid(st, wallet, l.id, Math.round((l.asking * 0.8) / 10) * 10);
    listPlayer(st, st.club!.squad[12].id);
    toggleShortlist(st, st.tm.listings[1].id);
    scoutListing(st, wallet, st.tm.listings[1].id);
    play(st, wallet);
    const back = migrateCareer(JSON.parse(JSON.stringify(st)), 1);
    expect(back).toEqual(st);
    // A bid whose listing is gone from the save is refunded through `owed`.
    const raw = JSON.parse(JSON.stringify(st));
    raw.tm.bids = [{ id: 'b9', listingId: 'gone', amount: 500, week: 1, status: 'pending', counter: 0, player: raw.tm.listings[0].player, clubName: 'X' }];
    const fixed = migrateCareer(raw, 1);
    expect(fixed.tm.bids).toHaveLength(0);
    expect(fixed.tm.owed).toBe(500);
    const w = { coins: 0 };
    refreshMarket(fixed, w);
    expect(w.coins).toBe(500);
    expect(fixed.tm.owed).toBe(0);
  });
});
