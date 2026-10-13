/** Deterministic planning scenarios, NOT measured player telemetry. Imports the game's live economy rules. */
import { Rng } from '../src/core/rng';
import { defaultSave, advanceDaily, dailyChallenges, dailyFor, levelOf, matchXp, nextStreak, matchStars, type MatchSummary } from '../src/core/save';
import { standardCoinReward, matchCoinPayout, skillGoalCoins } from '../src/meta/matchEconomy';
import { calendarToday, claimCalendar, advanceWeekly, claimSweep, claimDailyGems, CALENDAR, AD_CAPS, weeklyLoopGems } from '../src/meta/loops';
import { addGems, gems, GEM_PRICES, GEM_REWARDS, COIN_OFFERS } from '../src/meta/gems';
import { syncAchievementGems } from '../src/meta/gemSources';
import { recordMatchMeta, claimMastery } from '../src/meta/mastery';
import { claimAllSeason, seasonOf, seasonTier, selectJourney, tierXp, SEASON_THEMES, defaultSeason } from '../src/meta/season';
import { syncSeasonGems, passTotals } from '../src/meta/pass';
import { shopItems, rollPack, earnTokens, scoutTokens, FREE_AD_COINS, FREE_AD_DAILY_CAP } from '../src/meta/shop';
import { quickSaleValue } from '../src/meta/market';
import { STAFF, COMMERCIAL_HOME } from '../src/meta/staff';
import { PARTS } from '../src/meta/ground';
import { CATALOGUE, FIRST_BUY_MULT, gemsOf, isGemPack } from '../src/platform/iap';
import { FRIEND_REWARD } from '../src/meta/referrals';
import { createClub, matchCoins, migrateCareer, payTable } from '../src/meta/career';
// Coming back (14 October 2026): the welcome week, the play streak, the match of the day and club income.
import { comebackOf } from '../src/core/comebackState';
import {
  MOTD_REWARD, STREAK_ITEMS, WELCOME_WEEK, claimMotd, motdOf, startStreakDay, streakCoins, streakGems, syncWelcomeWeek, weeklyComebackCoins,
  weeklyComebackGems, welcomeWeekWorth,
} from '../src/meta/comeback';
import {
  ATMOSPHERE_BOOST, CLUB_SHOP, COMMERCIAL_BOOST, INCOME_CAP_HOURS, TICKET_OFFICE, accrueIncome, collectIncome, incomeCap, incomeRate, incomeRateMax,
  incomeSource,
} from '../src/meta/clubIncome';
import { KIT_COLORS } from '../src/meta/data';
import { groundLevel, nextBuild, startBuild, tickBuild } from '../src/meta/ground';
import { APP_AD_CAPS, PORTAL_AD_CAPS, PORTAL_GEM_OFFERS, type AdCaps } from '../src/meta/loops';
import { claimFreeAd, shopItem } from '../src/meta/shop';
import { hireStaff } from '../src/meta/staff';
// The career (15 October 2026, economy v7): ROAD TO GLORY simulated on the game's own engine.
import { overall, teamRating, type PlayerDef, type Role } from '../src/sim/types';
import { FORMATIONS } from '../src/sim/formations';
import { atmosphereOf } from '../src/meta/atmosphere';
import { payBoard } from '../src/meta/board';
import {
  BOTTOM_DIVISION, DIVISION_NAMES, MATCHDAYS, SQUAD_MAX, TRAIN_STEP, afterMatch, buildPart, clubRating, compTieReward, cupTieReward, divisionLevel,
  divisionPlayerOverall, groundBonus, matchDifficulty, matchReward, newSeason, nextMatch, playerPrice, resolveCompTie, resolveCupTie, resolveMatchday,
  sellPlayer, skipBuild, startNextSeason, trainPlayer, trainingCost, trainingDiscount, type CareerState,
} from '../src/meta/career';
import { pendingEvent, resolveEvent, type EventCard } from '../src/meta/events';
import { syncCareerGems } from '../src/meta/gemSources';
import { scoutNetworkTier, SCOUT_NETWORKS } from '../src/meta/gems';
import { megastoreCoins, has as hasPart } from '../src/meta/ground';
import { useAd } from '../src/meta/loops';
import { QUICK_SALE, RESALE_CAP, WAGE_DRAIN, clubWageBudget, placeBid, playerValue, squadWages, wageBudget, wageDrain, wageOf, windowOpen, type MetaPlayer } from '../src/meta/market';
import { buyPassWithGems, claimAllPass } from '../src/meta/pass';
import { buyNetwork, syncNetwork } from '../src/meta/premium';
import { PACK_TOKENS, freePackReady, openPack, packPrice, releaseCandidate, sellCard, settlePack, signCard, type PackKind } from '../src/meta/shop';
import { autoLineupFit, bestStat, trainBest } from '../src/meta/squad';
import { REGIONS, STAFF_ROLES, canHire, hiredLevel, signFind, staffDef, staffWages, type StaffRole } from '../src/meta/staff';
import { LEVEL_TITLES } from '../src/core/save';
import { tuneToOverall } from '../src/meta/career';

export interface Profile {
  id: string; name: string; weekdays: number[]; matches: number; winRate: number; drawRate: number;
  difficulty: number; minutes: number; gemAd: boolean; giftAd: boolean; matchAds: number; doubler: boolean;
  /** Share of active days the MATCH OF THE DAY is completed, and ticket office collections on an active day. */
  motd: number; collects: number;
  /** A portal build (CrazyGames, Poki): nothing is sold; rewarded FREE GEMS and FREE COINS offers taken on an active day. */
  portal?: boolean; gemAds?: number; coinAds?: number;
}
/** What a model run switches (the defaults are the game as shipped). */
export interface ModelOpts {
  /** false: the economy before the come-back features (the baseline the before/after tables are built from). */
  comeback?: boolean;
  /** FREE GEMS offers a day on a portal profile (the option table; default: PORTAL_GEM_OFFERS). */
  gemOffers?: number;
}
/** Share of every coin earned that the modelled club puts into its ground and its commercial manager. */
export const GROUND_SHARE = 0.4;
export const PROFILES: Profile[] = [
  { id: 'learning', name: 'Learning, no ads', weekdays: [0, 2, 5], matches: 2, winRate: .25, drawRate: .2, difficulty: 0, minutes: 6, gemAd: false, giftAd: false, matchAds: 0, doubler: false, motd: .4, collects: 1 },
  { id: 'casual', name: 'Casual, no ads', weekdays: [0, 2, 4, 6], matches: 2, winRate: .5, drawRate: .2, difficulty: 1, minutes: 6, gemAd: false, giftAd: false, matchAds: 0, doubler: false, motd: .6, collects: 1 },
  { id: 'regular', name: 'Regular, no ads', weekdays: [0, 1, 2, 3, 4, 5, 6], matches: 3, winRate: .5, drawRate: .2, difficulty: 1, minutes: 6, gemAd: false, giftAd: false, matchAds: 0, doubler: false, motd: .75, collects: 1 },
  { id: 'keen', name: 'Keen, optional ads', weekdays: [0, 1, 2, 3, 4, 5, 6], matches: 6, winRate: .65, drawRate: .15, difficulty: 2, minutes: 6, gemAd: true, giftAd: true, matchAds: 1, doubler: false, motd: .9, collects: 2 },
  { id: 'doubler', name: 'Regular + paid Coin Doubler', weekdays: [0, 1, 2, 3, 4, 5, 6], matches: 3, winRate: .5, drawRate: .2, difficulty: 1, minutes: 6, gemAd: false, giftAd: false, matchAds: 0, doubler: true, motd: .75, collects: 1 },
];
/**
 * The portal (CrazyGames, Poki): the same play as Casual, Regular and Keen with nothing for sale, and the rewarded
 * offers taken at a casual rate (one FREE GEMS a visit) and a keen rate (every FREE GEMS offer, the doubled gift, one
 * match bonus and two FREE COINS a day).
 */
