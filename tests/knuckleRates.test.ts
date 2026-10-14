import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { KNUCKLE_MIN_D } from '../src/sim/actions';
import { DT, HALF_L } from '../src/sim/constants';
import { EMPTY_PAD, Match, SHOOT_FULL_T } from '../src/sim/match';
import { HumanBot } from './humanBot';
import { CURLED, NORMAL, PLACED, fmtRates as fmt, rates, type Rates, type Strike } from './shotBench';

/*
 * How often the KNUCKLEBALL, the CURLER and an AFTERTOUCH score (the owner: "knuckle ball curves allat make the game
 * perfect! add new stuff u think players will love"): the measured balance behind sim/actions.ts's knuckleball and
 * curler constants, sim/keeper.ts KNUCKLE_SEEN and sim/match.ts AFTERTOUCH_SPIN.
 *
 * Staged trials: a striker with 81 shooting alone against a set keeper on NORMAL (the menu's 1.8), every trial its own
 * seed, so the rates are exact for this code and the bands are the design targets with room. Then whole matches: the
 * scripted human (tests/humanBot.ts) shooting from range whenever he has the ball there, defenders and all.
 *
 * Measured when it was tuned (2026-10-14; 600 trials a cell, the same seeds before and after; goals):
 *
 *                                   20.5 m   22 m   24 m   26 m   28 m   30 m   34 m
 *   placed strike (0.2 s)             41%     54%     1%     0%     0%     0%     0%
 *   full bar, before                  34%     18%    20%     5%     0%     0%     0%
 *   full bar now: the knuckleball     36%     25%    19%    19%    18%    13%     6%
 *
 *   (The knuckleball on EASY 42 / 28 / 17% from 22 / 26 / 30 m, HARD 13 / 14 / 8%, LEGEND 10 / 11 / 6%.)
 *
 *                                   14.5 m   16 m   18 m   20 m   22 m   25 m
 *   curled strike, before             61%     36%    18%     6%     2%     0%
 *   curled strike now: the curler     56%     33%    13%     3%     7%     0%
 *
 *   aftertouch on a placed strike:   20.5 m   26 m     (300 trials a cell)
 *   none                              41%      0%
 *   pushed one way without looking    27%      0%     (20% at the first tuning: AFTERTOUCH_SPIN 4.5 and a 0.3 dead zone;
 *                                                     eased to 3.2 and 0.45 so a careless thumb costs less)
 *   read and pushed right, 0.2 s on   63%      0%
 *
 * Whole matches (16 of them, 2 x 90 s): 82 knuckleballs struck from 21 to 30 m, 15 scored (18%), 32 parried, none
 * held, 10 blocked, 5 off the frame, 20 wide or over; the same man placing it from there scored 6 of 103 (6%).
 *
 * THE RANGE BALANCE (the same day, later; tests/rangeShots.test.ts has its own table and pins). Two rows of the table
 * above were defects: the placed strike's 41% and 54% from 20.5 and 22 m with nothing from 24 m (a cliff where the
 * keeper's handling of a long shot began, and at the wrong end), and the curler's 13 / 3 / 7% from 18 / 20 / 22 m (a
 * named skill shot far worse than leaving the stick alone). keeper.ts HUMAN_EDGE, actions.ts HUMAN_WIDE and Match's
 * CURLER_REACH put them right. The knuckleball's rows did not move by a trial: it keeps its aim and the keeper's
 * handling of it. Measured as above (600 trials a cell, the same seeds):
 *
 *                                   20.5 m   22 m   24 m   26 m   28 m   30 m   34 m
 *   placed strike (0.2 s), now        16%     11%    10%     6%     2%     0%     0%
 *   the knuckleball                   36%     25%    19%    19%    18%    13%     6%
 *
 *                                   14.5 m   16 m   18 m   20 m   22 m   25 m
 *   the curler, now                   57%     39%    26%    24%    16%     7%
 *
 *   aftertouch on a placed strike:   20.5 m   26 m     (300 trials a cell)
 *   none                              15%      8%
 *   pushed one way without looking    13%      -      (it no longer costs 14 points: the assist's strike is not for
 *                                                     the corner any more, so a blind push spoils fewer of them, and
 *                                                     sends twice as many wide or onto the post: 12% from 5%)
 *   read and pushed right, 0.2 s on   22%      4%
 *
 * So the bands below that set the knuckleball against the placed strike changed sides: from 20 m on the knuckleball is
 * the better shot now, as the skill shot should be, and a placed one from 26 m is a hopeful one, not a dead one.
 */

