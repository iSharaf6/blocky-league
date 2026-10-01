import { describe, expect, it, vi } from 'vitest';
import { FOUL_BEAT_S, FoulPresentation, type BookingShot } from '../src/game/foulPresentation';
import { MatchSession } from '../src/game/matchSession';
import { FRAME_LEN, writeFrame } from '../src/game/replay';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT, HALF_W } from '../src/sim/constants';
import { EMPTY_PAD, Match, type Phase, type Restart } from '../src/sim/match';
import type { Player } from '../src/sim/player';
import type { MatchEvent, RestartKind } from '../src/sim/types';

const freeKick = (): Restart => ({ kind: 'freekick', side: 0, x: -12, z: 3, taker: 9, wait: 0.7 });
const verdict = (kind: RestartKind = 'freekick', side: 0 | 1 = 0): Extract<MatchEvent, { type: 'restart' }> =>
  ({ type: 'restart', kind, side });
const booking = (restart: Restart, color: 'yellow' | 'red' = 'yellow'): BookingShot =>
  ({ player: 17, playerId: 'original-player', name: 'Original Player', color,
    second: color === 'red', x: -13.3, z: 3, close: true, restart });

function pending() {
  const beat = new FoulPresentation();
  const restart = freeKick();
  beat.contact(0);
  beat.queueBooking(booking(restart));
  expect(beat.queueRestart(verdict(), restart)).toBe(true);
  return { beat, restart };
}

function place(p: Player, x: number, z: number): void {
  p.pos.x = x;
  p.pos.z = z;
  p.vel.x = p.vel.z = 0;
  p.setState('move');
  p.order = null;
}

/** The same real mistimed slide as the rules tests; no manufactured foul/card/restart events. */
function realFoul(second: boolean, penalty = false) {
  for (let seed = 1; seed <= 20; seed++) {
    const m = new Match({
      home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]),
      halfLength: 150, difficulty: 2, humanSide: 0, seed,
    });
    m.phase = 'play';
    m.restart = null;
    m.phaseT = 0;
    m.drainEvents();
    m.players.forEach((p, i) => place(p, -40 + i * 3.6, -HALF_W + 1.5));
    const on = m.players[9];
    const by = m.players[17];
    const x = penalty ? 40 : -12;
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
    if (second) m.booked.add(by.idx);
    m.startSlide(by);
    by.slideFoul = true;
    const events: MatchEvent[] = [];
    for (let i = 0; i < 60 && !events.some((e) => e.type === 'foul'); i++) {
      m.step(DT, EMPTY_PAD);
      events.push(...m.drainEvents());
    }
    if (events.some((e) => e.type === 'card' && e.player === by.idx)) return { m, on, by, events };
  }
  throw new Error('A real booked foul was not produced by the deterministic slide fixture');
}

