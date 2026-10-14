import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AD_WAIT_LINE_MS, adHold, adHoldState, adWait } from '../src/ui/adHold';
import { Ads } from '../src/platform/ads';

/** Just enough of an element for the layer: its children, its listeners and whether it is still in the page. */
class El extends EventTarget {
  className = '';
  textContent = '';
  style = { cssText: '' };
  attrs: Record<string, string> = {};
  children: El[] = [];
  parent: El | null = null;
  appendChild(c: El): void {
    c.parent = this;
    this.children.push(c);
  }
  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  setAttribute(k: string, v: string): void { this.attrs[k] = v; }
}

let body: El;
beforeEach(() => {
  vi.useFakeTimers();
  body = new El();
  vi.stubGlobal('document', { body, createElement: () => new El() });
});
afterEach(() => {
  adHold(false);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const layer = (): El | undefined => body.children.find((c) => c.className === 'ad-hold');
const words = (): string[] => (layer()?.children ?? []).map((c) => c.textContent);

describe('the hold over the game while an ad is asked for or up', () => {
  it('one transparent full-screen layer just above the game\'s own screens, and gone with the ad', () => {
    adHold(true);
    adHold(true);
    expect(body.children).toHaveLength(1);
    const css = layer()!.style.cssText;
    for (const rule of ['position:fixed', 'top:0', 'left:0', 'right:0', 'bottom:0', 'background:transparent', 'pointer-events:auto', 'touch-action:none']) expect(css).toContain(rule);
    // #ui is z-index 2 (style.css): above it and the canvas, and no higher, so an SDK's own ad stays on top.
    expect(css).toContain('z-index:3;');
    expect(adHoldState()).toEqual({ up: true, line: false, pending: false });
    adHold(false);
    adHold(false);
    expect(body.children).toHaveLength(0);
    expect(adHoldState()).toEqual({ up: false, line: false, pending: false });
  });

  it('a tap, a click, a touch or the wheel on it goes no further (the pitch\'s own canvas is under it)', () => {
    adHold(true);
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'click', 'touchstart', 'touchend', 'contextmenu', 'wheel']) {
      const e = new Event(type, { cancelable: true, bubbles: true });
      const stop = vi.spyOn(e, 'stopPropagation');
      layer()!.dispatchEvent(e);
      expect(e.defaultPrevented, type).toBe(true);
      expect(stop, type).toHaveBeenCalled();
    }
  });

  it(`ONE MOMENT only once the wait has lasted ${AD_WAIT_LINE_MS} ms, in the middle, and gone when the ad starts`, () => {
    adHold(true);
    adWait(true);
    vi.advanceTimersByTime(AD_WAIT_LINE_MS - 1);
    expect(words()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(words()).toEqual(['ONE MOMENT']);
    expect(layer()!.style.cssText).toContain('align-items:center;justify-content:center;');
    expect(layer()!.children[0].attrs.role).toBe('status');
    // Asked again while it shows: still one line.
    adWait(true);
    vi.advanceTimersByTime(5000);
    expect(words()).toEqual(['ONE MOMENT']);
    // The ad starts: the line goes, the layer stays until the ad has gone.
    adWait(false);
    expect(words()).toEqual([]);
    expect(adHoldState()).toEqual({ up: true, line: false, pending: false });
    adHold(false);
    expect(body.children).toHaveLength(0);
  });

  it('an ad that comes at once never flashes the line', () => {
    adHold(true);
    adWait(true);
    vi.advanceTimersByTime(200);
    adWait(false);
    vi.advanceTimersByTime(5000);
    expect(words()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('taking the layer down takes the line and its timer with it, whichever came first', () => {
    adHold(true);
    adWait(true);
    adHold(false);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(body.children).toHaveLength(0);
    adHold(true);
    adWait(true);
    vi.advanceTimersByTime(AD_WAIT_LINE_MS);
    expect(words()).toEqual(['ONE MOMENT']);
    adHold(false);
    expect(body.children).toHaveLength(0);
    expect(adHoldState()).toEqual({ up: false, line: false, pending: false });
    // The next hold starts clean.
    adHold(true);
    expect(words()).toEqual([]);
    // A wait told with no layer up shows nothing, and leaves nothing behind.
    adHold(false);
    adWait(true);
    vi.advanceTimersByTime(AD_WAIT_LINE_MS);
    expect(body.children).toHaveLength(0);
    adWait(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the layer through a real CrazyGames request (main.ts: onBusy = adShield, onWait = adWait)', () => {
  type CrazySDK = NonNullable<Window['CrazyGames']>['SDK'];
  type AdCallbacks = Parameters<CrazySDK['ad']['requestAd']>[1];

  async function boot() {
    vi.stubEnv('VITE_PORTAL', 'crazygames');
    vi.stubGlobal('location', { search: '' });
    const head = { appendChild: (s: { onload?: () => void }) => void Promise.resolve().then(() => s.onload?.()) };
    vi.stubGlobal('document', { body, head, createElement: () => new El() });
    const slot: { cb?: AdCallbacks } = {};
    const sdk = {
      init: async () => {}, environment: 'local',
      game: {
        gameplayStart: vi.fn(), gameplayStop: vi.fn(), loadingStart: vi.fn(), loadingStop: vi.fn(), happytime: vi.fn(),
        settings: { muteAudio: false, disableChat: false }, addSettingsChangeListener: vi.fn(),
      },
      ad: { requestAd: (_t: string, cb: AdCallbacks) => { slot.cb = cb; }, hasAdblock: async () => false },
    } as unknown as CrazySDK;
    vi.stubGlobal('window', { CrazyGames: { SDK: sdk } });
    const ads = new Ads();
    ads.onBusy = adHold;
    ads.onWait = adWait;
    await ads.init();
    return { ads, slot };
  }

  it('a silent SDK: the layer at once, ONE MOMENT after 0.6 s, and both gone when the 6 s are up', async () => {
    const { ads } = await boot();
    const kickOff = ads.midgame('match');
    expect(adHoldState()).toEqual({ up: true, line: false, pending: true });
    await vi.advanceTimersByTimeAsync(AD_WAIT_LINE_MS);
    expect(words()).toEqual(['ONE MOMENT']);
    await vi.advanceTimersByTimeAsync(6000 - AD_WAIT_LINE_MS);
    await kickOff;
    expect(body.children).toHaveLength(0);
    expect(adHoldState()).toEqual({ up: false, line: false, pending: false });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('every way a request can end takes the layer down: played, failed, never finished, started late', async () => {
    const { ads, slot } = await boot();
    // Played.
    let ad = ads.midgame('halftime');
    await vi.advanceTimersByTimeAsync(1000);
    expect(words()).toEqual(['ONE MOMENT']);
    slot.cb!.adStarted?.();
    expect(adHoldState()).toEqual({ up: true, line: false, pending: false });
    slot.cb!.adFinished?.();
    await ad;
    expect(body.children).toHaveLength(0);
    // Failed (a rewarded one: held, and never a line).
    const reward = ads.rewarded();
    await vi.advanceTimersByTimeAsync(3000);
    expect(adHoldState()).toEqual({ up: true, line: false, pending: false });
    slot.cb!.adError?.({ code: 'unfilled', message: 'no inventory' });
    expect(await reward).toBe(false);
    expect(body.children).toHaveLength(0);
    // Started, and its end never reported: two minutes at most.
    await vi.advanceTimersByTimeAsync(60_000);
    ad = ads.midgame('match');
    expect(adHoldState().up).toBe(true);
    slot.cb!.adStarted?.();
    await vi.advanceTimersByTimeAsync(119_999);
    expect(adHoldState().up).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    await ad;
    expect(body.children).toHaveLength(0);
    // Given up on after 6 s, then started late over the running game: held again, and let go when it ends.
    await vi.advanceTimersByTimeAsync(300_000);
    ad = ads.midgame('match');
    expect(adHoldState().up).toBe(true);
    await vi.advanceTimersByTimeAsync(6000);
    await ad;
    expect(body.children).toHaveLength(0);
    slot.cb!.adStarted?.();
    expect(adHoldState()).toEqual({ up: true, line: false, pending: false });
    slot.cb!.adFinished?.();
    expect(body.children).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
