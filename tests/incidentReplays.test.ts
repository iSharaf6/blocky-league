import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Input, setBindings } from '../src/core/input';
import { FoulPresentation } from '../src/game/foulPresentation';
import { DEAD_HOLD_S, IncidentReplays, type IncidentReplay } from '../src/game/incidentReplay';
import { MatchSession } from '../src/game/matchSession';
import { MatchTally } from '../src/game/ratings';
import { BALL_OFS, FRAME_LEN, PF, ReplayBuffer, STATE_CODE, writeFrame } from '../src/game/replay';
import { encodeState } from '../src/game/stateCodec';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT, HALF_L, HALF_W, PEN_SPOT } from '../src/sim/constants';
import { EMPTY_PAD, Match, type Pad } from '../src/sim/match';
import type { Player } from '../src/sim/player';
import type { KickKind, MatchEvent } from '../src/sim/types';

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }));
  vi.stubGlobal('navigator', {});
  setBindings();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function newMatch(seed = 27): Match {
  const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]),
    halfLength: 150, difficulty: 1.8, humanSide: 0, seed });
  Object.assign(m, { phase: 'play', phaseT: 0, restart: null, clock: 30 });
  m.drainEvents();
  return m;
}

function place(p: Player, x: number, z: number): void {
  Object.assign(p.pos, { x, z });
  p.vel.x = p.vel.z = 0;
  p.setState('move');
  p.order = null;
}

function spreadPlayers(m: Match): void {
  m.players.forEach((p, i) => place(p, -40 + i * 3.6, -HALF_W + 1.5));
}

/** Real match/input/footage/transition code; only GPU, audio and HUD endpoints are doubled. */
function rig(m = newMatch()) {
  const input = new Input();
  input.lastDevice = 'touch';
  input.touch.enabled = true;
  const buffer = new ReplayBuffer(600);
  const incidentReplay = new IncidentReplays();
  const frame = new Float32Array(FRAME_LEN);
  writeFrame(m, frame, 0);
  const hud = {
    commentary: vi.fn(), card: vi.fn(), show: vi.fn(), toastMsg: vi.fn(), setCinematic: vi.fn(),
    setSkippable: vi.fn(), setReplay: vi.fn(), hideIntro: vi.fn(), setScore: vi.fn(), setClock: vi.fn(), showAddedBoard: vi.fn(),
  };
  const refState = { x: -15, z: 3, faceX: -13.3, faceZ: 3 };
  const view = {
    frameHook: null as ((f: Float32Array, dt: number) => void) | null,
    frame, headTop: 1.9, refState, ballGlide: { x: 0, y: 0, z: 0 },
    apply: vi.fn((_prev: Float32Array, cur: Float32Array, _alpha = 0, _time = 0, _dt = 0) => frame.set(cur)),
    tickFlashes: vi.fn(), flashPlayer: vi.fn(), refSignal: vi.fn(), refPoint: vi.fn(), clearFades: vi.fn(), pinPlayer: vi.fn(),
    setBallHidden: vi.fn(), setMarkerMode: vi.fn(), setMarkerVisible: vi.fn(), setTeamRings: vi.fn(), setTeamPips: vi.fn(),
    setShadowBudget: vi.fn(), faceCamera: vi.fn(), updateReferee: vi.fn(), setRival: vi.fn(), replacePlayer: vi.fn(),
    flashBall: vi.fn(), celeb: { active: false, begin: vi.fn(), end: vi.fn(), holdS: 0 },
    showCard: vi.fn((_color: string, x: number, z: number) => { refState.faceX = x; refState.faceZ = z; }),
    incidentMarks: { offside: vi.fn(), foul: vi.fn(), clear: vi.fn(), update: vi.fn() },
  };
  const cam = {
    mode: 'broadcast', behindActive: false, holding: false, focusX: 0, focusZ: 0,
    screenToWorld: (x: number, z: number) => ({ x, z }),
    update: vi.fn(), shakePx: vi.fn(), kick: vi.fn(), softCut: vi.fn(), cut: vi.fn(),
    cardLens: () => ({ x: -20, z: 12 }),
    setMode: vi.fn((mode: string) => { cam.mode = mode; }),
    replayKind: 'goal', replayShot: 'build', replayGoalSign: 1, replayActors: [] as number[],
    replayLens: null as { x: number; y: number; z: number; fov: number } | null,
  };
  const session = Object.assign(Object.create(MatchSession.prototype), {
    match: m, input, buffer, incidentReplays: incidentReplay, hud, view, cam, demo: false, driver: null, paused: false,
    opt: { kits: [m.teams[0].kit, m.teams[1].kit], celebration: 'classic' }, tally: new MatchTally(),
    lastPasser: [-1, -1], wearing: m.players.map(p => p.def), subQueue: [], subCut: null,
    moment: null, replay: null, replayIncident: null, replayDone: false, replayWanted: false,
    replayT: 0, introLeft: 0, lineupLeft: 0, holdFirst: false, interlude: null, motm: null,
    acc: 0, time: 0, hitStopT: 0, cardT: 0, cineHud: false, recorded: 0, prevButtons: false, eatButtons: false,
    prev: frame.slice(), cur: frame.slice(), focusOut: {}, cardFocus: {},
    lunge: new Float32Array(22).fill(-1), lungeLeg: new Float32Array(22), tryAt: new Float64Array(22).fill(-100),
    latch: { pass: false, shoot: false, through: false, power: false, skill: false },
    holdKick: null, foulOn: -1, foulAt: { x: 0, z: 0 }, foulBy: { x: 0, z: 0 },
    foulPresentation: new FoulPresentation(), ownerBefore: -1, activeBefore: m.activeOf(0),
    world: { quality: 'high', camera: {}, focusShadows: vi.fn() },
    stadium: { setArchVisible: vi.fn(), updateGlare: vi.fn(), update: vi.fn(), setScore: vi.fn(),
      punchNet: vi.fn(), flashBurst: vi.fn() },
    effects: { dust: vi.fn(), grass: vi.fn(), update: vi.fn(), clear: vi.fn(), burst: vi.fn(), confetti: vi.fn(), chunks: vi.fn() },
    fxKit: { update: vi.fn(), clear: vi.fn() },
    weather: { kind: 'clear', update: vi.fn() }, flash: { update: vi.fn(), play: vi.fn() },
    clips: { update: vi.fn(), stop: vi.fn(), recording: false }, clipName: '', clipLive: false,
    present: null, ghost: null, fun: null,
    holdLesson: () => false, updateFrameFx: vi.fn(), updateBlitz: vi.fn(), updateFades: vi.fn(),
    updateAtmosphere: vi.fn(), updateHud: vi.fn(), updateGhost: vi.fn(), updateScene: vi.fn(),
    updateQuickSub: vi.fn(), subCutReady: () => false, startMatchInterlude: () => false,
    celebNear: [], goalWideS: 0.6, celebDue: -1, megaShotT: -100, goldenGoalArmed: false,
    kickLogI: 0, kickLogT: new Float64Array(24).fill(-Infinity), kickLogS: new Array(24).fill('strike'),
    kickLogMine: new Uint8Array(24),
    tut: { passed: false, shot: false, chip: false },
  }) as MatchSession;
  const state = session as unknown as {
    recorded: number; time: number; cur: Float32Array; prev: Float32Array;
    replay: Float32Array[] | null; replayIncident: IncidentReplay | null; replayT: number;
    replayDone: boolean; anyPress: boolean; eatButtons: boolean; cardT: number; hitStopT: number;
    incidentFroze: boolean; incidentFreezeT: number;
    handleEvents(events: MatchEvent[]): void; stepReplay(dt: number): void; buildPad(): Pad;
    incidentReplayHold(dt: number): boolean;
  };
  const record = (count = 1, move?: (i: number) => void) => {
    for (let i = 0; i < count; i++) {
      move?.(i);
      buffer.push(m, state.time);
      state.recorded++;
      state.time += DT;
    }
    writeFrame(m, state.cur, state.time);
    state.prev.set(state.cur);
    frame.set(state.cur);
  };
  const step = (pad: Pad = EMPTY_PAD) => {
    const before = { phase: m.phase, restart: m.restart, kickId: m.kickId, shootoutStage: m.shootout?.stage };
    m.step(DT, pad);
    const events = m.drainEvents();
    state.handleEvents(events);
    record();
    incidentReplay.observe(events, m, buffer, state.recorded, before);
    return events;
  };
  return { m, input, buffer, incidentReplay, session, state, hud, view, cam, record, step };
}

