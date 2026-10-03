import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ads } from '../src/platform/ads';

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

  it('keeps the portals to their one break before a kick-off (the half-time ad is the app\'s)', async () => {
    const { sdk } = crazy();
    sdk.ad.requestAd = vi.fn((_type, callbacks) => callbacks.adFinished?.());
    const ads = new Ads();
    await ads.init();
    await ads.midgame('halftime');
    expect(sdk.ad.requestAd).not.toHaveBeenCalled();
    await ads.midgame();
    expect(sdk.ad.requestAd).toHaveBeenCalledWith('midgame', expect.anything());
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

  it('releases a request that never starts and ignores all late callbacks', async () => {
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
    callbacks.adStarted?.();
    callbacks.adFinished?.();
    callbacks.adError?.({ code: 'adblock', message: 'late error' });
    expect(mute).not.toHaveBeenCalled();
    expect(ads.rewardedAvailable).toBe(true);
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
