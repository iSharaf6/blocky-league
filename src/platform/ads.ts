/**
 * Monetisation adapter. The same build runs standalone (no ads), on CrazyGames / Poki (which pay developers a
 * revenue share of the ads they serve), or inside the iPhone / iPad app, where Google AdMob serves them ('app').
 *
 * Pick the portal at build time with VITE_PORTAL=crazygames|poki (npm run build:crazygames / build:poki).
 * In dev (VITE_PORTAL unset) ?portal=crazygames|poki switches at runtime. Portal builds contain only
 * their own SDK: the checks below compare the build-time constant, so the minifier drops the other branch.
 * The app is the itch build (VITE_PORTAL 'none') inside Capacitor: it loads the AdMob plugin only there.
 * Everything fails soft: if an SDK can't load, is blocked, or throws, the game just plays.
 */
import type { AdMobPlugin } from '@capacitor-community/admob';
import { ADMOB_IOS, ADMOB_KID_SAFE, ADMOB_TEST_IDS } from './adConfig';
import { inNativeApp } from './native';

type Portal = 'none' | 'crazygames' | 'poki' | 'app';
type AppAd = 'rewarded' | 'interstitial';
type AdMobModule = typeof import('@capacitor-community/admob');

/**
 * App interstitials, our own cap (the portals cap theirs): one at most every APP_AD_EVERY natural breaks and never
 * within APP_AD_GAP_MS of the last, so a session's first matches run clean and nobody sees one every match.
 */
export const APP_AD_EVERY = 2;
export const APP_AD_GAP_MS = 240_000;
/** Longest a full-screen ad may hold the game before it carries on regardless. */
const APP_AD_MAX_MS = 180_000;

interface CrazyAdError {
  code: 'adsDisabledBasicLaunch' | 'unfilled' | 'adblock' | 'adCooldown' | 'other';
  message: string;
}
interface CrazySettings {
  muteAudio: boolean;
  disableChat: boolean;
}
/** CrazyGames' Data Module: a localStorage-like store kept with the player's CrazyGames account. */
export interface PortalStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
interface CrazySDK {
  init(): Promise<void>;
  environment: 'local' | 'crazygames' | 'disabled';
  data?: PortalStore;
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
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    p.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
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
  private wantsGameplay = false;
  private initPromise: Promise<void> | null = null;
  private adsAllowed = true;
  private adInFlight = false;
  private loaded = false;
  private loadedSent = false;
  private adMuted = false;
  private settingsMuted = false;
  private muted = false;
  /** true = all game audio must be silent (ad playing, or CrazyGames muteAudio setting); false = may play. */
  onMute: (muted: boolean) => void = () => {};
  /**
   * true = the player owns NO ADS (platform/iap.ts adFree): no interstitial is ever requested. Rewarded ads are
   * opt-in rewards, not interruptions, so they stay available. main.ts points it at the live save.
   */
  adFree: () => boolean = () => false;

  // ---- the app's AdMob state ('app' only)
  private admob: AdMobPlugin | null = null;
  private admobMod: AdMobModule | null = null;
  private appLoaded: Record<AppAd, boolean> = { rewarded: false, interstitial: false };
  private appLoading: Record<AppAd, boolean> = { rewarded: false, interstitial: false };
  private appRetry: Record<AppAd, number> = { rewarded: 0, interstitial: 0 };
  /** Natural breaks since the last app interstitial, and when that one played (ms, Date.now). */
  private appBreaks = 0;
  private appLastAt = -Infinity;
  private readyFns = new Set<() => void>();

  /** `fn` runs whenever an app ad finishes loading (the shop redraws its FREE COINS card). Returns the unsubscribe. */
  onAdReady(fn: () => void): () => void {
    this.readyFns.add(fn);
    return () => void this.readyFns.delete(fn);
  }

  /**
   * The portal's own save store once its SDK is up (CrazyGames' Data Module: progress follows a signed-in player to
   * any device), else null. The save mirrors itself there (core/save.ts adoptPortalStore).
   */
  portalStore(): PortalStore | null {
    if (this.portal !== 'crazygames') return null;
    const d = window.CrazyGames?.SDK?.data;
    return d && typeof d.getItem === 'function' && typeof d.setItem === 'function' ? d : null;
  }

  init(): Promise<void> {
    // Boot and previews may both ask to initialize. Load just one SDK/listener.
    return this.initPromise ??= this.initPortal();
  }

