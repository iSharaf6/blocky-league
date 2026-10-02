import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IAP_APPLIED_MAX, defaultSave, importSave, loadSave, normalizeIap, type SaveData } from '../src/core/save';
import { localDay } from '../src/core/day';
import { owns, FREE_AD_COINS, FREE_AD_DAILY_CAP, claimFreeAd, freeAdsLeft } from '../src/meta/shop';
import { Ads } from '../src/platform/ads';
import { isSmall, normalizeCloud } from '../src/platform/cloud';
import {
  CATALOGUE, PRODUCT_NOADS, PRODUCT_STARTER, Iap, adFree, applyPurchase, coinsOf, entryOf,
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
async function devStore(search = '?iap=dev'): Promise<{ iap: Iap; save: SaveData; persist: ReturnType<typeof vi.fn> }> {
  vi.stubEnv('DEV', true);
  vi.stubGlobal('location', { search });
  const save = defaultSave();
  const persist = vi.fn();
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
  it('sells the six products under their stable ids, bonuses included', () => {
    expect(CATALOGUE.map((e) => e.id)).toEqual(['bl.coins.500', 'bl.coins.1500', 'bl.coins.4000', 'bl.coins.10000', 'bl.starter', 'bl.noads']);
    expect(CATALOGUE.map((e) => e.kind)).toEqual(['consumable', 'consumable', 'consumable', 'consumable', 'non-consumable', 'non-consumable']);
    expect(CATALOGUE.filter((e) => e.kind === 'consumable').map(coinsOf)).toEqual([500, 1650, 5000, 14000]);
    expect(coinsOf(entryOf(PRODUCT_STARTER)!)).toBe(2000);
    expect(entryOf(PRODUCT_STARTER)!.items).toEqual([{ cat: 'ball', id: 'gold' }]);
    expect(entryOf(PRODUCT_NOADS)!.noAds).toBe(true);
  });

  it('keeps the packs honest: the bigger the pack the better the rate, and the smallest is two or three wins', () => {
    const packs = CATALOGUE.filter((e) => e.kind === 'consumable');
    const perDollar = packs.map((e) => coinsOf(e) / e.usd);
    for (let i = 1; i < perDollar.length; i++) expect(perDollar[i]).toBeGreaterThan(perDollar[i - 1]);
    // A Normal win pays about 170 to 210 coins (main.ts standardReward): 500 coins is two or three of them.
    expect(500 / 210).toBeGreaterThanOrEqual(2);
    expect(500 / 170).toBeLessThanOrEqual(3);
    // Prices are only the suggestions for the store consoles; the shop shows the store's own string.
    expect(entryOf('bl.coins.500')!.usd).toBe(0.99);
  });
});

// ------------------------------------------------------------------ paying out once

describe('consumable coin packs', () => {
  it('credit the right coins once, even if the store delivers the transaction twice', async () => {
    const { iap, save, persist } = await devStore();
    const grants: IapGrant[] = [];
    iap.onGrant((g) => grants.push(g));
    const start = save.coins;
    expect(iap.deliver('bl.coins.1500', 'tx-1', false)).toBe('applied');
    expect(save.coins).toBe(start + 1650);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(iap.deliver('bl.coins.1500', 'tx-1', false)).toBe('duplicate');
    expect(save.coins).toBe(start + 1650);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(grants).toEqual([{ productId: 'bl.coins.1500', coins: 1650, items: [], noAds: false, restored: false }]);
    // A different transaction is a different purchase, and the same pack can be bought again.
    expect(iap.deliver('bl.coins.1500', 'tx-2', false)).toBe('applied');
    expect(save.coins).toBe(start + 3300);
  });

  it('are bought through the store and never marked as owned', async () => {
    const { iap, save } = await devStore();
    const start = save.coins;
    expect(iap.available).toBe(true);
    expect(await iap.buy('bl.coins.500')).toBe('ok');
    expect(await iap.buy('bl.coins.500')).toBe('ok');
    expect(save.coins).toBe(start + 1000);
    expect(save.iap!.owned).toEqual([]);
    expect(iap.products().find((p) => p.id === 'bl.coins.500')!.owned).toBe(false);
  });

  it('never pay for an unknown product, or before there is a save to pay into', async () => {
    const { iap, save } = await devStore();
    expect(iap.deliver('bl.coins.7', 'tx-9', false)).toBe('unknown');
    expect(save.coins).toBe(defaultSave().coins);
    expect(new Iap().deliver('bl.coins.500', 'tx-1', false)).toBe('unbound');
  });

  it('keep only the newest transaction ids, so the save stays small', () => {
    const save = defaultSave();
    const e = entryOf('bl.coins.500')!;
    for (let i = 0; i < IAP_APPLIED_MAX + 50; i++) applyPurchase(save, e, `tx-${i}`);
    expect(save.iap!.applied).toHaveLength(IAP_APPLIED_MAX);
    expect(save.iap!.applied[IAP_APPLIED_MAX - 1]).toBe(`tx-${IAP_APPLIED_MAX + 49}|bl.coins.500`);
    expect(save.iap!.applied).not.toContain('tx-0|bl.coins.500');
  });
});

