# Blocky League economy v5 — 6 October 2026

The economy now has a reproducible time model, a review spreadsheet, and explicit boundaries between match fees,
fixed prizes and repeatable rewards. This replaces older estimates and unverified competitor/pricing claims.

## 15 October 2026: the whole economy checked (economy v7)

The owner: "make sure the game economy for the whole game is balanced". Until now the model played quick matches,
claimed everything and spent nothing. This pass plays ROAD TO GLORY itself, matchday by matchday on the game's own
engine, with a manager who spends, and holds the result to 22 stated bars. Model: `npm run economy:model`
(`scripts/economy-model.ts` `modelCareer`, `buildCareerModel`). Workbook sheets Career By Season, Career Tables,
Balance Checks and Ads. Tests: `tests/economyCareer.test.ts`.

**Verdict.** For the first five to six weeks of daily play the economy balances: 20 of 22 checks pass. At the top
it does not: coins outrun every sink, and players cost no coins. Those two need a design decision, not a number,
and are left as FAIL on the sheet. (A third, an ad worth too much, was settled the same day: see item 3 below.)

### What was checked

Three careers over 180 days, every match a career match: learning (45/25/30, 3 days a week, 2 matches), regular
(60/20/20, daily, 3 matches) and strong (75/15/10, daily, 6 matches, every ad). The mix holds when the two elevens
are level on Normal; each rating point between them moves 1.5 points of a hundred between wins and defeats (25 at
most), Hard takes 10 off the wins and Legend 20. The manager keeps three matchdays of staff wages, builds the
cheapest part of the ground, hires staff in order while their wages stay under half of what a league matchday
brings, opens every pack (a card is signed when it beats a starter and the wage budget allows, else sold), signs or
trains only when the eleven is under its division's par, and buys the Local network, the Club Pass, then the other
networks with gems. The rest is saved. These are assumptions, not telemetry.

| Career, 180 days | Learning | Regular | Strong, every ad |
|---|---:|---:|---:|
| Promotions (season and day) | 6: seasons 2, 3, 4, 6, 8, 9 (day 174, Championship) | Elite League in season 8, day 45 | Elite League in season 7, day 20 |
| Coins in and out a season, Park League | 17,600 / 15,500 | 15,400 / 13,000 | 21,800 / 18,200 |
| Coins in and out a season, Elite League | not reached | 32,000 / 6,200 | 61,400 / 6,400 |
| Lowest balance after spending | 50 | 50 | 259 |
| Matchdays staff unpaid or wages drained | 0 | 0 | 0 |
| Whole ground, day | 50 | 15 | 7 |
| Every member of staff, day | not inside 180 | 34 | 15 |
| Top look (7,500) in the wallet, day | 45 | 13 | 7 |
| Local network, Club Pass, all networks, day | 22, 87, beyond 180 | 5, 22, 66 | 3, 9, 31 |
| Coins in the wallet on day 180 | 163,000 | 638,000 | 2,413,000 |
| Share of coins from club income / from ads | 9% / 0 | 7% / 0 | 4% / 31% |
| Level 10 and level 30, day | 34, beyond 180 | 9, 151 | 4, 69 |

A regular player's Scout Tickets: 359 earned, 359 spent, 122 cards signed and 417 sold for their resale credit
(4% of his coins): a ticket always has a use. His gems: 4,569 earned, 2,300 spent on the four permanent goals by
day 66.

### Findings

