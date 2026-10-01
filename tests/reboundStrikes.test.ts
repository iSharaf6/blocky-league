import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { BALL_R, DT, GOAL_W, HALF_L, HALF_W } from '../src/sim/constants';
import { EMPTY_PAD, Match } from '../src/sim/match';
import type { Player } from '../src/sim/player';
import type { MatchEvent } from '../src/sim/types';

function place(p: Player, x: number, z: number): void {
  p.sentOff = false;
  p.pos.x = x;
  p.pos.z = z;
  p.vel.x = p.vel.z = 0;
  p.facing = 0;
  p.setState('move');
  p.order = null;
  p.kickCooldown = 0;
}

function arena(seed = 1) {
  const m = new Match({
    home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]),
    halfLength: 120, difficulty: 0, humanSide: 0, seed,
  });
  m.phase = 'play';
  m.restart = null;
  m.clock = 20;
  m.timedFinish = false;
  m.moveAssist = false;
  m.autoSwitch = false;
  m.offside = false;
  for (const q of m.players) {
    q.sentOff = true;
    q.pos.x = -30;
    q.pos.z = HALF_W + 2;
    q.order = null;
  }
  const p = m.players[9];
  place(p, 30, 0);
  m.active = p.idx;
  m.drainEvents();
  return { m, p };
}

function incoming(seed = 1) {
  const { m, p } = arena(seed);
  m.ball.reset(p.pos.x + 7, p.pos.z);
  m.ball.vel.x = -9;
  m.ball.lastTouch = m.keeperOf(1)!.idx;
  m.ball.lastTouchSide = 1;
  m.passTarget = -1;
  m.updateBallPath();
  return { m, p };
}

/** Make a real save/post event first, then isolate a striker six metres along its returning flight. */
function actualRebound(kind: 'parry' | 'post') {
  const { m, p } = arena();
  place(p, HALF_L - 12, 0);
  p.stat.shooting = 100;
  if (kind === 'parry') {
    const keeper = m.keeperOf(1)!;
    place(keeper, HALF_L - 1.2, 0);
    keeper.stat.keeping = 0;
  }
  m.ball.reset(p.footX(), p.footZ());
  m.ball.owner = p.idx;
  m.ball.lastTouch = p.idx;
  m.ball.lastTouchSide = 0;
  m.updateBallPath();
  const order = m.order(p, 'shot', 1, 0, kind === 'post' ? 0.3 : 0.85, -1, false,
    { x: HALF_L, z: kind === 'post' ? GOAL_W / 2 : 0 })!;
  // Reduce aim noise to isolate the post collision, rather than depending on a random near miss.
  if (kind === 'post') order.finish = 0.2;
  const history: MatchEvent[] = [];
  let rebound = false;
  for (let i = 0; i < 180 && !rebound && m.phase === 'play'; i++) {
    m.step(DT, EMPTY_PAD);
    const events = m.drainEvents();
    history.push(...events);
    rebound = events.some((e) => kind === 'post' ? e.type === 'post' : e.type === 'save' && !e.caught);
  }
  expect(rebound).toBe(true);
  expect(m.ball.owner).toBe(-1);
  expect(m.ball.held).toBe(false);
  const speed = m.ball.hspeed();
  expect(speed).toBeGreaterThan(2);
  place(p, m.ball.pos.x + m.ball.vel.x / speed * 6, m.ball.pos.z + m.ball.vel.z / speed * 6);
  m.active = p.idx;
  // Tap on the next tick. Match reads the live rebound flight without refreshing the cached AI path.
  return { m, p, history };
}

function tap(m: Match, p: Player, aim = 0): void {
  expect(Math.hypot(m.ball.pos.x - p.pos.x, m.ball.pos.z - p.pos.z)).toBeGreaterThan(4);
  expect(m.passTarget).toBe(-1);
  m.step(DT, { ...EMPTY_PAD, shoot: true, mz: aim });
  expect(p.order?.kind).toBe('shot');
  expect(p.order?.firstTime).toBe(true);
  expect(p.order!.expires).toBeGreaterThan(0);
  expect(p.order!.expires).toBeLessThanOrEqual(2.35);
}

function strike(m: Match, p: Player, held = false) {
  const events: MatchEvent[] = m.drainEvents();
  let speed = 0;
  let vz = 0;
  let fired = false;
  for (let i = 0; i < 150 && !fired && m.phase === 'play'; i++) {
    m.step(DT, { ...EMPTY_PAD, shoot: held });
    const next = m.drainEvents();
    for (const e of next) {
      if (e.type === 'control' && e.player === p.idx) expect(fired).toBe(true);
      if (e.type === 'kick' && (e.kind === 'shot' || e.kind === 'header') && e.player === p.idx) {
        fired = true;
        speed = m.ball.hspeed();
        vz = m.ball.vel.z;
        expect(e.power).toBeGreaterThanOrEqual(0.85);
        expect(e.firstTime).toBe(true);
      }
    }
    events.push(...next);
  }
  expect(fired).toBe(true);
  expect(m.ball.owner).toBe(-1);
  return { events, speed, vz };
}

