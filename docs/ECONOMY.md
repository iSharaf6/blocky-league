# Blocky League economy v4 (October 2026)

How the game earns money while staying fun and fair, and what it copied from the games that do this best.

The free game is the whole game: no energy, no paywalls, no pay-to-win. Players pay because they want something,
never because they're blocked.

**v4: currency with a purpose.** Coins fund ordinary looks, players and club development. Gems buy guaranteed
signature identities, the Club Pass and useful shortcuts. **SCOUT TICKETS** are earned pack keys, with the existing
`shop.tokens` storage retained so no tickets disappear. Ordinary coin prices, already owned goods, challenge/gift
rewards and the pass's existing coin/gem payouts are preserved. Quick-match fees reward the result, with a modest
three-goal bonus cap instead of unlimited score farming. See `tests/signatureEconomy.test.ts` for save round trips,
old pass receipts, exact prices, duplicate purchase guards and the free-gem route.

**What v3 changed** (the owner: "i want it ethically to drive players to spend money ... im not happy with game
economy atm", "mascots and shit feel useless why would i want that, like make them useful", "i want people to be
incentivsed to keep coming back"):

1. **Two currencies.** COINS (earned every match, buy looks, players, the ground) and GEMS (scarce: a steady trickle
   from play, and packs in the store). Money buys gems, never coins directly.
2. **Gems buy time, second chances and guarantees**, each a stated outcome at a shown price with one tap to confirm:
   finish a build now, heal a player now, replay a lost decider, a Scouting Network tier, the Club Pass, coins.
3. **Stadium style and mascots do something.** They raise your club's ATMOSPHERE: matchday income, a fuller ground,
   more chants, a mascot's half time show. Capped, and bought with coins.
4. **Reasons to come back:** a 7-day login calendar, weekly objectives, the daily sweep, a free daily gem.
5. **A cleaner store:** five gem packs up to $19.99, the Starter Pack, NO ADS, the Coin Doubler, the Club Pass and a
   PRO bundle as the anchor.

## Currencies at a glance

| | COINS | GEMS | SCOUT TICKETS |
|---|---|---|---|
| What it is | The soft currency | The premium currency | The key to random scout packs |
| From play | Every match, challenges, the calendar, weekly objectives, prizes, the season track | Board objectives, legacy levels, cups, titles, levels, achievements, the calendar, weekly objectives, the daily sweep, season tiers | One per daily challenge done, one on calendar day 5 |
| From ads (optional) | FREE COINS 75 (5 a day), double a match, double the gift | 3 once a day | Never |
| From money | Never directly (gems swap for coins) | Gem packs, the Starter Pack, the PRO bundle | Never |
| Buys | Ordinary looks, sets, players, the ground, training | Permanent signature collections, time skips, a replay, the Scouting Network, the Club Pass, coins | Scout packs (the only random thing in the game) |
| Code | `SaveData.coins`, meta/shop.ts | `SaveData.gems`, meta/gems.ts | `SaveData.shop.tokens`, meta/shop.ts |

A new save starts with 500 coins, 50 gems (the welcome gift: one replay's worth) and 2 Scout Tickets.
One ticket opens a Scout Pack; three open an Elite Pack. Existing tickets are relabelled, never converted or removed.

## Gems: where they come from (meta/gems.ts `GEM_REWARDS`, meta/loops.ts, meta/gemSources.ts)

| Source | Gems | When |
|---|---|---|
| Welcome gift | 50 | Once (also for a save from before gems) |
| Login calendar | 5 on day 3, 20 on day 7 | 25 a round of 7 claimed days |
| Daily sweep | 3 | All three daily challenges done, once a day |
| Weekly objectives | 10 each | Three a week |
| Free daily gems | 3 | One rewarded ad a day (where there are ads) |
| New player level | 2 | Every level |
| Achievements | 5, 10, 15 or 20 by size | Once each, about 250 in all |
| Board objective met | 5 | Three a season |
| Legacy level | 20 | Every level, forever |
| Promotion, league title | 15, 30 | Each season it happens |
| Blocky Cup, Continental Cup, World Club Cup | 25, 60, 100 | Each time it is won |
| Club Journey (free) | 5, 10, 15 on tiers 10, 20, 30 | 30 once per Journey; 12 shipped |
| Permanent Club Pass track | 20 to 30 on six tiers | 150 once per Journey |

**A keen free player earns about 100 gems a week from the loops alone** (25 + 21 + 30 + 21 = 97:
`weeklyLoopGems()`), and about 120 with the career, levels and the season track. That is roughly a dollar a week of
gems: enough to matter, never enough to make a pack pointless. A casual player (four days a week, no ads) earns 40
to 50.

## Gems: what they buy (meta/gems.ts `GEM_PRICES`, `GEM_SINKS`)

100 gems is the smallest pack ($0.99). Every price below is shown before the tap, and every spend goes through one
confirm sheet (ui/gemUi.ts `confirmGems`) that shows the price, the wallet and the free way to the same thing.

| Sink | Gems | About | The free way |
|---|---|---|---|
| Finish a build now | 20 a matchday left | $0.20 to $0.40 | Play the matchdays; one rewarded ad a day takes a matchday off |
| Heal a player now | 30 | $0.30 | He is back by himself after his matchdays out |
| Replay a lost decider | 50 | $0.50 | A rewarded ad replays one a day; the season carries on either way |
| A new deal today, with the exact next item and discounted coin price shown before charging | 15 | $0.15 | A rewarded ad once a day; the deal changes by itself daily |
| Scouting Network 1, 2, 3 | 200, 500, 1,000 | $2, $5, $10 | Gems earned by playing; the academy brings prospects every season without it |
| Club Pass (selected Journey) | 600 | $3.99 in the store is cheaper | Gems earned by playing; the free track pays every tier anyway |
| Permanent signature collection (any shipped theme) | 600 for six pieces; 100 for each missing piece | Guaranteed identity, never a pack | Earned gems buy exactly the same collection |
| Coins | 50 for 700, 150 for 2,400, 400 for 7,500, 1,000 for 22,000 | 14 to 22 coins a gem | Play |
| Cover a coin shortfall | 1 gem per 14 coins short | | Play |

**The Scouting Network** (`SCOUT_NETWORKS`, permanent, each tier bought once in order). The owner's idea was
"a higher chance of finding a generational talent"; a paid chance is a loot box, so each tier is a GUARANTEE instead:

| Tier | Gems | Every academy intake, from the next one on |
|---|---|---|
| LOCAL NETWORK | 200 | has a prospect with at least 4 potential stars |
| NATIONAL NETWORK | 500 | has a 5 star prospect |
| WORLD NETWORK | 1,000 | has a 5 star prospect and one more prospect |

tests/economyV3.test.ts runs the career's intake against each tier to prove the promise holds every time.

**Replay a lost decider** (main.ts, `MatchRequest.decider`). A Blocky Cup tie, a Continental or World Club Cup
knockout, or a title, promotion or survival decider on the last matchday. Lost, the game asks once, before anything
is recorded: PLAY IT AGAIN for 50 gems, or a rewarded ad (once a day), or NO THANKS. One replay a match: the replay
itself can't be replayed. A match that isn't a decider is never offered.

## What we copied, and from whom

| Pattern | Who does it | In Blocky League |
|---|---|---|
| A season pass with a free and a paid track, priced for casual players | Dream League Soccer ($3.99), Brawl Pass, Pass Royale, Subway Surfers | **Club Pass**, $3.99 per permanent Journey (meta/pass.ts) |
| Mid-season buyers get every tier already reached | Dream League Soccer | Buying late unlocks all reached tiers at once |
| A one-time starter pack worth far more than its price, offered after a first win | Subway Surfers, Soccer Stars | **Welcome offer** after the first win (once, no timer) |
| A permanent coin doubler | Subway Surfers ($4.99), Crossy Road's Piggy Bank ($2.99) | **Coin Doubler**, $4.99: match coins ×2 for good |
| A first-purchase bonus on currency packs | EA FC Mobile's "2X Top Up" | **First buy ×2** on each gem pack, once |
| A soft and a premium currency, the premium one earned slowly in play | Clash Royale, Brawl Stars, Dream League Soccer | **Coins and gems**; gems from the board, cups, the calendar and weekly objectives |
| Premium currency skips a wait | Clash of Clans builders, Hay Day | **FINISH NOW** a stadium build, **HEAL NOW**, at a shown price |
| A one-time bundle as the price anchor | Subway Surfers, Brawl Stars value packs | **PRO bundle** $9.99: NO ADS, the Coin Doubler and 600 gems |
| A login calendar that forgives a missed day | Subway Surfers, Hay Day | **7 days**, counting the days claimed, never days in a row |
| Decoration that pays | Hay Day, SimCity BuildIt, Top Eleven's facilities | **Atmosphere**: stadium style and mascots raise matchday income and the crowd |
| A rotating daily shop | Rocket League (24 h) | **Today's deal**: one look a day at 25% off |
| Rarity tiers that show status | Brawl Stars skin tiers | COMMON, RARE, EPIC, LEGENDARY and CLUB PASS badges |
| Kits and player looks you see every match, the team in the kit you bought | Dream League Soccer kits, FIFA Mobile kits, Fortnite outfits | **Premium kits**, **player looks** and **stadium style** (Cosmetics 2.0, below) |
| Themed bundles at a discount, priced on what you don't own | Fortnite item shop sets, Brawl Stars skin bundles, Clash Royale offers | **Themed sets**: 6 matching looks at 40% off; COMPLETE THE SET charges only for the missing parts |
| A featured shelf that changes on a fixed day | Fortnite and Rocket League item shops | **This week** on FEATURED: a set and four looks, new every Monday, everything also on sale in its tab |
| Try before you buy | Fortnite locker preview, Clash Royale emote preview | **TRY IT ON**: your whole team in the look, with your ball, lawn and goal explosion |
| Opt-in rewarded ads at natural moments, capped | Crossy Road, Subway Surfers, Dream League Soccer | FREE COINS (5 a day), double coins at full time, double the daily gift |
| Free random rewards that can't be bought | Brawl Stars' Starr Drops (after it removed paid loot boxes) | **Scout Tickets**: packs cost earned-only tickets |
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
4. **Come back:** the 7-day calendar (it counts up whatever the gaps: gems on days 3 and 7), three daily challenges
   (each also a Scout Ticket, and 3 gems for all three), three weekly objectives (coins and 10 gems each), today's
   deal, the free daily gems, the twelve permanent Journeys and their optional passes, and the build that opens after your next match.

## Pacing: what a player has, and is offered, on day 1, day 7 and day 30

Coin totals vary with results, difficulty, streaks, career prizes and optional ads; they are not a promised daily
income. Quick-match base fees are listed below; tests/economyV3.test.ts pins the gem numbers. KEEN is about 6 matches a day, every day, with the
challenges, the calendar and the optional ads; CASUAL is 2 or 3 matches, four days a week, no ads.

| | Day 1 | Day 7 | Day 30 |
|---|---|---|---|
| Gems earned so far, keen | about 70 (50 welcome, levels, the first win, the sweep) | about 200 | about 650 |
| Gems earned so far, casual | about 60 | about 100 | about 250 |
| What coins have bought (keen) | 3 or 4 COMMON looks, or the Retro set's first parts | A RARE or EPIC look a day; an EPIC set; the main and family stands | The effects and balls catalogue, or most of the ground and two LEGENDARY looks |
| What gems can do (keen) | One replay, or two finished builds | The first Scouting Network (200), or a few replays and builds | One signature identity (600), the Club Pass (600), or saving toward the first two Scouting Networks (700) |
| What the game offers | The welcome gift; after the first win, the Starter Pack once ($1.99: 2,000 coins, 150 gems, the Gold ball), no timer | FIRST BUY X2 on every gem pack; the Club Pass ($3.99 or 600 gems) with its value on the card; the PRO bundle ($9.99) | The next Scouting Network; LEGENDARY sets a few gems short; another permanent Journey |
| Why come back tomorrow | Calendar day 2, three new challenges, the free pack, today's deal | Day 7 of the calendar (20 gems), the week's objectives, the stand that opens after the next match | A new season and its pass, the board's objectives, legacy levels that never run out |

A payer's first dollar: $0.99 is 200 gems the first time (100 after), which is four replays, or the first Scouting
Network, or about 2,800 coins: an EPIC look outright. $4.99 the first time is 1,200 gems: the Club Pass and the first
two Scouting Networks.

**Coin faucets** (ordinary rewards retained; quick-match fee pacing revised in v4):

| Faucet | Coins | Notes |
|---|---|---|
| Quick match | Normal base: win 110, draw 60, loss 35, plus 12 per goal up to three | Difficulty factors 0.8, 1, 1.25, 1.45. Existing win streak, atmosphere, grade and Coin Doubler multipliers still apply; a rewarded ad doubles it once |
| Daily challenges | 100 to 220 each, three a day | Each also a Scout Ticket |
| Login calendar | 100 up to 400 a day, 1,750 a round | A rewarded ad doubles the coins |
| Weekly objectives (NEW) | 300 to 400 each, three a week | With 10 gems each |
| FREE COINS | 75 an ad, 5 a day | Optional |
| Atmosphere (NEW) | Up to +12% of a home match, and a mascot's 20 to 60 a home match | Capped: see below |
| Season track | About 3,900 once per Journey free, 5,560 more with its permanent pass | |
| Career | Prizes, the board's objectives, the megastore, the big screen | See below |
| Gems | 14 to 22 coins a gem | Currency packs convert to coins here; the one-time Starter Pack also includes 2,000 coins |

**Coin sinks:** the looks catalogue (about 187,000), the ground (about 35,600), players in the transfer market,
training, and what the career adds (staff, facilities). Ordinary prices remain unchanged and every signature set
also accepts earned gems. Tests/economy.test.ts and tests/economyV3.test.ts pin the existing catalogue and rewards.

A Normal quick win with two goals pays **134 base coins**, a 0–0 draw 60, and a scoreless completed loss 35.
Three goals reach the win cap of 146; twenty goals pay the same base fee. Win streaks still multiply wins up to ×2.
Losses always pay, play is never limited by energy, and already earned currency is never reduced.

| Tier | Price | For a free player |
|---|---|---|
| COMMON | 250 to 450 | Two to four matches. Something new in the first session |
| RARE | 500 to 900 | A day |
| EPIC | 1,000 to 2,800 | A few days |
| LEGENDARY | 4,500 to 7,500 (Supernova, Diamond Rain, Meteor Strike, Black Hole, Lightning and Comet Tail trails, Diamond and Planet balls; the Galaxy, Gold Pinstripe, Glow In The Dark and Gold Foil kits; the Crown and Light Up Boots; the Pyro Show and Dragon Mascot) | One to three days each, **88,800 for them all**: weeks |
| SIGNATURE | Not for coins | Twelve permanent Journeys or guaranteed immediate collections, including with earned gems |

The effects, balls and celebrations cost about 86,000 coins, about a month of keen free play; Cosmetics 2.0 adds
about 100,900 more (kits 36,550, player looks 33,250, stadium style 31,100), so the whole catalogue is about 187,000:
with progress depending on play and purchases, less with the sets at 40% off. A free player can own it all eventually,
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

**Stadium style does something now: CLUB ATMOSPHERE** (meta/atmosphere.ts; the owner: "mascots and shit feel useless
why would i want that, like make them useful and worth it"). Every stadium style item you own AND wear, and every
part of the ground you have built, adds to your club's atmosphere. At every home match that means matchday income
(more coins from the match), a fuller ground, more chants from the home crowd, and a mascot's half time show that
pays a few coins. Each item says exactly what it adds on its shop card and tile, and the STADIUM tab's header shows
the total ("ATMOSPHERE 62: +9% INCOME, +8% CROWD, +2 CHANTS, SHOW +35").

| Slot | Items and what each adds while worn |
|---|---|
| Pitch | Mown Checks +1% income, Diagonal Stripes +1%, Mown Circles +2%, Centre Crest +3% |
| Nets | Club +1%, Hex +1%, Rainbow +2%, Neon +3% |
| Corner flags | Club +1%, Chequered +1%, Flame +2% |
| Seats | Name In The Seats +3% |
| Crowd | Flag Wave +1 chant, Giant Tifo +2 chants and +1% |
| Kick off | Confetti Walkout +3% crowd, Fireworks +6%, Pyro Show +10% and +1 chant |
| Floodlights | Club +2% income, Light Show +4% |
| Mascot | Bear: half time show +20 coins and +1 chant; Robot +35 and +1; Dragon +60 and +2 |
| The ground | Floodlights, each end, the big screen +2% crowd; the dome and the fan zone +3% crowd and +1 chant |

**Capped, so it is a nice boost and never a paywall:** income +12% (`INCOME_CAP`), crowd +12 points (`CROWD_CAP`),
chants +4 (`CHANT_CAP`: each one makes the crowd sing a fifth more often). Every cap is reached with mid-priced
items and no LEGENDARY one (a test proves it), so the dearest looks are for the look. It is the meta only: coins,
the crowd and the noise. Nothing here touches a rating or the match, and all of it is bought with coins.

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

**Road to Glory seasons and the Blocky Cup.** A season is home and away: 14 league matchdays plus up to 3 Blocky Cup
ties (the quarter-final after matchday 4, the semi-final after 8, the final after 12). An ordinary league match can be
settled with SIM THIS MATCH for half its coins (src/meta/week.ts `SIM_PAY`); derbies, deciders and cup ties are always
played. The cup is no longer a mode of its own.
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
starting again as a legend). All of it is earned in play. Since v3, gems can skip a WAIT here (finish a build, heal a
player) and buy a Scouting Network guarantee; each has a free way to the same thing, and nothing else is for sale.

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
league matchdays (builds finish over the summer between seasons). FINISH NOW opens it at once for 20 gems a matchday
left, and one rewarded ad a day takes a matchday off (MY CLUB > STADIUM); waiting is always free.

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

Money buys gems, never coins: one ladder, and the rate gets better at every step (101, 110, 120, 130 and 150 gems a
dollar). Nothing costs more than $19.99 (`MAX_PRICE_USD`, a test enforces it): no whale packs in a game children play.

| Product | Id | Type | Price | What you get |
|---|---|---|---|---|
| 100 gems | `bl.gems.100` | Consumable | $0.99 | 200 on the first buy |
| 300 gems (+10%) | `bl.gems.300` | Consumable | $2.99 | 330; 660 on the first buy |
| 500 gems (+20%), POPULAR | `bl.gems.500` | Consumable | $4.99 | 600; 1,200 on the first buy |
| 1,000 gems (+30%) | `bl.gems.1000` | Consumable | $9.99 | 1,300; 2,600 on the first buy |
| 2,000 gems (+50%), BEST VALUE | `bl.gems.2000` | Consumable | $19.99 | 3,000; 6,000 on the first buy |
| Starter Pack | `bl.starter` | Non-consumable | $1.99 once | 2,000 coins, 150 gems and the Gold ball. Offered once after the first win, no timer |
| NO ADS | `bl.noads` | Non-consumable | $3.99 once | No interstitials. Rewarded ads stay, by choice |
| **Club Pass** | `bl.pass` | Consumable | $3.99 per permanent Journey, or 600 gems | 5,560 coins and 150 gems plus a six-piece identity: welcome ceremony, player look, trail, kit, goal explosion and diamond nets |
| **Coin Doubler** | `bl.doubler` | Non-consumable | $4.99 once | Every match pays double coins, for good |
| **PRO bundle** | `bl.pro` | Non-consumable | $9.99 once | NO ADS, the Coin Doubler and 600 gems: $13.97 one by one, so 28% off. Shown only while neither part is owned |

The four coin packs of v2 (`bl.coins.*`) are gone. The STORE tab (ui/shop.ts) has four sections: GEMS (the packs,
the free daily gems, where gems come from in play), COINS (gems for coins, FREE COINS, the Coin Doubler), OFFERS (the
PRO bundle, the Starter Pack, NO ADS, the Coin Doubler) and CLUB (the Scouting Network, and what else gems do). The
Club Pass card stays beside all four, with both of its prices. On the web and the portals there is no store: the
tab still swaps gems earned by playing.

## The Club Pass (meta/season.ts, meta/pass.ts)

- Twelve shipped Club Journeys each have 30 tiers (4,200 XP). Players select one track to progress and can switch
  freely. XP, claims and its optional paid pass stay with that track indefinitely. Nothing resets on a date.
- The pass retains 5,560 coins and 150 gems, and now earns six identity pieces. Its **Star Ceremony is granted
  immediately on activation**, including zero-XP purchases. Tier 1 retains its 60 coins. The remaining pieces are
  earned through tiers: player look at 5, trail at 10, kit at 15, goal explosion at 20 and **Signature Nets at 25**
  alongside that tier's existing 700 coins. Tier 30 retains 1,800 coins. The existing themes include a snow tornado, a snowflake
  knit kit and a bobble hat in January; a mud splat, a mud splattered kit and mud stompers in February; flowers, a
  blossom kit and a flower crown in March; rain clouds, a raindrop kit and rainbow shades in April; a trophy, a white
  and gold trophy kit and a trophy armband in May; a big wave, beach stripes and surf shades in June; a grinning sun, a
  heat haze kit and a sun visor in July; a ball barrage, a training bib kit and camp gloves in August; a leaf gust, a
  harvest plaid kit and harvest curls in September; searchlights, a purple kit with glowing lines and floodlight boots
  in October; Catherine wheels, an ember kit and sparkler gloves in November; presents, a festive knit and a winter
  hat in December.
- If bought after progressing, every reached tier is claimable at once. Every unclaimed reward waits indefinitely.
- The existing consumable store product unlocks one selected Journey permanently. It can be bought for other
  Journeys; an already owned Journey refuses a second upgrade. It is not a subscription.
- **Its value is on the card** (the STORE tab and the JOURNEYS screen): +5,560 coins, +150 gems, 6 pieces and no expiry. Already owned pieces are counted so they are not advertised as new looks. Six pass tiers pay gems (3, 8, 13, 18, 23 and 28: `PASS_GEMS`), a quarter of what the pass costs in gems.
- **It can be bought with gems** (600, `GEM_PRICES.clubPass`), in every build. Gems are earned by playing, so a keen
  free player can earn the pass and its looks in about six weeks; the store's $3.99 is the cheaper way for a payer.

The permanent selected-track pattern has a shipped precedent: [Halo Support's official FAQ](https://support.halowaypoint.com/hc/en-us/articles/4408373413268-Halo-Infinite-Battle-Pass-Free-to-Play-FAQ)
explains that its passes remain available and XP advances the selected pass. This supports a design choice, not a revenue guarantee.
Blocky's free tracks also remain available indefinitely. No monthly content update is needed to keep any shipped Journey usable.

**Save compatibility:** the active legacy YYYY-MM ID remains its exact gem receipt namespace. Inactive tracks are saved
by their stable pass01..pass12 identity, with independent XP, free claims, permanent paid entitlement and paid claims.
Switching archives the old track before restoring the new one. Old wallets, IAP transactions, owned cosmetics, titles
and carry balances remain intact. Pending store payments keep the originally selected target across restarts; gem
upgrades are blocked while that payment is pending. No live product ID or price changed.

## Signature collections: lasting club identity

The shop's SIGNATURES tab previews the complete club and each of its six actual pieces. A full-club preview shows
the equipped strip, captain's look, goal show, nets and ceremony together; individual previews also show the trail.
EQUIP ALL SIX applies their existing match settings together. The club crest, ball, ground, roster and match stats
remain yours. Nets use a luminous diamond weave in the collection palette on both goals. The ceremony builds a
suspended constellation star by star and sheds jewels over the stand at walkout, scoring and a victory. It stays
clear of the playing surface and uses the existing pooled FX/disposal lifecycle.

All twelve shipped identities are **always available**, at 600 gems for all six pieces, reduced by 100 gems for each piece
already owned. The confirmation lists the exact missing items and charge. All bought pieces are granted and equipped
immediately and permanently; duplicate purchases charge nothing. Each identity also has a selectable permanent
Club Journey, whose optional Club Pass unlocks its tier rewards. Buying a collection does not buy or reset its Journey.
Owned pieces never expire, and neither option has a countdown or random draw.
Earned and purchased gems buy identical collections. Signature pieces add no player stats or economic bonuses.

Existing passes receive missing welcome ceremonies from their ownership receipts. An already claimed tier 25 receives
the new nets; durable past tier-28 gem receipts also restore both new pieces. Coins and
gems are never paid again by this migration. New decor IDs, ownership and equipped slots survive export/import, and
legacy carried coins, gems and identity pieces remain claimable exactly once.

## Ethics: kids play this

- **No paid random rewards.**
  - Packs cost Scout Tickets, earned only (one per daily challenge done, calendar day 5, plus the free daily pack) and
    never sold. Neither money, gems nor coins can buy a random card.
  - Every gem sink is a stated outcome. The Scouting Network is a guarantee ("every intake has a 5 star prospect"),
    never a chance; a test runs the academy against it.
  - A paid deal refresh shows the exact next look and its discounted coin price before spending; it buys a disclosed
    discount, not an unknown draw. Store questionnaires must describe the actual mechanics; no age rating is guaranteed.
  - A specific player is still bought directly with coins in the transfer market. That is a known, chosen item.
  - Injury offers disappear once the player is fit or has left. Coins or gems are never charged from an obsolete
    treatment card. One-time gem rewards retain their payout receipts across long careers and reloads.
- **Honest sets and shelves.** A set's price is its missing parts at a fixed 40% off, shown against what they cost
  alone; every part is on sale on its own; the FEATURED shelf changes on Mondays and shows no countdown.
- **No fake scarcity.** The deal rotates daily and every look comes round again. The welcome offer has no timer and
  says it stays in the shop. All twelve signature themes and their permanent Journeys are available indefinitely.
- **Absence is never punished.** The login calendar counts the days you claim it, not days in a row, so a missed day
  costs nothing. A week's objectives last the whole week; a missed week owes nothing. PEGI now rates "punishing
  absence".
- **No energy, no timers, no pressure.** A build takes MATCHDAYS (play, not a clock), so nothing ever stops you
  playing. There is no countdown on any offer, and gems are never needed to progress: every sink names its free way
  (`GEM_SINKS`, on the confirm sheet).
- **Every gem spend is confirmed once, with the price** and the wallet beside it (ui/gemUi.ts). Short of gems, the
  sheet says by how much and never starts a purchase by itself.
- **A price ceiling.** The dearest product is $19.99.
- **Ads are the player's choice, at the right moment, capped per day** (meta/loops.ts `AD_CAPS`: the daily gems, a
  replay, a build's matchday, a new deal: one each; FREE COINS five). No banners, in matches or in menus, and no
  offerwalls: see below.
- **No pay-to-win.** Everything bought is a look, coins, gems, a skipped wait or no ads. Atmosphere is coins and
  crowd noise, never a rating. A replay is the same match again, at the same difficulty. Online friendlies use preset
  clubs, so nothing bought ever meets another player.
- **Kid-safe ads.** Every request is child-directed, family-rated, never personalised, with no tracking prompt
  (src/platform/adConfig.ts).
- **One currency for money.** Gems are the only currency sold. Scout Tickets can't be bought. The shop shows the
  store's real price string, and what every pack hands over in full (the first-buy doubling included).

### Why no banner ads, and no offerwall

- **A banner on the menus: no.** A child-directed, non-personalised banner earns very little (a few cents per
  thousand views), sits on the screens the owner likes most, invites accidental taps from small fingers (which Apple
  reviews harshly in a 4+ game) and makes every menu look cheaper, which costs more in purchases than it earns.
  Ads before later kick-offs and optional rewarded videos remain available, and NO ADS removes those ad breaks.
  Revisit only with real numbers: if rewarded-ad fill is poor after launch, test a single banner on the full-time
  screen for non-payers before anywhere else.
- **Offerwalls: no.** They send children to third-party apps and surveys, and no kid-safe network offers one.
- **Reviews are never gated.** Apple's own prompt appears after a win, rarely (platform/review.ts). Anyone can email
  feedback from Settings.

## Realistic expectations

- About 1 to 2% of players ever pay (Unity 2024: 1.83%). Typical casual revenue from purchases is $0.02 to $0.10 a day
  per active player; kid-safe ads earn less than tracked ones.
- What moves the number is players and retention, not squeezing harder: get downloads (TikTok, Shorts, featuring) and
  keep them playing.
- Measure before changing prices. Watch conversion on the welcome offer, pass buy rate by Journey progress, and how many
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
| Gem prices, the Scouting Network, gems for coins | src/meta/gems.ts `GEM_PRICES`, `SCOUT_NETWORKS`, `COIN_OFFERS`, `COINS_PER_GEM` |
| Gems from play, the welcome gift, season and pass gems | src/meta/gems.ts `GEM_REWARDS`, `WELCOME_GEMS`, `SEASON_GEMS`, `PASS_GEMS`; src/meta/gemSources.ts |
| Gem packs, the PRO bundle, the price ceiling | src/platform/iap.ts `CATALOGUE`, `MAX_PRICE_USD` |
| Atmosphere: each item's bonus and the caps | src/meta/atmosphere.ts `DECOR_BONUS`, `PART_BONUS`, `INCOME_CAP`, `CROWD_CAP`, `CHANT_CAP` |
| The login calendar, weekly objectives, ad caps | src/meta/loops.ts `CALENDAR`, `WEEKLY_POOL`, `AD_CAPS` |
| Which matches can be replayed | src/ui/career.ts (`decider` on the match request), src/main.ts |
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

## Shipped long-game progression

Road to Glory now has eight divisions: Park, District, Sunday, County, National, League One, Championship and Elite.
The new two divisions sit below the original six; imported clubs keep their exact division, squad and current fixtures.
The established division 1..6 strength, match income, season prizes and away-ground scale remain unchanged. New clubs
start at a level suited to Park League. Seven promotions lead to Elite, followed by the existing continental/world
competitions, repeated seasons, living academy and Hall of Fame. No clock gates play.

The five mastery tracks now have eight tiers. The original first five thresholds, coin rewards and titles remain intact.
Tier V and VIII grant existing visible cosmetic looks without charging the wallet; grants are idempotent and retroactive
for old mastery progress. Higher tiers display coloured earned prestige, and a title can equip its associated look from
TITLES. Career promotion, titles, cup/continental/world wins and trebles unlock additional honours, archived permanently
when earned so restarting a club cannot erase them. Match results create stable varied football headlines; previews,
reloads and stale results cannot replay the same news beat.

Automatic ads do not run at halftime. A later kickoff may offer the existing automatic ad only after the paid result
screen has been visible for at least eight seconds. No ads interrupt a live attack, a replay, or a half-time team talk.

The existing Game Center `bl.lb.season` / Best Season board retains its live monthly definition for compatibility.
Permanent Journey IDs do not submit to that legacy board; goals, wins and win streak leaderboards continue to work.
No Game Center ID was repurposed or newly configured.