/** Run the actual session event handler/frame scheduler, with rendering endpoints replaced by doubles. */
function sessionFor(m: Match) {
  const beat = new FoulPresentation();
  const frame = new Float32Array(FRAME_LEN);
  writeFrame(m, frame, 0);
  const hud = {
    commentary: vi.fn(), card: vi.fn(), show: vi.fn(), toastMsg: vi.fn(), setCinematic: vi.fn(),
  };
  const refState = { x: -15, z: 3, faceX: -13.3, faceZ: 3 };
  const view = {
    frame, headTop: 1.9, refState,
    apply: vi.fn((_prev: Float32Array, cur: Float32Array) => frame.set(cur)),
    tickFlashes: vi.fn(), flashPlayer: vi.fn(), refSignal: vi.fn(), clearFades: vi.fn(), pinPlayer: vi.fn(),
    setBallHidden: vi.fn(), setMarkerMode: vi.fn(), setTeamRings: vi.fn(), setTeamPips: vi.fn(),
    setShadowBudget: vi.fn(), faceCamera: vi.fn(), updateReferee: vi.fn(),
    setRival: vi.fn(), replacePlayer: vi.fn(),
    showCard: vi.fn((_color: string, x: number, z: number, _seconds: number, _close: boolean) => { refState.faceX = x; refState.faceZ = z; }),
  };
  const cam = {
    mode: 'broadcast', behindActive: false, holding: false, focusX: 0, focusZ: 0,
    screenToWorld: (x: number, z: number) => ({ x, z }),
    update: vi.fn(), shakePx: vi.fn(), softCut: vi.fn(), cut: vi.fn(),
    cardLens: () => ({ x: -20, z: 12 }),
    setMode: vi.fn((mode: string) => { cam.mode = mode; }),
  };
  const session = Object.create(MatchSession.prototype) as MatchSession;
  Object.assign(session, {
    match: m, foulPresentation: beat, hud, view, cam, demo: false, paused: false, driver: null,
    opt: { kits: [m.teams[0].kit, m.teams[1].kit] }, tally: { sub: vi.fn() }, lastPasser: [-1, -1],
    input: { reset: vi.fn(), read: () => ({ sx: 0, sy: 0, sprint: false, pass: false, shoot: false, through: false }), lastDevice: 'keyboard' },
    touch: null, onPause: null, moment: null, replay: null, introLeft: 0, holdFirst: false,
    acc: 0, time: 0, hitStopT: 0, cardT: 0, cineHud: false, recorded: 0,
    prev: new Float32Array(frame), cur: new Float32Array(frame), focusOut: {}, cardFocus: {},
    buffer: { push: vi.fn() }, lunge: new Float32Array(22).fill(-1), lungeLeg: new Float32Array(22),
    tryAt: new Float64Array(22).fill(-100), latch: { pass: false, shoot: false, through: false, power: false },
    holdKick: null, foulOn: -1, foulAt: { x: 0, z: 0 }, foulBy: { x: 0, z: 0 },
    world: { quality: 'high', camera: {}, focusShadows: vi.fn() },
    stadium: { setArchVisible: vi.fn(), updateGlare: vi.fn(), update: vi.fn() },
    effects: { dust: vi.fn(), grass: vi.fn(), update: vi.fn() },
    weather: { kind: 'clear', update: vi.fn() }, flash: { update: vi.fn() }, clips: { update: vi.fn(), recording: false },
    holdLesson: () => false, updateFrameFx: vi.fn(), updateBlitz: vi.fn(), updateFades: vi.fn(),
    updateAtmosphere: vi.fn(), updateHud: vi.fn(), updateGhost: vi.fn(),
  });
  const events = (list: MatchEvent[]) => (session as unknown as { handleEvents(e: MatchEvent[]): void }).handleEvents(list);
  return { session, beat, hud, view, cam, events };
}

