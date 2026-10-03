# App Store release: Blocky League 1.0 (iPhone and iPad)

Everything App Store Connect asks for, ready to paste, and the order to do it in. The app is the itch web build in a
Capacitor shell (`ios/`, see docs/MONETIZATION.md 4.3): landscape only, no account, no online play.

- **Earns money from:** Google AdMob ads (rewarded and between matches, kid-safe) and in-app purchases (coin packs,
  Starter Pack, NO ADS, Club Pass, Coin Doubler). The design is docs/ECONOMY.md.
- **Game Center:** 21 achievements.
- **Build:** version **1.0**, build **1**, bundle id **com.calynx.blockyleague**, iOS 15 and later, iPhone and iPad.

## How the app makes money

| Where | What | Rules |
|---|---|---|
| Shop, COINS tab | **FREE COINS:** watch a rewarded ad, +75 coins | Up to 5 a day; only on the player's tap |
| Full time | **Double your coins** with a rewarded ad | Optional |
| Daily gift | **Double the gift** with a rewarded ad | Optional |
| Before a kick-off | A full-screen ad (interstitial) | At most every 2 breaks and 4 minutes apart; never mid-match; never in the first match or the basics |
| Shop, COINS tab | Coin packs US$0.99 to $14.99 (the first buy of each doubled), Starter Pack $1.99, **NO ADS $3.99** | NO ADS removes the full-screen ads; rewarded ads stay (they're the player's choice) |
| Shop, COINS tab and BADGES, SEASON | **Club Pass** $3.99 a month: about 6,000 coins and that month's own goal explosion and trail | Buying late unlocks reached tiers; nothing reached is lost |
| Shop, COINS tab | **Coin Doubler** $4.99 once: every match pays double coins | Looks and coins only, never an edge in a match |
| After the first win | A one-time welcome offer for the Starter Pack | No timer; it stays in the shop |

**Kid-safe:** every ad request is child-directed, so ads are family-rated (G), never personalised, and there's no
tracking prompt. It earns less per ad than tracked ads; it's the right line for a game kids play (and US law,
COPPA). The switch is `ADMOB_KID_SAFE` in `src/platform/adConfig.ts`.

## What only you can do, in order

1. **Merge the release branch into main** (PR from `release/ios-app`). GitHub Pages then publishes the support and
   privacy pages below. Check both links open before you submit.
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
   - Platform iOS, the name below, primary language English (Australia).
   - Bundle ID `com.calynx.blockyleague`, SKU `blocky-league-ios`.

   Then:
   - **In-App Purchases:** create the eight products exactly as docs/MONETIZATION.md section 1 lists them (ids,
     types, prices). That includes the **Club Pass** (`bl.pass`, Consumable, $3.99) and the **Coin Doubler**
     (`bl.doubler`, Non-Consumable, $4.99). Each needs a display name, a description and a review screenshot.
     Use a shop screenshot from the simulator.
   - **Game Center:** turn it on for the app, then add the 21 achievements and the 4 leaderboards below, each
     achievement with its image from `store-assets/game-center/<id>.png`.
   - Fill in the fields below, pick the uploaded build, and add the in-app purchases to the version.
7. **Try it first:** the TestFlight tab, then add yourself as an internal tester and install it on your iPhone.
   Purchases there are free sandbox ones. Check:
   - a coin pack, NO ADS and RESTORE PURCHASES
   - a rewarded ad
   - the Game Center banner when you win a match
8. **Add for Review**, then **Submit**. Review usually takes a day or two.

## App information

| Field | Value |
|---|---|
| Name (30 max) | Blocky League |
| Subtitle (30 max) | Voxel football. Big goals. |
| Category | Games. Subcategories: Sports, then Arcade |
| Content rights | Does not contain, show or access third-party content |
| Age rating | None or No to every content question, **loot boxes No** (scout packs cost earned-only tokens, never money). If asked: advertising yes, in-app purchases yes. Expected: 4+ |
| Copyright | 2026 Calynx |
| Price | Free, all countries |
| Sign-in required for review | No |

## Version 1.0

**Promotional text** (170 max):

> Skill past defenders, smash screamers and build your club from Sunday League to the top. Free to play, no account needed, plays offline.

**Description:**

