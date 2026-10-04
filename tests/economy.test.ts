import { describe, expect, it } from 'vitest';
import { defaultSave, normalizeShop, PASS_IDS, type SaveData } from '../src/core/save';
import { activatePass, claimAllPass, claimCarryItems, claimPassTier, passActive, passTotals } from '../src/meta/pass';
import { passReward, rollSeason, seasonOf, tierXp, unclaimedPassTiers } from '../src/meta/season';
import {
  DEAL_OFF, buyItem, dailyDeal, itemTier, owns, priceOn, seasonPassItems, shopItem, shopItems, shopOf,
} from '../src/meta/shop';
import { CATALOGUE, PRODUCT_DOUBLER, PRODUCT_PASS, applyPurchase, coinDoubler, entryOf } from '../src/platform/iap';

/**
 * Economy v2 (docs/ECONOMY.md): rarity tiers and Legendary looks, today's deal, the Club Pass and its exclusive
 * looks, the Coin Doubler. Packs and Scout Tokens are in shop.test.ts, store purchases in iap.test.ts.
 */

const OCT = new Date(2026, 9, 12, 12);
const NOV = new Date(2026, 10, 2, 12);
const DAY = '2026-10-12';

function rich(coins = 100_000): SaveData {
  const s = defaultSave();
  s.coins = coins;
  seasonOf(s, OCT);
  return s;
}

describe('rarity and the Legendary looks', () => {
  it('every look has a tier by price; the Legendary ones are weeks of play for a free player', () => {
    const all = shopItems().filter((i) => !i.pass);
    expect(all.filter((i) => i.price === 0).every((i) => itemTier(i) === 'common')).toBe(true);
    const legendary = all.filter((i) => itemTier(i) === 'legendary');
    expect(legendary.map((i) => `${i.cat}:${i.id}`).sort()).toEqual([
      'ball:diamond', 'ball:planet', 'decor:kickpyro', 'decor:mascotdragon', 'goalfx:diamond', 'goalfx:galaxy', 'goalfx:meteor', 'goalfx:supernova',
      'kit:galaxy', 'kit:goldfoil', 'kit:neonglow', 'kit:pinstripe', 'look:bootlight', 'look:crown', 'trail:comet', 'trail:lightning',
    ]);
    // A keen free player banks roughly 2,500 to 3,500 coins a day: each is one to three days of saving, the set weeks.
    for (const i of legendary) expect(i.price).toBeGreaterThanOrEqual(4500);
    expect(legendary.reduce((n, i) => n + i.price, 0)).toBeGreaterThanOrEqual(25_000);
    // The fairness line: a free player can own the whole catalogue eventually: the effects and balls in about a month
    // of keen play, everything (kits, player looks and stadium style too) in about two.
    const total = all.reduce((n, i) => n + i.price, 0);
    const v1 = all.filter((i) => i.cat !== 'kit' && i.cat !== 'look' && i.cat !== 'decor').reduce((n, i) => n + i.price, 0);
    expect(v1).toBeLessThanOrEqual(100_000);
    expect(total).toBeLessThanOrEqual(200_000);
    // Every new category has looks for a first session, and something to aim at for weeks.
    for (const cat of ['kit', 'look', 'decor'] as const) {
      const list = all.filter((i) => i.cat === cat && i.price > 0);
      expect(list.filter((i) => i.price <= 450).length, cat).toBeGreaterThanOrEqual(2);
      expect(list.filter((i) => itemTier(i) === 'legendary').length, cat).toBeGreaterThanOrEqual(1);
    }
    // The rarer, the bigger the show: in every category the dearest look is a Legendary one.
    for (const cat of ['ball', 'goalfx', 'trail', 'kit', 'look', 'decor'] as const) {
      const top = all.filter((i) => i.cat === cat).sort((a, b) => b.price - a.price)[0];
      expect(itemTier(top)).toBe('legendary');
    }
  });
});

describe('Club Pass looks', () => {
  it('one goal explosion and one trail per month, never sold for coins, owned once the pass hands them over', () => {
    expect(PASS_IDS).toHaveLength(12);
    const oct = seasonPassItems('2026-10');
    expect(oct.goalfx.id).toBe('pass10');
    expect(oct.trail.name).toBe('Floodlights');
    const s = rich();
    for (const it of [oct.goalfx, oct.trail]) {
      expect(it.pass).toBe(true);
      expect(itemTier(it)).toBe('season');
      expect(owns(s, it.cat, it.id)).toBe(false);
      expect(buyItem(s, it.cat, it.id)).toMatchObject({ ok: false, reason: 'pass' });
    }
    expect(s.coins).toBe(100_000);
  });

  it('their ids (with digits) survive a save reload', () => {
    const shop = normalizeShop({ owned: ['goalfx:pass10', 'trail:pass03', 'ball:gold', 'junk'] });
    expect(shop.owned).toEqual(['goalfx:pass10', 'trail:pass03', 'ball:gold']);
  });
});

