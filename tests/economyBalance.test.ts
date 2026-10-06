import { describe, expect, it } from 'vitest';
import { claimMomentXp, defaultSave, exportSave, importSave } from '../src/core/save';
import { matchCoinPayout, skillGoalCoins, standardCoinReward } from '../src/meta/matchEconomy';
import { claimAllSeason, selectJourney, seasonOf, seasonAdvance } from '../src/meta/season';
import { modelProfile, PROFILES } from '../scripts/economy-model';

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
    for (const key of Object.keys(a.coinSources).filter(k=>k!=='matches')) expect(a.coinSources[key]).toBe(b.coinSources[key]);
    expect(b.rows.at(-1)!.coins).toBeLessThan(a.rows.at(-1)!.coins*1.5);
  });
});
