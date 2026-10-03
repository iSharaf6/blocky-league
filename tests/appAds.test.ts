import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ads, APP_AD_GAP_MS, APP_AD_MATCH_GAP_MS, APP_AD_MOMENT_GAP_MS } from '../src/platform/ads';

/**
 * The iPhone / iPad app's ads (platform/ads.ts, provider 'app'): Google AdMob through the Capacitor plugin, mocked
 * here. Kid-safe settings, ads loaded ahead, a reward only on the reward event, an interstitial at every break but
 * never back to back, NO ADS kept.
 */

const h = vi.hoisted(() => {
  const listeners = new Map<string, Set<() => void>>();
  const emit = (name: string) => listeners.get(name)?.forEach((fn) => fn());
  const AdMob = {
    requestConsentInfo: vi.fn(async () => ({ status: 'NOT_REQUIRED', canRequestAds: true, isConsentFormAvailable: false })),
    showConsentForm: vi.fn(),
    initialize: vi.fn(async (_o?: unknown) => {}),
    prepareRewardVideoAd: vi.fn(async (_o?: unknown) => ({ adUnitId: 'r' })),
    prepareInterstitial: vi.fn(async (_o?: unknown) => ({ adUnitId: 'i' })),
    showRewardVideoAd: vi.fn((): Promise<unknown> => new Promise(() => {})),
    showInterstitial: vi.fn(async () => {}),
    addListener: vi.fn(async (name: string, fn: () => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(fn);
      return { remove: async () => { listeners.get(name)?.delete(fn); } };
    }),
  };
  return { AdMob, emit, listeners };
});

vi.mock('@capacitor-community/admob', () => ({
  AdMob: h.AdMob,
  MaxAdContentRating: { General: 'General', ParentalGuidance: 'ParentalGuidance', Teen: 'Teen', MatureAudience: 'MatureAudience' },
  AdmobConsentStatus: { NOT_REQUIRED: 'NOT_REQUIRED', OBTAINED: 'OBTAINED', REQUIRED: 'REQUIRED', UNKNOWN: 'UNKNOWN' },
  RewardAdPluginEvents: { Rewarded: 'onRewardedVideoAdReward', Dismissed: 'onRewardedVideoAdDismissed', FailedToShow: 'onRewardedVideoAdFailedToShow' },
  InterstitialAdPluginEvents: { Dismissed: 'interstitialAdDismissed', FailedToShow: 'interstitialAdFailedToShow' },
}));

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