/** A real bad slide, including the real referee RNG, restart and optional second yellow. */
function foulRig(card: 'none' | 'yellow' | 'red', penalty = false, advantage = false) {
  for (let seed = 1; seed <= 30; seed++) {
    const m = newMatch(seed);
    const h = rig(m);
    spreadPlayers(m);
    const on = m.players[9], by = m.players[17];
    const x = penalty ? 40 : advantage ? 20 : -12;
    place(on, x, 3);
    on.facing = 0;
    on.vel.x = 4;
    m.ball.reset(on.footX(), on.footZ());
    m.ball.owner = on.idx;
    m.ball.lastTouch = on.idx;
    m.ball.lastTouchSide = on.side;
    m.updateBallPath();
    place(by, x - 1.3, 3);
    by.facing = 0;
    by.vel.x = 6;
    if (card === 'red') m.booked.add(by.idx);
    h.record(150, i => { by.pos.x = x - 6 + i * 4.7 / 150; });
    m.startSlide(by);
    by.slideFoul = true;
    h.record();
    const events: MatchEvent[] = [];
    for (let i = 0; i < 60 && !events.some(e => e.type === 'foul'); i++) events.push(...h.step());
    // A whistled foul plays on through its dead-ball beat (the fall is live and on tape) before the recap holds it.
    if (!advantage) for (let i = 0; i < 90 && !h.incidentReplay.waiting(m); i++) events.push(...h.step());
    const got = events.find(e => e.type === 'card');
    if (events.some(e => e.type === 'foul') &&
      (card === 'none' ? !got : got?.type === 'card' && got.color === card)) return { ...h, on, by, events };
  }
  throw new Error(`Real slide fixture did not produce a ${card} foul`);
}

