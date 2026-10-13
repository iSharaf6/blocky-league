import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { crossingZ, KNUCKLE_MIN_D } from '../src/sim/actions';
import { DT, GOAL_W, HALF_L, HALF_W } from '../src/sim/constants';
import { EMPTY_PAD, Match, SHOOT_FULL_T, type Pad } from '../src/sim/match';
import type { Player } from '../src/sim/player';
import { HumanBot } from './humanBot';

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
 */

const NORMAL = 1.8;

function newMatch(seed: number, difficulty = NORMAL): Match {
  return new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 120, difficulty, humanSide: 0, seed });
}

function place(p: Player, x: number, z: number): void {
  p.pos.x = x;
  p.pos.z = z;
  p.vel.x = p.vel.z = 0;
  p.setState('move');
  p.order = null;
}

const phase = (m: Match): string => m.phase;

interface Strike {
  /** Seconds SHOOT is held. */
  hold: number;
  /** The stick while it is held and at the strike, across the goal (world z). */
  lat?: number;
  /** The stick's sideways push after the strike (aftertouch), world z: without looking. */
  after?: number;
  /**
   * A player who reads his own shot: `react` s after it is struck he pushes the stick all the way (world z) to bend it
   * towards a spot `read` m inside the post on the side it is heading for (in if it is going wide, out if it is central).
   */
  read?: number;
  react?: number;
}

interface Outcome { res: 'goal' | 'saved' | 'held' | 'off' | 'post'; style: string | null }

/** The ball `dist` m from the middle of the goal, `z` m off the pitch's axis; only the keeper (1.5 m off his line) to beat. */
function strikeTrial(seed: number, dist: number, z: number, s: Strike, difficulty = NORMAL): Outcome {
  const m = newMatch(seed, difficulty);
  m.phase = 'play';
  m.restart = null;
  m.clock = 20;
  m.players.forEach((p, i) => place(p, -40 + i * 3.6, -HALF_W + 1.5));
  const ad = m.attackDir(0);
  const gx = ad * HALF_L;
  const p = m.players[9];
  place(p, ad * (HALF_L - Math.sqrt(dist * dist - z * z) - 0.5), z);
  p.facing = Math.atan2(-z * 0.3, ad);
  place(m.keeperOf(1)!, ad * (HALF_L - 1.5), 0);
  const b = m.ball;
  b.reset(p.pos.x + ad * 0.5, p.pos.z);
  b.owner = p.idx;
  b.lastTouch = p.idx;
  b.lastTouchSide = 0;
  m.active = p.idx;
  m.updateBallPath();
  for (let i = 0; i < 4; i++) m.step(DT, EMPTY_PAD);
  m.drainEvents();
  const stick: Pad = { ...EMPTY_PAD, mz: s.lat ?? 0 };
  for (let i = 0; i < Math.round(s.hold / DT); i++) m.step(DT, { ...stick, shoot: true });
  const g0 = m.score[0];
  let style: string | null = null;
  let struck = -1;
  let saved = false;
  let held = false;
  let post = false;
  let push = s.after ?? 0;
  for (let i = 0; i < 260; i++) {
    // The stick stays where it was until the boot meets the ball; then the aftertouch (if any) moves it.
    const pushing = struck >= 0 && push !== 0 && i - struck < 40 && (i - struck) * DT >= (s.react ?? 0);
    m.step(DT, struck >= 0 && i - struck >= 40 ? EMPTY_PAD : pushing ? { ...EMPTY_PAD, mz: Math.max(-1, Math.min(1, (s.lat ?? 0) + push)) } : stick);
    for (const e of m.drainEvents()) {
      if (e.type === 'kick' && e.kind === 'shot' && struck < 0) {
        struck = i;
        style = e.style ?? null;
        if (s.read !== undefined) {
          const z0 = crossingZ(b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z, b.spin.y, gx);
          if (z0 !== null) {
            const zt = (Math.sign(z0) || 1) * (GOAL_W / 2 - s.read);
            if (Math.abs(zt - z0) > 0.25) push = Math.sign(zt - z0) * 2;
          }
        }
      }
      if (e.type === 'save') {
        saved = true;
        held = e.caught;
      }
      if (e.type === 'post') post = true;
    }
    if (m.score[0] > g0) return { res: 'goal', style };
    if (phase(m) === 'out' || (m.ball.owner >= 0 && m.players[m.ball.owner].side === 1) || m.ball.held) break;
  }
  return { res: held ? 'held' : saved ? 'saved' : post ? 'post' : 'off', style };
}