async function appAds(): Promise<Ads> {
  const ads = new Ads();
  await ads.init();
  await flush();
  return ads;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('VITE_PORTAL', 'none');
  vi.stubGlobal('location', { search: '' });
  vi.stubGlobal('window', { Capacitor: { isNativePlatform: () => true } });
  h.listeners.clear();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('ads in the iPhone / iPad app (AdMob)', () => {
  it('comes up kid-safe and loads both ads ahead', async () => {
    const ads = await appAds();
    expect(ads.portal).toBe('app');
    expect(h.AdMob.initialize).toHaveBeenCalledWith(expect.objectContaining({
      tagForChildDirectedTreatment: true, tagForUnderAgeOfConsent: true, maxAdContentRating: 'General',
    }));
    expect(h.AdMob.prepareRewardVideoAd).toHaveBeenCalledWith(expect.objectContaining({ npa: true }));
    expect(h.AdMob.prepareInterstitial).toHaveBeenCalledWith(expect.objectContaining({ npa: true }));
    expect(ads.rewardedAvailable).toBe(true);
    expect(ads.showsInterstitials).toBe(true);
  });

  it('is off in a browser (no Capacitor) and in the portal builds', async () => {
    vi.stubGlobal('window', {});
    expect((await appAds()).portal).toBe('none');
    expect(h.AdMob.initialize).not.toHaveBeenCalled();
  });

  it('pays a rewarded ad only on the reward, mutes the game while it plays, and loads the next one', async () => {
    const ads = await appAds();
    const muted: boolean[] = [];
    ads.onMute = (m) => muted.push(m);
    h.AdMob.showRewardVideoAd.mockImplementationOnce(async () => {
      h.emit('onRewardedVideoAdReward');
      h.emit('onRewardedVideoAdDismissed');
      return { type: 'coins', amount: 1 };
    });
    expect(await ads.rewarded()).toBe(true);
    expect(muted).toEqual([true, false]);
    await flush();
    expect(h.AdMob.prepareRewardVideoAd).toHaveBeenCalledTimes(2);

    // Closed early: the plugin's show never resolves, the dismissal ends it, and nothing is paid.
    h.AdMob.showRewardVideoAd.mockImplementationOnce(() => {
      queueMicrotask(() => h.emit('onRewardedVideoAdDismissed'));
      return new Promise(() => {});
    });
    expect(await ads.rewarded()).toBe(false);
  });

  it('never pays when the ad fails to show, and says no when none is loaded', async () => {
    const ads = await appAds();
    h.AdMob.showRewardVideoAd.mockImplementationOnce(() => {
      queueMicrotask(() => h.emit('onRewardedVideoAdFailedToShow'));
      return new Promise(() => {});
    });
    h.AdMob.prepareRewardVideoAd.mockImplementationOnce(() => new Promise(() => {}));
    expect(await ads.rewarded()).toBe(false);
    expect(ads.rewardedAvailable).toBe(false);
    expect(await ads.rewarded()).toBe(false);
    expect(h.AdMob.showRewardVideoAd).toHaveBeenCalledTimes(1);
  });

  it(`interstitials: at the very first half-time, then every break at least ${APP_AD_GAP_MS / 1000} s after the last ad closed`, async () => {
    const ads = await appAds();
    h.AdMob.showInterstitial.mockImplementation(async () => { queueMicrotask(() => h.emit('interstitialAdDismissed')); });
    const brk = async (at: 'match' | 'halftime') => {
      await ads.midgame(at);
      await flush();
    };
    // (The owner saw none: the old cap wanted two breaks first, and only counted the ones between matches.)
    await brk('halftime');
    expect(h.AdMob.showInterstitial).toHaveBeenCalledTimes(1);
    // The next match's kick-off right after it: no second ad back to back. A kick-off waits the longer
    // APP_AD_MATCH_GAP_MS (half-time is the regular one), a half-time APP_AD_GAP_MS.
    await brk('match');
    expect(h.AdMob.showInterstitial).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + APP_AD_MATCH_GAP_MS - 1000);
    await brk('match');
    expect(h.AdMob.showInterstitial).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 1000);
    await brk('match');
    expect(h.AdMob.showInterstitial).toHaveBeenCalledTimes(2);
    vi.setSystemTime(Date.now() + APP_AD_GAP_MS - 1000);
    await brk('halftime');
    expect(h.AdMob.showInterstitial).toHaveBeenCalledTimes(2);
    vi.setSystemTime(Date.now() + 1000);
    await brk('halftime');
    expect(h.AdMob.showInterstitial).toHaveBeenCalledTimes(3);
  });

  it('the gap counts from when the ad closed, a rewarded one too; one that never showed starts no gap', async () => {
    const ads = await appAds();
    // A long ad: closed APP_AD_GAP_MS after it began. The next break straight after it waits.
    h.AdMob.showInterstitial.mockImplementationOnce(async () => {
      setTimeout(() => h.emit('interstitialAdDismissed'), APP_AD_GAP_MS);
    });
    const shown = ads.midgame('halftime');
    await vi.advanceTimersByTimeAsync(APP_AD_GAP_MS);
    await shown;
    await flush();
    await ads.midgame('match');
    expect(h.AdMob.showInterstitial).toHaveBeenCalledTimes(1);
    // A rewarded ad the player chose: the half-time straight after it runs clean.
    vi.setSystemTime(Date.now() + APP_AD_GAP_MS);
    h.AdMob.showRewardVideoAd.mockImplementationOnce(async () => {
      h.emit('onRewardedVideoAdReward');
      h.emit('onRewardedVideoAdDismissed');
      return { type: 'coins', amount: 1 };
    });
    expect(await ads.rewarded()).toBe(true);
    await flush();
    await ads.midgame('halftime');
    expect(h.AdMob.showInterstitial).toHaveBeenCalledTimes(1);
    // One that fails to show: the very next break may try again (a kick-off one too, once clear of its longer gap).
    vi.setSystemTime(Date.now() + APP_AD_MATCH_GAP_MS);
    h.AdMob.showInterstitial.mockImplementationOnce(async () => { queueMicrotask(() => h.emit('interstitialAdFailedToShow')); });
    await ads.midgame('halftime');
    await flush();
    expect(h.AdMob.showInterstitial).toHaveBeenCalledTimes(2);
    h.AdMob.showInterstitial.mockImplementationOnce(async () => { queueMicrotask(() => h.emit('interstitialAdDismissed')); });
    await ads.midgame('match');
    await flush();
    expect(h.AdMob.showInterstitial).toHaveBeenCalledTimes(3);
  });

  it(`a Football Moment's quick retries: one before a try at most every ${APP_AD_MOMENT_GAP_MS / 60_000} minutes`, async () => {
    const ads = await appAds();
    h.AdMob.showInterstitial.mockImplementation(async () => { queueMicrotask(() => h.emit('interstitialAdDismissed')); });
    await ads.midgame('moment');
    await flush();
    expect(h.AdMob.showInterstitial).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + APP_AD_GAP_MS + 1000);
    await ads.midgame('moment');
    await flush();
    expect(h.AdMob.showInterstitial).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + APP_AD_MOMENT_GAP_MS);
    await ads.midgame('moment');
    await flush();
    expect(h.AdMob.showInterstitial).toHaveBeenCalledTimes(2);
  });

  it('an interstitial that is not loaded yet is skipped (the game never waits on one) and asked for again', async () => {
    h.AdMob.prepareInterstitial.mockImplementationOnce(() => new Promise(() => {}));
    const ads = await appAds();
    await ads.midgame('halftime');
    expect(h.AdMob.showInterstitial).not.toHaveBeenCalled();
  });

  it('NO ADS stops every interstitial; rewarded ads stay (they are the player\'s choice)', async () => {
    const ads = await appAds();
    ads.adFree = () => true;
    for (let i = 0; i < 6; i++) {
      vi.setSystemTime(Date.now() + APP_AD_GAP_MS * 2);
      await ads.midgame(i % 2 ? 'match' : 'halftime');
    }
    expect(h.AdMob.showInterstitial).not.toHaveBeenCalled();
    expect(ads.rewardedAvailable).toBe(true);
  });

  it('a failed load tries again later, and tells the shop when the ad is in', async () => {
    h.AdMob.prepareRewardVideoAd.mockRejectedValueOnce(new Error('no fill'));
    const ads = await appAds();
    const ready = vi.fn();
    ads.onAdReady(ready);
    expect(ads.rewardedAvailable).toBe(false);
    await vi.advanceTimersByTimeAsync(15_000);
    await flush();
    expect(h.AdMob.prepareRewardVideoAd).toHaveBeenCalledTimes(2);
    expect(ads.rewardedAvailable).toBe(true);
    expect(ready).toHaveBeenCalled();
  });
});
