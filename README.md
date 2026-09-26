# Blocky League

Chunky voxel football for the browser. It's 11-a-side and arcade-paced, in a Crossy-Road-style toy world, built with **TypeScript + Three.js + Vite** as a fully static build. There's no server and no accounts; progress lives in `localStorage`.

**Playtest:** [Play Blocky League](https://isharaf6.github.io/blocky-league/). Pushes to `main` run the gameplay/audio checks, build the web package, and deploy it through `.github/workflows/pages.yml`.

**Gameplay**
- Quick Match against the AI with 11 hand-made clubs and 4 difficulty levels (Easy → Legend), 1.5–4 minute halves.
- Instant assisted passing, sprint-and-pass one-twos, power shots, through balls, lobs and crosses, headers and buffered first-time finishes, player switching, pressing,
  standing and slide tackles, and a knock-on skill move (double-tap sprint).
- An on-pitch trainer is enabled by default, with contextual keyboard/gamepad/touch hints and a guide to the selected pass recipient. Disable it in **Pause → Settings → Controls**.
- Keepers dive, claim crosses, rush out and distribute. Fouls, free kicks with walls, penalties and yellow cards from an on-pitch referee.
- Corners and wide free kicks with loaded boxes, an aim arrow and a behind-the-ball camera.
- Half-time tactics: mentality (defensive / balanced / attacking) and up to three substitutions with fresh legs.
- Goal celebrations, TV-style instant replays, Man of the Match and player ratings.
- Day, sunset and floodlit night matches, rain and voxel snow, in front of an animated voxel crowd.

**Modes**
- **Career**: six divisions of eight clubs, promotion and relegation, transfers, training, kit designer and stadium upgrades.
- **Blocky Cup**: an 8-team knockout with a bracket, prize money, a trophy, and penalty shootouts (aim your kicks, dive with your keeper).
- **Daily gift** with a seven-day streak.

**Tech**
- Every sound is synthesised live with WebAudio, so there are no audio files.
- Quiet stereo rain patter and a subdued crowd bed; snow has no weather hiss. Ambience fades out on pause and in menus. Sound FX controls rain, and Crowd controls stadium ambience.
- Keyboard, gamepad and touch controls; landscape and portrait framing.
- Adaptive rendering quality (dynamic resolution, crowd density and shadow size follow the device).
- Portal builds zip to about 375 KB; the web build with PWA and sharing assets is about 535 KB.

**Monetisation** comes from an optional portal adapter for **CrazyGames** and **Poki**: midgame ads plus an opt-in rewarded ad that doubles your coins. See [`docs/PUBLISHING.md`](docs/PUBLISHING.md).

## Run it

Requires **Node.js 20.19+ or 22.12+** (Vite 8).

```bash
npm install
npm run dev          # http://localhost:5173 (also exposed on your LAN for phone testing)
```

URL parameters:

- `?quick`: skip the menus and start a match straight away. Dev server only.
- `?portal=crazygames` or `?portal=poki`: load that portal's SDK in the dev server (portal builds pick their SDK at build time).
  On localhost, CrazyGames runs in local mode, where fake ads appear as overlays.

## Test

```bash
npm test             # vitest: ball physics, match simulation, career rules
npm run typecheck    # tsc --noEmit
```

## Build and release

| Command | Output | For |
|---|---|---|
| `npm run build` | `dist/` | plain Vite build (no packaging) |
| `npm run build:web` | `dist-web/` + `release/blocky-league-web-v<ver>.zip` | your own site; includes the PWA manifest, icons, service worker, og image and privacy page |
| `npm run build:crazygames` | `dist-crazygames/` + zip | CrazyGames (`VITE_PORTAL=crazygames`) |
| `npm run build:poki` | `dist-poki/` + zip | Poki (`VITE_PORTAL=poki`) |
| `npm run build:itch` | `dist-itch/` + zip | itch.io (no ads, no PWA) |
| `npm run build:all` | all four | |
| `npm run assets` | `public/icons/*`, `public/og-image.png`, `release/store-assets/*` | regenerate icons and portal covers |

- **What `build:*` does:**
  - Type-checks first, then runs `scripts/release.mjs`.
  - Builds with a relative base (`./`), so the game runs from any sub-path.
  - Strips the web-only `<head>` block and files from portal and itch builds.
  - Writes `third-party-licenses.txt` into every build.
  - Zips the build with `index.html` at the root and re-verifies every zip entry.
  - Reports sizes and every external host the code references.
- **Social cards:** set `SITE_URL=https://your.domain` when building `web` to get absolute og/twitter image URLs.
- **Output location:** `dist-*/` and `release/` are build outputs (git-ignored).

The asset and release scripts have no dependencies beyond Node and Vite:

- **`scripts/gen-assets.mjs`** renders the voxel ball, players and goal with a small DDA ray caster. It draws the title in a hand-built 5×7 pixel font and writes PNGs through `node:zlib`.
- **`scripts/lib.mjs`** holds the CRC-32, PNG encoder and ZIP writer/verifier.

## Project structure

```
index.html              page shell (canvas + UI root); <head> holds PWA / social tags
public/                 static files copied into the web build (manifest, icons, sw.js, privacy.html, robots.txt)
scripts/                release tooling: gen-assets.mjs, release.mjs, lib.mjs
docs/                   PUBLISHING.md (portals, costs, checklists), STORE_LISTING.md (copy, tags, shot list)
tests/                  vitest suites (ball, match metrics, human control, career, cup, shootout, subs, voxel)
src/
  main.ts               boot, main loop, menu → match flow, rewards, ad hooks
  app.ts                AppContext / MatchRequest types shared by the UI modules
  audio/sfx.ts          WebAudio synth: crowd bed and reactions, whistle, kicks, woodwork, net, UI, chiptune loop
  core/                 input (keyboard/gamepad/touch), math helpers, seeded RNG, save (localStorage, versioned)
  game/                 matchSession (match ↔ renderer ↔ HUD glue: goals, celebrations, replays, half/full time), replay ring buffer
  meta/                 data (clubs, kits, player generation), career (divisions, fixtures, table, transfers, club state),
                        cup (knockout bracket, AI ties, prizes)
  platform/ads.ts       portal adapter: CrazyGames SDK v3 / Poki SDK v2 / none, fail-soft
  render/               Three.js world (renderer, sun, sky, time of day, quality), voxel mesher with AO, stadium and crowd,
                        voxel footballers and ball, referee, camera rig, match view, particles, weather, palette
  sim/                  deterministic fixed-step football simulation: match rules and restarts, ball physics,
                        players, team AI, keepers, pass/shot resolution, shootouts, formations, constants, types
  ui/                   HUD, menus (title, main, quick match, settings, pause, tactics, half/full time, gift, how to play),
                        touch controls, 3D kit previews, crests, career, My Club, cup and shootout HUD
  style.css             UI styles
```

## Controls

| Action | Keyboard | Gamepad |
|---|---|---|
| Move | WASD / arrows | left stick |
| Instant pass / switch player | Space | A |
| Pass and make a return run | Shift + Space | RT + A |
| Shoot (hold to power) / tackle (tap), slide (hold) | K | B |
| Through ball (tap) / lob-cross (hold) / press | L | X |
| Sprint (double-tap to knock it on) | Shift | RT |
| Pause | Esc / P | |

On touch screens there's a virtual stick on the left and action buttons on the right. Attacking labels stay visible while your pass is travelling.

**Instant Pass** is on by default for assisted ground passes: press once and the game chooses the weight. Semi/manual passing and turning Instant Pass off retain release-to-pass and hold-for-power controls. Hold Sprint while passing to send the passer on a return run. You can queue a first-time pass or shot before the ball arrives.

## Credits and licences

- **Fonts** (via [@fontsource](https://fontsource.org), both under the [SIL Open Font License 1.1](https://openfontlicense.org)):
  - **Lilita One** by Juan Montoreano.
  - **Silkscreen** by The Silkscreen Project Authors (Jason Kottke).
- **three.js** by the three.js authors, MIT licence.
- **Vite**, **Vitest**, **TypeScript**: build and test tooling, MIT / Apache-2.0. Not shipped to players.
- **Audio:** synthesised at runtime. No third-party sound files.
- **Art:** voxel models, icons and covers are generated by code in this repo.

The OFL and MIT licences require their notices to accompany redistributed copies. `scripts/release.mjs` writes those notices, taken from the installed packages, into `third-party-licenses.txt` in every build.

**Game code licence:** the repository doesn't yet include a `LICENSE` file, so all rights are reserved by the author by default. Add one before open-sourcing. Portal and store agreements (CrazyGames, Poki, app stores) need you to own, or have the rights to, everything in the build, and the dependencies above permit that.

Privacy: see [`public/privacy.html`](public/privacy.html). The game stores progress only in the browser's `localStorage`, has no accounts and no analytics of its own, and portal SDKs process data under their own policies.
