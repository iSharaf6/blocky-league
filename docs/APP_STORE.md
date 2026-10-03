# App Store release: Blocky League 1.0 (iPhone and iPad)

Everything App Store Connect asks for, ready to paste, and the order to do it in. The app is the itch web build in a
Capacitor shell (`ios/`, see docs/MONETIZATION.md 4.3): landscape only, no ads, no account, no online play, no
purchases, no network use. Version **1.0**, build **1**, bundle id **com.calynx.blockyleague**, iOS 15 and later,
iPhone and iPad.

## What only you can do, in order

1. **Merge the release branch into main** (PR from `release/ios-app`). GitHub Pages then publishes the support and
   privacy pages below. Check both links open before you submit.
2. **Join the Apple Developer Program:** <https://developer.apple.com/programs/enroll/> with your Apple ID (two-factor
   on). It costs US$99 a year (A$149 in Australia). Approval usually takes a day or two.
   - As an **individual**, the App Store shows your legal name as the seller.
   - To show **Calynx** instead, enrol as an **organisation**: it needs a registered business and a free D-U-N-S
     number, and takes longer.
3. **Xcode:** Settings, Accounts, add your Apple ID.
4. **Build and upload:**
   ```bash
   npm run ios
   open ios/App/App.xcodeproj
   ```
   In Xcode:
   1. Select the App target. Under Signing and Capabilities, tick Automatically manage signing and pick your team.
   2. Set the run destination to Any iOS Device (arm64).
   3. Product, Archive.
   4. In the Organizer: Distribute App, App Store Connect, Upload.
5. **App Store Connect** (<https://appstoreconnect.apple.com>), Apps, the + button, New App:
   - Platform iOS, the name below, primary language English (Australia).
   - Bundle ID `com.calynx.blockyleague`, SKU `blocky-league-ios`, full access.

   Fill in the fields below, then pick the uploaded build.
6. **Try it first (recommended):** the TestFlight tab, then add yourself as an internal tester and install it on your
   iPhone. Internal testing needs no review.
7. **Add for Review**, then **Submit**. Review usually takes a day or two.

## App information

| Field | Value |
|---|---|
| Name (30 max) | Blocky League |
| Subtitle (30 max) | Voxel football. Big goals. |
| Category | Games. Subcategories: Sports, then Arcade |
| Content rights | Does not contain, show or access third-party content |
| Age rating | Answer None or No to every question. Expected result: 4+ |
| Copyright | 2026 Calynx |
| Price | Free, all countries |
| Sign-in required for review | No |

## Version 1.0

**Promotional text** (170 max):

> Skill past defenders, smash screamers and build your club from Sunday League to the top. Free to play, no ads, no account, plays offline.

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
> - Daily challenges, win streaks and levels to climb
>
> New to it? Three quick drills teach you the basics in under a minute.
>
> No ads. No account. Plays offline. Touch controls built for landscape, and it works with a game controller too.
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

## App Privacy

Choose **Data Not Collected**. The app keeps progress on the device only, has no analytics, ads, account or
tracking, and makes no network requests. Privacy manifests: Capacitor's and Cordova's own ship in the build
(no tracking, no collected data, no required-reason APIs). The app's own code uses none.

## Export compliance

Already answered in the build (`ITSAppUsesNonExemptEncryption` false), so App Store Connect won't ask.

## Notes for the reviewer (App Review Information)

> Blocky League is a single-player football game. No account or login is needed and it makes no network requests.
> The app is landscape only on iPhone and iPad.
>
> To start: tap TAP TO PLAY, then LEARN THE BASICS (a short tutorial) or QUICK MATCH, then KICK OFF. Move by holding a thumb on the left of the screen; the buttons on the right pass, shoot and tackle.
>
> ROAD TO GLORY, MOMENTS, CLUB RUN and BLITZ unlock after you score your first goal in any match.
>
> Coins are earned only by playing and are spent in the in-game SHOP. There are no in-app purchases and no ads in this version.

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
- **Real-money coins:** add `cordova-plugin-purchase` and create the products (docs/MONETIZATION.md 4.1). Accept
  the Paid Apps Agreement with tax and banking first. Update the privacy page before that version ships.
