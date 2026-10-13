import { describe, expect, it } from 'vitest';
import {
  CAREER_PROFILES, PROFILES, arbitrageTable, buildCareerModel, buildComebackModel, interstitials, modelCareer, modelProfile,
} from '../scripts/economy-model';
import { TICKET_OFFICE } from '../src/meta/clubIncome';
import { SPONSOR_GAP, SPONSOR_LENGTH } from '../src/meta/events';
import { REGIONS } from '../src/meta/staff';

// Economy v7 (15 October 2026): ROAD TO GLORY simulated on the game's own engine, and one row per balance check
// (docs/ECONOMY.md, the workbook's Balance Checks sheet). Planning guard rails at stated assumptions, not telemetry.
describe('the career simulation is a ledger, not an estimate', () => {
  const regular = CAREER_PROFILES.find((p) => p.id === 'career-regular')!;
  const a = modelCareer(regular, 45);
  it('is reproducible, and every league matchday settles to the coin against the rules read beforehand', () => {
    const b = modelCareer(regular, 45);
    expect(b.coinsIn).toEqual(a.coinsIn);
    expect(b.coinsOut).toEqual(a.coinsOut);
    expect(b.seasons).toEqual(a.seasons);
    // Wages, the wage drain, the sponsor, the commercial manager and the season prize: nothing unaccounted for.
    expect(a.residual).toBe(0);
  });
  it('what came in less what went out is what is in the wallet, for coins, gems and Scout Tickets', () => {
    const sum = (l: Record<string, number>) => Object.values(l).reduce((x, y) => x + y, 0);
    expect(sum(a.coinsIn) - sum(a.coinsOut)).toBe(a.end.coins);
    expect(sum(a.gemsIn) - sum(a.gemsOut)).toBe(a.end.gems);
    expect(sum(a.ticketsIn) - sum(a.ticketsOut)).toBe(a.end.tickets);
  });
  it('a careful manager is never left unable to pay the staff, and gems are never spent on progress', () => {
    expect(a.seasons.length).toBeGreaterThanOrEqual(5);
    for (const s of a.seasons) expect(s.unpaidMatchdays, `season ${s.season}`).toBe(0);
    expect(a.end.unpaid).toBe(false);
    // The only gems that leave are the permanent goals he chose (the Scouting Network, the Club Pass).
    expect(Object.keys(a.gemsOut)).toEqual(['scoutNetwork', 'clubPass']);
  });
});

describe('economy v7: the three numbers that changed, and why', () => {
  it('the ticket office: 16 / 18 / 20 / 22 / 24 / 26 an hour (it was 16 / 19 / 22 / 25 / 28 / 32)', () => {
    expect([...TICKET_OFFICE]).toEqual([16, 18, 20, 22, 24, 26]);
  });
  it('a new sponsor calls eight league matchdays after the last (it was three): CASH NOW is eight matches of pay, no more', () => {
    expect(SPONSOR_GAP).toBe(8);
    // A deal that runs its length is longer than the gap, so EVERY MATCH and WIN BONUS are followed at once, as before.
    expect(SPONSOR_LENGTH).toBeGreaterThan(SPONSOR_GAP);
  });
  it('a home town find costs 0.8 of the going rate (it was 0.75), still the cheapest region, and cannot be flipped', () => {
    expect(REGIONS.home.fee).toBe(0.8);
    for (const r of Object.values(REGIONS)) expect(r.fee, r.id).toBeGreaterThanOrEqual(REGIONS.home.fee);
    // Nothing bought and sold at once, and no training session, makes a coin (it made 10 to 40 a home youth find).
    for (const t of arbitrageTable().filter((x) => x.instant)) expect(t.profit, `${t.trade}, division ${t.division}`).toBeLessThanOrEqual(0);
  });
});

