# Store listing: Blocky League

Copy for CrazyGames, Poki, GameDistribution, itch.io and your own site. Paste as-is, or trim to each field's limit. Character counts are noted where a portal enforces a limit.

> **Keep it honest.** Everything below is in the v1 build (checked 29 Sep 2026). If a feature is cut before you upload, delete its line. Two things are browser-dependent and are worded that way: goal clips (recorded only where the browser supports canvas recording) and cloud saves (web build only, and only once the owner has set up the backend: `docs/CLOUD.md`). Neither is mentioned in the portal copy.
>
> **Keep build-specific features out of shared copy.** Online friendlies are included in the own-site web and itch builds, and omitted from CrazyGames and Poki. The shared descriptions below focus on single-player modes so they can be reused across those builds. External account/cloud saves are own-site-only. Commentary is **text only**: the spoken voice was removed, so never write "voiced" or "spoken" commentary.
>
> `npm run submission` reads this file to write each portal's `listing.txt` (`release/submission/<portal>/`). Keep the headings as they are; the script stops with an error if one goes missing.

**CrazyGames release notes (2 Oct 2026):** submit the CrazyGames build for Basic Launch first. Ads are disabled during Basic Launch; an unavailable 2× reward leaves the normal reward intact and never blocks playing. Full Launch and monetization require CrazyGames' approval. Enable **Automatic Progress Save** in the dashboard and test it with a signed-in player before Full Launch; avoid claiming cross-device saves in listing copy until that check passes. The existing local demo ads are only SDK tests.

---

## Apple App Store and TestFlight

Native iPhone/iPad launch copy is in [store-assets/app-store/metadata](../store-assets/app-store/metadata/README.md): English (Australia) and English (US), with validated name, subtitle, keyword, promotional-text and description limits. TestFlight beta description and What to Test copy are alongside them. [APP_STORE.md](APP_STORE.md) shows the AU listing and native setup details.

Keep the portal copy below specific to browser builds. The native listing covers offline single-player modes, touch controls and controllers; its public copy excludes online friendlies, downloadable clips and pending Game Center availability.

## Title

**Blocky League**

## Developer

**Calynx** (Islam Sharaf). Use "Calynx" in the developer / studio field; the game's name and short name stay "Blocky League" (the PWA manifest keeps them too). Credit line for pages that want one: _Blocky League, a Calynx game, by Islam Sharaf._

## Tagline

Portal "short description" or "subtitle" fields.

- Chunky voxel football. Big goals. _(33 chars)_
- Voxel football with screamers, slide tackles and instant replays. _(65 chars)_

## Short description

For fields of up to about 160 characters.

> Chunky voxel football in your browser. Learn it in a minute, then take on Career, Club Run, Moments and Blitz power-ups. Keyboard, gamepad and touch.

_(149 chars)_

## Long description

> **Skill past defenders. Smash screamers. Win the league.** Blocky League is fast, chunky voxel football you can play right in your browser.
>
> Take a defender on and watch his head. When a big **!** pops up, hit SKILL and leave him on the floor. Chain your tricks and score a **SKILL GOAL**!
>
> - Pull off roulettes, rainbow flicks and stepovers
> - Smash screamers, whip in crosses and bang in volleys
> - **Road to Glory:** build your own club and climb from Park League to the top
> - **Blocky Cup:** knockout ties and tense penalty shootouts
> - **Club Run:** seven matches, one life, a new perk after every win
> - **Moments:** quick challenges to earn three stars
> - **Blitz:** crazy power ups like Mega Shot, Freeze and Turbo
> - Win coins and unlock celebrations, new balls, goal explosions and new players
> - Daily challenges, win streaks and levels to climb
>
> New to it? Three quick drills teach you to pass, shoot and cross in under a minute.
>
> Play with keyboard, controller or touch. Lace up and kick off now!

## GameDistribution fields (200–500 characters each)

**Description:**

> Chunky voxel football in your browser. Learn the basics in three quick drills, then pick one of eleven clubs and take on the AI from Easy to Legend. Build a club in Career, survive seven matches in Club Run, chase stars in Moments, or grab power-ups in Blitz mode. Pass, power up screamers, float crosses and slide-tackle. Level up, earn mastery badges and beat three daily challenges. Every goal gets a celebration and an instant replay.

_(438 chars)_

**Instructions:**

> Move with WASD or the arrow keys. Space passes (aim with the stick), hold and release K to shoot, tap L for a through ball or hold L to lob or cross, and hold Shift to sprint. Defending: Space switches player, K tackles, hold L to press. E uses a Blitz power-up. Esc pauses. Gamepad: A pass, B shoot, X through ball, Y power-up, RT sprint. Touch: stick on the left, buttons on the right. Change any key in Settings.

