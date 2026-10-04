import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The iPhone / iPad app uses the iOS web bundle (no portal SDK or install prompt), wrapped by
 * Capacitor. Native ads and purchases load only inside the app. `npm run ios` rebuilds and copies it into ios/.
 *
 * The iOS bundle carries the optional account/cloud backend; guest play remains available.
 */
const config: CapacitorConfig = {
  appId: 'com.calynx.blockyleague',
  appName: 'Blocky League',
  webDir: 'dist-ios',
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