function offsideRig(mode?: 'demo' | 'driver' | 'moment', delayedTouchFrames = 0, kind: KickKind = 'pass') {
  const h = rig(newMatch(1));
  spreadPlayers(h.m);
  const passer = h.m.players[kind === 'keeper' ? 0 : 6], attacker = h.m.players[9];
  place(passer, HALF_L - 30, 0);
  passer.facing = 0;
  h.m.teamPlayers(1).forEach((p, i) => {
    if (!p.isKeeper) place(p, -10, -HALF_W + 2 + i * 1.5);
  });
  place(h.m.players[13], HALF_L - 16, -14);
  place(h.m.players[14], HALF_L - 16, 14);
  place(h.m.keeperOf(1)!, HALF_L - 0.8, 0);
  place(attacker, HALF_L - 12, 0.5);
  h.m.ball.reset(passer.footX(), passer.footZ());
  h.m.ball.owner = passer.idx;
  h.m.ball.lastTouch = passer.idx;
  h.m.ball.lastTouchSide = passer.side;
  h.m.ball.held = kind === 'keeper';
  h.m.updateBallPath();
  h.record(90);
  h.m.order(passer, kind, attacker.pos.x - passer.pos.x, attacker.pos.z - passer.pos.z, 0.6, attacker.idx, false);
  const events: MatchEvent[] = [];
  let releaseStamp: number | undefined;
  if (mode) {
    Object.assign(h.session, mode === 'demo' ? { demo: true } : mode === 'driver' ? {
      driver: { frame: () => {}, next: () => [EMPTY_PAD, EMPTY_PAD], after: () => {}, pace: () => 1 },
    } : { moment: { briefT: 0, spec: {}, outcome: null, endT: -1, count: -1 }, judgeMoment: vi.fn() });
    for (let i = 0; i < 240 && !h.m.stats.offsides[0]; i++) h.session.update(DT);
    expect(h.m.stats.offsides[0]).toBe(1);
  } else {
    if (delayedTouchFrames) {
      for (let i = 0; !events.some(e => e.type === 'kick') && i < 60; i++) events.push(...h.step());
      expect(events.some(e => e.type === 'kick' && e.kind === 'pass')).toBe(true);
      const release = h.buffer.get(h.buffer.count - 1);
      releaseStamp = release[BALL_OFS + 9];
      const startX = release[BALL_OFS];
      // Controlled replay footage separates release and involvement by 4.5s. The kick and offside
      // witness are real; the helper must retain that actual release rather than a generic 3s tail.
      h.record(delayedTouchFrames, i => Object.assign(h.m.ball.pos, {
        x: startX + (attacker.pos.x - startX) * i / delayedTouchFrames,
        y: 0.5 + Math.sin(i / delayedTouchFrames * Math.PI) * 4, z: 0.5,
      }));
      const before = { phase: h.m.phase, restart: h.m.restart, kickId: h.m.kickId };
      expect((h.m as unknown as { offsideTouch(p: Player): boolean }).offsideTouch(attacker)).toBe(true);
      const verdict = h.m.drainEvents();
      events.push(...verdict);
      h.state.handleEvents(verdict);
      h.record();
      h.incidentReplay.observe(verdict, h.m, h.buffer, h.state.recorded, before);
    }
    for (let i = 0; i < 240 && !events.some(e => e.type === 'offside'); i++) events.push(...h.step());
    expect(events.some(e => e.type === 'offside')).toBe(true);
  }
  return { ...h, events, attacker, passer, releaseStamp };
}

function openReplay(h: ReturnType<typeof rig>): void {
  for (let i = 0; !h.state.replay && i < 240; i++) h.session.update(DT);
  expect(h.state.replay?.length).toBeGreaterThan(2);
}

function finishReplay(h: ReturnType<typeof rig>, skip = false): void {
  if (skip) { h.state.anyPress = true; h.input.touch.pass = true; }
  for (let i = 0; h.state.replay && i < 900; i++) h.state.stepReplay(DT);
  expect(h.state.replay).toBeNull();
}

function football(m: Match): string { return JSON.stringify(encodeState(m)); }

/** Actual run-up, strike, flight and shootout judge; deterministic targets cover each outcome. */
function shootoutRig(how: 'goal' | 'saved' | 'wide') {
  for (let seed = 1; seed <= 20; seed++) {
    const m = newMatch(seed);
    (m as unknown as { startShootout(): void }).startShootout();
    m.shootout!.stage = 'aim';
    m.shootout!.t = 0.4;
    m.drainEvents();
    const h = rig(m);
    h.record(90);
    const taker = m.players[m.shootout!.taker];
    (m as unknown as { shootoutKick(p: Player, aim: { z: number; h: number; power: number; placed: boolean }): void })
      .shootoutKick(taker, { z: how === 'wide' ? 8 : how === 'goal' ? 2.8 : 0, h: 1, power: 0.7, placed: true });
    const events: MatchEvent[] = [];
    for (let i = 0; i < 300 && !events.some(e => e.type === 'shootoutKick'); i++) events.push(...h.step());
    // The judged kick is seen to its end (net, gloves, crowd) before its recap holds the result.
    for (let i = 0; i < 90 && !h.incidentReplay.waiting(m); i++) events.push(...h.step());
    if (m.shootout!.last?.how === how) return { ...h, events, taker };
  }
  throw new Error(`Actual penalty flight did not produce ${how}`);
}