_(415 chars)_

**Genres (1–2):** Sports, Arcade. **Tags (1–5):** football, soccer, 3d, sports, arcade

---

## Controls text

The same controls, laid out for the pages that have a dedicated controls field. They are the defaults: players can rebind every key and gamepad button in **Settings › Keys**.

```
KEYBOARD
  Move                WASD or the arrow keys
  Pass                Space (aim with the stick)
  Shoot               Hold and release K
  Through ball        Tap L  |  lob or cross: hold L
  Sprint              Shift
  Defend              Space switches player  |  K tackles (tap while sprinting, or hold: slide)  |  hold L to press
  Skill move          Q  (when the ! shows over a defender: PERFECT)
  Quick sub           B  (when the sub card shows)
  Power-up (Blitz)    E
  Pause               Esc or P

GAMEPAD   A pass  |  B shoot  |  X through ball  |  LB skill  |  Y power-up  |  RT sprint  |  Start pause
TOUCH     Stick on the left (floating or fixed: Settings › Controls), buttons on the right, SKILL with the ball, POWER in Blitz
TIP       Press SHOOT just before a pass or cross reaches you for a first-time finish
```

The same text appears in-game under **How to play** (`src/ui/menus.ts`), which always shows the player's own bindings. If the defaults change, update both places.

---

## Tags and categories

Each portal has its own taxonomy, so pick from their list when you submit. These are the closest matches:

| Platform | Category | Tags |
|---|---|---|
| CrazyGames | Sports, Soccer / Football | football, soccer, 3d, voxel, arcade, 1 player, mobile |
| Poki | Sports, Soccer | football, soccer, 3D, blocky, arcade |
| GameDistribution | Sports, Arcade | football, soccer, 3d, sports, arcade |
| itch.io | Genre: Sports. Made with: Three.js | football, soccer, voxel, low-poly, 3d, arcade, browser, singleplayer, multiplayer |

**Age / content:** no violence beyond slide tackles, no chat, no purchases, no accounts, no outgoing links. The only text a player can type is a club name and a three-letter code, both run through a profanity filter and never shown to other players. Progression (XP, levels, badges, the season track, stars, streaks, daily challenges) is earned by playing only. Progress is saved in the browser (and on CrazyGames in the player's CrazyGames account, through the SDK's Data Module); the game itself collects no personal data. Suitable for all ages. This meets CrazyGames' PEGI-12 requirement.

_(Use this content paragraph for CrazyGames and Poki. It describes their single-player builds. The own-site web and itch online mode uses manual connection codes and can show club details to the opponent; use the itch-specific paragraph below for that build.)_

