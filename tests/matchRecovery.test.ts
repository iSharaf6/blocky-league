import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext, MatchRequest } from '../src/app';
import { Input, setBindings } from '../src/core/input';
import { Rng } from '../src/core/rng';
import { defaultSave, importSave } from '../src/core/save';
import { FoulPresentation } from '../src/game/foulPresentation';
import { FunTracker, BOUNTIES } from '../src/game/funLayer';
import { MatchSession, type MatchResult, type SessionOptions } from '../src/game/matchSession';
import { MatchRecoveryStore, RECOVERY_KEY, recoveredMatch, recoveryRequest, recoveryRoute,
  restoreBlitz, restoreHype, restoreScenario, savedBlitz, savedHype, savedScenario, type PendingMatch } from '../src/game/matchRecovery';
import { MatchTally } from '../src/game/ratings';
import { rebuildRecoveryRequest, recoveryContext } from '../src/game/matchRecoveryRequest';
import { FRAME_LEN } from '../src/game/replay';
import { decodeState, encodeState, type StateGraph } from '../src/game/stateCodec';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { BOTTOM_DIVISION, YOU, createClub, cupDue, migrateCareer, newSeason, nextMatch, resolveMatchday, userFixture } from '../src/meta/career';
import { BASICS } from '../src/meta/moments';
import { RUN_MILESTONES, drawOffer, pickPerk, runOf, settleRunMatch, startRun } from '../src/meta/run';
import { addXp } from '../src/meta/season';
import { Ball } from '../src/sim/ball';
import { blitzState, usePower } from '../src/sim/blitz';
import { DT, HALF_W } from '../src/sim/constants';
import { AssistState } from '../src/sim/dribble';
import { devFillHype, hypeOf } from '../src/sim/hype';
import { EMPTY_PAD, HumanCtl, Match, type MatchConfig, type Pad } from '../src/sim/match';
import { Player } from '../src/sim/player';
import { applyScenario, judgeScenario, scenarioSecondsLeft } from '../src/sim/scenario';
import { SkillState } from '../src/sim/skills';
import { weatherStep } from '../src/sim/weather';
import { playMatchday } from '../src/ui/career';
import { careerState } from '../src/ui/club';
import { resumeRunRequest } from '../src/ui/run';

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }));
  vi.stubGlobal('navigator', {});
  setBindings();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function match(cfg: Partial<MatchConfig> = {}): Match {
  return new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]),
    halfLength: 150, difficulty: 1.8, humanSide: 0, seed: 27, ...cfg });
}

/** Only the renderer and HUD are doubled. Match, Input, checkpoint/restore and earned trackers are real. */
function rig(m = match()) {
  m.drainEvents();
  const input = new Input();
  const tracker = new FunTracker(m, { humanSide: 0, bounties: true, showtime: true, seed: m.cfg.seed! });
  const tally = new MatchTally();
  const view = { replacePlayer: vi.fn(), apply: vi.fn(), setMarkerVisible: vi.fn(), frameHook: null, celeb: { end: vi.fn() } };
  const cam = { setMode: vi.fn(), cut: vi.fn() };
  const hud = { show: vi.fn(), hideIntro: vi.fn(), setReplay: vi.fn(), setSkippable: vi.fn() };
  const opt: SessionOptions = { ...m.cfg, kits: [m.teams[0].kit, m.teams[1].kit], attendance: 0.8 };
  const onFinish = vi.fn();
  const session = Object.assign(Object.create(MatchSession.prototype), {
    match: m, opt, input, view, cam, hud, onFinish, demo: false, driver: null,
    tally, fun: { tracker }, time: 17, lastPasser: [9, 20], subQueue: [], moment: null,
    latch: { pass: false, shoot: false, through: false, power: false, skill: false },
    cur: new Float32Array(FRAME_LEN), prev: new Float32Array(FRAME_LEN),
    foulPresentation: new FoulPresentation(), present: { hidePlate: vi.fn() },
    wearing: m.players.map(p => p.def), paused: false,
  }) as MatchSession;
  return { m, session, input, tracker, tally, view, cam, hud, onFinish, opt };
}

function wire(graph: StateGraph): StateGraph { return JSON.parse(JSON.stringify(graph)) as StateGraph; }
function snapshot(h: ReturnType<typeof rig>): StateGraph {
  const graph = h.session.checkpoint();
  expect(graph).not.toBeNull();
  return wire(graph!);
}

function advance(h: ReturnType<typeof rig>, frames: number, pad: Pad = EMPTY_PAD): void {
  for (let i = 0; i < frames; i++) {
    h.m.step(DT, pad);
    h.tracker.after(h.m.drainEvents(), DT);
  }
}

function openPlay(m: Match): void {
  m.phase = 'play';
  m.restart = null;
  m.phaseT = 0;
  for (const p of m.players) {
    p.pos.x = -40 + p.idx * 3.6;
    p.pos.z = -HALF_W + 1.5;
    p.vel.x = p.vel.z = 0;
    p.setState('move');
    p.order = null;
  }
  m.drainEvents();
}