function penaltyRig(how: 'goal' | 'saved' | 'wide') {
  for (let seed = 1; seed <= 20; seed++) {
    const m = newMatch(seed);
    (m as unknown as { goOut(kind: string, side: number, x: number, z: number): void })
      .goOut('penalty', 0, HALF_L - PEN_SPOT, 0);
    m.drainEvents();
    const h = rig(m);
    for (let i = 0; m.phase !== 'restart' && i < 600; i++) h.step();
    expect(m.phase).toBe('restart');
    const taker = m.restart!.taker;
    for (let i = 0; i < 60; i++) h.step({ ...EMPTY_PAD, digital: true, mz: how === 'saved' ? 0 : 1 });
    const gauss = how === 'wide' ? vi.spyOn(m.rng, 'gauss').mockReturnValue(8) : null;
    for (let i = 0; i < 15; i++) h.step({ ...EMPTY_PAD, digital: true, shoot: true });
    h.step({ ...EMPTY_PAD, digital: true });
    const events: MatchEvent[] = [];
    for (let i = 0; m.phase !== 'goal' && !h.incidentReplay.waiting(m) && i < 300; i++) events.push(...h.step());
    gauss?.mockRestore();
    const clip = h.incidentReplay.take(m);
    if (how === 'goal' ? m.phase === 'goal' : clip?.label.includes(how === 'saved' ? 'SAVED' : 'MISSED')) {
      if (clip) (h.state as unknown as { startIncidentReplay(clip: IncidentReplay): void }).startIncidentReplay(clip);
      return { ...h, events, taker };
    }
  }
  throw new Error(`Actual in-match penalty did not produce ${how}`);
}

