import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Input, setBindings } from '../src/core/input';
import { FoulPresentation } from '../src/game/foulPresentation';
import { MatchSession, PRESENTATION } from '../src/game/matchSession';
import { MatchTally } from '../src/game/ratings';
import { FRAME_LEN, ReplayBuffer, writeFrame } from '../src/game/replay';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT, HALF_L } from '../src/sim/constants';
import { Match, type Pad } from '../src/sim/match';
import type { MatchEvent, Side } from '../src/sim/types';
import { Hud } from '../src/ui/hud';

/** DOM class state only. The skip/replay changes themselves run Hud's real methods. */
function classList() {
  const classes = new Set<string>();
  return {
    contains: (name: string) => classes.has(name),
    remove: (name: string) => { classes.delete(name); },
    toggle: (name: string, on = !classes.has(name)) => {
      if (on) classes.add(name); else classes.delete(name);
      return on;
    },
  };
}

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }));
  vi.stubGlobal('navigator', {});
  setBindings();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** Real match, input, frame buffer and session transitions; only render/recording endpoints are doubled. */
function rig() {
  const match = new Match({ home: makeTeam(PRESET_CLUBS[0]), away: makeTeam(PRESET_CLUBS[1]),
    halfLength: 150, difficulty: 1.8, humanSide: 0, seed: 27 });
  match.drainEvents();
  const input = new Input();
  input.lastDevice = 'touch';
  input.touch.enabled = true;
  const replayClasses = classList();
  const hud = Object.assign(Object.create(Hud.prototype), {
    replay: { classList: replayClasses }, root: { classList: classList() }, cm: { classList: classList() },
    cmLine: null, cmPending: null, show: vi.fn(), setScore: vi.fn(), commentary: vi.fn(),
  }) as Hud;
  const frame = new Float32Array(FRAME_LEN);
  writeFrame(match, frame, 0);
  const view = {
    frame, headTop: 1.9, apply: vi.fn((_prev: Float32Array, cur: Float32Array) => frame.set(cur)),
    replacePlayer: vi.fn(), setMarkerVisible: vi.fn(), flashBall: vi.fn(),
    celeb: { end: vi.fn(), begin: vi.fn(), holdS: 0 },
  };
  const cam = {
    mode: 'broadcast', cut: vi.fn(), shakePx: vi.fn(), kick: vi.fn(),
    setMode: vi.fn((mode: string) => { cam.mode = mode; }),
    screenToWorld: (x: number, z: number) => ({ x, z }),
    replayGoalSign: 1, replayShot: 'build',
  };
  const session = Object.assign(Object.create(MatchSession.prototype), {
    match, input, hud, view, cam, opt: { kits: [match.teams[0].kit, match.teams[1].kit], celebration: 'classic' },
    demo: false, driver: null, paused: false, touch: {}, moment: null, interlude: null,
    time: 0, acc: 0, anyPress: false, eatButtons: false, halftimeFired: false,
    latch: { pass: false, shoot: false, through: false, power: false, skill: false },
    prev: frame.slice(), cur: frame.slice(), foulPresentation: new FoulPresentation(),
    replay: null, replayDone: false, replayWanted: false, recorded: 0, goalFrame: 0,
    goalWideS: PRESENTATION.goalWideS, celebDue: -1, megaShotT: -100, goldenGoalArmed: false,
    ownerBefore: -1, activeBefore: match.activeOf(0), hitStopT: 0, tally: new MatchTally(), lastPasser: [-1, -1],
    buffer: new ReplayBuffer(300), world: {}, clipName: '', clipLive: false,
    clips: { recording: false, stop: vi.fn() }, flash: { play: vi.fn() }, ghost: null,
    effects: { burst: vi.fn(), confetti: vi.fn(), clear: vi.fn() }, fxKit: { clear: vi.fn() },
    updateFrameFx: vi.fn(),
    stadium: { setScore: vi.fn(), punchNet: vi.fn(), flashBurst: vi.fn() },
    // The separate cinematic lifecycle suite exercises tunnel scenes. Keep these tests at the transition boundary.
    startMatchInterlude: vi.fn(() => false),
  }) as MatchSession;
  const internals = session as unknown as {
    paused: boolean; anyPress: boolean; eatButtons: boolean; halftimeFired: boolean; recorded: number;
    replay: Float32Array[] | null; replayDone: boolean; replayWanted: boolean; replayT: number;
    latch: { pass: boolean; shoot: boolean; through: boolean; power: boolean; skill: boolean };
    buffer: ReplayBuffer;
    flow(dt: number): void; stepReplay(dt: number): void; handleEvents(events: MatchEvent[]): void; buildPad(): Pad;
  };
  const renderFrame = () => {
    internals.flow(DT);
    // MatchSession.update consumes anyPress once per rendered frame, after flow.
    internals.anyPress = false;
  };
  const record = (count: number) => {
    for (let i = 0; i < count; i++) {
      internals.buffer.push(match, internals.recorded * DT);
      internals.recorded++;
    }
  };
  const goal = (worthReplay: boolean) => {
    match.phase = 'play';
    match.restart = null;
    match.ball.lastTouch = 9;
    Object.assign(match.ball.pos, { x: HALF_L + 0.1, y: 0.5, z: 0 });
    match.shotDist = worthReplay ? 24 : 6;
    match.shotStyle = null;
    match.kickKind = 'shot';
    record(150);
    (match as unknown as { goal(side: Side): void }).goal(0);
    internals.handleEvents(match.drainEvents());
    record(60);
  };
  return { match, input, session, internals, cam, hud, view, replayClasses, renderFrame, goal };
}