describe('economy v7: every balance check, with the bar it is held to', () => {
  const shared = PROFILES.map((p) => modelProfile(p));
  const model = buildCareerModel(shared, buildComebackModel(shared));
  const check = (id: string) => model.checks.find((c) => c.id === id)!;
  it('every check that a number could settle passes', () => {
    // The two left are design decisions (reported in docs/ECONOMY.md, 15 October 2026), pinned below as they stand.
    const open = ['squad-sink', 'sinks-last'];
    for (const c of model.checks.filter((x) => !open.includes(x.id))) expect(c.pass, `${c.id}: ${c.check} measured ${c.value} against ${c.op} ${c.limit}`).toBe(true);
    expect(model.checks.filter((c) => !c.pass).map((c) => c.id).sort()).toEqual([...open].sort());
  });
  it('club income is under a quarter of the rest of the day for every profile at every stage (it was 26.6%)', () => {
    expect(check('club-income').before).toBe(0.266);
    expect(check('club-income').value).toBeLessThan(0.25);
  });
  it('no answer to the sponsor is more than a quarter better than playing the deal out (CASH NOW paid 2.4 times as much)', () => {
    const per = (answer: string) => model.sponsor.find((s) => s.answer === answer)!.perMatchday;
    expect(per('CASH NOW') / per('EVERY MATCH')).toBeLessThanOrEqual(1.25);
    // The win bonus is still the better bet for a side that wins six in ten.
    expect(per('WIN BONUS')).toBeGreaterThan(per('EVERY MATCH'));
  });
  it('no division is a death spiral: a careful manager is never drained, and a collector is slowed, never sunk', () => {
    expect(check('wages-paid').value).toBe(0);
    expect(check('wage-drain').value).toBeLessThan(0.01);
    // Signing every better card puts the wage bill far over budget: the drain is the brake, and he still earns more than it takes.
    expect(check('collector-spiral').value).toBeLessThan(1);
  });
  it('a player who never watches an ad is never more than twice as slow as one who watches them all', () => {
    for (const g of model.ads.goals) if (g.ratio !== null) expect(g.ratio, g.goal).toBeLessThanOrEqual(2);
  });
  it('a free player earns everything: every goal is reached with no ad and no purchase inside the run', () => {
    const regular = model.runs.find((r) => r.profile.id === 'career-regular')!;
    for (const [goal, day] of Object.entries(regular.goalDays)) expect(day, goal).not.toBeNull();
    expect(regular.ads).toEqual({ gift: 0, match: 0, coins: 0, gems: 0, build: 0, heal: 0, replay: 0 });
  });
  it('the three open findings are what the report says they are', () => {
    // Pack cards keep a daily player's eleven above par, so players cost him no coins.
    expect(check('squad-sink').value).toBe(0);
    // Every coin sink in the game is paid for inside two months of daily play at six wins in ten.
    expect(check('sinks-last').value).toBeGreaterThan(40);
    expect(check('sinks-last').value).toBeLessThan(60);
    // The gift's 2X ad is about one won match early on (1.8 when it doubled the ticket office too: taken out).
    expect(check('ad-single').value).toBeGreaterThan(0.8);
    expect(check('ad-single').value).toBeLessThan(1.25);
  });
});

describe('interstitials in a visit: one before a kick-off, one at half time, three minutes apart', () => {
  it('none until two matches are finished on the save, and never before the first kick-off of a visit', () => {
    expect(interstitials(1, 0)).toBe(0);
    expect(interstitials(2, 0)).toBe(0);
    expect(interstitials(3, 0)).toBe(1);
  });
  it('at two minute halves a visit of N matches shows N: half time comes inside the three minutes after a kick-off ad', () => {
    for (const n of [1, 2, 3, 6]) expect(interstitials(n, 2), `${n} matches`).toBe(n);
  });
  it('with both slots clear of the gap it is 2N - 1, and a longer gap shows fewer', () => {
    expect(interstitials(3, 2, { kickToHalf: 3.5, halfToKick: 3.5, gap: 3 })).toBe(5);
    expect(interstitials(3, 2, { kickToHalf: 2.5, halfToKick: 3.5, gap: 10 })).toBe(2);
  });
});
