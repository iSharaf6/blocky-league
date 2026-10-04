# Blocky League

by Calynx, Islam Sharaf

Chunky voxel football for the browser. It's 11-a-side and arcade-paced, in a Crossy-Road-style toy world, built with **TypeScript + Three.js + Vite** as a fully static build. Progress lives in `localStorage` (Settings › Backup exports and imports it as a file); signing in is optional, for cloud saves (Supabase, see [`docs/CLOUD.md`](docs/CLOUD.md)), and the ACCOUNT button only appears in builds with a backend configured.

**Playtest:** [Play Blocky League](https://isharaf6.github.io/blocky-league/). Pushes to `main` run the gameplay/audio checks, build the web package, and deploy it through `.github/workflows/pages.yml`.

**Gameplay**
- **Learn the basics:** a first visit starts with three short staged drills (pass in a 2 v 1, an open shot, a cross to a runner), one prompt at a time, replayed until done (no fail state). Then the first match; the player's first goal unlocks Career, Moments, Club Run and Blitz. On a portal build, TAP TO PLAY goes straight into the first drill.
- Quick Match against the AI with 11 hand-made clubs and 4 difficulty levels (Easy to Legend), 1.5 to 4 minute halves.
- **Play Now** goes straight to kick-off. The first match waits for input while the AI eases into the game.
- **Continue your match:** leaving the app saves the minute, ball, players, substitutions and competition. Reopening offers the paused match at the same attack; periodic checkpoints also protect against an unexpected shutdown. Online matches are excluded, and results cannot be paid twice.
- A hidden ease (`src/core/dda.ts`) softens the AI for the first two matches and after three defeats in a row (career, or quick match at one difficulty, which also suggests Easy). It is described honestly in `docs/PUBLISHING.md`.
- Instant assisted passing, one-twos, power shots, through balls, lobs and crosses, headers and buffered first-time finishes, player switching, pressing,
  standing and slide tackles, automatic sprinting and contextual skill moves. On touch, pushing the stick sprints; a lighter push jogs.
- An on-pitch trainer is enabled by default, with contextual keyboard/gamepad/touch hints and a guide to the selected pass recipient. Disable it in **Pause → Settings → Controls**.
- Keepers dive, claim crosses, rush out and distribute. You can move your keeper with the ball in his hands or at his feet, and hold KEEPER to bring him out while defending.
- Fouls, penalties and yellow cards from an on-pitch referee. Direct free kicks use a goal reticle; corners and wide free kicks use a landing ring for the delivery.
- Half-time tactics: mentality (defensive / balanced / attacking) and up to five substitutions with fresh legs and a short scene for each change. Controls, settings and quit or forfeit are available at half time.
- Short, skippable match scenes: teammates chat and wave on their halftime tunnel walk, return for the second half, celebrate wins or argue before the captain settles them, then shake hands. Man of the Match receives an award with teammates applauding; booked foul victims add a comic injury reaction.
- Goal celebrations, TV-style instant replays, Man of the Match and player ratings, and a text commentary ticker (no spoken commentary).
- Goal clips: where the browser can record the canvas, SAVE CLIP and SHARE on the full-time screen and the pause menu.
- Day, sunset and floodlit night matches with clear skies, overcast, drizzle, rain, snow or blizzard. Snow settles from kickoff; marked rain puddles can cause a short skid on a sharp sprint turn. Net ripples follow the struck panel with seams fixed to the goal frame.
- Nineteen crowd chant patterns with rounded choir voices, major-key refrains, visible chant captions and rotating post-goal songs. In the iOS app, FULL vibration acknowledges every gameplay action button as it is pressed, alongside stronger contact feedback.

**Modes**
- **Road to Glory**: eight divisions of eight clubs, 14-matchday home-and-away seasons, promotion and relegation, transfers, training focuses, player growth, mentors, morale, staff, scouting and story decisions. Design your crest and kit, build your ground and earn a lasting club legacy.
- **Blocky Cup**: an 8-team knockout with a bracket, prize money, a trophy, and penalty shootouts (aim your kicks, dive with your keeper).
- **Football Moments**: eight challenges lasting 15 to 90 seconds of play, with retries, three-star best scores and an unlock ladder. Attempts earn XP without changing coins or the full-match record.
- **Club Run**: seven short matches against a ladder of stronger clubs, one life, a perk after every win.
- **Badges and Journeys**: five skill tracks with eight mastery tiers, earned cosmetic looks and titles worn in the match broadcast. Twelve permanent 30-tier Club Journeys save independent progress and optional Club Pass ownership; select one to advance, with no expiry or monthly reset.
- **Unlocks**: view the level requirements for ball skins, celebrations and Legend difficulty from the main menu's level badge.
- **Daily gift** with a seven-day calendar that keeps your place when you miss a day.
- **Club identity:** coins buy ordinary cosmetics, gems buy guaranteed six-piece signature collections, and earned Scout Tickets open player scouting packs. The Club Pass adds a permanent themed stadium ceremony immediately, then a player look, trail, kit, goal effect and diamond nets through its tiers. All twelve themes remain available for gems, with a discount for pieces already owned; these identities change appearance only.
- **Transfer window:** league matchdays refresh listings. Transfer news uses dated cards with unread notices that clear when the News tab is opened.

**Tech**
- Every sound is synthesised live with WebAudio, so there are no audio files.
- Quiet stereo rain patter and a subdued crowd bed; snow has no weather hiss. Ambience fades out on pause and in menus. Sound FX controls rain, and Crowd controls stadium ambience.
- Keyboard, gamepad and touch controls; landscape and portrait framing. Every key and gamepad button can be rebound (Settings › Keys, with swaps on a conflict and RESET), the touch stick can float or stay fixed, and a colour-blind option adds shape cues. Every key hint on screen follows the bindings.
- Adaptive rendering quality (dynamic resolution, crowd density and shadow size follow the device). Framebuffer pixel and GPU dimension budgets cover phone, tablet and large desktop screens; HTML UI keeps its native text resolution.
- Portal builds zip to about 776 KB; the web build with PWA, accounts and sharing assets is about 1.14 MB.

**Monetisation** comes from an optional portal adapter for **CrazyGames** and **Poki**: ads before later kick-offs (after at least eight seconds with the results), plus an opt-in rewarded ad that doubles your coins. See [`docs/PUBLISHING.md`](docs/PUBLISHING.md).

## Run it

Requires **Node.js 20.19+ or 22.12+** (Vite 8).

```bash
npm install
npm run dev          # http://localhost:5173 (also exposed on your LAN for phone testing)
```

URL parameters:

- `?quick`: skip the menus and start a match straight away. Dev server only.
- `?portal=crazygames` or `?portal=poki`: load that portal's SDK in the dev server (portal builds pick their SDK at build time), and behave like a portal build (a first visit goes straight into the first basics drill).
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
| `npm run assets` | only MISSING files in `public/icons/*`, `public/og-image.png`, `store-assets/*` | procedural placeholders; never overwrites the designed art (docs/BRAND.md) |

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
  boot.ts / boot.css    small loading entry, intact studio art and reload recovery for startup failures
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
| Sprint automatically (push the stick); manual sprint override | Shift | RT |
| Contextual skill / keeper rush while defending | Q | LB |
| Pause | Esc / P | Start |

These are the defaults; everything can be rebound in Settings › Keys. On touch screens there's a virtual stick on the left and action buttons on the right. Attacking labels stay visible while your pass is travelling.

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

Privacy: see [`public/privacy.html`](public/privacy.html). The game stores progress in the browser's `localStorage`; if a player chooses to sign in, the save JSON alone is also kept in the cloud, only while signed in (what the sign-in itself stores is listed in [`docs/CLOUD.md`](docs/CLOUD.md)). No analytics of its own; portal SDKs process data under their own policies.
