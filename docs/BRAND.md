# Blocky League brand and store art

The logo, the icons, the portal covers and the app store screenshots for Blocky League (a Calynx game). This file
covers the design, the palette, every file (where it is, its size, and the rule it meets) and each platform's
rules, with the page each rule came from and the date it was read.

**No iOS or Android app exists yet.** Capacitor comes later. Until then the App Store and Google Play files here
(icons, feature graphic, screenshots) are ready ahead of time. They are not uploaded anywhere. The screenshots
are of the web game in a phone or tablet touch emulation, not of a native build. Re-shoot them from the Capacitor
build if its layout ends up different (safe areas, the notch, the status bar).

## The design

The art style is Crossy Road's: chunky voxels, flat saturated colours, hard shadows, no gradients on the objects.

- **The mark.** The game's own voxel football sits on a small square of pitch with one white touchline, and casts
  a hard sun shadow on the grass. It is drawn as an orthographic three-quarter view with the renderer's face tints
  (top 1.0, sides 0.9). The ball uses the game's algorithm (`buildBallGeometry` in `src/render/characters.ts`: a
  sphere on a voxel grid with twelve icosahedron patches) on a 16³ grid, so the pentagons read at icon size.
- **The wordmark.** "BLOCKY" in cream over "LEAGUE" in yellow. It uses Silkscreen Bold's own pixel grid (the glyph
  bitmaps were read back from the game's font), with a dark outline and a chunky drop, like the title screen.
- **The lockups.** Stacked (mark above the wordmark), horizontal (mark left, wordmark right), and the mark alone.
- **One source.** Everything is crisp SVG built in `src/ui/gameLogo.ts` (`logoSvg`, `wordmarkSvg`, `markSvg`). It
  has no font dependency. The in-game title (`src/ui/menus.ts` `title()`) and every store file come from these same
  functions. The title passes `markOutline: 0.25`: an ink outline round the mark's silhouette, as thick as the
  wordmark's, because there the pitch tile sits on the game's own green pitch and would otherwise melt into it.
  Store art on sky leaves the outline off.
- **Pixel-exact type.** The wordmark always starts on a whole cell of the lockup. Store art sizes the lockup at a
  whole multiple of 4 px per cell, so every letter edge lands on a pixel.

### Palette