describe("today's deal", () => {
  it('one look a day at DEAL_OFF % off, kept for the day even after a purchase', () => {
    const s = rich();
    const d = dailyDeal(s, DAY)!;
    expect(d.item.pass).toBeUndefined();
    expect(d.price).toBe(Math.round((d.item.price * (100 - DEAL_OFF)) / 100 / 10) * 10);
    expect(priceOn(s, d.item, DAY)).toBe(d.price);
    expect(priceOn(s, d.item)).toBe(d.item.price);
    // Buying something else doesn't swap the deal; buying the deal look charges the deal price.
    const other = shopItems().find((i) => i.price > 0 && !i.pass && !(i.cat === d.item.cat && i.id === d.item.id))!;
    buyItem(s, other.cat, other.id, DAY);
    expect(dailyDeal(s, DAY)!.item.id).toBe(d.item.id);
    const before = s.coins;
    expect(buyItem(s, d.item.cat, d.item.id, DAY).ok).toBe(true);
    expect(before - s.coins).toBe(d.price);
    // Tomorrow: a new pick, from what isn't owned.
    const next = dailyDeal(s, '2026-10-13');
    expect(next && owns(s, next.item.cat, next.item.id)).toBe(false);
  });
});

describe('the Club Pass', () => {
  it('bought mid-month, it hands over every tier already reached; ~5,500 coins and four looks in all', () => {
    const totals = passTotals('2026-10');
    expect(totals.coins).toBeGreaterThanOrEqual(5500);
    // The month's player look (tier 5), sprint trail (10), premium kit (15) and goal explosion (20).
    expect(totals.items.map((i) => `${i.cat}:${i.id}`)).toEqual(['look:pass10', 'trail:pass10', 'kit:pass10', 'goalfx:pass10']);
    const s = rich(0);
    const season = seasonOf(s, OCT);
    season.xp = tierXp(12);
    expect(unclaimedPassTiers(season)).toEqual([]);
    expect(activatePass(s, OCT)).toBe(true);
    expect(activatePass(s, OCT)).toBe(false);
    expect(passActive(s, OCT)).toBe(true);
    expect(unclaimedPassTiers(season)).toHaveLength(12);
    // Tier 10 is the month's trail; tier 13 isn't reached yet.
    expect(claimPassTier(s, 10)).toEqual({ coins: 0, items: ['trail:pass10'] });
    expect(owns(s, 'trail', 'pass10')).toBe(true);
    expect(claimPassTier(s, 10)).toEqual({ coins: 0, items: [] });
    expect(claimPassTier(s, 13)).toEqual({ coins: 0, items: [] });
    const all = claimAllPass(s);
    expect(all.coins).toBe([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12].reduce((n, t) => n + passReward(t, '2026-10').coins, 0));
    expect(unclaimedPassTiers(season)).toEqual([]);
  });

  it('a new month ends it, and keeps what it reached: unclaimed coins carried, unclaimed looks claimable', () => {
    const s = rich(0);
    const season = seasonOf(s, OCT);
    season.xp = tierXp(21);
    activatePass(s, OCT);
    rollSeason(season, NOV);
    expect(season.pass).toBe(false);
    expect(season.passClaimed).toEqual([]);
    expect(season.carryItems.sort()).toEqual(['goalfx:pass10', 'kit:pass10', 'look:pass10', 'trail:pass10']);
    expect(season.carry!.coins).toBeGreaterThan(0);
    expect(claimCarryItems(s).sort()).toEqual(['goalfx:pass10', 'kit:pass10', 'look:pass10', 'trail:pass10']);
    expect(owns(s, 'goalfx', 'pass10')).toBe(true);
    expect(owns(s, 'kit', 'pass10')).toBe(true);
    expect(owns(s, 'look', 'pass10')).toBe(true);
    expect(shopOf(s).owned).toContain('trail:pass10');
  });

  it('is a store purchase: each month a new one, switched on by the payout', () => {
    const s = rich(0);
    const e = entryOf(PRODUCT_PASS)!;
    const g = applyPurchase(s, e, 'tx-pass-1');
    expect(g).toMatchObject({ pass: true, coins: 0 });
    expect(seasonOf(s).pass).toBe(true);
  });
});

describe('the Coin Doubler', () => {
  it('is a one-time store product that marks the save', () => {
    const s = rich(0);
    expect(coinDoubler(s)).toBe(false);
    const g = applyPurchase(s, entryOf(PRODUCT_DOUBLER)!, 'tx-d');
    expect(g).toMatchObject({ doubler: true, coins: 0 });
    expect(coinDoubler(s)).toBe(true);
    expect(applyPurchase(s, entryOf(PRODUCT_DOUBLER)!, 'tx-d2')).toBeNull();
    expect(CATALOGUE.find((x) => x.id === PRODUCT_DOUBLER)!.usd).toBe(4.99);
    expect(shopItem('ball', 'diamond')!.price).toBe(7500);
  });
});
