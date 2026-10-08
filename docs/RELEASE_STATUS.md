# TestFlight build 7 — 9 October 2026

Version **1.0 (7)** is uploaded, processed and **Approved** for external TestFlight testing. Apple received the
upload on **9 October 2026 at 1:12 am Australia/Sydney**. It is the only build in the private **Kareem First Beta**
group. The group has **zero testers**, its public link is disabled and automatic notifications are off.
The **Notify Testers** button is available. Because automatic notifications were disabled, manual distribution
has not started: Approved is distinct from Testing. When ready, the owner can choose **Notify Testers**, then
open **Testers > Add Testers** and invite the first recipient by email.
No invitation or tester notification has been sent. This is a beta; no public App Store release was submitted.

Its native icon uses the final
voxel football artwork shared with the web icons and studio mark. The opaque source icon is 1024 × 1024;
the compiled artwork is present in the archive and matches the exported IPA. Store artwork and listing text
are prepared separately in `store-assets/app-store/`.

Typecheck, all five release packages and **183 native/account/release checks across eight files** passed.
The final package source fingerprint is `37d9195519f5809db778b60e089137f0c635e273a8d7aa684096f89a31a268f3`.
All 33 native web files match the synced bundle, archive and IPA. Signatures, App Store distribution profile,
version, iPhone/iPad support, Apple sign-in/Game Center entitlements and the UserDefaults privacy declaration
passed the reusable `scripts/audit-ios-release.mjs` audit. The IPA SHA-256 is
`ad88273fcf30f963be4d4836c625e961b23a88e0e09cb427538a25afe458fcae`.

The web package has canonical URLs for the game, support and privacy pages, a three-page sitemap and an
updated robots file; native and portal bundles omit those web-only SEO assets. Support copy now reflects
automatic sprinting, optional cloud saves, match recovery and restore purchases. Privacy copy names the
current gem products and Game Center score reporting.

**Published web release:** source commit `f44befb613ce76553e5b320c7a9457de71b75018` is pushed to `main` and
`release/ios-app`; immutable tag `testflight-build-7-2026-10-09` preserves the verified build 7 source. The
[Pages workflow](https://github.com/iSharaf6/blocky-league/actions/runs/37794780439) passed **1,524 regression
checks across 79 files**, typecheck, web packaging and deployment. The
[live game](https://isharaf6.github.io/blocky-league/), support/privacy pages, sitemap, robots file and seven web
artwork files returned HTTP 200 on 9 October 2026 at 1:46 am Australia/Sydney. The audit verified the current
title, description and social metadata, exactly one canonical URL per page, matching VideoGame structured data,
all three sitemap URLs, source-identical support/privacy bodies and source-identical icon/social image bytes.
Evidence is `logs/pages-workflow.json`, `logs/pages-workflow.log` and `logs/live-site-audit.json` in the handoff
folder. An independent browser check also verified the new completed title screen and logo;
`proof/published-game.jpg` records the live result. This publishes the web game; the App Store listing remains an
unpublished draft.

Archive, IPA, five ZIPs/manifests, local verification logs, upload/export options, approval proof and beta handoff
files are in ignored `release/testflight/1.0-7/`. Approved build UUID: `aefba3ae-ff6f-48d2-84d2-1452db7d3f7e`.
Private group UUID: `0a571d6a-c6c3-455f-8e32-ebc1f666b9bc`. The
[private group builds page](https://appstoreconnect.apple.com/teams/656e6aff-e914-4c4b-8bff-c2a8fb1dc50b/apps/6819288055/testflight/groups/0a571d6a-c6c3-455f-8e32-ebc1f666b9bc/builds)
shows Approved and Notify Testers; the screenshot is `proof/testflight-approved.jpg` in the handoff folder.
The previous playtest build 5 is approved; build 6 is Ready to Submit. See [TESTFLIGHT.md](TESTFLIGHT.md).

**Rendered native smoke:** the Release app built, installed and launched on **iPhone 17 Simulator / iOS 26.5**.
The installed home-screen icon, animated title and main hub were inspected. The landscape title fits the safe
area, and the compact hub's header, prices, wallet, mode cards and bottom controls were visible without clipping.
Tap to Play reached the hub; opening the installed icon returned to the app. The simulator's 33 bundled web files
match the signed archive. Screenshots and logs are in `simulator-smoke/` and `logs/`.

Quick Match and gameplay touch response could not be exercised in this native pass: XcodeBuildMCP returned no
WebView interaction targets, while Simulator coordinate clicks repeatedly failed with `noWindowsAvailable`.
This is an automation limit, not a demonstrated gameplay failure. The screenshots are the tool's optimized JPEG
framebuffers; the title and hub are rotated relative to the Simulator's landscape window. They are QA evidence,
not App Store screenshot exports. Purchases, sign-in, device haptics and physical-device performance remain untested
in this smoke pass.

These checks establish local release integrity. Build 7 has not yet been installed on a physical device by this
release pass. Native products, production ad units, Game Center definitions and real device sign-in/purchase
verification remain prerequisites for public monetization.

## Previous TestFlight build 6 — 6 October 2026

Build **1.0 (6)** is signed, exported and installed on **EZY (iPhone 15)**. iOS device inventory confirms
version 1.0, build 6. Apple accepted the upload. The App Store Connect browser session then expired; external group assignment
awaits the owner signing back in. Build 6 is not yet confirmed available to external testers.
Build 5 has since been approved by Apple and remains available as the previous playtest build.

The economy audit and reproducible workbook are in [ECONOMY.md](ECONOMY.md) and
[economy/Blocky-League-Economy.xlsx](economy/Blocky-League-Economy.xlsx). This update closes repeated Moment XP,
stale settlement and date-rewind reward claims; separates fixed prizes from match/ad multipliers; caps new scout
card resale until six completed league starts; and removes play rewards from forfeits. Commercial Manager
upgrades now improve average net income after wages. Saved wallets and legacy card quotes are preserved.
US catalogue fallback prices are explicit, with no unsupported localized bundle-saving claim.

**Validation:** all **1,524 tests across 79 files** passed in one release regression batch. Typecheck and all five
web/native release packages passed. Source fingerprints, ZIP hashes, all 33 native game files, code signatures,
distribution provisioning, Apple sign-in/Game Center entitlements and the privacy manifest were verified against
the archived app and exported IPA. The workbook has nine sheets and 90 formulas with checked cached values.
These are code, model, build and installation checks; rendered game QA remains unverified because browser
preview access was rejected. No claim of perfect balance or every-device visual testing is made.

Source commit `d29306f` is pushed to `main` and `release/ios-app`; fallback tag
`testflight-build-6-2026-10-06` preserves that runtime. The [main workflow](https://github.com/iSharaf6/blocky-league/actions/runs/37442934089) passed regression checks,
typecheck, packaging and Pages deployment. The prior build 5 tag is retained. Archive, distribution IPA,
all five release ZIPs/manifests and verification logs are backed up locally in ignored `release/testflight/1.0-6/`.
The IPA SHA-256 is `4f049c45e2bd9a6fd498232acfb4a794e21e341dac445e8b10b34e713213a9f3`.
Apple accepted non-blocking missing-symbol warnings for the existing GoogleMobileAds/UserMessagingPlatform SDKs.

Native IAP products, production ad units and real/sandbox purchase verification remain prerequisites for public
monetization. Google credential creation/provider entry remains pending; native Apple is configured but requires
real-device sign-in testing. Existing account/referral features and all earlier gameplay fixes remain included.

## Previous TestFlight build 5 — 6 October 2026

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