function airborne(h: ReturnType<typeof rig>): void {
  const m = h.m;
  openPlay(m);
  const p = m.players[9];
  p.pos.x = -12;
  p.pos.z = 0;
  p.facing = 0;
  const receiver = m.players[10];
  receiver.pos.x = 12;
  receiver.pos.z = 3;
  m.active = p.idx;
  m.ball.reset(p.footX(), p.footZ());
  m.ball.owner = p.idx;
  m.ball.lastTouch = p.idx;
  m.ball.lastTouchSide = p.side;
  m.updateBallPath();
  const kick = m.kickId;
  expect(m.order(p, 'lob', 1, 0.125, 0.65, receiver.idx, false)).not.toBeNull();
  for (let i = 0; i < 90 && (m.kickId === kick || m.ball.pos.y < 1); i++) advance(h, 1);
  expect(m.kickId).toBeGreaterThan(kick);
  expect(m.ball.owner).toBe(-1);
  expect(m.ball.pos.y).toBeGreaterThanOrEqual(1);
}

class MemoryStore {
  readonly data = new Map<string, string>();
  getItem(k: string): string | null { return this.data.get(k) ?? null; }
  setItem(k: string, value: string): void { this.data.set(k, value); }
  removeItem(k: string): void { this.data.delete(k); }
}

function pending(h: ReturnType<typeof rig>, played = 4): PendingMatch {
  const req: MatchRequest = { kind: 'career', home: h.opt.home, away: h.opt.away, kits: h.opt.kits,
    humanSide: 0, difficulty: 1, halfMinutes: 2.5, attendance: h.opt.attendance,
    reward: () => ({ coins: 50, label: 'MATCH' }), onBanked: vi.fn(), onDone: vi.fn(), onQuit: vi.fn() };
  return { version: 1, savedAt: '2026-10-05T00:00:00.000Z', recordPlayed: played, route: recoveryRoute(req),
    request: recoveryRequest(req), options: h.opt, runtime: snapshot(h), tally: { passes: 3, tackles: 1 } };
}

describe('football object graph recovery', () => {
  it('roundtrips a real default Match with shared team/player/controller references and class methods', () => {
    const h = rig();
    const before = h.m.rng.state();
    const graph = snapshot(h);
    expect(h.m.rng.state()).toBe(before);
    expect(snapshot(h)).toEqual(graph);
    expect(h.m.rng.state()).toBe(before);
    const detached = recoveredMatch(graph);
    expect(detached).toBeInstanceOf(Match);
    expect(detached.ball).toBeInstanceOf(Ball);
    expect(detached.rng).toBeInstanceOf(Rng);
    expect(detached.players[0]).toBeInstanceOf(Player);
    expect(detached.ctl[0]).toBeInstanceOf(HumanCtl);
    expect(detached.ctl[0].assist).toBeInstanceOf(AssistState);
    expect(detached.ctl[0].skill).toBeInstanceOf(SkillState);
    expect(detached.teamPlayers(0)[9]).toBe(detached.players[9]);
    expect(detached.teams[0]).toBe(detached.cfg.home);
    expect(detached.players[9].def).toBe(detached.teams[0].players[9]);
    expect((detached as unknown as { h: HumanCtl }).h).toBe(detached.ctl[0]);
    expect(detached.rng.state()).toBe(before);
    expect(detached.rng.next()).toBe(h.m.rng.next());
  });

  it('preserves maps, sets, cycles and exact special numeric state across JSON', () => {
    const shared = { n: 1 };
    const value: { values: unknown[]; map: Map<unknown, unknown>; set: Set<unknown>; self?: unknown } = {
      values: [shared, shared, undefined, -0, NaN, Infinity, -Infinity],
      map: new Map([[shared, new Set([shared])]]), set: new Set([shared]),
    };
    value.self = value;
    const copy = decodeState<typeof value>(wire(encodeState(value)));
    expect(copy.self).toBe(copy);
    expect(copy.values[0]).toBe(copy.values[1]);
    expect(copy.values[2]).toBeUndefined();
    expect(Object.is(copy.values[3], -0)).toBe(true);
    expect(Number.isNaN(copy.values[4])).toBe(true);
    expect(copy.values.slice(5)).toEqual([Infinity, -Infinity]);
    expect(copy.set.has(copy.values[0])).toBe(true);
    expect((copy.map.get(copy.values[0]) as Set<unknown>).has(copy.values[0])).toBe(true);
  });

  it('rejects malformed or unsafe graphs before changing a live match', () => {
    const h = rig();
    const initial = snapshot(h);
    const unsafe = wire(initial);
    unsafe.nodes[0].entries.push(['__proto__', { ref: 0 }]);
    expect(() => h.session.restoreCheckpoint(unsafe)).toThrow();
    expect(snapshot(h)).toEqual(initial);
    const broken = wire(initial);
    broken.nodes[0].entries.push(['bad', { ref: broken.nodes.length + 10 }]);
    expect(() => h.session.restoreCheckpoint(broken)).toThrow();
    expect(snapshot(h)).toEqual(initial);
    expect(() => decodeState({ ...initial, version: 99 } as unknown as StateGraph)).toThrow();
  });
});