**Accessibility (for the portals' feature fields):** remappable keyboard and gamepad controls, fixed or floating touch stick, colour-blind shape cues, text-only commentary (no voice), every mode playable with keyboard, gamepad or touch.

## itch.io content

> No violence beyond slide tackles, no chat, no purchases and no external accounts. Single-player progression is earned by playing and saved in the browser. Optional online friendlies connect two players directly through WebRTC using manually exchanged connection codes and a public Google STUN server; players can see their opponent's club details. There is no relay server, so some networks cannot connect. Online friendlies do not change coins, XP or the single-player record.

---

## Links and contact

For the fields every portal asks for. The privacy page is live (checked 29 Sep 2026) and carries the contact email.

- **Privacy policy:** https://isharaf6.github.io/blocky-league/privacy.html
- **Contact email:** calynx@zohomail.com.au
- **Website:** https://isharaf6.github.io/blocky-league/
- **Made with:** Three.js, TypeScript and Vite. Fonts: Lilita One and Silkscreen (SIL Open Font License). Every model, texture and sound is generated in code: no bought or downloaded art or audio.
- **Platforms:** Desktop and mobile browsers with WebGL; keyboard, gamepad and touch.
- **Orientation:** Landscape and portrait are both supported (portrait switches to an end-on camera).

So far the game has been tested in Chrome only (`docs/PUBLISHING.md` §1.3), so don't claim other browsers by name.

Only put the website in a portal's *developer* fields, never inside the game: CrazyGames and Poki forbid outgoing links in the build.

---

## Screenshots (captured 29 Sep 2026)

Ten PNGs in `release/submission/media/screenshots/`, taken from the current build with a headless browser: full page with the HUD, no cursor, no debug text. `npm run submission` copies them into each portal folder.

| File | Shows |
|---|---|
| `desktop-1920x1080/01-title.png` | Title screen with the Calynx credit |
| `desktop-1920x1080/02-open-play.png` | Open play, broadcast camera, attack on goal |
| `desktop-1920x1080/03-goal-celebration.png` | GOAL! with the backflip celebration and the text commentary ticker |
| `desktop-1920x1080/04-blitz-power-up.png` | Blitz: a pickup beam, the power-up slot lit under the score, a mega shot run |
| `desktop-1920x1080/05-transfer-market.png` | Career transfer market |
| `desktop-1920x1080/06-full-time.png` | Full time: YOU WIN, three stars, XP bar, badge and season tier, stats |
| `desktop-1920x1080/07-goal-moment.png` | The ball in the net with the confetti burst (spare) |
| `desktop-1920x1080/08-career-hub.png` | Career hub with the league table (spare) |
| `phone-1080x1920/01-open-play-touch.png` | Phone portrait, open play with the touch stick and buttons |
| `phone-1080x1920/02-main-menu.png` | Phone portrait, main menu |

The goal and Blitz shots were staged with dev hooks (a player placed on the ball, a pickup placed in his path). Everything in them is real gameplay, but the moment was set up.

Still worth adding later if a portal asks: a night match under floodlights, and the Club Run ladder with a perk card.

**Rules to keep:** no text overlays (CrazyGames allows only the title on covers; Poki thumbnails have no text), no cursor, no "Play now".

## Preview videos (captured 29 Sep 2026)

Three silent H.264 MP4s in `release/submission/media/video/`, recorded from the game canvas with the browser's MediaRecorder: one frame per 1/60 s game step, then re-timed to a constant 60 fps. **Canvas only:** the DOM HUD (score, GOAL! text, commentary) is not in the videos, which also keeps them clear of promotional text.

| File | For | Spec |
|---|---|---|
| `blocky-league-16x9-1920x1080.mp4` | CrazyGames landscape video | 1920×1080, 60 fps, 18.5 s, about 27 MB. Opens on the landscape cover (1.5 s), then open play, a Blitz pickup, a mega shot, the goal, the backflip celebration and the replay |
| `blocky-league-2x3-1080x1620.mp4` | CrazyGames portrait video | 1080×1620, 60 fps, 18.5 s, about 20 MB. Same passage, rendered natively in portrait (end-on camera), opening on the portrait cover |
| `blocky-league-square-1080x1080.mp4` | Poki animated thumbnail | 1080×1080, 60 fps, 5.5 s, about 6.4 MB. Pickup, mega-shot run, goal and confetti, cut to the celebration |

The CrazyGames limits are 15–20 s, 50 MB or less, no sound, open on the static cover, and no black bars, logo transitions, cursor or promo text. Poki's are 1080×1080 or more, 4–6 s, 50 fps or more, muted, MP4, 100 MB or less.

## Asset files

The logo, icons, covers, thumbnails and app store screenshots are designed and rendered from the game itself
(docs/BRAND.md has every file, its size and the spec it meets) into the tracked `store-assets/` folder, so the
reviewed files are the same files uploaded to each store. `npm run assets` never overwrites them (it only fills in
a missing file with a procedural placeholder):

| File | Use |
|---|---|
| `blocky-league-logo-1200x630.png` | Master horizontal Blocky League logo / social card |
| `ios-app-icon-1024.png` | Apple App Store icon source (opaque 1024×1024; Apple applies the corner mask) |
| `ios-product-page-1200x630.png` | iOS product-page / campaign key art |
| `google-play-icon-512.png` | Google Play icon source (safe-zone composition) |
| `google-play-feature-1024x500.png` | Google Play feature graphic |
| `crazygames-landscape-1920x1080.png` | CrazyGames cover (16:9), title only |
| `crazygames-portrait-800x1200.png` | CrazyGames cover (2:3), title only |
| `crazygames-square-800x800.png` | CrazyGames cover (1:1), title only |
| `poki-thumbnail-1024x1024.png` | Poki static thumbnail (≥ 628×628, full bleed, no text) |
| `gamedistribution-512x512.png`, `-512x384.png`, `-200x120.png` | GameDistribution's mandatory thumbnails |
| `itch-cover-630x500.png` | itch.io cover image |
| `keyart-1920x1080.png` | Key art for your own site and social posts (the horizontal lockup over the same moment as the covers) |
| `gamedistribution-1280x720.png`, `-1280x550.png` | GameDistribution's optional banner sizes |
| `screenshots/{ios-6.9,ios-6.5,ipad-13,play-phone,play-tablet-7}/` | App Store and Google Play screenshots (docs/BRAND.md) |
| `logo/` | The logo as transparent PNGs and SVGs, and on sky |
| `public/og-image.png` (1200×630) | Social link preview for the web build |

GameDistribution's optional banner sizes (1280×720 and 1280×550) come from a search summary of its design guide, which could not be read directly; `npm run submission` now takes them from `store-assets/`.

`release/` is not in git (`.gitignore`), so the screenshots and videos exist only on this machine. Keep a copy.