export const PORTAL_PROFILES: Profile[] = [
  { id: 'portal-casual', name: 'Portal casual, one ad a visit', weekdays: [0, 2, 4, 6], matches: 2, winRate: .5, drawRate: .2, difficulty: 1, minutes: 6, gemAd: true, giftAd: false, matchAds: 0, doubler: false, motd: .6, collects: 1, portal: true, gemAds: 1, coinAds: 0 },
  { id: 'portal-regular', name: 'Portal regular, no ads', weekdays: [0, 1, 2, 3, 4, 5, 6], matches: 3, winRate: .5, drawRate: .2, difficulty: 1, minutes: 6, gemAd: false, giftAd: false, matchAds: 0, doubler: false, motd: .75, collects: 1, portal: true, gemAds: 0, coinAds: 0 },
  { id: 'portal-keen', name: 'Portal keen, every offer', weekdays: [0, 1, 2, 3, 4, 5, 6], matches: 6, winRate: .65, drawRate: .15, difficulty: 2, minutes: 6, gemAd: true, giftAd: true, matchAds: 1, doubler: false, motd: .9, collects: 2, portal: true, gemAds: 3, coinAds: 2 },
];
const MODEL_KIT = { shirt: KIT_COLORS.blue, shirt2: KIT_COLORS.white, pattern: 'stripes' as const, shorts: KIT_COLORS.white, socks: KIT_COLORS.blue, gk: 0 };
export function modelProfile(profile: Profile, horizon = 90, seed = 6102026, opts: ModelOpts = {}) {
  const rng = new Rng(seed);
  // (The come-back features draw from their own stream: the matches are the same with them and without.)
  const side = new Rng(seed ^ 0x5eed);
  const comeback = opts.comeback !== false;
  const caps: AdCaps = profile.portal ? { ...PORTAL_AD_CAPS, gem: Math.max(0, Math.min(3, Math.floor(opts.gemOffers ?? PORTAL_GEM_OFFERS))) } : APP_AD_CAPS;
  const save = defaultSave();
  const start = new Date(2026, 9, 5, 12);
  save.season = defaultSeason(start);
  const coinSources: Record<string, number> = { welcome: save.coins, matches: 0, calendar: 0, daily: 0, weekly: 0, live: 0, skill: 0, mastery: 0, journeys: 0, matchAds: 0, coinAds: 0, streak: 0, matchOfDay: 0, clubIncome: 0 };
  const gemSources: Record<string, number> = { welcome: gems(save), calendar: 0, sweep: 0, weekly: 0, levels: 0, journeys: 0, achievements: 0, ads: 0, welcomeWeek: 0, streak: 0, matchOfDay: 0 };
  const rows: Array<{day: number; date: string; active: boolean; matches: number; minutes: number; coins: number; gems: number; ticketsEarned: number; freePacks: number; completedJourneys: number;
    ground: number; incomeRate: number; clubIncome: number; looks: number; streak: number}> = [];
  let matchCount = 0, activeDays = 0, journey = 0;
  // The modelled club (ROAD TO GLORY): its ground and commercial manager are bought out of GROUND_SHARE of what is
  // earned, cheapest part first, one build at a time, a league matchday on every active day.
  const club = migrateCareer(null, 7);
  club.club = createClub({ name: 'Model FC', short: 'MOD', kit: MODEL_KIT, formation: '4-4-2' }, 7);
  const fund = { coins: 0 };
  let lastCoins = save.coins, looks = 0;
  const lookValue = (it: { item: { price: number }; owned: boolean } | undefined) => { if (it && !it.owned) looks += it.item.price; };
  const bank = (source: string, coins: number) => { coinSources[source] += coins; save.coins += coins; };
  const gemGrant = (source: string, action: () => unknown) => { const before = gems(save); action(); gemSources[source] += gems(save) - before; };
  for (let day = 0; day < horizon; day++) {
    const date = new Date(start); date.setDate(start.getDate() + day);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const active = profile.weekdays.includes(day % 7);
    if (active) {
      activeDays++;
      const gift = calendarToday(save, key);
      if (gift) {
        const got = claimCalendar(save, key, gift.step, profile.giftAd)!;
        coinSources.calendar += got.coins; gemSources.calendar += got.gems;
        if (comeback) {
          // WELCOME WEEK: the first claim of each calendar day hands over its look (counted as looks, not coins), gems or a ticket.
          const coinsBefore = save.coins, gemsBefore = gems(save);
          lookValue(syncWelcomeWeek(save)?.item);
          coinSources.calendar += save.coins - coinsBefore; gemSources.welcomeWeek += gems(save) - gemsBefore;
        }
      }
      for (let n = profile.gemAds ?? (profile.gemAd ? 1 : 0); n > 0; n--) gemGrant('ads', () => claimDailyGems(save, key, caps));
      for (let n = profile.coinAds ?? 0; n > 0; n--) { const before = save.coins; claimFreeAd(save, key); coinSources.coinAds += save.coins - before; }
      if (comeback) {
        // CLUB INCOME: the ticket office fills in real time and is collected on a visit (a keen player comes back for a second one).
        const now = date.getTime();
        const rate = incomeRate(incomeSource(club, save));
        accrueIncome(save, now, rate);
        for (let n = 0; n < profile.collects; n++) { const before = save.coins; collectIncome(save, now + n * INCOME_CAP_HOURS * 3_600_000, rate); coinSources.clubIncome += save.coins - before; }
        // The MATCH OF THE DAY, completed on a share of the days played (its first time XP is left out, like every moment's).
        const motd = motdOf(save, key);
        if (motd && side.chance(profile.motd)) {
          const coinsBefore = save.coins, gemsBefore = gems(save);
          claimMotd(save, key, motd.moment.id, true);
          save.moments = { ...(save.moments ?? {}), [motd.moment.id]: Math.max(1, save.moments?.[motd.moment.id] ?? 0) };
          coinSources.matchOfDay += save.coins - coinsBefore; gemSources.matchOfDay += gems(save) - gemsBefore;
        }
      }
      for (let i = 0; i < profile.matches; i++) {
        matchCount++;
        const outcome = rng.next();
        const won = outcome < profile.winRate, drawn = !won && outcome < profile.winRate + profile.drawRate;
        const goals = won ? (rng.chance(.2) ? 3 : 2) : drawn ? (rng.chance(.75) ? 1 : 0) : (rng.chance(.5) ? 1 : 0);
        const conceded = won ? (rng.chance(.45) ? 0 : 1) : drawn ? goals : 2;
        const summary: MatchSummary = {
          won, drawn, goals, conceded, assists: Math.max(0, goals - (rng.chance(.5) ? 1 : 0)),
          passes: 12 + rng.int(17), tacklesWon: 2 + rng.int(5), skills: rng.int(4), headers: goals > 0 && rng.chance(.18) ? 1 : 0,
          longGoals: goals > 0 && rng.chance(.15) ? 1 : 0, powerups: 0, motm: won && rng.chance(.7), blitz: false,
          difficulty: profile.difficulty, skillGoals: goals > 0 && rng.chance(.2) ? 1 : 0,
        };
        save.record.played++; save.record.goalsFor += goals; save.record.goalsAgainst += conceded;
        if (won) save.record.won++; else if (drawn) save.record.drawn++; else save.record.lost++;
        save.progress.streak = nextStreak(save.progress.streak, won, drawn);
        save.progress.bestStreak = Math.max(save.progress.bestStreak, save.progress.streak);
        save.progress.stars += matchStars(summary);
        const payout = matchCoinPayout(standardCoinReward(goals, conceded, profile.difficulty), { streak: won ? save.progress.streak : 0, atmosphere: 0, gradeBonus: rng.chance(.2) ? .05 : 0, doubler: profile.doubler });
        bank('matches', payout.coins);
        if (i < profile.matchAds) bank('matchAds', payout.adBonus);
        // Assumed two completed live objectives: win it back + shot on target (25 coins, 13 XP).
        bank('live', 25); bank('skill', skillGoalCoins(summary.skillGoals ?? 0));
        const xp = matchXp(summary) + 13;
        const levelBefore = levelOf(save.progress.xp).level;
        save.progress.xp += xp;
        gemGrant('levels', () => addGems(save, (levelOf(save.progress.xp).level - levelBefore) * GEM_REWARDS.levelUp, 'levelUp'));
        const daily = dailyFor(save.progress, key);
        const done = advanceDaily(daily, dailyChallenges(daily.day), summary);
        bank('daily', done.reduce((n, d) => n + d.challenge.coins, 0)); earnTokens(save, done.length);
        gemGrant('sweep', () => claimSweep(save, daily.day));
        gemGrant('weekly', () => bank('weekly', advanceWeekly(save, key, summary, done.length).reduce((n, d) => n + d.objective.coins, 0)));
        recordMatchMeta(save, { goals, assists: summary.assists, passes: summary.passes, tackles: summary.tacklesWon, skills: summary.skills, saves: 2, cleanSheet: conceded === 0 }, xp, date);
        bank('mastery', claimMastery(save.mastery!).coins);
        bank('journeys', claimAllSeason(seasonOf(save, date)));
        gemGrant('journeys', () => syncSeasonGems(save));
        gemGrant('achievements', () => syncAchievementGems(save));
        if (comeback) {
          // The PLAY STREAK: the first completed match of the day moves it on and pays its day (null for the rest).
          const coinsBefore = save.coins, gemsBefore = gems(save);
          lookValue(startStreakDay(save, key)?.prize.item);
          coinSources.streak += save.coins - coinsBefore; gemSources.streak += gems(save) - gemsBefore;
        }
        const season = seasonOf(save, date);
        if (seasonTier(season.xp) === 30 && journey < SEASON_THEMES.length) {
          journey++;
          if (journey < SEASON_THEMES.length) {
            // Select the next uncompleted shipped identity; this is an optimistic, deliberate player choice.
            const next = Array.from({length: SEASON_THEMES.length}, (_, n) => `pass${String(n + 1).padStart(2, '0')}`).find(k => !season.journeys?.[k] && k !== `pass${season.id.slice(-2)}`);
            if (next) selectJourney(season, next);
          }
        }
      }
      if (comeback) {
        // The ground: a matchday passes for the build going up, then GROUND_SHARE of the day's coins goes to the next
        // part (the cheapest that can be built), or to the commercial manager while the fund waits for a dearer one.
        tickBuild(club.ground);
        fund.coins += GROUND_SHARE * (save.coins - lastCoins);
        const next = club.ground.building ? null : nextBuild(club.ground);
        if (next && fund.coins >= next.cost) startBuild(club.ground, fund, next.id);
        else hireStaff(club, fund, 'commercial');
        club.stadium = groundLevel(club.ground);
      }
      lastCoins = save.coins;
    }
    rows.push({ day: day + 1, date: key, active, matches: matchCount, minutes: matchCount * profile.minutes, coins: save.coins, gems: gems(save), ticketsEarned: scoutTokens(save) - 2, freePacks: activeDays, completedJourneys: journey,
      ground: groundLevel(club.ground), incomeRate: comeback ? incomeRate(incomeSource(club, save)) : 0, clubIncome: coinSources.clubIncome, looks, streak: comebackOf(save).streak.days });
  }
  return { profile, seed, rows, coinSources, gemSources };
}
/** The first day a profile's gross total reaches `cost` (every coin or gem saved for it), or null inside the horizon. */
function dayOf(rows: ReadonlyArray<{ day: number; coins: number; gems: number }>, cur: 'coins' | 'gems', cost: number, share = 1): number | null {
  const start = cur === 'coins' ? 500 : 50;
  return rows.find((r) => start + (r[cur] - start) * share >= cost)?.day ?? null;
}

