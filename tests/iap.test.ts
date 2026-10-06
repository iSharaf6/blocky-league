import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IAP_APPLIED_MAX, defaultSave, importSave, loadSave, normalizeIap, type SaveData } from '../src/core/save';
import { localDay } from '../src/core/day';
import { selectJourney } from '../src/meta/season';
import { buyPassWithGems } from '../src/meta/pass';
import { WELCOME_GEMS, gems } from '../src/meta/gems';
import { owns, FREE_AD_COINS, FREE_AD_DAILY_CAP, claimFreeAd, freeAdsLeft } from '../src/meta/shop';
import { gemPackBadge } from '../src/ui/storeOffers';
import type { PurchaseRejection } from '../src/platform/purchaseEvents';
import { Ads } from '../src/platform/ads';
import { isSmall, normalizeCloud } from '../src/platform/cloud';
import {
  CATALOGUE, FIRST_BUY_MULT, MAX_PRICE_USD, PRODUCT_DOUBLER, PRODUCT_NOADS, PRODUCT_PASS, PRODUCT_PRO, PRODUCT_STARTER, Iap, adFree, applyPurchase, coinDoubler,
  coinsOf, entryOf, gemsOf, isGemPack, proOffered, proWorthUsd,
  type CdvPurchaseGlobal, type CdvTransaction, type IapGrant,
} from '../src/platform/iap';

// ------------------------------------------------------------------ fixtures

const KEY = 'blocky-league-save-v1';

function stubStorage(stored?: unknown): Map<string, string> {
  const data = new Map<string, string>();
  if (stored !== undefined) data.set(KEY, JSON.stringify(stored));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  });
  return data;
}

/** The dev store, bound to a fresh save. */
async function devStore(search = '?iap=dev'): Promise<{ iap: Iap; save: SaveData; persist: ReturnType<typeof vi.fn<() => void>> }> {
  vi.stubEnv('DEV', true);
  vi.stubGlobal('location', { search });
  const save = defaultSave();
  const persist = vi.fn<() => void>();
  const iap = new Iap();
  iap.bind({ save, persist });
  await iap.init();
  return { iap, save, persist };
}