  private async initPortal(): Promise<void> {
    const q = new URLSearchParams(location.search).get('portal');
    try {
      if ((!import.meta.env.VITE_PORTAL || import.meta.env.VITE_PORTAL === 'none') && inNativeApp()) {
        await this.initApp();
      } else if (import.meta.env.VITE_PORTAL === 'crazygames' || (!import.meta.env.VITE_PORTAL && q === 'crazygames')) {
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
    this.syncGameplay();
  }

  /**
   * Google's AdMob in the app. EEA / UK players first get Google's consent form where the law asks for one (the UMP
   * message set up in the AdMob console); kid-safe settings (adConfig.ts) go on every request. Both ad kinds are
   * loaded ahead, and loaded again after each one plays.
   */
  private async initApp(): Promise<void> {
    // (A literal check, so the portal builds drop the plugin and its chunks altogether.)
    if (import.meta.env.VITE_PORTAL && import.meta.env.VITE_PORTAL !== 'none') return;
    const m = await withTimeout(import('@capacitor-community/admob'), 8000, null);
    if (!m) return;
    const A = m.AdMob;
    try {
      let info = await withTimeout(A.requestConsentInfo({ tagForUnderAgeOfConsent: ADMOB_KID_SAFE }), 8000, null);
      if (info && info.status === m.AdmobConsentStatus.REQUIRED && info.isConsentFormAvailable) info = await A.showConsentForm();
      if (info && !info.canRequestAds) return;
    } catch {
      // (No consent message set up yet, or offline: ads may still be requested where none is needed.)
    }
    const kid = ADMOB_KID_SAFE;
    await withTimeout(A.initialize({
      tagForChildDirectedTreatment: kid,
      tagForUnderAgeOfConsent: kid,
      maxAdContentRating: kid ? m.MaxAdContentRating.General : m.MaxAdContentRating.ParentalGuidance,
      initializeForTesting: ADMOB_TEST_IDS,
    }), 10_000, undefined);
    this.admob = A;
    this.admobMod = m;
    this.portal = 'app';
    this.ok = true;
    this.prepareApp('rewarded');
    this.prepareApp('interstitial');
  }

  /** Load the next ad of a kind; a failed load tries again later (15 s, doubling, at most 5 min apart). */
  private prepareApp(kind: AppAd): void {
    const A = this.admob;
    if (!A || this.appLoading[kind] || this.appLoaded[kind]) return;
    this.appLoading[kind] = true;
    const opts = { adId: ADMOB_IOS[kind], npa: true };
    const load = kind === 'rewarded' ? A.prepareRewardVideoAd(opts) : A.prepareInterstitial(opts);
    load.then(
      () => {
        this.appLoading[kind] = false;
        this.appLoaded[kind] = true;
        this.appRetry[kind] = 0;
        for (const fn of this.readyFns) safe(fn);
      },
      () => {
        this.appLoading[kind] = false;
        const n = ++this.appRetry[kind];
        setTimeout(() => this.prepareApp(kind), Math.min(300_000, 15_000 * 2 ** (n - 1)));
      },
    );
  }

  /**
   * Show a loaded app ad; resolves when it is gone (closed, failed, or APP_AD_MAX_MS passed): true only if a
   * rewarded one paid out. (The plugin's show call for a rewarded ad only ever resolves on the reward, so the
   * dismissal is what ends it.)
   */
  private showApp(kind: AppAd): Promise<boolean> {
    const A = this.admob!;
    const M = this.admobMod!;
    this.appLoaded[kind] = false;
    return new Promise<boolean>((resolve) => {
      let earned = false;
      let done = false;
      const handles: { remove(): Promise<void> }[] = [];
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        for (const h of handles) void h.remove().catch(() => {});
        this.prepareApp(kind);
        resolve(earned);
      };
      const timer = setTimeout(finish, APP_AD_MAX_MS);
      const listen = async () => {
        if (kind === 'rewarded') {
          const E = M.RewardAdPluginEvents;
          handles.push(await A.addListener(E.Rewarded, () => { earned = true; }));
          handles.push(await A.addListener(E.Dismissed, finish));
          handles.push(await A.addListener(E.FailedToShow, finish));
        } else {
          const E = M.InterstitialAdPluginEvents;
          handles.push(await A.addListener(E.Dismissed, finish));
          handles.push(await A.addListener(E.FailedToShow, finish));
        }
      };
      listen().then(() => {
        if (done) return;
        this.setAdMute(true);
        const show = kind === 'rewarded' ? A.showRewardVideoAd().then(() => { earned = true; }) : A.showInterstitial();
        show.catch(finish);
      }, finish);
    });
  }

  /** Rewarded ads: on the portals, and in the app once one has loaded (asking for the next if not). */
  get rewardedAvailable(): boolean {
    if (this.portal === 'app') {
      if (!this.appLoaded.rewarded) this.prepareApp('rewarded');
      return this.ok && this.appLoaded.rewarded;
    }
    return this.ok && this.adsAllowed;
  }

  /** This build can show interstitial ads at all (so NO ADS is worth selling in it; see ui/shop.ts). */
  get showsInterstitials(): boolean {
    return this.ok && this.adsAllowed;
  }

  /** Call once the title screen is interactive. Safe to call before init() has finished. */
  loadingDone(): void {
    this.loaded = true;
    if (this.ok) this.sendLoaded();
    this.syncGameplay();
  }

  private sendLoaded(): void {
    if (this.loadedSent || !this.ok) return;
    this.loadedSent = true;
    if (this.portal === 'poki') safe(() => window.PokiSDK!.gameLoadingFinished());
    if (this.portal === 'crazygames') safe(() => window.CrazyGames!.SDK.game.loadingStop());
  }

  gameplayStart(): void {
    // The title remains playable if SDK initialization takes longer than boot's
    // deadline. Remember the current state so its first gameplay event is not lost.
    this.wantsGameplay = true;
    this.syncGameplay();
  }

  gameplayStop(): void {
    this.wantsGameplay = false;
    this.syncGameplay();
  }

  private syncGameplay(): void {
    if (!this.ok || !this.loadedSent || this.adInFlight || this.playing === this.wantsGameplay) return;
    this.playing = this.wantsGameplay;
    if (this.portal === 'poki') safe(() => this.playing ? window.PokiSDK!.gameplayStart() : window.PokiSDK!.gameplayStop());
    if (this.portal === 'crazygames') safe(() => this.playing ? window.CrazyGames!.SDK.game.gameplayStart() : window.CrazyGames!.SDK.game.gameplayStop());
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
    if (!this.ok || !this.adsAllowed || this.adInFlight || this.adFree()) return;
    if (this.portal === 'app') {
      // Our own cap (APP_AD_EVERY breaks, APP_AD_GAP_MS apart), and only an ad that is already loaded.
      this.appBreaks++;
      if (this.appBreaks < APP_AD_EVERY || Date.now() - this.appLastAt < APP_AD_GAP_MS || !this.appLoaded.interstitial) {
        this.prepareApp('interstitial');
        return;
      }
      this.appBreaks = 0;
      this.appLastAt = Date.now();
    }
    this.gameplayStop();
    this.adInFlight = true;
    let active = true;
    try {
      if (this.portal === 'app') {
        await this.showApp('interstitial');
      } else if (this.portal === 'poki') {
        await withTimeout(window.PokiSDK!.commercialBreak(() => { if (active) this.setAdMute(true); }), 45_000, undefined);
      } else if (this.portal === 'crazygames') {
        await this.crazyAd('midgame');
      }
    } catch {
      /* an ad failure never blocks play */
    } finally {
      active = false;
      this.adInFlight = false;
      this.setAdMute(false);
      this.syncGameplay();
    }
  }

  /** Opt-in rewarded ad. Resolves true only if the player watched it through. */
  async rewarded(): Promise<boolean> {
    if (!this.ok || !this.adsAllowed || this.adInFlight) return false;
    this.gameplayStop();
    this.adInFlight = true;
    let active = true;
    try {
      if (this.portal === 'app') {
        if (!this.appLoaded.rewarded) {
          this.prepareApp('rewarded');
          return false;
        }
        return await this.showApp('rewarded');
      }
      if (this.portal === 'poki') {
        return await withTimeout(window.PokiSDK!.rewardedBreak(() => { if (active) this.setAdMute(true); }), 60_000, false);
      }
      if (this.portal === 'crazygames') {
        return await this.crazyAd('rewarded');
      }
      return false;
    } catch {
      return false;
    } finally {
      active = false;
      this.adInFlight = false;
      this.setAdMute(false);
      this.syncGameplay();
    }
  }

  private crazyAd(type: 'midgame' | 'rewarded'): Promise<boolean> {
    return new Promise((resolve) => {
      let finished = false;
      // Give a started video time to finish. A missing SDK callback must still
      // release the UI, without allowing a later callback to mute it forever.
      let timer = setTimeout(() => finish(false), 15_000);
      const finish = (watched: boolean) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve(watched);
      };
      try {
        window.CrazyGames!.SDK.ad.requestAd(type, {
          adStarted: () => {
            if (finished) return;
            clearTimeout(timer);
            timer = setTimeout(() => finish(false), 120_000);
            this.setAdMute(true);
          },
          adFinished: () => finish(true),
          adError: (error) => {
            if (finished) return;
            if (error.code === 'adsDisabledBasicLaunch' || error.code === 'adblock') this.adsAllowed = false;
            finish(false); // never grant a reward for an error
          },
        });
      } catch {
        finish(false);
      }
    });
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
