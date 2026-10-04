import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DECOR_SLOT_OF, defaultSave, exportSave, importSave, type SaveData } from '../src/core/save';
import { DECOR_BONUS, atmosphereOf } from '../src/meta/atmosphere';
import { GEM_PRICES, PASS_GEMS, addGems, gems, sumGems } from '../src/meta/gems';
import { standardCoinReward } from '../src/meta/matchEconomy';
import {
  SIGNATURE_SET_GEMS, activatePass, buyPassWithGems, buySignatureSet, claimAllPass, claimCarryItems, equipSignatureSet,
  passTotals, signatureMissing, signaturePrice, signatureSet, signatureSets, syncSeasonGems, syncSignatureEntitlements,
} from '../src/meta/pass';
import { defaultSeason, normalizeSeason, rollSeason, seasonOf, tierXp } from '../src/meta/season';
import { buyItem, equipItem, grantItem, itemKey, owns, scoutTokens, shopOf } from '../src/meta/shop';
import { GOAL_SHOWS, KICKOFF_SHOWS, STAGE_SHOWS, WIN_SHOWS } from '../src/render/fx/stadiumFx';
import { signatureMonth, SIGNATURE_PALETTES } from '../src/render/signatureStyle';
import { netColor } from '../src/render/stadiumStyle';

const OCT = new Date(2026, 9, 12, 12);
const NOV = new Date(2026, 10, 2, 12);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(OCT); });
afterEach(() => { vi.useRealTimers(); });

function wallet(amount = 600): SaveData {
  const s = defaultSave();
  s.gems!.balance = amount;
  return s;
}