| Check | Bar | Before | After | |
|---|---|---:|---:|---|
| Club income against the rest of a day's coins, worst profile and stage | under a quarter | 26.6% | 22.3% | PASS |
| Sponsor: CASH NOW at every call against EVERY MATCH | no answer a quarter better | 2.37 times (368 against 155 a matchday) | 0.95 (148 against 155; WIN BONUS 185) | PASS |
| Sign a scout's find and sell him at once | no profit | 10 to 40 coins a find | 0 | PASS |
| Staff unpaid or wages drained, careful manager, every division | never | 0 | 0 | PASS |
| Staff wages against league matchday income, worst season | under two thirds | 47% | 47% | PASS |
| A collector who signs every better card: wages, drain and contracts against all he earns | under 100% | 54% | 65% | PASS |
| Longest wait for the next part of the ground, regular | 8 matches | 7 | 7 | PASS |
| Whole ground, regular | 6 weeks | day 15 | day 15 | PASS |
| Mid look, top look in the wallet, regular | 5 days, 3 weeks | day 4, 13 | day 4, 13 | PASS |
| Coins that need no match against coins from matches, worst profile | under 100% | 70% | 68% | PASS |
| Buy, play six starts, sell: expected profit | two league wins | 1.5 | 1.4 | PASS |
| Scout Tickets left unspent, regular | under 5% | 0 | 0 | PASS |
| Dearest gem goal on a portal, slowest profile | inside a year | day 231 | day 231 | PASS |
| No ads against every ad, days to each goal, worst | twice the time | 1.7 | 1.7 | PASS |
| Share of coins from ads, regular who watches every one | under half | 33% | 32% | PASS |
| Share of a regular player's spending on players | at least a tenth | 0 | 0 | FAIL |
| Day a regular player has paid for every coin sink in the game | not inside 60 days | day 56 | day 57 | FAIL |
| The daily gift's 2X ad against a won match, worst stage | about one win (1.25 at most) | 1.8 with the office doubled | 1.07 | PASS |

### What was changed

Three numbers. Nothing a player owns or was paid is touched; saved wallets load as they are.

| File | Before | After | Why |
|---|---|---|---|
| `src/meta/clubIncome.ts` `TICKET_OFFICE` | 16 / 19 / 22 / 25 / 28 / 32 an hour (52 and a 416 office at most) | 16 / 18 / 20 / 22 / 24 / 26 (43 and 344) | A keen player's office was 26.6% of the rest of his day, over the quarter |
| `src/meta/events.ts` `SPONSOR_GAP` | a new sponsor 3 matchdays after the last | 8 | CASH NOW pays 8 matches' worth; taken every 3 matchdays it paid 2.4 times a running deal |
| `src/meta/staff.ts` `REGIONS.home.fee` | 0.75 | 0.8 | A home youth find cost 0.45 of his price and a quick sale paid 0.47 |

The 14 October tables below were measured at the old ticket office. With the new one a daily player's 90 days are
211,382 coins (Regular), 368,767 (Keen), 89,948 (Casual) and 48,247 (Learning): 22 to 26% more than before the
come-back features instead of 24 to 28%. Gems are unchanged.

### Left alone on purpose, for the owner to decide

1. **Coins pile up at the top.** The ground (35,600) and the staff (24,900 in fees) are finished before the County
   League, on days 15 and 34. From there a regular player takes in about 32,000 coins a season and spends 6,200
   (staff wages and contracts). He can pay for every look in the shop (187,000) by day 57, a strong player who
   watches every ad by day 24, and then about 24,000 coins a week have nowhere to go. No small number fixes this
   without spoiling the early game, which is tight (a lowest balance of 50). It needs late sinks: dearer club
   projects opened by division, real player wages, or new looks. START A NEW CLUB AS A LEGEND is the one that exists.
2. **Players cost no coins.** Pack cards are drawn against the club's own eleven, four a day for nothing. A regular
   player's eleven is 7 over par after one season and 11 to 20 over from there to League One, with 0 coins spent on
   transfers or training in 180 days. Only a player who outruns his cards (six matches a day) uses the market
   (43,000). The lever is `RARITY_OVR` in `src/meta/shop.ts`, or drawing against the division's par.
3. **The welcome sheet's ad (settled).** With the ticket office doubled too it added 429 coins a day in week one,
   when a won match pays 233: 1.8 wins for one ad. The office doubling was taken out of the game the same day
   (`src/ui/comeback.ts`). The gift's own 2X is left as it has been since economy v2: 250 coins on average in a first
   week, 1.07 wins, once a day, and its bar is "about one win" (1.25).
4. **The wage brake is silent on cards.** The market refuses a signing over the wage budget; a pack card signs
   anyway. The collector's drain reaches 190% of what his league matchdays bring and his ground comes 13 days late.
   A squad relegated on the wage bill of the division above is drained 1,185 coins a matchday in the County League
   until players are sold. The rule works; the reveal and the hub should say so.

