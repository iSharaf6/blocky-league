# TestFlight build 5 — 6 October 2026

Build **1.0 (5)** is signed, exported and installed on EZY (iPhone 15), confirmed by iOS device inventory.
Apple accepted the upload and processed build `e4608f3d-d1ca-4a9d-92c2-d82b59271a3e`. It is now **Waiting for
Review** and is the only build in **Blocky League Playtest**. Build 4's review was withdrawn and its group
association removed. Automatic notifications are off; no tester invitations were sent. External access through
<https://testflight.apple.com/join/ChfvkUXC> still requires Apple's approval.

- Match recovery immediately restores the scoreboard, clock and added-time board, including while paused.
- Accepted quick substitutions show a three-second confirmation, then clear while the change waits for a safe stoppage.
- The compact header keeps the Ad Free price visible. Store products wrap into readable cards in one scrolling
  pane, with a separate Club Pass section and 44px controls. Static font/safe-area checks are in HUB_LAYOUT.md;
  rendered phone QA remains blocked by the preview's browser restriction.
- Both players earn **1,000 coins + 50 gems** for a qualifying referral. New account, first win, one welcome code,
  30-day eligibility and 20 invited-friend limits are shown. Durable wallet receipts survive dropped responses,
  and failed local writes roll back rewards. Account switches cannot share another player's cached code.

Validation: 1,396 workflow tests across 70 files passed through the full batch and an 82-test recovery/replay recheck.
The sole initial failure was an outdated HUD test fixture, corrected without changing the packaged runtime.
Typecheck, all five release packages, source/ZIP fingerprints, native asset parity, signatures, distribution
profile and privacy manifest checks passed. GitHub Pages run 37398057405 passed the full CI run and deployed
main commit `138ea20`. Source is pushed to main and release/ios-app; immutable fallback tag
`testflight-build-5-2026-10-06` points to that source. Archive/IPA/log backups are in ignored `release/testflight/1.0-5/`.

Supabase referral Edge Function version 2 (JWT verification enabled) and migration
`20261006010812_durable_generous_referral_rewards` are deployed. A rollback-only database integration check passed
for rewards, retry idempotency, eligibility, reciprocal claims, cap boundaries, permissions, account deletion and
legacy collection. It left zero synthetic accounts or reward rows. Anonymous HTTP collection is rejected with 401.
The uploaded match record remains client-authoritative; this is not server-attested anti-cheat.

Google's consent app has been saved with the owner's explicit policy approval. Its web OAuth client is prepared,
awaiting credential-creation confirmation and the owner's required secret-entry handoff in Supabase. Google remains
disabled until that step is saved. Native Apple remains configured but still needs a real-device sign-in check.

## Previous TestFlight build 4 — 6 October 2026

Version **1.0 (4)** was accepted by App Store Connect app **6819288055** and installed successfully on EZY
(iPhone 15). Apple finished processing build `15caa129-b3d8-45f8-b4cd-9ad59c451a58`; its external TestFlight
submission is **Waiting for Review**. Build 4 is the only build in the external group; the superseded build 3
was removed from that group. Automatic notifications are off and no invitations were sent. This is a beta,
not a public App Store release. The existing **Blocky League Playtest** link is
<https://testflight.apple.com/join/ChfvkUXC>; external access requires Apple's beta approval.

Build 4 replaces the two-row phone header with a compact level/reward area and a single row of account,
currency, help and settings controls. Labels shorten at narrow safe-area widths without reducing the 44px tap
targets. Fixture text has explicit short-screen sizes, and completed Daily challenges no longer reserve empty
progress/reward columns. The Journey crown hides on short screens so its tier and Club Pass stay visible.
The iOS 15 media-query fallback is preserved. All gameplay/account/replay features from build 3 remain included.

The final focused menu/settings/input/device-budget check passed **78 tests in five files**, with typecheck and
all five release builds passing. A source/font geometry audit covers **14 landscape iPhone/iPad sizes** and the
three text settings, including the supplied iPhone 15 safe-area width. It checks normal balances, maximum daily
gifts, completed Daily text and cup fixtures. These are static calculations, not rendered visual checks or a
claim that every device has been visually tested; see [HUB_LAYOUT.md](HUB_LAYOUT.md).

