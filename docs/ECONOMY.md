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
| Kits and player looks you see every match, the team in the kit you bought | Dream League Soccer kits, FIFA Mobile kits, Fortnite outfits | **Premium kits**, **player looks** and **stadium style** (Cosmetics 2.0, below) |
| Themed bundles at a discount, priced on what you don't own | Fortnite item shop sets, Brawl Stars skin bundles, Clash Royale offers | **Themed sets**: 6 matching looks at 40% off; COMPLETE THE SET charges only for the missing parts |
| A featured shelf that changes on a fixed day | Fortnite and Rocket League item shops | **This week** on FEATURED: a set and four looks, new every Monday, everything also on sale in its tab |
| Try before you buy | Fortnite locker preview, Clash Royale emote preview | **TRY IT ON**: your whole team in the look, with your ball, lawn and goal explosion |
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
| EPIC | 1,000 to 2,800 | A few days |
| LEGENDARY | 4,500 to 7,500 (Supernova, Diamond Rain, Meteor Strike, Black Hole, Lightning and Comet Tail trails, Diamond and Planet balls; the Galaxy, Gold Pinstripe, Glow In The Dark and Gold Foil kits; the Crown and Light Up Boots; the Pyro Show and Dragon Mascot) | One to three days each, **88,800 for them all**: weeks |
| CLUB PASS | Not for coins | Only on that month's pass track |

The effects, balls and celebrations cost about 86,000 coins, about a month of keen free play; Cosmetics 2.0 adds
about 100,900 more (kits 36,550, player looks 33,250, stadium style 31,100), so the whole catalogue is about 187,000:
about two months for a keen free player, less with the sets at 40% off. A free player can own it all eventually,
which is the fairness line; every category has looks of 450 or less for the first session. A payer gets there in
days. Every ball is also free at its level (the Planet at 27, the Diamond at 30).

**What the looks are (meta/shop.ts, render/fx).** Every look is its own effect, never a recolour, and the rarer it is
the bigger the show. The owner's playtest: "every other thing looks like a different colour so wtf is the point".
- Goal explosions (render/fx/goals.ts), each a scripted show the wide shot holds on for 1.8 s after your goal:
  Shockwave 300, Balloon Party 350, Confetti Cannons 450, Popcorn 600, Gold Rush (a coin geyser) 700, Frostbite (the
  goal freezes and shatters) 800, Pinata 900, Inferno (flame jets) 1,200, Rainbow (an arch over the box) 1,400, Neon
  Disco (mirror ball, lasers, dance floor) 1,800, Fireworks 2,200, Volcano 2,500, Thunderbolt 2,800, Black Hole 4,500,
  Meteor Strike 5,000, Diamond Rain 6,000, Supernova 7,500. Club Colours (the kit-colour burst) is free.
- Trails (render/fx/trails.ts) on the player you control when he sprints, and behind the ball on your side's hard
  shots: Toon Dash 300, Hearts 350, Bubblegum 400, Popcorn 450, Music Notes 600, Slime 650, Ice Trail (frozen boot
  prints) 750, Afterburner 900, Golden Boots (coins) 1,200, Glitch 1,500, Rainbow Ribbon 2,000, Lightning 4,500,
  Comet Tail 6,000. Chalk is free.
- Balls (render/characters.ts BALL_LOOK), shapes and patterns: Retro (leather and laces) 250, Beach 400, Melon 450,
  Blaze (magma) 600, Hoops 700, Eight 800, Ice (spiky) 900, Neon (grid lines) 1,000, Moon 1,200, Disco 1,800, Gold
  2,500, Planet (with a ring) 4,500, Diamond (a cut gem) 7,500.

## Cosmetics 2.0: kits, player looks, stadium style, sets (October 2026)

The owner: "i need u to go above and beyond for th eother stuff like kits etc and i want more cosmetics and stuff that
can drive user purchases". Three new categories, all seen in every match you play (never online, where both screens
must show the same strips), all looks only.

**Premium kits** (meta/shop.ts `KITS`, painted by render/kitDesigns.ts). Your club (career and Quick Match) plays in
it. Each is its own design voxel by voxel, never a recolour (tests/cosmetics2.test.ts proves no two share a pattern):
its own pattern, collar (crew, V or polo), cuffs, shorts with or without a side stripe, and socks; the dearest a
material as well: gold foil that catches the light, trim that glows in night matches, a sheen that shifts colour,
twinkling stars, flickering flames (one shared shader, a per-voxel channel: no textures, no per-player materials).
Zigzag 300, Checkerboard 400, Arctic Camo 600, Tiger 700, Sunset Fade 850, Retro 80s 1,100, Big Crest (your own
colours, a giant crest) 1,300, Inferno (flames, glowing at night) 1,600, Thunder (a bolt, glowing trim) 1,900, Ice
King (iridescent frost) 2,200, Hologram 2,600, Galaxy 4,500, Gold Pinstripe 5,000, Glow In The Dark 6,000, Gold Foil
7,500. Readability: none is grass green or the referee's charcoal, and a clash is fixed on the other side's strip
(meta/style.ts `styleMatch`), so the kit you bought is the kit you play in; the blue and red rings are untouched.