| Token | Hex | Use |
|---|---|---|
| `LOGO_INK` | `#26262e` | Outline, drop, the ball's patches, caption shadow |
| `LOGO_CREAM` | `#fbfbf4` | "BLOCKY", the touchline, caption words |
| `LOGO_YELLOW` | `#ffd23a` | "LEAGUE", a caption's last word |
| `LOGO_SKY` | `#5cc8f5` | Icon background, caption strip, the game's `theme-color` |
| Grass A / B | `#a2d65c` / `#88c247` | The mown stripes of the pitch tile |
| Ball | `#fbfbf6` / `#26262e` | Panels / patches (the game's classic ball) |

### Rules

- Keep the mark and the wordmark together in the lockups. The icons use the mark alone, and the covers and
  thumbnails the wordmark alone (see below).
- Put the logo on sky, on the game's own scenes (over the stands or the sky), or on transparent. Never put a flat
  dark band behind it; its own drop and outline give it the contrast.
- No taglines on the covers. Screenshot captions are three words or fewer, in the game's pixel type, with no dot or
  dash separators.

## Files

Every store and portal file is in the tracked `store-assets/` folder. Web icons are in `public/`. All were checked
with a Python PNG header read on 29 and 30 Sep 2026 (the wide covers re-checked on 30 Sep): exact size, colour type (2 = RGB, 6 = RGBA), bit depth 8, file size.
The icon safe zones were measured from the pixels (the content's bounding box or its radius over the flat sky).

### Logo (`store-assets/logo/`)

| File | Size | Notes |
|---|---|---|
| `blocky-league-logo-stacked.png` / `.svg` | 1296×1096 RGBA, 42.5 KB / 62.6 KB | Transparent; 32 px per cell |
| `blocky-league-logo-horizontal.png` / `.svg` | 1904×424 RGBA, 29.3 KB / 62.6 KB | Transparent; 32 px per cell |
| `blocky-league-wordmark.png` / `.svg` | 1296×424 RGBA, 3.7 KB / 21.4 KB | Transparent |
| `blocky-league-mark.png` / `.svg` | 1291×1024 RGBA, 49.7 KB / 41.2 KB | Transparent |
| `blocky-league-logo-stacked-on-sky-1600x1600.png` | 1600×1600 RGB, 49.1 KB | On `#5cc8f5` |
| `blocky-league-logo-horizontal-on-sky-2400x800.png` | 2400×800 RGB, 39.5 KB | On `#5cc8f5` |
| `blocky-league-mark-on-sky-1024.png` | 1024×1024 RGB, 38.7 KB | On `#5cc8f5` |
| `../blocky-league-logo-1200x630.png` | 1200×630 RGB, 249.3 KB | Master logo card: the full horizontal lockup (16 px per cell) over the wide cover scene |

The SVGs are standalone (`xmlns`, a `viewBox`, `role="img"`) and scale to any size.

### Icons

| File | Size | Spec met |
|---|---|---|
| `store-assets/ios-app-icon-1024.png` | 1024×1024, colour type 2 (RGB, no alpha), 38.5 KB | Apple: 1024×1024, square corners (the system masks them), opaque. The mark fills the central 84%, with even margins: left 82, right 81, top 171 and bottom 170 px |
| `store-assets/google-play-icon-512.png` | 512×512, colour type 6 (32-bit RGBA, every pixel opaque), 13.8 KB | Play: 512×512, 32-bit PNG, 1024 KB or less, full-bleed square (Play applies the mask and shadow). The whole mark sits inside the central 66%: content from 87 to 424 px, margins 87 px each side |
| `public/icons/icon-192.png`, `icon-512.png` | 192², 512² RGB | PWA "any" icons: the mark in the central 84% |
| `public/icons/maskable-192.png`, `maskable-512.png` | 192², 512² RGB | PWA "maskable": the farthest mark pixel is 0.386 to 0.388 of the side from the centre, inside the 0.40 safe circle |
| `public/apple-touch-icon.png` | 180×180 RGB | iOS home screen (web): mark in the central 84% |
| `public/favicon.ico` (16, 32, 48) and `favicon-16/32/48.png` | RGBA, transparent | The mark itself (the voxel ball on its pitch tile, `store-assets/logo/blocky-league-mark.png`), squared and area-averaged down, as the owner asked (30 Sep 2026) |

`index.html` links `favicon.ico`, `favicon-32.png` and `favicon-16.png` (the old inline data-URI icon is gone).
It also links `apple-touch-icon.png` and `manifest.webmanifest`. The manifest points at the four `icons/` files.
All of these paths are unchanged. Vite rewrites them to `./` paths in every build. The favicons sit outside the
web-only block, so the portal zips carry them too (four files, 1.2 KB).

### Covers and thumbnails (`store-assets/`)

The whole family is one real in-game moment. The striker has just struck it and is held in his follow-through.
The keeper is at full stretch. One crisp ball sits just past his glove, flying into the top corner with the net
behind it. The main stand, the end stand's crowd and the sky fill the back, with pitch stripes below.

How it was staged on the dev snapshot:

- Players were placed through the dev hooks, with a seeded random.
- The shot was given a little more lift, and the keeper's dive follows it.
- The sim was stepped frame by frame. The game renders it.

Every size was framed from that same frozen instant, with a camera solved for its aspect, and captured at its exact
pixel size (DPR 1, the WebGL canvas supersampled 2× to 4× inside it, never upscaled). There are two viewpoints:

- **Wide sizes** (16:9, 2:1, 1.9:1, 2.3:1) use a low, close camera (0.6 m up, 44° lens) in front of the striker, so
  the characters stay readable when a portal shrinks the cover to a 360 px tile. The striker stands in the left
  foreground at about half the frame height, turned to the lens in three-quarter view with his kicking leg through.
  The keeper dives at full stretch on the right, and the ball (about 6% of the frame height) is just past his glove
  in the top corner. The wordmark sits in the sky above the end stand, and very little grass shows. For this view
  only, the drawn striker is moved to 7 m from goal and turned to face the lens, and the drawn keeper is shifted
  0.8 m along the line so his glove falls just short of the ball. The sim is untouched. Every wide cover was checked
  shrunk to 360 px wide (`sips -Z 360`): the striker's face, the keeper and the ball all read.
- **Square, 4:3 and portrait sizes** use an over-the-shoulder view: the striker in front, the goal and keeper filling
  the middle, the wordmark over the stand.

Taken out for key art only: the HUD and markers, every particle (the ball trail, the dive dust, grass flecks), the
right-end scoreboard, the four floodlight masts and the crouched pitchside photographers. The masts crossed the
wordmark, and the photographers read as cut-off players. The drawn ball is also lifted 0.42 m from its simulated
spot (it stays under the bar), so it clears the keeper's head in every view.

**Every cover carries the wordmark only** (the game's title in pixel type), with no mark tile. That meets
CrazyGames' title-only rule, and it keeps the feature graphic and key art free of a pasted-on tile.

| File | Size | Title | Spec met |
|---|---|---|---|
| `crazygames-landscape-1920x1080.png` | 1920×1080 RGB, 446.6 KB | Wordmark | CrazyGames 16:9; the title is the only text; no icons, logos or borders |
| `crazygames-portrait-800x1200.png` | 800×1200 RGB, 176.3 KB | Wordmark | CrazyGames 2:3 (same rules); the action fills the middle, the title overlaps the stand |
| `crazygames-square-800x800.png` | 800×800 RGB, 129.6 KB | Wordmark | CrazyGames 1:1 (same rules) |
| `poki-thumbnail-1024x1024.png` | 1024×1024 RGB, 194.3 KB | None | Poki: full-bleed square of 628 px or more, no text, a key gameplay moment filling the frame |
| `google-play-feature-1024x500.png` | 1024×500 RGB (24-bit, no alpha), 134.4 KB | Wordmark | Play feature graphic 1024×500, JPEG or 24-bit PNG, no alpha |
| `ios-product-page-1200x630.png` | 1200×630 RGB, 237.2 KB | Wordmark | Product page and social card |
| `keyart-1920x1080.png` | 1920×1080 RGB, 446.6 KB | Wordmark | Key art (the same image as the CrazyGames landscape) |
| `itch-cover-630x500.png` | 630×500 RGB, 85.9 KB | Wordmark | itch.io cover 630×500 |
| `gamedistribution-512x512.png`, `-512x384.png`, `-200x120.png` | RGB, 85.1 / 59.9 / 20.2 KB | Wordmark | GameDistribution's mandatory thumbnails |
| `gamedistribution-1280x720.png`, `-1280x550.png` | RGB, 267.0 / 228.2 KB | Wordmark | GameDistribution's optional banners |
| `public/og-image.png` | 1200×630 RGB, 237.2 KB | Wordmark | `og:image` / `twitter:image` (same file as the product page) |

The in-world sponsor boards (calynx, CUBE COLA, HOP HOP, VOXEL BANK) are part of the scene.

### App store screenshots (`store-assets/screenshots/`)

All screenshots are real gameplay from the dev snapshot, in a touch-device emulation: a coarse pointer, touch
events and a mobile user agent, so the on-screen stick and buttons show. Each one uses the device's CSS size and
pixel ratio, and the WebGL canvas is forced to the full ratio (no upscaled 3D). There are no dev overlays and no
cursor, and the onboarding trainer card is hidden. The commentary ticker is off (the player's own Settings
switch), so no line crosses the HUD's banners.

A sky strip at the top (10% of the height; 272 px on the iPad) carries a caption in the game's Silkscreen type:
cream words, the last word in yellow, an ink outline, and an ink edge under the strip. Captions are three words or
fewer, with no hyphens, dashes or dots. The game area below the strip is the captured frame, placed 1:1.

The moments:

- **Title.** The live title screen with the Calynx credit.
- **Pass.** Our forward is placed on the ball in their half, team-mates spread ahead. The pass-preview ring sits
  under the man a pass would find.
- **Goal.** A goal, then the scorer's knee slide on the game's own celebration camera, dollied in along its line to
  him. He is big in the lower half, with GOAL!, his name tag, the confetti and the goal behind.
- **Blitz.** Our side is given a MEGA SHOT (the HUD slot and the power button lit), and a turbo cube glows on the
  pitch.
- **Market.** The transfer market of a career club.
- **Full time.** A real match: two 2-minute halves played out by the sim with the AI running both sides (a stronger
  AI for ours). The seed was chosen so we win by two or more with a clean sheet, which gives three stars. Every stat
  on the screen was played, for example 12 shots, 8 on target, 51 passes and 7 tackles on the iPad. The save sits
  mid-level, so no LEVEL UP toast crosses the XP bar. The screen's own count-ups had finished before the capture.

| Folder | Size | Shots |
|---|---|---|
| `ios-6.9/` | 1320×2868 RGB (CSS 440×956 at 3×) | `01-title` "VOXEL FOOTBALL", `02-pass` "PASS AND MOVE", `03-goal` "SCORE SCREAMERS", `04-blitz` "BLITZ POWER UPS", `05-market` "BUILD YOUR CLUB" |
| `ios-6.5/` | 1284×2778 RGB (428×926 at 3×) | The same five |
| `play-phone/` | 1080×1920 RGB (432×768 at 2.5×) | The same five |
| `ipad-13/` | 2064×2752 RGB (1032×1376 at 2×; the full-time card at 903 CSS px wide at 16/7×, so it fills the frame) | `01-goal`, `02-blitz`, `03-fulltime` "EARN EVERY STAR": YOU WIN! 3:0, three stars, XP, man of the match, the stats |
| `play-tablet-7/` | 1200×1920 RGB (600×960 at 2×) | `01-pass`, `02-goal`, `03-blitz`, `04-fulltime` (YOU WIN! 2:0): four shots, Google's tablet minimum |

The title screen with the new lockup was checked at 1280×720, 375×667 and 667×375 (the landscape phone uses the
horizontal lockup): no overflow, and the letter edges are crisp.

The Play phone set is 432 CSS px wide at 2.5×. At 360 CSS px wide, the game's GOAL! banner touches the clock pill
(a HUD layout issue at that width, noted but not changed here).

## How the files are made, and `npm run assets`

The designed files are rendered from the game itself. Two things render them:

- a small Vite page that imports `src/ui/gameLogo.ts` and composes an exact-size stage (logo layers, captions,
  captured frames placed 1:1);
- the dev snapshot build (`vite build --mode development`, served by the `blocky-snap` launch config on :4180),
  driven through its dev hooks (`?quick=1`, `?quick=1&blitz=1`, `window.__bl.step`, `__bl.key`, `__bl.session`,
  `__bl.app`) with the render loop frozen. Players are placed, the camera is posed, and one headless Chrome captures
  the page (`Page.setDeviceMetricsOverride` to the asset size, then `captureScreenshot`).

That capture tooling ran from a session scratch folder. It is **not in the repo**. Redoing the art means rebuilding
it with the method above.

`scripts/gen-assets.mjs` (`npm run assets`) is only a procedural fallback, a tiny voxel ray caster, and **it never
overwrites the designed files.** Each output (`public/icons/*`, `public/apple-touch-icon.png`,
`public/og-image.png`, `store-assets/*.png`) is written only if that file does not exist yet. An existing file is
reported as "kept" and left alone. `node scripts/gen-assets.mjs --out <dir>` writes every fallback under `<dir>`
instead and touches nothing in the repo.

`npm run submission` copies the covers and thumbnails from `store-assets/` into `release/submission/<portal>/`
and checks their sizes. That includes GameDistribution's two optional banners, which it used to take from
`release/submission/media/extra-sizes/`.

## Platform rules (sources and dates read)

| Platform | Rule | Source (read 29 Sep 2026) |
|---|---|---|
| Apple app icon | 1024×1024 layout. Square: "the system applies masking to produce rounded corners". Background "full-bleed and opaque". "Keep primary content centered to avoid truncation" | <https://developer.apple.com/design/human-interface-guidelines/app-icons> (read through its JSON: `developer.apple.com/tutorials/data/design/human-interface-guidelines/app-icons.json`) |
| Apple screenshots | 6.9": 1260×2736, 1290×2796 or 1320×2868 (portrait). 6.5": 1284×2778 or 1242×2688. iPad 13": 2064×2752 or 2048×2732. 1 to 10 per set; .png, .jpg or .jpeg; RGB with no alpha. 6.5" is required for iPhone apps unless 6.9" is provided; 13" is required if the app runs on iPad | <https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications> |
| Google Play icon | 512×512, 32-bit PNG, sRGB, 1024 KB or less, full square. Play applies the corner mask (30% radius) and the shadow; avoid transparency; keylines are guidelines | <https://developer.android.com/distribute/google-play/resources/icon-design-specifications> |
| Google Play feature graphic and screenshots | Feature graphic: 1024×500, JPEG or 24-bit PNG, no alpha. Screenshots: JPEG or 24-bit PNG, no alpha, 320 to 3840 px, the long side no more than twice the short side, at least 2 (up to 8 per device type). Phone: 1080 px minimum recommended, 9:16 portrait. Tablets: at least 4 screenshots, 1080 to 7680 px, 16:9 or 9:16 | <https://support.google.com/googleplay/android-developer/answer/9866151> |
| CrazyGames covers | 16:9 1920×1080, 2:3 800×1200, 1:1 800×800. "Don't write anything else other than your game's title". "Don't put icons or store logos in the visuals". No borders; nothing blurry or pixelated | <https://docs.crazygames.com/requirements/game-covers/> |
| Poki thumbnail | Full-bleed square, at least 628×628; avoid text and titles; no borders or padding; show the main character and a key gameplay element; avoid colours close to #83FFE7 | <https://developers.poki.com/guide/game-thumbnail> |
| GameDistribution | 512×512, 512×384 and 200×120 mandatory; 1280×720 and 1280×550 optional. From a search summary: the official guide could not be read (see docs/SUBMIT.md) | <https://static.gamedistribution.com/developer/developers-guidelines.html> |

### Open points

- **Play tablet aspect.** Google's help page asks for tablet screenshots in **16:9 or 9:16**. The `play-tablet-7/`
  set is 1200×1920 (10:16), as requested. It passes the general 2:1 rule and the 1080 to 7680 px range, but it is
  not exactly 9:16. If Play Console refuses it, shoot the same four moments at 1080×1920.
- **Covers carry no mark.** Every cover uses the wordmark alone. CrazyGames says no icons in the visuals (the mark
  is the game's icon), and on the wide art the mark tile looked pasted on. The full lockups stay in `logo/`.
- **The covers' ball.** The drawn ball is lifted 0.42 m from its simulated spot, so that it clears the keeper in
  every view. The sim itself is untouched.
- **Native builds.** Every App Store and Google Play screenshot shows the web build (see the top of this file).
