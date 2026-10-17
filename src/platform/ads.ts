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
 * App interstitials, our own policy (the portals cap theirs). The owner: "half time in between breaks should have an
 * ad". One at every half-time (the natural break), and one before the next match's kick-off, but never within
 * APP_AD_GAP_MS of the last ad of any kind (a rewarded one included), counted from when it closed, so two never come
 * back to back. The callers keep them out of the basics, the tutorial and a new player's first match (main.ts);
 * NO ADS owners never see one (adFree).
 */
export const APP_AD_GAP_MS = 90_000;
/**
 * Before a kick-off the gap is longer: the half-time ad is the regular one, so a short match (2 min halves) gets one
 * ad, not two, and the pre-match one only comes back after a longer spell without any (a quick rematch run).
 */
export const APP_AD_MATCH_GAP_MS = 180_000;
/** A Football Moment is a short try, retried often: an interstitial before one at most this often (ms). */
export const APP_AD_MOMENT_GAP_MS = 240_000;
/** Longest a full-screen ad may hold the game before it carries on regardless. */
const APP_AD_MAX_MS = 180_000;

/** Whole matches a save must have behind it before its first interstitial: a new player plays, and is not sold to. */
export const AD_FREE_MATCHES = 2;
/** A result screen is left alone this long before the next kick-off may bring an interstitial (ms). */
export const AD_AFTER_RESULT_MS = 8000;

/**
 * May an interstitial be asked for before this kick-off (main.ts startMatch, the only place one ever is)? Only at
 * that natural break: never as the first thing of a visit, never straight off a result screen, never in or after
 * a basics drill or before the first match, never into a match being restored, and not until AD_FREE_MATCHES whole
 * matches have been played (so a REMATCH straight after the first ever match gets none). Navigation never comes
 * here: no menu, tab or screen change asks for an ad.
 */
export function breakDue(o: {
  recovered: boolean; basics: boolean; firstMatch: boolean;
  /** Matches and moments finished this visit. */
  finishedThisVisit: number;
  /** Since the last result screen came up (ms). */
  sinceResultMs: number;
  /** Whole matches on the save (a drill or a moment is not one). */
  played: number;
}): boolean {
  return !o.recovered && !o.basics && !o.firstMatch && o.finishedThisVisit > 0 && o.sinceResultMs >= AD_AFTER_RESULT_MS && o.played >= AD_FREE_MATCHES;
}

/**
 * May an interstitial be asked for as the half-time screen comes up (main.ts onHalftime)? Half time is the one break
 * football has in the middle of a match, and the owner asked for it ("half time in between breaks should have an ad").
 * Never in a basics drill, a Football Moment or the first match, never into a match being restored, and not until
 * AD_FREE_MATCHES whole matches are behind the player. A portal asks only when its last ad is PORTAL_HALF_GAP_MS
 * behind (Ads.midgame): its SDK would refuse a nearer one anyway, and a refused request is still a blink of held game.
 */
export function halfBreakDue(o: { recovered: boolean; basics: boolean; firstMatch: boolean; moment: boolean; played: number }): boolean {
  return !o.recovered && !o.basics && !o.firstMatch && !o.moment && o.played >= AD_FREE_MATCHES;
}
/**
 * A portal's half-time interstitial waits this long (ms) after the last ad that actually played, a rewarded one
 * included. CrazyGames allows one interstitial every 3 minutes: with the default 2 minute halves that is an ad at
 * half time OR before the next kick-off, never both in one short match, and both in a long one.
 */
export const PORTAL_HALF_GAP_MS = 170_000;
/**
 * A portal's interstitial before a kick-off waits this long (ms) after the last ad that actually played, a rewarded
 * one included: a replay earned by an ad restarts the match, and the full-time bonus ad is followed by REMATCH, so
 * without it an ad the player chose would be answered with one he did not, back to back. (A Football Moment's try
 * waits APP_AD_MOMENT_GAP_MS, as in the app: retried tries are never ad after ad.)
 */
