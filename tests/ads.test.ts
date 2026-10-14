import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ads, APP_AD_MOMENT_GAP_MS, PORTAL_AD_GAP_MS, PORTAL_HALF_GAP_MS, PORTAL_NO_ANSWER_MS, PORTAL_RETRY_MS, tokenUserId } from '../src/platform/ads';

type CrazySDK = NonNullable<Window['CrazyGames']>['SDK'];
type AdCallbacks = Parameters<CrazySDK['ad']['requestAd']>[1];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function environment(portal: 'crazygames' | 'poki', loadScript = true) {
  vi.stubEnv('VITE_PORTAL', portal);
  vi.stubGlobal('location', { search: '' });
  const append = vi.fn((script: { onload?: () => void }) => {
    if (loadScript) void Promise.resolve().then(() => script.onload?.());
  });
  vi.stubGlobal('document', { createElement: () => ({}), head: { appendChild: append } });
  return append;
}

function crazy() {
  environment('crazygames');
  const events: string[] = [];
  const sdk: CrazySDK = {
    init: vi.fn(async () => {}), environment: 'local',
    game: {
      gameplayStart: vi.fn(() => { events.push('start'); }),
      gameplayStop: vi.fn(() => { events.push('stop'); }),
      loadingStart: vi.fn(() => { events.push('loading'); }),
      loadingStop: vi.fn(() => { events.push('loaded'); }),
      happytime: vi.fn(), settings: { muteAudio: false, disableChat: false },
      addSettingsChangeListener: vi.fn(),
    },
    ad: { requestAd: vi.fn(), hasAdblock: vi.fn(async () => false) },
  };
  vi.stubGlobal('window', { CrazyGames: { SDK: sdk } });
  return { sdk, events };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('portal startup and gameplay events', () => {
  it('queues gameplay when initialization finishes after the interactive title', async () => {
    const { sdk, events } = crazy();
    const initialized = deferred<void>();
    sdk.init = vi.fn(() => initialized.promise);
    const ads = new Ads();
    const boot = ads.init();
    ads.loadingDone();
    ads.gameplayStart();
    await vi.advanceTimersByTimeAsync(3500);
    expect(events).toEqual([]);
    initialized.resolve();
    await boot;
    expect(events).toEqual(['loading', 'loaded', 'start']);
    ads.gameplayStart();
    ads.gameplayStop();
    ads.gameplayStop();
    expect(events).toEqual(['loading', 'loaded', 'start', 'stop']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not emit an old start if the player paused before SDK initialization', async () => {
    const { sdk, events } = crazy();
    const initialized = deferred<void>();
    sdk.init = () => initialized.promise;
    const ads = new Ads();
    const boot = ads.init();
    ads.loadingDone();
    ads.gameplayStart();
    ads.gameplayStop();
    initialized.resolve();
    await boot;
    expect(events).toEqual(['loading', 'loaded']);
  });

  it('sends loading completion before gameplay and loads its SDK once', async () => {
    const { sdk, events } = crazy();
    const ads = new Ads();
    const boot = ads.init();
    expect(ads.init()).toBe(boot);
    await boot;
    ads.gameplayStart();
    expect(events).toEqual(['loading']);
    ads.loadingDone();
    ads.loadingDone();
    expect(events).toEqual(['loading', 'loaded', 'start']);
    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(sdk.game.addSettingsChangeListener).toHaveBeenCalledTimes(1);
  });

  it('lets the game proceed when the SDK script is blocked', async () => {
    environment('crazygames', false);
    vi.stubGlobal('window', {});
    const ads = new Ads();
    const boot = ads.init();
    await vi.advanceTimersByTimeAsync(6000);
    await boot;
    expect(ads.portal).toBe('none');
    expect(ads.rewardedAvailable).toBe(false);
    expect(await ads.rewarded()).toBe(false);
    await ads.midgame();
  });

  it('ignores a disabled SDK and a rejected SDK initialization', async () => {
    const { sdk, events } = crazy();
    sdk.environment = 'disabled';
    const disabled = new Ads();
    disabled.loadingDone();
    disabled.gameplayStart();
    await disabled.init();
    expect(disabled.rewardedAvailable).toBe(false);
    expect(events).toEqual([]);
    sdk.environment = 'local';
    sdk.init = async () => { throw new Error('blocked'); };
    const rejected = new Ads();
    await rejected.init();
    expect(rejected.rewardedAvailable).toBe(false);
  });
});

describe('ads and audio', () => {
  it.each(['adsDisabledBasicLaunch', 'adblock'] as const)('never rewards %s errors and hides later ad offers', async (code) => {
    const { sdk } = crazy();
    sdk.ad.requestAd = vi.fn((_type, callbacks) => callbacks.adError?.({ code, message: 'unavailable' }));
    const ads = new Ads();
    await ads.init();
    expect(await ads.rewarded()).toBe(false);
    expect(ads.rewardedAvailable).toBe(false);
    expect(await ads.rewarded()).toBe(false);
    await ads.midgame();
    expect(sdk.ad.requestAd).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('asks a portal for the half-time break too, but not inside its SDK\'s spacing of the last ad that played', async () => {
    const { sdk } = crazy();
    let callbacks!: AdCallbacks;
    const request = vi.fn((_type: string, cb: AdCallbacks) => { callbacks = cb; });
    sdk.ad.requestAd = request;
    const ads = new Ads();
    await ads.init();
    // Nothing has played yet this visit: half time asks, and the ad plays.
    const first = ads.midgame('halftime');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('midgame', expect.anything());
    callbacks.adStarted?.();
    callbacks.adFinished?.();
    await first;
    // Straight after an ad that played, the next half time asks for nothing (the SDK would refuse it anyway) ...
    await ads.midgame('halftime');
    expect(request).toHaveBeenCalledTimes(1);
    // ... a kick-off a minute later still asks (the SDK decides), and one it refuses starts no new wait ...
    vi.advanceTimersByTime(PORTAL_AD_GAP_MS);
    const kickOff = ads.midgame();
    expect(request).toHaveBeenCalledTimes(2);
    callbacks.adError?.({ code: 'adCooldown', message: 'too soon' });
    await kickOff;
    await ads.midgame('halftime');
    expect(request).toHaveBeenCalledTimes(2);
    // ... and once the gap is behind it, half time asks again.
    vi.advanceTimersByTime(PORTAL_HALF_GAP_MS + 1000);
    const again = ads.midgame('halftime');
    expect(request).toHaveBeenCalledTimes(3);
    callbacks.adError?.({ code: 'unfilled', message: 'no inventory' });
    await again;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never back to back: no interstitial before a kick-off within a minute of an ad that played, a rewarded one included', async () => {
    const { sdk } = crazy();
    let callbacks!: AdCallbacks;
    const request = vi.fn((_type: string, cb: AdCallbacks) => { callbacks = cb; });
    sdk.ad.requestAd = request;
    const ads = new Ads();
    const busy = vi.fn();
    ads.onBusy = busy;
    await ads.init();
    // The replay he watched an ad for restarts the match (main.ts again), and the full-time bonus ad is followed by
    // REMATCH then KICK OFF: both come straight to a kick-off.
    const reward = ads.rewarded();
    callbacks.adStarted?.();
    await vi.advanceTimersByTimeAsync(30_000);
    callbacks.adFinished?.();
    expect(await reward).toBe(true);
    busy.mockClear();
    await ads.midgame('match');
    await ads.midgame('moment');
    await ads.midgame('halftime');
    expect(request).toHaveBeenCalledTimes(1);
    // (Nothing was asked for, so the game was never held for it.)
    expect(busy).not.toHaveBeenCalled();
    // The minute is counted from when the ad ENDED, not from when it was asked for.
    vi.advanceTimersByTime(PORTAL_AD_GAP_MS - 1);
    await ads.midgame('match');
    expect(request).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    const kickOff = ads.midgame('match');
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith('midgame', expect.anything());
    callbacks.adStarted?.();
    callbacks.adFinished?.();
    await kickOff;
    // And an interstitial that played holds off the next kick-off's just the same.
    await ads.midgame('match');
    expect(request).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a rewarded ad that never played, or failed, starts no wait: the kick-off still asks', async () => {
    const { sdk } = crazy();
    let callbacks!: AdCallbacks;
    const request = vi.fn((_type: string, cb: AdCallbacks) => { callbacks = cb; });
    sdk.ad.requestAd = request;
    const ads = new Ads();
    await ads.init();
    const missed = ads.rewarded();
    callbacks.adError?.({ code: 'unfilled', message: 'no inventory' });
    expect(await missed).toBe(false);
    const kickOff = ads.midgame('match');
    expect(request).toHaveBeenCalledTimes(2);
    callbacks.adError?.({ code: 'unfilled', message: 'no inventory' });
    await kickOff;
  });

  it(`a Football Moment's retried tries: an interstitial at most every ${APP_AD_MOMENT_GAP_MS / 60_000} minutes on a portal too`, async () => {
    const { sdk } = crazy();
    sdk.ad.requestAd = vi.fn((_type: string, cb: AdCallbacks) => { cb.adStarted?.(); cb.adFinished?.(); });
    const ads = new Ads();
    await ads.init();
    await ads.midgame('moment');
    expect(sdk.ad.requestAd).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(30_000);
      await ads.midgame('moment');
    }
    expect(sdk.ad.requestAd).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(APP_AD_MOMENT_GAP_MS - 180_000);
    await ads.midgame('moment');
    expect(sdk.ad.requestAd).toHaveBeenCalledTimes(2);
  });

  it('an interstitial the SDK never answers holds the game 6 s, not 15, and says it is waiting meanwhile', async () => {
    const { sdk } = crazy();
    sdk.ad.requestAd = () => {};
    const ads = new Ads();
    const calls: string[] = [];
    const mute = vi.fn();
    ads.onMute = mute;
    ads.onBusy = (b) => calls.push(`busy ${b}`);
    ads.onWait = (w) => calls.push(`wait ${w}`);
    await ads.init();
    expect(PORTAL_NO_ANSWER_MS).toEqual({ midgame: 6000, rewarded: 15_000 });
    let done = false;
    void ads.midgame('match').then(() => { done = true; });
    // The wait is told inside the hold: after it begins ...
    expect(calls).toEqual(['busy true', 'wait true']);
    await vi.advanceTimersByTimeAsync(5999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    // ... and before it ends.
    expect(calls).toEqual(['busy true', 'wait true', 'wait false', 'busy false']);
    expect(mute).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    // A rewarded ad is one the player asked for: it keeps its 15 s, and never says it is waiting.
    calls.length = 0;
    let reward: boolean | null = null;
    void ads.rewarded().then((r) => { reward = r; });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(reward).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(reward).toBe(false);
    expect(calls).toEqual(['busy true', 'busy false']);
  });

  it('the wait ends the moment the interstitial starts, and the hold only when it has gone', async () => {
    const { sdk } = crazy();
    let callbacks!: AdCallbacks;
    sdk.ad.requestAd = (_type, cb) => { callbacks = cb; };
    const ads = new Ads();
    const calls: string[] = [];
    ads.onBusy = (b) => calls.push(`busy ${b}`);
    ads.onWait = (w) => calls.push(`wait ${w}`);
    await ads.init();
    const half = ads.midgame('halftime');
    await vi.advanceTimersByTimeAsync(2000);
    callbacks.adStarted?.();
    expect(calls).toEqual(['busy true', 'wait true', 'wait false']);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toEqual(['busy true', 'wait true', 'wait false']);
    callbacks.adFinished?.();
    await half;
    expect(calls).toEqual(['busy true', 'wait true', 'wait false', 'busy false']);
    // One the SDK refuses at once: the same pairs, closed at once.
    calls.length = 0;
    vi.advanceTimersByTime(PORTAL_HALF_GAP_MS);
    const next = ads.midgame('halftime');
    callbacks.adError?.({ code: 'unfilled', message: 'no inventory' });
    await next;
    expect(calls).toEqual(['busy true', 'wait true', 'wait false', 'busy false']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('an interstitial that starts after its 6 s were up still mutes and holds the game, and is not called a wait', async () => {
    const { sdk, events } = crazy();
    let callbacks!: AdCallbacks;
    sdk.ad.requestAd = vi.fn((_type, cb) => { callbacks = cb; });
    const ads = new Ads();
    const calls: string[] = [];
    const mute = vi.fn();
    ads.onMute = mute;
    ads.onBusy = (b) => calls.push(`busy ${b}`);
    ads.onWait = (w) => calls.push(`wait ${w}`);
    await ads.init();
    ads.loadingDone();
    const kickOff = ads.midgame('match');
    await vi.advanceTimersByTimeAsync(6000);
    await kickOff;
    // The match kicked off without it, and is being played when the ad turns up after all.
    ads.gameplayStart();
    calls.length = 0;
    callbacks.adStarted?.();
    expect(mute.mock.calls).toEqual([[true]]);
    expect(calls).toEqual(['busy true']);
    expect(events.at(-1)).toBe('stop');
    callbacks.adFinished?.();
    expect(mute.mock.calls).toEqual([[true], [false]]);
    expect(calls).toEqual(['busy true', 'busy false']);
    expect(events.at(-1)).toBe('start');
    // It played, so it counts for the gap to the next one.
    await ads.midgame('match');
    expect(sdk.ad.requestAd).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a game that throws from its wait callback does not strand the ad or the hold', async () => {
    const { sdk } = crazy();
    sdk.ad.requestAd = (_type, cb) => { cb.adStarted?.(); cb.adFinished?.(); };
    const ads = new Ads();
    const busy = vi.fn();
    ads.onBusy = busy;
    ads.onWait = () => { throw new Error('layer broke'); };
    await ads.init();
    await ads.midgame('match');
    expect(busy.mock.calls).toEqual([[true], [false]]);
  });

  it('Poki: a rewarded ad that played holds off the next kick-off\'s interstitial too', async () => {
    environment('poki');
    const commercialBreak = vi.fn(async (onStart?: () => void) => { onStart?.(); });
    vi.stubGlobal('window', { PokiSDK: {
      init: async () => {}, gameLoadingFinished: vi.fn(), gameplayStart: vi.fn(), gameplayStop: vi.fn(),
      rewardedBreak: async (onStart?: () => void) => { onStart?.(); return true; },
      commercialBreak,
    } });
    const ads = new Ads();
    await ads.init();
    expect(await ads.rewarded()).toBe(true);
    await ads.midgame('match');
    expect(commercialBreak).not.toHaveBeenCalled();
    vi.advanceTimersByTime(PORTAL_AD_GAP_MS);
    await ads.midgame('match');
    expect(commercialBreak).toHaveBeenCalledTimes(1);
    await ads.midgame('match');
    expect(commercialBreak).toHaveBeenCalledTimes(1);
  });

  it('allows a later attempt after an unfilled ad, and only rewards completion', async () => {
    const { sdk } = crazy();
    let callbacks!: AdCallbacks;
    sdk.ad.requestAd = (_type, cb) => { callbacks = cb; };
    const ads = new Ads();
    const mute = vi.fn();
    ads.onMute = mute;
    await ads.init();
    const missed = ads.rewarded();
    callbacks.adError?.({ code: 'unfilled', message: 'no inventory' });
    expect(await missed).toBe(false);
    expect(ads.rewardedAvailable).toBe(true);
    const watched = ads.rewarded();
    callbacks.adStarted?.();
    callbacks.adFinished?.();
    expect(await watched).toBe(true);
    expect(mute.mock.calls).toEqual([[true], [false]]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not unmute a portal-muted game when an ad ends', async () => {
    const { sdk } = crazy();
    sdk.game.settings.muteAudio = true;
    sdk.ad.requestAd = (_type, cb) => { cb.adStarted?.(); cb.adFinished?.(); };
    const ads = new Ads();
    const mute = vi.fn();
    ads.onMute = mute;
    await ads.init();
    expect(await ads.rewarded()).toBe(true);
    expect(mute.mock.calls).toEqual([[true]]);
  });

  it('releases a request that never starts: nothing is muted, nothing granted, and the game gets its input back', async () => {
    const { sdk } = crazy();
    sdk.ad.requestAd = () => {};
    const ads = new Ads();
    const mute = vi.fn();
    const busy = vi.fn();
    ads.onMute = mute;
    ads.onBusy = busy;
    await ads.init();
    const reward = ads.rewarded();
    expect(busy.mock.calls).toEqual([[true]]);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await reward).toBe(false);
    expect(mute).not.toHaveBeenCalled();
    expect(busy.mock.calls).toEqual([[true], [false]]);
    expect(ads.rewardedAvailable).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('an ad that starts after its request was given up on is muted and holds the game until it ends, and pays nothing', async () => {
    const { sdk, events } = crazy();
    let callbacks!: AdCallbacks;
    sdk.ad.requestAd = vi.fn((_type, cb) => { callbacks = cb; });
    const ads = new Ads();
    const mute = vi.fn();
    const busy = vi.fn();
    ads.onMute = mute;
    ads.onBusy = busy;
    await ads.init();
    ads.loadingDone();
    const reward = ads.rewarded();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await reward).toBe(false);
    // The caller moved on and a match is being played when the ad turns up after all.
    ads.gameplayStart();
    expect(events.at(-1)).toBe('start');
    callbacks.adStarted?.();
    expect(mute.mock.calls).toEqual([[true]]);
    expect(busy.mock.calls).toEqual([[true], [false], [true]]);
    expect(events.at(-1)).toBe('stop');
    // Nothing else is asked for while it is up.
    expect(await ads.rewarded()).toBe(false);
    await ads.midgame();
    expect(sdk.ad.requestAd).toHaveBeenCalledTimes(1);
    callbacks.adFinished?.();
    expect(mute.mock.calls).toEqual([[true], [false]]);
    expect(busy.mock.calls).toEqual([[true], [false], [true], [false]]);
    // The match was never paused by the game itself, so play is reported again.
    expect(events.at(-1)).toBe('start');
    // Whatever comes after it ended is ignored.
    callbacks.adError?.({ code: 'adblock', message: 'late error' });
    callbacks.adStarted?.();
    expect(mute.mock.calls).toEqual([[true], [false]]);
    expect(ads.rewardedAvailable).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a late ad that never reports its end gives the game back after two minutes, and a paused game stays stopped', async () => {
    const { sdk, events } = crazy();
    let callbacks!: AdCallbacks;
    sdk.ad.requestAd = (_type, cb) => { callbacks = cb; };
    const ads = new Ads();
    const mute = vi.fn();
    const busy = vi.fn();
    ads.onMute = mute;
    ads.onBusy = busy;
    await ads.init();
    ads.loadingDone();
    void ads.midgame();
    await vi.advanceTimersByTimeAsync(15_000);
    ads.gameplayStart();
    callbacks.adStarted?.();
    // (main.ts pauses the match the ad came up over: the portal is told play stopped, once.)
    ads.gameplayStop();
    expect(events.filter((e) => e === 'stop')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(119_999);
    expect(busy.mock.calls.at(-1)).toEqual([true]);
    await vi.advanceTimersByTimeAsync(1);
    expect(mute.mock.calls).toEqual([[true], [false]]);
    expect(busy.mock.calls.at(-1)).toEqual([false]);
    expect(events.at(-1)).toBe('stop');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a late error after a request was given up on still marks the blocker, and starts nothing', async () => {
    const { sdk } = crazy();
    let callbacks!: AdCallbacks;
    sdk.ad.requestAd = (_type, cb) => { callbacks = cb; };
    const ads = new Ads();
    const mute = vi.fn();
    ads.onMute = mute;
    await ads.init();
    const reward = ads.rewarded();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await reward).toBe(false);
    callbacks.adError?.({ code: 'adblock', message: 'late error' });
    callbacks.adStarted?.();
    expect(mute).not.toHaveBeenCalled();
    expect(ads.adBlocked).toBe(true);
    expect(ads.rewardedAvailable).toBe(false);
  });

  it('waits for a started ad, rejects overlapping requests, and defers gameplay until it finishes', async () => {
    const { sdk, events } = crazy();
    let callbacks!: AdCallbacks;
    sdk.ad.requestAd = vi.fn((_type, cb) => { callbacks = cb; });
    const ads = new Ads();
    await ads.init();
    ads.loadingDone();
    ads.gameplayStart();
    const reward = ads.rewarded();
    callbacks.adStarted?.();
    expect(await ads.rewarded()).toBe(false);
    await ads.midgame();
    ads.gameplayStart();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(events).toEqual(['loading', 'loaded', 'start', 'stop']);
    callbacks.adFinished?.();
    expect(await reward).toBe(true);
    expect(events.at(-1)).toBe('start');
    expect(sdk.ad.requestAd).toHaveBeenCalledTimes(1);
  });

  it('restores sound if a started ad loses its completion callback', async () => {
    const { sdk } = crazy();
    sdk.ad.requestAd = (_type, cb) => { cb.adStarted?.(); };
    const ads = new Ads();
    const mute = vi.fn();
    ads.onMute = mute;
    await ads.init();
    const reward = ads.rewarded();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await reward).toBe(false);
    expect(mute.mock.calls).toEqual([[true], [false]]);
  });

  it('ignores a late Poki ad start after its promise times out', async () => {
    environment('poki');
    let start!: () => void;
    vi.stubGlobal('window', { PokiSDK: {
      init: async () => {}, gameLoadingFinished: vi.fn(), gameplayStart: vi.fn(), gameplayStop: vi.fn(),
      rewardedBreak: (onStart: () => void) => { start = onStart; return new Promise(() => {}); },
    } });
    const ads = new Ads();
    const mute = vi.fn();
    ads.onMute = mute;
    await ads.init();
    const reward = ads.rewarded();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await reward).toBe(false);
    start();
    expect(mute).not.toHaveBeenCalled();
  });
});

describe('ad blockers and the rewarded offers', () => {
  /** Let the SDK's answer to hasAdblock() land (it is not waited for by init). */
  const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

  it('asks CrazyGames once the SDK is up: with a blocker on, rewarded offers are off before any request fails', async () => {
    const { sdk } = crazy();
    sdk.ad.hasAdblock = vi.fn(async () => true);
    const ads = new Ads();
    const changed = vi.fn();
    ads.onAdReady(changed);
    await ads.init();
    await settle();
    expect(sdk.ad.hasAdblock).toHaveBeenCalledTimes(1);
    expect(ads.adBlocked).toBe(true);
    expect(ads.rewardedAvailable).toBe(false);
    expect(ads.rewardedNote).toBe('ADS BLOCKED');
    // (A screen already showing an offer redraws it.)
    expect(changed).toHaveBeenCalledTimes(1);
    expect(sdk.ad.requestAd).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('no blocker: offers are on, and there is nothing to say in their place', async () => {
    const { sdk } = crazy();
    const ads = new Ads();
    await ads.init();
    await settle();
    expect(sdk.ad.hasAdblock).toHaveBeenCalledTimes(1);
    expect(ads.adBlocked).toBe(false);
    expect(ads.rewardedAvailable).toBe(true);
    expect(ads.rewardedNote).toBe('');
  });

  it('the answer is not always right: an ad that plays switches the offers back on', async () => {
    const { sdk } = crazy();
    sdk.ad.hasAdblock = async () => true;
    sdk.ad.requestAd = vi.fn((_type, cb) => { cb.adStarted?.(); cb.adFinished?.(); });
    const ads = new Ads();
    await ads.init();
    await settle();
    expect(ads.rewardedAvailable).toBe(false);
    // The break before a kick-off is still asked for, and it plays.
    await ads.midgame();
    expect(sdk.ad.requestAd).toHaveBeenCalledWith('midgame', expect.anything());
    expect(ads.adBlocked).toBe(false);
    expect(ads.rewardedAvailable).toBe(true);
    expect(await ads.rewarded()).toBe(true);
  });

  it('a request that fails for a blocker marks it, whatever the first answer was', async () => {
    const { sdk } = crazy();
    sdk.ad.requestAd = vi.fn((_type, cb) => cb.adError?.({ code: 'adblock', message: 'blocked' }));
    const ads = new Ads();
    const changed = vi.fn();
    ads.onAdReady(changed);
    await ads.init();
    await settle();
    expect(ads.adBlocked).toBe(false);
    expect(await ads.rewarded()).toBe(false);
    expect(ads.adBlocked).toBe(true);
    expect(ads.rewardedNote).toBe('ADS BLOCKED');
    expect(changed).not.toHaveBeenCalled();
  });

  it('ads switched off for this launch are not a blocker: the offers just have no ad right now', async () => {
    const { sdk } = crazy();
    sdk.ad.requestAd = vi.fn((_type, cb) => cb.adError?.({ code: 'adsDisabledBasicLaunch', message: 'basic launch' }));
    const ads = new Ads();
    await ads.init();
    expect(await ads.rewarded()).toBe(false);
    expect(ads.adBlocked).toBe(false);
    expect(ads.rewardedAvailable).toBe(false);
    expect(ads.rewardedNote).toBe('NO AD RIGHT NOW');
  });

  it.each([
    ['rejects', () => Promise.reject(new Error('no answer'))],
    ['throws', () => { throw new Error('not in this SDK'); }],
    ['never answers', () => new Promise<boolean>(() => {})],
  ] as const)('an adblock check that %s never holds the start up or breaks an offer', async (_what, hasAdblock) => {
    const { sdk, events } = crazy();
    sdk.ad.hasAdblock = hasAdblock as () => Promise<boolean>;
    sdk.ad.requestAd = (_type, cb) => { cb.adStarted?.(); cb.adFinished?.(); };
    const ads = new Ads();
    await ads.init();
    await settle();
    ads.loadingDone();
    expect(events).toEqual(['loading', 'loaded']);
    expect(ads.adBlocked).toBe(false);
    expect(await ads.rewarded()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('the game takes no input from the moment an ad is asked for until it has gone, and the sound only goes when it starts', async () => {
    const { sdk } = crazy();
    let callbacks!: AdCallbacks;
    sdk.ad.requestAd = (_type, cb) => { callbacks = cb; };
    const ads = new Ads();
    const log: string[] = [];
    ads.onBusy = (b) => log.push(b ? 'hold' : 'free');
    ads.onMute = (m) => log.push(m ? 'mute' : 'unmute');
    await ads.init();
    const reward = ads.rewarded();
    expect(log).toEqual(['hold']);
    callbacks.adStarted?.();
    expect(log).toEqual(['hold', 'mute']);
    callbacks.adFinished?.();
    expect(await reward).toBe(true);
    expect(log).toEqual(['hold', 'mute', 'unmute', 'free']);
    // An ad that never comes: held while it is asked for, never muted, and nothing granted.
    const missed = ads.rewarded();
    callbacks.adError?.({ code: 'unfilled', message: 'no inventory' });
    expect(await missed).toBe(false);
    expect(log).toEqual(['hold', 'mute', 'unmute', 'free', 'hold', 'free']);
  });

  it('a game that throws from its hold callback does not strand the ad', async () => {
    const { sdk } = crazy();
    sdk.ad.requestAd = (_type, cb) => { cb.adStarted?.(); cb.adFinished?.(); };
    const ads = new Ads();
    ads.onBusy = () => { throw new Error('screen gone'); };
    await ads.init();
    expect(await ads.rewarded()).toBe(true);
    expect(await ads.rewarded()).toBe(true);
  });

  it('a build without a portal has no rewarded offer, and its ads are never called blocked', async () => {
    vi.stubEnv('VITE_PORTAL', 'none');
    vi.stubGlobal('location', { search: '' });
    vi.stubGlobal('window', {});
    const ads = new Ads();
    await ads.init();
    expect(ads.portal).toBe('none');
    expect(ads.rewardedAvailable).toBe(false);
    expect(ads.adBlocked).toBe(false);
    expect(ads.portalStore()).toBeNull();
    expect(ads.portalUser()).toBeNull();
  });
});

describe('who is playing on CrazyGames (the save is kept per account)', () => {
  /** A user token as CrazyGames issues it: a JWT whose payload carries the account's userId. */
  const jwt = (payload: object): string => `h.${btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.s`;
  type UserModule = NonNullable<CrazySDK['user']>;

  function withUser(user: UserModule | undefined) {
    const { sdk } = crazy();
    sdk.data = { getItem: () => null, setItem: () => {} };
    if (user) sdk.user = user;
    return sdk;
  }

  it('reads the account id out of the token, and nothing out of anything else', () => {
    expect(tokenUserId(jwt({ userId: 'UOuZBKgjwpY9k4TSBB2NPugbsHD3', username: 'RustyCake.ZU9H' }))).toBe('UOuZBKgjwpY9k4TSBB2NPugbsHD3');
    expect(tokenUserId(jwt({ userId: 4471 }))).toBe('4471');
    // (base64url: no padding, and - _ where base64 has + /.)
    expect(tokenUserId(jwt({ userId: 'a?b>c~d', pad: 'x' }))).toBe('a?b>c~d');
    for (const bad of ['', 'not a token', 'a.b', 'a.!!!.c', jwt({ name: 'no id' }), jwt({ userId: { nested: true } }), null, undefined, 42]) expect(tokenUserId(bad)).toBe('');
  });

  it('an SDK without a User module: nobody can be named, and everything else is as it was', async () => {
    withUser(undefined);
    const ads = new Ads();
    await ads.init();
    expect(ads.portal).toBe('crazygames');
    expect(ads.portalUser()).toBeNull();
    expect(ads.portalStore()).not.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a guest is \'\', a signed-in player is his account id', async () => {
    withUser({ getUser: async () => null, getUserToken: async () => { throw new Error('no user'); } });
    const guest = new Ads();
    await guest.init();
    expect(guest.portalUser()).toBe('');
    vi.unstubAllGlobals();
    withUser({ getUser: async () => ({ username: 'bob' }), getUserToken: async () => jwt({ userId: 'acct-b' }) });
    const bob = new Ads();
    await bob.init();
    expect(bob.portalUser()).toBe('acct-b');
    expect(bob.portalStore()).not.toBeNull();
  });

  it('getUser that throws, rejects or never answers: nobody can be named, and the SDK still comes up', async () => {
    for (const getUser of [
      () => { throw new Error('user module down'); },
      () => Promise.reject(new Error('refused')),
      () => new Promise<null>(() => {}),
    ] as UserModule['getUser'][]) {
      vi.unstubAllGlobals();
      const sdk = withUser({ getUser, getUserToken: async () => jwt({ userId: 'x' }) });
      const ads = new Ads();
      let up = false;
      const boot = ads.init().then(() => { up = true; });
      await vi.advanceTimersByTimeAsync(1499);
      // (The store is not handed out before the question is settled: the save waits for who is playing.)
      if (!up) expect(ads.portalStore()).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      await boot;
      expect(ads.portal).toBe('crazygames');
      expect(ads.portalUser()).toBeNull();
      expect(ads.portalStore()).not.toBeNull();
      expect(sdk.game.loadingStart).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it('a token that cannot be had this once is "cannot say", never the username (he must not look like someone else)', async () => {
    for (const getUserToken of [
      async () => 'garbage',
      async () => { throw new Error('token service down'); },
      () => new Promise<string>(() => {}),
    ]) {
      vi.unstubAllGlobals();
      withUser({ getUser: async () => ({ username: 'bob' }), getUserToken });
      const ads = new Ads();
      const boot = ads.init();
      await vi.advanceTimersByTimeAsync(1500);
      await boot;
      expect(ads.portalUser()).toBeNull();
    }
    // An SDK with no tokens at all: the username is all there is, and it is the same every visit.
    vi.unstubAllGlobals();
    withUser({ getUser: async () => ({ username: 'bob' }) });
    const ads = new Ads();
    await ads.init();
    expect(ads.portalUser()).toBe('name:bob');
  });

  it('a guest who signs in mid-visit is heard once, with the account now playing', async () => {
    let who: { username: string } | null = null;
    let token = '';
    let fire!: () => void;
    withUser({
      getUser: async () => who,
      getUserToken: async () => token,
      addAuthListener: (fn) => { fire = () => fn(who); },
    });
    const ads = new Ads();
    const heard: string[] = [];
    ads.onAuth = (uid) => heard.push(uid);
    await ads.init();
    expect(ads.portalUser()).toBe('');
    who = { username: 'bob' };
    token = jwt({ userId: 'acct-b' });
    fire();
    await vi.advanceTimersByTimeAsync(0);
    expect(heard).toEqual(['acct-b']);
    expect(ads.portalUser()).toBe('acct-b');
    // Told again with nothing changed, or with a token that cannot be read: nothing more is said.
    fire();
    token = 'garbage';
    fire();
    await vi.advanceTimersByTimeAsync(0);
    expect(heard).toEqual(['acct-b']);
    expect(ads.portalUser()).toBe('acct-b');
  });

  it('a listener that throws, or a game that throws from onAuth, breaks nothing', async () => {
    let fire!: () => void;
    withUser({
      getUser: async () => ({ username: 'bob' }), getUserToken: async () => jwt({ userId: 'acct-b' }),
      addAuthListener: (fn) => { fire = () => fn(null); },
    });
    const ads = new Ads();
    ads.onAuth = () => { throw new Error('game broke'); };
    await ads.init();
    expect(() => fire()).not.toThrow();
    vi.unstubAllGlobals();
    withUser({ getUser: async () => null, addAuthListener: () => { throw new Error('no listeners here'); } });
    const other = new Ads();
    await other.init();
    expect(other.portalUser()).toBe('');
    expect(other.portalStore()).not.toBeNull();
  });
});

describe('a CrazyGames SDK that is not up in time is tried again behind the game', () => {
  type Tag = { onload?: () => void; onerror?: () => void };

  /** The page, with the SDK's script tags in the test's hands: each one loads or fails when the test says. */
  function slowPage() {
    vi.stubEnv('VITE_PORTAL', 'crazygames');
    vi.stubGlobal('location', { search: '' });
    const tags: Tag[] = [];
    vi.stubGlobal('document', { createElement: () => ({}), head: { appendChild: (t: Tag) => void tags.push(t) } });
    const events: string[] = [];
    const sdk = {
      init: vi.fn(async () => {}), environment: 'local',
      data: { getItem: () => null, setItem: () => {} },
      game: {
        gameplayStart: () => { events.push('start'); }, gameplayStop: () => { events.push('stop'); },
        loadingStart: () => { events.push('loading'); }, loadingStop: () => { events.push('loaded'); },
        happytime: () => {}, settings: { muteAudio: false, disableChat: false }, addSettingsChangeListener: () => {},
      },
      ad: { requestAd: vi.fn(), hasAdblock: async () => false },
    } as unknown as CrazySDK;
    const win: { CrazyGames?: { SDK: CrazySDK } } = {};
    vi.stubGlobal('window', win);
    /** The script has run: the SDK's global is there. */
    const arrive = (tag: Tag): void => {
      win.CrazyGames = { SDK: sdk };
      tag.onload?.();
    };
    return { tags, sdk, events, arrive };
  }

  it('a script that takes 8 s: the game starts without it, and 20 s later it is up with everything that hangs on it', async () => {
    const { tags, sdk, events, arrive } = slowPage();
    const ads = new Ads();
    const late = vi.fn();
    const offers = vi.fn();
    ads.onLate = late;
    ads.onAdReady(offers);
    const boot = ads.init();
    await vi.advanceTimersByTimeAsync(6000);
    await boot;
    // The visit has begun without it: the hub is up and a match is being played.
    expect(ads.portal).toBe('none');
    ads.loadingDone();
    ads.gameplayStart();
    expect(ads.portalStore()).toBeNull();
    await vi.advanceTimersByTimeAsync(2000);
    arrive(tags[0]);
    await vi.advanceTimersByTimeAsync(PORTAL_RETRY_MS - 2001);
    expect(ads.portal).toBe('none');
    expect(events).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(ads.portal).toBe('crazygames');
    // As for an init() that was merely slow: loading, then the play already under way; the offers; the save.
    expect(events).toEqual(['loading', 'loaded', 'start']);
    expect(ads.rewardedAvailable).toBe(true);
    expect(ads.portalStore()).not.toBeNull();
    expect(offers).toHaveBeenCalledTimes(1);
    expect(late).toHaveBeenCalledTimes(1);
    // The script was asked for once, init() called once, and nothing is left ticking.
    expect(tags).toHaveLength(1);
    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('an init() that takes 9 s: waited for again, never called twice', async () => {
    const { tags, sdk, events, arrive } = slowPage();
    const started = deferred<void>();
    sdk.init = vi.fn(() => started.promise);
    const ads = new Ads();
    const late = vi.fn();
    ads.onLate = late;
    const boot = ads.init();
    await vi.advanceTimersByTimeAsync(0);
    arrive(tags[0]);
    await vi.advanceTimersByTimeAsync(6000);
    await boot;
    expect(ads.portal).toBe('none');
    ads.loadingDone();
    await vi.advanceTimersByTimeAsync(3000);
    started.resolve();
    await vi.advanceTimersByTimeAsync(PORTAL_RETRY_MS - 3000);
    expect(ads.portal).toBe('crazygames');
    expect(events).toEqual(['loading', 'loaded']);
    expect(late).toHaveBeenCalledTimes(1);
    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(tags).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a script tag that fails is added again, twice at most; one that then loads brings the SDK up', async () => {
    const { tags, events, arrive } = slowPage();
    const ads = new Ads();
    const late = vi.fn();
    ads.onLate = late;
    const boot = ads.init();
    await vi.advanceTimersByTimeAsync(0);
    tags[0].onerror?.();
    await boot;
    expect(ads.portal).toBe('none');
    ads.loadingDone();
    // 20 s on: a new tag. It fails too, so there is a third, and that one loads.
    await vi.advanceTimersByTimeAsync(PORTAL_RETRY_MS);
    expect(tags).toHaveLength(2);
    tags[1].onerror?.();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(PORTAL_RETRY_MS);
    expect(tags).toHaveLength(3);
    arrive(tags[2]);
    await vi.advanceTimersByTimeAsync(0);
    expect(ads.portal).toBe('crazygames');
    expect(events).toEqual(['loading', 'loaded']);
    expect(late).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a script that never loads at all: three tags, then it is left alone for the visit', async () => {
    const { tags } = slowPage();
    const ads = new Ads();
    const late = vi.fn();
    ads.onLate = late;
    const boot = ads.init();
    await vi.advanceTimersByTimeAsync(0);
    tags[0].onerror?.();
    await boot;
    for (const i of [1, 2]) {
      await vi.advanceTimersByTimeAsync(PORTAL_RETRY_MS);
      tags[i].onerror?.();
      await vi.advanceTimersByTimeAsync(0);
    }
    await vi.advanceTimersByTimeAsync(600_000);
    expect(tags).toHaveLength(3);
    expect(ads.portal).toBe('none');
    expect(late).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(await ads.rewarded()).toBe(false);
  });

  it('a script still on its way after the retry is not asked for again: one tag, one retry', async () => {
    const { tags } = slowPage();
    const ads = new Ads();
    const boot = ads.init();
    await vi.advanceTimersByTimeAsync(6000);
    await boot;
    await vi.advanceTimersByTimeAsync(PORTAL_RETRY_MS + 6000);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(tags).toHaveLength(1);
    expect(ads.portal).toBe('none');
  });

  it('an SDK that answered and said no (disabled, or init refused) is never tried again', async () => {
    for (const refuse of [false, true]) {
      vi.unstubAllGlobals();
      const { sdk } = crazy();
      if (refuse) sdk.init = vi.fn(async () => { throw new Error('blocked'); });
      else sdk.environment = 'disabled';
      const ads = new Ads();
      const late = vi.fn();
      ads.onLate = late;
      await ads.init();
      expect(ads.portal).toBe('none');
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(600_000);
      expect(sdk.init).toHaveBeenCalledTimes(1);
      expect(late).not.toHaveBeenCalled();
    }
  });
});