**Player looks** (render/looks.ts), one per slot: hair on your captain (your best outfield player): Top Bun 350,
Frosted Tips 450, Mohawk 600, Big Afro 750, Super Spikes 1,600, Flame Hair 2,600. Headgear on your captain and the man
you control: Headband 300, Sweatbands 400, Halo 2,000, Ice Crown 2,400, Crown 6,000. Armbands on the captain:
Captain Armband 250, Rainbow 650, Gold 1,400. Boots on the whole team: Neon 500, Gold 2,400, Light Up 4,800. Keeper
gloves: Pro 300, Fire 800, Gold 1,800. Shades on everyone who celebrates: Shades 500, Star Shades 900, Gold Shades
1,500.

**Stadium style** (render/stadiumStyle.ts), one per slot, every home match: mowing (Checks 300, Diagonals 450,
Circles 800, your crest in the centre circle 1,500), nets (Club 300, Hex 600, Rainbow 900, Neon 2,000), corner flags
(Club 250, Chequered 400, Flame 700), your name in empty seats of the main stand (and the home end) 1,200, the crowd
(Flag Wave 600, a Giant Tifo of your crest 1,800), the walkout at kick off (Confetti 600, Fireworks 2,000, Pyro Show
4,500), floodlights (Club Colours 700, a Light Show 2,500, wild after your goals) and a touchline mascot that dances
when you score (Bear 1,500, Robot 2,500, Dragon 5,000, which breathes confetti). Decorative only: the career's ground
parts own the structure.

**Themed sets** (meta/shop.ts `BUNDLES`): six matching looks (a kit, a ball, a trail, a goal explosion, a celebration
or player look, a stadium touch) at `BUNDLE_OFF` 40% off the parts. The price is worked out from the parts you don't
own yet, so COMPLETE THE SET never charges for what you have, and every part is also sold alone at its shown price.

| Set | Parts | Parts on their own | Set |
|---|---|---|---|
| Retro | Retro 80s kit, Retro ball, Toon Dash, Confetti Cannons, the Robot, Mown Checks | 3,200 | 1,900 |
| Inferno | Inferno kit, Blaze ball, Afterburner, Inferno, the Backflip, Flame Flags | 6,200 | 3,700 |
| Ice King | Ice King kit, Ice ball, Ice Trail, Frostbite, Ice Crown, Mown Circles | 7,850 | 4,700 |
| Neon Nights | Glow In The Dark kit, Neon ball, Glitch, Neon Disco, Light Up Boots, Neon Nets | 17,100 | 10,250 |
| Champion | Gold Foil kit, Gold ball, Golden Boots, Gold Rush, Crown, Fireworks Walkout | 19,900 | 11,900 |
| Galaxy | Galaxy kit, Planet ball, Comet Tail, Black Hole, Halo, Light Show | 24,000 | 14,400 |

The cheap Retro set is the first-session hook; Inferno and Ice King are a few days; the three legendary sets are
the reason a coin pack is ever worth it (Galaxy is about 1.5 of the biggest pack).

**The shop** (ui/shop.ts, docs/UX.md): a rail on the left (FEATURED, KITS, PLAYERS, BALLS, GOALS, STADIUM, SCOUT, PASS
AND COINS), tiles on the left of each section and the item live on a 3D stage on the right with one-tap BUY. Kits
turn on your captain or show on the whole line-up (CAPTAIN or TEAM), anything that glows has a NIGHT view, TRY IT ON
dresses your team in the look with everything you have on, and an item in a set says so (a tap opens the set).
FEATURED holds this week's set as the hero, four featured looks, your started sets (COMPLETE THE SET) and every set.
NEW marks looks newly in reach of your coins, on the tiles and the rail.

