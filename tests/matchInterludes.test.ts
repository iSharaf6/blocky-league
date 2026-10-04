import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  INTERLUDE_SECONDS, MatchInterlude, TUNNEL_HIDE_Z, TUNNEL_MOUTH_Z, applyInterlude, interludeOrder, interludeShot,
  type MatchInterludeKind,
} from '../src/game/matchInterludes';
import { FRAME_LEN, PF, STATE_CODE, writeFrame } from '../src/game/replay';
import { MatchSession } from '../src/game/matchSession';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { MatchTunnel } from '../src/render/matchTunnel';
import { Match } from '../src/sim/match';
import { HALF_W } from '../src/sim/constants';

const home = Array.from({ length: 11 }, (_, i) => i);
const away = home.map((i) => i + 11);
const newShot = () => ({ px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0, fov: 0 });

describe('local match stories', () => {
  it.each<MatchInterludeKind>(['halftime', 'return', 'sportsmanship'])('%s ends once, within a few seconds, with a safe opening-tap grace', (kind) => {
    const scene = new MatchInterlude(kind, home, away);
    expect(scene.tick(0.1, true)).toBe(false);
    expect(scene.tick(0.1, true)).toBe(false);
    expect(scene.tick(0.1, false)).toBe(false);
    expect(scene.tick(0.1, true)).toBe(true);
    expect(scene.tick(0.1, false)).toBe(true);
    const full = new MatchInterlude(kind, home, away);
    for (let i = 0; i < 35; i++) full.tick(0.1, false);
    expect(full.done).toBe(true);
    expect(INTERLUDE_SECONDS[kind]).toBeLessThanOrEqual(3.2);
  });

  it('holds a captain-first cast snapshot, including only eligible actors supplied by the session', () => {
    const ids = [0, 2, 5, 8];
    const sorted = interludeOrder(ids, 5);
    const scene = new MatchInterlude('halftime', sorted, [11, 12]);
    sorted.pop();
    expect(scene.actors).toEqual([5, 0, 2, 8, 11, 12]);
    expect(interludeOrder(ids, -1)).toEqual(ids);
    expect(scene.actors).not.toContain(1);
  });

  it('walks both teams into the covered passage and returns them facing the pitch', () => {
    const f = new Float32Array(FRAME_LEN);
    const exit = new MatchInterlude('halftime', home, away);
    applyInterlude(f, exit, 3);
    const initial = f[1];
    expect(initial).toBeLessThan(HALF_W);
    expect(f[PF + 1]).toBeLessThan(initial);
    expect(f[11 * PF]).toBeGreaterThan(f[0]);
    expect(f[7]).toBeGreaterThan(1);
    expect(f[4]).toBe(STATE_CODE.move);
    expect(Math.sin(f[3])).toBeGreaterThan(0.99);
    exit.age = INTERLUDE_SECONDS.halftime * 0.8;
    applyInterlude(f, exit, 5);
    expect(f[1]).toBeGreaterThan(initial + 4);
    expect(f[1]).toBeLessThan(TUNNEL_HIDE_Z);
    exit.age = INTERLUDE_SECONDS.halftime;
    applyInterlude(f, exit, 6);
    expect(f[1]).toBeGreaterThan(HALF_W + 20); // Inside the covered passage, never through the stand behind it.

    const back = new MatchInterlude('return', home, away);
    applyInterlude(f, back, 10);
    expect(f[1]).toBeGreaterThan(TUNNEL_MOUTH_Z);
    expect(Math.sin(f[3])).toBeLessThan(-0.99);
    back.age = INTERLUDE_SECONDS.return;
    applyInterlude(f, back, 13);
    expect(f[1]).toBeCloseTo(initial);
    expect(f[PF + 1]).toBeGreaterThan(f[1]);
    expect(f[8]).toBe(0);
    expect(f[12]).toBe(0);
    expect(f[14]).toBe(0);
  });

  it('opponents approach one another, greet once, then pass and applaud instead of freezing in the greeting', () => {
    const scene = new MatchInterlude('sportsmanship', home, away);
    const f = new Float32Array(FRAME_LEN);
    applyInterlude(f, scene, 0);
    const gap = f[11 * PF] - f[0];
    expect(gap).toBeGreaterThan(5);
    expect(scene.takeGreeting()).toBe(false);
    scene.age = INTERLUDE_SECONDS.sportsmanship * 0.5;
    applyInterlude(f, scene, 2);
    expect(f[11 * PF] - f[0]).toBeLessThan(1.3);
    expect(f[4]).toBe(STATE_CODE.celebrate);
    expect(scene.takeGreeting()).toBe(true);
    expect(scene.takeGreeting()).toBe(false);
    const greeting = f[13];
    scene.age = INTERLUDE_SECONDS.sportsmanship;
    applyInterlude(f, scene, 4);
    expect(f[0]).toBeGreaterThan(f[11 * PF]);
    expect(f[13]).not.toBe(greeting);
    expect(Math.sin(f[3])).toBeGreaterThan(0.99);
  });

  it.each<MatchInterludeKind>(['halftime', 'return', 'sportsmanship'])('%s changes the drawn frame while preserving simulation actors, ball and random state', (kind) => {
    const m = new Match({ home: makeTeam(PRESET_CLUBS[0]), away: makeTeam(PRESET_CLUBS[1]), halfLength: 150, difficulty: 1.8, humanSide: 0, seed: 27 });
    const original = JSON.stringify(m);
    const source = new Float32Array(FRAME_LEN);
    writeFrame(m, source, 0);
    const drawn = source.slice();
    const scene = new MatchInterlude(kind, home, away);
    scene.age = INTERLUDE_SECONDS[kind] * 0.5;
    applyInterlude(drawn, scene, 2);
    expect([...drawn]).not.toEqual([...source]);
    expect(JSON.stringify(m)).toBe(original);
    expect([...source.slice(22 * PF)]).toEqual([...drawn.slice(22 * PF)]);
  });

  it('keeps each moving lens on the pitch side of the boards, with finite low framing on phone draw scales', () => {
    for (const kind of ['halftime', 'return', 'sportsmanship'] as const) {
      const scene = new MatchInterlude(kind, home, away);
      const shot = newShot();
      for (const tall of [1.9, 2.47]) for (let i = 0; i <= 60; i++) {
        scene.age = i / 60 * INTERLUDE_SECONDS[kind];
        interludeShot(scene, shot, tall);
        expect(Object.values(shot).every(Number.isFinite)).toBe(true);
        expect(shot.pz).toBeLessThan(HALF_W);
        expect(Math.hypot(shot.px - shot.tx, shot.pz - shot.tz)).toBeGreaterThan(5);
        expect(shot.py).toBeGreaterThan(1);
        expect(shot.py).toBeLessThan(2);
        expect(shot.fov).toBeGreaterThanOrEqual(34);
      }
    }
  });
});