/** The day marks of the before / after tables. */
export const MARKS = [1, 7, 30, 90] as const;
/** What a portal player saves for: the gem sinks in order, a first stand, a mid and a top look, the whole ground. */
export function portalGoals(): { goal: string; currency: 'coins' | 'gems'; cost: number }[] {
  const net = GEM_PRICES.scoutNetwork;
  return [
    { goal: 'Local Scouting Network', currency: 'gems', cost: net[0] },
    { goal: 'Club Pass', currency: 'gems', cost: GEM_PRICES.clubPass },
    { goal: 'National Scouting Network (after Local)', currency: 'gems', cost: net[0] + net[1] },
    { goal: 'World Scouting Network (all three)', currency: 'gems', cost: net[0] + net[1] + net[2] },
    { goal: 'Club Pass and all three networks', currency: 'gems', cost: GEM_PRICES.clubPass + net[0] + net[1] + net[2] },
    { goal: 'Main stand', currency: 'coins', cost: PARTS[0].steps[0].cost },
    { goal: 'Mid look (EPIC, Inferno goal)', currency: 'coins', cost: shopItem('goalfx', 'fire')!.price },
    { goal: 'Top look (LEGENDARY, Supernova goal)', currency: 'coins', cost: shopItem('goalfx', 'supernova')!.price },
    { goal: 'The whole ground', currency: 'coins', cost: PARTS.reduce((n, p) => n + p.steps.reduce((m, s) => m + s.cost, 0), 0) },
  ];
}
/** The come-back sources and the portal: before / after, club income against each profile's day, days to afford, the FREE GEMS options. */
export function buildComebackModel(profiles: ReturnType<typeof modelProfile>[]) {
  const baseline = PROFILES.map(p => modelProfile(p, 90, 6102026, { comeback: false }));
  const beforeAfter = PROFILES.map((p, i) => ({ id: p.id, name: p.name, marks: MARKS.map(d => {
    const a = baseline[i].rows[d - 1], b = profiles[i].rows[d - 1];
    return { day: d, coinsBefore: a.coins, coinsAfter: b.coins, gemsBefore: a.gems, gemsAfter: b.gems, looks: b.looks, ground: b.ground, incomeRate: b.incomeRate, streak: b.streak };
  }), coinSources: profiles[i].coinSources, gemSources: profiles[i].gemSources }));
  const HORIZON = 365;
  const portal = PORTAL_PROFILES.map(p => modelProfile(p, HORIZON));
  const goals = portalGoals();
  const afford = portal.flatMap(m => goals.map(g => ({
    profile: m.profile.name, goal: g.goal, currency: g.currency, cost: g.cost,
    // Every coin or gem saved for it, and a planning share (40% of coins beside the club, 75% of gems).
    dayAll: dayOf(m.rows, g.currency, g.cost), dayShared: dayOf(m.rows, g.currency, g.cost, g.currency === 'coins' ? GROUND_SHARE : .75),
  })));
  const groundLadder = [...profiles, ...portal].map(m => ({ profile: m.profile.name, levels: [1, 2, 3, 4, 5].map(level => ({ level, day: m.rows.find(r => r.ground >= level)?.day ?? null })),
    rateDay1: m.rows[0].incomeRate, rateDay30: m.rows[29].incomeRate, rateDay90: m.rows[89].incomeRate }));
  // CLUB INCOME against the rest of each profile's coins, a day, by stage: the "about a quarter at most" check.
  const windows: [number, number][] = [[1, 7], [8, 30], [31, 90]];
  const incomeShare = [...profiles, ...portal].flatMap(m => windows.map(([from, to]) => {
    const a = from > 1 ? m.rows[from - 2] : { coins: 500, clubIncome: 0 }, b = m.rows[to - 1];
    const days = to - from + 1, income = (b.clubIncome - a.clubIncome) / days, other = (b.coins - a.coins) / days - income;
    return { profile: m.profile.name, from, to, incomePerDay: Math.round(income), otherPerDay: Math.round(other), share: other > 0 ? income / other : 0, rate: b.incomeRate, fullOffice: incomeCap(b.incomeRate) };
  }));
  // FREE GEMS on a portal: one, two or three offers a day, each one ad for the same gems.
  const gemOffers = [1, 2, 3].flatMap(offers => PORTAL_PROFILES.filter(p => (p.gemAds ?? 0) > 0).map(p => {
    const m = modelProfile(p, HORIZON, 6102026, { gemOffers: offers });
    return { offers, profile: p.name, taken: Math.min(offers, p.gemAds ?? 0), weeklyLoopMax: weeklyLoopGems({ ...PORTAL_AD_CAPS, gem: offers }) + weeklyComebackGems(),
      gems30: m.rows[29].gems, gems90: m.rows[89].gems, adGems90: m.rows[89].gems - modelProfile({ ...p, gemAds: 0, gemAd: false }, 90).rows[89].gems,
      dayPass: dayOf(m.rows, 'gems', GEM_PRICES.clubPass), dayLocal: dayOf(m.rows, 'gems', GEM_PRICES.scoutNetwork[0]),
      dayAllNetworks: dayOf(m.rows, 'gems', GEM_PRICES.scoutNetwork.reduce((a, b) => a + b, 0)) };
  }));
  const item = (ref: { cat: Parameters<typeof shopItem>[0]; id: string } | undefined) => { const it = ref ? shopItem(ref.cat, ref.id) : undefined; return it ? { name: it.name, kind: it.cat, coins: it.price } : null; };
  return {
    beforeAfter, afford, groundLadder, incomeShare, gemOffers, horizon: HORIZON,
    portalProfiles: portal.map(m => ({ profile: m.profile, coinSources: m.coinSources, gemSources: m.gemSources, marks: [...MARKS, 180, 365].map(d => m.rows[d - 1]) })),
    constants: {
      welcomeWeek: WELCOME_WEEK.map((e, i) => ({ day: i + 1, calendarCoins: CALENDAR[i].coins, calendarGems: CALENDAR[i].gems, calendarTickets: CALENDAR[i].tokens, gems: e?.gems ?? 0, tickets: e?.tokens ?? 0, item: item(e?.item) })),
      welcomeWeekWorth: welcomeWeekWorth(),
      streak: [1, 2, 3, 4, 5, 6, 7, 14, 30].map(d => ({ day: d, coins: streakCoins(d), gems: streakGems(d), item: item(STREAK_ITEMS[d]) })),
      matchOfTheDay: MOTD_REWARD, weeklyComebackGems: weeklyComebackGems(), weeklyComebackCoins: weeklyComebackCoins(),
      weeklyLoopGemsApp: weeklyLoopGems(APP_AD_CAPS) + weeklyComebackGems(), weeklyLoopGemsAppNoAds: weeklyLoopGems({ ...APP_AD_CAPS, gem: 0 }) + weeklyComebackGems(),
      weeklyLoopGemsPortal: weeklyLoopGems(PORTAL_AD_CAPS) + weeklyComebackGems(), portalGemOffers: PORTAL_GEM_OFFERS, gemsPerOffer: GEM_REWARDS.dailyAd,
      clubIncome: { capHours: INCOME_CAP_HOURS, ticketOffice: TICKET_OFFICE, clubShop: CLUB_SHOP, commercialBoost: COMMERCIAL_BOOST, atmosphereBoost: ATMOSPHERE_BOOST, rateMax: incomeRateMax(), fullOfficeMax: incomeCap(incomeRateMax()), groundShare: GROUND_SHARE },
    },
  };
}
// =====================================================================================================================
// THE CAREER (15 October 2026, economy v7). ROAD TO GLORY played matchday by matchday on the game's own engine: the
// league, the cups, the week at the club, the market, the staff, the ground, the board and the event cards are the
// real functions (meta/career.ts resolveMatchday and everything it calls). Only three things are assumed and stated:
// who wins (a W / D / L mix at par, moved by the rating gap and the division's difficulty), what the manager buys
// (the policy in `manage`), and how often he plays. A planning model, not telemetry.
// =====================================================================================================================
export interface CareerProfile {
  id: string; name: string; weekdays: number[]; matches: number;
  /** Wins and draws at par on Normal (the rest are defeats). */
  win: number; draw: number;
  /** Every rewarded offer is taken (the doubled welcome sheet, the full-time bonus, FREE COINS, FREE GEMS, build, heal, replay), or none. */
  ads: boolean; motd: number; collects: number;
  /** The sponsor card's answer every time: 0 EVERY MATCH, 1 WIN BONUS, 2 CASH NOW. */
  sponsor: 0 | 1 | 2;
  /** Signs every pack card that beats a starter and hires every member of staff he has the fee for, whatever the wages. */
  naive?: boolean; portal?: boolean;
}
export const CAREER_HORIZON = 180;
export const CAREER_SEED = 15102026;
/** The stated assumptions of the career simulation. */
export const CAREER = {
  /** Each point of team rating between the two elevens moves this share of matches between wins and defeats, up to the clamp. */
  ratingPoint: 0.015, ratingClamp: 0.25,
  /** Off the win share on HARD (the Championship) and LEGEND (the Elite League): meta/career.ts matchDifficulty. */
  hard: 0.1, legend: 0.2,
  /** Staff wages kept in the wallet before anything is bought, in league matchdays. */
  reserveMatchdays: 3,
  /** Staff are hired while their wages stay under this share of what a league matchday brings the club. */
  staffShare: 0.5,
  /** Signings and training sessions a matchday, at most, to bring the eleven up to the division's par. */
  squadActions: 12,
} as const;
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
export const CAREER_PROFILES: CareerProfile[] = [
  { id: 'career-learning', name: 'Career learning, 45/25/30, no ads', weekdays: [0, 2, 5], matches: 2, win: .45, draw: .25, ads: false, motd: .4, collects: 1, sponsor: 0 },
  { id: 'career-regular', name: 'Career regular, 60/20/20, no ads', weekdays: EVERY_DAY, matches: 3, win: .6, draw: .2, ads: false, motd: .75, collects: 1, sponsor: 0 },
  { id: 'career-strong', name: 'Career strong, 75/15/10, every ad', weekdays: EVERY_DAY, matches: 6, win: .75, draw: .15, ads: true, motd: .9, collects: 2, sponsor: 1 },
];
/** The order a sensible manager hires in: what pays for itself first, then what the ground has opened. */
const STAFF_ORDER: readonly [StaffRole, number][] = [
  ['commercial', 1], ['assistant', 1], ['physio', 1], ['scout1', 1], ['academy', 1], ['commercial', 2], ['assistant', 2], ['physio', 2], ['academy', 2],
  ['commercial', 3], ['scout1', 2], ['assistant', 3], ['physio', 3], ['academy', 3], ['scout2', 1], ['scout1', 3], ['scout2', 2], ['scout2', 3],
];
export const COIN_IN = ['welcome', 'matchFees', 'megastore', 'cupPrizes', 'seasonPrizes', 'board', 'sponsor', 'commercial', 'events', 'playerSales', 'cardSales', 'calendar',
  'daily', 'weekly', 'live', 'skill', 'mastery', 'journeys', 'passTrack', 'playStreak', 'matchOfDay', 'clubIncome', 'halfTimeShow', 'adGift', 'adMatch', 'adCoins'] as const;