describe('early first-time rebound strikes', () => {
  it.each([false, true].flatMap((manual) => [false, true].map((bouncing) => ({ manual, bouncing }))))
  ('strikes an incoming untargeted ball without trapping it, manual $manual, bouncing $bouncing', ({ manual, bouncing }) => {
    const { m, p } = incoming();
    m.moveAssist = !manual;
    m.groundAssist = manual ? 'manual' : 'assisted';
    m.throughAssist = manual ? 'manual' : 'assisted';
    if (bouncing) {
      m.ball.pos.y = 0.8;
      m.ball.vel.y = 2.5;
      m.updateBallPath();
    }
    tap(m, p);
    const result = strike(m, p);
    expect(result.speed).toBeGreaterThan(24);
    expect(result.events.some((e) => e.type === 'control' && e.player === p.idx)).toBe(false);
    if (manual) {
      expect(p.pos.x).toBeCloseTo(30, 5);
      expect(p.pos.z).toBeCloseTo(0, 5);
    }
  });

  it.each(['parry', 'post'] as const)('recognises an actual %s rebound without a pass target', (kind) => {
    const { m, p, history } = actualRebound(kind);
    expect(history.some((e) => e.type === 'kick' && e.kind === 'shot')).toBe(true);
    expect(m.ball.lastTouchSide).toBe(kind === 'parry' ? 1 : 0);
    tap(m, p);
    const result = strike(m, p);
    expect(result.speed).toBeGreaterThan(20);
    expect(result.events.some((e) => e.type === 'control' && e.player === p.idx)).toBe(false);
  });

  it.each([-1, 1])('retains the pressed corner aim %s after the stick is released', (aim) => {
    const { m, p } = incoming(7);
    tap(m, p, aim);
    expect(p.order?.dirZ).toBe(aim);
    const result = strike(m, p);
    expect(result.vz * aim).toBeGreaterThan(0);
    expect(result.speed).toBeGreaterThan(24);
  });

  it('uses one held SHOOT press once, without charging or firing another shot on release', () => {
    const { m, p } = incoming();
    tap(m, p);
    const result = strike(m, p, true);
    expect(result.events.filter((e) => e.type === 'kick' && e.kind === 'shot')).toHaveLength(1);
    for (let i = 0; i < 12; i++) {
      m.step(DT, { ...EMPTY_PAD, shoot: true });
      expect(m.shootCharge).toBe(0);
    }
    m.step(DT, EMPTY_PAD);
    for (let i = 0; i < 20; i++) m.step(DT, EMPTY_PAD);
    expect(m.stats.shots[0]).toBe(1);
    expect(m.drainEvents().some((e) => e.type === 'kick' && e.kind === 'shot')).toBe(false);
  });
});

