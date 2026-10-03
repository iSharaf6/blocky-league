/**
 * AdMob in the iPhone / iPad app (platform/ads.ts, provider 'app'). Until the owner has an AdMob account these are
 * Google's own TEST ids: test ads show and nothing is earned. Swap in the real ones from the AdMob console (Apps,
 * Blocky League iOS, Ad units) here, and the app id in ios/App/App/Info.plist (GADApplicationIdentifier); see
 * docs/APP_STORE.md.
 */
export const ADMOB_IOS = {
  interstitial: 'ca-app-pub-3940256099942544/4411468910',
  rewarded: 'ca-app-pub-3940256099942544/1712485313',
};

/** Still on Google's test ids (a test build: fine to play, earns nothing). */
export const ADMOB_TEST_IDS = ADMOB_IOS.rewarded.startsWith('ca-app-pub-3940256099942544/');

/**
 * Kid-safe ads. Blocky League is made to appeal to kids, so every request is child-directed (COPPA) and under the
 * age of consent (GDPR): family-rated (G) ads only, never personalised, no tracking prompt. It earns less per ad
 * than tracked ads, and it is the line for a game kids play. A neutral age screen could lift it for older players
 * later.
 */
export const ADMOB_KID_SAFE = true;
