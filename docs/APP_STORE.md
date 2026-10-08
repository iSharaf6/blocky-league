# App Store release: Blocky League 1.0 (iPhone and iPad)

Everything App Store Connect asks for, ready to paste, and the order to do it in. The app uses the dedicated iOS web
build in a Capacitor shell (`ios/`, see docs/MONETIZATION.md 4.3): landscape play, optional accounts/cloud saves,
and no peer-to-peer online matches. Current provider configuration is recorded in docs/AUTH_SETUP.md; native
Apple is enabled, while Google setup and console achievements are still in progress.

- **Monetization interfaces:** Google AdMob ads (rewarded and between matches) and in-app purchases (gem packs,
  Starter Pack, NO ADS, Club Pass, Coin Doubler, PRO bundle). The design is docs/ECONOMY.md (economy v3).
- **Game Center:** 21 achievement definitions and four leaderboard definitions are prepared; console configuration and native device verification remain pending.
- **Uploaded build:** version **1.0**, build **7**, bundle id **com.calynx.blockyleague**, iOS 15 and later, iPhone and iPad.

## Current TestFlight build — 9 October 2026

App Store Connect app ID: `6819288055`. Version **1.0 (7)** is uploaded, processed and **Approved** for external
TestFlight testing. It is the only build in the private **Kareem First Beta** group, which has zero testers,
no public link and automatic notifications off. **Notify Testers** is available; manual distribution has not
started. Approved is distinct from Testing. The owner can choose **Notify Testers**, then **Testers > Add Testers**
to invite the first recipient. No tester has been added and no invitation or notification has been sent.
No public App Store release has been submitted.

Build 7 includes the final voxel football app icon, current optional-account support and privacy copy, and the
web-only SEO metadata and sitemap. Typecheck, all five release packages and 183 focused native/account/release
checks passed. All 33 bundled native web files match the synced bundle, signed archive and exported IPA.
The installed Release app's icon, title and main hub were inspected on iPhone 17 Simulator / iOS 26.5;
gameplay interaction, purchases and sign-in remain physical-device checks. Full evidence and limitations are in
[RELEASE_STATUS.md](RELEASE_STATUS.md); local release and approval records are in ignored `release/testflight/1.0-7/`.

