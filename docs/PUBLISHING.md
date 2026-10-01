# Publishing Blocky League: the v1 checklist

_CrazyGames integration requirements rechecked on **2 October 2026**. Earlier browser measurements and other portals' research retain their recorded dates below; use the current build and the portal's QA tool before each submission._

**Ready to submit?** Follow **[docs/SUBMIT.md](SUBMIT.md)**, the click-by-click guide for each portal. `npm run build:all`, then `npm run submission`, builds the submission kit in `release/submission/`: the zip, images, videos and a `listing.txt` of fields to paste for each portal, all re-checked on every run.

**Where things stand:** `npm run build:all` produces four upload zips, and store covers, screenshots and preview videos have already been prepared. CrazyGames **Basic Launch** is the first submission target; its live Preview/QA pass, dashboard settings and account acceptance remain necessary before publishing. Full Launch is a separate review by CrazyGames. The contact email (calynx@zohomail.com.au) is in the privacy policy.

**Tutorial playtest:** the first PASS drill's offside failure, hidden timeout and swallowed first actions were repaired. See [the 2 October playtest](PLAYTEST-2026-10-02.md) for actual reception, tutorial completion and packaged-build evidence. The earlier action-only checks did not establish tutorial completion.

**Playtest deployment:** [GitHub Pages](https://isharaf6.github.io/blocky-league/) is configured for this repository. `.github/workflows/pages.yml` tests and packages the web game on pushes to `main`, then deploys `dist-web`. The source repository remains private; the playable site is public. Portal submissions and monetisation are separate from this playtest deployment.

**What to expect from revenue:** web-portal income comes from ads shown to players. It scales with plays × session length × ad fill, so a game with few players earns next to nothing, whatever the platform. Treat the first months as a way to learn what players do. Don't plan on it as income.

---

## Contents

1. [The v1 checklist](#1-the-v1-checklist)
2. [Recommended path](#2-recommended-path)
3. [Building the release files](#3-building-the-release-files)
4. [CrazyGames](#4-crazygames)
5. [Poki](#5-poki)
6. [GameDistribution](#6-gamedistribution)
7. [itch.io](#7-itchio)
8. [Your own website (free hosting) + ads](#8-your-own-website-free-hosting--ads)
9. [Later: iOS / Android via Capacitor](#9-later-ios--android-via-capacitor)
10. [The old fix list (all done)](#10-the-old-fix-list-all-done)
11. [Cost table](#11-cost-table)
12. [Sources](#12-sources)

---

## 1. The v1 checklist

### 1.1 Done in the build

| Item | Where | How it was checked |
|---|---|---|
| Four release zips (web, crazygames, poki, itch), `index.html` at the zip root, relative paths only | `scripts/release.mjs`, `npm run build:all` | `build:all` passes; the script re-opens each zip and checks every entry |
| **One ad SDK per portal build.** CrazyGames' zip names only `sdk.crazygames.com`, Poki's only `game-cdn.poki.com`. Their builds omit online play and external account/cloud-save code. Web and itch have no ad SDK; optional online friendlies make WebRTC/STUN requests after the player hosts or joins a game. (`www.w3.org` is an SVG namespace and `jcgt.org` a shader comment, not requests.) Fonts are bundled | `src/platform/ads.ts`, `scripts/release.mjs`, `src/main.ts` online gate | Release host checks and build-branch inspection |
| **One click to gameplay** for a new player on a portal: TAP TO PLAY goes straight into the first LEARN THE BASICS drill | `src/main.ts` boot, `src/core/onboarding.ts` `straightToBasics` | Browser, `?portal=crazygames` on a fresh save |
| Untimed teaching drills: PASS completes on reception; SHOOT and CROSS teach finishes into an open goal; initial cues wait for input and never swallow the first action | `src/meta/moments.ts`, `src/ui/trainer.ts`, `src/game/matchSession.ts`, `src/sim/scenario.ts` | `tests/basicsPassing.test.ts`, `tests/basicsFinishing.test.ts`, `tests/lesson.test.ts`; fresh browser play |
| Tap SHOOT early on a reachable incoming rebound to strike first time. Movement assist can take a small step to meet it; aim, opposition and contact still decide the outcome. Contact triggers impact feedback; expired/intercepted attempts cannot fire later | `src/sim/match.ts`, `src/game/matchSession.ts`, `src/ui/trainer.ts` | `tests/reboundStrikes.test.ts`, `tests/netCompatibility.test.ts`; real keyboard/touch browser inputs |
| A foul stays in the wide shot for about 0.6 seconds so the tackle/fall can read before the referee decision. Pause preserves the remaining beat, advantage keeps play live and superseded decisions cannot cut away later | `src/game/foulPresentation.ts`, `src/game/matchSession.ts` | `tests/foulPresentation.test.ts`; desktop/touch foul, penalty and pause/resume browser checks |
| **No ads during onboarding or the first match.** Interstitials only at a natural break: just before a new kick-off, never the first thing in a visit, never before or during the basics, never before the first real match; no 2× COINS offer on the first match's result | `src/main.ts` `startMatch` / `onFinish` | Code review; the gating conditions are `finishedThisVisit > 0 && kind !== 'basics' && !firstMatch && played > 0` |
| **All audio muted during ads** (music, effects, crowd: one master gain) and on CrazyGames' `muteAudio` setting | `src/platform/ads.ts` → `sfx.setMuted` | Code review of `src/audio/sfx.ts` (every bus goes through the master gain) |
| **Pause on focus loss:** switching tab or clicking outside the portal frame pauses the match and shows the pause menu | `src/main.ts` `autoPause` (visibilitychange + blur) | Browser |
| SDK start-up capped at 3 s so a slow or blocked SDK never holds the title screen; everything fails soft (adblock users play normally) | `src/main.ts` boot, `src/platform/ads.ts` | Code review |
| CrazyGames: `environment === 'disabled'` treated as no portal, `loadingStart/Stop`, `gameplayStart/Stop` deduplicated, `happytime` only for a 3-goal win. Poki: `gameLoadingFinished`, `commercialBreak` before kick-off, `rewardedBreak` rewards only when watched | `src/platform/ads.ts` | Code review |
| SDK initialization can finish after the title becomes playable: the current gameplay state is sent after initialization and loading completion. Overlapping ad requests are rejected; callbacks arriving after an ad timeout cannot mute the game or grant a reward. Basic Launch / adblock errors disable further ad offers for the visit | `src/platform/ads.ts` | `tests/ads.test.ts` |
| Upload ZIPs are tied to the exact source/version with SHA-256 metadata. Submission rejects stale/replaced ZIPs; packaging checks SDK hosts and missing HTML assets, and Inspector extraction rejects unsafe paths | `scripts/release.mjs`, `scripts/submission.mjs`, `scripts/release-checks.mjs` | `tests/releaseChecks.test.ts`; release/submission checks |
| Rewarded button reads "🎬 2× COINS", yellow, beside a larger CONTINUE; CONTINUE is disabled while the ad runs | `src/ui/menus.ts` `fulltime` | Code review |
| Works in incognito / with storage blocked (every `localStorage` call is wrapped) | `src/core/save.ts` | Code review |
| Store text, covers and thumbnails | `docs/STORE_LISTING.md`, `store-assets/` (docs/BRAND.md) | Store text rewritten on 28 Sep to match the v1 features |
| Privacy policy (web build) | `public/privacy.html` | Updated 29 Sep: goal clips, key bindings, contact calynx@zohomail.com.au |
| Third-party licence notices (three.js MIT, fonts OFL, supabase-js MIT) | `third-party-licenses.txt`, generated into every build | Present in every zip |

What the v1 game has (so the listing stays honest): LEARN THE BASICS (three drills), then the first match; the first goal unlocks CAREER, MOMENTS, CLUB RUN and BLITZ. Quick Match, Blocky Cup, Career (six divisions, transfer market, stadium), Club Run (seven matches, perks), eight Football Moments, Blitz power-ups, XP levels, mastery badges, a monthly season track, daily challenges and gift, unlockable balls and celebrations. Text commentary (the spoken voice was removed). Settings: key and gamepad remapping, fixed or floating touch stick, colour-blind shape cues. Goal clips (SAVE CLIP / SHARE, a WebM) where the browser can record the canvas.

**Hidden difficulty help (honest note):** the game quietly eases the AI in a few cases. The first two real matches of a save, three career defeats in a row (until the next career win) and three quick-match defeats in a row at one difficulty (until a win there) make the AI press, tackle and finish a little softer against the player (`src/core/dda.ts`: 0.5 / 0.35 / 0.25 on `MatchConfig.assist`). The only visible sign is a "Tough run? TRY EASY" line after the third quick-match defeat. The drills in LEARN THE BASICS use a strong ease (0.8). None of this is shown as a difficulty label, so don't describe the difficulty levels as fixed in store copy.

### 1.2 What the owner must do (in this order)

1. **Pick the first portal.** Recommended: **CrazyGames first** (open submission, non-exclusive, fast Basic Launch), then GameDistribution later. Choose **Poki** instead only if you're happy with web exclusivity and a slower, curated process (they rule out the others; §2).
2. ~~Add a contact email~~ Done: calynx@zohomail.com.au is in `public/privacy.html`.
3. **Create the portal account(s) yourself** and accept their terms: [CrazyGames developer portal](https://developer.crazygames.com/) (and later Poki / GameDistribution / itch.io). Fill in the payout and tax forms when asked. Nobody else can do this for you.
4. ~~Capture the store media~~ Done 29 Sep. The screenshots (8 at 1920×1080, 2 phone shots at 1080×1920) and videos (CrazyGames 16:9 and 2:3, Poki's 1080×1080 loop) are in `release/submission/media/`, and `npm run submission` sorts them into each portal's folder (`docs/SUBMIT.md`).
5. **Test the portal build in the portal's own tool** before submitting: CrazyGames' Preview/QA tool (or `localhost` with `?useLocalSdk=true`), Poki Inspector for Poki. Check a full match, a rewarded ad, mute during ads, and the phone layouts.
6. **Submit** `release/blocky-league-crazygames-v<version>.zip` (the version is in `package.json`) with the three CrazyGames covers and the copy from `docs/STORE_LISTING.md`. At submission, switch on **Automatic Progress Save** (no code needed; the game has no purchases). Test that it restores progression for a signed-in CrazyGames player on another device before Full Launch.
7. **While in Basic Launch** (at least 7 days and 500 plays): watch the portal's stats (conversion to gameplay, playtime, retention) and fix what they show before Full Launch review.
8. **Optional, costs nothing:** upload the itch build as "$0 or donate", and put `dist-web` on Cloudflare Pages (§8) with `SITE_URL=https://your-site npm run build:web` so the social card works. Don't link to them from inside the portal builds.

The CrazyGames and Poki builds are single player. Both the own-site web build and itch build include optional peer-to-peer online friendlies, using manually exchanged connection codes and a public STUN server; there is no relay, so some networks cannot connect. External account/cloud saves are confined to the own-site web build and compiled out of itch, CrazyGames and Poki. GameDistribution still needs its own SDK integration (§6); its prepared artwork alone does not make it publishable.

### 1.3 Unverified

- **Load time on a throttled phone connection.** Not measured: no throttling tool was available on the build machine. What was measured (28 Sep, itch build served gzipped from localhost, an Apple-silicon Mac, no throttling): the page downloads **445 KB** in total (script 389 KB, styles 36 KB, two fonts 18 KB) and the title screen is up about **1.4 s** after navigation, most of it building the 3D scene (the studio splash also holds for at least 0.8 s). Estimate for Chrome's "Slow 4G" profile (about 1.6 Mbit/s, 150 ms latency): about 3 s to download plus the boot, so roughly **4 to 4.5 s on a laptop**, and possibly **over 5 s on a slow phone CPU**. On "Fast 4G" it should be about 2 to 3.5 s. Check it in Poki Inspector (it reports load time) or Chrome DevTools' network throttling before submitting.
- **Goal clips on real devices.** Recording uses `MediaRecorder` on the canvas; it's off where the browser lacks it (the buttons are hidden then). SHARE uses the system share sheet only where the browser can share files (mostly phones); elsewhere it downloads.
- **Portal SDK behaviour in the live environment** can only be checked on the portal (its Preview/QA tool or Poki Inspector).

---

## 2. Recommended path

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

## 3. Building the release files

```bash
npm install
npm run build:web          # own site (Cloudflare Pages / Netlify / GitHub Pages)
npm run build:crazygames   # VITE_PORTAL=crazygames
npm run build:poki         # VITE_PORTAL=poki
npm run build:itch         # no ads, no PWA (itch.io runs games in an iframe)
npm run build:all          # all four
npm run assets             # fill in MISSING icons / covers only (the designed art is never overwritten)
```

- Each `build:*` runs `tsc --noEmit` first, so a type error anywhere stops the build. To package without the type check: `node scripts/release.mjs <variant>`.
- The release script prints the file count, unpacked and zipped size, any file over 300 KB, and every external host named in the shipped code. It then re-opens each zip and checks every entry's CRC.
- Each ZIP has a matching `.json` release record beside it containing the source/version and ZIP hashes. Keep them together locally and run `npm run submission` after building. A missing record, changed source, or replaced ZIP fails submission checks; upload only the ZIP and the requested store media, not the release record.
- Portal builds fail packaging if the wrong SDK/external host is present, an HTML asset is missing, or an asset path is root-absolute. Each build is standalone under a portal sub-path.
- For the web build on a real domain, pass the site URL so social cards get an absolute image URL:
  ```bash
  SITE_URL=https://your-domain.example npm run build:web
  ```

Measured on 2 Oct 2026 after the release fixes (re-check the script's output each release):

| Variant | Files | Unpacked | Zip |
|---|---:|---:|---:|
| web | 30 | 1.88 MB | 824.2 KB |
| crazygames | 18 | 1.54 MB | 508.9 KB |
| poki | 18 | 1.54 MB | 508.8 KB |
| itch | 20 | 1.58 MB | 524.8 KB |

The main portal game script is about 1.30 MB (about 400 KB compressed: Three.js plus the game). A small separate boot module can display a retry screen if that script or WebGL initialization fails. Fonts are bundled; the stadium, players and crests are generated in code.

All of these are far below the published limits:

- CrazyGames: initial download ≤ 50 MB (≤ 20 MB for the mobile homepage), ≤ 1,500 files.
- Poki: guidance of ≤ 5 MB initial, ≤ 8 MB total.
- itch.io: ≤ 1,000 files, ≤ 500 MB extracted.

---

## 4. CrazyGames

Developer portal: <https://developer.crazygames.com/> · Docs: <https://docs.crazygames.com/>

### 4.1 Steps

1. **Create a developer account** at developer.crazygames.com. You do this yourself.
2. Run `npm run build:crazygames` (the old fix list in §10 is all done).
3. **Test locally.** On `localhost` the SDK runs in *local* mode: ads show as overlay text and logging is on. Add `?useLocalSdk=true` to force this on any domain, and `?muteAudio=true` to test the mute setting.
4. **Submit.** Upload `release/blocky-league-crazygames-v<version>.zip` and the three covers from `store-assets/`:
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
| Every SDK call throws when `SDK.environment === 'disabled'` (any non-CrazyGames domain) | Done: `'disabled'` counts as no portal, and every call is wrapped |
| `game.loadingStart()` / `game.loadingStop()`: optional pair for load-time stats | Done |
| `game.gameplayStart()` on every start/resume; `gameplayStop()` on menus, pause, match end | Done (deduplicated, including SDK initialization finishing after the player has started) |
| Don't call `gameplayStop` just because focus/visibility changed | Only called when the game really shows the pause menu. OK |
| `game.happytime()`: rarely, for real achievements | Done: only for a win by three goals or more |
| `ad.requestAd('midgame' \| 'rewarded', { adStarted, adFinished, adError })`; mute in `adStarted`, resume in `adFinished`/`adError`; never reward on `adError` | Done |
| Basic Launch disables ads (`adsDisabledBasicLaunch`); players with adblock must still be able to play | Done: no reward on errors, normal play continues, further ad offers stop after a Basic Launch/adblock error. Local SDK demo ads do not prove monetization is enabled on the live portal |
| Midgame only at natural breaks; **never on a navigation button** (main menu, settings, shop); no own cooldown (the SDK caps at 1 per 3 min) | Done: just before a new kick-off, never during the basics or before the first match, no local limiter |
| Full Implementation **must support `SDK.game.settings.muteAudio`** + `addSettingsChangeListener` | Done |
| Cloud progress save for Full Launch: `SDK.data` (plus the Progress Save toggle) **or** *Automatic Progress Save* | No code needed if you enable **Automatic Progress Save** at submission (allowed because the game has no purchases) |
| User/account module | Not needed: the game has no user accounts |

### 4.3 QA checklist (from the requirements pages)

**Technical**
- [x] Relative paths only. *Verified by `release.mjs` on every build.*
- [ ] Works on Chrome, Edge and 4 GB Chromebooks. *Chrome checked; Edge and a Chromebook not tested.*
- [x] Touch controls on mobile (floating or fixed stick), plus `user-select: none` on `body`. *In `src/style.css`.*

**Rules**
- [x] **No custom fullscreen button.** *There isn't one.*
- [x] **No external links or cross-promotion.** App-store links are never allowed. *The game has no links (checked: no `href` or `window.open` in the game code; SAVE CLIP is a local download).*
- [x] **Only CrazyGames SDK ads.** No other ad scripts. *The CrazyGames zip names only `sdk.crazygames.com` (checked 28 Sep).*
- [x] In-game purchases are invite-only (Xsolla). *The game has none.*

**Ads**
- [x] Game paused and **all audio muted** during ads. *One master gain carries music, effects and crowd.*
- [x] UI blocked while an ad request is in flight. *CONTINUE is disabled while the rewarded ad runs; the interstitial plays before the match is built.*
- [x] Adblock users can still play normally. *Everything fails soft; the SDK wait is capped at 3 s.*
- [x] Rewarded offer is clearly optional, and the skip option isn't hidden or delayed. *"Continue" sits next to the reward button, and is bigger.*

**Content**
- [x] English text; content PEGI-12 compliant.
- [x] Full Launch: new players reach gameplay immediately or within 1 click. *A first visit's TAP TO PLAY goes straight into the first basics drill.*

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
2. **Build** with `npm run build:poki`.
3. **Poki Inspector.** Drag the `dist-poki/` folder into it. You get:
   - a QA checklist and an SDK event log;
   - load time and file size;
   - external-request warnings;
   - scaling tests at 640×360, 836×470 and 1031×580;
   - mobile testing by QR code.
4. **Testing stages:** upload → playtests → player fit test → web fit test (about 7 days) → final review (1–2 weeks).
5. **If selected:** agreement → QA → Soft Release (2–3 weeks, can't be skipped) → Global Release. Poki estimates about 2–3 months from agreement to Global Release.
6. **Thumbnails and video.**
   - Static: `store-assets/poki-thumbnail-1024x1024.png`. It is full-bleed, text-free and at least 628×628; Poki rounds the corners itself.
   - Animated: a 1080×1080+ `.mp4`, 4–6 s, 50 fps or more, muted. It's needed before Global Release.
7. **Payouts:** wire or PayPal, set up in the Poki for Developers platform. The payout threshold isn't stated in the docs.

### 5.2 SDK v2 rules vs. this repo

| Rule (docs) | Repo status |
|---|---|
| Script `https://game-cdn.poki.com/scripts/v2/poki-sdk.js`; `PokiSDK.init()` returns a Promise. If it rejects, load the game anyway | Done (fails soft, with a timeout). init/commercialBreak can hang if an adblocker blocks the core script, so the adapter's timeouts are needed |
| `gameLoadingFinished()` when loading is done, before the first `gameplayStart()` | Done |
| `gameplayStart()` on the player's first input (not on load); `gameplayStop()` on every pause/menu/match end; never the same event twice in a row; no events during ads | Done (starts at kick-off, deduplicated) |
| `commercialBreak()` before each `gameplayStart()` after the first, when the player is heading back into play (not when going to menus); Poki decides whether an ad plays; no own ad timers | Done: just before a new kick-off, no local limiter |
| `rewardedBreak()` resolves `true` only when watched; grant only then | Done |
| Rewarded button must show 🎬, must not be green, and the normal continue button must be the same size or larger, next to or above it | Done: "🎬 2× COINS", yellow, beside a larger CONTINUE |
| No external requests (Poki applies a CSP); no other ad systems; no outgoing links; no IAP | Done: the Poki zip names only `game-cdn.poki.com` (checked 28 Sep) |
| Works in incognito: localStorage wrapped in try/catch | Done (`src/core/save.ts`) |
| Desktop + mobile + tablet; 16:9 scaling | Test with Poki Inspector |
| `happyTime` | Not called on Poki |

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

**Thumbnails (mandatory):** 512×512, 512×384 and 200×120, all in `store-assets/gamedistribution-*`.

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
5. **Cover:** `store-assets/itch-cover-630x500.png`. Add screenshots from the shot list in `docs/STORE_LISTING.md`.
6. **Optional CLI uploads:** use [butler](https://itch.io/docs/butler/): `butler push dist-itch you/blocky-league:html5 --userversion <version>` (use the version in `package.json`).

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

## 10. The old fix list (all done)

Kept for the record: every item was checked against the code on 28 Sep 2026.

1. [x] **One SDK per build.** Gate the portal branches in `ads.ts` on `import.meta.env.VITE_PORTAL` so the other portal's SDK code and URL are removed at build time, and ignore `?portal=` in portal builds. Poki blocks external requests, and CrazyGames forbids other portals' branding.
2. [x] **CrazyGames `disabled` environment:** check `SDK.environment` after `init()`, treat `'disabled'` as no portal, and wrap every SDK call in try/catch.
3. [x] **CrazyGames `loadingStart()`:** call it right after `init()`, paired with the existing `loadingStop()`.
4. [x] **CrazyGames `muteAudio`:** read `SDK.game.settings.muteAudio` and subscribe with `addSettingsChangeListener`. Required for Full Launch.
5. [x] **Move the midgame / commercialBreak** from the full-time "Continue" button (which navigates to the menu) to just **before kick-off of the next match**, and optionally before the second half.
6. [x] **Remove the local 3-minute limiter** in `ads.midgame()`. Both portals pace ads themselves and ask you not to add timers.
7. [x] **Mute all audio during ads and restore it afterwards.** Today only the music stops, and it's never restarted. SFX and crowd keep playing.
8. [x] **happytime:** drop Poki's `happyTime` (not in the HTML5 docs; a no-op). Consider calling CrazyGames' `happytime()` only for bigger moments, such as a win on Hard/Legend or a trophy, not every win.
9. [x] **(Recommended) One-click play** for new players on CrazyGames Full Launch, for example a "Play" that goes straight to a quick match.
10. [x] **Rewarded button:** add the 🎬 icon (Poki requirement), and disable "Continue" while a rewarded request is in flight (CrazyGames: block the UI until `adFinished`/`adError`).
11. [x] **Cap total ad-SDK start-up wait** at about 3 s so a slow or blocked SDK can't delay the title screen by up to 12 s. Poki notes players leave after about 10 s of loading.

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

The original research was fetched on 25 Sep 2026. CrazyGames SDK intro, game events/settings, video ads, technical requirements, account integration and Data module were rechecked on 2 Oct 2026. Poki's partnership terms and web-engine size guidance were also rechecked on 2 Oct 2026; indicative terms can differ from the agreement offered for a particular game.

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
