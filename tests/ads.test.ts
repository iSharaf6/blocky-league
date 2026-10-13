import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ads, PORTAL_HALF_GAP_MS } from '../src/platform/ads';

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
    // ... a kick-off still asks (the SDK decides), and one it refuses starts no new wait ...
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
  });
});