describe('second half after a native interruption', () => {
  it.each(['pass', 'skill', 'power'] as const)('resumes a paused half-time session, clears stale actions and eats held %s before the second-half kickoff', (held) => {
    const h = rig();
    h.match.phase = 'halftime';
    h.match.clock = 150;
    h.match.half = 1;
    h.internals.paused = true;
    h.internals.halftimeFired = true;
    h.internals.anyPress = true;
    for (const key of ['pass', 'shoot', 'through', 'power', 'skill'] as const) {
      h.internals.latch[key] = true;
      h.input.touch[key] = true;
    }
    const oldDirection = h.match.attackDir(0);
    const secondKickoff = h.match.restart!.side === 0 ? 1 : 0;
    const reset = vi.spyOn(h.input, 'reset');
    h.session.continueSecondHalf();
    expect(h.session.paused).toBe(false);
    expect(reset).toHaveBeenCalledOnce();
    expect(h.input.read()).toMatchObject({ pass: false, shoot: false, through: false, power: false, skill: false });
    expect(Object.values(h.internals.latch)).toEqual([false, false, false, false, false]);
    expect(h.internals.anyPress).toBe(false);
    expect(h.internals.eatButtons).toBe(true);
    expect(h.internals.halftimeFired).toBe(false);
    expect(h.match.half).toBe(2);
    expect(h.match.clock).toBe(0);
    expect(h.match.phase).toBe('kickoff');
    expect(h.match.restart?.side).toBe(secondKickoff);
    expect(h.match.attackDir(0)).toBe(-oldDirection);
    expect(h.cam.cut).toHaveBeenCalledOnce();
    expect(h.view.apply).toHaveBeenCalledOnce();

    // A platform can still report the same physical button held after input reset. It cannot become the kick-off.
    h.input.touch[held] = true;
    h.internals.latch[held] = true;
    const swallowed = h.internals.buildPad();
    expect(swallowed[held]).toBe(false);
    expect(h.internals.latch[held]).toBe(false);
    h.match.step(DT, swallowed);
    expect(h.match.phase).toBe('kickoff');
    h.input.touch[held] = false;
    h.internals.buildPad();
    expect(h.internals.eatButtons).toBe(false);
    h.input.touch[held] = true;
    expect(h.internals.buildPad()[held]).toBe(true);
  });

  it('freshens the AI once and ignores repeated SECOND HALF callbacks after the phase has moved on', () => {
    const h = rig();
    h.match.phase = 'halftime';
    for (const p of h.match.teamPlayers(1)) p.stamina = 0.2;
    const aiSubs = vi.spyOn(h.match, 'aiSubs');
    h.session.continueSecondHalf();
    expect(aiSubs).toHaveBeenCalledExactlyOnceWith(1, 2);
    expect(h.match.subsUsed[1]).toBe(2);
    expect(h.view.replacePlayer).toHaveBeenCalledTimes(2);
    const changes = h.match.teamPlayers(1).map((p) => p.def.id);
    h.session.continueSecondHalf();
    h.session.continueSecondHalf();
    expect(aiSubs).toHaveBeenCalledOnce();
    expect(h.match.subsUsed[1]).toBe(2);
    expect(h.match.teamPlayers(1).map((p) => p.def.id)).toEqual(changes);
    expect(h.view.replacePlayer).toHaveBeenCalledTimes(2);
    expect(h.cam.cut).toHaveBeenCalledOnce();
  });
});