describe('the tackle has time to read before the referee decision', () => {
  it.each([false, true])('defers the real card/restart sequence, second booking %s, exactly once', (second) => {
    const { m, on, by, events } = realFoul(second);
    expect(events.filter((e) => ['foul', 'card', 'whistle', 'restart'].includes(e.type)).map((e) => e.type))
      .toEqual(['foul', 'card', 'whistle', 'restart']);
    expect(m.phase).toBe('out');
    const h = sessionFor(m);
    h.events(events);
    const contact = { bx: on.pos.x, bz: on.pos.z, setPiece: null };
    expect(h.view.flashPlayer).toHaveBeenCalledWith(on.idx, expect.any(Number));
    expect(h.hud.card).toHaveBeenCalledWith(by.side, second ? 'red' : 'yellow', by.idx);
    expect(h.view.showCard).not.toHaveBeenCalled();
    expect(h.hud.show).not.toHaveBeenCalled();
    expect(h.beat.impact(m.phase, m.restart)).toBe(true);
    const clock = m.clock;
    for (let i = 0; i < 5; i++) h.session.update(0.1);
    h.session.update(0.09);
    expect(m.clock).toBeGreaterThan(clock); // This is camera pacing, not a simulation pause.
    expect(h.view.showCard).not.toHaveBeenCalled();
    expect(h.cam.mode).toBe('broadcast');
    expect(h.cam.update.mock.lastCall?.[1]).toMatchObject(contact);
    h.session.update(0.01);
    expect(h.view.showCard).toHaveBeenCalledTimes(1);
    expect(h.view.showCard.mock.calls[0][0]).toBe(second ? 'red' : 'yellow');
    expect(h.cam.mode).toBe('card');
    if (second) {
      const [, x, z] = h.view.showCard.mock.calls[0];
      expect(Math.hypot(x - by.pos.x, z - by.pos.z)).toBeGreaterThan(0.3);
    }
    expect(h.hud.show).toHaveBeenCalledWith(second ? 'RED CARD' : 'YELLOW CARD',
      second ? `${by.def.name} · 2nd yellow` : by.def.name, expect.any(String), expect.any(Number));
    expect(h.hud.toastMsg.mock.calls.filter(([text]) => text === 'FREE KICK')).toHaveLength(1);
    h.session.update(0.1);
    expect(h.view.showCard).toHaveBeenCalledTimes(1);
  });

  it('freezes only the presentation countdown while the session is paused', () => {
    const { m, events } = realFoul(false);
    const h = sessionFor(m);
    h.events(events);
    h.session.update(0.2);
    h.session.requestPause();
    h.view.updateReferee.mockClear();
    const clock = m.clock;
    for (let i = 0; i < 30; i++) h.session.update(0.1);
    expect(m.clock).toBe(clock);
    expect(h.beat.waiting).toBe(true);
    expect(h.view.showCard).not.toHaveBeenCalled();
    expect(h.view.updateReferee.mock.calls.every(([dt]) => dt === 0)).toBe(true);
    h.session.resume();
    for (let i = 0; i < 4; i++) h.session.update(0.1);
    expect(h.view.showCard).not.toHaveBeenCalled();
    h.session.update(0.1);
    expect(h.view.showCard).toHaveBeenCalledTimes(1);
  });

  it('defers an actual penalty verdict with its booking while readiness clocks continue', () => {
    const { m, events } = realFoul(false, true);
    expect(events.some((e) => e.type === 'restart' && e.kind === 'penalty')).toBe(true);
    const h = sessionFor(m);
    h.events(events);
    expect(h.hud.show).not.toHaveBeenCalled();
    for (let i = 0; i < 6; i++) h.session.update(0.1);
    expect(h.hud.show.mock.calls.some(([title]) => title === 'PENALTY!')).toBe(true);
    expect(h.view.showCard).toHaveBeenCalledTimes(1);
    expect(m.phase === 'out' || m.phase === 'restart').toBe(true);
    expect(m.stats.shots[0]).toBe(0);
  });

  it('respects a peer pause arriving in driver.frame, through the beat and the active close-up', () => {
    const { m, events } = realFoul(false);
    const h = sessionFor(m);
    h.events(events);
    let paused = false;
    let arrivingPause = true;
    h.session.driver = {
      get paused() { return paused; },
      frame() { if (arrivingPause) { paused = true; arrivingPause = false; } },
      next: () => paused ? null : [EMPTY_PAD, EMPTY_PAD], after: () => {}, pace: () => 1,
    };
    const clock = m.clock;
    for (let i = 0; i < 30; i++) h.session.update(0.1);
    expect(m.clock).toBe(clock);
    expect(h.beat.waiting).toBe(true);
    expect(h.view.showCard).not.toHaveBeenCalled();
    expect(h.view.updateReferee.mock.calls.every(([dt]) => dt === 0)).toBe(true);
    paused = false;
    for (let i = 0; i < 6; i++) h.session.update(0.1);
    expect(h.view.showCard).toHaveBeenCalledTimes(1);
    expect(h.cam.mode).toBe('card');
    const cardClock = m.clock;
    h.view.updateReferee.mockClear();
    paused = true;
    for (let i = 0; i < 30; i++) h.session.update(0.1);
    expect(m.clock).toBe(cardClock);
    expect(h.cam.mode).toBe('card');
    expect(h.view.updateReferee.mock.calls.every(([dt]) => dt === 0)).toBe(true);
    paused = false;
    for (let i = 0; i < 19; i++) h.session.update(0.1);
    expect(h.cam.mode).toBe('broadcast');
  });

  it('announces the original booked footballer after a paused substitution without pinning his replacement', () => {
    const { m, by, events } = realFoul(false);
    const name = by.def.name;
    const id = by.def.id;
    const h = sessionFor(m);
    h.events(events);
    h.session.update(0.1);
    h.session.requestPause();
    const bench = m.bench[by.side].findIndex((p) => p.role !== 'GK');
    expect(h.session.substitute(by.side, by.slot, bench)).toBe(true);
    expect(by.def.id).not.toBe(id);
    h.session.resume();
    for (let i = 0; i < 5; i++) h.session.update(0.1);
    expect(h.hud.show).toHaveBeenCalledWith('YELLOW CARD', name, expect.any(String), expect.any(Number));
    expect(h.view.showCard.mock.calls[0][4]).toBe(false);
    expect(h.view.pinPlayer).not.toHaveBeenCalled();
    expect(h.cam.mode).toBe('broadcast');
    expect(h.hud.card).toHaveBeenCalledTimes(1);
  });

  it('ends an active card shot if a new restart supersedes its stoppage in the same phase', () => {
    const { m, events } = realFoul(false);
    const h = sessionFor(m);
    h.events(events);
    for (let i = 0; i < 6; i++) h.session.update(0.1);
    expect(h.cam.mode).toBe('card');
    m.restart = { ...m.restart!, x: m.restart!.x + 1 };
    h.session.update(0.001);
    expect(h.cam.mode).toBe('broadcast');
    expect(h.view.pinPlayer).toHaveBeenLastCalledWith(null);
    expect(h.view.setBallHidden).toHaveBeenCalledWith(false);
  });

  it('ends an active card shot when its player is replaced during pause', () => {
    const { m, by, events } = realFoul(false);
    const h = sessionFor(m);
    h.events(events);
    for (let i = 0; i < 6; i++) h.session.update(0.1);
    expect(h.cam.mode).toBe('card');
    h.session.requestPause();
    expect(h.session.substitute(by.side, by.slot, m.bench[by.side].findIndex((p) => p.role !== 'GK'))).toBe(true);
    h.session.resume();
    h.session.update(0.001);
    expect(h.cam.mode).toBe('broadcast');
    expect(h.view.pinPlayer).toHaveBeenLastCalledWith(null);
  });

  it('uses the remaining contact beat when advantage is later whistled back', () => {
    const beat = new FoulPresentation();
    const restart = freeKick();
    beat.contact(0);
    beat.tick(0.4);
    beat.queueBooking(booking(restart));
    expect(beat.queueRestart(verdict(), restart)).toBe(true);
    beat.tick(0.19);
    expect(beat.take('out', restart)).toBeNull();
    beat.tick(0.01);
    expect(beat.take('out', restart)?.verdict).toEqual(verdict());
    expect(beat.take('out', restart)).toBeNull();
  });

  it('does not add a second beat when a late whistle-back happens after contact has settled', () => {
    const beat = new FoulPresentation();
    const restart = freeKick();
    beat.contact(0);
    beat.tick(1.1);
    expect(beat.queueRestart(verdict(), restart)).toBe(false);
    expect(beat.waiting).toBe(false);
  });

  it('keeps advantage live and shows a live booking without a pending close-up', () => {
    const { m, by } = realFoul(false);
    m.phase = 'play';
    m.restart = null;
    const h = sessionFor(m);
    h.events([{ type: 'foul', by: by.idx, on: 9, penalty: false }, { type: 'advantage', side: 0 },
      { type: 'card', player: by.idx, color: 'yellow' }]);
    expect(h.view.showCard).toHaveBeenCalledTimes(1);
    expect(h.view.showCard.mock.calls[0][4]).toBe(false);
    expect(h.cam.mode).toBe('broadcast');
    expect(h.beat.waiting).toBe(false);
    expect(h.beat.impact('play', null)).toBe(false);
    h.beat.tick(FOUL_BEAT_S);
    expect(h.beat.take('play', null)).toBeNull();
  });

  it.each(['advantage', 'offside'] as const)('clears an old foul episode when the caller handles %s', (kind) => {
    const { m, events } = realFoul(false);
    const h = sessionFor(m);
    h.events(events);
    expect(h.beat.waiting).toBe(true);
    h.events([kind === 'advantage' ? { type: 'advantage', side: 0 } : { type: 'offside', side: 0, player: 9 }]);
    expect(h.beat.waiting).toBe(false);
    expect(h.beat.impact(m.phase, m.restart)).toBe(false);
    expect(h.beat.take(m.phase, m.restart)).toBeNull();
  });
});