**Road to Glory seasons and the Blocky Cup.** A season is 7 league matchdays plus up to 3 Blocky Cup ties (the
quarter-final after matchday 2, the semi-final after 4, the final after 6). The cup is no longer a mode of its own.
- A cup tie pays the same match fee as a league match (result, goals, your ground's gate), plus a prize when you go
  through. XP is per match as always.
- Prizes scale by division (`CUP_DIV_SCALE`, src/meta/cup.ts): QF 40, SF 80, final 160 and the trophy 400 in the
  Sunday League (680 for a winning run), up to 1,530 for a winning run in the Elite League.
- A winning cup run always pays less than winning the league in the same division (1,040 in the Sunday League,
  2,640 in the Elite League), and getting knocked out pays only the match fee.
- An average season (a typical run: through one round, out in the next) gains about two matches and roughly a third
  more coins, so coins per match rise by well under 10%: a bonus, not a second economy. The old standalone cup paid
  1,700 for three wins on Normal; the career cup pays less per match. (Estimates, from the prize tables.)

## Road to Glory as a forever game (v3, October 2026)

The owner: "i want it to be a forever game, just like terraria is a forever game and sims is a forever game". Every
season now has a purpose (the board), the club has something to build (the ground), a squad that lives and changes
(the academy, aging, legends) and a horizon that never ends (the Continental and World Club Cups, legacy levels,
starting again as a legend). None of it is for sale: everything below is earned in play, and nothing can be sped up
with money.

**New income (all earned in play):**

| Source | Pays | Where |
|---|---|---|
| Board objectives (three a season) | League 200 + 60 a division up (x1.5 for a title target), cup 150 + 40 a division up (x1.5 to win it), the third 120 + 30 a division up. About 470 a season at most in the Sunday League, about 1,200 to 1,400 in the Elite League. Paid when met, on the hub, never multiplied by streaks or the Coin Doubler | src/meta/board.ts `setObjectives` |
| Continental Cup (every Elite League season) | Group win 150, semi final won 400, final won 800 plus the trophy 2,000 (4,250 for a winning run with three group wins), plus the usual match fee each game | src/meta/comps.ts `CONT_PRIZE` |
| World Club Cup (the season after an Elite title or a Continental Cup) | Semi final won 600, final won 1,200 plus the trophy 3,000 | src/meta/comps.ts `WORLD_PRIZE` |
| MEGASTORE (a part of the ground) | 60 coins a home match in the Sunday League, up to 160 in the Elite League | src/meta/ground.ts `megastoreCoins` |
| BIG SCREEN (a part of the ground) | +5% match coins | src/meta/ground.ts `SCREEN_BONUS` |
| Legacy perk, level 3 | +5% match coins | src/meta/legacy.ts `LEGACY_PERKS` |
| Board confidence | The wage budget moves up to 10% either way (never a sacking) | src/meta/board.ts `confidenceBudget` |
| Legacy perk, level 10 | +10% wage budget | src/meta/legacy.ts |

**New sinks: the ground, part by part** (src/meta/ground.ts `PARTS`). One build at a time, it opens after one or two
league matchdays (builds finish over the summer between seasons). Never sped up for money.

| Part | Cost | Builds in | What it does |
|---|---|---|---|
| Main stand / upper tier | 800 / 3,000 | 1 / 2 | Seats and gate money (the upper tier needs floodlights) |
| Family stand / full length | 1,200 / 1,600 | 1 / 1 | Seats along the near side |
| Floodlights | 1,600 | 1 | Night games at home, needed for the upper tier |
| North end, south end | 3,800 each | 2 | Stands behind the goals |
| The dome | 9,000 | 2 | Roofs the bowl: the biggest ground |
| Big screen | 1,500 | 1 | +5% match coins |
| Megastore | 2,500 | 1 | Shirt sales every home match |
| Fan zone | 1,800 | 1 | The fans roar you on: +1 OVR at home |
| Training ground | 2,000 | 1 | Training 25% cheaper |
| Youth academy | 3,000 | 2 | Three prospects a season, one star better |

The stands cost 24,800 in all (the old five levels cost 25,710), the buildings 10,800 more: the whole ground is about
35,600 coins, several seasons of play. An old save's stadium level becomes exactly the parts that made it.

**Pacing.** A Sunday League season pays roughly 2,500 to 3,000 coins in matches, prizes and objectives: the main
stand in week one, the family stand soon after, and a long goal to save for. In the Elite League a good season pays
10,000 or more (the Continental Cup is the big new prize), which is what the dome and the last buildings cost.

**Legacy (src/meta/legacy.ts).** Points, not coins: a title 100 + 40 a division up, promotion 60, the Blocky Cup 80
(a final 30), the Continental Cup 300, the World Club Cup 500, the treble 400, each objective 15, each legend 25, each
milestone or record 5. Level n needs 50 n (n + 1) points: 100, 300, 600, 1,000, 1,500... forever. Perks: academy
prospects one star better (level 2), +5% match coins (3), training 10% cheaper (5), new clubs start 4 OVR stronger
(7), +10% wage budget (10). After an Elite League title the club can be handed on: START A NEW CLUB AS A LEGEND keeps
legacy, perks, legends, coins and every cosmetic; the old club stays in the Hall of Fame.

## What money buys (the app's store, platform/iap.ts)

| Product | Price | What you get |
|---|---|---|
| 500 coins | $0.99 | 1,000 on the first buy |
| 1,500 (+10%) | $2.99 | 3,300 on the first buy |
| 4,000 (+25%) | $6.99 | 10,000 on the first buy |
| 10,000 (+40%) | $14.99 | 28,000 on the first buy |
| Starter Pack | $1.99 once | 2,000 coins and the Gold ball, worth 4,500 |
| NO ADS | $3.99 once | No interstitials. Rewarded ads stay, by choice |
| **Club Pass** | $3.99 a month | About 5,560 coins (about $11 at pack prices, nearly 3 times its price) plus that month's player look, trail, premium kit and goal explosion, which money can't buy any other way |
| **Coin Doubler** | $4.99 once | Every match pays double coins, for good |

## The Club Pass (meta/season.ts, meta/pass.ts)

- It is the same 30 tiers as the free season, about 30 matches a month, so it's finishable at about 4 days of play a
  week. Supercell found 85% of players never finished a pass that was too long.
- The pass track pays 60 to 200 coins a tier, plus 700 at tier 25 and 1,800 at 30 (5,560 in all). Four tiers are the
  month's own looks (`PASS_ITEM_TIERS`): tier 5 its player look, tier 10 its sprint trail, tier 15 its premium kit and
  tier 20 its goal explosion. Each month its own, themed to the month, never a colourway: a snow tornado, a snowflake
  knit kit and a bobble hat in January; a mud splat, a mud splattered kit and mud stompers in February; flowers, a
  blossom kit and a flower crown in March; rain clouds, a raindrop kit and rainbow shades in April; a trophy, a white
  and gold trophy kit and a trophy armband in May; a big wave, beach stripes and surf shades in June; a grinning sun, a
  heat haze kit and a sun visor in July; a ball barrage, a training bib kit and camp gloves in August; a leaf gust, a
  harvest plaid kit and harvest curls in September; searchlights, a purple kit with glowing lines and floodlight boots
  in October; Catherine wheels, an ember kit and sparkler gloves in November; presents, a festive knit and a winter
  hat in December.
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
- **Honest sets and shelves.** A set's price is its missing parts at a fixed 40% off, shown against what they cost
  alone; every part is on sale on its own; the FEATURED shelf changes on Mondays and shows no countdown.
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
| Blocky Cup prizes and calendar | src/meta/cup.ts `ROUND_PRIZE`, `TROPHY_PRIZE`, `CUP_DIV_SCALE`, `CUP_AFTER` |
| Board objectives and their rewards | src/meta/board.ts `setObjectives`, `CONFIDENCE_DONE`, `CONFIDENCE_FAILED` |
| Continental / World Club Cup prizes and calendar | src/meta/comps.ts `CONT_PRIZE`, `WORLD_PRIZE`, `CONT_GROUP_AFTER`, `CONT_SF_AFTER`, `CONT_FINAL_AFTER` |
| Ground part costs, build times, megastore and screen | src/meta/ground.ts `PARTS`, `megastoreCoins`, `SCREEN_BONUS`, `TRAINING_DISCOUNT` |
| Legacy points, levels and perks | src/meta/legacy.ts `LEGACY_POINTS`, `legacyNeed`, `LEGACY_PERKS` |
| Retirement ages, academy intake | src/meta/life.ts `RETIRE_CHANCE`, `RETIRE_ALWAYS`, `INTAKE` |
| Today's deal discount | src/meta/shop.ts `DEAL_OFF` |
| Set discount and the sets | src/meta/shop.ts `BUNDLE_OFF`, `BUNDLES` |
| The featured shelf | src/meta/shop.ts `featuredShelf` (new every Monday) |
| Kit, look and stadium prices | src/meta/shop.ts `KITS`, `LOOKS`, `DECOR` |
| Which pass tiers are looks | src/meta/season.ts `PASS_ITEM_TIERS` |
| Pass rewards | src/meta/season.ts `passReward`, `PASS_BIG_COINS` |
| Pack token costs | src/meta/shop.ts `PACK_TOKENS` |
| First-buy multiplier | src/platform/iap.ts `FIRST_BUY_MULT` |
| Interstitial cap | src/platform/ads.ts `APP_AD_EVERY`, `APP_AD_GAP_MS` |
| Review prompt rules | src/platform/review.ts |
