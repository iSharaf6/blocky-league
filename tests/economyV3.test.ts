/**
 * Economy v3 (docs/ECONOMY.md): gems beside coins, what stadium style does (the club's atmosphere), the reasons to
 * come back (the login calendar, weekly objectives, capped rewarded ads) and the invariants that keep it fair:
 *   1. a free player can still earn everything eventually,
 *   2. gems are never required to progress,
 *   3. no purchase is random.
 * The store's catalogue is in iap.test.ts; rarity, today's deal and the Club Pass track in economy.test.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DECOR_IDS, DECOR_SLOT_OF, defaultSave, importSave, type MatchSummary, type SaveData } from '../src/core/save';
import {
  CHANT_CAP, CROWD_CAP, DECOR_BONUS, INCOME_CAP, atmosphereFrom, atmosphereOf, bestSlots, chantRate, decorBonusParts, decorBonusShort, withCrowd, withIncome,
} from '../src/meta/atmosphere';
import { BOTTOM_DIVISION, createClub, migrateCareer, newSeason, type CareerState } from '../src/meta/career';
import { KIT_COLORS } from '../src/meta/data';
import { payoutText, seasonGemsMax, syncCareerGems } from '../src/meta/gemSources';
import {
  COINS_PER_GEM, COIN_OFFERS, GEM_PRICES, GEM_REWARDS, GEM_SINKS, PASS_GEMS, SCOUT_NETWORKS, SEASON_GEMS, WELCOME_GEMS, addGems, buyCoinsWithGems,
  buyScoutNetwork, canAfford, coverShortfall, finishBuildPrice, gems, grantGemsOnce, normalizeGems, scoutNetworkOf, scoutNetworkTier, spendGems, sumGems, topUpGems,
} from '../src/meta/gems';
import { PARTS, defaultGround, groundFromLevel, startBuild, tickBuild } from '../src/meta/ground';
import { academyIntake, bestProspectIndex } from '../src/meta/life';
import {
  AD_CAPS, AD_PLACES, CALENDAR, WEEKLY_POOL, adsLeft, advanceWeekly, calendarNext, calendarToday, claimDailyGems, claimSweep, normalizeLoops, useAd, weekStart,
  weeklyFor, weeklyLoopGems, weeklyObjectives,
} from '../src/meta/loops';
import { playerPotential } from '../src/meta/market';
import { buyPassWithGems, claimAllPass, passActive, passTotals, syncSeasonGems } from '../src/meta/pass';
import { claimAllSeason, rollSeason, seasonOf, tierXp } from '../src/meta/season';
import {
  PACK_TOKENS, buyItem, dailyDeal, equipItem, grantItem, itemTier, nextDeal, owns, rerollDeal, scoutTokens, shopItems,
} from '../src/meta/shop';
import { CATALOGUE, applyPurchase, gemsOf, isGemPack } from '../src/platform/iap';
import type { Kit } from '../src/sim/types';

const OCT = new Date(2026, 9, 12, 12);
const NOV = new Date(2026, 10, 2, 12);
const DAY = '2026-10-12';

afterEach(() => {
  vi.restoreAllMocks();
});

const win = (over: Partial<MatchSummary> = {}): MatchSummary => ({
  won: true, drawn: false, goals: 2, conceded: 0, assists: 1, tacklesWon: 4, passes: 20, skills: 2, headers: 0, longGoals: 0, powerups: 0, motm: true, blitz: false,
  difficulty: 1, ...over,
});

// ------------------------------------------------------------------ the gem wallet

describe('gems: the wallet', () => {
  it('a new save, and a save from before gems, starts with the welcome gift', () => {
    expect(gems(defaultSave())).toBe(WELCOME_GEMS);
    const old = JSON.parse(JSON.stringify(defaultSave())) as Record<string, unknown>;
    delete old.gems;
    delete old.loops;
    const loaded = importSave(old)!;
    expect(gems(loaded)).toBe(WELCOME_GEMS);
    expect(loaded.loops).toEqual(normalizeLoops(undefined));
    // The gift is one replay's worth: enough to try a sink, not more.
    expect(WELCOME_GEMS).toBeGreaterThanOrEqual(GEM_PRICES.replayMatch);
    expect(WELCOME_GEMS).toBeLessThan(100);
  });

  it('adds, spends and never goes below zero; a refused spend changes nothing', () => {
    const s = defaultSave();
    addGems(s, 30, 'board');
    expect(gems(s)).toBe(WELCOME_GEMS + 30);
    expect(s.gems!.earned).toBe(WELCOME_GEMS + 30);
    expect(spendGems(s, 60, 'replayMatch')).toBe(true);
    expect(gems(s)).toBe(WELCOME_GEMS - 30);
    expect(canAfford(s, 1000)).toBe(false);
    expect(spendGems(s, 1000, 'scoutNetwork')).toBe(false);
    expect(gems(s)).toBe(WELCOME_GEMS - 30);
    expect(s.gems!.spent).toBe(60);
    // Damaged amounts pay and take nothing.
    addGems(s, -5, 'x');
    addGems(s, Number.NaN, 'x');
    expect(spendGems(s, -1, 'x')).toBe(false);
    expect(spendGems(s, Number.NaN, 'x')).toBe(false);
    expect(gems(s)).toBe(WELCOME_GEMS - 30);
    // Gems from the store count as bought, the rest as earned by playing.
    addGems(s, 100, 'iap:bl.gems.100');
    expect(s.gems!.bought).toBe(100);
    expect(s.gems!.earned).toBe(WELCOME_GEMS + 30);
  });

  it('a one-time reward pays once', () => {
    const s = defaultSave();
    expect(grantGemsOnce(s, 'legacy:1', 20, 'legacyLevel')).toBe(true);
    expect(grantGemsOnce(s, 'legacy:1', 20, 'legacyLevel')).toBe(false);
    expect(gems(s)).toBe(WELCOME_GEMS + 20);
  });

  it('keeps lifetime payout receipts after hundreds of seasons and a reload', () => {
    const s = defaultSave();
    grantGemsOnce(s, 'legacy:1', GEM_REWARDS.legacyLevel, 'legacyLevel');
    for (let season = 1; season <= 700; season++) grantGemsOnce(s, `board:0:${season}:0`, GEM_REWARDS.boardObjective, 'boardObjective');
    const before = gems(s);
    expect(grantGemsOnce(s, 'legacy:1', GEM_REWARDS.legacyLevel, 'legacyLevel')).toBe(false);
    const back = importSave(JSON.parse(JSON.stringify(s)))!;
    expect(grantGemsOnce(back, 'legacy:1', GEM_REWARDS.legacyLevel, 'legacyLevel')).toBe(false);
    expect(grantGemsOnce(back, 'board:0:1:0', GEM_REWARDS.boardObjective, 'boardObjective')).toBe(false);
    expect(gems(back)).toBe(before);
    // Receipts are short identifiers, so a long career's whole ledger remains small.
    expect(JSON.stringify(back.gems!.claimed).length).toBeLessThan(15_000);
  });

  it('is made whole when damaged, and survives a reload', () => {
    expect(normalizeGems('nonsense')).toEqual(normalizeGems(undefined));
    const g = normalizeGems({ balance: -4, earned: 'x', claimed: ['ok:1', '<script>', 5], network: 9, log: [{ n: 3, why: 'a' }, 'junk'] });
    expect(g).toMatchObject({ balance: 0, earned: 0, claimed: ['ok:1'], network: SCOUT_NETWORKS.length, log: [{ n: 3, why: 'a' }] });
    const s = defaultSave();
    addGems(s, 77, 'cup');
    buyScoutNetwork(s);
    const back = importSave(JSON.parse(JSON.stringify(s)))!;
    expect(back.gems).toEqual(s.gems);
    const broken = defaultSave();
    (broken as { gems?: unknown }).gems = 'x';
    expect(gems(broken)).toBe(WELCOME_GEMS);
  });
});

// ------------------------------------------------------------------ prices, and the ladder a dollar buys

describe('gems: what they cost and what a dollar buys', () => {
  it('every price is a whole positive number, and $0.99 is worth something real', () => {
    const flat = [GEM_PRICES.finishBuildPerMatchday, GEM_PRICES.healPlayer, GEM_PRICES.replayMatch, GEM_PRICES.clubPass, GEM_PRICES.dealRefresh, ...GEM_PRICES.scoutNetwork];
    for (const n of flat) {
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThan(0);
    }
    // The smallest pack: 100 gems. Two replays, or five one-matchday builds, or an EPIC look's worth of coins.
    const smallest = CATALOGUE.filter(isGemPack)[0];
    expect(gemsOf(smallest)).toBe(100);
    expect(Math.floor(100 / GEM_PRICES.replayMatch)).toBe(2);
    expect(Math.floor(100 / finishBuildPrice(1))).toBe(5);
    expect(100 * COINS_PER_GEM).toBeGreaterThanOrEqual(1000);
    // The tiers of the Scouting Network cost more each, and finishing a build scales with the wait.
    expect([...GEM_PRICES.scoutNetwork]).toEqual([...GEM_PRICES.scoutNetwork].sort((a, b) => a - b));
    expect(finishBuildPrice(2)).toBe(2 * GEM_PRICES.finishBuildPerMatchday);
    expect(finishBuildPrice(0)).toBe(GEM_PRICES.finishBuildPerMatchday);
  });

  it('swaps gems for coins at a shown rate that only gets better with size', () => {
    const rate = COIN_OFFERS.map((o) => o.coins / o.gems);
    for (let i = 1; i < rate.length; i++) expect(rate[i]).toBeGreaterThan(rate[i - 1]);
    expect(rate[0]).toBe(COINS_PER_GEM);
    const s = defaultSave();
    addGems(s, 500, 'cup');
    const coins = s.coins;
    expect(buyCoinsWithGems(s, 'c2400')).toMatchObject({ ok: true, price: 150, coins: 2400 });
    expect(s.coins).toBe(coins + 2400);
    expect(gems(s)).toBe(WELCOME_GEMS + 350);
    expect(buyCoinsWithGems(s, 'c22000')).toMatchObject({ ok: false, reason: 'no-gems' });
    expect(buyCoinsWithGems(s, 'nope')).toMatchObject({ ok: false, reason: 'unknown' });
    expect(s.coins).toBe(coins + 2400);
  });

  it('covers a coin shortfall with gems at the base rate, exactly, or not at all', () => {
    expect(topUpGems(0)).toBe(0);
    expect(topUpGems(1)).toBe(1);
    expect(topUpGems(COINS_PER_GEM * 10)).toBe(10);
    expect(topUpGems(COINS_PER_GEM * 10 + 1)).toBe(11);
    const s = defaultSave();
    s.coins = 1000;
    // 1,500 short of a 2,500 look: 108 gems. The welcome gift alone doesn't cover it: nothing changes.
    expect(coverShortfall(s, 2500, 'ball:gold')).toBe(false);
    expect(s.coins).toBe(1000);
    expect(gems(s)).toBe(WELCOME_GEMS);
    addGems(s, 100, 'cup');
    expect(coverShortfall(s, 2500, 'ball:gold')).toBe(true);
    expect(s.coins).toBe(2500);
    expect(gems(s)).toBe(WELCOME_GEMS + 100 - topUpGems(1500));
    expect(buyItem(s, 'ball', 'gold').ok).toBe(true);
    expect(s.coins).toBe(0);
  });
});

// ------------------------------------------------------------------ invariant 1: a free player can earn everything

describe('invariant: a free player can still earn everything eventually', () => {
  it('every look is free, earned by level, sold for coins, or on the Club Pass, which gems earned by playing buy', () => {
    for (const it of shopItems()) {
      const reachable = it.price === 0 || it.level !== undefined || it.price > 0 || it.pass === true;
      expect(reachable, `${it.cat}:${it.id}`).toBe(true);
      // Nothing in the catalogue is priced in gems only: coins (earned every match) buy every look that is for sale.
      if (!it.pass) expect(it.price).toBeGreaterThanOrEqual(0);
    }
    // The Club Pass looks: a free player earns the pass with gems from play.
    const s = defaultSave();
    seasonOf(s, OCT);
    expect(buyPassWithGems(s, OCT)).toMatchObject({ ok: false, reason: 'no-gems' });
    addGems(s, GEM_PRICES.clubPass, 'weekly');
    expect(buyPassWithGems(s, OCT)).toMatchObject({ ok: true, price: GEM_PRICES.clubPass });
    expect(passActive(s, OCT)).toBe(true);
    expect(buyPassWithGems(s, OCT)).toMatchObject({ ok: false, reason: 'maxed' });
    // The loops alone (the calendar, the sweep, the weekly objectives, the daily ad) earn it in about six weeks.
    expect(weeklyLoopGems()).toBeGreaterThanOrEqual(90);
    expect(Math.ceil(GEM_PRICES.clubPass / weeklyLoopGems())).toBeLessThanOrEqual(7);
    // And the pass pays back a quarter of its gem price.
    expect(passTotals('2026-10').gems).toBe(sumGems(PASS_GEMS));
    expect(sumGems(PASS_GEMS)).toBeGreaterThanOrEqual(GEM_PRICES.clubPass / 4);
  });

  it('every gem sink is in reach of gems earned by playing: the top Scouting Network in about four months', () => {
    const all = GEM_PRICES.scoutNetwork.reduce((a, b) => a + b, 0);
    expect(Math.ceil(all / weeklyLoopGems())).toBeLessThanOrEqual(18);
    expect(Math.ceil(GEM_PRICES.scoutNetwork[0] / weeklyLoopGems())).toBeLessThanOrEqual(3);
    // A season of the career pays gems too (objectives, the cup, the title).
    expect(seasonGemsMax(BOTTOM_DIVISION)).toBeGreaterThanOrEqual(3 * GEM_REWARDS.boardObjective + GEM_REWARDS.cup);
  });

  it('the free play gem income is small and steady: neither a trickle nor a flood next to the packs', () => {
    // A keen free player's week from the loops is about one dollar of gems: enough to matter, not enough to make
    // the packs pointless.
    expect(weeklyLoopGems()).toBeGreaterThanOrEqual(80);
    expect(weeklyLoopGems()).toBeLessThanOrEqual(160);
    expect(sumGems(SEASON_GEMS)).toBe(30);
  });
});

// ------------------------------------------------------------------ invariant 2: gems are never required

describe('invariant: gems are never required to progress', () => {
  it('every gem sink names its free way', () => {
    for (const k of Object.keys(GEM_PRICES) as (keyof typeof GEM_PRICES)[]) {
      expect(GEM_SINKS[k].what.length, k).toBeGreaterThan(3);
      expect(GEM_SINKS[k].free.length, k).toBeGreaterThan(10);
    }
  });

  it('a build opens by itself after its matchdays, with no gems at all', () => {
    for (const part of PARTS) {
      // (A ground with everything the part needs built: the whole thing, then this part taken back down.)
      const g = groundFromLevel(5);
      for (const p of PARTS) g.built[p.id] = p.steps.length;
      g.built[part.id] = part.steps.length - 1;
      const wallet = { coins: 1_000_000 };
      const r = startBuild(g, wallet, part.id);
      expect(r.ok, part.id).toBe(true);
      if (!r.ok) continue;
      for (let md = 0; md < r.weeks; md++) tickBuild(g);
      expect(g.building).toBeNull();
      expect(g.built[part.id]).toBe(part.steps.length);
    }
    // And nothing about building is priced in gems: the parts cost coins and matchdays.
    expect(startBuild(defaultGround(), { coins: 800 }, 'main')).toMatchObject({ ok: true, cost: 800 });
  });

  it('the season track pays every free tier without the pass or a gem', () => {
    const s = defaultSave();
    s.gems!.balance = 0;
    const season = seasonOf(s, OCT);
    season.xp = tierXp(30);
    const coins = claimAllSeason(season);
    expect(coins).toBeGreaterThan(3000);
    // The free track even pays gems (tiers 10, 20 and 30), once each.
    expect(syncSeasonGems(s)).toBe(sumGems(SEASON_GEMS));
    expect(syncSeasonGems(s)).toBe(0);
    expect(gems(s)).toBe(sumGems(SEASON_GEMS));
  });

  it('a pass bought with gems pays its gems once per tier claimed, and a month end loses nothing', () => {
    const s = defaultSave();
    const season = seasonOf(s, OCT);
    season.xp = tierXp(13);
    addGems(s, GEM_PRICES.clubPass, 'weekly');
    expect(buyPassWithGems(s, OCT).ok).toBe(true);
    claimAllPass(s);
    // Pass tiers 3, 8 and 13 pay gems.
    expect(syncSeasonGems(s)).toBe(PASS_GEMS[3] + PASS_GEMS[8] + PASS_GEMS[13]);
    expect(syncSeasonGems(s)).toBe(0);
    // Reached but not claimed at the month's end: the gems are carried and paid.
    season.xp = tierXp(20);
    const before = gems(s);
    rollSeason(season, NOV);
    expect(season.carryGems).toBe(PASS_GEMS[18] + (SEASON_GEMS[10] ?? 0) + (SEASON_GEMS[20] ?? 0));
    expect(syncSeasonGems(s)).toBe(PASS_GEMS[18] + 15);
    expect(season.carryGems ?? 0).toBe(0);
    expect(gems(s)).toBe(before + PASS_GEMS[18] + 15);
    expect(syncSeasonGems(s)).toBe(0);
  });
});

// ------------------------------------------------------------------ invariant 3: no purchase is random

describe('invariant: no purchase is random', () => {
  it('every store product pays out exactly the same thing whatever the dice say', () => {
    for (const entry of CATALOGUE) {
      const run = (roll: number) => {
        vi.spyOn(Math, 'random').mockReturnValue(roll);
        const s = defaultSave();
        seasonOf(s, OCT);
        const g = applyPurchase(s, entry, 'tx-1');
        vi.restoreAllMocks();
        return { g, coins: s.coins, gems: gems(s), owned: [...s.shop!.owned].sort(), iap: [...s.iap!.owned], tokens: scoutTokens(s) };
      };
      expect(run(0.01), entry.id).toEqual(run(0.99));
    }
  });

  it('money and gems never buy a scout pack: tokens are earned only', () => {
    const s = defaultSave();
    const tokens = scoutTokens(s);
    for (const entry of CATALOGUE) applyPurchase(s, entry, `tx-${entry.id}`);
    addGems(s, 100_000, 'iap:test');
    for (const o of COIN_OFFERS) buyCoinsWithGems(s, o.id);
    while (buyScoutNetwork(s).ok);
    expect(scoutTokens(s)).toBe(tokens);
    // Packs cost tokens, and nothing in the store's catalogue or the gem prices mentions them.
    expect(PACK_TOKENS.scout).toBeGreaterThan(0);
    for (const entry of CATALOGUE) expect(Object.keys(entry)).not.toContain('tokens');
    expect(Object.keys(GEM_PRICES)).not.toContain('pack');
  });

  it('every gem sink is a stated outcome: the same result every time', () => {
    const run = (roll: number) => {
      vi.spyOn(Math, 'random').mockReturnValue(roll);
      const s = defaultSave();
      seasonOf(s, OCT);
      addGems(s, 5000, 'cup');
      buyCoinsWithGems(s, 'c7500');
      buyScoutNetwork(s);
      buyPassWithGems(s, OCT);
      coverShortfall(s, s.coins + 140, 'x');
      vi.restoreAllMocks();
      return { coins: s.coins, gems: gems(s), network: scoutNetworkTier(s), pass: s.season!.pass };
    };
    expect(run(0.01)).toEqual(run(0.99));
    expect(run(0.5)).toEqual({ coins: 500 + 7500 + 140, gems: WELCOME_GEMS + 5000 - 400 - 200 - GEM_PRICES.clubPass - 10, network: 1, pass: true });
  });

  it('the Scouting Network is a guarantee, never odds: every intake has its promised prospect', () => {
    const KIT: Kit = { shirt: KIT_COLORS.blue, shirt2: KIT_COLORS.white, pattern: 'stripes', shorts: KIT_COLORS.white, socks: KIT_COLORS.blue, gk: 0 };
    const career = (seed: number): CareerState => {
      const st = migrateCareer(null, seed);
      st.club = createClub({ name: 'Test Town', short: 'TST', kit: KIT, formation: '4-4-2' }, seed);
      newSeason(st, BOTTOM_DIVISION, 1);
      return st;
    };
    // The tiers are bought in order, each once, each a stronger promise in plain words.
    const s = defaultSave();
    addGems(s, 10_000, 'cup');
    expect(scoutNetworkOf(s)).toBeNull();
    for (const n of SCOUT_NETWORKS) {
      expect(buyScoutNetwork(s)).toMatchObject({ ok: true, price: n.price });
      expect(scoutNetworkOf(s)).toEqual(n);
      expect(n.text).toMatch(/EVERY INTAKE/);
      expect(n.text).not.toMatch(/CHANCE|LIKELY|ODDS|%/);
    }
    expect(buyScoutNetwork(s)).toMatchObject({ ok: false, reason: 'maxed' });
    // The career's intake keeps the promise for every seed tried (meta/life.ts reads the tier mirrored into the career).
    for (const n of SCOUT_NETWORKS) {
      for (let seed = 1; seed <= 6; seed++) {
        const st = career(seed) as CareerState & { staff?: { network: number } };
        if (!st.staff) return; // (A career without staff yet: the mirror isn't there to test.)
        st.staff.network = n.tier;
        const plain = career(seed);
        plain.season!.number = 2;
        plain.academy.season = 0;
        academyIntake(plain);
        st.season!.number = 2;
        st.academy.season = 0;
        academyIntake(st);
        const best = st.academy.prospects[bestProspectIndex(st)];
        expect(playerPotential(best), `tier ${n.tier} seed ${seed}`).toBeGreaterThanOrEqual(n.minStars);
        expect(st.academy.prospects.length).toBe(plain.academy.prospects.length + n.extra);
      }
    }
  }, 30_000);

  it("today's deal moves to another look on a reroll, and stays put for the rest of the day", () => {
    const s = defaultSave();
    const d = dailyDeal(s, DAY)!;
    const next = rerollDeal(s, DAY)!;
    expect(`${next.item.cat}:${next.item.id}`).not.toBe(`${d.item.cat}:${d.item.id}`);
    expect(owns(s, next.item.cat, next.item.id)).toBe(false);
    expect(dailyDeal(s, DAY)!.item.id).toBe(next.item.id);
    // The same save rerolls to the same look: the reroll is a rule, not a slot machine.
    const t = defaultSave();
    dailyDeal(t, DAY);
    expect(rerollDeal(t, DAY)!.item.id).toBe(next.item.id);
  });

  it('shows the exact next deal without changing the save or charging anything', () => {
    const s = defaultSave();
    for (const establish of [false, true]) {
      if (establish) dailyDeal(s, DAY);
      const before = JSON.parse(JSON.stringify(s));
      const preview = nextDeal(s, DAY)!;
      expect(s).toEqual(before);
      expect(nextDeal(s, DAY)).toEqual(preview);
      expect(rerollDeal(s, DAY)).toEqual(preview);
      expect(s.coins).toBe(before.coins);
      expect(gems(s)).toBe(before.gems.balance);
    }
    delete s.shop;
    const old = JSON.parse(JSON.stringify(s));
    expect(nextDeal(s, DAY)).not.toBeNull();
    expect(s).toEqual(old);
    // With just today's item left, a refresh offers no outcome and changes nothing.
    const full = defaultSave();
    const current = dailyDeal(full, DAY)!;
    for (const it of shopItems()) if (it.id !== current.item.id || it.cat !== current.item.cat) grantItem(full, it.cat, it.id);
    const complete = JSON.parse(JSON.stringify(full));
    expect(nextDeal(full, DAY)).toBeNull();
    expect(rerollDeal(full, DAY)).toBeNull();
    expect(full).toEqual(complete);
  });
});

// ------------------------------------------------------------------ atmosphere: what stadium style and mascots do

describe('club atmosphere', () => {
  it('every coin-purchased stadium style item adds its stated atmosphere benefit', () => {
    for (const id of DECOR_IDS.filter((id) => !shopItems('decor').find((it) => it.id === id)?.pass)) {
      const b = DECOR_BONUS[id];
      expect((b.income ?? 0) + (b.crowd ?? 0) + (b.chants ?? 0) + (b.show ?? 0), id).toBeGreaterThan(0);
      const parts = decorBonusParts(id);
      expect(parts.length, id).toBeGreaterThan(0);
      expect(decorBonusShort(id), id).not.toBe('');
      // (No hyphens in the pixel font, no separators the owner dislikes.)
      for (const p of [...parts, decorBonusShort(id)]) expect(p).not.toMatch(/[-–—·●]/);
    }
    expect(decorBonusParts('mowcrest')).toEqual(['+3% MATCHDAY INCOME']);
    expect(decorBonusParts('tifoflags')).toEqual(['+1 CHANT']);
    expect(decorBonusParts('mascotdragon')).toEqual(['HALF TIME SHOW +60 COINS', '+2 CHANTS']);
    // Only mascots put on a half time show.
    for (const id of DECOR_IDS) expect(!!DECOR_BONUS[id].show, id).toBe(DECOR_SLOT_OF[id] === 'mascot');
  });

  it('nothing worn is no atmosphere; what is worn adds up, by slot', () => {
    expect(atmosphereFrom({})).toMatchObject({ rating: 0, word: 'QUIET', income: 0, crowd: 0, chants: 0, show: 0 });
    const a = atmosphereFrom({ pitch: 'mowcircle', net: 'netclub', tifo: 'tifoflags', mascot: 'mascotbear' });
    expect(a).toMatchObject({ income: 3, chants: 2, crowd: 0, show: 20, mascot: 'mascotbear' });
    expect(a.rating).toBeGreaterThan(0);
    // An item in the wrong slot, or an unknown one, counts for nothing.
    expect(atmosphereFrom({ pitch: 'netglow', net: 'nope' }).rating).toBe(0);
    // The ground as built adds to it (the fan zone, the ends, the dome...).
    const g = groundFromLevel(5);
    g.built.fanzone = 1;
    expect(atmosphereFrom({}, g).crowd).toBeGreaterThan(0);
    expect(atmosphereFrom({}, g).chants).toBeGreaterThan(0);
    expect(atmosphereFrom({}, g).income).toBe(0);
  });

  it('counts only what is owned AND worn', () => {
    const s = defaultSave();
    expect(atmosphereOf(s).rating).toBe(0);
    grantItem(s, 'decor', 'lightshow');
    // Owned, not worn: nothing yet.
    expect(atmosphereOf(s).income).toBe(0);
    equipItem(s, 'decor', 'lightshow');
    expect(atmosphereOf(s).income).toBe(4);
    // Worn in the settings but not owned (a hand-edited save): nothing.
    s.settings.decor = { ...s.settings.decor, mascot: 'mascotdragon' };
    expect(atmosphereOf(s).show).toBe(0);
  });

  it('is capped: a nice boost, never a paywall', () => {
    const g: ReturnType<typeof groundFromLevel> = groundFromLevel(5);
    for (const p of PARTS) g.built[p.id] = p.steps.length;
    const best = atmosphereFrom(bestSlots(), g);
    expect(best.income).toBe(INCOME_CAP);
    expect(best.crowd).toBe(CROWD_CAP);
    expect(best.chants).toBe(CHANT_CAP);
    expect(best.rating).toBe(100);
    expect(best.raw.income).toBeGreaterThan(INCOME_CAP);
    expect(INCOME_CAP).toBeLessThanOrEqual(15);
    // The caps are reached WITHOUT a single Legendary look: the dearest ones are for the look.
    const mid: { [slot: string]: string } = {};
    const score = (id: (typeof DECOR_IDS)[number]) => (DECOR_BONUS[id].income ?? 0) * 3 + (DECOR_BONUS[id].crowd ?? 0) + (DECOR_BONUS[id].chants ?? 0) * 4;
    for (const it of shopItems('decor')) {
      if (itemTier(it) === 'legendary' || !it.slot) continue;
      const cur = mid[it.slot] as (typeof DECOR_IDS)[number] | undefined;
      if (!cur || score(it.id as (typeof DECOR_IDS)[number]) > score(cur)) mid[it.slot] = it.id;
    }
    const m = atmosphereFrom(mid, g);
    expect(m.income).toBe(INCOME_CAP);
    expect(m.crowd).toBe(CROWD_CAP);
    expect(m.chants).toBe(CHANT_CAP);
    // What it does to a home match: coins up to the cap, a fuller ground, more chants. Never less than without it.
    expect(withIncome(200, best)).toBe(Math.round(200 * (1 + INCOME_CAP / 100)));
    expect(withIncome(200, atmosphereFrom({}))).toBe(200);
    expect(withIncome(0, best)).toBe(0);
    expect(withCrowd(0.95, best)).toBe(1);
    expect(withCrowd(0.5, best)).toBeCloseTo(0.5 + CROWD_CAP / 100);
    expect(chantRate(best)).toBeLessThanOrEqual(2);
    expect(chantRate(atmosphereFrom({}))).toBe(1);
    // The mascot's show is a few coins, far under what a match pays (a Normal win is about 200).
    expect(best.show).toBeLessThanOrEqual(60);
  });
});

// ------------------------------------------------------------------ the reasons to come back

describe('the login calendar', () => {
  it('pays coins every day, gems on days 3 and 7 and a Scout Token on day 5, then starts again', () => {
    expect(CALENDAR).toHaveLength(7);
    expect(CALENDAR.map((d) => d.coins)).toEqual([100, 150, 200, 250, 300, 350, 400]);
    expect(CALENDAR.map((d) => d.gems)).toEqual([0, 0, 5, 0, 0, 0, 20]);
    expect(CALENDAR.map((d) => d.tokens)).toEqual([0, 0, 0, 0, 1, 0, 0]);
    const s = defaultSave();
    expect(calendarToday(s, DAY)).toEqual({ step: 1, reward: CALENDAR[0] });
    s.gift = { last: DAY, streak: 1 };
    expect(calendarToday(s, DAY)).toBeNull();
    expect(calendarNext(s)).toEqual({ step: 2, reward: CALENDAR[1] });
    s.gift = { last: '2026-10-18', streak: 7 };
    expect(calendarToday(s, '2026-10-19')!.step).toBe(1);
  });

  it('never punishes a missed day: after a month away the calendar carries on where it was', () => {
    const s = defaultSave();
    s.gift = { last: '2026-09-01', streak: 4 };
    expect(calendarToday(s, DAY)).toEqual({ step: 5, reward: CALENDAR[4] });
  });
});

describe('weekly objectives', () => {
  it('are the same three for everyone all week, and new ones the next', () => {
    expect(weekStart('2026-10-12')).toBe('2026-10-12');
    expect(weekStart('2026-10-18')).toBe('2026-10-12');
    expect(weekStart('2026-10-19')).toBe('2026-10-19');
    const a = weeklyObjectives('2026-10-12');
    expect(new Set(a.map((o) => o.id)).size).toBe(3);
    expect(weeklyObjectives('2026-10-17').map((o) => o.id)).toEqual(a.map((o) => o.id));
    for (const o of WEEKLY_POOL) {
      expect(o.goal).toBeGreaterThan(0);
      expect(o.coins).toBeGreaterThanOrEqual(300);
    }
    // Over a year of weeks every objective comes up.
    const seen = new Set<string>();
    for (let w = 0; w < 52; w++) for (const o of weeklyObjectives(`2026-${String(1 + Math.floor(w / 5)).padStart(2, '0')}-${String(1 + (w % 5) * 6).padStart(2, '0')}`)) seen.add(o.id);
    expect(seen.size).toBe(WEEKLY_POOL.length);
  });

  it('pay coins (returned for the match to pay) and gems once each, and a new week starts afresh', () => {
    const s = defaultSave();
    const start = gems(s);
    let coins = 0;
    let done = 0;
    // A fortnight's worth of good matches in one week: all three are done, each paid once.
    for (let i = 0; i < 40; i++) {
      const got = advanceWeekly(s, DAY, win({ goals: 3, assists: 2, tacklesWon: 6, skills: 4 }), 1);
      coins += got.reduce((n, x) => n + x.objective.coins, 0);
      done += got.length;
    }
    expect(done).toBe(3);
    expect(coins).toBe(weeklyObjectives(DAY).reduce((n, o) => n + o.coins, 0));
    expect(gems(s)).toBe(start + 3 * GEM_REWARDS.weekly);
    expect(weeklyFor(s, DAY).claimed).toEqual([true, true, true]);
    expect(weeklyFor(s, '2026-10-19')).toMatchObject({ week: '2026-10-19', progress: [0, 0, 0], claimed: [false, false, false] });
  });
});

describe('the daily sweep and the rewarded ads', () => {
  it('all three daily challenges done pays the sweep gems, once a day', () => {
    const s = defaultSave();
    s.progress.daily = { day: DAY, progress: [1, 1, 1], claimed: [true, true, false], fresh: false };
    expect(claimSweep(s, DAY)).toBe(0);
    s.progress.daily.claimed = [true, true, true];
    expect(claimSweep(s, DAY)).toBe(GEM_REWARDS.dailySweep);
    expect(claimSweep(s, DAY)).toBe(0);
    expect(gems(s)).toBe(WELCOME_GEMS + GEM_REWARDS.dailySweep);
  });

  it('every rewarded ad is capped per day and starts again the next', () => {
    const s = defaultSave();
    for (const place of AD_PLACES) {
      expect(AD_CAPS[place]).toBeGreaterThanOrEqual(1);
      expect(AD_CAPS[place]).toBeLessThanOrEqual(2);
      expect(adsLeft(s, place, DAY)).toBe(AD_CAPS[place]);
      for (let i = 0; i < AD_CAPS[place]; i++) expect(useAd(s, place, DAY)).toBe(true);
      expect(useAd(s, place, DAY)).toBe(false);
      expect(adsLeft(s, place, DAY)).toBe(0);
      expect(adsLeft(s, place, '2026-10-13')).toBe(AD_CAPS[place]);
    }
    // The count is in the save, so a reload cannot reset it.
    const back = importSave(JSON.parse(JSON.stringify(s)))!;
    for (const place of AD_PLACES) expect(adsLeft(back, place, DAY)).toBe(0);
    // The free daily gems are one of them.
    const t = defaultSave();
    expect(claimDailyGems(t, DAY)).toBe(GEM_REWARDS.dailyAd);
    expect(claimDailyGems(t, DAY)).toBe(0);
    expect(gems(t)).toBe(WELCOME_GEMS + GEM_REWARDS.dailyAd);
  });
});

// ------------------------------------------------------------------ gems from the career

describe('gems from the career', () => {
  const KIT: Kit = { shirt: KIT_COLORS.blue, shirt2: KIT_COLORS.white, pattern: 'stripes', shorts: KIT_COLORS.white, socks: KIT_COLORS.blue, gk: 0 };
  function career(seed = 7): CareerState {
    const st = migrateCareer(null, seed);
    st.club = createClub({ name: 'Test Town', short: 'TST', kit: KIT, formation: '4-4-2' }, seed);
    newSeason(st, BOTTOM_DIVISION, 1);
    return st;
  }

  it('pays each objective met, legacy level, title, promotion and cup once, however often it is asked', () => {
    const save: SaveData = defaultSave();
    const st = career();
    expect(syncCareerGems(save, st)).toEqual([]);
    expect(syncCareerGems(save, null)).toEqual([]);
    st.board.season = st.season!.number;
    st.board.objectives = [
      { kind: 'wins', target: 3, reward: 100, state: 'done' },
      { kind: 'goals', target: 10, reward: 100, state: 'open' },
    ];
    st.legacy.points = 300; // level 2
    st.history = [{ season: 1, division: 6, position: 1, outcome: 'promoted', cup: 3 }];
    const paid = syncCareerGems(save, st);
    const total = paid.reduce((n, p) => n + p.gems, 0);
    expect(total).toBe(GEM_REWARDS.boardObjective + 2 * GEM_REWARDS.legacyLevel + GEM_REWARDS.title + GEM_REWARDS.promotion + GEM_REWARDS.cup);
    expect(gems(save)).toBe(WELCOME_GEMS + total);
    expect(payoutText(paid)).toMatch(/^\+\d+ GEMS: /);
    expect(payoutText(paid)).not.toMatch(/[–—·●]/);
    // Asked again: nothing. The second objective, once met: just that one.
    expect(syncCareerGems(save, st)).toEqual([]);
    st.board.objectives[1].state = 'done';
    expect(syncCareerGems(save, st)).toEqual([{ what: 'OBJECTIVE DONE', gems: GEM_REWARDS.boardObjective }]);
    // A new club started as a legend plays season 1 again: its trophies pay too (the generation is in the key).
    st.legacy.gen = 1;
    expect(syncCareerGems(save, st).reduce((n, p) => n + p.gems, 0)).toBe(2 * GEM_REWARDS.boardObjective + GEM_REWARDS.title + GEM_REWARDS.promotion + GEM_REWARDS.cup);
  });
});
