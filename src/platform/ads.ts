/**
 * Web-portal monetisation adapter. The same build runs standalone (no ads) or on
 * CrazyGames / Poki, which pay developers a revenue share of the ads they serve.
 *
 * Pick the portal at build time with VITE_PORTAL=crazygames|poki, or at runtime with
 * ?portal=crazygames. Everything fails soft: if an SDK can't load, the game just plays.
 */

type Portal = 'none' | 'crazygames' | 'poki';

interface CrazySDK {
  init(): Promise<void>;
  ad: { requestAd(type: 'midgame' | 'rewarded', cb: { adStarted?: () => void; adFinished?: () => void; adError?: (e: unknown) => void }): void };
  game: { gameplayStart(): void; gameplayStop(): void; happytime(): void; loadingStart?(): void; loadingStop?(): void };
}

interface PokiSDKType {
  init(): Promise<void>;
  gameLoadingFinished(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  commercialBreak(onStart?: () => void): Promise<void>;
  rewardedBreak(onStart?: () => void): Promise<boolean>;
  happyTime?(n: number): void;
}

declare global {
  interface Window {
    CrazyGames?: { SDK: CrazySDK };
    PokiSDK?: PokiSDKType;
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

export class Ads {
  portal: Portal = 'none';
  private ok = false;
  private playing = false;
  private lastMidgame = 0;
  onMute: (muted: boolean) => void = () => {};

  async init(): Promise<void> {
    const q = new URLSearchParams(location.search).get('portal');
    const env = (import.meta.env.VITE_PORTAL as string | undefined) ?? '';
    const want = (q || env || 'none') as Portal;
    try {
      if (want === 'crazygames') {
        await withTimeout(loadScript('https://sdk.crazygames.com/crazygames-sdk-v3.js'), 6000, undefined);
        if (window.CrazyGames?.SDK) {
          await withTimeout(window.CrazyGames.SDK.init(), 6000, undefined);
          this.portal = 'crazygames';
          this.ok = true;
        }
      } else if (want === 'poki') {
        await withTimeout(loadScript('https://game-cdn.poki.com/scripts/v2/poki-sdk.js'), 6000, undefined);
        if (window.PokiSDK) {
          await withTimeout(window.PokiSDK.init(), 6000, undefined);
          this.portal = 'poki';
          this.ok = true;
        }
      }
    } catch {
      this.ok = false;
      this.portal = 'none';
    }
  }

  /** Rewarded ads only exist on portals. */
  get rewardedAvailable(): boolean {
    return this.ok;
  }

  loadingDone(): void {
    if (!this.ok) return;
    if (this.portal === 'poki') window.PokiSDK?.gameLoadingFinished();
    if (this.portal === 'crazygames') window.CrazyGames?.SDK.game.loadingStop?.();
  }

  gameplayStart(): void {
    if (!this.ok || this.playing) return;
    this.playing = true;
    if (this.portal === 'poki') window.PokiSDK?.gameplayStart();
    if (this.portal === 'crazygames') window.CrazyGames?.SDK.game.gameplayStart();
  }

  gameplayStop(): void {
    if (!this.ok || !this.playing) return;
    this.playing = false;
    if (this.portal === 'poki') window.PokiSDK?.gameplayStop();
    if (this.portal === 'crazygames') window.CrazyGames?.SDK.game.gameplayStop();
  }

  happyTime(): void {
    if (!this.ok) return;
    if (this.portal === 'crazygames') window.CrazyGames?.SDK.game.happytime();
    if (this.portal === 'poki') window.PokiSDK?.happyTime?.(1);
  }

  /** Interstitial at a natural break (after full time). Rate-limited to one per 3 minutes. */
  async midgame(): Promise<void> {
    if (!this.ok) return;
    const now = performance.now();
    if (now - this.lastMidgame < 180_000) return;
    this.lastMidgame = now;
    this.gameplayStop();
    try {
      if (this.portal === 'poki') {
        await withTimeout(window.PokiSDK!.commercialBreak(() => this.onMute(true)), 45_000, undefined);
      } else if (this.portal === 'crazygames') {
        await withTimeout(
          new Promise<void>((resolve) =>
            window.CrazyGames!.SDK.ad.requestAd('midgame', {
              adStarted: () => this.onMute(true),
              adFinished: () => resolve(),
              adError: () => resolve(),
            }),
          ),
          45_000,
          undefined,
        );
      }
    } finally {
      this.onMute(false);
    }
  }

  /** Opt-in rewarded ad. Resolves true only if the player watched it through. */
  async rewarded(): Promise<boolean> {
    if (!this.ok) return false;
    this.gameplayStop();
    try {
      if (this.portal === 'poki') {
        return await withTimeout(window.PokiSDK!.rewardedBreak(() => this.onMute(true)), 60_000, false);
      }
      if (this.portal === 'crazygames') {
        return await withTimeout(
          new Promise<boolean>((resolve) =>
            window.CrazyGames!.SDK.ad.requestAd('rewarded', {
              adStarted: () => this.onMute(true),
              adFinished: () => resolve(true),
              adError: () => resolve(false),
            }),
          ),
          60_000,
          false,
        );
      }
      return false;
    } finally {
      this.onMute(false);
    }
  }
}

export const ads = new Ads();