export const COIN_OUT = ['ground', 'staffFees', 'staffWages', 'wageDrain', 'transfers', 'training', 'contracts', 'events'] as const;
export const GEM_IN = ['welcome', 'calendar', 'welcomeWeek', 'sweep', 'weekly', 'levels', 'journeys', 'achievements', 'playStreak', 'matchOfDay', 'board', 'legacy', 'trophies', 'ads'] as const;
export const GEM_OUT = ['scoutNetwork', 'clubPass'] as const;
export const TICKET_IN = ['welcome', 'daily', 'calendar', 'welcomeWeek'] as const;
export const TICKET_OUT = ['scoutPacks', 'elitePacks'] as const;
/** The club's own matchday business: what the staff's wages are set against. */
export const CLUB_KEYS = ['matchFees', 'megastore', 'sponsor', 'commercial'] as const;
/** Coins that need no match: the gift, the ticket office, the match of the day (a moment), the play streak's day. */
export const PASSIVE_KEYS = ['calendar', 'clubIncome', 'matchOfDay', 'playStreak', 'adGift', 'adCoins'] as const;
type Ledger = Record<string, number>;
const zero = (keys: readonly string[]): Ledger => Object.fromEntries(keys.map(k => [k, 0]));
const total = (l: Ledger): number => Object.values(l).reduce((a, b) => a + b, 0);
const minus = (now: Ledger, then: Ledger): Ledger => Object.fromEntries(Object.keys(now).map(k => [k, now[k] - (then[k] ?? 0)]));
const within = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export interface CareerSeason {
  season: number; division: number; league: string; position: number; outcome: string; cup: number; dayFrom: number; dayTo: number; matches: number;
  won: number; drawn: number; lost: number; coinsIn: number; coinsOut: number; in: Ledger; out: Ledger; balanceStart: number; balanceEnd: number; balanceMin: number;
  clubIncome: number; staffWages: number; wageShare: number; playerWages: number; wageBudget: number; unpaidMatchdays: number; drainMatchdays: number; shortMatchdays: number;
  rating: number; par: number; squad: number; ground: number; partsBuilt: number; staffLevels: number; gemsIn: number; gemsOut: number; gemsEnd: number;
  ticketsIn: number; ticketsOut: number; cardsSigned: number; cardsSold: number; level: number;
}
export function modelCareer(profile: CareerProfile, horizon = CAREER_HORIZON, seed = CAREER_SEED) {
  const rng = new Rng(seed), side = new Rng(seed ^ 0x5eed);
  const caps: AdCaps = profile.portal ? PORTAL_AD_CAPS : APP_AD_CAPS;
  const save = defaultSave();
  const start = new Date(2026, 9, 5, 12);
  save.season = defaultSeason(start);
  const st: CareerState = migrateCareer(null, seed);
  const club = createClub({ name: 'Model FC', short: 'MOD', kit: MODEL_KIT, formation: '4-4-2' }, st.seed);
  st.club = club;
  newSeason(st, BOTTOM_DIVISION, 1);
  const cin = zero(COIN_IN), cout = zero(COIN_OUT), gin = zero(GEM_IN), gout = zero(GEM_OUT), tin = zero(TICKET_IN), tout = zero(TICKET_OUT);
  cin.welcome = save.coins; gin.welcome = gems(save); tin.welcome = scoutTokens(save);
  const ads = { gift: 0, match: 0, coins: 0, gems: 0, build: 0, heal: 0, replay: 0 };
  const cards = { signed: 0, sold: 0 };
  let matches = 0, journey = 0, residual = 0, passBought = false, day = 0, adMax = 0, sheetMax = 0, winCoins = 0, winCount = 0;
  const gain = (k: string, fn: () => unknown): number => { const b = save.coins; fn(); const d = save.coins - b; cin[k] += d; return d; };
  const pay = (k: string, fn: () => unknown): number => { const b = save.coins; fn(); const d = b - save.coins; cout[k] += d; return d; };
  const gemGain = (k: string, fn: () => unknown) => { const b = gems(save); fn(); gin[k] += gems(save) - b; };
  const snap = () => ({ cin: { ...cin }, cout: { ...cout }, gin: { ...gin }, gout: { ...gout }, tin: { ...tin }, tout: { ...tout }, matches, day, balance: save.coins, signed: cards.signed, sold: cards.sold });
  let at = snap(), res = { w: 0, d: 0, l: 0 }, low = { min: save.coins, unpaid: 0, drained: 0, short: 0 };
  const seasons: CareerSeason[] = [];
  const promotions: { division: number; season: number; day: number }[] = [];
  const levels: { level: number; day: number; matches: number }[] = [];
  const builds: { part: string; cost: number; day: number; match: number; sinceLast: number }[] = [];
  const matchRows: { n: number; day: number; season: number; division: number; competition: string; result: string; coins: number; balance: number }[] = [];
  const parts = () => PARTS.reduce((n, p) => n + Math.min(p.steps.length, st.ground.built[p.id] ?? 0), 0);
  const staffSum = () => STAFF_ROLES.reduce((n, r) => n + hiredLevel(st, r), 0);
  const par = () => { const r = st.season?.rivals ?? []; return r.length ? r.reduce((n, x) => n + x.rating, 0) / r.length : 0; };
  const closeSeason = () => {
    const s = st.summary!;
    const i = minus(cin, at.cin), o = minus(cout, at.cout);
    const clubIncome = CLUB_KEYS.reduce((n, k) => n + i[k], 0);
    seasons.push({
      season: s.season, division: s.division, league: DIVISION_NAMES[s.division], position: s.position, outcome: s.outcome, cup: s.cup ?? -1, dayFrom: at.day + 1, dayTo: day + 1,
      matches: matches - at.matches, won: res.w, drawn: res.d, lost: res.l, coinsIn: total(i), coinsOut: total(o), in: i, out: o, balanceStart: at.balance, balanceEnd: save.coins,
      balanceMin: low.min, clubIncome, staffWages: o.staffWages, wageShare: clubIncome > 0 ? o.staffWages / clubIncome : 0, playerWages: squadWages(club), wageBudget: clubWageBudget(st),
      unpaidMatchdays: low.unpaid, drainMatchdays: low.drained, shortMatchdays: low.short, rating: clubRating(club), par: Math.round(par()), squad: club.squad.length,
      ground: groundLevel(st.ground), partsBuilt: parts(), staffLevels: staffSum(), gemsIn: total(minus(gin, at.gin)), gemsOut: total(minus(gout, at.gout)), gemsEnd: gems(save),
      ticketsIn: total(minus(tin, at.tin)), ticketsOut: total(minus(tout, at.tout)), cardsSigned: cards.signed - at.signed, cardsSold: cards.sold - at.sold, level: levelOf(save.progress.xp).level,
    });
    if (s.outcome === 'promoted') promotions.push({ division: s.nextDivision, season: s.season, day: day + 1 });
    at = snap(); res = { w: 0, d: 0, l: 0 }; low = { min: save.coins, unpaid: 0, drained: 0, short: 0 };
  };
  // ---- the squad: who is weakest, who goes, and room for one more inside the squad size and the wage budget
  const weakest = (role: Role): number => {
    const slots = FORMATIONS[club.formation];
    let w = Infinity;
    for (let i = 0; i < Math.min(11, club.squad.length); i++) if (slots[i]?.role === role) w = Math.min(w, overall(club.squad[i]));
    return w;
  };
  const release = (): boolean => {
    const p = club.squad[releaseCandidate(club)];
    const r = p ? sellPlayer(st, save, p.id) : null;
    if (!r?.ok) return false;
    cin.playerSales += r.delta;
    return true;
  };
  const room = (wage: number) => club.squad.length < SQUAD_MAX && squadWages(club) + wage <= clubWageBudget(st);
  const fit = (wage: number): boolean => { for (let g = 0; g < 10 && !room(wage); g++) if (!release()) break; return room(wage); };
  /** A pack: the card is signed when it beats a starter in its position (and the wages fit), else sold for its resale credit. */
  const pack = (kind: PackKind, key: string, free: boolean): boolean => {
    const r = openPack(save, club, kind, key, free);
    if (!r.ok) return false;
    if (!free) tout[kind === 'elite' ? 'elitePacks' : 'scoutPacks'] += PACK_TOKENS[kind];
    const p = r.card.player;
    let sign = overall(p) > weakest(p.role);
    if (sign) sign = profile.naive ? club.squad.length < SQUAD_MAX || release() : fit(wageOf(p));
    if (sign && signCard(club, r.card, r.price || packPrice('scout', clubRating(club)), st.season?.number ?? 1).ok) cards.signed++;
    else { cin.cardSales += sellCard(save, r.card); cards.sold++; }
    settlePack(save);
    return true;
  };
  // ---- the event cards: the answer a careful manager gives (never gems; a paid answer only when the wallet has it)
  const answer = (c: EventCard): number => {
    const can = (i: number) => !!c.choices[i] && !c.choices[i].gems && (c.choices[i].coins ?? 0) <= save.coins;
    const want = c.kind === 'sponsor' ? profile.sponsor : c.kind === 'festival' || c.kind === 'bid' ? 1 : c.kind === 'contract' ? (can(0) ? 0 : can(1) ? 1 : 2) : 0;
    return can(want) ? want : c.choices.findIndex((x) => !x.gems && !x.coins);
  };
  const answerCards = (key: string) => {
    for (let g = 0; g < 6; g++) {
      const c = pendingEvent(st);
      if (!c) break;
      // HEAL A PLAYER by ad (one a day, the same effect as the 30 gem heal): the card is gone once he is fit.
      if (c.kind === 'injury' && profile.ads && useAd(save, 'heal', key, caps)) {
        for (const p of club.squad) if (c.who.includes(p.id)) (p as PlayerDef & { inj?: number }).inj = 0;
        ads.heal++;
        continue;
      }
      const before = save.coins;
      if (!resolveEvent(st, save, c.id, answer(c)).ok) break;
      const d = save.coins - before;
      if (d > 0) cin[c.kind === 'bid' ? 'playerSales' : c.kind === 'sponsor' ? 'sponsor' : 'events'] += d;
      else cout[c.kind === 'contract' || c.kind === 'youth' ? 'contracts' : 'events'] -= d;
    }
  };
  // ---- the spending policy (stated on the workbook's Career sheet): wages kept, the cheapest part of the ground, the
  // staff in order, the eleven brought up to the division's par, the gem goals in order. Everything else is saved.
  const reserve = () => CAREER.reserveMatchdays * staffWages(st);
  const spare = () => save.coins - reserve();
  const matchdayIncome = (): number => {
    const pt = payTable(st.season!.division, st.stadium), sp = st.events.sponsor;
    const fee = profile.win * (pt.win + 2 * pt.goal) + profile.draw * (pt.draw + pt.goal) + (1 - profile.win - profile.draw) * pt.loss;
    return fee + (sp ? sp.amount * (sp.pay === 'match' ? 1 : profile.win) : 0) + COMMERCIAL_HOME[hiredLevel(st, 'commercial')] / 2
      + (hasPart(st.ground, 'store') ? megastoreCoins(st.season!.division) / 2 : 0);
  };
  const manage = (key: string, date: Date) => {
    const season = st.season;
    if (!season || st.summary) return;
    if (!profile.naive) for (let g = 0; g < 10 && squadWages(club) > clubWageBudget(st) && release(); g++);
    const nb = st.ground.building ? null : nextBuild(st.ground);
    if (nb && spare() >= nb.cost && pay('ground', () => buildPart(st, save, nb.id)) > 0) {
      builds.push({ part: nb.name, cost: nb.cost, day: day + 1, match: matches, sinceLast: matches - (builds.at(-1)?.match ?? 0) });
    }
    if (profile.ads && st.ground.building && useAd(save, 'build', key, caps)) { skipBuild(st); ads.build++; }
    for (const [role, level] of STAFF_ORDER) {
      if (hiredLevel(st, role) !== level - 1) continue;
      const c = canHire(st, spare(), role);
      if (!c.ok) { if (c.reason === 'locked') continue; break; }
      const lv = staffDef(role).levels;
      if (!profile.naive && staffWages(st) + lv[level - 1].wage - (lv[level - 2]?.wage ?? 0) > CAREER.staffShare * matchdayIncome()) break;
      pay('staffFees', () => hireStaff(st, save, role));
    }
    for (let n = 0; n < CAREER.squadActions && clubRating(club) < par(); n++) {
      const best: { score: number; wage: number; go: (() => boolean) | null } = { score: 0, wage: 0, go: null };
      const consider = (p: PlayerDef, cost: number, go: () => boolean) => {
        const lift = overall(p) - weakest(p.role);
        if (lift >= 2 && cost <= spare() && lift / cost > best.score) Object.assign(best, { score: lift / cost, wage: wageOf(p), go });
      };
      if (windowOpen(season.matchday)) for (const l of st.tm.listings) if (!l.club && !l.youth) consider(l.player, l.asking, () => placeBid(st, save, l.id, l.asking).ok);
      for (const r of st.staff.reports) r.finds.forEach((f, i) => { if (f.kind === 'ready') consider(f.player, f.fee, () => signFind(st, save, r.slot, i).ok); });
      if (best.go && fit(best.wage) && pay('transfers', best.go) > 0) { club.squad = autoLineupFit(club.squad, club.formation); continue; }
      const pick = trainBest(club.squad);
      const who = pick ? club.squad[pick.index] : null;
      if (!pick || !who || trainingCost(who, trainingDiscount(st)) > spare()) break;
      pay('training', () => trainPlayer(club, save, who.id, pick.stat, trainingDiscount(st)));
    }
    // The permanent gem goals, in order: the Local network, the Club Pass, then the National and World networks.
    const tier = scoutNetworkTier(save);
    if ((tier === 0 || passBought) && tier < SCOUT_NETWORKS.length && gems(save) >= SCOUT_NETWORKS[tier].price) { const r = buyNetwork(st, save); if (r.ok) gout.scoutNetwork += r.price; }
    else if (tier > 0 && !passBought && gems(save) >= GEM_PRICES.clubPass) { const r = buyPassWithGems(save, date); if (r.ok) { gout.clubPass += r.price; passBought = true; } }
  };
  // ---- one match of the career: the next thing on the calendar (a league matchday, a cup tie, a continental night)
  const playMatch = (key: string, date: Date) => {
    if (st.summary) {
      closeSeason(); syncNetwork(st, save); startNextSeason(st);
      // A new division is a new wage budget (a smaller one after relegation): a careful manager sells down before the first match.
      if (!profile.naive) for (let g = 0; g < 10 && squadWages(club) > clubWageBudget(st) && release(); g++);
    }
    club.squad = autoLineupFit(club.squad, club.formation);
    const nm = nextMatch(st), season = st.season;
    if (!nm || !season) return;
    const division = season.division, stadium = st.stadium, league = nm.competition === 'league';
    const knockout = nm.competition === 'cup' || (!league && nm.stage !== 'group'), hosting = nm.userHome && !nm.neutral;
    const mine = teamRating(nm.userHome ? nm.home : nm.away), theirs = teamRating(nm.userHome ? nm.away : nm.home);
    const hard = [0, 0, CAREER.hard, CAREER.legend][matchDifficulty(division)] ?? 0;
    const pWin = within(profile.win + within((mine - theirs) * CAREER.ratingPoint, -CAREER.ratingClamp, CAREER.ratingClamp) - hard, .05, .92);
    const pDraw = (1 - pWin) * (profile.draw / (1 - profile.win));
    const roll = () => {
      const x = rng.next(), won = x < pWin, drawn = !won && x < pWin + pDraw;
      const goals = won ? (rng.chance(.2) ? 3 : 2) : drawn ? (rng.chance(.75) ? 1 : 0) : (rng.chance(.5) ? 1 : 0);
      return { won, drawn, goals, conceded: won ? (rng.chance(.45) ? 0 : 1) : drawn ? goals : 2, through: won || (drawn && knockout && rng.chance(.5)) };
    };
    let r = roll();
    // REPLAY A LOST DECIDER (one rewarded ad a day): a knockout tie that was lost is played once more.
    if (knockout && !r.through && profile.ads && useAd(save, 'replay', key, caps)) { ads.replay++; r = roll(); }
    const won = knockout ? r.through : r.won, drawn = !knockout && r.drawn;
    const pens: [number, number] | null = knockout && r.drawn ? (r.through ? [4, 3] : [3, 4]) : null;
    const xi = club.squad.slice(0, 11), shooters = xi.filter(p => p.role === 'FW' || p.role === 'MF');
    const facts = { played: xi.map(p => p.id), scorers: Array.from({ length: r.goals }, () => side.pick(shooters).id), my: r.goals, their: r.conceded, vs: nm.rival.name };
    save.record.played++; save.record.goalsFor += r.goals; save.record.goalsAgainst += r.conceded;
    if (won) { save.record.won++; res.w++; } else if (drawn) { save.record.drawn++; res.d++; } else { save.record.lost++; res.l++; }
    save.progress.streak = nextStreak(save.progress.streak, won, drawn);
    save.progress.bestStreak = Math.max(save.progress.bestStreak, save.progress.streak);
    const before = save.coins;
    let reward: ReturnType<typeof groundBonus>;
    if (league) {
      // What the matchday takes and brings, read off the rules before it is settled (the settlement must match it to the coin).
      const drain = Math.min(wageDrain(st), Math.max(0, Math.floor(save.coins)));
      const wages = staffWages(st), paid = wages > 0 && Math.floor(save.coins - drain) >= wages ? wages : 0;
      const sp = st.events.sponsor, sponsor = sp && (sp.pay === 'match' || r.won) ? sp.amount : 0;
      const commercial = nm.userHome && (paid > 0 || wages === 0) ? COMMERCIAL_HOME[hiredLevel(st, 'commercial')] : 0;
      if (!resolveMatchday(st, save, nm.md, nm.userHome ? r.goals : r.conceded, nm.userHome ? r.conceded : r.goals)) return;
      const prize = st.summary?.prize ?? 0;
      cout.wageDrain += drain; cout.staffWages += paid; cin.sponsor += sponsor; cin.commercial += commercial; cin.seasonPrizes += prize;
      residual += Math.abs(save.coins - before - (sponsor + commercial + prize - drain - paid));
      if (drain > 0) low.drained++;
      if (wages > 0 && !paid) low.unpaid++;
      afterMatch(st, facts);
      reward = groundBonus(st, matchReward(division, stadium, r.goals, r.conceded), nm.userHome, division);
    } else if (nm.competition === 'cup') {
      const out = resolveCupTie(st, r.goals, r.conceded, r.through, pens);
      if (!out) return;
      afterMatch(st, facts);
      reward = groundBonus(st, cupTieReward(division, stadium, r.goals, r.conceded, out), hosting, division);
    } else {
      const out = resolveCompTie(st, r.goals, r.conceded, knockout ? r.through : r.won, pens);
      if (!out) return;
      afterMatch(st, facts);
      reward = groundBonus(st, compTieReward(division, stadium, r.goals, r.conceded, out), hosting, division);
    }
    const atmo = hosting ? atmosphereOf(save, st.ground) : null;
    const payout = matchCoinPayout(reward, { streak: won ? save.progress.streak : 0, atmosphere: atmo?.income ?? 0, gradeBonus: rng.chance(.2) ? .05 : 0, doubler: false });
    const store = Math.min(payout.fixedCoins, hosting && hasPart(st.ground, 'store') ? megastoreCoins(division) : 0);
    save.coins += payout.coins; cin.matchFees += payout.matchCoins; cin.megastore += store; cin.cupPrizes += payout.fixedCoins - store;
    if (won) { winCoins += payout.matchCoins; winCount++; }
    // The FULL-TIME BONUS (a rewarded ad): the match fee once more.
    if (profile.ads && payout.adBonus > 0) { save.coins += payout.adBonus; cin.adMatch += payout.adBonus; ads.match++; adMax = Math.max(adMax, payout.adBonus); }
    if (atmo?.show) { save.coins += atmo.show; cin.halfTimeShow += atmo.show; }
    // The shared loops, as every match pays them (modelProfile above): live goals, challenges, the week, mastery, the Journey.
    const summary: MatchSummary = {
      won, drawn, goals: r.goals, conceded: r.conceded, assists: Math.max(0, r.goals - (side.chance(.5) ? 1 : 0)), passes: 12 + side.int(17), tacklesWon: 2 + side.int(5),
      skills: side.int(4), headers: r.goals > 0 && side.chance(.18) ? 1 : 0, longGoals: r.goals > 0 && side.chance(.15) ? 1 : 0, powerups: 0, motm: won && side.chance(.7),
      blitz: false, difficulty: matchDifficulty(division), skillGoals: r.goals > 0 && side.chance(.2) ? 1 : 0,
    };
    save.progress.stars += matchStars(summary);
    save.coins += 25; cin.live += 25;
    gain('skill', () => { save.coins += skillGoalCoins(summary.skillGoals ?? 0); });
    const xp = matchXp(summary) + 13, levelBefore = levelOf(save.progress.xp).level;
    save.progress.xp += xp;
    matches++;
    const levelNow = levelOf(save.progress.xp).level;
    gemGain('levels', () => addGems(save, (levelNow - levelBefore) * GEM_REWARDS.levelUp, 'levelUp'));
    for (let l = levelBefore + 1; l <= levelNow; l++) levels.push({ level: l, day: day + 1, matches });
    const daily = dailyFor(save.progress, key), done = advanceDaily(daily, dailyChallenges(daily.day), summary);
    gain('daily', () => { save.coins += done.reduce((n, d) => n + d.challenge.coins, 0); });
    earnTokens(save, done.length); tin.daily += done.length;
    gemGain('sweep', () => claimSweep(save, daily.day));
    gemGain('weekly', () => gain('weekly', () => { save.coins += advanceWeekly(save, key, summary, done.length).reduce((n, d) => n + d.objective.coins, 0); }));
    recordMatchMeta(save, { goals: r.goals, assists: summary.assists, passes: summary.passes, tackles: summary.tacklesWon, skills: summary.skills, saves: 2, cleanSheet: r.conceded === 0 }, xp, date);
    gain('mastery', () => { save.coins += claimMastery(save.mastery!).coins; });
    gain('journeys', () => { save.coins += claimAllSeason(seasonOf(save, date)); });
    if (passBought) gain('passTrack', () => { save.coins += claimAllPass(save).coins; });
    gemGain('journeys', () => syncSeasonGems(save));
    gemGain('achievements', () => syncAchievementGems(save));
    gemGain('playStreak', () => gain('playStreak', () => startStreakDay(save, key)));
    const jr = seasonOf(save, date);
    if (seasonTier(jr.xp) === 30 && journey < SEASON_THEMES.length && ++journey < SEASON_THEMES.length) {
      const next = Array.from({ length: SEASON_THEMES.length }, (_, n) => `pass${String(n + 1).padStart(2, '0')}`).find(k => !jr.journeys?.[k] && k !== `pass${jr.id.slice(-2)}`);
      if (next) selectJourney(jr, next);
    }
    // Back at the hub: the board pays what its objectives earned, the career's gems, the cards waiting, then the spending.
    gain('board', () => payBoard(st, save));
    for (const g of syncCareerGems(save, st)) gin[/OBJECTIVE/.test(g.what) ? 'board' : /LEGACY/.test(g.what) ? 'legacy' : 'trophies'] += g.gems;
    answerCards(key);
    matchRows.push({ n: matches, day: day + 1, season: season.number, division, competition: nm.competition, result: won ? 'W' : drawn ? 'D' : 'L', coins: payout.coins, balance: save.coins });
    manage(key, date);
    low.min = Math.min(low.min, save.coins);
    if (league && save.coins < staffWages(st)) low.short++;
  };
  const goalDays: Record<string, number | null> = { ground: null, staff: null, localNetwork: null, clubPass: null, allNetworks: null, midLook: null, topLook: null };
  const rows: { day: number; matches: number; season: number; division: number; coins: number; earned: number; spent: number; gems: number; tickets: number; ground: number; staff: number; rating: number; clubIncome: number; passive: number; oneTime: number; adGift: number; adGifts: number; winCoins: number; winCount: number }[] = [];
  for (day = 0; day < horizon; day++) {
    const date = new Date(start);
    date.setDate(start.getDate() + day);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    if (profile.weekdays.includes(day % 7)) {
      // The welcome sheet: the calendar gift and the ticket office. The gift's ad doubles the gift's coins, once a day
      // (not the office's: doubling both put this one ad at 1.8 match wins in week one, against a bar of one).
      const gift = calendarToday(save, key);
      let sheetAd = 0;
      if (gift) {
        const got = claimCalendar(save, key, gift.step, profile.ads)!;
        cin.calendar += profile.ads ? got.coins / 2 : got.coins; gin.calendar += got.gems; tin.calendar += got.tokens;
        if (profile.ads) { sheetAd += got.coins / 2; ads.gift++; }
        const c0 = save.coins, g0 = gems(save), t0 = scoutTokens(save);
        syncWelcomeWeek(save);
        cin.calendar += save.coins - c0; gin.welcomeWeek += gems(save) - g0; tin.welcomeWeek += scoutTokens(save) - t0;
      }
      const now = date.getTime(), rate = incomeRate(incomeSource(st, save));
      accrueIncome(save, now, rate);
      for (let n = 0; n < profile.collects; n++) {
        gain('clubIncome', () => collectIncome(save, now + n * INCOME_CAP_HOURS * 3_600_000, rate));
      }
      cin.adGift += sheetAd; sheetMax = Math.max(sheetMax, sheetAd);
      if (profile.ads) {
        for (let n = caps.gem; n > 0; n--) { const b = gems(save); claimDailyGems(save, key, caps); if (gems(save) > b) { gin.ads += gems(save) - b; ads.gems++; } }
        for (let n = FREE_AD_DAILY_CAP; n > 0; n--) if (gain('adCoins', () => claimFreeAd(save, key)) > 0) ads.coins++;
      }
      const motd = motdOf(save, key);
      if (motd && side.chance(profile.motd)) {
        gemGain('matchOfDay', () => gain('matchOfDay', () => claimMotd(save, key, motd.moment.id, true)));
        save.moments = { ...(save.moments ?? {}), [motd.moment.id]: Math.max(1, save.moments?.[motd.moment.id] ?? 0) };
      }
      for (let i = 0; i < profile.matches; i++) playMatch(key, date);
      // Scout Tickets: the day's free pack, Elite Packs while the eleven is under par, Scout Packs with the rest.
      if (freePackReady(save, key)) pack('scout', key, true);
      while (clubRating(club) < par() && scoutTokens(save) >= PACK_TOKENS.elite && pack('elite', key, false));
      while (scoutTokens(save) >= PACK_TOKENS.scout && pack('scout', key, false));
    }
    const tier = scoutNetworkTier(save), goal = (k: string, ok: boolean) => { if (ok && goalDays[k] === null) goalDays[k] = day + 1; };
    goal('ground', parts() >= PARTS.reduce((n, p) => n + p.steps.length, 0)); goal('staff', staffSum() >= STAFF_ROLES.length * 3);
    goal('localNetwork', tier >= 1); goal('clubPass', passBought); goal('allNetworks', tier >= SCOUT_NETWORKS.length);
    goal('midLook', save.coins >= 1200); goal('topLook', save.coins >= 7500);
    rows.push({ day: day + 1, matches, season: st.season?.number ?? 0, division: st.season?.division ?? 0, coins: save.coins, earned: total(cin), spent: total(cout), gems: gems(save),
      tickets: scoutTokens(save), ground: groundLevel(st.ground), staff: staffSum(), rating: clubRating(club), clubIncome: cin.clubIncome, passive: PASSIVE_KEYS.reduce((n, k) => n + cin[k], 0),
      oneTime: cout.ground + cout.staffFees, adGift: cin.adGift, adGifts: ads.gift, winCoins, winCount });
  }
  return {
    profile, seed, horizon, seasons, rows, matchRows, builds, promotions, levels, goalDays, ads, cards, residual, adMax, sheetMax, winAverage: winCount ? winCoins / winCount : 0,
    coinsIn: cin, coinsOut: cout, gemsIn: gin, gemsOut: gout, ticketsIn: tin, ticketsOut: tout,
    end: { coins: save.coins, gems: gems(save), tickets: scoutTokens(save), division: st.season?.division ?? 0, season: st.season?.number ?? 0, rating: clubRating(club), level: levelOf(save.progress.xp).level,
      unpaid: st.staff.unpaid },
  };
}
export type CareerRun = ReturnType<typeof modelCareer>;

