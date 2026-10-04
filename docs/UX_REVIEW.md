# Blocky League: player-centric UX review (October 2026)

Lens: a first-time player on a landscape iPhone. Three questions: how quickly they learn the systems, where they meet
friction, and what the design does to their feelings minute by minute and day by day. The sources are the owner's own
playtests, measurements from bot matches that play like a casual touch player (tests/humanBot.ts), and a read of the
code.

## Why the loop feels tedious after two minutes

### 1. Too little to decide, too much travelling
- Most of a match is spent jogging the ball up an 11-a-side pitch or chasing the AI back down it. The moments that
  feel like playing (a shot, a skill, a tackle, a save) are spread thin. Dead balls (throw-ins, goal kicks, kick-offs,
  the celebration and replay) keep taking control away.
- People judge fun by how often their input matters. When most inputs are "hold the stick and wait", the brain gets
  used to it within a couple of minutes and the match turns into a chore.
- Fix in progress: measure ball-in-play time and how often the player makes a meaningful action, then cut dead time
  (quicker restarts, skippable replays) and transit time (snappier movement, a closer phone camera, smarter switching).

### 2. A flat tension curve: nothing escalates and the result is predictable
- Every possession plays out much the same way, the AI defends the same way, and the match has no shape: no momentum,
  no rising stakes, no late drama.
- NORMAL is now too generous: the casual bot went 20 wins, 4 draws, 0 losses, averaging 2.4 to 0.4. Not knowing the
  result is what makes football exciting. Remove it and the player stops caring part-way through.
- People remember an experience by its peak and its ending. Right now a match has neither a peak nor a climax.
- Fix in progress:
  - a HYPE meter that builds to a SUPER SHOT, for both sides, which allows comebacks and drama
  - a FINAL MINUTE beat with the crowd and heartbeat rising
  - bigger juice for equalisers and late winners
  - a NORMAL rebalanced towards end-to-end games instead of walkovers

### 3. Rewards and purpose sit apart from play
- Coins and XP only appear on the full-time screen. Nothing during play moves a visible goal: daily challenges are
  out of sight, and there are no bounties or progress pops.
- There is no answer to "why am I playing this match?" in the moment, so nothing pulls the player towards a
  finish line.
- After the match there is no next objective and no cliffhanger, so nothing says "one more".
- Fix in progress:
  - live objectives during the match ("score in 40 s: +50") with coins flying to the counter
  - a style grade (S to C) with a small bonus and a personal best to beat
  - board objectives every season and a NEXT GOAL card on the hub
  - a career that never ends (continental cup, legacy, youth academy, players who age and retire)

## Learnability

| Area | What a new player meets | Risk | Direction |
|---|---|---|---|
| Controls | One stick plus five buttons that change meaning with possession: PASS, SHOOT, THROUGH, SPRINT and SKILL become PRESS, TACKLE, SWITCH and SPRINT | Too many choices at once, plus labels that move under the thumb | Auto sprint (done). One-button contexts where possible. Fade labels once learnt (the trainer already fades). |
| Skills | Skill move depends on the stick direction when SKILL is tapped | It can't be discovered. A move that seems to fail randomly reads as a broken game, as with the rainbow flick | A first-use skill card per move, the move name shown on success, a skills page in HOW TO PLAY (done) |
| Switching | Auto-switch and SWITCH pick by distance | "Hard to control players": the wrong man is selected at the moment that matters | Switch by interception point and predict loose balls (in progress) |
| Meta systems | Career, cup, market, training, season pass, badges, mastery, Club Run, Moments, Blitz, shop | Too many systems at once. Each one is fine, but together they overwhelm | One hero path (ROAD TO GLORY), a NEXT GOAL card, other modes under EVENTS (done); bring systems in one at a time through board objectives |

## Friction (fixed in the last two rounds)
- **Graphics:** blurry on the phone. Fixed: HIGH by default, the resolution governor floor, and shaders compiled
  before kick-off.
- **Scrolling:** every screen scrolled. Fixed with the app shell (docs/UX.md); every screen is measured to fit
  852x393 and 667x375.
- **Chores:** subs, training, transfers. Fixed with tap-tap or drag swaps, AUTO PICK, SUGGESTED SUBS, TRAIN BEST and the
  FOR YOU sort.
- **Hidden money:** REMOVE ADS, Club Pass and coin packs were invisible on the phone. Fixed: always shown, with an
  honest note while the store is offline.
- **Haptics:** not felt. Fixing now: Core Haptics with stronger patterns, plus the iPhone setting check.

## Emotional journey (target)

| Moment | Today | Target |
|---|---|---|
| First 10 s | Splash, title, tap | Into a match in one tap, as now |
| First match | Learns while the AI waits; generous | A goal within a minute, a skill that lands, a big explosion (pride) |
| End of the first match | Coins and XP screen | The style grade, a coin shower, "NEXT: create your club" (anticipation) |
| First session | Free to wander many modes | Found your club, kit, first league match, first board objective (ownership) |
| Day 2 | Daily gift, challenges | Gift plus "your youth prospect arrives", objectives half done (an unfinished goal pulls them back) |
| Week 1 | Season ends | Promotion party, cup run, stadium stand built, first bundle tempting (identity, status) |
| Month 1 and on | Pass and cosmetics | Legacy level, Hall of Fame, continental nights, players aging into legends (forever) |

## Monetisation that follows the feelings (ethical)
- **Sell identity, not power.** Premium kits, player looks, stadium style and themed sets, previewed on your own team.
  Ownership and self-expression are what make The Sims and Terraria last forever.
- **Club Pass.** Monthly unique looks plus coins, clearly worth $3.99. No timers, no loot boxes for money, and every
  price is visible.
- **Ads at natural breaks only** (half-time). Rewarded ads stay the player's choice.