describe('the Starter Pack', () => {
  it('is one time only, and hands over its coins and the Gold ball', async () => {
    const { iap, save } = await devStore();
    const start = save.coins;
    expect(save.shop!.owned).not.toContain('ball:gold');
    expect(await iap.buy(PRODUCT_STARTER)).toBe('ok');
    expect(save.coins).toBe(start + 2000);
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
  it('hands back the one-time products only, never coin packs', async () => {
    const { iap, save } = await devStore();
    await iap.buy('bl.coins.4000');
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
    // No coins: the Starter Pack's 2000 were paid on the first device (a reinstall is no coin tap); the Gold ball is back.
    expect(fresh.coins).toBe(defaultSave().coins);

    // Restoring again changes nothing and says so.
    const twice = await again.restore();
    expect(twice).toEqual({ ok: true, restored: [] });
    expect(fresh.coins).toBe(defaultSave().coins);
    expect(save.coins).toBe(defaultSave().coins + 5000 + 2000);
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
    expect(await prod.buy('bl.coins.500')).toBe('failed');
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
    expect(await iap.buy('bl.coins.500')).toBe('failed');
    expect(save.coins).toBe(defaultSave().coins);
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
  const persist = vi.fn();
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
    expect(registered.find((p) => p.id === 'bl.coins.500')!.type).toBe('consumable');
    expect(cdv.store.initialize).toHaveBeenCalledWith(['ios-appstore']);
    expect(iap.products().find((p) => p.id === 'bl.coins.500')!.price).toBe('EUR 0.99');
  });

  it('pays a purchase out, saves, and only then finishes it; a second delivery pays nothing', async () => {
    const cdv = fakeCdv();
    const { iap, save, persist } = await nativeStore(cdv);
    const start = save.coins;
    expect(await iap.buy('bl.coins.500')).toBe('ok');
    expect(save.coins).toBe(start + 500);
    expect(cdv.finishes).toHaveLength(1);
    expect(cdv.finishes[0]).toHaveBeenCalledTimes(1);
    // Saved before the store was told: a crash in between only re-delivers a purchase we recognise.
    expect(persist.mock.invocationCallOrder[0]).toBeLessThan(cdv.finishes[0].mock.invocationCallOrder[0]);

    const txId = save.iap!.applied[0].split('|')[0];
    cdv.redeliver('bl.coins.500', txId);
    await Promise.resolve();
    expect(save.coins).toBe(start + 500);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(cdv.finishes[1]).toHaveBeenCalledTimes(1); // finished again: harmless, and it clears the store's queue
  });

  it('calls a backed out purchase cancelled and charges nothing', async () => {
    const cdv = fakeCdv({ cancel: true });
    const { iap, save } = await nativeStore(cdv);
    const start = save.coins;
    expect(await iap.buy('bl.coins.4000')).toBe('cancelled');
    expect(save.coins).toBe(start);
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
    const start = save.coins;
    const result = iap.buy('bl.coins.500');
    await vi.advanceTimersByTimeAsync(61_000);
    expect(await result).toBe('pending');
    expect(save.coins).toBe(start);
    cdv.redeliver('bl.coins.500', 'late-1');
    await Promise.resolve();
    expect(save.coins).toBe(start + 500);
    expect(grants).toHaveLength(1);
  });

  it('restores the one-time products the store says the account owns, not coin packs', async () => {
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
    expect(loaded.iap).toEqual({ owned: [], applied: [], freeAds: { day: '', count: 0 } });
    expect(importSave(old)!.iap).toEqual({ owned: [], applied: [], freeAds: { day: '', count: 0 } });
    expect(normalizeCloud(old).iap).toEqual({ owned: [], applied: [], freeAds: { day: '', count: 0 } });
    expect(adFree(loaded)).toBe(false);
  });

  it('keep their purchases through a store, an export and the cloud', async () => {
    const { iap, save } = await devStore();
    await iap.buy(PRODUCT_NOADS);
    await iap.buy('bl.coins.500');
    const copy = JSON.parse(JSON.stringify(save)) as SaveData;
    expect(importSave(copy)!.iap).toEqual(save.iap);
    expect(normalizeCloud(copy).iap).toEqual(save.iap);
    expect(adFree(normalizeCloud(copy))).toBe(true);
  });

  it('are made whole when damaged', () => {
    expect(normalizeIap('nonsense')).toEqual({ owned: [], applied: [], freeAds: { day: '', count: 0 } });
    expect(normalizeIap({ owned: 5, applied: [1, 'a|b', 'a|b'], freeAds: { day: 'yesterday', count: -3 } }))
      .toEqual({ owned: [], applied: ['a|b'], freeAds: { day: '', count: 0 } });
    expect(normalizeIap({ owned: ['bl.noads', '<script>'], freeAds: { day: '2026-10-02', count: 7.9 } }))
      .toEqual({ owned: ['bl.noads'], applied: [], freeAds: { day: '2026-10-02', count: 7 } });
    const broken = defaultSave();
    (broken as { iap?: unknown }).iap = 'x';
    expect(adFree(broken)).toBe(false);
    expect(broken.iap).toEqual({ owned: [], applied: [], freeAds: { day: '', count: 0 } });
  });

  it('with a purchase are never "barely started" for cloud sync, so they are not given away unasked', () => {
    const save = defaultSave();
    expect(isSmall(save)).toBe(true);
    save.iap!.owned.push(PRODUCT_NOADS);
    expect(isSmall(save)).toBe(false);
    const coinsOnly = defaultSave();
    coinsOnly.iap!.applied.push('tx-1|bl.coins.500');
    expect(isSmall(coinsOnly)).toBe(false);
  });
});