beforeEach(() => {
  stubStorage();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

// ------------------------------------------------------------------ the catalogue and the economy

describe('catalogue and economy', () => {
  it('sells the ten products under their stable ids, bonuses included (economy v3: money buys gems, never coins)', () => {
    expect(CATALOGUE.map((e) => e.id)).toEqual([
      'bl.gems.100', 'bl.gems.300', 'bl.gems.500', 'bl.gems.1000', 'bl.gems.2000', 'bl.starter', 'bl.noads', 'bl.pass', 'bl.doubler', 'bl.pro',
    ]);
    expect(CATALOGUE.map((e) => e.kind)).toEqual([
      'consumable', 'consumable', 'consumable', 'consumable', 'consumable', 'non-consumable', 'non-consumable', 'consumable', 'non-consumable', 'non-consumable',
    ]);
    expect(CATALOGUE.filter(isGemPack).map(gemsOf)).toEqual([100, 330, 600, 1300, 3000]);
    // No pack sells coins: coins come from playing, or from swapping gems at a shown rate (meta/gems.ts COIN_OFFERS).
    expect(CATALOGUE.filter(isGemPack).every((e) => e.coins === 0)).toBe(true);
    // The Club Pass is bought per permanent Journey (consumable) and is no gem pack; the Coin Doubler is for good.
    expect(entryOf(PRODUCT_PASS)!.pass).toBe(true);
    expect(isGemPack(entryOf(PRODUCT_PASS)!)).toBe(false);
    expect(entryOf(PRODUCT_DOUBLER)!.doubler).toBe(true);
    expect(coinsOf(entryOf(PRODUCT_STARTER)!)).toBe(2000);
    expect(gemsOf(entryOf(PRODUCT_STARTER)!)).toBe(150);
    expect(entryOf(PRODUCT_STARTER)!.items).toEqual([{ cat: 'ball', id: 'gold' }]);
    expect(entryOf(PRODUCT_NOADS)!.noAds).toBe(true);
  });

  it('keeps the packs honest: the bigger the pack the better the rate, and nothing costs more than $19.99', () => {
    const packs = CATALOGUE.filter(isGemPack);
    const perDollar = packs.map((e) => gemsOf(e) / e.usd);
    for (let i = 1; i < perDollar.length; i++) expect(perDollar[i]).toBeGreaterThan(perDollar[i - 1]);
    // Prices are only the suggestions for the store consoles; the shop shows the store's own string.
    expect(entryOf('bl.gems.100')!.usd).toBe(0.99);
    // Children play this: no pack above the ceiling.
    expect(MAX_PRICE_USD).toBe(19.99);
    for (const e of CATALOGUE) expect(e.usd, e.id).toBeLessThanOrEqual(MAX_PRICE_USD);
  });

  it('keeps pack labels truthful when first-buy bonuses are mixed', async () => {
    const { iap } = await devStore();
    const before = iap.products().find((p) => p.id === 'bl.gems.2000')!;
    expect(gemPackBadge(before)).toBe('FIRST BUY X2');
    iap.deliver('bl.gems.2000', 'largest-first-buy', false);
    const largest = iap.products().find((p) => p.id === 'bl.gems.2000')!;
    const small = iap.products().find((p) => p.id === 'bl.gems.100')!;
    // A fresh small pack now has a better actual rate than the largest repeat purchase.
    expect(small.gems * FIRST_BUY_MULT / entryOf(small.id)!.usd).toBeGreaterThan(largest.gems / entryOf(largest.id)!.usd);
    expect(gemPackBadge(largest)).toBe('LARGEST PACK');
    expect(gemPackBadge(small)).toBe('FIRST BUY X2');
    iap.deliver('bl.gems.500', 'middle-first-buy', false);
    const middle = iap.products().find((p) => p.id === 'bl.gems.500')!;
    expect(gemPackBadge(middle)).toBe('BONUS GEMS');
    expect(gemPackBadge(middle)).not.toContain('POPULAR');
  });

  it('the PRO bundle is NO ADS, the Coin Doubler and 600 gems for less than they cost one by one, bought once', async () => {
    const pro = entryOf(PRODUCT_PRO)!;
    expect(pro).toMatchObject({ kind: 'non-consumable', noAds: true, doubler: true, gems: 600, usd: 9.99 });
    // Its parts one by one: NO ADS 3.99, the Coin Doubler 4.99 and the pack that hands over 600 gems 4.99.
    expect(proWorthUsd()).toBe(13.97);
    expect(pro.usd).toBeLessThan(proWorthUsd());
    const { iap, save } = await devStore();
    expect(proOffered(save)).toBe(true);
    expect(await iap.buy(PRODUCT_PRO)).toBe('ok');
    expect(adFree(save)).toBe(true);
    expect(coinDoubler(save)).toBe(true);
    expect(gems(save)).toBe(WELCOME_GEMS + 600);
    expect(proOffered(save)).toBe(false);
    // Its parts read OWNED and can't be bought again on top.
    expect(iap.products().find((p) => p.id === PRODUCT_NOADS)!.owned).toBe(true);
    expect(iap.products().find((p) => p.id === PRODUCT_DOUBLER)!.owned).toBe(true);
    expect(await iap.buy(PRODUCT_NOADS)).toBe('failed');
    expect(await iap.buy(PRODUCT_DOUBLER)).toBe('failed');
    expect(await iap.buy(PRODUCT_PRO)).toBe('failed');
    expect(gems(save)).toBe(WELCOME_GEMS + 600);
  });

  it('the PRO bundle is not offered once one of its parts was bought on its own (it is priced against both)', async () => {
    const { iap, save } = await devStore();
    await iap.buy(PRODUCT_NOADS);
    expect(proOffered(save)).toBe(false);
  });
});

// ------------------------------------------------------------------ paying out once

describe('consumable gem packs', () => {
  it('credit the right gems once, even if the store delivers the transaction twice (the first buy of a pack doubled)', async () => {
    const { iap, save, persist } = await devStore();
    const grants: IapGrant[] = [];
    iap.onGrant((g) => grants.push(g));
    const start = gems(save);
    const coins = save.coins;
    expect(iap.products().find((p) => p.id === 'bl.gems.300')!.firstBonus).toBe(true);
    expect(iap.deliver('bl.gems.300', 'tx-1', false)).toBe('applied');
    expect(gems(save)).toBe(start + 330 * FIRST_BUY_MULT);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(iap.deliver('bl.gems.300', 'tx-1', false)).toBe('duplicate');
    expect(gems(save)).toBe(start + 330 * FIRST_BUY_MULT);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(grants).toEqual([{ productId: 'bl.gems.300', coins: 0, gems: 660, items: [], noAds: false, firstBonus: 330, pass: false, doubler: false, restored: false }]);
    // A different transaction is a different purchase, and the same pack can be bought again: at its normal size now.
    expect(iap.products().find((p) => p.id === 'bl.gems.300')!.firstBonus).toBe(false);
    expect(iap.deliver('bl.gems.300', 'tx-2', false)).toBe('applied');
    expect(gems(save)).toBe(start + 660 + 330);
    // A gem pack never touches the coins, and what it bought counts as bought (not earned).
    expect(save.coins).toBe(coins);
    expect(save.gems!.bought).toBe(990);
  });

  it('are bought through the store and never marked as owned', async () => {
    const { iap, save } = await devStore();
    const start = gems(save);
    expect(iap.available).toBe(true);
    expect(await iap.buy('bl.gems.100')).toBe('ok');
    expect(await iap.buy('bl.gems.100')).toBe('ok');
    // (The first buy of a pack pays double, once.)
    expect(gems(save)).toBe(start + 200 + 100);
    expect(save.iap!.owned).toEqual([]);
    expect(iap.products().find((p) => p.id === 'bl.gems.100')!.owned).toBe(false);
  });

  it('never pay for an unknown product, or before there is a save to pay into', async () => {
    const { iap, save } = await devStore();
    expect(iap.deliver('bl.gems.7', 'tx-9', false)).toBe('unknown');
    // (The coin packs of economy v2 are gone: their ids pay nothing.)
    expect(iap.deliver('bl.coins.500', 'tx-9', false)).toBe('unknown');
    expect(save.coins).toBe(defaultSave().coins);
    expect(gems(save)).toBe(WELCOME_GEMS);
    expect(new Iap().deliver('bl.gems.100', 'tx-1', false)).toBe('unbound');
  });

  it('keep only the newest transaction ids, so the save stays small', () => {
    const save = defaultSave();
    const e = entryOf('bl.gems.100')!;
    for (let i = 0; i < IAP_APPLIED_MAX + 50; i++) applyPurchase(save, e, `tx-${i}`);
    expect(save.iap!.applied).toHaveLength(IAP_APPLIED_MAX);
    expect(save.iap!.applied[IAP_APPLIED_MAX - 1]).toBe(`tx-${IAP_APPLIED_MAX + 49}|bl.gems.100`);
    expect(save.iap!.applied).not.toContain('tx-0|bl.gems.100');
  });
});

describe('the Starter Pack', () => {
  it('is one time only, and hands over its coins, its gems and the Gold ball', async () => {
    const { iap, save } = await devStore();
    const start = save.coins;
    expect(save.shop!.owned).not.toContain('ball:gold');
    expect(await iap.buy(PRODUCT_STARTER)).toBe('ok');
    expect(save.coins).toBe(start + 2000);
    expect(gems(save)).toBe(WELCOME_GEMS + 150);
    expect(save.shop!.owned).toContain('ball:gold');
    expect(owns(save, 'ball', 'gold')).toBe(true);
    expect(save.iap!.owned).toEqual([PRODUCT_STARTER]);
    expect(iap.products().find((p) => p.id === PRODUCT_STARTER)!.owned).toBe(true);
    // Buyable once: the shop hides it, and the store would refuse it anyway.
    expect(await iap.buy(PRODUCT_STARTER)).toBe('failed');
    expect(save.coins).toBe(start + 2000);
    // A restore brings it back under a new transaction id: still paid once.
    expect(iap.deliver(PRODUCT_STARTER, 'another-id', true)).toBe('duplicate');
    expect(save.coins).toBe(start + 2000);
    expect(gems(save)).toBe(WELCOME_GEMS + 150);
  });
});

describe('NO ADS', () => {
  function portal() {
    vi.stubEnv('VITE_PORTAL', 'crazygames');
    vi.stubGlobal('location', { search: '' });
    vi.stubGlobal('document', {
      createElement: () => ({}),
      head: { appendChild: (s: { onload?: () => void }) => void Promise.resolve().then(() => s.onload?.()) },
    });
    const requestAd = vi.fn((_type: string, cb: { adStarted?: () => void; adFinished?: () => void }) => {
      cb.adStarted?.();
      cb.adFinished?.();
    });
    vi.stubGlobal('window', {
      CrazyGames: {
        SDK: {
          init: async () => {}, environment: 'local',
          game: {
            gameplayStart() {}, gameplayStop() {}, happytime() {}, loadingStart() {}, loadingStop() {}, settings: { muteAudio: false, disableChat: false },
            addSettingsChangeListener() {},
          },
          ad: { requestAd, hasAdblock: async () => false },
        },
      },
    });
    return requestAd;
  }

  it('is owned once bought, kept on a save reload, and flips adFree', async () => {
    const { iap, save } = await devStore();
    expect(adFree(save)).toBe(false);
    expect(await iap.buy(PRODUCT_NOADS)).toBe('ok');
    expect(adFree(save)).toBe(true);
    expect(adFree(importSave(JSON.parse(JSON.stringify(save)))!)).toBe(true);
    expect(await iap.buy(PRODUCT_NOADS)).toBe('failed');
  });

  it('stops the interstitial ads but never the rewarded ones the player asks for', async () => {
    vi.useFakeTimers();
    const requestAd = portal();
    const save = defaultSave();
    const ads = new Ads();
    ads.adFree = () => adFree(save);
    await ads.init();
    expect(ads.rewardedAvailable).toBe(true);
    await ads.midgame();
    expect(requestAd).toHaveBeenLastCalledWith('midgame', expect.anything());
    expect(requestAd).toHaveBeenCalledTimes(1);

    save.iap!.owned.push(PRODUCT_NOADS);
    await ads.midgame();
    expect(requestAd).toHaveBeenCalledTimes(1);
    expect(await ads.rewarded()).toBe(true);
    expect(requestAd).toHaveBeenCalledTimes(2);
    expect(requestAd).toHaveBeenLastCalledWith('rewarded', expect.anything());
    expect(ads.rewardedAvailable).toBe(true);
  });
});

// ------------------------------------------------------------------ restoring

describe('restore purchases', () => {
  it('hands back the one-time products only, never gem packs', async () => {
    const { iap, save } = await devStore();
    await iap.buy('bl.gems.1000');
    await iap.buy(PRODUCT_STARTER);
    await iap.buy(PRODUCT_NOADS);

    // A new device: a fresh save, the same store account (the dev store keeps its ledger in storage).
    const fresh = defaultSave();
    const again = new Iap();
    again.bind({ save: fresh, persist: vi.fn() });
    await again.init();
    expect(adFree(fresh)).toBe(false);
    const r = await again.restore();
    expect(r.ok).toBe(true);
    expect([...r.restored].sort()).toEqual([PRODUCT_NOADS, PRODUCT_STARTER].sort());
    expect(adFree(fresh)).toBe(true);
    expect(owns(fresh, 'ball', 'gold')).toBe(true);
    // No coins or gems: the Starter Pack's were paid on the first device (a reinstall is no currency tap); the Gold ball is back.
    expect(fresh.coins).toBe(defaultSave().coins);
    expect(gems(fresh)).toBe(WELCOME_GEMS);

    // Restoring again changes nothing and says so.
    const twice = await again.restore();
    expect(twice).toEqual({ ok: true, restored: [] });
    expect(fresh.coins).toBe(defaultSave().coins);
    expect(gems(fresh)).toBe(WELCOME_GEMS);
    // (The 1000 pack's first buy paid double; the Starter Pack its coins and gems.)
    expect(save.coins).toBe(defaultSave().coins + 2000);
    expect(gems(save)).toBe(WELCOME_GEMS + 1300 * FIRST_BUY_MULT + 150);
  });

  it('reports a store that cannot be reached, and nothing without one', async () => {
    const none = new Iap();
    expect(await none.restore()).toEqual({ ok: false, restored: [] });
  });
});

// ------------------------------------------------------------------ which provider

describe('providers', () => {
  it('is the dev store only in a dev server with ?iap=dev', async () => {
    const { iap } = await devStore();
    expect(iap.provider).toBe('dev');
    expect(iap.available).toBe(true);
    expect(iap.products().map((p) => p.id)).toEqual(CATALOGUE.map((e) => e.id));
    expect(iap.products()[0].price).toBe('$0.99');
  });

  it('is none on the plain web, in a production build, and without the flag', async () => {
    expect((await devStore('')).iap.provider).toBe('none');
    expect((await devStore('?iap=prod')).iap.available).toBe(false);
    vi.stubEnv('DEV', false);
    vi.stubGlobal('location', { search: '?iap=dev' });
    const prod = new Iap();
    prod.bind({ save: defaultSave(), persist: vi.fn() });
    await prod.init();
    expect(prod.provider).toBe('none');
    expect(prod.available).toBe(false);
    expect(prod.products()).toEqual([]);
    expect(await prod.buy('bl.gems.100')).toBe('failed');
  });

  it.each(['crazygames', 'poki'])('is none on %s, whatever else is on the page', async (portal) => {
    vi.stubEnv('VITE_PORTAL', portal);
    vi.stubEnv('DEV', true);
    vi.stubGlobal('location', { search: '?iap=dev' });
    // Even a native store sitting on the page (it never is on a portal) is left alone.
    vi.stubGlobal('window', { CdvPurchase: fakeCdv().global });
    const save = defaultSave();
    const iap = new Iap();
    iap.bind({ save, persist: vi.fn() });
    await iap.init();
    expect(iap.provider).toBe('none');
    expect(iap.available).toBe(false);
    expect(iap.products()).toEqual([]);
    expect(await iap.buy('bl.gems.100')).toBe('failed');
    expect(save.coins).toBe(defaultSave().coins);
    expect(gems(save)).toBe(WELCOME_GEMS);
  });

  it('is none in the dev server on ?portal=, and on itch and the website (nothing to detect)', async () => {
    expect((await devStore('?iap=dev&portal=poki')).iap.provider).toBe('none');
    vi.stubEnv('VITE_PORTAL', 'none');
    vi.stubEnv('DEV', false);
    vi.stubGlobal('location', { search: '' });
    const web = new Iap();
    web.bind({ save: defaultSave(), persist: vi.fn() });
    await web.init();
    expect(web.provider).toBe('none');
  });
});

// ------------------------------------------------------------------ the native store (a stand-in for cordova-plugin-purchase)

function fakeCdv(opts: { owned?: string[]; cancel?: boolean } = {}) {
  let approved: ((t: CdvTransaction) => void) | null = null;
  const finishes: ReturnType<typeof vi.fn>[] = [];
  const owned = new Set(opts.owned ?? []);
  const tx = (id: string, transactionId: string): CdvTransaction => {
    const finish = vi.fn(async () => {});
    finishes.push(finish);
    return { transactionId, products: [{ id }], finish };
  };
  const when = { approved: (cb: (t: CdvTransaction) => void) => { approved = cb; return when; }, verified: () => when, finished: () => when };
  const store = {
    register: vi.fn(),
    initialize: vi.fn(async () => []),
    when: () => when,
    get: (id: string) => ({
      id,
      pricing: { price: `EUR ${(entryOf(id)!.usd).toFixed(2)}` },
      getOffer: () => ({
        id: 'offer',
        pricingPhases: [],
        order: async () => {
          if (opts.cancel) return { code: 6777006, message: 'Payment cancelled' };
          queueMicrotask(() => approved?.(tx(id, `store-${id}-${finishes.length}`)));
          return undefined;
        },
      }),
    }),
    owned: (id: string) => owned.has(id),
    restorePurchases: vi.fn(async () => {
      for (const id of owned) approved?.(tx(id, `restored-${id}`));
      return undefined;
    }),
    defaultPlatform: () => 'ios-appstore',
    error: vi.fn(),
  };
  const global: CdvPurchaseGlobal = {
    store,
    ProductType: { CONSUMABLE: 'consumable', NON_CONSUMABLE: 'non consumable' },
    Platform: { APPLE_APPSTORE: 'ios-appstore', GOOGLE_PLAY: 'android-playstore' },
    ErrorCode: { PAYMENT_CANCELLED: 6777006 },
  };
  return { global, store, finishes, redeliver: (id: string, transactionId: string) => approved?.(tx(id, transactionId)) };
}

async function nativeStore(cdv: ReturnType<typeof fakeCdv>) {
  vi.stubEnv('DEV', false);
  vi.stubGlobal('location', { search: '' });
  vi.stubGlobal('window', { CdvPurchase: cdv.global });
  const save = defaultSave();
  const persist = vi.fn<() => boolean>(() => true);
  const iap = new Iap();
  iap.bind({ save, persist });
  await iap.init();
  return { iap, save, persist };
}

describe('the native store', () => {
  it('is found by feature detection, registers every product and shows the store prices', async () => {
    const cdv = fakeCdv();
    const { iap } = await nativeStore(cdv);
    expect(iap.provider).toBe('native');
    expect(iap.available).toBe(true);
    const registered = (cdv.store.register.mock.calls[0][0] as { id: string; type: string; platform: string }[]);
    expect(new Set(registered.map((p) => p.id))).toEqual(new Set(CATALOGUE.map((e) => e.id)));
    expect(registered.filter((p) => p.platform === 'ios-appstore').find((p) => p.id === PRODUCT_NOADS)!.type).toBe('non consumable');
    expect(registered.find((p) => p.id === 'bl.gems.100')!.type).toBe('consumable');
    expect(cdv.store.initialize).toHaveBeenCalledWith(['ios-appstore']);
    expect(iap.products().find((p) => p.id === 'bl.gems.100')!.price).toBe('EUR 0.99');
  });

  it('pays a purchase out, saves, and only then finishes it; a second delivery pays nothing', async () => {
    const cdv = fakeCdv();
    const { iap, save, persist } = await nativeStore(cdv);
    const start = gems(save);
    expect(await iap.buy('bl.gems.100')).toBe('ok');
    expect(gems(save)).toBe(start + 100 * FIRST_BUY_MULT);
    expect(cdv.finishes).toHaveLength(1);
    expect(cdv.finishes[0]).toHaveBeenCalledTimes(1);
    // Saved before the store was told: a crash in between only re-delivers a purchase we recognise.
    expect(persist.mock.invocationCallOrder[0]).toBeLessThan(cdv.finishes[0].mock.invocationCallOrder[0]);

    const txId = save.iap!.applied[0].split('|')[0];
    cdv.redeliver('bl.gems.100', txId);
    await Promise.resolve();
    expect(gems(save)).toBe(start + 100 * FIRST_BUY_MULT);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(cdv.finishes[1]).toHaveBeenCalledTimes(1); // finished again: harmless, and it clears the store's queue
  });

  it('calls a backed out purchase cancelled and charges nothing', async () => {
    const cdv = fakeCdv({ cancel: true });
    const { iap, save } = await nativeStore(cdv);
    const start = gems(save);
    expect(await iap.buy('bl.gems.1000')).toBe('cancelled');
    expect(gems(save)).toBe(start);
    expect(cdv.finishes).toHaveLength(0);
  });

  it('calls a purchase the store never confirms pending, and still pays it out if it arrives later', async () => {
    vi.useFakeTimers();
    const cdv = fakeCdv();
    cdv.store.get = (id: string) => ({
      id, pricing: { price: '$0.99' },
      getOffer: () => ({ id: 'o', order: async () => undefined }),
    }) as ReturnType<typeof cdv.store.get>;
    const { iap, save } = await nativeStore(cdv);
    const grants: IapGrant[] = [];
    iap.onGrant((g) => grants.push(g));
    const start = gems(save);
    const result = iap.buy('bl.gems.100');
    await vi.advanceTimersByTimeAsync(61_000);
    expect(await result).toBe('pending');
    expect(gems(save)).toBe(start);
    cdv.redeliver('bl.gems.100', 'late-1');
    await Promise.resolve();
    expect(gems(save)).toBe(start + 100 * FIRST_BUY_MULT);
    expect(grants).toHaveLength(1);
  });

  it('restores the one-time products the store says the account owns, not gem packs', async () => {
    vi.useFakeTimers();
    const cdv = fakeCdv({ owned: [PRODUCT_STARTER, PRODUCT_NOADS] });
    const { iap, save } = await nativeStore(cdv);
    // (init already handed over what the store listed as owned.)
    expect(adFree(save)).toBe(true);
    expect(owns(save, 'ball', 'gold')).toBe(true);
    expect(save.coins).toBe(defaultSave().coins);
    const p = iap.restore();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await p).toEqual({ ok: true, restored: [] });
    expect(save.coins).toBe(defaultSave().coins);
  });
});

// ------------------------------------------------------------------ free coins from ads

describe('free coins from rewarded ads', () => {
  it('pay 75 coins an ad, at most 5 a day, and start again the next day', () => {
    const save = defaultSave();
    const start = save.coins;
    const day = '2026-10-02';
    expect(FREE_AD_COINS).toBe(75);
    expect(FREE_AD_DAILY_CAP).toBe(5);
    expect(freeAdsLeft(save, day)).toBe(5);
    for (let i = 1; i <= 5; i++) {
      const r = claimFreeAd(save, day);
      expect(r).toEqual({ ok: true, coins: start + 75 * i, left: 5 - i });
    }
    expect(freeAdsLeft(save, day)).toBe(0);
    expect(claimFreeAd(save, day)).toEqual({ ok: false, reason: 'cap' });
    expect(save.coins).toBe(start + 375);

    // The count is in the save, so a reload (or a second tab) cannot reset it.
    const reloaded = importSave(JSON.parse(JSON.stringify(save)))!;
    expect(freeAdsLeft(reloaded, day)).toBe(0);
    expect(claimFreeAd(reloaded, day).ok).toBe(false);

    // Tomorrow is a fresh five.
    expect(freeAdsLeft(save, '2026-10-03')).toBe(5);
    expect(claimFreeAd(save, '2026-10-03')).toEqual({ ok: true, coins: start + 450, left: 4 });
    expect(freeAdsLeft(save, '2026-10-03')).toBe(4);
  });

  it('does not reset rewarded-coin caps by alternating older dates, including after reloading', () => {
    const save = defaultSave();
    for (let i = 0; i < FREE_AD_DAILY_CAP; i++) claimFreeAd(save, '2026-10-03');
    const earned = save.coins;
    for (const day of ['2026-10-02', '2026-10-03', '2026-09-30', '']) {
      expect(freeAdsLeft(save, day)).toBe(0);
      expect(claimFreeAd(save, day)).toEqual({ ok: false, reason: 'cap' });
      expect(save.coins).toBe(earned);
      expect(save.iap!.freeAds).toEqual({ day: '2026-10-03', count: FREE_AD_DAILY_CAP });
    }
    const reloaded = importSave(JSON.parse(JSON.stringify(save)))!;
    expect(claimFreeAd(reloaded, '2026-10-02').ok).toBe(false);
    expect(claimFreeAd(reloaded, '2026-10-04')).toMatchObject({ ok: true, coins: earned + FREE_AD_COINS });
    expect(claimFreeAd(reloaded, '2026-10-03').ok).toBe(false);
    expect(freeAdsLeft(reloaded, '2026-10-04')).toBe(FREE_AD_DAILY_CAP - 1);
  });

  it('count by the local calendar day, whatever the hour', () => {
    const late = new Date(2026, 9, 2, 23, 59);
    const early = new Date(2026, 9, 3, 0, 1);
    expect(localDay(0, late)).toBe('2026-10-02');
    expect(localDay(0, early)).toBe('2026-10-03');
    const save = defaultSave();
    for (let i = 0; i < 5; i++) claimFreeAd(save, localDay(0, late));
    expect(freeAdsLeft(save, localDay(0, late))).toBe(0);
    expect(freeAdsLeft(save, localDay(0, early))).toBe(5);
  });
});

// ------------------------------------------------------------------ old saves, cloud copies

describe('saves', () => {
  it('from before purchases load with nothing owned and no ads watched', () => {
    const old = JSON.parse(JSON.stringify(defaultSave())) as Record<string, unknown>;
    delete old.iap;
    stubStorage(old);
    const loaded = loadSave();
    expect(loaded.iap).toEqual({ owned: [], applied: [], freeAds: { day: '', count: 0 }, firsts: [], welcome: false });
    expect(importSave(old)!.iap).toEqual({ owned: [], applied: [], freeAds: { day: '', count: 0 }, firsts: [], welcome: false });
    expect(normalizeCloud(old).iap).toEqual({ owned: [], applied: [], freeAds: { day: '', count: 0 }, firsts: [], welcome: false });
    expect(adFree(loaded)).toBe(false);
  });

  it('keep their purchases through a store, an export and the cloud', async () => {
    const { iap, save } = await devStore();
    await iap.buy(PRODUCT_NOADS);
    await iap.buy('bl.gems.100');
    const copy = JSON.parse(JSON.stringify(save)) as SaveData;
    expect(importSave(copy)!.iap).toEqual(save.iap);
    expect(normalizeCloud(copy).iap).toEqual(save.iap);
    // The gems bought travel with the save too.
    expect(importSave(copy)!.gems).toEqual(save.gems);
    expect(gems(importSave(copy)!)).toBe(WELCOME_GEMS + 200);
    expect(adFree(normalizeCloud(copy))).toBe(true);
  });

  it('are made whole when damaged', () => {
    expect(normalizeIap('nonsense')).toEqual({ owned: [], applied: [], freeAds: { day: '', count: 0 }, firsts: [], welcome: false });
    expect(normalizeIap({ owned: 5, applied: [1, 'a|b', 'a|b'], freeAds: { day: 'yesterday', count: -3 } }))
      .toEqual({ owned: [], applied: ['a|b'], freeAds: { day: '', count: 0 }, firsts: [], welcome: false });
    expect(normalizeIap({ owned: ['bl.noads', '<script>'], freeAds: { day: '2026-10-02', count: 7.9 } }))
      .toEqual({ owned: ['bl.noads'], applied: [], freeAds: { day: '2026-10-02', count: 7 }, firsts: [], welcome: false });
    const broken = defaultSave();
    (broken as { iap?: unknown }).iap = 'x';
    expect(adFree(broken)).toBe(false);
    expect(broken.iap).toEqual({ owned: [], applied: [], freeAds: { day: '', count: 0 }, firsts: [], welcome: false });
  });

  it('with a purchase are never "barely started" for cloud sync, so they are not given away unasked', () => {
    const save = defaultSave();
    expect(isSmall(save)).toBe(true);
    save.iap!.owned.push(PRODUCT_NOADS);
    expect(isSmall(save)).toBe(false);
    const coinsOnly = defaultSave();
    coinsOnly.iap!.applied.push('tx-1|bl.gems.100');
    expect(isSmall(coinsOnly)).toBe(false);
  });
});

// ------------------------------------------------------------------ the app's shelf (the shop shows everything, even before the store answers)

describe('the shelf in the app', () => {
  it('off the storefront (the web, the portals) there is no shelf and nothing for sale', () => {
    const iap = new Iap();
    iap.bind({ save: defaultSave(), persist: vi.fn() });
    expect(iap.storefront).toBe(false);
    expect(iap.shelf()).toEqual([]);
    expect(iap.canSell(PRODUCT_NOADS)).toBe(false);
  });

  it('in the app before the store answers: every product shows at the catalogue price, none sells, nothing is granted', async () => {
    const { cataloguePrice } = await import('../src/platform/iap');
    vi.stubGlobal('window', { Capacitor: { isNativePlatform: () => true } });
    const save = defaultSave();
    const iap = new Iap();
    iap.bind({ save, persist: vi.fn() });
    expect(iap.available).toBe(false);
    expect(iap.storefront).toBe(true);
    const shelf = iap.shelf();
    expect(shelf.map((p) => p.id)).toEqual(CATALOGUE.map((e) => e.id));
    expect(shelf.every((p) => !p.sellable)).toBe(true);
    expect(shelf.find((p) => p.id === PRODUCT_NOADS)!.price).toBe('US$3.99');
    expect(shelf.every((p) => p.price.startsWith('US$'))).toBe(true);
    expect(shelf.find((p) => p.id === PRODUCT_PASS)!.price).toBe(cataloguePrice(entryOf(PRODUCT_PASS)!));
    expect(iap.canSell(PRODUCT_PASS)).toBe(false);
    expect(await iap.buy(PRODUCT_NOADS)).toBe('failed');
    expect(adFree(save)).toBe(false);
    expect(save.coins).toBe(defaultSave().coins);
  });

  it('a portal build is never a storefront, even inside a native shell', () => {
    vi.stubEnv('VITE_PORTAL', 'poki');
    vi.stubGlobal('window', { Capacitor: { isNativePlatform: () => true } });
    const iap = new Iap();
    iap.bind({ save: defaultSave(), persist: vi.fn() });
    expect(iap.storefront).toBe(false);
    expect(iap.shelf()).toEqual([]);
  });

  it('the dev store: the shelf is the store\'s own products, all for sale', async () => {
    const { iap } = await devStore();
    expect(iap.storefront).toBe(true);
    expect(iap.shelf()).toEqual(iap.products());
    expect(iap.shelf().every((p) => p.sellable)).toBe(true);
  });

  it('a store missing a product: that one is a stand-in at the catalogue price, the rest the store\'s own', async () => {
    const cdv = fakeCdv();
    const get = cdv.store.get;
    cdv.store.get = (id: string) => (id === PRODUCT_PASS ? { id, getOffer: () => undefined } : get(id)) as ReturnType<typeof get>;
    const { iap } = await nativeStore(cdv);
    expect(iap.available).toBe(true);
    const pass = iap.shelf().find((p) => p.id === PRODUCT_PASS)!;
    expect(pass.sellable).toBe(false);
    expect(pass.price).toBe('US$3.99');
    expect(iap.canSell(PRODUCT_PASS)).toBe(false);
    const noAds = iap.shelf().find((p) => p.id === PRODUCT_NOADS)!;
    expect(noAds.sellable).toBe(true);
    expect(noAds.price).toBe('EUR 3.99');
    expect(iap.shelf()).toHaveLength(CATALOGUE.length);
  });

  it.each(['A$5.99', '$3.99', '3,99\u00a0€'])('keeps the live Ad Free price %s exactly as supplied by the native store', async (price) => {
    const cdv = fakeCdv();
    const get = cdv.store.get;
    cdv.store.get = (id: string) => {
      const product = get(id);
      return id === PRODUCT_NOADS ? { ...product, pricing: { price } } : product;
    };
    const { iap } = await nativeStore(cdv);
    const noAds = iap.shelf().find((p) => p.id === PRODUCT_NOADS)!;
    expect(noAds.sellable).toBe(true);
    expect(noAds.price).toBe(price);
  });
});

describe('permanent Journey payment targeting', () => {
  it('pays a delayed approval into the Journey selected at checkout, even after switching and restarting', async () => {
    const { iap, save, persist } = await devStore('?iap=dev&iapresult=pending');
    save.season = { id: '2026-10', xp: 900, claimed: [1, 2], titles: [], carry: null, pass: false, passClaimed: [], carryItems: [] };
    expect(await iap.buy(PRODUCT_PASS)).toBe('pending');
    expect(save.iap!.pendingPass).toBe('2026-10');
    expect(persist).toHaveBeenCalled();
    expect(selectJourney(save.season, 'pass11')).toBe(true);
    expect(await iap.buy(PRODUCT_PASS)).toBe('pending');
    expect(buyPassWithGems(save)).toEqual({ ok: false, reason: 'pending', short: 0 });
    const imported = importSave(JSON.stringify(save))!;
    expect(imported.iap!.pendingPass).toBe('2026-10');
    const restarted = new Iap(); restarted.bind({ save: imported, persist: () => persist() });
    expect(restarted.deliver(PRODUCT_PASS, 'approved-later', false)).toBe('applied');
    expect(imported.season!.id).toBe('journey-11');
    expect(imported.season!.pass).toBe(false);
    expect(imported.season!.journeys!.pass10.pass).toBe(true);
    expect(imported.season!.journeys!.pass10.id).toBe('2026-10');
    expect(imported.season!.journeys!.pass10.xp).toBe(900);
    expect(imported.iap!.pendingPass).toBeUndefined();
    expect(imported.shop!.owned).toContain('decor:kickpass10');
    expect(imported.shop!.owned).not.toContain('decor:kickpass11');
    expect(restarted.deliver(PRODUCT_PASS, 'approved-later', false)).toBe('duplicate');
  });

  it.each(['cancelled', 'failed'] as const)('clears a confirmed %s order so a later upgrade remains possible', async (result) => {
    const { iap, save } = await devStore(`?iap=dev&iapresult=${result}`);
    expect(await iap.buy(PRODUCT_PASS)).toBe(result);
    expect(save.iap!.pendingPass).toBeUndefined();
    expect(save.season!.pass).toBe(false);
  });

  it('retains an unknown provider outcome and validates persisted target IDs', async () => {
    const save = defaultSave();
    const iap = new Iap(); iap.bind({ save, persist: vi.fn() });
    (iap as unknown as { impl: unknown }).impl = { buy: async () => { throw new Error('connection lost'); } };
    expect(await iap.buy(PRODUCT_PASS)).toBe('pending');
    expect(save.iap!.pendingPass).toBe(save.season!.id);
    for (const id of ['pass99', 'journey-13', '<script>', '', '2026-00']) expect(normalizeIap({ pendingPass: id }).pendingPass).toBeUndefined();
    expect(normalizeIap({ pendingPass: 'journey-01' }).pendingPass).toBe('journey-01');
  });
});

describe('late native pass declines', () => {
  it.each([6777006, 6777003])('clears a definitively declined pending order after timeout and restart (code %s)', async (code) => {
    vi.useFakeTimers();
    const cdv = fakeCdv();
    cdv.store.get = (id: string) => ({ id, pricing: { price: '$3.99' },
      getOffer: () => ({ id: 'o', order: async () => undefined }) }) as ReturnType<typeof cdv.store.get>;
    const { iap, save } = await nativeStore(cdv);
    const result = iap.buy(PRODUCT_PASS);
    await vi.advanceTimersByTimeAsync(61_000); expect(await result).toBe('pending');
    const reloaded = importSave(JSON.stringify(save))!;
    const restarted = new Iap(); restarted.bind({ save: reloaded, persist: vi.fn(() => true) }); await restarted.init();
    const update = vi.fn(); const off = restarted.onStateChange(update);
    const error = cdv.store.error.mock.calls.at(-1)![0] as (e: { code: number; productId: string }) => void;
    error({ code, productId: PRODUCT_PASS });
    expect(reloaded.iap!.pendingPass).toBeUndefined(); expect(reloaded.season!.pass).toBe(false);
    expect(update).toHaveBeenCalledTimes(1);
    off(); error({ code, productId: PRODUCT_PASS }); expect(update).toHaveBeenCalledTimes(1);
    const retry = restarted.buy(PRODUCT_PASS);
    await vi.advanceTimersByTimeAsync(61_000); expect(await retry).toBe('pending');
  });

  it('preserves the checkout target on an unrelated error or transient connection failure', async () => {
    vi.useFakeTimers();
    const cdv = fakeCdv();
    cdv.store.get = (id: string) => ({ id, pricing: { price: '$3.99' },
      getOffer: () => ({ id: 'o', order: async () => undefined }) }) as ReturnType<typeof cdv.store.get>;
    const { iap, save } = await nativeStore(cdv);
    const result = iap.buy(PRODUCT_PASS);
    await vi.advanceTimersByTimeAsync(61_000); expect(await result).toBe('pending');
    const target = save.iap!.pendingPass;
    const error = cdv.store.error.mock.calls[0][0] as (e: { code: number; productId: string }) => void;
    error({ code: 6777006, productId: 'bl.gems.100' });
    error({ code: 6777014, productId: PRODUCT_PASS });
    expect(save.iap!.pendingPass).toBe(target);
    expect(iap.deliver(PRODUCT_PASS, 'connection-recovered', false)).toBe('applied');
    expect(save.season!.pass).toBe(true); expect(save.iap!.pendingPass).toBeUndefined();
  });
});

describe('durable StoreKit rejection delivery', () => {
  it('handles a deferred Apple cancellation without store.error, then prevents old rejection replay from cancelling a retry', async () => {
    vi.useFakeTimers();
    const cdv = fakeCdv();
    cdv.store.get = (id: string) => ({ id, pricing: { price: '$3.99' },
      getOffer: () => ({ id: 'o', order: async () => undefined }) }) as ReturnType<typeof cdv.store.get>;
    vi.stubGlobal('window', { CdvPurchase: cdv.global });
    let receiver: ((event: PurchaseRejection) => boolean) | undefined;
    const watch = vi.fn(async (accept: (event: PurchaseRejection) => boolean) => { receiver = accept; });
    cdv.store.initialize = vi.fn(async () => { expect(receiver).toBeTypeOf('function'); return []; });
    const save = defaultSave(); const persist = vi.fn<() => boolean>(() => true);
    const iap = new Iap(watch); iap.bind({ save, persist }); await iap.init();
    const buy = iap.buy(PRODUCT_PASS);
    await vi.advanceTimersByTimeAsync(61_000); expect(await buy).toBe('pending');
    const update = vi.fn(); iap.onStateChange(update);
    const rejected: PurchaseRejection = { id: 'A8A96679-2678-4EAE-B87E-C174B9B1E702', productId: PRODUCT_PASS, result: 'cancelled' };
    expect(receiver!(rejected)).toBe(true);
    expect(save.iap!.pendingPass).toBeUndefined(); expect(save.season!.pass).toBe(false);
    expect(update).toHaveBeenCalledTimes(1);
    expect(save.iap!.applied).toContain(`native-rejection:${rejected.id}|${PRODUCT_PASS}`);
    // Persisted receipt survives death between save and native ACK. Replayed A must not clear the new order B.
    const imported = importSave(JSON.stringify(save))!;
    const restarted = new Iap(watch); restarted.bind({ save: imported, persist }); await restarted.init();
    const retry = restarted.buy(PRODUCT_PASS);
    await vi.advanceTimersByTimeAsync(61_000); expect(await retry).toBe('pending');
    const target = imported.iap!.pendingPass;
    expect(receiver!(rejected)).toBe(true); expect(imported.iap!.pendingPass).toBe(target);
    expect(restarted.deliver(PRODUCT_PASS, 'retry-approved', false)).toBe('applied');
    expect(imported.season!.pass).toBe(true);
  });

  it('settles a live deferred checkout, saves before ACK, and keeps unrelated or malformed events isolated', async () => {
    const cdv = fakeCdv();
    cdv.store.get = (id: string) => ({ id, pricing: { price: '$3.99' },
      getOffer: () => ({ id: 'o', order: async () => undefined }) }) as ReturnType<typeof cdv.store.get>;
    vi.stubGlobal('window', { CdvPurchase: cdv.global });
    let receiver: ((event: PurchaseRejection) => boolean) | undefined;
    const save = defaultSave(); const persist = vi.fn<() => boolean>(() => true); const ack = vi.fn();
    const iap = new Iap(async accept => { receiver = accept; }); iap.bind({ save, persist }); await iap.init();
    const buy = iap.buy(PRODUCT_PASS); await Promise.resolve();
    const target = save.iap!.pendingPass;
    expect(receiver!({ id: 'other', productId: 'bl.gems.100', result: 'cancelled' })).toBe(true);
    expect(save.iap!.pendingPass).toBe(target);
    expect(receiver!({ id: 'bad', productId: PRODUCT_PASS, result: 'network' as 'failed' })).toBe(false);
    expect(save.iap!.pendingPass).toBe(target);
    const accepted = receiver!({ id: 'live-failure', productId: PRODUCT_PASS, result: 'failed' });
    const savedAt = persist.mock.invocationCallOrder.at(-1)!;
    if (accepted) ack();
    expect(await buy).toBe('failed'); expect(save.iap!.pendingPass).toBeUndefined();
    expect(savedAt).toBeLessThan(ack.mock.invocationCallOrder[0]);
    expect(save.season!.pass).toBe(false);
  });

  it('consumes a rejection retained before initialization without inventing an approval or payout', async () => {
    const cdv = fakeCdv(); vi.stubGlobal('window', { CdvPurchase: cdv.global });
    const save = defaultSave(); save.iap!.pendingPass = save.season!.id;
    const coins = save.coins, beforeGems = gems(save); const persist = vi.fn<() => boolean>(() => true);
    const iap = new Iap(async accept => {
      expect(accept({ id: 'retained-on-disk', productId: PRODUCT_PASS, result: 'cancelled' })).toBe(true);
    });
    iap.bind({ save, persist }); await iap.init();
    expect(save.iap!.pendingPass).toBeUndefined(); expect(save.season!.pass).toBe(false);
    expect(save.coins).toBe(coins); expect(gems(save)).toBe(beforeGems); expect(persist).toHaveBeenCalledTimes(1);
  });

  it('keeps the native event and pending target until a failed local write can be retried', async () => {
    const cdv = fakeCdv(); vi.stubGlobal('window', { CdvPurchase: cdv.global });
    let receiver: ((event: PurchaseRejection) => boolean) | undefined;
    const save = defaultSave(); const target = save.season!.id; save.iap!.pendingPass = target;
    const stored = vi.fn<() => boolean>(() => false);
    const iap = new Iap(async accept => { receiver = accept; }); iap.bind({ save, persist: stored }); await iap.init();
    const event: PurchaseRejection = { id: 'disk-failure', productId: PRODUCT_PASS, result: 'cancelled' };
    expect(receiver!(event)).toBe(false); expect(save.iap!.pendingPass).toBe(target);
    expect(save.iap!.applied).not.toContain(`native-rejection:${event.id}|${PRODUCT_PASS}`);
    stored.mockImplementationOnce(() => { throw new Error('Storage full'); });
    expect(receiver!(event)).toBe(false); expect(save.iap!.pendingPass).toBe(target);
    stored.mockReturnValue(true);
    expect(receiver!(event)).toBe(true); expect(save.iap!.pendingPass).toBeUndefined();
    expect(save.iap!.applied).toContain(`native-rejection:${event.id}|${PRODUCT_PASS}`);
  });

  it('never starts a paid pass order if its target could not be saved', async () => {
    const cdv = fakeCdv(); vi.stubGlobal('window', { CdvPurchase: cdv.global });
    const order = vi.fn(async () => undefined);
    cdv.store.get = (id: string) => ({ id, pricing: { price: '$3.99' }, getOffer: () => ({ id: 'o', pricingPhases: [], order }) }) as ReturnType<typeof cdv.store.get>;
    const save = defaultSave(); const iap = new Iap(); iap.bind({ save, persist: () => false }); await iap.init();
    expect(await iap.buy(PRODUCT_PASS)).toBe('failed'); expect(order).not.toHaveBeenCalled();
    expect(save.iap!.pendingPass).toBeUndefined();
  });
});

describe('paid native save failures', () => {
  it.each(['false', 'throw', 'unconfirmed'] as const)('never finishes an unsaved payout (%s), then pays the same receipt once after storage recovers', async (failure) => {
    const cdv = fakeCdv();
    const { iap, save } = await nativeStore(cdv);
    const before = structuredClone(save);
    const sameSave = save;
    let canSave = false;
    const persist = vi.fn<() => boolean | void>(() => {
      save.updatedAt = '2026-10-06T00:00:00.000Z';
      if (canSave) return true;
      if (failure === 'throw') throw new Error('Storage unavailable');
      if (failure === 'false') return false;
    });
    iap.bind({ save, persist });
    const grant = vi.fn(); iap.onGrant(grant);
    for (const product of ['bl.gems.100', PRODUCT_STARTER]) {
      cdv.redeliver(product, `disk-${product}`);
      await Promise.resolve();
      expect(cdv.finishes.at(-1)).not.toHaveBeenCalled();
      expect(save).toBe(sameSave);
      expect(save).toEqual(before);
      expect(iap.deliver(product, `disk-${product}`, false)).toBe('unsaved');
      expect(save).toEqual(before);
      expect(grant).not.toHaveBeenCalled();
    }
    canSave = true;
    for (const product of ['bl.gems.100', PRODUCT_STARTER]) {
      cdv.redeliver(product, `disk-${product}`);
      await Promise.resolve();
      expect(cdv.finishes.at(-1)).toHaveBeenCalledTimes(1);
    }
    expect(save.coins).toBe(before.coins + 2000);
    expect(gems(save)).toBe(gems(before) + 200 + 150);
    expect(owns(save, 'ball', 'gold')).toBe(true);
    expect(save.iap!.firsts).toEqual(['bl.gems.100']);
    expect(grant).toHaveBeenCalledTimes(2);
    const paid = structuredClone(save);
    cdv.redeliver('bl.gems.100', 'disk-bl.gems.100'); await Promise.resolve();
    expect(cdv.finishes.at(-1)).toHaveBeenCalledTimes(1);
    expect(save).toEqual(paid);
    expect(grant).toHaveBeenCalledTimes(2);
  });

  it('rolls back a paid inactive legacy Journey and its entitlements, retaining its original target for redelivery', async () => {
    const cdv = fakeCdv(); const { iap, save, persist } = await nativeStore(cdv);
    save.season = { id: '2026-10', xp: 900, claimed: [1, 2], titles: [], carry: null, pass: false, passClaimed: [], carryItems: [] };
    save.iap!.pendingPass = '2026-10';
    selectJourney(save.season, 'pass11');
    const before = structuredClone(save);
    persist.mockReturnValue(false);
    cdv.redeliver(PRODUCT_PASS, 'paid-legacy-pass'); await Promise.resolve();
    expect(cdv.finishes.at(-1)).not.toHaveBeenCalled();
    expect(save).toEqual(before);
    expect(save.iap!.pendingPass).toBe('2026-10');
    persist.mockReturnValue(true);
    cdv.redeliver(PRODUCT_PASS, 'paid-legacy-pass'); await Promise.resolve();
    expect(cdv.finishes.at(-1)).toHaveBeenCalledTimes(1);
    expect(save.season!.id).toBe('journey-11'); expect(save.season!.pass).toBe(false);
    expect(save.season!.journeys!.pass10).toMatchObject({ id: '2026-10', xp: 900, pass: true });
    expect(save.shop!.owned).toContain('decor:kickpass10');
    expect(save.shop!.owned).not.toContain('decor:kickpass11');
    expect(save.iap!.pendingPass).toBeUndefined();
    expect(iap.deliver(PRODUCT_PASS, 'paid-legacy-pass', false)).toBe('duplicate');
  });

  it.each(['false', 'throw'] as const)('preserves a legacy shell pending target when its definitive cancellation cannot save (%s)', async (failure) => {
    const cdv = fakeCdv(); const { iap, save, persist } = await nativeStore(cdv);
    const order = vi.fn(async () => undefined);
    cdv.store.get = (id: string) => ({ id, pricing: { price: '$3.99' }, getOffer: () => ({ id: 'o', pricingPhases: [], order }) }) as ReturnType<typeof cdv.store.get>;
    const buy = iap.buy(PRODUCT_PASS); await Promise.resolve();
    const before = structuredClone(save);
    if (failure === 'false') persist.mockReturnValue(false);
    else persist.mockImplementation(() => { throw new Error('Storage full'); });
    const error = cdv.store.error.mock.calls.at(-1)![0] as (e: { code: number; productId: string }) => void;
    error({ code: 6777006, productId: PRODUCT_PASS });
    expect(await buy).toBe('pending');
    expect(save).toEqual(before);
    expect(await iap.buy(PRODUCT_PASS)).toBe('pending'); expect(order).toHaveBeenCalledTimes(1);
    persist.mockImplementation(() => true);
    error({ code: 6777006, productId: PRODUCT_PASS });
    expect(save.iap!.pendingPass).toBeUndefined();
  });

  it.each(['error-first', 'observer-first'] as const)('requires the native durable rejection in either callback order (%s), and replay cannot clear a retry', async (first) => {
    vi.useFakeTimers();
    const cdv = fakeCdv();
    vi.stubGlobal('window', { CdvPurchase: cdv.global, Capacitor: { isNativePlatform: () => true, isPluginAvailable: (name: string) => name === 'PurchaseEvents' } });
    const order = vi.fn(async () => undefined);
    cdv.store.get = (id: string) => ({ id, pricing: { price: '$3.99' }, getOffer: () => ({ id: 'o', pricingPhases: [], order }) }) as ReturnType<typeof cdv.store.get>;
    let receive: ((event: PurchaseRejection) => boolean) | undefined;
    const save = defaultSave(); let canSave = true;
    const persist = vi.fn(() => canSave);
    const iap = new Iap(async accept => { receive = accept; }); iap.bind({ save, persist }); await iap.init();
    const changed = vi.fn(); iap.onStateChange(changed);
    const buy = iap.buy(PRODUCT_PASS); await Promise.resolve();
    const before = structuredClone(save); canSave = false;
    const error = cdv.store.error.mock.calls.at(-1)![0] as (e: { code: number; productId: string }) => void;
    const event: PurchaseRejection = { id: 'authoritative-A', productId: PRODUCT_PASS, result: 'cancelled' };
    if (first === 'error-first') { error({ code: 6777006, productId: PRODUCT_PASS }); expect(receive!(event)).toBe(false); }
    else { expect(receive!(event)).toBe(false); error({ code: 6777006, productId: PRODUCT_PASS }); }
    expect(await buy).toBe('pending'); expect(save).toEqual(before);
    expect(await iap.buy(PRODUCT_PASS)).toBe('pending'); expect(order).toHaveBeenCalledTimes(1);
    expect(changed).not.toHaveBeenCalled();
    canSave = true;
    // Even if ordinary error arrives after storage recovers, the retained event still owns the receipt.
    error({ code: 6777006, productId: PRODUCT_PASS });
    expect(save.iap!.pendingPass).toBe(before.iap!.pendingPass);
    expect(receive!(event)).toBe(true); expect(save.iap!.pendingPass).toBeUndefined();
    expect(changed).toHaveBeenCalledTimes(1);
    selectJourney(save.season!, 'pass12');
    const retry = iap.buy(PRODUCT_PASS); await Promise.resolve(); const targetB = save.iap!.pendingPass;
    expect(targetB).toBe('journey-12'); expect(order).toHaveBeenCalledTimes(2);
    expect(receive!(event)).toBe(true); expect(save.iap!.pendingPass).toBe(targetB);
    error({ code: 6777006, productId: PRODUCT_PASS }); expect(await retry).toBe('pending');
    expect(save.iap!.pendingPass).toBe(targetB);
  });
});