/** The stages a share is measured over (days). */
const STAGES: readonly [number, number][] = [[1, 7], [8, 30], [31, 90], [91, CAREER_HORIZON]];
/** What was measured on the rules as they stood before this pass (economy v6, 14 October 2026), same model, same seeds. */
export const BEFORE_V7 = { clubIncomeShare: 0.266, clubIncomeProfile: 'Keen, optional ads, days 31 to 90', sponsorCashRatio: 2.37, sponsorCashPerMatchday: 379, sponsorMatchPerMatchday: 160, ticketOffice: [16, 19, 22, 25, 28, 32], sponsorGap: 3 } as const;
/** A stand-in player of this overall, with the age and contract a listing of that kind carries. */
function sample(ovr: number, age: number, contract: number): MetaPlayer {
  const p = rollPack('scout', ovr, 4242).player;
  tuneToOverall(p, ovr);
  delete p.scoutResale;
  return Object.assign(p, { age, contract, potential: 0 });
}
const r10 = (n: number) => Math.round(n / 10) * 10;
/** Every way a player could try to turn coins into more coins without playing: what goes in, what comes back. */
export function arbitrageTable() {
  return [8, 5, 1].flatMap(division => {
    // (A league win at the ground a club of that division has: a park pitch at the bottom, the dome in the Elite League.)
    const ovr = divisionPlayerOverall(division, 'MF'), win = payTable(division, Math.max(0, 6 - division)).win;
    const agent = sample(ovr, 26, 2), price = playerPrice(agent), value = playerValue(agent);
    const kid = sample(ovr - 9, 17, 3), kidFee = r10(Math.max(40, playerPrice(kid) * 0.6 * REGIONS.home.fee));
    const stat = bestStat(agent), trained = stat ? { ...agent, stats: { ...agent.stats, [stat]: agent.stats[stat] + TRAIN_STEP } } : agent;
    const row = (trade: string, instant: boolean, cost: number, back: number, how: string) => ({ division, ovr, win, trade, instant, cost, back, profit: back - cost, wins: (back - cost) / win, how });
    return [
      row('Free agent at his asking price, sold at once', true, price, quickSaleValue(agent), `quick sale, ${QUICK_SALE * 100}% of his value`),
      row('Free agent, sold the same season before 6 league starts (best offer)', false, price, Math.min(r10(value * .95), r10(price * RESALE_CAP)), `offers capped at ${RESALE_CAP} x what was paid`),
      row('Free agent, sold after 6 league starts (expected offer)', false, price, r10(value * .825), 'AI offers are 70 to 95% of his value'),
      row('A training session, then sold (the value +2 adds)', true, trainingCost(agent), playerValue(trained) - value, 'the value added against the session'),
      row('A scout\'s home youth find, sold at once', true, kidFee, quickSaleValue(kid), 'quick sale'),
      row('A scout\'s home youth find, sold after 6 league starts (expected offer)', false, kidFee, r10(playerValue(kid) * .825), 'needs a squad place, an open window and an offer (65% a week)'),
      row('An academy prospect, promoted and sold at once', false, 0, quickSaleValue(sample(ovr - 14, 16, 3)), 'two to five a season, none after a season of walk-offs'),
    ];
  });
}
/**
 * Interstitials in one visit of `matches` matches on a save that had `completedBefore` finished: one before a kick-off
 * (never the visit's first match), one at half time, none until two matches are finished on the save, and at least
 * `gap` minutes between any two (the portal's SDK).
 */