interface Rates { n: number; goal: number; saved: number; held: number; off: number; post: number; styles: Record<string, number> }

/** `n` trials from `dist` m, a third of them from 5 m either side of the pitch's axis, each on its own seed. */
function rates(dist: number, s: Strike, n: number, difficulty = NORMAL): Rates {
  const r: Rates = { n: 0, goal: 0, saved: 0, held: 0, off: 0, post: 0, styles: {} };
  const zs = [0, 5, -5];
  for (let k = 0; k < n; k++) {
    const o = strikeTrial(11 + k * 7 + Math.round(dist * 2) * 1013, dist, zs[k % 3], s, difficulty);
    r.n++;
    r[o.res]++;
    const st = o.style ?? 'plain';
    r.styles[st] = (r.styles[st] ?? 0) + 1;
  }
  r.goal /= n;
  r.saved /= n;
  r.held /= n;
  r.off /= n;
  r.post /= n;
  return r;
}

const pc = (v: number) => `${(v * 100).toFixed(0)}%`.padStart(4);
const fmt = (label: string, r: Rates) =>
  `${label.padEnd(36)} goal ${pc(r.goal)} | parried ${pc(r.saved)} | held ${pc(r.held)} | off ${pc(r.off)} | post ${pc(r.post)}`;

const PLACED: Strike = { hold: 0.2 };
const FULL: Strike = { hold: SHOOT_FULL_T + 0.1 };
const CURLED: Strike = { hold: 0.36, lat: 1 };
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

  it('is the shot from 24 m and beyond, but not the best way to score from the edge of its range, and never one from inside it', () => {
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
    // From 26 m a placed strike is the keeper's every time; the knuckleball is the way to score from there.
    expect(placedFar.goal).toBeLessThanOrEqual(0.04);
    expect(knuckleFar.goal).toBeGreaterThanOrEqual(placedFar.goal + 0.08);
    // At the near edge of its range the placed strike is still the better shot.
    expect(knuckleNear.goal).toBeLessThanOrEqual(placedNear.goal + 0.02);
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
  it('the curler is the bent strike it was, within a few points: a chance from the edge of the box, a hopeful one from range', () => {
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
    // (Before the bigger bend: 36% / 18% / 6% / 2% / 0%.)
    expect(by.get(16)!.goal).toBeGreaterThanOrEqual(0.22);
    expect(by.get(16)!.goal).toBeLessThanOrEqual(0.46);
    expect(by.get(18)!.goal).toBeGreaterThanOrEqual(0.05);
    expect(by.get(18)!.goal).toBeLessThanOrEqual(0.27);
    expect(by.get(20)!.goal).toBeLessThanOrEqual(0.14);
    expect(by.get(22)!.goal).toBeLessThanOrEqual(0.16);
    expect(by.get(25)!.goal).toBeLessThanOrEqual(0.08);
    // It is on target as often as ever (it is re-aimed): the keeper is what stops it.
    for (const r of by.values()) expect(r.off).toBeLessThanOrEqual(0.15);
  }, 300_000);

  it('aftertouch is a skill, not a gift: pushed without looking it costs goals, read right it adds them, and from 26 m it changes nothing', () => {
    const none = rates(20.5, PLACED, N);
    const blind = rates(20.5, { ...PLACED, after: 1 }, N);
    const read = rates(20.5, { ...PLACED, read: 0.6, react: 0.2 }, N);
    const farNone = rates(26, PLACED, N);
    const farRead = rates(26, { ...PLACED, read: 0.6, react: 0.2 }, N);
    // eslint-disable-next-line no-console
    console.log([fmt('20.5 m placed', none), fmt('20.5 m placed, pushed blind', blind), fmt('20.5 m placed, read and pushed', read),
      fmt('26 m placed', farNone), fmt('26 m placed, read and pushed', farRead)].join('\n'));
    expect(blind.goal).toBeLessThanOrEqual(none.goal - 0.08);
    // (Bent off target, mostly: that is what it costs.)
    expect(blind.off).toBeGreaterThan(none.off);
    expect(read.goal).toBeGreaterThanOrEqual(none.goal + 0.05);
    // A perfect reader with a human's reaction time: better, never a formality.
    expect(read.goal).toBeLessThanOrEqual(0.8);
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
