# Blocky League App Store assets

English artwork rendered from the current game's Three.js models, animations, UI, Silkscreen pixel font and SVG wordmark. No generated illustration, stock player, fabricated UI, device frame, award, rating or price appears in these exports.

## Upload map

| Placement | File or folder | Size | Notes |
| --- | --- | --- | --- |
| Header / universal creative | `creative/universal-5244x2950.png` | 5244 × 2950 | Preferred universal header asset; also accepted for search. |
| Dedicated wide header | `creative/header-3840x1646.png` | 3840 × 1646 | Alternative header composition. Upload one header, not both. |
| Dedicated search creative | `creative/search-3840x2560.png` | 3840 × 2560 | 3:2 search asset. |
| iPhone largest display | `screenshots/iphone-large/` | 2868 × 1320 | Five landscape screenshots in filename order. |
| iPhone medium display | `screenshots/iphone-medium/` | 2622 × 1206 | Five landscape screenshots for the display requested in App Store Connect. |
| iPad 13-inch display | `screenshots/ipad-13/` | 2752 × 2064 | Five landscape screenshots with the tablet layout. |

All upload PNGs are opaque RGB. `manifest.json` records exact dimensions, bytes, SHA-256 hashes, captions and capture viewports. `previews/` contains review contact sheets and must not be uploaded as screenshots. Open `index.html` to review individual full-size exports.

## Screenshot order

1. **Score screamers** — a goal detected by the match simulation, the game's knee-slide celebration, scorer plate and confetti.
2. **Pass and move** — open play with the real floating touch stick, teammate indicators and current attack controls.
3. **Blitz power ups** — the Blitz match mode with a held Mega Shot and a valid Turbo pickup rendered by the game.
4. **Road to Glory** — the real career hub, league table and next fixture for a freshly created Blocky Athletic club.
5. **Bend it** — the shooting free-kick camera, wall, reticle and native touch instructions.

Captions use the game's Silkscreen Bold glyphs on an integer pixel grid, cream and yellow over the game's sky colour. The app view below the caption is captured at its native output resolution, without stretching. Both iPhone career screenshots use a thinner 96-pixel caption band to give the actual hub enough height for its fixture reward line. Scenes are staged deterministically using existing development hooks so each feature is easy to read.

| Capture | Caption band | Pixel glyph cell | Game viewport in CSS pixels | Pixel density |
| --- | --- | --- | --- | --- |
| iPhone medium, shots 01–03 and 05 | 144 px | 16 px | 874 × 354 | 3× |
| iPhone medium, career shot 04 | 96 px | 12 px | 874 × 370 | 3× |
| iPhone large, shots 01–03 and 05 | 156 px | 16 px | 956 × 388 | 3× |
| iPhone large, career shot 04 | 96 px | 12 px | 956 × 408 | 3× |
| iPad 13-inch, all shots | 216 px | 24 px | 1376 × 924 | 2× |

## Capture context

Screenshots are **Chromium touch-device emulations of the current game**, not photographs or captures from an installed iOS build. They reproduce the landscape touch layout and safe-area insets. A caption occupies the top band, so the game viewport itself is shorter than a full-screen device viewport. Verify the corresponding screens on the uploaded TestFlight build before public release; Safari/WebKit rendering and device performance may differ.

Creative assets are **promotional compositions** from the game's own models and poses. They use an editorial camera, staged striker/keeper/ball positions, a modest character fill, hidden gameplay markers and removed corner lighting masts to keep the wordmark clear. These three images are separate from the screenshot set and must not be labelled gameplay screenshots.

## Reproduce

Source: `scripts/capture-app-store.mjs`. It requires Node, the project dependencies, Playwright and Sharp, plus Playwright Chromium. If those packages are already resolvable from the project:

```sh
npx playwright install chromium
node scripts/capture-app-store.mjs
```

For isolated tooling without changing the project's frozen release dependencies:

```sh
npm install --prefix /tmp/blocky-art-tools --no-save playwright sharp
node /tmp/blocky-art-tools/node_modules/playwright/cli.js install chromium
BLOCKY_ART_NODE_MODULES=/tmp/blocky-art-tools/node_modules node scripts/capture-app-store.mjs
```

The script starts a Vite server on port 4192. To use an existing server, set `BLOCKY_ART_URL=http://127.0.0.1:4192`. An alternate browser cache can be selected with `PLAYWRIGHT_BROWSERS_PATH`. `--creative-only` and `--screenshots-only` refresh that subset while preserving the other subset's manifest entries. `--screenshots-only --shot=04-road-to-glory` refreshes one scene across all devices; add `--device=iphone-medium` to refresh only that device. Contact sheets are rebuilt and every retained file's dimensions, alpha and hash are rechecked. A full run refreshes all exports and contact sheets.

The script waits for completed startup, freezes the simulation, finishes CSS transitions for capture and checks that the career screenshot has its actual hub, no match HUD and an unclipped fixture reward line. Free-kick instructions are checked for touch labels. The final manifest is written only after a successful run.

## Apple references

- [Creative asset specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications)
- [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications)
- [Asset best practices](https://developer.apple.com/app-store/asset-best-practices/)

These exports prepare the product page. They do not themselves submit an App Store release or start a product page optimization experiment.