> Skill past defenders. Smash screamers. Win the league.
>
> Blocky League is fast, chunky voxel football for your iPhone and iPad.
>
> Take a defender on and watch his head. When a big ! pops up, hit SKILL and leave him on the floor. Chain your tricks and score a SKILL GOAL!
>
> - Pull off roulettes, rainbow flicks and stepovers
> - Smash screamers, whip in crosses and bang in volleys
> - Road to Glory: build your own club and climb from Sunday League to the top
> - Blocky Cup: knockout ties and tense penalty shootouts
> - Club Run: seven matches, one life, a new perk after every win
> - Moments: quick challenges to earn three stars
> - Blitz: crazy power ups like Mega Shot, Freeze and Turbo
> - Win coins and unlock celebrations, new balls, goal explosions and new players
> - Daily challenges, win streaks, levels and Game Center achievements
>
> New to it? Three quick drills teach you the basics in under a minute.
>
> No account needed. Plays offline. Touch controls built for landscape, and it works with a game controller too.
>
> Lace up and kick off now!

**Keywords** (100 max, exactly 100):

```
soccer,football,voxel,skills,dribble,cup,penalty,shootout,goal,striker,career,manager,arcade,offline
```

| Field | Value |
|---|---|
| Support URL | https://isharaf6.github.io/blocky-league/support.html |
| Marketing URL | https://isharaf6.github.io/blocky-league/ |
| Privacy policy URL (App Information) | https://isharaf6.github.io/blocky-league/privacy.html |
| Version | 1.0 |

## Screenshots (store-assets/screenshots, all landscape)

| App Store Connect slot | Upload |
|---|---|
| iPhone 6.9" | `ios-6.9/` (2868x1320), all five in order: title, pass, goal, blitz, market |
| iPhone 6.5" | Optional once 6.9" is in; `ios-6.5/` (2778x1284) if it asks |
| iPad 13" | `ipad-13/` (2752x2064): goal, blitz, fulltime |

The app icon comes from the build (`ios-app-icon-1024.png`); App Store Connect takes no separate upload.

## App Privacy (the questionnaire)

Data is collected, all of it by Google's ad SDK. These answers are from its own privacy manifest
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
version adds the prompt. Purchases and Game Center are handled by Apple and aren't "collected" by the app.

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
Best Season is a Classic board of each player's best month.

## Notes for the reviewer (App Review Information)

> Blocky League is a single-player football game. No account or login is needed. The app is landscape only on iPhone and iPad.
>
> To start: tap TAP TO PLAY, then LEARN THE BASICS (a short tutorial) or QUICK MATCH, then KICK OFF. Move by holding a thumb on the left of the screen; the buttons on the right pass, shoot and tackle.
>
> ROAD TO GLORY, MOMENTS, CLUB RUN and BLITZ unlock after you score your first goal in any match.
>
> Ads (Google AdMob, family-rated, child-directed, no tracking): an optional rewarded video for coins (SHOP, COINS, FREE COINS; also "double" offers at full time and on the daily gift), and an occasional full-screen ad before a kick-off, never during play.
>
> In-app purchases are in SHOP, COINS: four coin packs (the first buy of each pays double), a Starter Pack, NO ADS (removes the full-screen ads), the Club Pass (this month's extra season track, also shown in BADGES, SEASON) and the Coin Doubler, with RESTORE PURCHASES. Coins are also earned by playing. Player scout packs in SHOP, PLAYERS cost Scout Tokens, which are earned by playing and can't be bought; their odds are shown.
>
> Game Center achievements and leaderboards are reported as you play; BADGES has GAME CENTER ACHIEVEMENTS and LEADERBOARDS buttons. After some wins the app may show Apple's own rating prompt.

Also fill in your name, phone and email as the review contact.

## What the app leaves out (on purpose)

The app hides three web features. `src/platform/native.ts` (`inNativeApp()`) checks for `window.Capacitor`, so
the same itch build still has them on the web:

- **ONLINE:** codes are swapped by hand, with no relay server. They mostly fail on mobile data, and the "this browser"
  room means nothing in an app.
- **BACKUP:** its export is a browser download. iOS backs the app's data up itself.
- **Goal clips:** WebM, which Photos can't save, and the download goes nowhere in an app.

## Later updates

- Bump the version (Xcode, App target, General: Version 1.0.1 or 1.1) and the Build number every upload.
- **More ad money, ethically:** a neutral age screen at first launch would let players 13 and over get standard
  (still untracked) ads while younger ones stay child-directed. That needs `ADMOB_KID_SAFE` per player, and the
  privacy page and the questionnaire updated to match.
- **Before you change achievements:** add new ones, never rename or reuse a live id. Apple caps points at 1000.