export function interstitials(matches: number, completedBefore: number, t = { kickToHalf: 2.5, halfToKick: 3.5, gap: 3 }): number {
  let last = -Infinity, n = 0, clock = 0;
  for (let i = 0; i < matches; i++) {
    const open = completedBefore + i >= 2;
    if (i > 0 && open && clock - last >= t.gap) { n++; last = clock; }
    clock += t.kickToHalf;
    if (open && clock - last >= t.gap) { n++; last = clock; }
    clock += t.halfToKick;
  }
  return n;
}
export interface BalanceCheck { id: string; area: string; check: string; bar: string; op: '<=' | '>='; limit: number; value: number; unit: string; before: number | null; pass: boolean; note: string }
/** The career profiles, the variants the checks need, and one row per balance check: the bar, the measured value, PASS or FAIL. */
export function buildCareerModel(shared: ReturnType<typeof modelProfile>[], comeback: ReturnType<typeof buildComebackModel>) {
  const runs = CAREER_PROFILES.map(p => modelCareer(p));
  const [learning, regular, strong] = runs;
  const base = CAREER_PROFILES[1];
  const variant = (id: string, name: string, over: Partial<CareerProfile>, seed = CAREER_SEED) => modelCareer({ ...base, id, name, ...over }, CAREER_HORIZON, seed);
  const allAds = variant('career-regular-ads', 'Career regular, every ad', { ads: true });
  const collector = variant('career-regular-collector', 'Career regular, signs every better card, hires everyone', { naive: true });
  const sponsor = [regular, variant('career-sponsor-win', 'Career regular, WIN BONUS', { sponsor: 1 }), variant('career-sponsor-cash', 'Career regular, CASH NOW', { sponsor: 2 })].map((r, i) => {
    const coins = r.seasons.reduce((n, s) => n + s.in.sponsor, 0), matchdays = r.seasons.length * MATCHDAYS;
    return { answer: ['EVERY MATCH', 'WIN BONUS', 'CASH NOW'][i], coins, matchdays, perMatchday: coins / matchdays };
  });
  const stage = (r: CareerRun) => STAGES.filter(([, to]) => to <= r.horizon).map(([from, to]) => {
    const a = from > 1 ? r.rows[from - 2] : { earned: r.coinsIn.welcome, clubIncome: 0, passive: 0, adGift: 0, adGifts: 0, winCoins: 0, winCount: 0 };
    const b = r.rows[to - 1], days = to - from + 1, income = b.clubIncome - a.clubIncome, earned = b.earned - a.earned, passive = b.passive - a.passive;
    const win = (b.winCoins - a.winCoins) / Math.max(1, b.winCount - a.winCount), sheet = (b.adGift - a.adGift) / Math.max(1, b.adGifts - a.adGifts);
    return { profile: r.profile.name, from, to, incomePerDay: Math.round(income / days), otherPerDay: Math.round((earned - income) / days), incomeShare: income / Math.max(1, earned - income),
      passivePerDay: Math.round(passive / days), matchPerDay: Math.round((earned - passive) / days), passiveShare: passive / Math.max(1, earned - passive),
      winFee: Math.round(win), sheetAd: Math.round(sheet), sheetAdWins: win > 0 ? sheet / win : 0 };
  });
  const stages = [...runs, allAds].flatMap(stage);
  const sharedPassive = shared.map(m => {
    const s = m.coinSources, passive = s.calendar + s.clubIncome + s.matchOfDay + s.streak + s.coinAds, all = total(s) - s.welcome;
    return { profile: m.profile.name, passive, match: all - passive, share: passive / (all - passive) };
  });
  const catalogue = shopItems().filter(i => i.price > 0 && !i.pass).reduce((n, i) => n + i.price, 0);
  const groundCost = PARTS.reduce((n, p) => n + p.steps.reduce((m, x) => m + x.cost, 0), 0), staffCost = STAFF.reduce((n, d) => n + d.levels.reduce((m, l) => m + l.fee, 0), 0);
  const exhausted = (r: CareerRun) => r.rows.find(x => x.coins + x.oneTime >= groundCost + staffCost + catalogue)?.day ?? null;
  // The same manager with every ad and with none, three seeds each: the days to each goal.
  const seeds = [1, 2].map(n => CAREER_SEED + n);
  const free = [regular, ...seeds.map(s => variant('career-regular', base.name, {}, s))], watched = [allAds, ...seeds.map(s => variant('career-regular-ads', 'Career regular, every ad', { ads: true }, s))];
  const meanDay = (rs: CareerRun[], k: string): number | null => rs.some(r => r.goalDays[k] === null) ? null : rs.reduce((n, r) => n + (r.goalDays[k] ?? 0), 0) / rs.length;
  const GOALS: [string, string][] = [['midLook', 'A mid look in the wallet (1,200 coins)'], ['topLook', 'A top look in the wallet (7,500 coins)'], ['ground', 'The whole ground built'],
    ['staff', 'Every member of staff at level 3'], ['localNetwork', 'Local Scouting Network'], ['clubPass', 'Club Pass'], ['allNetworks', 'All three Scouting Networks']];
  const adGoals = GOALS.map(([k, goal]) => { const a = meanDay(free, k), b = meanDay(watched, k); return { goal, noAds: a, everyAd: b, ratio: a !== null && b ? a / b : null }; });
  const placements = (r: CareerRun) => {
    const played = Math.round(r.horizon * r.profile.weekdays.length / 7), coins = total(r.coinsIn), gemTotal = total(r.gemsIn);
    const row = (placement: string, cap: string, taken: number, got: number, gemsGot: number, worth: string) => ({ profile: r.profile.name, placement, cap, taken, perDay: taken / played,
      coins: got, gems: gemsGot, coinsEach: taken ? got / taken : 0, coinShare: got / coins, gemShare: gemsGot / gemTotal, worth });
    return [
      row('Daily gift doubled', '1 a day', r.ads.gift, r.coinsIn.adGift, 0, 'the gift\'s coins again'),
      row('Full-time bonus', 'every match', r.ads.match, r.coinsIn.adMatch, 0, 'the match fee once more: exactly one match'),
      row('FREE COINS', `${FREE_AD_DAILY_CAP} a day`, r.ads.coins, r.coinsIn.adCoins, 0, `${FREE_AD_COINS} coins each`),
      row('FREE GEMS', `${r.profile.portal ? PORTAL_GEM_OFFERS : APP_AD_CAPS.gem} a day`, r.ads.gems, 0, r.gemsIn.ads, `${GEM_REWARDS.dailyAd} gems each`),
      row('One matchday off a build', '1 a day', r.ads.build, 0, 0, `time: ${GEM_PRICES.finishBuildPerMatchday} gems as a shortcut, pays no currency`),
      row('Heal a player', '1 a day', r.ads.heal, 0, 0, `time: ${GEM_PRICES.healPlayer} gems as a shortcut, pays no currency`),
      row('Replay a lost decider', '1 a day', r.ads.replay, 0, 0, `a second go at the same tie (${GEM_PRICES.replayMatch} gems as a shortcut): worth that match at most`),
      row('A new daily deal', '1 a day', 0, 0, 0, `not modelled: a different look on offer (${GEM_PRICES.dealRefresh} gems as a shortcut), pays no currency`),
    ];
  };
  const visits = [...runs, allAds].map(r => ({ profile: r.profile.name, matches: r.profile.matches, minutes: r.profile.matches * 6, firstVisit: interstitials(r.profile.matches, 0),
    laterVisit: interstitials(r.profile.matches, 2), perHour: interstitials(r.profile.matches, 2) / (r.profile.matches * 6) * 60, rewardedPerDay: total(r.ads) / Math.max(1, Math.round(r.horizon * r.profile.weekdays.length / 7)) }));
  const unlocks = new Map<number, string[]>();
  for (const t of LEVEL_TITLES) unlocks.set(t.level, [`title ${t.title}`]);
  for (const it of shopItems()) if (it.level !== undefined && it.level > 1) unlocks.set(it.level, [...(unlocks.get(it.level) ?? []), `${it.name} (${it.cat}, or ${it.price} coins)`]);
  const xp = runs.flatMap(r => [...unlocks.keys()].filter(l => l > 1 && l <= 30).sort((a, b) => a - b).map(level => {
    const hit = r.levels.find(x => x.level === level);
    return { profile: r.profile.name, level, unlocks: unlocks.get(level)!.join(', '), day: hit?.day ?? null, matches: hit?.matches ?? null };
  }));
  // What a league matchday is worth to the club in each division, against the staff and a wage bill over budget.
  const fullStaff = STAFF.reduce((n, d) => n + d.levels[d.levels.length - 1].wage, 0);
  const divisions = [8, 7, 6, 5, 4, 3, 2, 1].flatMap(division => [0, 5].map(stadium => {
    const pt = payTable(division, stadium), fee = base.win * (pt.win + 2 * pt.goal) + base.draw * (pt.draw + pt.goal) + (1 - base.win - base.draw) * pt.loss;
    const sponsorBase = r10(20 + 12 * (BOTTOM_DIVISION - division)), budget = wageBudget(division, stadium);
    return { division, league: DIVISION_NAMES[division], stadium, par: divisionLevel(division) + 5, winFee: pt.win, expectedFee: Math.round(fee), sponsor: sponsorBase, megastoreHome: megastoreCoins(division),
      fullStaffWages: fullStaff, staffShare: fullStaff / (fee + sponsorBase * 1.75 + COMMERCIAL_HOME[3] / 2 + megastoreCoins(division) / 2), wageBudget: budget,
      tenOverCosts: Math.round(budget * 0.1 * WAGE_DRAIN), relegatedCosts: division > 1 ? Math.round((wageBudget(division - 1, stadium) - budget) * WAGE_DRAIN) : 0, parSigning: playerPrice(sample(divisionLevel(division) + 5, 26, 2)), session: trainingCost(sample(divisionLevel(division) + 5, 26, 2)) };
  }));
  // ---- the checks
  const policy = runs.flatMap(r => r.seasons.map(s => ({ ...s, profile: r.profile.name })));
  const worst = <T>(list: T[], f: (x: T) => number) => list.reduce((m, x) => Math.max(m, f(x)), 0);
  const incomeShares = [...comeback.incomeShare.map(s => s.share), ...stages.map(s => s.incomeShare)];
  const arbitrage = arbitrageTable();
  const gaps = regular.builds.map(b => b.sinceLast);
  const firstWeek = stages.find(s => s.profile === allAds.profile.name && s.from === 1)!;
  const sheetWorst = worst(stages.filter(s => s.profile === allAds.profile.name), s => s.sheetAdWins);
  const adShare = (allAds.coinsIn.adGift + allAds.coinsIn.adMatch + allAds.coinsIn.adCoins) / total(allAds.coinsIn);
  const squadSpend = (regular.coinsOut.transfers + regular.coinsOut.training) / total(regular.coinsOut);
  const collectorWorst = worst(collector.seasons, s => (s.out.staffWages + s.out.wageDrain + s.out.contracts + s.out.events) / Math.max(1, s.coinsIn));
  const collectorDrain = worst(collector.seasons, s => s.out.wageDrain / Math.max(1, s.clubIncome));
  const portalAll = comeback.afford.filter(a => /Club Pass and all three/.test(a.goal)).map(a => a.dayAll ?? Infinity);
  const C = (id: string, area: string, check: string, bar: string, op: '<=' | '>=', limit: number, value: number, unit: string, note: string, before: number | null = null): BalanceCheck =>
    ({ id, area, check, bar, op, limit, value, unit, before, pass: op === '<=' ? value <= limit : value >= limit, note });
  const checks: BalanceCheck[] = [
    C('ledger', 'The model', 'Every league matchday settles to the coin against the rules read beforehand', 'No coin unaccounted for', '<=', 0, [...runs, allAds, collector].reduce((n, r) => n + r.residual, 0), 'coins', 'Wages, the wage drain, the sponsor, the commercial manager and the season prize, itemised before the engine settles the matchday.'),
    C('wages-paid', 'Wages', 'Matchdays the staff went unpaid, careful manager, all three profiles, every division', 'Never', '<=', 0, policy.reduce((n, s) => n + s.unpaidMatchdays, 0), 'matchdays', `Lowest balance after spending in any season: ${Math.min(...policy.map(s => s.balanceMin))} coins (the wage reserve of a new club).`),
    C('wage-drain', 'Wages', 'Coins the wage drain took from a careful manager, against what his league matchdays brought', 'Under 1%', '<=', 0.01, policy.reduce((n, s) => n + s.out.wageDrain, 0) / policy.reduce((n, s) => n + s.clubIncome, 0), 'share', `${policy.reduce((n, s) => n + s.drainMatchdays, 0)} matchdays in ${policy.length} seasons: he sells down to the budget before a new season's first match. One who does not, relegated to the County League with the wage bill of the division above, is drained ${divisions.find(d => d.division === 5 && d.stadium === 5)!.relegatedCosts} coins a matchday (an expected match fee there is ${divisions.find(d => d.division === 5 && d.stadium === 5)!.expectedFee}) until players are sold.`),
    C('wage-share', 'Wages', 'Staff wages against what league matchdays bring the club, worst season of any profile', 'Under two thirds', '<=', 0.67, worst(policy, s => s.wageShare), 'share', 'The full staff costs the same 320 a matchday in every division: it is paced by the division, not by the fee.'),
    C('collector-spiral', 'Wages', 'A collector who signs every better card and hires everyone: wages, drain and contracts against all he earns, worst season', 'Under 100% (no death spiral)', '<=', 1, collectorWorst, 'share', `His wage drain alone reaches ${Math.round(collectorDrain * 100)}% of what his league matchdays bring: the brake on a squad far over its division. He still promotes; his ground is finished on day ${collector.goalDays.ground} instead of ${regular.goalDays.ground}.`),
    C('ground-part', 'Sinks', 'Matches between one part of the ground and the next, regular player, longest wait', '8 matches at most', '<=', 8, Math.max(...gaps), 'matches', `Every wait: ${gaps.join(', ')}. One part goes up at a time and takes one or two matchdays.`),
    C('ground-whole', 'Sinks', 'The whole ground (35,600 coins), regular player', 'Inside 6 weeks of daily play', '<=', 42, regular.goalDays.ground ?? 999, 'days', `Learning (3 days a week): day ${learning.goalDays.ground}. Strong with every ad: day ${strong.goalDays.ground}.`),
    C('staff-whole', 'Sinks', 'Every member of staff at level 3 (24,900 coins of fees), regular player', 'Inside 10 weeks of daily play', '<=', 70, regular.goalDays.staff ?? 999, 'days', `Paced by the division (wages). Learning: ${learning.goalDays.staff === null ? 'not inside the run' : `day ${learning.goalDays.staff}`}.`),
    C('mid-look', 'Sinks', 'A mid look (1,200 coins) in the wallet beside the club, regular player', 'Inside 5 days', '<=', 5, regular.goalDays.midLook ?? 999, 'days', `Learning: day ${learning.goalDays.midLook}.`),
    C('top-look', 'Sinks', 'A top look (7,500 coins) in the wallet beside the club, regular player', 'Inside 3 weeks', '<=', 21, regular.goalDays.topLook ?? 999, 'days', `Learning: day ${learning.goalDays.topLook}.`),
    C('passive', 'Sources', 'Coins that need no match (gift, ticket office, match of the day, streak day, coin ads) against coins from matches, worst profile and stage', 'Under what the matches pay (100%)', '<=', 1, Math.max(worst(sharedPassive, s => s.share), worst(stages, s => s.passiveShare)), 'share', `Shared profiles over 90 days: ${sharedPassive.map(s => `${s.profile} ${Math.round(s.share * 100)}%`).join(', ')}.`),
    C('club-income', 'Sources', 'Club income against the rest of a day\'s coins, every profile (shared, portal, career) at every stage', 'Under a quarter', '<=', 0.25, Math.max(...incomeShares), 'share', `Before: ${BEFORE_V7.clubIncomeProfile}. The lever was the ticket office: ${BEFORE_V7.ticketOffice.join(' / ')} became ${TICKET_OFFICE.join(' / ')} coins an hour.`, BEFORE_V7.clubIncomeShare),
    C('sponsor', 'Arbitrage', 'The sponsor card: CASH NOW taken every time against EVERY MATCH, coins a league matchday', 'No answer more than a quarter better', '<=', 1.25, sponsor[2].perMatchday / sponsor[0].perMatchday, 'ratio', `Coins a league matchday: ${sponsor.map(s => `${s.answer} ${Math.round(s.perMatchday)}`).join(', ')}. Before, a new sponsor called ${BEFORE_V7.sponsorGap} matchdays after the cash was taken.`, BEFORE_V7.sponsorCashRatio),
    C('flip-instant', 'Arbitrage', 'Buy and sell at once (a free agent, a scout\'s find), train and sell: best profit', 'Nothing', '<=', 0, Math.max(...arbitrage.filter(a => a.instant).map(a => a.profit)), 'coins', 'A quick sale is 45% of value; a session adds a fraction of its cost to a player\'s value.'),
    C('flip-held', 'Arbitrage', 'Buy, play him six league starts, sell: expected profit in league wins, best case', 'Two league wins at most', '<=', 2, Math.max(...arbitrage.filter(a => !a.instant && a.cost > 0).map(a => a.wins)), 'wins', 'The scout\'s home youth find is the bargain it is meant to be; a free agent resold loses money on average.'),
    C('tickets', 'Currencies', 'Scout Tickets left unspent at the end, regular player', 'Under 5% of those earned', '<=', 0.05, regular.end.tickets / Math.max(1, total(regular.ticketsIn)), 'share', `${regular.cards.signed} cards signed and ${regular.cards.sold} sold for their resale credit (${Math.round(regular.coinsIn.cardSales / total(regular.coinsIn) * 1000) / 10}% of his coins): a ticket always has a use.`),
    C('gems-portal', 'Currencies', 'The dearest gem goal (Club Pass and all three networks, 2,300 gems) on a portal with nothing for sale, slowest profile', 'Inside the modelled year', '<=', 365, Math.max(...portalAll), 'days', `Career regular, no ads: Local network day ${regular.goalDays.localNetwork}, Club Pass day ${regular.goalDays.clubPass}, all three networks day ${regular.goalDays.allNetworks}.`),
    C('squad-sink', 'Lopsided', 'Share of a regular player\'s spending that goes on players (transfers and training)', 'At least a tenth', '>=', 0.1, squadSpend, 'share', `Pack cards are drawn against his own eleven, four a day, free: ${regular.cards.signed} signed in ${regular.horizon} days keep it above its division's par with no coins. DESIGN DECISION, not a number.`),
    C('sinks-last', 'Lopsided', 'The day a regular player has paid for every coin sink in the game (ground, staff, the whole look catalogue)', 'Not inside 60 days', '>=', 60, exhausted(regular) ?? 999, 'days', `Strong with every ad: day ${exhausted(strong) ?? `beyond ${strong.horizon}`}. Learning: ${exhausted(learning) === null ? `beyond ${learning.horizon}` : `day ${exhausted(learning)}`}. After it nothing is left to buy but players. DESIGN DECISION: late sinks.`),
    C('ads-twice', 'Ads', 'A player who never watches an ad against one who watches them all: days to each goal, worst ratio', 'Twice the time at most', '<=', 2, Math.max(...adGoals.map(g => g.ratio ?? 0)), 'ratio', adGoals.map(g => `${g.goal}: ${g.noAds === null ? 'beyond the run' : Math.round(g.noAds)} against ${g.everyAd === null ? 'beyond the run' : Math.round(g.everyAd)}`).join('; ')),
    // (The bar was "one win" when the ad also doubled the ticket office: 1.8 wins, and the office doubling was taken
    // out. What is left is the daily gift's own 2X, in the game since economy v2: 250 coins on average in a first week
    // against a 233 coin win, once a day. About one win is the honest bar for it: a quarter over at most.)
    C('ad-single', 'Ads', 'The daily gift\'s 2X ad against a won match\'s fee at the same stage, worst stage', 'About one match win (a quarter over at most)', '<=', 1.25, sheetWorst, 'wins', `Days 1 to 7: the ad adds ${firstWeek.sheetAd} coins on average, a won match pays ${firstWeek.winFee}. Doubling the ticket office with it as well made this 1.8 and was taken out. The full-time bonus is one match by rule; FREE COINS is ${FREE_AD_COINS}.`),
    C('ad-share', 'Ads', 'Share of coins that come from ads for a regular player who watches every one', 'Under half', '<=', 0.5, adShare, 'share', `Strong, 6 matches a day: ${Math.round((strong.coinsIn.adGift + strong.coinsIn.adMatch + strong.coinsIn.adCoins) / total(strong.coinsIn) * 100)}%. The full-time bonus on every match is nearly all of it.`),
  ];
  const slim = (r: CareerRun) => ({ profile: r.profile, seed: r.seed, horizon: r.horizon, seasons: r.seasons, promotions: r.promotions, builds: r.builds, goalDays: r.goalDays, ads: r.ads, cards: r.cards,
    coinsIn: r.coinsIn, coinsOut: r.coinsOut, gemsIn: r.gemsIn, gemsOut: r.gemsOut, ticketsIn: r.ticketsIn, ticketsOut: r.ticketsOut, end: r.end, exhausted: exhausted(r), winAverage: r.winAverage,
    sheetMax: r.sheetMax, rows: r.rows.filter(x => x.day % 5 === 0 || x.day === 1) });
  return {
    horizon: CAREER_HORIZON, seed: CAREER_SEED, assumptions: CAREER, costs: { ground: groundCost, staff: staffCost, catalogue, fullStaffWages: fullStaff },
    runs: [...runs, allAds, collector].map(slim), matchLedger: regular.matchRows, stages, sharedPassive, sponsor, arbitrage, divisions, xp, checks,
    ads: { goals: adGoals, placements: [allAds, strong].flatMap(placements), visits, timing: { kickToHalf: 2.5, halfToKick: 3.5, gap: 3 } },
  };
}

