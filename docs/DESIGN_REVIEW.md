# Blocky League: arcade pacing and retention review

Written against build b459cd5, from the round 7 to 12 critic data and the owner's playtests. The brief: find where a player gets bored or frustrated, and design a simple progression that rewards mastery and makes people want "just one more run".

## Where boredom sets in

| When | What the player feels | Why |
|---|---|---|
| 0:00 to 0:30 | Fine | PLAY NOW reaches the ball in two clicks, and the first-match hold waits for them. |
| 0:30 to 2:00 | "Everyone is chasing the ball" | Up to five players from each side converge on the carrier. There is no shape, so there is no space and no pass worth making. This kills the football fantasy faster than anything else. |
| 2:00 to 4:00 | "I've seen this attack before" | Most goals come from one pattern: carry wide, cross, header. Headers are about 63% of AI goals. Nothing in a match changes after the first goal: no momentum, no comeback pressure, no late-game drama. |
| Match 2 to 3 | "Why am I doing this again?" | The meta gives coins with few sinks outside Career. The level ladder has visible rewards only up to level 14. Daily challenges are the only reason to come back tomorrow. |
| Match 4 onward | Quiet exit | There's no goal the player set for themselves, and no run that could go further next time. |

## Where frustration sets in

- **Losing the ball with no explanation:** a tackle, a heavy first touch or an interception happens, and nothing on screen says why.
- **Impacts that don't land:** a won tackle or a shot off the bar has too little weight (sound, freeze, shake), so good play doesn't feel good.
- **Commentary voice:** the spoken commentary talks over the play. The owner has asked for the voice to go; the text ticker stays.
- **Slow dead balls:** set pieces and replays on a 1.5-minute half eat a big share of the match.
- **Difficulty cliffs:** a novice concedes early, while a competent player is never in danger at Normal.

## Fixes by impact

1. **Football shape.** At most two players press the ball. Everyone else holds a line and a lane, and makes runs. Teams play in distinct styles (high press, park the bus, possession, counter), so opponents feel different.
2. **Weight on every impact:** hit-stop on goals, posts and slide tackles; small screen shake; flashes on the ball and players; layered synthesised sound for shots, headers, tackles and goals; and a crowd that swells as the ball nears a box.
3. **Remove the commentary voice.** Keep the commentary text and the big event banners (GOAL!, SAVE!, WON IT!).
4. **Staged onboarding:** learn to move, then pass, then shoot, then score your first goal. Career and Moments unlock after that goal.
5. **One-more-run and mastery,** below.

## Progression: "Club Run" plus mastery badges

### Club Run (the one-more-run loop)

- A run is up to 7 short matches (1-minute halves) against a ladder of clubs that gets stronger each round.
- A draw goes to penalties. A loss ends the run.
- After every win, pick one of three **perks** for the rest of the run. Each changes how you play, so every run plays differently. Examples:
  - start each match with a Blitz power-up held
  - start 1-0 up
  - the next opponent is a level weaker
  - golden first goal (the first goal counts double)
  - +20% run XP
  - a sharper keeper
- The run screen shows the ladder of seven crests, your perks, and your **best run** ("Best: round 5 v Northwick").
- Rewards come at milestones:
  - reaching rounds 3, 5 and 7 unlocks a run-only celebration, ball and title
  - clearing all seven is the "Invincible" badge
- **Why it works:** runs are short, each is a fresh start with a visible personal best, perks create "this time I'll take the keeper perk", and losing costs 2 minutes, not a season.

### Mastery badges (reward getting good)

- **Five skill tracks:**
  - Finisher: goals
  - Playmaker: assists and completed passes
  - Wall: tackles won and clean sheets
  - Magician: skill cuts and nutmegs
  - Keeper: saves in Moments
- Each track has eight tiers earned by doing the thing in any mode. Every tier pays coins and a wearable title; tiers V and VIII also grant existing cosmetic looks. The original first five thresholds and rewards are preserved. Higher tiers carry visible earned prestige.
- The level badge on the main menu shows the next badge tier, so there is always a near goal.

### Season track (a reason to come back each day)

- Twelve shipped, player-selected 30-tier Club Journeys. XP advances the selected track; free progress and optional paid upgrades never expire or reset. Switching retains each Journey's own XP and claims. No monthly updates are needed.
- Every tier gives coins or a cosmetic.
- Each Journey has a free track and an optional permanent Club Pass for one identity. Purchases have stated outcomes; paid identity pieces do not affect match strength.

## Deliberately not in v1

- **Online multiplayer:** built on a separate branch. The simulation is deterministic, so the plan is lockstep networking over WebRTC. It merges after the v1 portal launch once it has been played.
- **Moving the simulation to a Web Worker:** the frame cost is 3 to 6 ms on the main thread today, so this isn't needed for launch.
- **Paid anything:** first launch is on ad-supported portals only.
