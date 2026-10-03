/**
 * Inside the iPhone / iPad app: Capacitor's native shell wraps the itch web build and puts `window.Capacitor` on
 * the page. The app hides what only works in a browser: ONLINE (hand-swapped WebRTC codes and a browser-tab room),
 * BACKUP (a file download) and goal clips (WebM downloads); see main.ts and game/clip.ts. The store bridge
 * (platform/iap.ts) waits for the plugin only here.
 */
export function inNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
  return !!host.Capacitor?.isNativePlatform?.();
}