const phase = (m: Match): string => m.phase;

// (The bench itself, a striker alone against a set keeper, each trial on its own seed, is tests/shotBench.ts: shared
// with tests/rangeShots.test.ts so the two files' numbers are the same trials.)
const FULL: Strike = { hold: SHOOT_FULL_T + 0.1 };
const N = 300;

describe('knuckleball: how often it scores (a set keeper, NORMAL)', () => {
  it('from 22 to 28 m it is a low-percentage spectacular: about one in five, most of the rest parried or just wide, never held', () => {
    const out: string[] = [];
    const by = new Map<number, Rates>();
    for (const d of [20.5, 22, 24, 26, 28, 30, 34]) {
      const r = rates(d, FULL, N);
      by.set(d, r);
      out.push(fmt(`${d} m knuckleball`, r));
      // Every full bar from in range is one.
      expect(r.styles.knuckle, `${d} m`).toBe(N);
    }
    // eslint-disable-next-line no-console
    console.log(out.join('\n'));
    const mid = [22, 24, 26, 28].map((d) => by.get(d)!);
    for (const r of mid) {
      expect(r.goal).toBeGreaterThanOrEqual(0.1);
      expect(r.goal).toBeLessThanOrEqual(0.34);
      // Parried more often than anything else; a few wide or over, a few off the frame; never in his arms.
      expect(r.saved).toBeGreaterThanOrEqual(0.38);
      expect(r.saved).toBeGreaterThan(r.goal);
      expect(r.off + r.post).toBeGreaterThanOrEqual(0.1);
      expect(r.off + r.post).toBeLessThanOrEqual(0.4);
      expect(r.held).toBeLessThanOrEqual(0.03);
    }
    const mean = mid.reduce((a, r) => a + r.goal, 0) / mid.length;
    expect(mean).toBeGreaterThanOrEqual(0.15);
    expect(mean).toBeLessThanOrEqual(0.27);
    // Nearer is better, further is worse, and nowhere is it a formality or a waste of the ball.
    expect(by.get(20.5)!.goal).toBeGreaterThanOrEqual(mean);
    expect(by.get(20.5)!.goal).toBeLessThanOrEqual(0.46);
    expect(by.get(30)!.goal).toBeGreaterThanOrEqual(0.05);
    expect(by.get(30)!.goal).toBeLessThanOrEqual(mean + 0.03);
    expect(by.get(34)!.goal).toBeGreaterThanOrEqual(0.01);
    expect(by.get(34)!.goal).toBeLessThanOrEqual(0.15);
  }, 300_000);

  it('is the better shot than a placed strike all through its range, by most from 24 m and beyond, and never one from inside it', () => {
    const out: string[] = [];
    const placedNear = rates(20.5, PLACED, N);
    const knuckleNear = rates(20.5, FULL, N);
    const placedFar = rates(26, PLACED, N);
    const knuckleFar = rates(26, FULL, N);
    // (Just inside its range: the full bar of old, a riser.)
    const inside = rates(KNUCKLE_MIN_D - 1.5, FULL, N);
    out.push(fmt('20.5 m placed', placedNear), fmt('20.5 m knuckleball', knuckleNear), fmt('26 m placed', placedFar), fmt('26 m knuckleball', knuckleFar),
      fmt(`${KNUCKLE_MIN_D - 1.5} m full bar (no knuckleball)`, inside));
    // eslint-disable-next-line no-console
    console.log(out.join('\n'));
    expect(inside.styles.knuckle ?? 0).toBe(0);
    expect(inside.styles.plain).toBe(N);
    // From 26 m a placed strike is a hopeful one, the keeper's nine times in ten; the knuckleball is the way to score
    // from there. (The range balance, 2026-10-14: it was 0% from 24 m on, behind a cliff: 54% from 22 m. It falls away
    // smoothly now, 6% from here over 600 trials, 8% over these 300. The bands were <= 0.04 and + 0.08.)
    expect(placedFar.goal).toBeLessThanOrEqual(0.12);
    expect(knuckleFar.goal).toBeGreaterThanOrEqual(placedFar.goal + 0.06);
    // At the near edge of its range it is the better shot already. (The same revision: this used to say the placed
    // strike was still the better one from here, knuckleNear <= placedNear + 0.02, when a placed strike from 20.5 m
    // went in 41% of the time. That was the defect: it is 15 to 17% now, and the skill shot is the better shot.)
    expect(knuckleNear.goal).toBeGreaterThanOrEqual(placedNear.goal + 0.08);
    expect(placedNear.goal).toBeGreaterThanOrEqual(0.08);
    expect(placedNear.goal).toBeLessThanOrEqual(0.27);
    // ... and it does not make the full bar from 20 m a better shot than the full bar from 18.5 m.
    expect(knuckleNear.goal).toBeLessThanOrEqual(inside.goal + 0.1);
  }, 300_000);

  it('a better keeper has more of it: EASY is beaten most, LEGEND least, and it still goes in on LEGEND', () => {
    const easy = rates(26, FULL, N, 0.6);
    const normal = rates(26, FULL, N);
    const legend = rates(26, FULL, N, 4);
    // eslint-disable-next-line no-console
    console.log([fmt('26 m knuckleball EASY', easy), fmt('26 m knuckleball NORMAL', normal), fmt('26 m knuckleball LEGEND', legend)].join('\n'));
    expect(easy.goal).toBeGreaterThanOrEqual(normal.goal);
    expect(normal.goal).toBeGreaterThanOrEqual(legend.goal);
    expect(easy.goal).toBeGreaterThanOrEqual(legend.goal + 0.06);
    expect(easy.goal).toBeLessThanOrEqual(0.45);
    expect(legend.goal).toBeGreaterThanOrEqual(0.03);
    for (const r of [easy, normal, legend]) expect(r.held).toBeLessThanOrEqual(0.03);
  }, 300_000);
});