export function buildEconomyModel() {
  const profiles = PROFILES.map(p => modelProfile(p));
  const ranges = PROFILES.map(p => {
    const runs = Array.from({length: 20}, (_, n) => modelProfile(p, 90, 6102026 + n));
    const end = runs.map(r => r.rows.at(-1)!);
    return { id: p.id, coinsMin: Math.min(...end.map(r => r.coins)), coinsMax: Math.max(...end.map(r => r.coins)), gemsMin: Math.min(...end.map(r => r.gems)), gemsMax: Math.max(...end.map(r => r.gems)) };
  });
  const scoutResale = [41, 65, 90].map(ovr => {
    const cards = Array.from({length: 1000}, (_, seed) => rollPack('scout', ovr, seed).player);
    const values = cards.map(quickSaleValue);
    const previous = cards.map(p => { const legacy = {...p, scoutResale: undefined}; return quickSaleValue(legacy); });
    return {ovr, mean: values.reduce((a,b)=>a+b,0)/values.length, previousMean: previous.reduce((a,b)=>a+b,0)/previous.length, min: Math.min(...values), max: Math.max(...values)};
  });
  const comeback = buildComebackModel(profiles);
  return {
    economyVersion: 7, generatedFor: '2026-10-15', horizon: 90,
    comeback, career: buildCareerModel(profiles, comeback),
    assumptions: [
      'Scenario forecasts, not player telemetry, human playtests or revenue forecasts.',
      'Six minutes per match: four playing minutes at the default two-minute halves, plus an assumed two minutes of menus, stoppages and scenes. Ad watch time excluded.',
      'Results are seeded with stated win/draw rates. Statistics are assumed; classic matches only, so Blitz and Hard challenges may remain incomplete.',
      'All reached free rewards are claimed, and players select each next Journey after completing one. No paid passes, purchases, referrals or gem spending in base cases.',
      'Two live objectives per match are assumed (25 coins, 13 XP); no atmosphere boost. Two keeper saves per match; 20% of matches are assumed A-grade (+5% match coins), all others receive no grade bonus. All income uses actual rule functions.',
      'Coin totals are cumulative gross earning, including the 500-coin welcome, NOT spendable balances after club purchases. Each goal is estimated independently.',
      'Free packs are availability counts, not assumed claims. Earned ticket counts exclude the starting two. Both are tracked separately; cards can improve squads or be sold, not both. Resale table estimates their additional value at fixed squad ratings.',
      'Career prizes, board objectives, academy sales, sponsorship, commercial income, renewals and development spending are separate from these shared-loop scenarios: the career sheets (15 October 2026) simulate them.',
      'No-ads and paid-doubler regular cases use identical results/random seeds. Optional ads case assumes one gem ad, gift ad and match ad per active day, no five-per-day coin-ad grind.',
      'Ranges show 20 deterministic seeds at the stated assumptions; they are sensitivity ranges, not statistical confidence intervals.',
      'Coming back (14 October 2026): the welcome week and the play streak are claimed on every day played; the MATCH OF THE DAY is completed on 40% (Learning), 60% (Casual), 75% (Regular) or 90% (Keen) of them. Looks handed over are counted at their shop price as looks, never as coins.',
      'Club income: the modelled club puts 40% of every coin earned into its ground (cheapest part first, one build at a time, a league matchday on every day played) and its commercial manager; the ticket office is collected once on a day played (Keen: twice). No stadium style is bought, so the atmosphere is the ground\'s own.',
      `The career (15 October 2026): ROAD TO GLORY on the game's own engine for ${CAREER_HORIZON} days, every match a career match, at 45/25/30 (3 days a week, 2 matches), 60/20/20 (daily, 3) and 75/15/10 (daily, 6, every ad). Who wins is assumed (the mix at par, moved by the rating gap and the division's difficulty) and so is what the manager buys; both are written out on the sheet Career By Season. Club Run, online play and SIM THIS MATCH are not in it.`,
      'Portal profiles (CrazyGames, Poki): nothing is sold. Casual takes one FREE GEMS offer a visit; Keen takes every FREE GEMS offer, the doubled gift, one match bonus and two FREE COINS a day. Days to afford run a 365 day horizon and assume nothing else is bought with that currency.',
    ],
    profiles, ranges, scoutResale,
    commercial: STAFF.find(s=>s.role==='commercial')!.levels.map((s,i)=>({level:i+1,fee:s.fee,wage:s.wage,home:COMMERCIAL_HOME[i+1],netPerMatch:COMMERCIAL_HOME[i+1]/2-s.wage})),
    constants: { welcomeCoins: 500, welcomeGems: 50, weeklyLoopGemsWithAds: weeklyLoopGems(), weeklyLoopGemsNoAds: weeklyLoopGems()-7 * AD_CAPS.gem * GEM_REWARDS.dailyAd, gemPrices: GEM_PRICES, gemRewards: GEM_REWARDS, calendar: CALENDAR, coinOffers: COIN_OFFERS,
      referralCoins: FRIEND_REWARD.coins, referralGems: FRIEND_REWARD.gems, freeAdCoins: FREE_AD_COINS, freeAdDailyCap: FREE_AD_DAILY_CAP, journeyXp: tierXp(30), journeyCount: SEASON_THEMES.length, pass: passTotals('2026-10') },
    sinks: [...STAFF.flatMap(p=>p.levels.map((s,i)=>({category:'Staff',id:`${p.role}:${i+1}`,name:`${p.name} ${i+1}`,coins:s.fee,gems:0,waitMatches:0}))), ...PARTS.flatMap(p => p.steps.map((s,i) => ({category:'Ground', id: `${p.id}:${i+1}`, name:s.name, coins:s.cost, gems:0, waitMatches:s.weeks}))),
      ...shopItems().filter(i => i.price>0 && !i.pass).map(i=>({category: i.cat, id:`${i.cat}:${i.id}`, name:i.name, coins:i.price, gems:0, waitMatches:0})),
      ...GEM_PRICES.scoutNetwork.map((gems,i)=>({category:'Gem sink',id:`scoutNetwork:${i+1}`,name:`SCOUTING NETWORK ${i+1}`,coins:0,gems,waitMatches:0})),
      ...Object.entries(GEM_PRICES).filter(([,n])=>typeof n==='number').map(([id,n])=>({category:'Gem sink',id,name:id,coins:0,gems:n,waitMatches:0}))],
    store: CATALOGUE.map(p=>({id:p.id,title:p.title,usd:p.usd,gems:gemsOf(p),firstGems:isGemPack(p)?gemsOf(p)*FIRST_BUY_MULT:gemsOf(p),coins:p.coins,kind:p.kind,tag:p.tag??''})),
    careerFees: [8,6,4,2,1].flatMap(division=>[0,3,5].map(stadium=>({division,stadium,...payTable(division,stadium),twoGoalWin:matchCoins(division,stadium,2,0),twentyGoalWin:matchCoins(division,stadium,20,0)}))),
  };
}
