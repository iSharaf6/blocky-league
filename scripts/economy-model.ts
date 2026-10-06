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
import { matchCoins, payTable } from '../src/meta/career';

export interface Profile {
  id: string; name: string; weekdays: number[]; matches: number; winRate: number; drawRate: number;
  difficulty: number; minutes: number; gemAd: boolean; giftAd: boolean; matchAds: number; doubler: boolean;
}
export const PROFILES: Profile[] = [
  { id: 'learning', name: 'Learning, no ads', weekdays: [0, 2, 5], matches: 2, winRate: .25, drawRate: .2, difficulty: 0, minutes: 6, gemAd: false, giftAd: false, matchAds: 0, doubler: false },
  { id: 'casual', name: 'Casual, no ads', weekdays: [0, 2, 4, 6], matches: 2, winRate: .5, drawRate: .2, difficulty: 1, minutes: 6, gemAd: false, giftAd: false, matchAds: 0, doubler: false },
  { id: 'regular', name: 'Regular, no ads', weekdays: [0, 1, 2, 3, 4, 5, 6], matches: 3, winRate: .5, drawRate: .2, difficulty: 1, minutes: 6, gemAd: false, giftAd: false, matchAds: 0, doubler: false },
  { id: 'keen', name: 'Keen, optional ads', weekdays: [0, 1, 2, 3, 4, 5, 6], matches: 6, winRate: .65, drawRate: .15, difficulty: 2, minutes: 6, gemAd: true, giftAd: true, matchAds: 1, doubler: false },
  { id: 'doubler', name: 'Regular + paid Coin Doubler', weekdays: [0, 1, 2, 3, 4, 5, 6], matches: 3, winRate: .5, drawRate: .2, difficulty: 1, minutes: 6, gemAd: false, giftAd: false, matchAds: 0, doubler: true },
];
export function modelProfile(profile: Profile, horizon = 90, seed = 6102026) {
  const rng = new Rng(seed);
  const save = defaultSave();
  const start = new Date(2026, 9, 5, 12);
  save.season = defaultSeason(start);
  const coinSources: Record<string, number> = { welcome: save.coins, matches: 0, calendar: 0, daily: 0, weekly: 0, live: 0, skill: 0, mastery: 0, journeys: 0, matchAds: 0 };
  const gemSources: Record<string, number> = { welcome: gems(save), calendar: 0, sweep: 0, weekly: 0, levels: 0, journeys: 0, achievements: 0, ads: 0 };
  const rows: Array<{day: number; date: string; active: boolean; matches: number; minutes: number; coins: number; gems: number; ticketsEarned: number; freePacks: number; completedJourneys: number}> = [];
  let matchCount = 0, activeDays = 0, journey = 0;
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
      }
      if (profile.gemAd) gemGrant('ads', () => claimDailyGems(save, key));
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
    }
    rows.push({ day: day + 1, date: key, active, matches: matchCount, minutes: matchCount * profile.minutes, coins: save.coins, gems: gems(save), ticketsEarned: scoutTokens(save) - 2, freePacks: activeDays, completedJourneys: journey });
  }
  return { profile, seed, rows, coinSources, gemSources };
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
    economyVersion: 5, generatedFor: '2026-10-06', horizon: 90,
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