describe('curler and aftertouch: how often they score (a set keeper, NORMAL)', () => {
  it('the curler is a chance from the edge of the box and a real choice from range: it falls away with distance and never dies at 20 m', () => {
    const out: string[] = [];
    const by = new Map<number, Rates>();
    for (const d of [16, 18, 20, 22, 25]) {
      const r = rates(d, CURLED, N);
      by.set(d, r);
      out.push(fmt(`${d} m curler`, r));
      expect(r.styles.curler, `${d} m`).toBe(N);
    }
    // eslint-disable-next-line no-console
    console.log(out.join('\n'));
    // (Before the bigger bend: 36% / 18% / 6% / 2% / 0%. With it, until the range balance of 2026-10-14: 33% / 13% /
    // 3% / 7% / 0%, a far worse shot than leaving the stick alone from 18 to 22 m and not monotone; the bands were
    // 0.22-0.46, 0.05-0.27, <= 0.14, <= 0.16, <= 0.08. Now 39% / 26% / 24% / 16% / 7% over 600 trials, a little more
    // than the placed strike's 35% / 26% / 20% / 11% / 6%: keeper.ts HUMAN_EDGE, Match's CURLER_REACH.
    // tests/rangeShots.test.ts sets it against the placed strike distance by distance.)
    const band: Record<number, [number, number]> = { 16: [0.3, 0.5], 18: [0.19, 0.37], 20: [0.15, 0.33], 22: [0.08, 0.24], 25: [0.02, 0.14] };
    for (const [d, [lo, hi]] of Object.entries(band)) {
      expect(by.get(Number(d))!.goal, `${d} m`).toBeGreaterThanOrEqual(lo);
      expect(by.get(Number(d))!.goal, `${d} m`).toBeLessThanOrEqual(hi);
    }
    // Never better from further out (3 points is the bench's noise).
    const ds = [16, 18, 20, 22, 25];
    for (let i = 1; i < ds.length; i++) expect(by.get(ds[i])!.goal, `${ds[i]} m`).toBeLessThanOrEqual(by.get(ds[i - 1])!.goal + 0.03);
    // It is on target as often as ever (it is re-aimed): the keeper is what stops it.
    for (const r of by.values()) expect(r.off).toBeLessThanOrEqual(0.15);
  }, 300_000);

  it('aftertouch is a skill, not a gift: pushed without looking it adds no goals and sends more wide, read right it adds them, and from 26 m it adds nothing', () => {
    const none = rates(20.5, PLACED, N);
    const blind = rates(20.5, { ...PLACED, after: 1 }, N);
    const read = rates(20.5, { ...PLACED, read: 0.6, react: 0.2 }, N);
    const farNone = rates(26, PLACED, N);
    const farRead = rates(26, { ...PLACED, read: 0.6, react: 0.2 }, N);
    // eslint-disable-next-line no-console
    console.log([fmt('20.5 m placed', none), fmt('20.5 m placed, pushed blind', blind), fmt('20.5 m placed, read and pushed', read),
      fmt('26 m placed', farNone), fmt('26 m placed, read and pushed', farRead)].join('\n'));
    // (The range balance, 2026-10-14: this was blind <= none - 0.08, when the assist put a placed strike from 20.5 m in
    // the corner, 41% of them went in and a careless push bent a third of those away: 27%. The assist's strike from
    // range is spread across the open side now (actions.ts HUMAN_WIDE) and 15% go in; a blind push spoils the ones for
    // the corner and now and then improves one that was not: 13%. It still must never ADD goals.)
    expect(blind.goal).toBeLessThanOrEqual(none.goal + 0.02);
    // (Bent off target or onto the frame, mostly: that is what it costs.)
    expect(blind.off).toBeGreaterThan(none.off);
    expect(blind.off + blind.post).toBeGreaterThanOrEqual(none.off + none.post + 0.04);
    expect(read.goal).toBeGreaterThanOrEqual(none.goal + 0.05);
    // A perfect reader with a human's reaction time: better, never a formality. (It was <= 0.8, of 63%; 23% now.)
    expect(read.goal).toBeLessThanOrEqual(0.45);
    // From range it does not turn a placed strike into a goal.
    expect(farRead.goal).toBeLessThanOrEqual(farNone.goal + 0.05);
  }, 300_000);
});

