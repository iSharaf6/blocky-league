# Submitting Blocky League: the click-by-click guide

_Release instructions refreshed 2 October 2026. Historical research and browser observations below retain their recorded dates; current CrazyGames integration requirements were rechecked on 2 October (see PUBLISHING.md). Portals change their forms, so if a button has a different name, look for the nearest match and trust the portal's own wording over this page._

Everything you upload is already made and checked. Your part: create the accounts, accept the terms, click upload and paste. Nobody else can do those for you.

**Before anything else, refresh the kit** (it takes a minute):

```bash
npm run build:all      # rebuild the four zips from the latest code
npm run submission     # rebuild release/submission/ and re-check everything
```

`npm run submission` must end with **All checks passed**. Every ZIP needs its matching release record; changed source or a replaced ZIP now fails validation. Rebuild rather than uploading a stale package. It rebuilds one folder per portal:

```
release/submission/
  crazygames/        upload/ (zip)   covers/   videos/   screenshots-if-asked/   listing.txt
  itch/              upload/ (zip)   cover/    screenshots/   trailer-for-youtube/   listing.txt
  poki/              upload/ (zip + inspector-folder/)   thumbnails/   screenshots-if-asked/   listing.txt
  gamedistribution/  NOT-READY.txt   thumbnails/   screenshots/   video-optional/   listing.txt
  media/             the source screenshots and videos (never changed by the script)
```

`listing.txt` in each folder holds every field for that portal, ready to paste. Each portal's listing names only that portal.

---

## 1. The one decision: CrazyGames or Poki

**Recommended: CrazyGames first, and itch.io at the same time.** You can add GameDistribution later.

- **CrazyGames** takes open submissions and is not exclusive. The game goes live quickly in a *Basic Launch*: a small audience, no ads and no money yet, for at least 7 days and 500 plays. After that, CrazyGames decides on a *Full Launch* (ads and revenue share) from how long people play, how many come back the next day, and how many new visitors actually start playing. The CrazyGames build already has the SDK integrated. Full Launch still requires CrazyGames selection, live SDK checks, and progress-save verification.
- **itch.io** is free and self-serve, with no review. It's a good place to share a link and get feedback while CrazyGames runs its Basic Launch.
- **Poki** is the biggest audience but the hardest door. It hand-picks games, testing takes weeks, and its standard deal is **web-exclusive for about 5 years**. That exclusivity covers the whole open web, including Discord and YouTube Playables, so you'd have to take the game off CrazyGames, itch.io and GameDistribution. Steam, the app stores and consoles stay yours. Poki pays 100% of ad revenue from players who come to the game directly and 50/50 on players Poki brings. The only non-exclusive option is a one-time flat fee with no revenue share.

**The honest trade-off.** Poki can bring far more players, but only if it accepts the game, and it takes 2–3 months from agreement to global release. If you launch on CrazyGames and itch.io first and Poki later wants the game, you would have to take it down from the others to sign the exclusive deal. If Poki is your dream platform, apply there *first* and wait for its answer before submitting anywhere else. If you'd rather be live this week and learn from real players, go with CrazyGames and itch.io.

---

## 2. Before you click submit (one page)

Tick every line for the portal you're on.

- [ ] `npm run build:all`, then `npm run submission`: **All checks passed**, with current source and ZIP hashes matching.
- [ ] You played the zip you're about to upload, start to finish (the first drill, then a quick match), on a computer and on a phone. The quickest way is the portal's own test tool (step 3 of each portal below).
- [ ] In that test tool, you checked all of these:
  - The game loads.
  - The first click lands in gameplay.
  - Switching tabs pauses the match.
  - Sound goes quiet during an ad.
  - The **🎬 2× COINS** button works.
  - Nothing breaks when the ad doesn't show.
