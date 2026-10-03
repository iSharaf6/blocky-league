# Blocky League economy v2 (October 2026)

How the game earns money while staying fun and fair, and what it copied from the games that do this best.

The free game is the whole game: no energy, no paywalls, no pay-to-win. Players pay because they want something,
never because they're blocked.

## What we copied, and from whom

| Pattern | Who does it | In Blocky League |
|---|---|---|
| A season pass with a free and a paid track, priced for casual players | Dream League Soccer ($3.99), Brawl Pass, Pass Royale, Subway Surfers | **Club Pass**, $3.99 a month (meta/pass.ts) |
| Mid-season buyers get every tier already reached | Dream League Soccer | Buying late unlocks all reached tiers at once |
| A one-time starter pack worth far more than its price, offered after a first win | Subway Surfers, Soccer Stars | **Welcome offer** after the first win (once, no timer) |
| A permanent coin doubler | Subway Surfers ($4.99), Crossy Road's Piggy Bank ($2.99) | **Coin Doubler**, $4.99: match coins ×2 for good |
| A first-purchase bonus on currency packs | EA FC Mobile's "2X Top Up" | **First buy ×2** on each coin pack, once |
| A rotating daily shop | Rocket League (24 h) | **Today's deal**: one look a day at 25% off |
| Rarity tiers that show status | Brawl Stars skin tiers | COMMON, RARE, EPIC, LEGENDARY and CLUB PASS badges |
| Opt-in rewarded ads at natural moments, capped | Crossy Road, Subway Surfers, Dream League Soccer | FREE COINS (5 a day), double coins at full time, double the daily gift |
| Free random rewards that can't be bought | Brawl Stars' Starr Drops (after it removed paid loot boxes) | **Scout Tokens**: packs cost earned-only tokens |
| No ads for buyers, rewarded ads still optional | Voodoo hybrid-casual games | NO ADS ($3.99) stops interstitials only |
| Social status | Every big game | Game Center achievements and leaderboards (goals, wins, best streak, best season) |

Research: about 150 sources, including GDC talks, Supercell's own notes, Deconstructor of Fun, Naavik,
PocketGamer.biz, App Store listings and regulators. The full report is in the October 2026 session notes. The key
facts are below.

## The loop

1. **Play:** a match pays coins, XP (level and season), mastery progress and challenge progress.
2. **Unlock:** something new every couple of matches early on, a Rare or Epic look every few days, and a Legendary
   to aim at for weeks.
3. **Show it off:** the look is drawn in every match, the rarity badge in the shop, titles in the menu, achievements
   and leaderboards in Game Center.
4. **Come back:** the daily gift (it counts up whatever the gaps), three daily challenges (each also a Scout Token),
   today's deal, the monthly season and its pass.

## Pacing (coins)

A keen free player (about 6 matches, the challenges, the gift and the free ads) banks roughly **2,500 to 3,500
coins a day**. A Normal win pays about 210, a draw 90, a loss 30, and win streaks multiply wins up to ×2.

| Tier | Price | For a free player |
|---|---|---|
| COMMON | 250 to 450 | Two to four matches. Something new in the first session |
| RARE | 500 to 900 | A day |
| EPIC | 1,000 to 2,500 | A few days |
| LEGENDARY | 4,500 to 7,500 (Supernova, Diamond Rain, Lightning, Comet Tail, Diamond ball) | One to three days each, **28,500 for the set**: weeks |
| CLUB PASS | Not for coins | Only on that month's pass track |

The whole catalogue costs about 46,000 coins. A free player can own it eventually, which is the fairness line.
A payer gets there in days. The Diamond ball is also free at level 30, like every ball.

## What money buys (the app's store, platform/iap.ts)

| Product | Price | What you get |
|---|---|---|
| 500 coins | $0.99 | 1,000 on the first buy |
| 1,500 (+10%) | $2.99 | 3,300 on the first buy |
| 4,000 (+25%) | $6.99 | 10,000 on the first buy |
| 10,000 (+40%) | $14.99 | 28,000 on the first buy |
| Starter Pack | $1.99 once | 2,000 coins and the Gold ball, worth 4,500 |
| NO ADS | $3.99 once | No interstitials. Rewarded ads stay, by choice |
| **Club Pass** | $3.99 a month | About 6,060 coins (about $12 at pack prices, 3 times its price) plus that month's goal explosion and trail, which money can't buy any other way |
| **Coin Doubler** | $4.99 once | Every match pays double coins, for good |

## The Club Pass (meta/season.ts, meta/pass.ts)

- It is the same 30 tiers as the free season, about 30 matches a month, so it's finishable at about 4 days of play a
  week. Supercell found 85% of players never finished a pass that was too long.
- The pass track pays 60 to 200 coins a tier, plus 300 at tier 5, 500 at 15, 700 at 25 and 1,500 at 30. Tier 10 is
  the month's sprint trail and tier 20 its goal explosion: 12 colourways, one per monthly theme.
- If bought late, every reached tier is claimable at once. At month end, unclaimed pass coins carry into the next
  month and unclaimed looks stay claimable. Nothing reached is lost.
- It is a consumable store product, so it can be bought again each month. The store refuses a second buy in the same
  month.

## Ethics: kids play this

- **No paid random rewards.**
  - Packs cost Scout Tokens, earned only (one per daily challenge done, plus the free daily pack) and never sold.
    Coins, which the store sells, can't buy a random card.
  - Apple rates loot boxes 9+, PEGI gives paid random items a 16 by default from June 2026, Brazil bans them for
    under-18s, and the FTC fined HoYoverse $20M in 2025. Blocky League stays 4+ with no loot-box label.
  - A specific player is still bought directly with coins in the transfer market. That is a known, chosen item.
- **No fake scarcity.** The deal rotates daily and every look comes round again. The welcome offer has no timer and
  says it stays in the shop. Club Pass looks return when their month's theme comes round.
- **Absence is never punished.** The daily gift counts the days you claim it, not days in a row, so a missed day
  costs nothing. PEGI now rates "punishing absence".
- **No pay-to-win.** Everything bought is a look, coins, or no ads. Online friendlies use preset clubs.
- **Kid-safe ads.** Every request is child-directed, family-rated, never personalised, with no tracking prompt
  (src/platform/adConfig.ts).
- **One currency for money.** Coins are the only thing sold. Scout Tokens can't be bought. The shop shows the store's
  real price string.
- **Reviews are never gated.** Apple's own prompt appears after a win, rarely (platform/review.ts). Anyone can email
  feedback from Settings.

## Realistic expectations

- About 1 to 2% of players ever pay (Unity 2024: 1.83%). Typical casual revenue from purchases is $0.02 to $0.10 a day
  per active player; kid-safe ads earn less than tracked ones.
- What moves the number is players and retention, not squeezing harder: get downloads (TikTok, Shorts, featuring) and
  keep them playing.
- Measure before changing prices. Watch conversion on the welcome offer, pass buy rate by day of month, and how many
  free players reach Legendary.

## Tuning knobs

| What | Where |
|---|---|
| Item prices and the rarity cut-offs | src/meta/shop.ts (`itemTier`) |
| Today's deal discount | src/meta/shop.ts `DEAL_OFF` |
| Pass rewards | src/meta/season.ts `passReward`, `PASS_BIG_COINS` |
| Pack token costs | src/meta/shop.ts `PACK_TOKENS` |
| First-buy multiplier | src/platform/iap.ts `FIRST_BUY_MULT` |
| Interstitial cap | src/platform/ads.ts `APP_AD_EVERY`, `APP_AD_GAP_MS` |
| Review prompt rules | src/platform/review.ts |
