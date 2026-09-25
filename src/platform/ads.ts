/**
 * Web-portal monetisation adapter. The same build runs standalone (no ads) or on
 * CrazyGames / Poki, which pay developers a revenue share of the ads they serve.
 *
 * Pick the portal at build time with VITE_PORTAL=crazygames|poki (npm run build:crazygames / build:poki).
 * In dev (VITE_PORTAL unset) ?portal=crazygames|poki switches at runtime. Portal builds contain only
 * their own SDK: the checks below compare the build-time constant, so the minifier drops the other branch.
 * Everything fails soft: if an SDK can't load, is blocked, or throws, the game just plays.
 */

type Portal = 'none' | 'crazygames' | 'poki';

interface CrazyAdError {
  code: 'adsDisabledBasicLaunch' | 'unfilled' | 'adblock' | 'adCooldown' | 'other';
  message: string;
}
interface CrazySettings {
  muteAudio: boolean;
  disableChat: boolean;
}
interface CrazySDK {
  init(): Promise<void>;
  environment: 'local' | 'crazygames' | 'disabled';
  ad: {
    requestAd(type: 'midgame' | 'rewarded', cb: { adStarted?: () => void; adFinished?: () => void; adError?: (e: CrazyAdError) => void }): void;
    hasAdblock(): Promise<boolean>;
  };
  game: {
    gameplayStart(): void;
    gameplayStop(): void;
    happytime(): void;
    loadingStart(): void;
    loadingStop(): void;
    settings: CrazySettings;
    addSettingsChangeListener(fn: (s: CrazySettings) => void): void;
  };
}