describe('the dressing-room passage set', () => {
  it('is absent during play and disposes only its own geometry when a match exits', () => {
    const tunnel = new MatchTunnel(0x2230d6, 0xeb5832);
    const parent = new THREE.Group();
    parent.add(tunnel.group);
    expect(tunnel.group.visible).toBe(false);
    tunnel.show(true);
    expect(tunnel.group.visible).toBe(true);
    const mesh = tunnel.group.children[0] as THREE.Mesh;
    const geometry = vi.spyOn(mesh.geometry, 'dispose');
    const sharedMaterial = vi.spyOn(mesh.material as THREE.Material, 'dispose');
    tunnel.dispose();
    expect(geometry).toHaveBeenCalledOnce();
    expect(sharedMaterial).not.toHaveBeenCalled();
    expect(parent.children).toHaveLength(0);
    expect(tunnel.group.visible).toBe(false);
    vi.restoreAllMocks();
  });
});

/** Exercise the session's real scene lifetime with a real simulation, without creating a WebGL surface in Node. */
function sessionFixture() {
  const m = new Match({ home: makeTeam(PRESET_CLUBS[0]), away: makeTeam(PRESET_CLUBS[1]), halfLength: 150, difficulty: 1.8, humanSide: 0, seed: 27 });
  const controls = { pass: false, shoot: false, through: false, skill: false, power: false, sprint: false };
  const view = { headTop: 2.1, frameHook: null as ((f: Float32Array) => void) | null,
    celeb: { end: vi.fn() }, apply: vi.fn(), setMarkerVisible: vi.fn(), setBallHidden: vi.fn() };
  const cam = { mode: 'broadcast', setMode: vi.fn((mode: string) => { cam.mode = mode; }), cut: vi.fn() };
  const session = Object.assign(Object.create(MatchSession.prototype), {
    match: m, opt: { kits: [m.teams[0].kit, m.teams[1].kit] },
    demo: false, driver: null, moment: null, paused: false, interlude: null, subCut: null, sceneKeep: [], sceneClear: 0,
    time: 0, prevButtons: false, anyPress: false, eatButtons: false, acc: 0,
    finishFired: false, halftimeFired: false, sportsmanshipDone: false,
    lineupLeft: 0, subQueue: [], motm: null,
    hud: { hideIntro: vi.fn(), setSkippable: vi.fn(), show: vi.fn() },
    input: { read: () => controls }, view, cam, matchTunnel: { show: vi.fn() },
    present: { hideChant: vi.fn(), showPlate: vi.fn(), hidePlate: vi.fn() },
    sceneShot: newShot(), prev: new Float32Array(FRAME_LEN), cur: new Float32Array(FRAME_LEN),
    clearLatch: vi.fn(), resetView: vi.fn(), motmBeat: vi.fn(() => false), ratings: () => [],
    onHalftime: vi.fn(), onFinish: vi.fn(),
  }) as MatchSession;
  return { m, session, controls, view, cam,
    internals: session as unknown as { flow(dt: number): void; startMatchInterlude(kind: MatchInterludeKind): boolean; stepMatchInterlude(dt: number): void; interlude: MatchInterlude | null; } };
}

