# Store listing: Blocky League

Copy for CrazyGames, Poki, GameDistribution, itch.io and your own site. Paste as-is, or trim to each field's limit. Character counts are noted where a portal enforces a limit.

> **Keep it honest.** Everything below is in the v1 build (checked 29 Sep 2026). If a feature is cut before you upload, delete its line. Two things are browser-dependent and are worded that way: goal clips (recorded only where the browser supports canvas recording) and cloud saves (web build only, and only once the owner has set up the backend: `docs/CLOUD.md`). Neither is mentioned in the portal copy.
>
> **Web-build-only features stay out of the portal copy.** Online multiplayer is in the web build only (your own site), not in the CrazyGames, Poki or itch zips, so none of the text below mentions it. Commentary is **text only**: the spoken voice was removed, so never write "voiced" or "spoken" commentary.
>
> `npm run submission` reads this file to write each portal's `listing.txt` (`release/submission/<portal>/`). Keep the headings as they are; the script stops with an error if one goes missing.

---

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

> **Blocky League** is fast, chunky voxel football you can play right in your browser.
>
> New to it? **Learn the basics** in three quick drills (pass, shoot, cross), then play your first match. Score your first goal and the whole game opens up.
>
> Pick one of eleven clubs, from park-football minnows to superstar sides, and take on the AI on four difficulty levels, from Easy to Legend. Thread passes through tight lanes, hold Shoot to power up a screamer, float lobs and crosses, and time a first-time volley as the ball drops. When they come at you, switch players, press the ball and throw in a slide tackle. Every goal gets a celebration and an instant replay, with broadcast-style text commentary, a roaring voxel crowd, and matches in daylight, at sunset or under the floodlights.
>
> **Career:** start your own club at the bottom of six divisions, set your formation, sign players on the transfer market and grow your stadium on the way to the top. **Blocky Cup:** a knockout trophy with penalty shootouts.
>
> **Club Run:** seven short matches against a ladder of stronger clubs, one life. After every win, pick a perk that changes how you play, and chase your best run.
>
> **Moments:** eight short challenges, from a first-touch finish to a two-goal comeback, three stars each.
>
> **Blitz mode:** football with power-ups. Grab the glowing pickups for a turbo burst, a mega shot, a freeze, a magnet, a shield or a golden boost that makes your next goal count double, and use them at the right moment.
>
> Every match earns XP: level up from Sunday Leaguer to Blocky Legend, earn mastery badges for finishing, playmaking, defending, skills and saves, climb the monthly season track, keep a win streak going and beat three fresh daily challenges every day. Everything is earned by playing: there is nothing to buy.
>
> Play on keyboard, gamepad or touch. Every key and button can be changed, the touch stick can float or stay fixed, and a colour-blind option adds shape cues. Your progress is saved in your browser.

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
  Power-up (Blitz)    E
  Pause               Esc or P

GAMEPAD   A pass  |  B shoot  |  X through ball  |  Y power-up  |  RT sprint  |  Start pause
TOUCH     Stick on the left (floating or fixed: Settings › Controls), buttons on the right (⚡ in Blitz)
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
| itch.io | Genre: Sports. Made with: Three.js | football, soccer, voxel, low-poly, 3d, arcade, browser, singleplayer |

**Age / content:** no violence beyond slide tackles, no chat, no purchases, no accounts, no outgoing links. The only text a player can type is a club name and a three-letter code, both run through a profanity filter and never shown to other players. Progression (XP, levels, badges, the season track, stars, streaks, daily challenges) is earned by playing only. Progress is saved in the browser; the game itself collects no personal data. Suitable for all ages. This meets CrazyGames' PEGI-12 requirement.

_(True for the CrazyGames, Poki and itch builds. The web build's online mode is not covered: check what it shows other players before you reuse this line on your own site.)_

**Accessibility (for the portals' feature fields):** remappable keyboard and gamepad controls, fixed or floating touch stick, colour-blind shape cues, text-only commentary (no voice), every mode playable with keyboard, gamepad or touch.

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

The covers and thumbnails are generated by `npm run assets` into `release/store-assets/`:

| File | Use |
|---|---|
| `crazygames-landscape-1920x1080.png` | CrazyGames cover (16:9), title only |
| `crazygames-portrait-800x1200.png` | CrazyGames cover (2:3), title only |
| `crazygames-square-800x800.png` | CrazyGames cover (1:1), title only |
| `poki-thumbnail-1024x1024.png` | Poki static thumbnail (≥ 628×628, full bleed, no text) |
| `gamedistribution-512x512.png`, `-512x384.png`, `-200x120.png` | GameDistribution's mandatory thumbnails |
| `itch-cover-630x500.png` | itch.io cover image |
| `keyart-1920x1080.png` | Key art with tagline for your own site and social posts (**not** for CrazyGames, which allows the title only) |
| `public/og-image.png` (1200×630) | Social link preview for the web build |

Also in `release/submission/media/extra-sizes/`: `gamedistribution-1280x720.png` and `gamedistribution-1280x550.png`. These are resized or cropped from the CrazyGames landscape cover, for GameDistribution's optional banner sizes (the sizes come from a search summary of its design guide, which could not be read directly). Re-make them if you regenerate the covers.

`release/` is not in git (`.gitignore`), so the screenshots and videos exist only on this machine. Keep a copy.