interface Tries { tries: number; struck: number; knuckle: number; goal: number; saved: number; held: number; blocked: number; post: number; off: number; lost: number }

/**
 * A whole match by the scripted human, who shoots from 21 to 30 m whenever his man has the ball there (in front of
 * him, within 12 m of the pitch's axis): SHOOT held `hold` s with the stick left alone. What came of every try.
 */
function rangeShooter(seed: number, hold: number, difficulty = NORMAL, halfLength = 90): Tries {
  const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength, difficulty, humanSide: 0, seed });
  const bot = new HumanBot(seed);
  const t: Tries = { tries: 0, struck: 0, knuckle: 0, goal: 0, saved: 0, held: 0, blocked: 0, post: 0, off: 0, lost: 0 };
  let charge = 0;
  let rest = 0;
  let cool = 0;
  /** The try being followed: steps left to see what came of it, whether it was struck (and as which kick), whether it is settled. */
  let watch: { left: number; struck: boolean; kick: number; done: boolean } | null = null;
  const settle = (what: keyof Tries) => {
    if (watch && !watch.done) {
      watch.done = true;
      t[what]++;
    }
  };
  for (let steps = 0; phase(m) !== 'fulltime' && steps < 60 * 60 * 8; steps++) {
    let pad = bot.pad(m);
    const b = m.ball;
    const ad = m.attackDir(0);
    const d = Math.hypot(b.pos.x - ad * HALF_L, b.pos.z);
    cool = Math.max(0, cool - DT);
    if (charge > 0) {
      pad = { ...EMPTY_PAD, shoot: true };
      charge--;
      if (charge === 0) rest = 14;
    } else if (rest > 0) {
      pad = EMPTY_PAD;
      rest--;
    } else if (!watch && cool <= 0 && phase(m) === 'play' && b.owner >= 0 && b.owner === m.active && m.players[b.owner].side === 0 &&
      !m.players[b.owner].isKeeper && !b.held && d >= 21 && d <= 30 && Math.abs(b.pos.z) < 12 && (b.pos.x - m.players[b.owner].pos.x) * ad > -0.2) {
      charge = Math.round(hold / DT) - 1;
      cool = 2.5;
      t.tries++;
      watch = { left: charge + 215, struck: false, kick: -1, done: false };
      pad = { ...EMPTY_PAD, shoot: true };
    }
    const before = m.ball.owner;
    const active = m.active;
    m.step(DT, pad);
    const evs = m.drainEvents();
    bot.observe(m, evs, before);
    for (const e of evs) {
      // (Only the man the human had could have struck a knuckleball or a curler.)
      if (e.type === 'kick' && (e.style === 'knuckle' || e.style === 'curler')) expect(e.player).toBe(active);
    }
    if (watch) {
      for (const e of evs) {
        if (e.type === 'kick' && e.kind === 'shot' && !watch.struck && e.player !== undefined && m.players[e.player].side === 0 && charge === 0) {
          watch.struck = true;
          watch.kick = m.kickId;
          t.struck++;
          if (e.style === 'knuckle') t.knuckle++;
        } else if (watch.struck && !watch.done) {
          if (e.type === 'goal' && e.side === 0) settle('goal');
          else if (e.type === 'save') settle(e.caught ? 'held' : 'saved');
          else if (e.type === 'block') settle('blocked');
          else if (e.type === 'post') settle('post');
        }
      }
      watch.left--;
      if (watch.struck && !watch.done && (phase(m) === 'out' || m.ball.owner >= 0)) settle('off');
      if (watch.left <= 0 || (watch.struck && watch.done) || (!watch.struck && charge === 0 && rest === 0)) {
        if (!watch.struck) t.lost++;
        else if (!watch.done) settle('off');
        watch = null;
      }
    }
    if (phase(m) === 'halftime') {
      m.aiSubs(1, 2);
      m.continueSecondHalf();
    }
    if (phase(m) === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
  }
  return t;
}

