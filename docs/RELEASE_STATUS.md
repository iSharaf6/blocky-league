# Evergreen club build — 5 October 2026

This build was compiled, installed and launched on EZY (iPhone 15). It uses the dedicated `dist-ios` bundle,
with the Apple sign-in and Game Center entitlements. All 32 copied native web assets match the signed app.
This is a development-signed Release build, not a TestFlight upload or App Store submission.

## Completed

- Idle players stop automatically shielding forever or immediately stealing a successful AI challenge back.
  Tests cover the actual first-match, new Career, maximum-assistance, Normal and Blitz configurations.
  A successful poke may still create a loose-ball contest; Easy remains more forgiving.
- All ordinary local goals receive recorded replays, including tap-ins and opposition goals. Explicit skips
  remain available. Goal text stays below the scoreboard; player names are larger.
- Halftime tunnel walks, second-half returns, win/loss reactions, sportsmanship, a Man of the Match trophy
  presentation and comic booked-player reactions use the actual players and kits. Scene skips cannot pay out twice.
- Nineteen chant patterns use rounder choir voices and musical refrains. Shop nets now preview the same
  anchored cloth response used on the pitch.
- Eight divisions and twelve permanent selectable 30-tier Club Journeys ship with independent progress and
  optional paid ownership. No calendar reset or monthly content drop is needed. Mastery has eight tiers on each
  of five tracks; earned titles appear in match presentation and remain in club honours.
- Invite Friends opens the native or browser share sheet, or copies the public playtest link. No message sends
  automatically. Valid signed-in referral codes use the existing server reward rules.
- Native paid receipts finish only after confirmed local saving. Failed writes roll back rewards and leave the
  transaction available for redelivery. Deferred Club Pass orders preserve the selected Journey across restarts.
- Framebuffer and GPU dimension budgets cover small phones through large desktop displays. Ads wait until
  full-time scenes finish and at least eight seconds have passed with the results; immediate rematches skip the ad.

## Validation and remaining console work

The full suite passed 1,729 checks (two intentionally skipped). After the final paid-receipt changes, 108 focused
purchase, Journey, menu and authentication checks passed. Typecheck, all five release packages (web, CrazyGames,
Poki, itch and iOS), ZIP/source fingerprints and the native signed build passed. The installed process was verified
against the final installation path.

Browser visual QA was blocked by the preview URL's browser safety restriction. Automated viewport/resource
checks and one physical installation do not certify every device's appearance or subjective gameplay/audio feel.

Google and Apple sign-in code is wired, but both providers remain disabled in the existing Supabase project.
See [AUTH_SETUP.md](AUTH_SETUP.md) for exact provider and redirect settings. Guest/local play remains available.
The 21 Game Center achievement definitions and artwork are ready in [APP_STORE.md](APP_STORE.md); configuring
them and updating App Privacy in App Store Connect still requires the owner's Apple login.

The source backup is on `release/ios-app`, tagged `evergreen-club-verified-2026-10-05`. Earlier fallback tags remain.
For a fresh checkout, copy the public-only `.env.production.example` to `.env.production`, run `npm ci`, then
`npm run ios` and build the App scheme with the owner's normal Apple signing configuration.
