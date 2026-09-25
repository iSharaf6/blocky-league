# Publishing & monetising Blocky League

_Last checked against the portals' own documentation: **25 September 2026**. Portal rules change, so re-read the linked pages before each submission._

**Status: nothing is published yet.** This repo can build and package the game for every channel below. You still have to create each account and complete each submission yourself, and none of it costs money until you choose to go mobile.

**What to expect from revenue:** web-portal income comes from ads shown to players. It scales with plays × session length × ad fill, so a game with few players earns next to nothing, whatever the platform. Treat the first months as a way to learn what players do. Don't plan on it as income.

---

## Contents

1. [Recommended path](#1-recommended-path)
2. [What is already done in this repo](#2-what-is-already-done-in-this-repo)
3. [Building the release files](#3-building-the-release-files)
4. [CrazyGames](#4-crazygames)
5. [Poki](#5-poki)
6. [GameDistribution](#6-gamedistribution)
7. [itch.io](#7-itchio)
8. [Your own website (free hosting) + ads](#8-your-own-website-free-hosting--ads)
9. [Later: iOS / Android via Capacitor](#9-later-ios--android-via-capacitor)
10. [Fix list before any ad-portal submission](#10-fix-list-before-any-ad-portal-submission)
11. [Cost table](#11-cost-table)
12. [Sources](#12-sources)

---

## 1. Recommended path

The first decision is **Poki or everyone else**. Poki's standard deal is *web-exclusive*: you can't also put the game on CrazyGames, GameDistribution or other web portals. Steam, app stores and consoles are still allowed. Discord and YouTube Playables count as web.

| Option | Who decides | Exclusivity | Revenue model (published) | Effort |
|---|---|---|---|---|
| **CrazyGames** | Open submission, then QA and a metrics-based Basic → Full Launch | None by default. Opt-in 2 months' web exclusivity after Full Launch earns +50% | Share % not published; €100 payout minimum | SDK integration (mostly done; see §10) |
| **Poki** | Curated. Apply, then playtests and fit tests | Web-exclusive (standard deal) | 100% of revenue from players who reach the game directly; 50/50 on players Poki brings | SDK integration (mostly done), about 2–3 months from agreement to global release |
| **GameDistribution** | Account, then checklist, then review (about 1 week) | Non-exclusive | Developer gets 33% of net revenue | Needs its own SDK adapter (not written yet) |
| **itch.io** | Self-serve | None | You set the price or donations; itch takes 10% by default (adjustable) | Upload the zip. Done |
| **Own site** | Self-serve | None | Ads only via approval (Google H5 Games Ads) or donations | Deploy the web build. Done |

**Suggested order:**

1. **This week (free):** put the web build on Cloudflare Pages and the itch build on itch.io ("$0 or donate"). Share the links, watch how people play, fix the rough edges.
2. **Then choose:**
   - **Poki:** apply first if you're happy with web exclusivity and a slower, curated process.
   - **CrazyGames (+ GameDistribution):** submit to CrazyGames if you'd rather go live fast and non-exclusive. GameDistribution can be added later. Its SDK adapter needs writing first, and CrazyGames' opt-in exclusivity bonus would rule it out for 2 months.
3. **Later:** mobile stores (costs money; §9).

---

## 2. What is already done in this repo

| Item | Where | State |
|---|---|---|
| Build variants: web / crazygames / poki / itch | `scripts/release.mjs`, `npm run build:*` | Done. Each writes `dist-<variant>/` and `release/blocky-league-<variant>-v<version>.zip` with `index.html` at the zip root and relative paths only |
| Zip size | see §3 | ~270 KB for the portal/itch zips, ~430 KB for web (budget 5 MB) |
| Portal ad/SDK adapter | `src/platform/ads.ts` | Implemented. **Some corrections are required before a Full Launch / Poki QA** (§10) |
| Store art (covers, thumbnails) | `release/store-assets/` (regenerate with `npm run assets`) | Done, sized per each portal's rules |
| PWA: manifest, icons (192/512 + maskable), apple-touch-icon, service worker | `public/` | Done. Web build only; stripped from portal/itch builds |
| Social preview image + tags | `public/og-image.png`, `index.html` head | Done. Set `SITE_URL` when building for a real domain (§3) |
| Privacy policy | `public/privacy.html` | Done. **Add a contact email** before publishing |
| Third-party licence notices (three.js MIT, fonts OFL) | `third-party-licenses.txt`, generated into every build | Done |
| Store text | `docs/STORE_LISTING.md` | Done |

**Things you must do yourself:** create each account, accept each platform's terms, fill in tax and payout forms, upload the files, and answer the platforms' emails.

---

## 3. Building the release files

```bash
npm install
npm run build:web          # own site (Cloudflare Pages / Netlify / GitHub Pages)
npm run build:crazygames   # VITE_PORTAL=crazygames
npm run build:poki         # VITE_PORTAL=poki
npm run build:itch         # no ads, no PWA (itch.io runs games in an iframe)
npm run build:all          # all four
npm run assets             # re-render icons, og image and store covers
```

- Each `build:*` runs `tsc --noEmit` first, so a type error anywhere stops the build. To package without the type check: `node scripts/release.mjs <variant>`.
- The release script prints the file count, unpacked and zipped size, any file over 300 KB, and every external host named in the shipped code. It then re-opens each zip and checks every entry's CRC.
- For the web build on a real domain, pass the site URL so social cards get an absolute image URL:
  ```bash
  SITE_URL=https://your-domain.example npm run build:web
  ```

Measured on 25 Sep 2026 (sizes grow as features land, so re-check the script's output each release):

| Variant | Files | Unpacked | Zip |
|---|---:|---:|---:|
| web | 20 | 1003.4 KB | 429.1 KB |
| crazygames | 10 | 836.1 KB | 269.9 KB |
| poki | 10 | 836.1 KB | 269.9 KB |
| itch | 10 | 836.1 KB | 269.9 KB |

All of these are far below the published limits:

- CrazyGames: initial download ≤ 50 MB (≤ 20 MB for the mobile homepage), ≤ 1,500 files.
- Poki: guidance of ≤ 5 MB initial, ≤ 8 MB total.
- itch.io: ≤ 1,000 files, ≤ 500 MB extracted.

---

## 4. CrazyGames

Developer portal: <https://developer.crazygames.com/> · Docs: <https://docs.crazygames.com/>

### 4.1 Steps

1. **Create a developer account** at developer.crazygames.com. You do this yourself.
2. **Fix the items in §10**, then run `npm run build:crazygames`.
3. **Test locally.** On `localhost` the SDK runs in *local* mode: ads show as overlay text and logging is on. Add `?useLocalSdk=true` to force this on any domain, and `?muteAudio=true` to test the mute setting.
4. **Submit.** Upload `release/blocky-league-crazygames-v<version>.zip` and the three covers from `release/store-assets/`:
   - `crazygames-landscape-1920x1080.png`
   - `crazygames-portrait-800x1200.png`
   - `crazygames-square-800x800.png`
5. **Preview/QA tool.** Test the uploaded build in CrazyGames' Preview/QA tool on the portal.
6. **Record a preview video.** CrazyGames asks for one:
   - 15–20 s (anything past 20 s is cut), ≤ 50 MB.
   - Both a 1080p 16:9 and a 1080p 2:3 version.
   - No sound, no cursor, no "Play now" text; start on your static cover.
   - Shot ideas are in `docs/STORE_LISTING.md`.
7. **Basic Launch.** The game goes live to a limited audience **with no monetisation** (the SDK is optional at this stage). It lasts until the game has been live ≥ 7 days **and** has 500 plays, or ends automatically after 21 days if it doesn't reach 500 plays.
8. **Full Launch.** Selection is based on playtime, conversion to gameplay and retention. It requires the *Full Implementation* and a second QA pass, and it switches on revenue share.
9. **Payouts.** Set up the payout method on the portal (Tipalti: wire, ACH, eCheck or PayPal). Expect to give tax and identity details during that onboarding.

### 4.2 SDK v3 requirements vs. this repo

| Requirement (docs) | Repo status |
|---|---|
| Load `https://sdk.crazygames.com/crazygames-sdk-v3.js`, then `await window.CrazyGames.SDK.init()` before any call | Done |
| Every SDK call throws when `SDK.environment === 'disabled'` (any non-CrazyGames domain) | **Fix:** check `environment` and wrap calls in try/catch (§10 #2) |
| `game.loadingStart()` / `game.loadingStop()`: optional pair for load-time stats | **Fix:** only `loadingStop` is called (§10 #3) |
| `game.gameplayStart()` on every start/resume; `gameplayStop()` on menus, pause, match end | Done (deduplicated) |
| Don't call `gameplayStop` just because focus/visibility changed | Only called when the game really shows the pause menu. OK |
| `game.happytime()`: rarely, for real achievements | Called on every win. Consider limiting it (§10 #8) |
| `ad.requestAd('midgame' \| 'rewarded', { adStarted, adFinished, adError })`; mute in `adStarted`, resume in `adFinished`/`adError`; never reward on `adError` | Done |
| Midgame only at natural breaks; **never on a navigation button** (main menu, settings, shop); no own cooldown (the SDK caps at 1 per 3 min) | **Fix:** currently fired by the full-time "Continue" button that returns to the menu, with a local 3-min limiter (§10 #5, #6) |
| Full Implementation **must support `SDK.game.settings.muteAudio`** + `addSettingsChangeListener` | **Fix** (§10 #4) |
| Cloud progress save for Full Launch: `SDK.data` (plus the Progress Save toggle) **or** *Automatic Progress Save* | No code needed if you enable **Automatic Progress Save** at submission (allowed because the game has no purchases) |
| User/account module | Not needed: the game has no user accounts |

### 4.3 QA checklist (from the requirements pages)

**Technical**
- [ ] Relative paths only. *Verified by `release.mjs`.*
- [ ] Works on Chrome, Edge and 4 GB Chromebooks.
- [ ] Touch controls on mobile, plus `user-select: none` on `body`. *Already in `src/style.css`.*

**Rules**
- [ ] **No custom fullscreen button.** *There isn't one.*
- [ ] **No external links or cross-promotion.** App-store links are never allowed. *The game has no links.*
- [ ] **Only CrazyGames SDK ads.** No other ad scripts. *See §10 #1: remove the Poki code from this build.*
- [ ] In-game purchases are invite-only (Xsolla). *The game has none.*

**Ads**
- [ ] Game paused and **all audio muted** during ads. *See §10 #7: SFX/crowd currently keep playing.*
- [ ] UI blocked while an ad request is in flight.
- [ ] Adblock users can still play normally. *Yes: everything fails soft.*
- [ ] Rewarded offer is clearly optional, and the skip option isn't hidden or delayed. *"Continue" sits next to the reward button.*

**Content**
- [ ] English text; content PEGI-12 compliant.
- [ ] Full Launch: new players reach gameplay immediately or within 1 click. *Currently: Tap to play → Quick match → Kick off. Consider a one-click "Play" (§10 #9).*

### 4.4 Money and timing

- **Revenue share:** not published in the docs or in the current developer terms (dated 18 Aug 2025). They say compensation depends on traffic and ad performance. Figures you'll see quoted online (for example 60/40) come from specific game-jam deals, not the standard terms.
- **Exclusivity bonus:** opt-in, **+50%** compensation if the game is web-exclusive to CrazyGames and hosted by them for 2 months after Full Launch.
- **Payouts:** monthly once earnings reach **€100** (lower amounts roll over). Terms are NET 60, though they aim to pay around the 10th of the following month.
- **Timeline:** Basic Launch runs at least 7 days and at most 21. Then comes Full Launch review.

---

## 5. Poki

Developer guide: <https://developers.poki.com/> · Apply: <https://developers.poki.com/guide/share>

### 5.1 Steps

1. **Apply** via the "Request access to Poki for Developers" form. You'll need your name, email, team name, country and previous games. Poki hand-picks every game; there's no guarantee of acceptance.
2. **Build** with `npm run build:poki` once the §10 fixes are in.
3. **Poki Inspector.** Drag the `dist-poki/` folder into it. You get:
   - a QA checklist and an SDK event log;
   - load time and file size;
   - external-request warnings;
   - scaling tests at 640×360, 836×470 and 1031×580;
   - mobile testing by QR code.
4. **Testing stages:** upload → playtests → player fit test → web fit test (about 7 days) → final review (1–2 weeks).
5. **If selected:** agreement → QA → Soft Release (2–3 weeks, can't be skipped) → Global Release. Poki estimates about 2–3 months from agreement to Global Release.
6. **Thumbnails and video.**
   - Static: `release/store-assets/poki-thumbnail-1024x1024.png`. It is full-bleed, text-free and at least 628×628; Poki rounds the corners itself.
   - Animated: a 1080×1080+ `.mp4`, 4–6 s, 50 fps or more, muted. It's needed before Global Release.
7. **Payouts:** wire or PayPal, set up in the Poki for Developers platform. The payout threshold isn't stated in the docs.

### 5.2 SDK v2 rules vs. this repo

| Rule (docs) | Repo status |
|---|---|
| Script `https://game-cdn.poki.com/scripts/v2/poki-sdk.js`; `PokiSDK.init()` returns a Promise. If it rejects, load the game anyway | Done (fails soft, with a timeout). init/commercialBreak can hang if an adblocker blocks the core script, so the adapter's timeouts are needed |
| `gameLoadingFinished()` when loading is done, before the first `gameplayStart()` | Done |
| `gameplayStart()` on the player's first input (not on load); `gameplayStop()` on every pause/menu/match end; never the same event twice in a row; no events during ads | Done (starts at kick-off, deduplicated) |
| `commercialBreak()` before each `gameplayStart()` after the first, when the player is heading back into play (not when going to menus); Poki decides whether an ad plays; no own ad timers | **Fix:** currently called on the way *to* the main menu, with a local 3-min limiter (§10 #5, #6) |
| `rewardedBreak()` resolves `true` only when watched; grant only then | Done |
| Rewarded button must show 🎬, must not be green, and the normal continue button must be the same size or larger, next to or above it | **Fix:** label is "▶ WATCH AD · 2× COINS" and needs 🎬 (§10 #10). Yellow (not green) and a larger Continue button already comply |
| No external requests (Poki applies a CSP); no other ad systems; no outgoing links; no IAP | **Fix:** remove the CrazyGames SDK code from the Poki build (§10 #1) |
| Works in incognito: localStorage wrapped in try/catch | Done (`src/core/save.ts`) |
| Desktop + mobile + tablet; 16:9 scaling | Test with Poki Inspector |
| `happyTime` | Not in the HTML5 docs, and a no-op in the current SDK. Remove the call (§10 #8) |

### 5.3 Money

- **Revenue:** 100% of ad revenue from players who reach the game directly (bookmarks, search, your community). 50/50 on players Poki brings in.
- **Deal types:** web-exclusive is the default, with a 5-year term described as "indicative". A non-exclusive deal pays a one-time flat fee with no revenue share.
- **Costs:** none.

---

## 6. GameDistribution

Developer site: <https://developer.gamedistribution.com/> · Guidelines: <https://static.gamedistribution.com/developer/developers-guidelines.html>

**Not integrated yet.** GameDistribution needs its own SDK, so `ads.ts` would need a `gamedistribution` branch plus a `build:gamedistribution` variant in `scripts/release.mjs`. What that branch needs:

- **Setup:** set `window.GD_OPTIONS = { gameId, onEvent }`, then load `https://html5.api.gamedistribution.com/main.min.js` once, before the game starts.
- **Pause/resume:** pause **and mute** on `SDK_GAME_PAUSE`; resume on `SDK_GAME_START`.
- **Interstitials:** `gdsdk.showAd()`, only after `SDK_READY` and only from a mouseup/touchend handler, on Play/Next/Continue buttons. Pre-rolls and mid-rolls are mandatory.
- **Rewarded:** `gdsdk.preloadAd('rewarded')`, then `gdsdk.showAd('rewarded')`. Reward only on `SDK_REWARDED_WATCH_COMPLETE`. Rewarded must be switched on for the game in the GD dashboard.

**Submission:**
1. Create an account and add the game.
2. Finish the in-dashboard checklist, then click **Request Activation**. The first review typically takes up to a week.

**Rules:** HTTPS, no outgoing/social/app-store links, no data collection, and no non-GD cookies or trackers (Google Analytics, Facebook Pixel and Mixpanel are named). Blocky League has none of these.

**Store text:** English. Description and instructions 200–500 characters each, 1–2 genres, 1–5 tags. See `docs/STORE_LISTING.md`.

**Thumbnails (mandatory):** 512×512, 512×384 and 200×120, all in `release/store-assets/gamedistribution-*`.

**Money:**
- Developer gets **33% of net revenue** (net of ad-platform costs, invalid traffic, payment costs and VAT; terms updated 19 Jun 2025).
- Non-exclusive licence; no developer fees in the terms.
- Payout threshold €100 in the terms (the FAQ mentions €50 via PayPal).
- Revenue for a month is paid about two months later. For example, May revenue is paid at the end of July.

---

## 7. itch.io

Docs: <https://itch.io/docs/creators/html5>

**Steps:**
1. Create an itch.io account (yourself) and click **Upload new project**.
2. Set **Kind of project: HTML** and upload `release/blocky-league-itch-v<version>.zip`. Tick **"This file will be played in the browser"**.
3. **Embed options:**
   - Either "Embed in page" at a 16:9 size such as 960×540, or "Click to launch in fullscreen".
   - Tick **Mobile friendly** (landscape).
   - Optionally turn on itch's own *Fullscreen button*.
4. **Pricing:** "$0 or donate" (pay-what-you-want with a free option) or "No payments". A fixed "Paid" minimum is also possible but is a hard sell for a web game.
5. **Cover:** `release/store-assets/itch-cover-630x500.png`. Add screenshots from the shot list in `docs/STORE_LISTING.md`.
6. **Optional CLI uploads:** use [butler](https://itch.io/docs/butler/): `butler push dist-itch you/blocky-league:html5 --userversion 0.1.0`.

**Limits:** ≤ 1,000 files, ≤ 500 MB extracted, ≤ 200 MB per file, paths ≤ 240 characters. The build is 10 files, well within all of these.

**Money:**
- Open revenue sharing: itch's cut is **10% by default**, and you choose anywhere from 0% to 100%. Payment processors charge on top (Stripe/PayPal about $0.30 + 2.9%).
- **"Collected by itch.io" (simplest):**
  - itch is the merchant of record and handles VAT; balance in USD.
  - Payouts to PayPal or Payoneer from $5; funds are available 7 days after a purchase, then payout review takes about 10–14 days.
  - You must complete itch's **tax interview**. Without a tax ID, 30% may be withheld by default.
- **"Direct to you":** you connect your own PayPal or Stripe and become the merchant of record, which means handling VAT and tax yourself.

---

## 8. Your own website (free hosting) + ads

Deploy `dist-web/` (build it with `SITE_URL=https://… npm run build:web`). It includes the PWA manifest, icons, service worker, `privacy.html` and `robots.txt`.

**About the service worker:**
- It only registers on https, in a top-level window (never in an iframe), off localhost, and without `?portal=`.
- It caches only Vite's content-hashed `assets/*` files, cache-first, and never caches `index.html`, so a new deploy is picked up on the next page load.
- Keep `public/assets/` empty, because the service worker treats that path as hashed build output.

### 8.1 Hosting options (all $0)

| Host | Free-tier limits (published) | Notes |
|---|---|---|
| **Cloudflare Pages** (recommended) | Static requests free and unlimited; 500 builds/month; 20,000 files; 25 MiB per file | Cloudflare now suggests Workers static assets for *new* projects. It is also free, with the same file limits and unlimited static requests. Either works for a static folder |
| **Netlify** (free plan) | 300 credits/month: production deploy = 15 credits, bandwidth = 20 credits/GB. **On the free plan, sites are paused when credits run out** | Works for low traffic. A popular game would exhaust the credits (roughly ≤ 15 GB/month if nothing else is used, by our arithmetic) |
| **GitHub Pages** | 1 GB site, 100 GB/month soft bandwidth, 10 builds/hour soft limit | Terms say Pages isn't for running an online business, e-commerce or SaaS. Donation buttons and crowdfunding links are explicitly allowed; the terms don't say whether display ads are, so prefer Cloudflare if you plan to run ads |

**Cloudflare Pages, by hand (no Git needed):**
1. Create a Cloudflare account (yourself).
2. Go to Workers & Pages → Create → Pages → **Upload assets**.
3. Drag in the contents of `dist-web/`.
4. You'll get a `*.pages.dev` URL. Rebuild with `SITE_URL` set to it, then re-upload.

**Custom domain (optional, recurring):** a `.com` is typically around US$10–15 per year. Cloudflare Registrar sells at cost with no mark-up; we couldn't confirm its live `.com` price, so check at checkout. Add the domain to the Pages project under Custom domains.

### 8.2 Ads on your own site

- **Google H5 Games Ads (AdSense, Ad Placement API)** is the ad product built for HTML5 games.
  - **Eligibility:** apply at <https://adsense.google.com/start/h5-games-ads/>. It requires an **approved AdSense account** and approval of the H5 application, which isn't guaranteed. You must be 18+ and able to edit the site's HTML.
  - **Tag:** `adsbygoogle.js` goes in the page `<head>` with `data-ad-client`. Test with `data-adbreak-test="on"`.
  - **API:** `adBreak({ type: 'next' | 'start' | 'pause' | 'reward' | …, beforeAd, afterAd, beforeReward, adViewed, adDismissed, adBreakDone })` and `adConfig({ preloadAdBreaks, sound })`. Full-screen ads only at natural transitions.
  - **Money:** payment threshold is US$100. Google publishes 80% for AdSense *display* content but not a figure for H5 Games Ads.
  - **Not integrated yet:** it would need an `adsense` branch in `ads.ts` and the tag in the web build's head.
- **No ads + donations:** the simplest option. Link your itch.io page ("$0 or donate") from the site text around the game. **Never** put such links inside the portal builds.
- **CrazyGames or Poki SDKs on your own site:** they don't serve ads there. CrazyGames' SDK is `disabled` off its domains, so don't ship a portal build to your own domain.

---

## 9. Later: iOS / Android via Capacitor

Capacitor (currently **v8**) wraps the web build in a native app shell.

**Toolchain:** Node 22+, Xcode 26+ for iOS (needs a Mac), Android Studio 2025.2.1+.

```bash
npm i @capacitor/core && npm i -D @capacitor/cli
npx cap init "Blocky League" com.yourname.blockyleague --web-dir dist-itch   # a no-ads, no-PWA build
npm i @capacitor/android @capacitor/ios
npx cap add android && npx cap add ios
npx cap sync
```

**Ads:** `@capacitor-community/admob` (v8, for Capacitor 8), with interstitial and rewarded APIs and a consent form. Needs its own `ads.ts` branch, plus an AdMob account (free).

**IAP ("Remove ads", coin packs):**
- `@revenuecat/purchases-capacitor`: free until US$2,500 monthly tracked revenue, then 1%.
- `capacitor-plugin-cdv-purchase` (cordova-plugin-purchase): MIT licensed.
- **Keep IAP out of the web portal builds.** Poki forbids IAP, and CrazyGames allows purchases only by invitation via Xsolla.

**Store accounts and fees (you register and pay yourself):**
- **Google Play:** US$25 one-time registration.
  - New *personal* accounts must run a closed test with **≥ 12 testers for 14 continuous days** before applying for production.
  - Service fee: 15% on the first US$1M/year in most markets. In the EEA, UK and US since 30 Jun 2026 it's 10% + a 5% billing fee on the first US$1M.
- **Apple Developer Program:** **US$99 per year**, recurring. Fee waivers apply only to nonprofits, schools and government bodies.
  - Commission: 15% under the Small Business Program (you must enrol) or 30% standard.
  - EU in-app purchases from 1 Oct 2026: 26%, or 15% under the Small Business Program.

Both stores also need a privacy policy URL (use `privacy.html` on your site) and content-rating questionnaires.

---

## 10. Fix list before any ad-portal submission

These changes are in `src/` (engine and UI code), which the lead engineer owns. The exact code-level changes were handed over with this release tooling; tick items off here as they land.

1. [ ] **One SDK per build.** Gate the portal branches in `ads.ts` on `import.meta.env.VITE_PORTAL` so the other portal's SDK code and URL are removed at build time, and ignore `?portal=` in portal builds. Poki blocks external requests, and CrazyGames forbids other portals' branding.
2. [ ] **CrazyGames `disabled` environment:** check `SDK.environment` after `init()`, treat `'disabled'` as no portal, and wrap every SDK call in try/catch.
3. [ ] **CrazyGames `loadingStart()`:** call it right after `init()`, paired with the existing `loadingStop()`.
4. [ ] **CrazyGames `muteAudio`:** read `SDK.game.settings.muteAudio` and subscribe with `addSettingsChangeListener`. Required for Full Launch.
5. [ ] **Move the midgame / commercialBreak** from the full-time "Continue" button (which navigates to the menu) to just **before kick-off of the next match**, and optionally before the second half.
6. [ ] **Remove the local 3-minute limiter** in `ads.midgame()`. Both portals pace ads themselves and ask you not to add timers.
7. [ ] **Mute all audio during ads and restore it afterwards.** Today only the music stops, and it's never restarted. SFX and crowd keep playing.
8. [ ] **happytime:** drop Poki's `happyTime` (not in the HTML5 docs; a no-op). Consider calling CrazyGames' `happytime()` only for bigger moments, such as a win on Hard/Legend or a trophy, not every win.
9. [ ] **(Recommended) One-click play** for new players on CrazyGames Full Launch, for example a "Play" that goes straight to a quick match.
10. [ ] **Rewarded button:** add the 🎬 icon (Poki requirement), and disable "Continue" while a rewarded request is in flight (CrazyGames: block the UI until `adFinished`/`adError`).
11. [ ] **Cap total ad-SDK start-up wait** at about 3 s so a slow or blocked SDK can't delay the title screen by up to 12 s. Poki notes players leave after about 10 s of loading.

---

## 11. Cost table

Everything in the web plan is **$0 up front**. Money only flows *to* you (after thresholds) until you choose paid options.

| Item | One-off cost | Recurring cost | Platform's cut of your revenue |
|---|---|---|---|
| CrazyGames account + publishing | $0 | $0 | Not published (+50% bonus for opt-in 2-month exclusivity); €100 payout minimum |
| Poki account + publishing | $0 | $0 | 50% on Poki-sourced players, 0% on direct players; exclusive deal |
| GameDistribution | $0 | $0 | Developer receives 33% of net; €100 threshold (€50 PayPal per FAQ) |
| itch.io | $0 | $0 | 10% default (you choose 0–100%) + processor ~$0.30 + 2.9% |
| Cloudflare Pages hosting | $0 | $0 | none |
| Netlify hosting (Free) | $0 | $0 (site pauses if 300 credits/month run out; Personal plan $9/month) | none |
| GitHub Pages hosting | $0 | $0 | none |
| Custom domain (optional) | none | ≈ US$10–15/year for a .com (check the registrar's price) | none |
| Google AdSense / H5 Games Ads | $0 | $0 | Share for H5 not published; US$100 payment threshold |
| Google Play developer account | **US$25 (once)** | $0 | 15% of first $1M/yr (most markets); 10% + 5% billing fee in EEA/UK/US |
| Apple Developer Program | $0 | **US$99 / year** | 15% (Small Business Program) or 30% |
| RevenueCat (IAP helper, optional) | $0 | $0 until US$2,500/month tracked revenue, then 1% | – |
| AdMob (mobile ads) | $0 | $0 | Google's share (not researched here) |

---

## 12. Sources

All pages were fetched on 25 Sep 2026.

**CrazyGames**
- SDK intro / environment: <https://docs.crazygames.com/sdk/intro/>
- Game module (gameplayStart/Stop, loadingStart/Stop, happytime, settings.muteAudio): <https://docs.crazygames.com/sdk/game/>
- Video ads (requestAd, callbacks, adError codes, hasAdblock): <https://docs.crazygames.com/sdk/video-ads/>
- Data module: <https://docs.crazygames.com/sdk/data/>
- Requirements:
  - Intro: <https://docs.crazygames.com/requirements/intro/>
  - Technical: <https://docs.crazygames.com/requirements/technical/>
  - Gameplay: <https://docs.crazygames.com/requirements/gameplay/>
  - Ads: <https://docs.crazygames.com/requirements/ads/>
  - Account integration: <https://docs.crazygames.com/requirements/account-integration/>
  - Covers: <https://docs.crazygames.com/requirements/game-covers/>
- Midgame pacing: <https://docs.crazygames.com/resources/midgame-ads-pacing/>
- Payouts: <https://docs.crazygames.com/payouts/> · FAQ: <https://docs.crazygames.com/faq/>
- Developer terms (18 Aug 2025): <https://files.crazygames.com/documents/developer_terms_20250818.pdf>

**Poki**
- HTML5 SDK: <https://developers.poki.com/guide/sdk-html5> · Overview: <https://developers.poki.com/guide/sdk-overview>
- Quality requirements: <https://developers.poki.com/guide/requirements-quality>
- External resources: <https://developers.poki.com/guide/external-resources-policy>
- Engines / file size: <https://developers.poki.com/guide/web-engine>
- Accounts / saves: <https://developers.poki.com/guide/accounts>
- Thumbnail: <https://developers.poki.com/guide/game-thumbnail> · Game page: <https://developers.poki.com/guide/your-game-page>
- Testing: <https://developers.poki.com/guide/how-testing-works> · Release: <https://developers.poki.com/guide/release-process>
- Working with Poki: <https://developers.poki.com/guide/working-with-poki> · Deal types: <https://developers.poki.com/guide/revenue-deal-types>
- Payouts: <https://developers.poki.com/guide/payouts-billing> · Inspector: <https://developers.poki.com/guide/inspector>
- Apply: <https://developers.poki.com/guide/share>

**GameDistribution**
- SDK: <https://github.com/GameDistribution/GD-HTML5/wiki/SDK-Implementation> · Rewarded: <https://github.com/GameDistribution/GD-HTML5/wiki/Rewarded-Ads>
- Guidelines: <https://static.gamedistribution.com/developer/developers-guidelines.html>
- Terms: <https://static.gamedistribution.com/terms/developer.html>
- Payments FAQ: <https://gamedistribution.com/developers/faq/getting-started/setting-up-and-receiving-your-payment/>

**itch.io**
- HTML5: <https://itch.io/docs/creators/html5> · Pricing: <https://itch.io/docs/creators/pricing>
- Payments: <https://itch.io/docs/creators/payments> · butler: <https://itch.io/docs/butler/pushing.html>

**Hosting**
- Cloudflare Pages limits: <https://developers.cloudflare.com/pages/platform/limits/>
- Cloudflare Pages pricing: <https://developers.cloudflare.com/pages/functions/pricing/>
- Cloudflare Workers static assets: <https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/>
- Netlify credits: <https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/> · pricing: <https://www.netlify.com/pricing/>
- GitHub Pages limits: <https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits>
- GitHub additional-products terms: <https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features>
- Cloudflare Registrar: <https://www.cloudflare.com/products/registrar/>

**Google ads**
- H5 Games Ads: <https://adsense.google.com/start/h5-games-ads/> · beta: <https://developers.google.com/ad-placement/docs/beta>
- Ad Placement API: <https://developers.google.com/ad-placement/apis>
- Tag setup: <https://support.google.com/adsense/answer/9955214> · policy: <https://support.google.com/adsense/answer/9959170>
- Thresholds: <https://support.google.com/adsense/answer/1709871> · revenue share: <https://support.google.com/adsense/answer/180195>

**Mobile**
- Apple: <https://developer.apple.com/programs/whats-included/>, <https://developer.apple.com/support/membership-fee-waiver/>, <https://developer.apple.com/app-store/small-business-program/>, <https://www.apple.com/newsroom/2026/08/apple-announces-changes-for-apps-in-the-european-union/>
- Google Play:
  - Registration: <https://support.google.com/googleplay/android-developer/answer/6112435>
  - Testing requirement: <https://support.google.com/googleplay/android-developer/answer/14151465>
  - Service fees: <https://support.google.com/googleplay/android-developer/answer/112622>
- Capacitor: <https://capacitorjs.com/docs/getting-started> · AdMob plugin: <https://github.com/capacitor-community/admob>
- RevenueCat: <https://www.revenuecat.com/docs/getting-started/installation/capacitor>, <https://www.revenuecat.com/pricing/>