describe('incident replays', () => {
  it('captures the real offside pass and keeps its exact indirect restart ready after natural playback', () => {
    const h = offsideRig();
    expect(h.events.filter(e => ['offside', 'whistle', 'restart'].includes(e.type)).map(e => e.type))
      .toEqual(['offside', 'whistle', 'restart']);
    const restart = h.m.restart!;
    expect(restart.indirect).toBe(true);
    const original = football(h.m);
    openReplay(h);
    expect(h.state.replayIncident?.kind).toBe('offside');
    expect(h.state.replay![0][BALL_OFS]).toBeLessThan(h.state.replay!.at(-1)![BALL_OFS] - 10);
    expect(h.state.replay!.some(f => f[h.passer.idx * PF + 4] === STATE_CODE.kick)).toBe(true);
    expect(h.cam.mode).toBe('replay');
    expect(h.cam.replayKind).toBe('incident');
    finishReplay(h);
    expect(football(h.m)).toBe(original);
    expect(h.m.restart).toBe(restart);
    expect(h.cam.mode).toBe('broadcast');
    expect(h.hud.setReplay).toHaveBeenLastCalledWith(false);
    expect(h.state.replayDone).toBe(false);
    expect(h.view.frame).toEqual(h.state.cur);
  });

  it.each(['none', 'yellow', 'red'] as const)('replays one real %s foul after the contact/card scene, with the tackle in its footage', card => {
    const h = foulRig(card);
    const original = football(h.m);
    const restart = h.m.restart!;
    openReplay(h);
    expect(h.state.replayIncident?.kind).toBe(card === 'none' ? 'foul' : card === 'red' ? 'red' : 'yellow');
    expect(h.state.replay!.some(f => f[h.by.idx * PF + 4] === STATE_CODE.slide)).toBe(true);
    if (card !== 'none') expect(h.view.showCard).toHaveBeenCalledTimes(1);
    expect(h.m.players[h.by.idx].sentOff).toBe(card === 'red');
    finishReplay(h, true);
    expect(football(h.m)).toBe(original);
    expect(h.m.restart).toBe(restart);
    expect(h.incidentReplay.waiting(h.m)).toBe(false);
    expect(h.state.buildPad().pass).toBe(false);
    h.input.touch.pass = false;
    h.state.buildPad();
    h.input.touch.pass = true;
    expect(h.state.buildPad().pass).toBe(true);
  });

  it('combines a booked penalty foul into one penalty-award replay without playing duplicate foul/card clips', () => {
    const h = foulRig('yellow', true);
    expect(h.m.restart?.kind).toBe('penalty');
    openReplay(h);
    expect(h.state.replayIncident?.kind).toBe('yellow');
    expect(h.state.replayIncident?.label).toContain('PENALTY');
    expect(h.view.showCard).toHaveBeenCalledTimes(1);
    const original = football(h.m);
    finishReplay(h);
    expect(football(h.m)).toBe(original);
    expect(h.m.stats.shots[0]).toBe(0);
    expect(h.incidentReplay.waiting(h.m)).toBe(false);
    for (let i = 0; i < 15; i++) h.session.update(DT);
    expect(h.state.replay).toBeNull();
    expect(h.hud.setReplay.mock.calls.filter(([on]) => on)).toHaveLength(1);
  });

  it('keeps advantage live and retains the original contact through a delayed whistle-back', () => {
    const h = foulRig('none', false, true);
    expect(h.m.phase).toBe('play');
    expect(h.events.some(e => e.type === 'restart')).toBe(false);
    // (Its clip is cut once the aftermath is on tape, not on the contact frame.)
    expect(h.incidentReplay.pending).toBe(0);
    expect(h.incidentReplay.waiting(h.m)).toBe(false);
    expect(h.incidentReplay.take(h.m)).toBeNull();
    // Keep the exposed ball away from both sides while the referee actually waits for advantage.
    h.m.ball.owner = -1;
    Object.assign(h.m.ball.pos, { x: 5, y: 0.2, z: 10 });
    Object.assign(h.m.ball.vel, { x: 0, y: 0, z: 0 });
    h.m.updateBallPath();
    while (h.state.hitStopT > 1e-4) h.session.update(DT);
    const clock = h.m.clock;
    h.session.update(DT);
    expect(h.m.clock).toBeGreaterThan(clock);
    expect(h.state.replay).toBeNull();
    for (let i = 0; h.m.phase === 'play' && i < 120; i++) h.step();
    expect(h.m.restart?.kind).toBe('freekick');
    expect(h.m.restart?.x).toBeGreaterThan(17);
    openReplay(h);
    // The action comes from the contact at x=20, before the ball was moved for the advantage wait.
    const clip = h.state.replayIncident!;
    const contact = h.state.replay![clip.actionIdx];
    expect(contact[BALL_OFS]).toBeGreaterThan(17);
    expect(contact[h.on.idx * PF]).toBeGreaterThan(17);
    expect(h.state.replay!.length - 1 - clip.actionIdx).toBeGreaterThanOrEqual(48);
    finishReplay(h);
    expect(h.incidentReplay.pending).toBe(0);
  });

  it('waits for an actual dead ball after granted advantage rather than cutting away from possession', () => {
    const h = foulRig('none', false, true);
    const mate = h.m.players[10];
    place(mate, 25, 8);
    h.m.ball.reset(mate.footX(), mate.footZ());
    h.m.ball.owner = mate.idx;
    h.m.ball.lastTouch = mate.idx;
    h.m.ball.lastTouchSide = mate.side;
    h.m.updateBallPath();
    const events = h.step();
    expect(events.some(e => e.type === 'advantage')).toBe(true);
    expect(h.m.phase).toBe('play');
    expect(h.incidentReplay.waiting(h.m)).toBe(false);
    while (h.state.hitStopT > 1e-4) h.session.update(DT);
    const clock = h.m.clock;
    h.session.update(DT);
    expect(h.m.clock).toBeGreaterThan(clock);
    expect(h.state.replay).toBeNull();
  });

  it('ignores an already-held action, then consumes a fresh keeper/skill skip before the restart', () => {
    const h = offsideRig();
    h.input.touch.skill = true;
    openReplay(h);
    const original = football(h.m);
    for (let i = 0; i < 12; i++) h.state.stepReplay(DT);
    expect(h.state.replay).not.toBeNull();
    h.input.touch.skill = false;
    h.state.stepReplay(DT);
    h.input.touch.skill = true;
    h.state.stepReplay(DT);
    expect(h.state.replay).toBeNull();
    expect(h.state.buildPad().skill).toBe(false);
    expect(football(h.m)).toBe(original);
  });

  it.each([0, 1])('does not enter an empty replay or trap a dead ball with only %i recorded frames', count => {
    const h = rig();
    h.record(count);
    (h.m as unknown as { goOut(kind: string, side: number, x: number, z: number): void })
      .goOut('penalty', 0, HALF_L - PEN_SPOT, 0);
    const events = h.m.drainEvents();
    h.state.handleEvents(events);
    h.incidentReplay.observe(events, h.m, h.buffer, 0, { phase: 'play', restart: null, kickId: h.m.kickId });
    expect(h.incidentReplay.pending).toBe(0);
    const phaseT = h.m.phaseT;
    expect(() => h.session.update(DT)).not.toThrow();
    expect(h.m.phaseT).toBeGreaterThan(phaseT);
    expect(h.state.replay).toBeNull();
  });

  it('restores the exact saved stoppage during an incident replay and discards transient historical footage', () => {
    const h = offsideRig();
    openReplay(h);
    const original = football(h.m);
    const checkpoint = JSON.parse(JSON.stringify(h.session.checkpoint()));
    h.state.stepReplay(0.3);
    expect(h.state.replay).not.toBeNull();
    h.session.restoreCheckpoint(checkpoint);
    expect(h.hud.setScore).toHaveBeenLastCalledWith(h.m.score[0], h.m.score[1], false);
    expect(h.hud.setClock).toHaveBeenCalledOnce();
    expect(football(h.m)).toBe(original);
    expect(h.state.replay).toBeNull();
    expect(h.state.replayIncident).toBeNull();
    expect(h.incidentReplay.pending).toBe(0);
    expect(h.cam.mode).toBe('broadcast');
    expect(h.hud.setReplay).toHaveBeenLastCalledWith(false);
    expect(h.state.eatButtons).toBe(true);
    h.session.update(DT);
    expect(h.state.replay).toBeNull();
  });

  it.each(['goal', 'saved', 'wide'] as const)('replays the actual %s shootout penalty and resumes the same result exactly once', how => {
    const h = shootoutRig(how);
    expect(h.events.some(e => e.type === 'kick' && e.kind === 'shot')).toBe(true);
    expect(h.events.some(e => e.type === 'shootoutKick' && e.scored === (how === 'goal'))).toBe(true);
    const original = football(h.m);
    const kicks = h.m.shootout!.kicks.map(k => [...k]);
    openReplay(h);
    expect(h.state.replayIncident?.kind).toBe('penalty-result');
    expect(h.state.replayIncident?.label).toContain(how === 'goal' ? 'SCORED' : how === 'saved' ? 'SAVED' : 'MISSED');
    expect(h.state.replay!.some(f => f[h.taker.idx * PF + 4] === STATE_CODE.kick)).toBe(true);
    expect(h.state.replay!.some(f => Math.abs(f[BALL_OFS + 3]) > 10)).toBe(true);
    finishReplay(h, true);
    expect(football(h.m)).toBe(original);
    expect(h.m.shootout!.kicks).toEqual(kicks);
    expect(h.m.shootout!.stage).toBe('result');
    expect(h.cam.mode).toBe('penalty');
    expect(h.incidentReplay.pending).toBe(0);
    expect(h.state.buildPad().pass).toBe(false);
  });

  it.each(['saved', 'wide'] as const)('replays the actual %s in-match penalty only after the rebound/possession is settled', how => {
    const h = penaltyRig(how);
    expect(h.state.replayIncident?.kind).toBe('penalty-result');
    expect(h.state.replayIncident?.label).toContain(how === 'saved' ? 'SAVED' : 'MISSED');
    const original = football(h.m);
    expect(h.state.replay!.some(f => f[h.taker * PF + 4] === STATE_CODE.kick)).toBe(true);
    if (how === 'saved') expect(h.events.some(e => e.type === 'save')).toBe(true);
    else expect(h.m.phase === 'out' || h.m.phase === 'restart').toBe(true);
    finishReplay(h);
    expect(football(h.m)).toBe(original);
    expect(h.m.score).toEqual([0, 0]);
    expect(h.incidentReplay.pending).toBe(0);
  });

  it('keeps a scored in-match penalty in the normal goal celebration/replay lifecycle without adding a second recap', () => {
    const h = penaltyRig('goal');
    expect(h.m.score).toEqual([1, 0]);
    expect(h.state.replayIncident).toBeNull();
    expect(h.state.replay).toBeNull();
    expect(h.incidentReplay.pending).toBe(0);
    expect((h.state as unknown as { replayWanted: boolean }).replayWanted).toBe(true);
  });

  it.each(['demo', 'driver', 'moment'] as const)('keeps automatic incident replays out of %s sessions', mode => {
    const h = offsideRig(mode);
    expect(h.incidentReplay.pending).toBe(0);
    expect(h.state.replay).toBeNull();
    expect(h.hud.setReplay.mock.calls.filter(([on]) => on)).toHaveLength(0);
  });

  it('pauses the contact/card/replay sequence and resumes without moving the held football state', () => {
    const h = foulRig('yellow');
    h.session.requestPause();
    const original = football(h.m);
    for (let i = 0; i < 180; i++) h.session.update(DT);
    expect(football(h.m)).toBe(original);
    expect(h.view.showCard).not.toHaveBeenCalled();
    expect(h.state.replay).toBeNull();
    h.session.resume();
    openReplay(h);
    expect(h.view.showCard).toHaveBeenCalledTimes(1);
    h.session.requestPause();
    const replayT = h.state.replayT;
    for (let i = 0; i < 60; i++) h.session.update(DT);
    expect(h.state.replayT).toBe(replayT);
    expect(football(h.m)).toBe(original);
    h.session.resume();
    finishReplay(h);
    expect(football(h.m)).toBe(original);
  });

  it('retains the actual pass release and flagged receiver pose when involvement arrives 4.5 seconds later', () => {
    const h = offsideRig(undefined, 270);
    openReplay(h);
    const frames = h.state.replay!;
    expect(frames.length).toBeGreaterThan(270);
    const release = frames.find(f => f[BALL_OFS + 9] === h.releaseStamp);
    expect(release).toBeDefined();
    expect(release![h.passer.idx * PF + 4]).toBe(STATE_CODE.kick);
    expect(release![h.attacker.idx * PF]).toBeGreaterThan(HALF_L - 16);
    expect(h.cam.replayActors).toContain(h.passer.idx);
    expect(h.cam.replayActors).toContain(h.attacker.idx);
    expect(frames.at(-1)![BALL_OFS + 9] - release![BALL_OFS + 9]).toBeGreaterThan(4.4);
    const releaseIdx = h.state.replayIncident!.releaseIdx!;
    expect(frames[releaseIdx][BALL_OFS + 9]).toBe(h.releaseStamp);
    // The line is the sim's own, read off the release frame: the second-last defender, 16 m from his goal line.
    const line = h.state.replayIncident!.offside!;
    expect(line.attacker).toBe(h.attacker.idx);
    expect([13, 14]).toContain(line.defender);
    expect(line.lineX).toBeCloseTo(frames[releaseIdx][line.defender * PF], 4);
    expect(Math.abs(line.lineX - (HALF_L - 16))).toBeLessThan(1);
    expect(frames[releaseIdx][h.attacker.idx * PF]).toBeGreaterThan(line.lineX);
    expect(h.state.replayIncident!.caption).toMatch(/^OFFSIDE \d+ /);
    // The picture stops on the pass with the lens brought in line with the line, then runs on at match speed.
    h.state.replayT = releaseIdx / 60;
    h.state.stepReplay(DT);
    expect(h.state.replayT).toBe(releaseIdx / 60);
    expect(h.cam.replayLens?.x).toBeCloseTo(line.lineX, 3);
    for (let i = 0; i < 60; i++) h.state.stepReplay(DT);
    expect(h.state.replayT).toBe(releaseIdx / 60);
    for (let i = 0; i < 40; i++) h.state.stepReplay(DT);
    expect(h.cam.replayLens).toBeNull();
    const t = h.state.replayT;
    expect(t).toBeGreaterThan(releaseIdx / 60);
    h.state.stepReplay(DT);
    expect(h.state.replayT - t).toBeCloseTo(DT, 9);
  });

  it.each(['header', 'keeper'] as const)('shows the release line for an actual offside from a passing %s', kind => {
    const h = offsideRig(undefined, 0, kind);
    expect(h.events.some(e => e.type === 'kick' && e.kind === kind)).toBe(true);
    const original = football(h.m);
    openReplay(h);
    const clip = h.state.replayIncident!;
    expect(clip.offside?.attacker).toBe(h.attacker.idx);
    expect(clip.releaseIdx).toBeGreaterThanOrEqual(0);
    expect(clip.frames[clip.releaseIdx!][h.passer.idx * PF + 4]).toBe(kind === 'keeper' ? STATE_CODE.throw : STATE_CODE.kick);
    finishReplay(h);
    expect(football(h.m)).toBe(original);
  });

  it('retains the original release after the live ring rolls over, and holds its line even at the end of footage', () => {
    const h = offsideRig(undefined, 720);
    const original = football(h.m);
    const restart = h.m.restart;
    openReplay(h);
    const clip = h.state.replayIncident!;
    expect(clip.frames.length).toBeLessThanOrEqual(61);
    expect(clip.releaseIdx).toBe(clip.frames.length - 1);
    expect(clip.frames[clip.releaseIdx!][BALL_OFS + 9]).toBe(h.releaseStamp);
    expect(clip.offside?.lineX).toBeCloseTo(HALF_L - 16, 0);
    h.state.replayT = clip.releaseIdx! / 60;
    for (let i = 0; i < 60; i++) h.state.stepReplay(DT);
    expect(h.state.replay).not.toBeNull();
    expect(h.view.incidentMarks.offside).toHaveBeenCalledTimes(1);
    const [a, b] = h.view.apply.mock.lastCall!;
    expect(a).toBe(clip.frames[clip.releaseIdx!]);
    expect(b).toBe(a);
    finishReplay(h);
    expect(football(h.m)).toBe(original);
    expect(h.m.restart).toBe(restart);
  });

  it.each([{ cadence: [1 / 30] }, { cadence: [1 / 60] }, { cadence: [1 / 120] }, { cadence: [0.011, 0.049, 0.022] }])('holds one exact release pose without rewinding at render cadence $cadence', ({ cadence }) => {
    const h = offsideRig();
    const original = football(h.m);
    openReplay(h);
    const clip = h.state.replayIncident!;
    const release = clip.releaseIdx! / 60;
    const begin = release - 0.023;
    h.state.replayT = begin;
    h.cam.cut.mockClear();
    let elapsed = 0, n = 0, frozenFrames = 0;
    while (elapsed < 1.65 - 1e-9) {
      const dt = Math.min(cadence[n++ % cadence.length], 1.65 - elapsed);
      const before = h.state.replayT;
      h.state.stepReplay(dt);
      elapsed += dt;
      expect(h.state.replayT + 1e-9).toBeGreaterThanOrEqual(before);
      if (h.state.incidentFreezeT > 0) {
        frozenFrames++;
        expect(h.state.replayT).toBeCloseTo(release, 9);
        expect(h.cam.replayLens).not.toBeNull();
        expect(h.view.incidentMarks.foul).not.toHaveBeenCalled();
        const [a, b, alpha, drawTime, poseDt] = h.view.apply.mock.lastCall!;
        expect(a).toBe(clip.frames[clip.releaseIdx!]);
        expect(b).toBe(a);
        expect(alpha).toBe(0);
        expect(drawTime).toBe(a[BALL_OFS + 9]);
        expect(poseDt).toBe(0);
      }
    }
    expect(frozenFrames).toBeGreaterThan(10);
    expect(h.state.replayT).toBeCloseTo(begin + elapsed - 1.5, 9);
    expect(h.view.incidentMarks.offside).toHaveBeenCalledTimes(1);
    expect(h.view.incidentMarks.foul).toHaveBeenCalledTimes(1);
    expect(h.cam.cut).toHaveBeenCalledTimes(2);
    expect(h.cam.replayLens).toBeNull();
    expect(football(h.m)).toBe(original);
    finishReplay(h);
    expect(football(h.m)).toBe(original);
  });

  it('clears a live first-touch draw offset before replaying the recorded ball', () => {
    const h = offsideRig();
    Object.assign(h.view.ballGlide, { x: -1.2, y: 0.3, z: 0.4 });
    openReplay(h);
    expect(h.view.ballGlide).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('uses the next actual pass as the witness for another offside instead of replaying an unrelated older release', () => {
    const h = offsideRig(undefined, 270);
    openReplay(h);
    finishReplay(h);
    const olderStamp = h.releaseStamp!;
    Object.assign(h.m, { phase: 'play', phaseT: 0, restart: null });
    place(h.passer, HALF_L - 30, 0);
    place(h.attacker, HALF_L - 12, 0.5);
    h.passer.facing = 0;
    h.m.ball.reset(h.passer.footX(), h.passer.footZ());
    h.m.ball.owner = h.passer.idx;
    h.m.ball.lastTouch = h.passer.idx;
    h.m.ball.lastTouchSide = h.passer.side;
    h.m.updateBallPath();
    h.record(90);
    const oldKick = h.m.kickId;
    h.m.order(h.passer, 'pass', h.attacker.pos.x - h.passer.pos.x, h.attacker.pos.z - h.passer.pos.z, 0.6, h.attacker.idx, false);
    for (let i = 0; h.m.kickId === oldKick && i < 60; i++) h.step();
    expect(h.m.kickId).toBe(oldKick + 1);
    const releaseStamp = h.buffer.get(h.buffer.count - 1)[BALL_OFS + 9];
    for (let i = 0; h.m.phase === 'play' && i < 240; i++) h.step();
    expect(h.m.stats.offsides[0]).toBe(2);
    openReplay(h);
    const frames = h.state.replay!;
    expect(frames.some(f => f[BALL_OFS + 9] === releaseStamp)).toBe(true);
    expect(frames.some(f => f[BALL_OFS + 9] === olderStamp)).toBe(false);
  });

  it.each([['none', false], ['yellow', false], ['red', false], ['none', true], ['yellow', true]] as const)(
    'keeps the contact inside a %s foul clip (penalty %s): 1.5 s before it, 0.8 s after it, slowed through it', (card, penalty) => {
      const h = foulRig(card, penalty);
      // The whistle went at once: the match ran on through its dead-ball beat, then held just short of the restart.
      expect(h.m.phase).toBe('out');
      expect(h.m.phaseT).toBeGreaterThanOrEqual(DEAD_HOLD_S);
      expect(h.hud.show).toHaveBeenCalledWith(penalty ? 'PENALTY!' : 'FOUL',
        expect.stringMatching(new RegExp(`^TRIPPED BY ${h.by.def.number} `)), 'small foul', expect.any(Number));
      if (penalty) expect(h.view.refPoint).toHaveBeenCalledWith(expect.any(Number), h.m.restart!.x, h.m.restart!.z);
      openReplay(h);
      const clip = h.state.replayIncident!;
      const frames = h.state.replay!;
      if (penalty) expect(clip.label).toContain('PENALTY');
      expect(clip.caption).toBe(`FOUL BY ${h.by.def.number} ${h.by.def.name.toUpperCase()}`);
      expect([clip.fouler, clip.victim]).toEqual([h.by.idx, h.on.idx]);
      const contact = clip.actionIdx;
      expect(contact).toBeGreaterThanOrEqual(90);
      expect(frames.length - 1 - contact).toBeGreaterThanOrEqual(48);
      // The contact frame itself: the victim goes down on it, having been on his feet the frame before...
      expect(frames[contact][h.on.idx * PF + 4]).toBe(STATE_CODE.fallen);
      expect(frames[contact - 1][h.on.idx * PF + 4]).not.toBe(STATE_CODE.fallen);
      // ...and he is seen on the floor for the whole of the tail, the slide still in the picture at the contact.
      expect(frames[contact + 40][h.on.idx * PF + 4]).toBe(STATE_CODE.fallen);
      expect(frames[contact - 1][h.by.idx * PF + 4]).toBe(STATE_CODE.slide);
      expect(clip.slowFrom).toBeLessThan(contact);
      expect(clip.slowTo).toBeGreaterThan(contact);
      // Played through: slow motion covers the contact, and the clip does not end before it.
      let sawContact = false;
      let slowAtContact = false;
      for (let i = 0; h.state.replay && i < 900; i++) {
        const before = h.state.replayT;
        h.state.stepReplay(DT);
        if (Math.floor(before * 60) === contact) {
          sawContact = true;
          slowAtContact = h.state.replayT - before < DT * 0.6;
        }
      }
      expect(sawContact).toBe(true);
      expect(slowAtContact).toBe(true);
      expect(h.state.replay).toBeNull();
      expect(h.cam.replayLens).toBeNull();
    });

  it('shows a foul live in order: the banner at the whistle, then the card, then the replay, then the same restart', () => {
    const h = foulRig('yellow', true);
    const restart = h.m.restart!;
    const shows = () => h.hud.show.mock.calls.map(c => c[0] as string);
    expect(shows()).toEqual(['PENALTY!']);
    expect(h.view.showCard).not.toHaveBeenCalled();
    // The decision stands alone for its beat: no card over it yet, and no replay.
    for (let i = 0; i < 20; i++) h.session.update(DT);
    expect(h.view.showCard).not.toHaveBeenCalled();
    expect(h.state.replay).toBeNull();
    for (let i = 0; !h.view.showCard.mock.calls.length && i < 120; i++) h.session.update(DT);
    expect(shows()).toEqual(['PENALTY!', 'YELLOW CARD']);
    expect(h.state.replay).toBeNull();
    openReplay(h);
    expect(h.hud.setReplay).toHaveBeenLastCalledWith(true, expect.stringContaining('PENALTY'), expect.stringMatching(/^FOUL BY /));
    finishReplay(h);
    expect(h.m.restart).toBe(restart);
    expect(h.m.phase).toBe('out');
    // No second "PENALTY!" replaced the card or the reason line along the way.
    expect(shows()).toEqual(['PENALTY!', 'YELLOW CARD']);
  });

  it('replays a missed in-match penalty only once the ball is dead, from the run-up to the miss', () => {
    const h = penaltyRig('wide');
    const clip = h.state.replayIncident!;
    const frames = h.state.replay!;
    // Out of play and dead: the hold comes at the end of the dead-ball beat, not as the ball crosses the line.
    expect(h.m.phase).toBe('out');
    expect(h.m.phaseT).toBeGreaterThanOrEqual(DEAD_HOLD_S);
    const strike = frames.findIndex(f => f[h.taker * PF + 4] === STATE_CODE.kick);
    expect(strike).toBeGreaterThanOrEqual(60);
    expect(clip.actionIdx).toBeGreaterThan(strike);
    expect(frames.length - 1 - clip.actionIdx).toBeGreaterThanOrEqual(30);
    expect(clip.caption).toContain('MISSED');
    finishReplay(h);
    // The live ball is kept out of the picture for the last frames before the restart places it.
    expect((h.session as unknown as { ballOutHidden: boolean }).ballOutHidden).toBe(true);
  });

  it('holds a saved in-match penalty in the gloves before its replay', () => {
    const h = penaltyRig('saved');
    const clip = h.state.replayIncident!;
    expect(h.state.replay!.length - 1 - clip.actionIdx).toBeGreaterThanOrEqual(30);
    expect(clip.caption).toMatch(/^SAVED BY \d+ /);
  });
});