export const PORTAL_AD_GAP_MS = 60_000;
/** How long a CrazyGames request may go unanswered before the game carries on without it (ms; Ads.crazyAd). */
export const PORTAL_NO_ANSWER_MS = { midgame: 6_000, rewarded: 15_000 } as const;
/** A CrazyGames SDK that was not up in time is tried again this long after (ms; Ads.crazyRetry). */
export const PORTAL_RETRY_MS = 20_000;

/**
 * Is a ball actually playable? The portals' "gameplay started" goes out only then (main.ts payPlay): the sim has
 * stepped since the kick-off (or the half) was set up, in a phase the player has something to play, and nothing
 * holds the match (a pause, a menu over it). Not while the fly-in plays, a brief is read or a first match waits on
 * its kick-off: the sim does not step through any of those.
 */
export function playIsLive(phase: string, stepped: boolean, held: boolean, scene = false): boolean {
  return stepped && !held && !playIsHeld(phase, scene);
}

/** The words every rewarded offer shows while an ad blocker is on (CrazyGames' review asked for these). */
export const ADBLOCKER_NOTE = 'ADBLOCKER DETECTED';

/**
 * Has the match itself taken the ball away from the player? A goal (the celebration, the replay and the walk back,
 * until the kick-off: the sim's 'goal' phase), half time, full time, or a cut scene (game/matchSession.ts cutScene: a
 * replay, an incident's decision and recap, the referee's close-up, a substitution's touchline shot, a tunnel scene).
 * CrazyGames: "When the player goals, please call gameplayStop until the game resumes" (main.ts payPlay, playStep).
 */
export function playIsHeld(phase: string, scene: boolean): boolean {
  return scene || phase === 'goal' || phase === 'halftime' || phase === 'fulltime';
}

/**
 * Play must have been live this long (s), unbroken, before "gameplay started" goes out again: a kick-off that a
 * substitution's touchline shot or the referee's close-up follows a frame or two later never sends a start and a stop
 * back to back (CrazyGames' SDK also holds back a start that comes within a second of the last call).
 */
export const PLAY_SETTLE_S = 0.5;

/**
 * The portals' "gameplay started" for the match on screen (main.ts). `out`: a start went out and no stop since.
 * `owed`: one is wanted as soon as play is live (a kick-off, a second half, a resume, the end of a stoppage).
 * `liveS`: how long play has been live while owed (-1: not yet).
 */
export interface PlayState { out: boolean; owed: boolean; liveS: number }

/**
 * One frame of it: 'stop' the moment the match takes the ball away (playIsHeld) while a start is out, and the start is
 * owed again; 'start' once it is owed and play has been live (playIsLive) for PLAY_SETTLE_S; else nothing. Strictly
 * alternating: never two starts or two stops in a row. A pause or a menu (`held`) is not seen here: main.ts onPause
 * takes the start back itself, and a resume gives it back.
 */
