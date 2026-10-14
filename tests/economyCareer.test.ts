import { describe, expect, it } from 'vitest';
import {
  BEFORE_V8, CAREER, CAREER_PROFILES, PROFILES, arbitrageTable, buildCareerModel, buildComebackModel, interstitials, modelCareer, modelProfile,
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

// (The whole model is built once for the two blocks below: it plays about twenty 180 day careers.)
const SHARED = PROFILES.map((p) => modelProfile(p));
const MODEL = buildCareerModel(SHARED, buildComebackModel(SHARED));

describe('economy v7 and v8: every balance check, with the bar it is held to', () => {
  const model = MODEL;
  const check = (id: string) => model.checks.find((c) => c.id === id)!;
  it('every check that a number could settle passes', () => {
    // (Pin moved 16 October 2026, economy v8. The two findings left open on 15 October, squad-sink and sinks-last, were
    // design decisions; the owner made them and both pass now. The pace check's first bar (day 90 to 150) could not be
    // met by any price, because who goes up is set by who wins: its bar is eight weeks now, see below.)
    const open: string[] = [];
    for (const c of model.checks.filter((x) => !open.includes(x.id))) expect(c.pass, `${c.id}: ${c.check} measured ${c.value} against ${c.op} ${c.limit}`).toBe(true);
    expect(model.checks.filter((c) => !c.pass).map((c) => c.id).sort()).toEqual([...open].sort());
  });
  it('club income is under a quarter of the rest of the day for every profile at every stage (it was 26.6% two passes ago)', () => {
    // (Pin moved 16 October 2026: "before" is now the pass before this one, economy v7, where the ticket office had
    // already been cut. The 26.6% of economy v6 is in the check's note.)
    expect(check('club-income').before).toBe(0.2234);
    expect(check('club-income').note).toMatch(/26\.6%/);
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
  it('the two findings left open on 15 October are settled: players cost coins, and the sinks last', () => {
    // (Pins moved 16 October 2026. squad-sink was 0 and sinks-last was day 57: both FAIL, both design decisions.)
    expect(BEFORE_V8.checks['squad-sink']).toBe(0);
    expect(BEFORE_V8.checks['sinks-last']).toBe(57);
    expect(check('squad-sink').pass).toBe(true);
    expect(check('squad-sink').value).toBeGreaterThan(0.1);
    // Not paid for inside the 180 days modelled (the value is the day after the run).
    expect(check('sinks-last').pass).toBe(true);
    expect(check('sinks-last').value).toBeGreaterThan(120);
    // The gift's 2X ad is about one won match early on (1.8 when it doubled the ticket office too: taken out).
    expect(check('ad-single').value).toBeGreaterThan(0.8);
    expect(check('ad-single').value).toBeLessThan(1.25);
  });
  it('every check carries what it measured on the rules before this pass', () => {
    for (const id of Object.keys(BEFORE_V8.checks)) expect(check(id), id).toBeDefined();
    for (const c of model.checks) if (c.id in BEFORE_V8.checks) expect(c.before, c.id).toBe(BEFORE_V8.checks[c.id]);
    expect(model.checks).toHaveLength(33);
  });
});

describe('economy v8 (16 October 2026): players cost coins', () => {
  const model = MODEL;
  const check = (id: string) => model.checks.find((c) => c.id === id)!;
  const run = (id: string) => model.runs.find((r) => r.profile.id === id)!;
  it('on cards alone a regular player sits about par (he was 7 to 20 over), and the coins put him ahead of it', () => {
    expect(check('card-level').pass).toBe(true);
    expect(check('card-level').value).toBeLessThanOrEqual(5);
    expect(check('coins-ahead').pass).toBe(true);
    for (const c of model.v8.coinsBuy.filter((x) => x.division >= 3)) expect(c.half, c.league).toBeGreaterThan(c.cardsOnly);
    // The manager who never spends a coin on players spends none (the policy is what the sheet says it is).
    expect(run('career-regular-cards').coinsOut.transfers + run('career-regular-cards').coinsOut.training).toBe(0);
    expect(CAREER.squadShare).toBe(0.5);
  });
  it('at least a fifth of everything a regular player earns goes on players, and on day 180 there is still a month of income to spend', () => {
    expect(check('squad-coins').pass).toBe(true);
    expect(check('squad-coins').value).toBeGreaterThanOrEqual(0.2);
    expect(check('goal-left').pass).toBe(true);
    expect(check('goal-left').value).toBeGreaterThanOrEqual(4);
    // Whatever he does with his coins: banking every one, or putting every one into the eleven.
    expect(model.v8.goalLeft.allIn.weeks).toBeGreaterThanOrEqual(4);
    expect(model.v8.goalLeft.cardsOnly.coins).toBeGreaterThan(0);
  });
  it('a strong player who watches every ad does not have coins for everything before day 90', () => {
    expect(check('strong-sinks').pass).toBe(true);
    expect(check('strong-sinks').value).toBeGreaterThanOrEqual(90);
    expect(check('strong-sinks').before).toBe(25);
  });
  it('the early game is not harder: the first 30 days are what they were, and nothing in the bottom two divisions costs more', () => {
    expect(check('early-ledger').pass).toBe(true);
    expect(check('early-ledger').value).toBeLessThanOrEqual(0.1);
    const regular = run('career-regular');
    expect(regular.promotions[0].day).toBe(BEFORE_V8.firstPromotion);
    expect(regular.builds.map((b) => b.day)).toEqual([...BEFORE_V8.buildDays]);
    expect(regular.goalDays.ground).toBe(15);
    expect(regular.goalDays.staff).toBe(34);
    expect(Math.min(...regular.seasons.filter((s) => s.dayFrom <= 30).map((s) => s.balanceMin))).toBe(BEFORE_V8.lowestBalance);
    expect(check('early-prices').pass).toBe(true);
    expect(regular.bottomTwoBest).toBeLessThanOrEqual(70);
  });
  it('no death spiral: nobody is drained, a card obeys the wage budget, a relegated club can sell its way out', () => {
    expect(check('wages-paid').value).toBe(0);
    expect(check('wage-drain').value).toBeLessThan(0.01);
    expect(check('collector-spiral').value).toBeLessThan(1);
    expect(check('card-budget').pass).toBe(true);
    expect(check('card-budget').value).toBeLessThan(0.05);
    expect(check('card-budget').before).toBe(1.9);
    expect(check('relegated-exit').pass).toBe(true);
    // The careful managers (every profile, every ad, cards only) never miss the staff's wages. The one who puts every
    // spare coin into the eleven keeps only three matchdays of wages back, and a contract renewal can cost him one.
    const careful = model.runs.filter((r) => !/allin|collector/.test(r.profile.id));
    expect(careful.length).toBeGreaterThanOrEqual(5);
    for (const r of careful) for (const s of r.seasons) expect(s.unpaidMatchdays, `${r.profile.id} season ${s.season}`).toBe(0);
    for (const r of model.runs) expect(r.seasons.reduce((n, s) => n + s.unpaidMatchdays, 0), r.profile.id).toBeLessThanOrEqual(2);
  });
  it('a free card never sells at the market\'s price, and no trade makes a coin', () => {
    expect(check('free-card').value).toBe(0);
    expect(check('flip-instant').value).toBeLessThanOrEqual(0);
    expect(check('flip-held').value).toBeLessThanOrEqual(2);
  });
  it('a six-in-ten manager reaches the top in about two months, a third longer than before, and no price sets that', () => {
    const pace = check('top-pace');
    expect(pace.pass).toBe(true);
    expect(pace.limit).toBe(56);
    expect(pace.value).toBeGreaterThanOrEqual(56);
    expect(pace.value).toBeLessThan(90);
    // Why: on the game's own league he goes up four seasons in five at par, and still one in five 20 under it.
    const odds = model.v8.odds;
    const at = (gap: number) => odds.find((o) => o.gap === gap)!.promoted;
    expect(at(0)).toBeGreaterThan(0.7);
    expect(at(-9)).toBeGreaterThan(0.35);
    expect(at(-20)).toBeGreaterThan(0.1);
    for (let i = 1; i < odds.length; i++) expect(odds[i].promoted).toBeLessThanOrEqual(odds[i - 1].promoted);
    // The learning player (45/25/30, three days a week) is where the climb is long: the Championship after day 120.
    expect(run('career-learning').promotions.find((p) => p.division === 2)!.day).toBeGreaterThan(120);
  });
  it('the tables the document prints are the rules: prices, training and wages from 50 to 99', () => {
    const c = (ovr: number) => model.v8.curves.find((x) => x.ovr === ovr)!;
    expect(c(50)).toMatchObject({ priceBefore: 630, price: 630, sessionBefore: 190, session: 190, wage: 63 });
    expect(c(60)).toMatchObject({ priceBefore: 900, price: 900, sessionBefore: 220, session: 220 });
    expect(c(70)).toMatchObject({ sessionBefore: 250, session: 250 });
    expect(c(95)).toMatchObject({ priceBefore: 2260, price: 12700, sessionBefore: 325, session: 1950, wage: 226 });
    expect(c(99)).toMatchObject({ priceBefore: 2450, price: 18140, session: 10110, wage: 245 });
    expect(model.v8.rules).toEqual({ priceKnee: 60, trainKnee: 70, packLift: 0, packOwnCap: 52, packCap: 95 });
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