describe('permanent gem identities', () => {
  it('offers twelve real six-piece collections, with ceremony handlers and matching styled nets', () => {
    const sets = signatureSets();
    expect(sets).toHaveLength(12);
    const keys = sets.flatMap((s) => s.items.map((it) => itemKey(it.cat, it.id)));
    expect(new Set(keys).size).toBe(72);
    for (const [month, set] of sets.entries()) {
      expect(set.items.map((it) => it.cat)).toEqual(['goalfx', 'trail', 'kit', 'look', 'decor', 'decor']);
      for (const it of set.items) {
        expect(it.pass).toBe(true);
        expect(buyItem(wallet(), it.cat, it.id)).toMatchObject({ ok: false, reason: 'pass' });
      }
      const net = `net${set.id}`;
      const entry = `kick${set.id}`;
      expect(DECOR_SLOT_OF[net as keyof typeof DECOR_SLOT_OF]).toBe('net');
      expect(DECOR_SLOT_OF[entry as keyof typeof DECOR_SLOT_OF]).toBe('kickoff');
      expect(signatureMonth(net)).toBe(month);
      expect(signatureMonth(entry)).toBe(month);
      expect(SIGNATURE_PALETTES[month]).toContain(netColor(net, 0xffffff, 0, 0, 1, 1));
      for (const shows of [KICKOFF_SHOWS, GOAL_SHOWS, WIN_SHOWS, STAGE_SHOWS]) expect(shows[entry]?.run).toBeTypeOf('function');
      expect(DECOR_BONUS[net as keyof typeof DECOR_BONUS]).toEqual({});
      expect(DECOR_BONUS[entry as keyof typeof DECOR_BONUS]).toEqual({});
    }
    expect(signatureMonth('pass00')).toBe(-1);
    expect(signatureMonth('netpass13')).toBe(-1);
  });

  it('shows and charges a guaranteed price, with no charge for already owned pieces', () => {
    const s = wallet();
    const set = signatureSet('pass03')!;
    for (const it of set.items.slice(0, 3)) grantItem(s, it.cat, it.id);
    expect(signatureMissing(s, set)).toHaveLength(3);
    expect(signaturePrice(s, set)).toBe(300);
    const coins = s.coins;
    const tickets = scoutTokens(s);
    const result = buySignatureSet(s, set.id, OCT);
    expect(result).toMatchObject({ ok: true, price: 300, gems: 300 });
    expect(result.items?.map((it) => itemKey(it.cat, it.id))).toEqual(['look:pass03', 'decor:netpass03', 'decor:kickpass03']);
    expect(signatureMissing(s, set)).toEqual([]);
    expect(s.coins).toBe(coins);
    expect(scoutTokens(s)).toBe(tickets);
    const after = exportSave(s);
    expect(buySignatureSet(s, set.id, OCT)).toMatchObject({ ok: false, reason: 'maxed' });
    expect(exportSave(s)).toBe(after);
  });

  it('refuses insufficient gems, unknown themes and the current pass without mutating the wallet or inventory', () => {
    const s = wallet(SIGNATURE_SET_GEMS - 1);
    seasonOf(s, OCT);
    shopOf(s);
    const before = exportSave(s);
    expect(buySignatureSet(s, 'pass03', OCT)).toMatchObject({ ok: false, reason: 'no-gems', short: 1 });
    expect(buySignatureSet(s, 'pass10', OCT)).toMatchObject({ ok: false, reason: 'unknown' });
    expect(buySignatureSet(s, 'pass99', OCT)).toMatchObject({ ok: false, reason: 'unknown' });
    expect(exportSave(s)).toBe(before);
  });

  it('earned gems buy the identical identity as store gems; nothing is a random purchase', () => {
    const a = wallet(0);
    const b = wallet(0);
    addGems(a, SIGNATURE_SET_GEMS, 'weekly');
    addGems(b, SIGNATURE_SET_GEMS, 'iap:bl.gems.600');
    expect(buySignatureSet(a, 'pass04', OCT).ok).toBe(true);
    expect(buySignatureSet(b, 'pass04', OCT).ok).toBe(true);
    expect(a.shop!.owned).toEqual(b.shop!.owned);
    expect(gems(a)).toBe(0);
    expect(gems(b)).toBe(0);
  });

  it('equips all six into their actual match slots and preserves the ball, crest, progress and currency', () => {
    const s = wallet();
    grantItem(s, 'ball', 'gold');
    equipItem(s, 'ball', 'gold');
    grantItem(s, 'decor', 'mowchecks');
    equipItem(s, 'decor', 'mowchecks');
    const unchanged = { ball: s.settings.ballSkin, coins: s.coins, progress: JSON.stringify(s.progress), record: JSON.stringify(s.record) };
    const atmosphere = atmosphereOf(s);
    expect(equipSignatureSet(s, 'pass01')).toBe(false);
    expect(buySignatureSet(s, 'pass01', OCT).ok).toBe(true);
    expect(equipSignatureSet(s, 'pass01')).toBe(true);
    expect(s.settings).toMatchObject({ kit: 'pass01', goalFx: 'pass01', trail: 'pass01', decor: { pitch: 'mowchecks', net: 'netpass01', kickoff: 'kickpass01' } });
    expect(Object.values(s.settings.looks ?? {})).toContain('pass01');
    expect(s.settings.ballSkin).toBe(unchanged.ball);
    expect(s.coins).toBe(unchanged.coins);
    expect(JSON.stringify(s.progress)).toBe(unchanged.progress);
    expect(JSON.stringify(s.record)).toBe(unchanged.record);
    expect(atmosphereOf(s)).toEqual(atmosphere);
    expect(equipSignatureSet(s, 'pass01')).toBe(true);
  });

  it('keeps existing purchased goods, Scout Tickets and new equipped pieces through an actual exported save import', () => {
    const s = wallet();
    s.shop!.tokens = 17;
    grantItem(s, 'decor', 'mascotbear');
    grantItem(s, 'kit', 'goldfoil');
    buySignatureSet(s, 'pass05', OCT);
    equipSignatureSet(s, 'pass05');
    const loaded = importSave(exportSave(s))!;
    expect(loaded.shop!.owned).toEqual(s.shop!.owned);
    expect(loaded.shop!.tokens).toBe(17);
    expect(loaded.settings.decor).toEqual(s.settings.decor);
    expect(loaded.settings.looks).toEqual(s.settings.looks);
    expect(signatureMissing(loaded, signatureSet('pass05')!)).toEqual([]);
    expect(equipSignatureSet(loaded, 'pass05')).toBe(true);
  });
});

