/**
 * Inside the iPhone / iPad app: Capacitor's native shell wraps the itch web build and puts `window.Capacitor` on
 * the page. The app hides what only works in a browser: ONLINE (hand-swapped WebRTC codes and a browser-tab room),
 * BACKUP (a file download) and goal clips (WebM downloads); see main.ts and game/clip.ts. The store bridge
 * (platform/iap.ts) waits for the plugin only here.
 */
/**
 * The dev server only: `?portal=crazygames` (or poki) makes it behave as that portal's build, so its screens can be
 * checked without building. A real build decides by VITE_PORTAL alone, and every caller writes that check out in
 * full (`import.meta.env.VITE_PORTAL === 'crazygames' || ... || (import.meta.env.DEV && devPortal())`): only a
 * literal the bundler can see lets it drop what a portal must not carry (mail links, the app's store copy).
 */
export function devPortal(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).has('portal');
}

export function inNativeApp(): boolean {
  // (The app wraps the VITE_PORTAL 'none' build only: a literal check, so a portal build never looks for the shell.)
  if (import.meta.env.VITE_PORTAL && import.meta.env.VITE_PORTAL !== 'none') return false;
  if (typeof window === 'undefined') return false;
  const host = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
  return !!host.Capacitor?.isNativePlatform?.();
}