describe('actual MatchSession checkpoint and restore', () => {
  it('clears a prior card victim pose and pin on restore while retaining the actual booking', () => {
    const source = rig();
    source.m.booked.add(7);
    const graph = snapshot(source);
    const resumed = rig();
    const pinPlayer = vi.fn();
    Object.assign(resumed.view, { pinPlayer, frameHook: vi.fn() });
    Object.assign(resumed.session, { cardT: 1.2, cardRestart: resumed.m.restart, cardPlayer: 7, cardVictim: 9,
      cardIdentity: resumed.m.players[7].def.id, cardAct: { idx: 9, age: 0.4 } });
    resumed.session.restoreCheckpoint(graph);
    const state = resumed.session as unknown as { cardT: number; cardAct: unknown; cardPlayer: number; cardVictim: number };
    expect(state).toMatchObject({ cardT: 0, cardAct: null, cardPlayer: -1, cardVictim: -1 });
    expect(resumed.view.frameHook).toBeNull();
    expect(pinPlayer).toHaveBeenLastCalledWith(null);
    expect(resumed.m.booked.has(7)).toBe(true);
    expect(snapshot(resumed)).toEqual(graph);
  });

  it('resumes the same airborne pass and future simulation while keeping live tracker and HUD match identities', () => {
    const source = rig();
    airborne(source);
    source.tracker.setDaily([{ text: '3 passes', have: 1, goal: 3, coins: 25, claimed: false }], ['passShot']);
    source.tally.get(9).passes = 3;
    const graph = snapshot(source);
    const resumed = rig();
    const liveMatch = resumed.m;
    const liveTracker = resumed.tracker;
    const liveTally = resumed.tally;
    resumed.input.touch.pass = true;
    resumed.session.restoreCheckpoint(graph);
    expect(resumed.session.match).toBe(liveMatch);
    expect((resumed.tracker as unknown as { m: Match }).m).toBe(liveMatch);
    expect(resumed.tracker).toBe(liveTracker);
    expect(resumed.tally).toBe(liveTally);
    expect(snapshot(resumed)).toEqual(graph);
    expect(resumed.tally.get(9).passes).toBe(3);
    expect(resumed.view.replacePlayer).toHaveBeenCalledTimes(22);
    expect(resumed.input.read().pass).toBe(false);
    expect(resumed.hud.setSkippable).toHaveBeenLastCalledWith(false);
    advance(source, 180, { ...EMPTY_PAD, mx: 0.7, mz: 0.1, autoSprint: true });
    advance(resumed, 180, { ...EMPTY_PAD, mx: 0.7, mz: 0.1, autoSprint: true });
    expect(snapshot(resumed)).toEqual(snapshot(source));
  });

  it('retains a keeper holding the ball and lets him carry and distribute it after reopening', () => {
    const source = rig();
    openPlay(source.m);
    const keeper = source.m.keeperOf(0)!;
    (source.m as unknown as { catchBall(p: Player, save: boolean): void }).catchBall(keeper, true);
    source.m.active = keeper.idx;
    source.m.drainEvents();
    advance(source, 24, { ...EMPTY_PAD, mx: 0.6, mz: 0.5 });
    const resumed = rig();
    resumed.session.restoreCheckpoint(snapshot(source));
    expect(resumed.m.ball.held).toBe(true);
    expect(resumed.m.ball.owner).toBe(keeper.idx);
    expect(resumed.m.keeperHeldT).toBe(source.m.keeperHeldT);
    advance(source, 12, { ...EMPTY_PAD, mx: 0.5, mz: 0.5, pass: true });
    advance(resumed, 12, { ...EMPTY_PAD, mx: 0.5, mz: 0.5, pass: true });
    advance(source, 40);
    advance(resumed, 40);
    expect(resumed.m.ball.held).toBe(false);
    expect(snapshot(resumed)).toEqual(snapshot(source));
  });

  it('keeps second-half direction, substitutions, booked players and separate predecessor ratings', () => {
    const source = rig();
    source.m.phase = 'halftime';
    source.m.clock = source.m.cfg.halfLength;
    const off = source.m.players[9];
    const oldName = off.def.name;
    source.tally.get(off.idx).goals = 2;
    const bench = source.m.bench[0].findIndex(p => p.role !== 'GK');
    expect(bench).toBeGreaterThanOrEqual(0);
    source.tally.sub(off.idx, oldName, 0, false, false);
    expect(source.session.substitute(0, off.slot, bench)).toBe(true);
    source.m.booked.add(4);
    source.m.continueSecondHalf();
    source.m.drainEvents();
    const graph = snapshot(source);
    const resumed = rig();
    resumed.session.restoreCheckpoint(graph);
    expect(resumed.m.half).toBe(2);
    expect(resumed.m.attackDir(0)).toBe(source.m.attackDir(0));
    expect(resumed.m.subsUsed).toEqual([1, 0]);
    expect(resumed.m.booked.has(4)).toBe(true);
    expect(resumed.m.players[9].def.name).not.toBe(oldName);
    expect(resumed.session.ratings()).toEqual(source.session.ratings());
    expect(resumed.session.ratings().find(p => p.name === oldName)?.goals).toBe(2);
    expect(resumed.session.ratings().find(p => p.name === resumed.m.players[9].def.name)?.goals).toBe(0);
    advance(source, 150);
    advance(resumed, 150);
    expect(snapshot(resumed)).toEqual(snapshot(source));
  });

  it.each([1, 2])('accounts for %i paused substitution(s) in one slot exactly once after reopening', count => {
    const source = rig();
    source.session.paused = true;
    source.m.phase = 'halftime';
    source.m.clock = source.m.cfg.halfLength;
    const player = source.m.players[9];
    const originalName = player.def.name;
    Object.assign(source.tally.get(player.idx), { goals: 2, assists: 1 });
    const changes: { off: string; on: string }[] = [];
    for (let i = 0; i < count; i++) {
      const off = player.def.name;
      const bench = source.m.bench[0].findIndex(p => p.role !== 'GK');
      expect(bench).toBeGreaterThanOrEqual(0);
      expect(source.session.substitute(0, player.slot, bench)).toBe(true);
      changes.push({ off, on: player.def.name });
    }
    // The paused tactics menu has not reached handleEvents yet: no manual tally accounting or event drain.
    expect(source.m.events.filter(e => e.type === 'sub')).toHaveLength(count);
    expect(source.tally.get(player.idx)).toMatchObject({ goals: 2, assists: 1 });
    const graph = snapshot(source);
    const resumed = rig();
    resumed.session.restoreCheckpoint(graph);
    const ratings = resumed.session.ratings();
    expect(ratings).toHaveLength(22 + count);
    expect(ratings.filter(p => p.name === originalName)).toHaveLength(1);
    expect(ratings.find(p => p.name === originalName)).toMatchObject({ goals: 2, assists: 1 });
    for (const change of changes) {
      expect(ratings.find(p => p.name === change.on)).toMatchObject({ goals: 0, assists: 0 });
    }
    expect(resumed.tally.get(player.idx)).toMatchObject({ goals: 0, assists: 0 });
    const presentation = (session: MatchSession) => session as unknown as {
      lastPasser: [number, number]; subQueue: { off: { name: string }; on: { name: string } }[];
    };
    expect(presentation(resumed.session).lastPasser[0]).toBe(-1);
    expect(presentation(resumed.session).lastPasser[1]).toBe(20);
    const queued = (session: MatchSession) => presentation(session).subQueue.map(q => ({ off: q.off.name, on: q.on.name }));
    expect(queued(resumed.session)).toEqual(changes);
    expect(resumed.m.events).toEqual([]);

    resumed.session.restoreCheckpoint(graph);
    expect(resumed.session.ratings()).toEqual(ratings);
    expect(queued(resumed.session)).toEqual(changes);
    const reopened = rig();
    reopened.session.restoreCheckpoint(snapshot(resumed));
    expect(reopened.session.ratings()).toEqual(ratings);
    expect(queued(reopened.session)).toEqual(changes);
    expect(presentation(reopened.session).lastPasser[0]).toBe(-1);
    expect(reopened.m.events).toEqual([]);
  });

  it('keeps HYPE meters and an active Blitz power without consuming a fresh random spawn draw', () => {
    const source = rig(match({ mode: 'blitz', hype: true }));
    openPlay(source.m);
    source.m.heldPower[0] = 'freeze';
    expect(usePower(source.m, 0, source.m.active)).toBe(true);
    blitzState(source.m).spawnT = 0.4;
    devFillHype(source.m, 0);
    source.m.drainEvents();
    const before = source.m.rng.state();
    const graph = snapshot(source);
    expect(source.m.rng.state()).toBe(before);
    const resumed = rig(match({ mode: 'blitz', hype: true }));
    resumed.session.restoreCheckpoint(graph);
    expect(resumed.m.rng.state()).toBe(before);
    expect(hypeOf(resumed.m, 0)).toBe(1);
    expect(savedHype(resumed.m)).toEqual(savedHype(source.m));
    expect(savedBlitz(resumed.m)).toEqual(savedBlitz(source.m));
    expect(savedBlitz(resumed.m)!.fx[0].freeze).toBeGreaterThan(0);
    advance(source, 120);
    advance(resumed, 120);
    expect(snapshot(resumed)).toEqual(snapshot(source));
    expect(resumed.m.powerups.length).toBeGreaterThan(0);
  });

  it('resumes a rain skid, its wet patch locations and the slip cooldown exactly', () => {
    const source = rig(match({ weather: 'rain' }));
    openPlay(source.m);
    const p = source.m.players[9];
    const patch = source.m.wetPatches[0];
    Object.assign(p.pos, { x: patch.x, z: patch.z });
    Object.assign(p.vel, { x: 8, z: 0 });
    p.wantX = -1;
    p.wantZ = 0;
    p.sprint = true;
    source.m.ball.owner = p.idx;
    source.m.active = p.idx;
    weatherStep(source.m, DT);
    expect(p.state).toBe('fallen');
    expect(p.wetSlipT).toBe(9);
    source.m.drainEvents();
    const rng = source.m.rng.state();
    const resumed = rig();
    resumed.session.restoreCheckpoint(snapshot(source));
    expect(resumed.m.cfg.weather).toBe('rain');
    expect(resumed.m.wetPatches).toEqual(source.m.wetPatches);
    expect(resumed.m.players[9].wetSlipT).toBe(9);
    expect(resumed.m.players[9].state).toBe('fallen');
    expect(resumed.m.rng.state()).toBe(rng);
    advance(source, 120, { ...EMPTY_PAD, mx: -1, autoSprint: true });
    advance(resumed, 120, { ...EMPTY_PAD, mx: -1, autoSprint: true });
    expect(resumed.m.players[9].wetSlipT).toBeGreaterThan(0);
    expect(snapshot(resumed)).toEqual(snapshot(source));
  });

  it('resumes a moment judge with elapsed play intact and the same later verdict', () => {
    const source = rig(match({ halfLength: 600 }));
    const spec = { ...BASICS[0].spec, untimed: false, seconds: 3 };
    applyScenario(source.m, spec);
    for (let i = 0; i < 30; i++) {
      advance(source, 1, { ...EMPTY_PAD, mx: 0.4 });
      judgeScenario(source.m, spec);
    }
    const left = scenarioSecondsLeft(source.m, spec);
    const graph = snapshot(source);
    expect(savedScenario(source.m)).not.toBeNull();
    const resumed = rig(match({ halfLength: 600 }));
    resumed.session.restoreCheckpoint(graph);
    expect(savedScenario(resumed.m)).toEqual(savedScenario(source.m));
    expect(scenarioSecondsLeft(resumed.m, spec)).toBe(left);
    for (let i = 0; i < 90; i++) {
      const pad = { ...EMPTY_PAD, pass: i < 8, mx: 0.8, mz: 0.6 };
      advance(source, 1, pad);
      advance(resumed, 1, pad);
      expect(judgeScenario(resumed.m, spec)).toEqual(judgeScenario(source.m, spec));
    }
    expect(snapshot(resumed)).toEqual(snapshot(source));
  });

  it('restores an untimed basics step with its documented half-length sentinel', () => {
    const source = rig();
    applyScenario(source.m, BASICS[0].spec);
    advance(source, 15, { ...EMPTY_PAD, mx: 0.4 });
    judgeScenario(source.m, BASICS[0].spec);
    expect(source.m.cfg.halfLength).toBe(Number.MAX_SAFE_INTEGER);
    const resumed = rig();
    resumed.session.restoreCheckpoint(snapshot(source));
    expect(resumed.m.cfg.halfLength).toBe(Number.MAX_SAFE_INTEGER);
    expect(savedScenario(resumed.m)).toEqual(savedScenario(source.m));
    expect(snapshot(resumed)).toEqual(snapshot(source));
  });

  it('settles a finished basics verdict once after reopening even when its result timer passed below zero', () => {
    const source = rig();
    const spec = BASICS[1].spec;
    applyScenario(source.m, spec);
    const internals = source.session as unknown as {
      moment: { spec: typeof spec; briefT: number; outcome: MatchResult['scenarioOutcome'] | null; endT: number; count: number };
      judgeMoment(): void; finishMoment(): void; momentFlow(dt: number): void;
    };
    internals.moment = { spec, briefT: 0, outcome: null, endT: -1, count: -1 };
    advance(source, 1, { ...EMPTY_PAD, mx: 0.4 });
    (source.m as unknown as { goal(side: 0): void }).goal(0);
    internals.judgeMoment();
    expect(internals.moment.outcome).toMatchObject({ won: true, stars: 3 });
    const verdict = { ...internals.moment.outcome! };
    internals.finishMoment();
    expect(internals.moment.endT).toBeGreaterThan(0);
    let captured: StateGraph | null = null;
    source.session.onFinish = vi.fn(() => { captured = snapshot(source); });
    internals.momentFlow(internals.moment.endT + DT);
    expect(source.session.onFinish).toHaveBeenCalledOnce();
    expect(internals.moment.endT).toBeLessThan(0);
    expect(source.m.phase).toBe('fulltime');
    expect(captured).not.toBeNull();
    const resumed = rig();
    resumed.session.restoreCheckpoint(captured!);
    const resumedInternals = resumed.session as unknown as { moment: { endT: number }; momentFlow(dt: number): void };
    expect(resumedInternals.moment.endT).toBe(0);
    resumedInternals.momentFlow(DT);
    resumedInternals.momentFlow(DT);
    expect(resumed.onFinish).toHaveBeenCalledOnce();
    expect(resumed.onFinish.mock.calls[0][0].scenarioOutcome).toEqual(verdict);
  });

  it('keeps an active basics step with endT -1 waiting for a verdict after reopening', () => {
    const source = rig();
    const spec = BASICS[0].spec;
    applyScenario(source.m, spec);
    Object.assign(source.session, { moment: { spec, briefT: 0, outcome: null, endT: -1, count: -1 } });
    const resumed = rig();
    resumed.session.restoreCheckpoint(snapshot(source));
    const internals = resumed.session as unknown as { moment: { endT: number }; momentFlow(dt: number): void };
    internals.momentFlow(10);
    expect(internals.moment.endT).toBe(-1);
    expect(resumed.m.phase).toBe('play');
    expect(resumed.onFinish).not.toHaveBeenCalled();
  });

  it('restores a shootout ball in flight and resolves the same kick', () => {
    const source = rig(match({ knockout: true }));
    source.m.half = 2;
    source.m.score = [1, 1];
    (source.m as unknown as { startShootout(): void }).startShootout();
    for (let i = 0; i < 900 && source.m.shootout!.stage !== 'flight'; i++) {
      const s = source.m.shootout!;
      advance(source, 1, { ...EMPTY_PAD, shoot: s.stage === 'aim' && s.t < 0.4, mz: 0.3 });
    }
    expect(source.m.shootout!.stage).toBe('flight');
    const resumed = rig(match({ knockout: true }));
    resumed.session.restoreCheckpoint(snapshot(source));
    expect(resumed.m.shootout).toEqual(source.m.shootout);
    advance(source, 90);
    advance(resumed, 90);
    expect(snapshot(resumed)).toEqual(snapshot(source));
    expect(resumed.m.shootout!.kicks[0].length + resumed.m.shootout!.kicks[1].length).toBeGreaterThan(0);
  });

  it('repeated background saves and restores preserve earned bounties without paying or adding them again', () => {
    const source = rig();
    openPlay(source.m);
    source.tracker.bounty = { id: 1, kind: 'score', def: BOUNTIES.score, left: 20, total: 30, have: 0 };
    source.tracker.offered = 1;
    source.m.score = [1, 0];
    source.tracker.after([{ type: 'goal', side: 0, scorer: 9, own: false }], DT);
    const earned = source.tracker.summary();
    expect(earned.coins).toBe(BOUNTIES.score.coins);
    const storage = new MemoryStore();
    const state = pending(source);
    for (let i = 0; i < 3; i++) {
      // A new store/session simulates process loss, rather than retaining a saved object in memory.
      expect(new MatchRecoveryStore(storage).write(state)).toBe(true);
      const read = new MatchRecoveryStore(storage).read(4)!;
      const resumed = rig();
      resumed.session.restoreCheckpoint(read.runtime);
      expect(resumed.tracker.summary()).toEqual(earned);
      expect(resumed.onFinish).not.toHaveBeenCalled();
      expect(resumed.tally.ratings(resumed.m)).toEqual(source.tally.ratings(source.m));
      state.runtime = snapshot(resumed);
    }
    // Once the ordinary save has recorded the result, an old unfinished snapshot cannot pay it again.
    expect(new MatchRecoveryStore(storage).read(5)).toBeNull();
    expect(storage.getItem(RECOVERY_KEY)).toBeNull();
  });
});