interface PokiSDKType {
  init(): Promise<void>;
  gameLoadingFinished(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  commercialBreak(onStart?: () => void): Promise<void>;
  rewardedBreak(onStart?: () => void): Promise<boolean>;
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

/** true if the promise resolved in time, false if it rejected or timed out (e.g. blocked by an adblocker). */
function settled(p: Promise<unknown>, ms: number): Promise<boolean> {
  return withTimeout(p.then(() => true, () => false), ms, false);
}

/** A portal SDK hiccup must never break the game. */
function safe(fn: () => void): void {
  try {
    fn();
  } catch {
    /* ignore */
  }
}

export class Ads {
  portal: Portal = 'none';
  private ok = false;
  private playing = false;
  private loaded = false;
  private loadedSent = false;
  private adMuted = false;
  private settingsMuted = false;
  private muted = false;
  /** true = all game audio must be silent (ad playing, or CrazyGames muteAudio setting); false = may play. */
  onMute: (muted: boolean) => void = () => {};

  async init(): Promise<void> {
    const q = new URLSearchParams(location.search).get('portal');
    try {
      if (import.meta.env.VITE_PORTAL === 'crazygames' || (!import.meta.env.VITE_PORTAL && q === 'crazygames')) {
        await withTimeout(loadScript('https://sdk.crazygames.com/crazygames-sdk-v3.js'), 6000, undefined);
        const sdk = window.CrazyGames?.SDK;
        // Off CrazyGames' domains (and not localhost) the SDK is 'disabled' and every call throws.
        if (sdk && (await settled(sdk.init(), 6000)) && sdk.environment !== 'disabled') {
          this.portal = 'crazygames';
          this.ok = true;
          safe(() => sdk.game.loadingStart());
          safe(() => {
            this.settingsMuted = !!sdk.game.settings.muteAudio;
            sdk.game.addSettingsChangeListener((s) => {
              this.settingsMuted = !!s.muteAudio;
              this.syncMute();
            });
          });
          this.syncMute();
        }
      } else if (import.meta.env.VITE_PORTAL === 'poki' || (!import.meta.env.VITE_PORTAL && q === 'poki')) {
        await withTimeout(loadScript('https://game-cdn.poki.com/scripts/v2/poki-sdk.js'), 6000, undefined);
        // init() rejects (or, with some adblockers, never settles): play on without ads either way.
        if (window.PokiSDK && (await settled(window.PokiSDK.init(), 6000))) {
          this.portal = 'poki';
          this.ok = true;
        }
      }
    } catch {
      this.ok = false;
      this.portal = 'none';
    }
    if (this.loaded) this.sendLoaded();
  }

  /** Rewarded ads only exist on portals. */
  get rewardedAvailable(): boolean {
    return this.ok;
  }

  /** Call once the title screen is interactive. Safe to call before init() has finished. */
  loadingDone(): void {
    this.loaded = true;
    if (this.ok) this.sendLoaded();
  }

  private sendLoaded(): void {
    if (this.loadedSent || !this.ok) return;
    this.loadedSent = true;
    if (this.portal === 'poki') safe(() => window.PokiSDK!.gameLoadingFinished());
    if (this.portal === 'crazygames') safe(() => window.CrazyGames!.SDK.game.loadingStop());
  }

  gameplayStart(): void {
    if (!this.ok || this.playing) return;
    this.playing = true;
    if (this.portal === 'poki') safe(() => window.PokiSDK!.gameplayStart());
    if (this.portal === 'crazygames') safe(() => window.CrazyGames!.SDK.game.gameplayStart());
  }

  gameplayStop(): void {
    if (!this.ok || !this.playing) return;
    this.playing = false;
    if (this.portal === 'poki') safe(() => window.PokiSDK!.gameplayStop());
    if (this.portal === 'crazygames') safe(() => window.CrazyGames!.SDK.game.gameplayStop());
  }

  /** CrazyGames celebration for a real achievement; use sparingly. Poki has no HTML5 equivalent. */
  happyTime(): void {
    if (this.ok && this.portal === 'crazygames') safe(() => window.CrazyGames!.SDK.game.happytime());
  }

  /**
   * Interstitial at a natural break, just before gameplay resumes (next kick-off / second half).
   * No local cooldown: both SDKs decide whether an ad actually plays (CrazyGames caps at 1 per 3 min).
   */
  async midgame(): Promise<void> {
    if (!this.ok) return;
    this.gameplayStop();
    try {
      if (this.portal === 'poki') {
        await withTimeout(window.PokiSDK!.commercialBreak(() => this.setAdMute(true)), 45_000, undefined);
      } else if (this.portal === 'crazygames') {
        await withTimeout(
          new Promise<void>((resolve) => {
            try {
              window.CrazyGames!.SDK.ad.requestAd('midgame', {
                adStarted: () => this.setAdMute(true),
                adFinished: () => resolve(),
                adError: () => resolve(),
              });
            } catch {
              resolve();
            }
          }),
          45_000,
          undefined,
        );
      }
    } catch {
      /* an ad failure never blocks play */
    } finally {
      this.setAdMute(false);
    }
  }

  /** Opt-in rewarded ad. Resolves true only if the player watched it through. */
  async rewarded(): Promise<boolean> {
    if (!this.ok) return false;
    this.gameplayStop();
    try {
      if (this.portal === 'poki') {
        return await withTimeout(window.PokiSDK!.rewardedBreak(() => this.setAdMute(true)), 60_000, false);
      }
      if (this.portal === 'crazygames') {
        return await withTimeout(
          new Promise<boolean>((resolve) => {
            try {
              window.CrazyGames!.SDK.ad.requestAd('rewarded', {
                adStarted: () => this.setAdMute(true),
                adFinished: () => resolve(true),
                adError: () => resolve(false), // never reward on error
              });
            } catch {
              resolve(false);
            }
          }),
          60_000,
          false,
        );
      }
      return false;
    } catch {
      return false;
    } finally {
      this.setAdMute(false);
    }
  }

  private setAdMute(m: boolean): void {
    this.adMuted = m;
    this.syncMute();
  }

  private syncMute(): void {
    const m = this.adMuted || this.settingsMuted;
    if (m === this.muted) return;
    this.muted = m;
    this.onMute(m);
  }
}

export const ads = new Ads();