Source/ZIP fingerprints for all five release packages match
`be75c58c5aeb6edad43d12f2fdc4c7c435d7f40b77d3bc64ac3d7bd222cd65a4`.
All 33 native game files match the signed archive and App Store IPA. Version, signatures, Apple sign-in/Game
Center entitlements, provisioning and the UserDefaults `CA92.1` privacy declaration passed validation. Apple
accepted the same non-blocking vendor SDK missing-symbol warnings recorded for builds 2 and 3.

The final source is backed up on `release/ios-app` at `29ef639`; the build 4 fallback tag is
`testflight-build-4-2026-10-06`. Signed archive, IPA, all five release ZIPs/manifests, layout audit and verification
logs are preserved in the ignored `release/testflight/1.0-4/` directory. The IPA SHA-256 is
`b9d9323c168d6207fd0d7b31e5562b9c69fcc260264a3639f2a9703071e67cee`.

The release was fast-forwarded into GitHub `main` at `857b415`. The
[GitHub checks and Pages deployment](https://github.com/iSharaf6/blocky-league/actions/runs/37329972749)
passed: **1,311 tests across 64 files**, web type-check/packaging, and publication. GitHub Actions contains only
the existing public Supabase URL/publishable-key build configuration. The subsequent review-status documentation
update changes no game source or shipped assets.

Google remains disabled pending the consent-policy approval and provider credentials described in
[AUTH_SETUP.md](AUTH_SETUP.md). Native Apple is configured but actual account sign-in still needs device
verification. Game Center definitions, paid purchase products and production ad units remain console setup work.

## Superseded TestFlight build 3 — 6 October 2026

Version **1.0 (3)** was successfully uploaded to App Store Connect app **6819288055**. Apple finished processing
build `8477cb6c-da10-4d1d-ba44-ecd4ae32695b`; it was submitted for external TestFlight review, then withdrawn
to replace its two-row header with build 4. The archive
contains all 33 native game assets from the verified iOS bundle, including the developer portrait. Source and ZIP
fingerprints for all five release packages passed. Build 3 was also installed successfully on EZY (iPhone 15).
An empty external **Blocky League Playtest** group was created, build 3 was added, and updated beta review notes
were saved. Automatic tester notifications are off and no invitations were sent. Apple approval remains pending;
this is not a public App Store release.

Build 3 adds:

- A protected level/daily-gift strip with wrapping phone layouts so the level badge keeps its space.
- Settings > More links for account saves, Invite Friends and About the Developer. Account overlays retire
  Settings shortcuts, handle Escape from body/buttons/inputs and return once without leaking listeners.
- A built-in blocky portrait and About page for the developer, loaded when that page opens.
- Provider readiness checks when Account opens, explicit unavailable-provider messaging, optional native Apple
  sign-in and a separate opt-in flag for browser Apple OAuth. Local progress remains available offline.
- Offside recaps that use the original pass release and smoothly hold/resume the decision frame, with raised
  pitch marks and settled camera framing.

The final combined menu/account/replay check passed all 244 checks across 12 files. Typecheck passed.
The wider regression scope passed **1,885 checks across 125 files**, with two intentional skips, across the main
batch and targeted rechecks. Five long fixtures initially exceeded runtime deadlines without assertion failures;
the heavy fixtures now use finite budgets while preserving every seed, sample and assertion. All 72 checks in
those five files passed, including the final 12-check idle-possession rerun. The four aggregate metrics fixtures
were excluded from this presentation/account change's current scope. The historical 1,796-check result below
covers the earlier replay/clock update, not the complete build 3 source.

Verified signed archive and App Store IPA backups, options, manifests and validation logs are preserved locally
in the ignored `release/testflight/1.0-3/` directory (approximately 26 MB). The source is backed up on
`release/ios-app`; build 3's release tag is `testflight-build-3-2026-10-06`.

Live Supabase configuration now enables Apple for native bundle `com.calynx.blockyleague`, enables manual identity
linking, and sets the published GitHub website as Site URL with the website and exact native callback allowlisted.
Google remains disabled; a dedicated Google project (`blocky-league-510713`) exists. Its consent-app setup is
prepared and awaits the owner's approval of Google's API Services User Data Policy before saving. OAuth client
creation and provider credential entry are still pending; no secret was created, read or stored in the source.
Native Apple still needs a real-device sign-in check. Browser Apple requires its separate Services ID/OAuth secret
setup. No provider credentials or reviewer phone number are stored in this document.

## Successfully uploaded TestFlight build 2 — 6 October 2026

Version **1.0 (2)** was successfully uploaded to App Store Connect app **6819288055** using normal App Store
Connect distribution. Apple's upload service accepted it and processing completed to **Ready to Submit** for
external beta review. The beta description, no-sign-in
review notes and owner-supplied reviewer contact were saved. An empty, manually distributed Internal QA group
was created; no tester invitations were sent. External beta review has not been submitted yet.

The signed archive includes the app's UserDefaults `CA92.1` privacy manifest. Archive, export and signature checks
passed; all 32 native game files match the latest verified iOS bundle. Local archive and exported IPA backups are
in the ignored `release/testflight/1.0-2/` directory. Apple accepted two non-blocking missing-symbol warnings for
the GoogleMobileAds and UserMessagingPlatform SDKs. Build 2 source is `cc6c68e`, tagged
`testflight-build-2-2026-10-06`; its gameplay also includes `6a01153`, not only the replay/clock update below.

## AI, cinematics and club information baseline included in builds 2 and 3

Commit `6a01153` strengthens challenges against stationary, circling and straight-running carriers, keeps skill
tells committed, locks out immediate possession theft after a successful challenge, improves keeper positioning
and AI shot selection, and uses Normal difficulty in the lower Career divisions. Its limitations still include
the AI's modest shot volume and no new passing patterns; the changes do not certify difficulty or enjoyment on
every device.

That baseline also adds post-contact foul footage, complete settled penalty replays, clearer foul/card
presentation, an offside decision freeze, dejected conceding players, coin-toss/commentary/fan/dugout/keeper
scenes, an early-bath scene and match-ball presentation. Club story cards expose player details and bids;
season/all-time statistics include keeper numbers, and the halftime screen is rebuilt. These are already in the
successfully uploaded build 2 and remain in uploaded build 3. Its deterministic network protocol is 11.

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

For the 5 October replay/clock update (`36dded7`), full regression coverage passed 1,796 checks across 121 files
(two intentionally skipped). This historical result precedes `6a01153` and build 3. The four aggregate
football-metrics checks ran separately; the remaining files were checked together and the enlarged team-style
sample was rerun successfully. The original discipline density bands use independently measured prior live
exposure, with additional raw-volume caps. The style check retains its original seeds and all margins, using
48 matches per style to reduce sampling noise. All 19 deterministic drivers retain exact hash/score comparisons
for network protocol 10. Typecheck, all five release packages (web, CrazyGames, Poki, itch and iOS), ZIP/source
fingerprints and the native signed build passed. The installed process was verified against the final installation path.

Browser visual QA was blocked by the preview URL's browser safety restriction. Automated viewport/resource
checks and one physical installation do not certify every device's appearance or subjective gameplay/audio feel.

Google and Apple sign-in code is wired. Native Apple is now enabled in the existing Supabase project; Google
setup remains in progress and browser Apple remains disabled pending its separate configuration.
See [AUTH_SETUP.md](AUTH_SETUP.md) for provider and redirect settings. Guest/local play remains available.
The 21 Game Center achievement definitions and artwork are ready in [APP_STORE.md](APP_STORE.md); configuring
them and updating App Privacy in App Store Connect still require console setup. The owner's Apple account is now signed in.

Source backups are on `release/ios-app`. The uploaded build 2 is tagged `testflight-build-2-2026-10-06`;
the earlier replay/clock update is tagged `incident-replays-verified-2026-10-05`. Earlier fallback tags remain,
including `evergreen-club-verified-2026-10-05` for the build before this replay/clock update.
For a fresh checkout, copy the public-only `.env.production.example` to `.env.production`, run `npm ci`, then
`npm run ios` and build the App scheme with the owner's normal Apple signing configuration.