The [live web game](https://isharaf6.github.io/blocky-league/) now serves the final branding and SEO, with current
support/privacy copy, canonical URLs, VideoGame structured data and a three-page sitemap. The
[Pages workflow](https://github.com/iSharaf6/blocky-league/actions/runs/37794780439) passed 1,524 regression checks,
typecheck, packaging and deployment. Source commit `f44befb` is preserved by `testflight-build-7-2026-10-09`;
live metadata, page copy and artwork were verified after deployment.

The previous Blocky League Playtest group and its <https://testflight.apple.com/join/ChfvkUXC> link are separate
from this private first-tester group. Build history is recorded in [RELEASE_STATUS.md](RELEASE_STATUS.md).

The beta uses Google test ad units. Supabase now accepts native Apple sign-in for `com.calynx.blockyleague`, with
manual linking and the exact native/web redirects configured. An actual device sign-in still needs verification.
Google remains disabled while its OAuth setup is underway. Browser Apple sign-in stays off until a Services ID
and OAuth secret are configured and its public build flag is enabled. Game Center definitions and native purchase
product configuration remain pending; guest gameplay and local saving are available. No public App Store version
has been submitted.

## Applied listing draft — 9 October 2026

The authenticated App Store Connect session saved the English (US) and English (Australia) names and subtitles
shown below, plus version 1.0 promotional text, description, keywords, support and marketing URLs. Games > Sports
and Casual are saved. Build **1.0 (7)** is attached to the version draft. These changes remain an unpublished
App Store listing; external TestFlight approval is a separate status.

The English (US) header and search creative are accepted, each with one asset in its slot. English (Australia)
explicitly uses those English (US) creative assets. The age questionnaire is saved with the observed regional
ratings documented below. The owner's content-rights declaration remains unset.

English (US) has five accepted screenshots in each of the medium iPhone, largest iPhone and iPad 13-inch slots,
in filename order 01–05. The final phone career captures use a thinner caption band so the complete fixture
reward line and bottom controls fit. English (Australia) displays those same five final screenshots per slot
through **Using Existing Assets**; its custom upload count is zero because the English (US) assets are inherited.

The final local export pack has three creative assets, fifteen screenshots and three review contact sheets.
Independent validation matched all 21 files to their manifest dimensions, opaque RGB channels, byte counts and
SHA-256 hashes. The screenshot captions and all three device contact sheets were inspected against the game's
features, and all three career captures were checked at original resolution. The final manifest timestamp is
`2026-10-08T14:36:18.729Z` (9 October in Australia/Sydney). The app icon is byte-identical to the native build's
1024-pixel source icon.

## How the app makes money

| Where | What | Rules |
|---|---|---|
| Shop, STORE tab, COINS | **FREE COINS:** watch a rewarded ad, +75 coins | Up to 5 a day; only on the player's tap |
| Shop, STORE tab, GEMS | **FREE GEMS:** watch a rewarded ad, +3 gems | Once a day; only on the player's tap |
| Full time | **Double your coins** with a rewarded ad | Optional |
| Daily gift | **Double the gift's coins** with a rewarded ad | Optional |
| A lost cup tie or decider | **Play it again** with a rewarded ad (or 50 gems) | Once a day by ad; one replay a match |
| Shop, today's deal | **A new deal today** with a rewarded ad (or 15 gems) | Once a day |
| MY CLUB, STADIUM | **One matchday off a build** with a rewarded ad | Once a day |
| Before a kick-off | A full-screen ad (interstitial) | At most every 2 breaks and 4 minutes apart; never mid-match; never in the first match or the basics |
| Shop, STORE tab | **Gem packs** US$0.99 to $19.99 (the first buy of each doubled), Starter Pack $1.99, **NO ADS $3.99**, **PRO bundle $9.99** (NO ADS, the Coin Doubler and 600 gems) | NO ADS removes the full-screen ads; rewarded ads stay (they're the player's choice). Gems never buy anything random |
| Shop, STORE tab and BADGES, JOURNEYS | **Club Pass** $3.99 per permanent selected Journey (or 600 gems): 5,560 coins, 150 gems and six identity pieces on its 30 tiers | Buying late unlocks reached tiers; nothing reached is lost |
| Shop, STORE tab | **Coin Doubler** $4.99 once: every match pays double coins | Multiplies the match coin payout; does not directly change player stats |
| After the first win | A one-time welcome offer for the Starter Pack | No timer; it stays in the shop |

**Ad request settings:** requests are configured as child-directed, with a G maximum content rating and
non-personalised ads. The app does not show an App Tracking Transparency prompt. The switch is `ADMOB_KID_SAFE`
in `src/platform/adConfig.ts`; the current beta uses test units and does not earn ad revenue.

## Public-release setup reference

Enrollment, the app record and the build 7 TestFlight upload are complete. The following setup reference also
includes earlier steps; it is not a list of actions already performed. Native purchase products, Game Center
definitions, production ad units, the live App Privacy answers, content rights and physical-device checks remain
public-release work. TestFlight approval does not approve a public App Store version.

1. **Publish the current web package.** Verify the deployed game, support and privacy pages against the release
   source and check the URLs below before a public App Store submission. Local package validation does not prove
   that the current SEO and support/privacy changes are published.
2. **Join the Apple Developer Program:** <https://developer.apple.com/programs/enroll/> with your Apple ID (two-factor
   on). US$99 a year (A$149 in Australia). As an individual the App Store shows your legal name as the seller; to
   show **Calynx**, enrol as an organisation (needs a registered business and a free D-U-N-S number).
3. **Paid Apps Agreement** (App Store Connect, Business): accept it, then add your bank account and the tax forms
   (W-8BEN for Australia). Purchases don't load until it says Active. Also apply for the **Small Business Program**
   (Apple then takes 15% instead of 30%).
4. **AdMob** (free): <https://admob.google.com>, sign in with a Google account, add payment details.
   1. Apps, Add app, iOS, "not published yet", name Blocky League.
   2. In that app, create two ad units: **Rewarded** and **Interstitial**.
   3. Put the real ids in the code. In `src/platform/adConfig.ts`, set `interstitial` and `rewarded` to the two ad
      unit ids (`ca-app-pub-…/…`). In `ios/App/App/Info.plist`, set `GADApplicationIdentifier` to the App ID
      (`ca-app-pub-…~…`). Until then the app shows Google's **test** ads and earns nothing.
   4. Privacy and messaging: create the **GDPR** message (Google's consent form for Europe) and publish it.
   5. After the app is live, link it to the App Store listing in AdMob. Then add an **app-ads.txt** file with the
      line AdMob gives you at the root of your developer website: a repo named `iSharaf6.github.io` with
      `app-ads.txt` in it serves `https://isharaf6.github.io/app-ads.txt`.
5. **Xcode:** Settings, Accounts, add your Apple ID. Then:
   ```bash
   npm run ios
   open ios/App/App.xcodeproj
   ```
   In Xcode:
   1. Select the App target. Under Signing and Capabilities, tick Automatically manage signing and pick your team.
      The Game Center capability is already in `App.entitlements`.
   2. Set the run destination to Any iOS Device (arm64).
   3. Product, Archive.
   4. In the Organizer: Distribute App, App Store Connect, Upload.
6. **App Store Connect** (<https://appstoreconnect.apple.com>), Apps, the + button, New App:
   - Platform iOS, the name below, primary language English (U.S.). The current app record uses this locale.
   - Bundle ID `com.calynx.blockyleague`, SKU `blocky-league-ios`.

   Then:
   - **In-App Purchases:** create the ten products in the table below (the same as docs/MONETIZATION.md section 1:
     ids, types, prices). Each needs a display name, a description and a review screenshot. Use a screenshot of the
     shop's STORE tab from the simulator. The four coin packs of the old economy (`bl.coins.*`) are gone: if any
     was already created, leave it out of the version (an id can never be reused, so do not delete and recreate).

     | Product ID | Type | Price (US$) | Display name | Description |
     |---|---|---|---|---|
     | `bl.gems.100` | Consumable | 0.99 | 100 Gems | 100 gems for your club. |
     | `bl.gems.300` | Consumable | 2.99 | 330 Gems | 300 gems and 30 bonus gems. |
     | `bl.gems.500` | Consumable | 4.99 | 600 Gems | 500 gems and 100 bonus gems. |
     | `bl.gems.1000` | Consumable | 9.99 | 1,300 Gems | 1,000 gems and 300 bonus gems. |
     | `bl.gems.2000` | Consumable | 19.99 | 3,000 Gems | 2,000 gems and 1,000 bonus gems. |
     | `bl.starter` | Non-Consumable | 1.99 | Starter Pack | 2,000 coins, 150 gems and the Gold ball. One time only. |
     | `bl.noads` | Non-Consumable | 3.99 | No Ads | No ad breaks between matches. |
     | `bl.pass` | Consumable | 3.99 | Club Pass | Permanent Club Pass for the selected Journey: coins, gems and six identity pieces on its 30 tiers. |
     | `bl.doubler` | Non-Consumable | 4.99 | Coin Doubler | Every match pays double coins, for good. |
     | `bl.pro` | Non-Consumable | 9.99 | Pro Bundle | No Ads, the Coin Doubler and 600 gems in one. |

     Review notes for each gem pack: "Gems are the premium currency. They never buy anything random: every use is a
     stated outcome at a shown price (finish a stadium build, replay a lost cup tie, a Scouting Network tier, coins
     at a fixed rate, the Club Pass). The first purchase of each pack grants double."
   - **Game Center:** turn it on for the app, then add the 21 achievements and the 4 leaderboards below, each
     achievement with its image from `store-assets/game-center/<id>.png`.
   - Fill in the fields below, pick the uploaded build, and add the in-app purchases to the version.
7. **Try it first:** the TestFlight tab, then add yourself as an internal tester and install it on your iPhone.
   Purchases there are free sandbox ones. Check:
   - a gem pack, NO ADS and RESTORE PURCHASES
   - a rewarded ad
   - the Game Center banner when you win a match
8. Once the public-release prerequisites are verified, **Add for Review**, then **Submit**. Apple's review timing varies.

## App information

| Field | Value |
|---|---|
| Name (30 max) | Blocky League: Football (English AU, 23); Blocky League: Soccer (English US, 21) |
| Subtitle (30 max) | Voxel soccer. Build your club. (English AU, 30); Voxel football. Build a club. (English US, 29) |
| Category | Games. Subcategories: Sports, then Casual (live App Store Connect picker checked 9 October 2026; Arcade is absent) |
| Content rights | Unset in live App Store Connect (dialog canceled 9 October 2026); the owner's content-rights declaration remains pending. |
| Age rating | Live questionnaire saved 9 October 2026: advertising Yes; infrequent cartoon/fantasy violence; Loot Boxes Yes for randomized scout cards. Native chat, UGC, unrestricted web access, gambling and contests No. Observed live ratings: **9+ in 171 countries**, **12+ Vietnam**, **16+ Australia and Brazil**, **All in Korea**. |
| Copyright | 2026 Calynx |
| Price | Free, all countries |
| Sign-in required for review | No |

**Age-rating evidence:** `src/meta/shop.ts` `openPack` spends 1 Scout Ticket for a Scout Pack or 3 for an Elite Pack; `rollPack` draws a randomized functional player card. The daily free pack is also randomized. Source checks confirm that tickets come from the initial save grant, daily challenges and gifts; they cannot be purchased with money, gems or coins, and the paid Club Pass does not grant them. Odds are displayed before opening.

**Descriptor interpretation:** the saved Loot Boxes Yes answer discloses this randomized-card mechanic. Apple's [age-rating definitions](https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions/) describe randomized items for purchase without an explicit earned-token exemption; its [age-rating API](https://developer.apple.com/documentation/appstoreconnectapi/ageratingdeclarationupdaterequest/data-data.dictionary/attributes-data.dictionary) describes the field as covering loot boxes or other randomized virtual item mechanics. Applying that descriptor to earned-only ticket packs is our interpretation, separate from the source-verified fact that no real-money purchase buys a random card. Observed live results on 9 October 2026 were 9+ in 171 countries, 12+ in Vietnam, 16+ in Australia and Brazil, and All in Korea. These are console results rather than predictions from the code.

## Version 1.0

The source of truth for launch copy is [store-assets/app-store/metadata](../store-assets/app-store/metadata/README.md). English (Australia) is shown below; English (US) has localized sport and kit wording. Character and byte limits were checked against Apple's current documentation on 9 October 2026. These source files do not update the live App Store Connect listing.

**Promotional text** (170 max, 152 characters):

> Build your club, climb eight divisions and score with timed skill moves. Try knockout cups, short challenges and Blitz power-ups between league matches.

**Description** (4,000 max, 1331 characters):

> Blocky League brings 11-a-side football to a chunky voxel pitch. Play quick matches, pull off timed skill moves and build your own club from Park League to the top.
>
> - Road to Glory: climb eight divisions with transfers, training and promotion. Design your kit and crest, develop your players and grow your stadium.
> - Quick Match: pick from eleven original clubs and four difficulty levels, from Easy to Legend.
> - Blocky Cup: play knockout ties and settle draws with penalty shootouts.
> - Club Run: take on seven matches with one life and choose perks between wins.
> - Moments: tackle eight short challenges with three stars to earn in each.
> - Blitz: collect on-pitch power-ups including Turbo, Mega Shot and Freeze.
>
> Thread through balls, cross for a header, time a first-time finish or win the ball with a slide tackle. Celebrate your goals and watch instant replays. Play in daylight, at sunset or under floodlights, with rain and snow on the pitch.
>
> Earn coins, mastery badges and new celebrations, balls and club looks. Club Journeys keep your progress without a monthly reset.
>
> Start with three short practice drills. Landscape touch controls suit iPhone and iPad, with game controller support too.
>
> Single-player matches work offline with no account required. Ads, in-app purchases and cloud saves need an internet connection.

**Keywords** (100 bytes max, 99 ASCII bytes):

```
offline,career,manager,goal,penalty,shootout,dribble,skills,cup,transfer,tactics,controller,striker
```

The keyword field avoids words already used in the localized name, subtitle and categories. The copy describes the native single-player build; Game Center availability is omitted until its console setup and device behavior are verified. Optional-account configuration currently permits offline guest gameplay.

**TestFlight copy:** [Beta App Description](../store-assets/app-store/metadata/testflight-beta-description.txt) and [What to Test](../store-assets/app-store/metadata/testflight-what-to-test.txt). Feedback email: `calynx@zohomail.com.au`. Check the beta description's service-status sentence against the build being invited.

| Field | Value |
|---|---|
| Support URL | https://isharaf6.github.io/blocky-league/support.html |
| Marketing URL | https://isharaf6.github.io/blocky-league/ |
| Privacy policy URL (App Information) | https://isharaf6.github.io/blocky-league/privacy.html |
| Version | 1.0 |

## Product-page artwork (store-assets/app-store)

| App Store Connect slot | Upload |
|---|---|
| Header | `creative/header-3840x1646.png` (3840 × 1646); the alternative `creative/universal-5244x2950.png` (5244 × 2950) is also valid. Upload one header. |
| Search Results | `creative/search-3840x2560.png` (3840 × 2560) |
| iPhone medium display | `screenshots/iphone-medium/` (2622 × 1206), all five in filename order |
| iPhone largest display | `screenshots/iphone-large/` (2868 × 1320), all five in filename order |
| iPad 13" | `screenshots/ipad-13/` (2752 × 2064), all five in filename order |

Screenshot order is **Score screamers**, **Pass and move**, **Blitz power ups**, **Road to Glory**, **Bend it**.
The PNGs are opaque RGB; the [asset manifest](../store-assets/app-store/manifest.json) records dimensions,
capture context and SHA-256 hashes. The [asset README](../store-assets/app-store/README.md) describes the
reproduction workflow and [review gallery](../store-assets/app-store/index.html). Contact sheets are review aids
and must not be uploaded as screenshots. The previous `store-assets/screenshots/` set is superseded.

Screenshots use the current game with Chromium touch emulation, safe-area insets and staged development hooks;
they are not installed-iOS captures. The short caption band reduces the game viewport height. Creative assets
use the game's models and poses with a promotional camera. Verify the corresponding gameplay on the approved
TestFlight build before a public release; native WebKit rendering and performance can differ.

The app icon comes from the build (`store-assets/ios-app-icon-1024.png`); App Store Connect takes no separate upload.

## Product Page Optimization after public launch

No experiment has been created or started. Once the app is publicly available and real impressions/downloads
support a useful test, compare the current **Score screamers** first screenshot against one treatment that moves
**Road to Glory** first, keeping the other screenshots' relative order. Keep the icon, artwork, captions and
listing copy stable so screenshot order is the tested variable.

Use App Store Connect's duration estimate before allocating traffic. Track conversion rate, impressions,
downloads and confidence against the original page; keep the control if evidence remains inconclusive.
Apply a treatment only after meaningful volume and at least 90% confidence, following Apple's
[Product Page Optimization guidance](https://developer.apple.com/app-store/product-page-optimization/).

## Native privacy manifest

`ios/App/App/PrivacyInfo.xcprivacy` is included in the app resources. It declares the app's UserDefaults access
with required reason `CA92.1` for the on-device paid receipt journal. This declaration is separate from the App
Privacy questionnaire below; it does not assert that the app or its SDKs collect no data.

## App Privacy (the questionnaire)

The native app now offers optional accounts and cloud progress saving. Players can continue locally without an
account. Update the live App Store Connect questionnaire before submitting this build: the source change alone
does not update Apple's console. The account backend receives a linked user ID, game progress and, when supplied
by the chosen sign-in provider, email/display name. It is used for account access and restoring progress, not tracking.

| Account data type | Linked to the user | Used for tracking | Purpose |
|---|---|---|---|
| User ID | Yes | No | App Functionality |
| Gameplay Content (saved career, achievements and progress) | Yes | No | App Functionality |
| Email Address (when supplied for sign-in) | Yes | No | App Functionality |
| Name (optional provider display name) | Yes | No | App Functionality |
| Purchase History (owned items and transaction IDs in the synced save; no payment-card data) | Yes | No | App Functionality |

Apple's [App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/) define Gameplay Content
for saved games and require disclosing optional collection as well as guest-mode behavior.

The ad SDK also collects data. The following entries come from its privacy manifest
(GoogleMobileAds.framework/PrivacyInfo.xcprivacy). Xcode's privacy report (Organizer, right-click the archive,
Generate Privacy Report) shows the same.

| Data type | Linked to the user | Used for tracking | Purposes |
|---|---|---|---|
| Coarse Location (from the IP address) | Yes | **No** | Third-Party Advertising, Developer's Advertising, Analytics |
| Device ID | Yes | **No** | Third-Party Advertising, Developer's Advertising, Analytics |
| Advertising Data | Yes | No | Third-Party Advertising, Developer's Advertising, Analytics |
| Product Interaction | Yes | No | Third-Party Advertising, Developer's Advertising, Analytics |
| Crash Data | No | No | Analytics |
| Performance Data | No | No | Third-Party Advertising, Developer's Advertising, Analytics |
| Other Diagnostic Data | No | No | Third-Party Advertising, Developer's Advertising, Analytics |

**Tracking: answer No.** Google's manifest marks the device id as possibly used for tracking: that's the IDFA,
which only exists when a player allows tracking. This app never asks (no App Tracking Transparency prompt) and
sends every request as child-directed, so nothing is tracked.

Declaring tracking without asking for permission is a common reason for rejection, so keep it No unless a later
version adds the prompt. Apple handles purchases and Game Center. When a player explicitly uses Game Center to
connect a cloud account, the backend additionally receives its verified user identity for that account; include the
linked User ID entry above. Never infer "no data collected" from guest/offline play when the optional service exists.

## Export compliance

Already answered in the build (`ITSAppUsesNonExemptEncryption` false), so App Store Connect won't ask.

## Game Center achievements

Add all 21 under the app's Game Center section, with each image from `store-assets/game-center/<id>.png`
(1024x1024). Not hidden, achievable more than once: No. The ids must match exactly: they come from
`src/meta/achievements.ts`. 740 points of the 1000 allowed.

| ID | Title | Points | Before earning | After earning |
|---|---|---|---|---|
| `bl.ach.first_win` | First Win | 10 | Win a match. | You won your first match. |
| `bl.ach.wins_50` | Fifty Up | 50 | Win 50 matches. | You have won 50 matches. |
| `bl.ach.streak_5` | On Fire | 30 | Win 5 matches in a row. | You won 5 matches in a row. |
| `bl.ach.level_10` | Rising Star | 30 | Reach level 10. | You reached level 10. |
| `bl.ach.run_champion` | Run Champion | 60 | Win all 7 matches of a Club Run. | You won all 7 matches of a Club Run. |
| `bl.ach.moments_all` | Moment Maker | 60 | Get three stars on every Moment. | Three stars on every Moment. |
| `bl.ach.finisher.1` | Poacher | 10 | FINISHER badge: 2 goals. | FINISHER badge earned: 2 goals. |
| `bl.ach.finisher.3` | Sharpshooter | 30 | FINISHER badge: 20 goals. | FINISHER badge earned: 20 goals. |
| `bl.ach.finisher.5` | Goal Machine | 60 | FINISHER badge: 55 goals. | FINISHER badge earned: 55 goals. |
| `bl.ach.playmaker.1` | Link Player | 10 | PLAYMAKER badge: 5 playmaker points (assists, and one for every 10 passes). | PLAYMAKER badge earned: 5 playmaker points. |
| `bl.ach.playmaker.3` | Conductor | 30 | PLAYMAKER badge: 60 playmaker points (assists, and one for every 10 passes). | PLAYMAKER badge earned: 60 playmaker points. |
| `bl.ach.playmaker.5` | Master Architect | 60 | PLAYMAKER badge: 180 playmaker points (assists, and one for every 10 passes). | PLAYMAKER badge earned: 180 playmaker points. |
| `bl.ach.wall.1` | Stopper | 10 | WALL badge: 4 wall points (tackles won, and 3 for a clean sheet). | WALL badge earned: 4 wall points. |
| `bl.ach.wall.3` | Enforcer | 30 | WALL badge: 45 wall points (tackles won, and 3 for a clean sheet). | WALL badge earned: 45 wall points. |
| `bl.ach.wall.5` | The Wall | 60 | WALL badge: 135 wall points (tackles won, and 3 for a clean sheet). | WALL badge earned: 135 wall points. |
| `bl.ach.magician.1` | Showboat | 10 | MAGICIAN badge: 5 skill moves and men beaten. | MAGICIAN badge earned: 5 skill moves and men beaten. |
| `bl.ach.magician.3` | Nutmeg King | 30 | MAGICIAN badge: 60 skill moves and men beaten. | MAGICIAN badge earned: 60 skill moves and men beaten. |
| `bl.ach.magician.5` | The Magician | 60 | MAGICIAN badge: 165 skill moves and men beaten. | MAGICIAN badge earned: 165 skill moves and men beaten. |
| `bl.ach.keeper.1` | Safe Hands | 10 | KEEPER badge: 2 saves by your keeper. | KEEPER badge earned: 2 saves by your keeper. |
| `bl.ach.keeper.3` | Cat Reflexes | 30 | KEEPER badge: 25 saves by your keeper. | KEEPER badge earned: 25 saves by your keeper. |
| `bl.ach.keeper.5` | Golden Glove | 60 | KEEPER badge: 65 saves by your keeper. | KEEPER badge earned: 65 saves by your keeper. |

## Game Center leaderboards

All four use score format Integer, submission type Best Score, sort High to Low (src/meta/leaderboards.ts).

| ID | Name | Type | Description | Suffix |
|---|---|---|---|---|
| `bl.lb.goals` | Goals Scored | Classic | Every goal your team has scored. | goal / goals |
| `bl.lb.wins` | Matches Won | Classic | Every match you have won. | win / wins |
| `bl.lb.streak` | Best Win Streak | Classic | Your most wins in a row. | win / wins |
| `bl.lb.season` | Best Season | Classic | Most XP earned in one monthly season. | XP / XP |

Apple has no calendar-month recurring leaderboard (its longest repeat is 30 days, which drifts off the months), so
Best Season is a Classic board of each player's best month. This is now a legacy compatibility board: permanent
Club Journey IDs submit no score to it. Keep its existing live ID and definition; goals, wins and streaks remain active.

## Notes for the reviewer (App Review Information)

> Blocky League is a single-player football game. No account or login is needed. The app is landscape only on iPhone and iPad.
>
> To start: tap TAP TO PLAY, then LEARN THE BASICS (three practice drills) or QUICK MATCH, then KICK OFF. Move with the left thumbstick; pushing it fully sprints. The buttons on the right pass, shoot and tackle.
>
> ROAD TO GLORY, MOMENTS, CLUB RUN and BLITZ unlock after you score your first goal in any match.
>
> Ads (Google AdMob, family-rated, child-directed, no tracking): optional rewarded videos (SHOP, STORE: FREE COINS and FREE GEMS; "double" offers at full time and on the daily gift; a replay of a lost cup tie; a new daily deal), each capped per day, and an occasional full-screen ad before a later kick-off. Ad breaks wait until all full-time scenes finish and at least eight seconds have passed on the results screen; an immediate rematch skips the ad. No ad interrupts play or half time.
>
> In-app purchases are in SHOP, STORE: five gem packs (the first buy of each pays double), a Starter Pack, NO ADS (removes the full-screen ads), the Club Pass (a permanent paid track for the selected Club Journey, also shown in BADGES, JOURNEYS), the Coin Doubler and the PRO bundle, with RESTORE PURCHASES. Gems are also earned by playing. Gems buy only stated outcomes at a shown price, each confirmed with one tap: coins at a fixed rate, finishing a stadium build, a replay of a lost cup tie, a Scouting Network tier (a guaranteed prospect quality, never a chance), the Club Pass. Player scout packs in SHOP, SCOUT cost Scout Tickets, which are earned by playing and can't be bought with money, gems or coins; their odds are shown.
>
> Game Center achievements and leaderboards may be unavailable while their console configuration is completed. The native purchase interface can also be unavailable until its products are configured. Core guest gameplay remains available. After some wins the app may show Apple's own rating prompt.

For build 7 beta review, use the current [TestFlight review notes](../store-assets/app-store/metadata/testflight-review-notes.txt),
which also disclose earned-ticket randomized packs and the observed age ratings. Recheck service status before a
public review. Review contact name, phone and email belong to the developer, not a beta tester.

## What the app leaves out (on purpose)

The app hides three web features. `src/platform/native.ts` (`inNativeApp()`) checks for `window.Capacitor`, while
the web and itch builds still expose their browser-specific features:

- **ONLINE:** codes are swapped by hand, with no relay server. They mostly fail on mobile data, and the "this browser"
  room means nothing in an app.
- **BACKUP:** its export is a browser download. iOS backs the app's data up itself.
- **Goal clips:** WebM, which Photos can't save, and the download goes nowhere in an app.

## Later updates

- Increment the Build number for every new upload. TestFlight iterations can keep marketing version 1.0; bump the marketing version for a new App Store release.
- **More ad money, ethically:** a neutral age screen at first launch would let players 13 and over get standard
  (still untracked) ads while younger ones stay child-directed. That needs `ADMOB_KID_SAFE` per player, and the
  privacy page and the questionnaire updated to match.
- **Before you change achievements:** add new ones, never rename or reuse a live id. Apple caps points at 1000.
