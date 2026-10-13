import { describe, expect, it } from 'vitest';
import { claimMomentXp, defaultSave, exportSave, importSave } from '../src/core/save';
import { matchCoinPayout, skillGoalCoins, standardCoinReward } from '../src/meta/matchEconomy';
import { claimAllSeason, selectJourney, seasonOf, seasonAdvance } from '../src/meta/season';
import { buildComebackModel, modelProfile, PROFILES } from '../scripts/economy-model';
import { PORTAL_GEM_OFFERS } from '../src/meta/loops';

describe('economy leakage guards', () => {
  it('replaying a short Moment cannot mint Journey coins; new stars pay their difference once', () => {
    let s = defaultSave();
    const first = claimMomentXp(s, 'first-touch', 1);
    expect(first).toBe(55);
    seasonAdvance(seasonOf(s), first);
    for (let i=0; i<1000; i++) seasonAdvance(seasonOf(s), claimMomentXp(s, 'first-touch', 1));
    expect(seasonOf(s).xp).toBe(55);
    expect(claimAllSeason(seasonOf(s))).toBe(0);
    expect(claimMomentXp(s, 'first-touch', 3)).toBe(50);
    s = importSave(JSON.parse(exportSave(s)))!;
    selectJourney(seasonOf(s), 'pass01');
    expect(claimMomentXp(s, 'first-touch', 3)).toBe(0);
    expect(claimMomentXp(s, 'first-touch', 0)).toBe(0);
    expect(s.moments!['first-touch']).toBe(3);
  });
  it('pays the first unsuccessful attempt once, preserves old results, and rejects invalid results', () => {
    const s=defaultSave();
    expect(claimMomentXp(s, 'one-on-one', 0)).toBe(30);
    expect(claimMomentXp(s, 'one-on-one', 0)).toBe(0);
    expect(claimMomentXp(s, 'one-on-one', 2)).toBe(50);
    s.moments!['old-moment']=3;
    expect(claimMomentXp(s, 'old-moment', 3)).toBe(0);
    expect(claimMomentXp(s, 'bad', NaN)).toBe(0);
    expect(s.moments!.bad).toBeUndefined();
  });
  it('skill coin bonuses stop at three just like skill XP and cannot be negative', () => {
    expect([0,1,2,3,4,100].map(skillGoalCoins)).toEqual([0,25,50,75,75,75]);
    expect(skillGoalCoins(-1)).toBe(0);
    expect(skillGoalCoins(Infinity)).toBe(0);
  });
  it('preserves ordinary quick-match multipliers while paying fixed prizes exactly once at face value', () => {
    const boosts={streak:10,atmosphere:12,gradeBonus:.1,doubler:true};
    const fee=standardCoinReward(2,0,1);
    const plain=matchCoinPayout(fee,boosts);
    const cup=matchCoinPayout({coins:fee.coins+4200,fixedCoins:4200},boosts);
    expect(plain.coins).toBe(Math.round(Math.round(fee.coins*1.12)*2*1.1*2));
    expect(cup.coins-plain.coins).toBe(4200);
    expect(cup.adBonus).toBe(plain.adBonus);
    expect(cup.coins+cup.adBonus-plain.coins-plain.adBonus).toBe(4200);
    expect(matchCoinPayout({coins:500,fixedCoins:500},boosts)).toEqual({coins:500,matchCoins:0,fixedCoins:500,adBonus:0});
  });
});

describe('time-based planning model', () => {
  it('reconciles every coin and gem source and is reproducible', () => {
    const p=PROFILES.find(p=>p.id==='regular')!;
    const a=modelProfile(p,30,123), b=modelProfile(p,30,123);
    expect(a).toEqual(b);
    expect(a.rows.at(-1)!.coins).toBe(Object.values(a.coinSources).reduce((x,y)=>x+y,0));
    expect(a.rows.at(-1)!.gems).toBe(Object.values(a.gemSources).reduce((x,y)=>x+y,0));
    expect(a.rows.at(-1)!.matches).toBe(90);
    expect(a.rows.at(-1)!.minutes).toBe(540);
  });
  it('keeps a no-ad route to early club upgrades and a signature/pass within the modelled 90 days', () => {
    const p=PROFILES.find(p=>p.id==='casual')!;
    const m=modelProfile(p);
    // Planning guardrails, not guarantees: 8 matches/week, 50% wins, claims collected, no other spending.
    expect(m.rows[6].coins).toBeGreaterThanOrEqual(800);
    expect(m.rows[89].gems).toBeGreaterThanOrEqual(600);
    expect(m.rows[89].completedJourneys).toBeLessThan(12);
    expect(m.gemSources.ads).toBe(0);
  });
  it('the Coin Doubler does not double objectives, gifts, Journey rewards or premium currency', () => {
    const a=modelProfile(PROFILES.find(p=>p.id==='regular')!,30);
    const b=modelProfile(PROFILES.find(p=>p.id==='doubler')!,30);
    expect(a.gemSources).toEqual(b.gemSources);
    // (14 October 2026) Club income is left out of the "identical" list and pinned on its own: the Doubler's richer
    // club builds its ground a few days sooner, so its ticket office takes a little more. A second order effect of
    // spending, never a doubling: it must stay well under the Doubler's own match multiplier.
    for (const key of Object.keys(a.coinSources).filter(k=>k!=='matches'&&k!=='clubIncome')) expect(a.coinSources[key]).toBe(b.coinSources[key]);
    expect(b.coinSources.clubIncome).toBeGreaterThanOrEqual(a.coinSources.clubIncome);
    expect(b.coinSources.clubIncome).toBeLessThan(a.coinSources.clubIncome*1.15);
    expect(b.rows.at(-1)!.coins).toBeLessThan(a.rows.at(-1)!.coins*1.5);
  });
});

