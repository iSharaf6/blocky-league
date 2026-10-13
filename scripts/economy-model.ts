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
  return {
    economyVersion: 6, generatedFor: '2026-10-14', horizon: 90,
    comeback: buildComebackModel(profiles),
    assumptions: [
      'Scenario forecasts, not player telemetry, human playtests, revenue forecasts or complete-career simulations.',
      'Six minutes per match: four playing minutes at the default two-minute halves, plus an assumed two minutes of menus, stoppages and scenes. Ad watch time excluded.',
      'Results are seeded with stated win/draw rates. Statistics are assumed; classic matches only, so Blitz and Hard challenges may remain incomplete.',
      'All reached free rewards are claimed, and players select each next Journey after completing one. No paid passes, purchases, referrals or gem spending in base cases.',
      'Two live objectives per match are assumed (25 coins, 13 XP); no atmosphere boost. Two keeper saves per match; 20% of matches are assumed A-grade (+5% match coins), all others receive no grade bonus. All income uses actual rule functions.',
      'Coin totals are cumulative gross earning, including the 500-coin welcome, NOT spendable balances after club purchases. Each goal is estimated independently.',
      'Free packs are availability counts, not assumed claims. Earned ticket counts exclude the starting two. Both are tracked separately; cards can improve squads or be sold, not both. Resale table estimates their additional value at fixed squad ratings.',
      'Career prizes, board objectives, academy sales, sponsorship, commercial income, renewals and development spending are separate from these shared-loop scenarios.',
      'No-ads and paid-doubler regular cases use identical results/random seeds. Optional ads case assumes one gem ad, gift ad and match ad per active day, no five-per-day coin-ad grind.',
      'Ranges show 20 deterministic seeds at the stated assumptions; they are sensitivity ranges, not statistical confidence intervals.',
      'Coming back (14 October 2026): the welcome week and the play streak are claimed on every day played; the MATCH OF THE DAY is completed on 40% (Learning), 60% (Casual), 75% (Regular) or 90% (Keen) of them. Looks handed over are counted at their shop price as looks, never as coins.',
      'Club income: the modelled club puts 40% of every coin earned into its ground (cheapest part first, one build at a time, a league matchday on every day played) and its commercial manager; the ticket office is collected once on a day played (Keen: twice). No stadium style is bought, so the atmosphere is the ground\'s own.',
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