describe('local recovery storage and request boundary', () => {
  it('keeps callback functions out of the durable request and restores after a fresh store instance', () => {
    const h = rig();
    const state = pending(h);
    expect(state.request).not.toHaveProperty('reward');
    expect(state.request).not.toHaveProperty('onDone');
    expect(state.request).not.toHaveProperty('onBanked');
    expect(state.request).not.toHaveProperty('onQuit');
    const storage = new MemoryStore();
    expect(new MatchRecoveryStore(storage).write(state)).toBe(true);
    const read = new MatchRecoveryStore(storage).read(4)!;
    expect(read).toEqual(state);
    expect(recoveredMatch(read.runtime).score).toEqual(h.m.score);
    expect(recoveryRoute({ ...state.request, reward: vi.fn(), onDone: vi.fn(), kind: 'run' })).toBe('run');
    expect(recoveryRoute({ ...state.request, reward: vi.fn(), onDone: vi.fn(), kind: 'basics' })).toBe('basics');
  });

  it.each(['truncated', 'missing player state', 'unsupported version', 'stale paid record', 'NaN owner', 'fractional owner'])('discards %s data harmlessly', (fault) => {
    const h = rig();
    const storage = new MemoryStore();
    const state = pending(h);
    if (fault === 'truncated') storage.setItem(RECOVERY_KEY, '{');
    else {
      if (fault === 'unsupported version') (state as unknown as { version: number }).version = 99;
      if (fault === 'stale paid record') state.recordPlayed = 3;
      if (fault === 'missing player state') {
        const player = state.runtime.nodes.find(n => n.kind === 'Player')!;
        player.entries = player.entries.filter(([k]) => k !== 'stamina');
      }
      if (fault === 'NaN owner' || fault === 'fractional owner') {
        const owner = state.runtime.nodes.find(n => n.kind === 'Ball')!.entries.find(([k]) => k === 'owner')!;
        owner[1] = fault === 'NaN owner' ? { special: 'NaN' } : 9.5;
      }
      storage.setItem(RECOVERY_KEY, JSON.stringify(state));
    }
    expect(() => new MatchRecoveryStore(storage).read(4)).not.toThrow();
    expect(new MatchRecoveryStore(storage).read(4)).toBeNull();
    expect(storage.getItem(RECOVERY_KEY)).toBeNull();
  });

  it('tolerates blocked or full storage on read, write and clear without stopping football', () => {
    const denied = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); },
      removeItem: () => { throw new Error('denied'); } };
    const store = new MatchRecoveryStore(denied);
    expect(store.write(pending(rig()))).toBe(false);
    expect(store.read(4)).toBeNull();
    expect(() => store.clear()).not.toThrow();
  });

  it('leaves WeakMap helpers empty when a mode has no saved state', () => {
    const m = match();
    restoreHype(m, null);
    restoreBlitz(m, null);
    restoreScenario(m, null);
    expect(savedHype(m)).toBeNull();
    expect(savedBlitz(m)).toBeNull();
    expect(savedScenario(m)).toBeNull();
  });
});