describe('repeated goal skip and replay transitions', () => {
  it('shows one skip state per celebration, consumes its tap and clears it on every kickoff through goals three and four', () => {
    const h = rig();
    for (let goal = 1; goal <= 4; goal++) {
      h.goal(false);
      expect(h.match.score[0]).toBe(goal);
      h.match.phaseT = PRESENTATION.goalWideS + PRESENTATION.goalSkipGraceS + 0.01;
      h.renderFrame();
      expect(h.replayClasses.contains('skip-only')).toBe(true);
      h.internals.anyPress = true;
      h.input.touch.pass = true;
      h.renderFrame();
      expect(h.match.phase).toBe('kickoff');
      expect(h.replayClasses.contains('skip-only')).toBe(false);
      expect(h.replayClasses.contains('on')).toBe(false);
      expect(h.internals.replay).toBeNull();
      expect(h.internals.eatButtons).toBe(true);
      expect(h.internals.buildPad().pass).toBe(false);
      h.input.touch.pass = false;
      h.internals.buildPad();
      h.renderFrame();
      expect(h.replayClasses.contains('skip-only')).toBe(false);
    }
  });

  it('runs real replays on the third and fourth goals and clears their HUD state whether skipped or naturally finished', () => {
    const h = rig();
    for (let goal = 1; goal <= 4; goal++) {
      h.goal(true);
      expect(h.internals.replayWanted).toBe(true);
      h.match.phaseT = PRESENTATION.replayAtS + 0.1;
      h.renderFrame();
      expect(h.internals.replay?.length).toBeGreaterThan(2);
      const replayLength = h.internals.replay!.length;
      expect(h.cam.mode).toBe('replay');
      expect(h.replayClasses.contains('on')).toBe(true);
      expect(h.replayClasses.contains('skip-only')).toBe(false);
      if (goal === 3) {
        h.internals.anyPress = true;
        h.input.touch.pass = true;
        h.internals.stepReplay(DT);
      } else {
        // SHOOT held from the replay's opening is not a new skip edge: let the fourth replay finish naturally.
        if (goal === 4) h.input.touch.shoot = true;
        for (let frame = 0; frame < 900 && h.internals.replay; frame++) h.internals.stepReplay(DT);
      }
      h.internals.anyPress = false;
      expect(h.match.phase).toBe('kickoff');
      expect(h.cam.mode).toBe('broadcast');
      expect(h.replayClasses.contains('on')).toBe(false);
      expect(h.replayClasses.contains('skip-only')).toBe(false);
      expect(h.internals.replay).toBeNull();
      expect(h.internals.replayDone).toBe(false);
      if (goal === 4) expect(h.internals.replayT * 60).toBeGreaterThanOrEqual(replayLength - 1);
      if (goal === 3 || goal === 4) {
        expect(h.internals.eatButtons).toBe(true);
        expect(h.internals.buildPad()[goal === 3 ? 'pass' : 'shoot']).toBe(false);
      }
      h.input.touch.pass = h.input.touch.shoot = false;
      h.internals.buildPad();
      h.renderFrame();
      expect(h.replayClasses.contains('skip-only')).toBe(false);
    }
  });
});