- [ ] Every text field came from **this portal's** `listing.txt`.
- [ ] The images went into the right slots: landscape, portrait and square covers in their own slots. The two CrazyGames videos also go in separate slots: 16:9 into landscape, 2:3 into portrait.
- [ ] The privacy link opens: <https://isharaf6.github.io/blocky-league/privacy.html>. Mail to calynx@zohomail.com.au arrives (send yourself a test).
- [ ] You read the terms you're accepting. On Poki, you understood the web-exclusive deal (§1).
- [ ] itch.io only: you answered the AI disclosure honestly (§4, step 7).
- [ ] You backed up `release/submission/media/`. `release/` is not in git, so those files exist only on this computer.

Payout and tax forms (Tipalti on CrazyGames, Poki's and itch's own) can come later, but you won't be paid until they're done.

---

## 3. CrazyGames (recommended first)

Folder: `release/submission/crazygames/`

1. **Sign up.** Go to <https://developer.crazygames.com/> and create a developer account. Accept the developer terms yourself.
2. **Start a submission.** Click **Submit a game** (or the portal's equivalent, such as *Add game* or *Upload*).
3. **Upload the build.** Upload `upload/blocky-league-crazygames-v1.0.0.zip`. Its `index.html` is at the root of the zip, all paths are relative, and there are 18 files (about 1.53 MB extracted), well under CrazyGames' limits. _CrazyGames' docs don't say whether the portal wants a zip or loose files. If it asks for files, unzip the zip and upload the contents._
4. **Test in the Preview tool.** The portal opens your build in the **Preview** (QA) tool. Check all of these:
   - TAP TO PLAY goes straight into the first drill (one click).
   - A quick match plays through to full time.
   - Pausing and switching tabs work.
   - A rewarded ad (2× COINS on the result screen) plays and mutes the sound.
   - Phone size works (the Preview tool has device sizes).
   - Esc also leaves browser fullscreen on CrazyGames, so check that **P** pauses too.
5. **Images.** Upload the three covers from `covers/` into their matching slots:
   - `crazygames-landscape-1920x1080.png` into landscape (16:9)
   - `crazygames-portrait-800x1200.png` into portrait (2:3)
   - `crazygames-square-800x800.png` into square (1:1)
   These carry the title only, as CrazyGames requires.
6. **Videos.** Upload the two videos from `videos/`:
   - `blocky-league-16x9-1920x1080.mp4` into landscape
   - `blocky-league-2x3-1080x1620.mp4` into portrait
   Both run 18.5 s, open on the static cover, are silent, and are under 50 MB.
7. **Text.** Paste from `listing.txt`:
   - Name, developer (**Calynx**) and description.
   - Controls.
   - Category and tags: pick the closest ones from CrazyGames' lists.
   - Orientation (both are supported) and devices (desktop and mobile).
   - Privacy URL and contact.
8. **Switches.** Set these:
   - **Automatic Progress Save:** ON.
   - Multiplayer: no.
   - In-game purchases: none.
9. **Submit.** Your part is done.

**What happens next** (from CrazyGames' docs):

- **Initial QA check.** The official docs give no review time. One third-party guide says feedback takes 1–2 days. You'll hear by email.
- **Basic Launch.** The game goes live with no ads. It lasts at least 7 days and needs 500 plays, and ends automatically after 21 days if it doesn't reach 500. CrazyGames' targets are:
  - average playtime of 10 minutes or more
  - day-1 retention of 10–15%
  - 80% or more of visitors playing at least a minute
- **Full Launch decision.** If selected, ads switch on through the SDK, which is already in this build.
- **Updates.** A new zip is "usually processed within the same working day". Rebuild, run `npm run submission`, and upload the new zip as a new version.
- **Exclusivity bonus.** An opt-in 2-month exclusivity after Full Launch pays +50% (per `docs/PUBLISHING.md`, read on 25 Sep). It would rule out GameDistribution and itch.io for those 2 months.

---

## 4. itch.io (free, no review, any time)

Folder: `release/submission/itch/`

1. **Sign up** at <https://itch.io/register>, then open your **Dashboard**.
2. Click **Create new project**.
3. **Basics.** Fill these in:
   - **Title:** Blocky League
   - **Project URL:** `blocky-league`
   - **Short description:** copy from `listing.txt`.
   - **Classification:** Games
   - **Kind of project:** **HTML**
   - **Release status:** Released
4. **Pricing.** Choose **No payments**, or "$0 or donate". itch lets HTML games take donations only unless you contact its support.
5. **Uploads.** Upload `upload/blocky-league-itch-v1.0.0.zip` and tick **This file will be played in the browser**.
6. **Embed options.** Set these:
   - **Embed in page**, viewport **960 × 540** (the game scales to fit).
   - **Mobile friendly:** ON. Choose landscape if an orientation option appears.
   - **Fullscreen button:** ON. itch's own button is fine on itch; the no-custom-fullscreen rule is CrazyGames'.
   - **Scrollbars:** OFF.
   - **SharedArrayBuffer:** OFF.
7. **Details.** Paste the description (it has the controls at the end) and set:
   - **Genre:** Sports
   - **Tags:** from `listing.txt` (itch allows 10).
   - **AI disclosure:** your call, but answer honestly. The game's code, which also generates every model, texture and sound, was written with an AI coding assistant. itch asks you to tag projects containing generative-AI material. If unsure, disclose.
8. **Media.**
   - **Cover image:** `cover/itch-cover-630x500.png`.
   - **Screenshots:** 3–5 from `screenshots/`. Suggested: 02 open play, 03 celebration, 04 Blitz, 06 full time, and the phone shot.
   - **Trailer:** itch wants a YouTube or Vimeo link, not a file. It's optional: upload `trailer-for-youtube/…mp4` to YouTube first if you want one.
9. **Visibility.** Leave it as **Draft**, click **Save & view page**, and play it right there once. When it works, set it to **Public** and save.

**What happens next:** nothing to wait for. HTML games need no review. The page appears in itch's search and browse once it's public, has a cover, and is playable. itch only queues a *first paid project* for a few days' review, which doesn't apply here.

---

## 5. Poki (only if you choose web exclusivity)

Folder: `release/submission/poki/`

1. **Apply** at <https://developers.poki.com/guide/share>. The form asks for:
   - your name, email, studio or team (**Calynx**) and country
   - a short studio description and platforms you've used (optional)
   - links to previous games
   - the genres and engines you work with (Three.js / TypeScript), and what you want from Poki
   Poki then contacts you to give access to *Poki for Developers*. No response time is stated.
2. **Create the game** in Poki for Developers. In the **Settings** tab, set:
   - the title
   - up to 4 categories
   - the suggested description (both in `listing.txt`)
3. **Poki Inspector.** Open <https://inspector.poki.dev> and give it the folder `upload/inspector-folder/` (Poki asks for the game's folder, not a zip). Work through its QA checklist, SDK event log, load time and size, external-request warnings, scaling tests and phone test by QR code. The Inspector can also be opened from the **Versions** tab. Expect:
   - one external host from the game: `game-cdn.poki.com`
   - the ad requests Poki's SDK makes on its own
4. **Upload the version** in the **Versions** tab, using the folder or `upload/blocky-league-poki-v1.0.0.zip`, whichever the tab accepts.
5. **Thumbnails** tab:
   - **Static:** `thumbnails/poki-thumbnail-1024x1024.png` (square, no text; Poki rounds the corners).
   - **Animated:** `thumbnails/blocky-league-square-1080x1080.mp4` (1080×1080, 60 fps, 5.5 s, muted). It's needed before global release.
6. **Playtests.** Every version first passes a content check. Then each playtest returns 10 recordings of real players; watch them.
7. **Player Fit Test.** It unlocks after you've watched 10 recordings and added a thumbnail. It shows the game to 500 players over about 5 hours. To pass, average playtime must be 3 minutes or more, with 25% of plays over 3 minutes.
8. **Web Fit Test**, then **final review**: 1–2 weeks for the decision. Then the agreement (the web-exclusive deal in §1), QA, a 2–3 week Soft Release, and Global Release. Poki estimates 2–3 months from agreement to global release.

**Things Poki may flag** (not verified in the Inspector yet):
- Poki says to remove splash screens, while "your studio logo is welcome on the loading screen". The Calynx logo shows during loading and holds for at least 0.8 s. If Poki asks, that hold can be dropped for the Poki build.
- Load time: see `docs/PUBLISHING.md` §1.3. The Inspector measures it.

---

## 6. GameDistribution (not ready yet)

Folder: `release/submission/gamedistribution/`. It has no zip on purpose: see `NOT-READY.txt`.

GameDistribution's developer terms say the game must implement **their SDK**, or publishing is denied. Blocky League doesn't have a GameDistribution build yet: it needs an `ads.ts` branch and a `build:gamedistribution` variant (`docs/PUBLISHING.md` §6). Everything else is ready for when it does:
- mandatory thumbnails at 512×512, 512×384 and 200×120
- optional thumbnails at 1280×720 and 1280×550
- description (438 characters) and instructions (415), both within the 200–500 asked for
- genres and tags

Once a GameDistribution build exists:

1. Create an account at <https://developer.gamedistribution.com/> and add the game.
2. Upload the GameDistribution zip.
3. Add the thumbnails, then paste the description, instructions, genres and tags.
4. Work through the dashboard checklist. Activation requires watching one in-game ad all the way through from the upload view.
5. Click **Request Activation**.

Review times conflict between GameDistribution's own pages: "up to 2 days", "up to two weeks", and "up to 3 weeks" in a search snippet. Expect up to a few weeks.

GameDistribution is non-exclusive and pays the developer 33% of net revenue, monthly, from €50.

---

## 7. Current release checks and historical observations

**2 October 2026:** the startup loader, pause/menu/input lifecycle, restricted gamepad access, save repair and portal SDK failure paths were improved. `build:all` now verifies upload paths/assets and writes content hashes; `submission` rejects stale source or modified ZIPs. Current portal sizes are about 507 KB zipped (CrazyGames and Poki); itch is about 523 KB. Re-run the commands above after any source changes.

The observations below are the previous 29 September run, retained as historical evidence; they do not replace current Preview/QA testing.

**Zips** (the `release/*.zip` files from `npm run build:all` on 28 Sep, 01:44). `npm run submission` re-checks these on every run:

| Zip | Files | Unpacked | External hosts in the code | Result |
|---|---:|---:|---|---|
| crazygames | 12 | 1.47 MB | `sdk.crazygames.com` only | index.html at root, relative paths, no `wss://`, no service worker, CRCs good |
| poki | 12 | 1.47 MB | `game-cdn.poki.com` only | same |
| itch | 12 | 1.47 MB | none | same |

**Boot test.** Each zip was unpacked and served from a sub-path (`/game/<variant>/`), as a portal would, in headless Chrome with a fresh save:
- **CrazyGames** (`?portal=crazygames`): title screen up, and the CrazyGames SDK started in local mode (loading start/stop, settings listener). **One click reached the first drill.** No errors, no warnings, no 404s.
- **Poki** (`?portal=poki`): title screen up; Poki SDK init, `gameLoadingFinished` and `gameplayStart` all fired. One click reached the first drill. No errors. There were two warnings, both from inside Poki's ad SDK ("Handler scope is deprecated"), not from the game. The game itself requests only `game-cdn.poki.com`; the other hosts seen (Google IMA, Prebid, Amazon) are requested by Poki's SDK.
- **itch** (`?portal=crazygames`, to prove the parameter is ignored): title screen up, **zero network requests beyond the game's own files**, and a silent console. TAP TO PLAY goes to the main menu with LEARN THE BASICS on top. That's two clicks to play, which is fine on itch.
- **Web** build: boots under a sub-path, silent console, and `privacy.html` is served.

**Media:** 1920×1080 screenshots (8), phone 1080×1920 screenshots (2), and three videos. Each video's size, length, frame rate (60 fps) and silence is re-checked by the script. They were captured on 29 Sep from the latest development build, which is newer than the 28 Sep zips.

**Not verified (only the portals can show these):**
- The live developer-portal forms. CrazyGames' and Poki's portals are apps that couldn't be read without an account, so the button names in §3 and §5 come from their documentation.
- Portal SDK behaviour on the real sites: ads actually filling, and CrazyGames' `muteAudio` setting.
- Load time on a slow phone (`docs/PUBLISHING.md` §1.3).
- Browsers other than Chrome, and a 4 GB Chromebook (CrazyGames asks for Chrome, Edge and 4 GB Chromebooks).
- **Online multiplayer is confined to web and itch builds.** CrazyGames and Poki submissions compile out the online mode and external account login. The portal ZIP validator checks for unauthorized hosts.

---

## 8. Requirements found (read 29 September 2026)

The pages were read with a web-fetch tool that summarises them. Short quotes are its extraction, and anything marked _third-party_ is not an official source.

### CrazyGames
| Requirement | Value | Source |
|---|---|---|
| Build size and files | Initial download ≤ 50 MB (≤ 20 MB for the mobile homepage); ≤ 1,500 files; total ≤ 250 MB | <https://docs.crazygames.com/requirements/technical/>, <https://docs.crazygames.com/requirements/intro/> |
| Paths | Relative paths only, never absolute | <https://docs.crazygames.com/requirements/technical/> |
| Browsers | Chrome and Edge; smooth on 4 GB Chromebooks; Safari may be disabled if it runs badly | same |
| Upload format | **Unclear**: zip or loose files is not stated | <https://docs.crazygames.com/sdk/intro/> |
| Covers (mandatory) | 1920×1080 (16:9), 800×1200 (2:3), 800×800 (1:1). Title is the only text allowed. No borders, icons, store logos, blurry art or plain screenshots | <https://docs.crazygames.com/requirements/game-covers/> |
| Preview videos | Two, "1080p" 16:9 and 2:3. 15–20 s (longer is cut at 20 s), ≤ 50 MB, no sound, cover as the opening frame. No black screens, logo transitions, black bars, cursor, promo text or app icons. Don't fast-forward. Format not stated (MP4 used). Whether the videos are strictly required is **unclear** | same |
| Screenshots | Not asked for | (not on any requirements page) |
| Gameplay | Land in gameplay immediately, or within 1 click. No custom fullscreen button. No cross-promotion (app-store links never allowed). PEGI 12 compliant. English | <https://docs.crazygames.com/requirements/gameplay/> |
| Keys | Esc closes fullscreen; Ctrl/Cmd+W closes the tab; adapt to AZERTY (the game reads physical keys, so WASD works as ZQSD) | <https://docs.crazygames.com/requirements/quality/> |
| Basic Launch | ≥ 7 days and 500 plays, auto-ends at 21 days. No ads. SDK not required, but if present it must send gameplay start | <https://docs.crazygames.com/resources/basic-launch-metrics/>, <https://docs.crazygames.com/requirements/ads/> |
| Full Launch | SDK, gameplay events, ads only via the SDK, one-click gameplay | <https://docs.crazygames.com/requirements/intro/> |
| Review times | Updates "usually processed within the same working day". First QA: not stated (_third-party_: 1–2 days, <https://app.cinevva.com/guides/publish-game-crazygames>) | <https://docs.crazygames.com/faq/> |
| Exclusivity | Not required | same |

### Poki
| Requirement | Value | Source |
|---|---|---|
| Deal | Web Exclusive (default, 5 years, covers the open web, Discord and YouTube Playables) or a non-exclusive one-time fee. 100% of direct revenue, 50/50 on Poki's traffic | <https://developers.poki.com/guide/revenue-deal-types>, <https://developers.poki.com/guide/working-with-poki> |
| Apply | Form: name, email, team, country, studio description, previous games, genres and engines, goals | <https://developers.poki.com/guide/share> |
| Inspector | inspector.poki.dev; "open your game's folder" (zip not mentioned); QA checklist, SDK log, external requests, load time, size, scaling, QR mobile test | <https://developers.poki.com/guide/inspector> |
| Size | "initial download should not exceed 5MB and 8MB in total" | <https://developers.poki.com/guide/web-engine> |
| Quality | Pause on ESC or Space; no splash screens (a studio logo on the loading screen is fine); scale to 640×360, 836×470, 1031×580; desktop, mobile and tablet; localStorage in try/catch | <https://developers.poki.com/guide/requirements-quality> |
| External requests | Blocked by default; no chat or external logins | <https://developers.poki.com/guide/external-resources-policy> |
| Static thumbnail | Full-bleed square ≥ 628×628; no text, padding or borders; show the main character | <https://developers.poki.com/guide/game-thumbnail> |
| Animated thumbnail | ≥ 1080×1080, 1:1, ≥ 50 fps, 4–6 s, muted MP4, ≤ 100 MB; needed before global release | <https://developers.poki.com/guide/your-game-page> |
| Testing | Playtests (10 recordings); Player Fit Test (500 players, ~5 h; pass at 3+ min average and 25%+ of plays over 3 min); Web Fit Test (3–5 days on one page, ~7 on another); final review 1–2 weeks; release 2–3 months | <https://developers.poki.com/guide/how-testing-works>, <https://developers.poki.com/guide/player-fit-test>, <https://developers.poki.com/guide/web-fit-test>, <https://developers.poki.com/guide/final-review>, <https://developers.poki.com/guide/release-process> |

### GameDistribution
| Requirement | Value | Source |
|---|---|---|
| SDK | **Mandatory**; publishing is denied without it; activation needs one ad watched in full | <https://static.gamedistribution.com/terms/developer.html>, <https://github.com/GameDistribution/GD-HTML5/wiki/SDK-Implementation> |
| Thumbnails | **Unclear** (the official design guide is image-only). A search summary lists 512×512, 512×384 and 200×120 as mandatory, and 1280×720 and 1280×550 as optional. All five are in the kit | <https://static.gamedistribution.com/developer/developers-guidelines.html> (unreadable) |
| Upload | A zip (_third-party_ only); size limits **unclear** | <https://defold.com/2021/03/14/Releasing-html5-games-on-Game-Distribution/> |
| Text limits | 200–500 characters for description and instructions: **not confirmed** on an official page (kept from `STORE_LISTING.md`) | none found |
| Money | Non-exclusive; 33% of net revenue; €50 minimum, monthly | <https://static.gamedistribution.com/terms/developer.html>, <https://github.com/GameDistribution/GD-HTML5/wiki/F.A.Q.> |
| Review | Conflicting: up to 2 days, up to two weeks, up to 3 weeks | the F.A.Q. and SDK pages above, <https://gamedistribution.com/developers/> |

### itch.io
| Requirement | Value | Source |
|---|---|---|
| Zip | Must contain `index.html` (root is the safe choice; ours is at the root); .zip only; ≤ 1,000 files; ≤ 500 MB extracted; ≤ 200 MB per file; paths ≤ 240 characters; case-sensitive names | <https://itch.io/docs/creators/html5> |
| Embed | Embed in page (you set the viewport) or click to launch in fullscreen; fullscreen button; scrollbars; Mobile friendly checkbox; phones open games fullscreen and lock orientation to the game's shape | same, <https://itch.io/updates/better-support-for-mobile-html-games-more> |
| SharedArrayBuffer | Experimental option; moves the game to another domain, which loses existing saves; not needed | <https://itch.io/t/2025776/experimental-sharedarraybuffer-support> |
| Images | Cover 315×250 minimum, 630×500 recommended; screenshots any size, 3–5 recommended | <https://itch.io/docs/creators/getting-started> |
| AI | "Accurately tag your project if it contains materials produced by generative AI" | <https://itch.io/docs/creators/quality-guidelines> |
| Review | None for free HTML games; indexing needs a public page, a cover and a playable game | <https://itch.io/docs/creators/getting-indexed> |

**Still unclear after reading:**
- CrazyGames' exact upload format and form fields.
- Whether Poki's Versions tab takes a zip.
- GameDistribution's official thumbnail list, size limits and text limits.
- Whether itch shows an explicit orientation dropdown.