describe('a delayed referee shot belongs only to its current foul stoppage', () => {
  it('uses the booked player’s recorded coordinates even if he moves toward the dugout', () => {
    const { beat, restart } = pending();
    const shot = booking(restart, 'red');
    beat.queueBooking(shot);
    beat.tick(FOUL_BEAT_S);
    const result = beat.take('out', restart);
    expect(result?.booking).toEqual(shot);
    expect(result?.booking).toMatchObject({ player: 17, color: 'red', second: true, x: -13.3, z: 3 });
  });

  it.each(['play', 'goal', 'kickoff', 'halftime', 'fulltime', 'shootout'] as Phase[])
  ('discards a pending card/verdict when the match moves to %s', (phase) => {
    const { beat, restart } = pending();
    expect(beat.impact(phase, restart)).toBe(false);
    expect(beat.take(phase, restart)).toBeNull();
    beat.tick(FOUL_BEAT_S);
    expect(beat.take('out', restart)).toBeNull();
  });

  it('discards a pending cut when another restart supersedes the foul, even with equal coordinates', () => {
    const { beat, restart } = pending();
    const newer = { ...restart };
    expect(beat.impact('out', newer)).toBe(false);
    expect(beat.take('out', newer)).toBeNull();
    beat.tick(FOUL_BEAT_S);
    expect(beat.take('out', restart)).toBeNull();
  });

  it('keeps the same stoppage valid as out advances to restart', () => {
    const { beat, restart } = pending();
    expect(beat.impact('restart', restart)).toBe(true);
    beat.tick(FOUL_BEAT_S);
    expect(beat.take('restart', restart)?.booking?.player).toBe(17);
  });

  it.each(['kickoff', 'corner', 'throwin', 'goalkick'] as RestartKind[])
  ('leaves an unrelated %s immediate', (kind) => {
    const beat = new FoulPresentation();
    beat.contact(0);
    const restart = { ...freeKick(), kind };
    expect(beat.queueRestart(verdict(kind), restart)).toBe(false);
    expect(beat.impact('out', restart)).toBe(false);
    beat.tick(FOUL_BEAT_S);
    expect(beat.take('out', restart)).toBeNull();
  });

  it('does not defer the other side’s free kick during a contact beat', () => {
    const beat = new FoulPresentation();
    beat.contact(0);
    const restart = { ...freeKick(), side: 1 as const };
    expect(beat.queueRestart(verdict('freekick', 1), restart)).toBe(false);
  });

  it('preserves immediate restart/card compatibility when no foul beat was started', () => {
    const beat = new FoulPresentation();
    const restart = freeKick();
    expect(beat.queueRestart(verdict(), restart)).toBe(false);
    beat.queueBooking(booking(restart));
    expect(beat.take('restart', restart)?.booking?.player).toBe(17);
  });

  it('clears a pending decision when a new foul replaces it or the view is reset', () => {
    const { beat, restart } = pending();
    beat.contact(1);
    beat.tick(FOUL_BEAT_S);
    expect(beat.take('out', restart)).toBeNull();
    beat.contact(0);
    beat.queueBooking(booking(restart));
    beat.clear();
    expect(beat.waiting).toBe(false);
    expect(beat.take('out', restart)).toBeNull();
  });
});