/** Menu navigation is a renderer boundary: stop after the real callback saves and before any screen mounts. */
function appRig(save = defaultSave()) {
  const requests: MatchRequest[] = [];
  const app: AppContext = {
    save, menus: {} as AppContext['menus'], persist: vi.fn(), startMatch: r => { requests.push(r); },
    mainMenu: vi.fn(() => { throw new Error('navigation reached'); }),
  };
  return { app, requests };
}

function careerApp() {
  const h = appRig();
  const st = migrateCareer(null, 173);
  const team = makeTeam(PRESET_CLUBS[5]);
  st.club = createClub({ name: 'Pixel Park FC', short: 'PIX', kit: team.kit, formation: '4-4-2' }, 173);
  newSeason(st, BOTTOM_DIVISION, 1);
  h.app.save.career = st;
  return h;
}

function requestPending(app: AppContext, req: MatchRequest): PendingMatch {
  const h = rig(match({ home: req.home, away: req.away, humanSide: req.humanSide,
    halfLength: req.halfMinutes * 60, knockout: req.knockout, mode: req.mode, weather: req.weather }));
  const route = recoveryRoute(req);
  return { ...pending(h, app.save.record.played), request: recoveryRequest(req), route,
    context: recoveryContext(app, route), progressXp: app.save.progress.xp };
}