describe('scene transitions in a match session', () => {
  it('shows the half-time tunnel before the menu, holding the simulation and firing the menu callback once', () => {
    const { m, session, internals, view, cam } = sessionFixture();
    m.phase = 'halftime';
    m.phaseT = 2;
    const before = JSON.stringify(m);
    internals.flow(0.1);
    expect(session.staging.interlude).toBe('halftime');
    expect(cam.mode).toBe('scene');
    expect(session.onHalftime).not.toHaveBeenCalled();
    for (let i = 0; i < 34; i++) if (internals.interlude) internals.stepMatchInterlude(0.1);
    expect(session.onHalftime).toHaveBeenCalledOnce();
    expect(JSON.stringify(m)).toBe(before);
    expect(internals.interlude).toBeNull();
    expect(view.frameHook).toBeNull();
    expect(cam.mode).toBe('broadcast');
    internals.flow(0.1);
    expect(session.onHalftime).toHaveBeenCalledOnce();
    expect(internals.interlude).toBeNull();
  });

  it('returns from the tunnel with the kick-off untouched, consumes a skip action, and restores the match framing', () => {
    const { m, session, internals, controls, view, cam } = sessionFixture();
    m.phase = 'halftime';
    m.continueSecondHalf();
    const before = JSON.stringify(m);
    expect(internals.startMatchInterlude('return')).toBe(true);
    for (let i = 0; i < 4; i++) internals.stepMatchInterlude(0.1);
    controls.shoot = true;
    internals.stepMatchInterlude(0.1);
    expect(internals.interlude).toBeNull();
    expect(view.frameHook).toBeNull();
    expect(cam.mode).toBe('broadcast');
    expect(view.setMarkerVisible).toHaveBeenLastCalledWith(true);
    expect(JSON.stringify(m)).toBe(before);
    expect(session.onHalftime).not.toHaveBeenCalled();
    expect((session as unknown as { eatButtons: boolean }).eatButtons).toBe(true);
  });

  it('shows sportsmanship before the result once, then removes its cast and set', () => {
    const { m, session, internals, view } = sessionFixture();
    m.phase = 'fulltime';
    m.phaseT = 10;
    internals.flow(0.1);
    expect(session.staging.interlude).toBe('sportsmanship');
    expect(session.onFinish).not.toHaveBeenCalled();
    for (let i = 0; i < 32; i++) if (internals.interlude) internals.stepMatchInterlude(0.1);
    expect(session.onFinish).toHaveBeenCalledOnce();
    expect(view.frameHook).toBeNull();
    internals.flow(0.1);
    expect(session.onFinish).toHaveBeenCalledOnce();
    expect(internals.interlude).toBeNull();
  });

  it.each(['driver', 'demo', 'moment'] as const)('never inserts a timed scene into %s play', (key) => {
    const { m, internals, session } = sessionFixture();
    m.phase = 'halftime';
    (session as unknown as Record<string, unknown>)[key] = key === 'demo' ? true : {};
    expect(internals.startMatchInterlude('halftime')).toBe(false);
    expect(internals.interlude).toBeNull();
  });
});
