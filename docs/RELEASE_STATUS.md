# TestFlight upload — 6 October 2026

Version **1.0 (2)** was successfully uploaded to App Store Connect app **6819288055** using normal App Store
Connect distribution. Apple's upload service accepted it and began processing. The beta description, no-sign-in
review notes and owner-supplied reviewer contact were saved. An empty, manually distributed Internal QA group
was created; no tester invitations were sent. External beta review has not been submitted yet.

The signed archive includes the app's UserDefaults `CA92.1` privacy manifest. Archive, export and signature checks
passed; all 32 native game files match the latest verified iOS bundle. Local archive and exported IPA backups are
in the ignored `release/testflight/1.0-2/` directory. Apple accepted two non-blocking missing-symbol warnings for
the GoogleMobileAds and UserMessagingPlatform SDKs. Game gameplay/source remains the replay/clock update below.

## Incident replays and live match clock — 5 October 2026

This build was compiled, installed and launched on EZY (iPhone 15). It uses the dedicated `dist-ios` bundle,
with the Apple sign-in and Game Center entitlements. All 32 copied native web assets match the signed app.
This is a development-signed Release build, not a TestFlight upload or App Store submission.

## Completed

- Idle players stop automatically shielding forever or immediately stealing a successful AI challenge back.
  Tests cover the actual first-match, new Career, maximum-assistance, Normal and Blitz configurations.
  A successful poke may still create a loose-ball contest; Easy remains more forgiving.
- All ordinary local goals receive recorded replays, including tap-ins and opposition goals. Explicit skips
  remain available. Goal text stays below the scoreboard; player names are larger.
- Offsides retain the original pass release; fouls, yellow/red cards, penalty awards and settled penalty results
  receive recorded recaps. A foul, booking and penalty award share one clip. Replays preserve the exact live
  restart or possession, consume skip inputs and leave advantage uninterrupted. Shootout results also replay.
- Match time and possession statistics pause while the ball is dead, including penalty preparation and restart
  waits. Animations and preparation timers continue; the actual strike restarts time. First-match AI penalties
  cannot wait forever on the paused clock. Paused breaks do not also inflate added time.
- AI missed challenges commit fewer discretionary fouls over the extra live football. Challenge scheduling,
  clean-tackle success, human foul rules and idle-possession counterplay keep their existing rules.
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

Full regression coverage passed 1,796 checks across 121 files (two intentionally skipped). The four aggregate
football-metrics checks ran separately; the remaining files were checked together and the enlarged team-style
sample was rerun successfully. The original discipline density bands use independently measured prior live
exposure, with additional raw-volume caps. The style check retains its original seeds and all margins, using
48 matches per style to reduce sampling noise. All 19 deterministic drivers retain exact hash/score comparisons
for network protocol 10. Typecheck, all five release packages (web, CrazyGames, Poki, itch and iOS), ZIP/source
fingerprints and the native signed build passed. The installed process was verified against the final installation path.

Browser visual QA was blocked by the preview URL's browser safety restriction. Automated viewport/resource
checks and one physical installation do not certify every device's appearance or subjective gameplay/audio feel.

Google and Apple sign-in code is wired, but both providers remain disabled in the existing Supabase project.
See [AUTH_SETUP.md](AUTH_SETUP.md) for exact provider and redirect settings. Guest/local play remains available.
The 21 Game Center achievement definitions and artwork are ready in [APP_STORE.md](APP_STORE.md); configuring
them and updating App Privacy in App Store Connect still require console setup. The owner's Apple account is now signed in.

The source backup is on `release/ios-app`, tagged `incident-replays-verified-2026-10-05`. Earlier fallback tags remain,
including `evergreen-club-verified-2026-10-05` for the build before this replay/clock update.
For a fresh checkout, copy the public-only `.env.production.example` to `.env.production`, run `npm ci`, then
`npm run ios` and build the App scheme with the owner's normal Apple signing configuration.