describe('rebound eligibility and cancellation', () => {
  it('keeps an incoming airborne opponent ball at our own end as a clearance', () => {
    const { m, p } = incoming();
    m.ball.pos.y = 2;
    m.ball.vel.y = 4;
    expect(m.canStrikeLoose()).toBe(true);
    // The same reachable flight at our defensive end belongs to the existing clearance control.
    p.pos.x -= 66;
    m.ball.pos.x -= 66;
    m.updateBallPath();
    expect(m.canStrikeLoose()).toBe(false);
    m.step(DT, { ...EMPTY_PAD, shoot: true });
    expect(p.order?.looseStrike).toBeUndefined();
    let cleared = false;
    for (let i = 0; i < 90 && !cleared && m.phase === 'play'; i++) {
      m.step(DT, EMPTY_PAD);
      expect(p.order?.looseStrike).toBeUndefined();
      cleared = m.drainEvents().some((e) => e.type === 'kick' && e.player === p.idx &&
        e.kind === 'header' && e.firstTime === true);
    }
    expect(cleared).toBe(true);
    expect(m.ball.vel.x * m.attackDir(p.side)).toBeGreaterThan(0);
    expect(m.stats.shots[0]).toBe(0);
  });

  it.each(['away', 'wide', 'stops-short', 'too-high', 'too-far'] as const)
  ('does not queue a strike for a ball that is %s', (kind) => {
    const { m, p } = incoming();
    if (kind === 'away') m.ball.vel.x = 9;
    if (kind === 'wide') m.ball.pos.z = 5;
    if (kind === 'stops-short') { m.ball.pos.x = p.pos.x + 13; m.ball.vel.x = -2; }
    if (kind === 'too-high') { m.ball.pos.y = 12; m.ball.vel.y = 16; }
    if (kind === 'too-far') m.ball.pos.x = p.pos.x + 15;
    m.updateBallPath();
    m.step(DT, { ...EMPTY_PAD, shoot: true });
    expect(p.order?.firstTime).not.toBe(true);
    expect(m.stats.shots[0]).toBe(0);
  });

  it('does not strike a ball held in the opposing goalkeeper’s hands', () => {
    const { m, p } = incoming();
    const keeper = m.keeperOf(1)!;
    place(keeper, m.ball.pos.x, 0);
    keeper.setState('hold');
    m.ball.owner = keeper.idx;
    m.ball.held = true;
    m.step(DT, { ...EMPTY_PAD, shoot: true });
    expect(p.order?.firstTime).not.toBe(true);
    expect(m.stats.shots[0]).toBe(0);
  });

  it('keeps SHOOT as a tackle when an opponent has possession', () => {
    const { m, p } = incoming();
    const carrier = m.players[14];
    place(carrier, p.pos.x + 1.1, p.pos.z);
    carrier.facing = Math.PI;
    m.ball.reset(carrier.footX(), carrier.footZ());
    m.ball.owner = carrier.idx;
    m.ball.lastTouch = carrier.idx;
    m.ball.lastTouchSide = 1;
    m.step(DT, { ...EMPTY_PAD, shoot: true });
    expect(m.drainEvents().some((e) => e.type === 'tackleTry')).toBe(true);
    expect(p.order?.kind).not.toBe('shot');
    expect(m.stats.shots[0]).toBe(0);
  });

  it('cancels the old rebound order when another player actually starts a new flight', () => {
    const { m, p } = incoming();
    tap(m, p);
    const oldKick = m.kickId;
    const defender = m.players[14];
    place(defender, m.ball.pos.x, m.ball.pos.z);
    m.order(defender, 'clear', 1, 0, 0.6, -1, true);
    m.step(DT, EMPTY_PAD);
    expect(m.kickId).toBeGreaterThan(oldKick);
    expect(m.drainEvents().some((e) => e.type === 'kick' && e.kind === 'clear')).toBe(true);
    m.step(DT, EMPTY_PAD);
    expect(p.order).toBeNull();
    expect(m.stats.shots[0]).toBe(0);
  });

  it('cancels on opposing possession and does not replay the consumed SHOOT release', () => {
    const { m, p } = incoming();
    tap(m, p);
    const carrier = m.players[14];
    place(carrier, m.ball.pos.x, m.ball.pos.z);
    m.ball.owner = carrier.idx;
    m.step(DT, { ...EMPTY_PAD, shoot: true });
    expect(p.order).toBeNull();
    m.step(DT, EMPTY_PAD);
    expect(m.stats.shots[0]).toBe(0);
  });

  it('expires a missed flight within the bounded wait instead of leaving a permanent strike order', () => {
    const { m, p } = incoming();
    place(p, 10, 0);
    m.ball.reset(17, 0);
    m.ball.vel.x = -9;
    m.updateBallPath();
    tap(m, p);
    const kick = m.kickId;
    // A deflection redirects this same flight; there is no new kick to invalidate its identity.
    m.ball.vel.x = 9;
    m.updateBallPath();
    for (let i = 0; i < 145; i++) m.step(DT, EMPTY_PAD);
    expect(m.kickId).toBe(kick);
    expect(p.order).toBeNull();
    expect(m.stats.shots[0]).toBe(0);
  });

  it('does not pull control away from a pending rebound strike through auto-switch', () => {
    const { m, p } = incoming();
    place(p, 26, 0);
    m.updateBallPath();
    m.autoSwitch = true;
    m.ctl[0].seenActive = p.idx;
    m.ctl[0].switchT = 2;
    place(m.players[10], m.ball.pos.x - 1.5, 1.2);
    tap(m, p);
    expect(m.active).toBe(p.idx);

    // The same geometry really does trigger a switch when there is no requested strike to preserve.
    const idle = incoming();
    place(idle.p, 26, 0);
    place(idle.m.players[10], idle.m.ball.pos.x - 1.5, 1.2);
    idle.m.updateBallPath();
    idle.m.autoSwitch = true;
    idle.m.ctl[0].seenActive = idle.p.idx;
    idle.m.ctl[0].switchT = 2;
    idle.m.step(DT, EMPTY_PAD);
    expect(idle.m.active).toBe(10);
  });

  it('preserves the existing first-time finish for a targeted pass', () => {
    const { m, p } = incoming();
    m.passTarget = p.idx;
    m.ball.lastTouch = 10;
    m.ball.lastTouchSide = 0;
    m.kickSide = 0;
    m.kickKind = 'pass';
    m.sinceKick = 0;
    m.updateBallPath();
    m.step(DT, { ...EMPTY_PAD, shoot: true });
    expect(p.order?.firstTime).toBe(true);
    expect(p.order?.looseStrike).toBeUndefined();
    expect(p.order?.power).toBe(0.65);
  });

  it('preserves the near stationary loose-ball strike', () => {
    const { m, p } = incoming();
    m.ball.reset(p.footX() + 0.3, p.footZ());
    m.ball.pos.y = BALL_R;
    m.updateBallPath();
    m.step(DT, { ...EMPTY_PAD, shoot: true });
    const events = m.drainEvents();
    expect(events.some((e) => e.type === 'kick' && e.kind === 'shot' && e.power === 0.8)).toBe(true);
    expect(m.stats.shots[0]).toBe(1);
  });
});