describe('Club Pass signature receipts and legacy saves', () => {
  it('gives the ceremony immediately at zero XP, while keeping all prior coin and gem payouts', () => {
    const s = wallet(GEM_PRICES.clubPass);
    expect(buyPassWithGems(s, OCT).ok).toBe(true);
    expect(owns(s, 'decor', 'kickpass10')).toBe(true);
    expect(owns(s, 'decor', 'netpass10')).toBe(false);
    expect(claimAllPass(s)).toEqual({ coins: 0, items: [] });
    const totals = passTotals('2026-10');
    expect(totals.coins).toBe(5560);
    expect(totals.gems).toBe(sumGems(PASS_GEMS));
    expect(totals.items).toHaveLength(6);
    s.season!.xp = tierXp(30);
    const all = claimAllPass(s);
    expect(all.coins).toBe(5560);
    expect(all.items).toHaveLength(5); // Ceremony already granted on activation.
    expect(owns(s, 'decor', 'netpass10')).toBe(true);
    expect(syncSeasonGems(s)).toBe(sumGems(PASS_GEMS));
    expect(syncSeasonGems(s)).toBe(0);
    expect(claimAllPass(s)).toEqual({ coins: 0, items: [] });
  });

  it('backfills the welcome and already-claimed tier-25 pieces once without repeating money rewards', () => {
    const s = wallet();
    s.season = { ...defaultSeason(OCT), pass: true, xp: tierXp(25), passClaimed: [1, 25] };
    const walletBefore = JSON.stringify(s.gems);
    const coins = s.coins;
    expect(syncSignatureEntitlements(s)).toEqual(['decor:kickpass10', 'decor:netpass10']);
    expect(syncSignatureEntitlements(s)).toEqual([]);
    expect(JSON.stringify(s.gems)).toBe(walletBefore);
    expect(s.coins).toBe(coins);
  });

  it('recovers older monthly ownership and durable tier-28 receipts after a season has ended', () => {
    const s = wallet();
    grantItem(s, 'kit', 'pass03');
    s.gems!.claimed.push('season:2026-04:p28');
    const before = gems(s);
    expect(syncSignatureEntitlements(s).sort()).toEqual(['decor:kickpass03', 'decor:kickpass04', 'decor:netpass04']);
    expect(gems(s)).toBe(before);
    expect(owns(s, 'kit', 'pass03')).toBe(true);
    expect(syncSignatureEntitlements(s)).toEqual([]);
  });

  it('keeps new items and old claimed-tier entitlements on rollover and save normalization', () => {
    const s = wallet();
    s.season = { ...defaultSeason(OCT), pass: true, xp: tierXp(25), passClaimed: Array.from({ length: 25 }, (_, i) => i + 1) };
    rollSeason(s.season, NOV);
    expect(s.season.carryItems).toEqual(['decor:kickpass10', 'decor:netpass10']);
    s.season = normalizeSeason(s.season, NOV);
    expect(claimCarryItems(s)).toEqual(['decor:kickpass10', 'decor:netpass10']);
    expect(claimCarryItems(s)).toEqual([]);
    expect(s.coins).toBe(500);
    const raw = { ...defaultSeason(OCT), pass: true, xp: tierXp(25), passClaimed: [1, 25] };
    const rolled = normalizeSeason(raw, NOV);
    expect(rolled.carryItems).toContain('decor:netpass10');
    expect(rolled.carryItems).toContain('decor:kickpass10');
  });

  it('preserves the immediate welcome reward when a zero-XP pass rolls to the next month', () => {
    const s = wallet();
    activatePass(s, OCT);
    rollSeason(s.season!, NOV);
    expect(s.season!.carryItems).toEqual(['decor:kickpass10']);
    expect(claimCarryItems(s)).toEqual([]); // Already owned, never paid again.
    expect(owns(s, 'decor', 'kickpass10')).toBe(true);
  });
});

describe('coin pacing rewards football results', () => {
  it('keeps every completed result worthwhile with a modest three-goal cap', () => {
    expect(standardCoinReward(0, 1, 1)).toEqual({ coins: 35, label: 'MATCH FEE' });
    expect(standardCoinReward(0, 0, 1).coins).toBe(60);
    expect(standardCoinReward(1, 0, 1).coins).toBe(122);
    expect(standardCoinReward(2, 0, 1).coins).toBe(134);
    expect(standardCoinReward(3, 0, 1).coins).toBe(146);
    expect(standardCoinReward(20, 0, 1).coins).toBe(146);
    expect(standardCoinReward(4, 4, 1).coins).toBe(96);
  });

  it('rewards harder difficulty without allowing invalid scores to poison the wallet', () => {
    const rewards = [0, 1, 2, 3].map((d) => standardCoinReward(2, 0, d).coins);
    expect(rewards).toEqual([107, 134, 168, 194]);
    expect(standardCoinReward(Number.NaN, Number.POSITIVE_INFINITY, -1).coins).toBe(60);
    expect(standardCoinReward(-10, 1, 1).coins).toBe(35);
    expect(standardCoinReward(1.8, 0, 1).coins).toBe(122);
  });
});
