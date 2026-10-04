# Monetisation: gem packs in the apps, progress earned everywhere

_Written 3 October 2026. The code and tests below were run. Every console click path, fee and price-point figure was written from the stores' documentation, not from a live console (no accounts exist yet), so check each one as you go._

**The short version**

- **iOS and Android (later, via Capacitor):** real-money gem packs (economy v3: money buys gems, never coins), a one-time Starter Pack, NO ADS, the Coin Doubler, the Club Pass and the PRO bundle, through the stores' own billing (`cordova-plugin-purchase`). You create the products in App Store Connect and Play Console with the ids in section 1.
- **CrazyGames, Poki, itch, your own site:** no real money, ever. The same shop's STORE tab shows FREE COINS (a rewarded ad for 75 coins, at most 5 a day) and FREE GEMS (3 gems, once a day) on the portals; on the plain web (no ads) the STORE tab still swaps gems earned by playing for coins, the Club Pass and the Scouting Network.
- **One rule everywhere:** a purchase is paid out once, saved, and only then confirmed to the store. A store that delivers the same purchase twice never pays twice.

---

## 0. Status (honest)

| Piece | State |
|---|---|
| Catalogue, providers, idempotent grants, restore (`src/platform/iap.ts`) | Implemented; `tests/iap.test.ts` (27 tests) covers the rules, the dev store and a stand-in for the native plugin |
| Shop STORE tab, FREE COINS, RESTORE PURCHASES (`src/ui/shop.ts`, `shop.css`) | Implemented; exercised in a browser on `?iap=dev` (buy a pack, the Starter Pack, NO ADS, restore, cancel) and on `?portal=crazygames` (the 5 a day cap) |
| NO ADS silencing interstitials (`src/platform/ads.ts` `adFree`) | Implemented and tested; rewarded ads stay |
| Save fields and cloud copy (`SaveData.iap`) | Implemented; old saves load; a save holding a purchase is never given away unasked by cloud sync |
| The real native bridge | `cordova-plugin-purchase` 13.18.0 is installed in the iOS app; every name `iap.ts` uses was checked against its own typings (`www/store.d.ts`, cancel code 6777006). In the simulator it starts up and asks the App Store for the ten products. **Not yet run against a real store:** that needs the products in App Store Connect (docs/APP_STORE.md) |
| Ads in the app (`src/platform/ads.ts`, provider `app`) | Google AdMob through `@capacitor-community/admob` 8.1.0: rewarded and interstitial, kid-safe, capped; `tests/appAds.test.ts`. A real Google test ad played and paid +75 in the simulator. Uses Google's TEST ids until the owner's AdMob ids go in `src/platform/adConfig.ts` and Info.plist |
| Receipt validation | **None in v1** (the plugin's own local handling is trusted). See 4.5 |
| Store accounts, products, sandbox runs | **Yours to do** (section 4). Nothing has been created or spent |

---

## 1. What is sold

Prices are set in the store consoles. The shop shows the store's own price string in the player's currency; the dollar figures here are what to type into the consoles.

| Product id | Type | Gives | Suggested price | Card tag |
|---|---|---|---|---|
| `bl.gems.100` | Consumable | **100** gems | US$0.99 | none |
| `bl.gems.300` | Consumable | 300 + 10% bonus = **330** gems | US$2.99 | none |
| `bl.gems.500` | Consumable | 500 + 20% bonus = **600** gems | US$4.99 | POPULAR |
| `bl.gems.1000` | Consumable | 1,000 + 30% bonus = **1,300** gems | US$9.99 | none |
| `bl.gems.2000` | Consumable | 2,000 + 50% bonus = **3,000** gems | US$19.99 | BEST VALUE |
| `bl.starter` | Non-consumable | 2,000 coins, 150 gems and the Gold ball. Buyable once; the shop hides it once owned | US$1.99 | none |
| `bl.noads` | Non-consumable | No interstitial ads between matches. Rewarded ads you choose to watch stay | US$3.99 | none |
| `bl.pass` | Consumable | The Club Pass for the month it is bought in: about 5,560 coins, 150 gems and that month's player look, trail, premium kit and goal explosion on the pass track (meta/pass.ts). The store refuses a second buy in the same month. It can also be bought in the game for 600 gems | US$3.99 | none |
| `bl.doubler` | Non-consumable | Coin Doubler: every match pays double coins, for good | US$4.99 | none |
| `bl.pro` | Non-consumable | PRO bundle: NO ADS, the Coin Doubler and 600 gems (US$13.97 bought one by one). Buyable once; the shop shows it only while neither NO ADS nor the Coin Doubler is owned | US$9.99 | none |

**Economy v3 (October 2026): money buys gems, never coins.** The four coin packs of v2 (`bl.coins.*`) are gone: do not
create them. Coins come from playing, or from swapping gems at a shown rate in the STORE tab (`meta/gems.ts COIN_OFFERS`).
The first buy of each gem pack pays double (`FIRST_BUY_MULT`, remembered in `SaveData.iap.firsts`). Nothing costs
more than US$19.99 (`MAX_PRICE_USD`, a test enforces it). The economy design behind these numbers is docs/ECONOMY.md.

Ids are final: neither store lets you rename or reuse one. They are lower case with dots, which both stores accept.

**Where each provider runs** (`iap.provider`):

| Provider | When | Notes |
|---|---|---|
| `native` | `window.CdvPurchase` exists (the iOS or Android app with the plugin) | Real store, real prices |
| `dev` | A dev server (`npm run dev`) **and** `?iap=dev` in the URL | Fake store, instant success, prices are the suggested dollars. Compiled out of production builds |
| `none` | Everywhere else, and **always** on CrazyGames and Poki builds (also on `?portal=` in dev) | No real-money offer is drawn. In the portal bundles the native and dev code is removed entirely (checked: no `CdvPurchase` string in a `VITE_PORTAL=crazygames` build) |

itch and the plain website have no `CdvPurchase`, so they are `none` too.

**NO ADS is only shown where it means something.** The card appears when the build can show interstitials (`ads.showsInterstitials`), when the player already owns it, or on the dev store. The native app has an AdMob provider; test ids are configured until production ids are supplied. Verify interstitial delivery on the release device before listing NO ADS in the consoles.

---

## 2. The economy

**This section is a summary; docs/ECONOMY.md (v3) is the design.**

**Where coins come from today.** A Normal win pays about 170 to 210 coins, a draw about 90, a loss about 50 (x1.1 per win in a row, up to x2). Daily challenges pay 100 to 220 each, the daily gift 100 to 400, weekly objectives 300 to 400 each. On the portals a rewarded ad adds 75 (5 a day, so 375 a day at most). Gems swap for coins at 14 to 22 coins a gem.

**What coins buy.** Looks cost 250 to 7,500 (the whole catalogue is about 187,000), the ground about 35,600, plus players and training. Scout packs cost Scout Tokens, which are earned only: neither coins, gems nor money buy a random card. Some looks are also free at a level, so nobody has to buy.

**The packs against that:**

| Pack | Gems | Gems per US$ | What it is worth |
|---|---|---|---|
| `bl.gems.100` | 100 | 101 | Two replays, or five finished builds, or 1,400 coins |
| `bl.gems.300` | 330 | 110 | The first Scouting Network and a replay, or 5,000 coins |
| `bl.gems.500` | 600 | 120 | The Club Pass, or a Legendary look |
| `bl.gems.1000` | 1,300 | 130 | The first two Scouting Network tiers and the Club Pass |
| `bl.gems.2000` | 3,000 | 150 | Every Scouting Network tier, the Club Pass and a Legendary set |

The rate improves with every step (a test enforces it), and even the biggest pack does not buy the whole catalogue, so there is always something to play for. There are no fake discounts, no crossed-out prices and no countdown timers anywhere; the bonus percentages are real (they are added to the grant). POPULAR and BEST VALUE are editorial tags in `CATALOGUE`: keep them true if you change prices, and check POPULAR against real sales after launch.

**The Starter Pack is deliberately generous:** 2,000 coins, 150 gems and a Gold ball that costs 2,500 in the shop (it is also free at level 12) for US$1.99. It is a one-time first-purchase hook, offered once after the first win with no timer. **The PRO bundle** is the anchor: NO ADS (US$3.99), the Coin Doubler (US$4.99) and 600 gems (US$4.99) for US$9.99, about 28% less than one by one; the shop works that out from the catalogue (`proWorthUsd`) and hides the bundle once either part is owned.

**Scout packs use earned-only tokens.** SCOUT costs one Scout Token and ELITE costs three, with odds shown before opening (SCOUT 62/28/8/2 percent common/rare/epic/legend, ELITE 0/55/35/10). Tokens come from completed daily challenges and calendar day 5; one SCOUT pack is also free each day. Coins, gems, rewarded ads and store purchases never grant tokens or pay for a random card (`PACK_TOKENS`, `openPack`, `tests/economyV3.test.ts`).

The Scouting Network sells a stated minimum prospect potential per intake, earned gems can buy every tier, and online friendlies use preset clubs. A paid deal refresh discloses the exact next item and its discounted coin price before charging gems (`nextDeal`). Store questionnaires should describe these implemented mechanics accurately; the final classification belongs to the store review process.

---

## 3. How it works (for whoever edits it)

- **`src/platform/iap.ts`**: the catalogue, the pure payout rule (`applyPurchase`), the providers (`NativeStore`, `DevStore`) and the `Iap` class (`init`, `available`, `products()`, `buy(id)`, `restore()`, `onGrant`, `deliver`). `main.ts` binds it to the one save (`iap.bind`), points `ads.adFree` at it and starts it in the background (`void iap.init()`).
- **`buy(id)`** resolves `'ok'` (paid out), `'cancelled'`, `'failed'` or `'pending'` (the store has it but has not confirmed within 60 seconds, for example a family approval; if it completes later the grant still arrives and a message shows wherever the player is).
- **Idempotent grants.** Every payout is stored in `save.iap.applied` as `transactionId|productId` (newest 200 kept); a one-time product is also stored in `save.iap.owned`. A repeat is a no-op. For a consumable the order is: pay out, save (`persist`), then `transaction.finish()`. A crash between the save and the finish just re-delivers a transaction we recognise.
- **One-time products** (`bl.starter`, `bl.noads`) are owned for good, never charged twice (`buy` refuses an owned one), and come back on a new device through RESTORE PURCHASES, or on Android at start-up from the store's owned list. Restore hands back one-time products only, and their items, never coins; gem packs are consumed at purchase and never return.
- **NO ADS:** `ads.midgame()` (the only interstitial) returns at once when `ads.adFree()` is true. `ads.rewarded()` is untouched.
- **FREE COINS** (`meta/shop.ts` `claimFreeAd`): the count is per local day (`core/day.ts localDay`), stored in `save.iap.freeAds`, so a reload cannot reset it. The ad starts only on the player's tap and pays only if `ads.rewarded()` resolved true (watched through).
- **Saves:** `SaveData.iap` is optional in old saves and always whole after load (`normalizeIap`), also on import and in the cloud copy (`normalizeCloud`). Purchases follow the account through cloud saves, and a save that holds one is never treated as "barely started" (`isSmall`), so another device cannot overwrite it without asking.

---

## 4. Owner steps

### 4.1 Apple (App Store)

1. Join the Apple Developer Program (US$99 a year, see PUBLISHING.md section 9).
2. **Agreements, Tax and Banking** (App Store Connect, Business): accept the **Paid Apps Agreement** (the Account Holder must), add your bank account, fill the tax forms for your country, add the contacts. Until its status is Active, products do not load, even in sandbox. Consider enrolling in the **Small Business Program** (15% instead of 30%).
3. Create the app record: the bundle id must match the Capacitor `appId` you pick in 4.3.
4. In the app, **Monetization, In-App Purchases, +**: create the ten products with exactly these ids. For each: Reference Name (your own label), Product ID, Price, a Localization (display name and description, shown on the purchase sheet), a Review Screenshot (a screenshot of the shop STORE tab is fine) and Review Notes.

   | Product id | Type | Price (US$ base, Apple's price points; the old tier number in brackets) |
   |---|---|---|
   | `bl.gems.100` | Consumable | 0.99 (tier 1) |
   | `bl.gems.300` | Consumable | 2.99 (tier 3) |
   | `bl.gems.500` | Consumable | 4.99 (tier 5) |
   | `bl.gems.1000` | Consumable | 9.99 (tier 10) |
   | `bl.gems.2000` | Consumable | 19.99 (tier 20) |
   | `bl.starter` | Non-Consumable | 1.99 (tier 2) |
   | `bl.noads` | Non-Consumable | 3.99 (tier 4), **only once the app shows ads** |
   | `bl.pass` | Consumable | 3.99 (tier 4) |
   | `bl.doubler` | Non-Consumable | 4.99 (tier 5) |
   | `bl.pro` | Non-Consumable | 9.99 (tier 10), **only once the app shows ads** (it includes NO ADS) |

   Pick the price in your base country; Apple converts it for every other storefront.
5. When each product is **Ready to Submit**, the first ones must be attached to an app version (the version page, In-App Purchases) and go to review with the binary.
6. **Sandbox testers:** App Store Connect, Users and Access, Sandbox, add a tester (an email address that is not a real Apple ID). On the test iPhone (iOS 16 and later), install a build from Xcode, then Settings, Developer, Sandbox Apple Account, and sign in with the tester. Purchases then show a Sandbox banner and cost nothing. TestFlight builds also use the sandbox.
7. In Xcode, Signing & Capabilities, add **In-App Purchase**.
8. For review: RESTORE PURCHASES is on the STORE tab, scout-pack odds are shown, and the privacy labels and age-rating answers should describe purchases and earned-only random rewards accurately.

### 4.2 Google Play

1. Register a Google Play developer account (US$25 once, see PUBLISHING.md section 9; new personal accounts also owe the closed-test period listed there).
2. Create the **merchant (payments) profile**: Play Console, Setup, Payments profile, with your tax and bank details. Without it you cannot sell.
3. Create the app and upload a first build to the **Internal testing** track. The build must carry the billing permission (`com.android.vending.BILLING`); the plugin adds it. In-app products can only be created once such a build is in the console.
4. **Monetize with Play, Products, In-app products, Create product**, with the same ten ids, a name and description for each, and a default price in US dollars (Play converts the rest; you can edit each country). Set each to Active. Ids cannot be changed or reused later. Play has one product kind for these; whether a product is consumable is decided by the app consuming it, which the plugin does when we finish the transaction (gem packs), and the plugin acknowledges the one-time products the same way (an unacknowledged purchase is refunded after 3 days).
5. **License testers:** Play Console, Settings, License testing: add the testers' Google accounts, response RESPOND_NORMALLY. Also add them to the Internal testing testers list and install from the opt-in link on that same Google account. Test purchases are free.
6. Complete the Data safety form (purchases are handled by Google; the game stores no payment data) and the content rating. Describe the scout packs as earned-only random rewards; their odds are displayed.

### 4.3 Capacitor (the app shell)

The iOS shell is in the repo (Capacitor 8, Swift Package Manager, no CocoaPods):

- `capacitor.config.ts`: appId `com.calynx.blockyleague`, web dir `dist-itch` (the no PWA, no cloud-login web build).
- `ios/`: landscape only on iPhone and iPad, no status bar, the grey launch screen, the 1024 app icon.
- `npm run ios` rebuilds that web build and copies it in. Then open `ios/App/App.xcodeproj` in Xcode, set your
  team under Signing and Capabilities, and run or archive.

Still to add for the stores:

```bash
npm i cordova-plugin-purchase                       # the store bridge, detected at run time
npm i @capacitor/android && npx cap add android     # Google Play (lock it to landscape too)
npm run ios                                         # after every web change; npx cap sync for Android
```

- Use the **same `appId`/bundle id** as the app records in 4.1 and 4.2.
- `cap sync` picks `cordova-plugin-purchase` up automatically (it is a Cordova plugin). `npx cap ls` should list it for both platforms. Re-run `npx cap sync` after every web rebuild.
- The bridge is found in `nativeStore()` in `src/platform/iap.ts`: it feature-detects `window.CdvPurchase` (no import, so the web bundle carries no native code or dependency), and inside a native shell waits up to 3 seconds for Cordova's `deviceready` first.
- **Check the interface against the installed plugin.** `src/platform/iap.ts` declares a minimal `Cdv...` interface (`store.register`, `initialize`, `when().approved/verified/finished`, `get` with `getOffer().order()`, `restorePurchases`, `owned`, `error`, `defaultPlatform`) from the plugin's **v13** API. Run `npm ls cordova-plugin-purchase` and compare with the plugin's own typings (it ships them in its `www` folder) and its README. If a name differs, change the interface and the few calls that use it; the tests use a stand-in, so they will not notice.

### 4.4 Testing

- **Dev store, no accounts needed:** `npm run dev`, then open `http://localhost:5173/?iap=dev`. Open SHOP, then STORE > GEMS. Buying is instant. Add `&iapresult=cancelled`, `&iapresult=failed` or `&iapresult=pending` to see the calm messages. The fake store remembers one-time purchases under `localStorage` key `blocky-league-iap-dev` (delete it to act as a new store account; delete `blocky-league-save-v1` to act as a new device) so RESTORE PURCHASES has something to restore.
- **Real stores:** test every product in the sandbox (Apple) and with a license tester (Google). Cases to run: buy each gem pack (gems rise by the right amount, the wallet animates); buy the Starter Pack (coins, Gold ball equipped, the card disappears) and NO ADS (card shows OWNED); cancel at the payment sheet; airplane mode; reinstall, then RESTORE PURCHASES (NO ADS and the Gold ball return); kill the app mid-purchase and relaunch (it must arrive once).
- **Portals:** `?portal=crazygames` in the dev server shows FREE COINS and never a real-money currency pack; earned-only scout packs remain available.

### 4.5 Receipt validation

v1 trusts the plugin's local handling: it grants on `approved`. That is fine to launch (a rooted or jailbroken phone can fake a purchase, which only gives that player coins for single-player use, since online friendlies use the preset clubs). To do better later:

1. Stand up a small server that checks receipts with Apple (App Store Server API) and Google (Play Developer API). The project already uses Supabase for cloud saves, so an Edge Function is the natural place. Services that do this for you exist (for example RevenueCat or iaptic); each has its own pricing, which is why none is wired.
2. Set the plugin's `store.validator` to that endpoint.
3. In `NativeStore.approved` (`src/platform/iap.ts`) call `t.verify()` instead of paying out, and pay out in a `when().verified(...)` handler (the `verified` and `finished` hooks are already declared in the interface). Everything else (idempotency, the finish order) stays.

### 4.6 Before you submit the native build

- [ ] Products created with the exact ids (4.1, 4.2), prices set, `bl.noads` only if the app shows ads.
- [ ] Store content-rating answers reflect the earned-only scout packs and fixed, disclosed premium outcomes (section 2).
- [ ] `public/privacy.html` and both stores' privacy answers mention purchases (handled by Apple or Google; the game stores no payment details). That page was not edited here.
- [ ] Sandbox and license-tester runs from 4.4 done on a real iPhone and a real Android phone.
- [ ] RESTORE PURCHASES visible on the STORE tab (it is).

---

## 5. Web portals: ads only

CrazyGames, Poki and itch get **no real-money offers**: their rules and payment integrations differ (Poki forbids in-game purchases; CrazyGames allows them only by invitation through Xsolla, see PUBLISHING.md section 9; itch has its own checkout, not in-game billing). The code enforces it: the provider is `none` in the CrazyGames and Poki bundles, and on itch and the website because there is no store bridge to find.

**How coins come in there:**

- Matches, challenges and the daily gift, as everywhere.
- The existing "2x COINS" rewarded offers after a match and on the daily gift.
- **FREE COINS** in the shop's STORE tab: WATCH AN AD for +75 coins, at most **5 a day** (counted per local day and saved). It shows only where `ads.rewardedAvailable` is true. If there is no ad right now it says to come back later, and when the 5 are used it says come back tomorrow. The ad starts only on the player's tap, the reward is paid only when the ad was watched through, and a button is disabled while an ad is running. Plain web has no ads; STORE still offers earned-gem swaps, the gem-funded Club Pass and the Scouting Network.

**Money from the portals (the owner's notes):** about a 40% revenue share and monthly payouts above EUR 100. These figures are as the owner pasted them and are not checked here. Note that PUBLISHING.md section 4.4 records that CrazyGames' own developer terms (18 August 2025) do not state a share, and that figures quoted online come from specific deals; confirm yours in your own agreement before relying on it.

---

## 6. Known limits and later work

- **A restore never pays coins.** A one-time product handed back on a new device (RESTORE PURCHASES, or the store's owned list at start-up) brings back its items and ownership (the Gold ball, NO ADS) but not the Starter Pack's 2,000 coins: those were paid on the device that bought it, so a reinstall is no coin tap (`applyPurchase`'s `restored`). The plugin cannot tell a restore from an interrupted first purchase; the rare player whose app died mid-purchase on a brand-new install keeps the ball but not the coins (support can top them up). A receipt-validation server (4.5) with a ledger would close that gap.
- The record of paid transactions keeps the newest 200 per save.
- AdMob uses test ads until production ids are supplied; real-device ad and purchase checks remain release requirements.
- A `native` entry in `scripts/release.mjs` (a dedicated web build for the app shell) would be tidier than reusing the itch build; not done.