export function playStep(st: PlayState, f: { phase: string; scene: boolean; stepped: boolean; held: boolean; dt: number }): 'start' | 'stop' | null {
  if (st.out) {
    if (f.held || !playIsHeld(f.phase, f.scene)) return null;
    st.out = false;
    st.owed = true;
    st.liveS = -1;
    return 'stop';
  }
  if (!st.owed) return null;
  if (f.held || playIsHeld(f.phase, f.scene)) {
    st.liveS = -1;
    return null;
  }
  // (Live from the first step the sim takes: the fly-in, a brief or the first match's hold do not step it.)
  if (st.liveS < 0) {
    if (!playIsLive(f.phase, f.stepped, false, false)) return null;
    st.liveS = 0;
  } else st.liveS += f.dt;
  if (st.liveS < PLAY_SETTLE_S) return null;
  st.out = true;
  st.owed = false;
  st.liveS = -1;
  return 'start';
}

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
interface CrazyUser {
  username?: string;
  profilePictureUrl?: string;
}
interface CrazySDK {
  init(): Promise<void>;
  environment: 'local' | 'crazygames' | 'disabled';
  data?: PortalStore;
  /** The User module (all of it optional: an SDK without it behaves as one that cannot say who is playing). */
  user?: {
    /**
     * The signed-in player, or null for a guest. (The only User call the game makes: it keeps its progress in the Data
     * Module and has no use for a user token, so it never asks for one. CrazyGames' review asked for exactly that.)
     */
    getUser?(): Promise<CrazyUser | null>;
    /** Fires when a guest signs in (a sign-out reloads the page instead). */
    addAuthListener?(fn: (user: CrazyUser | null) => void): void;
  };
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

/**
 * Who CrazyGames' getUser() says is playing, as the save's tag (core/save.ts SaveData.portalUid): '' a guest (null),
 * `name:` and the username for a signed-in player, null when it cannot be told (no username to go on). Only ever used
 * to tell one account's save from another's in this browser: nothing is trusted on it, and it is sent nowhere.
 * (core/save.ts portalTagCurrent knows this form: keep the two together.)
 */
export function portalUidOf(user: unknown): string | null {
  if (user === null) return '';
  const name = typeof user === 'object' && user ? (user as CrazyUser).username : undefined;
  return typeof name === 'string' && name ? `name:${name.slice(0, 120)}` : null;
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
  /**
   * An ad blocker is on, as far as CrazyGames can tell: asked once its SDK is up (the answer is not always right), set
   * by a request that fails for it, cleared by any ad that does play. Rewarded offers are off while it is set.
   */
  private blocked = false;
  /** CrazyGames ads that started only after their request had been given up on (crazyAd): the game is held meanwhile. */
  private lateAds = 0;
  private busy = false;
  /** true = all game audio must be silent (ad playing, or CrazyGames muteAudio setting); false = may play. */
  onMute: (muted: boolean) => void = () => {};
  /**
   * true = an ad is being asked for or is on screen: the game takes no input until false (main.ts shields its
   * screens, and pauses a match one has started over). Always followed by false, whatever the SDK does.
   */
  onBusy: (busy: boolean) => void = () => {};
  /**
   * true = an interstitial was asked for and nothing has come up yet: the game is held with nothing on screen to say
   * why (before a kick-off the menus are closed, at half time no screen is up yet), so main.ts puts ONE MOMENT there
   * if it lasts (ui/adHold.ts). false once the ad starts or the request is over. Always inside an onBusy(true) ..
   * onBusy(false) pair. Never for a rewarded ad: the player asked for that one.
   */
  onWait: (waiting: boolean) => void = () => {};
  /** The request in flight is an interstitial (onWait). */
  private interstitial = false;
  private waiting = false;
  /**
   * true = the player owns NO ADS (platform/iap.ts adFree): no interstitial is ever requested. Rewarded ads are
   * opt-in rewards, not interruptions, so they stay available. main.ts points it at the live save.
   */
  adFree: () => boolean = () => false;

  // ---- the app's AdMob state ('app' only)
  // (Named for what they hold, not for the SDK: a portal build then carries no trace of the app's ad provider.)
  private appPlugin: AdMobPlugin | null = null;
  private appModule: AdMobModule | null = null;
  private appLoaded: Record<AppAd, boolean> = { rewarded: false, interstitial: false };
  private appLoading: Record<AppAd, boolean> = { rewarded: false, interstitial: false };
  private appRetry: Record<AppAd, number> = { rewarded: 0, interstitial: 0 };
  /** When the last app ad (either kind) closed (ms, Date.now): the next interstitial waits APP_AD_GAP_MS from it. */
  private appLastAt = -Infinity;
  /** When the last portal ad that actually played (either kind) ended (ms, Date.now): the half-time break waits on it. */
  private portalLastAt = -Infinity;
  private readyFns = new Set<() => void>();

  /**
   * `fn` runs whenever what can be offered changes: an app ad finished loading, or CrazyGames reported an ad blocker
   * (the shop redraws its FREE COINS card). Returns the unsubscribe.
   */
  onAdReady(fn: () => void): () => void {
    this.readyFns.add(fn);
    return () => void this.readyFns.delete(fn);
  }

  /**
   * The portal's own save store once its SDK is up (CrazyGames' Data Module: progress follows a signed-in player to
   * any device), else null. The save mirrors itself there (core/save.ts adoptPortalStore).
   */
  portalStore(): PortalStore | null {
    // (Not before the SDK has been asked who is playing: the save is settled per account, so the store waits for that.)
    if (this.portal !== 'crazygames' || !this.userAsked) return null;
    const d = window.CrazyGames?.SDK?.data;
    return d && typeof d.getItem === 'function' && typeof d.setItem === 'function' ? d : null;
  }

  /** Who is playing on CrazyGames (portalUidOf): '' a guest, else `name:` and his username; null when it cannot say (or elsewhere). */
  private uid: string | null = null;
  private userAsked = false;
  /** A guest signed in mid-visit (CrazyGames): `uid` is the account now playing. main.ts settles the save again. */
  onAuth: (uid: string) => void = () => {};

  /** Who is playing, as last heard from CrazyGames (see `uid`). Known once init() has finished. */
  portalUser(): string | null {
    return this.uid;
  }

  /**
   * Ask CrazyGames who is playing. Never throws and never hangs: an SDK without a User module, one that throws, and
   * one that gives no answer in time are all "cannot say" (null), and the game behaves as it did before accounts
   * were told apart. getUser() is all it asks: a guest, or a signed-in player and his username (portalUidOf). No user
   * token is ever asked for (the save lives in the Data Module, which is already the account's own).
   */
  private async askUser(sdk: CrazySDK): Promise<string | null> {
    try {
      const u = sdk.user;
      if (!u || typeof u.getUser !== 'function') return null;
      const who = await withTimeout(Promise.resolve(u.getUser()), 1500, undefined);
      if (who === undefined) return null;
      return portalUidOf(who ?? null);
    } catch {
      return null;
    }
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
        // Not up in time (a slow network, a slow init): the game starts without it, and it is tried again behind it.
        if (!(await this.crazyUp())) this.crazyRetry();
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

  /** The SDK script's tag (one at a time: only a tag that FAILED is ever added again), and its init(), called once. */
  private crazyTag: Promise<void> | null = null;
  private crazyStart: Promise<void> | null = null;
  private crazyTries = 0;
  /** The SDK answered and said no (off CrazyGames' domains, or init() refused): it is not tried again. */
  private crazyOff = false;
  /**
   * The SDK came up late, on a background retry (crazyRetry), after init() had already resolved without it: main.ts
   * settles the save with its store now, as it does when init() itself was merely slow.
   */
  onLate: () => void = () => {};

  /**
   * Bring CrazyGames' SDK up: its script and its init(), each waited for 6 s at most, then everything that hangs on
   * it. False when it is not up (yet). Safe to call again: a script still loading or an init() still running is
   * waited for again, never started twice.
   */
  private async crazyUp(): Promise<boolean> {
    // (The literal check: every other build drops this method's body, and CrazyGames' address with it. The release
    // script refuses a Poki or itch package that names another portal's host.)
    if (import.meta.env.VITE_PORTAL && import.meta.env.VITE_PORTAL !== 'crazygames') return false;
    this.crazyTries++;
    if (!this.crazyTag) {
      const tag = loadScript('https://sdk.crazygames.com/crazygames-sdk-v3.js');
      this.crazyTag = tag;
      tag.catch(() => {
        if (this.crazyTag === tag) this.crazyTag = null;
      });
    }
    await settled(this.crazyTag, 6000);
    const sdk = window.CrazyGames?.SDK;
    if (!sdk) return false;
    this.crazyStart ??= Promise.resolve().then(() => sdk.init());
    const started = await withTimeout(this.crazyStart.then(() => 'up' as const, () => 'refused' as const), 6000, 'slow' as const);
    // Off CrazyGames' domains (and not localhost) the SDK is 'disabled' and every call throws.
    if (started === 'refused' || (started === 'up' && sdk.environment === 'disabled')) this.crazyOff = true;
    if (started !== 'up' || this.crazyOff) return false;
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
    // An ad blocker: known from the start, so a rewarded offer says ADBLOCKER DETECTED instead of failing on a tap.
    // (Not waited for: the answer can be slow, and it must never hold the game's start.)
    safe(() => void sdk.ad.hasAdblock().then((on) => {
      if (on !== true || this.blocked) return;
      this.blocked = true;
      for (const fn of this.readyFns) safe(fn);
    }, () => {}));
    // Who is playing: the save is kept per account (core/save.ts adoptPortalStore), so this is known before the
    // store is handed out (portalStore). A guest who signs in later is heard here, and the save settled again.
    this.uid = await this.askUser(sdk);
    this.userAsked = true;
    safe(() => sdk.user?.addAuthListener?.(() => {
      void this.askUser(sdk).then((uid) => {
        if (uid === null || uid === this.uid) return;
        this.uid = uid;
        safe(() => this.onAuth(uid));
      });
    }));
    return true;
  }

  /**
   * The SDK was not up in time: without it there are no ads, no portal events and no account save for the whole
   * visit, so it is tried once more PORTAL_RETRY_MS later, behind the game (and a second time only when the script's
   * tag itself failed to load: then nothing is still on its way). When it comes up, everything that hangs on it
   * happens as for an init() that was merely slow: loading and gameplay events, the offers, the save (onLate).
   */
  private crazyRetry(): void {
    if (this.crazyOff || this.crazyTries >= (this.crazyTag ? 2 : 3)) return;
    setTimeout(() => {
      void this.crazyUp().then((up) => {
        if (!up) return this.crazyRetry();
        if (this.loaded) this.sendLoaded();
        this.syncGameplay();
        for (const fn of this.readyFns) safe(fn);
        safe(() => this.onLate());
      }, () => {});
    }, PORTAL_RETRY_MS);
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
    this.appPlugin = A;
    this.appModule = m;
    this.portal = 'app';
    this.ok = true;
    this.prepareApp('rewarded');
    this.prepareApp('interstitial');
  }

  /** Load the next ad of a kind; a failed load tries again later (15 s, doubling, at most 5 min apart). */
  private prepareApp(kind: AppAd): void {
    // (A literal check, as in initApp: a portal build carries none of the app's ad code or its unit ids.)
    if (import.meta.env.VITE_PORTAL && import.meta.env.VITE_PORTAL !== 'none') return;
    const A = this.appPlugin;
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
    if (import.meta.env.VITE_PORTAL && import.meta.env.VITE_PORTAL !== 'none') return Promise.resolve(false);
    const A = this.appPlugin!;
    const M = this.appModule!;
    this.appLoaded[kind] = false;
    return new Promise<boolean>((resolve) => {
      let earned = false;
      let done = false;
      const handles: { remove(): Promise<void> }[] = [];
      const finish = (closed = false) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        // (One the player sat through starts the gap to the next interstitial; one that never showed doesn't.)
        if (closed || earned) this.appLastAt = Date.now();
        for (const h of handles) void h.remove().catch(() => {});
        this.prepareApp(kind);
        resolve(earned);
      };
      const timer = setTimeout(() => finish(true), APP_AD_MAX_MS);
      const listen = async () => {
        if (kind === 'rewarded') {
          const E = M.RewardAdPluginEvents;
          handles.push(await A.addListener(E.Rewarded, () => { earned = true; }));
          handles.push(await A.addListener(E.Dismissed, () => finish(true)));
          handles.push(await A.addListener(E.FailedToShow, () => finish()));
        } else {
          const E = M.InterstitialAdPluginEvents;
          handles.push(await A.addListener(E.Dismissed, () => finish(true)));
          handles.push(await A.addListener(E.FailedToShow, () => finish()));
        }
      };
      listen().then(() => {
        if (done) return;
        this.setAdMute(true);
        const show = kind === 'rewarded' ? A.showRewardVideoAd().then(() => { earned = true; }) : A.showInterstitial();
        show.catch(() => finish());
      }, () => finish());
    });
  }

  /**
   * Rewarded ads: on the portals (not with an ad blocker on: see adBlocked), and in the app once one has loaded
   * (asking for the next if not). Every rewarded offer reads this before it draws itself and again on the tap.
   */
  get rewardedAvailable(): boolean {
    if ((!import.meta.env.VITE_PORTAL || import.meta.env.VITE_PORTAL === 'none') && this.portal === 'app') {
      if (!this.appLoaded.rewarded) this.prepareApp('rewarded');
      return this.ok && this.appLoaded.rewarded;
    }
    return this.ok && this.adsAllowed && !this.blocked;
  }

  /** An ad blocker is on (CrazyGames): a rewarded offer shows itself switched off, with ADBLOCKER_NOTE beside it. */
  get adBlocked(): boolean {
    return this.blocked;
  }

  /**
   * The words a rewarded offer shows in place of its reward while no ad can be offered ('' when one can):
   * ADBLOCKER_NOTE with an ad blocker on, else NO AD RIGHT NOW. Inline on the offer itself, never a popup.
   */
  get rewardedNote(): string {
    return this.rewardedAvailable ? '' : this.blocked ? ADBLOCKER_NOTE : 'NO AD RIGHT NOW';
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
    // (Poki's calls sit behind the literal check everywhere in this file: the CrazyGames build carries none of them.)
    if ((!import.meta.env.VITE_PORTAL || import.meta.env.VITE_PORTAL === 'poki') && this.portal === 'poki') safe(() => window.PokiSDK!.gameLoadingFinished());
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
    if (!this.ok || !this.loadedSent || this.adInFlight || this.lateAds > 0 || this.playing === this.wantsGameplay) return;
    this.playing = this.wantsGameplay;
    if ((!import.meta.env.VITE_PORTAL || import.meta.env.VITE_PORTAL === 'poki') && this.portal === 'poki') safe(() => this.playing ? window.PokiSDK!.gameplayStart() : window.PokiSDK!.gameplayStop());
    if (this.portal === 'crazygames') safe(() => this.playing ? window.CrazyGames!.SDK.game.gameplayStart() : window.CrazyGames!.SDK.game.gameplayStop());
  }

  /** An ad is being asked for or is up (a late one included): tell the game once each way (onBusy). */
  private syncBusy(): void {
    const b = this.adInFlight || this.lateAds > 0;
    // (The wait is told inside the hold: after it begins, and before it ends.)
    if (!b) this.syncWait();
    if (b !== this.busy) {
      this.busy = b;
      safe(() => this.onBusy(b));
    }
    if (b) this.syncWait();
  }

  /** An interstitial is asked for and no ad is up yet: tell the game once each way (onWait). */
  private syncWait(): void {
    const w = this.adInFlight && this.interstitial && !this.adMuted && this.lateAds === 0;
    if (w === this.waiting) return;
    this.waiting = w;
    safe(() => this.onWait(w));
  }

  /** CrazyGames celebration for a real achievement; use sparingly. Poki has no HTML5 equivalent. */
  happyTime(): void {
    if (this.ok && this.portal === 'crazygames') safe(() => window.CrazyGames!.SDK.game.happytime());
  }

  /**
   * Interstitial at a natural break: 'match' just before a new match kicks off ('moment': a Football Moment's
   * try), 'halftime' as the half-time screen comes up. The portals: both SDKs decide whether an ad actually plays
   * (CrazyGames caps at 1 per 3 min), and they are asked only when the last ad that played, a rewarded one included,
   * is far enough behind: PORTAL_AD_GAP_MS before a kick-off, APP_AD_MOMENT_GAP_MS before a Moment's try,
   * PORTAL_HALF_GAP_MS at half time. The app: see APP_AD_GAP_MS.
   */
  async midgame(at: 'match' | 'moment' | 'halftime' = 'match'): Promise<void> {
    if (!this.ok || !this.adsAllowed || this.adInFlight || this.lateAds > 0 || this.adFree()) return;
    if ((!import.meta.env.VITE_PORTAL || import.meta.env.VITE_PORTAL === 'none') && this.portal === 'app') {
      // Every break, clear of the last ad, and only an ad that is already loaded.
      const gap = at === 'moment' ? APP_AD_MOMENT_GAP_MS : at === 'match' ? APP_AD_MATCH_GAP_MS : APP_AD_GAP_MS;
      if (Date.now() - this.appLastAt < gap || !this.appLoaded.interstitial) {
        this.prepareApp('interstitial');
        return;
      }
    } else if (Date.now() - this.portalLastAt < (at === 'halftime' ? PORTAL_HALF_GAP_MS : at === 'moment' ? APP_AD_MOMENT_GAP_MS : PORTAL_AD_GAP_MS)) {
      // Too soon after the last ad that played (a rewarded one counts): nothing is asked for, the game is not held.
      return;
    }
    this.gameplayStop();
    this.interstitial = true;
    this.adInFlight = true;
    this.syncBusy();
    let active = true;
    try {
      if ((!import.meta.env.VITE_PORTAL || import.meta.env.VITE_PORTAL === 'none') && this.portal === 'app') {
        await this.showApp('interstitial');
      } else if ((!import.meta.env.VITE_PORTAL || import.meta.env.VITE_PORTAL === 'poki') && this.portal === 'poki') {
        let played = false;
        await withTimeout(window.PokiSDK!.commercialBreak(() => {
          played = true;
          this.portalLastAt = Date.now();
          if (active) this.setAdMute(true);
        }), 45_000, undefined);
        // (Counted from when it ended, like every other ad.)
        if (played) this.portalLastAt = Date.now();
      } else if (this.portal === 'crazygames') {
        await this.crazyAd('midgame');
      }
    } catch {
      /* an ad failure never blocks play */
    } finally {
      active = false;
      this.adEnded();
    }
  }

  /**
   * Opt-in rewarded ad. Resolves true only if the player watched it through: an error, an ad that never came or one
   * the SDK gave no answer for is false, and nothing is granted for it.
   */
  async rewarded(): Promise<boolean> {
    if (!this.ok || !this.adsAllowed || this.adInFlight || this.lateAds > 0) return false;
    this.gameplayStop();
    this.interstitial = false;
    this.adInFlight = true;
    this.syncBusy();
    let active = true;
    try {
      if ((!import.meta.env.VITE_PORTAL || import.meta.env.VITE_PORTAL === 'none') && this.portal === 'app') {
        if (!this.appLoaded.rewarded) {
          this.prepareApp('rewarded');
          return false;
        }
        return await this.showApp('rewarded');
      }
      if ((!import.meta.env.VITE_PORTAL || import.meta.env.VITE_PORTAL === 'poki') && this.portal === 'poki') {
        // A rewarded ad that played starts the wait to the next interstitial too (midgame).
        let played = false;
        const ended = (earned: boolean): boolean => {
          if (played || earned) this.portalLastAt = Date.now();
          return earned;
        };
        return await withTimeout(window.PokiSDK!.rewardedBreak(() => { played = true; if (active) this.setAdMute(true); }), 60_000, false).then(ended);
      }
      if (this.portal === 'crazygames') {
        return await this.crazyAd('rewarded');
      }
      return false;
    } catch {
      return false;
    } finally {
      active = false;
      this.adEnded();
    }
  }

  /** A request is over (played, failed or given up on): sound and input come back unless a late ad is still up. */
  private adEnded(): void {
    this.adInFlight = false;
    if (this.lateAds === 0) this.setAdMute(false);
    this.syncBusy();
    this.syncGameplay();
  }

  /**
   * One CrazyGames ad request. Resolves true only when the ad played through. The sound is muted when it actually
   * starts, never before, and comes back when it ends. A request the SDK gives no answer to lets the caller go after
   * PORTAL_NO_ANSWER_MS (an ad that does not come must not stall the game: 6 s for an interstitial, which holds a game
   * the player did not stop himself; 15 s for a rewarded one, which he asked for). Should that ad start after all, it
   * would play over a running game: the game is muted and held again (lateAdStart) until it finishes, fails, or 120 s
   * pass, and nothing is granted for it (its caller was already told no).
   */
  private crazyAd(type: 'midgame' | 'rewarded'): Promise<boolean> {
    return new Promise((resolve) => {
      // asked: no answer yet. playing: it started in time. left: the caller was let go. late: it started after that.
      let state: 'asked' | 'playing' | 'left' | 'late' | 'over' = 'asked';
      let timer = setTimeout(() => {
        state = 'left';
        resolve(false);
      }, PORTAL_NO_ANSWER_MS[type]);
      const over = (watched: boolean) => {
        const was = state;
        if (was === 'over') return;
        state = 'over';
        clearTimeout(timer);
        // (One that played, on time or late, starts the wait to the next half-time break.)
        if (was === 'playing' || was === 'late') this.portalLastAt = Date.now();
        if (was === 'late') this.lateAdEnd();
        else if (was !== 'left') resolve(watched);
      };
      try {
        window.CrazyGames!.SDK.ad.requestAd(type, {
          adStarted: () => {
            if (state !== 'asked' && state !== 'left') return;
            // (An ad that plays: whatever said a blocker was on, it did not stop this one.)
            this.blocked = false;
            clearTimeout(timer);
            // Give a started video time to finish; a missing callback must still give the game back.
            timer = setTimeout(() => over(false), 120_000);
            if (state === 'left') {
              state = 'late';
              this.lateAdStart();
            } else {
              state = 'playing';
              this.setAdMute(true);
            }
          },
          adFinished: () => over(true),
          adError: (error) => {
            if (state === 'over') return;
            // No ads in this launch at all: nothing more is asked for. A blocker: the same, and the offers say so.
            if (error.code === 'adsDisabledBasicLaunch' || error.code === 'adblock') this.adsAllowed = false;
            if (error.code === 'adblock') this.blocked = true;
            over(false); // never grant a reward for an error
          },
        });
      } catch {
        over(false);
      }
    });
  }

  /** An ad came up after its request was given up on: over whatever the game is doing now. Mute, and hold the game. */
  private lateAdStart(): void {
    // The portal hears that play stopped; what the game wants is kept (syncGameplay) for when the ad has gone.
    if (this.playing) {
      this.playing = false;
      safe(() => window.CrazyGames!.SDK.game.gameplayStop());
    }
    this.lateAds++;
    this.setAdMute(true);
    this.syncBusy();
  }

  private lateAdEnd(): void {
    this.lateAds = Math.max(0, this.lateAds - 1);
    if (this.lateAds === 0 && !this.adInFlight) this.setAdMute(false);
    this.syncBusy();
    this.syncGameplay();
  }

  private setAdMute(m: boolean): void {
    this.adMuted = m;
    this.syncMute();
    // (Muted for an ad means one is up: the wait for it is over.)
    this.syncWait();
  }

  private syncMute(): void {
    const m = this.adMuted || this.settingsMuted;
    if (m === this.muted) return;
    this.muted = m;
    this.onMute(m);
  }
}

export const ads = new Ads();