Limits: who wins is assumed. Club Run, online play and SIM THIS MATCH are not simulated. The ad rewards were
modelled as built (the gift's 2X, HEAL A PLAYER, the replay, the half time interstitial). Interstitials at two minute halves come to one a match, ten an hour: half time falls inside the portal's
three minutes after a kick-off ad.

### Invariants (tests/economyCareer.test.ts, economyBalance.test.ts, comeback.test.ts, clubIncome.test.ts)

- A free player can earn everything: every goal above is reached with no ad and no purchase.
- Gems are never required to progress: the only gems that leave are the permanent goals a player chooses.
- Nothing random is sold: Scout Tickets are earned only.
- Missing a day costs nothing: the office waits full, the calendar keeps its place.

## 14 October 2026: coming back (economy v6)

CrazyGames' reviewer: "We believe average playtime and retention can be improved further. You can add more progression
features." Day 1 retention was 4.3%. This pass adds reasons to come back tomorrow and proves the economy still
balances with them. No price changed. Rules: `src/meta/comeback.ts`, `src/meta/clubIncome.ts`. Model: `npm run
economy:model`; workbook sheets Coming Back, Come Back Sources, Club Income and Portal.

### What changed

| New source | What it pays | Limit |
|---|---|---|
| Welcome week | The first time each calendar day is claimed: day 2 the Melon ball and a Scout Ticket, day 3 +15 gems, day 4 a Scout Ticket, day 5 the Tiger kit, day 6 +5 gems, day 7 the Big Afro | Once per save. 1,900 coins of looks, 20 gems, 2 tickets in all. A look already owned pays its coin price instead |
| Play streak | The first completed match of a local day: 20 coins on day 1 up to 80 from day 7; 2 gems on day 3, 3 on day 5, 5 on every 7th; Music Notes trail on day 7, Rainbow goal on day 14, Halo on day 30 | One missed day a week is forgiven. A longer break halves the streak, never zeroes it. Each look once |
| Try today | One look not owned (ball, trail, goal explosion or celebration), free for one completed match a day | Pays nothing. KEEP IT is the shop price |
| Match of the day | 100 coins and 3 gems for completing the day's featured Moment | Once a local day |
| Club income | The ticket office: 16 / 18 / 20 / 22 / 24 / 26 coins an hour by ground level (15 October: it was 16 / 19 / 22 / 25 / 28 / 32), +5 with the megastore, +10 / 20 / 30% with the commercial manager, up to +10% for atmosphere. 43 an hour at the very most | Stops after 8 hours (344 coins at most). The clock only moves forward |
| FREE GEMS on a portal | The same 3 gems for one ad | 2 offers a day on CrazyGames and Poki (the apps keep 1); the owner's limit is 3 |

### Before and after (gross coins / gems, same seeded matches)

| Profile | Day 1 | Day 7 | Day 30 | Day 90 |
|---|---|---|---|---|
| Learning, no ads | 1,242 / 79 to 1,362 / 82 | 3,315 / 96 to 3,741 / 114 | 12,520 / 192 to 15,132 / 218 | 38,389 / 468 to 48,951 / 527 |
| Casual, no ads | 1,289 / 79 to 1,409 / 82 | 4,679 / 100 to 5,385 / 121 | 25,510 / 356 to 29,844 / 409 | 73,490 / 757 to 91,244 / 888 |
| Regular, no ads | 1,420 / 79 to 1,540 / 82 | 14,447 / 222 to 16,421 / 270 | 57,259 / 612 to 68,837 / 720 | 171,380 / 1,391 to 215,526 / 1,677 |
| Keen, optional ads | 3,597 / 98 to 3,845 / 101 | 29,830 / 383 to 32,976 / 434 | 127,682 / 960 to 150,032 / 1,089 | 297,761 / 1,758 to 378,511 / 2,095 |
| Regular + Coin Doubler | 1,690 / 79 to 1,810 / 82 | 17,449 / 222 to 19,463 / 270 | 68,971 / 612 to 80,837 / 720 | 205,158 / 1,391 to 250,040 / 1,677 |

A player who comes back every day earns about a quarter more coins and a fifth more gems over 90 days. That is the
point of the pass and it is the whole of it: for Regular the 44,146 extra coins are 30,456 club income, 6,990 streak
and 6,700 match of the day; the 286 extra gems are 201 match of the day, 65 streak and 20 welcome week. Looks handed
over (5,900 coins of them by day 30 for a daily player) are items, never coins.

Club income against the rest of a profile's coins, a day: Regular 6.9% in week one, 13.6% in days 8 to 30, 18.8% in
days 31 to 90. Casual 9.3 / 11.7 / 20.6%. Learning 8.6 / 19.5 / 22.6%. Keen, collecting twice a day, 6.9 / 15.0 /
26.6%: the most anything added up to, over a quarter. (15 October: `TICKET_OFFICE` came down and the same figures are
Regular 6.6 / 12.3 / 15.9%, Casual 9.3 / 10.7 / 18.5%, Learning 8.6 / 18.1 / 20.5% and Keen 6.4 / 13.1 / 22.3%.)

Weekly ceiling of gems from the loops: 97 with the daily ad becomes 123 in the apps (76 becomes 102 without ads), and
144 on a portal with both offers. The tuned band stays 80 to 160; three portal offers would have made it 165.

### The portal: days to afford with nothing for sale

Every coin or gem saved for the goal (in brackets: 40% of coins beside the club, 75% of gems).

| Goal | Casual, one ad a visit | Regular, no ads | Keen, every offer |
|---|---:|---:|---:|
| Local Scouting Network, 200 gems | 12 (14) | 5 (7) | 3 (4) |
| Club Pass, 600 gems | 42 (61) | 22 (32) | 12 (17) |
| National network after Local, 700 gems | 49 (73) | 28 (40) | 15 (22) |
| World network, all three, 1,700 gems | 162 (224) | 91 (138) | 55 (84) |
| Club Pass and all three, 2,300 gems | 231 (336) | 143 (210) | 86 (126) |
| Main stand, 800 coins | 1 (1) | 1 (1) | 1 (1) |
| Mid look, 1,200 coins | 1 (3) | 1 (2) | 1 (1) |
| Top look, 7,500 coins | 10 (19) | 4 (8) | 2 (4) |
| The whole ground, 35,600 coins | 35 (89) | 15 (38) | 8 (18) |

The modelled club (40% of coins into the ground, cheapest part first) reaches ground levels 1 to 5 on days 7, 10, 50,
77 and 101 at a casual rate, 3, 5, 22, 35 and 44 at a regular one, and 2, 3, 11, 18 and 22 at a keen one.

FREE GEMS: a casual player who takes one offer a visit is unaffected by the number of offers (Club Pass on day 42
whatever it is). For a keen one a second offer brings the Club Pass from day 14 to day 12 and every network from day
64 to day 55 (270 more gems in 90 days); a third would bring day 10 and day 47. Two was chosen: more generous, and
inside the band. No price is out of reach on a portal (the dearest goal is long and still inside the modelled year),
and no new source trivialises a sink: the largest, a full office, is at most 344 coins (416 before 15 October) against parts of 800 to 9,000
and looks of 250 to 7,500.

### Invariants (tests/comeback.test.ts, clubIncome.test.ts, economyBalance.test.ts, economyV3.test.ts)

- A free player can earn everything: every look handed over is also sold for coins, and every gem goal is reached
  by playing.
- Gems are never required to progress.
- Nothing random is sold. The welcome week, the streak, the free try and the match of the day are all fixed and on
  show before they are earned.
- Missing a day costs nothing: the calendar keeps its place, the office waits full, a missed day a week is forgiven
  and a longer break halves the streak, saying what was kept.
- Rewarded ads are opt-in: one ad a reward, in the shop only for FREE GEMS, at most 2 a day on a portal.
- Every date is a high-water mark and the one clock only moves forward: a device date or time set back pays nothing.

## Decision

Keep the accessible ordinary prices and earned-gem route. Fix inflation and repeated claims first. Newly scouted
players should primarily improve a squad; immediately discarding free cards should not earn more than playing.
Do not reduce saved wallets, existing player values, paid grants or permanent owned content to create demand.

Coins buy players, training, staff, club facilities and ordinary cosmetics. Gems buy guaranteed signature
collections, permanent passes, scouting guarantees and optional convenience. Scout Tickets are earned-only pack
keys; neither currency nor money buys random packs. Purchases can accelerate the solo career. Online friendlies
use preset clubs, without purchased squad advantages.

## The model and workbook

- `docs/economy/Blocky-League-Economy.xlsx`: readable summary, sources, actual prices, editable saving goals,
  store arithmetic, career fees, card resale, a 90-day ledger and a gem chart.
- `scripts/economy-model.ts`: deterministic scenarios importing the game's real reward functions.
- `docs/economy/model.json`: generated data; `npm run economy:model` refreshes it.
- `scripts/economy-workbook.py`: builds the workbook from that JSON using Python + xlsxwriter.

The forecast uses **six minutes per match**: four playing minutes at the default two-minute halves, plus an
assumed two minutes for menus, stoppages and scenes. Ad time is additional. Win rates and match statistics are
assumptions, not player telemetry. Twenty seeds check sensitivity. Classic-only play leaves some Blitz and
higher-difficulty objectives unfinished. All reached free rewards are collected and the next Journey is selected
when one finishes. No spending, referrals, paid passes, career side income or card sales is included in the
shared-loop totals. Those exclusions matter: **gross earning is not a player's unspent wallet**.

| Scenario | Weekly matches / assumed wins | Day 30 gross coins / gems | Day 90 gross coins / gems | First 600 gems, no spending |
|---|---:|---:|---:|---:|
| Learning, no ads | 6 / 25% | 12,520 / 192 | 38,389 / 468 | Beyond 90 days |
| Casual, no ads | 8 / 50% | 25,510 / 356 | 73,490 / 757 | Day 61 |
| Regular, no ads | 21 / 50% | 57,259 / 612 | 171,380 / 1,391 | Day 28 |
| Keen, optional ads | 42 / 65% | 127,682 / 960 | 297,761 / 1,758 | Day 16 |
| Regular + Coin Doubler | 21 / 50% | 68,971 / 612 | 205,158 / 1,391 | Day 28 |

Keen assumes one gem ad, one doubled calendar gift and one match-reward ad per active day. It does not assume
five daily coin ads. The Doubler case uses the same results as Regular: it doubles match fees, not every source,
so its total 90-day coin advantage is about 20%, and gems are unchanged. Exact modeled values are reproducible
examples, not promises. The workbook's editable saving share accounts for competing club and cosmetic goals.

A first 800-coin stand is affordable within the first modeled session if the welcome coins are saved, then needs
one league matchday to build. A 7,500-coin legendary look is a longer optional goal; saving every coin is faster
than reserving 40% while developing the club. A 600-gem identity/pass takes weeks, without requiring ads or a
purchase. A struggling player's slower gem progress is a playtest concern, not a reason to remove their match
income or put career progression behind gems.

## Changes in this build

| Problem | Revised rule |
|---|---|
| Repeating a 15–20 second Moment repeatedly minted XP, then Journey coins/gems | 30 XP for that Moment's first attempt, plus 25 per newly earned best star; repeats remain playable. Existing results count as paid. |
| Trophy prizes and megastore sales were multiplied by streak, grade, atmosphere, Doubler and ads | Only the match fee gets those boosts. Fixed prize and sales amounts are preserved at face value. The ad button shows its exact extra coins. |
| Repeated/stale career result callbacks paid a fee, or could settle the next same-day World fixture | Settlement is bound to its original fixture; rejected callbacks pay zero. |
| Unlimited career goal bonuses and skill-goal coins encouraged running up easy scores | First three goals pay career and Club Run goal bonuses; first three skill goals pay 25 each, matching their XP cap. Results/statistics still count every goal. |
| Forfeiting earned sponsor/commercial money, training and participation | A walk-off is a 0–3 defeat with calendar consequences, without those play rewards and it ends the win streak. Real completed losses still earn rewards. |
| All-forfeit seasons generated free academy intakes and spare keepers to sell | New intake/spare depth requires a completed league fixture; manager simulations count. The minimum playable squad and a keeper remain protected. |
| Rewinding the phone date reopened calendars, objectives and ad/free-pack caps | Reward periods move forward only. Calendar claims recheck the date and displayed step after an ad and cannot pay twice. |
| Free scout card resale scaled to hundreds of coins per card at high squad OVR | New cards have a 75 / 100 / 150 / 250-coin immediate resale ceiling by rarity. Signing then selling, season rollover and AI bids cannot bypass it. Six completed league starts lift the cap. |
| Commercial Manager upgrades could reduce net income after wages | Fees 400 / 1,000 / 2,000; wages 10 / 24 / 40; home income 40 / 90 / 170. Average net league income before sponsorship becomes 10 / 21 / 45 instead of 6 / 8 / 1. Existing hires benefit automatically. |
| US catalogue prices and value labels could mislead in another currency or after a first-buy bonus | Fallbacks say US$; real localized store prices remain exact. No blanket BEST VALUE or unverified 28% saving claim. |

Legacy squad players without new scout provenance retain their existing sale values. A pack already pending
before the update retains its prior quote. The cap is saved with new cards and survives sign/reload/season changes.
At the old rates, a scout card averaged roughly **205 coins at OVR 41, 501 at OVR 65 and 940 at OVR 90** (10,000
seeded draws); three daily cards could provide 616–2,821 coins before a calendar or match reward. New-card
credits average about 92 coins per scout pack (by displayed rarity odds) and 133 per elite pack, rather than
scaling without limit with squad strength. Cards still have their original football stats and rarity odds.

As an extreme multiplier example, a 4,200-coin World final prize plus fee/megastore could formerly reach about
52,808 coins with a max streak, grade, ground/legacy boosts, Doubler and rewarded ad. The equivalent new result
is 10,054: 4,360 fixed prize/sales and 5,694 boosted match fee including the optional ad. Ordinary unboosted
prize amounts stay the same.

## Sources and sinks

A fresh save keeps **500 coins, 50 gems and two Scout Tickets**.

| Source | Coins | Gems | Cadence / limit |
|---|---:|---:|---|
| Normal Quick Match | Win 110 / draw 60 / loss 35, +12 per goal up to 3 | — | Completed matches; difficulty factors 0.8 / 1 / 1.25 / 1.45 |
| Career fee | Win 120 at bottom to 320 at top; draw 45%, loss 20%, +15 per goal up to 3 | — | Ground gate multiplier up to 1.5 |
| Streak / grade / atmosphere | Match fee only: up to 2× / +10% / +12% | — | Fixed prizes and side rewards excluded |
| Skill / live objectives | Up to 75 skill coins; at most 5 live offers, 10–40 each | — | Played match |
| Login calendar | 1,750 per 7 claims | 25 | Missed days do not reset progress; optional ad doubles coins only |
| Daily challenges | 100–220 each plus 1 Scout Ticket | 3 for all 3 | Once per local day |
| Weekly objectives | 300–400 each | 10 each | Three per week |
| Optional shop ads | 75, at most 5/day | 3 once/day | Opt-in; no ad needed for progression |
| Free Journey | **4,310** | 30 | Once per 4,200-XP track; 12 shipped |
| Permanent pass, extra track | 5,560 plus 6 signature pieces | 150 | Once per unlocked Journey |
| Mastery | 50 / 100 / 200 / 350 / 600 / 900 / 1,400 / 2,200 per track | Achievement rewards separately | Five tracks; finite one-time rewards |
| Player level | — | 2 | Levels 2–99; 44 earned by the XP for all 12 Journeys |
| Achievements | — | 5–20 by achievement | Once each |
| Career board / legacy | Objective cash varies by division | 5/objective; 20/legacy level | Receipt protected |
| Career trophies | Defined stage/season prizes | Promotion 15, title 30, Blocky 25, Continental 60, World 100 | Each earned trophy/season |
| Qualified referral | **1,000 each side** | **50 each side** | New signed-in friend's first win/code; 30-day welcome; 20 invited friends + 1 welcome grant/account |

The pure weekly loop ceiling is **97 gems with all daily gem ads**, or **76 without ads**: 25 calendar gems,
21 from sweeps and 30 from weeklies, plus 21 optional ad gems. Casual or classic-only players will not always complete every objective.
Career, levels, achievements and Journeys add separate rewards; “120 gems every week” was not a measured rate.
All referral receipts together can add at most 21,000 coins and 1,050 gems to one account. They remain a generous,
finite promotion rather than a recurring income assumption.

| Sink | Cost / role |
|---|---|
| Ordinary looks | 250–7,500 coins; entire paid coin catalogue about 187,000 before bundles/free level unlocks |
| Ground | 35,600 coins total; one build at a time, 1–2 league matchdays each |
| Staff | 24,900 coins across all role upgrades, plus wages; choose staffing to suit income |
| Players / training / contracts | Rating/age/contract-dependent; compete with cosmetic and construction budgets |
| Scouting Network | 200 / 500 / 1,000 gems in order; 1,700 total, permanent guarantees |
| Permanent pass | 600 gems per selected Journey; 150 returned only as its paid tiers are earned |
| Signature collection | 600 gems for 6 immediate pieces; subtract 100 for each piece already owned |
| Build / heal / replay | 20 gems per build matchday / 30 to heal / 50 to replay a lost decider once |
| Deal refresh | 15 gems; exact next item and coin price shown before charging |
| Gem-to-coin exchange | 50 → 700; 150 → 2,400; 400 → 7,500; 1,000 → 22,000; no reverse conversion |

An 8,000-coin transfer budget is not equivalent to owning 8,000 of cosmetics: players can also be developed,
retire and require contract/staff choices. Wage budget is a roster restriction; staff wages are actual deductions.
Career simulations pay half the relevant fee and advance the manager game; they are an intentional alternative
mode, not included in the six-minute played-match forecasts.

## Store value and evergreen content

Gem packs retain their USD reference ladder and first-buy bonus: 100 / 330 / 600 / 1,300 / 3,000 gems for
US$0.99 / 2.99 / 4.99 / 9.99 / 19.99, doubled once per pack. The Starter Pack remains US$1.99 for 2,000 coins, 150 gems
and the Gold ball. Ad Free remains US$3.99, Coin Doubler US$4.99, and Pro US$9.99 for those two entitlements
and 600 gems. StoreKit's localized price is authoritative; these are configuration references.

A direct Club Pass is US$3.99 or 600 gems. The first 660-gem pack at US$2.99 can be cheaper; do not advertise
cash as universally cheaper. Buying a signature collection gives immediate cosmetics; the pass requires tier
progress but also gives coins/gems. Once the collection is owned, the pass's incremental cosmetic value is zero;
the UI counts already owned pieces. First-buy discounts can buy many permanent passes cheaply; this is finite
published value, not an exchange exploit, and is preserved.

The twelve Journeys never expire. No monthly reset or content update is required to keep them playable. The
career can continue through seasons, squad development and legacy. A shipped finite catalogue cannot guarantee
endless purchasing demand or revenue. Market the complete game; use optional identity/pass purchases, Ad Free
and convenience to fund it without making ordinary losses or missed days punitive.

## Validation and remaining limits

New regression coverage: `economyBalance.test.ts`, `careerEconomy.test.ts`, `rewardClock.test.ts`, plus scout,
IAP, career and settlement tests. The model checks source reconciliation, determinism, reachable free goals
under stated assumptions and a Doubler that does not affect gems or side rewards.

Local saves, device dates and uploaded win records are client-authoritative. Clock-rewind/receipt checks close
simple repeated claims; they are not server anti-cheat. A claim previously made with a future phone date remains
locked until that date passes. A trusted-time recovery path is separate work. Referral eligibility is not a
server-simulated proof of a real match. Paid pass recovery after reinstall depends on saved/cloud progress.

Native IAP products, production ad units and successful real/sandbox purchase flows still need console setup
and end-to-end verification before public monetization. This economy pass prepares a TestFlight build, not a
claim that revenue is enabled or that every device was visually tested.

For playtesting, observe first purchase earned, first stand built, coins/gems earned and spent by source,
match completion, losses, sessions to an intended upgrade, and whether players understand gem uses. Review
when a reward/progression feature changes or tester behavior differs materially from these scenarios. Do not
change ten prices because one tester is rich, and do not equate currency scarcity with fun or revenue.
