import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The iPhone / iPad app: the same game as the itch.io build (no portal SDK, no ads, no install prompt, no cloud
 * login), wrapped by Capacitor. `npm run ios` rebuilds that variant and copies it into ios/ (then open Xcode).
 *
 * When accounts and cloud saves are switched on (supabase/README.md, "Switching it on"), the app takes the `ios`
 * build instead (`npm run build:ios`, which carries the backend): webDir becomes 'dist-ios'.
 */
const config: CapacitorConfig = {
  appId: 'com.calynx.blockyleague',
  appName: 'Blocky League',
  webDir: 'dist-itch',
  // The splash's grey, so nothing flashes white between the launch screen and the game's own loading screen.
  backgroundColor: '#35373b',
  ios: {
    // The page handles the notch itself (viewport-fit=cover and safe-area insets), and never scrolls or bounces.
    contentInset: 'never',
    scrollEnabled: false,
    allowsLinkPreview: false,
  },
};

export default config;