function reloadPending(app: AppContext, state: PendingMatch) {
  const storage = new MemoryStore();
  expect(new MatchRecoveryStore(storage).write(state)).toBe(true);
  const save = importSave(JSON.stringify(app.save))!;
  expect(save).not.toBeNull();
  const reloaded = appRig(save);
  const pending = new MatchRecoveryStore(storage).read(save.record.played, save.progress.xp)!;
  expect(pending).not.toBeNull();
  return { ...reloaded, pending, storage };
}

function resultOf(state: PendingMatch, won = true): MatchResult {
  const m = recoveredMatch(state.runtime);
  const hs = state.request.humanSide;
  m.phase = 'fulltime';
  m.score = hs === 0 ? (won ? [2, 1] : [0, 1]) : (won ? [1, 2] : [1, 0]);
  return { score: m.score, humanSide: hs, match: m, winner: won ? hs : hs === 0 ? 1 : 0 };
}

describe('recovered competition settlement callbacks', () => {
  it('rebuilds the actual league fixture callback after process loss and advances that fixture once', () => {
    const source = careerApp();
    playMatchday(source.app, careerState(source.app));
    const req = source.requests[0];
    const state = requestPending(source.app, req);
    const reloaded = reloadPending(source.app, state);
    reloaded.app.save.settings.halfMinutes = 0.5;
    const friendlyReward = vi.fn(() => ({ coins: 99999, label: 'WRONG ROUTE' }));
    const rebuilt = rebuildRecoveryRequest(reloaded.app, reloaded.pending, friendlyReward)!;
    expect(rebuilt).not.toBeNull();
    expect(rebuilt.halfMinutes).toBe(req.halfMinutes);
    expect(reloaded.requests).toEqual([]);
    const before = careerState(reloaded.app);
    const md = before.season!.matchday;
    const fixture = userFixture(before.season!, md)!;
    const r = resultOf(state);
    expect(rebuilt.reward(r).coins).toBeGreaterThan(0);
    const after = careerState(reloaded.app);
    expect(after.season!.matchday).toBe(md + 1);
    expect(fixture.hg).toBe(r.score[0]);
    expect(fixture.ag).toBe(r.score[1]);
    expect(friendlyReward).not.toHaveBeenCalled();
    const settled = JSON.stringify(after);
    const wallet = reloaded.app.save.coins;
    rebuilt.reward(r);
    expect(JSON.stringify(careerState(reloaded.app))).toBe(settled);
    expect(reloaded.app.save.coins).toBe(wallet);
    vi.mocked(reloaded.app.persist).mockClear();
    expect(() => rebuilt.onDone(r, 50)).toThrow('navigation reached');
    expect(reloaded.app.persist).toHaveBeenCalledOnce();
    expect(reloaded.app.mainMenu).toHaveBeenCalledOnce();
    expect(rebuildRecoveryRequest(reloaded.app, reloaded.pending, friendlyReward)).toBeNull();
  });

  it.each(['fixture', 'season seed', 'team', 'human side'])('rejects a pending league snapshot after its %s changes', (change) => {
    const source = careerApp();
    playMatchday(source.app, careerState(source.app));
    const state = requestPending(source.app, source.requests[0]);
    const reloaded = reloadPending(source.app, state);
    const st = careerState(reloaded.app);
    if (change === 'fixture') {
      const f = userFixture(st.season!, st.season!.matchday)!;
      expect(resolveMatchday(st, reloaded.app.save, st.season!.matchday, f.home === YOU ? 2 : 1, f.home === YOU ? 1 : 2)).toBe(true);
    } else if (change === 'season seed') st.season!.seed++;
    else if (change === 'team') reloaded.pending.request.away.id = 'wrong-team';
    else reloaded.pending.request.humanSide = reloaded.pending.request.humanSide === 0 ? 1 : 0;
    expect(rebuildRecoveryRequest(reloaded.app, reloaded.pending, vi.fn())).toBeNull();
    expect(reloaded.requests).toEqual([]);
  });

  it('restores a cup replay without resurrecting its already consumed decider offer or advancing league matchdays', () => {
    const source = careerApp();
    const st = careerState(source.app);
    for (let md = 0; md < 4; md++) {
      const f = userFixture(st.season!, md)!;
      expect(resolveMatchday(st, source.app.save, md, f.home === YOU ? 2 : 1, f.home === YOU ? 1 : 2)).toBe(true);
    }
    expect(cupDue(st)).toBe(0);
    playMatchday(source.app, st);
    const req = source.requests[0];
    expect(req.decider).toContain('BLOCKY CUP');
    const state = requestPending(source.app, { ...req, decider: undefined });
    const reloaded = reloadPending(source.app, state);
    // JSON omits undefined; rebuilding the normal cup request would otherwise reintroduce the offer.
    expect(reloaded.pending.request).not.toHaveProperty('decider');
    const rebuilt = rebuildRecoveryRequest(reloaded.app, reloaded.pending, vi.fn())!;
    expect(rebuilt.decider).toBeUndefined();
    const current = careerState(reloaded.app);
    const md = current.season!.matchday;
    const cupRound = nextMatch(current)!.cupRound;
    expect(rebuilt.reward(resultOf(state)).coins).toBeGreaterThan(0);
    expect(cupDue(careerState(reloaded.app))).not.toBe(cupRound);
    expect(careerState(reloaded.app).season!.matchday).toBe(md);
    expect(rebuildRecoveryRequest(reloaded.app, reloaded.pending, vi.fn())).toBeNull();
  });

  it('banks a recovered Club Run milestone, match totals and XP BOOST before navigation exactly once', () => {
    const source = appRig();
    const run = runOf(source.app.save);
    const seed = Array.from({ length: 50 }, (_, i) => i + 1)
      .find(seed => drawOffer({ seed, round: 1, perks: [] }).includes('xpBoost'))!;
    expect(seed).toBeGreaterThan(0);
    expect(startRun(run, { seed, club: 5, difficulty: 1 })).toBe(true);
    for (let i = 0; i < 2; i++) {
      run.inMatch = true;
      expect(settleRunMatch(source.app.save, { won: true, score: [2, 0] })).not.toBeNull();
      expect(pickPerk(run, i === 0 ? 'xpBoost' : run.offer[0])).toBe(true);
    }
    expect(run.perks).toContain('xpBoost');
    run.inMatch = true;
    const req = resumeRunRequest(source.app)!;
    expect(req).not.toBeNull();
    const state = requestPending(source.app, req);
    const reloaded = reloadPending(source.app, state);
    const friendlyReward = vi.fn();
    const rebuilt = rebuildRecoveryRequest(reloaded.app, reloaded.pending, friendlyReward)!;
    expect(rebuilt).not.toBeNull();
    expect(runOf(reloaded.app.save).inMatch).toBe(true);
    const beforeCoins = reloaded.app.save.coins;
    const beforeXp = reloaded.app.save.progress.xp;
    const r = resultOf(state);
    const reward = rebuilt.reward(r);
    const milestone = RUN_MILESTONES.find(m => m.round === 3)!;
    expect(reward.coins).toBeGreaterThan(0);
    expect(runOf(reloaded.app.save)).toMatchObject({ round: 3, inMatch: false, milestones: [3] });
    expect(reloaded.app.save.coins - beforeCoins).toBe(milestone.coins);
    expect(reloaded.app.save.progress.xp - beforeXp).toBe(milestone.xp);
    const saved = JSON.stringify(reloaded.app.save);
    expect(rebuilt.reward(r).coins).toBe(0);
    expect(JSON.stringify(reloaded.app.save)).toBe(saved);
    expect(friendlyReward).not.toHaveBeenCalled();
    const runCoins = runOf(reloaded.app.save).coins;
    const runXp = runOf(reloaded.app.save).xp;
    addXp(reloaded.app.save, 100); // Main banks the match XP after the milestone reward and before onBanked.
    reloaded.app.save.coins += reward.coins;
    expect(rebuilt.onBanked).toBeTypeOf('function');
    rebuilt.onBanked!(r, reward.coins);
    expect(runOf(reloaded.app.save).coins).toBe(runCoins + reward.coins);
    expect(runOf(reloaded.app.save).xp).toBe(runXp + 20);
    expect(reloaded.app.save.progress.xp).toBe(beforeXp + milestone.xp + 120);
    expect(reloaded.app.mainMenu).not.toHaveBeenCalled();
    let persisted = '';
    vi.mocked(reloaded.app.persist).mockClear();
    vi.mocked(reloaded.app.persist).mockImplementation(() => { persisted = JSON.stringify(reloaded.app.save); });
    reloaded.app.persist();
    const paidReload = importSave(persisted)!;
    expect(runOf(paidReload).coins).toBe(runCoins + reward.coins);
    expect(runOf(paidReload).xp).toBe(runXp + 20);
    expect(paidReload.progress.xp).toBe(beforeXp + milestone.xp + 120);
    const once = JSON.stringify(reloaded.app.save);
    rebuilt.onBanked!(r, reward.coins);
    expect(JSON.stringify(reloaded.app.save)).toBe(once);

    reloaded.app.save.coins += reward.coins; // A rewarded double calls the hook with the new cumulative amount.
    rebuilt.onBanked!(r, reward.coins * 2);
    expect(runOf(reloaded.app.save).coins).toBe(runCoins + reward.coins * 2);
    expect(runOf(reloaded.app.save).xp).toBe(runXp + 20);
    expect(reloaded.app.save.progress.xp).toBe(paidReload.progress.xp);
    const twice = JSON.stringify(reloaded.app.save);
    rebuilt.onBanked!(r, reward.coins * 2);
    expect(JSON.stringify(reloaded.app.save)).toBe(twice);
    reloaded.app.persist();
    expect(runOf(importSave(persisted)!).coins).toBe(runCoins + reward.coins * 2);

    vi.mocked(reloaded.app.persist).mockClear();
    expect(() => rebuilt.onDone(r, reward.coins)).toThrow('navigation reached');
    expect(JSON.stringify(reloaded.app.save)).toBe(twice);
    expect(reloaded.app.persist).toHaveBeenCalledOnce();
    expect(rebuildRecoveryRequest(reloaded.app, reloaded.pending, friendlyReward)).toBeNull();
  });

  it('rejects a Club Run snapshot after another run seed replaces it and after its result has been paid', () => {
    const source = appRig();
    const run = runOf(source.app.save);
    expect(startRun(run, { seed: 173, club: 5, difficulty: 1 })).toBe(true);
    run.inMatch = true;
    const state = requestPending(source.app, resumeRunRequest(source.app)!);
    const reloaded = reloadPending(source.app, state);
    runOf(reloaded.app.save).seed++;
    expect(rebuildRecoveryRequest(reloaded.app, reloaded.pending, vi.fn())).toBeNull();
    reloaded.app.save.record.played++;
    expect(new MatchRecoveryStore(reloaded.storage).read(reloaded.app.save.record.played, reloaded.app.save.progress.xp)).toBeNull();
  });

  it('rejects a basics snapshot when progress XP shows its completion was already saved', () => {
    const storage = new MemoryStore();
    const state = pending(rig());
    state.route = 'basics';
    state.progressXp = 10;
    expect(new MatchRecoveryStore(storage).write(state)).toBe(true);
    expect(new MatchRecoveryStore(storage).read(4, 10)).not.toBeNull();
    expect(new MatchRecoveryStore(storage).read(4, 40)).toBeNull();
  });
});
