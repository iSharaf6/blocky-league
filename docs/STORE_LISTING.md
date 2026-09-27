# Store listing: Blocky League

Copy for CrazyGames, Poki, GameDistribution, itch.io and your own site. Paste as-is, or trim to each field's limit. Character counts are noted where a portal enforces a limit.

> **Keep it honest.** Everything below is in the v1 build (checked 28 Sep 2026). If a feature is cut before you upload, delete its line. Two things are browser-dependent and are worded that way: goal clips (recorded only where the browser supports canvas recording) and cloud saves (web build only, and only once the owner has set up the backend: `docs/CLOUD.md`). Neither is mentioned in the portal copy.

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

_(152 chars)_

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
> **Blitz mode:** football with power-ups. Grab the glowing pickups for a turbo burst, a mega shot, a freeze, a magnet or a shield, and use them at the right moment.
>
> Every match earns XP: level up from Sunday Leaguer to Blocky Legend, earn mastery badges for finishing, playmaking, defending, skills and saves, climb the monthly season track, keep a win streak going and beat three fresh daily challenges every day. Everything is earned by playing: there is nothing to buy.
>
> Play on keyboard, gamepad or touch. Every key and button can be changed, the touch stick can float or stay fixed, and a colour-blind option adds shape cues. Your progress is saved in your browser.

## GameDistribution fields (200–500 characters each)

**Description:**

> Chunky voxel football in your browser. Learn the basics in three quick drills, then pick one of eleven clubs and take on the AI from Easy to Legend. Build a club in Career, survive seven matches in Club Run, chase stars in Moments, or grab power-ups in Blitz mode. Pass, power up screamers, float crosses and slide-tackle. Level up, earn mastery badges and beat three daily challenges. Every goal gets a celebration and an instant replay.

_(446 chars)_

**Instructions:**

> Move with WASD or the arrow keys. Space passes (aim with the stick), hold and release K to shoot, tap L for a through ball or hold L to lob or cross, and hold Shift to sprint. Defending: Space switches player, K tackles, hold L to press. E uses a Blitz power-up. Esc pauses. Gamepad: A pass, B shoot, X through ball, Y power-up, RT sprint. Touch: stick on the left, buttons on the right. Change any key in Settings.

_(419 chars)_

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

**Age / content:** no violence beyond slide tackles, no chat, no purchases. The only text a player can type is a club name and a three-letter code, both run through a profanity filter and never shown to other players. Progression (XP, levels, badges, the season track, stars, streaks, daily challenges) is earned by playing only. Suitable for all ages. This meets CrazyGames' PEGI-12 requirement.

**Accessibility (for the portals' feature fields):** remappable keyboard and gamepad controls, fixed or floating touch stick, colour-blind shape cues, text-only commentary (no voice), every mode playable with keyboard, gamepad or touch.

---

## Screenshot shot list (5)

Capture at 1920×1080 (16:9). CrazyGames' portrait video also needs a 1080×1620 (2:3) crop.

1. **The screamer.** A power shot mid-flight towards the top corner, the keeper diving and the crowd on its feet. Capture the moment just before the ball crosses the line.
2. **Goal celebration.** The scorer mid-celebration with confetti particles, with the scoreline and HUD visible, so it's obvious this is live gameplay.
3. **Night match under floodlights.** A wide broadcast angle of a full stadium at night, with a passing move in progress. It shows off the lighting and the atmosphere.
4. **Blitz.** A player grabbing a glowing power-up cube, the power-up slot lit under the score. It shows the arcade side.
5. **Club Run or the main menu.** The Club Run ladder of seven crests with a perk card, or the main menu with the captain in his kit. It shows there is more than one match to play.

**Tips:**
- Hide the cursor.
- Pause at the peak of the action and use the game's replay camera for the cleanest angle.
- Don't add text overlays: CrazyGames allows only the title on covers, and Poki thumbnails should have no text.

## Preview video (CrazyGames 15–20 s; Poki animated thumbnail 4–6 s, square)

**Specs:**
- No sound, no cursor, and no "Play now" text.
- Start on the static cover image.
- Cut from shot to shot every 2–3 seconds.

**Order:**
1. Kick-off (1.5 s)
2. Passing move (3 s)
3. Power shot (2 s)
4. Goal plus confetti (2 s)
5. Replay angle (3 s)
6. Slide tackle (2 s)
7. Night-stadium wide shot (2 s)
8. End on the cover (2 s)

For Poki's square loop (1080×1080, 50 fps or more), use shots 3, 4 and 5.

## Asset files

All of these are generated by `npm run assets` into `release/store-assets/`:

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

The screenshots and the preview video are **not** generated: capture them from the game (shot list above).