describe('coming back (14 October 2026): the new sources stay small, and the old economy is still under them', () => {
  const model = buildComebackModel(PROFILES.map(p=>modelProfile(p)));
  it('with the come-back features off the model is the economy v5 forecast, to the coin', () => {
    // docs/ECONOMY.md's 6 October table: the before column of every before / after comparison.
    const before = (id: string) => modelProfile(PROFILES.find(p=>p.id===id)!, 90, 6102026, { comeback: false });
    expect([before('regular').rows[29].coins, before('regular').rows[29].gems]).toEqual([57259, 612]);
    expect([before('casual').rows[89].coins, before('casual').rows[89].gems]).toEqual([73490, 757]);
    expect(Object.entries(before('regular').coinSources).filter(([k])=>['streak','matchOfDay','clubIncome','coinAds'].includes(k)).map(([,v])=>v)).toEqual([0,0,0,0]);
    // And the matches themselves are the same with the features on: only the new sources are added.
    const on = modelProfile(PROFILES.find(p=>p.id==='regular')!);
    for (const key of ['matches','daily','weekly','live','skill']) expect(on.coinSources[key]).toBe(before('regular').coinSources[key]);
  });
  it('a daily player earns more for coming back, never a multiple: about a quarter more coins and a fifth more gems by day 90', () => {
    for (const p of model.beforeAfter) {
      const d90 = p.marks.find(m=>m.day===90)!;
      expect(d90.coinsAfter / d90.coinsBefore, p.id).toBeGreaterThan(1.1);
      expect(d90.coinsAfter / d90.coinsBefore, p.id).toBeLessThan(1.35);
      expect(d90.gemsAfter / d90.gemsBefore, p.id).toBeGreaterThan(1.05);
      expect(d90.gemsAfter / d90.gemsBefore, p.id).toBeLessThan(1.3);
      // The looks handed over (the welcome week and the streak) are a few days of play, not a catalogue.
      expect(d90.looks, p.id).toBeLessThanOrEqual(6000);
    }
  });
  it('club income is small next to playing at every stage: under a fifth of a regular player\'s day, about a quarter at the very most', () => {
    for (const s of model.incomeShare) {
      // The most: a keen player who collects twice a day from the dome with a level 3 manager.
      expect(s.share, `${s.profile} ${s.from} to ${s.to}`).toBeLessThanOrEqual(0.28);
      if (s.from === 1) expect(s.share, `${s.profile} week one`).toBeLessThanOrEqual(0.1);
      if (/^Regular, no ads|^Portal regular/.test(s.profile)) expect(s.share, s.profile).toBeLessThanOrEqual(0.2);
    }
  });
  it('the portal, with nothing for sale, reaches every gem goal by playing; the Club Pass inside two months at a casual rate', () => {
    const day = (profile: RegExp, goal: RegExp) => model.afford.find(a=>profile.test(a.profile)&&goal.test(a.goal))!.dayAll;
    expect(day(/Portal casual/, /^Local Scouting/)).toBeLessThanOrEqual(21);
    expect(day(/Portal casual/, /^Club Pass$/)).toBeLessThanOrEqual(60);
    expect(day(/Portal regular/, /^Club Pass$/)).toBeLessThanOrEqual(30);
    // The dearest goal of all is long, and still inside the modelled year for every portal profile.
    for (const a of model.afford) expect(a.dayAll, `${a.profile}: ${a.goal}`).not.toBeNull();
    // Coins never gate the first stand: affordable in the first session if the welcome coins are saved.
    expect(day(/Portal casual/, /^Main stand/)).toBe(1);
  });
  it('FREE GEMS on a portal: two offers a day keep the week inside the tuned band; three would not', () => {
    const at = (offers: number) => model.gemOffers.find(g=>g.offers===offers&&/keen/.test(g.profile))!;
    expect(PORTAL_GEM_OFFERS).toBe(2);
    expect(at(PORTAL_GEM_OFFERS).weeklyLoopMax).toBeLessThanOrEqual(160);
    expect(at(3).weeklyLoopMax).toBeGreaterThan(160);
    // What the second offer buys a keen portal player: the Club Pass a couple of days sooner, every network about nine.
    expect(at(1).dayPass! - at(2).dayPass!).toBeGreaterThanOrEqual(1);
    expect(at(1).dayAllNetworks! - at(2).dayAllNetworks!).toBeGreaterThanOrEqual(5);
    // A casual player (one offer a visit) is not asked to watch more to keep up.
    const casual = model.gemOffers.filter(g=>/casual/.test(g.profile)).map(g=>g.dayPass);
    expect(new Set(casual).size).toBe(1);
  });
});