describe('knuckleball: whole matches (the scripted human shooting from range, NORMAL)', () => {
  it('in a real match it is what it is on the bench: struck when he gets the time, parried or wide mostly, in about one time in six', () => {
    const sum = (hold: number, n: number): Tries => {
      const s: Tries = { tries: 0, struck: 0, knuckle: 0, goal: 0, saved: 0, held: 0, blocked: 0, post: 0, off: 0, lost: 0 };
      for (let k = 0; k < n; k++) {
        const r = rangeShooter(900 + k, hold);
        for (const key of Object.keys(s) as (keyof Tries)[]) s[key] += r[key];
      }
      return s;
    };
    const full = sum(SHOOT_FULL_T + 0.07, 10);
    const placed = sum(0.25, 10);
    // eslint-disable-next-line no-console
    console.log(`whole matches, 21 to 30 m: full bar ${JSON.stringify(full)} | placed ${JSON.stringify(placed)}`);
    expect(full.struck).toBeGreaterThanOrEqual(30);
    // Every full bar he got away from there was a knuckleball; none of the placed ones was.
    expect(full.knuckle).toBe(full.struck);
    expect(placed.knuckle).toBe(0);
    // Holding SHOOT for half a second with defenders about costs him the ball some of the time.
    expect(full.lost).toBeGreaterThan(0);
    expect(full.lost / full.tries).toBeLessThanOrEqual(0.45);
    const rate = full.goal / full.struck;
    expect(rate).toBeGreaterThanOrEqual(0.07);
    expect(rate).toBeLessThanOrEqual(0.32);
    // Never held; parried more than anything else it does.
    expect(full.held).toBe(0);
    expect(full.saved).toBeGreaterThanOrEqual(full.goal);
    // Better from there than placing it (which the keeper holds or it goes wide).
    expect(rate).toBeGreaterThan(placed.goal / Math.max(1, placed.struck));
    expect(placed.held).toBeGreaterThan(0);
  }, 600_000);
});
